use std::collections::HashMap;
use std::error::Error;
use tokio::sync::{mpsc, mpsc::error::SendError};
use serde::{Serialize, Deserialize};
use axum::extract::ws::Message;
use random_color::{Color, Luminosity, RandomColor};

use crate::events::Event;
use crate::lobby::{Vec3, Pawn, PawnId};

pub trait Sender {
    fn send_event(&mut self, content: &Event) -> Result<(), Box<dyn Error>>;
    fn send_string(&mut self, content: &str) -> Result<(), Box<dyn Error>>;
}
impl<'a, T> Sender for T where T: Iterator<Item=&'a User> {
    fn send_event(&mut self, content: &Event)  -> Result<(), Box<dyn Error>> {
        let content = serde_json::to_string(content)?;
        self.send_string(&content)
    }
    fn send_string(&mut self, content: &str)  -> Result<(), Box<dyn Error>> {
        for user in self {
            user.send_string(content)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug, Default, PartialEq, Eq, Hash)]
pub struct UserId(pub u64);
#[derive(Clone, Serialize, Debug)]
pub struct User {
    pub id: UserId,
    pub color: String,

    #[serde(skip)]
    pub hand: HashMap<PawnId, Pawn>,
    #[serde(skip)]
    pub tx: mpsc::UnboundedSender<Message>,
    #[serde(skip)]
    pub cursor_position: Vec3
}

impl User {
    pub fn new(id: UserId, tx: mpsc::UnboundedSender<Message>, color: Color) -> User {
        User {
            id,
            tx,
            hand: HashMap::new(),
            color: RandomColor::new().hue(color).luminosity(Luminosity::Dark).to_hex(),
            cursor_position: Vec3 {x:0.0,y:0.0,z:0.0}
        }
    }

    pub fn send_event(&self, content: &Event) -> Result<(), SendError<Message>> {
        self.tx.send(Message::Text(serde_json::to_string(content).unwrap()))
    }
    pub fn send_string(&self, content: &str) -> Result<(), SendError<Message>> {
        self.tx.send(Message::Text(content.to_string()))
    }
}
