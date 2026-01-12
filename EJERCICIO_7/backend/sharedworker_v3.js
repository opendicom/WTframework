// sharedworker_v3.js
// NOTE: WebTransport REQUIRES HTTPS + HTTP/3 (http.server is DB-only)

let transport = null;
let transportReady = null;
let ports = new Set();

let db = null;
let dbReadyPromise = null;

const seeds = [
  { titulo: "bedrock nights", autor: "Freddie", isbn: 123456 },
  { titulo: "water buffaloes", autor: "Fred", isbn: 234567 },
  { titulo: "neo pull", autor: "Barney", isbn: 345678 }
];


// ===============================
// WebTransport setup
// ===============================

async function ensureTransport() {
  if (transport) return transport;
  if (transportReady) return transportReady;

  transportReady = (async () => {
    transport = new WebTransport("https://localhost:4433");

    await transport.ready;
    console.log("WORKER: WebTransport connected");

    receiveDatagrams(transport);
    return transport;
  })();

  return transportReady;
}

async function receiveDatagrams(transport) {
  const reader = transport.datagrams.readable.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    // Broadcast to all connected tabs
    for (const port of ports) {
      port.postMessage({
        domain: "net",
        type: "datagram",
        payload: value
      });
    }
  }
}


// ===============================
// IndexedDB
// ===============================

function ensureDB() {
  if (db) return Promise.resolve(db);
  if (dbReadyPromise) return dbReadyPromise;

  dbReadyPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("library", 3);

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      const store = dbInstance.createObjectStore("books", { keyPath: "isbn" });
      store.createIndex("por_titulo", "titulo", { unique: false });
      store.createIndex("por_autor", "autor", { unique: false });

      for (const seed of seeds) store.put(seed);
    };

    request.onsuccess = (e) => {
      db = e.target.result;

      const tx = db.transaction("books", "readonly");
      const store = tx.objectStore("books");
      const countReq = store.count();

      countReq.onsuccess = () => {
        if (countReq.result === 0) {
          const tx2 = db.transaction("books", "readwrite");
          const store2 = tx2.objectStore("books");
          for (const seed of seeds) store2.put(seed);
        }
        resolve(db);
      };

      countReq.onerror = reject;

      db.onversionchange = () => {
        db.close();
        db = null;
        dbReadyPromise = null;
      };
    };

    request.onerror = reject;
  });

  return dbReadyPromise;
}


// ===============================
// SharedWorker entry point
// ===============================

self.onconnect = function (e) {
  const port = e.ports[0];
  port.start();
  ports.add(port);

  port.onclose = () => ports.delete(port);

  port.onmessage = async function (event) {
    const message = event.data;

    // ===============================
    // NETWORK DOMAIN (NEW)
    // ===============================
    if (message?.domain === "net") {
      const t = await ensureTransport();

      if (message.type === "send") {
        const writer = t.datagrams.writable.getWriter();
        await writer.write(message.payload);
        writer.releaseLock();
      }
      return;
    }

    // ===============================
    // DATABASE DOMAIN (EXISTING)
    // ===============================

    if (message?.action === "getBook") {
      const titulo = message.payload?.titulo;
      if (!titulo) {
        port.postMessage({ error: "No titulo provided" });
        return;
      }

      const dbInst = await ensureDB();
      const tx = dbInst.transaction("books", "readonly");
      const store = tx.objectStore("books");
      const idx = store.index("por_titulo");
      const req = idx.get(titulo);

        req.onsuccess = () => {
        if (req.result) {
            port.postMessage({
            type: "searchResult",
            data: `${req.result.titulo} — ${req.result.autor} (ISBN ${req.result.isbn})`
            });
        } else {
            port.postMessage({
            type: "searchResult",
            data: "Libro no encontrado"
            });
        }
        };

        req.onerror = () => {
        port.postMessage({ error: "DB error" });
        };

      return;
    }

    else if (message?.action === "addBook") {
      const book = message.payload;
      if (!book?.titulo || !book?.autor || !book?.isbn) {
        port.postMessage({ error: "Missing book fields" });
        return;
      }

      book.titulo = book.titulo.trim().toLowerCase();

      const dbInst = await ensureDB();
      const tx = dbInst.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      const req = store.put(book);

      req.onsuccess = () => {
        port.postMessage({
            type: "addResult",
            data: `Libro añadido: ${book.titulo}`
        });
        };

        req.onerror = () => {
        port.postMessage({ error: "Failed to add book" });
        };

      return;
    }

    port.postMessage("pong from worker");
  };
};
