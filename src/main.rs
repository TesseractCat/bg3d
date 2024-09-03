#![allow(non_snake_case)]

use std::env;
use std::collections::HashMap;
use std::sync::Arc;
use std::ops::{Deref, DerefMut};
use std::error::Error;
use std::net::SocketAddr;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{
    body::Body,
    extract::{
        Path as AxumPath,
        ws::{Message, WebSocket, WebSocketUpgrade}
    },
    response::Redirect,
    routing::get,
    Router,
    http::{Uri, header::HeaderMap, header, Request}
};
use tower_http::{services::{ServeDir, ServeFile}, compression::CompressionLayer};
use tower::ServiceExt;

use futures_util::{StreamExt, SinkExt, TryFutureExt};
use tokio::time::{interval, timeout, Duration, Instant};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_stream::wrappers::UnboundedReceiverStream;

use random_color::Color;
use rapier3d::prelude::*;

mod math;
mod pawn;
mod lobby;
mod user;
mod physics;
mod events;
mod gltf_ext;

use lobby::*;
use pawn::*;
use user::*;
use events::*;

const PHYSICS_RATE: f32 = 1.0/45.0;
const CURSOR_RATE: f32 = 1.0/10.0;

//TODO: Replace this with Dashmap?
type Lobbies = Arc<RwLock<HashMap<String, Arc<Mutex<Lobby>>>>>;

#[tokio::main]
async fn main() {
    let default_port: u16 = 8080;
    let port: u16 = match env::args().nth(1) {
        Some(p) => p.parse::<u16>().unwrap_or(default_port),
        None => default_port,
    };
    
    // Define our lobbies HashMap
    let lobbies = Lobbies::default();

    let lobbies_index_clone = lobbies.clone();
    let lobbies_assets_clone = lobbies.clone();
    let lobbies_ws_clone = lobbies.clone();
    let lobbies_dashboard_clone = lobbies.clone();

    // Routing
    // FIXME: Re-add cache headers
    let lobby_routes = Router::new()
        .route("/", get(|AxumPath(lobby): AxumPath<String>, request: Request<Body>| async move {
            let lobbies = lobbies_index_clone.clone();
            if let Some(lobby) = lobbies.read().await.get(&lobby) {
                if lobby.lock().await.users.len() >= 32 {
                    return (
                        [(header::CACHE_CONTROL, "no-cache")],
                        ServeFile::new("static/full.html").oneshot(request).await
                    );
                }
            }
            return (
                [(header::CACHE_CONTROL, "no-cache")],
                ServeFile::new("static/index.html").oneshot(request).await
            );
        }))
        .nest_service("/assets", ServeDir::new("static/games").fallback(get(
            move |AxumPath(lobby): AxumPath<String>, uri: Uri| {
                let lobbies = lobbies_assets_clone.clone();
                println!("Someone requested asset path \"{}\" for lobby [{lobby}]", uri.path());

                retrieve_asset(lobbies, lobby, uri)
            }
        )))
        .route("/ws", get(
            |AxumPath(lobby): AxumPath<String>, ws: WebSocketUpgrade, headers: HeaderMap| async move {
                let lobbies = lobbies_ws_clone.clone();
                ws.on_upgrade(move |socket| async {
                    if let Err(err) = user_connected(socket, lobby, lobbies, headers).await {
                        println!("Error encountered in websocket connection: {:?}", err);
                    }
                })
            }
        ));
    let index_routes = Router::new()
        .route_service("/", ServeFile::new("static/frontpage/index.html"))
        .route("/index.html", get(|| async { Redirect::to("/") }));

    let app = index_routes
        .route("/dashboard", get(move || {
            let lobbies = lobbies_dashboard_clone.clone();
            dashboard(lobbies)
        }))
        .nest_service("/static",
                      ServeDir::new("static").append_index_html_on_directories(false))
        .nest_service("/plugins",
                      ServeDir::new("plugins").append_index_html_on_directories(false))
        .nest("/:lobby", lobby_routes)
        .layer(CompressionLayer::new());
    
    // Relay user statuses (cursors, head, etc)
    let lobbies_clone = lobbies.clone();
    tokio::task::spawn(async move  {
        let mut interval = interval(Duration::from_secs_f32(CURSOR_RATE));
        loop {
            {
                let lobbies_rl = lobbies_clone.read().await;
                for lobby in lobbies_rl.values() {
                    let lobby = lobby.lock().await;
                    lobby.relay_user_statuses().ok();
                }
            }
            interval.tick().await;
        }
    });

    println!("Starting BG3D on port [{port}]...");
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    axum::serve(listener, app).await.unwrap();
}
async fn dashboard(lobbies: Lobbies) -> String {
    let lobbies = lobbies.read().await;

    let mut lobbies_text = String::new();
    for (name, lobby) in lobbies.iter() {
        let lobby = lobby.lock().await;
        lobbies_text += &format!(" - '{}' [{} user(s)]\n", name, lobby.users.len());
    }

    format!(
        include_str!("../static/dashboard.html"),
        lobby_count = lobbies.len(),
        lobbies = lobbies_text
    )
}
async fn retrieve_asset(lobbies: Lobbies, lobby: String, path: Uri) -> axum::response::Result<impl IntoResponse> {
    let lobbies_rl = lobbies.read().await;

    let lobby = lobbies_rl.get(&lobby).ok_or(StatusCode::NOT_FOUND)?.lock().await;
    let asset = lobby.assets.get(path.path()).ok_or(StatusCode::NOT_FOUND)?;

    axum::response::Result::Ok((
        [
            ("Content-Type", asset.mime_type.to_string()),
            ("Cache-Control", "no-cache, no-store, must-revalidate".to_string())
        ],
        asset.data.clone()
    ))
}

