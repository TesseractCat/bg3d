import { Vector3 } from 'three';
import { Spring } from './spring';

class Card extends HTMLElement {
    #image;
    #imageContainer;
    #hiddenImage;
    #flippedIndicator;

    constructor() {
        super();
        this.attachShadow({mode: 'open'});

        this.#imageContainer = document.createElement('div');
        this.#image = document.createElement('img');
        this.#image.draggable = false;
        this.#imageContainer.appendChild(this.#image);

        this.#flippedIndicator = document.createElement("p");
        this.#flippedIndicator.id = "flipped";
        this.#flippedIndicator.innerText = "↺";
        this.#flippedIndicator.style.display = "none";
        this.#imageContainer.appendChild(this.#flippedIndicator);

        this.#hiddenImage = document.createElement('div');
        this.#hiddenImage.id = 'hidden';

        let style = document.createElement('style');
        this.shadowRoot.append(style,
                               this.#imageContainer, this.#hiddenImage);

        style.textContent = `
:host {
    display: inline-block;
}
img, div {
    display: inherit;
    aspect-ratio: inherit;
    height: inherit;
}
#hidden {
    visibility: hidden;
}
div:not(#hidden) {
    position: fixed;
    top: 0px;
    left: 0px;
    overflow: hidden;

    border-radius: inherit;

    box-shadow: -10px 10px 20px rgb(0 0 0 / 30%);

    transition: border 0.2s;

    background: url(static/games/generic/alpha.png);
}
:host([grabbed]) div {
    /*opacity: 0.5;*/
}
#flipped {
    position: absolute;
    top: 0px;
    right: 0px;
    margin: 0px;

    color:white;
    background-color: black;

    width: 1.5em;
    height: 1.5em;
    line-height: 1.5em;

    border-radius: 0 0 0 2px;

    transition: opacity 0.1s;
}
#flipped:hover {
    opacity: 0.2;
}
`;
    }

    get src() { this.#image.src; }
    set src(newSrc) {
        this.#image.src = newSrc;
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'src') {
            this.src = newValue;
        }
        if (name === 'flipped') {
            this.#flippedIndicator.style.display = "block";
        }
    }
    static get observedAttributes() {
        return ['src', 'grabbed', 'flipped'];
    }

    #springs = [new Spring(0, 200, 20), new Spring(0, 200, 20)];
    set position(p) {
        this.#springs[0].set(p[0]);
        this.#springs[1].set(p[1]);
    }
    get grabbed() {
        return this.hasAttribute('grabbed');
    }
    set grabbed(g) {
        if (g) {
            this.setAttribute('grabbed', g);
        } else {
            this.removeAttribute('grabbed');
        }
        this.#imageContainer.style.zIndex = g ? 1 : 0;
        this.#imageContainer.style.pointerEvents = g ? 'none' : 'auto';
    }

    lastTime;
    animationId;
    animate(time) {
        this.#springs[0].center = this.getBoundingClientRect().left;
        this.#springs[1].center = this.getBoundingClientRect().top;

        if (!this.lastTime)
            this.lastTime = time;

        let elapsed = (time - this.lastTime)/1000;
        let dt = Math.min(elapsed, 1/20);

        if (!this.grabbed) {
            let x = this.#springs[0].animate(dt).toFixed(2);
            let y = this.#springs[1].animate(dt).toFixed(2);
            this.#imageContainer.style.transform = `translate(${x}px, ${y}px)`;
        } else {
            let x = this.#springs[0].get();
            let y = this.#springs[1].get();
            this.#imageContainer.style.transform = `translate(${x}px, ${y}px)`;
        }

        if (time !== undefined)
            this.lastTime = time;
        this.animationId = requestAnimationFrame((t) => this.animate(t));
    }
    reset() {
        this.#springs[0].set(this.getBoundingClientRect().left);
        this.#springs[1].set(this.getBoundingClientRect().top);
    }

    connectedCallback() {
        this.reset();
        this.animate(performance.now());
    }
    disconnectedCallback() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
    }
}

export default class Hand extends HTMLElement {
    cards = new Map();
    shadowRoot;
    cardSlot;
    tip;

    grabbedCard = null;
    
    constructor() {
        super();

        this.shadowRoot = this.attachShadow({ mode: 'open' });

        this.tip = document.createElement("h1");
        this.tip.innerText = "Drag cards here";
        this.shadowRoot.appendChild(this.tip);

        this.cardSlot = document.createElement("slot");
        this.shadowRoot.appendChild(this.cardSlot);

        const style = document.createElement('style');
        style.textContent = `
        :host {
            pointer-events: none;
        }
        ::slotted(bird-card) {
            cursor: pointer;
            height: 200px;

            display: inline-block;

            margin-left: calc(-1 * var(--offset));
            pointer-events:auto;
            user-select:none;
        }
        ::slotted(bird-card:first-child) {
            margin-left: 0px;
        }
        ::slotted(bird-card:hover) {
            margin-bottom: var(--offset);
            margin-right: var(--offset);
            margin-left: 0px;
        }

        slot {
            height: 200px;
            margin-bottom: calc(-2 * var(--offset));

            display:flex;
            justify-content:center;
            align-items:flex-end;
            text-align:center;
            
            transition: background 0.2s;
        }
        :host([minimized]) slot {
            margin-bottom: calc(-3 * var(--offset));
            pointer-events: none;
        }

        h1 {
            display: none;
            position: absolute;
            left: 50%;
            transform: translate(-50%, 0);
            top: 0px;
            user-select: none;
            color: rgba(0,0,0,0.5);
        }
        :host([indicate]) h1 {
            display: block;
        }
        `;
        this.shadowRoot.appendChild(style);
    }
    
