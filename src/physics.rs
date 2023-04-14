use rapier3d::prelude::*;
use tokio::sync::mpsc;
use tokio::sync::mpsc::{UnboundedSender, UnboundedReceiver};
use serde::{Serialize, Deserialize};

use crate::lobby::Vec3;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CollisionAudioInfo {
    position: Vec3,
    impulse: f32,
}

pub struct TokioEventCollector {
    event_sender: UnboundedSender<CollisionAudioInfo>
}
impl TokioEventCollector {
    pub fn new (event_sender: UnboundedSender<CollisionAudioInfo>) -> Self {
        Self { event_sender }
    }
}
impl EventHandler for TokioEventCollector {
    fn handle_contact_force_event(
        &self,
        _dt: f32,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        _contact_pair: &ContactPair,
        _total_force_magnitude: f32,
    ) { }

    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        colliders: &ColliderSet,
        event: CollisionEvent,
        pair: Option<&ContactPair>,
    ) {
        if let Some(pair) = pair {
            if let Some((_, contact)) = pair.find_deepest_contact() {
                if let CollisionEvent::Started(collider, _, _) = event {
                    if let Some(collider) = colliders.get(collider) {
                        let position: &Vector<f32> = &collider.position().transform_vector(&contact.local_p1.coords);
                        let impulse = contact.data.impulse;

                        let _ = self.event_sender.send(CollisionAudioInfo {
                            position: position.into(),
                            impulse,
                        });
                    }
                }
            }
        }
    }
}

pub struct PhysicsWorld {
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,

    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline: PhysicsPipeline,

    pub island_manager: IslandManager,
    pub broad_phase: BroadPhase,
    pub narrow_phase: NarrowPhase,

    pub impulse_joint_set: ImpulseJointSet,
    pub multibody_joint_set: MultibodyJointSet,
    pub ccd_solver: CCDSolver,

    pub event_handler: TokioEventCollector,
    pub event_receiver: UnboundedReceiver<CollisionAudioInfo>,
}
impl PhysicsWorld {
    pub fn new(dt: f32) -> PhysicsWorld {
        let (collision_tx, collision_rx) = mpsc::unbounded_channel();

        // Build world
        let mut w = PhysicsWorld {
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),

            integration_parameters: IntegrationParameters {
                dt: dt,
                erp: 0.95,
                damping_ratio: 0.5,
                ..Default::default()
            },
            physics_pipeline: PhysicsPipeline::new(),

            island_manager: IslandManager::new(),
            broad_phase: BroadPhase::new(),
            narrow_phase: NarrowPhase::new(),

            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),

            event_handler: TokioEventCollector::new(collision_tx),
            event_receiver: collision_rx,
        };
		
        // Ground plane
		w.collider_set.insert(ColliderBuilder::halfspace(Vector::y_axis()).build());
		
		return w;
    }
    pub fn step(&mut self) {
        self.physics_pipeline.step(
            &vector![0.0, -9.8, 0.0],
            &self.integration_parameters,

			&mut self.island_manager,
			&mut self.broad_phase,
			&mut self.narrow_phase,

			&mut self.rigid_body_set,
			&mut self.collider_set,

			&mut self.impulse_joint_set,
			&mut self.multibody_joint_set,
			&mut self.ccd_solver,

            None,
			&(),
			&self.event_handler,
        );
    }
    pub fn get_collisions(&mut self) -> Option<Vec<CollisionAudioInfo>> {
        let mut events: Vec<CollisionAudioInfo> = Vec::new();
        while let Ok(event) = self.event_receiver.try_recv() {
            events.push(event);
        }
        if events.len() == 0 {
            None
        } else {
            Some(events)
        }
    }
    pub fn remove_rigidbody(&mut self, handle: RigidBodyHandle) {
        self.rigid_body_set.remove(handle,
                                   &mut self.island_manager,
                                   &mut self.collider_set,
                                   &mut self.impulse_joint_set,
                                   &mut self.multibody_joint_set,
                                   true);
    }
    pub fn insert_with_parent(&mut self, collider: Collider, handle: RigidBodyHandle) -> ColliderHandle {
        self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set)
    }
    pub fn remove_collider(&mut self, handle: ColliderHandle) {
        self.collider_set.remove(handle,
                                 &mut self.island_manager,
                                 &mut self.rigid_body_set,
                                 true);
    }
}
