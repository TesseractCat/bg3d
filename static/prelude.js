// Classes

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
}

class Box {
    type = "Box";
    halfExtents;

    constructor(halfExtents) {
        this.halfExtents = new Vector3().copy(halfExtents);
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
}

class Pawn {
    type = 'Pawn';

    position;
    rotation;
    mesh;
    moveable;
    name;
    colliderShapes;

    constructor({position = new Vector3(), rotation = new Vector3(), mesh, moveable = true, name, colliderShapes = []}) {
        this.position = position;
        this.rotation = rotation;

        this.mesh = mesh;
        this.moveable = moveable;
        this.name = name;
        this.colliderShapes = colliderShapes;
    }
}
class Deck extends Pawn {
    type = 'Deck';

    contents;
    sideColor;
    cornerRadius;
    size;
    
    constructor({contents=[], sideColor=0xcccccc, cornerRadius=0.05, size=new Vector2(), ...rest}) {
        super(rest);

        this.contents = contents;
        this.sideColor = sideColor;
        this.cornerRadius = cornerRadius;
        this.size = size;
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
