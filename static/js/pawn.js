import * as THREE from 'three';
import * as CANNON from 'cannon-es'

import Manager from './manager';

// Local instance of moveable object with mesh
export class Pawn {
    position = new THREE.Vector3(0,0,0);
    rotation = new THREE.Quaternion();
    hovered = false;
    selected = false;
    
    selectRotation = {x:0, y:0, z:0};
    
    id = null;
    
    moveable = true;
    mesh;
    meshUrl;
    meshOffset = new THREE.Vector3(0,0,0);
    physicsBody;
    
    dirty = new Set();
    lastPosition = new THREE.Vector3(0,0,0);
    lastRotation = new THREE.Quaternion();
    
    networkSelected = false;
    networkBuffer = [];
    networkLastSynced = 0;
    
    static NEXT_ID = 0;
    
    constructor(manager, position, rotation, mesh, physicsBody, id = null) {
        if (id == null) {
            this.id = Pawn.NEXT_ID;
            Pawn.NEXT_ID += 1;
        } else {
            this.id = id;
        }
        this.manager = manager;
        this.position.copy(position); // Apply transform
        this.rotation.copy(rotation);
        
        // Flush networkBuffer
        this.flushBuffer(position, rotation);
        
        // Create and register physics body
        this.physicsBody = physicsBody;
        this.physicsBody.position.copy(position);
        this.physicsBody.quaternion.copy(rotation);
        // Disable physics for non-hosts
        //if (!this.manager.host)
        //    this.physicsBody.type = CANNON.Body.Static
        this.manager.world.addBody(this.physicsBody);

        // Load mesh
        if (typeof mesh === 'string') { // GLTF URL
            this.meshUrl = mesh;
            this.manager.loader.load(mesh, (gltf) => {
                gltf.scene.traverse(function (child) {
                    /*if (child.material != undefined) {
                        child.material.metalness = 0;
                        child.material.smoothness = 0;
                    }*/
                    child.castShadow = true;
                    child.receiveShadow = true;
                });

                this.mesh = gltf.scene;
                this.updateMeshTransform();
                this.manager.scene.add(gltf.scene);
            });
        } else { // Three.JS mesh
            this.meshUrl = "";
            this.mesh = mesh;
            this.updateMeshTransform();
            this.manager.scene.add(this.mesh);
        }
    }
    initialized = false;
    init() {
        this.manager.scene.add(this.mesh);
        this.manager.world.addBody(this.physicsBody);
        initialized = true;
    }
    
