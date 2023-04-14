use std::borrow::Cow;
use serde::{Serialize, Deserialize};
use serde_json::Value;

use crate::user::User;
use crate::lobby::{Pawn, PawnUpdate, Vec3, GameInfo};
use crate::physics::CollisionAudioInfo;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CursorUpdate {
    pub id: usize,
    pub position: Vec3,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PawnEvent {
    InsertItem,
    GrabItem,
    Remove,

    Insert { top: bool, contents: Vec<String> },
    GrabCards { count: Option<usize> },
    Deal,
    Shuffle,

    #[serde(skip_deserializing)]
    Callback,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event<'a> {
    Join {},
    #[serde(skip_deserializing)]
    Start {
        id: usize, host: bool, color: &'a str, info: &'a Option<GameInfo>,
        users: Vec<&'a User>, pawns: Vec<&'a Pawn>
    },
    AssignHost {},
    #[serde(skip_deserializing)]
    Connect { id: usize, color: &'a str },
    Disconnect { id: usize },

    Ping { idx: u64 },
    Pong { idx: u64 },

    AddPawn { pawn: Cow<'a, Pawn> }, // Serde always deserializes Cows as Owned
    RemovePawns {
        #[serde(rename = "pawns")]
        ids: Vec<u64>
    },
    ClearPawns {},
    UpdatePawns {
        #[serde(rename = "pawns")]
        updates: Vec<PawnUpdate>,
        #[serde(skip_serializing_if = "Option::is_none")]
        collisions: Option<Vec<CollisionAudioInfo>>,
    },

    ExtractPawns { from_id: u64, to_id: u64, count: Option<u64> },
    MergePawns { from_id: u64, into_id: u64 },

    RegisterGame(Cow<'a, GameInfo>),
    RegisterAsset { name: String, data: String, last: bool },
    ClearAssets {},

    SendCursor { position: Vec3 },
    RelayCursors { cursors: Vec<CursorUpdate> },

    Chat { id: Option<usize>, content: Cow<'a, String> },

    PawnEvent { id: u64, target_host: bool, data: PawnEvent },
}
