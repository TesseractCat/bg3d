use std::collections::HashMap;
use std::error::Error;
use std::io::{self, Write};
use tokio::sync::{mpsc, mpsc::error::SendError};
use serde::{Serialize, Deserialize};
use axum::extract::ws::Message;
use random_color::{Color, Luminosity, RandomColor, color_dictionary::ColorDictionary};

use flate2::{Compress, Compression};
use flate2::write::ZlibEncoder;

use crate::events::Event;
use crate::pawn::{Pawn, PawnId};
use crate::math::Vec3;

struct FixedFormatter;
impl serde_json::ser::Formatter for FixedFormatter {
    fn write_f64<W>(&mut self, writer: &mut W, value: f64) -> io::Result<()>
        where
            W: ?Sized + io::Write, {
        write!(writer, "{:.4}", value)
    }
    fn write_f32<W>(&mut self, writer: &mut W, value: f32) -> io::Result<()>
        where
            W: ?Sized + io::Write, {
        write!(writer, "{:.4}", value)
    }
}

pub trait Sender {
    fn send_event(&mut self, content: &Event) -> Result<(), Box<dyn Error>>;
    fn send_binary(&mut self, content: &[u8]) -> Result<(), Box<dyn Error>>;
    fn send_text(&mut self, content: &str) -> Result<(), Box<dyn Error>>;
}
impl<'a, T> Sender for T where T: Iterator<Item=&'a User> {
    fn send_event(&mut self, content: &Event)  -> Result<(), Box<dyn Error>> {
        let mut ser = serde_json::Serializer::with_formatter(Vec::new(), FixedFormatter);
        content.serialize(&mut ser)?;
        let content = String::from_utf8(ser.into_inner())?;

        let mut c = Compress::new(Compression::best(), false);
        c.set_dictionary(include_bytes!("dictionary.txt")).expect("Failed to set DEFLATE dictionary");
        let mut deflate_compressor = ZlibEncoder::new_with_compress(Vec::new(), c);
        deflate_compressor.write_all(content.as_bytes())?;
        self.send_binary(deflate_compressor.finish()?.as_slice())
    }
    fn send_binary(&mut self, content: &[u8])  -> Result<(), Box<dyn Error>> {
        for user in self {
            user.send_binary(content)?;
        }
        Ok(())
    }
    fn send_text(&mut self, content: &str)  -> Result<(), Box<dyn Error>> {
        for user in self {
            user.send_text(content.to_string())?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct UserId(pub u64);
impl mlua::UserData for UserId { }
impl<'lua> mlua::FromLua<'lua> for UserId {
    fn from_lua(value: mlua::Value<'lua>, _lua: &'lua mlua::Lua) -> mlua::Result<Self> {
        Ok(*(value.as_userdata().ok_or(mlua::Error::UserDataTypeMismatch)?.borrow()?))
    }
}
#[derive(Clone, Serialize, Debug)]
pub struct User {
    pub id: UserId,
    pub color: String,

    #[serde(skip)]
    pub color_idx: usize,

    #[serde(skip)]
    pub hand: HashMap<PawnId, Pawn>,
    #[serde(skip)]
    pub tx: mpsc::UnboundedSender<Message>,

    #[serde(skip)]
    pub cursor_position: Vec3,
    #[serde(skip)]
    pub head_position: Vec3,
    #[serde(skip)]
    pub head_direction: Vec3
}

impl User {
    pub fn new(id: UserId, tx: mpsc::UnboundedSender<Message>, color: Color, color_idx: usize) -> User {
        User {
            id,
            tx,
            hand: HashMap::new(),
            color: RandomColor::new().dictionary(ColorDictionary::new()).hue(color).luminosity(Luminosity::Dark).to_hex(),
            color_idx,

            cursor_position: Vec3 {x:0.0,y:0.0,z:0.0},
            head_position: Vec3 {x:0.0,y:0.0,z:0.0},
            head_direction: Vec3 {x:0.0,y:0.0,z:0.0}
        }
    }

    pub fn send_event(&self, content: &Event) -> Result<(), SendError<Message>> {
        let mut ser = serde_json::Serializer::with_formatter(Vec::new(), FixedFormatter);
        content.serialize(&mut ser).unwrap();
        let content = String::from_utf8(ser.into_inner()).unwrap();

        let mut c = Compress::new(Compression::best(), false);
        c.set_dictionary(include_bytes!("dictionary.txt")).expect("Failed to set DEFLATE dictionary");
        let mut deflate_compressor = ZlibEncoder::new_with_compress(Vec::new(), c);
        deflate_compressor.write_all(content.as_bytes()).unwrap();
        self.send_binary(deflate_compressor.finish().unwrap().as_slice())
    }
    pub fn send_binary(&self, content: &[u8]) -> Result<(), SendError<Message>> {
        self.tx.send(Message::Binary(content.to_vec()))
    }
    pub fn send_text(&self, content: String) -> Result<(), SendError<Message>> {
        self.tx.send(Message::Text(content))
    }
}