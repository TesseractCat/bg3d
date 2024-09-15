use std::borrow::Cow;
use std::collections::HashMap;
use indexmap::IndexMap;
use serde::{Serialize, Deserialize};

use crate::user::{User, UserId};
use crate::pawn::{Pawn, PawnUpdate, PawnId};
use crate::math::Vec3;
use crate::lobby::{GameInfo, LobbySettings};
use crate::physics::CollisionAudioInfo;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct UserStatusUpdate {
    pub id: UserId,

    pub cursor: Vec3,
    pub head: Vec3,
    pub look: Vec3
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "id", rename_all = "snake_case")]
pub enum PawnOrUser {
    Pawn(PawnId),
    User(UserId)
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event<'a> {
    Join { referrer: &'a str },
    #[serde(skip_deserializing)]
    Start {
        id: UserId, host: UserId, color: &'a str, info: &'a Option<GameInfo>, settings: &'a LobbySettings,
        users: Vec<&'a User>, pawns: Vec<&'a Pawn>, registered_pawns: &'a IndexMap<String, Vec<Pawn>>
    },
    AssignHost { id: UserId },
    #[serde(skip_deserializing)]
    Connect { id: UserId, color: &'a str },
    Disconnect { id: UserId },
    Settings(Cow<'a, LobbySettings>),

    RegisterGame { info: Cow<'a, GameInfo>, assets: HashMap<String, String> },
    RegisterPawn { path: &'a str, pawn: Cow<'a, Pawn> },

    Ping { idx: u64 },
    Pong { idx: u64 },

    AddPawn { pawn: Cow<'a, Pawn> }, // Serde always deserializes Cows as Owned
    RemovePawns {
        #[serde(rename = "pawns")]
        ids: Vec<PawnId>
    },
    ClearPawns {},
    UpdatePawns {
        #[serde(rename = "pawns")]
        updates: Vec<PawnUpdate>,
        #[serde(skip_serializing_if = "Option::is_none")]
        collisions: Option<Vec<CollisionAudioInfo>>,
    },
    AddPawnToHand { pawn: Cow<'a, Pawn> },
    HandCount { id: UserId, count: u64 },

    // 'Extracting' a pawn and 'taking' a pawn are different
    // because extracting creates a new pawn with a new ID
    ExtractPawns { from_id: PawnId, new_id: PawnId, into_id: Option<UserId>, count: Option<u64> },
    StorePawn { from_id: PawnId, into_id: PawnOrUser },
    TakePawn { from_id: UserId, target_id: PawnId, position_hint: Option<Vec3> },

    UpdateUserStatuses { updates: Vec<UserStatusUpdate> },

    Chat { id: Option<UserId>, content: Cow<'a, String> },
}
