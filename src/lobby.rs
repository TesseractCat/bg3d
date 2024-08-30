use std::borrow::Cow;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{Ordering, AtomicU64};
use std::error::Error;
use data_url::DataUrl;
use tokio::time::Instant;

use gltf::Gltf;
use rapier3d::prelude::*;
use rapier3d::dynamics::{RigidBodyBuilder, RigidBodyType};
use rapier3d::geometry::{Collider, ColliderHandle};
use rapier3d::math::{Rotation, Vector};
use rapier3d::pipeline::ActiveEvents;
use serde::{Serialize, Deserialize};

use mlua::{FromLua, HookTriggers, IntoLua, Lua};

use crate::gltf_ext::GltfExt;
use crate::user::*;
use crate::physics::*;
use crate::events::*;
use crate::pawn::*;
use crate::PHYSICS_RATE;

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
    pub start_time: Instant,

    pub users: HashMap<UserId, User>, // FIXME: Make these both u16
    pub pawns: HashMap<PawnId, Pawn>,   // - Collision probability?
    pub assets: HashMap<String, Asset>,

    pub world: PhysicsWorld,
    pub abort_token: Option<bool>,

    pub lua: Option<Lua>,

    next_user_id: AtomicU64,
    next_pawn_id: AtomicU64,
}

impl Lobby {
    pub fn new() -> Lobby {
        let lua = Lua::new_with(
            mlua::StdLib::MATH | mlua::StdLib::TABLE | mlua::StdLib::STRING,
            mlua::LuaOptions::new()
        ).unwrap();
        lua.set_memory_limit(1 << 18).expect("Failed to set memory limit for lua VM");

        // https://github.com/kikito/lua-sandbox/blob/master/sandbox.lua
        const ALLOWED_GLOBALS: [&str; 21] = [
            "_G", "_VERSION", "assert", "error",    "ipairs",   "next", "pairs",
            "pcall",    "select", "tonumber", "tostring", "type", "unpack", "xpcall",
            "math", "table", "string", // Libraries
            "setmetatable", "getmetatable", "rawget", "rawset" // FIXME: Can modify protected metatables, sandbox break?
        ];
        for pair in lua.globals().pairs::<mlua::Value, mlua::Value>() {
            let pair = pair.expect("Failed while cleaning globals");
            let key = pair.0.as_str().expect("Failed while cleaning globals");
            if !ALLOWED_GLOBALS.contains(&key) {
                lua.globals().raw_set(key, mlua::Value::Nil).expect("Failed while cleaning globals");
            }
        }

        lua.globals().set("game", lua.create_table().unwrap()).expect("Failed while initializing globals");

        lua.globals().set("require", lua.create_function(|lua, path: String| {
            let text = match path.as_str() {
                "math" => include_str!("math.lua"),
                "prelude" => include_str!("prelude.lua"),
                _ => panic!("Attempted to require undefined library '{}' during lua startup", path),
            };
            lua.load(text).eval::<mlua::Value>()
        }).expect("Failed while initializing globals")).expect("Failed while initializing globals");
        lua.load("require(\"prelude\")").exec().expect("Error in lua prelude");

        Lobby {
            name: "".to_string(),
            host: UserId(0),
            info: None,
            settings: Default::default(),
            start_time: Instant::now(),

            users: HashMap::new(),
            pawns: HashMap::new(),
            assets: HashMap::new(),

            world: PhysicsWorld::new(PHYSICS_RATE),
            abort_token: None,

            lua: Some(lua),

            next_user_id: AtomicU64::new(1),
            next_pawn_id: AtomicU64::new(1),
        }
    }

    pub fn next_user_id(&self) -> UserId {
        UserId(self.next_user_id.fetch_add(1, Ordering::Relaxed))
    }
    pub fn next_pawn_id(&self) -> PawnId {
        PawnId(self.next_pawn_id.fetch_add(1, Ordering::Relaxed))
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
            pawn.position = Vec3::from(rb.translation());
            pawn.rotation = Vec3::from(rb.rotation());
            if !rb.is_sleeping() && rb.is_moving() {
                dirty_pawns.push(pawn);
            }
        }
        if !dirty_pawns.is_empty() && send_update_pawns {
            // Send update
            return self.users.values().send_event(&Event::UpdatePawns {
                updates: dirty_pawns.iter().map(|p| p.serialize_transform()).collect(),
                collisions: None,
            });
        }

