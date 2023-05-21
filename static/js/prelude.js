import { Vector3, Vector2 } from 'three';
import { Box, Cylinder } from './shapes.js';
import { UniqueId } from './utils.js';

// Classes
// - All classes are easily cloneable, as they always clone parameters

class Pawn {
    class = "Pawn";

    id;

    position;
    rotation;

    mesh;
    tint;
    texture;

    moveable;
    name;

    constructor({id = null, position = new Vector3(), rotation = new Vector3(),
                 mesh, tint, texture, moveable = true, name = null}) {
        this.id = (id == null) ? Pawn.nextId() : id;

        this.position = new Vector3().copy(position);
        this.rotation = new Vector3().copy(rotation);

        this.mesh = mesh;
        this.tint = tint;
        this.texture = texture;

        this.moveable = moveable;
        this.name = name;
    }

    static nextId() {
        return UniqueId();
    }

    clone(parameters) {
        return new this.constructor({...this, id: null, ...parameters});
    }
}
class SnapPoint extends Pawn {
    class = "SnapPoint";

    radius;
    size;
    scale;
    snaps;

    constructor({radius, size, scale, snaps = [], ...rest}) {
        super(rest);

        this.radius = radius;
        this.size = size;
        this.scale = scale;
        this.snaps = [...snaps];
    }
}
class Deck extends Pawn {
    class = "Deck";

    contents;
    back;
    sideColor;

    border;
    cornerRadius;
    cardThickness;
    size;
    
    constructor({contents, back, sideColor,
                 border, cornerRadius, cardThickness, size, ...rest}) {
        super(rest);

        this.contents = [...contents];
        this.back = back;
        this.sideColor = sideColor;

        this.border = border;
        this.cornerRadius = cornerRadius;
        this.cardThickness = cardThickness;
        this.size = size;
    }

    shuffle() {
        for (let i = this.contents.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.contents[i], this.contents[j]]
                = [this.contents[j], this.contents[i]];
        }
    }
}
class Container extends Pawn {
    class = "Container";

    holds;
    capacity;
    
    constructor({holds, capacity, ...rest}) {
        super(rest);

        if (holds)
            this.holds = holds.clone();
        this.capacity = capacity;
    }
}
class Dice extends Pawn {
    class = "Dice";

    rollRotations;

    constructor({rollRotations = [], ...rest}) {
        super(rest);

        this.rollRotations = rollRotations.map(rot => rot.clone());
    }
}

// Functions

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// World

class World extends EventTarget {
    #pawns = new Map();

    constructor() {
        super();

        self.onmessage = (e) => {
            let msg = e.data;
            let ids = [];

            if (msg.name == "update") {
                for (let pawn of msg.pawns) {
                    this.#pawns.set(pawn.id, pawn);
                    ids.push(pawn.id);
                }
            } else if (msg.name == "remove") {
                for (let id of msg.pawns) {
                    this.#pawns.delete(id);
                    ids.push(id);
                }
            } else if (msg.name == "clear") {
                this.#pawns.clear();
            }

            this.dispatchEvent(new CustomEvent(msg.name, {
                detail: ids
            }));
        };
    }

    pawns() {
        return this.#pawns;
    }
    add(pawns) {
        if (!pawns?.[Symbol.iterator]) {
            pawns = [pawns];
        }
        for (let pawn of pawns) {
            this.#pawns.set(pawn.id, pawn);
        }
        this.commit(pawns.map(p => p.id));
    }
    remove(ids) {
        if (!ids?.[Symbol.iterator]) {
            ids = [ids];
        }
        for (let id of ids) {
            this.#pawns.delete(id);
        }
        this.commit(ids);
    }
    commit(ids = null) {
        if (ids) {
            postMessage({
                name: "commit",
                data: [...this.#pawns.values()].filter(p => ids.indexOf(p.id) != -1)
            });
        } else {
            postMessage({
                name: "commit",
                data: [...this.#pawns.values()]
            });
        }
    }
    close() {
        postMessage({name: "close"});
        self.close();
    }
}

self.Vector2 = Vector2;
self.Vector3 = Vector3;

self.Box = Box;
self.Cylinder = Cylinder;

self.Pawn = Pawn;
self.Deck = Deck;
self.Container = Container;
self.Dice = Dice;
self.SnapPoint = SnapPoint;

self.world = new World();
self.timeout = timeout;

self.standardDeck = () => {
    let suits = ['S','D','C','H'];
    let ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    return suits.flatMap((suit) => ranks.map((rank) => `generic/cards/${rank}${suit}.webp`));
};

// TODO: https://stackoverflow.com/questions/10653809/making-webworkers-a-safe-environment