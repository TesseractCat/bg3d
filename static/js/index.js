import * as THREE from 'three';

import Manager from './manager';
import Pawn from './pawn';

let manager;

let board;
let checker;

function setup() {
    manager = new Manager();
    
    board = new Pawn(manager, new THREE.Vector3(0,0,0), 'checkerboard.gltf');
    checker = new Pawn(manager, new THREE.Vector3(0,1.0,0), 'checker.gltf');
}

let ticks = 0;
function animate() {
    requestAnimationFrame(animate);
    manager.animate();
    
    //pawn.setPosition(new THREE.Vector3(0, ticks/1000.0, 0));
    ticks++;
}

// SETUP
window.onload = function() {
    setup();
    animate();
};
window.onresize = function() {
    manager.resize();
};
