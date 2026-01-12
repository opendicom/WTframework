let db = null;
let dbReady = false;
let dbReadyPromise = null;

const seeds = [
  { titulo: "bedrock nights", autor: "Freddie", isbn: 123456 },
  { titulo: "water buffaloes", autor: "Fred", isbn: 234567 },
  { titulo: "neo pull", autor: "Barney", isbn: 345678 }
];

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("library", 3);

    request.onupgradeneeded = (event) => {
    const dbInstance = event.target.result;

      if (!dbInstance.objectStoreNames.contains("books")) {
        const store = dbInstance.createObjectStore("books", { keyPath: "isbn" });
        store.createIndex("por_titulo", "titulo", { unique: false });
        store.createIndex("por_autor", "autor", { unique: false });

        seeds.forEach(s => store.put(s));
      }
    };

    request.onsuccess = async (event) => {
      db = event.target.result;

      db.onversionchange = () => {
        console.warn("WORKER: Version change detected — closing DB");
        db.close();
        db = null;
      };

      await seedIfMissing();
      dbReady = true;
      resolve();
    };

    request.onerror = (event) => reject(event);
  });
}

function seedIfMissing() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readwrite");
    const store = tx.objectStore("books");

    let pending = seeds.length;

    seeds.forEach(seed => {
      const check = store.get(seed.isbn);

      check.onsuccess = () => {
        if (!check.result) store.put(seed);
        if (--pending === 0) resolve();
      };

      check.onerror = reject;
    });
  });
}

async function ensureDB() {
  if (dbReady) return;

  if (!dbReadyPromise) {
    dbReadyPromise = initDB();
  }

  return dbReadyPromise;
}

self.onconnect = function (e) {
  const port = e.ports[0];
  port.start();

  port.onmessage = async (event) => {
    const msg = event.data;

    await ensureDB();

    if (msg.action === "getBook") {
      const titulo = msg.payload?.titulo?.toLowerCase() || "";
      const tx = db.transaction("books", "readonly");
      const store = tx.objectStore("books");
      const index = store.index("por_titulo");

      const results = [];
      index.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          port.postMessage(results);
          return;
        }

        if (cursor.value.titulo.toLowerCase().includes(titulo)) {
          results.push(cursor.value);
        }
        cursor.continue();
      };
      return;
    }

    if (msg.action === "resetDB") {
      db.close();
      const del = indexedDB.deleteDatabase("library");
      del.onsuccess = async () => {
        dbReady = false;
        await ensureDB();
        port.postMessage({ status: "reset-complete" });
      };
      return;
    }

    port.postMessage("pong");
  };
};