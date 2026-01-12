// Estado del cliente
let worker = null;
let isConnected = false;

// Referencias a elementos del DOM
const workerStatus = document.getElementById('workerStatus');
const serverStatus = document.getElementById('serverStatus');
const dbStatus = document.getElementById('dbStatus');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultContent = document.getElementById('resultContent');
const sourceBadge = document.getElementById('sourceBadge');
const logContainer = document.getElementById('logContainer');

// Función para agregar logs
function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
    
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Actualizar estado del Worker
function updateWorkerStatus(status, className) {
    workerStatus.textContent = status;
    workerStatus.className = `value ${className}`;
}

// Actualizar estado del servidor
function updateServerStatus(status, className) {
    serverStatus.textContent = status;
    serverStatus.className = `value ${className}`;
}

// Actualizar estado de la DB
function updateDBStatus(status, className) {
    dbStatus.textContent = status;
    dbStatus.className = `value ${className}`;
}

// Conectar al SharedWorker
function connectToWorker() {
    try {
        log('Iniciando conexión con SharedWorker...', 'info');
        
        // Crear conexión al SharedWorker
        worker = new SharedWorker('shared-worker.js');
        
        // Configurar listener para mensajes del worker
        worker.port.onmessage = handleWorkerMessage;
        
        // Iniciar conexión
        worker.port.start();
        
        // Enviar mensaje de inicialización
        worker.port.postMessage({
            type: 'INIT',
            clientId: generateClientId()
        });
        
        updateWorkerStatus('Conectando...', 'warning');
        
    } catch (error) {
        log(`❌ Error al conectar con SharedWorker: ${error.message}`, 'error');
        updateWorkerStatus('Error', 'disconnected');
    }
}

// Manejar mensajes del SharedWorker
function handleWorkerMessage(event) {
    const { type, data, source, error } = event.data;
    
    switch (type) {
        case 'INIT_SUCCESS':
            log('✅ Conexión establecida con SharedWorker', 'success');
            updateWorkerStatus('Conectado', 'connected');
            isConnected = true;
            enableUI();
            break;
            
        case 'DB_READY':
            log('✅ IndexedDB inicializado correctamente', 'success');
            updateDBStatus('Listo', 'connected');
            break;
            
        case 'PRELOAD_COMPLETE':
            log(`📦 ${data.count} productos pre-cargados en IndexedDB`, 'info');
            break;
            
        case 'SERVER_CONNECTED':
            log('✅ Conexión establecida con servidor HTTP/3', 'success');
            updateServerStatus('Conectado', 'connected');
            break;
            
        case 'SERVER_DISCONNECTED':
            log('⚠️ Desconectado del servidor HTTP/3', 'warning');
            updateServerStatus('Desconectado', 'disconnected');
            break;
            
        case 'SEARCH_RESULT':
            displayResult(data, source);
            break;
            
        case 'CACHE_CLEARED':
            log('🗑️ Caché limpiado exitosamente', 'success');
            clearResult();
            break;
            
        case 'ERROR':
            log(`❌ Error: ${error}`, 'error');
            break;
            
        default:
            log(`📨 Mensaje recibido: ${type}`, 'info');
    }
}

// Buscar metadata
function searchMetadata() {
    const key = searchInput.value.trim();
    
    if (!key) {
        log('⚠️ Por favor ingresa una clave de búsqueda', 'warning');
        return;
    }
    
    if (!isConnected) {
        log('❌ No hay conexión con el SharedWorker', 'error');
        return;
    }
    
    log(`🔍 Buscando: "${key}"`, 'info');
    
    // Mostrar loading
    resultContent.className = 'result-content empty';
    resultContent.textContent = 'Buscando...';
    sourceBadge.style.display = 'none';
    
    // Enviar solicitud al SharedWorker
    worker.port.postMessage({
        type: 'SEARCH',
        key: key
    });
}

// Mostrar resultado
function displayResult(data, source) {
    if (!data) {
        resultContent.className = 'result-content empty';
        resultContent.textContent = 'No se encontraron resultados';
        sourceBadge.style.display = 'none';
        log('❌ No se encontró la clave solicitada', 'warning');
        return;
    }
    
    resultContent.className = 'result-content';
    resultContent.textContent = JSON.stringify(data, null, 2);
    
    // Mostrar badge de origen
    sourceBadge.style.display = 'inline-block';
    if (source === 'cache') {
        sourceBadge.className = 'badge cache';
        sourceBadge.textContent = '📦 Desde IndexedDB';
        log('✅ Resultado obtenido desde IndexedDB (caché local)', 'success');
    } else {
        sourceBadge.className = 'badge server';
        sourceBadge.textContent = '🌐 Desde Servidor';
        log('✅ Resultado obtenido desde servidor HTTP/3', 'success');
    }
}

// Limpiar resultado
function clearResult() {
    resultContent.className = 'result-content empty';
    resultContent.textContent = 'Los resultados aparecerán aquí...';
    sourceBadge.style.display = 'none';
}

// Limpiar caché
function clearCache() {
    if (!isConnected) {
        log('❌ No hay conexión con el SharedWorker', 'error');
        return;
    }
    
    log('🗑️ Solicitando limpieza de caché...', 'info');
    
    worker.port.postMessage({
        type: 'CLEAR_CACHE'
    });
}

// Desconectar
function disconnect() {
    if (worker) {
        worker.port.postMessage({ type: 'DISCONNECT' });
        worker.port.close();
        worker = null;
    }
    
    isConnected = false;
    disableUI();
    
    updateWorkerStatus('Desconectado', 'disconnected');
    updateServerStatus('Desconectado', 'disconnected');
    updateDBStatus('No inicializado', 'disconnected');
    
    log('🔌 Desconectado del sistema', 'info');
    clearResult();
}

// Habilitar UI
function enableUI() {
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    clearCacheBtn.disabled = false;
    searchInput.disabled = false;
    searchBtn.disabled = false;
}

// Deshabilitar UI
function disableUI() {
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    clearCacheBtn.disabled = true;
    searchInput.disabled = true;
    searchBtn.disabled = true;
}

// Generar ID único para el cliente
function generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Permitir búsqueda con Enter
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !searchBtn.disabled) {
        searchMetadata();
    }
});

// Manejar cierre de ventana
window.addEventListener('beforeunload', () => {
    if (worker) {
        worker.port.postMessage({ type: 'DISCONNECT' });
    }
});
