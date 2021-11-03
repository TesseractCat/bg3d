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
#[serde(tag = "type")]
pub enum Shape {
    #[serde(rename_all = "camelCase")]
    Box { half_extents: Vec3 },
    #[serde(rename_all = "camelCase")]
    Cylinder { radius_top: f64, radius_bottom: f64, height: f64, num_segments: u64 },
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Pawn {
    pub id: u64, // Identifiers
    pub name: Option<String>,
    
    pub class: String, // Immutable Properties
    pub mesh: Option<String>,
    #[serde(rename = "meshOffset")]
    pub mesh_offset: Vec3,
    pub mass: f64,
    pub shapes: Vec<Shape>,
    pub moveable: bool,
    
    pub position: Vec3, // Mutable Properties
    pub rotation: Vec3,
    pub selected: bool,
    #[serde(rename = "selectRotation")]
    pub select_rotation: Vec3,
    
    //FIXME: Completely serialize this data, we don't want arbitrary storage here.
    pub data: serde_json::Value // Misc
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
