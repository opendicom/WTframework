let ports = [];

onconnect = (event) => {
    const port = event.ports[0];
    ports.push(port);

    broadcast("tab conectada");

    port.onmessage = (e) => {
        console.log("mensaje recibido:", e.data);

        broadcast("Tab: " + e.data);
    };

    port.start();
};

// Function para mandar msg a todas las tabs
function broadcast(msg) {
    for (const p of ports) {
        p.postMessage(msg);
    }
}
