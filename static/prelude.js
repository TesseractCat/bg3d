// Classes

class Vector3 {
    x;
    y;
    z;
    
    constructor(x,y,z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    copy(rhs) {
        this.x = rhs.x;
        this.y = rhs.y;
        this.z = rhs.z;
    }
    clone() {
        return new Vector3(0,0,0).copy(this);
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
    position;
    mesh;
    moveable;
    name;
    colliderShapes;

    constructor({position, mesh, moveable = true, name, colliderShapes = []}) {
        this.position = position;
        this.mesh = mesh;
        this.moveable = moveable;
        this.name = name;
        this.colliderShapes = colliderShapes;
    }
}

// Functions

function addPawn(pawn) {
    postMessage({
        type:"addPawn",
        pawn:pawn,
    });
}
function removePawn(id) {
    postMessage({
        type:"removePawn",
        pawn:id,
    });
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
