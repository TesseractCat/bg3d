import { Vector3 } from 'three';
import { Spring } from './spring';
import { Pawn } from './pawn';

class CardElement extends HTMLElement {
    image;
    hiddenImage;

    constructor() {
        super();
        this.attachShadow({mode: 'open'});

        this.image = document.createElement('img');
        this.image.draggable = false;
        this.hiddenImage = this.image.cloneNode();
        this.hiddenImage.id = 'hidden';

        let style = document.createElement('style');
        this.shadowRoot.append(style,
                               this.image, this.hiddenImage);

        style.textContent = `
:host {
    display: inline-block;
}
img {
    display: inherit;
    width: inherit;
    height: inherit;
}
img#hidden {
    visibility: hidden;
}
img:not(#hidden) {
    position: fixed;
    top: 0px;
    left: 0px;

    border-radius: inherit;

    box-shadow: -10px 10px 20px rgb(0 0 0 / 30%);

    transition: opacity 0.2s;
}
:host([grabbed]) img:not(#hidden) {
    opacity:0.5;
}
`;
    }

    get src() { this.image.src; }
    set src(newSrc) {
        // Defer loading image
        let newImage = this.image.cloneNode();
        newImage.src = newSrc;

        newImage.addEventListener('load', () => {
            this.image.replaceWith(newImage);
            this.image = newImage;
            let newHiddenImage = newImage.cloneNode();
            this.hiddenImage.replaceWith(newHiddenImage);
            this.hiddenImage = newHiddenImage;
            this.hiddenImage.id = 'hidden';

            // Hack to update grabbed
            this.grabbed = this.grabbed;
        });
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'src') {
            this.src = newValue;
        }
    }
    static get observedAttributes() {
        return ['src', 'grabbed'];
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
        this.image.style.zIndex = g ? 1 : 0;
        this.image.style.pointerEvents = g ? 'none' : 'auto';
    }

    lastTime;
    animationId;
    animate(time) {
        this.#springs[0].center = this.getBoundingClientRect().left;
        this.#springs[1].center = this.getBoundingClientRect().top;

        if (this.lastTime !== undefined) {
            let dt = Math.min(time - this.lastTime, 50)/1000;

            if (!this.grabbed) {
                let x = this.#springs[0].animate(dt).toFixed(2);
                let y = this.#springs[1].animate(dt).toFixed(2);
                this.image.style.transform = `translate(${x}px, ${y}px)`;
            } else {
                let x = this.#springs[0].get();
                let y = this.#springs[1].get();
                this.image.style.transform = `translate(${x}px, ${y}px)`;
            }
        }

        if (time !== undefined)
            this.lastTime = time;
        this.animationId = window.requestAnimationFrame((t) => this.animate(t));
    }
    reset() {
        this.#springs[0].set(this.getBoundingClientRect().left);
        this.#springs[1].set(this.getBoundingClientRect().top);
    }

    connectedCallback() {
        this.animate();
    }
    disconnectedCallback() {
        if (this.animationId) {
            window.cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
    }
}
window.customElements.define('bird-card', CardElement);

export class Hand {
    manager;
    cards = new Map();
    element;
    
    constructor(manager) {
        this.manager = manager;
        this.element = document.querySelector("#hand-panel");
    }
    
    pushCard(deck, grab=false) {
        let serialized = deck.serialize();
        this.cards.set(serialized.id, serialized);
        let card = this.cards.get(serialized.id);
        console.assert(card.data.contents.length == 1);
        
        let imageElement = document.createElement('bird-card');
        imageElement.dataset.id = card.id;
        imageElement.className = 'card';
        imageElement.src = `${window.location.pathname}/assets/${card.data.contents[0]}`;
        imageElement.style.borderRadius = `${card.data.cornerRadius}in`;

        imageElement.addEventListener('pointerdown', (e) => {
            let offset = [imageElement.getBoundingClientRect().x - e.clientX,
                          imageElement.getBoundingClientRect().y - e.clientY];
            imageElement.grabbed = true;

            const cardDrop = () => {
                document.removeEventListener('pointerup', cardDrop);
                document.removeEventListener('pointermove', cardMove);
                this.element.querySelectorAll('.card').forEach((e) => {
                    e.removeEventListener('pointermove', cardHover);
                });

                imageElement.grabbed = false;
            }
            const cardMove = (e) => {
                if (e.clientY < window.innerHeight * 0.75) {
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
            this.element.querySelectorAll(`.card:not([data-id="${card.id}"])`).forEach((e) => {
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

                let imageElement = this.element.querySelector(`.card[data-id="${card.id}"]`);
                imageElement.src = `${window.location.pathname}/${card.data.contents[0]}`;
            }
        }
    }
    takeCard(id) {
        if ([...this.manager.pawns.values()].filter(p => p.selected).length != 0)
            return;
        
        let card = this.cards.get(id);
        this.cards.delete(id);
        this.element.querySelector(`.card[data-id="${id}"]`)?.remove();
        
        let raycastableObjects = [...this.manager.pawns.values()].map(x => x.mesh);
        raycastableObjects.push(this.manager.plane);
        let hits = this.manager.raycaster.intersectObjects(raycastableObjects, true);
        
        if (hits.length >= 1) {
            let hitPoint = hits[0].point.clone();
            card.position = hitPoint.add(new Vector3(0, 2, 0));
            
            let cardPawn = this.manager.loadPawn(card);
            const grabHandler = (e) => {
                if (e.detail.pawn.id == cardPawn.id) {
                    this.manager.pawns.get(cardPawn.id).grab(0);
                    this.manager.removeEventListener("add_pawn", grabHandler);
                }
            };
            this.manager.addEventListener("add_pawn", grabHandler);
            this.manager.sendAddPawn(cardPawn);
        }
    }
    clear() {
        console.log("Clearing hand...");
        // Remove children
        while (this.element.firstChild) {
            this.element.firstChild.remove();
        }
        this.cards.clear();
    }

    minimize(state) {
        if (state) {
            this.element.classList.add("minimized");
        } else {
            this.element.classList.remove("minimized");
        }
    }
}
