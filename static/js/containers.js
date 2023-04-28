import { TextureLoader, Vector2, Vector3, Euler, Quaternion, MeshBasicMaterial, Mesh, RepeatWrapping, Shape, Color, SRGBColorSpace } from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

import { ExtrudeGeometry } from './ExtrudeGeometryFB';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshPhongDitheredMaterial, DepthDitheredMaterial } from './DitheredMaterials';

import { deserializePawn, Pawn } from './pawns';
import { Box } from './shapes.js';

import { cancellablePromise } from './utils';

export class Deck extends Pawn {
    static textureCache = new Map();
    static textureLoader = new TextureLoader().setPath(window.location.href + '/assets/');
    static svgLoader = new SVGLoader().setPath(window.location.href + '/assets/');

    data = {
        contents: [],
        back: null,
        sideColor: 0,

        border: null,
        cornerRadius: 0,
        cardThickness: 0,
        size: new Vector2()
    }
    
    #box;

    #faceMaterial;
    #backMaterial;
    #sideMaterial;
    #sideTexture;
    
    constructor({contents = [], back = null, sideColor = 0xffffff,
                 size = new Vector2(), border = null, cornerRadius = 0.02, cardThickness = 0.01,
                 ...rest}) {
        rest.colliderShapes = [
            new Box(new Vector3(size.x/2, (cardThickness * contents.length * 1.15)/2, size.y/2))
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
    static #shapeGeometryCache = new Map();
    async init() {
        super.init();

        let geometry = null;
        let key = this.data.border ? this.data.border : this.data.cornerRadius;
        if (this.constructor.#shapeGeometryCache.has(key)) {
            geometry = this.constructor.#shapeGeometryCache.get(key);
        } else {
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
            
            geometry = new ExtrudeGeometry(shape, extrudeSettings);
            geometry.deleteAttribute('normal');
            geometry = BufferGeometryUtils.mergeVertices(geometry);
            geometry = BufferGeometryUtils.toCreasedNormals(geometry); // geometry.computeVertexNormals();

            this.constructor.#shapeGeometryCache.set(key, geometry);
        }
        
        let material = new MeshBasicMaterial({alphaTest:0.5, opacity:0});
        
        this.#box = new Mesh(geometry, material);
        this.#box.customDepthMaterial = material;
        this.#box.castShadow = true;
        this.#box.receiveShadow = true;
        this.#box.scale.set(1, -1, 1);
        this.#box.position.set(-0.5, 0.5, 0.5);
        this.#box.quaternion.setFromEuler(new Euler(Math.PI/2, 0, 0));
        
        this.getMesh().scale.copy(new Vector3(
            this.data.size.x,
            this.data.cardThickness * this.data.contents.length,
            this.data.size.y
        ));
        this.getMesh().add(this.#box);

        this.#sideTexture = (await this.#loadTexture("generic/cards/side.webp")).clone();
        this.#sideTexture.needsUpdate = true;
        [this.#sideTexture.wrapS, this.#sideTexture.wrapT] = [RepeatWrapping, RepeatWrapping];
        
        this.#updateDeck(true);

        display.addEventListener('pointermove', this.#mouseMove);
    }
    #roundedSquare(radius) {
        let shape = new Shape();
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
        display.removeEventListener('pointermove', this.#mouseMove);
        if (this.#sideTexture)
            this.#sideTexture.dispose();
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
            if (window.manager.host) {
                deckEntries.push(["Deal", () => this.deal()]);
            }
            entries.splice(1, 0, deckEntries);
        }
        return entries;
    }
    
    animate(dt) {
        super.animate(dt);

        if (this.#faceMaterial) {
            if (this.flipped() && !this.#faceMaterial.color.equals(new Color(0x000000))) {
                this.#faceMaterial.color = new Color(0x000000);
            } else if (!this.flipped() && this.#faceMaterial.color.equals(new Color(0x000000))) {
                this.#faceMaterial.color = new Color(0xffffff);
            }
        }
    }
    #mouseMove = (e) => {
        if (this.data.contents.length == 1 &&
            this.selected && e.clientY > (window.innerHeight - 200)) {

            super.release(false);

            window.manager.removePawn(this.id);
            window.manager.hand.pushCard(this, true);
            window.manager.sendRemovePawn(this.id); // FIXME: Callback on failure

            // 'Release' pointer on OrbitControls
            // Note, call this after super.release(false) to prevent merging
            window.manager.controls.domElement.dispatchEvent(
                new PointerEvent('pointerup', {
                    pointerId: e.pointerId
                })
            );
        }
    }
    
    async #loadTexture(texture) {
        if (Deck.textureCache.has(texture))
            return Deck.textureCache.get(texture);

        let t = await Deck.textureLoader.loadAsync(texture);
        t.colorSpace = SRGBColorSpace;
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

            window.manager.removePawn(this.id);
            window.manager.hand.pushCard(this);
            window.manager.sendRemovePawn(this.id); // FIXME: Callback on failure
        }
        if (!this.selected && e.key == 't') {
            this.grabCards();
        }
    }

    deal() {
        window.manager.sendEvent("pawn", false, {id: this.id, name: "deal"});
    }
    grabCards(intoHand = false, count = 1) {
        if (count < 1)
            return;
        if (this.data.contents.length - count < 1)
            return;

        const to_id = Pawn.nextId();
        window.manager.sendSocket({
            type: "extract_pawns",
            from_id: this.id,
            to_id: to_id,
            count: count,
        });
        const handleGrabCards = (e) => {
            if (e.detail.pawn.id != to_id)
                return;
    
            let cards = window.manager.pawns.get(e.detail.pawn.id);
    
            if (intoHand && count == 1) {
                window.manager.removePawn(cards.id);
                window.manager.hand.pushCard(cards);
                window.manager.sendRemovePawn(cards.id); // FIXME: Callback on failure
            } else {
                if (cards)
                    cards.grab(0);
            }

            window.manager.removeEventListener("add_pawn", handleGrabCards);
        };
        window.manager.addEventListener("add_pawn", handleGrabCards);
    }
    split() {
        this.grabCards(false, Math.floor(this.data.contents.length/2));
    }
    handleEvent(data) {
        let out = super.handleEvent(data);
        switch (data.name) {
            case "deal":
                this.grabCards(true);
                break;
            case "shuffle":
                this.shuffle();
                break;
        }
        return out;
    }
    
    insert(top, contents) {
        if (!top) {
            this.data.contents = [...contents, ...this.data.contents];
        } else {
            this.data.contents = [...this.data.contents, ...contents];
        }
        this.#updateDeck();
    }
    merge(rhs) {
        if (rhs instanceof Deck && rhs.name == this.name && rhs.flipped() == this.flipped()) {
            this.insert(this.flipped(), rhs.data.contents);

            let previewMesh = rhs.getMesh().clone();
            window.manager.removePawn(rhs.id);

            window.manager.scene.add(previewMesh);
            const start = performance.now();
            const startPosition = previewMesh.position.clone();
            const startRotation = new Quaternion().setFromEuler(previewMesh.rotation.clone());
            const animatePreview = (now) => {
                if ((now - start)/250 < 1) {
                    previewMesh.position.copy(startPosition.lerp(this.getMesh().position, (now - start)/250));
                    previewMesh.rotation.setFromQuaternion(startRotation.slerp(
                        new Quaternion().setFromEuler(this.getMesh().rotation),
                        (now - start)/250
                    ));
                    requestAnimationFrame(animatePreview);
                } else {
                    window.manager.scene.remove(previewMesh);
                }
            };
            animatePreview(start);

            window.manager.sendSocket({
                type: "merge_pawns",
                into_id: this.id,
                from_id: rhs.id,
            });
        }
    }
    grab(button, shift) {
        if (this.selected || this.networkSelected)
            return;
        if (!shift || this.data.contents.length == 1) {
            super.grab();
        } else {
            this.selected = false;
            this.grabCards();
        }
    }
    
    #updateMaterials(faceTexture, backTexture) {
        // Dispose of old materials
        for (let material of [this.#backMaterial, this.#faceMaterial, this.#sideMaterial]) {
            if (material)
                material.dispose();
        }
        // Apply new materials
        this.#sideTexture.repeat.y = this.data.contents.length - 1;
        this.#sideMaterial = new MeshPhongDitheredMaterial({
            color: new Color(this.data.sideColor).multiply(new Color(this.tint)),
            map: this.#sideTexture,
            shininess: 5,
        });
        this.#faceMaterial = new MeshPhongDitheredMaterial({
            color: this.tint,
            map: faceTexture,
            shininess: 5,
        });
        this.#backMaterial = new MeshPhongDitheredMaterial({
            color: this.tint,
            map: backTexture,
            shininess: 5,
        });
        this.#box.material = [
            this.#faceMaterial, this.#sideMaterial, this.#backMaterial
        ];
    }
    #updateDeckPromise = null;
    async #updateDeck(fadeIn = false) {
        if (this.#updateDeckPromise) {
            this.#updateDeckPromise.cancel();
        }
        
        // Load textures
        if (!fadeIn) { // Show placeholder when loading, but not for the first load
            if (
                !Deck.textureCache.has(this.data.contents[0]) ||
                !Deck.textureCache.has(this.data.back ? this.data.back : this.#loadTexture(this.data.contents[this.data.contents.length - 1]))
            ) {
                let alphaTexture = await this.#loadTexture("generic/alpha.png");
                this.#updateMaterials(alphaTexture, alphaTexture);
            }
        }

        let abort = false;
        this.#updateDeckPromise = cancellablePromise(async (resolve, reject, onCancel) => {
            onCancel = () => { abort = true; };

            resolve(await Promise.all([
                this.#loadTexture(this.data.contents[0]),
                this.data.back ?
                    this.#loadTexture(this.data.back) :
                    this.#loadTexture(this.data.contents[this.data.contents.length - 1])
            ]));
        });
        let [faceTexture, backTexture] = await this.#updateDeckPromise;
        if (abort) return;
        this.#updateDeckPromise = null;

        // Resize
        let thickness = this.data.cardThickness * this.data.contents.length;
        this.getMesh().scale.setComponent(1, thickness);
        this.updateBoundingBox();

        this.colliderShapes[0].halfExtents.setComponent(
            1, Math.max(thickness/2, 0.03),
        );
        this.dirty.add("selected");
        this.dirty.add("colliderShapes");
        
        // Dispose of old materials
        this.#updateMaterials(faceTexture, backTexture);
        if (fadeIn) {
            this.#box.customDepthMaterial = new DepthDitheredMaterial().clone();
            for (let material of this.#box.material.concat([this.#box.customDepthMaterial])) {
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
    processData() {
        this.#updateDeck();
    }
    
    shuffle() {
        if (this.data.contents.length > 1) {
            //Shuffle
            //https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
            for (let i = this.data.contents.length - 1; i >= 0; i--) {
                let j = Math.floor(Math.random() * (i + 1));
                [this.data.contents[j], this.data.contents[i]]
                    = [this.data.contents[i], this.data.contents[j]];
            }
            this.#updateDeck();
            this.dirty.add("selected");
            this.dirty.add("data");
        }
    }
    
    flip() {
        if (this.data.back != null)
            super.flip();
    }
    shake() {
        this.shuffle();
    }
    flipped() {
        return Math.abs(this.selectRotation.x - Math.PI) < 0.01;
    }
    
    static className() { return "Deck"; };
}

export class Container extends Pawn {
    data = {
        holds: null,
        capacity: null,
    }
    
    constructor({holds, capacity, ...rest}) {
        super(rest);

        if (holds)
            this.data.holds = holds;
        this.processData();

        this.data.capacity = capacity;
    }
    
    menu() {
        let entries = super.menu();
        entries[1].splice(0, 1);
        entries.splice(1, 0, [
            ["Take", () => this.spawnItem()]  
        ]);
        return entries;
    }

    flip() { }
    
    keyDown(e) {
        super.keyDown(e);

        if (!this.selected && e.key == 't') {
            this.spawnItem();
        }
    }
    
    spawnItem() {
        if (this.data.capacity !== undefined) {
            if (this.data.capacity == 0)
                return;
        }

        const to_id = Pawn.nextId();
        window.manager.sendSocket({
            type: "extract_pawns",
            from_id: this.id,
            to_id: to_id
        });
        const handleGrabItem = (e) => {
            if (e.detail.pawn.id != to_id)
                return;
    
            let item = window.manager.pawns.get(e.detail.pawn.id);
            if (item)
                item.grab(0);
    
            window.manager.removeEventListener("add_pawn", handleGrabItem);
        };
        window.manager.addEventListener("add_pawn", handleGrabItem);
    }
    grab(button, shift) {
        if (this.selected || this.networkSelected)
            return;
        if (button == 0) {
            if (shift) {
                this.spawnItem();
            } else {
                super.grab();
            }
        }
    }
    merge(rhs) {
        if (rhs.name != this.data.holds.name)
            return;

        if (this.data.capacity) {
            this.data.capacity += 1;
        }

        window.manager.sendSocket({
            type: "merge_pawns",
            into_id: this.id,
            from_id: rhs.id,
        });
    }

    serialize() {
        let out = super.serialize();
        if (this.data.holds instanceof Pawn)
            out.data.holds = this.data.holds.serialize();
        return out;
    }
    processData() {
        if (this.data.holds) {
            if (!(this.data.holds instanceof Pawn)) {
                this.data.holds = deserializePawn(this.data.holds);
            }
        }
    }
    
    static className() { return "Container"; };
}
