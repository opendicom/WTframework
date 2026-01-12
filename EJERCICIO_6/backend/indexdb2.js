//se inician las variables db y dbReady, db es la instancia de la base de datos y dbReady indica si la base de datos está lista para usarse, empiezan sin datos.
let db = null;
let dbReady = false;
let dbReadyPromise = null;

//la lista de la lista base de libros que se usarán para inicializar la base de datos.
const seeds = [
  { titulo: "bedrock nights", autor: "Freddie", isbn: 123456 },
  { titulo: "water buffaloes", autor: "Fred", isbn: 234567 },
  { titulo: "neo pull", autor: "Barney", isbn: 345678 }
];

// funcion para inciar la base de datos, (linea 13-71)
function initDB() {
  return new Promise((resolve, reject) => {
    // funcion para inciar la base de datos version numero 3 (ya habia creado dos previamente).
    const request = indexedDB.open("library", 3);

    //"funcion" que hace que la base de datos necesita ser actualizada a la ultima version.
    request.onupgradeneeded = (event) => {
    const dbInstance = event.target.result;

      //si la libreria no contiene libros, se creara de nuevo los libros.
      if (!dbInstance.objectStoreNames.contains("books")) {
        //crea los libros, con la clave primaria isbn (es un codigo especifico para distinguir libros en las librerias).
        const store = dbInstance.createObjectStore("books", { keyPath: "isbn" });
        //crea dos index, uno por titulo y el otro por autor, para poder buscar libros por cualquiera de esos dos campos.
        store.createIndex("por_titulo", "titulo", { unique: false });
        store.createIndex("por_autor", "autor", { unique: false });

        //inserta los libros base, creados en la variable seeds (linea 6-10) con sus datos en el nuevo objeto de libros.
        seeds.forEach(s => store.put(s));
      }
    };

    //cuando la base de datos se abre correctamente esto se ejecuta, (linea 36-49).
    request.onsuccess = async (event) => {
      
      //asigna la instancia de la base de datos a event.target.result, event.target es el objecto IDBOpenDBRequest devuelto por indexedDB.open("library", 3) (linea 16), db es la variable que contiene la CONEXION a la instancia abierta de la base de datos.
      //
      //SIMPLIFICADO:
      //
      //event.target = objecto IDBOpenDBRequest devuelto por "indexedDB.open("library", 3)" en la linea 16
      //
      //event.target.result = instancia de la base de datos abierta.
      //
      //db = variable que contiene la conexion de la instancia de la base de datos abierta para que pueda ser utilizada por el resto del programa.
      //
      db = event.target.result;

      //esta "funcion" se ejecuta cuando hay un cambio de version en la base de datos, lo que indica que otra conexion ha solicitado una version mas alta de la base de datos, esta otra conexion puede ser otra tab, otro shardworker o otro script.
      db.onversionchange = () => {
        //se le advierte a la consola que se va a cerrar la base de datos para actualizar de version.
        console.warn("WORKER: Version change detected — closing DB");
        //cierra la CONEXION a la base de datos.
        db.close();
        //reseteas la variable db asi no se conecra accidentalmente a una base de datos cerrada.
        db = null;
        //como la base de datos ya no esta lista para usarse, se resetea la variable dbReadyPromise para que la proxima vez que corra la funcion ensuredb() (linea 105 - 100) se vuelva a iniciar la base de datos.
      };

      //corre la funcion seedIfMissing() (linea 73-90) que se encarga de insertar los libros base en la base de datos solo si no existen en la libreria.
      await seedIfMissing();
      //con la nueva version de la base de datos abierta y los libros base asegurados en la libreria, se marca la variable dbReady como true para indicar que la base de datos esta lista para usarse.
      dbReady = true;
      resolve();
    };

    //si falla indexedDB.open(), la promesa se rechaza y tira el error.
    request.onerror = (event) => reject(event);
  });
}

