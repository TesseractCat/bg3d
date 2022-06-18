import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import Manager from './manager';
import { NetworkedTransform } from './transform';
import { MeshStandardDitheredMaterial, DepthDitheredMaterial } from './DitheredMaterials';

Math.clamp = function(x, min, max) {
    return Math.min(Math.max(x, min), max);
};
Math.clamp01 = function(x) {
    return Math.clamp(x, 0, 1);
};

// Local instance of moveable object with mesh
export class Pawn {
    static gltfLoader = new GLTFLoader().setPath(window.location.href + '/');

    // Serialized
    position = new THREE.Vector3(0,0,0);
    rotation = new THREE.Quaternion();
    data = {};
    
    selected = false;
    selectRotation = new THREE.Vector3();
    
    id;
    name;
    meshUrl;
    tint;
    
    moveable = true;
    colliderShapes;
    
    // Non-Serialized
    dirty = new Set();
    lastPosition = new THREE.Vector3();
    lastRotation = new THREE.Quaternion();
    
    networkSelected = false;
    networkTransform;

    mesh = new THREE.Object3D();
    size = new THREE.Vector3();
    hovered = false;
    selectStaticPosition;
    
    static nextId() {
        // Generate a random 52 bit integer (max safe js uint)
        // https://stackoverflow.com/a/70167319
        let [upper,lower] = new Uint32Array(Float64Array.of(Math.random()).buffer);
        upper = upper & 1048575; // upper & (2^20 - 1)
        upper = upper * Math.pow(2, 32); // upper << 32
        return upper + lower;
    }
    
