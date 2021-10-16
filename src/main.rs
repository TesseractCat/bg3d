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
    let users = Users::default();
    let users = warp::any().map(move || users.clone());
    
    let ws = warp::path("ws")
        .and(warp::ws())
        .and(lobbies)
        .and(users)
        .map(|ws: warp::ws::Ws, lobbies, users| {
            ws.on_upgrade(move |socket| user_connected(socket, lobbies, users))
        });
    
    let routes = warp::get().and(
        index.or(default).or(ws).or(game)
    );

    warp::serve(routes).run(([127, 0, 0, 1], 8080)).await;
}

async fn user_connected(ws: WebSocket, lobbies: Lobbies, users: Users) {
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
        let mut users_write_lock = users.write().await;
        users_write_lock.insert(user_id, User::new(user_id, buffer_tx));
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
            user_disconnected(user_id, &users, &lobbies).await;
            break;
        }
        let text: String = message.to_str().unwrap().to_string();
        let data: Value = serde_json::from_str(&text).unwrap();
        
        match data["type"].as_str().unwrap() {
            "join" => user_joined(user_id, data, &users, &lobbies).await,
            "add_pawn" => add_pawn(user_id, data, &users, &lobbies).await,
            _ => (),
        }
    }
}

async fn add_pawn(user_id: usize, data: Value, users: &Users, lobbies: &Lobbies) {
    let mut users_write_lock = users.write().await;
    let mut lobby_write_lock = lobbies.write().await;
    
    let pawn: Pawn = serde_json::from_value(data["pawn"].clone()).unwrap();
    
    // Get user/lobby
    let mut user = users_write_lock.get_mut(&user_id).unwrap();
    let mut lobby: &mut Lobby = lobby_write_lock.get_mut(&user.lobby.clone().unwrap()).unwrap();
    
    // Add pawn to lobby
    lobby.pawns.push(pawn.clone());
    
    // Tell other users that this was added
    let response = json!({
        "type":"add_pawn",
        "pawn":pawn.clone()
    });
    for (&uid, u) in users_write_lock.iter() {
        if uid != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
}

async fn user_joined(user_id: usize, data: Value, users: &Users, lobbies: &Lobbies) {
    let mut users_write_lock = users.write().await;
    let mut lobby_write_lock = lobbies.write().await;
    
    // Get user
    let mut user = users_write_lock.get_mut(&user_id).unwrap();

    // Create lobby if uncreated
    let lobby_name = data["lobby"].as_str().unwrap();
    user.lobby = Some(lobby_name.to_string());
    
    if lobby_write_lock.get(lobby_name).is_none() {
        lobby_write_lock.insert(lobby_name.to_string(), Lobby::new());
    }
    let mut lobby: &mut Lobby = lobby_write_lock.get_mut(lobby_name).unwrap();
    lobby.users += 1;
    
    println!("User <{}> joined lobby [{}] with {} users and {} pawns",
        user_id, lobby_name, lobby.users, lobby.pawns.len());
    
    let response = json!({
        "type":"start",
        "host":(lobby.users == 1),
        "pawns":lobby.pawns
    });
    user.tx.send(Message::text(response.to_string()));
    
    // Tell all other users that this user has joined
    let response = json!({
        "type":"connect",
        "id":user_id
    });
    for (&uid, u) in users_write_lock.iter() {
        if uid != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
}

async fn user_disconnected(user_id: usize, users: &Users, lobbies: &Lobbies) {
    let mut users_write_lock = users.write().await;
    let mut lobby_write_lock = lobbies.write().await;
    
    let lobby_name: String = users_write_lock.get(&user_id).unwrap().lobby.clone().unwrap();
    
    // Remove lobby if the last player, otherwise decrement player count
    let mut lobby: &mut Lobby = lobby_write_lock.get_mut(&lobby_name).unwrap();
    if lobby.users > 1 {
        lobby.users -= 1;
    } else {
        println!("Lobby {} closed!", lobby_name);
        lobby_write_lock.remove(&lobby_name);
    }
    
    // Remove user
    users_write_lock.remove(&user_id);
    
    // Tell all other users that this user has disconnected
    let response = json!({
        "type":"disconnect",
        "id":user_id
    });
    for (&uid, u) in users_write_lock.iter() {
        if uid != user_id {
            u.tx.send(Message::text(response.to_string()));
        }
    }
}
