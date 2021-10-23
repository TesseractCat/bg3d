use std::collections::HashMap;
use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};
use std::env;

use futures_util::{FutureExt, StreamExt, SinkExt, TryFutureExt};
use tokio::sync::{RwLock, mpsc};
use tokio_stream::wrappers::UnboundedReceiverStream;
use warp::{http::Uri, Filter};
use warp::ws::{Message, WebSocket};
use names::Generator;
use serde_json::{Value, json};
use random_color::{Color};

mod lobby;
mod user;
use lobby::*;
use user::*;

type Lobbies = Arc<RwLock<HashMap<String, Lobby>>>;
type Users = Arc<RwLock<HashMap<usize, User>>>;

static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    let mut port: u16 = 8080;
    if args.len() == 2 {
        port = args[1].parse::<u16>().unwrap_or(8080);
    }
    
    let default = warp::fs::dir("./static").with(warp::compression::gzip());
    
    let index = warp::path::end().or(warp::path!("index.html")).map(|a| {
        let mut generator = Generator::default();
        warp::redirect::see_other(generator.next().unwrap().parse::<Uri>().unwrap())
    });
    
    let game = warp::fs::file("./static/index.html");
    
    let lobbies = Lobbies::default();
    let lobbies = warp::any().map(move || lobbies.clone());
    
    let ws = warp::path!("ws" / String)
        .and(warp::ws())
        .and(lobbies)
        .map(|lobby: String, ws: warp::ws::Ws, lobbies| {
            ws.on_upgrade(move |socket| user_connected(socket, lobby, lobbies))
        });
    
    let routes = warp::get().and(
        index.or(default).or(ws).or(game)
    );

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
            _ => Color::Monochrome, // Should never occur
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
        return;
    }
    for u in lobby.users.values() {
        //if u.id != user_id {
        u.tx.send(Message::text(data.to_string()));
        //}
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
    
    let pawn: Pawn = serde_json::from_value(data["pawn"].clone()).unwrap();
    
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
        lobby.pawns.remove(&id);
    }
    
    // Tell other users that this was removed
    for u in lobby.users.values() {
        u.tx.send(Message::text(data.to_string()));
    }
}
macro_rules! update_from_serde {
    ($to_update:ident, $value:expr, $key:ident) => {
        if !$value.get(stringify!($key)).is_none() {
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
        let pawn: &mut Pawn = lobby.pawns.get_mut(&pawns[i]["id"].as_u64().unwrap())?;
        
        update_from_serde!(pawn, pawns[i], selected);
        update_from_serde!(pawn, pawns[i], position);
        update_from_serde!(pawn, pawns[i], rotation);
        update_from_serde!(pawn, pawns[i], selectRotation);
        update_from_serde!(pawn, pawns[i], data);
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
