use serde::{Serialize, Deserialize};
use serde_with::skip_serializing_none;
use tokio::time::Instant;
use rapier3d::prelude::*;
use mlua::TableExt;

use crate::user::*;

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
impl<'lua> mlua::IntoLua<'lua> for Vec3 {
    fn into_lua(self, lua: &'lua mlua::Lua) -> mlua::Result<mlua::Value<'lua>> {
        lua.globals().get::<_, mlua::Table>("vec3")?.call((self.x, self.y, self.z))
    }
}
impl<'lua> mlua::FromLua<'lua> for Vec3 {
    fn from_lua(value: mlua::Value<'lua>, _: &'lua mlua::Lua) -> mlua::Result<Self> {
        Ok(if let Some(table) = value.as_table() {
            Self { x: table.get("x")?, y: table.get("y")?, z: table.get("z")? }
        } else {
            Self::default()
        })
    }
}

#[derive(Clone, Copy, Default, Serialize, Deserialize, Debug)]
pub struct Vec2 {
        pub x: f64,
        pub y: f64,
}
impl<'lua> mlua::IntoLua<'lua> for Vec2 {
    fn into_lua(self, lua: &'lua mlua::Lua) -> mlua::Result<mlua::Value<'lua>> {
        lua.globals().get::<_, mlua::Table>("vec2")?.call((self.x, self.y))
    }
}
impl<'lua> mlua::FromLua<'lua> for Vec2 {
    fn from_lua(value: mlua::Value<'lua>, _: &'lua mlua::Lua) -> mlua::Result<Self> {
        Ok(if let Some(table) = value.as_table() {
            Self { x: table.get("x")?, y: table.get("y")? }
        } else {
            Self::default()
        })
    }
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
impl<'lua> mlua::FromLua<'lua> for Pawn {
    fn from_lua(value: mlua::Value<'lua>, _lua: &'lua mlua::Lua) -> mlua::Result<Self> {
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
                last_updated: Instant::now()
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
        table.set_metatable(lua.globals().get("Pawn")?);
        Ok(mlua::Value::Table(table))
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