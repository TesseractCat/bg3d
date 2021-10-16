import * as THREE from 'three';
import * as CANNON from 'cannon-es'

import Stats from '../deps/libs/stats.module';
import { EffectComposer } from '../deps/postprocessing/EffectComposer';
import { RenderPass } from '../deps/postprocessing/RenderPass';
import { ShaderPass } from '../deps/postprocessing/ShaderPass';
import { SAOPass } from '../deps/postprocessing/SAOPass';
import { SSAOPass } from '../deps/postprocessing/SSAOPass';
import { PixelShader } from '../deps/shaders/PixelShader';
import { OrbitControls } from '../deps/controls/OrbitControls';
import { GLTFLoader } from '../deps/loaders/GLTFLoader.js';

import Pawn from './pawn';

CANNON.Shape.prototype.serialize = function() {
    var shape = {};
    shape.type = this.type;
    switch (shape.type) {
        case CANNON.Shape.types.BOX:
            shape.halfExtents = {x: this.halfExtents.x, y: this.halfExtents.y, z: this.halfExtents.z};
            break;
        case CANNON.Shape.types.CYLINDER:
            shape.radiusTop = this.radiusTop;
            shape.radiusBottom = this.radiusBottom;
            shape.height = this.height;
            shape.numSegments = this.numSegments;
            break;
        default:
            console.error("Attempting to serialize unhandled shape!");
            break;
    }
    return shape;
}
CANNON.Shape.prototype.deserialize = function(shape) {
    switch (shape.type) {
        case CANNON.Shape.types.BOX:
            return new CANNON.Box(new CANNON.Vec3().copy(shape.halfExtents));
        case CANNON.Shape.types.CYLINDER:
            return new CANNON.Cylinder(shape.radiusTop, shape.radiusBottom, shape.height, shape.numSegments);
        default:
            console.error("Attempting to deserialize unhandled shape!");
            break;
    }
}

export default class Manager {
    scene;
    camera;
    renderer;
    composer;
    controls;
    stats;
    world;
    socket;
    
    pawns = new Map();
    plane;
    
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    host = false;
    
    static physicsTimestep = 1/60;
    static networkTimestep = 1000/10;
    lastCallTime;
    
    constructor() {
        this.loader = new GLTFLoader().setPath('../models/');
    }
    
    init(callback) {
        this.buildScene();
        this.buildRenderer();
        this.buildControls();
        this.buildPhysics();
        
        this.resize();
        
        document.addEventListener("mousemove", (e) => {
            this.mouse.x = (event.clientX / window.innerWidth)*2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight)*2 + 1;
        });
        
        let dragged = false;
        document.addEventListener('mousedown', () => { dragged = false });
        document.addEventListener('mousemove', () => { dragged = true });
        document.addEventListener("mouseup", () => {
            let toSelect = Array.from(this.pawns.values()).filter(p => 
                p.moveable && (p.hovered || p.selected)
            );
            if (toSelect.length == 0 || dragged)
                return;
            for (var i = 0; i < toSelect.length; i++) {
                if (toSelect[i].selected) {
                    toSelect[i].selected = false;
                    return;
                }
            }
            toSelect[0].selected = true;
        });
        
