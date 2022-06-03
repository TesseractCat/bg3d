import * as THREE from 'three';
import { nanoid } from 'nanoid';

import Stats from 'three/examples/jsm/libs/stats.module';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { Pawn, Dice, Deck, Container  } from './pawns';
import { NetworkedTransform } from './transform';

class Hand {
    manager;
    cards = [];
    
    constructor(manager) {
        this.manager = manager;
    }
    
    pushCard(deck) {
        let cardProps = deck.serialize();
        this.cards.push(cardProps);
        console.assert(cardProps.data.contents.length == 1);
        
        let imageElement = document.createElement("img");
        imageElement.src = `games/${cardProps.data.contents[0]}`;
        imageElement.style.borderRadius = `${cardProps.data.cornerRadius}in`;
        imageElement.addEventListener("click",
            () => this.takeCard(imageElement));
        imageElement.oncontextmenu = function() {
            return false;
        }
        document.querySelector("#hand-panel").appendChild(imageElement);
    }
    takeCard(elem) {
        if ([...this.manager.pawns.values()].filter(p => p.selected).length != 0)
            return;
        
        const idx = [...elem.parentElement.children].indexOf(elem);
        let card = this.cards[idx];
        
        let raycastableObjects = [...this.manager.pawns.values()].map(x => x.mesh);
        raycastableObjects.push(this.manager.plane);
        let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);
        
        if (hits.length >= 1) {
            let hitPoint = hits[0].point.clone();
            card.position = hitPoint.add(new THREE.Vector3(0, 2, 0));
            
            this.manager.sendEvent("request_add_pawn", true, {pawn:card}, (id) => {
                this.manager.pawns.get(id).grab(0);
                
                this.cards.splice(idx, 1);
                elem.remove();
            });
        }
    }
}

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

export default class Manager {
    scene;
    camera;
    renderer;
    composer;
    controls;
    socket;
    plane;
    
    stats;
    pingPanel;
    
    pawns = new Map();
    hand = new Hand(this);
    
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    cursorPosition = new THREE.Vector3();
    lobbyCursors = new Map();
    
    host = false;
    id;
    userColors = new Map();
    
    static networkTimestep = 1000/20; // Milliseconds
    lastCallTime;
    
    lastPingSent;
    
    constructor() {
        this.loader = new GLTFLoader().setPath(window.location.href + '/');
    }
    
    async init(callback) {
        this.buildScene();
        this.buildRenderer();
        this.buildControls();
        
        this.resize();
        
        // Track mouse position
        display.addEventListener("mousemove", (e) => {
            this.mouse.x = (e.clientX / window.innerWidth)*2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight)*2 + 1;
            tooltip.style.top = e.clientY + "px";
            tooltip.style.left = e.clientX + "px";
        });
        
        let dragged = false;
        let downPos = {x: 0, y:0};
        display.addEventListener('mousedown', (e) => {
            dragged = false;
            downPos = {x: e.clientX, y: e.clientY};
        });
        display.addEventListener('mousemove', (e) => {
            // Fix intermittent chrome bug where mouse move is triggered incorrectly
            // https://bugs.chromium.org/p/chromium/issues/detail?id=721341
            if (downPos.x - e.clientX != 0 && downPos.y - e.clientY != 0)
                dragged = true;
        });
        display.addEventListener("mouseup", (e) => {
            if (dragged)
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
            toSelect[0].grab(e.button);
        });
        
        // Chat
        display.addEventListener("keydown", (e) => {
            if (e.key == "Enter") {
                //document.querySelector("#chat-panel").style.display = "block";
                document.querySelector("#chat-panel").style.opacity = "1";
                document.querySelector("#chat-panel").style.pointerEvents = "auto";
                document.querySelector("#chat-input").focus();
                document.querySelector("#chat-input").select();
            }
        });
        document.querySelector("#chat-input").addEventListener("keydown", (e) => {
            if (e.key == "Enter") {
                if (document.querySelector("#chat-input").value != "") {
                    this.sendEvent("chat", false, {
                        id:this.id,
                        content:document.querySelector("#chat-input").value
                    });
                }
                //document.querySelector("#chat-panel").style.display = "none";
                document.querySelector("#chat-panel").style.opacity = "0.2";
                document.querySelector("#chat-panel").style.pointerEvents = "none";
                document.querySelector("#chat-input").value = "";
                document.querySelector("#chat-input").blur();
                display.focus();
            }
        });
        document.querySelector("#chat-input").addEventListener("blur", (e) => {
            document.querySelector("#chat-panel").style.opacity = "0.2";
            document.querySelector("#chat-panel").style.pointerEvents = "none";
            document.querySelector("#chat-input").value = "";
        });
        
