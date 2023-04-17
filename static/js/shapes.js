import { Vector3 } from 'three';

export class Shape { }

export class Box extends Shape {
    class = "Box";
    halfExtents;

    constructor(halfExtents) {
        super();
        this.halfExtents = new Vector3().copy(halfExtents);
    }
    clone() {
        return new Box(this.halfExtents);
    }
}

export class Cylinder extends Shape {
    class = "Cylinder";
    radius;
    height;

    constructor(radius, height) {
        super();
        this.radius = radius;
        this.height = height;
    }
    clone() {
        return new Cylinder(this.radius, this.height);
    }
}
