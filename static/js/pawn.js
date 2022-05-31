import * as THREE from 'three';

import Manager from './manager';
import { NetworkedTransform } from './transform';

// Local instance of moveable object with mesh
export class Pawn {
    position = new THREE.Vector3(0,0,0);
    rotation = new THREE.Quaternion();
    hovered = false;
    selected = false;
    data = {};
    
    selectRotation = new THREE.Vector3();
    
    id;
    name;
    
    moveable = true;
    mesh = new THREE.Object3D();
    colliderShapes;
    meshUrl;
    meshOffset = new THREE.Vector3();
    hoveredOffset = 0;
    
    dirty = new Set();
    lastPosition = new THREE.Vector3();
    lastRotation = new THREE.Quaternion();
    
    networkSelected = false;
    networkTransform;
    
    static NEXT_ID = 0;
    
    constructor({manager,
        position = new THREE.Vector3(), rotation = new THREE.Quaternion(),
        mesh = null, meshOffset = new THREE.Vector3(), colliderShapes = null, moveable = true, id = null, name = null}) {
        
        if (id == null) {
            this.id = Pawn.NEXT_ID;
            Pawn.NEXT_ID += 1;
        } else {
            this.id = id;
        }
        this.manager = manager;
        
        this.position.copy(position); // Apply transform
        this.rotation.copy(rotation);

        this.name = name;
        this.moveable = moveable;
        this.meshUrl = mesh;
        this.meshOffset.copy(meshOffset);
        this.colliderShapes = colliderShapes;
        
        // Create new NetworkedTransform
        this.networkTransform = new NetworkedTransform(position, rotation);

        // Load mesh
        if (mesh != null) { // GLTF URL
            this.manager.loader.load(mesh, (gltf) => {
                gltf.scene.traverse(function (child) {
                    /*if (child.material != undefined) {
                        child.material.metalness = 0;
                        child.material.smoothness = 0;
                    }*/
                    child.castShadow = true;
                    child.receiveShadow = true;
                });

                let boundingBox = new THREE.Box3().setFromObject(gltf.scene);
                this.meshOffset = new THREE.Vector3(0, -0.5 * (boundingBox.max.y - boundingBox.min.y), 0);
                this.dirty.add("meshOffset");
                this.mesh.add(gltf.scene);
                this.updateMeshTransform();
            });
        } else { // Don't load GLTF
            this.updateMeshTransform();
        }
    }
    initialized = false;
    init() {
        this.manager.scene.add(this.mesh);
        this.initialized = true;
    }
    
    animate(dt) {
        //this.hoveredOffset = new THREE.Vector3(0, this.hoveredOffset, 0)
        //    .lerp(new THREE.Vector3(0, this.hovered ? 0.2 : 0, 0), dt * 15).y;
        
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
        this.networkTransform.animate();
        this.setPosition(
            this.position.clone().lerp(this.networkTransform.position, dt * 40),
            false
        );
        this.setRotation(
            this.rotation.clone().slerp(this.networkTransform.rotation, dt * 40),
            false
        );
        
        // When to mark pawn as 'dirty' (needs to be synced on the network)
        if (!this.dirty.has("position") && this.selected) {
            if (this.position.distanceToSquared(this.lastPosition) > 0.01 ||
                this.rotation.angleTo(this.lastRotation) > 0.01) {

                this.dirty.add("position");
                this.dirty.add("rotation");

                this.lastPosition.copy(this.position);
                this.lastRotation.copy(this.rotation);
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
        this.networkTransform.flushBuffer(this.position, this.rotation);
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
    
    setPosition(position, resetNetwork = true) {
        this.position.copy(position);
        if (resetNetwork)
            this.networkTransform = new NetworkedTransform(this.position, this.rotation);
        this.updateMeshTransform();
        return this;
    }
    setRotation(rotation, resetNetwork = true) {
        this.rotation.copy(rotation);
        if (resetNetwork)
            this.networkTransform = new NetworkedTransform(this.position, this.rotation);
        this.updateMeshTransform();
        return this;
    }
    
    updateMeshTransform() {
        if (this.mesh) {
            this.mesh.position.copy(this.position);
            this.mesh.quaternion.copy(this.rotation);
            this.mesh.translateX(this.meshOffset.x);
            this.mesh.translateY(this.meshOffset.y + this.hoveredOffset);
            this.mesh.translateZ(this.meshOffset.z);
        }
    }
    
    static className() { return "Pawn"; };
    serialize() {
        let out = this.serializeState();
        Object.assign(out, {
            class: this.constructor.className(),
            name: this.name,
            mesh: this.meshUrl, meshOffset: this.meshOffset,
            mass: 1.0, moveable: this.moveable,
            colliderShapes: this.colliderShapes,
            data: this.data
        });
        return out;
    }
    serializeState() {
        let rotation = new THREE.Euler().setFromQuaternion(this.rotation).toVector3();
        return {
            id:this.id,
            selected:this.selected,
            position:this.position,
            rotation:rotation,
            selectRotation:this.selectRotation,
        };
    }
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let pawn = new Pawn({
            manager: manager, name: pawnJSON.name,
            position: pawnJSON.position, rotation: rotation,
            mesh: pawnJSON.mesh, colliderShapes: pawnJSON.colliderShapes,
            moveable: pawnJSON.moveable, id: pawnJSON.id
        });
        pawn.meshOffset.copy(pawnJSON.meshOffset);
        pawn.networkSelected = pawnJSON.selected;
        pawn.selectRotation = pawnJSON.selectRotation;
        return pawn;
    }
    clone() {
        // Serialize and Deserialize to clone
        let serialized = this.serialize();
        let serializedJSON = JSON.stringify(serialized);
        let pawn = this.constructor.deserialize(this.manager, JSON.parse(serializedJSON));
        // Increment ID
        pawn.id = Pawn.NEXT_ID;
        Pawn.NEXT_ID += 1;
        return pawn;
    }
    processData() { }
}

export class Dice extends Pawn {
    data = {
        rollRotations: []
    }
    
    constructor({manager, rollRotations, position, rotation, mesh, colliderShapes, moveable = true, id = null, name = null}) {
        super({
            manager: manager, name: name,
            position: position, rotation: rotation,
            mesh: mesh, colliderShapes: colliderShapes,
            moveable: moveable, id: id
        });
        this.data.rollRotations = rollRotations;
    }
    
    flip() { }
    rotate(m) { }
    shake() {
        this.selectRotation = this.data.rollRotations[Math.floor(Math.random() * this.data.rollRotations.length)];
        this.dirty.add("selectRotation");
    }
    
    static className() { return "Dice"; };
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let pawn = new Dice({
            manager: manager, name: pawnJSON.name,
            rollRotations: pawnJSON.data.rollRotations,
            position: pawnJSON.position, rotation: rotation,
            mesh: pawnJSON.mesh, colliderShapes: pawnJSON.colliderShapes,
            moveable: pawnJSON.moveable, id: pawnJSON.id
        });
        pawn.meshOffset.copy(pawnJSON.meshOffset);
        pawn.moveable = pawnJSON.moveable;
        pawn.networkSelected = pawnJSON.selected;
        pawn.selectRotation = pawnJSON.selectRotation;
        return pawn;
    }
}