async fn user_connected(ws: WebSocket, lobby_name: String, lobbies: Lobbies, headers: HeaderMap) -> Result<(), Box<dyn Error>> {
    let (mut tx, mut rx) = ws.split();
    
    let (buffer_tx, buffer_rx) = mpsc::unbounded_channel::<Message>();
    
    // Automatically send buffered messages
    let mut buffer_rx = UnboundedReceiverStream::new(buffer_rx);
    let buffer_task_handle = tokio::task::spawn(async move {
        while let Some(message) = buffer_rx.next().await {
            tx.send(message).unwrap_or_else(|_| {}).await
        }
    });

    // Send keep-alive pings every 5 seconds
    let cloned_tx = buffer_tx.clone();
    let keep_alive_task_handle = tokio::task::spawn(async move {
        let mut interval = interval(Duration::from_secs(5));
        loop {
            cloned_tx.send(Message::Ping(vec![])).ok();
            interval.tick().await;
        }
    });
    
    // Track user
    let user_id = {
        let mut host: bool = false;

        // Create lobby if it doesn't exist
        if lobbies.read().await.get(&lobby_name).is_none() {
            let mut lobbies_wl = lobbies.write().await;

            let mut lobby = Lobby::new();
            lobby.name = lobby_name.clone();

            let lobby_arc = Arc::new(Mutex::new(lobby));

            // Start thread to step physics
            let lobby_physics_clone = lobby_arc.clone();            
            std::thread::spawn(move || {
                let physics_rate_duration = Duration::from_secs_f32(PHYSICS_RATE);

                let mut tick: u32 = 0;
                loop {
                    let start = Instant::now();
                    {
                        let mut lobby_wl = lobby_physics_clone.blocking_lock();
                        if let Some(true) = lobby_wl.abort_token {
                            return;
                        }
                        lobby_wl.step(tick % 3 == 0).ok();
                    }
                    let _elapsed = Instant::now() - start;

                    // println!("Physics time: {}", elapsed.as_millis());
                    tick += 1;
                    std::thread::sleep(physics_rate_duration.saturating_sub(_elapsed));
                }
            });
            lobby_arc.lock().await.abort_token = Some(false);

            lobbies_wl.insert(lobby_name.clone(), lobby_arc);
            host = true;
        }

        let lobbies_rl = lobbies.read().await;
        let mut lobby = lobbies_rl.get(&lobby_name).ok_or("Lobby missing")?.lock().await;
        let user_id = lobby.next_user_id();

        if host { lobby.host = user_id; }
        let (color, color_idx) = lobby.next_color();
        lobby.users.insert(user_id, User::new(user_id, buffer_tx, color, color_idx));

        user_id
    };
    
    // Continually process received messages
    // - Timeout at 10 seconds
    loop {
        let result = timeout(Duration::from_secs(10), rx.next()).await;
        let message: Message = match result {
            Ok(Some(r)) => match r {
                Ok(m) => m,
                Err(e) => {
                    println!("Websocket connection error, user <{user_id:?}> disconnected: {}", e);
                    break;
                }
            },
            Ok(None) => {continue;},
            Err(_) => {
                println!("Websocket connection closed, user <{user_id:?}> timed-out");
                break;
            },
        };
        if matches!(message, Message::Close(_)) {
            println!("Websocket connection closed, user <{user_id:?}> left");
            break;
        }
        if !matches!(message, Message::Text(_)) {
            if matches!(message, Message::Pong(_)) { continue; } else {
                println!("Received non-binary/non-pong message");
                continue;
            }
        }

        let lobbies_rl = lobbies.read().await;
        let lobby = lobbies_rl.get(&lobby_name).ok_or("Lobby missing")?;

        // let message_bytes = message.into_data();
        // match serde_json::from_slice(&message_bytes) {
        match serde_json::from_str(&message.into_text().unwrap()) {
            Ok(event_data) => {
                let event_result = match event_data {
                    Event::Join { referrer } => user_joined(user_id, lobby.lock().await.deref(), referrer, headers.clone()), 

                    Event::AddPawn { pawn } => lobby.lock().await.deref_mut().add_pawn(pawn),
                    Event::RemovePawns { ids } => lobby.lock().await.deref_mut().remove_pawns(ids),
                    Event::ClearPawns { } => lobby.lock().await.deref_mut().clear_pawns(),
                    Event::UpdatePawns { updates, .. } => lobby.lock().await.deref_mut().update_pawns(Some(user_id), updates),

                    Event::ExtractPawns { from_id, new_id, into_id, count } => lobby.lock().await.deref_mut().extract_pawns(user_id, from_id, new_id, into_id, count),
                    Event::StorePawn { from_id, into_id } => lobby.lock().await.deref_mut().store_pawn(from_id, into_id),
                    Event::TakePawn { from_id, target_id, position_hint } => lobby.lock().await.deref_mut().take_pawn(user_id, from_id, target_id, position_hint),

                    Event::RegisterGame(info) => lobby.lock().await.deref_mut().register_game(user_id, info),
                    Event::RegisterAssets { assets } => lobby.lock().await.deref_mut().register_assets(user_id, assets),
                    Event::ClearAssets { } => lobby.lock().await.deref_mut().clear_assets(user_id),
                    Event::Settings(s) => lobby.lock().await.deref_mut().settings(user_id, s),

                    Event::UpdateUserStatuses { updates } => lobby.lock().await.deref_mut().update_user(user_id, updates),

                    Event::Chat { content, .. } => lobby.lock().await.deref_mut().chat(user_id, content),
                    Event::Ping { idx } => lobby.lock().await.deref().ping(user_id, idx),

                    _ => Err("Received broadcast-only event".into()),
                };

                if let Err(err) = event_result {
                    println!("Error encountered while handling event:");
                    // println!(" - Event: {:?}", rmp_serde::from_slice::<Event>(&message_bytes)?);
                    println!(" - Error: {:?}", err);
                }
            },
            Err(err) => {
                println!("User <{user_id:?}> sent malformed message: {:?}", err);
            }
        };
    }

    buffer_task_handle.abort();
    keep_alive_task_handle.abort();
    user_disconnected(user_id, &lobby_name, &lobbies).await
}


