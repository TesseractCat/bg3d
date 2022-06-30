import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';

import { ExtrudeGeometry } from './ExtrudeGeometryFB';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { MeshStandardDitheredMaterial, DepthDitheredMaterial } from './DitheredMaterials';

import Manager from './manager';
import { Pawn } from './pawn';
import { Box } from './shapes.js';

export class Deck extends Pawn {
    static textureCache = new Map();
    static textureLoader = new THREE.TextureLoader().setPath(window.location.href + '/');
    static svgLoader = new SVGLoader().setPath(window.location.href + '/');

    data = {
        contents: [],
        back: null,
        sideColor: 0,

        border: null,
        cornerRadius: 0,
        cardThickness: 0,
        size: new THREE.Vector2()
    }
    
    box;

    faceMaterial;
    backMaterial;
    sideMaterial;
    sideTexture;
    
    constructor({contents = [], back = null, sideColor = 0xcccccc,
                 size = new THREE.Vector2(), border = null, cornerRadius = 0.02, cardThickness = 0.01,
                 ...rest}) {
        rest.colliderShapes = [
            new Box(new THREE.Vector3(size.x/2, (cardThickness * contents.length * 1.15)/2, size.y/2))
        ];
        super(rest);
        
        this.data.contents = contents;
        this.data.back = back;
        this.data.sideColor = sideColor;

        this.data.border = border;
        this.data.cornerRadius = cornerRadius;
        this.data.cardThickness = cardThickness;
        this.data.size.copy(size);
    }
    async init(manager) {
        super.init(manager);
        
        let shape = this.#roundedSquare(this.data.cornerRadius);
        if (this.data.border) {
            let data = await Deck.svgLoader.loadAsync(this.data.border);
            if (data.paths.length > 0)
                shape = SVGLoader.createShapes(data.paths[0])[0];
        }
        const extrudeSettings = {
            steps: 1,
            depth: 1,
            bevelEnabled: false,
        };
        
        let geometry = new ExtrudeGeometry(shape, extrudeSettings);
        geometry.deleteAttribute('normal');
        geometry = BufferGeometryUtils.mergeVertices(geometry);
        geometry.computeVertexNormals();
        let material = new THREE.MeshBasicMaterial({alphaTest:0.5, opacity:0});
        
        const box = new THREE.Mesh(geometry, material);
        box.customDepthMaterial = material;
        box.castShadow = true;
        box.receiveShadow = true;
        box.scale.set(1, -1, 1);
        box.position.set(-0.5, 0.5, 0.5);
        box.quaternion.setFromEuler(new THREE.Euler(Math.PI/2, 0, 0));
        
        this.box = box;
        this.mesh.scale.copy(new THREE.Vector3(
            this.data.size.x,
            this.data.cardThickness * this.data.contents.length,
            this.data.size.y
        ));
        this.mesh.add(box);

        this.sideTexture = (await this.loadTexture("generic/cards/side.jpg")).clone();
        this.sideTexture.needsUpdate = true;
        [this.sideTexture.wrapS, this.sideTexture.wrapT] = [THREE.RepeatWrapping, THREE.RepeatWrapping];
        
        this.updateDeck(true);
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
    dispose() {
        super.dispose();
        this.sideTexture.dispose();
        // FIXME: Dispose of textures, if possible
    }

    menu() {
        let entries = super.menu();
        if (this.data.contents.length > 1) {
            let deckEntries = [
                ["Take", () => this.grabCards()],
                ["Split", () => this.split()],
                ["Shuffle", () => this.shuffle()],
            ];
            if (this.manager.host) {
                deckEntries.push(["Deal", () => this.deal()]);
            }
            entries.splice(1, 0, deckEntries);
        }
        return entries;
    }
    
    animate(dt) {
        super.animate(dt);

        if (this.faceMaterial) {
            if (this.flipped() && !this.faceMaterial.color.equals(new THREE.Color(0x000000))) {
                this.faceMaterial.color = new THREE.Color(0x000000);
            } else if (!this.flipped() && this.faceMaterial.color.equals(new THREE.Color(0x000000))) {
                this.faceMaterial.color = new THREE.Color(0xffffff);
            }
        }
    }
    
    async loadTexture(texture) {
        if (Deck.textureCache.has(texture))
            return Deck.textureCache.get(texture);

        let t = await Deck.textureLoader.loadAsync(texture);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = 4;

        Deck.textureCache.set(texture, t);
        return Deck.textureCache.get(texture);
    }
    
    keyDown(e) {
        super.keyDown(e);
        
        if (!this.moveable)
            return;

        if (e.key == "g" && this.data.contents.length == 1) {
            super.release(false);
            this.manager.sendEvent("pawn", true, {id: this.id, name: "remove"}, () => {
                this.manager.hand.pushCard(this);
            });
        }
        if (!this.selected && e.key == 't') {
            this.grabCards();
        }
    }

    deal() {
        this.manager.sendEvent("pawn", false, {id: this.id, name: "deal"});
    }
    grabCards(intoHand = false, count = 1) {
        if (count < 1)
            return;
        // FIXME: Instead of callback, predict
        this.manager.sendEvent("pawn", true, {id: this.id, name: "grab_cards", count: count}, (card_id) => {
            if (card_id) {
                this.updateDeck();
                let card = this.manager.pawns.get(card_id);
                if (intoHand) {
                    this.manager.sendEvent("pawn", true, {id: card.id, name: "remove"}, () => {
                        this.manager.hand.pushCard(card);
                    });
                } else {
                    card.grab(0);
                }
            }
        });
    }
    split() {
        this.grabCards(false, Math.floor(this.data.contents.length/2));
    }
    handleEvent(data) {
        let out = super.handleEvent(data);
        switch (data.name) {
            case "insert":
                this.insert(data.top, data.contents);
                break;
            case "remove":
                this.manager.removePawn(this.id);
                break;
            case "deal":
                this.grabCards(true);
                break;
            case "grab_cards":
                let cards = this.spawnCards(data.count);
                if (cards)
                    out = cards.id;
                break;
            case "shuffle":
                this.shuffle();
                break;
        }
        return out;
    }
    
    spawnCards(count = 1) {
        if (this.data.contents.length - count < 1)
            return;

        // Create a new deck of length 1 and grab that instead
        let range = this.flipped() ?
            [this.data.contents.length - count, this.data.contents.length] :
            [0, count];
        let cardPawn = new Deck({
            manager: this.manager, name: this.name,
            contents: this.data.contents.slice(range[0], range[1]), back: this.data.back,
            border: this.data.border, sideColor: this.data.sideColor,

            cornerRadius: this.data.cornerRadius, cardThickness: this.data.cardThickness,
            position: new THREE.Vector3().copy(this.position).add(new THREE.Vector3(0,1,0)), rotation: this.rotation,
            size: this.data.size
        });
        cardPawn.selectRotation = Object.assign({}, this.selectRotation);
        
        this.manager.addPawn(cardPawn);
        
        this.data.contents.splice(range[0], count);
        this.dirty.add("selected");
        this.dirty.add("data");
        // Flush dirty and prevent race condition
        // (where you could grab and put down in the same tick, causing the contents to be synced out of order)
        this.manager.tick();
        
        this.updateDeck();
        
        return cardPawn;
    }
    insert(top, contents) {
        console.assert(this.manager.host);
        if (!top) {
            this.data.contents = [...contents, ...this.data.contents];
        } else {
            this.data.contents = [...this.data.contents, ...contents];
        }
        this.updateDeck();
        this.dirty.add("selected");
        this.dirty.add("data");
        this.manager.tick();
    }
    merge(rhs) {
        if (rhs instanceof Deck && rhs.name == this.name && rhs.flipped() == this.flipped()) {
            this.manager.sendEvent("pawn", true, {
                id: this.id, name: "insert",
                top: this.flipped(), contents: rhs.data.contents
            });
            this.manager.removePawn(rhs.id);
        }
    }
    grab(button, shift) {
        if (this.selected || this.networkSelected)
            return;
        if (!shift) {
            super.grab();
        } else {
            this.grabCards();
        }
    }
    
    async updateDeck(fadeIn = false) {
        // Resize
        let thickness = this.data.cardThickness * this.data.contents.length;
        this.mesh.scale.setComponent(1, thickness);
        this.updateBoundingBox();

        this.colliderShapes[0].halfExtents.setComponent(
            1, Math.max(thickness/2, 0.03),
        );
        this.dirty.add("selected");
        this.dirty.add("colliderShapes");
        
        // Load textures
        let [faceTexture, backTexture] = await Promise.all([
            this.loadTexture(this.data.contents[0]),
            this.data.back != null ?
                this.loadTexture(this.data.back) :
                this.loadTexture(this.data.contents[this.data.contents.length - 1])
        ]);
        
        // Dispose of old materials
        for (let material of [this.backMaterial, this.faceMaterial, this.sideMaterial]) {
            if (material)
                material.dispose();
        }
        // Apply new materials
        this.sideTexture.repeat.y = this.data.contents.length - 1;
        this.sideMaterial = new MeshStandardDitheredMaterial({
            color: this.data.sideColor,
            map: this.sideTexture
        });
        this.faceMaterial = new MeshStandardDitheredMaterial({
            color: 0xffffff,
            map: faceTexture
        });
        this.backMaterial = new MeshStandardDitheredMaterial({
            color: 0xffffff,
            map: backTexture
        });
        this.box.material = [
            this.faceMaterial, this.sideMaterial, this.backMaterial
        ];
        if (fadeIn) {
            this.box.customDepthMaterial = new DepthDitheredMaterial().clone();
            for (let material of this.box.material.concat([this.box.customDepthMaterial])) {
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
    }
    processData() { this.updateDeck() }
    
    shuffle() {
        if (this.data.contents.length > 1) {
            //Shuffle
            //https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
            for (let i = this.data.contents.length - 1; i >= 0; i--) {
                let j = Math.floor(Math.random() * (i + 1));
                [this.data.contents[j], this.data.contents[i]]
                    = [this.data.contents[i], this.data.contents[j]];
            }
            this.updateDeck();
            this.dirty.add("selected");
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
}

export class Container extends Pawn {
    data = {
        holds: {},
        capacity: undefined,
    }
    
    constructor({holds, capacity, ...rest}) {
        super(rest);
        this.data.holds = holds;
        this.data.capacity = capacity;
    }
    
    menu() {
        let entries = super.menu();
        entries[1].splice(0, 1);
        entries.splice(1, 0, [
            ["Take", () => {
                this.manager.sendEvent("pawn", true, {id: this.id, name: "grab_item"}, (item_id) => {
                    if (item_id)
                        this.manager.pawns.get(item_id).grab(0);
                });
            }]  
        ]);
        return entries;
    }

    flip() { }
    
    handleEvent(data) {
        let out = super.handleEvent(data);
        switch (data.name) {
            case "grab_item":
                let item = this.spawnItem();
                if (item)
                    out = item.id;
                break;
            case "insert_item":
                if (this.data.capacity) {
                    this.data.capacity += 1;
                    this.dirty.add("selected");
                    this.dirty.add("data");
                }
                break;
        }
        return out;
    }
    keyDown(e) {
        super.keyDown(e);

        if (!this.selected && e.key == 't') {
            this.manager.sendEvent("pawn", true, {id: this.id, name: "grab_item"}, (item_id) => {
                if (item_id)
                    this.manager.pawns.get(item_id).grab(0);
            });
        }
    }
    
    spawnItem(prediction = false) {
        if (this.data.capacity !== undefined) {
            if (this.data.capacity == 0)
                return;
        }

        let item = this.manager.loadPawn(this.data.holds).clone();

        item.setPosition(this.position.clone().add(new THREE.Vector3(0, 2, 0)));
        this.manager.addPawn(item);

        if (this.data.capacity && !prediction) {
            this.data.capacity -= 1;
            this.dirty.add("selected");
            this.dirty.add("data");
        }
        
        return item;
    }
    grab(button) {
        if (this.selected || this.networkSelected)
            return;
        if (button == 0)
            super.grab();
    }
    merge(rhs) {
        if (rhs.name != this.data.holds.name)
            return;

        this.manager.removePawn(rhs.id);
        this.manager.sendEvent("pawn", true, {id: this.id, name: "insert_item"});
    }
    
    static className() { return "Container"; };
}
