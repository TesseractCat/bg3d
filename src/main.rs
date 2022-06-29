use std::env;
use std::collections::HashMap;
use std::borrow::Cow;
use std::sync::Arc;
use std::ops::{Deref, DerefMut};
use std::error::Error;

use futures_util::{StreamExt, SinkExt, TryFutureExt};
use tokio::time::{sleep, timeout, Duration, Instant};
use tokio::sync::{RwLock, mpsc};
use tokio_stream::wrappers::UnboundedReceiverStream;

use warp::{http::{Uri, Response}, Filter};
use warp::ws::{Message, WebSocket};
use data_url::DataUrl;

use serde_json::Value;

use names::Generator;
use random_color::Color;
use rapier3d::prelude::*;

mod lobby;
mod user;
mod physics;
mod events;

use lobby::*;
use user::*;
use events::*;

//TODO: Replace this with Dashmap?
type Lobbies = Arc<RwLock<HashMap<String, RwLock<Lobby>>>>;

#[tokio::main]
async fn main() {
    let default_port: u16 = 8080;
    let port: u16 = match env::args().nth(1) {
        Some(p) => p.parse::<u16>().unwrap_or(default_port),
        None => default_port,
    };
    
    // Define our lobbies HashMap
    let lobbies = Lobbies::default();
    
    // Paths
    let redirect = warp::path::end().or(warp::path("index.html")).map(|_| {
        let mut generator = Generator::default();
        warp::redirect::see_other(generator.next().unwrap().parse::<Uri>().unwrap())
    });

    let default = warp::fs::dir("./static").with(warp::compression::gzip());
    let default_assets = warp::path::param::<String>()
        .and(warp::fs::dir("./static/games"))
        .map(|_, file| file)
        .with(warp::compression::gzip());

    let lobbies_clone = lobbies.clone();
    let lobby_assets = warp::path::param::<String>()
        .and(warp::path::tail())
        .and_then(move |lobby: String, tail: warp::path::Tail| {
            let lobbies = lobbies_clone.clone();
            println!("Someone requested asset path \"{}\" for lobby [{lobby}]", tail.as_str());

            async move {
                let lobbies_rl = lobbies.read().await;
                let lobby = match lobbies_rl.get(&lobby) {
                    Some(l) => l.read().await,
                    None => return Err(warp::reject::not_found()),
                };
                let asset = match lobby.assets.get(tail.as_str()) {
                    Some(a) => a,
                    None => return Err(warp::reject::not_found()),
                };
                let response = Response::builder()
                    .header("Content-Type", asset.mime_type.clone())
                    .header("Cache-Control", "no-cache, no-store, must-revalidate")
                    .body(asset.data.clone());
                Ok(response)
            }
        })
        .with(warp::compression::gzip());
    
    let index = warp::path::param::<String>()
        .and(warp::path::end())
        .and(warp::fs::file("./static/index.html"))
        .map(|_, file| file)
        .with(warp::reply::with::header("Cache-Control", "no-cache, no-store, must-revalidate"))
        .with(warp::compression::gzip());

    let lobbies_clone = lobbies.clone();
    let ws = warp::path!(String / "ws")
        .and(warp::ws())
        .map(move |lobby: String, ws: warp::ws::Ws| {
            let lobbies = lobbies_clone.clone();
            ws.on_upgrade(move |socket| user_connected(socket, lobby, lobbies))
        });
    
    let routes = warp::get().and(
        (redirect)
            .or(default)
            .or(index)
            .or(ws)
            .or(default_assets)
            .or(lobby_assets)
    );
    
    // Physics steps
    let lobbies_clone = lobbies.clone();
    tokio::task::spawn(async move {
        let mut tick: u64 = 0;

        loop {
            //let physics_time = Instant::now();
            {
                let lobbies_rl = lobbies_clone.read().await;
                for lobby in lobbies_rl.values() {
                    lobby.write().await.step(tick % 3 == 0).ok();
                }
            }
            //println!("Physics elapsed time: {}", Instant::now().duration_since(physics_time).as_millis());
            sleep(Duration::from_secs_f64(1.0/60.0)).await;
            tick += 1;
        }
    });
    // Relay cursors
    let lobbies_clone = lobbies.clone();
    tokio::task::spawn(async move  {
        loop {
            {
                let lobbies_rl = lobbies_clone.read().await;
                for lobby in lobbies_rl.values() {
                    let lobby = lobby.read().await;
                    lobby.relay_cursors().ok();
                }
            }
            sleep(Duration::from_secs_f64(1.0/10.0)).await;
        }
    });

    println!("Starting BG3D on port [{port}]...");
    if port == 443 {
        warp::serve(routes)
            .tls()
            .cert_path("/etc/letsencrypt/live/birdga.me/fullchain.pem")
            .key_path("/etc/letsencrypt/live/birdga.me/privkey.pem")
            .run(([0, 0, 0, 0], port)).await;
    } else {
        warp::serve(routes).run(([0, 0, 0, 0], port)).await;
    }
}

