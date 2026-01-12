// se inicia la variable fileHandle, que representa el archivo en el sistema del navegador
let fileHandle = null;

// lista base de libros que se usarán para inicializar el archivo
const seeds = [
  { titulo: "bedrock nights", autor: "Freddie", isbn: 123456 },
  { titulo: "water buffaloes", autor: "Fred", isbn: 234567 },
  { titulo: "neo pull", autor: "Barney", isbn: 345678 }
];

// funcion para inicializar el archivo si no existe
async function initFile() {
  if (fileHandle) return;

  // se le pide al usuario elegir o crear el archivo
  fileHandle = await self.showSaveFilePicker({
    suggestedName: "library.json",
    types: [{
      description: "JSON",
      accept: { "application/json": [".json"] }
    }]
  });

  // se lee el contenido actual del archivo
  const file = await fileHandle.getFile();
  const text = await file.text();

  // si el archivo esta vacio, se escriben los libros base
  if (!text) {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(seeds, null, 2));
    await writable.close();
  }
}

// funcion para leer todos los libros del archivo
async function readBooks() {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

// funcion para escribir la lista completa de libros al archivo
async function writeBooks(books) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(books, null, 2));
  await writable.close();
}

// esta funcion se ejecuta cuando un tab u otro script se conecta al shared worker
self.onconnect = function (e) {
  const port = e.ports[0];
  port.start();

  port.onmessage = async (event) => {
    const msg = event.data;

    // asegura que el archivo este listo antes de continuar
    await initFile();

    // buscar libros por titulo
    if (msg.action === "getBook") {
      const titulo = msg.payload?.titulo?.toLowerCase() || "";
      const books = await readBooks();

      const results = books.filter(b =>
        b.titulo.toLowerCase().includes(titulo)
      );

      port.postMessage(results);
      return;
    }

    // agregar un libro nuevo
    if (msg.action === "addBook") {
      const books = await readBooks();
      books.push(msg.payload);
      await writeBooks(books);
      port.postMessage({ status: "added" });
      return;
    }

    // resetear archivo
    if (msg.action === "resetDB") {
      await writeBooks(seeds);
      port.postMessage({ status: "reset-complete" });
      return;
    }

    port.postMessage("pong");
  };
};
