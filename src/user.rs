use std::collections::HashMap;
use std::error::Error;
use tokio::sync::{mpsc, mpsc::error::SendError};
use serde::{Serialize, Deserialize};
use axum::extract::ws::Message;
use random_color::{Color, Luminosity, RandomColor};

use crate::events::Event;
use crate::pawn::{Vec3, Pawn, PawnId};

pub trait Sender {
    fn send_event(&mut self, content: &Event) -> Result<(), Box<dyn Error>>;
    fn send_binary(&mut self, content: &[u8]) -> Result<(), Box<dyn Error>>;
}
impl<'a, T> Sender for T where T: Iterator<Item=&'a User> {
    fn send_event(&mut self, content: &Event)  -> Result<(), Box<dyn Error>> {
        let content = rmp_serde::to_vec_named(content)?;
        self.send_binary(&content)
    }
    fn send_binary(&mut self, content: &[u8])  -> Result<(), Box<dyn Error>> {
        for user in self {
            user.send_binary(content)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
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
        self.send_binary(&rmp_serde::to_vec_named(content).unwrap())
    }
    pub fn send_binary(&self, content: &[u8]) -> Result<(), SendError<Message>> {
        self.tx.send(Message::Binary(content.to_vec()))
    }
}
