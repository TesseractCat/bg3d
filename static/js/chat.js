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
        this.entries.innerHTML = `<p class="entry"><i>To start chatting, press 'Enter'</i></p>`;
        this.panel.appendChild(this.entries);

        this.input = document.createElement("input");
        this.panel.appendChild(this.input);

        const style = document.createElement('style');
        style.textContent = `
        :host {
            position:absolute;
            bottom: 20px;
            right: 20px;
            width: 280px;
        }
        #panel {
            padding: 20px;
            background-color: #DED6BA;
            border-radius: 10px;
            box-shadow: rgb(0 0 0 / 10%) 5px 5px 15px inset;
            user-select:none;
            overflow-x:hidden;
            
            cursor:pointer;
            transition:opacity 0.2s;
            opacity:0.2;
        }
        #entries {
            max-height:150px;
            overflow-y:auto;
        }
        input {
            margin-top:10px;
            width:100%;
            border-radius:5px;
            border:1px solid grey;
            padding:5px;
            box-sizing:border-box;

            pointer-events:none;
        }
        .entry {
            overflow-x: hidden;
            margin: 0px;
            margin-bottom: 3px;
        }
        @media only screen and (max-width: 768px) {
            :host {
                right:5%;
                left:5%;
                width:auto;
            }
            #entries {
                max-height:75px;
            }
        }
        `;
        this.shadowRoot.appendChild(style);

        let clickingPanel = false;
        this.panel.addEventListener('pointerdown', () => {
            if (!this.focused)
                clickingPanel = true;
        });
        document.addEventListener("mouseup", () => {
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

    chatFadeTimeout;
    addChatEntry(id, content, color) {
        let entry = document.createElement("p");
        entry.classList.add("entry");
        
        let name = document.createElement("span");
        name.style.color = color;
        name.innerText = "⬤: ";
        let text = document.createElement("span");
        text.innerText = content;
        
        entry.appendChild(name);
        entry.appendChild(text);
        this.entries.appendChild(entry);
        this.entries.scrollTop = this.entries.scrollHeight;
        
        this.panel.style.opacity = "1";
        if (this.chatFadeTimeout !== undefined)
            clearTimeout(this.chatFadeTimeout);
        this.chatFadeTimeout = setTimeout(() => {
            if (this.input != this.shadowRoot.activeElement)
                this.panel.style.opacity = "0.2";
        }, 4000);
    }
}

customElements.define('bird-chat', Chat);