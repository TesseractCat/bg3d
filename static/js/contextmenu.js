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
        
        button, p {
            margin: 0px;

            display:block;
            box-sizing:border-box;

            width: 100%;
            padding-left: 15%;
            font-family: inherit;
        }
        button {
            font-size:0.9em;
            border: none;
            border-radius:0px;
            background-color: transparent;
            text-align: left;
        }
        button:hover {
            background-color: rgba(0,0,0,0.2);
        }
        p {
            font-style: italic;
            text-transform: capitalize;
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
                if (entry.length == 1) {
                    let text = document.createElement("p");
                    text.innerText = entry[0];

                    this.element.appendChild(text);
                } else if (entry.length == 2) {
                    let [name, action] = entry;

                    let button = document.createElement("button");
                    button.innerText = name;
                    button.addEventListener("click", () => {
                        this.hide();
                        action();
                    });

                    this.element.appendChild(button);
                }
            }

            // Create divider
            if (i != menu.length - 1) {
                let divider = document.createElement("hr");
                this.element.appendChild(divider);
            }
        }

        this.style.left = event.clientX + "px";
        this.style.top = event.clientY + "px";
        this.element.style.display = "block";

        this.visible = true;
    }
    hide() {
        this.element.style.display = "none";

        this.visible = false;
    }
}

customElements.define('bird-context-menu', ContextMenu);
