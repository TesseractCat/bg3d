use std::collections::HashMap;
use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};

use futures_util::{FutureExt, StreamExt, SinkExt, TryFutureExt};
use tokio::sync::{RwLock, mpsc};
use tokio_stream::wrappers::UnboundedReceiverStream;
use warp::{http::Uri, Filter};
use warp::ws::{Message, WebSocket};
use names::Generator;
use serde_json::{Result, Value, json};

mod lobby;
mod user;
use lobby::*;
use user::*;

type Lobbies = Arc<RwLock<HashMap<String, Lobby>>>;
type Users = Arc<RwLock<HashMap<usize, User>>>;

static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

#[tokio::main]
async fn main() {
    let default = warp::fs::dir("./static");
    
    let index = warp::get().and(warp::path::end()).or(warp::path!("index.html")).map(|a| {
        let mut generator = Generator::default();
        warp::redirect::see_other(generator.next().unwrap().parse::<Uri>().unwrap())
    });
    
    let game = warp::get().and(warp::fs::file("./static/index.html"));
    
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

    warp::serve(routes).run(([0, 0, 0, 0], 8080)).await;
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
        let mut lobbies_write_lock = lobbies.write().await;
        let mut host: bool = false;
        if lobbies_write_lock.get(&lobby_name).is_none() {
            lobbies_write_lock.insert(lobby_name.clone(), Lobby::new());
            host = true;
        }
        let mut lobby = lobbies_write_lock.get_mut(&lobby_name).unwrap();
        if host { lobby.host = user_id; }
        lobby.users.insert(user_id, User::new(user_id, buffer_tx));
    }
    
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
            user_disconnected(user_id, &lobby_name, &lobbies).await;
            break;
        }
        let text: String = message.to_str().unwrap().to_string();
        let data: Value = serde_json::from_str(&text).unwrap();
        
        match data["type"].as_str().unwrap() {
            "join" => user_joined(user_id, data, &lobby_name, &lobbies).await,
            "add_pawn" => add_pawn(user_id, data, &lobby_name, &lobbies).await,
            "update_pawns" => update_pawns(user_id, data, &lobby_name, &lobbies).await,
            "request_update_pawn" => request_update_pawn(user_id, data, &lobby_name, &lobbies).await,
            "send_cursor" => update_cursor(user_id, data, &lobby_name, &lobbies).await,
            _ => (),
        }
        relay_cursors(user_id, &lobby_name, &lobbies).await
    }
}

// --- PAWN EVENTS ---

async fn add_pawn(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_write_lock = lobbies.write().await;
    let mut lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    
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
async fn update_pawns(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_write_lock = lobbies.write().await;
    let mut lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    
    // Iterate through and update pawns
    let pawns = data["pawns"].as_array().unwrap();
    for i in 0..pawns.len() {
        let pawn: &mut Pawn = lobby.pawns.get_mut(&pawns[i]["id"].as_u64().unwrap()).unwrap();
        let position: Vec3 = serde_json::from_value(pawns[i]["position"].clone()).unwrap();
        let rotation: Vec3 = serde_json::from_value(pawns[i]["rotation"].clone()).unwrap();
        pawn.selected = pawns[i]["selected"].clone().as_bool().unwrap();
        pawn.position = position;
        pawn.rotation = rotation;
    }
    
    // Tell other users that these pawns were changed
    let response = json!({
        "type":"update_pawns",
        "pawns":data["pawns"]
    });
    for u in lobby.users.values() {
        if u.id != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
}

async fn request_update_pawn(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_write_lock = lobbies.write().await;
    let mut lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    
    // Forward to host
    let response = json!({
        "type":"request_update_pawn",
        "pawn":data["pawn"]
    });
    //FIXME handle reassigning host
    lobby.users[&lobby.host].tx.send(Message::text(response.to_string()));
}

// --- USER EVENTS ---

async fn user_joined(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_write_lock = lobbies.write().await;
    let mut lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    
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
    let mut lobby_write_lock = lobbies.write().await;
    let mut lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    
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
    
    // Remove user from lobby, delete lobby if last user
    lobby.users.remove(&user_id);
    if lobby.users.len() == 0 {
        lobby_write_lock.remove(lobby_name);
    }
}

// -- CURSOR EVENTS --
async fn update_cursor(user_id: usize, data: Value, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_write_lock = lobbies.write().await;
    let mut lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    
    let mut user = lobby.users.get_mut(&user_id).unwrap();
    user.cursor_position = serde_json::from_value(data["position"].clone()).unwrap();
}
async fn relay_cursors(user_id: usize, lobby_name: &str, lobbies: &Lobbies) {
    let mut lobby_write_lock = lobbies.write().await;
    let mut lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    
    let response = json!({
        "type":"relay_cursors",
        "cursors":lobby.users.iter().map(|(k, v)| {
            json!({
                "id":k,
                "position":v.cursor_position
            })
        }).collect::<Vec<Value>>()
    });
    for u in lobby.users.values() {
        u.tx.send(Message::text(response.to_string()));
    }
}
