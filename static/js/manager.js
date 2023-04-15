import * as THREE from 'three';
import { nanoid } from 'nanoid';

import Stats from 'three/addons/libs/stats.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { OrbitControls } from './OrbitControls.js';

import { Pawn, SnapPoint, Dice, Deck, Container  } from './pawns';
import { NetworkedTransform } from './transform';

class Cursor {
    mesh;
    networkTransform;
    
    constructor(color) {
        const cursorGeometry = new THREE.SphereGeometry(0.32, 12, 12);
        const cursorMaterial = new THREE.MeshBasicMaterial( {color: color} );
        const cursorObject = new THREE.Mesh(cursorGeometry, cursorMaterial);
        
        this.mesh = cursorObject;
        this.networkTransform = new NetworkedTransform(new THREE.Vector3(), new THREE.Quaternion());
    }
    animate() {
        this.networkTransform.animate();
        this.mesh.position.copy(this.networkTransform.position);
        this.mesh.quaternion.copy(this.networkTransform.rotation);
    }
}

export default class Manager extends EventTarget {
    scene;
    camera;
    audioListener;
    renderer;
    composer;
    controls;
    socket;
    plane;
    
    stats;
    pingPanel;
    
    pawns = new Map();

    hand;
    chat;
    contextMenu;
    tooltip;
    
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    localCursor = {
        position: new THREE.Vector3(),
        dirty: false
    };
    lobbyCursors = new Map();
    
    host = false;
    id;
    userColors = new Map();
    info;
    
    static networkTimestep = 1000/20; // Milliseconds
    lastCallTime;
    
    lastPingSent;
    
    constructor() {
        super();
    }

