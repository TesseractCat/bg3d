import * as THREE from 'three';

import { ExtrudeGeometry } from './ExtrudeGeometryFB';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';

import Manager from './manager';
import { Pawn } from './pawn';
import { Box } from './shapes.js';

export class Deck extends Pawn {
    data = {
        contents: [],
        back: "",
        sideColor: 0,
        cornerRadius: 0,
        size: new THREE.Vector2()
    }
    
    static cardThickness = 0.01;
    static textureCache = new Map();
    static textureLoader = new THREE.TextureLoader().setPath("../games/");
    
    box;
    faceMaterial;
    backMaterial;
    
    constructor({contents, back, sideColor = 0xcccccc, size, cornerRadius = 0.02, ...rest}) {
        rest.colliderShapes = [
            new Box(new THREE.Vector3(size.x/2, (Deck.cardThickness * contents.length * 1.15)/2, size.y/2))
        ];
        super(rest);
        
        this.data.contents = contents;
        this.data.back = back;
        this.data.sideColor = sideColor;
        this.data.cornerRadius = cornerRadius;
        this.data.size.copy(size);
        
        const roundedSquare = this.#roundedSquare(cornerRadius);
        const extrudeSettings = {
            steps:1,
            depth:1,
            bevelEnabled: false,
        };
        
        let geometry = new ExtrudeGeometry(roundedSquare, extrudeSettings);//new THREE.BoxGeometry(1,1,1);
        geometry.deleteAttribute('normal');
        geometry = BufferGeometryUtils.mergeVertices(geometry);
        geometry.computeVertexNormals();
        
        const box = new THREE.Mesh(geometry);
        box.castShadow = true;
        box.receiveShadow = true;
        box.scale.set(1, -1, 1);
        box.position.set(-0.5, 0.5, 0.5);
        box.quaternion.setFromEuler(new THREE.Euler(Math.PI/2, 0, 0));
        
        this.box = box;
        this.mesh.scale.copy(new THREE.Vector3(size.x, Deck.cardThickness * contents.length, size.y));
        this.mesh.add(box);
        
        if (this.data.back != null)
            this.loadTexture(this.data.back);
        
        this.updateDeck();
    }
    #roundedSquare(radius) {
        let shape = new THREE.Shape();
        let width = 1;
        let height = 1;
        let x = 0;
        let y = 0;
        shape.moveTo(x, y + radius);
        shape.lineTo(x, y + height - radius);
        shape.quadraticCurveTo(x, y + height, x + radius, y + height);
        shape.lineTo(x + width - radius, y + height);
        shape.quadraticCurveTo(x + width, y + height, x + width, y + height - radius);
        shape.lineTo(x + width, y + radius);
        shape.quadraticCurveTo(x + width, y, x + width - radius, y);
        shape.lineTo(x + radius, y);
        shape.quadraticCurveTo(x, y, x, y + radius);
        return shape;
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
        let cardPawn = new Deck({
            manager: this.manager, name: this.name,
            contents: [this.data.contents[idx]], back: this.data.back,
            sideColor: this.data.sideColor, cornerRadius: this.data.cornerRadius,
            position: new THREE.Vector3().copy(this.position).add(new THREE.Vector3(0,1,0)), rotation: this.rotation,
            size: this.data.size
        });
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
            if (belowPawn != this // Not us :)
                && belowPawn.constructor.name == this.constructor.name // Both are Decks
                && belowPawn.name == this.name // ...of the same type
                && belowPawn.flipped() == this.flipped()) { // ...and are flipped the same direction
                
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

        this.colliderShapes[0].halfExtents.setComponent(
            1, Math.max(thickness, Deck.cardThickness * 10)/2,
        );
        this.dirty.add("colliderShapes");
        
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
        
        // Apply new materials
        const sideMaterial = new THREE.MeshStandardMaterial({color: this.data.sideColor});
        this.faceMaterial = new THREE.MeshStandardMaterial({color: 0xffffff,
            map: faceTexture
        });
        this.backMaterial = new THREE.MeshStandardMaterial({color: 0xffffff,
            map: backTexture
        });
        this.box.material = [
            this.faceMaterial, sideMaterial, this.backMaterial
        ];
    }
    
    shuffle() {
        console.assert(this.manager.host);
        if (this.data.contents.length > 1) {
            //Shuffle
            //this.data.contents = arrayShuffle(this.data.contents);
            //https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
            for (let i = this.data.contents.length - 1; i >= 0; i--) {
                let j = Math.floor(Math.random() * (i + 1));
                [this.data.contents[j], this.data.contents[i]]
                    = [this.data.contents[i], this.data.contents[j]];
            }
            this.updateDeck();
            this.dirty.add("data");
        }
    }
    
    flip() {
        if (this.data.back != null)
            super.flip();
    }
    shake() {
        this.manager.sendEvent("pawn", true, {id: this.id, name: "shuffle"});
    }
    flipped() {
        return Math.abs(this.selectRotation.x - Math.PI) < 0.01;
    }
    
    static className() { return "Deck"; };
    static deserialize(pawnJSON) {
        let rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        let pawn = new Deck({
            name: pawnJSON.name,
            
            contents: pawnJSON.data.contents, back: pawnJSON.data.back,
            sideColor: pawnJSON.data.sideColor, cornerRadius: pawnJSON.data.cornerRadius,
            
            position: pawnJSON.position, rotation: rotation, size: pawnJSON.data.size,
            moveable: pawnJSON.moveable, id: pawnJSON.id
        });
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
    
    constructor({holds, ...rest}) {
        super(rest);
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
        let item = this.manager.loadPawn(this.data.holds).clone();
        // FIXME: Update networkTransform or something
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
    
    static className() { return "Container"; };
    static deserialize(pawnJSON) {
        let pawn = super.deserialize(pawnJSON);
        pawn.data.holds = pawnJSON.data.holds;
        return pawn;
    }
}
