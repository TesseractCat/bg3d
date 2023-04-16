import { Vector3, Quaternion, Object3D, Euler, Vector2, Mesh, Box3, Color } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

import Manager from './manager';
import { NetworkedTransform } from './transform';
import { MeshStandardDitheredMaterial, MeshPhongDitheredMaterial, DepthDitheredMaterial } from './DitheredMaterials';

import { Spring, Vector3Spring } from './spring';
import { AudioLoader, Audio as GlobalAudio } from 'three';

Math.clamp = function(x, min, max) {
    return Math.min(Math.max(x, min), max);
};
Math.clamp01 = function(x) {
    return Math.clamp(x, 0, 1);
};

// Local instance of moveable object with mesh
export class Pawn {
    static dracoLoader = new DRACOLoader().setDecoderPath('/static/draco/');
    static gltfLoader = new GLTFLoader()
        .setDRACOLoader(Pawn.dracoLoader)
        .setPath(window.location.href + '/assets/');
    static audioLoader = new AudioLoader().setPath(window.location.href + '/assets/');

    // Serialized
    position = new Vector3(0,0,0);
    rotation = new Quaternion();
    data = {};
    
    selected = false;
    selectRotation = new Vector3();
    
    id;
    name;
    mesh;
    tint;
    
    moveable = true;
    colliderShapes;
    
    // Non-Serialized
    dirty = new Set();
    lastPosition = new Vector3();
    lastRotation = new Quaternion();
    
    networkSelected = false;
    networkTransform;

