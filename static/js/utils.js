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