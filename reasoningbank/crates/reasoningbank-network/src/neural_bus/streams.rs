//! Stream roles and reasoning streams
//!
//! Defines different stream types for the neural bus:
//! - Control: Connection management and configuration
//! - ReqResp: Request/response patterns
//! - Gossip: Peer-to-peer gossip protocol
//! - Snapshot: Bulk data transfer
//! - Telemetry: Metrics and monitoring
//! - Reasoning: Multi-stream reasoning with token, trace, rubric, verify

use crate::neural_bus::{Frame, FrameType, IntentVerifier, Scope};
use crate::{NetworkError, Result};
use bytes::Bytes;
use quinn::{RecvStream, SendStream};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, warn};

/// Stream role identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StreamRole {
    Control = 0,
    ReqResp = 1,
    Gossip = 2,
    Snapshot = 3,
    Telemetry = 4,
    ReasoningTokens = 5,
    ReasoningTraces = 6,
    ReasoningRubrics = 7,
    ReasoningVerify = 8,
}

impl StreamRole {
    pub fn as_byte(&self) -> u8 {
        *self as u8
    }

    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            0 => Some(Self::Control),
            1 => Some(Self::ReqResp),
            2 => Some(Self::Gossip),
            3 => Some(Self::Snapshot),
            4 => Some(Self::Telemetry),
            5 => Some(Self::ReasoningTokens),
            6 => Some(Self::ReasoningTraces),
            7 => Some(Self::ReasoningRubrics),
            8 => Some(Self::ReasoningVerify),
            _ => None,
        }
    }

    pub fn required_scope(&self) -> Scope {
        match self {
            Self::Control => Scope::Write,
            Self::ReqResp => Scope::Write,
            Self::Snapshot => Scope::Write,
            _ => Scope::Read,
        }
    }
}

use serde::{Deserialize, Serialize};

/// Neural stream with intent verification
pub struct NeuralStream {
    send: Arc<Mutex<SendStream>>,
    recv: Arc<Mutex<RecvStream>>,
    role: StreamRole,
    intent_verifier: Arc<IntentVerifier>,
    stream_id: u64,
}

impl NeuralStream {
    /// Create a new neural stream (for client initiating connection)
    pub fn new(
        send: SendStream,
        recv: RecvStream,
        role: StreamRole,
        intent_verifier: Arc<IntentVerifier>,
    ) -> Self {
        let stream_id = send.id().index();

        Self {
            send: Arc::new(Mutex::new(send)),
            recv: Arc::new(Mutex::new(recv)),
            role,
            intent_verifier,
            stream_id,
        }
    }

    /// Accept an incoming stream (for server receiving connection)
    pub async fn accept(
        send: SendStream,
        mut recv: RecvStream,
        intent_verifier: Arc<IntentVerifier>,
    ) -> Result<Self> {
        // Read first frame to determine role
        let frame = Frame::read_from(&mut recv).await?;

        // Extract role from frame type
        let role = match frame.frame_type {
            FrameType::Control => StreamRole::Control,
            FrameType::Request | FrameType::Response => StreamRole::ReqResp,
            FrameType::Gossip => StreamRole::Gossip,
            FrameType::Snapshot => StreamRole::Snapshot,
            FrameType::Telemetry => StreamRole::Telemetry,
            FrameType::Token => StreamRole::ReasoningTokens,
            FrameType::Trace => StreamRole::ReasoningTraces,
            FrameType::Rubric => StreamRole::ReasoningRubrics,
            FrameType::Verify => StreamRole::ReasoningVerify,
        };

        let stream_id = send.id().index();

        Ok(Self {
            send: Arc::new(Mutex::new(send)),
            recv: Arc::new(Mutex::new(recv)),
            role,
            intent_verifier,
            stream_id,
        })
    }

    pub fn id(&self) -> u64 {
        self.stream_id
    }

    pub fn role(&self) -> StreamRole {
        self.role
    }

    /// Send a frame with intent verification
    pub async fn send_frame(&self, frame: Frame) -> Result<()> {
        debug!(
            "Sending frame type {:?} on stream {} (role: {:?})",
            frame.frame_type, self.stream_id, self.role
        );

        // Verify intent if signature present
        if let (Some(kid), Some(scope_str), Some(cap), Some(sig)) = (
            &frame.header.kid,
            &frame.header.scope,
            frame.header.cap,
            &frame.header.sig,
        ) {
            let required_scope = self.role.required_scope();
            self.intent_verifier
                .verify_frame_header(
                    kid,
                    frame.header.ts,
                    &frame.header.nonce,
                    scope_str,
                    cap,
                    sig,
                    &frame.header.op,
                    &required_scope,
                )
                .await?;
        } else if self.role.required_scope() != Scope::Read {
            // Mutating operations require signatures
            warn!("Missing intent signature for mutating operation on stream {}", self.stream_id);
            return Err(NetworkError::Internal(
                "Intent signature required for this operation".to_string(),
            ));
        }

        // Send frame
        let mut send = self.send.lock().await;
        frame.write_to(&mut *send).await?;

        Ok(())
    }

