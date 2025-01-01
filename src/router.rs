use std::{collections::HashMap, env, net::SocketAddr, sync::Arc};

use axum::{body::Body, extract::{ws::{CloseFrame, Message, WebSocket}, Path, RawQuery, Request, State, WebSocketUpgrade}, http::{StatusCode, Uri}, response::{IntoResponse, Redirect, Response}, routing::{any, get}, Router};
use futures::{SinkExt, StreamExt};
use tokio::{io::{AsyncBufReadExt, BufReader}, net::TcpStream, process::Child, sync::RwLock};
use tokio::process::Command;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite as ts;
use tower::Service;
use tower_http::{compression::CompressionLayer, services::{ServeDir, ServeFile}};

use hyper_util::{client::legacy::{connect::HttpConnector, Client}, rt::TokioExecutor};

#[allow(dead_code)]
struct Lobby {
    child: Child,
    port: u16
}
type Lobbies = HashMap<String, Lobby>;

#[tokio::main]
async fn main() {
    let base_uri: Uri = Uri::try_from(env::args().nth(1).unwrap_or("http://localhost:8080".to_string())).expect("Invalid Uri provided");
    let port = base_uri.port_u16().unwrap_or(80);

    let lobbies: Lobbies = Default::default();
    let lobbies = Arc::new(RwLock::new(lobbies));
    let lobbies_clone = lobbies.clone();
    let lobbies_ws_clone = lobbies.clone();

    let index_routes = Router::new()
        .route_service("/", ServeFile::new("static/frontpage/index.html"))
        .route("/index.html", get(|| async { Redirect::to("/") }));

    let mut connector = HttpConnector::new();
    let client: Client<HttpConnector, Body> = Client::builder(TokioExecutor::new()).build(connector.clone());

    let app = index_routes
        // .route("/dashboard", get(move || {
        //     dashboard(lobbies)
        // }))
        .nest_service("/static",
                      ServeDir::new("static").append_index_html_on_directories(false))
        .nest_service("/plugins",
                      ServeDir::new("plugins").append_index_html_on_directories(false))
        .route("/:lobby", any(move |
            State(client): State<Client<HttpConnector, Body>>,
            Path(lobby): Path<String>, RawQuery(query): RawQuery, req: Request
        | {
            async move {
                lobby_proxy(lobbies, lobby, "".into(), query, client, req).await
            }
        }))
        .route("/:lobby/ws", get(move |
            ws: WebSocketUpgrade,
            Path(lobby): Path<String>,
            req: Request
        | {
            let path = "ws";
            async move {
                let port = {
                    let lobbies = lobbies_ws_clone.read().await;
                    let lobby = lobbies.get(&lobby).ok_or(StatusCode::NOT_FOUND)?;
                    lobby.port
                };

                let uri_ws = Uri::try_from(format!("ws://localhost:{}/{}", port, path)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let uri_http = Uri::try_from(format!("http://localhost:{}/{}", port, path)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

                let stream = connector.call(uri_http).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.into_inner();
                let mut req = Request::from_parts(req.into_parts().0, ());
                *req.uri_mut() = uri_ws;
                let (ws_stream, _) = tokio_tungstenite::client_async(
                    req,
                    stream
                ).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

                Ok::<Response, StatusCode>(ws.on_upgrade(move |ws: WebSocket| {
                    ws_proxy(ws, ws_stream)
                }))
            }
        }))
        .route("/:lobby/*path", any(move |
            State(client): State<Client<HttpConnector, Body>>,
            Path((lobby, path)): Path<(String, String)>, RawQuery(query): RawQuery, req: Request
        | {
            async move {
                lobby_proxy(lobbies_clone, lobby, path, query, client, req).await
            }
        }))
        .with_state(client)
        .layer(CompressionLayer::new());

    println!("Starting BG3D at [{base_uri}]...");
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

async fn lobby_proxy(
    lobbies: Arc<RwLock<Lobbies>>, lobby: String,
    path: String, query: Option<String>,
    client: Client<HttpConnector, Body>, mut req: Request
) -> Result<Response, StatusCode> {
    let port = {
        let port: u16;
        if let Some(p) = {
            let lobbies = lobbies.read().await;
            lobbies.get(&lobby).map(|l| l.port)
        } {
            port = p;
        } else {
            // Launch server
            println!("Launching lobby [{lobby}]!");
            let mut child = Command::new("server")
                .arg("0").arg(lobby.clone())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let mut stdout = BufReader::new(child.stdout.take().unwrap());
            port = {
                let mut buf = String::new();
                stdout.read_line(&mut buf).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let port = buf[0..buf.len()-1].parse().unwrap();
                println!(" - Got port {port}");
                port
            };
            {
                let mut lobbies = lobbies.write().await;
                lobbies.insert(lobby.clone(), Lobby {
                    child: child,
                    port: port
                });
            }
            tokio::task::spawn(async move {
                let mut buf = String::new();
                loop {
                    buf.clear();
                    if let Err(_) = stdout.read_line(&mut buf).await {
                        break;
                    }
                    println!("[{lobby}]: {}", buf.trim());
                }
            });
            println!("Launched!");
        }
        port
    };

    let uri = format!("http://localhost:{}/{}{}", port, path, query.map(|x| format!("?{x}")).unwrap_or("".into()));
    *req.uri_mut() = Uri::try_from(uri).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(client
        .request(req)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)
        .into_response())
}

// async fn dashboard(lobbies: ?) -> String {
//     let lobbies = lobbies.read().await;

//     let mut lobbies_text = String::new();
//     for (name, lobby) in lobbies.iter() {
//         let lobby = lobby.lock().await;
//         lobbies_text += &format!(" - '{}' [{} user(s)]\n", name, lobby.users.len());
//     }

//     format!(
//         include_str!("../static/dashboard.html"),
//         lobby_count = lobbies.len(),
//         lobbies = lobbies_text
//     )
// }

trait MessageExt {
    fn into_tungstenite(self) -> ts::Message;
    fn from_tungstenite(message: ts::Message) -> Option<Self> where Self: Sized;
}
impl MessageExt for Message {
    fn into_tungstenite(self) -> ts::Message {
        match self {
            Self::Text(text) => ts::Message::Text(text),
            Self::Binary(binary) => ts::Message::Binary(binary),
            Self::Ping(ping) => ts::Message::Ping(ping),
            Self::Pong(pong) => ts::Message::Pong(pong),
            Self::Close(Some(close)) => ts::Message::Close(Some(ts::protocol::CloseFrame {
                code: ts::protocol::frame::coding::CloseCode::from(close.code),
                reason: close.reason,
            })),
            Self::Close(None) => ts::Message::Close(None),
        }
    }

    fn from_tungstenite(message: ts::Message) -> Option<Self> {
        match message {
            ts::Message::Text(text) => Some(Self::Text(text)),
            ts::Message::Binary(binary) => Some(Self::Binary(binary)),
            ts::Message::Ping(ping) => Some(Self::Ping(ping)),
            ts::Message::Pong(pong) => Some(Self::Pong(pong)),
            ts::Message::Close(Some(close)) => Some(Self::Close(Some(CloseFrame {
                code: close.code.into(),
                reason: close.reason,
            }))),
            ts::Message::Close(None) => Some(Self::Close(None)),
            // we can ignore `Frame` frames as recommended by the tungstenite maintainers
            // https://github.com/snapview/tungstenite-rs/issues/268
            ts::Message::Frame(_) => None,
        }
    }
}

async fn ws_proxy(
    ws_ext: WebSocket, ws_lobby: WebSocketStream<TcpStream>
) {
    let (mut ws_ext_tx, mut ws_ext_rx) = ws_ext.split();
    let (mut ws_lobby_tx, mut ws_lobby_rx) = ws_lobby.split();
    // Ext -> lobby
    tokio::spawn(async move {
        while let Some(msg) = ws_ext_rx.next().await {
            if let Ok(msg) = msg {
                let close = matches!(msg, Message::Close(_));
                let _ = ws_lobby_tx.send(msg.into_tungstenite()).await;
                if close { break; }
            } else {
                // TODO: Log error
                break;
            }
        }
    });
    // Lobby -> ext
    tokio::spawn(async move {
        while let Some(msg) = ws_lobby_rx.next().await {
            if let Ok(msg) = msg {
                if let Some(msg) = Message::from_tungstenite(msg) {
                    let close = matches!(msg, Message::Close(_));
                    let _ = ws_ext_tx.send(msg).await;
                    if close { break; }
                }
            } else {
                // TODO: Log error
                break;
            }
        }
    });
}