use std::env;
use std::collections::HashMap;
use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};
use std::ops::{Deref, DerefMut};
use std::error::Error;

use futures_util::{StreamExt, SinkExt, TryFutureExt};
use tokio::time::{sleep, Duration, Instant};
use tokio::sync::{RwLock, mpsc};
use tokio_stream::wrappers::UnboundedReceiverStream;

use warp::{http::{Uri, Response}, Filter};
use warp::ws::{Message, WebSocket};
use data_url::{DataUrl};

use serde_json::{Value, json};

use names::Generator;
use random_color::{Color};
use rapier3d::prelude::*;

mod lobby;
mod user;
mod physics;

use lobby::*;
use user::*;

//TODO: Replace this with Dashmap?
type Lobbies = Arc<RwLock<HashMap<String, RwLock<Lobby>>>>;

static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

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
                    .body(asset.data.clone());
                Ok(response)
            }
        })
        .with(warp::compression::gzip());
    
    let index = warp::path::param::<String>()
        .and(warp::path::end())
        .and(warp::fs::file("./static/index.html"))
        .map(|_, file| file)
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
                    let lobby = &mut *lobby.write().await;
                    // Simulate physics
                    lobby.world.step();

                    // Transfer pawn information from rigidbody
                    let mut dirty_pawns: Vec<&Pawn> = vec![];
                    for pawn in lobby.pawns.values_mut() {
                        if pawn.selected { continue; } // Ignore selected pawns

                        let rb_handle = pawn.rigid_body.expect("A pawn must have a rigid body handle");
                        let rb = lobby.world.rigid_body_set.get(rb_handle).unwrap();
                        pawn.position = Vec3::from(rb.translation());
                        pawn.rotation = Vec3::from(rb.rotation());
                        if !rb.is_sleeping() && rb.is_moving() {
                            dirty_pawns.push(pawn);
                        }
                    }
                    if !dirty_pawns.is_empty() && tick % 3 == 0 {
                        // Send update
                        let response = json!({
                            "type":"update_pawns",
                            "pawns":dirty_pawns.iter().map(|p| p.serialize_transform()).collect::<Vec<Value>>(),
                        });
                        for u in lobby.users.values() {
                            u.tx.send(Message::text(response.to_string()));
                        }
                    }
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
                    for user_id in lobby.users.keys() {
                        relay_cursors(*user_id, &lobby);
                    }
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
    let user_id = NEXT_USER_ID.fetch_add(1, Ordering::Relaxed);
    let (mut tx, mut rx) = ws.split();
    
    let (buffer_tx, buffer_rx) = mpsc::unbounded_channel::<Message>();
    let mut buffer_rx = UnboundedReceiverStream::new(buffer_rx);
    
    // Automatically send buffered messages
    tokio::task::spawn(async move {
        while let Some(message) = buffer_rx.next().await {
            tx.send(message).unwrap_or_else(|_| {}).await
        }
    });
    
    // Track user
    {
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
    }
    
    // Continually process received messages
    while let Some(result) = rx.next().await {
        let message = match result {
            Ok(r) => r,
            Err(e) => {
                println!("Websocket error: {}", e);
                break;
            }
        };
        if message.is_close() {
            println!("Websocket connection closed, user <{user_id}> left");
            break;
        }
        let text: &str = message.to_str().unwrap();
        let data: Value = serde_json::from_str(text).unwrap();

        let lobbies_rl = lobbies.read().await;
        let lobby = lobbies_rl.get(&lobby_name).unwrap();

        let event_type: String = data["type"].as_str().unwrap_or_default().to_string();
        let event_result = match event_type.as_str() {
            "join" => user_joined(user_id, data, lobby.read().await.deref()),
            "ping" => ping(user_id, data, lobby.read().await.deref()),
            
            "add_pawn"     => add_pawn(user_id, data, lobby.write().await.deref_mut()),
            "remove_pawns" => remove_pawns(user_id, data, lobby.write().await.deref_mut()),
            "update_pawns" => update_pawns(user_id, data, lobby.write().await.deref_mut()),

            "register_asset" => register_asset(user_id, data, lobby.write().await.deref_mut()),
            "clear_assets" => clear_assets(user_id, data, lobby.write().await.deref_mut()),
            
            "send_cursor" => update_cursor(user_id, data, lobby.write().await.deref_mut()),
            
            "event"          => event(user_id, data, lobby.write().await.deref_mut()),
            "event_callback" => event_callback(user_id, data, lobby.write().await.deref_mut()),

            _ => Err("Invalid event".into()),
        };

        if event_result.is_err() {
            println!("Error encountered while handling event [{}]: {:?}",
                     event_type, event_result);
        }
    }
    user_disconnected(user_id, &lobby_name, &lobbies).await;
}

