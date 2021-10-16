import * as THREE from 'three';
import * as CANNON from 'cannon-es'

// Local instance of moveable object with mesh
export default class Pawn {
    position = new THREE.Vector3(0,0,0);
    rotation = new THREE.Quaternion();
    hovered = false;
    selected = false;
    id = null;
    
    moveable = false;
    mesh;
    meshUrl;
    physicsBody;
    
    dirty = false;
    lastPosition = new THREE.Vector3(0,0,0);
    lastRotation = new THREE.Quaternion();
    
    static NEXT_ID = 0;
    
    constructor(manager, position, mesh, physicsBody, id = null) {
        if (id == null) {
            this.id = Pawn.NEXT_ID;
            Pawn.NEXT_ID += 1;
        }
        this.manager = manager;
        
        this.physicsBody = physicsBody;
        this.physicsBody.position.copy(position);
        this.manager.world.addBody(this.physicsBody);

        // MESH
        /*this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial());
        this.mesh.castShadow = true;
        this.manager.scene.add(this.mesh);*/
        
        this.meshUrl = mesh;
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
        
        /*let dragged = false;
        document.addEventListener('mousedown', () => { dragged = false });
        document.addEventListener('mousemove', () => { dragged = true });
        document.addEventListener("mouseup", () => {
            if (!this.moveable || dragged)
                return;
            if (this.hovered && !this.selected) {
                this.selected = true;
            } else if (this.selected) {
                this.selected = false;
            }
        });*/
    }
    
    animate(dt) {
        if (this.physicsBody.type == CANNON.Body.DYNAMIC) {
            //console.log(this.physicsBody.position);
            this.position.copy(this.physicsBody.position);
            this.rotation.copy(this.physicsBody.quaternion);
            this.updateMeshTransform();
        }
        
        // Raycast to mesh
        //if (this.mesh) {
        //    let hits = this.manager.raycaster.intersectObject(this.mesh, true);
        //    this.hovered = hits.length > 0;
        //}
        
        if (this.selected) {
            let raycastableObjects = Array.from(this.manager.pawns.values()).filter(x => x != this).map(x => x.mesh);
            raycastableObjects.push(this.manager.plane);
            let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);
            
            for (var i = 0; i < hits.length; i++) {
                if (hits[i].object != this.mesh) {
                    let newPosition = this.position.clone();
                    newPosition.lerp(hits[i].point.clone().add(new THREE.Vector3(0, 2, 0)), dt * 10);
                    let newRotation = this.rotation.clone();
                    newRotation.slerp(new THREE.Quaternion(), dt * 10);
                    this.setPosition(newPosition);
                    this.setRotation(newRotation);
                    break;
                }
            }
        }
        
        if (!this.dirty) {
            this.dirty = this.position.distanceToSquared(this.lastPosition) > 0.01 ||
                this.rotation.angleTo(this.lastRotation) > 0.01;
            if (this.dirty) {
                this.lastPosition.copy(this.position);
                this.lastRotation.copy(this.rotation);
            }
        }
    }
    
    setPosition(position) {
        this.position.copy(position);
        this.physicsBody.position.copy(position);
        this.physicsBody.velocity.set(0,0,0);
        
        this.updateMeshTransform();
    }
    setRotation(rotation) {
        this.rotation.copy(rotation);
        this.physicsBody.quaternion.copy(rotation);
        this.physicsBody.angularVelocity.set(0,0,0);
        
        this.updateMeshTransform();
    }
    
    updateMeshTransform() {
        if (this.mesh) {
            this.mesh.position.copy(this.position);
            this.mesh.quaternion.copy(this.rotation);
        }
    }
}
