export default class Tabbar extends HTMLElement {
    shadowRoot;
    bar;
    panel;

    selectedTab = 0;
    tabCount = 0;

    constructor() {
        super();

        this.shadowRoot = this.attachShadow({ mode: 'open' });

        this.bar = document.createElement("div");
        this.bar.id = "bar";
        this.shadowRoot.appendChild(this.bar);

        this.panel = document.createElement("slot");
        this.panel.id = "panel";
        this.shadowRoot.appendChild(this.panel);

        const style = document.createElement('style');
        style.textContent = `
        :host {
            display: flex;
            flex-direction: column;
            gap: var(--edge-offset);
            align-items: flex-end;
            pointer-events: none;
        }
        :host > * {
            pointer-events: auto;
        }

        #bar {
            display: flex;
            flex-direction: row-reverse;

            background-image: linear-gradient(180deg, var(--bg-top), var(--bg-bottom) 200%);
            background-color: #FFFFFF;
            background-blend-mode: multiply;
            border-radius: calc(var(--radius) * 2);
            box-shadow: var(--shadow);
            border: 1px solid var(--overlay-gray);

            user-select: none;
        }
        #bar div {
            height: 1.5em;
            width: 1.5em;
            cursor: pointer;
            padding: 7px;
            border-radius: calc(var(--radius) * 2);

            transition: background-color 0.1s;

            -webkit-tap-highlight-color: transparent;
        }
        #bar div.selected {
            background-color: var(--accent-button-hovered);
        }
        #bar div:hover {
            background-color: var(--accent-button-2);
        }
        #bar div:focus {
            outline: none !important;
        }
        #bar div ::slotted(img) {
            width: 100%;
            height: 100%;
        }
        `;
        this.shadowRoot.appendChild(style);
    }

    #mutationObserver;
    connectedCallback() {
        this.#mutationObserver = new MutationObserver(() => this.childrenChangedCallback());
        this.#mutationObserver.observe(this, { childList: true });
    }
    disconnectedCallback() {
        this.#mutationObserver.disconnect();
    }

    childrenChangedCallback() {
        this.bar.innerHTML = "";
        this.tabCount = Math.max(...[...this.children].map(e => parseInt(e.getAttribute("slot")))) + 1;
        for (let i = 0; i < this.tabCount; i++) {
            let buttonElement = document.createElement("div");
            if (i == 0)
                buttonElement.classList.add("selected");
            let iconSlot = document.createElement("slot");
            iconSlot.setAttribute("name", `${i}-icon`);
            buttonElement.appendChild(iconSlot);
            buttonElement.addEventListener("click", () => {
                this.selectTab(i);
            });
            this.bar.appendChild(buttonElement);
        }

        let defaultSelected = [...this.children].filter(e => e.hasAttribute("selected"))[0]?.getAttribute("slot");
        if (defaultSelected)
            this.selectTab(defaultSelected);
    }

    selectTab(index) {
        this.panel.setAttribute("name", index.toString());
        this.bar.querySelector(".selected")?.classList.remove("selected");
        this.bar.children[index]?.classList.add("selected");
    }
}

customElements.define('bird-tabbar', Tabbar);