//sharedworker_v3.js
//py -m http.server 5500
let db = null;
let dbReadyPromise = null;

const seeds = [
  { titulo: "bedrock nights", autor: "Freddie", isbn: 123456 },
  { titulo: "water buffaloes", autor: "Fred", isbn: 234567 },
  { titulo: "neo pull", autor: "Barney", isbn: 345678 }
];

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

      // ✅ If store exists but is empty, reseed
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
        console.warn("WORKER: Version change detected — closing DB");
        db.close();
        db = null;
        dbReadyPromise = null;
      };

    };

    request.onerror = (e) => {
      console.error("WORKER: IndexedDB failed", e);
      reject(e);
    };
  });

  return dbReadyPromise;
}

self.onconnect = function (e) {
  console.log("WORKER: onconnect fired");
  const port = e.ports[0];
  port.start();

  port.onmessage = async function (event) {
    console.log("WORKER: inside port.onmessage handler");
    const message = event.data;

    // ✅ getBook
    if (message && message.action === "getBook") {
      console.log("WORKER: >>> getBook branch HIT");

      const titulo = message.payload?.titulo;
      if (!titulo) {
        port.postMessage({ error: "No titulo provided" });
        return;
      }

      let dbInst;
      try {
        dbInst = await ensureDB();
      } catch (err) {
        console.error("WORKER: DB init failed", err);
        port.postMessage({ error: "DB init failed" });
        return;
      }

      try {
        const tx = dbInst.transaction("books", "readonly");
        const store = tx.objectStore("books");
        const idx = store.index("por_titulo");
        const req = idx.get(titulo);

        req.onsuccess = () => {
          port.postMessage(req.result || { error: "Not found" });
        };

        req.onerror = () => {
          port.postMessage({ error: "DB error" });
        };
      } catch (ex) {
        console.error("WORKER: transaction failed", ex);
        port.postMessage({ error: "DB transaction failed" });
      }

      return;
    }

    // ✅ addBook
    else if (message && message.action === "addBook") {
      console.log("WORKER: >>> addBook branch HIT");

      const book = message.payload;
      if (!book || !book.titulo || !book.autor || !book.isbn) {
        port.postMessage({ error: "Missing book fields" });
        return;
      }

      book.titulo = book.titulo.trim().toLowerCase();

      let dbInst;
      try {
        dbInst = await ensureDB();
      } catch (err) {
        console.error("WORKER: DB init failed", err);
        port.postMessage({ error: "DB init failed" });
        return;
      }

      const tx = dbInst.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      const req = store.put(book);

      req.onsuccess = () => {
        console.log("WORKER: Book added:", book);
        port.postMessage({ success: true, book });
      };

      req.onerror = () => {
        port.postMessage({ error: "Failed to add book" });
      };

      return;
    }

    // ✅ Unknown action → pong
    else {
      console.log("WORKER: >>> unknown action, replying pong");
      port.postMessage("pong from worker");
    }
  };
};