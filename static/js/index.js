import { Vector3, Quaternion } from 'three';

import mouseShake from './mouse-shake.js'

import Manager from './manager';

import PluginLoader from './pluginloader'

import ContextMenu from './contextmenu.js';
import Tooltip from './tooltip.js';
import Chat from './chat.js';
import Hand from './hand.js';

import { Pawn } from './pawns.js';

let manager;
let pluginLoader;

function animate() {
    requestAnimationFrame(animate);
    manager.animate();
}

// SETUP
window.onload = () => {
    window.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(navigator.userAgent);

    let onItch = (window !== window.parent); // Are we in an iFrame (i.e. on itch.io)
    if (onItch) { 
        document.body.classList.add("iframe");
    }

    manager = new Manager();
    window.manager = manager;

    pluginLoader = new PluginLoader(manager);

    manager.init((host) => {
        let games = [
            ['Welcome', 'plugins/welcome.zip'],
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

        async function loadGame(url) {
            let blob = await ((await fetch(`${url}?v=${window.version}`)).blob());
            let file = new File([blob], 'plugin.zip', { type: 'application/zip' });
            await pluginLoader.loadFromFile(file);
        }
        document.querySelector("#games").addEventListener("change", async (e) => {
            e.target.blur();
            
            e.target.setAttribute("disabled", "");
            await loadGame(games[e.target.selectedIndex][1]);
            e.target.removeAttribute("disabled");
        });

        /*document.querySelector("#settings").addEventListener("change", (e) => {
            window.manager.sendSocket({
                "type": "settings",
                ...Object.fromEntries([...new FormData(e.target.form).entries()].map(([k, v]) => {
                    if (v == "true")
                        v = true;
                    return [k, v];
                }))
            });
        });*/
        
        if (host)
            loadGame(games[0][1]);
        
        animate();
    });

    // Spawn menu
    let spawnables = [
        new Pawn({
            name: "Bird Statue", mesh: 'generic/bird.glb'
        }),
        new Pawn({
            name: "Mini Bird", mesh: 'generic/minibird.gltf', tint: 0xdd2222
        })
    ];
    
    const createOption = (name) => {
        let elem = document.createElement("option");
        elem.setAttribute("value", name);
        return elem;
    };
    let pawnList = document.getElementById("pawn-list");
    spawnables.map((p) => createOption(p.name)).forEach(e => pawnList.appendChild(e));
    document.querySelector("#add-pawn input").setAttribute("pattern", spawnables.map(p => p.name).join("|"));
    document.querySelector("#add-pawn input").addEventListener("input", (e) => {
        if (e.target.validity.patternMismatch) {
            e.target.setCustomValidity("Please pick a valid piece.");
        } else {
            e.target.setCustomValidity("");
        }
    });
    document.getElementById("add-pawn").addEventListener("submit", (e) => {
        e.preventDefault();
        let form = e.target;
        let name = form.elements["pawn"].value;
        let pawn = spawnables.filter(p => p.name == name)[0];
        if (pawn) {
            form.elements["pawn"].value = "";
            window.manager.sendAddPawn(pawn.clone({
                position: new Vector3(0, 5, 0),
            }));
        }
    });
    
    // Show link
    // - Itch doesn't support clipboard
    let gameLinkElem = document.querySelector("#game-link");
    if (!onItch) {
        let linkText = window.location.host + window.location.pathname;
        gameLinkElem.innerText = linkText;
        gameLinkElem.href = window.location.href;

        let linkTimeout;
        gameLinkElem.addEventListener("click", (e) => {
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
    } else {
        let lobby = window.location.pathname.slice(1);
        gameLinkElem.innerText = ".../?lobby=" + lobby;
        gameLinkElem.href = "https://tesseractcat.itch.io/birdgame?lobby=" + lobby;
        gameLinkElem.target = "_blank";
    }
    
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
