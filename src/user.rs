use warp::ws::*;
use tokio::sync::mpsc;

pub struct User {
    pub id: usize,
    pub tx: mpsc::UnboundedSender<Message>,
    pub lobby: Option<String>
}

impl User {
    pub fn new(id: usize, tx: mpsc::UnboundedSender<Message>) -> User {
        User {
            id: id,
            tx: tx,
            lobby: None
        }
    }
}
