import * as THREE from 'three';
import * as CANNON from 'cannon-es'
import {Text} from 'troika-three-text'

import mouseShake from '../deps/mouse-shake'

import Manager from './manager';
import {Pawn, Deck, Dice} from './pawns';
import * as GAMES from './game';

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
    titleText.text = decodeURI(window.location.pathname.substring(1)).toUpperCase();
    titleText.font = "../fonts/Bayon/Bayon-Regular.ttf"
    //titleText.font = "../fonts/Lora/Lora-Regular.ttf"
    titleText.fontSize = 3.0;
    titleText.anchorX = '50%';
    titleText.anchorY = '50%';
    titleText.position.copy(new THREE.Vector3(0, 2.5, -11));
    titleText.rotation.copy(new THREE.Euler(-Math.PI/5.0, 0, 0));
    titleText.color = "#D6CCA9";
    //manager.scene.add(titleText);
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
        
        let games = [
            new GAMES.Welcome(manager),
            new GAMES.Chess(manager),
            new GAMES.Checkers(manager),
            new GAMES.Cards(manager),
            new GAMES.Monopoly(manager),
        ];
        games.forEach((g, i) => {
            let gameOption = document.createElement("option");
            gameOption.value = g.name;
            gameOption.innerText = g.name;
            document.querySelector("#games").appendChild(gameOption);
            
            if (g.templates.size > 0) {
                let pieceGroup = document.createElement("optgroup");
                pieceGroup.label = g.name;
                for (const piece of g.templates.keys()) {
                    let pieceOption = document.createElement("option");
                    pieceOption.value = i + "/" + piece;
                    pieceOption.innerText = piece;
                    pieceGroup.appendChild(pieceOption);
                }
                document.querySelector("#pieces").appendChild(pieceGroup);
            }
        });
        document.querySelector("#games").addEventListener("change", (e) => {
            for (let g of games) {
                if (g.name == e.target.value) {
                    g.init(true);
                    return;
                }
            }
        });
        document.querySelector("#add-piece").addEventListener("click", (e) => {
            let info = document.querySelector("#pieces").value.split("/");
            let idx = info[0];
            let templateName = info[1];
            
            let pawn = games[idx].templates.get(templateName).clone();
            pawn.setPosition(new THREE.Vector3(0, 5, 0));
            pawn.setRotation(new THREE.Quaternion());
            manager.addPawn(pawn);
        });
        
        if (host) {
            document.querySelector("#host-panel").style.display = "block";
            games[0].init(false);
        }
        
        animate();
    });
    
    document.getElementById("game-link").innerText = window.location.host + window.location.pathname;
    document.getElementById("game-link").href = window.location.href;
    
    document.getElementById("overlay-collapse").addEventListener("click", function() {
        const elem = document.getElementById("overlay-collapse");
        let collapsed = elem.innerText == "+";
        if (collapsed) {
            elem.innerText = "-";
            overlay.style.width = "";
            overlay.style.maxHeight = "";
        } else {
            elem.innerText = "+";
            overlay.style.width = "10px";
            overlay.style.maxHeight = "10px";
        }
    });
};
window.onresize = function() {
    manager.resize();
};
