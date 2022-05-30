use std::env;
use std::collections::HashMap;
use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};

use futures_util::{FutureExt, StreamExt, SinkExt, TryFutureExt};
use tokio::sync::{RwLock, mpsc};
use tokio_stream::wrappers::UnboundedReceiverStream;

use warp::{http::Uri, Filter};
use warp::ws::{Message, WebSocket};

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
type Lobbies = Arc<RwLock<HashMap<String, Lobby>>>;

static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

#[tokio::main]
async fn main() {
    let default_port: u16 = 8080;
    let mut port: u16 = match env::args().nth(1) {
        Some(p) => p.parse::<u16>().unwrap_or(default_port),
        None => default_port,
    };
    
    // Paths
    let default = warp::fs::dir("./static").with(warp::compression::gzip());
    
    let index = warp::path::end().or(warp::path!("index.html")).map(|a| {
        let mut generator = Generator::default();
        warp::redirect::see_other(generator.next().unwrap().parse::<Uri>().unwrap())
    });
    let www = warp::header::exact("host", "www.birdga.me") .map(|| {
            warp::redirect::permanent(Uri::from_static("https://birdga.me"))
        });
    
    let game = warp::fs::file("./static/index.html");
    
    let lobbies = Lobbies::default();
    let physics_lobbies = lobbies.clone();
    let lobbies = warp::any().map(move || lobbies.clone());
    
    let ws = warp::path!("ws" / String)
        .and(warp::ws())
        .and(lobbies)
        .map(|lobby: String, ws: warp::ws::Ws, lobbies| {
            ws.on_upgrade(move |socket| user_connected(socket, lobby, lobbies))
        });
    
    let routes = warp::get().and(
        (index).or(default).or(ws).or(game)
    );
    
    // Physics steps
    tokio::task::spawn(async move {
        let mut tick: u64 = 0;

        loop {
            {
                let mut lobby_wl = physics_lobbies.write().await;
                for lobby in lobby_wl.values_mut() {
                    // Simulate physics
                    lobby.world.step();

                    // Transfer pawn information from rigidbody
                    let mut dirty_pawns: Vec<&Pawn> = vec![];
                    for pawn in lobby.pawns.values_mut() {
                        if pawn.selected { continue; } // Ignore selected pawns

                        let rb_handle = pawn.rigid_body.unwrap();
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
            tokio::time::sleep(tokio::time::Duration::from_secs_f64(1.0/60.0)).await;
            tick += 1;
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
            tx.send(message).unwrap_or_else(|e| {}).await
        }
    });
    
    // Track user
    {
        let mut lobbies_wl = lobbies.write().await;
        let mut host: bool = false;
        if lobbies_wl.get(&lobby_name).is_none() {
            lobbies_wl.insert(lobby_name.clone(), Lobby::new());
            host = true;
        }
        let mut lobby = lobbies_wl.get_mut(&lobby_name).unwrap();
        if host { lobby.host = user_id; }
        let color: Color = match (lobby.users.len() + 1) % 7 {
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
    
    // Set up loop to relay cursor positions
    let lobbies_clone = lobbies.clone();
    let lobby_name_clone = lobby_name.clone();
    tokio::task::spawn(async move {
        loop {
            relay_cursors(user_id, &lobby_name_clone, &lobbies_clone).await;
            tokio::time::sleep(tokio::time::Duration::from_millis(1000/10)).await;
        }
    });
    
    // Continually process received messages
    while let Some(result) = rx.next().await {
        let message = match result {
            Ok(r) => r,
            Err(e) => {
                println!("websocket error: {}", e);
                break;
            }
        };
        if message.is_close() {
            println!("Websocket connection closed!");
            break;
        }
        let text: String = message.to_str().unwrap().to_string();
        let data: Value = serde_json::from_str(&text).unwrap();
        
        match data["type"].as_str().unwrap() {
            "join" => {user_joined(user_id, data, &lobby_name, &lobbies).await;},
            "ping" => {ping(user_id, data, &lobby_name, &lobbies).await;},
            
            "add_pawn" => {add_pawn(user_id, data, &lobby_name, &lobbies).await;},
            "remove_pawns" => {remove_pawns(user_id, data, &lobby_name, &lobbies).await;},
            "update_pawns" => {update_pawns(user_id, data, &lobby_name, &lobbies).await;},
            
            "send_cursor" => {update_cursor(user_id, data, &lobby_name, &lobbies).await;},
            
            "event" => {event(user_id, data, &lobby_name, &lobbies).await;},
            "event_callback" => {event_callback(user_id, data, &lobby_name, &lobbies).await;},
            _ => (),
        }
    }
    user_disconnected(user_id, &lobby_name, &lobbies).await;
}

// --- GENERIC EVENTS ---

async fn event(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    let target_host: bool = serde_json::from_value(data["target"].clone()).unwrap();
    
    // Relay event
    if target_host {
        lobby.users.get(&lobby.host).unwrap().tx.send(Message::text(data.to_string()));
    } else {
        for u in lobby.users.values() {
            u.tx.send(Message::text(data.to_string()));
        }
    }
}
async fn event_callback(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    let target: usize = serde_json::from_value(data["receiver"].clone()).unwrap();
    
    // Relay callback
    lobby.users.get(&target).unwrap().tx.send(Message::text(data.to_string()));
}

// --- PAWN EVENTS ---

async fn add_pawn(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    let mut pawn: Pawn = serde_json::from_value(data["pawn"].clone()).unwrap();
    
    // Deserialize collider
	let rigid_body = if pawn.moveable { RigidBodyBuilder::dynamic() } else { RigidBodyBuilder::fixed() }
		.translation(Vector::from(&pawn.position))
        .rotation(Rotation::from(&pawn.rotation).scaled_axis())
        .linear_damping(0.5).angular_damping(0.5)
        .build();
	pawn.rigid_body = Some(lobby.world.rigid_body_set.insert(rigid_body));

    for shape in &pawn.shapes {
        let collider = match shape {
            lobby::Shape::Box { half_extents } => {
                ColliderBuilder::cuboid(half_extents.x as f32,
                    half_extents.y as f32,
                    half_extents.z as f32)
            },
            lobby::Shape::Cylinder { radius_top, radius_bottom, height, num_segments } => {
                ColliderBuilder::cylinder((*height as f32)/(2 as f32), *radius_top as f32)
            },
            _ => ColliderBuilder::ball(0.5),
        };
		lobby.world.collider_set.insert_with_parent(
            collider.density(1.0).build(),
			pawn.rigid_body.unwrap(), &mut lobby.world.rigid_body_set);
    }
    
    // Add pawn to lobby
    lobby.pawns.insert(pawn.id, pawn.clone());
    
    // Tell other users that this was added
    let response = json!({
        "type":"add_pawn",
        "pawn":pawn.clone()
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
}
async fn remove_pawns(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    let pawn_ids: Vec<u64> = serde_json::from_value(data["pawns"].clone()).unwrap();
    
    // Remove pawn from lobby
    for id in pawn_ids {
        // Remove rigidbody first
        let rb_handle = lobby.pawns.get(&id).unwrap().rigid_body.unwrap();
        lobby.world.remove_rigidbody(rb_handle);
        lobby.pawns.remove(&id);
    }
    
    // Tell other users that this was removed
    for u in lobby.users.values() {
        u.tx.send(Message::text(data.to_string()));
    }
}
macro_rules! update_from_serde {
    ($to_update:ident, $value:expr, $key:ident) => {
        if $value.get(stringify!($key)).is_some() {
            $to_update.$key = serde_json::from_value($value[stringify!($key)].clone()).unwrap();
        }
    }
}
async fn update_pawns(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) -> Option<()> {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    // Iterate through and update pawns
    let pawns = data["pawns"].as_array().unwrap();
    for i in 0..pawns.len() {
        let pawn_id: u64 = pawns[i]["id"].as_u64().unwrap();
        let pawn: &mut Pawn = lobby.pawns.get_mut(&pawn_id)?;
        
        // Update struct values
        update_from_serde!(pawn, pawns[i], position);
        update_from_serde!(pawn, pawns[i], rotation);
        update_from_serde!(pawn, pawns[i], selected);
        update_from_serde!(pawn, pawns[i], select_rotation);
        update_from_serde!(pawn, pawns[i], data);
        
        // Update physics
        if pawn.moveable {
            let rb_handle = pawn.rigid_body.unwrap();
            let rb = lobby.world.rigid_body_set.get_mut(rb_handle).unwrap();
            if pawns[i].get("position").is_some() || pawns[i].get("rotation").is_some() {
                let position: Vector<f32> = Vector::from(&pawn.position);
                let rotation: Rotation<f32> = Rotation::from(&pawn.rotation);

                rb.set_translation(position, true);
                rb.set_rotation(rotation.scaled_axis(), true);
                rb.set_linvel(vector![0.0, 0.0, 0.0], true);
                rb.set_angvel(vector![0.0, 0.0, 0.0], true);
            }
            // Don't simulate selected pawns
            rb.set_body_type(if !pawn.selected {
                RigidBodyType::Dynamic
            } else {
                RigidBodyType::KinematicPositionBased
            });
        }
    }
    
    // Relay to other users that these pawns were changed
    let response = json!({
        "type":"update_pawns",
        "pawns":data["pawns"]
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
    Some(())
}
/*async fn clear_pawns(lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    // Tell other users to clear
    let response = json!({
        "type":"clear_pawns",
    });
    for u in lobby.users.values() {
        u.tx.send(Message::text(response.to_string()));
    }
}*/

// --- USER EVENTS ---

async fn user_joined(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    // Get user
    let user = lobby.users.get(&user_id).unwrap();
    
    println!("User <{}> joined lobby [{}] with {} users and {} pawns",
        user_id, lobby_name, lobby.users.len(), lobby.pawns.len());
    
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
    user.tx.send(Message::text(response.to_string()));
    
    // Tell all other users that this user has joined
    let response = json!({
        "type":"connect",
        "color":user.color,
        "id":user_id
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
}

async fn user_disconnected(user_id: usize, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    // Tell all other users that this user has disconnected
    let response = json!({
        "type":"disconnect",
        "id":user_id
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
    
    // Remove user from lobby
    lobby.users.remove(&user_id);
    
    if lobby.users.len() != 0 {
        // If the user id is the host, let's reassign the host to the next user
        if lobby.host == user_id {
            // Reassign hsot
            lobby.host = *lobby.users.keys().next().unwrap();
            // Tell the new host
            let response = json!({
                "type":"assign_host"
            });
            lobby.users.get(&lobby.host).unwrap().tx.send(Message::text(response.to_string()));
        }
    } else {
        // Otherwise, delete lobby if last user
        lobby_wl.remove(lobby_name);
    }
}

async fn ping(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_rl = lobbies.read().await;
    let lobby = lobby_rl.get(lobby_name).unwrap();
    
    let response = json!({
        "type":"pong",
        "idx":data["idx"]
    });
    
    // Pong
    lobby.users.get(&user_id).unwrap().tx.send(Message::text(response.to_string()));
}

// -- CURSOR EVENTS --

async fn update_cursor(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_wl = lobbies.write().await;
    let lobby = lobby_wl.get_mut(lobby_name).unwrap();
    
    let mut user = lobby.users.get_mut(&user_id).unwrap();
    user.cursor_position = serde_json::from_value(data["position"].clone()).unwrap();
}
async fn relay_cursors(user_id: usize, lobby_name: &str, lobbies: &Lobbies) -> Option<()> {
    let lobby_rl = lobbies.read().await;
    let lobby = lobby_rl.get(lobby_name)?;
    
    let response = json!({
        "type":"relay_cursors",
        "cursors":lobby.users.iter().map(|(k, v)| {
            json!({
                "id":k,
                "position":v.cursor_position
            })
        }).collect::<Vec<Value>>()
    });
    if lobby.users.contains_key(&user_id) {
        lobby.users.get(&user_id).unwrap().tx.send(Message::text(response.to_string()));
    }
    Some(())
}
