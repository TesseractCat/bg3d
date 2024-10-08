import {
    SphereGeometry, MeshBasicMaterial, Vector3, Quaternion, Mesh, Vector2, Matrix4, Raycaster, AudioListener,
    Scene, DirectionalLight, AmbientLight, PlaneGeometry, ShaderMaterial, ShaderLib, PerspectiveCamera,
    WebGLRenderer, PCFShadowMap, PCFSoftShadowMap, Euler, Cache, Color,
    LinearFilter,
    Object3D,
    MeshPhongMaterial,
    DoubleSide,
    TextureLoader
} from 'three';

import Stats from 'three/addons/libs/stats.module.js';
import { OrbitControls } from './OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { deserializePawn, Pawn, SnapPoint, Dice, Deck, Container  } from './pawns';
import { NetworkedTransform } from './transform';

import { serializationFixedFloatMixin, serializationReplacer, serializationThreeTypesMixin, UniqueId } from './utils.js';

import { deflateSync, inflateSync } from 'fflate';

import dictionary from '../../src/dictionary.txt';

const COMPRESSED = true;

class User {
    static gltfLoader = new GLTFLoader()
        .setPath(window.location.origin + '/static/');
    static textureLoader = new TextureLoader()
        .setPath(window.location.origin + '/static/');

    id;

    color;
    cardTextElement;
    playerTextElement;

    cursorObject;
    cursorTransform;
    headObject;
    headTransform;
    handObject;

    cardDisplayParent;
    cardDisplayMaterial;

    constructor(id, color, self, cardTextElement, playerTextElement) {
        this.id = id;
        this.color = color;
        this.cardTextElement = cardTextElement;
        this.playerTextElement = playerTextElement;
        
        this.headObject = null;
        this.headTransform = new NetworkedTransform(new Vector3(), new Quaternion());
        this.cursorTransform = new NetworkedTransform(new Vector3(), new Quaternion());
        
        this.cardDisplayParent = new Object3D();
        this.cardDisplayMaterial = new MeshPhongMaterial({color: 0xFAFAFA, side: DoubleSide, alphaTest: 0.5});
        User.textureLoader.load("games/generic/unknown_card.png", (tex) => {
            this.cardDisplayMaterial.map = tex;
        });

        if (!self) {
            const cursorGeometry = new SphereGeometry(0.32, 12, 12);
            const cursorMaterial = new MeshBasicMaterial( {color: color} );
            this.cursorObject = new Mesh(cursorGeometry, cursorMaterial);
            window.manager.scene.add(this.cursorObject);

            User.gltfLoader.load("head/head.glb", (gltf) => {
                gltf.scene.traverse((child) => {
                    if (child instanceof Mesh) {
                        let mat = new MeshBasicMaterial();
                        if (child.material.name == 'Tex') {
                            mat.color = new Color(color);
                        } else {
                            mat.color = child.material.emissive;
                        }
                        mat.map = child.material.emissiveMap;
                        if (child.material.name == 'Eye') {
                            mat.alphaTest = 0.5;
                        } else {
                            mat.transparent = true;
                        }
                        if (child.name == 'Eyes') {
                            function blink() {
                                child.scale.set(1,0.05,1);
                                child.material.color = new Color(0x000000);
                                setTimeout(() => {
                                    child.scale.set(1,1,1);
                                    child.material.color = new Color(0xffffff);
                                }, 200);
                                setTimeout(blink, (Math.random() * 4 + 6) * 1000);
                            }
                            blink();
                        }
                        if (child.name == 'Hand') {
                            child.parent = null;
                            this.handObject = child;
                            this.handObject.visible = false;
                        }
                        child.material.dispose();
                        child.material = mat;
                    }
                });
                gltf.scene.scale.set(1.5,1.5,1.5);
                gltf.scene.visible = false;
                window.manager.scene.add(gltf.scene);
                this.headObject = gltf.scene;

                this.headObject.add(this.cardDisplayParent);
                this.cardDisplayParent.position.set(0, -0.75, 1.75);
            });
        }
    }
    animate() {
        this.cursorTransform.animate();
        this.cursorObject?.position.copy(this.cursorTransform.position);
        this.cursorObject?.quaternion.copy(this.cursorTransform.rotation);

        this.headTransform.animate();
        if (this.headObject) {
            this.headObject.position.copy(this.headTransform.position);
            this.headObject.quaternion.copy(this.headTransform.rotation);
            this.headObject.visible = true;

            if (this.handObject) {
                this.handObject.position.copy(this.cursorTransform.position);
                this.handObject.quaternion.copy(this.headTransform.rotation);
                // this.handObject.visible = true;
            }
        }
    }

