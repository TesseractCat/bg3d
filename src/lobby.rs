use std::collections::HashMap;
use serde::{Serialize, Deserialize};

use crate::user::*;

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Vec3 {
        pub x: f64,
        pub y: f64,
        pub z: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Pawn {
    pub id: u64,
    pub mesh: String,
    pub position: Vec3,
    pub rotation: Vec3,
    pub mass: f64,
    pub moveable: bool,
    pub shapes: serde_json::Value
}

pub struct Lobby {
    pub name: String,
    pub host: usize,
    pub users: HashMap<usize, User>,
    pub pawns: HashMap<u64, Pawn>,
}

impl Lobby {
    pub fn new() -> Lobby {
        Lobby {
            name: "".to_string(),
            host: 0,
            users: HashMap::new(),
            pawns: HashMap::new(),
        }
    }
}
