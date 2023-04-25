import { Vector3, Quaternion } from 'three';

import mouseShake from './mouse-shake.js'

import Manager from './manager';
import {Pawn, Deck, Dice} from './pawns';

import PluginLoader from './pluginloader'

import ContextMenu from './contextmenu.js';
import Tooltip from './tooltip.js';
import Chat from './chat.js';
import Hand from './hand.js';

let manager;
let pluginLoader;

function animate() {
    requestAnimationFrame(animate);
    manager.animate();
}

// SETUP
window.onload = () => {
    window.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(navigator.userAgent);

    if (window !== window.parent) { // Are we in an iFrame (i.e. on itch.io)
        document.body.classList.add("iframe");
    }

    manager = new Manager();
    window.manager = manager;

    pluginLoader = new PluginLoader(manager);

    manager.init((host) => {
        let games = [
            ['Welcome', 'plugins/welcome'],
            ['Cards', 'plugins/cards'],
            ['Chess', 'plugins/chess'],
            ['Checkers', 'plugins/checkers'],
            ['Go', 'plugins/go'],
            ['Uno', 'plugins/uno.zip'],
            ['Sorry', 'plugins/sorry.zip'],
            ['Carcassonne', 'plugins/carcassonne.zip'],
            ['Catan', 'plugins/catan.zip'],
        ];
        games.forEach((g, i) => {
            let name = g[0];
            let gameOption = document.createElement("option");
            gameOption.value = name;
            gameOption.innerText = name;
            document.querySelector("#games").appendChild(gameOption);
        });
        let gameOption = document.createElement("option");
        gameOption.value = 'Custom';
        gameOption.innerText = 'Custom';
        gameOption.setAttribute("hidden", "");
        document.querySelector("#games").appendChild(gameOption);

        async function loadGame(index) {
            let game = games[index];
            let url = game[1];

            if (url.endsWith("zip")) {
                let blob = await ((await fetch(url)).blob());
                let file = new File([blob], 'plugin.zip', { type: 'application/zip' });
                await pluginLoader.loadFromFile(file);
            } else {
                let manifest = await (await fetch(`${url}/manifest.json?v=${window.version}`)).json();
                await pluginLoader.loadManifest(manifest, {path: url});
            }
        }
        document.querySelector("#games").addEventListener("change", async (e) => {
            e.target.blur();
            
            e.target.setAttribute("disabled", "");
            await loadGame(e.target.selectedIndex);
            e.target.removeAttribute("disabled");
        });
        
        if (host) {
            document.querySelector("#host-panel").style.display = "block";
            loadGame(0);
        }
        
        animate();
    });
    
    // Show link
    const linkText = window.location.host + window.location.pathname;
    document.getElementById("game-link").innerText = linkText;
    document.getElementById("game-link").href = window.location.href;

    let linkTimeout;
    document.getElementById("game-link").addEventListener("click", (e) => {
        e.preventDefault();
        if (linkTimeout)
            return;

        navigator.clipboard.writeText(window.location.href);
        e.target.innerText = "Link copied!";
        e.target.style.textDecoration = "auto";
        e.target.style.cursor = "default";

        linkTimeout = setTimeout(() => {
            e.target.innerText = linkText;
            e.target.style.textDecoration = null;
            e.target.style.cursor = null;
            linkTimeout = null;
        }, 500);
    });
    
    // Overlay functionality
    document.getElementById("overlay-collapse").addEventListener("click", (e) => {
        e.target.innerText = e.target.innerText == "-" ? "+" : "-";
        document.getElementById("overlay").classList.toggle("minimized");
    });
        
    // Allow plugins to be dropped
    document.body.addEventListener("dragenter", (e) => e.preventDefault());
    document.body.addEventListener("dragleave", (e) => e.preventDefault());
    document.body.addEventListener("dragover", (e) => e.preventDefault());
    document.body.addEventListener("drop", async (e) => {
        e.preventDefault();

        if (e.dataTransfer.items && e.dataTransfer.items.length == 1) {
            let item = e.dataTransfer.items[0];
            let file = item.getAsFile();

            await pluginLoader.loadFromFile(file);
            document.querySelector("#games").value = "Custom";
        }
    });

    // Disable context menu
    document.addEventListener('contextmenu', e => {
        if (!(e.target instanceof HTMLAnchorElement || e.target instanceof Chat))
            e.preventDefault();
    });
};
window.onresize = () => {
    manager.resize();
};
