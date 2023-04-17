export default class Tooltip extends HTMLElement {
    shadowRoot;

    constructor() {
        super();

        this.shadowRoot = this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(document.createElement('slot'));

        const style = document.createElement('style');
        style.textContent = `
        :host {
            display: none;
            position:absolute;
            pointer-events:none;
            user-select: none;

            background-color:rgba(0,0,0,0.8);
            color:white;

            transform:translate(0, -100%);
            padding:3px;
            border-radius:2px;
        }
        slot {
            white-space: nowrap;
        }
        `;
        this.shadowRoot.appendChild(style);

        // Track mouse position
        display.addEventListener('pointermove', (e) => {
            this.style.top = e.clientY + "px";
            this.style.left = e.clientX + "px";
        });
    }

    show() {
        this.style.display = 'block';
    }
    hide() {
        this.style.display = 'none';
    }
    visible() {
        return this.style.display == 'block';
    }
}

customElements.define('bird-tooltip', Tooltip);