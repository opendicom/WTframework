let transport = null;
let writer = null;
let reader = null;

const statusDiv = document.getElementById('status');
const logDiv = document.getElementById('log');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const sendBtn = document.getElementById('sendBtn');
const messageInput = document.getElementById('messageInput');

function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
}

function updateStatus(status, className) {
    statusDiv.textContent = `Estado: ${status}`;
    statusDiv.className = className;
}

async function connect() {
    try {
        updateStatus('Conectando...', 'connecting');
        log('Intentando conectar a https://localhost:4433', 'info');
        
        const serverCertificateHashes = [{
            algorithm: "sha-256",
            value: new Uint8Array([149, 139, 192, 125, 80, 31, 52, 31, 51, 116, 109, 223, 113, 90, 81, 49, 183, 210, 209, 140, 154, 216, 16, 211, 200, 79, 149, 253, 46, 241, 95, 232])
        }];
        
        transport = new WebTransport('https://localhost:4433', {
            serverCertificateHashes: serverCertificateHashes
        });
        
        await transport.ready;
        
        log('¡Conexión establecida correctamente!', 'success');
        updateStatus('Conectado', 'connected');
        
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        sendBtn.disabled = false;
        messageInput.disabled = false;

        const stream = await transport.createBidirectionalStream();
        writer = stream.writable.getWriter();
        reader = stream.readable.getReader();

        log('Stream bidireccional creado', 'success');

        readFromServer();

    } catch (error) {
        log(`Error al conectar: ${error.message}`, 'error');
        updateStatus('Error en la conexión', 'disconnected');
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        sendBtn.disabled = true;
        messageInput.disabled = true;
    }
}

async function readFromServer() {
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                log('Stream cerrado por el servidor', 'info');
                break;
            }
            const message = new TextDecoder().decode(value);
            log(`Recibido del servidor: ${message}`, 'success');
        }
    } catch (error) {
        log(`Error al leer del servidor: ${error.message}`, 'error');
    }
}

async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) {
        log('Por favor escribe un mensaje', 'error');
        return;
    }

    try {
        const encoder = new TextEncoder();
        await writer.write(encoder.encode(message));
        log(`Enviado: ${message}`, 'info');
        messageInput.value = '';
    } catch (error) {
        log(`Error al enviar mensaje: ${error.message}`, 'error');
    }
}

async function disconnect() {
    try {
        if (writer) {
            await writer.close();
        }
        if (transport) {
            transport.close();
        }
        
        log('Desconectado del servidor', 'info');
        updateStatus('Desconectado', 'disconnected');
        
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        sendBtn.disabled = true;
        messageInput.disabled = true;
        
        transport = null;
        writer = null;
        reader = null;
    } catch (error) {
        log(`Error al desconectar: ${error.message}`, 'error');
    }
}

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !sendBtn.disabled) {
        sendMessage();
    }
});
