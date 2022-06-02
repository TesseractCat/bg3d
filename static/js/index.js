import * as THREE from 'three';

import mouseShake from './mouse-shake.js'

import Manager from './manager';
import {Pawn, Deck, Dice} from './pawns';
import * as GAMES from './game';

import PluginLoader from './pluginloader'

let manager;
let pluginLoader;

let board;

function animate() {
    requestAnimationFrame(animate);
    manager.animate();
}

// SETUP
window.onload = function() {
    manager = new Manager();
    window.manager = manager;

    pluginLoader = new PluginLoader(manager);

    manager.init((host) => {
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
    
    // Show link
    document.getElementById("game-link").innerText = window.location.host + window.location.pathname;
    document.getElementById("game-link").href = window.location.href;
    
    // Overlay functionality
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
        
    // Allow plugins to be dropped
    document.body.addEventListener("dragenter", (e) => e.preventDefault());
    document.body.addEventListener("dragleave", (e) => e.preventDefault());
    document.body.addEventListener("dragover", (e) => e.preventDefault());
    document.body.addEventListener("drop", (e) => {
        e.preventDefault();

        if (e.dataTransfer.items && e.dataTransfer.items.length == 1) {
            let item = e.dataTransfer.items[0];
            let file = item.getAsFile();

            pluginLoader.loadFromFile(file);
        }
    });
};
window.onresize = function() {
    manager.resize();
};
