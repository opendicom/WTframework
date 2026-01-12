// SharedWorker - Gestiona múltiples clientes, IndexedDB y conexión al servidor
const DB_NAME = 'MetadataCache';
const DB_VERSION = 1;
const STORE_NAME = 'metadata';

// Estado global del SharedWorker
let db = null;
let serverConnection = null;
let clients = new Map();

// Importar gestor de stream HTTP/3
importScripts('stream-manager.js');

// Listener para nuevas conexiones de clientes
self.onconnect = function(e) {
    const port = e.ports[0];
    
    port.onmessage = function(event) {
        handleClientMessage(port, event.data);
    };
    
    port.start();
};

// Manejar mensajes de los clientes
async function handleClientMessage(port, message) {
    const { type, clientId, key } = message;
    
    switch (type) {
        case 'INIT':
            await initClient(port, clientId);
            break;
            
        case 'SEARCH':
            await searchMetadata(port, key);
            break;
            
        case 'CLEAR_CACHE':
            await clearCache(port);
            break;
            
        case 'DISCONNECT':
            disconnectClient(port, clientId);
            break;
            
        default:
            console.log('Mensaje desconocido:', type);
    }
}

// Inicializar cliente
async function initClient(port, clientId) {
    try {
        // Registrar cliente
        clients.set(clientId, port);
        
        // Inicializar IndexedDB si no está listo
        if (!db) {
            await initIndexedDB();
        }
        
        // Inicializar conexión al servidor si no existe
        if (!serverConnection) {
            await initServerConnection();
        }
        
        // Notificar al cliente que está listo
        port.postMessage({
            type: 'INIT_SUCCESS',
            data: { clientId }
        });
        
        console.log(`Cliente ${clientId} conectado`);
        
    } catch (error) {
        port.postMessage({
            type: 'ERROR',
            error: error.message
        });
    }
}

// Inicializar IndexedDB
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            reject(new Error('Error al abrir IndexedDB'));
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB inicializado correctamente');
            
            // Pre-cargar datos de ejemplo en IndexedDB
            preloadSampleData();
            
            // Notificar a todos los clientes
            broadcastToClients({
                type: 'DB_READY'
            });
            
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Crear object store si no existe
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                console.log('Object store creado');
            }
        };
    });
}

// Pre-cargar datos de ejemplo en IndexedDB
async function preloadSampleData() {
    try {
        // Verificar si ya hay datos
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(STORE_NAME);
        const countRequest = objectStore.count();
        
        countRequest.onsuccess = async () => {
            // Solo pre-cargar si la base está vacía
            if (countRequest.result === 0) {
                console.log('Pre-cargando datos de ejemplo en IndexedDB...');
                
                const sampleData = [
                    {
                        key: 'product:789',
                        value: {
                            id: 789,
                            name: 'Laptop Dell XPS 13',
                            price: 1299.99,
                            stock: 15
                        },
                        timestamp: Date.now()
                    },
                    {
                        key: 'config:app',
                        value: {
                            theme: 'dark',
                            language: 'es',
                            notifications: true
                        },
                        timestamp: Date.now()
                    }
                ];
                
                const writeTransaction = db.transaction([STORE_NAME], 'readwrite');
                const writeStore = writeTransaction.objectStore(STORE_NAME);
                
                for (const item of sampleData) {
                    writeStore.add(item);
                }
                
                writeTransaction.oncomplete = () => {
                    console.log(`✅ ${sampleData.length} registros pre-cargados en IndexedDB`);
                    broadcastToClients({
                        type: 'PRELOAD_COMPLETE',
                        count: sampleData.length
                    });
                };
            } else {
                console.log(`IndexedDB ya contiene ${countRequest.result} registros`);
            }
        };
    } catch (error) {
        console.error('Error al pre-cargar datos:', error);
    }
}

// Inicializar conexión al servidor
async function initServerConnection() {
    try {
        serverConnection = new StreamManager('https://localhost:4433');
        await serverConnection.connect();
        
        console.log('Conectado al servidor HTTP/3');
        
        broadcastToClients({
            type: 'SERVER_CONNECTED'
        });
        
    } catch (error) {
        console.error('Error al conectar con el servidor:', error);
        
        broadcastToClients({
            type: 'ERROR',
            error: 'No se pudo conectar al servidor HTTP/3'
        });
    }
}

// Buscar metadata (primero en caché, luego en servidor)
async function searchMetadata(port, key) {
    try {
        console.log(`Buscando: ${key}`);
        
        // 1. Buscar en IndexedDB (caché)
        const cachedData = await getFromCache(key);
        
        if (cachedData) {
            console.log(`✓ Encontrado en caché: ${key}`);
            port.postMessage({
                type: 'SEARCH_RESULT',
                data: cachedData.value,
                source: 'cache'
            });
            return;
        }
        
        console.log(`✗ No encontrado en caché, consultando servidor: ${key}`);
        
        // 2. Si no está en caché, buscar en el servidor
        if (!serverConnection || !serverConnection.isConnected()) {
            await initServerConnection();
        }
        
        const serverData = await serverConnection.query(key);
        
        if (serverData) {
            console.log(`✓ Encontrado en servidor: ${key}`);
            
            // Guardar en caché para futuras consultas
            await saveToCache(key, serverData);
            
            port.postMessage({
                type: 'SEARCH_RESULT',
                data: serverData,
                source: 'server'
            });
        } else {
            console.log(`✗ No encontrado en servidor: ${key}`);
            port.postMessage({
                type: 'SEARCH_RESULT',
                data: null,
                source: null
            });
        }
        
    } catch (error) {
        console.error('Error en búsqueda:', error);
        port.postMessage({
            type: 'ERROR',
            error: error.message
        });
    }
}

// Obtener datos de IndexedDB
function getFromCache(key) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve(null);
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const objectStore = transaction.objectStore(STORE_NAME);
        const request = objectStore.get(key);
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onerror = () => {
            reject(new Error('Error al leer de IndexedDB'));
        };
    });
}

// Guardar datos en IndexedDB
function saveToCache(key, value) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('IndexedDB no inicializado'));
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(STORE_NAME);
        
        const data = {
            key: key,
            value: value,
            timestamp: Date.now()
        };
        
        const request = objectStore.put(data);
        
        request.onsuccess = () => {
            console.log(`Guardado en caché: ${key}`);
            resolve();
        };
        
        request.onerror = () => {
            reject(new Error('Error al guardar en IndexedDB'));
        };
    });
}

// Limpiar caché
function clearCache(port) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('IndexedDB no inicializado'));
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const objectStore = transaction.objectStore(STORE_NAME);
        const request = objectStore.clear();
        
        request.onsuccess = () => {
            console.log('Caché limpiado');
            port.postMessage({
                type: 'CACHE_CLEARED'
            });
            resolve();
        };
        
        request.onerror = () => {
            reject(new Error('Error al limpiar caché'));
        };
    });
}

// Desconectar cliente
function disconnectClient(port, clientId) {
    clients.delete(clientId);
    console.log(`Cliente ${clientId} desconectado`);
    
    // Si no quedan clientes, cerrar conexión al servidor
    if (clients.size === 0 && serverConnection) {
        serverConnection.disconnect();
        serverConnection = null;
        console.log('Conexión al servidor cerrada (no hay clientes)');
    }
}

// Enviar mensaje a todos los clientes conectados
function broadcastToClients(message) {
    clients.forEach((port) => {
        port.postMessage(message);
    });
}
