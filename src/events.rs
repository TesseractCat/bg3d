use std::borrow::Cow;
use serde::{Serialize, Deserialize};
use serde_json::Value;

use crate::user::User;
use crate::lobby::{Pawn, PawnUpdate, Vec3};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CursorUpdate {
    pub id: usize,
    pub position: Vec3,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event<'a> {
    Join {},
    #[serde(skip_deserializing)]
    Start { id: usize, host: bool, color: &'a str, users: Vec<&'a User>, pawns: Vec<&'a Pawn> },
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
        updates: Vec<PawnUpdate>
    },

    RegisterAsset { name: String, data: String },
    ClearAssets {},

    SendCursor { position: Vec3 },
    RelayCursors { cursors: Vec<CursorUpdate> },

    Event { target: bool, #[serde(flatten)] data: Value },
    EventCallback { receiver: usize, #[serde(flatten)] data: Value },
}