    /// Receive a frame with intent verification
    pub async fn recv_frame(&self) -> Result<Frame> {
        let mut recv = self.recv.lock().await;
        let frame = Frame::read_from(&mut *recv).await?;

        debug!(
            "Received frame type {:?} on stream {} (role: {:?})",
            frame.frame_type, self.stream_id, self.role
        );

        // Verify intent if signature present
        if let (Some(kid), Some(scope_str), Some(cap), Some(sig)) = (
            &frame.header.kid,
            &frame.header.scope,
            frame.header.cap,
            &frame.header.sig,
        ) {
            let required_scope = self.role.required_scope();
            self.intent_verifier
                .verify_frame_header(
                    kid,
                    frame.header.ts,
                    &frame.header.nonce,
                    scope_str,
                    cap,
                    sig,
                    &frame.header.op,
                    &required_scope,
                )
                .await?;
        }

        Ok(frame)
    }

    /// Close the stream
    pub async fn close(&self) -> Result<()> {
        let mut send = self.send.lock().await;
        send.finish()
            .map_err(|e| NetworkError::Connection(e.to_string()))?;
        Ok(())
    }
}

/// Multiple streams for reasoning tasks
pub struct ReasoningStreams {
    /// Request stream (bidirectional)
    pub request: NeuralStream,
    /// Token stream (unidirectional, server -> client)
    pub tokens: Arc<Mutex<SendStream>>,
    /// Trace stream (unidirectional, server -> client)
    pub traces: Arc<Mutex<SendStream>>,
    /// Rubric stream (unidirectional, server -> client)
    pub rubrics: Arc<Mutex<SendStream>>,
    /// Verification stream (unidirectional, server -> client)
    pub verify: Arc<Mutex<SendStream>>,
}

impl ReasoningStreams {
    /// Create reasoning streams from open connections
    pub fn new(
        request: NeuralStream,
        tokens: SendStream,
        traces: SendStream,
        rubrics: SendStream,
        verify: SendStream,
    ) -> Self {
        Self {
            request,
            tokens: Arc::new(Mutex::new(tokens)),
            traces: Arc::new(Mutex::new(traces)),
            rubrics: Arc::new(Mutex::new(rubrics)),
            verify: Arc::new(Mutex::new(verify)),
        }
    }

    /// Send a token chunk
    pub async fn send_token(&self, token: Bytes) -> Result<()> {
        let mut tokens = self.tokens.lock().await;
        tokio::io::AsyncWriteExt::write_all(&mut *tokens, &token)
            .await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;
        Ok(())
    }

    /// Send a trace chunk
    pub async fn send_trace(&self, trace: Bytes) -> Result<()> {
        let mut traces = self.traces.lock().await;
        tokio::io::AsyncWriteExt::write_all(&mut *traces, &trace)
            .await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;
        Ok(())
    }

    /// Send a rubric update
    pub async fn send_rubric(&self, rubric: Bytes) -> Result<()> {
        let mut rubrics = self.rubrics.lock().await;
        tokio::io::AsyncWriteExt::write_all(&mut *rubrics, &rubric)
            .await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;
        Ok(())
    }

    /// Send verification result
    pub async fn send_verification(&self, verification: Bytes) -> Result<()> {
        let mut verify = self.verify.lock().await;
        tokio::io::AsyncWriteExt::write_all(&mut *verify, &verification)
            .await
            .map_err(|e| NetworkError::Connection(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_role_byte_conversion() {
        assert_eq!(StreamRole::Control.as_byte(), 0);
        assert_eq!(StreamRole::from_byte(0), Some(StreamRole::Control));
        assert_eq!(StreamRole::from_byte(255), None);
    }

    #[test]
    fn test_stream_role_scope() {
        assert_eq!(StreamRole::Control.required_scope(), Scope::Write);
        assert_eq!(StreamRole::ReqResp.required_scope(), Scope::Write);
        assert_eq!(StreamRole::Gossip.required_scope(), Scope::Read);
    }
}
