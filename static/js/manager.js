import * as THREE from 'three';
import { nanoid } from 'nanoid';

import Stats from 'three/examples/jsm/libs/stats.module';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import { Pawn, SnapPoint, Dice, Deck, Container  } from './pawns';
import { NetworkedTransform } from './transform';
import { Hand } from './hand';

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

class ContextMenu {
    manager;
    element;

    visible = false;

    constructor(manager) {
        this.manager = manager;
        this.element = document.querySelector('#context-menu');

        this.element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        document.addEventListener('pointerdown', (e) => {
            if (!this.element.contains(e.target) && this.visible) {
                this.hide();
            }
        });
    }

    show(event, menu) {
        // Remove children
        while (this.element.firstChild) {
            this.element.firstChild.remove();
        }
        
        // Create buttons
        for (let [i, section] of menu.entries()) {
            for (let entry of section) {
                if (entry.length == 1) {
                    let text = document.createElement("p");
                    text.innerText = entry[0];

                    this.element.appendChild(text);
                } else if (entry.length == 2) {
                    let [name, action] = entry;

                    let button = document.createElement("button");
                    button.innerText = name;
                    button.addEventListener("click", () => {
                        this.hide();
                        action();
                    });

                    this.element.appendChild(button);
                }
            }

            // Create divider
            if (i != menu.length - 1) {
                let divider = document.createElement("hr");
                this.element.appendChild(divider);
            }
        }

        this.element.style.left = event.clientX + "px";
        this.element.style.top = event.clientY + "px";
        this.element.style.display = "block";

        this.visible = true;
    }
    hide() {
        this.element.style.display = "none";

        this.visible = false;
    }
}

class Chat {
    manager;

    panel;
    input;
    entries;

    focused = false;

    constructor(manager) {
        this.manager = manager;

        this.panel = document.querySelector("#chat-panel");
        this.input = document.querySelector("#chat-input");
        this.entries = document.querySelector("#chat-entries");

        let clickingPanel = false;
        this.panel.addEventListener('pointerdown', () => {
            if (!this.focused)
                clickingPanel = true;
        });
        document.addEventListener("mouseup", () => {
            if (clickingPanel) {
                this.focus();
                clickingPanel = false;
            }
        });
        this.input.addEventListener("keydown", (e) => {
            if (e.key == "Enter") {
                if (this.input.value != "") {
                    this.send(this.input.value);
                }
                this.blur();
            }
        });
        this.input.addEventListener("blur", (e) => {
            this.blur();
        });
    }

    focus() {
        this.focused = true;

        this.panel.style.cursor = "auto";
        this.panel.style.opacity = "1";
        this.input.style.pointerEvents = "auto";
        this.input.focus();
        this.input.select();
    }
    blur() {
        this.focused = false;

        this.panel.style.cursor = "pointer";
        this.panel.style.opacity = "0.2";
        this.input.style.pointerEvents = "none";
        this.input.value = "";
        this.input.blur();
        display.focus();
    }

    send(content) {
        this.manager.sendSocket({
            type:"chat",
            content:content,
        });
    }

    chatFadeTimeout;
    addChatEntry(id, content) {
        let entry = document.createElement("p");
        entry.classList.add("entry");
        
        let name = document.createElement("span");
        name.innerText = "⬤: ";
        name.style.color = this.manager.userColors.get(id);
        let text = document.createElement("span");
        text.innerText = content;
        
        entry.appendChild(name);
        entry.appendChild(text);
        this.entries.appendChild(entry);
        this.entries.scrollTop = this.entries.scrollHeight;
        
        this.panel.style.opacity = "1";
        if (this.chatFadeTimeout !== undefined)
            clearTimeout(this.chatFadeTimeout);
        this.chatFadeTimeout = setTimeout(() => {
            if (this.input != document.activeElement)
                this.panel.style.opacity = "0.2";
        }, 4000);
    }
}

export default class Manager {
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

    hand = new Hand(this);
    contextMenu = new ContextMenu(this);
    chat = new Chat(this);
    
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
    
    async init(callback) {
        this.buildScene();
        this.buildRenderer();
        this.buildControls();
        
        this.resize();

        // Enable cache
        THREE.Cache.enabled = true;
        
        // Track mouse position
        display.addEventListener('pointermove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth)*2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight)*2 + 1;
            tooltip.style.top = e.clientY + "px";
            tooltip.style.left = e.clientX + "px";
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
                let rotation = new THREE.Euler().setFromQuaternion(p.rotation, 'ZYX').toVector3();
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
                tooltip.innerText = hovered.name;
                if (hovered.data.capacity !== undefined && hovered.data.capacity != null)
                    tooltip.innerText += ` [${hovered.data.capacity}]`;
                tooltip.style.display = "block";
            } else {
                tooltip.style.display = "none";
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
    pendingEvents = new Map();
    sendEvent(name, target, data, callback) {
        //target = true (target host only), false (target all)
        let uuid = nanoid(6);
        let event = {
            type:"event",
            sender:this.id,
            uuid:uuid,
            name:name,
            target:target,
            callback:(callback !== undefined),
            data:data
        };
        
        if (target == true && this.host) {
            // We are sending an event to ourselves, no need to use websockets, let's just detour
            if (callback !== undefined)
                this.pendingEvents.set(uuid, callback);
            this.handleEvent(event);
        } else {
            if (callback !== undefined)
                this.pendingEvents.set(uuid, callback);
            this.sendSocket(event);
        }
    }
    handleEvent(eventJSON) {
        let name = eventJSON.name;
        let response = {};
        
        switch (eventJSON.name) {
            case "pawn":
                response = this.pawns.get(eventJSON.data.id).handleEvent(eventJSON.data);
                break;
            case "request_add_pawn":
                let pawn = this.loadPawn(eventJSON.data.pawn);
                this.sendAddPawn(pawn);
                response = pawn.id;
                break;
            case "request_update_pawns":
                eventJSON.data.pawns.forEach(p => this.updatePawn(p));
                this.sendSocket({
                    type:"update_pawns",
                    pawns:eventJSON.data.pawns
                });
                break;
        }
        
        // Callback 
        if (eventJSON.callback && this.host) {
            this.sendSocket({
                type:"event_callback",
                receiver:eventJSON.sender,
                data:response,
                uuid:eventJSON.uuid,
            });
        }
    }
    eventCallback(callbackJSON) {
        this.pendingEvents.get(callbackJSON.uuid)(callbackJSON.data);
        this.pendingEvents.delete(callbackJSON.uuid);
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
        
        this.controls.keyPanSpeed = 20;
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
                let pings = 0;
                setInterval(() => {
                    this.lastPingSent = performance.now();
                    this.sendSocket({
                        type:"ping",
                        idx:pings
                    });
                    pings++;
                }, 500);
                // Create webworker to manage animate() when page not focused
                let animateWorker = new Worker('/js/loop.js');
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
            
            if (type == "event") {
                this.handleEvent(msg);
            } else if (type == "event_callback") {
                this.eventCallback(msg);
            }
            
            if (type == "add_pawn") {
                this.addPawn(msg.pawn);
            } else if (type == "remove_pawns") {
                msg.pawns.forEach(id => this.removePawn(id));
            } else if (type == "update_pawns") {
                msg.pawns.forEach(p => this.updatePawn(p));
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
                this.chat.addChatEntry(msg.id, msg.content);
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
        });
    }
}
