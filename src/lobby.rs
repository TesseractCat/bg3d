use std::collections::HashMap;
use std::sync::atomic::{Ordering, AtomicU64};
use std::error::Error;

use serde::{Serialize, Deserialize};
use tokio::task::JoinHandle;

use crate::user::*;
use crate::physics::*;
use crate::events::*;
use crate::pawn::*;
use crate::{PHYSICS_RATE, PHYSICS_SCALE};

pub struct Asset {
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub name: String,
    pub description: String,
    pub author: String,

    pub rotation_increment: Option<f64>,
}
#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LobbySettings {
    #[serde(default)]
    pub spawn_permission: bool,
    #[serde(default)]
    pub show_card_counts: bool,
    #[serde(default)]
    pub hide_chat: bool,
}
pub struct Lobby {
    pub name: String,
    pub host: UserId,
    pub info: Option<GameInfo>,
    pub settings: LobbySettings,

    pub users: HashMap<UserId, User>, // FIXME: Make these both u16
    pub pawns: HashMap<PawnId, Pawn>,   // - Collision probability?
    pub assets: HashMap<String, Asset>,

    pub world: PhysicsWorld,
    pub physics_handle: Option<JoinHandle<()>>,

    next_user_id: AtomicU64,
}
impl Lobby {
    pub fn new() -> Lobby {
        Lobby {
            name: "".to_string(),
            host: UserId(0),
            info: None,
            settings: Default::default(),

            users: HashMap::new(),
            pawns: HashMap::new(),
            assets: HashMap::new(),

            world: PhysicsWorld::new(PHYSICS_RATE),
            physics_handle: None,

            next_user_id: AtomicU64::new(0),
        }
    }

    pub fn remove_pawn(&mut self, id: PawnId) -> Option<Pawn> {
        // Remove rigidbody first
        if let Some(rb_handle) = self.pawns.get(&id)?.rigid_body {
            self.world.remove_rigidbody(rb_handle);
        }

        let mut pawn = self.pawns.remove(&id)?;
        pawn.rigid_body = None;
        Some(pawn)
    }
    pub fn next_user_id(&self) -> UserId {
        UserId(self.next_user_id.fetch_add(1, Ordering::Relaxed))
    }

    pub fn step(&mut self, send_update_pawns: bool) -> Result<(), Box<dyn Error>> {
        // Simulate physics
        self.world.step();

        // Transfer pawn information from rigidbodies
        let mut dirty_pawns: Vec<&Pawn> = vec![];
        for pawn in self.pawns.values_mut() {
            if pawn.selected_user.is_some() { continue; } // Ignore selected pawns

            let rb_handle = pawn.rigid_body.ok_or("A pawn must have a rigid body handle")?;
            let rb = self.world.rigid_body_set.get(rb_handle).ok_or("Invalid rigidbody handle")?;
            pawn.position = Vec3::from(&(rb.translation()/PHYSICS_SCALE));
            pawn.rotation = Vec3::from(rb.rotation());
            if !rb.is_sleeping() && rb.is_moving() {
                dirty_pawns.push(pawn);
            }
        }
        if !dirty_pawns.is_empty() && send_update_pawns {
            // Send update
            return self.users.values().send_event(&Event::UpdatePawns {
                updates: dirty_pawns.iter().map(|p| p.serialize_transform()).collect(),
                collisions: self.world.get_collisions(),
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
