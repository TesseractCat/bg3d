#![allow(non_snake_case)]

use std::env;
use std::collections::HashMap;
use std::borrow::Cow;
use std::sync::Arc;
use std::ops::{Deref, DerefMut};
use std::error::Error;
use std::net::SocketAddr;
use std::path::Path;

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

use data_url::DataUrl;

use names::Generator;
use random_color::Color;
use rapier3d::prelude::*;
use gltf::Gltf;
use crate::gltf_ext::GltfExt;

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
const PHYSICS_SCALE: f32 = 1.0/8.0;
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
                    return ServeFile::new("static/full.html").oneshot(request).await;
                }
            }
            return ServeFile::new("static/index.html").oneshot(request).await;
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
    let redirect_routes = Router::new()
        .route("/", get(|| async {
            let mut generator = Generator::default();
            Redirect::to(&format!("/{}", generator.next().expect("Generator failed")))
        }))
        .route("/index.html", get(|| async { Redirect::to("/") }));

    let app = redirect_routes
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
    
    // Relay cursors
    let lobbies_clone = lobbies.clone();
    tokio::task::spawn(async move  {
        let mut interval = interval(Duration::from_secs_f32(CURSOR_RATE));
        loop {
            {
                let lobbies_rl = lobbies_clone.read().await;
                for lobby in lobbies_rl.values() {
                    let lobby = lobby.lock().await;
                    lobby.relay_cursors().ok();
                }
            }
            interval.tick().await;
        }
    });

    println!("Starting BG3D on port [{port}]...");
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
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

            // Start task to step physics
            let lobby_physics_clone = lobby_arc.clone();            
            let physics_handle = tokio::task::spawn(async move {
                let mut interval = interval(Duration::from_secs_f32(PHYSICS_RATE));

                let mut tick: u32 = 0;
                loop {
                    let start = Instant::now();
                    {
                        let lobby_physics_clone = lobby_physics_clone.clone();
                        if let Err(err) = tokio::task::spawn_blocking(move || {
                            let mut lobby_wl = lobby_physics_clone.blocking_lock();
                            lobby_wl.step(tick % 3 == 0).ok();
                        }).await {
                            println!("Encountered error during physics step: {}", err);
                        }
                    }
                    let _elapsed = Instant::now() - start;
                    // println!("Physics time: {}", elapsed.as_millis());
                    tick += 1;
                    interval.tick().await;
                }
            });
            lobby_arc.lock().await.physics_handle = Some(physics_handle);

            lobbies_wl.insert(lobby_name.clone(), lobby_arc);
            host = true;
        }

        let lobbies_rl = lobbies.read().await;
        let mut lobby = lobbies_rl.get(&lobby_name).ok_or("Lobby missing")?.lock().await;
        let user_id = lobby.next_user_id();

        if host { lobby.host = user_id; }
        let color: Color = match (user_id.0 + 1) % 7 {
            1 => Color::Red,
            2 => Color::Blue,
            3 => Color::Purple,
            4 => Color::Green,
            5 => Color::Orange,
            6 => Color::Monochrome,
            0 => Color::Pink,
            _ => Color::Monochrome,
        };
        lobby.users.insert(user_id, User::new(user_id, buffer_tx, color));

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

        let lobbies_rl = lobbies.read().await;
        let lobby = lobbies_rl.get(&lobby_name).ok_or("Lobby missing")?;

        let message_bytes = message.into_data();
        match rmp_serde::from_slice(&message_bytes) {
            Ok(event_data) => {
                let event_result = match event_data {
                    Event::Join { referrer } => user_joined(user_id, lobby.lock().await.deref(), referrer, headers.clone()), 
                    Event::Ping { idx } => ping(user_id, lobby.lock().await.deref(), idx),

                    Event::AddPawn { pawn } => add_pawn(user_id, lobby.lock().await.deref_mut(), pawn),
                    Event::RemovePawns { ids } => remove_pawns(user_id, lobby.lock().await.deref_mut(), ids),
                    Event::ClearPawns { } => clear_pawns(user_id, lobby.lock().await.deref_mut()),
                    Event::UpdatePawns { updates, .. } => update_pawns(user_id, lobby.lock().await.deref_mut(), updates),

                    Event::ExtractPawns { from_id, new_id, into_id, count } => extract_pawns(user_id, lobby.lock().await.deref_mut(), from_id, new_id, into_id, count),
                    Event::StorePawn { from_id, into_id } => store_pawn(user_id, lobby.lock().await.deref_mut(), from_id, into_id),
                    Event::TakePawn { from_id, target_id, position_hint } => take_pawn(user_id, lobby.lock().await.deref_mut(), from_id, target_id, position_hint),

                    Event::RegisterGame(info) => register_game(user_id, lobby.lock().await.deref_mut(), info),
                    Event::RegisterAssets { assets } => register_assets(user_id, lobby.lock().await.deref_mut(), assets),
                    Event::ClearAssets { } => clear_assets(user_id, lobby.lock().await.deref_mut()),
                    Event::Settings(s) => settings(user_id, lobby.lock().await.deref_mut(), s),

                    Event::SendCursor { position } => update_cursor(user_id, lobby.lock().await.deref_mut(), position),

                    Event::Chat { content, .. } => chat(user_id, lobby.lock().await.deref(), content),

                    _ => Err("Received broadcast-only event".into()),
                };

                if let Err(err) = event_result {
                    println!("Error encountered while handling event:");
                    println!(" - Event: {:?}", rmp_serde::from_slice::<Event>(&message_bytes)?);
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

// --- PAWN EVENTS ---

fn add_pawn(_user_id: UserId, lobby: &mut Lobby, mut pawn: Cow<'_, Pawn>) -> Result<(), Box<dyn Error>> {
    if /*user_id != lobby.host || */lobby.pawns.len() >= 1024 { return Err("Failed to add pawn".into()); }

    if lobby.pawns.get(&pawn.id).is_some() { return Err("Pawn ID collision".into()); }
    
    // Deserialize collider
    // FIXME: Only enable CCD on cards/thin geometry?
    let rigid_body = if pawn.moveable { RigidBodyBuilder::dynamic() } else { RigidBodyBuilder::fixed() }
        .translation(Vector::from(&pawn.position) * PHYSICS_SCALE)
        .rotation(Rotation::from(&pawn.rotation).scaled_axis())
        .linear_damping(1.0).angular_damping(0.5)
        .ccd_enabled(matches!(pawn.data, PawnData::Deck { .. }) && pawn.moveable)
        .build();
    pawn.to_mut().rigid_body = Some(lobby.world.rigid_body_set.insert(rigid_body));

    let colliders: Box<dyn Iterator<Item = Collider>> = match &pawn.data {
        PawnData::Deck { .. } => {
            Box::new(std::iter::once((&pawn.data).try_into().unwrap()))
        },
        _ => {
            if let Some(mesh) = pawn.mesh.as_ref() {
                let static_path = Path::new("./static/games").canonicalize()?;
                let path = static_path.join(Path::new(mesh)).canonicalize();

                let gltf: Option<Gltf> = if let Ok(path) = path {
                    if path.starts_with(static_path) { Gltf::open(path).ok() } else { None }
                } else if let Some(asset) = lobby.assets.get(&format!("/{}", mesh)) {
                    Gltf::from_slice(asset.data.as_slice()).ok()
                } else { None };

                if let Some(gltf) = gltf {
                    Box::new(gltf.colliders().map(|collider| {
                        collider.friction(0.7).active_events(ActiveEvents::COLLISION_EVENTS).mass(0.01).build()
                    }))
                } else {
                    Box::new(std::iter::empty())
                }
            } else {
                Box::new(std::iter::empty())
            }
        }
    };
    for collider in colliders {
        lobby.world.insert_with_parent(collider, pawn.rigid_body.ok_or("Pawn missing rigidbody")?);
    }

    // Tell other users that this was added
    lobby.users.values().send_event(&Event::AddPawn { pawn: Cow::Borrowed(&pawn) })?;
    
    // Add pawn to lobby
    lobby.pawns.insert(pawn.id, pawn.into_owned());
    Ok(())
}
fn remove_pawns(_user_id: UserId, lobby: &mut Lobby, pawn_ids: Vec<PawnId>) -> Result<(), Box<dyn Error>> {
    // if user_id != lobby.host { return Err("Failed to remove pawn".into()); }
    
    // Remove pawn from lobby
    for id in &pawn_ids {
        lobby.remove_pawn(*id);
    }
    
    lobby.users.values().send_event(&Event::RemovePawns { ids: pawn_ids })
}
fn clear_pawns(user_id: UserId, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { return Err("Failed to clear pawns".into()); }

    // Remove pawn rigidbodies from lobby
    for (id, _) in lobby.pawns.iter() {
        let rb_handle = lobby.pawns
                                         .get(&id).ok_or("Trying to remove missing pawn")?
                                         .rigid_body.ok_or("Pawn missing rigidbody")?;
        lobby.world.remove_rigidbody(rb_handle);
    }
    lobby.pawns = HashMap::new();

    for user in lobby.users.values_mut() {
        user.hand = HashMap::new();
    }
    for &id in lobby.users.keys() {
        lobby.users.values().send_event(&Event::HandCount { id, count: 0 })?;
    }
    
    lobby.users.values().send_event(&Event::ClearPawns {})
}
fn update_pawns(user_id: UserId, lobby: &mut Lobby, mut updates: Vec<PawnUpdate>) -> Result<(), Box<dyn Error>> {
    // Iterate through and update pawns, sanitize updates when relaying:
    //  - Discard updates updating invalid pawns, non-owned pawns
    //  - Discard position and rotation changes on updates to immovable pawns
    updates = updates.into_iter().map(|mut update| {
        let pawn_id = update.id;
        let pawn: &mut Pawn = lobby.pawns.get_mut(&pawn_id).ok_or("Trying to update invalid pawn")?;

        match pawn.selected_user {
            Some(selected_user_id) if selected_user_id != user_id => {
                return Err("User trying to update non-owned pawn".into());
            },
            _ => {},
        };

        if !pawn.moveable {
            update.position = None;
            update.rotation = None;
            update.select_rotation = None;
        }
        
        // Update struct values
        pawn.patch(&update);
        pawn.selected_user = if update.selected.unwrap_or(true) {
            Some(user_id)
        } else {
            None
        };
        
        // Update physics
        if let Some(PawnData::Deck { .. }) = &update.data {
            let collider_handles: Vec<ColliderHandle> = {
                let rb_handle = pawn.rigid_body.ok_or("Pawn missing rigidbody")?;
                let rb = lobby.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
                rb.colliders().iter().map(|h| *h).collect()
            };
            for handle in collider_handles {
                lobby.world.remove_collider(handle);
            }

            lobby.world.insert_with_parent((update.data.as_ref().unwrap()).try_into().unwrap(),
                                           pawn.rigid_body.ok_or("Pawn missing rigidbody")?);
        }
        if pawn.moveable {
            let rb_handle = pawn.rigid_body.ok_or("Pawn missing rigidbody")?;
            let rb = lobby.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
            // Don't simulate selected pawns
            rb.set_body_type(if pawn.selected_user.is_none() {
                RigidBodyType::Dynamic
            } else {
                RigidBodyType::KinematicPositionBased
            }, true);
            for collider_handle in rb.colliders().iter() {
                let collider = lobby.world.collider_set.get_mut(*collider_handle).ok_or("Invalid collider handle")?;
                collider.set_sensor(pawn.selected_user.is_some());
            }
            // Update position and velocity
            if update.position.is_some() || update.rotation.is_some() {
                let old_position: &Vector<f32> = rb.translation();
                let position: Vector<f32> = Vector::from(&pawn.position) * PHYSICS_SCALE;

                let rotation: Rotation<f32> = Rotation::from(&pawn.rotation);
                let time_difference = (Instant::now() - pawn.last_updated).as_secs_f32();
                let velocity: Vector<f32> = (position - old_position)/time_difference.max(1.0/20.0);

                let wake = true;
                rb.set_translation(position, wake);
                rb.set_rotation(rotation, wake);
                rb.set_linvel(velocity, wake);
                rb.set_angvel(vector![0.0, 0.0, 0.0], wake);
            }
        }

        // Refresh last updated
        pawn.last_updated = Instant::now();

        Ok(update)
    }).collect::<Result<Vec<_>, Box<dyn Error>>>()?;
    
    // Relay to other users that these pawns were changed
    lobby.users.values()
        .filter(|u| u.id != user_id)
        .send_event(&Event::UpdatePawns { updates, collisions: None })
}

fn extract_pawns(user_id: UserId, lobby: &mut Lobby, from_id: PawnId, new_id: PawnId, into_id: Option<UserId>, count: Option<u64>) -> Result<(), Box<dyn Error>> {
    if lobby.pawns.contains_key(&new_id) { return Err("Attempting to extract with existing ID".into()); }

    let from = lobby.pawns.get_mut(&from_id).ok_or("Trying to extract from missing pawn")?;

    let flipped = from.flipped();
    let to = match &mut from.data {
        PawnData::Container { holds, capacity } => {
            if *capacity == Some(0) {
                Err::<Pawn, Box<dyn Error>>("Trying to extract from empty container".into())
            } else {
                if let Some(c) = *capacity {
                    capacity.replace(c - 1);
                }
                let mut to = *holds.clone();
                to.rigid_body = None;
                to.id = new_id;
                to.position = from.position.clone();
                to.position.y += 3.0;
                Ok(to)
            }
        },
        PawnData::Deck { contents: from_contents, .. } => {
            let count = count.map(|x| x.max(1)).unwrap_or(1) as usize;
            if from_contents.len() <= count {
                Err("Trying to extract too many cards from deck".into())
            } else {
                let new_contents: Vec<String> = from_contents.drain(if flipped {
                    (from_contents.len() - count)..from_contents.len()
                } else {
                    0..count
                }).collect();

                // Update from's collider
                {
                    let collider_handles: Vec<ColliderHandle> = {
                        let rb_handle = from.rigid_body.ok_or("Pawn missing rigidbody")?;
                        let rb = lobby.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
                        rb.colliders().iter().map(|h| *h).collect()
                    };
                    for handle in collider_handles {
                        lobby.world.remove_collider(handle);
                    }
    
                    lobby.world.insert_with_parent((&from.data).try_into().unwrap(),
                                                   from.rigid_body.ok_or("Pawn missing rigidbody")?);
                }

                let mut to = from.clone();
                to.rigid_body = None;
                to.id = new_id;
                to.position = from.position.clone();
                to.position.y += 1.0;
                if let PawnData::Deck { contents: to_contents, .. } = &mut to.data {
                    *to_contents = new_contents;
                }
                Ok(to)
            }
        },
        _ => Err("Trying to extract from non-container pawn".into()),
    }?;

    lobby.users.values().send_event(&Event::UpdatePawns {
        updates: vec![PawnUpdate {
            id: from.id,
            data: Some(from.data.clone()),
            ..Default::default()
        }],
        collisions: None
    })?;

    match into_id {
        Some(into_id) => {
            lobby.pawns.insert(new_id, to);
            store_pawn(user_id, lobby, new_id, PawnOrUser::User(into_id))
        },
        None => add_pawn(lobby.host, lobby, Cow::Owned(to)),
    }
}
fn store_pawn(_user_id: UserId, lobby: &mut Lobby, from_id: PawnId, into_id: PawnOrUser) -> Result<(), Box<dyn Error>> {
    if !match into_id {
        PawnOrUser::User(id) => lobby.pawns.contains_key(&from_id) && lobby.users.contains_key(&id),
        PawnOrUser::Pawn(id) => lobby.pawns.contains_key(&from_id) && lobby.pawns.contains_key(&id),
    } {
        // Bail out early
        return Err("From/into pawn missing when merging".into());
    }

    let from = lobby.remove_pawn(from_id).unwrap();
    match into_id {
        PawnOrUser::Pawn(into_id) => {
            let into = lobby.pawns.get_mut(&into_id).unwrap();

            let flipped = into.flipped();
            match &mut into.data {
                PawnData::Container { capacity, .. } => {
                    if let Some(c) = *capacity {
                        capacity.replace(c + 1);
                    }
                    Ok::<(), Box<dyn Error>>(())
                },
                PawnData::Deck { contents: into_contents, .. } => {
                    if let PawnData::Deck { contents: mut from_contents, ..} = from.data {
                        if flipped {
                            into_contents.append(&mut from_contents);
                        } else {
                            from_contents.append(into_contents);
                            *into_contents = from_contents;
                        }

                        // Update into's collider
                        {
                            let collider_handles: Vec<ColliderHandle> = {
                                let rb_handle = into.rigid_body.ok_or("Pawn missing rigidbody")?;
                                let rb = lobby.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
                                rb.colliders().iter().map(|h| *h).collect()
                            };
                            for handle in collider_handles {
                                lobby.world.remove_collider(handle);
                            }
            
                            lobby.world.insert_with_parent((&into.data).try_into().unwrap(),
                                                        into.rigid_body.ok_or("Pawn missing rigidbody")?);
                        }
                    }
                    Ok(())
                },
                _ => Err("Trying to merge into non-container pawn".into()),
            }?;

            lobby.users.values().send_event(&Event::UpdatePawns {
                updates: vec![PawnUpdate {
                    id: into.id,
                    data: Some(into.data.clone()),
                    ..Default::default()
                }],
                collisions: None
            })?;
        },
        PawnOrUser::User(into_id) => {
            let into = lobby.users.get_mut(&into_id).unwrap();
            into.hand.insert(from_id, from);

            into.send_event(&Event::AddPawnToHand {
                pawn: Cow::Borrowed(into.hand.get(&from_id).unwrap())
            })?;

            if lobby.settings.show_card_counts {
                let count = into.hand.len() as u64;
                lobby.users.values().send_event(&Event::HandCount {
                    id: into_id, count
                })?;
            }
        }
    }
    lobby.users.values().send_event(&Event::RemovePawns { ids: vec![from_id] })
}
fn take_pawn(user_id: UserId, lobby: &mut Lobby, from_id: UserId, target_id: PawnId, position_hint: Option<Vec3>) -> Result<(), Box<dyn Error>> {
    if user_id != from_id { return Err("Attempting to take pawn from non-self user".into()); }

    let mut taken_pawn = lobby.users
                          .get_mut(&from_id)
                          .ok_or("Lobby missing user")?.hand
                          .remove(&target_id).ok_or("User doesn't have requested pawn")?;

    if lobby.settings.show_card_counts {
        let count = lobby.users.get_mut(&from_id).unwrap().hand.len() as u64;
        lobby.users.values().send_event(&Event::HandCount {
            id: from_id, count
        })?;
    }
    
    if let Some(position_hint) = position_hint {
        taken_pawn.position = position_hint;
    }

    add_pawn(lobby.host, lobby, Cow::Owned(taken_pawn))
}

// --- GAME REGISTRATION EVENTS ---

fn register_game(user_id: UserId, lobby: &mut Lobby, info: Cow<'_, GameInfo>) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { return Err("Failed to register game".into()); }

    println!("User <{user_id:?}> registering game \"{}\" for lobby [{}]",
             info.name, lobby.name);

    lobby.info = Some(info.into_owned());

    lobby.users.values()
        .send_event(&Event::RegisterGame(
            Cow::Borrowed(lobby.info.as_ref().ok_or("Lobby missing GameInfo")?)
        ))
}
fn register_assets(user_id: UserId, lobby: &mut Lobby, assets: HashMap<String, String>) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host || lobby.assets.len() >= 256 { return Err("Failed to register asset".into()); }

    println!("User <{user_id:?}> registering assets for lobby [{}]:", lobby.name);
    for (name, data) in assets.into_iter() {
        if lobby.assets.values().fold(0, |acc, a| acc + a.data.len()) > 1024 * 1024 * 40 { return Err("Attempting to register >40 MiB of assets".into()); }
        if lobby.assets.get(&name).is_some() { return Err("Attempting to overwrite asset".into()); }
    
        let url = DataUrl::process(&data).ok().ok_or("Failed to process base64")?;
        let asset = Asset {
            mime_type: format!("{}/{}", url.mime_type().type_, url.mime_type().subtype),
            data: url.decode_to_vec().ok().ok_or("Failed to decode base64")?.0, // Vec<u8>
        };
    
        // No assets above 2 MiB
        if asset.data.len() > 1024 * 1024 * 2 { return Err("Asset too large".into()); }
    
        lobby.assets.insert(name.to_string(), asset);
    
        println!(" - \"{name}\"");
    }
    println!(" - Asset count: {} | Total size: {} KiB",
            lobby.assets.len(),
            lobby.assets.values().fold(0, |acc, a| acc + a.data.len())/1024);

    // Alert host that the assets have been registered
    lobby.users.get(&user_id).ok_or("Failed to get host")?
         .send_event(&Event::RegisterAssets { assets: HashMap::default() })?;
    Ok(())
}
fn clear_assets(user_id: UserId, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { return Err("Failed to clear assets".into()); }

    lobby.assets = HashMap::new();

    println!("User <{user_id:?}> clearing assets for lobby [{}]", lobby.name);
    Ok(())
}
fn settings(user_id: UserId, lobby: &mut Lobby, settings: LobbySettings) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { return Err("Non-host user attempting to change settings".into()); }

    lobby.settings = settings.clone();

    if lobby.settings.show_card_counts {
        for (&id, other) in lobby.users.iter() {
            let count = other.hand.len() as u64;
            lobby.users.values().send_event(&Event::HandCount { id, count })?;
        }
    }

    lobby.users.values().send_event(&Event::Settings(settings))
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
    
    // Remove user from lobby
    lobby.users.remove(&user_id);

    // Deselect all pawns selected by this user
    let lobby_mut_ref: &mut Lobby = &mut *lobby;
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
            lobby.users.get(&lobby.host).unwrap().send_event(&Event::AssignHost {})?;

            println!("Host of lobby [{lobby_name}] left, reassigning <{user_id:?}> -> <{:?}>", lobby.host);
        }
    } else { // Otherwise, delete lobby if last user
        lobby.physics_handle.as_ref().ok_or("Attempting to remove lobby without physics handle")?.abort();
        drop(lobby);
        drop(lobbies_rl);

        let mut lobbies_wl = lobbies.write().await;
        lobbies_wl.remove(lobby_name);

        println!("Lobby [{lobby_name}] removed");
    }
    Ok(())
}

fn ping(user_id: UserId, lobby: &Lobby, idx: u64) -> Result<(), Box<dyn Error>> {
    // Pong
    lobby.users.get(&user_id).ok_or("Invalid user id")?.send_event(&Event::Pong { idx })?;
    Ok(())
}

// -- CURSOR EVENTS --

fn update_cursor(user_id: UserId, lobby: &mut Lobby, position: Vec3) -> Result<(), Box<dyn Error>> {
    let mut user = lobby.users.get_mut(&user_id).ok_or("Invalid user id")?;

    user.cursor_position = position;
    Ok(())
}

// -- CHAT EVENTS --

fn chat(user_id: UserId, lobby: &Lobby, content: Cow<'_, String>) -> Result<(), Box<dyn Error>> {
    lobby.users.values().send_event(&Event::Chat {
        id: Some(user_id),
        content: Cow::Borrowed(&content)
    })
}
