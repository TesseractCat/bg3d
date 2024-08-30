use rapier3d::prelude::*;
use tokio::sync::mpsc;
use tokio::sync::mpsc::{UnboundedSender, UnboundedReceiver};
use serde::{Serialize, Deserialize};

use crate::pawn::Vec3;

const PHYSICS_SCALE: f32 = 1.0/8.0;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CollisionAudioInfo {
    position: Vec3,
    impulse: f32,
}

pub struct TokioEventCollector {
    event_sender: UnboundedSender<(CollisionEvent, Option<ContactPair>)>
}
impl TokioEventCollector {
    pub fn new (event_sender: UnboundedSender<(CollisionEvent, Option<ContactPair>)>) -> Self {
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
        _colliders: &ColliderSet,
        event: CollisionEvent,
        pair: Option<&ContactPair>,
    ) {
        let _ = self.event_sender.send((event, pair.cloned()));
    }
}

pub struct PhysicsWorld {
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,

    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline: PhysicsPipeline,

    pub island_manager: IslandManager,
    pub broad_phase: DefaultBroadPhase,
    pub narrow_phase: NarrowPhase,

    pub impulse_joint_set: ImpulseJointSet,
    pub multibody_joint_set: MultibodyJointSet,
    pub ccd_solver: CCDSolver,

    pub event_handler: TokioEventCollector,
    pub event_receiver: UnboundedReceiver<(CollisionEvent, Option<ContactPair>)>,
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
                min_ccd_dt: dt/100.0,
                contact_damping_ratio: 0.25,
                // erp: 1.0,
                // damping_ratio: 0.8,
                // max_stabilization_iterations: 2,
                max_ccd_substeps: 2,
                length_unit: 1.0/PHYSICS_SCALE,

                ..Default::default()
            },
            physics_pipeline: PhysicsPipeline::new(),

            island_manager: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),

            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),

            event_handler: TokioEventCollector::new(collision_tx),
            event_receiver: collision_rx,
        };
		
        // Ground
		w.collider_set.insert(ColliderBuilder::halfspace(Vector::y_axis()).build());
  
        // Ceiling
		w.collider_set.insert(ColliderBuilder::halfspace(-Vector::y_axis())
                                    .translation(Vector::y_axis().into_inner() * 500.).build());

        // Walls
        let wall_distance = 80.;
		w.collider_set.insert(ColliderBuilder::halfspace(Vector::x_axis())
                                    .translation(Vector::x_axis().into_inner() * -wall_distance).build());
		w.collider_set.insert(ColliderBuilder::halfspace(-Vector::x_axis())
                                    .translation(Vector::x_axis().into_inner() * wall_distance).build());
		w.collider_set.insert(ColliderBuilder::halfspace(Vector::z_axis())
                                    .translation(Vector::z_axis().into_inner() * -wall_distance).build());
		w.collider_set.insert(ColliderBuilder::halfspace(-Vector::z_axis())
                                    .translation(Vector::z_axis().into_inner() * wall_distance).build());
		
		return w;
    }
    pub fn step(&mut self) {
        self.physics_pipeline.step(
            &vector![0.0, -9.8 / PHYSICS_SCALE, 0.0],
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
    pub fn get_collisions(&mut self) -> impl Iterator<Item = (CollisionEvent, Option<ContactPair>)> {
        let mut events: Vec<(CollisionEvent, Option<ContactPair>)> = Vec::new();
        while let Ok(event) = self.event_receiver.try_recv() {
            events.push(event);
        }
        events.into_iter()
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
