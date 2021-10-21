import * as THREE from 'three';
import * as CANNON from 'cannon-es'

import Manager from './manager';
import arrayShuffle from 'array-shuffle';

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
        
        // Events
        document.addEventListener('keydown', (e) => {
            if (this.selected) {
                if (e.key == 'f')
                    this.flip();
                if (e.key == 'q')
                    this.rotate(1);
                if (e.key == 'e')
                    this.rotate(-1);
            }
        });
        document.addEventListener('mouseshake', (e) => {
            if (this.selected)
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
            if (hitPoint != undefined) {
                let newPosition = this.position.clone();
                newPosition.lerp(hitPoint.add(new THREE.Vector3(0, 2, 0)), dt * 10);
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
    
    grab(button) {
        // If we are trying to select something that is already selected
        if (this.networkSelected) 
            return;
        this.selected = true;
        this.dirty.add("selected");
    }
    release() {
        this.selected = false;
        // Locally apply position as networked position
        this.flushBuffer(this.position, this.rotation);
        // Mark as dirty (so as to share that we have released)
        this.dirty.add("position");
        this.dirty.add("rotation");
        this.dirty.add("selected");
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
            selectRotation:this.selectRotation,
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
        pawn.selectRotation = pawnJSON.selectRotation;
        return pawn;
    }
    processData() { }
}

export class Deck extends Pawn {
    data = {
        name: "",
        contents: [],
        size: new THREE.Vector2()
    }
    
    static cardThickness = 0.01;//0.005;
    static textureCache = new Map();
    static textureLoader = new THREE.TextureLoader().setPath("../games/");
    
    box;
    faceMaterial;
    backMaterial;
    
    constructor(manager, name, position, rotation, size, contents, id = null) {
        const mesh = new THREE.Object3D();
        mesh.scale.copy(new THREE.Vector3(size.x, Deck.cardThickness * contents.length, size.y));
        
        super(manager, position, rotation, mesh, new CANNON.Body({
            mass: 5,
            shape: new CANNON.Box(new CANNON.Vec3(size.x/2, (Deck.cardThickness * contents.length * 1.15)/2, size.y/2))
        }), id);
        
        this.data.name = name;
        this.data.contents = contents;
        
        const geometry = new THREE.BoxGeometry(1,1,1);
        const box = new THREE.Mesh(geometry);
        box.castShadow = true;
        box.receiveShadow = true;
        this.box = box;
        mesh.add(box);
        
        Deck.textureCache.set("generic/cards_k/cardBack_red5.png",
            Deck.textureLoader.load("generic/cards_k/cardBack_red5.png"));
        
        this.updateDeck();
        
        this.data.size.copy(size);
    }
    
    handleEvent(data) {
        let out = super.handleEvent(data);
        switch (data.name) {
            case "try_merge":
                this.tryMerge();
                break;
            case "grab_card":
                let card = this.spawnCard();
                out = card.id;
                break;
            case "shuffle":
                this.shuffle();
                break;
        }
        return out;
    }
    
    spawnCard() {
        //Create a new deck of length 1 and grab that instead
        let idx = this.flipped() ? this.data.contents.length - 1 : 0;
        let cardPawn = new Deck(this.manager, this.data.name, new THREE.Vector3().copy(this.position).add(new THREE.Vector3(0,1,0)), this.rotation,
            this.data.size, [this.data.contents[idx]]);
        cardPawn.moveable = true;
        cardPawn.selectRotation = Object.assign({}, this.selectRotation);
        
        this.manager.addPawn(cardPawn);
        
        this.data.contents.splice(idx, 1);
        this.dirty.add("data");
        // Flush dirty and prevent race condition
        // (where you could grab and put down in the same tick, causing the contents to be synced out of order)
        this.manager.tick();
        
        this.updateDeck();
        
        return cardPawn;
    }
    tryMerge() {
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
            if (belowPawn != this
                && belowPawn.constructor.name == this.constructor.name
                && belowPawn.data.name == this.data.name
                && belowPawn.flipped() == this.flipped()) {
                
                if (this.flipped()) {
                    belowPawn.data.contents = [...belowPawn.data.contents, ...this.data.contents];
                } else {
                    belowPawn.data.contents = [...this.data.contents, ...belowPawn.data.contents];
                }
                belowPawn.dirty.add("data");
                this.manager.tick();
                this.manager.socket.send(JSON.stringify({
                    type:"remove_pawns",
                    pawns:[this.id]
                }));
                belowPawn.updateDeck();
            }
        }
    }
    grab(button) {
        if (this.selected || this.networkSelected)
            return;
        if (button == 0 || this.data.contents.length == 1) {
            super.grab();
        } else if (button == 2 && this.data.contents.length > 1) {
            this.manager.sendEvent("pawn", true, {id: this.id, name: "grab_card"}, (card_id) => {
                this.updateDeck();
                this.manager.pawns.get(card_id).grab(0);
            });
        }
    }
    release() {
        this.manager.sendEvent("pawn", true, {id: this.id, name: "try_merge"});
        super.release();
    }
    
    updateDeck() {
        // Resize
        let thickness = Deck.cardThickness * this.data.contents.length;
        this.mesh.scale.setComponent(1, thickness);
        this.physicsBody.shapes[0].halfExtents.set(
            this.physicsBody.shapes[0].halfExtents.x,
            (Math.max(thickness, Deck.cardThickness * 10) * 1.15)/2,
            this.physicsBody.shapes[0].halfExtents.z);
        this.physicsBody.shapes[0].updateConvexPolyhedronRepresentation();
        this.physicsBody.shapes[0].updateBoundingSphereRadius();
        this.physicsBody.updateBoundingRadius();
        
        // Load textures
        let faceTexture;
        if (!Deck.textureCache.has(this.data.contents[0])) {
            Deck.textureCache.set(this.data.contents[0],
                Deck.textureLoader.load(this.data.contents[0]));
        }
        faceTexture = Deck.textureCache.get(this.data.contents[0]);
        let backTexture = Deck.textureCache.get("generic/cards_k/cardBack_red5.png");
        //faceTexture.generateMipmaps = false;
        //faceTexture.magFilter = THREE.LinearFilter;
        //faceTexture.minFilter = THREE.LinearFilter;
        
        // Apply new materials
        const sideMaterial = new THREE.MeshStandardMaterial( {color: 0xcccccc} );
        this.faceMaterial = new THREE.MeshStandardMaterial( {color: 0xffffff,
            map: faceTexture
        });
        this.backMaterial = new THREE.MeshStandardMaterial( {color: 0xffffff,
            map: backTexture
        });
        this.box.material = [
            sideMaterial, sideMaterial, this.faceMaterial, this.backMaterial, sideMaterial, sideMaterial
        ];
    }
    
    shuffle() {
        console.assert(this.manager.host);
        if (this.data.contents.length > 1) {
            //Shuffle
            this.data.contents = arrayShuffle(this.data.contents);
            this.updateDeck();
            this.dirty.add("data");
        }
    }
    
    shake() {
        this.manager.sendEvent("pawn", true, {id: this.id, name: "shuffle"});
    }
    flipped() {
        return Math.abs(this.selectRotation.x - Math.PI) < 0.01;
    }
    
    serialize() {
        let out = super.serialize();
        out.class = "Deck";
        out.data = this.data;
        return out;
    }
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let pawn = new Deck(manager, pawnJSON.data.name, pawnJSON.position, rotation, pawnJSON.data.size, pawnJSON.data.contents, pawnJSON.id);
        pawn.moveable = pawnJSON.moveable;
        pawn.networkSelected = pawnJSON.selected;
        pawn.selectRotation = pawnJSON.selectRotation;
        pawn.data = pawnJSON.data;
        pawn.processData();
        return pawn;
    }
    
    processData() {
        this.updateDeck();
    }
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
        let pawn = super.deserialize(manager, pawnJSON);
        pawn.data = pawnJSON.data;
        return pawn;
    }
}