    async init(callback) {
        this.buildScene();
        this.buildRenderer();
        this.buildControls();
        
        this.resize();

        // Setup custom elements
        this.hand = document.querySelector("bird-hand");
        this.chat = document.querySelector("bird-chat");
        this.contextMenu = document.querySelector("bird-context-menu");
        this.tooltip = document.querySelector("bird-tooltip");

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

            let raycastableObjects = [...this.pawns.values()].map(x => x.mesh);
            raycastableObjects.push(this.plane);
            let hits = this.raycaster.intersectObjects(raycastableObjects, true);
            
            if (hits.length >= 1) {
                let hitPoint = hits[0].point.clone();
                card.position = hitPoint.add(new THREE.Vector3(0, 2, 0));
                
                let cardPawn = this.loadPawn(card);
                const grabHandler = (e) => {
                    if (e.detail.pawn.id == cardPawn.id) {
                        this.pawns.get(cardPawn.id).grab(0);
                        this.removeEventListener("add_pawn", grabHandler);
                    }
                };
                this.addEventListener("add_pawn", grabHandler);
                this.sendAddPawn(cardPawn);
            }
        });

        // Enable cache
        THREE.Cache.enabled = true;
        
        // Track mouse position
        display.addEventListener('pointermove', (e) => {
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
            if (e.key == "Enter") {
                this.chat.focus();
            }
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
            this.scene.remove(this.pawns.get(id).mesh);
            this.pawns.get(id).dispose();
            this.pawns.delete(id);
        });
        this.hand.clear();
        THREE.Cache.clear();
        Deck.textureCache.clear();
    }
    sendClearPawns() {
        this.sendSocket({
            type:"clear_pawns",
        });
    }
    addPawn(toAdd) {
        if (this.pawns.has(toAdd.id) || this.hand.cards.has(toAdd.id)) {
            this.updatePawn(toAdd);
        } else {
            if (toAdd instanceof Pawn) {
                this.pawns.set(toAdd.id, toAdd);
                toAdd.init(this);
            } else {
                let pawn = this.loadPawn(toAdd);
                this.pawns.set(pawn.id, pawn);
                pawn.init(this);
            }
        }
    }
    sendAddPawn(toAdd) {
        let serialized = toAdd.serialize();

        this.sendSocket({
            type:"add_pawn",
            pawn:serialized
        });
    }
    removePawn(id) {
        if (this.pawns.has(id)) {
            this.scene.remove(this.pawns.get(id).mesh);
            this.pawns.get(id).dispose();
            this.pawns.delete(id);
        }
    }
    sendRemovePawn(id) {
        console.log("Removing pawn with ID: " + id);
        this.sendSocket({
            type:"remove_pawns",
            pawns:[id],
        });
    }
    loadPawn(pawnJSON) {
        let pawn;
        switch (pawnJSON.class) {
            case "Pawn":
                pawn = Pawn.deserialize(pawnJSON);
                break;
            case "SnapPoint":
                pawn = SnapPoint.deserialize(pawnJSON);
                break;
            case "Dice":
                pawn = Dice.deserialize(pawnJSON);
                break;
            case "Deck":
                pawn = Deck.deserialize(pawnJSON);
                break;
            case "Container":
                pawn = Container.deserialize(pawnJSON);
                break;
            default:
                console.error("Encountered unknown pawn type!");
                return;
        }
        return pawn;
    }
    updatePawn(pawnJSON) {
        if (!this.pawns.has(pawnJSON.id)) {
            if (this.hand.cards.has(pawnJSON.id)) {
                this.hand.updateCard(pawnJSON);
            } else {
                console.warn("Attempting to update non-existent pawn");
            }
            return;
        }
        let pawn = this.pawns.get(pawnJSON.id);

        if (pawnJSON.hasOwnProperty('selected')) {
            if (pawn.networkSelected && !pawnJSON.selected) {
                // This pawn has been grabbed/released, reset the network buffer and update position
                if (pawnJSON.hasOwnProperty('position') && pawnJSON.hasOwnProperty('rotation')) {
                    pawn.setPosition(new THREE.Vector3().copy(pawnJSON.position));
                    pawn.setRotation(new THREE.Quaternion().setFromEuler(
                        new THREE.Euler().setFromVector3(pawnJSON.rotation, 'ZYX')
                    ));
                }
            }
            pawn.networkSelected = pawnJSON.selected;
        }
        if (pawnJSON.hasOwnProperty('position') && pawnJSON.hasOwnProperty('rotation')) {
            pawn.networkTransform.tick(
                new THREE.Vector3().copy(pawnJSON.position),
                new THREE.Quaternion().setFromEuler(
                    new THREE.Euler().setFromVector3(pawnJSON.rotation, 'ZYX')
                )
            );
        }
        if (pawnJSON.hasOwnProperty('selectRotation')) {
            pawn.selectRotation = pawnJSON.selectRotation;
        }
        if (pawnJSON.hasOwnProperty('data')) {
            pawn.data = pawnJSON.data;
            pawn.processData();
        }
    }
    
    addUser(id, color) {
        this.userColors.set(id, color);
        
        // Create element
        let playerElement = document.createElement("h2");
        playerElement.innerText = "";//id;
        playerElement.style.color = color;
        playerElement.classList.add("player");
        playerElement.dataset.id = id;
        
        if (id == this.id)
            playerElement.innerText += " (You)";
        
        let playerList = document.querySelector("#player-entries");
        for (let entryNode of playerList.children) {
            if (id < parseInt(entryNode.dataset.id)) {
                playerList.insertBefore(playerElement, entryNode);
                break;
            } 
        }
        if (playerElement.parentNode != playerList)
            playerList.appendChild(playerElement);
        
        // Create cursor entry/object
        if (id != this.id) {
            let cursor = new Cursor(new THREE.Color(color));
            this.scene.add(cursor.mesh);
            this.lobbyCursors.set(id, cursor);
        }
    }
    removeUser(id) {
        document.querySelector(`.player[data-id="${id}"]`).remove();
        this.scene.remove(this.lobbyCursors.get(id).mesh);
        this.lobbyCursors.delete(id);
        this.userColors.delete(id);
    }
    
    sendCursor() {
        this.sendSocket({
            type:"send_cursor",
            position:{x:this.localCursor.position.x,
                      y:this.localCursor.position.y,
                      z:this.localCursor.position.z}
        });
    }
    tick() {
        // Send all dirty pawns (even the ones selected by a client)
        let to_update = Array.from(this.pawns.values()).filter(p => p.dirty.size != 0);
        if (to_update.length > 0) {
            let to_update_data = to_update.map(p => {
                let rotation = new THREE.Vector3().setFromEuler(new THREE.Euler().setFromQuaternion(p.rotation, 'ZYX'));
                let update = {id: p.id};
                for (let dirtyParam of p.dirty) {
                    switch (dirtyParam) {
                        case "rotation":
                            update[dirtyParam] = rotation;
                            break;
                        default:
                            update[dirtyParam] = p[dirtyParam];
                            break;
                    }
                }
                return update;
            });

            this.sendSocket({type: "update_pawns", pawns: to_update_data});
            to_update.forEach(p => p.dirty.clear());
        }
        if (this.localCursor.dirty) {
            this.sendCursor();
            this.localCursor.dirty = false;
        }
    }
    raycastHover() {
        // Raycast for selectable
        // (don't raycast ground plane to stop card's being below the ground issues)
        // FIXME: Don't do this on mobile devices
        this.raycaster.setFromCamera(this.mouse, this.camera);

        let raycastableObjects = Array.from(this.pawns.values()).filter(x => x.mesh).map(x => x.mesh);
        let hovered = this.raycaster.intersectObjects(raycastableObjects, true);
        this.pawns.forEach((p, k) => p.hovered = false);

        let pawn = null;
        if (hovered.length > 0) {
            hovered[0].object.traverseAncestors((a) => {
                for (const [key, value] of this.pawns) {
                    if (value.mesh == a) {
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
                if (!this.tooltip.visible()) {
                    this.tooltip.innerText = hovered.name;
                    if (hovered.data.capacity !== undefined && hovered.data.capacity != null)
                        this.tooltip.innerText += ` [${hovered.data.capacity}]`;
                    this.tooltip.show();
                }
            } else {
                if (this.tooltip.visible()) {
                    this.tooltip.hide();
                }
            }
            
            // Raycast for cursor plane
            let newCursorPosition = new THREE.Vector3();
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
        
        // Lerp all cursors
        this.lobbyCursors.forEach((c) => { c.animate(); });
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
    
    benchmark = false;
    benchmarkTime = 0;
    benchmarkBytes = 0;
    sendSocket(obj) {
        let json = JSON.stringify(obj, function(k,v) {
            if (typeof v === "number") {
                //FIXME: Is this enough precision?
                return parseFloat(v.toFixed(2));
            }
            return v;
        });
        if (this.benchmark) {
            this.benchmarkBytes += new TextEncoder().encode(json).length;
            if (performance.now() - this.benchmarkTime > 1000) {
                console.log((this.benchmarkBytes/1000).toString() +  " KB/s");
                this.benchmarkBytes = 0;
                this.benchmarkTime = performance.now();
            }
        }
        if (this.socket.readyState == 1)
            this.socket.send(json);
    }
    
    buildScene() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = null;
        
        // Setup light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.castShadow = true;
        directionalLight.position.y = 25;
        directionalLight.position.x = 10;//0
        directionalLight.shadow.normalBias = 0.1;//0.05;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.bottom = -50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.mapSize.width = 2048;//1024;
        directionalLight.shadow.mapSize.height = 2048;//1024;
        this.scene.add(directionalLight);
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.1);
        directionalLight2.position.y = 10;
        directionalLight2.position.z = -15;
        directionalLight2.position.x = -20;
        this.scene.add(directionalLight2);

        const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
        this.scene.add(ambientLight);
        
        // Setup ground plane
        const geom = new THREE.PlaneGeometry(200, 200);
        geom.rotateX(-Math.PI/2);
        const material = new THREE.ShadowMaterial();
        material.opacity = 0.3;
        this.plane = new THREE.Mesh(geom, material);
        this.plane.position.y = 0;
        this.plane.receiveShadow = true;
        this.scene.add(this.plane);
    }
    buildRenderer() {
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 15;
        this.camera.position.y = 8;

        this.audioListener = new THREE.AudioListener();
        this.camera.add(this.audioListener);
        
        this.renderer = new THREE.WebGLRenderer({
            canvas: display, alpha: true, antialias: true, stencil: false,
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.autoUpdate = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        
        // this.composer = new EffectComposer(this.renderer);
        // const renderPass = new RenderPass(this.scene, this.camera);
        // this.composer.addPass(renderPass);

        this.stats = Stats();
        this.pingPanel = this.stats.addPanel(new Stats.Panel('ping', '#ff8', '#221'));
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
        //this.controls.mouseButtons = { MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
        this.controls.listenToKeyEvents(this.renderer.domElement);
    }
    buildWebSocket(callback) {
        let lobby = window.location.pathname;
        this.socket =
            new WebSocket((location.protocol === "https:" ? "wss://" : "ws://")
                          + location.host + lobby + "/ws");
        
        this.socket.addEventListener('open', (e) => {
            this.sendSocket({
                type: "join"
            });
            console.log('Connected!');
        });
        this.socket.addEventListener('close', (e) => {
            shade.style.display = 'block'
        });
        this.socket.addEventListener('message', (e) => {
            let msg = JSON.parse(e.data);
            let type = msg.type;
            
            if (type == "start") {
                // We have initiated a connection
                this.host = msg.host;
                this.id = msg.id;
                this.info = msg.info;
                
                callback(this.host);
                
                // Start ticks
                if (this.host) {
                    setInterval(() => this.tick(), Manager.networkTimestep);
                } else {
                    setInterval(() => this.tick(), Manager.networkTimestep);
                    // If we aren't the host, let's deserialize the pawns received
                    msg.pawns.forEach(p => {
                        let pawn = this.loadPawn(p);
                        pawn.init(this);
                        this.pawns.set(pawn.id, pawn);
                    });
                }
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
            } else if (type == "assign_host") {
                document.querySelector("#host-panel").style.display = "block";
                this.host = true;
            }

            if (type == "register_game") {
                this.info = msg;
                delete this.info.type;
            }
            
            if (type == "pong") {
                let rtt = Math.floor(performance.now() - this.lastPingSent);
                this.pingPanel.update(rtt, 200);
            }
            
            if (type == "add_pawn") {
                this.addPawn(msg.pawn);
            } else if (type == "remove_pawns") {
                msg.pawns.forEach(id => this.removePawn(id));
            } else if (type == "update_pawns") {
                msg.pawns.forEach(p => this.updatePawn(p));
                if (msg.collisions)
                    console.log(msg.collisions);
            } else if (type == "clear_pawns") {
                this.clearPawns();
            }
            
            if (type == "connect") {
                // Add the connected player to the player list
                this.addUser(msg.id, msg.color);
            } else if (type == "disconnect") {
                // Add the connected player to the player list
                this.removeUser(msg.id);
            }

            if (type == "chat") {
                this.chat.addChatEntry(msg.id, msg.content, this.userColors.get(msg.id));
            }
            
            if (type == "relay_cursors") {
                msg.cursors.forEach((cursor) => {
                    if (cursor.id == this.id)
                        return;
                    
                    let newPosition = new THREE.Vector3().copy(cursor.position).add(new THREE.Vector3(0, 0.25, 0));
                    if (this.lobbyCursors.has(cursor.id))
                        this.lobbyCursors.get(cursor.id).networkTransform.tick(newPosition);
                });
            }

            this.dispatchEvent(new CustomEvent(type, { detail: msg }));
        });
    }
}
