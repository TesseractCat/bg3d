import * as THREE from 'three';
import * as CANNON from 'cannon-es'
import {Text} from 'troika-three-text'

import Manager from './manager';
import Pawn from './pawn';

let manager;

let board;

function setup() {
    manager.world.addBody(new CANNON.Body({
        mass: 0,
        shape: new CANNON.Plane(),
        quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0)
    }));
    
    const titleText = new Text();
    titleText.text = "CHECKERS";
    titleText.font = "../fonts/Bayon-Regular.ttf"
    titleText.fontSize = 3.0;
    titleText.anchorX = '50%';
    titleText.anchorY = '50%';
    titleText.position.copy(new THREE.Vector3(0, 2.5, -11));
    titleText.rotation.copy(new THREE.Euler(-Math.PI/5.0, 0, 0));
    titleText.color = "#D6CCA9";
    manager.scene.add(titleText);
}
function setupPawns() {
    board = new Pawn(manager, new THREE.Vector3(0,0.5,0), 'checkerboard.gltf',
        new CANNON.Body({
            mass: 0,
            //shape: new CANNON.Box(new CANNON.Vec3(8.0,1.0,8.0))
            shape: new CANNON.Box(new CANNON.Vec3(9.0,0.4,9.0))
        })
    );
    manager.addPawn(board);
    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
            checker = new Pawn(manager, new THREE.Vector3(-7.7 + x * 2.2,1.5,-7.7 + y * 2.2), 'checker.gltf',
                new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.1, 1.1, 0.6, 6)//new CANNON.Vec3(1.0,0.2,1.0))
                })
            );
            checker.moveable = true;
            manager.addPawn(checker);
        }
    }
}

let ticks = 0;
function animate() {
    requestAnimationFrame(animate);
    manager.animate();
    
    ticks++;
}

// SETUP
window.onload = function() {
    manager = new Manager();
    manager.init((host) => {
        if (host)
            setupPawns();
        setup();
        animate();
    });
};
window.onresize = function() {
    manager.resize();
};
window.onkeydown = function(e) {
}
