use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tracing::{error, info};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::EnvFilter;
use wtransport::endpoint::IncomingSession;
use wtransport::{Endpoint, Identity, ServerConfig};

// Base de datos en memoria para metadata
type MetadataDB = Arc<Mutex<HashMap<String, serde_json::Value>>>;

#[derive(Serialize, Deserialize, Debug)]
struct QueryRequest {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(rename = "requestId")]
    request_id: u64,
    key: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct QueryResponse {
    #[serde(rename = "requestId")]
    request_id: u64,
    found: bool,
    data: Option<serde_json::Value>,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_logging();

    // Inicializar base de datos de ejemplo
    let db = init_database();

    // Cargar certificado y clave privada desde archivos
    let identity = Identity::load_pemfiles("cert.pem", "key.pem").await?;

    let config = ServerConfig::builder()
        .with_bind_default(4433)
        .with_identity(identity)
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();

    let server = Endpoint::server(config)?;

    info!("🚀 Servidor de Metadata WebTransport listo en puerto 4433");
    info!("📦 Base de datos inicializada con {} registros", db.lock().unwrap().len());

    for id in 0.. {
        let incoming_session = server.accept().await;
        let db_clone = Arc::clone(&db);
        tokio::spawn(async move {
            if let Err(e) = handle_connection(incoming_session, db_clone).await {
                error!("Error en conexión {}: {:?}", id, e);
            }
        });
    }

    Ok(())
}

async fn handle_connection(incoming_session: IncomingSession, db: MetadataDB) -> Result<()> {
    info!("📥 Nueva conexión entrante");

    let session_request = incoming_session.await?;

    info!(
        "✓ Sesión establecida - Authority: '{}', Path: '{}'",
        session_request.authority(),
        session_request.path()
    );

    let connection = session_request.accept().await?;

    info!("⏳ Esperando streams...");

    loop {
        tokio::select! {
            stream = connection.accept_bi() => {
                let mut stream = stream?;
                let db_clone = Arc::clone(&db);
                
                info!("🔗 Stream bidireccional aceptado");

                // Spawn una tarea para manejar el stream de forma continua
                tokio::spawn(async move {
                    let mut buffer = vec![0; 65536];
                    loop {
                        match stream.1.read(&mut buffer).await {
                            Ok(Some(bytes_read)) => {
                                let msg = &buffer[..bytes_read];
                                
                                // Procesar consulta
                                if let Ok(query) = serde_json::from_slice::<QueryRequest>(msg) {
                                    info!("🔍 Consulta recibida: key='{}', requestId={}", query.key, query.request_id);
                                    
                                    // Buscar en la base de datos (scope explícito para liberar el lock)
                                    let result = {
                                        let db_lock = db_clone.lock().unwrap();
                                        db_lock.get(&query.key).cloned()
                                    }; // db_lock se libera aquí automáticamente
                                    
                                    let response = if let Some(data) = result {
                                        info!("✅ Encontrado: {}", query.key);
                                        QueryResponse {
                                            request_id: query.request_id,
                                            found: true,
                                            data: Some(data),
                                        }
                                    } else {
                                        info!("❌ No encontrado: {}", query.key);
                                        QueryResponse {
                                            request_id: query.request_id,
                                            found: false,
                                            data: None,
                                        }
                                    };
                                    
                                    // Enviar respuesta
                                    if let Ok(response_json) = serde_json::to_string(&response) {
                                        if let Err(e) = stream.0.write_all(response_json.as_bytes()).await {
                                            error!("Error al enviar respuesta: {}", e);
                                            break;
                                        }
                                    }
                                } else {
                                    error!("Mensaje inválido recibido");
                                }
                            }
                            Ok(None) => {
                                info!("🔌 Stream cerrado por el cliente");
                                break;
                            }
                            Err(e) => {
                                error!("Error al leer del stream: {}", e);
                                break;
                            }
                        }
                    }
                });
            }
        }
    }
}

// Inicializar base de datos con datos de ejemplo
fn init_database() -> MetadataDB {
    let mut db = HashMap::new();

    // Usuarios
    db.insert(
        "user:123".to_string(),
        serde_json::json!({
            "id": 123,
            "name": "Juan Pérez",
            "email": "juan@example.com",
            "role": "admin"
        }),
    );

    db.insert(
        "user:456".to_string(),
        serde_json::json!({
            "id": 456,
            "name": "María García",
            "email": "maria@example.com",
            "role": "user"
        }),
    );

    // Productos
    db.insert(
        "product:789".to_string(),
        serde_json::json!({
            "id": 789,
            "name": "Laptop Dell XPS 13",
            "price": 1299.99,
            "stock": 15
        }),
    );

    db.insert(
        "product:101".to_string(),
        serde_json::json!({
            "id": 101,
            "name": "Mouse Logitech MX Master 3",
            "price": 99.99,
            "stock": 50
        }),
    );

    // Configuraciones
    db.insert(
        "config:app".to_string(),
        serde_json::json!({
            "theme": "dark",
            "language": "es",
            "notifications": true
        }),
    );

    Arc::new(Mutex::new(db))
}

fn init_logging() {
    let env_filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env_lossy();

    tracing_subscriber::fmt()
        .with_target(true)
        .with_level(true)
        .with_env_filter(env_filter)
        .init();
}
