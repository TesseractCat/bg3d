use std::sync::Arc;

use serde::{Serialize, Deserialize};
use serde_with::skip_serializing_none;
use tokio::time::Instant;
use rapier3d::prelude::*;
use mlua::TableExt;

use crate::user::*;
use crate::math::*;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
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
    Dice { roll_rotations: Vec<Quat> },
    Pawn {},
}
impl<'lua> mlua::FromLua<'lua> for PawnData {
    fn from_lua(value: mlua::Value<'lua>, lua: &'lua mlua::Lua) -> mlua::Result<Self> {
        if let Some(table) = value.as_table() {
            if let Some(mt) = table.get_metatable() {
                let deck_mt = lua.globals().get::<_, mlua::Table>("DeckData")?;
                let snap_point_mt = lua.globals().get::<_, mlua::Table>("SnapPointData")?;
                let container_mt = lua.globals().get::<_, mlua::Table>("ContainerData")?;
                let dice_mt = lua.globals().get::<_, mlua::Table>("DiceData")?;
                if mt == deck_mt {
                    Ok(PawnData::Deck {
                        contents: table.get("contents")?,
                        back: table.get("back")?,
                        side_color: table.get("side_color")?,
                        border: table.get("border")?,
                        corner_radius: table.get("corner_radius")?,
                        card_thickness: table.get("card_thickness")?,
                        size: table.get("size")?
                    })
                } else if mt == snap_point_mt {
                    Ok(PawnData::SnapPoint {
                        radius: table.get("radius")?,
                        size: table.get("size")?,
                        scale: table.get("scale")?,
                        snaps: table.get("snaps")?
                    })
                } else if mt == container_mt {
                    Ok(PawnData::Container {
                        holds: Box::new(table.get("holds")?),
                        capacity: table.get("capacity")?
                    })
                } else if mt == dice_mt {
                    Ok(PawnData::Dice { roll_rotations: table.get("roll_rotations")? })
                } else {
                    Err(mlua::Error::FromLuaConversionError { from: "table", to: "PawnData", message: Some("Invalid PawnData type".to_string()) })
                }
            } else {
                Err(mlua::Error::FromLuaConversionError { from: "table", to: "PawnData", message: Some("Mismatched metatable".to_string()) })
            }
        } else {
            Err(mlua::Error::FromLuaConversionError {
                from: "value", to: "PawnData",
                message: Some(format!("Data type is {}, expected table", value.type_name()))
            })
        }
    }
}
impl TryInto<Collider> for &PawnData {
    type Error = ();

    fn try_into(self) -> Result<Collider, Self::Error> {
        match &self {
            PawnData::Deck { contents, card_thickness, size, .. } => {
                Ok(ColliderBuilder::cuboid(size.x as f32/2.,
                                    ((*card_thickness as f32 * contents.len() as f32 * 1.15)/2.).max(0.03),
                                    size.y as f32/2.)
                    .friction(0.7).mass(0.01)
                    .active_events(ActiveEvents::COLLISION_EVENTS).build())
            },
            _ => Err(())
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug, Default, PartialEq, Eq, Hash)]
pub struct PawnId(pub u64);
// impl mlua::UserData for PawnId { }
// impl<'lua> mlua::FromLua<'lua> for PawnId {
//     fn from_lua(value: mlua::Value<'lua>, _lua: &'lua mlua::Lua) -> mlua::Result<Self> {
//         Ok(*(value.as_userdata().ok_or(mlua::Error::UserDataTypeMismatch)?.borrow()?))
//     }
// }
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
    pub rotation: Quat,
    pub select_rotation: Quat,
    
    #[serde(flatten)]
    pub data: PawnData, // Misc

