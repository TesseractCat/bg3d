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
    type = "Box";
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
    type = "Cylinder";
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
    type = 'Pawn';

    position;
    rotation;

    mesh;
    tint;

    moveable;
    name;
    colliderShapes;

    #id = null;

    constructor({position = new Vector3(), rotation = new Vector3(),
                 mesh, tint,
                 moveable, name, colliderShapes = []}) {
        this.position = new Vector3().copy(position);
        this.rotation = new Vector3().copy(rotation);

        this.mesh = mesh;
        this.tint = tint;

        this.moveable = moveable;
        this.name = name;
        this.colliderShapes = colliderShapes.map(shape => shape.clone());
    }

    async create() {
        this.id = await addPawn(this);
        return this;
    }

    clone(parameters) {
        return new this.constructor({...this, ...parameters});
    }
}
class SnapPoint extends Pawn {
    type = 'SnapPoint';

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
    type = 'Deck';

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
    type = 'Container';

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
    type = 'Dice';

    rollRotations;

    constructor({rollRotations = [], ...rest}) {
        super(rest);

        this.rollRotations = rollRotations.map(rot => rot.clone());
    }
}

// Functions

function callMain(message, waitReturn = true) {
    if (!waitReturn) {
        postMessage(message);
        return;
    }
    let resultPromise = new Promise((resolve, reject) => {
        let wait = (e) => {
            let data = e.data;
            if (data.type == "return") {
                removeEventListener('message', wait);
                resolve(data.result);
            }
        };
        addEventListener('message', wait);
    });
    postMessage(message);
    return resultPromise;
}

async function addPawn(pawn) {
    let id = await callMain({
        type:"addPawn",
        pawn:pawn,
    });
    return id;
}
async function removePawn(id) {
    callMain({
        type:"removePawn",
        pawn:id,
    }, false);
}

// Events

self.start = function() { }

addEventListener('message', async function (e) {
    let data = e.data;
    if (data.type == "call") {
        let result = await self[data.action]();
        postMessage({
            type:"return",
            result:result
        });
    }
});