        // Lua callback
        if let Err(e) = self.lua_scope(|lua, _scope, _| {
            if let Some(res) = Self::run_lua_callback(lua, "physics", ()) {
                res?;
            }
            Ok(())
        }) {
            self.system_chat(Cow::Owned(format!("Lua error: `{}`", e)))?;
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

    // Cursed lifetime workaround, third argument to FnOnce is just to imply lifetime bounds :|
    // this solution was discovered in the #dark-arts channel on the Rust discord
    // Minimal repro: https://play.rust-lang.org/?version=stable&mode=debug&edition=2021&gist=42c572f9b964787146018dcbe664741b
    pub fn lua_scope<'a, R, F>(&mut self, f: F) -> Result<R, mlua::Error>
    where
        F: for<'lua, 'scope> FnOnce(&mlua::Lua, &mlua::Scope<'lua, 'scope>, &'lua &'a ()) -> Result<R, mlua::Error>,
    {
        let lua = self.lua.take().expect("Triggered lua callback inside another lua callback");

        lua.set_hook(HookTriggers::new().every_nth_instruction(1 << 14), |_lua, _debug| {
            Err(mlua::Error::SafetyError("Exceeded execution limit".to_string()))
        });

        let result = lua.scope(|scope: &mlua::Scope| {
            let ud = scope.create_userdata_ref_mut(self).expect("Failed to create UserData from lobby");
            lua.globals().raw_set("lobby", ud).expect("Failed to set lobby UserData");

            f(&lua, scope, &&())
        });

        self.lua = Some(lua);

        result
    }
    fn run_lua_callback<'lua, R: mlua::FromLuaMulti<'lua>, A: mlua::IntoLuaMulti<'lua>>(lua: &'lua Lua, callback_name: &str, args: A) -> Option<mlua::Result<R>> {
        if let Some(game) = lua.globals().get::<_, mlua::Table>("game").ok() {
            if let Some(callback) = game.get::<_, mlua::Function>(callback_name).ok() {
                Some(callback.call(args))
            } else {
                None
            }
        } else {
            None
        }
    }
}
impl mlua::UserData for Lobby {
    fn add_methods<'lua, M: mlua::UserDataMethods<'lua, Self>>(methods: &mut M) {
        macro_rules! method {
            ($name:tt: |$this:ident, $lua:ident, $($argname:ident : $argtype:ty),+| $method:expr) => {
                #[allow(unused_parens)]
                methods.add_method_mut(stringify!($name), |$lua, $this: &mut Self, ($($argname),+): ($($argtype),+)| {
                    (|| -> Result<_, Box<dyn Error>> {
                        $method
                    })().map_err(|e| mlua::Error::RuntimeError(format!("Error occurred in Rust callback [{}]: {}", stringify!($name), e)))
                })
            };
            ($name:tt: |$this:ident, $lua:ident| $method:expr) => {
                methods.add_method_mut(stringify!($name), |$lua, $this: &mut Self, _: ()| {
                    (|| -> Result<_, Box<dyn Error>> {
                        $method
                    })().map_err(|e| mlua::Error::RuntimeError(format!("Error occurred in Rust callback [{}]: {}", stringify!($name), e)))
                })
            };
        }
        method!(name: |this, _lua| {
            Ok(this.name.clone())
        });
        method!(time: |this, _lua| {
            Ok((Instant::now() - this.start_time).as_secs_f32())
        });
        method!(system_chat: |this, _lua, message: String| {
            this.system_chat(Cow::Owned(message))?;
            Ok(())
        });
        method!(send_chat: |this, _lua, user_id: u64, message: String| {
            this.chat(UserId(user_id), Cow::Owned(message))?;
            Ok(())
        });
        method!(create_pawn: |this, lua, params: mlua::Table| {
            let id = this.next_pawn_id();

            let mut pawn = Pawn::from_lua(mlua::Value::Table(params), lua)?;
            pawn.id = id;
            this.add_pawn(Cow::Owned(pawn.clone()))?;

            Ok(pawn)
        });
        method!(update_pawn: |this, lua, params: mlua::Table| {
            let update = PawnUpdate {
                id: PawnId(params.get("id").unwrap()),
                name: params.get("name").ok(),
                mesh: params.get("mesh").ok(),
                tint: params.get("tint").ok(),
                moveable: params.get::<_, mlua::Value>("moveable").ok().and_then(|x| x.as_boolean()),

                position: params.get("position").ok(),
                rotation: params.get("rotation").ok(),
                select_rotation: params.get("select_rotation").ok(),

                selected: None,
                data: params.get("data").ok()
            };
            this.update_pawns(None, Vec::from([update]))?;
            Ok(())
        });
        method!(get_pawn: |this, lua, id: u64, key: String| {
            let pawn = this.pawns.get(&PawnId(id)).unwrap();
            Ok::<mlua::Value, _>(match key.as_str() {
                "name" => pawn.name.clone().into_lua(lua)?,
                "moveable" => pawn.moveable.into_lua(lua)?,

                "position" => pawn.position.into_lua(lua)?,
                "rotation" => pawn.rotation.into_lua(lua)?,
                "select_rotation" => pawn.select_rotation.into_lua(lua)?,
                _ => mlua::Value::Nil
            })
        });
        method!(destroy_pawn: |this, _lua, id: u64| {
            this.remove_pawns(Vec::from([PawnId(id)]))?;
            Ok(())
        });
    }
}