    constructor({
        position = new THREE.Vector3(), rotation = new THREE.Quaternion(),
        mesh = null, colliderShapes = [], tint,
        moveable = true, id = null, name = null}) {
        
        if (id == null) {
            this.id = Pawn.nextId();
        } else {
            this.id = id;
        }
        
        this.position.copy(position); // Apply transform
        this.rotation.copy(rotation);
        this.selectRotation.copy(new THREE.Euler().setFromQuaternion(this.rotation));

        this.name = name;
        this.moveable = moveable;
        this.meshUrl = mesh;
        this.tint = tint;
        this.colliderShapes = colliderShapes;
        
        // Create new NetworkedTransform
        this.networkTransform = new NetworkedTransform(position, rotation);
    }
    initialized = false;
    init(manager) {
        this.manager = manager;

        // Load mesh
        if (this.meshUrl != null) { // GLTF URL
            Pawn.gltfLoader.load(this.meshUrl, (gltf) => {
                gltf.scene.traverse((child) => {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    if (child instanceof THREE.Mesh) {
                        if (this.tint !== undefined)
                            child.material.color.multiply(new THREE.Color(this.tint));
                        if (child.material.map !== null)
                            child.material.map.anisotropy = 4;

                        child.material = new MeshStandardDitheredMaterial().copy(child.material);
                        child.customDepthMaterial = new DepthDitheredMaterial().clone();

                        child.material.opacity = 0.0;
                        child.customDepthMaterial.uniforms.opacity.value = 0.0;
                        let fadeInInterval = setInterval(() => {
                            child.material.opacity += 6.0/60.0;
                            if (child.material.opacity >= 1) {
                                child.material.opacity = 1;
                                clearInterval(fadeInInterval);
                            }
                            child.customDepthMaterial.uniforms.opacity.value = child.material.opacity;
                        }, 1000.0/60.0);
                    }
                });

                let boundingBox = new THREE.Box3().setFromObject(gltf.scene);
                let height = boundingBox.max.y - boundingBox.min.y;
                gltf.scene.translateY(-boundingBox.min.y - 0.5 * height);

                this.mesh.add(gltf.scene);
                this.updateMeshTransform();
                this.updateBoundingBox();
            });
        } else { // Don't load GLTF
            this.updateMeshTransform();
        }

        // Add to scene
        this.manager.scene.add(this.mesh);
        this.initialized = true;
    }
    dispose() {
        this.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                for (let material of (Array.isArray(child.material) ? child.material : [child.material]))
                    material.dispose();
            }
        });
    }
    
    animate(dt) {
        if (this.selected) {
            let grabPoint = this.selectStaticPosition;
            let snapped = false;

            if (grabPoint === undefined) {
                // Raycast for movement
                let raycastablePawns = Array.from(this.manager.pawns.values()).filter(x => x != this);
                let raycastableObjects = raycastablePawns.map(x => x.mesh);
                raycastableObjects.push(this.manager.plane);
                let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);

                if (hits.length != 0) {
                    grabPoint = hits[0].point.clone();

                    let boundingBox = new THREE.Box3().setFromObject(hits[0].object);
                    grabPoint.y = boundingBox.max.y;
                }

                if (grabPoint) {
                    // Snap points
                    let snapPoints = Array.from(this.manager.pawns.values()).filter(x => x instanceof SnapPoint);

                    for (let snapPoint of snapPoints) {
                        if (snapPoint.data.snaps.length != 0 && !snapPoint.data.snaps.includes(this.name))
                            continue;
                        let snappedPoint = snapPoint.snapsTo(grabPoint);
                        if (snappedPoint) {
                            snapped = true;
                            grabPoint.x = snappedPoint.x;
                            grabPoint.z = snappedPoint.z;
                            break;
                        }
                    }
                }
            }
            if (grabPoint) {
                // Lerp
                let newPosition = this.position.clone();
                newPosition.lerp(grabPoint.clone().add(
                    new THREE.Vector3(0, this.size.y/2 + (snapped ? 0.5 : 1), 0)
                ), Math.clamp01(dt * 10));

                let newRotation = this.rotation.clone();
                newRotation.slerp(new THREE.Quaternion().setFromEuler(
                    new THREE.Euler().setFromVector3(this.selectRotation, 'ZYX')
                ), Math.clamp01(dt * 10));

                this.setPosition(newPosition);
                this.setRotation(newRotation);
            }
        }
        
        // Handle network interpolation
        this.networkTransform.animate();
        this.setPosition(
            this.position.clone().lerp(this.networkTransform.position, Math.clamp01(dt * 40)),
            false
        );
        this.setRotation(
            this.rotation.clone().slerp(this.networkTransform.rotation, Math.clamp01(dt * 40)),
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
        let entries = [
            [
                [this.name],
            ],
            [
                ["Flip", () => this.flip()],
                ["Rotate Left", () => this.rotate(2)],
                ["Rotate Right", () => this.rotate(-2)],
            ],
        ];
        let hostEntries = [
            ["Clone", () => {
                this.manager.addPawn(this.clone());
            }],
            ["Delete", () => {
                this.manager.removePawn(this.id);
            }],
        ];
        if (this.manager.host)
            entries.push(hostEntries);
        return entries;
    }
    handleEvent(data) {
        return undefined;
    }
    keyDown(e) {
        if (e.key == 'f')
            this.flip();
        if (e.key == 'q')
            this.rotate(2);
        if (e.key == 'e')
            this.rotate(-2);
        if (e.key == 'Q')
            this.rotate(1);
        if (e.key == 'E')
            this.rotate(-1);
    }
    
    grab(button) {
        // If we are trying to select something that is already selected
        if (this.networkSelected)
            return;
        
        this.selected = true;
        this.dirty.add("selected");
        //this.updateMeshTransform(); // FIXME: Needed?
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
    async selectAndRun(action, firstDelay = 100, secondDelay = 400) {
        if (this.networkSelected || !this.moveable)
            return;

        this.selected = true;
        this.selectStaticPosition = this.position.clone();
        this.dirty.add("selected");

        await new Promise(r => setTimeout(r, firstDelay));

        action();

        await new Promise(r => setTimeout(r, secondDelay));

        this.selected = false;
        this.selectStaticPosition = undefined;
        this.dirty.add("selected");
    }
    flip() {
        if (!this.selected) {
            this.selectAndRun(() => this.flip());
            return;
        }

        let tau = Math.PI * 2;
        let modRot = ((this.selectRotation.x % tau) + tau) % tau;
        this.selectRotation.x = modRot < Math.PI/2 ? Math.PI : 0;
        this.dirty.add("selectRotation");
    }
    rotate(m) {
        if (!this.selected) {
            this.selectAndRun(() => this.rotate(m));
            return;
        }

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
    updateBoundingBox() {
        let p = this.mesh.position.clone();
        let r = this.mesh.quaternion.clone();
        this.mesh.position.set(0,0,0);
        this.mesh.quaternion.identity();

        let boundingBox = new THREE.Box3().setFromObject(this.mesh);
        this.size = boundingBox.getSize(new THREE.Vector3());

        this.mesh.position.copy(p);
        this.mesh.quaternion.copy(r);
    }
    
    static className() { return "Pawn"; };
    serialize() {
        let out = this.serializeState();
        Object.assign(out, {
            class: this.constructor.className(),
            name: this.name,
            mesh: this.meshUrl, tint: this.tint,
            mass: 1.0, moveable: this.moveable,
            colliderShapes: this.colliderShapes,
            data: this.data
        });
        return out;
    }
    serializeState() {
        let rotation = new THREE.Vector3().copy(
            new THREE.Euler().setFromQuaternion(this.rotation)
        );
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
            mesh: pawnJSON.mesh, tint: pawnJSON.tint,
            colliderShapes: pawnJSON.colliderShapes,
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
        pawn.id = Pawn.nextId();
        return pawn;
    }
    processData() { }
}

export class SnapPoint extends Pawn {
    data = {
        radius: 0,
        size: new THREE.Vector2(),
        scale: 0,
        snaps: [],
    }

    constructor({radius=1, size=new THREE.Vector2(1,1), scale=1, snaps=[], ...rest}) {
        rest.moveable = false;
        rest.colliderShapes = [];
        super(rest);
        this.data.radius = radius;
        this.data.size = size;
        this.data.scale = scale;
        this.data.snaps = snaps;
    }

    snapsTo(position) {
        let halfExtents = new THREE.Vector3(this.data.size.x - 1, 0, this.data.size.y - 1).divideScalar(2.0);

        // Transform position into local space
        let localPosition = this.mesh.worldToLocal(position.clone());
        localPosition.divideScalar(this.data.scale);
        localPosition.add(halfExtents);
        let roundedPosition = localPosition.clone().round();

        let distance = localPosition.distanceTo(roundedPosition);
        if (distance < this.data.radius/this.data.scale
            && roundedPosition.x < this.data.size.x && roundedPosition.x >= 0
            && roundedPosition.y == 0
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

    menu() {
        let entries = super.menu();
        entries.splice(1, 1, [
            ["Roll", () => this.shake()]
        ]);
        return entries;
    }
    
    flip() { }
    rotate(m) { }
    shake() {
        if (!this.selected) {
            this.selectAndRun(() => this.shake());
            return;
        }

        let value = Math.floor(Math.random() * this.data.rollRotations.length);
        this.selectRotation = this.data.rollRotations[value];
        this.dirty.add("selectRotation");
    }
    
    static className() { return "Dice"; };
}