    animate(dt) {
        // TODO: Check for initialized
        // Follow dynamic physics body
        if (this.physicsBody.type == CANNON.Body.DYNAMIC) {
            this.position.copy(this.physicsBody.position);
            this.rotation.copy(this.physicsBody.quaternion);
            this.updateMeshTransform();
        }
        
        // Raycast to mesh
        if (this.selected) {
            let raycastableObjects = Array.from(this.manager.pawns.values()).filter(x => x != this).map(x => x.mesh);
            raycastableObjects.push(this.manager.plane);
            let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);
            
            let hitPoint;
            for (var i = 0; i < hits.length; i++) {
                if (hits[i].object != this.mesh) {
                    hitPoint = hits[i].point.clone();
                    break;
                }
            }
            if (hitPoint != undefined) {
                let newPosition = this.position.clone();
                newPosition.lerp(hitPoint.add(new THREE.Vector3(0, 2, 0)).sub(this.meshOffset), dt * 10);
                let newRotation = this.rotation.clone();
                newRotation.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(this.selectRotation)), dt * 10);
                this.setPosition(newPosition);
                this.setRotation(newRotation);
            }
        }
        
        // Handle network interpolation
        if (!this.selected && (!this.manager.host || this.networkSelected)) {
            let diff = this.networkBuffer[1].time - this.networkBuffer[0].time;
            let progress = (performance.now()-this.networkLastSynced)/diff;
            progress = Math.max(Math.min(progress, 1), 0);
            
            let newPosition = this.networkBuffer[0].position.clone();
            newPosition.lerp(this.networkBuffer[1].position.clone(), progress);
            
            let newRotation = this.networkBuffer[0].rotation.clone();
            newRotation.slerp(this.networkBuffer[1].rotation.clone(), progress);
            
            //FIXME: Do some sort of check for when to lerp, otherwise simulate physics locally (for smoothness)
            if (this.networkSelected || true) {
                // Lerp directly
                this.setPosition(newPosition);//, this.networkSelected);
                this.setRotation(newRotation);//, this.networkSelected);
            } else {
                /*
                // 'Nudge' into place using physics forces
                //this.setPosition(this.position.clone().lerp(this.networkPosition, dt * 5));
                //this.setRotation(this.rotation.clone().slerp(this.networkRotation.clone(), dt * 5));
                let force = new CANNON.Vec3().copy(this.networkPosition.clone().sub(this.position)).scale(100);
                console.log(force);
                this.physicsBody.applyForce(force);
                let torque = new THREE.Quaternion().multiply(this.networkRotation, this.rotation.inverse());
                torque = new THREE.Euler().setFromQuaternion(torque).toVector3();
                this.physicsBody.applyTorque(
                    new CANNON.Vec3().copy(torque).scale(100));*/
            }
        }
        
        // When to mark pawn as 'dirty' (needs to be synced on the network)
        if (!this.dirty.has("position")) {
            if ((this.manager.host && !this.networkSelected) || this.selected) {
            //if (this.manager.host || this.selected) {
                if (this.position.distanceToSquared(this.lastPosition) > 0.01 ||
                    this.rotation.angleTo(this.lastRotation) > 0.01) {
                    
                    this.dirty.add("position");
                    this.dirty.add("rotation");
                    
                    this.lastPosition.copy(this.position);
                    this.lastRotation.copy(this.rotation);
                }
            }
        }
    }
    
    handleEvent(data) {
        return {};
    }
    keyDown(e) {
        if (e.key == 'f')
            this.flip();
        if (e.key == 'q')
            this.rotate(1);
        if (e.key == 'e')
            this.rotate(-1);
    }
    
    grab(button) {
        // If we are trying to select something that is already selected
        if (this.networkSelected) 
            return;
        
        this.selected = true;
        this.dirty.add("selected");
        this.updateMeshTransform(); // FIXME: Needed?
        document.querySelector("#hand-panel").classList.add("minimized");
    }
    release() {
        this.selected = false;
        // Locally apply position as networked position
        this.flushBuffer(this.position, this.rotation);
        // Mark as dirty (so as to share that we have released)
        this.dirty.add("position");
        this.dirty.add("rotation");
        this.dirty.add("selected");
        
        document.querySelector("#hand-panel").classList.remove("minimized");
    }
    flip() {
        this.selectRotation.x = Math.abs(this.selectRotation.x - Math.PI) < 0.01 ? 0 : Math.PI;
        this.dirty.add("selectRotation");
    }
    rotate(m) {
        this.selectRotation.y += m * Math.PI/8;
        this.dirty.add("selectRotation");
    }
    shake() { }
    
    setPosition(position, clearVelocity = true) {
        this.position.copy(position);
        this.physicsBody.position.copy(position);
        if (clearVelocity)
            this.physicsBody.velocity.set(0,0,0);
        
        this.updateMeshTransform();
    }
    setRotation(rotation, clearVelocity = true) {
        this.rotation.copy(rotation);
        this.physicsBody.quaternion.copy(rotation);
        if (clearVelocity)
            this.physicsBody.angularVelocity.set(0,0,0);
        
        this.updateMeshTransform();
    }
    flushBuffer(position, rotation) {
        this.networkBuffer.push({
            time:performance.now(),
            position:new THREE.Vector3().copy(position),
            rotation:new THREE.Quaternion().copy(rotation)
        });
        if (this.networkBuffer.length > 2)
            this.networkBuffer.shift();
        this.networkBuffer.push({
            time:performance.now() + 1,
            position:new THREE.Vector3().copy(position),
            rotation:new THREE.Quaternion().copy(rotation)
        });
        if (this.networkBuffer.length > 2)
            this.networkBuffer.shift();
    }
    
    updateMeshTransform() {
        if (this.mesh) {
            this.mesh.position.copy(this.position);
            this.mesh.quaternion.copy(this.rotation);
            this.mesh.translateX(this.meshOffset.x);
            this.mesh.translateY(this.meshOffset.y);
            this.mesh.translateZ(this.meshOffset.z);
        }
    }
    
    serialize() {
        let out = this.serializeState();
        out.class = "Pawn";
        out.mesh = this.meshUrl;
        out.mass = this.physicsBody.mass;
        out.moveable = this.moveable;
        out.shapes = this.physicsBody.shapes.map(x => x.serialize());
        out.meshOffset = {x:this.meshOffset.x, y:this.meshOffset.y, z:this.meshOffset.z};
        out.data = {};
        return out;
    }
    serializeState() {
        let rotation = new THREE.Euler().setFromQuaternion(this.rotation);
        return {
            id:this.id,
            selected:this.selected,
            position:{x:this.position.x, y:this.position.y, z:this.position.z},
            rotation:{x:rotation.x, y:rotation.y, z:rotation.z},
            selectRotation:this.selectRotation,
        };
    }
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let physicsBody = new CANNON.Body({
            mass: pawnJSON.mass,
            shape: new CANNON.Shape().deserialize(pawnJSON.shapes[0]) // FIXME Handle multiple shapes
        });
        let pawn = new Pawn(manager, pawnJSON.position, rotation, pawnJSON.mesh, physicsBody, pawnJSON.id);
        pawn.meshOffset.copy(pawnJSON.meshOffset);
        pawn.moveable = pawnJSON.moveable;
        pawn.networkSelected = pawnJSON.selected;
        pawn.selectRotation = pawnJSON.selectRotation;
        return pawn;
    }
    processData() { }
}

export class Dice extends Pawn {
    data = {
        rollRotations: []
    }
    
    constructor(manager, position, rotation, mesh, physicsBody, rollRotations, id = null) {
        super(manager, position, rotation, mesh, physicsBody, id);
        this.data.rollRotations = rollRotations;
    }
    
    flip() { }
    rotate(m) { }
    shake() {
        this.selectRotation = this.data.rollRotations[Math.floor(Math.random() * this.data.rollRotations.length)];
        this.dirty.add("selectRotation");
    }
    
    serialize() {
        let out = super.serialize();
        out.class = "Dice";
        out.data = this.data;
        return out;
    }
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let physicsBody = new CANNON.Body({
            mass: pawnJSON.mass,
            shape: new CANNON.Shape().deserialize(pawnJSON.shapes[0]) // FIXME Handle multiple shapes
        });
        let pawn = new Dice(manager, pawnJSON.position, rotation,
            pawnJSON.mesh, physicsBody, pawnJSON.data.rollRotations, pawnJSON.id);
        pawn.meshOffset.copy(pawnJSON.meshOffset);
        pawn.moveable = pawnJSON.moveable;
        pawn.networkSelected = pawnJSON.selected;
        pawn.selectRotation = pawnJSON.selectRotation;
        return pawn;
    }
}
