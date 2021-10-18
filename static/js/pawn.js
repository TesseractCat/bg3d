import * as THREE from 'three';
import * as CANNON from 'cannon-es'

import Manager from './manager';

// Local instance of moveable object with mesh
export class Pawn {
    position = new THREE.Vector3(0,0,0);
    rotation = new THREE.Quaternion();
    hovered = false;
    selected = false;
    selectRotation = new THREE.Euler();
    id = null;
    
    moveable = false;
    mesh;
    meshUrl;
    physicsBody;
    
    dirty = new Set();
    lastPosition = new THREE.Vector3(0,0,0);
    lastRotation = new THREE.Quaternion();
    
    networkSelected = false;
    networkPosition = new THREE.Vector3(0,0,0);
    networkRotation = new THREE.Quaternion();
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
        
        // Create and register physics body
        this.physicsBody = physicsBody;
        this.physicsBody.position.copy(position);
        this.physicsBody.quaternion.copy(rotation);
        // Disable physics for non-hosts
        if (!this.manager.host)
            this.physicsBody.type = CANNON.Body.Static
        this.manager.world.addBody(this.physicsBody);

        // Load mesh
        if (typeof mesh === 'string') { // GLTF URL
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
        } else { // Three.JS mesh
            this.meshUrl = "";
            this.mesh = mesh;
            this.manager.scene.add(this.mesh);
            this.updateMeshTransform();
        }
        
        // Apply transform
        this.position.copy(position);
        this.rotation.copy(rotation);
        this.networkPosition.copy(position);
        this.networkRotation.copy(rotation);
        
        // Events
        document.addEventListener('keydown', (e) => {
            if (this.selected) {
                if (e.key == 'f')
                    this.flip();
                if (e.key == 'q')
                    this.selectRotation.y += Math.PI/8;
                if (e.key == 'e')
                    this.selectRotation.y -= Math.PI/8;
            }
        });
        document.addEventListener('mouseshake', (e) => {
            this.shake();
        });
    }
    
    animate(dt) {
        // Follow dynamic physics body
        if (this.physicsBody.type == CANNON.Body.DYNAMIC) {
            //console.log(this.physicsBody.position);
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
            let newPosition = this.position.clone();
            newPosition.lerp(hitPoint.add(new THREE.Vector3(0, 2, 0)), dt * 10);
            let newRotation = this.rotation.clone();
            newRotation.slerp(new THREE.Quaternion().setFromEuler(this.selectRotation), dt * 10);
            this.setPosition(newPosition);
            this.setRotation(newRotation);
        }
        
        // Handle network interpolation
        if (!this.selected && (!this.manager.host || this.networkSelected)) {
            let progress = (performance.now()-this.networkLastSynced)/Manager.networkTimestep;
            progress = Math.max(Math.min(progress, 1), 0);
            
            let newPosition = this.position.clone();
            newPosition.lerp(this.networkPosition, progress);
            
            let newRotation = this.rotation.clone();
            newRotation.slerp(this.networkRotation, progress);
            
            this.setPosition(newPosition);
            this.setRotation(newRotation);
        }
        
        // When to mark pawn as 'dirty' (needs to be synced on the network)
        if (!this.dirty.has("position")) {
            if (this.manager.host || this.selected) {
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
    
    grab(button) {
        // If we are trying to select something that is already selected
        if (this.networkSelected) 
            return;
        this.selected = true;
        this.dirty.add("selected");
    }
    release() {
        this.selected = false;
        // Locally apply position as networkPosition
        this.networkPosition.copy(this.position);
        this.networkRotation.copy(this.rotation);
        // Mark as dirty (so as to share that we have released)
        this.dirty.add("selected");
    }
    flip() {
        this.selectRotation.x += Math.PI;
    }
    shake() { }
    
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
    
    serialize() {
        let out = this.serializeState();
        out.class = "Pawn";
        out.mesh = this.meshUrl;
        out.mass = this.physicsBody.mass;
        out.moveable = this.moveable;
        out.shapes = this.physicsBody.shapes.map(x => x.serialize());
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
        };
    }
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let pawn = new Pawn(manager, pawnJSON.position, rotation, pawnJSON.mesh, new CANNON.Body({
            mass: pawnJSON.mass,
            shape: new CANNON.Shape().deserialize(pawnJSON.shapes[0]) // FIXME Handle multiple shapes
        }), pawnJSON.id);
        pawn.moveable = pawnJSON.moveable;
        pawn.networkSelected = pawnJSON.selected;
        return pawn;
    }
    processData() { }
}