// --- GENERIC EVENTS ---

fn event(_user_id: usize, data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    let target_host: bool = serde_json::from_value(data["target"].clone())?;
    
    // Relay event
    if target_host {
        lobby.users.get(&lobby.host).ok_or("Missing host")?.tx.send(Message::text(data.to_string()))?;
    } else {
        for u in lobby.users.values() {
            u.tx.send(Message::text(data.to_string()))?;
        }
    }

    Ok(())
}
fn event_callback(_user_id: usize, data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    let target: usize = serde_json::from_value(data["receiver"].clone())?;
    
    // Relay callback
    lobby.users.get(&target).ok_or("Missing callback target")?.tx.send(Message::text(data.to_string()))?;
    Ok(())
}

// --- PAWN EVENTS ---

fn add_pawn(user_id: usize, data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host || lobby.pawns.len() >= 1024 { Err("Failed to add pawn")?; }

    let mut pawn: Pawn = serde_json::from_value(data["pawn"].clone())?;
    
    // Deserialize collider
	let rigid_body = if pawn.moveable { RigidBodyBuilder::dynamic() } else { RigidBodyBuilder::fixed() }
		.translation(Vector::from(&pawn.position))
        .rotation(Rotation::from(&pawn.rotation).scaled_axis())
        .linear_damping(0.5).angular_damping(0.5)
        .build();
	pawn.rigid_body = Some(lobby.world.rigid_body_set.insert(rigid_body));

    for shape in &pawn.collider_shapes {
        let collider: ColliderBuilder = ColliderBuilder::from(shape).density(1.0).friction(0.7);
        lobby.world.insert_with_parent(collider.build(), pawn.rigid_body.unwrap());
    }
    
    // Add pawn to lobby
    lobby.pawns.insert(pawn.id, pawn.clone());
    
    // Tell other users that this was added
    let response = json!({
        "type":"add_pawn",
        "pawn":pawn.clone()
    });
    for u in lobby.users.values() {
        u.tx.send(Message::text(response.to_string()))?;
    }
    Ok(())
}
fn remove_pawns(user_id: usize, data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { Err("Failed to remove pawn")?; }

    let pawn_ids: Vec<u64> = serde_json::from_value(data["pawns"].clone())?;
    
    // Remove pawn from lobby
    for id in pawn_ids {
        // Remove rigidbody first
        let rb_handle = lobby.pawns.get(&id).ok_or("Trying to remove missing pawn")?.rigid_body.unwrap();
        lobby.world.remove_rigidbody(rb_handle);
        lobby.pawns.remove(&id);
    }
    
    // Tell other users that this was removed
    for u in lobby.users.values() {
        u.tx.send(Message::text(data.to_string()))?;
    }
    Ok(())
}
fn update_pawns(user_id: usize, data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    // Iterate through and update pawns
    let pawns = data["pawns"].as_array().ok_or("Malformed update_pawns")?;
    for i in 0..pawns.len() {
        let pawn_id: u64 = pawns[i]["id"].as_u64().ok_or("Malformed update_pawns")?;
        let pawn: &mut Pawn = lobby.pawns.get_mut(&pawn_id).ok_or("Trying to update missing pawn")?;
        
        // Update struct values
        pawn.patch(&pawns[i]);
        
        // Update physics
        if pawns[i].get("colliderShapes").is_some() {
            let collider_handles: Vec<ColliderHandle> = {
                let rb_handle = pawn.rigid_body.unwrap();
                let rb = lobby.world.rigid_body_set.get_mut(rb_handle).unwrap();
                rb.colliders().iter().map(|h| *h).collect()
            };
            for handle in collider_handles {
                lobby.world.remove_collider(handle);
            }
            for shape in &pawn.collider_shapes {
                let collider: ColliderBuilder = ColliderBuilder::from(shape).density(1.0).friction(0.7);
                lobby.world.insert_with_parent(collider.build(), pawn.rigid_body.unwrap());
            }
        }
        if pawn.moveable {
            let rb_handle = pawn.rigid_body.unwrap();
            let rb = lobby.world.rigid_body_set.get_mut(rb_handle).unwrap();
            // Don't simulate selected pawns
            rb.set_body_type(if !pawn.selected {
                RigidBodyType::Dynamic
            } else {
                RigidBodyType::KinematicPositionBased
            });
            for collider_handle in rb.colliders().iter() {
                let collider = lobby.world.collider_set.get_mut(*collider_handle).unwrap();
                collider.set_sensor(pawn.selected);
            }
            // Update position and velocity
            if pawns[i].get("position").is_some() || pawns[i].get("rotation").is_some() {
                let old_position: &Vector<f32> = rb.translation();
                let position: Vector<f32> = Vector::from(&pawn.position);

                let rotation: Rotation<f32> = Rotation::from(&pawn.rotation);
                let time_difference = (Instant::now() - pawn.last_updated).as_secs_f32();
                let velocity: Vector<f32> = (position - old_position)/time_difference;

                let wake = true;
                rb.set_translation(position, wake);
                rb.set_rotation(rotation.scaled_axis(), wake);
                rb.set_linvel(velocity, wake);
                rb.set_angvel(vector![0.0, 0.0, 0.0], wake);
            }
        }

        // Refresh last updated
        pawn.last_updated = Instant::now();
    }
    
    // Relay to other users that these pawns were changed
    let response = json!({
        "type":"update_pawns",
        "pawns":data["pawns"]
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()))?;
        }
    }
    Ok(())
}

