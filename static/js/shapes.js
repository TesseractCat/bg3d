import * as THREE from 'three';

export class Shape { }

export class Box extends Shape {
    type = "Box";
    halfExtents;

    constructor(halfExtents) {
        super();
        this.halfExtents = new THREE.Vector3().copy(halfExtents);
    }
}

export class Cylinder extends Shape {
    type = "Cylinder";
    radius;
    height;

    constructor(radius, height) {
        super();
        this.radius = radius;
        this.height = height;
    }
}
