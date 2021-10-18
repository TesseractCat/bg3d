import * as THREE from 'three';
import * as CANNON from 'cannon-es'
import {Text} from 'troika-three-text'

import mouseShake from '../deps/mouse-shake'

import Manager from './manager';
import {Pawn, Deck, Dice} from './pawn';

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
    board = new Pawn(manager, new THREE.Vector3(0,0.5,0), new THREE.Quaternion(), 'checkerboard.gltf',
        new CANNON.Body({
            mass: 0,
            //shape: new CANNON.Box(new CANNON.Vec3(8.0,1.0,8.0))
            shape: new CANNON.Box(new CANNON.Vec3(9.0,0.5,9.0))
        })
    );
    manager.addPawn(board);
    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
            if ((x + y) % 2 != 0 || y == 4 || y == 3)
                continue;
            let checker = new Dice(manager, new THREE.Vector3(-7.7 + x * 2.2,1.5,-7.7 + y * 2.2), new THREE.Quaternion(), y < 4 ? 'checker_red.gltf' : 'checker_black.gltf',
                new CANNON.Body({
                    mass: 5,
                    shape: new CANNON.Cylinder(1.1, 1.1, 0.48, 6)//new CANNON.Vec3(1.0,0.2,1.0))
                })
            );
            checker.moveable = true;
            manager.addPawn(checker);
        }
    }
    let ranks = "A,2,3,4,5,6,7,8,9,10,J,Q,K".split(",");
    let suits = "C,S,D,H".split(",");
    let cards = [];
    for (let rank of ranks) {
        for (let suit of suits) {
            cards.push("./images/cards/" + rank + suit + ".jpg");
        }
    }
    let deck = new Deck(manager, new THREE.Vector3(0, 3, 0), new THREE.Quaternion(), new THREE.Vector2(3.75, 5.25), cards);
    deck.moveable = true;
    manager.addPawn(deck);
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
    
    document.getElementById("game-link").innerText = window.location.href;
    document.getElementById("game-link").href = window.location.href;
};
window.onresize = function() {
    manager.resize();
};
window.onkeydown = function(e) {
}
