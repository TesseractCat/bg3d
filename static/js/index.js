import * as THREE from 'three';
import * as CANNON from 'cannon-es'
import {Text} from 'troika-three-text'

import mouseShake from '../deps/mouse-shake'

import Manager from './manager';
import {Pawn, Deck, Dice} from './pawn';
import {Checkers, Cards} from './game';

let manager;
let titleText;

let board;

function setup() {
    manager.world.addBody(new CANNON.Body({
        mass: 0,
        shape: new CANNON.Plane(),
        quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0)
    }));
    
    titleText = new Text();
    titleText.text = decodeURI(window.location.pathname.substring(1));
    titleText.font = "../fonts/Bayon/Bayon-Regular.ttf"
    titleText.fontSize = 3.0;
    titleText.anchorX = '50%';
    titleText.anchorY = '50%';
    titleText.position.copy(new THREE.Vector3(0, 2.5, -11));
    titleText.rotation.copy(new THREE.Euler(-Math.PI/5.0, 0, 0));
    titleText.color = "#D6CCA9";
    manager.scene.add(titleText);
}

function animate() {
    requestAnimationFrame(animate);
    manager.animate();
}

// SETUP
window.onload = function() {
    manager = new Manager();
    manager.init((host) => {
        setup();
        if (host) {
            document.querySelector("#host-panel").style.display = "block";
            let checkers = new Checkers(manager);
            let cards = new Cards(manager);
            checkers.init(false);
            
            document.querySelector("#games").addEventListener("change", (e) => {
                switch (e.target.value) {
                    case "checkers":
                        checkers.init(true);
                        break;
                    case "cards":
                        cards.init(true);
                        break;
                }
            });
        }
        animate();
    });
    
    document.getElementById("game-link").innerText = window.location.host + window.location.pathname;
    document.getElementById("game-link").href = window.location.href;
};
window.onresize = function() {
    manager.resize();
};
window.onkeydown = function(e) {
}
