//! Neural Bus over QUIC
//!
//! High-performance neural communication bus using QUIC protocol with:
//! - Role-based stream multiplexing (control, req/resp, gossip, snapshot, telemetry)
//! - Application-level priority queues (high, normal, low)
//! - Intent-capped actions with Ed25519 signatures
//! - Reasoning streaming with parallel verification
//!
//! **Note**: This is a native-only feature due to Ed25519 crypto requirements.
//! WASM compatibility is not supported.

pub mod frame;
pub mod intent;
pub mod priority;
pub mod streams;
pub mod gossip;
pub mod snapshot;

pub use frame::{Frame, FrameType, FrameHeader};
pub use intent::{Intent, IntentVerifier, Scope};
pub use priority::{PriorityQueue, Priority};
pub use streams::{StreamRole, NeuralStream, ReasoningStreams};
pub use gossip::GossipManager;
pub use snapshot::SnapshotManager;

use crate::{NetworkError, Result};
use quinn::{Connection, RecvStream, SendStream};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info};

/// Neural bus configuration
#[derive(Debug, Clone)]
pub struct NeuralBusConfig {
    /// Maximum concurrent streams per role
    pub max_streams_per_role: usize,
    /// Priority queue sizes
    pub high_priority_buffer: usize,
    pub normal_priority_buffer: usize,
    pub low_priority_buffer: usize,
    /// Enable 0-RTT for read-only operations
    pub enable_0rtt_readonly: bool,
    /// Reject 0-RTT for mutating operations
    pub reject_0rtt_mutations: bool,
}

impl Default for NeuralBusConfig {
    fn default() -> Self {
        Self {
            max_streams_per_role: 10,
            high_priority_buffer: 1000,
            normal_priority_buffer: 5000,
            low_priority_buffer: 10000,
            enable_0rtt_readonly: true,
            reject_0rtt_mutations: true,
        }
    }
}

/// Neural bus over QUIC - one connection per peer with streams per role
pub struct NeuralBus {
    connection: Connection,
    config: NeuralBusConfig,
    intent_verifier: Arc<IntentVerifier>,
    priority_queue: Arc<PriorityQueue>,
    streams: Arc<RwLock<StreamManager>>,
}

impl NeuralBus {
    /// Create a new neural bus from an existing QUIC connection
    pub fn new(
        connection: Connection,
        config: NeuralBusConfig,
        intent_verifier: IntentVerifier,
    ) -> Self {
        let priority_queue = Arc::new(PriorityQueue::new(
            config.high_priority_buffer,
            config.normal_priority_buffer,
            config.low_priority_buffer,
        ));

        Self {
            connection,
            config,
            intent_verifier: Arc::new(intent_verifier),
            priority_queue,
            streams: Arc::new(RwLock::new(StreamManager::new())),
        }
    }

    /// Open a new stream with the specified role
    pub async fn open_stream(&self, role: StreamRole) -> Result<NeuralStream> {
        debug!("Opening stream with role: {:?}", role);

        let (send, recv) = self.connection.open_bi().await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        let stream = NeuralStream::new(send, recv, role, self.intent_verifier.clone());

        // Register stream
        let mut streams = self.streams.write().await;
        streams.register(role, stream.id())?;

        Ok(stream)
    }

    /// Accept an incoming stream
    pub async fn accept_stream(&self) -> Result<NeuralStream> {
        let (send, recv) = self.connection.accept_bi().await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        // Read role from first frame
        let stream = NeuralStream::accept(send, recv, self.intent_verifier.clone()).await?;

        // Register stream
        let mut streams = self.streams.write().await;
        streams.register(stream.role(), stream.id())?;

        Ok(stream)
    }

    /// Open unidirectional stream (for gossip, snapshots, telemetry)
    pub async fn open_uni_stream(&self, role: StreamRole) -> Result<SendStream> {
        debug!("Opening unidirectional stream with role: {:?}", role);

        let mut send = self.connection.open_uni().await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        // Send role header
        let role_byte = role.as_byte();
        tokio::io::AsyncWriteExt::write_all(&mut send, &[role_byte]).await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        Ok(send)
    }

    /// Accept unidirectional stream
    pub async fn accept_uni_stream(&self) -> Result<(RecvStream, StreamRole)> {
        let mut recv = self.connection.accept_uni().await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        // Read role header
        let mut role_byte = [0u8; 1];
        tokio::io::AsyncReadExt::read_exact(&mut recv, &mut role_byte).await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;

        let role = StreamRole::from_byte(role_byte[0])
            .ok_or_else(|| NetworkError::Internal("Invalid role byte".to_string()))?;

        Ok((recv, role))
    }

    /// Get the priority queue for application-level prioritization
    pub fn priority_queue(&self) -> Arc<PriorityQueue> {
        self.priority_queue.clone()
    }

    /// Get connection statistics
    pub fn stats(&self) -> ConnectionStats {
        let stats = self.connection.stats();
        ConnectionStats {
            rtt: stats.path.rtt,
            congestion_window: stats.path.cwnd,
            sent_packets: stats.udp_tx.datagrams,
            lost_packets: stats.path.lost_packets,
        }
    }

    /// Close the neural bus connection
    pub fn close(&self, reason: &str) {
        info!("Closing neural bus: {}", reason);
        self.connection.close(quinn::VarInt::from_u32(0), reason.as_bytes());
    }
}

/// Stream manager to track open streams by role
struct StreamManager {
    streams: std::collections::HashMap<StreamRole, Vec<u64>>,
}

impl StreamManager {
    fn new() -> Self {
        Self {
            streams: std::collections::HashMap::new(),
        }
    }

    fn register(&mut self, role: StreamRole, stream_id: u64) -> Result<()> {
        self.streams.entry(role).or_insert_with(Vec::new).push(stream_id);
        Ok(())
    }

    #[allow(dead_code)]
    fn unregister(&mut self, role: StreamRole, stream_id: u64) {
        if let Some(streams) = self.streams.get_mut(&role) {
            streams.retain(|&id| id != stream_id);
        }
    }

    #[allow(dead_code)]
    fn count(&self, role: StreamRole) -> usize {
        self.streams.get(&role).map(|v| v.len()).unwrap_or(0)
    }
}

/// Connection statistics
#[derive(Debug, Clone)]
pub struct ConnectionStats {
    pub rtt: std::time::Duration,
    pub congestion_window: u64,
    pub sent_packets: u64,
    pub lost_packets: u64,
}