    updateCardCount(count) {
        this.cardDisplayParent.clear();

        const width = count <= 2 ? 0.5 : 1.5;
        const rotAmount = count <= 2 ? 0.3 : 0.7;
        for (let i = 0; i < count; i++) {
            const p = count == 1 ? 0.5 : i/(count-1);
            const geometry = new PlaneGeometry(0.9, 1.25);
            const plane = new Mesh(geometry, this.cardDisplayMaterial);
            plane.position.set(p * width - width/2, 0.1 * Math.sin(Math.PI * p), p * 0.05);
            plane.setRotationFromEuler(new Euler(0, 0, (p - 0.5) * -rotAmount));
            this.cardDisplayParent.add(plane);
        }
    }
}

export default class Manager extends EventTarget {

    static deflateOpts = {
        dictionary: new Uint8Array(new TextEncoder().encode(dictionary))
    };

    scene;
    camera;
    audioListener;
    renderer;
    composer;
    controls;
    plane;
    gridMaterial;

    socket;
    
    stats;
    pingPanel;
    
    settingsForm;
    hand;
    chat;
    contextMenu;
    tooltip;
    spawnMenu;
    
    raycaster = new Raycaster();
    mouse = new Vector2();
    
    localCursor = {
        position: new Vector3(),
        dirty: false
    };
    
    pawns = new Map();
    host = false;
    id;
    users = new Map();
    info;
    
    static networkTimestep = 1000/20; // Milliseconds
    lastCallTime;
    
    lastPingSent;
    
    constructor() {
        super();
    }