impl Lobby {
    // -- CHAT EVENTS --

    pub fn chat(&mut self, user_id: UserId, content: Cow<'_, String>) -> Result<(), Box<dyn Error>> {
        self.users.values().send_event(&Event::Chat {
            id: Some(user_id),
            content: Cow::Borrowed(&content)
        })?;
        if let Err(e) = self.lua_scope(|lua, scope, _| {
            if let Some(res) = Self::run_lua_callback(lua, "chat", (user_id.0, content.into_owned())) {
                res?;
            }
            Ok(())
        }) {
            self.system_chat(Cow::Owned(format!("Lua error: `{}`", e)))?;
        }
        Ok(())
    }
    pub fn system_chat(&self, content: Cow<'_, String>) -> Result<(), Box<dyn Error>> {
        self.users.values().send_event(&Event::Chat {
            id: Some(UserId(0)),
            content: Cow::Borrowed(&content)
        })
    }

    // -- PAWN EVENTS --

    pub fn add_pawn(&mut self, mut pawn: Cow<'_, Pawn>) -> Result<(), Box<dyn Error>> {
        if self.pawns.len() >= 1024 { return Err("Failed to add pawn".into()); }

        if self.pawns.get(&pawn.id).is_some() { return Err("Pawn ID collision".into()); }
        
        // Deserialize collider
        // FIXME: Only enable CCD on cards/thin geometry?
        let rigid_body = if pawn.moveable { RigidBodyBuilder::dynamic() } else { RigidBodyBuilder::fixed() }
            .translation(Vector::from(&pawn.position))
            .rotation(Rotation::from(&pawn.rotation).scaled_axis())
            .linear_damping(1.0).angular_damping(0.5)
            .ccd_enabled(/*matches!(pawn.data, PawnData::Deck { .. }) ||*/true) // Enable CCD on everything for now...
            .build();
        pawn.to_mut().rigid_body = Some(self.world.rigid_body_set.insert(rigid_body));

        let colliders: Box<dyn Iterator<Item = Collider>> = match &pawn.data {
            PawnData::Deck { .. } => {
                Box::new(std::iter::once((&pawn.data).try_into().unwrap()))
            },
            _ => {
                if let Some(mesh) = pawn.mesh.as_ref() {
                    let static_path = Path::new("./static/games").canonicalize()?;
                    let path = static_path.join(Path::new(mesh)).canonicalize();

                    let gltf: Option<Gltf> = if let Ok(path) = path {
                        if path.starts_with(static_path) { Gltf::open(path).ok() } else { None }
                    } else if let Some(asset) = self.assets.get(&format!("/{}", mesh)) {
                        Gltf::from_slice(asset.data.as_slice()).ok()
                    } else { None };

                    if let Some(gltf) = gltf {
                        Box::new(gltf.colliders().map(|collider| {
                            collider
                                .friction(0.7).mass(0.01)
                                .active_events(ActiveEvents::COLLISION_EVENTS).build()
                        }))
                    } else {
                        Box::new(std::iter::empty())
                    }
                } else {
                    Box::new(std::iter::empty())
                }
            }
        };
        for collider in colliders {
            self.world.insert_with_parent(collider, pawn.rigid_body.ok_or("Pawn missing rigidbody")?);
        }

        // Tell other users that this was added
        self.users.values().send_event(&Event::AddPawn { pawn: Cow::Borrowed(&pawn) })?;
        
        // Add pawn to lobby
        self.pawns.insert(pawn.id, pawn.into_owned());

        Ok(())
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
    pub fn remove_pawns(&mut self, pawn_ids: Vec<PawnId>) -> Result<(), Box<dyn Error>> {
        // Remove pawn from lobby
        for id in &pawn_ids {
            self.remove_pawn(*id);
        }
        
        self.users.values().send_event(&Event::RemovePawns { ids: pawn_ids })
    }
    pub fn clear_pawns(&mut self) -> Result<(), Box<dyn Error>> {
        // Remove pawn rigidbodies from lobby
        for (id, _) in self.pawns.iter() {
            let rb_handle = self.pawns
                                            .get(&id).ok_or("Trying to remove missing pawn")?
                                            .rigid_body.ok_or("Pawn missing rigidbody")?;
            self.world.remove_rigidbody(rb_handle);
        }
        self.pawns = HashMap::new();

        for user in self.users.values_mut() {
            user.hand = HashMap::new();
        }
        for &id in self.users.keys() {
            self.users.values().send_event(&Event::HandCount { id, count: 0 })?;
        }
        
        self.users.values().send_event(&Event::ClearPawns {})
    }
    pub fn update_pawns(&mut self, user_id: Option<UserId>, mut updates: Vec<PawnUpdate>) -> Result<(), Box<dyn Error>> {
        // Iterate through and update pawns, sanitize updates when relaying:
        //  - Discard updates updating invalid pawns, non-owned pawns
        //  - Discard position and rotation changes on updates to immovable pawns
        updates = updates.into_iter().map(|mut update| {
            let pawn_id = update.id;
            let pawn: &mut Pawn = self.pawns.get_mut(&pawn_id).ok_or("Trying to update invalid pawn")?;

            if let Some(user_id) = user_id {
                match pawn.selected_user {
                    Some(selected_user_id) if selected_user_id != user_id => {
                        return Err("User trying to update non-owned pawn".into());
                    },
                    _ => {},
                };
            }

            if !pawn.moveable {
                update.position = None;
                update.rotation = None;
                update.select_rotation = None;
            }
            
            // Update struct values
            pawn.patch(&update);
            if let Some(user_id) = user_id {
                pawn.selected_user = if update.selected.unwrap_or(true) {
                    Some(user_id)
                } else {
                    None
                };
            }
            
            // Update physics
            if let Some(PawnData::Deck { .. }) = &update.data {
                let collider_handles: Vec<ColliderHandle> = {
                    let rb_handle = pawn.rigid_body.ok_or("Pawn missing rigidbody")?;
                    let rb = self.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
                    rb.colliders().iter().map(|h| *h).collect()
                };
                for handle in collider_handles {
                    self.world.remove_collider(handle);
                }

                self.world.insert_with_parent((update.data.as_ref().unwrap()).try_into().unwrap(),
                                            pawn.rigid_body.ok_or("Pawn missing rigidbody")?);
            }
            if pawn.moveable {
                let rb_handle = pawn.rigid_body.ok_or("Pawn missing rigidbody")?;
                let rb = self.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
                // Don't simulate selected pawns
                rb.set_body_type(if pawn.selected_user.is_none() {
                    RigidBodyType::Dynamic
                } else {
                    RigidBodyType::KinematicPositionBased
                }, true);
                for collider_handle in rb.colliders().iter() {
                    let collider = self.world.collider_set.get_mut(*collider_handle).ok_or("Invalid collider handle")?;
                    collider.set_sensor(pawn.selected_user.is_some());
                }
                // Update position and velocity
                if update.position.is_some() || update.rotation.is_some() {
                    let old_position: &Vector<f32> = rb.translation();
                    let position: Vector<f32> = Vector::from(&pawn.position);

                    let rotation: Rotation<f32> = Rotation::from(&pawn.rotation);
                    let time_difference = (Instant::now() - pawn.last_updated).as_secs_f32();
                    let velocity: Vector<f32> = (position - old_position)/time_difference.max(1.0/20.0);

                    let wake = true;
                    rb.set_translation(position, wake);
                    rb.set_rotation(rotation, wake);
                    rb.set_linvel(velocity, wake);
                    rb.set_angvel(vector![0.0, 0.0, 0.0], wake);
                }
            }

            // Refresh last updated
            pawn.last_updated = Instant::now();

            Ok(update)
        }).collect::<Result<Vec<_>, Box<dyn Error>>>()?;
        
        // Relay to other users that these pawns were changed
        self.users.values()
            .filter(|u| !user_id.is_some_and(|user_id| u.id == user_id))
            .send_event(&Event::UpdatePawns { updates, collisions: None })
    }
    pub fn extract_pawns(&mut self, user_id: UserId, from_id: PawnId, new_id: PawnId, into_id: Option<UserId>, count: Option<u64>) -> Result<(), Box<dyn Error>> {
        if self.pawns.contains_key(&new_id) { return Err("Attempting to extract with existing ID".into()); }

        let from = self.pawns.get_mut(&from_id).ok_or("Trying to extract from missing pawn")?;

        let flipped = from.flipped();
        let to = match &mut from.data {
            PawnData::Container { holds, capacity } => {
                if *capacity == Some(0) {
                    Err::<Pawn, Box<dyn Error>>("Trying to extract from empty container".into())
                } else {
                    if let Some(c) = *capacity {
                        capacity.replace(c - 1);
                    }
                    let mut to = *holds.clone();
                    to.rigid_body = None;
                    to.id = new_id;
                    to.position = from.position.clone();
                    to.position.y += 3.0;
                    Ok(to)
                }
            },
            PawnData::Deck { contents: from_contents, .. } => {
                let count = count.map(|x| x.max(1)).unwrap_or(1) as usize;
                if from_contents.len() <= count {
                    Err("Trying to extract too many cards from deck".into())
                } else {
                    let new_contents: Vec<String> = from_contents.drain(if flipped {
                        (from_contents.len() - count)..from_contents.len()
                    } else {
                        0..count
                    }).collect();

                    // Update from's collider
                    {
                        let collider_handles: Vec<ColliderHandle> = {
                            let rb_handle = from.rigid_body.ok_or("Pawn missing rigidbody")?;
                            let rb = self.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
                            rb.colliders().iter().map(|h| *h).collect()
                        };
                        for handle in collider_handles {
                            self.world.remove_collider(handle);
                        }
        
                        self.world.insert_with_parent((&from.data).try_into().unwrap(),
                                                    from.rigid_body.ok_or("Pawn missing rigidbody")?);
                    }

                    let mut to = from.clone();
                    to.rigid_body = None;
                    to.id = new_id;
                    to.position = from.position.clone();
                    to.position.y += 1.0;
                    if let PawnData::Deck { contents: to_contents, .. } = &mut to.data {
                        *to_contents = new_contents;
                    }
                    Ok(to)
                }
            },
            _ => Err("Trying to extract from non-container pawn".into()),
        }?;

        self.users.values().send_event(&Event::UpdatePawns {
            updates: vec![PawnUpdate {
                id: from.id,
                data: Some(from.data.clone()),
                ..Default::default()
            }],
            collisions: None
        })?;

        match into_id {
            Some(into_id) => {
                self.pawns.insert(new_id, to);
                self.store_pawn(new_id, PawnOrUser::User(into_id))
            },
            None => self.add_pawn(Cow::Owned(to)),
        }
    }
    pub fn store_pawn(&mut self, from_id: PawnId, into_id: PawnOrUser) -> Result<(), Box<dyn Error>> {
        if !match into_id {
            PawnOrUser::User(id) => self.pawns.contains_key(&from_id) && self.users.contains_key(&id),
            PawnOrUser::Pawn(id) => self.pawns.contains_key(&from_id) && self.pawns.contains_key(&id),
        } {
            // Bail out early
            return Err("From/into pawn missing when merging".into());
        }

        let from = self.remove_pawn(from_id).unwrap();
        match into_id {
            PawnOrUser::Pawn(into_id) => {
                let into = self.pawns.get_mut(&into_id).unwrap();

                let flipped = into.flipped();
                match &mut into.data {
                    PawnData::Container { capacity, .. } => {
                        if let Some(c) = *capacity {
                            capacity.replace(c + 1);
                        }
                        Ok::<(), Box<dyn Error>>(())
                    },
                    PawnData::Deck { contents: into_contents, .. } => {
                        if let PawnData::Deck { contents: mut from_contents, ..} = from.data {
                            if flipped {
                                into_contents.append(&mut from_contents);
                            } else {
                                from_contents.append(into_contents);
                                *into_contents = from_contents;
                            }

                            // Update into's collider
                            {
                                let collider_handles: Vec<ColliderHandle> = {
                                    let rb_handle = into.rigid_body.ok_or("Pawn missing rigidbody")?;
                                    let rb = self.world.rigid_body_set.get_mut(rb_handle).ok_or("Rigidbody handle invalid")?;
                                    rb.colliders().iter().map(|h| *h).collect()
                                };
                                for handle in collider_handles {
                                    self.world.remove_collider(handle);
                                }
                
                                self.world.insert_with_parent((&into.data).try_into().unwrap(),
                                                            into.rigid_body.ok_or("Pawn missing rigidbody")?);
                            }
                        }
                        Ok(())
                    },
                    _ => Err("Trying to merge into non-container pawn".into()),
                }?;

                self.users.values().send_event(&Event::UpdatePawns {
                    updates: vec![PawnUpdate {
                        id: into.id,
                        data: Some(into.data.clone()),
                        ..Default::default()
                    }],
                    collisions: None
                })?;
            },
            PawnOrUser::User(into_id) => {
                let into = self.users.get_mut(&into_id).unwrap();
                into.hand.insert(from_id, from);

                into.send_event(&Event::AddPawnToHand {
                    pawn: Cow::Borrowed(into.hand.get(&from_id).unwrap())
                })?;

                if self.settings.show_card_counts {
                    let count = into.hand.len() as u64;
                    self.users.values().send_event(&Event::HandCount {
                        id: into_id, count
                    })?;
                }
            }
        }
        self.users.values().send_event(&Event::RemovePawns { ids: vec![from_id] })
    }
    pub fn take_pawn(&mut self, user_id: UserId, from_id: UserId, target_id: PawnId, position_hint: Option<Vec3>) -> Result<(), Box<dyn Error>> {
        if user_id != from_id { return Err("Attempting to take pawn from non-self user".into()); }

        let mut taken_pawn = self.users
                            .get_mut(&from_id)
                            .ok_or("Lobby missing user")?.hand
                            .remove(&target_id).ok_or("User doesn't have requested pawn")?;

        if self.settings.show_card_counts {
            let count = self.users.get_mut(&from_id).unwrap().hand.len() as u64;
            self.users.values().send_event(&Event::HandCount {
                id: from_id, count
            })?;
        }
        
        if let Some(position_hint) = position_hint {
            taken_pawn.position = position_hint;
        }

        self.add_pawn(Cow::Owned(taken_pawn))
    }

    // -- CURSOR EVENTS --

    pub fn update_cursor(&mut self, user_id: UserId, position: Vec3) -> Result<(), Box<dyn Error>> {
        let mut user = self.users.get_mut(&user_id).ok_or("Invalid user id")?;

        user.cursor_position = position;
        Ok(())
    }

    // --- GAME REGISTRATION EVENTS ---

    pub fn register_game(&mut self, user_id: UserId, info: Cow<'_, GameInfo>) -> Result<(), Box<dyn Error>> {
        if user_id != self.host { return Err("Failed to register game".into()); }

        println!("User <{user_id:?}> registering game \"{}\" for lobby [{}]",
                info.name, self.name);

        self.info = Some(info.into_owned());

        self.users.values()
            .send_event(&Event::RegisterGame(
                Cow::Borrowed(self.info.as_ref().ok_or("Lobby missing GameInfo")?)
            ))
    }
    pub fn register_assets(&mut self, user_id: UserId, assets: HashMap<String, String>) -> Result<(), Box<dyn Error>> {
        if user_id != self.host || self.assets.len() >= 256 { return Err("Failed to register asset".into()); }

        println!("User <{user_id:?}> registering assets for lobby [{}]:", self.name);
        let mut processed_assets: HashMap<String, Asset> = HashMap::new();
        for (name, data) in assets.into_iter() {
            if processed_assets.values().fold(0, |acc, a| acc + a.data.len()) > 1024 * 1024 * 40 { return Err("Attempting to register >40 MiB of assets".into()); }
            if processed_assets.get(&name).is_some() { return Err("Attempting to overwrite asset".into()); }
        
            let url = DataUrl::process(&data).ok().ok_or("Failed to process base64")?;
            let asset = Asset {
                mime_type: format!("{}/{}", url.mime_type().type_, url.mime_type().subtype),
                data: url.decode_to_vec().ok().ok_or("Failed to decode base64")?.0, // Vec<u8>
            };
        
            // No assets above 2 MiB
            if asset.data.len() > 1024 * 1024 * 2 { return Err("Asset too large".into()); }

            processed_assets.insert(name.to_string(), asset);
        
            println!(" - \"{name}\"");
        }
        println!(" - Asset count: {} | Total size: {} KiB",
                processed_assets.len(),
                processed_assets.values().fold(0, |acc, a| acc + a.data.len())/1024);

        // Load lua if it exists
        // `require` function is only defined on initial load.
        if let Err(e) = self.lua_scope(|lua, scope, _| {
            lua.globals().set("require", scope.create_function(|lua, path: String| {
                Ok(if let Some(asset) = processed_assets.get(&format!("/{}.lua", path)) {
                    lua.load(String::from_utf8(asset.data.clone()).unwrap()).eval()?
                } else { mlua::Value::Nil })
            })?)?;
            lua.load("require(\"main\")").exec()?;

            if let Some(res) = Self::run_lua_callback(lua, "start", ()) {
                res?;
            }
            Ok(())
        }) {
            self.system_chat(Cow::Owned(format!("Lua error: `{}`", e)))?;
        }
        
        self.assets = processed_assets;

        // Alert host that the assets have been registered
        self.users.get(&user_id).ok_or("Failed to get host")?
            .send_event(&Event::RegisterAssets { assets: HashMap::default() })?;
        Ok(())
    }
    pub fn clear_assets(&mut self, user_id: UserId) -> Result<(), Box<dyn Error>> {
        if user_id != self.host { return Err("Failed to clear assets".into()); }

        self.assets = HashMap::new();

        println!("User <{user_id:?}> clearing assets for lobby [{}]", self.name);
        Ok(())
    }
    pub fn settings(&mut self, user_id: UserId, settings: LobbySettings) -> Result<(), Box<dyn Error>> {
        if user_id != self.host { return Err("Non-host user attempting to change settings".into()); }

        self.settings = settings.clone();

        if self.settings.show_card_counts {
            for (&id, other) in self.users.iter() {
                let count = other.hand.len() as u64;
                self.users.values().send_event(&Event::HandCount { id, count })?;
            }
        }

        self.users.values().send_event(&Event::Settings(settings))
    }

    // -- PING --

    pub fn ping(&self, user_id: UserId, idx: u64) -> Result<(), Box<dyn Error>> {
        // Pong
        self.users.get(&user_id).ok_or("Invalid user id")?.send_event(&Event::Pong { idx })?;
        Ok(())
    }
}