	#[serde(skip)]
    pub selected_user: Option<UserId>,
	#[serde(skip)]
	pub rigid_body: Option<RigidBodyHandle>,
	#[serde(skip, default = "Instant::now")]
    pub last_updated: Instant,
    #[serde(skip)]
    pub on_grab_callback: Option<Arc<mlua::RegistryKey>>
}
impl PartialEq for Pawn {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id &&
            self.name == other.name && 
            self.mesh == other.mesh &&
            self.tint == other.tint &&
            self.texture == other.texture &&
            self.moveable == other.moveable &&
            self.position == other.position &&
            self.rotation == other.rotation &&
            self.select_rotation == other.select_rotation &&
            self.data == other.data
    }
}
impl<'lua> mlua::FromLua<'lua> for Pawn {
    fn from_lua(value: mlua::Value<'lua>, lua: &'lua mlua::Lua) -> mlua::Result<Self> {
        if let Some(params) = value.as_table() {
            Ok(Pawn {
                id: PawnId(params.get::<_, u64>("id").ok().unwrap_or(0)),
                name: params.get("name").ok(),
                mesh: params.get("mesh").ok(),
                tint: params.get("tint").ok(),
                texture: params.get("texture").ok(),
                moveable: params.get::<_, mlua::Value>("moveable").ok().and_then(|x| x.as_boolean()).unwrap_or(true),
    
                position: params.get("position").ok().unwrap_or_default(),
                rotation: params.get("rotation").ok().unwrap_or_default(),
                select_rotation: params.get("select_rotation").ok().unwrap_or_default(),
    
                selected_user: None,
                data: params.get::<_, Option<PawnData>>("data")?.unwrap_or(PawnData::Pawn { }),
                rigid_body: None,
                last_updated: Instant::now(),

                on_grab_callback: params.get::<_, mlua::Function>("on_grab")
                                        .ok().map(|cb| Arc::new(lua.create_registry_value(cb).unwrap()))
            })
        } else {
            Err(mlua::Error::FromLuaConversionError { from: "table", to: "Pawn", message: None })
        }
    }
}
impl<'lua> mlua::IntoLua<'lua> for Pawn {
    fn into_lua(self, lua: &'lua mlua::Lua) -> mlua::Result<mlua::Value<'lua>> {
        let table = lua.create_table()?;
        table.set("id", self.id.0)?;
        table.set("name", self.name)?;
        table.set("mesh", self.mesh)?;
        table.set("tint", self.tint)?;
        table.set("texture", self.texture)?;

        table.set("moveable", self.moveable)?;
        table.set("position", self.position)?;
        table.set("rotation", self.rotation)?;
        table.set("select_rotation", self.select_rotation)?;

        //table.set("data", self.data)?;

        let pawn_table = lua.globals().get::<_, mlua::Table>("Pawn")?;
        pawn_table.get::<_, mlua::Function>("new")?.call((pawn_table, table))
    }
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
    pub rotation: Option<Quat>,
    pub selected: Option<bool>,
    pub select_rotation: Option<Quat>,
    
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
    pub fn patch(&mut self, mut update: PawnUpdate, user: Option<UserId>) -> PawnUpdate {
        let mut diff = PawnUpdate::default();
        diff.id = update.id;
        macro_rules! p {
            (option: $name:ident) => {
                update.$name.take_if(|v| self.$name.as_ref() != Some(v)).map(|v| {
                    self.$name = Some(v.clone());
                    diff.$name = Some(v);
                });
            };
            ($name:ident) => {
                update.$name.take_if(|v| self.$name != *v).map(|v| {
                    self.$name = v.clone();
                    diff.$name = Some(v);
                });
            }
        }
        p!(option: name);
        p!(option: mesh);
        p!(option: tint);
        p!(moveable);
        p!(position);
        p!(rotation);
        p!(select_rotation);
        p!(data);
        if let Some(user) = user {
            if let Some(selected) = update.selected {
                update.selected.take_if(|_|
                    (selected && self.selected_user != Some(user)) || (!selected && self.selected_user.is_some())
                ).map(|v| {
                    self.selected_user = if v { Some(user) } else { None };
                    diff.selected = Some(v);
                });
            }
        }
        diff
    }
    pub fn flipped(&self) -> bool {
        (self.select_rotation.x - std::f64::consts::PI).abs() < 0.01
    }
}