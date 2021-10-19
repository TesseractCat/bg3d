let loop = true;

onmessage = (e) => {
    loop = e;
};

setInterval(function() {
    if (loop)
        postMessage({});
}, 1000/30);
