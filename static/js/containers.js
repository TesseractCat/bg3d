import * as THREE from 'three';
import * as CANNON from 'cannon-es'

import Manager from './manager';
import { Pawn } from './pawn';
import arrayShuffle from 'array-shuffle';

export class Deck extends Pawn {
    data = {
        name: "",
        contents: [],
        back: "",
        size: new THREE.Vector2()
    }
    
    static cardThickness = 0.01;//0.005;
    static textureCache = new Map();
    static textureLoader = new THREE.TextureLoader().setPath("../games/");
    
    box;
    faceMaterial;
    backMaterial;
    
    constructor(manager, name, contents, back,
        position, rotation, size, moveable = true, id = null) {
        
        super(manager, position, rotation, null, new CANNON.Body({
            mass: 5,
            shape: new CANNON.Box(new CANNON.Vec3(size.x/2, (Deck.cardThickness * contents.length * 1.15)/2, size.y/2))
        }), moveable, id);
        
        this.data.name = name;
        this.data.contents = contents;
        this.data.back = back;
        
        const geometry = new THREE.BoxGeometry(1,1,1);
        const box = new THREE.Mesh(geometry);
        box.castShadow = true;
        box.receiveShadow = true;
        this.box = box;
        this.box.scale.copy(new THREE.Vector3(size.x, Deck.cardThickness * contents.length, size.y));
        this.mesh.add(box);
        
        if (this.data.back != null)
            this.loadTexture(this.data.back);
        
        this.updateDeck();
        
        this.data.size.copy(size);
    }
    
    animate(dt) {
        super.animate(dt);
        if (this.flipped() && !this.faceMaterial.color.equals(new THREE.Color(0x000000))) {
            this.faceMaterial.color = new THREE.Color(0x000000);
        } else if (!this.flipped() && this.faceMaterial.color.equals(new THREE.Color(0x000000))) {
            this.faceMaterial.color = new THREE.Color(0xffffff);
        }
    }
    
    loadTexture(texture) {
        let t = Deck.textureLoader.load(texture);
        t.encoding = THREE.sRGBEncoding;
        Deck.textureCache.set(texture, t);
    }
    
    keyDown(e) {
        super.keyDown(e);
        if (e.key == "g" && this.data.contents.length == 1) {
            super.release();
            this.manager.sendEvent("pawn", true, {id: this.id, name: "remove"}, () => {
                this.manager.hand.pushCard(this);
                //console.log(this.manager.hand);
            });
        }
    }
    handleEvent(data) {
        let out = super.handleEvent(data);
        switch (data.name) {
            case "try_merge":
                this.tryMerge();
                break;
            case "remove":
                this.manager.socket.send(JSON.stringify({
                    type:"remove_pawns",
                    pawns:[this.id]
                }));
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
        let cardPawn = new Deck(this.manager, this.data.name, [this.data.contents[idx]], this.data.back,
            new THREE.Vector3().copy(this.position).add(new THREE.Vector3(0,1,0)), this.rotation, this.data.size);
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
        this.box.scale.setComponent(1, thickness);
        this.physicsBody.shapes[0].halfExtents.set(
            this.physicsBody.shapes[0].halfExtents.x,
            (Math.max(thickness, Deck.cardThickness * 10) * 1.15)/2,
            this.physicsBody.shapes[0].halfExtents.z);
        this.physicsBody.shapes[0].updateConvexPolyhedronRepresentation();
        this.physicsBody.shapes[0].updateBoundingSphereRadius();
        this.physicsBody.updateBoundingRadius();
        
        // Load textures
        let faceTexture;
        if (!Deck.textureCache.has(this.data.contents[0]))
            this.loadTexture(this.data.contents[0]);
        if (!Deck.textureCache.has(this.data.contents[this.data.contents.length - 1]))
            this.loadTexture(this.data.contents[this.data.contents.length - 1]);
        faceTexture = Deck.textureCache.get(this.data.contents[0]);
        let backTexture = this.data.back != null ?
            Deck.textureCache.get(this.data.back) :
            Deck.textureCache.get(this.data.contents[this.data.contents.length - 1]);
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
        let pawn = new Deck(manager, pawnJSON.data.name, pawnJSON.data.contents, pawnJSON.data.back,
            pawnJSON.position, rotation, pawnJSON.data.size, pawnJSON.moveable, pawnJSON.id);
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

export class Container extends Pawn {
    data = {
        holds: {}
    }
    
    constructor(manager, holds, position, rotation, mesh, physicsBody, moveable = true, id = null) {
        super(manager, position, rotation, mesh, physicsBody, moveable, id);
        this.data.holds = holds;
    }
    
    flip() { }
    
    handleEvent(data) {
        let out = super.handleEvent(data);
        switch (data.name) {
            case "grab_item":
                let item = this.spawnItem();
                out = item.id;
                break;
        }
        return out;
    }
    
    spawnItem() {
        /*//Create a new deck of length 1 and grab that instead
        let idx = this.flipped() ? this.data.contents.length - 1 : 0;
        let cardPawn = new Deck(this.manager, this.data.name, new THREE.Vector3().copy(this.position).add(new THREE.Vector3(0,1,0)), this.rotation,
            this.data.size, [this.data.contents[idx]], this.data.back);
        cardPawn.moveable = true;
        cardPawn.selectRotation = Object.assign({}, this.selectRotation);
        
        this.manager.addPawn(cardPawn);
        
        this.data.contents.splice(idx, 1);
        this.dirty.add("data");
        // Flush dirty and prevent race condition
        // (where you could grab and put down in the same tick, causing the contents to be synced out of order)
        this.manager.tick();
        
        this.updateDeck();
        
        return cardPawn;*/
        
        let item = this.manager.loadPawn(this.data.holds).clone();
        item.setPosition(this.position.clone().add(new THREE.Vector3(0, 2, 0)));
        this.manager.addPawn(item);
        
        return item;
    }
    grab(button) {
        if (this.selected || this.networkSelected)
            return;
        if (button == 0) {
            super.grab();
        } else if (button == 2) {
            this.manager.sendEvent("pawn", true, {id: this.id, name: "grab_item"}, (item_id) => {
                this.manager.pawns.get(item_id).grab(0);
            });
        }
    }
    
    serialize() {
        let out = super.serialize();
        out.class = "Container";
        out.data = this.data;
        return out;
    }
    static deserialize(manager, pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let physicsBody = new CANNON.Body({
            mass: pawnJSON.mass,
            shape: new CANNON.Shape().deserialize(pawnJSON.shapes[0]) // FIXME Handle multiple shapes
        });
        let pawn = new Container(manager, pawnJSON.data.holds,
            pawnJSON.position, rotation, pawnJSON.mesh, physicsBody, pawnJSON.moveable, pawnJSON.id);
        pawn.meshOffset.copy(pawnJSON.meshOffset);
        pawn.networkSelected = pawnJSON.selected;
        pawn.selectRotation = pawnJSON.selectRotation;
        return pawn;
    }
}
