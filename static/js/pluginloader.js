import * as THREE from 'three';
import * as zip from '@zip.js/zip.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import Manager from './manager';
import { Pawn, SnapPoint, Deck, Container, Dice } from './pawns';
import { Box, Cylinder } from './shapes';

function findEntry(entries, path) {
    return entries.filter(e => e.filename == path)[0];
}

export default class PluginLoader {
    manager;

    pluginWorker;

    constructor(manager) {
        this.manager = manager;
    }

    async loadFromFile(file) {
        if (!this.manager.host)
            return;

        console.log("Loading plugin...");
        let reader = new zip.ZipReader(new zip.BlobReader(file));

        let entries = await reader.getEntries();

        let manifest;
        try {
            let manifestEntry = findEntry(entries, "manifest.json");
            manifest = JSON.parse(await manifestEntry.getData(new zip.TextWriter()));
        } catch (error) {
            console.error(error);
            return;
        }

        if (manifest.script != undefined) {
            let script = findEntry(entries, manifest.script);
            if (script) {
                let scriptBlob = await script.getData(new zip.BlobWriter());
                scriptBlob = new Blob([
                    `importScripts("${window.location.protocol}//${window.location.host}/prelude.js");\n\n`,
                    scriptBlob
                ], {type: "text/javascript"});

                if (this.pluginWorker)
                    this.pluginWorker.terminate();

                this.pluginWorker = new Worker(URL.createObjectURL(scriptBlob));
                this.pluginWorker.addEventListener('message', (e) => this.onWorker(e));
            }
        }

        // First clear all existing assets and pawns
        this.clear();

        // Register all plugin assets
        for (let entry of entries) {
            if (!entry.directory)
                await this.registerAsset(entry);
        }
        // Wait until assets are complete (send empty event)
        console.log("Waiting until assets complete...");
        await new Promise(r => this.manager.sendEvent("assets_complete", false, {}, r));
        console.log("Done!");

        this.callWorker("start");

        await reader.close();
        console.log("Plugin loaded!");
        document.querySelector("#games").value = "Custom";
    }
    async loadScript(url) {
        let scriptBlob = await (await fetch(url)).blob();
        scriptBlob = new Blob([
            `importScripts("${window.location.protocol}//${window.location.host}/prelude.js");\n\n`,
            scriptBlob
        ], {type: "text/javascript"});

        if (this.pluginWorker)
            this.pluginWorker.terminate();

        this.pluginWorker = new Worker(URL.createObjectURL(scriptBlob));
        this.pluginWorker.addEventListener('message', (e) => this.onWorker(e));

        // Clear all existing assets
        this.clear();

        this.callWorker("start");
    }
    callWorker(action) {
        let resultPromise = new Promise((resolve, reject) => {
            let wait = (e) => {
                let data = e.data;
                if (data.type == "return") {
                    this.pluginWorker.removeEventListener('message', wait);
                    resolve(data.result);
                }
            };
            this.pluginWorker.addEventListener('message', wait);
        });
        this.pluginWorker.postMessage({
            type:"call",
            action:action,
        });
        return resultPromise;
    }
    async onWorker(message) {
        let data = message.data;
        let respond = (result) => {
            this.pluginWorker.postMessage({
                type:"return",
                result:result,
            });
        }

        if (data.type == "addPawn") {
            let pawn = this.loadPawn(data.pawn);
            if (pawn) {
                this.manager.addPawn(pawn);
                respond(pawn.id);
            } else {
                respond(-1);
            }
        } else if (data.type == "removePawn") {
            this.manager.removePawn(pawn.id);
        }
    }

    loadPawn(pawn) {
        if (pawn.rotation) {
            pawn.rotation = new THREE.Quaternion().setFromEuler(
                new THREE.Euler().setFromVector3(pawn.rotation)
            );
        }

        let result;
        switch (pawn.type) {
        case "Pawn":
            result = new Pawn(pawn);
            break;
        case "SnapPoint":
            result = new SnapPoint(pawn);
            break;
        case "Deck":
            result = new Deck(pawn);
            break;
        case "Container":
            pawn.holds = this.loadPawn(pawn.holds).serialize();
            result = new Container(pawn);
            break;
        case "Dice":
            result = new Dice(pawn);
            break;
        default:
            break;
        }
        return result;
    }

    async registerAsset(entry) {
        let extension = entry.filename.split('.')[1].toLowerCase();

        let mimeType = "";
        switch (extension) {
            case "gltf":
                mimeType = "model/gltf+json";
                break;
            case "glb":
                mimeType = "model/gltf-binary";
                break;
            case "bin":
                mimeType = "application/gltf-buffer";
                break;

            case "png":
                mimeType = "image/png";
                break;
            case "jpg":
            case "jpeg":
                mimeType = "image/jpeg";
                break;

            default:
                return;
        }
        
        let data = await entry.getData(new zip.Data64URIWriter(mimeType));
        this.manager.sendSocket({
            "type":"register_asset",
            "name": entry.filename,
            "data": data,
        });
    }
    clear() {
        this.manager.sendSocket({
            "type":"clear_assets"
        });
        this.manager.clearPawns();
    }
}
