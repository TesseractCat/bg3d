use serde::{Serialize, Deserialize};
use serde_with::skip_serializing_none;
use tokio::time::Instant;
use rapier3d::prelude::*;

use crate::user::*;
use crate::PHYSICS_SCALE;

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

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "class", content = "data")]
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
impl TryInto<Collider> for &PawnData {
    type Error = ();

    fn try_into(self) -> Result<Collider, Self::Error> {
        match &self {
            PawnData::Deck { contents, card_thickness, size, .. } => {
                Ok(ColliderBuilder::cuboid((size.x/2.) as f32 * PHYSICS_SCALE,
                                    ((*card_thickness * contents.len() as f64 * 1.15)/2.).max(0.03) as f32 * PHYSICS_SCALE,
                                    (size.y/2.) as f32 * PHYSICS_SCALE)
                    .friction(0.7).active_events(ActiveEvents::COLLISION_EVENTS).mass(0.01).build())
            },
            _ => Err(())
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug, Default, PartialEq, Eq, Hash)]
pub struct PawnId(u64);
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pawn {
    pub id: PawnId, // Identifiers
    
    pub name: Option<String>, // Immutable Properties
    pub mesh: Option<String>,
    pub tint: Option<u64>,
    pub texture: Option<String>,

    pub moveable: bool, // Physics properties
    
    pub position: Vec3, // Mutable Properties
    pub rotation: Vec3,
    pub select_rotation: Vec3,
    
    #[serde(flatten)]
    pub data: PawnData, // Misc

	#[serde(skip)]
    pub selected_user: Option<UserId>,
	#[serde(skip)]
	pub rigid_body: Option<RigidBodyHandle>,
	#[serde(skip, default = "Instant::now")]
    pub last_updated: Instant,
}
#[skip_serializing_none]
#[derive(Clone, Default, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PawnUpdate {
    pub id: PawnId,
    
    pub name: Option<String>,
    pub mesh: Option<String>,
    pub tint: Option<u64>,

    pub moveable: Option<bool>,
    
    pub position: Option<Vec3>,
    pub rotation: Option<Vec3>,
    pub selected: Option<bool>,
    pub select_rotation: Option<Vec3>,
    
    #[serde(flatten)]
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
        update.moveable.map(|v| self.moveable = v);
        if self.moveable {
            update.position.map(|v| self.position = v);
            update.rotation.map(|v| self.rotation = v);
            update.select_rotation.map(|v| self.select_rotation = v);
        }
    }
    pub fn flipped(&self) -> bool {
        (self.select_rotation.x - std::f64::consts::PI).abs() < 0.01
    }
}