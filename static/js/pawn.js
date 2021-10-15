import * as THREE from 'three';
import * as CANNON from 'cannon-es'

// Local instance of moveable object with mesh
export default class Pawn {
    position = new THREE.Vector3(0,0,0);
    rotation = new THREE.Quaternion();
    mesh;
    physicsBody;
    
    constructor(manager, position, mesh, physicsBody) {
        this.manager = manager;
        
        this.physicsBody = physicsBody;
        this.physicsBody.position.copy(position);
        this.manager.world.addBody(this.physicsBody);

        // MESH
        /*this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial());
        this.mesh.castShadow = true;
        this.manager.scene.add(this.mesh);*/
        
        this.manager.loader.load(mesh, (gltf) => {
            gltf.scene.traverse(function (child) {
                child.castShadow = true;
                child.receiveShadow = true;
            });

            this.mesh = gltf.scene;
            this.manager.scene.add(gltf.scene);
            this.updateMeshTransform();
        });
        
        this.position.copy(position);
    }
    
    animate() {
        if (this.physicsBody.type == CANNON.Body.DYNAMIC) {
            //console.log(this.physicsBody.position);
            this.position.copy(this.physicsBody.position);
            this.rotation.copy(this.physicsBody.quaternion);
            this.updateMeshTransform();
        }
    }
    
    setPosition(position) {
        this.position.copy(position);
        this.physicsBody.position.copy(position);
        
        this.updateMeshTransform();
    }
    
    updateMeshTransform() {
        if (this.mesh) {
            this.mesh.position.copy(this.position);
            this.mesh.quaternion.copy(this.rotation);
        }
    }
}
