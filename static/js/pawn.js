import * as THREE from 'three';

import Manager from './manager';
import { NetworkedTransform } from './transform';

// Local instance of moveable object with mesh
export class Pawn {
    // Serialized
    position = new THREE.Vector3(0,0,0);
    rotation = new THREE.Quaternion();
    data = {};
    
    selectRotation = new THREE.Vector3();
    
    id;
    name;
    meshUrl;
    
    moveable = true;
    colliderShapes;
    
    // Non-Serialized
    dirty = new Set();
    lastPosition = new THREE.Vector3();
    lastRotation = new THREE.Quaternion();
    
    networkSelected = false;
    networkTransform;

    mesh = new THREE.Object3D();
    boundingBox = new THREE.Box3();
    hovered = false;
    selected = false;
    
    static NEXT_ID = 0;
    
    constructor({position = new THREE.Vector3(), rotation = new THREE.Quaternion(),
        mesh = null, colliderShapes = [], moveable = true, id = null, name = null}) {
        
        if (id == null) {
            this.id = Pawn.NEXT_ID;
            Pawn.NEXT_ID += 1;
        } else {
            this.id = id;
        }
        
        this.position.copy(position); // Apply transform
        this.rotation.copy(rotation);
        this.selectRotation.copy(new THREE.Euler().setFromQuaternion(this.rotation));

        this.name = name;
        this.moveable = moveable;
        this.meshUrl = mesh;
        this.colliderShapes = colliderShapes;
        
        // Create new NetworkedTransform
        this.networkTransform = new NetworkedTransform(position, rotation);
    }
    initialized = false;
    init(manager) {
        this.manager = manager;

        // Load mesh
        if (this.meshUrl != null) { // GLTF URL
            this.manager.loader.load(this.meshUrl, (gltf) => {
                gltf.scene.traverse(function (child) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                });

                this.boundingBox = new THREE.Box3().setFromObject(gltf.scene);
                let size = this.boundingBox.getSize(new THREE.Vector3());
                gltf.scene.translateY(-this.boundingBox.min.y - 0.5 * size.y);

                this.mesh.add(gltf.scene);
                this.updateMeshTransform();
            });
        } else { // Don't load GLTF
            this.updateMeshTransform();
        }

        // Add to scene
        this.manager.scene.add(this.mesh);
        this.initialized = true;
    }
    
    animate(dt) {
        if (this.selected) {
            // Raycast for movement
            let raycastableObjects = Array.from(this.manager.pawns.values()).filter(x => x != this).map(x => x.mesh);
            raycastableObjects.push(this.manager.plane);
            let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);
            
            let hitPoint;
            for (var i = 0; i < hits.length; i++) {
                if (hits[i].object != this.mesh) {
                    let hitBox = new THREE.Box3().setFromObject(hits[i].object);
                    hitPoint = hits[i].point.clone();
                    hitPoint.y = hitBox.max.y;
                    break;
                }
            }
            if (hitPoint) {
                // Snap points
                let snapPoints = Array.from(this.manager.pawns.values()).filter(x => x instanceof SnapPoint);
                let snapped = false;

                for (let snapPoint of snapPoints) {
                    let snappedPoint = snapPoint.snapsTo(hitPoint);
                    if (snappedPoint) {
                        snapped = true;
                        hitPoint.copy(snappedPoint);
                        break;
                    }
                }

                // Lerp
                let newPosition = this.position.clone();
                let height = this.boundingBox.getSize(new THREE.Vector3()).y;
                newPosition.lerp(hitPoint.clone().add(
                    new THREE.Vector3(0, height/2 + (snapped ? 0.5 : 2), 0)
                ), dt * 10);

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
    
    menu() {
        let commonEntries = [
            [this.name],
            [],
            ["Flip", () => {}],
            ["Rotate Left", () => {}],
            ["Rotate Right", () => {}],
        ];
        let hostEntries = [
            [],
            ["Clone", () => {
                this.manager.addPawn(this.clone());
            }],
            ["Delete", () => {
                this.manager.removePawn(this.id);
            }],
        ];
        let entries = commonEntries;
        if (this.manager.host)
            entries = entries.concat(hostEntries);
        return entries;
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
        }
    }
    
    static className() { return "Pawn"; };
    serialize() {
        let out = this.serializeState();
        Object.assign(out, {
            class: this.constructor.className(),
            name: this.name,
            mesh: this.meshUrl,
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
    static deserialize(pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let pawn = new this({
            name: pawnJSON.name,
            position: pawnJSON.position, rotation: rotation,
            mesh: pawnJSON.mesh, colliderShapes: pawnJSON.colliderShapes,
            moveable: pawnJSON.moveable, id: pawnJSON.id
        });
        pawn.networkSelected = pawnJSON.selected;
        pawn.selectRotation = pawnJSON.selectRotation;
        pawn.data = pawnJSON.data;
        return pawn;
    }
    clone() {
        // Serialize and Deserialize to clone
        let serialized = this.serialize();
        let serializedJSON = JSON.stringify(serialized);
        let pawn = this.constructor.deserialize(JSON.parse(serializedJSON));
        // Increment ID
        pawn.id = Pawn.NEXT_ID;
        Pawn.NEXT_ID += 1;
        return pawn;
    }
    processData() { }
}

export class SnapPoint extends Pawn {
    data = {
        radius: 0,
        size: new THREE.Vector2(),
        scale: 0,
    }

    constructor({radius=1, size=new THREE.Vector2(1,1), scale=1, ...rest}) {
        rest.moveable = false;
        rest.colliderShapes = [];
        super(rest);
        this.data.radius = radius;
        this.data.size = size;
        this.data.scale = scale;
    }

    snapsTo(position) {
        let halfExtents = new THREE.Vector3(this.data.size.x - 1, 0, this.data.size.y - 1).divideScalar(2.0);

        // Transform position into local space
        let localPosition = this.mesh.worldToLocal(position.clone());
        localPosition.divideScalar(this.data.scale);
        localPosition.add(halfExtents);
        // Round to nearest half: 0.5, 1.5, 2.5, ... 
        let roundedPosition = localPosition.clone().round();

        let distance = localPosition.distanceTo(roundedPosition);
        if (distance < this.data.radius/this.data.scale
            && roundedPosition.x < this.data.size.x && roundedPosition.x >= 0
            && roundedPosition.z < this.data.size.y && roundedPosition.z >= 0) {

            // Transform rounded position back into object space
            let resultPosition = roundedPosition.clone();
            resultPosition.sub(halfExtents);
            resultPosition.multiplyScalar(this.data.scale);

            return this.mesh.localToWorld(resultPosition);
        }
    }

    static className() { return "SnapPoint"; };
}

export class Dice extends Pawn {
    data = {
        rollRotations: []
    }
    
    constructor({rollRotations, ...rest}) {
        super(rest);
        this.data.rollRotations = rollRotations;
    }
    
    flip() { }
    rotate(m) { }
    shake() {
        this.selectRotation = this.data.rollRotations[Math.floor(Math.random() * this.data.rollRotations.length)];
        this.dirty.add("selectRotation");
    }
    
    static className() { return "Dice"; };
}
