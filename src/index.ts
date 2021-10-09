import * as THREE from 'three';
import Stats from '../deps/libs/stats.module';

import { EffectComposer } from '../deps/postprocessing/EffectComposer';
import { RenderPass } from '../deps/postprocessing/RenderPass';
import { ShaderPass } from '../deps/postprocessing/ShaderPass';
import { SAOPass } from '../deps/postprocessing/SAOPass';
import { PixelShader } from '../deps/shaders/PixelShader';

import { OrbitControls } from '../deps/controls/OrbitControls';

import { GLTFLoader } from '../deps/loaders/GLTFLoader';

// SCENE
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdddddd);

// RENDERING
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
const controls = new OrbitControls(camera, renderer.domElement);
controls.screenSpacePanning = false;
controls.enableDamping = true;
controls.dampingFactor = 0.15;

// POST PROCESSING
const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const saoPass = new SAOPass(scene, camera, false, true);
saoPass.params.saoIntensity = 0.001;
composer.addPass(saoPass);

const pixelPass = new ShaderPass(PixelShader);
pixelPass.uniforms["resolution"].value = new THREE.Vector2( window.innerWidth, window.innerHeight );
pixelPass.uniforms["resolution"].value.multiplyScalar( window.devicePixelRatio );
pixelPass.uniforms["pixelSize"].value = 3;
//composer.addPass(pixelPass);

const stats: Stats = Stats();

// LIGHTING
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.castShadow = true;
directionalLight.position.y = 25;
directionalLight.position.x = 10;
directionalLight.shadow.camera.left = -50;
directionalLight.shadow.camera.right = 50;
directionalLight.shadow.camera.bottom = -50;
directionalLight.shadow.camera.top = 50;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
scene.add(directionalLight);

const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
scene.add(ambientLight);

//const helper = new THREE.CameraHelper( directionalLight.shadow.camera );
//scene.add(helper);

// TABLE
const plane = new THREE.PlaneGeometry( 100, 100 );
plane.rotateX(- Math.PI/2);
const material = new THREE.ShadowMaterial();
material.opacity = 0.3;
const table = new THREE.Mesh(plane, material);
table.position.y = 0;
table.receiveShadow = true;
scene.add(table);

// CUBE
const cube = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial());
cube.position.y = 2;
cube.position.x = 1.25;
cube.castShadow = true;
scene.add(cube);

camera.position.z = 5;

// MODELS
const loader = new GLTFLoader();
loader.load('models/chess.gltf', function (gltf) {
    gltf.scene.traverse(function(e) {
        e.castShadow = true;
        e.receiveShadow = true;
    });
    scene.add(gltf.scene);
});

// SETUP
window.onload = function() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(stats.dom);
};
window.onresize = function() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    pixelPass.uniforms["resolution"].value.set(window.innerWidth, window.innerHeight).multiplyScalar(window.devicePixelRatio);
};

function animate() {
    requestAnimationFrame(animate);
    
    //renderer.render(scene, camera);
    composer.render();
    controls.update();
    stats.update();
}
animate();