// --- ASSET EVENTS ---

fn register_asset(user_id: usize, data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host || lobby.assets.len() >= 256 { Err("Failed to register asset")?; }

    let name = data["name"].as_str().ok_or("Malformed register_asset")?;
    let data = data["data"].as_str().ok_or("Malformed register_asset")?;

    if lobby.assets.get(name).is_some() { Err("Attempting to overwrite asset")?; }

    let url = DataUrl::process(data).ok().ok_or("Failed to process base64")?;
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
fn clear_assets(user_id: usize, _data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    if user_id != lobby.host { Err("Failed to clear assets")?; }

    lobby.assets = HashMap::new();

    println!("User <{user_id}> clearing assets for lobby [{}]", lobby.name);
    Ok(())
}

// --- USER EVENTS ---

fn user_joined(user_id: usize, _data: Value, lobby: &Lobby) -> Result<(), Box<dyn Error>> {
    // Get user
    let user = lobby.users.get(&user_id).unwrap();
    
    println!("User <{}> joined lobby [{}] with {} users and {} pawns",
        user_id, lobby.name, lobby.users.len(), lobby.pawns.len());
    
    let response = json!({
        "type":"start",
        "id":user_id,
        "host":(lobby.users.len() == 1),
        "color":user.color,
        "users":lobby.users.values().map(|u| {
            json!({
                "id":u.id,
                "color":u.color
            })
        }).collect::<Vec<Value>>(),
        "pawns":lobby.pawns.values().collect::<Vec<&Pawn>>()
    });
    user.tx.send(Message::text(response.to_string()))?;
    
    // Tell all other users that this user has joined
    let response = json!({
        "type":"connect",
        "color":user.color,
        "id":user_id
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()))?;
        }
    }
    Ok(())
}

async fn user_disconnected(user_id: usize, lobby_name: &str, lobbies: &Lobbies) -> Result<(), Box<dyn Error>> {
    let lobbies_rl = lobbies.read().await;
    let mut lobby = lobbies_rl.get(lobby_name).ok_or("Missing lobby")?.write().await;
    
    // Tell all other users that this user has disconnected
    let response = json!({
        "type":"disconnect",
        "id":user_id
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()))?;
        }
    }
    
    // Remove user from lobby
    lobby.users.remove(&user_id);
    
    if lobby.users.len() != 0 { // If the user id is the host, let's reassign the host to the next user
        if lobby.host == user_id {
            // Reassign host
            lobby.host = *lobby.users.keys().next().unwrap();

            // Tell the new host
            let response = json!({
                "type":"assign_host"
            });
            lobby.users.get(&lobby.host).unwrap().tx.send(Message::text(response.to_string()))?;

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

fn ping(user_id: usize, data: Value, lobby: &Lobby) -> Result<(), Box<dyn Error>> {
    let response = json!({
        "type":"pong",
        "idx":data["idx"]
    });
    
    // Pong
    lobby.users.get(&user_id).unwrap().tx.send(Message::text(response.to_string()))?;
    Ok(())
}

// -- CURSOR EVENTS --

fn update_cursor(user_id: usize, data: Value, lobby: &mut Lobby) -> Result<(), Box<dyn Error>> {
    let mut user = lobby.users.get_mut(&user_id).unwrap();

    user.cursor_position = serde_json::from_value(data["position"].clone())?;
    Ok(())
}
fn relay_cursors(user_id: usize, lobby: &Lobby) -> Result<(), Box<dyn Error>> {
    let response = json!({
        "type":"relay_cursors",
        "cursors":lobby.users.iter().map(|(k, v)| {
            json!({
                "id":k,
                "position":v.cursor_position
            })
        }).collect::<Vec<Value>>()
    });

    lobby.users.get(&user_id).unwrap().tx.send(Message::text(response.to_string()))?;
    Ok(())
}
