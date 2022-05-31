use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};
use rapier3d::prelude::*;

use crate::user::*;
use crate::physics::*;

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Vec3 {
        pub x: f64,
        pub y: f64,
        pub z: f64,
}
impl From<&Vector<f32>> for Vec3 {
	fn from(v: &Vector<f32>) -> Self {
		Vec3 {
			x: v.x as f64,
			y: v.y as f64,
			z: v.z as f64,
		}
	}
}
impl From<&Vec3> for Vector<f32> {
	fn from(v: &Vec3) -> Self {
		vector![v.x as f32, v.y as f32, v.z as f32]
	}
}
impl From<&Rotation<f32>> for Vec3 {
	fn from(v: &Rotation<f32>) -> Self {
		let euler = v.euler_angles();
		Vec3 {
			x: euler.0 as f64,
			y: euler.1 as f64,
			z: euler.2 as f64,
		}
	}
}
impl From<&Vec3> for Rotation<f32> {
	fn from(v: &Vec3) -> Self {
		Rotation::from_euler_angles(v.x as f32, v.y as f32, v.z as f32)
	}
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Vec2 {
        pub x: f64,
        pub y: f64,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Shape {
    #[serde(rename_all = "camelCase")]
    Box { half_extents: Vec3 },
    #[serde(rename_all = "camelCase")]
    Cylinder { radius: f64, height: f64 },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PawnData {
    #[serde(rename_all = "camelCase")]
    Deck { contents: Vec<String>, back: Option<String>, side_color: u64, corner_radius: f64, size: Vec2 },
    #[serde(rename_all = "camelCase")]
    Dice { roll_rotations: Vec<Vec3> },
    #[serde(rename_all = "camelCase")]
    Container { holds: Box<Pawn> },
    Pawn {},
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Pawn {
    pub id: u64, // Identifiers
    
    pub class: String, // Immutable Properties
    pub name: Option<String>,
    pub mesh: Option<String>,
    #[serde(rename = "meshOffset")]
    pub mesh_offset: Vec3,

    #[serde(rename = "colliderShapes")] // Physics properties
    pub shapes: Vec<Shape>,
    pub moveable: bool,
    pub mass: f64,
    
    pub position: Vec3, // Mutable Properties
    pub rotation: Vec3,
    pub selected: bool,
    #[serde(rename = "selectRotation")]
    pub select_rotation: Vec3,
    
    pub data: PawnData, // Misc

	#[serde(skip)]
	pub rigid_body: Option<RigidBodyHandle>,
}
impl Pawn {
    pub fn serialize(&self) -> Value {
        serde_json::to_value(self).unwrap()
    }
    pub fn serialize_transform(&self) -> Value {
        json!({
            "id": self.id,
            "position": self.position,
            "rotation": self.rotation,
        })
    }
}

pub struct Lobby {
    pub name: String,
    pub host: usize,

    pub users: HashMap<usize, User>, // FIXME: Make these both u16
    pub pawns: HashMap<u64, Pawn>,

    pub world: PhysicsWorld,
}
impl Lobby {
    pub fn new() -> Lobby {
        Lobby {
            name: "".to_string(),
            host: 0,
            users: HashMap::new(),
            pawns: HashMap::new(),
            world: PhysicsWorld::new(1.0/30.0),
        }
    }
}
