import { Quaternion, Vector3 } from 'three';

export class Transform {
    position = new Vector3();
    rotation = new Quaternion();
    
    constructor() { }
    clone() {
        let newTransform = new Transform();
        newTransform.copy(this.position, this.rotation);
        return newTransform;
    }
    copy(position, rotation) {
        this.position.copy(position);
        this.rotation.copy(rotation);
    }
    lerp(newPosition, newRotation, progress) {
        this.position.lerp(newPosition.clone(), progress);
        this.rotation.slerp(newRotation.clone(), progress);
    }
}

export class NetworkedTransform {
    position = new Vector3();
    rotation = new Quaternion();
    
    buffer = [];
    lastSynced = 0;
    
    constructor(position, rotation) {
        this.flushBuffer(position, rotation);
        
        this.position.copy(position);
        this.rotation.copy(rotation);
    }
    tick(position, rotation = new Quaternion()) {
        let now = performance.now();
        this.lastSynced = now;
        this.pushBuffer(now, position, rotation);
    }
    animate() {
        let diff = this.buffer[1].time - this.buffer[0].time;
        let progress = (performance.now()-this.lastSynced)/diff;
        progress = Math.max(Math.min(progress, 1), 0); // Clamp01
        
        this.position.copy(this.buffer[0].position);
        this.position.lerp(this.buffer[1].position.clone(), progress);
        
        this.rotation.copy(this.buffer[0].rotation);
        this.rotation.slerp(this.buffer[1].rotation.clone(), progress);
    }
    flushBuffer(position, rotation) {
        this.pushBuffer(performance.now(), position, rotation);
        this.pushBuffer(performance.now() + 1, position, rotation);
    }
    pushBuffer(time, position, rotation) {
        this.buffer.push({
            time:time,
            position:new Vector3().copy(position),
            rotation:new Quaternion().copy(rotation)
        });
        if (this.buffer.length > 2)
            this.buffer.shift();
    }
}
