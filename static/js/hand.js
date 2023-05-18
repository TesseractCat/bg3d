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

    transition: opacity 0.2s;

    background: url(static/games/generic/alpha.png);
}
:host([grabbed]) div {
    opacity: 0.5;
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
        // Defer loading image
        // - Don't remember why I did this, probably should remove this code...
        /*let newImage = this.#imageContainer.cloneNode(true);
        newImage.firstChild.src = newSrc;

        newImage.firstChild.addEventListener('load', () => {
            this.#imageContainer.replaceWith(newImage);
            this.#imageContainer = newImage;
            this.#image = newImage.firstChild;

            let newHiddenImage = this.#image.cloneNode();
            newHiddenImage.id = 'hidden';
            this.#hiddenImage.replaceWith(newHiddenImage);
            this.#hiddenImage = newHiddenImage;

            // Hack to update grabbed
            this.grabbed = this.grabbed;
        });*/
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
    element;
    
    constructor() {
        super();

        this.shadowRoot = this.attachShadow({ mode: 'open' });
        this.element = document.createElement("div");
        this.shadowRoot.appendChild(this.element);

        const style = document.createElement('style');
        style.textContent = `
        :host {
            pointer-events:none;
        }
        bird-card {
            cursor:pointer;
            height: 200px;

            display:inline-block;

            margin-left: calc(-1 * var(--offset));
            pointer-events:auto;
            user-select:none;
        }
        bird-card:first-child {
            margin-left: 0px;
        }
        bird-card:hover {
            margin-bottom: var(--offset);
            margin-right: var(--offset);
            margin-left: 0px;
        }

        div {
            height: 200px;
            margin-bottom: calc(-2 * var(--offset));

            display:flex;
            justify-content:center;
            align-items:flex-end;
            text-align:center;
            
            transition: background 0.2s;
        }
        :host([minimized]) div {
            margin-bottom: calc(-3 * var(--offset));
            pointer-events: none;
        }
        `;
        this.shadowRoot.appendChild(style);
    }
    
    pushCard(deck, grab=false) {
        let serialized = deck.serialize();
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

        imageElement.addEventListener('pointerdown', (e) => {
            let offset = [imageElement.getBoundingClientRect().x - e.clientX,
                          imageElement.getBoundingClientRect().y - e.clientY];
            imageElement.grabbed = true;

            const cardDrop = () => {
                document.removeEventListener('pointerup', cardDrop);
                document.removeEventListener('pointermove', cardMove);
                this.element.querySelectorAll('bird-card').forEach((e) => {
                    e.removeEventListener('pointermove', cardHover);
                });

                imageElement.grabbed = false;
                display.focus(); // Otherwise focus goes to <body> for some reason...
            }
            const cardMove = (e) => {
                if (e.clientY < (window.innerHeight - 200)) {
                    cardDrop();
                    this.takeCard(card.id);
                    return;
                }
                imageElement.position = [e.clientX + offset[0], e.clientY + offset[1]];
            }
            const cardHover = (e) => {
                let {left, width} = e.target.getBoundingClientRect();
                let middle = left + width/2;
                let before = e.clientX < middle;

                if (before) {
                    if (imageElement.nextSibling !== e.target) {
                        this.element.insertBefore(imageElement, e.target);
                    }
                } else {
                    if (e.target.nextSibling !== imageElement) {
                        this.element.insertBefore(imageElement, e.target.nextSibling);
                    }
                }
            }

            document.addEventListener('pointerup', cardDrop);
            document.addEventListener('pointermove', cardMove);
            this.element.querySelectorAll(`bird-card:not([data-id="${card.id}"])`).forEach((e) => {
                e.addEventListener('pointermove', cardHover);
            });
        });
        imageElement.oncontextmenu = function() { return false; }

        this.element.appendChild(imageElement);
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
    updateCard(cardJSON) {
        if (this.cards.has(cardJSON.id)) {
            let card = this.cards.get(cardJSON.id);
            if (cardJSON.hasOwnProperty('data')) {
                card.data = cardJSON.data;

                let imageElement = this.element.querySelector(`bird-card[data-id="${card.id}"]`);
                imageElement.src = `${window.location.pathname}/${card.data.contents[0]}`;
            }
        }
    }
    takeCard(id) {
        let card = this.cards.get(id);
        this.cards.delete(id);
        this.element.querySelector(`bird-card[data-id="${id}"]`)?.remove();

        this.dispatchEvent(new CustomEvent("take", {
            detail: card
        }));
    }
    clear() {
        // Remove children
        while (this.element.firstChild) {
            this.element.firstChild.remove();
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