async fn user_connected(ws: WebSocket, lobby_name: String, lobbies: Lobbies) {
    let (mut tx, mut rx) = ws.split();
    
    let (buffer_tx, buffer_rx) = mpsc::unbounded_channel::<Message>();
    
    // Automatically send buffered messages
    let mut buffer_rx = UnboundedReceiverStream::new(buffer_rx);
    tokio::task::spawn(async move {
        while let Some(message) = buffer_rx.next().await {
            tx.send(message).unwrap_or_else(|_| {}).await
        }
    });
    
    // Track user
    let user_id: usize = {
        let mut host: bool = false;
        if lobbies.read().await.get(&lobby_name).is_none() {
            let mut lobbies_wl = lobbies.write().await;

            let mut lobby = Lobby::new();
            lobby.name = lobby_name.clone();

            lobbies_wl.insert(lobby_name.clone(), RwLock::new(lobby));
            host = true;
        }

        let lobbies_rl = lobbies.read().await;
        let mut lobby = lobbies_rl.get(&lobby_name).unwrap().write().await;
        let user_id = lobby.next_user_id();

        if host { lobby.host = user_id; }
        let color: Color = match (user_id + 1) % 7 {
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
                    println!("Websocket error: {}", e);
                    break;
                }
            },
            Ok(None) => {continue;},
            Err(_) => {
                println!("Websocket connection closed, user <{user_id}> timed-out");
                break;
            },
        };
        if message.is_close() {
            println!("Websocket connection closed, user <{user_id}> left");
            break;
        }
        if !message.is_text() {
            println!("Received non-text message");
            continue;
        }

        let lobbies_rl = lobbies.read().await;
        let lobby = lobbies_rl.get(&lobby_name).unwrap();

        if let Some(event_data) = serde_json::from_str(message.to_str().unwrap()).ok() {
            // println!("Event: {:?}", event_data);

            let event_result = match event_data {
                Event::Join { } => user_joined(user_id, lobby.read().await.deref()), 
                Event::Ping { idx } => ping(user_id, lobby.read().await.deref(), idx),

                Event::AddPawn { pawn } => add_pawn(user_id, lobby.write().await.deref_mut(), pawn),
                Event::RemovePawns { ids } => remove_pawns(user_id, lobby.write().await.deref_mut(), ids),
                Event::ClearPawns { } => clear_pawns(user_id, lobby.write().await.deref_mut()),
                Event::UpdatePawns { updates } => update_pawns(user_id, lobby.write().await.deref_mut(), updates),

                Event::RegisterGame(info) => register_game(user_id, lobby.write().await.deref_mut(), info),
                Event::RegisterAsset { name, data, last } => register_asset(user_id, lobby.write().await.deref_mut(), name, data),
                Event::ClearAssets { } => clear_assets(user_id, lobby.write().await.deref_mut()),

                Event::SendCursor { position } => update_cursor(user_id, lobby.write().await.deref_mut(), position),

                Event::Chat { content, .. } => chat(user_id, lobby.read().await.deref(), content),

                Event::Event { target, data } => event(user_id, lobby.write().await.deref_mut(), target, data),
                Event::EventCallback { receiver, data } => event_callback(user_id, lobby.write().await.deref_mut(), receiver, data),

                _ => Err("Received broadcast-only event".into()),
            };

            if event_result.is_err() {
                // FIXME: Print event name
                println!("Error encountered while handling event: {:?}", event_result);
            }
        } else {
            println!("User <{user_id}> sent malformed message");
        }
    }
    match user_disconnected(user_id, &lobby_name, &lobbies).await {
        Err(e) => println!("Error encountered while disconnecting user: {:?}", e),
        _ => (),
    };
}

