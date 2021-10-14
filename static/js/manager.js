import * as THREE from 'three';
import Stats from '../deps/libs/stats.module';

import { EffectComposer } from '../deps/postprocessing/EffectComposer';
import { RenderPass } from '../deps/postprocessing/RenderPass';
import { ShaderPass } from '../deps/postprocessing/ShaderPass';
import { SAOPass } from '../deps/postprocessing/SAOPass';
import { SSAOPass } from '../deps/postprocessing/SSAOPass';
import { PixelShader } from '../deps/shaders/PixelShader';

import { OrbitControls } from '../deps/controls/OrbitControls';
import { GLTFLoader } from '../deps/loaders/GLTFLoader.js';

export default class Manager {
    scene;
    camera;
    renderer;
    composer;
    controls;
    stats;
    
    constructor() {
        this.buildScene();
        this.buildRenderer();
        this.buildControls();
        this.resize();
        
        this.loader = new GLTFLoader().setPath('../models/');
    }
    
    animate() {
        this.composer.render();
        this.controls.update();
        this.stats.update();
    }
    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth/2, window.innerHeight/2);
        this.renderer.domElement.style.width = "100%";
        this.renderer.domElement.style.height = "100%";
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    
    buildScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xdddddd);
        
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
        
        // TABLE
        const plane = new THREE.PlaneGeometry( 100, 100 );
        plane.rotateX(- Math.PI/2);
        const material = new THREE.ShadowMaterial();
        material.opacity = 0.3;
        const table = new THREE.Mesh(plane, material);
        table.position.y = 0;
        table.receiveShadow = true;
        this.scene.add(table);
    }
    buildRenderer() {
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 15;
        this.camera.position.y = 8;
        
        this.renderer = new THREE.WebGLRenderer({canvas: display});
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.autoUpdate = true;
        //this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
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
    }
}
