use mlua::TableExt;
use nalgebra::Quaternion;
use serde::{Serialize, Deserialize};
use rapier3d::prelude::*;

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

#[derive(Clone, Copy, Default, Serialize, Deserialize, Debug)]
pub struct Quat {
        pub x: f64,
        pub y: f64,
        pub z: f64,
        pub w: f64,
}
impl<'lua> mlua::IntoLua<'lua> for Quat {
    fn into_lua(self, lua: &'lua mlua::Lua) -> mlua::Result<mlua::Value<'lua>> {
        lua.globals().get::<_, mlua::Table>("quat")?.call((self.x, self.y, self.z, self.w))
    }
}
impl<'lua> mlua::FromLua<'lua> for Quat {
    fn from_lua(value: mlua::Value<'lua>, _: &'lua mlua::Lua) -> mlua::Result<Self> {
        Ok(if let Some(table) = value.as_table() {
            Self {
                x: table.get("x")?, y: table.get("y")?, z: table.get("z")?, w: table.get("w")?,
            }
        } else {
            Self::default()
        })
    }
}
impl From<&Rotation<f32>> for Quat {
	fn from(v: &Rotation<f32>) -> Self {
		Quat {
			x: v.coords.x as f64,
			y: v.coords.y as f64,
			z: v.coords.z as f64,
			w: v.coords.w as f64,
		}
	}
}
impl From<&Quat> for Rotation<f32> {
	fn from(v: &Quat) -> Self {
        Rotation::from_quaternion(Quaternion::new(v.w as f32, v.x as f32, v.y as f32, v.z as f32))
	}
}