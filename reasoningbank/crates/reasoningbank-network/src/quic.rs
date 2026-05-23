//! QUIC protocol implementation for high-performance networking

use quinn::{
    ClientConfig, Endpoint, RecvStream, SendStream, ServerConfig,
    VarInt,
};
use rcgen::{generate_simple_self_signed, CertifiedKey};
use reasoningbank_core::Pattern;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tracing::info;

use crate::{NetworkError, Result};

/// Configuration for QUIC networking
#[derive(Debug, Clone)]
pub struct QuicConfig {
    /// Server bind address
    pub bind_addr: SocketAddr,

    /// Maximum concurrent streams
    pub max_concurrent_streams: u32,

    /// Connection timeout in seconds
    pub connection_timeout_secs: u64,

    /// Enable 0-RTT
    pub enable_0rtt: bool,
}

impl Default for QuicConfig {
    fn default() -> Self {
        Self {
            bind_addr: "127.0.0.1:5000".parse().unwrap(),
            max_concurrent_streams: 100,
            connection_timeout_secs: 30,
            enable_0rtt: true,
        }
    }
}

/// Network message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkMessage {
    /// Store a pattern
    StorePattern(Pattern),

    /// Retrieve a pattern by ID
    GetPattern(String),

    /// Search patterns
    SearchPatterns { query: String, limit: usize },

    /// Synchronize patterns
    SyncPatterns { since_timestamp: i64 },

    /// Response with pattern
    PatternResponse(Option<Pattern>),

    /// Response with multiple patterns
    PatternsResponse(Vec<Pattern>),

    /// Error response
    Error(String),

    /// Ping for keep-alive
    Ping,

    /// Pong response
    Pong,
}

/// QUIC server for receiving reasoning requests
pub struct QuicServer {
    endpoint: Endpoint,
    config: QuicConfig,
}

impl QuicServer {
    /// Create a new QUIC server
    pub async fn new(config: QuicConfig) -> Result<Self> {
        info!("Starting QUIC server on {}", config.bind_addr);

        let server_config = configure_server()?;
        let endpoint = Endpoint::server(server_config, config.bind_addr)
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        Ok(Self { endpoint, config })
    }

    /// Get the server's local address
    pub fn local_addr(&self) -> Result<SocketAddr> {
        self.endpoint.local_addr()
            .map_err(|e| NetworkError::Io(e))
    }

    /// Accept incoming connections
    pub async fn accept(&self) -> Result<IncomingConnection> {
        let connecting = self.endpoint.accept().await
            .ok_or_else(|| NetworkError::Connection("Server closed".to_string()))?;

        info!("Accepting new connection");

        let connection = connecting.await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        Ok(IncomingConnection { connection })
    }

    /// Close the server
    pub fn close(&self) {
        info!("Closing QUIC server");
        self.endpoint.close(VarInt::from_u32(0), b"server shutdown");
    }
}

/// An incoming QUIC connection
pub struct IncomingConnection {
    connection: quinn::Connection,
}

impl IncomingConnection {
    /// Accept a bidirectional stream
    pub async fn accept_stream(&self) -> Result<(SendStream, RecvStream)> {
        let (send, recv) = self.connection.accept_bi().await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        Ok((send, recv))
    }

    /// Receive a message from a stream
    pub async fn receive_message(recv: &mut RecvStream) -> Result<NetworkMessage> {
        // Read message length (4 bytes)
        let len_bytes = recv.read_chunk(4, true).await
            .map_err(|e| NetworkError::Connection(e.to_string()))?
            .ok_or_else(|| NetworkError::Connection("Stream closed".to_string()))?;

        if len_bytes.bytes.len() < 4 {
            return Err(NetworkError::Connection("Incomplete length prefix".to_string()));
        }

        let len = u32::from_be_bytes([
            len_bytes.bytes[0],
            len_bytes.bytes[1],
            len_bytes.bytes[2],
            len_bytes.bytes[3],
        ]) as usize;

        // Read message data
        let data_chunk = recv.read_chunk(len, true).await
            .map_err(|e| NetworkError::Connection(e.to_string()))?
            .ok_or_else(|| NetworkError::Connection("Stream closed".to_string()))?;

        if data_chunk.bytes.len() < len {
            return Err(NetworkError::Connection("Incomplete message data".to_string()));
        }

        // Deserialize
        let message: NetworkMessage = serde_json::from_slice(&data_chunk.bytes)?;
        Ok(message)
    }

    /// Send a message to a stream
    pub async fn send_message(send: &mut SendStream, message: &NetworkMessage) -> Result<()> {
        let data = serde_json::to_vec(message)?;
        let len = data.len() as u32;

        // Write length prefix
        send.write_all(&len.to_be_bytes()).await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        // Write data
        send.write_all(&data).await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        send.flush().await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        Ok(())
    }

    /// Close the connection
    pub fn close(&self) {
        self.connection.close(VarInt::from_u32(0), b"closing");
    }
}

