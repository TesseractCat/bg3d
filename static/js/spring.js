import { Vector3 } from 'three';

export class Spring {
    value;
    center = 0;

    stiffness;
    damping;
    mass;

    #velocity = 0;

    constructor(value = 0, stiffness = 100, damping = 10, mass = 1) {
        this.value = value;

        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
    }

    animate(dt) {
        dt = Math.min(dt, 1/20); // Limit delta time to prevent spring moving out of control

        let Fspring = (-this.stiffness) * (this.value - this.center);
        let Fdamping = (-this.damping) * this.#velocity;
        let acceleration = (Fspring + Fdamping)/this.mass;

        this.#velocity += acceleration * dt;
        this.value += this.#velocity * dt;

        return this.value;
    }
    animateTo(center, dt) {
        this.center = center;
        return this.animate(dt);
    }
    set(value) {
        this.value = value;
        this.#velocity = 0;
    }
    get() {
        return this.value;
    }
}

export class Vector3Spring {
    spring = {x: null, y: null, z: null};
    stiffness;
    damping;
    mass;

    constructor(value = new Vector3(0,0,0), stiffness = 100, damping = 10, mass = 1) {
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
        this.copy(value);
    }
    animate(dt) {
        return new Vector3(
            this.spring.x.animate(dt),
            this.spring.y.animate(dt),
            this.spring.z.animate(dt)
        );
    }
    animateTo(center, dt) {
        this.spring.x.center = center.x;
        this.spring.y.center = center.y;
        this.spring.z.center = center.z;
        return this.animate(dt);
    }
    copy(rhs) {
        this.spring = {
            x: new Spring(rhs.x, this.stiffness, this.damping, this.mass),
            y: new Spring(rhs.y, this.stiffness, this.damping, this.mass),
            z: new Spring(rhs.z, this.stiffness, this.damping, this.mass),
        };
    }
}