// --- GENERIC EVENTS ---

fn event(_user_id: usize, lobby: &mut Lobby, target_host: bool, mut data: Value) -> Result<(), Box<dyn Error>> {
    data["type"] = Value::String("event".to_string());
    // Relay event
    if target_host {
        lobby.users.get(&lobby.host).ok_or("Missing host")?.send_string(&data.to_string())?;
    } else {
        lobby.users.values().send_string(&data.to_string())?;
    }

    Ok(())
}
fn event_callback(_user_id: usize, lobby: &mut Lobby, target: usize, mut data: Value) -> Result<(), Box<dyn Error>> {
    data["type"] = Value::String("event_callback".to_string());
    // Relay callback
    lobby.users.get(&target).ok_or("Missing callback target")?.send_string(&data.to_string())?;
    Ok(())
}

// --- PAWN EVENTS ---

fn add_pawn(user_id: usize, lobby: &mut Lobby, mut pawn: Cow<'_, Pawn>) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host || lobby.pawns.len() >= 1024 { Err("Failed to add pawn")?; }

    if lobby.pawns.get(&pawn.id).is_some() { Err("Pawn ID collision")?; }
    
    // Deserialize collider
    // FIXME: Only enable CCD on cards/thin geometry?
	let rigid_body = if pawn.moveable { RigidBodyBuilder::dynamic().ccd_enabled(true) } else { RigidBodyBuilder::fixed() }
		.translation(Vector::from(&pawn.position))
        .rotation(Rotation::from(&pawn.rotation).scaled_axis())
        .linear_damping(0.5).angular_damping(0.5)
        .build();
	pawn.to_mut().rigid_body = Some(lobby.world.rigid_body_set.insert(rigid_body));

    for shape in &pawn.collider_shapes {
        let collider: ColliderBuilder = ColliderBuilder::from(shape).friction(0.7)
            .mass_properties(MassProperties::new(Point::<f32>::origin(), 1.0, vector![1.0,1.0,1.0]));
        lobby.world.insert_with_parent(collider.build(), pawn.rigid_body.unwrap());
    }

    // Tell other users that this was added
    lobby.users.values().send_event(&Event::AddPawn { pawn: Cow::Borrowed(&pawn) })?;
    
    // Add pawn to lobby
    lobby.pawns.insert(pawn.id, pawn.into_owned());
    Ok(())
}
fn remove_pawns(_user_id: usize, lobby: &mut Lobby, pawn_ids: Vec<u64>) -> Result<(), Box<dyn Error>> {
    // if user_id != lobby.host { Err("Failed to remove pawn")?; }
    
    // Remove pawn from lobby
    for id in &pawn_ids {
        // Remove rigidbody first
        let rb_handle = lobby.pawns.get(&id).ok_or("Trying to remove missing pawn")?.rigid_body.unwrap();
        lobby.world.remove_rigidbody(rb_handle);
        lobby.pawns.remove(&id);
    }
    
    lobby.users.values().send_event(&Event::RemovePawns { ids: pawn_ids })
}
fn clear_pawns(user_id: usize, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { Err("Failed to clear pawns")?; }

    // Remove pawn rigidbodies from lobby
    for (id, _) in lobby.pawns.iter() {
        let rb_handle = lobby.pawns.get(&id).ok_or("Trying to remove missing pawn")?.rigid_body.unwrap();
        lobby.world.remove_rigidbody(rb_handle);
    }
    lobby.pawns = HashMap::new();
    
    lobby.users.values().send_event(&Event::ClearPawns {})
}
fn update_pawns(user_id: usize, lobby: &mut Lobby, mut updates: Vec<PawnUpdate>) -> Result<(), Box<dyn Error>> {
    // Iterate through and update pawns, sanitize updates when relaying:
    //  - Discard updates updating invalid pawns, non-owned pawns
    //  - Discard position and rotation changes on updates to immovable pawns
    updates.retain_mut(|update| {
        let pawn_id: u64 = update.id;
        let pawn: &mut Pawn = match lobby.pawns.get_mut(&pawn_id) {
            Some(p) => p,
            None => {
                println!("User <{user_id}> trying to update invalid pawn");
                return false;
            },
        };

        match pawn.selected_user {
            Some(selected_user_id) if selected_user_id != user_id => {
                println!("User <{user_id}> trying to update non-owned pawn");
                return false;
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
        if update.collider_shapes.is_some() {
            let collider_handles: Vec<ColliderHandle> = {
                let rb_handle = pawn.rigid_body.unwrap();
                let rb = lobby.world.rigid_body_set.get_mut(rb_handle).unwrap();
                rb.colliders().iter().map(|h| *h).collect()
            };
            for handle in collider_handles {
                lobby.world.remove_collider(handle);
            }
            for shape in &pawn.collider_shapes {
                let collider: ColliderBuilder = ColliderBuilder::from(shape).friction(0.7)
                    .mass_properties(MassProperties::new(Point::<f32>::origin(), 1.0, vector![1.0,1.0,1.0]));
                lobby.world.insert_with_parent(collider.build(), pawn.rigid_body.unwrap());
            }
        }
        if pawn.moveable {
            let rb_handle = pawn.rigid_body.unwrap();
            let rb = lobby.world.rigid_body_set.get_mut(rb_handle).unwrap();
            // Don't simulate selected pawns
            rb.set_body_type(if pawn.selected_user.is_none() {
                RigidBodyType::Dynamic
            } else {
                RigidBodyType::KinematicPositionBased
            });
            for collider_handle in rb.colliders().iter() {
                let collider = lobby.world.collider_set.get_mut(*collider_handle).unwrap();
                collider.set_sensor(pawn.selected_user.is_some());
            }
            // Update position and velocity
            if update.position.is_some() || update.rotation.is_some() {
                let old_position: &Vector<f32> = rb.translation();
                let position: Vector<f32> = Vector::from(&pawn.position);

                let rotation: Rotation<f32> = Rotation::from(&pawn.rotation);
                let time_difference = (Instant::now() - pawn.last_updated).as_secs_f32();
                let velocity: Vector<f32> = (position - old_position)/time_difference.max(1.0/20.0);

                let wake = true;
                rb.set_translation(position, wake);
                rb.set_rotation(rotation.scaled_axis(), wake);
                rb.set_linvel(velocity, wake);
                rb.set_angvel(vector![0.0, 0.0, 0.0], wake);
            }
        }

        // Refresh last updated
        pawn.last_updated = Instant::now();

        true
    });
    
    // Relay to other users that these pawns were changed
    lobby.users.values()
        .filter(|u| u.id != user_id)
        .send_event(&Event::UpdatePawns { updates })
}

// --- GAME REGISTRATION EVENTS ---

fn register_game(user_id: usize, lobby: &mut Lobby, info: Cow<'_, GameInfo>) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { Err("Failed to register game")?; }

    println!("User <{user_id}> registering game \"{}\" for lobby [{}]",
             info.name, lobby.name);

    lobby.info = Some(info.into_owned());

    lobby.users.values()
        .send_event(&Event::RegisterGame(
            Cow::Borrowed(lobby.info.as_ref().unwrap())
        ))
}
fn register_asset(user_id: usize, lobby: &mut Lobby, name: String, data: String) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host || lobby.assets.len() >= 256 { Err("Failed to register asset")?; }

    if lobby.assets.get(&name).is_some() { Err("Attempting to overwrite asset")?; }

    let url = DataUrl::process(&data).ok().ok_or("Failed to process base64")?;
    let asset = Asset {
        mime_type: url.mime_type().type_.clone() + "/" + &url.mime_type().subtype,
        data: url.decode_to_vec().ok().ok_or("Failed to decode base64")?.0, // Vec<u8>
    };

    // No assets above 2 MiB
    if asset.data.len() > 1024 * 1024 * 2 { Err("Asset too large")?; }

    lobby.assets.insert(name.to_string(), asset);

    println!("User <{user_id}> registering asset with filename: \"{name}\" for lobby [{}]", lobby.name);
    Ok(())
}
fn clear_assets(user_id: usize, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { Err("Failed to clear assets")?; }

    lobby.assets = HashMap::new();

    println!("User <{user_id}> clearing assets for lobby [{}]", lobby.name);
    Ok(())
}

// --- USER EVENTS ---

fn user_joined(user_id: usize, lobby: &Lobby) -> Result<(), Box<dyn Error>> {
    // Get user
    let user = lobby.users.get(&user_id).unwrap();
    
    println!("User <{}> joined lobby [{}] with {} users and {} pawns",
        user_id, lobby.name, lobby.users.len(), lobby.pawns.len());
    
    user.send_event(&Event::Start {
        id: user_id,
        host: (lobby.users.len() == 1),
        color: &user.color,
        info: &lobby.info,
        users: lobby.users.values().collect(),
        pawns: lobby.pawns.values().collect(),
    })?;
    
    // Tell all other users that this user has joined
    lobby.users.values()
        .filter(|u| u.id != user_id)
        .send_event(&Event::Connect {
            id: user_id,
            color: &user.color,
        })
}

async fn user_disconnected(user_id: usize, lobby_name: &str, lobbies: &Lobbies) -> Result<(), Box<dyn Error>> {
    let lobbies_rl = lobbies.read().await;
    let mut lobby = lobbies_rl.get(lobby_name).ok_or("Missing lobby")?.write().await;
    
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
                let rb_handle = pawn.rigid_body.unwrap();
                let rb = lobby_mut_ref.world.rigid_body_set.get_mut(rb_handle).unwrap();
                rb.set_body_type(RigidBodyType::Dynamic);
                for collider_handle in rb.colliders().iter() {
                    let collider = lobby_mut_ref.world.collider_set.get_mut(*collider_handle).unwrap();
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
        &Event::UpdatePawns { updates: deselected_pawns }
    )?;
    
    if lobby.users.len() != 0 { // If the user id is the host, let's reassign the host to the next user
        if lobby.host == user_id {
            // Reassign host
            lobby.host = *lobby.users.keys().next().unwrap();

            // Tell the new host
            lobby.users.get(&lobby.host).unwrap().send_event(&Event::AssignHost {})?;

            println!("Host of lobby [{lobby_name}] left, reassigning <{user_id}> -> <{}>", lobby.host);
        }
    } else { // Otherwise, delete lobby if last user
        drop(lobby);
        drop(lobbies_rl);
        let mut lobbies_wl = lobbies.write().await;

        lobbies_wl.remove(lobby_name);

        println!("Lobby [{lobby_name}] removed");
    }
    Ok(())
}

fn ping(user_id: usize, lobby: &Lobby, idx: u64) -> Result<(), Box<dyn Error>> {
    // Pong
    lobby.users.get(&user_id).unwrap().send_event(&Event::Pong { idx })?;
    Ok(())
}

// -- CURSOR EVENTS --

fn update_cursor(user_id: usize, lobby: &mut Lobby, position: Vec3) -> Result<(), Box<dyn Error>> {
    let mut user = lobby.users.get_mut(&user_id).unwrap();

    user.cursor_position = position;
    Ok(())
}

// -- CHAT EVENTS --

fn chat(user_id: usize, lobby: &Lobby, content: Cow<'_, String>) -> Result<(), Box<dyn Error>> {
    lobby.users.values().send_event(&Event::Chat {
        id: Some(user_id),
        content: Cow::Borrowed(&content)
    })
}