    meshObject = new Object3D();
    size = new Vector3();
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
        position = new Vector3(), rotation = new Quaternion(),
        mesh = null, colliderShapes = [], tint,
        moveable = true, id = null, name = null
    }) {
        this.id = (id == null) ? Pawn.nextId() : id;
        
        this.position.copy(position); // Apply transform
        this.rotation.copy(rotation);
        this.selectRotation.copy(new Euler().setFromQuaternion(this.rotation));

        this.name = name;
        this.moveable = moveable;
        this.mesh = mesh;
        this.tint = tint;
        this.colliderShapes = colliderShapes;
        
        // Create new NetworkedTransform
        this.networkTransform = new NetworkedTransform(position, rotation);
    }
    initialized = false;
    init(manager) {
        this.manager = manager;

        // Load mesh
        if (this.mesh != null) { // GLTF URL
            Pawn.gltfLoader.load(this.mesh, (gltf) => {
                gltf.scene.traverse((child) => {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    if (child instanceof Mesh) {
                        if (this.tint !== undefined)
                            child.material.color.multiply(new Color(this.tint));
                        if (child.material.map !== null)
                            child.material.map.anisotropy = 4;

                        let oldMaterial = child.material;
                        if (window.isMobile) {
                            child.material = MeshPhongDitheredMaterial.fromStandard(child.material);
                        } else {
                            child.material = new MeshStandardDitheredMaterial().copy(child.material);
                        }
                        child.customDepthMaterial = new DepthDitheredMaterial().clone();
                        oldMaterial.dispose();

                        for (let material of [child.material, child.customDepthMaterial]) {
                            material.opacity = 0.0;
                            let fadeInInterval = setInterval(() => {
                                material.opacity += 6.0/60.0;
                                if (material.opacity >= 1) {
                                    material.opacity = 1;
                                    clearInterval(fadeInInterval);
                                }
                            }, 1000.0/60.0);
                        }
                    }
                });

                let boundingBox = new Box3().setFromObject(gltf.scene);
                let height = boundingBox.max.y - boundingBox.min.y;
                gltf.scene.translateY(-boundingBox.min.y - 0.5 * height);

                this.meshObject.add(gltf.scene);
                this.updateMeshTransform();
                this.updateBoundingBox();
            });
        } else { // Don't load GLTF
            this.updateMeshTransform();
        }

        // Add to scene
        this.manager.scene.add(this.meshObject);
        this.initialized = true;
    }
    dispose() {
        this.meshObject.traverse((child) => {
            if (child instanceof Mesh) {
                child.geometry.dispose();
                for (let material of (Array.isArray(child.material) ? child.material : [child.material]))
                    material.dispose();
            }
        });
    }
    
    // grabSpring = new Vector3Spring(new Vector3(0,0,0), 500, 40, 2);
    grabSpring = new Spring(0, 500, 15);
    animate(dt) {
        if (this.selected) {
            let grabPoint = this.selectStaticPosition;
            let snapped = false;

            if (grabPoint === undefined) {
                // Raycast for movement
                let raycastablePawns = Array.from(this.manager.pawns.values()).filter(x => x != this);
                let raycastableObjects = raycastablePawns.map(x => x.meshObject);
                raycastableObjects.push(this.manager.plane);
                let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);

                if (hits.length != 0) {
                    grabPoint = hits[0].point.clone();

                    let boundingBox = new Box3().setFromObject(hits[0].object);
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
                let height = this.size.y/2 + (snapped ? 0.5 : 1);
                // newPosition.copy(this.grabSpring.animateTo(
                //     grabPoint.clone().add(
                //         new Vector3(0, height, 0)
                //     ),
                //     dt
                // ));
                newPosition.lerp(grabPoint.clone().add(
                    new Vector3(0, this.grabSpring.animateTo(height, dt), 0)
                ), Math.clamp01(dt * 10));

                let newRotation = this.rotation.clone();
                newRotation.slerp(new Quaternion().setFromEuler(
                    new Euler().setFromVector3(this.selectRotation, 'ZYX')
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
                this.manager.sendAddPawn(this.clone());
            }],
            ["Delete", () => {
                this.manager.sendRemovePawn(this.id);
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
        this.manager.hand.minimize(true);

        this.grabSpring.set(this.position.y);
    }
    release(tryMerge = true) {
        this.selected = false;
        
        // Locally apply position as networked position
        this.networkTransform.flushBuffer(this.position, this.rotation);
        // Mark as dirty (so as to share that we have released)
        this.dirty.add("position");
        this.dirty.add("rotation");
        this.dirty.add("selected");
        
        this.manager.hand.minimize(false);

        // Fire merge event if applicable
        if (tryMerge) {
            let raycastablePawns = Array.from(this.manager.pawns.values()).filter(x => x != this);
            let raycastableObjects = raycastablePawns.map(x => x.meshObject);
            let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);
            if (hits[0]) {
                for (let rhs of raycastablePawns) {
                    let isParent = false;
                    rhs.meshObject.traverse((child) => {
                        if (child == hits[0].object)
                            isParent = true;
                    });
                    // Don't merge with selected pawns
                    if (isParent && !rhs.networkSelected && !rhs.selected) {
                        rhs.merge(this);
                        break;
                    }
                }
            }
        }
    }
    selectAndRunTimeout;
    async selectAndRun(action, firstDelay = 100, secondDelay = 400) {
        if (this.selected && !this.selectAndRunTimeout) {
            action();
            return;
        }
        if (this.networkSelected || !this.moveable)
            return;

        if (this.selectAndRunTimeout) {
            clearTimeout(this.selectAndRunTimeout);
            this.selectAndRunTimeout = undefined;
        } else {
            this.selected = true;
            this.selectStaticPosition = this.position.clone();
            this.dirty.add("selected");

            await new Promise(r => setTimeout(r, firstDelay));
        }

        action();

        this.selectAndRunTimeout = setTimeout(() => {
            this.selected = false;
            this.selectStaticPosition = undefined;
            this.dirty.add("selected");
            this.selectAndRunTimeout = undefined;
        }, secondDelay);
    }
    flip() {
        this.selectAndRun(() => {
            let tau = Math.PI * 2;
            let modRot = ((this.selectRotation.x % tau) + tau) % tau;
            this.selectRotation.x = modRot < Math.PI/2 ? Math.PI : 0;
            this.dirty.add("selectRotation");
        });
    }
    rotate(m) {
        this.selectAndRun(() => {
            let increment = this.manager.info?.rotationIncrement || Math.PI/8;
            this.selectRotation.y += m * increment;
            this.dirty.add("selectRotation");
        });
    }
    shake() { }
    merge(rhs) { }
    
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
        if (this.meshObject) {
            this.meshObject.position.copy(this.position);
            this.meshObject.quaternion.copy(this.rotation);
        }
    }
    updateBoundingBox() {
        let p = this.meshObject.position.clone();
        let r = this.meshObject.quaternion.clone();
        this.meshObject.position.set(0,0,0);
        this.meshObject.quaternion.identity();

        let boundingBox = new Box3().setFromObject(this.meshObject);
        this.size = boundingBox.getSize(new Vector3());

        this.meshObject.position.copy(p);
        this.meshObject.quaternion.copy(r);
    }
    
    static className() { return "Pawn"; };
    serialize() {
        let out = this.serializeState();
        Object.assign(out, {
            class: this.constructor.className(),
            name: this.name,
            mesh: this.mesh, tint: this.tint,
            mass: 1.0, moveable: this.moveable,
            colliderShapes: this.colliderShapes,
            data: this.data
        });
        return out;
    }
    serializeState() {
        let rotation = new Vector3().setFromEuler(
            new Euler().setFromQuaternion(this.rotation, 'ZYX')
        );
        return {
            id:this.id,
            selected:this.selected,
            position:this.position,
            rotation:rotation,
            selectRotation:this.selectRotation,
        };
    }
    serializeDirty() {
        let out = {id:this.id};
        for (let dirtyParam of this.dirty) {
            if (dirtyParam == "rotation") {
                out[dirtyParam] = new Vector3().setFromEuler(
                    new Euler().setFromQuaternion(this.rotation, 'ZYX')
                );
            } else {
                out[dirtyParam] = this[dirtyParam];
            }
        }
        return out;
    }
    static deserialize(serializedPawn) {
        let rotation = new Quaternion();
        if (serializedPawn.rotation)
            rotation.setFromEuler(new Euler().setFromVector3(serializedPawn.rotation, 'ZYX'));

        let pawn = new this({
            ...serializedPawn.data,
            ...serializedPawn,
            rotation: rotation,
        });
        if (serializedPawn.selected)
            pawn.networkSelected = serializedPawn.selected;
        if (serializedPawn.selectRotation)
            pawn.selectRotation = serializedPawn.selectRotation;
        return pawn;
    }
    clone(parameters) {
        // Serialize and Deserialize to clone
        let serialized = this.serialize();
        let deserialized = JSON.parse(JSON.stringify(serialized));
        deserialized.id = null;
        let pawn = this.constructor.deserialize({
            ...deserialized,
            ...parameters,
        });
        return pawn;
    }
    processData() { }
}

export class SnapPoint extends Pawn {
    data = {
        radius: 0,
        size: new Vector2(),
        scale: 0,
        snaps: [],
    }

    constructor({radius=1, size=new Vector2(1,1), scale=1, snaps=[], ...rest}) {
        rest.moveable = false;
        rest.colliderShapes = [];
        super(rest);
        this.data.radius = radius;
        this.data.size = size;
        this.data.scale = scale;
        this.data.snaps = snaps;
    }

    snapsTo(position) {
        let halfExtents = new Vector3(this.data.size.x - 1, 0, this.data.size.y - 1).divideScalar(2.0);

        // Transform position into local space
        let localPosition = this.meshObject.worldToLocal(position.clone());
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

            return this.meshObject.localToWorld(resultPosition);
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
            ["Roll", () => this.roll()]
        ]);
        return entries;
    }
    
    flip() { }
    rotate(m) { }

    shakeEnd = 0;
    shake() {
        this.shakeEnd = Date.now();
    }

    roll() {
        this.selectAndRun(() => {
            let value = Math.floor(Math.random() * this.data.rollRotations.length);
            this.selectRotation = this.data.rollRotations[value];
            this.dirty.add("selectRotation");
        });
    }

    release(tryMerge = true) {
        super.release(tryMerge);

        if (Date.now() - this.shakeEnd < 500) {
            this.roll();
        }
    }
    
    static className() { return "Dice"; };
}