// --- USER EVENTS ---

fn user_joined(user_id: UserId, lobby: &Lobby, referrer: &str, headers: HeaderMap) -> Result<(), Box<dyn Error>> {
    // Get user
    let user = lobby.users.get(&user_id).ok_or("Invalid user id")?;
    
    println!("User <{:?}> joined lobby [{}] with {} users and {} pawns:",
        user_id, lobby.name, lobby.users.len(), lobby.pawns.len());
    println!(" - Referrer: {:?}", referrer);
    println!(" - Lang: {:?}", headers.get(header::ACCEPT_LANGUAGE));
    println!(" - UA: {:?}", headers.get(header::USER_AGENT));
    
    user.send_event(&Event::Start {
        id: user_id,
        host: (lobby.users.len() == 1),
        color: &user.color,
        info: &lobby.info,
        users: lobby.users.values().collect(),
        pawns: lobby.pawns.values().collect(),
    })?;
    user.send_event(&Event::Settings(lobby.settings.clone()))?;

    if lobby.settings.show_card_counts {
        for (&id, other) in lobby.users.iter() {
            let count = other.hand.len() as u64;
            lobby.users.values().send_event(&Event::HandCount { id, count })?;
        }
    }

    lobby.users.values()
        .send_event(&Event::AssignHost {
            id: lobby.host,
        })?;
    
    // Tell all other users that this user has joined
    lobby.users.values()
        .filter(|u| u.id != user_id)
        .send_event(&Event::Connect {
            id: user_id,
            color: &user.color,
        })
}

