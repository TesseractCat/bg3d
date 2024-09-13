import { Quaternion, Euler } from 'three';
import * as zip from '@zip.js/zip.js';

import Manager from './manager';
import { deserializePawn } from './pawns';
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

    async loadFromFile(file, onDone) {
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
            this.manager.chat.addSystemEntry("Failed to load plugin: Bad manifest");
            return;
        }

        // Register all plugin assets
        let nonDirEntries = entries.filter(entry => !entry.directory);
        await this.registerGame(manifest, nonDirEntries);

        // Wait until assets are complete
        console.log("Waiting until assets complete...");
        await new Promise(resolve =>
            this.manager.addEventListener("register_game",
                () => resolve(),
                { once: true }
            )
        );
        console.log("Done!");

        await reader.close();

        if (onDone !== undefined) {
            onDone();
        }
    }

    async registerGame(manifest, entries) {
        let entriesWithData = await Promise.all(entries.map(async (entry) => {
            let extension = entry.filename.split('.')[1].toLowerCase();

            let mimeType = "";
            switch (extension) {
                case "lua":
                    mimeType = "text/x-lua";
                    break;
                case "json":
                    mimeType = "application/json";
                    break;
                case "gltf":
                    mimeType = "model/gltf+json";
                    break;
                case "glb":
                    mimeType = "model/gltf-binary";
                    break;
                case "bin":
                    mimeType = "application/gltf-buffer";
                    break;

                case "webp":
                    mimeType = "image/webp";
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

            return ["/" + entry.filename, data];
        }));
        entriesWithData = entriesWithData.filter(x => x);

        this.manager.sendSocket({
            "type": "register_game",
            "info": manifest,
            "assets": Object.fromEntries(entriesWithData)
        });
    }
}
