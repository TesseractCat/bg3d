use rapier3d::prelude::*;

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
}
impl PhysicsWorld {
    pub fn new(dt: f32) -> PhysicsWorld {
        // Build world
        let mut w = PhysicsWorld {
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),

            integration_parameters: IntegrationParameters {
                dt: dt,
                ..Default::default()
            },
            physics_pipeline: PhysicsPipeline::new(),

            island_manager: IslandManager::new(),
            broad_phase: BroadPhase::new(),
            narrow_phase: NarrowPhase::new(),

            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
        };
		
        // Ground plane
		w.collider_set.insert(ColliderBuilder::cuboid(1000.0, 0.5, 1000.0).translation(vector![0.0, -0.5, 0.0]).build());
		
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

			&(),
			&(),
        );
    }
    pub fn remove_rigidbody(&mut self, handle: RigidBodyHandle) {
        self.rigid_body_set.remove(handle,
                                   &mut self.island_manager,
                                   &mut self.collider_set,
                                   &mut self.impulse_joint_set,
                                   &mut self.multibody_joint_set,
                                   true);
    }
    pub fn insert_with_parent(&mut self, collider: Collider, handle: RigidBodyHandle) {
        self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
    }
}
