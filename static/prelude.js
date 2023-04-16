// Classes
// All classes are easily cloneable, as they always clone parameters

class Vector3 {
    x;
    y;
    z;
    
    constructor(x=0, y=0, z=0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    copy(rhs) {
        this.x = rhs.x;
        this.y = rhs.y;
        this.z = rhs.z;
        return this;
    }
    clone() {
        return new Vector3().copy(this);
    }
    add(rhs) {
        return new Vector3(this.x + rhs.x, this.y + rhs.y, this.z + rhs.z);
    }
}
class Vector2 {
    x;
    y;
    
    constructor(x=0, y=0) {
        this.x = x;
        this.y = y;
    }
    copy(rhs) {
        this.x = rhs.x;
        this.y = rhs.y;
        return this;
    }
    clone() {
        return new Vector2().copy(this);
    }
    toVector3({x, y, z}) {
        if (x)
            return new Vector3(x, this.x, this.y);
        if (y)
            return new Vector3(this.x, y, this.y);
        if (z)
            return new Vector3(this.x, this.y, z);

        return new Vector3(this.x, 0, this.y);
    }
    rotate(angle) {
        let rx = Math.cos(angle) * this.x - Math.sin(angle) * this.y;
        let ry = Math.sin(angle) * this.x + Math.cos(angle) * this.y;
        return new Vector2(rx, ry);
    }
    add(rhs) {
        return new Vector2(this.x + rhs.x, this.y + rhs.y);
    }
}

class Box {
    class = "Box";

    halfExtents;

    constructor(halfExtents = new Vector3()) {
        this.halfExtents = new Vector3().copy(halfExtents);
    }
    copy(rhs) {
        this.halfExtents.copy(rhs.halfExtents);
    }
    clone() {
        return new Box(this.halfExtents);
    }
}
class Cylinder {
    class = "Cylinder";

    radius;
    height;

    constructor(radius, height) {
        this.radius = radius;
        this.height = height;
    }
    clone() {
        return new Cylinder(this.radius, this.height);
    }
}

class Pawn {
    class = "Pawn";

    id;

    position;
    rotation;

    mesh;
    tint;

    moveable;
    name;
    colliderShapes;

    constructor({id = null, position = new Vector3(), rotation = new Vector3(),
                 mesh, tint, moveable, name, colliderShapes = []}) {
        this.id = (id == null) ? Pawn.nextId() : id;

        this.position = new Vector3().copy(position);
        this.rotation = new Vector3().copy(rotation);

        this.mesh = mesh;
        this.tint = tint;

        this.moveable = moveable;
        this.name = name;
        this.colliderShapes = colliderShapes.map(shape => shape.clone());
    }

    static nextId() {
        // Generate a random 52 bit integer (max safe js uint)
        // https://stackoverflow.com/a/70167319
        let [upper,lower] = new Uint32Array(Float64Array.of(Math.random()).buffer);
        upper = upper & 1048575; // upper & (2^20 - 1)
        upper = upper * Math.pow(2, 32); // upper << 32
        return upper + lower;
    }

    clone(parameters) {
        return new this.constructor({...this, ...parameters});
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

            if (msg.name == "update") {
                for (let pawn of msg.pawns) {
                    this.#pawns.set(pawn.id, pawn);
                }
            } else if (msg.name == "remove") {
                for (let id of msg.pawns) {
                    this.#pawns.delete(id);
                }
            } else if (msg.name == "clear") {
                this.#pawns.clear();
            }

            this.dispatchEvent(new CustomEvent(msg.name));
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
}
self.world = new World();