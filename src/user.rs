use serde::Serialize;
use warp::ws::*;
use tokio::sync::{mpsc, mpsc::error::SendError};
use random_color::{Color, Luminosity, RandomColor};

use crate::events::Event;
use crate::lobby::Vec3;

#[derive(Clone, Serialize, Debug)]
pub struct User {
    pub id: usize,
    pub color: String,

    #[serde(skip)]
    pub tx: mpsc::UnboundedSender<Message>,
    #[serde(skip)]
    pub cursor_position: Vec3
}

impl User {
    pub fn new(id: usize, tx: mpsc::UnboundedSender<Message>, color: Color) -> User {
        User {
            id,
            tx,
            color: RandomColor::new().hue(color).luminosity(Luminosity::Dark).to_hex(),
            cursor_position: Vec3 {x:0.0,y:0.0,z:0.0}
        }
    }

    pub fn send_event(&self, content: &Event) -> Result<(), SendError<Message>> {
        self.tx.send(Message::text(serde_json::to_string(content).unwrap()))
    }
    pub fn send_string(&self, content: &str) -> Result<(), SendError<Message>> {
        self.tx.send(Message::text(content))
    }
}
