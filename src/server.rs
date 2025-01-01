#![allow(non_snake_case)]

use std::borrow::Cow;
use std::env;
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use std::ops::{Deref, DerefMut};
use std::error::Error;
use std::net::SocketAddr;

use axum::extract::RawQuery;
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

use flate2::{Decompress, read::ZlibDecoder};

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

#[tokio::main]
async fn main() {
    let port = env::args().nth(1).expect("Missing port").parse::<u16>().expect("Invalid port");
    let lobby_name = env::args().nth(2).expect("Missing name");
    
    // Create lobby
    let lobby: Arc<Mutex<Lobby>> = Arc::new(Mutex::new(Lobby::new()));
    {
        let mut lobby = lobby.lock().await;
        lobby.name = lobby_name.clone();
    }
    // Start thread to step physics
    let lobby_physics_clone = lobby.clone();            
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

    let lobby_index_clone = lobby.clone();
    let lobby_assets_clone = lobby.clone();
    let lobby_ws_clone = lobby.clone();
    let lobby_page_clone = lobby.clone();
    let lobby_page_path_clone = lobby.clone();

    // Routing
    // FIXME: Re-add cache headers
    let lobby_routes = Router::new()
        .route("/", get(|request: Request<Body>| async move {
            let lobby = lobby_index_clone.clone();
            if lobby.lock().await.users.len() >= 32 {
                return (
                    [(header::CACHE_CONTROL, "no-cache")],
                    ServeFile::new("static/full.html").oneshot(request).await
                );
            }
            return (
                [(header::CACHE_CONTROL, "no-cache")],
                ServeFile::new("static/index.html").oneshot(request).await
            );
        }))
        .nest_service("/assets", ServeDir::new("static/games").fallback(get(
            move |uri: Uri| {
                let lobby = lobby_assets_clone.clone();
                println!("Someone requested asset path \"{}\"", uri.path());
                retrieve_asset(lobby, uri)
            }
        )))
        .route("/page/", get(
            move |RawQuery(query): RawQuery| {
                let lobby = lobby_page_clone.clone();
                let query = query.map(|q| format!("?{q}")).unwrap_or("".to_string());
                serve_page(lobby, format!("/{query}"))
            }
        ))
        .route("/page/*path", get(
            move |AxumPath((_, path)): AxumPath<(String, String)>, RawQuery(query): RawQuery| {
                let lobby = lobby_page_path_clone.clone();
                let query = query.map(|q| format!("?{q}")).unwrap_or("".to_string());
                serve_page(lobby, format!("/{path}{query}"))
            }
        ))
        .route("/ws", get(
            |ws: WebSocketUpgrade, headers: HeaderMap| async move {
                let lobby = lobby_ws_clone.clone();
                ws.on_upgrade(move |socket| async {
                    if let Err(err) = user_connected(socket, lobby, headers).await {
                        println!("Error encountered in websocket connection: {:?}", err);
                    }
                })
            }
        ));

    let app = lobby_routes
        .layer(CompressionLayer::new());
    
    // Relay user statuses (cursors, head, etc)
    let lobby_clone = lobby.clone();
    tokio::task::spawn(async move  {
        let mut interval = interval(Duration::from_secs_f32(CURSOR_RATE));
        loop {
            {
                let lobby = lobby_clone.lock().await;
                lobby.relay_user_statuses().ok();
            }
            interval.tick().await;
        }
    });

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    println!("{}", listener.local_addr().expect("Failed to bind").port());

    axum::serve(listener, app).await.unwrap();
    println!("Listening...");
}
async fn retrieve_asset(lobby: Arc<Mutex<Lobby>>, path: Uri) -> axum::response::Result<impl IntoResponse> {
    let lobby = lobby.lock().await;
    let asset = lobby.assets.get(path.path()).ok_or(StatusCode::NOT_FOUND)?;

    axum::response::Result::Ok((
        [
            ("Content-Type", asset.mime_type.to_string()),
            ("Cache-Control", "no-cache, no-store, must-revalidate".to_string())
        ],
        asset.data.clone()
    ))
}
async fn serve_page(lobby: Arc<Mutex<Lobby>>, path: String) -> axum::response::Result<impl IntoResponse> {
    let mut lobby = lobby.lock().await;

    let content: mlua::Result<Result<String, StatusCode>> = lobby.lua_scope(|lua, _scope, _| { // Call physics callback
        if let Some(res) = Lobby::run_lua_callback::<_, String>(lua, "page", path) {
            Ok(Ok(res?))
        } else {
            //Ok(Err(StatusCode::NOT_FOUND))
            Ok(Ok("This plugin has no settings".to_string()))
        }
    });

    let content = match content {
        Err(e) => {
            let _ = lobby.system_chat(Cow::Owned(format!("Lua error in game.page: `{}`", e)));
            Err(StatusCode::NOT_FOUND)
        },
        Ok(r) => r
    };

    axum::response::Result::Ok((
        [
            ("Content-Type", "text/html"),
            ("Cache-Control", "no-cache, no-store, must-revalidate"),
            ("Access-Control-Allow-Origin", "null")
        ],
        content
    ))
}

