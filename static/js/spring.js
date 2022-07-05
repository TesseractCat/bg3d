export class Spring {
    value;
    center = 0;

    stiffness;
    damping;
    mass;

    #velocity = 0;

    constructor(value, stiffness = 100, damping = 10, mass = 1) {
        this.value = value;

        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
    }

    animate(dt) {
        let Fspring = (-this.stiffness) * (this.value - this.center);
        let Fdamping = (-this.damping) * this.#velocity;
        let acceleration = (Fspring + Fdamping)/this.mass;

        this.#velocity += acceleration * dt;
        this.value += this.#velocity * dt;

        return this.value;
    }
    set(value) {
        this.value = value;
        this.#velocity = 0;
    }
    get() {
        return this.value;
    }
}
