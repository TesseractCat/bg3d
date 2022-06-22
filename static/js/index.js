import * as THREE from 'three';

import mouseShake from './mouse-shake.js'

import Manager from './manager';
import {Pawn, Deck, Dice} from './pawns';

import PluginLoader from './pluginloader'

let manager;
let pluginLoader;

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
            ['Welcome', 'games/welcome.js'],
            ['Chess', 'games/chess.js'],
            ['Go', 'games/go.js'],
        ];
        games.forEach((g, i) => {
            let name = g[0];
            let gameOption = document.createElement("option");
            gameOption.value = name;
            gameOption.innerText = name;
            document.querySelector("#games").appendChild(gameOption);
            
            // if (g.templates.size > 0) {
            //     let pieceGroup = document.createElement("optgroup");
            //     pieceGroup.label = g.name;
            //     for (const piece of g.templates.keys()) {
            //         let pieceOption = document.createElement("option");
            //         pieceOption.value = i + "/" + piece;
            //         pieceOption.innerText = piece;
            //         pieceGroup.appendChild(pieceOption);
            //     }
            //     document.querySelector("#pieces").appendChild(pieceGroup);
            // }
        });
        let gameOption = document.createElement("option");
        gameOption.value = 'Custom';
        gameOption.innerText = 'Custom';
        gameOption.setAttribute("hidden", "");
        document.querySelector("#games").appendChild(gameOption);

        function loadGame(index) {
            let game = games[index];
            if (game) {
                let url = game[1];
                pluginLoader.loadScript(`${url}?v=${window.version}`);
            }
        }
        document.querySelector("#games").addEventListener("change", (e) => {
            loadGame(e.target.selectedIndex);
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
            loadGame(0);
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

    // Disable context menu
    document.addEventListener('contextmenu', e => {
        if (e.target.id != 'game-link')
            e.preventDefault();
    });
};
window.onresize = function() {
    manager.resize();
};