async fn user_connected(ws: WebSocket, lobby: Arc<Mutex<Lobby>>, headers: HeaderMap) -> Result<(), Box<dyn Error>> {
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
        let mut lobby = lobby.lock().await;
        let host = lobby.users.len() == 0;
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
        if !matches!(message, Message::Binary(_)) {
            if matches!(message, Message::Pong(_)) { continue; } else {
                println!("Received non-binary/non-pong message");
                continue;
            }
        }

        let message_bytes = message.into_data();
        let mut d = Decompress::new(false);
        d.set_dictionary(include_bytes!("dictionary.txt")).expect("Failed to set DEFLATE dictionary");
        let mut deflate_decompressor = ZlibDecoder::new_with_decompress(message_bytes.as_slice(), d);
        let mut message_text = String::new();
        deflate_decompressor.read_to_string(&mut message_text).unwrap();

        match serde_json::from_str(&message_text) {
            Ok(event_data) => {
                let event_result = match event_data {
                    Event::Join { referrer } => user_joined(user_id, lobby.lock().await.deref(), referrer, headers.clone()), 

                    Event::AddPawn { pawn } => lobby.lock().await.deref_mut().add_pawn(pawn.into_owned()),
                    Event::RemovePawns { ids } => lobby.lock().await.deref_mut().remove_pawns(ids),
                    Event::ClearPawns { } => lobby.lock().await.deref_mut().clear_pawns(),
                    Event::UpdatePawns { updates, .. } => lobby.lock().await.deref_mut().update_pawns(Some(user_id), updates),

                    Event::ExtractPawns { from_id, new_id, into_id, count } => lobby.lock().await.deref_mut().extract_pawns(user_id, from_id, new_id, into_id, count),
                    Event::StorePawn { from_id, into_id } => lobby.lock().await.deref_mut().store_pawn(from_id, into_id),
                    Event::TakePawn { from_id, target_id, position_hint } => lobby.lock().await.deref_mut().take_pawn(user_id, from_id, target_id, position_hint),

                    Event::RegisterGame { info, assets } => lobby.lock().await.deref_mut().register_game(user_id, info, assets),
                    Event::Settings(s) => lobby.lock().await.deref_mut().settings(user_id, s.into_owned()),

                    Event::UpdateUserStatuses { updates } => lobby.lock().await.deref_mut().update_user(user_id, updates),

                    Event::Chat { content, .. } => lobby.lock().await.deref_mut().chat(user_id, content),
                    Event::Ping { idx } => lobby.lock().await.deref().ping(user_id, idx),

                    _ => Err("Received broadcast-only event".into()),
                };

                if let Err(err) = event_result {
                    println!("Error encountered while handling event:");
                    println!(" - Message: {:?}", message_text);
                    println!(" - Error: {:?}", err);
                }
            },
            Err(err) => {
                println!("User <{user_id:?}> sent malformed message: {:?}", err);
                println!(" - Message: {:?}", message_text);
            }
        };
    }

    buffer_task_handle.abort();
    keep_alive_task_handle.abort();
    user_disconnected(user_id, lobby).await
}


// --- USER EVENTS ---

fn user_joined(user_id: UserId, lobby: &Lobby, referrer: &str, headers: HeaderMap) -> Result<(), Box<dyn Error>> {
    // Get user
    let user = lobby.users.get(&user_id).ok_or("Invalid user id")?;
    
    println!("User <{:?}> joined lobby with {} users and {} pawns:",
        user_id, lobby.users.len(), lobby.pawns.len());
    println!(" - Referrer: {:?}", referrer);
    println!(" - Lang: {:?}", headers.get(header::ACCEPT_LANGUAGE));
    println!(" - UA: {:?}", headers.get(header::USER_AGENT));
    
    user.send_event(&Event::Start {
        id: user_id,
        host: lobby.host,
        color: &user.color,
        info: &lobby.info,
        settings: &lobby.settings,
        users: lobby.users.values().collect(),
        pawns: lobby.pawns.values().collect(),
        registered_pawns: &lobby.registered_pawns,
    })?;

    if lobby.settings.show_card_counts {
        for (&id, other) in lobby.users.iter() {
            let count = other.hand.len() as u64;
            lobby.users.values().send_event(&Event::HandCount { id, count })?;
        }
    }
    
    // Tell all other users that this user has joined
    lobby.users.values()
        .filter(|u| u.id != user_id)
        .send_event(&Event::Connect {
            id: user_id,
            color: &user.color,
        })
}

async fn user_disconnected(user_id: UserId, lobby: Arc<Mutex<Lobby>>) -> Result<(), Box<dyn Error>> {
    let mut lobby = lobby.lock().await;

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

            println!("Host of lobby left, reassigning <{user_id:?}> -> <{:?}>", lobby.host);
        }
    } else { // Otherwise, delete lobby if last user
        // FIXME: Delete lobby? Keep it around?
    }
    Ok(())
}