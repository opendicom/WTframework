// StreamManager - Gestiona la conexión WebTransport (HTTP/3) con el servidor
class StreamManager {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.transport = null;
        this.writer = null;
        this.reader = null;
        this.connected = false;
        this.pendingRequests = new Map();
        this.requestId = 0;
        
        // Hash del certificado del servidor (debe coincidir con el generado)
        this.serverCertificateHashes = [{
            algorithm: "sha-256",
            value: new Uint8Array([149, 139, 192, 125, 80, 31, 52, 31, 51, 116, 109, 223, 113, 90, 81, 49, 183, 210, 209, 140, 154, 216, 16, 211, 200, 79, 149, 253, 46, 241, 95, 232])
        }];
    }
    
    // Conectar al servidor WebTransport
    async connect() {
        try {
            console.log(`Conectando a ${this.serverUrl}...`);
            
            // Crear conexión WebTransport
            this.transport = new WebTransport(this.serverUrl, {
                serverCertificateHashes: this.serverCertificateHashes
            });
            
            // Esperar a que la conexión esté lista
            await this.transport.ready;
            
            console.log('✓ Conexión WebTransport establecida');
            
            // Crear stream bidireccional
            const stream = await this.transport.createBidirectionalStream();
            this.writer = stream.writable.getWriter();
            this.reader = stream.readable.getReader();
            
            this.connected = true;
            
            // Iniciar lectura de respuestas del servidor
            this.startReading();
            
            return true;
            
        } catch (error) {
            console.error('Error al conectar con WebTransport:', error);
            this.connected = false;
            throw error;
        }
    }
    
    // Leer respuestas del servidor
    async startReading() {
        try {
            while (this.connected) {
                const { value, done } = await this.reader.read();
                
                if (done) {
                    console.log('Stream cerrado por el servidor');
                    this.connected = false;
                    break;
                }
                
                // Decodificar mensaje
                const message = new TextDecoder().decode(value);
                this.handleServerResponse(message);
            }
        } catch (error) {
            console.error('Error al leer del servidor:', error);
            this.connected = false;
        }
    }
    
    // Manejar respuesta del servidor
    handleServerResponse(message) {
        try {
            const response = JSON.parse(message);
            const { requestId, data, found } = response;
            
            // Resolver la promesa pendiente
            const pendingRequest = this.pendingRequests.get(requestId);
            
            if (pendingRequest) {
                if (found) {
                    pendingRequest.resolve(data);
                } else {
                    pendingRequest.resolve(null);
                }
                
                this.pendingRequests.delete(requestId);
            }
            
        } catch (error) {
            console.error('Error al procesar respuesta del servidor:', error);
        }
    }
    
    // Consultar metadata al servidor
    async query(key) {
        if (!this.connected) {
            throw new Error('No hay conexión con el servidor');
        }
        
        return new Promise(async (resolve, reject) => {
            try {
                // Generar ID único para la petición
                const requestId = ++this.requestId;
                
                // Crear mensaje de consulta
                const queryMessage = JSON.stringify({
                    type: 'QUERY',
                    requestId: requestId,
                    key: key
                });
                
                // Guardar promesa pendiente
                this.pendingRequests.set(requestId, { resolve, reject });
                
                // Enviar al servidor
                const encoder = new TextEncoder();
                await this.writer.write(encoder.encode(queryMessage));
                
                console.log(`Consulta enviada: ${key} (ID: ${requestId})`);
                
                // Timeout de 5 segundos
                setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.pendingRequests.delete(requestId);
                        reject(new Error('Timeout: el servidor no respondió'));
                    }
                }, 5000);
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Verificar si está conectado
    isConnected() {
        return this.connected;
    }
    
    // Desconectar
    async disconnect() {
        try {
            this.connected = false;
            
            if (this.writer) {
                await this.writer.close();
                this.writer = null;
            }
            
            if (this.transport) {
                this.transport.close();
                this.transport = null;
            }
            
            this.reader = null;
            
            // Rechazar todas las peticiones pendientes
            this.pendingRequests.forEach((request) => {
                request.reject(new Error('Conexión cerrada'));
            });
            this.pendingRequests.clear();
            
            console.log('Desconectado del servidor');
            
        } catch (error) {
            console.error('Error al desconectar:', error);
        }
    }
}

// Exportar para uso en SharedWorker
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StreamManager;
}
