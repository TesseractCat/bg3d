import * as THREE from 'three';

export class Shape { }

export class Box {
    type = "Box";
    halfExtents;

    constructor(halfExtents) {
        this.halfExtents = new THREE.Vector3().copy(halfExtents);
    }
}

export class Cylinder {
    type = "Cylinder";
    radius;
    height;

    constructor(radius, height) {
        this.radius = radius;
        this.height = height;
    }
}