    async init(callback) {
        this.buildRenderer();
        this.buildScene();
        this.buildControls();
        
        this.resize();

        // Setup custom elements
        this.settingsForm = document.querySelector("#settings");
        this.hand = document.querySelector("bird-hand");
        this.chat = document.querySelector("bird-chat");
        this.contextMenu = document.querySelector("bird-context-menu");
        this.tooltip = document.querySelector("bird-tooltip");
        this.spawnMenu = document.querySelector("bird-spawn-menu");

        this.chat.addEventListener("chat", (e) => {
            this.sendSocket({
                type: "chat",
                content: e.detail
            });
        });
        this.hand.addEventListener("take", (e) => {
            let card = e.detail;

            if ([...this.pawns.values()].filter(p => p.selected).length != 0)
                return;

            let raycastableObjects = [...this.pawns.values()].map(x => x.getMesh());
            raycastableObjects.push(this.plane);
            let hits = this.raycaster.intersectObjects(raycastableObjects, true);
            
            if (hits.length >= 1) {
                let hitPoint = hits[0].point.clone();
                let hint = hitPoint.add(new Vector3(0, 2, 0));
                
                const grabHandler = (e) => {
                    if (e.detail.pawn.id == card.id) {
                        this.pawns.get(card.id).grab(0);
                        this.removeEventListener("add_pawn", grabHandler);
                    }
                };
                this.addEventListener("add_pawn", grabHandler);
                this.sendSocket({
                    type: "take_pawn",
                    from_id: this.id,
                    target_id: card.id,
                    position_hint: hint
                });
            }
        });
        this.spawnMenu.addEventListener("spawn", (e) => {
            e.detail.position.copy(new Vector3(0, 1, 0));
            e.detail.id = UniqueId();
            this.sendAddPawn(e.detail);
        });
        display.addEventListener("drop", (e) => {
            let name = e.dataTransfer.getData("application/pawn");
            if (name !== null) {
                let p = this.spawnMenu.getByName(name);
                p.position.copy(this.localCursor.position).add(new Vector3(0, 1, 0));
                p.id = UniqueId();
                this.sendAddPawn(p);
            }
        });

        // Enable cache
        Cache.enabled = true;
        
        // Track mouse position
        display.addEventListener('pointermove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth)*2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight)*2 + 1;
        });
        display.addEventListener('dragover', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth)*2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight)*2 + 1;
        });
        
        let dragged = false;
        let downPos = {x: 0, y:0};
        display.addEventListener('pointerdown', (e) => {
            dragged = false;
            downPos = {x: e.clientX, y: e.clientY};
        });
        display.addEventListener('pointermove', (e) => {
            // Fix intermittent chrome bug where mouse move is triggered incorrectly
            // https://bugs.chromium.org/p/chromium/issues/detail?id=721341
            if (downPos.x - e.clientX != 0 && downPos.y - e.clientY != 0) {
                dragged = true;
            }
        });
        display.addEventListener('pointerdown', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth)*2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight)*2 + 1;
            this.raycastHover();

            if (e.button != 0)
                return;

            let toSelect = Array.from(this.pawns.values()).filter(p => 
                p.moveable && (p.hovered || p.selected)
            );
            if (toSelect.length == 0)
                return;
            for (var i = 0; i < toSelect.length; i++) {
                // Release currently selected object
                if (toSelect[i].selected) {
                    toSelect[i].release();
                    return;
                }
            }
            if (e.button == 0) {
                toSelect[0].grab(e.button, e.shiftKey);
                this.controls.saveState();
                this.controls.reset(); // Reset sets controls state to NONE
            }
        });
        display.addEventListener('pointerup', (e) => {
            if (e.button == 0) {
                let selected = Array.from(this.pawns.values()).filter(p => p.selected);
                for (let pawn of selected) {
                    pawn.release();
                }
            } else if (e.button == 2 && !dragged) {
                if (Array.from(this.pawns.values()).filter(p => p.selected).length != 0)
                    return;
                let toSelect = Array.from(this.pawns.values()).filter(p => 
                    p.moveable && (p.hovered || p.selected)
                );
                if (toSelect.length != 0)
                    this.contextMenu.show(e, toSelect[0].menu());
            }
        });
        display.addEventListener('wheel', (e) => this.contextMenu.hide());
        
        // Chat
        display.addEventListener('keydown', (e) => {
            if (e.key == "Enter")
                this.chat.focus();
        });
        
        // Route events to active pawns
        document.addEventListener('keydown', (e) => {
            if (this.chat.focused)
                return;

            let existsSelected = Array.from(this.pawns.values()).filter(p => p.selected).length != 0;
            this.pawns.forEach(p => {
                if ((existsSelected && p.selected) || (!existsSelected && p.hovered)) {
                    p.keyDown(e);
                }
            });
        });
        document.addEventListener('mouseshake', (e) => {
            this.pawns.forEach(p => {
                if (p.selected)
                    p.shake();
            });
        });
        
        // Finally make websocket connection
        this.buildWebSocket(callback);
    }
    
    clearPawns() {
        [...this.pawns.keys()].forEach(id => {
            this.scene.remove(this.pawns.get(id).getMesh());
            this.pawns.get(id).dispose();
            this.pawns.delete(id);
        });
        this.hand.clear();
        Cache.clear();
        Deck.textureCache.clear();
    }
    sendClearPawns() {
        this.sendSocket({
            type:"clear_pawns",
        });
    }
    addPawn(pawn) {
        if (this.pawns.has(pawn.id) || this.hand.cards.has(pawn.id)) {
            this.updatePawn(pawn);
        } else {
            this.pawns.set(pawn.id, pawn);
            pawn.init();
        }
    }
    sendAddPawn(pawn) {
        this.sendSocket({ type: "add_pawn", pawn: pawn.serialize() });
    }
    removePawn(id) {
        if (this.pawns.has(id)) {
            this.scene.remove(this.pawns.get(id).getMesh());
            this.pawns.get(id).dispose();
            this.pawns.delete(id);
        }
    }
    sendRemovePawn(id) {
        this.sendSocket({ type:"remove_pawns", pawns:[id] });
    }
    updatePawn(serializedPawn) {
        if (!this.pawns.has(serializedPawn.id)) {
            if (this.hand.cards.has(serializedPawn.id)) {
                console.warn("Updating card already in hand!");
                this.hand.updateCard(serializedPawn);
            } else {
                console.warn(`Attempting to update non-existent pawn [${serializedPawn.id}]`);
            }
            return;
        }
        let pawn = this.pawns.get(serializedPawn.id);

        if (serializedPawn.hasOwnProperty('name')) {
            pawn.name = serializedPawn.name;
        }
        if (serializedPawn.hasOwnProperty('mesh')) {
            pawn.mesh = serializedPawn.mesh;
            pawn.processMesh();
        }
        if (serializedPawn.hasOwnProperty('tint')) {
            pawn.tint = serializedPawn.tint;
            pawn.processMesh();
        }
        if (serializedPawn.hasOwnProperty('selected')) {
            if (pawn.networkSelected && !serializedPawn.selected) {
                // This pawn has been grabbed/released, reset the network buffer and update position
                if (serializedPawn.hasOwnProperty('position') && serializedPawn.hasOwnProperty('rotation')) {
                    pawn.setPosition(new Vector3().copy(serializedPawn.position));
                    pawn.setRotation(new Quaternion().copy(serializedPawn.rotation));
                }
            }
            pawn.networkSelected = serializedPawn.selected;
        }
        if (serializedPawn.hasOwnProperty('position') || serializedPawn.hasOwnProperty('rotation')) {
            pawn.tick(serializedPawn.position, serializedPawn.rotation);
        }
        if (serializedPawn.hasOwnProperty('selectRotation')) {
            pawn.selectRotation.copy(serializedPawn.selectRotation);
        }
        if (serializedPawn.hasOwnProperty('data')) {
            pawn.data = serializedPawn.data;
            pawn.processData();
        }
    }
    sendUpdatePawn(pawn) {
        this.sendSocket({type: "update_pawns", pawns: [pawn.serialize()]});
    }
    
    addUser(id, color) {
        // Create elements
        let playerElement = document.createElement("div");
        playerElement.classList.add("player");
        playerElement.dataset.id = id;
        playerElement.style.setProperty("--bird-fill-color", color);
        playerElement.style.setProperty("--bird-stroke-color", color);
        playerElement.appendChild(document.getElementById("bird-icon").content.cloneNode(true));
        let playerTextElement = document.createElement("h3");
        playerTextElement.classList.add("text");
        playerTextElement.innerText = "";//id;
        playerElement.appendChild(playerTextElement);
        let cardTextElement = document.createElement("h3");
        cardTextElement.classList.add("cards");
        cardTextElement.innerText = "[0 cards]";
        playerElement.appendChild(cardTextElement);

        if (id == this.id) {
            playerTextElement.innerText = "YOU";
            playerElement.classList.add("you");
        }
        
        let playerList = document.querySelector("#player-entries");
        for (let entryNode of playerList.children) {
            if (id < parseInt(entryNode.dataset.id)) {
                playerList.insertBefore(playerElement, entryNode);
                break;
            } 
        }
        if (playerElement.parentNode != playerList)
            playerList.appendChild(playerElement);
        
        // Create user object
        let user = new User(id, color, id == this.id, cardTextElement, playerTextElement);
        this.users.set(id, user);
    }
    removeUser(id) {
        document.querySelector(`.player[data-id="${id}"]`).remove();
        this.scene.remove(this.users.get(id).cursorObject);
        this.scene.remove(this.users.get(id).headObject);
        this.users.delete(id);
    }
    
    sendUserStatus() {
        let forward = this.camera.getWorldDirection(new Vector3());
        this.sendSocket({
            type: "update_user_statuses",
            updates: [{
                id: this.id,
                cursor: {x: this.localCursor.position.x,
                         y: this.localCursor.position.y,
                         z: this.localCursor.position.z},
                head: {x: this.camera.position.x,
                       y: Math.min(this.camera.position.y, 8), // Set a ceiling of 8 for the head, helps keeps other heads in view
                       z: this.camera.position.z},
                look: {x: forward.x,
                       y: forward.y,
                       z: forward.z},
            }],
        });
    }

    benchmark = false;
    benchmarkTime = 0;
    benchmarkBytesSent = 0;
    benchmarkBytesRecv = 0;
    tick() {
        // Send all dirty pawns (even the ones selected by a client)
        let to_update = [...this.pawns.values()].filter(p => p.dirty.size != 0);
        if (to_update.length > 0) {
            this.sendSocket({type: "update_pawns", pawns: to_update.map(p => p.serializeDirty())});
            to_update.forEach(p => p.dirty.clear());
        }
        if (this.localCursor.dirty) {
            this.sendUserStatus();
            this.localCursor.dirty = false;
        }
        // Network benchmark info
        if (this.benchmark) {
            if (performance.now() - this.benchmarkTime > 1000) {
                console.log("Sent: " + ((this.benchmarkBytesSent/1024)*8).toString() +  " Kb/s");
                console.log("Recv: " + ((this.benchmarkBytesRecv/1024)*8).toString() +  " Kb/s");
                this.benchmarkBytesSent = 0;
                this.benchmarkBytesRecv = 0;
                this.benchmarkTime = performance.now();
            }
        }
    }
    raycastHover() {
        // Raycast for selectable
        // (don't raycast ground plane to stop card's being below the ground issues)
        // FIXME: Don't do this on mobile devices
        this.raycaster.setFromCamera(this.mouse, this.camera);

        let raycastableObjects = Array.from(this.pawns.values()).filter(x => x.getMesh()).map(x => x.getMesh());
        let hovered = this.raycaster.intersectObjects(raycastableObjects, true);
        this.pawns.forEach((p, k) => p.hovered = false);

        let pawn = null;
        if (hovered.length > 0) {
            hovered[0].object.traverseAncestors((a) => {
                for (const [key, value] of this.pawns) {
                    if (value.getMesh() == a) {
                        if (value.moveable && !value.selected) {
                            pawn = value;
                        }
                        value.hovered = true;
                        return;
                    }
                }
            });
        }
        return [pawn, hovered[0]?.point];
    }
    animate() {
        // Render loop
        if (!document.hidden) {
            this.renderer.render(this.scene, this.camera); // this.composer.render();
            this.controls.update();
            this.stats.update();
        }
        
        // Calculate delta time
        const time = performance.now() / 1000; // seconds
        let dt = 0;
        if (this.lastCallTime) {
            dt = time - this.lastCallTime;
        }
        this.lastCallTime = time;
        
        // Call pawn update loops
        for (const [key, value] of this.pawns) {
            value.animate(dt);
        }
        
        // Raycast all objects for selectable/cursor
        if (!document.hidden) {
            let [hovered, point] = this.raycastHover();

            display.style.cursor = hovered ? "pointer" : "auto";
            if (hovered != null && hovered instanceof Container) {
                let text = hovered.name;
                if (hovered.data.capacity !== undefined && hovered.data.capacity != null)
                    text += ` [${hovered.data.capacity}]`;

                if (this.tooltip.innerText != text)
                    this.tooltip.innerText = text;
                if (!this.tooltip.visible())
                    this.tooltip.show();
            } else {
                if (this.tooltip.visible())
                    this.tooltip.hide();
            }
            
            // Raycast for cursor plane
            let newCursorPosition = new Vector3();
            if (point) {
                newCursorPosition.copy(point);
            } else {
                let planeIntersection = this.raycaster.intersectObjects([this.plane], true);
                if (planeIntersection.length > 0)
                    newCursorPosition.copy(planeIntersection[0].point);
            }
            if (!this.localCursor.position.equals(newCursorPosition)) {
                this.localCursor.position.copy(newCursorPosition);
                this.localCursor.dirty = true;
            }
        }
        
        this.users.forEach((u) => { u.animate(); });
    }
    resize() {
        // Update camera aspect ratio
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        // Update domElement size
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);
        this.renderer.domElement.style.width = "100%";
        this.renderer.domElement.style.height = "100%";

        // Set lower pixel ratio on mobile devices
        if (window.isMobile) {
            this.renderer.setPixelRatio(1.0);
        } else {
            this.renderer.setPixelRatio(window.devicePixelRatio);
        }

        // Update composer size
        // this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    
    sendSocket(obj) {
        if (this.socket.readyState == 1) {
            let jsonText = JSON.stringify(obj, (k, v) => serializationFixedFloatMixin(k, serializationThreeTypesMixin(k, v)));
            if (COMPRESSED) {
                let buffer = new TextEncoder().encode(jsonText);
                let compressedBuffer = deflateSync(buffer, Manager.deflateOpts);
                this.socket.send(compressedBuffer);

                this.benchmarkBytesSent += compressedBuffer.length;
            } else {
                this.socket.send(jsonText);
            }
        }
    }
    
    buildScene() {
        // Create scene
        this.scene = new Scene();
        this.scene.background = null;
        
        // Setup light
        const directionalLight = new DirectionalLight(0xffffff, 0.5);
        directionalLight.castShadow = true;
        directionalLight.position.y = 25;
        directionalLight.position.x = 10;//0
        directionalLight.shadow.normalBias = 0.1;//0.05;
        const shadowExtents = 40;
        const shadowResolution = window.isMobile ? 1024 : 2048;
        directionalLight.shadow.camera.left = -shadowExtents;
        directionalLight.shadow.camera.right = shadowExtents;
        directionalLight.shadow.camera.bottom = -shadowExtents;
        directionalLight.shadow.camera.top = shadowExtents;
        directionalLight.shadow.mapSize.width = shadowResolution;
        directionalLight.shadow.mapSize.height = shadowResolution;
        this.scene.add(directionalLight);
        const directionalLight2 = new DirectionalLight(0xffffff, 0.1);
        directionalLight2.position.y = 10;
        directionalLight2.position.z = -15;
        directionalLight2.position.x = -20;
        this.scene.add(directionalLight2);

        const ambientLight = new AmbientLight(0x808080, 1.5);
        this.scene.add(ambientLight);
        
        // Setup ground plane
        const geom = new PlaneGeometry(160, 160);
        geom.rotateX(-Math.PI/2);
        const material = new ShaderMaterial();//new ShadowMaterial();
        //material.opacity = 0.5;
        //material.transparent = true;
        material.lights = true;
        material.uniforms = ShaderLib.shadow.uniforms;
        material.uniforms.dots = { value: true };
        material.uniforms.gridSize = { value: 1.0 };
        material.vertexShader = `varying vec4 worldPos;\n` + ShaderLib.shadow.vertexShader.replace("main() {", `
        main() {
            worldPos = modelMatrix * vec4(position, 1.0);
        `);
        material.fragmentShader = `
        #define GRID_THICKNESS 0.05
        #define FADE_DISTANCE 40.0

        varying vec4 worldPos;
        uniform bool dots;
        uniform float gridSize;
        
        #include <common>
        #include <packing>
        #include <fog_pars_fragment>
        #include <bsdfs>
        #include <lights_pars_begin>
        #include <shadowmap_pars_fragment>
        #include <shadowmask_pars_fragment>

        // https://iquilezles.org/articles/filterableprocedurals/
        float filteredGrid( in vec2 p, in vec2 dpdx, in vec2 dpdy )
        {
            const float N = 1.0/GRID_THICKNESS;
            vec2 w = max(abs(dpdx), abs(dpdy));
            vec2 a = p + 0.5*w;                        
            vec2 b = p - 0.5*w;           
            vec2 i = (floor(a)+min(fract(a)*N,1.0)-
                    floor(b)-min(fract(b)*N,1.0))/(N*w);
            return (1.0-i.x)*(1.0-i.y);
        }

        void main() {
            vec2 gridPos = worldPos.xz * gridSize;
            bool grid = distance(fract(gridPos), vec2(0.5)) < GRID_THICKNESS;

            float fade = 1.0 - clamp(distance(worldPos.xyz, cameraPosition)/FADE_DISTANCE, 0.0, 1.0);
            float boxAmount = (1.0 - filteredGrid(gridPos, dFdx(gridPos), dFdy(gridPos))) * 0.2 * fade;
            float dotAmount = (grid ? 0.2 : 0.0) * fade;
            float shadowAmount = 1.0 - getShadowMask();

            if (dots) {
                gl_FragColor = vec4(vec3(0), dotAmount + shadowAmount/4.0);
            } else {
                gl_FragColor = vec4(vec3(0), boxAmount + shadowAmount/4.0);
            }
        }
        `;
        this.gridMaterial = material;
        this.plane = new Mesh(geom, material);
        this.plane.position.y = 0;
        this.plane.receiveShadow = true;
        this.scene.add(this.plane);
    }
    buildRenderer() {
        this.camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 8;
        this.camera.position.y = 8;

        this.audioListener = new AudioListener();
        this.camera.add(this.audioListener);
        
        this.renderer = new WebGLRenderer({
            canvas: display, alpha: true, antialias: true, stencil: false,
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.autoUpdate = true;
        if (window.isMobile) {
            this.renderer.shadowMap.type = PCFShadowMap;
        } else {
            this.renderer.shadowMap.type = PCFSoftShadowMap;
        }

        // this.renderer.toneMapping = LinearToneMapping;
        
        // this.composer = new EffectComposer(this.renderer);
        // const renderPass = new RenderPass(this.scene, this.camera);
        // this.composer.addPass(renderPass);

        this.stats = Stats();
        this.pingPanel = this.stats.addPanel(new Stats.Panel('ping', '#ff8', '#221'));
        this.stats.dom.id = "stats";
        this.stats.dom.style.display = "none";
        document.body.appendChild(this.stats.dom);
    }
    buildControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.screenSpacePanning = false;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.15;
        this.controls.maxPolarAngle = Math.PI/2.2;
        this.controls.maxDistance = 65;
        this.controls.minDistance = 2;
        
        this.controls.keyPanSpeed = 5.0;
        this.controls.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
        //this.controls.mouseButtons = { MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
        this.controls.listenToKeyEvents(this.renderer.domElement);
    }
    buildWebSocket(callback) {
        const assignHost = (id) => {
            if (id == this.id) {
                delete document.querySelector("#control-panel").dataset.hidden;
                delete document.querySelector("[data-host-only]").dataset.hidden;
                document.querySelector("#settings #lobby-settings").removeAttribute("disabled");
                // document.querySelector("#settings #plugin-settings").removeAttribute("disabled");
                this.host = true;
                this.users.get(id).playerTextElement.innerText = "HOST\nYOU";
            } else {
                this.users.get(id).playerTextElement.innerText = "HOST";
            }
        }
        const updateSettings = (settings) => {
            for (let elem of this.settingsForm.elements) {
                if (elem.type == "checkbox") {
                    elem.checked = settings[elem.id];
                } else {
                    elem.value = settings[elem.id];
                }
            }
            if (!this.host) {
                settings.spawnPermission ? this.spawnMenu.removeAttribute("disabled") : this.spawnMenu.setAttribute("disabled", "");
            }
            let playerEntriesElem = document.querySelector("#player-entries");
            //settings.showCardCounts ? delete playerEntriesElem.dataset.hideCardCounts : playerEntriesElem.dataset.hideCardCounts = '';
            if (!settings.showCardCounts) {
                this.users.values().forEach(user => user.updateCardCount(0));
            }

            let chatElem = document.querySelector("bird-chat");
            !settings.hideChat ? delete chatElem.dataset.hidden : chatElem.dataset.hidden = '';
        }

        let lobby = window.location.pathname;
        this.socket =
            new WebSocket((location.protocol === "https:" ? "wss://" : "ws://")
                          + location.host + lobby + "/ws");
        this.socket.binaryType = "arraybuffer";
        
        this.socket.addEventListener('open', (e) => {
            this.sendSocket({
                type: "join",
                referrer: document.referrer
            });
            console.log('Connected!');
        });
        this.socket.addEventListener('close', (e) => {
            shade.style.display = 'block';
        });
        this.socket.addEventListener('message', (e) => {
            let msg;
            if (COMPRESSED) {
                console.assert(typeof e.data === 'object');
                this.benchmarkBytesRecv += new Uint8Array(e.data).length;
                msg = JSON.parse(new TextDecoder().decode(inflateSync(new Uint8Array(e.data), Manager.deflateOpts)));
            } else {
                console.assert(typeof e.data === 'string');
                this.benchmarkBytesRecv += e.data.length;
                msg = JSON.parse(e.data);
            }
            let type = msg.type;
            
            if (type == "start") {
                // We have initiated a connection
                this.host = msg.host == msg.id;
                this.id = msg.id;
                this.info = msg.info;
                
                // Start ticks
                setInterval(() => this.tick(), Manager.networkTimestep);
                msg.pawns.forEach(p => {
                    let pawn = deserializePawn(p);
                    this.addPawn(pawn);
                });

                // Start ping tester
                // Can't use WebSocket ping event type because it's not available for browser use
                let pings = 0;
                setInterval(() => {
                    this.lastPingSent = performance.now();
                    this.sendSocket({
                        type:"ping",
                        idx:pings
                    });
                    pings++;
                }, 1000);

                // Create webworker to manage animate() when page not focused
                let animateWorker = new Worker('static/js/loop.js');
                animateWorker.onmessage = (e) => {
                    if (document.hidden) {
                        this.animate();
                        this.tick();
                    }
                };
                
                // Add users
                msg.users.forEach(u => {
                    this.addUser(u.id, u.color)
                });
                // Register pawns
                Object.entries(msg.registered_pawns).forEach(([path, pawns]) => {
                    for (let pawn of pawns) {
                        this.spawnMenu.registerPawn(path, pawn);
                    }
                });
                // Assign host
                assignHost(msg.host);
                // Update settings
                updateSettings(msg.settings);
                
                // Run connected callback
                callback(this.id == this.host);
            } else if (type == "assign_host") {
                assignHost(msg.id);
            } else if (type == "register_game") {
                this.info = msg;
                delete this.info.type;
            } else if (type == "register_pawn") {
                this.spawnMenu.registerPawn(msg.path, msg.pawn);
            } else if (type == "settings") {
                updateSettings(msg);
            } else if (type == "pong") {
                let rtt = Math.floor(performance.now() - this.lastPingSent);
                this.pingPanel.update(rtt, 200);
            } else if (type == "add_pawn") {
                this.addPawn(deserializePawn(msg.pawn));
            } else if (type == "remove_pawns") {
                msg.pawns.forEach(id => this.removePawn(id));
            } else if (type == "update_pawns") {
                msg.pawns.forEach(p => this.updatePawn(p));
                // if (msg.collisions)
                //     console.log(msg.collisions);
            } else if (type == "clear_pawns") {
                this.clearPawns();
            } else if (type == "add_pawn_to_hand") {
                if (!this.hand.cards.has(msg.pawn.id))
                    this.hand.pushCard(deserializePawn(msg.pawn), false);
            } else if (type == "hand_count") {
                //this.users.get(msg.id).cardTextElement.innerText = `[${msg.count} card${msg.count == 1 ? '' : 's'}]`;
                this.users.get(msg.id).updateCardCount(msg.count);
            } else if (type == "connect") {
                // Add the connected player to the player list
                this.addUser(msg.id, msg.color);
            } else if (type == "disconnect") {
                // Add the connected player to the player list
                this.removeUser(msg.id);
            } else if (type == "chat") {
                if (msg.id == 0) {
                    this.chat.addSystemEntry(msg.content);
                    console.log(`SYS: ${msg.content}`);
                } else {
                    this.chat.addChatEntry(msg.content, this.users.get(msg.id).color);
                }
            } else if (type == "update_user_statuses") {
                msg.updates.forEach((update) => {
                    if (update.id == this.id)
                        return;
                    if (!this.users.has(update.id)) {
                        console.warn("Attempted to update status of non-existent user");
                        return;
                    }
                    
                    let newPosition = new Vector3().copy(update.cursor).add(new Vector3(0, 0.25, 0));
                    
                    this.users.get(update.id).cursorTransform.tick(newPosition);

                    let from = new Vector3().copy(update.head);
                    let target =
                        new Vector3().copy(update.look).add(update.cursor).multiplyScalar(0.5)
                        .sub(from);
                    let lookAtMatrix = new Matrix4().lookAt(new Vector3(0,0,0), target.negate(), new Vector3(0,1,0));
                    this.users.get(update.id).headTransform?.tick(
                        new Vector3().copy(update.head),
                        new Quaternion().setFromRotationMatrix(lookAtMatrix)
                    );
                });
            } else {
                console.warn("Received unhandled event: ", msg);
            }

            this.dispatchEvent(new CustomEvent(type, { detail: msg }));
        });
    }
}
