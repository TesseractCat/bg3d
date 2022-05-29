use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use rapier3d::prelude::*;

use crate::user::*;

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
    Cylinder { radius_top: f64, radius_bottom: f64, height: f64, num_segments: u64 },
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
    
    pub data: PawnData, // Misc

	#[serde(skip)]
	pub rigid_body: Option<RigidBodyHandle>,
}

pub struct PhysicsWorld {
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,
    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline: PhysicsPipeline,
    pub island_manager: IslandManager,
    pub broad_phase: BroadPhase,
    pub narrow_phase: NarrowPhase,
    pub joint_set: JointSet,
    pub ccd_solver: CCDSolver,
}
impl PhysicsWorld {
    pub fn new(dt: f32) -> PhysicsWorld {
        let mut w = PhysicsWorld {
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),
            integration_parameters: IntegrationParameters {
                dt: dt,
                ..Default::default()
            },
            physics_pipeline: PhysicsPipeline::new(),
            island_manager: IslandManager::new(),
            broad_phase: BroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            joint_set: JointSet::new(),
            ccd_solver: CCDSolver::new(),
        };
		
		w.collider_set.insert(ColliderBuilder::cuboid(1000.0, 0.5, 1000.0).translation(vector![0.0, -0.5, 0.0]).build());
		
		return w;
    }
    pub fn step(&mut self) {
        self.physics_pipeline.step(
            &vector![0.0, -15.0, 0.0],
            &self.integration_parameters,
			&mut self.island_manager,
			&mut self.broad_phase,
			&mut self.narrow_phase,
			&mut self.rigid_body_set,
			&mut self.collider_set,
			&mut self.joint_set,
			&mut self.ccd_solver,
			&(),
			&(),
        );
    }
}

pub struct Lobby {
    pub name: String,
    pub host: usize,
    pub world: PhysicsWorld,
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
            world: PhysicsWorld::new(50.0/1000.0),
        }
    }
}