async fn user_disconnected(user_id: UserId, lobby_name: &str, lobbies: &Lobbies) -> Result<(), Box<dyn Error>> {
    let lobbies_rl = lobbies.read().await;
    let mut lobby = lobbies_rl.get(lobby_name).ok_or("Missing lobby")?.lock().await;
    
    // Tell all other users that this user has disconnected
    lobby.users.values()
        .filter(|u| u.id != user_id)
        .send_event(&Event::Disconnect {
            id: user_id,
        })?;

    let lobby_mut_ref: &mut Lobby = &mut *lobby;
    
    // Remove user from lobby
    let color_idx = lobby_mut_ref.users[&user_id].color_idx;
    lobby_mut_ref.color_allocations[color_idx] = lobby_mut_ref.color_allocations[color_idx].saturating_sub(1);
    lobby_mut_ref.users.remove(&user_id);

    // Deselect all pawns selected by this user
    let mut deselected_pawns: Vec<PawnUpdate> = Vec::new();
    for pawn in lobby_mut_ref.pawns.values_mut() {
        if pawn.selected_user == Some(user_id) {
            pawn.selected_user = None;

            if pawn.moveable {
                let rb_handle = pawn.rigid_body.ok_or("Pawn missing rigidbody")?;
                let rb = lobby_mut_ref.world.rigid_body_set.get_mut(rb_handle).ok_or("Invalid rigidbody handle")?;
                rb.set_body_type(RigidBodyType::Dynamic, true);
                for collider_handle in rb.colliders().iter() {
                    let collider = lobby_mut_ref.world.collider_set.get_mut(*collider_handle).ok_or("Invalid collider handle")?;
                    collider.set_sensor(false);
                }
            }

            deselected_pawns.push(PawnUpdate {
                id: pawn.id,
                selected: Some(false),
                ..Default::default()
            });
        }
    }
    // Relay to other users that these pawns were deselected
    lobby.users.values().filter(|u| u.id != user_id).send_event(
        &Event::UpdatePawns { updates: deselected_pawns, collisions: None }
    )?;
    
    if lobby.users.len() != 0 { // If the user id is the host, let's reassign the host to the next user
        if lobby.host == user_id {
            // Reassign host
            let sorted_users = {
                let mut v = lobby.users.keys().cloned().collect::<Vec<UserId>>();
                v.sort();
                v
            };
            lobby.host = *sorted_users.first().unwrap();

            // Tell the new host
            lobby.users.get(&lobby.host).unwrap().send_event(&Event::AssignHost { id: lobby.host })?;

            println!("Host of lobby [{lobby_name}] left, reassigning <{user_id:?}> -> <{:?}>", lobby.host);
        }
    } else { // Otherwise, delete lobby if last user
        //lobby.physics_handle.as_ref().ok_or("Attempting to remove lobby without physics handle")?.abort();
        lobby.abort_token = Some(true);
        drop(lobby);
        drop(lobbies_rl);

        let mut lobbies_wl = lobbies.write().await;
        lobbies_wl.remove(lobby_name);

        println!("Lobby [{lobby_name}] removed");
    }
    Ok(())
}