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
    /*// Generate a random 52 bit integer (max safe js uint)
    // https://stackoverflow.com/a/70167319
    let [upper,lower] = new Uint32Array(Float64Array.of(Math.random()).buffer);
    upper = upper & 1048575; // upper & (2^20 - 1)
    upper = upper * Math.pow(2, 32); // upper << 32
    return upper + lower;*/
    //return crypto.getRandomValues(new Uint32Array(1))[0];
    let [upper, lower] = crypto.getRandomValues(new Uint32Array(2));
    return (BigInt(upper) << BigInt(32)) | BigInt(lower);
}