// esta es la funcion referenciada en el comentario en la linea 61, se encarga de insertar los libros base en la base de datos solo si no existen en la libreria.
function seedIfMissing() {
  //devuelve una nueva promesa que llama await seedIfMissing() en la linea 62.
  return new Promise((resolve, reject) => {
    //abre una transaccion de lectura y de escritura en el object store "books", es de escritura tambien ya que talvez debamos insertar seed.
    const tx = db.transaction("books", "readwrite");
    //la variable store es lo que se va a ultlizar para interactuar con el object store "books".
    const store = tx.objectStore("books");

    //por cada libro en seeds se añade 1 de valor a la variable pending.
    let pending = seeds.length;

    //se revisa si cada libro indivudual si existe en la base de datos.
    seeds.forEach(seed => {
      //lee el libro por su clave primaria isbn, si existe en la variable store entonces no se inserta, si no existe entonces se inserta.
      const check = store.get(seed.isbn);

      //si se ejecuto correctamante la linea de codigo anterior (linea 88) entonces corre este codigo.
      check.onsuccess = () => {
        //se verifica si check.result es falso, si es falso significa que el libro no existe en la base de datos, asi que se inserta el libro con store.put(seed), si no es falso, este libro ya existe en la libreria.
        if (!check.result) store.put(seed);
        //si el counter de libros pendientes llega a 0, termina la lista y por ende la promesa.
        if (--pending === 0) resolve();
      };

      //si hubo un error al intentar leer el libro por su isbn, se rechaza la promesa.
      check.onerror = reject;
    });
  });
}

// function que asegura que la base de datos este lista para usarse
async function ensureDB() {
  //si la base de datos ya esta lista, retorna inmediatamente.
  if (dbReady) return;

  //si la base de datos no esta lista, se inicia la base de datos.
  if (!dbReadyPromise) {
    dbReadyPromise = initDB();
  }

  //devuelve la promesa que se resuelve cuando la base de datos esta lista.
  return dbReadyPromise;
}

// esta "funcion" se ejecuta cuando un  tab o otro script se conecta al shared worker.
self.onconnect = function (e) {
  const port = e.ports[0];
  //crea el puerto de comunicacion entre el shared worker y el tab o script que se conecto.
  port.start();

  //cada vez que se mande un mensaje atravez de este puerto, se ejecutara esta funcion.
  port.onmessage = async (event) => {
    //se guardan los datos mandados por sharedworker en la variable msg.
    const msg = event.data;

    //asegura que la base de datos este lista para usarse antes de continuar.
    await ensureDB();

    //esta funcion solo se ejecuta si el mensaje recibido tiene la accion "getBook".
    if (msg.action === "getBook") {
      //pone el texto del titulo buscado en minusculas para hacer la busqueda case insensitive.
      const titulo = msg.payload?.titulo?.toLowerCase() || "";
      //crea una interaccion con la base de datos en modo solo lectura.
      const tx = db.transaction("books", "readonly");
      //obtiene el object store "books", donde deben de estar los libros.
      const store = tx.objectStore("books");
      //obtiene el indice por titulo para hacer la busqueda.
      const index = store.index("por_titulo");

      const results = [];
      //Abre un cursor para recorrer los libros uno por uno.
      index.openCursor().onsuccess = (e) => {
        //Obtiene el libro actual del cursor.
        const cursor = e.target.result;
        //Si ya no hay más libros, envía los resultados y termina, (linea 150 - 153).
        if (!cursor) {
          port.postMessage(results);
          return;
        }

        //Si el título del libro contiene lo buscado, lo agrega a la lista.
        if (cursor.value.titulo.toLowerCase().includes(titulo)) {
          results.push(cursor.value);
        }
        //Avanza al siguiente libro.
        cursor.continue();
      };
      //termina la funcion para que no continue con las demas acciones.
      return;
    }

    //codigo para resetear la base de datos si el mensaje recibido tiene la accion "resetDB" (puramente por si acaso).
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