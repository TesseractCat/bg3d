use std::borrow::Cow;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

use crate::user::{User, UserId};
use crate::lobby::{Pawn, PawnUpdate, Vec3, GameInfo, PawnId, LobbySettings};
use crate::physics::CollisionAudioInfo;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CursorUpdate {
    pub id: UserId,
    pub position: Vec3,
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
    Join {},
    #[serde(skip_deserializing)]
    Start {
        id: UserId, host: bool, color: &'a str, info: &'a Option<GameInfo>,
        users: Vec<&'a User>, pawns: Vec<&'a Pawn>
    },
    AssignHost {},
    #[serde(skip_deserializing)]
    Connect { id: UserId, color: &'a str },
    Disconnect { id: UserId },
    Settings(LobbySettings),

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

    // 'Extracting' a pawn and 'taking' a pawn are different
    // because extracting creates a new pawn with a new ID
    ExtractPawns { from_id: PawnId, new_id: PawnId, into_id: Option<UserId>, count: Option<u64> },
    StorePawn { from_id: PawnId, into_id: PawnOrUser },
    TakePawn { from_id: UserId, target_id: PawnId, position_hint: Option<Vec3> },

    RegisterGame(Cow<'a, GameInfo>),
    RegisterAssets { assets: HashMap<String, String> },
    ClearAssets {},

    SendCursor { position: Vec3 },
    RelayCursors { cursors: Vec<CursorUpdate> },

    Chat { id: Option<UserId>, content: Cow<'a, String> },
}