    pushCard(deck, grab=false) {
        let serialized = deck.serialize();
        if (this.cards.has(serialized.id)) {
            console.warn("Attempting to add duplicate pawn to hand");
            return;
        }
        this.cards.set(serialized.id, serialized);
        let card = this.cards.get(serialized.id);
        console.assert(card.data.contents.length == 1);
        
        let imageElement = document.createElement('bird-card');
        imageElement.dataset.id = card.id;
        if (deck.flipped())
            imageElement.setAttribute("flipped", "");
        imageElement.src = `${window.location.pathname}/assets/${card.data.contents[0]}`;
        imageElement.style.borderRadius = `${deck.data.cornerRadius}in`;
        imageElement.style.aspectRatio = `${deck.data.size.x}/${deck.data.size.y}`;

        imageElement.addEventListener("pointermove", (e) => {
            if (this.grabbedCard === null)
                return;

            let {left, width} = e.target.getBoundingClientRect();
            let middle = left + width/2;
            let before = e.clientX < middle;

            if (before) {
                if (this.grabbedCard.nextSibling !== e.target) {
                    this.insertBefore(this.grabbedCard, e.target);
                }
            } else {
                if (this.grabbedCard !== e.target.nextSibling) {
                    this.insertBefore(this.grabbedCard, e.target.nextSibling);
                }
            }
        });

        imageElement.addEventListener('pointerdown', (e) => {
            let offset = [imageElement.getBoundingClientRect().x - e.clientX,
                          imageElement.getBoundingClientRect().y - e.clientY];
            imageElement.grabbed = true;
            this.grabbedCard = imageElement;

            const cardDrop = () => {
                document.removeEventListener('pointerup', cardDrop);
                document.removeEventListener('pointermove', cardMove);

                this.grabbedCard = null;

                imageElement.grabbed = false;
                display.focus(); // Otherwise focus goes to <body> for some reason...
            }
            const cardMove = (e) => {
                if (e.clientY < (window.innerHeight - 200)) {
                    // cardDrop();
                    // this.takeCard(card.id);
                    let hint = window.manager.getHintPosition();
                    window.manager.sendSocket({
                        type: "take_pawn",
                        from_id: window.manager.id,
                        target_id: card.id,
                        position_hint: hint
                    });
                    // const onAddPawn = (e) => {
                    //     if (e.detail.pawn.id == card.id) {
                    //         window.manager.removeEventListener("add_pawn", onAddPawn);
                    //     }
                    // };
                    // window.manager.addEventListener("add_pawn", onAddPawn);
                    return;
                }
                imageElement.position = [e.clientX + offset[0], e.clientY + offset[1]];
            }

            document.addEventListener('pointerup', cardDrop);
            document.addEventListener('pointermove', cardMove);
        });
        imageElement.oncontextmenu = function() { return false; }

        this.appendChild(imageElement);
        imageElement.reset();
        if (grab) {
            let {x, y, height} = imageElement.getBoundingClientRect();
            let width = (deck.data.size.x/deck.data.size.y) * height;
            imageElement.dispatchEvent(new PointerEvent('pointerdown', {
                clientX: x + width/2,
                clientY: y + height/2,
            }));
        }
    }
    updateCard(serializedCard) {
        if (this.cards.has(serializedCard.id)) {
            let card = this.cards.get(serializedCard.id);
            if (serializedCard.hasOwnProperty('data')) {
                card.data = serializedCard.data;

                let imageElement = this.querySelector(`bird-card[data-id="${card.id}"]`);
                imageElement.src = `${window.location.pathname}/assets/${card.data.contents[0]}`;
                imageElement.style.borderRadius = `${card.data.cornerRadius}in`;
                imageElement.style.aspectRatio = `${card.data.size.x}/${card.data.size.y}`;
            }
        }
    }
    takeCard(id) {
        if (this.grabbedCard !== null && parseInt(this.grabbedCard.dataset.id) == id)
            this.grabbedCard = null;
        this.cards.delete(id);
        [...this.querySelectorAll(`bird-card[data-id="${id}"]`)].forEach((e) => e.remove());
    }
    clear() {
        // Remove children
        while (this.firstChild) {
            this.firstChild.remove();
        }
        this.cards.clear();
    }

    minimize(state, indicate) {
        if (state) {
            this.setAttribute("minimized", "");
            if (indicate)
                this.setAttribute("indicate", "");
        } else {
            this.removeAttribute("minimized");
            this.removeAttribute("indicate");
        }
    }
}

window.customElements.define('bird-card', Card);
window.customElements.define('bird-hand', Hand);