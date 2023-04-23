export default class Chat extends HTMLElement {
    shadowRoot;
    panel;
    entries;
    input;

    focused = false;

    constructor() {
        super();

        this.shadowRoot = this.attachShadow({ mode: 'open' });

        this.panel = document.createElement("div");
        this.panel.id = "panel";
        this.shadowRoot.appendChild(this.panel);

        this.entries = document.createElement("div");
        this.entries.id = "entries";
        const isMobile = window.matchMedia("(max-width: 768px)").matches;
        if (isMobile) {
            this.entries.innerHTML = `<p class="entry"><i>To start chatting, tap here</i></p>`;
        } else {
            this.entries.innerHTML = `<p class="entry"><i>To start chatting, press 'Enter'</i></p>`;
        }
        this.panel.appendChild(this.entries);

        this.input = document.createElement("input");
        this.panel.appendChild(this.input);

        const style = document.createElement('style');
        style.textContent = `
        ::selection {
            color: #EEE;
            background: rgba(0,0,0,0.8);
        }

        #panel {
            padding: 20px;
            background: var(--background);
            background-blend-mode: var(--blend-mode);

            border-radius: var(--radius);
            border: var(--border);

            box-shadow: var(--shadow);
            user-select: none;
            overflow-x: hidden;
            
            cursor: pointer;
            transition: opacity 0.2s;
            opacity: 0.2;
        }
        #entries {
            max-height: 150px;
            overflow-y: auto;
        }
        input {
            margin-top: 10px;
            width: 100%;
            border-radius: var(--half-radius);
            border: 1px solid grey;
            padding: 5px;
            box-sizing: border-box;

            pointer-events: none;
        }
        .entry {
            overflow-x: hidden;
            margin: 0px;
            margin-bottom: 3px;
        }
        .entry span:first-child {
            margin-right: 0.25em;
        }
        @media only screen and (max-width: 768px) {
            #entries {
                max-height:75px;
            }
        }

        .entry .system {
            background-color: black;
            border-radius: 3px;
        }
        `;
        this.shadowRoot.appendChild(style);

        let clickingPanel = false;
        this.panel.addEventListener('pointerdown', (e) => {
            if (e.button != 0)
                return;

            if (!this.focused)
                clickingPanel = true;
        });
        document.addEventListener('mouseup', (e) => { // Event ordering issue with pointerup
            if (e.button != 0)
                return;

            if (clickingPanel) {
                this.focus();
                clickingPanel = false;
            }
        });
        this.input.addEventListener("keydown", (e) => {
            if (e.key == "Enter") {
                if (this.input.value != "") {
                    this.send(this.input.value);
                }
                this.blur();
            } else if (e.key == "Escape") {
                this.blur();
            }
        });
        this.input.addEventListener("blur", (e) => {
            this.blur();
        });
        this.shadowRoot.addEventListener("contextmenu", (e) => {
            if (e.target != this.input)
                e.preventDefault();
        });
    }

    focus() {
        this.focused = true;

        this.panel.style.cursor = "auto";
        this.panel.style.opacity = "1";
        this.input.style.pointerEvents = "auto";
        this.input.focus();
        this.input.select();
    }
    blur() {
        this.focused = false;

        this.panel.style.cursor = "pointer";
        this.panel.style.opacity = "0.2";
        this.input.style.pointerEvents = "none";
        this.input.value = "";
        this.input.blur();
        display.focus();
    }

    send(content) {
        this.dispatchEvent(new CustomEvent("chat", {
            detail: content
        }));
    }

    #fadeTimeout;
    #addEntry(name, color, content, className = null) {
        let entry = document.createElement("p");
        entry.classList.add("entry");
        
        let prefix = document.createElement("span");
        prefix.style.color = color;
        if (className)
            prefix.classList.add(className);
        prefix.innerText = `${name}:`;
        let text = document.createElement("span");
        text.innerText = content;
        
        entry.appendChild(prefix);
        entry.appendChild(text);
        this.entries.appendChild(entry);
        this.entries.scrollTop = this.entries.scrollHeight;
        
        this.panel.style.opacity = "1";
        if (this.#fadeTimeout !== undefined)
            clearTimeout(this.#fadeTimeout);
        this.#fadeTimeout = setTimeout(() => {
            if (this.input != this.shadowRoot.activeElement)
                this.panel.style.opacity = "0.2";
        }, 4000);

    }
    addChatEntry(content, color) {
        this.#addEntry("⬤", color, content);
    }
    addSystemEntry(content) {
        this.#addEntry("SYS", "white", content, "system");
    }
}

customElements.define('bird-chat', Chat);