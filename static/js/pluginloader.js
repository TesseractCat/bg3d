import * as THREE from 'three';
import * as zip from '@zip.js/zip.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import Manager from './manager';
import { Pawn } from './pawn';
import { Box, Cylinder } from './shapes';

export class GameBox extends Pawn {
    constructor({rollRotations, position, rotation, mesh, colliderShapes, moveable = true, id = null, name = null}) {
        super({
            name: name,
            position: position, rotation: rotation,
            mesh: mesh, colliderShapes: colliderShapes,
            moveable: moveable, id: id
        });
    }

    menu() {
        if (!this.manager.host) {
            return [[this.name + ' Box']];
        } else {
            return [
                [this.name + ' Box'],
                [],
                ["Open", () => this.open()],
                ["Delete", () => {
                    this.manager.sendSocket({
                        type:"remove_pawns",
                        pawns:[this.id],
                    });
                }],
            ];
        }
    }

    open() {
        this.manager.sendSocket({
            type:"remove_pawns",
            pawns:[this.id],
        });
    }
    
    static className() { return "GameBox"; };
    static deserialize(pawnJSON) {
        return super.deserialize(pawnJSON);
    }
}

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

        // First clear all existing assets
        this.clearAssets();
        this.manager.sendEvent("clear_pawns", true, {});

        // Register all plugin assets
        for (let entry of entries) {
            await this.registerAsset(entry);
        }

        this.callWorker("start");

        await reader.close();
        console.log("Plugin loaded!");
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
        console.log(data);

        if (data.type == "addPawn") {
            let pawn = new Pawn(data.pawn);
            console.log(pawn);
            this.manager.addPawn(pawn);
        } else if (data.type == "removePawn") {
            this.manager.sendSocket({
                type:"remove_pawns",
                pawns:[data.pawn],
            });
        }
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
    clearAssets() {
        this.manager.sendSocket({
            "type":"clear_assets"
        });
    }

    async createBoxPawn(manifest) {
        let intersections = this.manager.raycaster.intersectObject(this.manager.scene, true);

        let point = intersections.length != 0 ?
            intersections[0].point : new THREE.Vector3(0,0,0);

        return new GameBox({
            manager: this.manager, name: manifest.name,
            position: point.add(new THREE.Vector3(0,3,0)),
            rotation: new THREE.Quaternion(),
            mesh: 'box.gltf', colliderShapes: [
                new Box(new THREE.Vector3(10.5/2, 1.5/2, 10.5/2))
            ],
        });
    }
}
