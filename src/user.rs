use warp::ws::*;
use tokio::sync::mpsc;
use random_color::{Color, Luminosity, RandomColor};

use crate::lobby::Vec3;

pub struct User {
    pub id: usize,
    pub tx: mpsc::UnboundedSender<Message>,
    pub color: String,
    pub cursor_position: Vec3
}

impl User {
    pub fn new(id: usize, tx: mpsc::UnboundedSender<Message>, color: Color) -> User {
        User {
            id: id,
            tx: tx,
            color: RandomColor::new().hue(color).luminosity(Luminosity::Dark).to_hex(),
            cursor_position: Vec3 {x:0.0,y:0.0,z:0.0}
        }
    }
}
