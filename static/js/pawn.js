import { Vector3, Quaternion, Object3D, Euler, Vector2, Mesh, Box3, Color, TextureLoader, MeshPhongMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import Manager from './manager';
import { NetworkedTransform } from './transform';

import { Spring, Vector3Spring } from './spring';
import { AudioLoader, Audio as GlobalAudio } from 'three';

import { serializationReplacer, serializationThreeTypesMixin, UniqueId } from './utils';

Math.clamp = function(x, min, max) {
    return Math.min(Math.max(x, min), max);
};
Math.clamp01 = function(x) {
    return Math.clamp(x, 0, 1);
};

export class Pawn {
    static gltfLoader = new GLTFLoader()
        .setPath(window.location.href + '/assets/');
    static textureLoader = new TextureLoader().setPath(window.location.href + '/assets/');
    static audioLoader = new AudioLoader().setPath(window.location.href + '/assets/');

    // Serialized
    position = new Vector3(0,0,0);
    rotation = new Quaternion(0,0,0,0);
    selectRotation = new Quaternion();
    data = {};
    
    selected = false;
    
    id;
    name;
    mesh;
    tint;
    texture;
    
    moveable = true;
    
    // Non-Serialized
    #lastPosition = new Vector3();
    #lastRotation = new Quaternion();
    dirty = new Set();
    
    networkSelected = false;
    networkTransform;

    #meshObject = new Object3D();
    getMesh() { return this.#meshObject }

    hovered = false;
    selectStaticPosition;

    #predicting = false;
    #velocity = new Vector3();
    
    static nextId() {
        return UniqueId();
    }
    
    constructor({
        position = new Vector3(), rotation = new Quaternion(), selectRotation = new Quaternion(),
        mesh = null, tint = 0xffffff, texture = null,
        moveable = true, id = null, name = null
    }) {
        this.id = (id == null) ? Pawn.nextId() : id;
        
        this.position.copy(position); // Apply transform
        this.rotation.copy(rotation);
        this.selectRotation.copy(selectRotation);

        this.name = name;
        this.moveable = moveable;
        this.mesh = mesh;
        this.tint = tint;
        this.texture = texture;
        
        // Create new NetworkedTransform
        this.networkTransform = new NetworkedTransform(position, rotation);
    }
    initialized = false;
    init() {
        // Load mesh
        if (this.mesh != null) { // GLTF URL
            Pawn.gltfLoader.load(this.mesh, (gltf) => {
                gltf.scene.traverse((child) => {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    if (child instanceof Mesh) {
                        child.material.color.multiply(new Color(this.tint));

                        if (child.material.map !== null) {
                            child.material.map.anisotropy = 4;
                            if (this.texture) {
                                Pawn.textureLoader.load(this.texture, (texture) => {
                                    texture.flipY = false;
                                    child.material.map = texture;
                                });
                            }
                        }

                        let mat = new MeshPhongMaterial();
                        mat.color = child.material.color;
                        mat.map = child.material.map;
                        mat.normalMap = child.material.normalMap;
                        mat.shininess = (1 - child.material.roughness) * 60;
                        mat.transparent = true;
                        child.material.dispose();
                        child.material = mat;

                        for (let material of [child.material/*, child.customDepthMaterial*/]) {
                            material.opacity = 0.0;
                            let fadeInInterval = setInterval(() => {
                                material.opacity += 6.0/60.0;
                                if (material.opacity >= 1) {
                                    material.opacity = 1;
                                    material.transparent = false;
                                    clearInterval(fadeInInterval);
                                }
                            }, 1000.0/60.0);
                        }
                    }
                });

                this.getMesh().add(gltf.scene);
                this.updateMeshTransform();
            });
        } else { // Don't load GLTF
            this.updateMeshTransform();
        }

        // Add to scene
        window.manager.scene.add(this.getMesh());
        this.initialized = true;
    }
    dispose() {
        this.getMesh().traverse((child) => {
            if (child instanceof Mesh) {
                child.geometry.dispose();
                for (let material of (Array.isArray(child.material) ? child.material : [child.material]))
                    material.dispose();
            }
        });
    }

    tick(position, rotation) {
        if (this.#predicting) {
            this.#predicting = false;
        }
        position = new Vector3().copy(position);
        rotation = new Quaternion().copy(rotation);
        this.networkTransform.tick(position, rotation);
    }
    
    // grabSpring = new Vector3Spring(new Vector3(0,0,0), 500, 40, 2);
    grabSpring = new Spring(0, 500, 15);
    #dt = 1/60;
    animate(dt) {
        this.#dt = dt;
        if (this.selected) {
            let grabPoint = this.selectStaticPosition;
            let snapped = false;

            if (!grabPoint) {
                // Raycast for movement
                let raycastablePawns = Array.from(window.manager.pawns.values()).filter(x => x != this);
                let raycastableObjects = raycastablePawns.map(x => x.getMesh());
                raycastableObjects.push(window.manager.plane);
                let hits = window.manager.raycaster.intersectObjects(raycastableObjects, true);

                if (hits.length != 0) {
                    grabPoint = hits[0].point.clone();

                    let boundingBox = new Box3().setFromObject(hits[0].object);
                    grabPoint.y = boundingBox.max.y;
                }

                if (grabPoint) {
                    // Snap points
                    let snapPoints = Array.from(window.manager.pawns.values()).filter(x => x instanceof SnapPoint);

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
                // FIXME: Rotate around center of bounding box?
                let newPosition = this.position.clone();
                let bottomOffset = 0;
                if (this.getMesh().children.length != 0) {
                    // Insert this check because if the mesh hasn't loaded, the bounding box min is Infinity
                    bottomOffset = new Box3().setFromObject(this.getMesh()).min.y - this.getMesh().position.y;
                }
                let height = -bottomOffset + (snapped ? 0.5 : 1);
                
                newPosition.lerp(grabPoint.clone().add(
                    new Vector3(0, this.grabSpring.animateTo(height, dt), 0)
                ), Math.clamp01(dt * 10));

                let newRotation = this.rotation.clone();
                newRotation.slerp(this.selectRotation.normalize(), Math.clamp01(dt * 10));

                this.setPosition(newPosition);
                this.setRotation(newRotation);
            }
        }
        
        // Handle network interpolation
        if (this.#predicting) {
            // Incredibly basic "physics" for simple client side prediction
            // Predict at half (dt/2) speed, because the server will only start simulating after RTT/2
            // ideally once we're done predicting we'll be exactly matched with the server
            this.#velocity.multiplyScalar(0.9); // Drag
            this.#velocity.add(new Vector3(0, -9.8 * 8, 0).multiplyScalar(dt/2)); // Gravity
            this.position.add(this.#velocity.clone().multiplyScalar(dt/2));
            this.networkTransform.tick(this.position, this.rotation);
            this.updateMeshTransform();
        } else {
            this.networkTransform.animate();
            this.setPosition(
                this.position.clone().lerp(this.networkTransform.position, Math.clamp01(dt * 40)),
                false
            );
            this.setRotation(
                this.rotation.clone().slerp(this.networkTransform.rotation, Math.clamp01(dt * 40)),
                false
            );
        }
        
        // When to mark pawn as 'dirty' (needs to be synced on the network)
        if (!this.dirty.has("position") && this.selected) {
            if (this.position.distanceToSquared(this.#lastPosition) > 0.01 ||
                this.rotation.angleTo(this.#lastRotation) > 0.01) {

                this.dirty.add("position");
                this.dirty.add("rotation");

                this.#lastPosition.copy(this.position);
                this.#lastRotation.copy(this.rotation);
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
                let tempClone = this.clone();
                tempClone.position.add(new Vector3(
                    0, new Box3().setFromObject(this.getMesh()).getSize(new Vector3()).y + 0.5, 0
                ));
                window.manager.sendAddPawn(tempClone);
            }],
            ["Delete", () => {
                window.manager.sendRemovePawn(this.id);
            }],
        ];
        if (window.manager.host)
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
        window.manager.hand.minimize(true, this.constructor.className() == "Deck");

        this.grabSpring.set(this.position.y);
    }
    release(tryMerge = true) {
        this.selected = false;
        this.#predicting = true;
        this.#velocity = this.position.clone().sub(this.#lastPosition).divideScalar(this.#dt).divideScalar(2);
        
        // Locally apply position as networked position
        this.networkTransform.flushBuffer(this.position, this.rotation);
        // Mark as dirty (so as to share that we have released)
        this.dirty.add("position");
        this.dirty.add("rotation");
        this.dirty.add("selected");

        window.manager.hand.minimize(false, this.constructor.className() == "Deck");

        // Fire merge event if applicable
        if (tryMerge) {
            let raycastablePawns = Array.from(window.manager.pawns.values()).filter(x => x != this);
            let raycastableObjects = raycastablePawns.map(x => x.getMesh());
            let hits = window.manager.raycaster.intersectObjects(raycastableObjects, true);
            if (hits[0]) {
                for (let rhs of raycastablePawns) {
                    let isParent = false;
                    rhs.getMesh().traverse((child) => {
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
            this.selectStaticPosition = this.position.clone().setComponent(1,
                new Box3().setFromObject(this.getMesh()).min.y
            );
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
            this.selectRotation.normalize().multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0), Math.PI));
            this.dirty.add("selectRotation");
        });
    }
    rotate(m) {
        this.selectAndRun(() => {
            let increment = window.manager.info?.rotationIncrement || Math.PI/8;
            this.selectRotation.normalize().premultiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0), m * increment));
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
        if (this.getMesh()) {
            this.getMesh().position.copy(this.position);
            this.getMesh().quaternion.copy(this.rotation);
        }
    }
    
    static className() { return "Pawn"; };
    serialize() {
        let out = structuredClone(this);
        out.class = this.constructor.className();
        // Probably should just write a function to apply this replacement
        return JSON.parse(JSON.stringify(out, serializationThreeTypesMixin));
    }
    serializeDirty() {
        let out = {id:this.id};
        for (let dirtyParam of this.dirty) {
            out[dirtyParam] = structuredClone(this[dirtyParam]);
        }
        if (this.dirty.has("data"))
            out.class = this.constructor.className();

        return JSON.parse(JSON.stringify(out, serializationThreeTypesMixin));
    }
    static deserialize(serializedPawn) {
        let pawn = new this({
            ...serializedPawn,
            ...serializedPawn.data,
        });

        if (serializedPawn.selected)
            pawn.networkSelected = serializedPawn.selected;
        return pawn;
    }
    clone(parameters) {
        // Serialize and Deserialize to clone
        let serialized = this.serialize();
        serialized.id = null;
        let pawn = this.constructor.deserialize({...serialized, ...serialized.data, ...parameters});
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
        super(rest);
        this.data.radius = radius;
        this.data.size = size;
        this.data.scale = scale;
        this.data.snaps = snaps;
    }

    snapsTo(position) {
        let halfExtents = new Vector3(this.data.size.x - 1, 0, this.data.size.y - 1).divideScalar(2.0);

        // Transform position into local space
        let localPosition = this.getMesh().worldToLocal(position.clone());
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

            return this.getMesh().localToWorld(resultPosition);
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
        this.roll();
    }

    roll() {
        this.selectAndRun(() => {
            let value = Math.floor(Math.random() * this.data.rollRotations.length);
            this.selectRotation.copy(this.data.rollRotations[value]);
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