        // Route events to active pawns
        document.addEventListener("keydown", (e) => {
            this.pawns.forEach(p => {
                if (p.selected)
                    p.keyDown(e);
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
    chatFadeTimeout;
    addChatEntry(chatJSON) {
        let entry = document.createElement("p");
        entry.classList.add("entry");
        
        let name = document.createElement("span");
        name.innerText = "⬤: ";
        name.style.color = this.userColors.get(chatJSON.id);
        let text = document.createElement("span");
        text.innerText = chatJSON.content;
        
        entry.appendChild(name);
        entry.appendChild(text);
        document.querySelector("#chat-entries").appendChild(entry);
        document.querySelector("#chat-entries").scrollTop =
            document.querySelector("#chat-entries").scrollHeight;
        
        document.querySelector("#chat-panel").style.opacity = "1";
        if (this.chatFadeTimeout !== undefined)
            clearTimeout(this.chatFadeTimeout);
        this.chatFadeTimeout = setTimeout(() => {
            if (document.querySelector("#chat-input") != document.activeElement)
                document.querySelector("#chat-panel").style.opacity = "0.2";
        }, 2000);
    }
    
    clear() {
        this.sendSocket({
            type:"clear_pawns",
        });
    }
    addPawn(pawn) {
        console.log("Adding pawn with ID: " + pawn.id);
        // pawn.init();
        // this.pawns.set(pawn.id, pawn);
        this.sendSocket({
            type:"add_pawn",
            pawn:pawn.serialize()
        });
    }
    removePawn(id) {
        this.scene.remove(this.pawns.get(id).mesh);
        this.pawns.delete(id);
    }
    loadPawn(pawnJSON) {
        let pawn;
        switch (pawnJSON.class) {
            case "Pawn":
                pawn = Pawn.deserialize(this, pawnJSON);
                break;
            case "Dice":
                pawn = Dice.deserialize(this, pawnJSON);
                break;
            case "Deck":
                pawn = Deck.deserialize(this, pawnJSON);
                break;
            case "Container":
                pawn = Container.deserialize(this, pawnJSON);
                break;
            default:
                console.error("Encountered unknown pawn type!");
                return;
        }
        return pawn;
    }
    updatePawn(pawnJSON) {
        if (!this.pawns.has(pawnJSON.id)) {
            console.warn("Attempting to update non existent pawn");
            return;
        }
        let pawn = this.pawns.get(pawnJSON.id);
        if (pawnJSON.hasOwnProperty('selected')) {
            if (pawn.networkSelected && !pawnJSON.selected && !pawn.simulateLocally) {
                //This pawn has been released, reset the network buffer and update position
                pawn.setPosition(new THREE.Vector3().copy(pawnJSON.position));
                pawn.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation)));
            }
            //TODO: Disable simulateLocally in some cases?
            pawn.networkSelected = pawnJSON.selected;
        }
        if (pawnJSON.hasOwnProperty('position') && pawnJSON.hasOwnProperty('rotation')) {
            pawn.networkTransform.tick(
                new THREE.Vector3().copy(pawnJSON.position),
                new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation, 'ZYX')));
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
        playerElement.innerText = "⬤";//id;
        playerElement.style.color = color;
        playerElement.classList.add("player");
        playerElement.classList.add("p" + id);
        
        if (id == this.id)
            playerElement.innerText += " (You)";
        
        document.querySelector("#player-entries").appendChild(playerElement);
        
        // Create cursor entry/object
        if (id != this.id) {
            let cursor = new Cursor(new THREE.Color(color));
            this.scene.add(cursor.mesh);
            this.lobbyCursors.set(id, cursor);
        }
    }
    removeUser(id) {
        document.querySelector(".player.p" + id).remove();
        this.scene.remove(this.lobbyCursors.get(id).mesh);
        this.lobbyCursors.delete(id);
        this.userColors.delete(id);
    }
    
