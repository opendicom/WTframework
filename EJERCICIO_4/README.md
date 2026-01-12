# EJERCICIO 4 - Sistema de Caché Distribuido con WebTransport

## 🎯 Descripción

Sistema completo que integra **SharedWorker**, **IndexedDB** y **WebTransport (HTTP/3)** para implementar un sistema de caché distribuido con comunicación duplex en tiempo real.

## 🏗️ Arquitectura

### **Frontend (JavaScript)**
- `index.html` - Interfaz de usuario con logs en tiempo real
- `client.js` - Cliente que se comunica con el SharedWorker
- `shared-worker.js` - Worker compartido que gestiona IndexedDB y comunicación
- `stream-manager.js` - Gestor de streams duplex HTTP/3 (WebTransport)

### **Backend (Rust)**
- Servidor WebTransport en puerto 4433
- Base de datos en memoria (HashMap) con metadata de ejemplo
- Comunicación bidireccional sobre HTTP/3/QUIC

## 📋 Flujo de Trabajo

```
1. Cliente solicita metadata (ej: "user:123")
           ↓
2. SharedWorker busca en IndexedDB
           ├─ ✅ ENCONTRADO → Devuelve desde caché
           └─ ❌ NO ENCONTRADO
                     ↓
3. StreamManager consulta al servidor vía WebTransport
                     ↓
4. Servidor busca en HashMap y responde
                     ↓
5. SharedWorker guarda en IndexedDB (caché)
                     ↓
6. Cliente recibe el resultado
```

## 🚀 Instalación y Uso

### **Paso 1: Backend**

#### Opción A: Con certificados existentes

Si ya tienes `cert.pem` y `key.pem`:

```powershell
cd EJERCICIO_4\backend
cargo run
```

#### Opción B: Generar certificados nuevos

Necesitas OpenSSL instalado:

```powershell
# Generar clave privada
openssl genrsa -out key.pem 2048

# Generar certificado autofirmado
openssl req -new -x509 -key key.pem -out cert.pem -days 365 -subj "/CN=localhost"

# Ejecutar servidor
cargo run
```

**Salida esperada:**
```
🚀 Servidor de Metadata WebTransport listo en puerto 4433
📦 Base de datos inicializada con 5 registros
```

### **Paso 2: Frontend**

Abre una nueva terminal:

```powershell
cd EJERCICIO_4\frontend
python -m http.server 8000
```

O usa cualquier servidor HTTP:

```powershell
# PowerShell (requiere instalar http-server globalmente)
npx http-server -p 8000

# O simplemente abre index.html en Chrome/Edge
start index.html
```

### **Paso 3: Usar la Aplicación**

1. Abre tu navegador en `http://localhost:8000`
2. Haz clic en **"Conectar"**
3. Prueba buscando estas claves:

## Claves de Ejemplo

Prueba buscando estas claves:

- `user:123` - Usuario Juan Pérez
- `user:456` - Usuario María García
- `product:789` - Laptop Dell XPS 13
- `product:101` - Mouse Logitech
- `config:app` - Configuración de la aplicación

## Características

✅ **Caché distribuido** con IndexedDB
✅ **SharedWorker** para compartir conexión entre pestañas
✅ **HTTP/3 (WebTransport)** para comunicación de baja latencia
✅ **Streams bidireccionales** para comunicación eficiente
✅ **Fallback automático** de caché a servidor
✅ **Interfaz visual** con logs en tiempo real

## Tecnologías

- JavaScript (ES6+)
- WebTransport API
- SharedWorker API
- IndexedDB API
- Rust (wtransport crate)
- Tokio async runtime
