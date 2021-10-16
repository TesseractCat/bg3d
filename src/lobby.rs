use serde::{Serialize, Deserialize};

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Vec3 {
        pub x: f64,
        pub y: f64,
        pub z: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Pawn {
    pub id: u32,
    pub mesh: String,
    pub position: Vec3,
    pub rotation: Vec3,
    pub mass: f64,
    pub shapes: serde_json::Value
}

pub struct Lobby {
    pub name: String,
    pub users: u32,
    pub pawns: Vec<Pawn>,
}

impl Lobby {
    pub fn new() -> Lobby {
        Lobby {
            name: "".to_string(),
            users: 0,
            pawns: vec![],
        }
    }
}