        this.buildWebSocket(callback);
    }
    
    addPawn(pawn) {
        console.assert(this.host);
        
        console.log("Adding pawn with ID: " + pawn.id);
        this.pawns.set(pawn.id, pawn);
        let rotation = new THREE.Euler().setFromQuaternion(pawn.rotation);
        this.socket.send(JSON.stringify({
            type:"add_pawn",
            pawn:{
                id:pawn.id,
                mesh:pawn.meshUrl,
                position:{x:pawn.position.x, y:pawn.position.y, z:pawn.position.z},
                rotation:{x:rotation.x, y:rotation.y, z:rotation.z},
                mass:pawn.physicsBody.mass,
                moveable:pawn.moveable,
                shapes:pawn.physicsBody.shapes.map(x => x.serialize()),
            }
        }));
    }
    loadPawn(pawnJSON) {
        let pawn = new Pawn(this, pawnJSON.position, pawnJSON.mesh, new CANNON.Body({
            mass: pawnJSON.mass,
            shape: new CANNON.Shape().deserialize(pawnJSON.shapes[0]) // FIXME Handle multiple shapes
        }), pawnJSON.id);
        pawn.rotation.setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation));
        pawn.moveable = pawnJSON.moveable;
        this.pawns.set(pawnJSON.id, pawn);
    }
    updatePawn(pawnJSON) {
        let pawn = this.pawns.get(pawnJSON.id);
        if (pawn.selected) // We own selected pawns
            return;
        pawn.setPosition(pawnJSON.position);
        pawn.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler().setFromVector3(pawnJSON.rotation)));
    }
    
    tickHost() {
        let to_update = Array.from(this.pawns.values()).filter(p => p.dirty);
        if (to_update.length > 0) {
            this.socket.send(JSON.stringify({
                type:"update_pawns",
                pawns:to_update.map(p => {
                    let rotation = new THREE.Euler().setFromQuaternion(p.rotation)
                    return {
                        id:p.id,
                        position:{x:p.position.x, y:p.position.y, z:p.position.z},
                        rotation:{x:rotation.x, y:rotation.y, z:rotation.z}
                    };
                })
            }));
            to_update.forEach(p => p.dirty = false);
        }
    }
    tickClient() {
        let to_update = Array.from(this.pawns.values()).filter(p => p.dirty && p.selected);
        if (to_update.length > 0) {
            this.socket.send(JSON.stringify({
                type:"request_update_pawn",
                pawn:to_update.map(p => {
                    let rotation = new THREE.Euler().setFromQuaternion(p.rotation)
                    return {
                        id:p.id,
                        position:{x:p.position.x, y:p.position.y, z:p.position.z},
                        rotation:{x:rotation.x, y:rotation.y, z:rotation.z}
                    };
                })[0]
            }));
            to_update.forEach(p => p.dirty = false);
        }
    }
    animate() {
        this.composer.render();
        this.controls.update();
        this.stats.update();
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const time = performance.now() / 1000; // seconds
        let dt = 0;
        if (!this.lastCallTime) {
            this.world.step(Manager.physicsTimestep);
        } else {
            dt = time - this.lastCallTime;
            this.world.step(Manager.physicsTimestep, dt);
        }
        this.lastCallTime = time;
        
        for (const [key, value] of this.pawns) {
            value.animate(dt);
        }
        
        let raycastableObjects = Array.from(this.pawns.values()).filter(x => x.mesh).map(x => x.mesh);
        let hovered = this.raycaster.intersectObjects(raycastableObjects, true);
        if (hovered.length > 0) {
            this.pawns.forEach((p, k) => p.hovered = false);
            hovered[0].object.traverseAncestors((a) => {
                for (const [key, value] of this.pawns) {
                    if (value.mesh == a) {
                        value.hovered = true;
                        return;
                    }
                }
            });
        }
    }
    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth/1.5, window.innerHeight/1.5);
        this.renderer.domElement.style.width = "100%";
        this.renderer.domElement.style.height = "100%";
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    
    buildScene() {
        this.scene = new THREE.Scene();
        //this.scene.background = new THREE.Color(0xdddddd);
        this.scene.background = null;
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.castShadow = true;
        directionalLight.position.y = 25;
        directionalLight.position.x = 10;
        directionalLight.shadow.normalBias = 0.05;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.bottom = -50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.mapSize.width = 2048;//1024;
        directionalLight.shadow.mapSize.height = 2048;//1024;
        this.scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
        this.scene.add(ambientLight);
        
        // PLANE
        const geom = new THREE.PlaneGeometry( 100, 100 );
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
        
        this.renderer = new THREE.WebGLRenderer({canvas: display, alpha: true});
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.autoUpdate = true;
        //this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        //this.renderer.shadowMap.type = THREE.VSMShadowMap;
        
        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        /*const saoPass = new SAOPass(scene, camera, false, true);
        saoPass.params.saoIntensity = 0.001;
        composer.addPass(saoPass);
        const ssaoPass = new SSAOPass(scene, camera, window.innerWIDTH, window.innerHeight);
        ssaoPass.kernelRadius = 16;
        composer.addPass(ssaoPass);*/

        const pixelPass = new ShaderPass(PixelShader);
        pixelPass.uniforms["resolution"].value = new THREE.Vector2( window.innerWidth, window.innerHeight );
        pixelPass.uniforms["resolution"].value.multiplyScalar( window.devicePixelRatio );
        pixelPass.uniforms["pixelSize"].value = 3;
        //this.composer.addPass(pixelPass);
        
        this.stats = Stats();
        document.body.appendChild(this.stats.dom);
    }
    buildControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.screenSpacePanning = false;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.15;
        this.controls.maxPolarAngle = Math.PI/2.2;
        
        this.controls.keyPanSpeed = 20;
        this.controls.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
        this.controls.listenToKeyEvents(document);
    }
    buildPhysics() {
        this.world = new CANNON.World({
            gravity: new CANNON.Vec3(0, -15.0, 0),
        });
    }
    buildWebSocket(callback) {
        let lobby = window.location.pathname.substring(1);
        this.socket = new WebSocket("ws://" + window.location.host + "/ws/" + lobby);
        
        this.socket.addEventListener('open', (e) => {
            this.socket.send(JSON.stringify({
                type: "join"
            }));
            console.log('Connected!');
        });
        this.socket.addEventListener('message', (e) => {
            console.log('Message from server: ' + e.data);
            let msg = JSON.parse(e.data);
            if (msg["type"] == "start") {
                // We have initiated a connection
                this.host = msg["host"];
                callback(this.host);
                if (this.host) {
                    setInterval(() => this.tickHost(), Manager.networkTimestep);
                } else {
                    setInterval(() => this.tickClient(), Manager.networkTimestep);
                    // If we aren't the host, let's deserialize the pawns recieved
                    msg.pawns.forEach(p => this.loadPawn(p));
                }
            } else if (msg["type"] == "update_pawns") {
                msg.pawns.forEach(p => this.updatePawn(p));
            } else if (msg["type"] == "request_update_pawn" && this.host) {
                this.updatePawn(msg.pawn);
            }
        });
    }
}