export class Deck extends Pawn {
    data = {
        contents: [],
        size: new THREE.Vector2()
    }
    
    static cardThickness = 0.01;//0.005;
    
    box;
    faceMaterial;
    backMaterial;
    
    constructor(manager, position, rotation, size, contents, id = null) {
        const mesh = new THREE.Object3D();
        
        super(manager, position, rotation, mesh, new CANNON.Body({
            mass: 5,
            shape: new CANNON.Box(new CANNON.Vec3(size.x/2, (Deck.cardThickness * contents.length * 1.15)/2, size.y/2))
        }), id);
        
        this.data.contents = contents;
        
        const geometry = new THREE.BoxGeometry(size.x, Deck.cardThickness * contents.length, size.y);
        const box = new THREE.Mesh(geometry);
        box.castShadow = true;
        box.receiveShadow = true;
        this.box = box;
        mesh.add(box);
        
        this.updateMaterials();
        
        this.data.size.copy(size);
    }
    
    grab(button) {
        if (button == 0) {
            super.grab();
        } else if (button == 2 && this.manager.host && this.data.contents.length > 1) {
            //Create a new deck of length 1 and grab that instead
            let cardPawn = new Deck(this.manager, new THREE.Vector3().copy(this.position).add(new THREE.Vector3(0,1,0)), this.rotation,
                this.data.size, [this.data.contents[0]]);
            
            cardPawn.moveable = true;
            this.manager.addPawn(cardPawn);
            cardPawn.grab(0);
            
            this.data.contents.shift();
            this.dirty.add("data");
            this.updateMaterials();
        }
    }
    
    updateMaterials() {
        const sideMaterial = new THREE.MeshStandardMaterial( {color: 0xcccccc} );
        this.faceMaterial = new THREE.MeshStandardMaterial( {color: 0xffffff,
            map: new THREE.TextureLoader().load(this.data.contents[0])
        });
        this.backMaterial = new THREE.MeshStandardMaterial( {color: 0xffffff,
            map: new THREE.TextureLoader().load("./images/cards/Red_back.jpg")
        });
        this.box.material = [
            sideMaterial, sideMaterial, this.faceMaterial, this.backMaterial, sideMaterial, sideMaterial
        ]
    }
    
    release() {
        super.release();
        return;
        let raycaster = new THREE.Raycaster();
        raycaster.set(this.position, new THREE.Vector3(0, -1, 0));
        let pawnMeshes = Array.from(this.manager.pawns.values()).filter(p => p.mesh).map(p => p.mesh);
        let belowPawns = raycaster.intersectObjects(pawnMeshes, true);
        if (belowPawns.length > 0) {
            let belowPawn;
            for (var i = 0; i < belowPawns.length; i++) {
                let obj = belowPawns[i].object;
                obj.traverseAncestors((a) => {
                    for (const [key, value] of this.manager.pawns) {
                        if (value.mesh == a) {
                            belowPawn = value;
                            return;
                        }
                    }
                });
                if (belowPawn != this)
                    break;
            }
            
            let newPosition = new THREE.Vector3(belowPawn.position.x, this.position.y, belowPawn.position.z);
            this.setPosition(newPosition);
        }
    }
    
    shuffle() {
        if (this.manager.host && this.data.contents.length > 1) {
            //Shuffle
            for (let i = this.data.contents.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.data.contents[i], this.data.contents[j]] = [this.data.contents[j], this.data.contents[i]];
            }
            this.updateMaterials();
            this.dirty.add("data");
        } else {
            //TODO: Ask host to shuffle
        }
    }
    
    shake() {
        super.shake();
        
        if (this.data.contents.length == 1) {
            this.flip();
        } else {
            this.shuffle();
        }
    }
    
    serialize() {
        let out = super.serialize();
        out.class = "Deck";
        out.data = this.data;
        return out;
    }
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let pawn = new Deck(manager, pawnJSON.position, rotation, pawnJSON.data.size, pawnJSON.data.contents, pawnJSON.id);
        pawn.moveable = pawnJSON.moveable;
        pawn.networkSelected = pawnJSON.selected;
        return pawn;
    }
    
    processData() {
        this.updateMaterials();
    }
}

export class Dice extends Pawn {
    data = {
        resultVectors: []
    }
    
    shake() {
        super.shake();
        this.flip();
    }
    
    serialize() {
        let out = super.serialize();
        out.class = "Dice";
        out.data = this.data;
        return out;
    }
    static deserialize(manager, pawnJSON) {
        let pawn = super.deserialize(manager, pawnJSON);
        pawn.data = pawnJSON.data;
        return pawn;
    }
}
