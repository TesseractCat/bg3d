import { Quaternion, Euler } from 'three';
import * as zip from '@zip.js/zip.js';

import Manager from './manager';
import { Pawn, SnapPoint, Deck, Container, Dice, deserializePawn } from './pawns';
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

    createScriptBlob(blob) {
        return new Blob([
            `importScripts("${window.location.protocol}//${window.location.host}/static/prelude.js?v=${window.version}");\n\n`,
            blob
        ], {type: "text/javascript"});
    }
    async loadFromFile(file) {
        if (!this.manager.host) {
            console.warn("Attempted to load plugin on non-host client!");
            return;
        }

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

        await this.loadManifest(manifest, {entries: entries});
        await reader.close();
    }
    async loadManifest(manifest, {entries = [], updateSelect = true}) {
        // Load script
        let scriptBlob;
        if (manifest.script != undefined) {
            if (entries.length > 0) {
                // Load script from zip entries
                let script = findEntry(entries, manifest.script);
                if (script)
                    scriptBlob = this.createScriptBlob(await script.getData(new zip.BlobWriter()));
            } else {
                // Load script from URL
                scriptBlob = this.createScriptBlob(await (await fetch("static/games/" + manifest.script)).blob());
            }
        }

        // Load worker
        if (scriptBlob) {
            if (this.pluginWorker)
                this.pluginWorker.terminate();

            this.pluginWorker = new Worker(URL.createObjectURL(scriptBlob));
            this.pluginWorker.addEventListener('message', (e) => this.onWorker(e.data));
        }

        // First clear all existing assets and pawns
        this.clear();

        // Register everything
        this.registerGame(manifest);
        if (entries.length > 0) {
            // Register all plugin assets
            for (let [i, entry] of entries.entries()) {
                if (!entry.directory)
                    await this.registerAsset(entry, i == entries.length - 1);
            }
            // Wait until assets are complete (send empty event)
            console.log("Waiting until assets complete...");
            await new Promise(r => this.manager.sendEvent("assets_complete", false, {}, r));
            console.log("Done!");
        }

        // Start worker
        this.pluginWorker.postMessage({name: "start"});

        // Hook events
        const update = (pawns) => {
            this.pluginWorker.postMessage({name: "update", pawns: pawns});
        };
        this.manager.addEventListener("update_pawns", (e) => {
            update(e.detail.pawns.map(p => this.manager.pawns.get(p.id).serialize()));
        });
        this.manager.addEventListener("add_pawn", (e) => {
            update([this.manager.pawns.get(e.detail.pawn.id).serialize()]);
        });
        this.manager.addEventListener("remove_pawns", (e) => {
            this.pluginWorker.postMessage({name: "remove", pawns: e.detail.pawns});
        });
        this.manager.addEventListener("clear_pawns", (e) => {
            this.pluginWorker.postMessage({name: "clear"});
        });

        console.log("Plugin loaded!");
        if (updateSelect)
            document.querySelector("#games").value = "Custom";
    }

    onWorker(msg) {
        if (msg.name == "commit") {
            for (let pawn of msg.data) {
                if (!this.manager.pawns.has(pawn.id)) {
                    this.manager.sendAddPawn(deserializePawn(pawn));
                } else {
                    this.manager.sendUpdatePawn(deserializePawn(pawn));
                }
            }
        }
    }

    registerGame(manifest) {
        this.manager.sendSocket({
            "type":"register_game",
            ...manifest
        });
    }
    async registerAsset(entry, last = false) {
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
            case "svg":
                mimeType = "image/svg+xml";
                break;

            default:
                return;
        }
        
        let data = await entry.getData(new zip.Data64URIWriter(mimeType));
        this.manager.sendSocket({
            "type":"register_asset",
            "name": entry.filename,
            "data": data,
            "last": last
        });
    }
    clear() {
        this.manager.sendSocket({
            "type":"clear_assets"
        });
        this.manager.sendClearPawns();
    }
}
