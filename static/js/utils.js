// https://gist.github.com/pygy/6290f78b078e22418821b07d8d63f111
Promise.pending = Promise.race.bind(Promise, []);
export function cancellablePromise(executor) {
    let cancel;
    var res = new Promise(function (resolve, reject) {
        let handler;
        function onCancel(cb) { handler = cb; }
        cancel = function cancel() {
            resolve(Promise.pending()); // adopt a forever pending state
            if (typeof handler === 'function') handler();
        }
        executor(resolve, reject, onCancel);
    });
    res.cancel = cancel;
    return res;
}

export function UniqueId() {
    // Generate a random 52 bit integer (max safe js uint)
    // https://stackoverflow.com/a/70167319
    let [upper,lower] = new Uint32Array(Float64Array.of(Math.random()).buffer);
    upper = upper & 1048575; // upper & (2^20 - 1)
    upper = upper * Math.pow(2, 32); // upper << 32
    return upper + lower;
    //return crypto.getRandomValues(new Uint32Array(1))[0];
    // let [upper, lower] = crypto.getRandomValues(new Uint32Array(2));
    // return (BigInt(upper) << BigInt(32)) | BigInt(lower);
}

export function numberToBytes(num) {
    if (num > Number.MAX_SAFE_INTEGER || num < 0) {
        throw new RangeError("Input must be a non-negative number less than or equal to Number.MAX_SAFE_INTEGER.");
    }

    const bigIntValue = BigInt(num);
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    const lowBits = Number(bigIntValue & 0xFFFFFFFFn); // Lower 32 bits
    const highBits = Number(bigIntValue >> 32n & 0xFFFFFFFFn); // Upper 32 bits
    view.setUint32(0, lowBits, true); // Low 32 bits
    view.setUint32(4, highBits, true); // High 32 bits

    return new Uint8Array(buffer);
}

export function serializationThreeTypesMixin(key, value) {
    if (value?.isVector3) {
        return {x: value.x, y: value.y, z: value.z}
    } else if (value?.isQuaternion) {
        return {x: value._x, y: value._y, z: value._z, w: value._w}
    } else {
        return value;
    }
}
export function serializationFixedFloatMixin(key, value) {
    if (typeof value === "number") {
        return parseFloat(value.toFixed(2));
    }
    return value;
}