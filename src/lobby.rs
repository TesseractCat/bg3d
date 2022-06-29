use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::error::Error;

use serde::{Serialize, Deserialize};
use serde_with::skip_serializing_none;
use tokio::time::Instant;
use rapier3d::prelude::*;

use crate::user::*;
use crate::physics::*;
use crate::events::*;

#[derive(Clone, Copy, Default, Serialize, Deserialize, Debug)]
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

#[derive(Clone, Copy, Default, Serialize, Deserialize, Debug)]
pub struct Vec2 {
        pub x: f64,
        pub y: f64,
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum Shape {
    #[serde(rename_all = "camelCase")]
    Box { half_extents: Vec3 },
    #[serde(rename_all = "camelCase")]
    Cylinder { radius: f64, height: f64 },
}
impl From<&Shape> for ColliderBuilder {
    fn from(shape: &Shape) -> ColliderBuilder {
        match shape {
            Shape::Box { half_extents } => {
                ColliderBuilder::cuboid(half_extents.x as f32,
                    half_extents.y as f32,
                    half_extents.z as f32)
            },
            Shape::Cylinder { radius, height } => {
                ColliderBuilder::cylinder((*height as f32)/(2 as f32), *radius as f32)
            },
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(untagged)]
pub enum PawnData {
    #[serde(rename_all = "camelCase")]
    Deck {
        contents: Vec<String>, back: Option<String>, side_color: u64,
        border: Option<String>, corner_radius: f64, card_thickness: f64, size: Vec2
    },
    SnapPoint { radius: f64, size: Vec2, scale: f64, snaps: Vec<String> },
    Container { holds: Box<Pawn>, capacity: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Dice { roll_rotations: Vec<Vec3> },
    Pawn {},
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pawn {
    pub id: u64, // Identifiers
    
    pub class: String, // Immutable Properties
    pub name: Option<String>,
    pub mesh: Option<String>,
    pub tint: Option<u64>,

    pub collider_shapes: Vec<Shape>, // Physics properties
    pub moveable: bool,
    pub mass: f64,
    
    pub position: Vec3, // Mutable Properties
    pub rotation: Vec3,
	#[serde(skip)]
    pub selected_user: Option<usize>,
    pub select_rotation: Vec3,
    
    pub data: PawnData, // Misc

	#[serde(skip)]
	pub rigid_body: Option<RigidBodyHandle>,
	#[serde(skip, default = "Instant::now")]
    pub last_updated: Instant,
}
#[skip_serializing_none]
#[derive(Clone, Default, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PawnUpdate {
    pub id: u64,
    
    pub class: Option<String>,
    pub name: Option<String>,
    pub mesh: Option<String>,
    pub tint: Option<u64>,

    pub collider_shapes: Option<Vec<Shape>>,
    pub moveable: Option<bool>,
    pub mass: Option<f64>,
    
    pub position: Option<Vec3>,
    pub rotation: Option<Vec3>,
    pub selected: Option<bool>,
    pub select_rotation: Option<Vec3>,
    
    pub data: Option<PawnData>,
}
impl Pawn {
    pub fn serialize_transform(&self) -> PawnUpdate {
        PawnUpdate {
            id: self.id,
            position: Some(self.position),
            rotation: Some(self.rotation),
            ..Default::default()
        }
    }
    pub fn patch(&mut self, update: &PawnUpdate) {
        update.data.as_ref().map(|v| self.data = v.clone());
        update.collider_shapes.as_ref().map(|v| self.collider_shapes = v.clone());
        update.moveable.map(|v| self.moveable = v);
        update.mass.map(|v| self.mass = v);
        if self.moveable {
            update.position.map(|v| self.position = v);
            update.rotation.map(|v| self.rotation = v);
            update.select_rotation.map(|v| self.select_rotation = v);
        }
    }
}

pub struct Asset {
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub name: String,
    pub author: String,
}
pub struct Lobby {
    pub name: String,
    pub host: usize,
    pub info: Option<GameInfo>,

    pub users: HashMap<usize, User>, // FIXME: Make these both u16
    pub pawns: HashMap<u64, Pawn>,
    pub assets: HashMap<String, Asset>,

    pub world: PhysicsWorld,

    next_user_id: AtomicUsize,
}
impl Lobby {
    pub fn new() -> Lobby {
        Lobby {
            name: "".to_string(),
            host: 0,
            info: None,

            users: HashMap::new(),
            pawns: HashMap::new(),
            assets: HashMap::new(),

            world: PhysicsWorld::new(1.0/30.0),

            next_user_id: AtomicUsize::new(0),
        }
    }

    pub fn next_user_id(&self) -> usize {
        self.next_user_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn step(&mut self, send_update_pawns: bool) -> Result<(), Box<dyn Error>> {
        // Simulate physics
        self.world.step();

        // Transfer pawn information from rigidbodies
        let mut dirty_pawns: Vec<&Pawn> = vec![];
        for pawn in self.pawns.values_mut() {
            if pawn.selected_user.is_some() { continue; } // Ignore selected pawns

            let rb_handle = pawn.rigid_body.expect("A pawn must have a rigid body handle");
            let rb = self.world.rigid_body_set.get(rb_handle).unwrap();
            pawn.position = Vec3::from(rb.translation());
            pawn.rotation = Vec3::from(rb.rotation());
            if !rb.is_sleeping() && rb.is_moving() {
                dirty_pawns.push(pawn);
            }
        }
        if !dirty_pawns.is_empty() && send_update_pawns {
            // Send update
            return self.users.values().send_event(&Event::UpdatePawns {
                updates: dirty_pawns.iter().map(|p| p.serialize_transform()).collect()
            });
        }
        Ok(())
    }
    pub fn relay_cursors(&self) -> Result<(), Box<dyn Error>> {
        self.users.values().send_event(&Event::RelayCursors {
            cursors: self.users.iter().map(|(k, v)| CursorUpdate {
                id: *k,
                position: v.cursor_position,
            }).collect()
        })
    }
}
