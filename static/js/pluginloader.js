import * as THREE from 'three';
import * as zip from '@zip.js/zip.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import Manager from './manager';
import { Pawn } from './pawn';
import { Box, Cylinder } from './shapes';

function findEntry(entries, path) {
    return entries.filter(e => e.filename == path)[0];
}

export default class PluginLoader {
    manager;

    constructor(manager) {
        this.manager = manager;
    }

    async loadFromFile(file) {
        console.log("Loading plugin...");
        let reader = new zip.ZipReader(new zip.BlobReader(file));

        let entries = await reader.getEntries();
        console.log("Found files: ");
        console.log(entries.map(e => e.filename));

        let manifest;
        try {
            let manifestEntry = findEntry(entries, "manifest.json");
            manifest = JSON.parse(await manifestEntry.getData(new zip.TextWriter()));
        } catch (error) {
            console.error(error);
            return;
        }

        console.log(manifest, entries);

        // First clear all existing assets
        this.clearAssets();

        // Register box.gltf file and add box
        await this.registerAsset(findEntry(entries, "box.gltf"));
        this.manager.addPawn(await this.createBoxPawn(manifest));

        await reader.close();
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
        return new Pawn({
            manager: this.manager, name: manifest.name,
            position: new THREE.Vector3(0,3.0,0),
            rotation: new THREE.Quaternion(),
            mesh: 'box.gltf', colliderShapes: [
                new Box(new THREE.Vector3(10.5/2, 1.5/2, 10.5/2))
            ],
        });
    }
}
