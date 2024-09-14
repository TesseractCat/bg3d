import { deserializePawn } from "./pawns";

export default class SpawnMenu extends HTMLElement {
    shadowRoot;
    search;
    results;

    #path = [];
    #contents = new Map();

    constructor() {
        super();

        this.shadowRoot = this.attachShadow({ mode: 'open' });

        this.search = document.createElement("input");
        this.search.id = "search";
        this.search.setAttribute("placeholder", "Filter objects...")
        this.search.setAttribute("autocomplete", "off")
        this.shadowRoot.appendChild(this.search);

        this.results = document.createElement("div");
        this.results.id = "results";
        this.shadowRoot.appendChild(this.results);

        const style = document.createElement('style');
        style.textContent = `
        :host {
            display: flex;
            flex-direction: column;
            gap: 0.5em;
        }
        :host([disabled]) {
            cursor: not-allowed;
            opacity: 0.5;
        }
        :host([disabled]) > * {
            pointer-events: none;
        }
        #search {
            flex-grow: 1;
            border-radius: var(--half-radius);
            border: 1px solid gray;
            font-family: inherit;
            padding: 0.3em;
            font-size: 1.1em;
        }
        #results {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 4px;
        }
        #results div {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 4px 8px 4px 8px;

            background-color: white;
            border-radius: var(--half-radius);
            border: 1px solid gray;

            cursor: pointer;

            transition: background-color 0.1s;
        }
        #results .pawn {
            cursor: grab;
        }
        #results div img {
            height: 1em;
            width: 1em;
        }
        #results div span {
            flex-grow: 1;
            word-break: break-word;
        }
        #results div:hover {
            background-color: var(--bg-top);
        }
        `;
        this.shadowRoot.appendChild(style);
    }

    getByName(name) {
        let folder = this.#contents;
        for (let segment of this.#path) {
            if (folder.get(segment) instanceof Map) {
                folder = folder.get(segment);
            }
        }
        return folder.get(name);
    }

    createResult(name, folder, onClick) {
        let folderElem = document.createElement("div");
        folderElem.classList.add(folder ? "folder" : "pawn");
        let folderIcon = document.createElement("img");
        folderIcon.src = folder ? "static/icons/folder.svg" : "static/icons/pawn.svg";
        folderIcon.setAttribute("draggable", "false");
        folderElem.appendChild(folderIcon);
        let folderText = document.createElement("span");
        folderText.innerText = name;
        folderElem.appendChild(folderText);

        if (!folder) {
            folderElem.setAttribute("draggable", "true");
            folderElem.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("application/pawn", name);
            });
        }
        folderElem.addEventListener("click", onClick);
        return folderElem;
    }

    registerPawn(path, pawn) {
        path = path.split("/").filter(seg => seg.length > 0);
        pawn = deserializePawn(pawn);

        let folder = this.#contents;
        for (let segment of path) {
            if (folder.has(segment)) {
                if (folder.get(segment) instanceof Map) {
                    folder = folder.get(segment);
                } else {
                    console.error("Failed to register pawn, path collision");
                    return;
                }
            } else {
                folder.set(segment, new Map());
                folder = folder.get(segment);
            }
        }
        if (pawn.name in folder) {
            console.error("Failed to register pawn, path collision");
            return;
        } else {
            folder.set(pawn.name, pawn);
        }
        this.render();
    }
    render() {
        let newResults = [];
        let folder = this.#contents;
        for (let segment of this.#path) {
            if (folder.get(segment) instanceof Map) {
                folder = folder.get(segment);
            }
        }
        if (this.#path.length > 0) {
            newResults.push(this.createResult("Back", true, () => {
                this.#path.splice(this.#path.length - 1);
                this.render();
            }));
        }
        for (let [key, value] of folder.entries()) {
            if (value instanceof Map) {
                newResults.push(this.createResult(key, true, () => {
                    this.#path.push(key);
                    this.render();
                }));
            } else {
                newResults.push(this.createResult(key, false, () => {
                    const event = new CustomEvent("spawn", { detail: value });
                    this.dispatchEvent(event);
                }));
            }
        }
        this.results.replaceChildren(...newResults);
    }
}

customElements.define('bird-spawn-menu', SpawnMenu);