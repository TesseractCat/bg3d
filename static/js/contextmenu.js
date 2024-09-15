export default class ContextMenu extends HTMLElement {
    shadowRoot;
    element;

    visible = false;

    constructor() {
        super();

        this.shadowRoot = this.attachShadow({ mode: 'open' });
        this.element = document.createElement('div');
        this.shadowRoot.appendChild(this.element);
        
        const style = document.createElement('style');
        style.textContent = `
        :host {
            position: absolute;

            font-family: inherit;
        }

        div {
            display: none;

            width: 150px;
            padding: 5px 0px;

            background: var(--background);
            border: 1px solid rgba(0,0,0,0.5);
            border-radius: 2px;

            user-select:none;
        }
        
        button, p, label {
            margin: 0px;

            display: block;
            box-sizing: border-box;

            width: 100%;
            padding-left: 15%;
            font-family: inherit;
        }
        button, label {
            font-size: 0.9em;
            border: none;
            border-radius: 0px;
            background-color: transparent;
            text-align: left;
        }
        button:hover, label:hover {
            background-color: rgba(0,0,0,0.2);
        }
        p {
            font-style: italic;
            text-transform: capitalize;
        }
        label {
            display: flex;
            gap: 5px;
            align-items: center;
        }

        input[type="color"] {
            width: 10px;
            height: 10px;
            border: 1px solid gray;
            border-radius: 5px;

            padding: 0;
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
        }
        input[type="color"]::-webkit-color-swatch {
            border: none;
        }
        input[type="color"]::-webkit-color-swatch-wrapper {
            padding: 0;
            border: none;
        }
        input[type="color"]::-moz-color-swatch {
            border: none;
        }
        `;
        this.shadowRoot.appendChild(style);

        this.element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        document.addEventListener('pointerdown', (e) => {
            if (!this.contains(e.target) && this.visible) {
                this.hide();
            }
        });
    }

    show(event, menu) {
        // Remove children
        while (this.element.firstChild) {
            this.element.firstChild.remove();
        }
        
        // Create buttons
        for (let [i, section] of menu.entries()) {
            for (let entry of section) {
                if (entry.length == 1) { // Label, i.e. for the pawn name
                    let text = document.createElement("p");
                    text.innerText = entry[0];

                    this.element.appendChild(text);
                } else if (entry.length > 1) { // Buttons or inputs
                    let name, input, action;
                    if (entry[1] instanceof HTMLElement) {
                        [name, input, action] = entry;
                    } else {
                        [name, action] = entry;
                    }

                    let elem;
                    if (input) {
                        elem = document.createElement("label");
                        elem.innerText = name;
                        elem.prepend(input);
                    } else {
                        elem = document.createElement("button");
                        elem.innerText = name;
                    }

                    if (input) {
                        input.addEventListener("change", (e) => {
                            this.hide();
                            action(e.target.value);
                        });
                    } else {
                        elem.addEventListener("click", () => {
                            this.hide();
                            action();
                        });
                    }

                    this.element.appendChild(elem);
                }
            }

            // Create divider
            if (i != menu.length - 1) {
                let divider = document.createElement("hr");
                this.element.appendChild(divider);
            }
        }

        this.element.style.display = "block";
        const height = this.element.getBoundingClientRect().height;
        const bottomOverflow = Math.max((event.clientY + height) - document.body.clientHeight, 0);
        this.style.left = event.clientX + "px";
        this.style.top = (event.clientY - bottomOverflow) + "px";

        this.visible = true;
    }
    hide() {
        this.element.style.display = "none";

        this.visible = false;
    }
}

customElements.define('bird-context-menu', ContextMenu);