/// QUIC client for sending reasoning requests
pub struct QuicClient {
    endpoint: Endpoint,
}

impl QuicClient {
    /// Create a new QUIC client
    pub fn new() -> Result<Self> {
        let client_config = configure_client();
        let mut endpoint = Endpoint::client("0.0.0.0:0".parse().unwrap())
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        endpoint.set_default_client_config(client_config);

        Ok(Self { endpoint })
    }

    /// Connect to a server
    pub async fn connect(&self, server_addr: SocketAddr) -> Result<QuicConnection> {
        info!("Connecting to QUIC server at {}", server_addr);

        let connecting = self.endpoint.connect(server_addr, "localhost")
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        let connection = connecting.await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        info!("Connected to server");

        Ok(QuicConnection { connection })
    }

    /// Close the client
    pub fn close(&self) {
        self.endpoint.close(VarInt::from_u32(0), b"client shutdown");
    }
}

/// A QUIC connection from client
pub struct QuicConnection {
    connection: quinn::Connection,
}

impl QuicConnection {
    /// Open a bidirectional stream
    pub async fn open_stream(&self) -> Result<(SendStream, RecvStream)> {
        let (send, recv) = self.connection.open_bi().await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        Ok((send, recv))
    }

    /// Send a message and receive response
    pub async fn request(&self, message: &NetworkMessage) -> Result<NetworkMessage> {
        let (mut send, mut recv) = self.open_stream().await?;

        // Send request
        IncomingConnection::send_message(&mut send, message).await?;

        // Receive response
        let response = IncomingConnection::receive_message(&mut recv).await?;

        Ok(response)
    }

    /// Close the connection
    pub fn close(&self) {
        self.connection.close(VarInt::from_u32(0), b"closing");
    }
}

/// Configure server with TLS (rustls 0.23 API)
fn configure_server() -> Result<ServerConfig> {
    // Generate self-signed certificate for development
    let CertifiedKey { cert, key_pair } =
        generate_simple_self_signed(vec!["localhost".to_string()])
            .map_err(|e| NetworkError::Tls(e.to_string()))?;

    let cert_der = CertificateDer::from(cert.der().to_vec());
    let key_der = PrivateKeyDer::try_from(key_pair.serialize_der())
        .map_err(|e| NetworkError::Tls(e.to_string()))?;

    let mut server_config = ServerConfig::with_single_cert(vec![cert_der], key_der)
        .map_err(|e| NetworkError::Tls(e.to_string()))?;

    // Configure transport
    let mut transport_config = quinn::TransportConfig::default();
    transport_config.max_concurrent_bidi_streams(VarInt::from_u32(100));
    transport_config.max_concurrent_uni_streams(VarInt::from_u32(100));

    server_config.transport_config(Arc::new(transport_config));

    Ok(server_config)
}

/// Configure client with permissive TLS for self-signed certs (development only)
fn configure_client() -> ClientConfig {
    // Custom verifier that accepts all server certificates (dev/test only).
    // In production, replace with a proper CA-validating verifier.
    #[derive(Debug)]
    struct SkipServerVerification(Arc<rustls::crypto::CryptoProvider>);

    impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
        fn verify_server_cert(
            &self,
            _end_entity: &CertificateDer<'_>,
            _intermediates: &[CertificateDer<'_>],
            _server_name: &ServerName<'_>,
            _ocsp_response: &[u8],
            _now: rustls::pki_types::UnixTime,
        ) -> std::result::Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        }

        fn verify_tls12_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &rustls::DigitallySignedStruct,
        ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls12_signature(
                message, cert, dss,
                &self.0.signature_verification_algorithms,
            )
        }

        fn verify_tls13_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &rustls::DigitallySignedStruct,
        ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls13_signature(
                message, cert, dss,
                &self.0.signature_verification_algorithms,
            )
        }

        fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
            self.0.signature_verification_algorithms.supported_schemes()
        }
    }

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let crypto = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(SkipServerVerification(Arc::clone(&provider))))
        .with_no_client_auth();

    // quinn 0.11 requires quinn::crypto::rustls::QuicClientConfig wrapper
    ClientConfig::new(Arc::new(
        quinn::crypto::rustls::QuicClientConfig::try_from(crypto)
            .expect("TLS config must support QUIC"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn install_provider() {
        // rustls 0.23 requires an explicit CryptoProvider in tests
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    #[tokio::test]
    async fn test_server_creation() {
        install_provider();
        let config = QuicConfig::default();
        let server = QuicServer::new(config).await.unwrap();
        assert!(server.local_addr().is_ok());
        server.close();
    }

    #[tokio::test]
    async fn test_client_creation() {
        install_provider();
        let client = QuicClient::new().unwrap();
        client.close();
    }

    #[tokio::test]
    async fn test_message_serialization() {
        let msg = NetworkMessage::Ping;
        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: NetworkMessage = serde_json::from_str(&json).unwrap();

        matches!(deserialized, NetworkMessage::Ping);
    }
}
