// API ENDPOINTS:
// GET /transport/status returns server state
// GET /transport/stats returns channel & datagram counts
// POST /echo <payload> returns echoed payload

use anyhow::Result;
use std::time::Duration;
use tracing::{error, info, info_span};
use tracing::Instrument;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::EnvFilter;
use wtransport::endpoint::IncomingSession;
use wtransport::{Endpoint, Identity, ServerConfig};

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering}
};

struct ChannelStats {
    bi_streams: AtomicUsize,
    uni_streams: AtomicUsize,
    datagrams: AtomicUsize,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_logging();

    let config = ServerConfig::builder()
        .with_bind_default(4433)
        .with_identity(Identity::self_signed(["localhost"]).unwrap())
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();

    let server = Endpoint::server(config)?;

    info!("Server ready on port 4433!");
    info!("Certificate fingerprint: use .with_no_cert_validation() on client for testing");

    for id in 0.. {
        let incoming_session = server.accept().await;
        tokio::spawn(handle_connection(incoming_session).instrument(info_span!("Connection", id)));
    }

    Ok(())
}

async fn handle_connection(incoming_session: IncomingSession) {
    let result = handle_connection_impl(incoming_session).await;
    if let Err(e) = result {
        error!("Connection error: {:?}", e);
    }
}

async fn handle_connection_impl(incoming_session: IncomingSession) -> Result<()> {
    let stats = Arc::new(ChannelStats {
        bi_streams: AtomicUsize::new(0),
        uni_streams: AtomicUsize::new(0),
        datagrams: AtomicUsize::new(0),
    });

    let mut buffer = vec![0; 65536].into_boxed_slice();

    info!("Waiting for session request...");

    let session_request = incoming_session.await?;

    info!(
        "New session: Authority: '{}', Path: '{}'",
        session_request.authority(),
        session_request.path()
    );

    let connection = session_request.accept().await?;

    info!("Waiting for data from client...");

    loop {
        tokio::select! {
            stream = connection.accept_bi() => {
                stats.bi_streams.fetch_add(1, Ordering::Relaxed);
                let mut stream = stream?;
                info!("Accepted BI stream");

                let Some(bytes_read) = stream.1.read(&mut buffer).await? else {
                    continue;
                };

                let msg = std::str::from_utf8(&buffer[..bytes_read])?.trim();

                info!("Received (bi) '{}' from client", msg);

                let response = handle_api_request(msg);
                stream.0.write_all(response.as_bytes()).await?;
            }
            stream = connection.accept_uni() => {
                stats.uni_streams.fetch_add(1, Ordering::Relaxed);
                let mut stream = stream?;
                info!("Accepted UNI stream");

                let Some(bytes_read) = stream.read(&mut buffer).await? else {
                    continue;
                };

                let msg = std::str::from_utf8(&buffer[..bytes_read])?;

                info!("Received (uni) '{}' from client", msg);

                let mut stream = connection.open_uni().await?.await?;
                stream.write_all(b"ACK from server").await?;
            }
            dgram = connection.receive_datagram() => {
                stats.datagrams.fetch_add(1, Ordering::Relaxed);
                let dgram = dgram?;
                let msg = std::str::from_utf8(&dgram)?;

                info!("Received (dgram) '{}' from client", msg);

                connection.send_datagram(b"ACK datagram")?;
            }
        }
    }
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

fn handle_api_request(input: &str, stats: &ChannelStats) -> String {
    match input {
        "GET /transport/stats" => {
            format!(
                r#"{{"bi_streams":{},"uni_streams":{},"datagrams":{}}}"#,
                stats.bi_streams.load(Ordering::Relaxed),
                stats.uni_streams.load(Ordering::Relaxed),
                stats.datagrams.load(Ordering::Relaxed),
            )
        }
        _ => r#"{"error":"unknown endpoint"}"#.to_string(),
    }
}