    sendCursor() {
        this.sendSocket({
            type:"send_cursor",
            position:{x:this.cursorPosition.x, y:this.cursorPosition.y, z:this.cursorPosition.z}
        });
    }
    tick() {
        // Send all dirty pawns (even the ones selected by a client)
        let to_update = Array.from(this.pawns.values()).filter(p => p.dirty.size != 0);
        if (to_update.length > 0) {
            let to_update_data = to_update.map(p => {
                let rotation = new THREE.Euler().setFromQuaternion(p.rotation).toVector3();
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
        this.sendCursor();
    }
    animate() {
        // Render loop
        if (!document.hidden) {
            this.composer.render();
            this.controls.update();
            this.stats.update();
        }
        
        this.raycaster.setFromCamera(this.mouse, this.camera);

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
            // Raycast for selectable
            // (don't raycast ground plane to stop card's being below the ground issues)
            let raycastableObjects = Array.from(this.pawns.values()).filter(x => x.mesh).map(x => x.mesh);
            let hovered = this.raycaster.intersectObjects(raycastableObjects, true);
            this.pawns.forEach((p, k) => p.hovered = false);
            if (hovered.length > 0) {
                let pawnHovered = false;
                let pawn = null;
                hovered[0].object.traverseAncestors((a) => {
                    for (const [key, value] of this.pawns) {
                        if (value.mesh == a) {
                            if (value.moveable && !value.selected) {
                                pawnHovered = true;
                                pawn = value;
                            }
                            value.hovered = true;
                            return;
                        }
                    }
                });
                display.style.cursor = pawnHovered ? "pointer" : "auto";
                if (pawnHovered && pawn != null && pawn.constructor.className() == "Container") {
                    tooltip.innerText = pawn.name;
                    tooltip.style.display = "block";
                } else {
                    tooltip.style.display = "none";
                }
            } else {
                display.style.cursor = "auto";
                tooltip.style.display = "none";
            }
            
            // Raycast for cursor plane
            raycastableObjects.push(this.plane);
            hovered = this.raycaster.intersectObjects(raycastableObjects, true);
            if (hovered.length > 0)
                this.cursorPosition.copy(hovered[0].point);
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

        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Update composer size
        this.composer.setSize(window.innerWidth, window.innerHeight);
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
                this.addPawn(pawn);
                response = pawn.id;
                break;
            case "clear_pawns":
                this.sendSocket({
                    type:"remove_pawns",
                    pawns:Array.from(this.pawns.values()).map(p => p.id)
                });
                break;
            case "request_update_pawns":
                eventJSON.data.pawns.forEach(p => this.updatePawn(p));
                this.sendSocket({
                    type:"update_pawns",
                    pawns:eventJSON.data.pawns
                });
                break;
            case "chat":
                this.addChatEntry(eventJSON.data);
                break;
        }
        
        // Callback 
        if (eventJSON.callback) {
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
        const geom = new THREE.PlaneGeometry( 200, 200 );
        geom.rotateX(- Math.PI/2);
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
        
        this.renderer = new THREE.WebGLRenderer({canvas: display, alpha: true, antialias: true});
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.autoUpdate = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        
        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);
        /*const ssaoPass = new SSAOPass(this.scene, this.camera, 20, 20);
        ssaoPass.minDistance /= 30;
        ssaoPass.maxDistance /= 30;
        ssaoPass.kernelRadius = 16/30;
        ssaoPass.output = 0;
        this.composer.addPass(ssaoPass);
        const gammaCorrectionPass = new ShaderPass(GammaCorrectionShader)
        this.composer.addPass(gammaCorrectionPass);*/

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
        this.controls.listenToKeyEvents(display);
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
                this.host = msg["host"];
                this.id = msg.id;
                
                callback(this.host);
                
                // Start ticks
                if (this.host) {
                    setInterval(() => this.tick(), Manager.networkTimestep);
                } else {
                    setInterval(() => this.tick(), Manager.networkTimestep);
                    // If we aren't the host, let's deserialize the pawns received
                    msg.pawns.forEach(p => {
                        let pawn = this.loadPawn(p);
                        pawn.init();
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
                let animateWorker = new Worker('js/loop.js');
                animateWorker.onmessage = (e) => {
                    if (document.hidden) {
                        this.animate();
                        this.tick();
                    }
                };
                
                // Add users
                msg.users.sort((a, b) => b.id == this.id ? 1 : -1).forEach(u => {
                    this.addUser(u.id, u.color)
                });
            } else if (type == "assign_host") {
                document.querySelector("#host-panel").style.display = "block";
                this.host = true;
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
                let pawn = this.loadPawn(msg.pawn);
                this.pawns.set(pawn.id, pawn);
                pawn.init();
            } else if (type == "remove_pawns") {
                msg.pawns.forEach(id => this.removePawn(id));
            } else if (type == "update_pawns") {
                msg.pawns.forEach(p => this.updatePawn(p));
            }
            
            if (type == "connect") {
                // Add the connected player to the player list
                this.addUser(msg.id, msg.color);
            } else if (type == "disconnect") {
                // Add the connected player to the player list
                this.removeUser(msg.id);
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
