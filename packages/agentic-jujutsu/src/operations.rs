//! Operation log types for agentic-jujutsu
//!
//! This module provides types for tracking and querying jujutsu operations.
//! Operations represent actions taken in the repository and can be queried
//! for analysis and learning.
//!
//! # Examples
//!
//! ```rust
//! use agentic_jujutsu::operations::{JJOperation, JJOperationLog, OperationType};
//! use chrono::Utc;
//!
//! // Create an operation
//! let op = JJOperation::builder()
//!     .operation_type(OperationType::Commit)
//!     .command("jj commit -m 'Initial commit'".to_string())
//!     .user("alice".to_string())
//!     .build();
//!
//! // Build an operation log
//! let mut log = JJOperationLog::new(1000);
//! log.add_operation(op);
//! ```

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;
use napi_derive::napi;

use crate::error::{JJError, Result};
use crate::crypto::{hash_operation_data, sign_message_internal, verify_signature_internal, OperationSignature};

/// Type of jujutsu operation
///
/// Represents the various operations that can be performed in a jujutsu repository.
#[derive(Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[napi]
pub enum OperationType {
    /// Create a new commit
    Commit,
    /// Snapshot operation (automatic)
    Snapshot,
    /// Describe/amend commit message
    Describe,
    /// New commit creation
    New,
    /// Edit commit
    Edit,
    /// Abandon a commit
    Abandon,
    /// Rebase commits
    Rebase,
    /// Squash commits
    Squash,
    /// Resolve conflicts
    Resolve,
    /// Branch operation
    Branch,
    /// Delete a branch
    BranchDelete,
    /// Bookmark operation
    Bookmark,
    /// Create a tag
    Tag,
    /// Checkout a commit
    Checkout,
    /// Restore files
    Restore,
    /// Split a commit
    Split,
    /// Duplicate a commit
    Duplicate,
    /// Undo last operation
    Undo,
    /// Fetch from remote
    Fetch,
    /// Git fetch
    GitFetch,
    /// Push to remote
    Push,
    /// Git push
    GitPush,
    /// Clone repository
    Clone,
    /// Initialize repository
    Init,
    /// Git import
    GitImport,
    /// Git export
    GitExport,
    /// Move changes
    Move,
    /// Diffedit
    Diffedit,
    /// Merge branches
    Merge,
    /// Show status
    Status,
    /// Show commit log
    Log,
    /// Show diff
    Diff,
    /// Unknown operation type
    Unknown,
}

impl OperationType {
    /// Convert to string representation
    #[inline]
    pub fn as_string(&self) -> String {
        match self {
            OperationType::Commit => "Commit".to_string(),
            OperationType::Snapshot => "Snapshot".to_string(),
            OperationType::Describe => "Describe".to_string(),
            OperationType::New => "New".to_string(),
            OperationType::Edit => "Edit".to_string(),
            OperationType::Abandon => "Abandon".to_string(),
            OperationType::Rebase => "Rebase".to_string(),
            OperationType::Squash => "Squash".to_string(),
            OperationType::Resolve => "Resolve".to_string(),
            OperationType::Branch => "Branch".to_string(),
            OperationType::BranchDelete => "BranchDelete".to_string(),
            OperationType::Bookmark => "Bookmark".to_string(),
            OperationType::Tag => "Tag".to_string(),
            OperationType::Checkout => "Checkout".to_string(),
            OperationType::Restore => "Restore".to_string(),
            OperationType::Split => "Split".to_string(),
            OperationType::Duplicate => "Duplicate".to_string(),
            OperationType::Undo => "Undo".to_string(),
            OperationType::Fetch => "Fetch".to_string(),
            OperationType::GitFetch => "GitFetch".to_string(),
            OperationType::Push => "Push".to_string(),
            OperationType::GitPush => "GitPush".to_string(),
            OperationType::Clone => "Clone".to_string(),
            OperationType::Init => "Init".to_string(),
            OperationType::GitImport => "GitImport".to_string(),
            OperationType::GitExport => "GitExport".to_string(),
            OperationType::Move => "Move".to_string(),
            OperationType::Diffedit => "Diffedit".to_string(),
            OperationType::Merge => "Merge".to_string(),
            OperationType::Status => "Status".to_string(),
            OperationType::Log => "Log".to_string(),
            OperationType::Diff => "Diff".to_string(),
            OperationType::Unknown => "Unknown".to_string(),
        }
    }

    /// Check if operation modifies history
    #[inline]
    pub fn modifies_history(&self) -> bool {
        matches!(
            self,
            OperationType::Commit
                | OperationType::Describe
                | OperationType::Edit
                | OperationType::Abandon
                | OperationType::Rebase
                | OperationType::Squash
                | OperationType::Split
                | OperationType::Move
                | OperationType::Merge
        )
    }

    /// Check if operation interacts with remotes
    #[inline]
    pub fn is_remote_operation(&self) -> bool {
        matches!(
            self,
            OperationType::Fetch
                | OperationType::GitFetch
                | OperationType::Push
                | OperationType::GitPush
                | OperationType::Clone
                | OperationType::GitImport
                | OperationType::GitExport
        )
    }

    /// Check if operation is automatic (not user-initiated)
    #[inline]
    pub fn is_automatic(&self) -> bool {
        matches!(self, OperationType::Snapshot)
    }
}

impl OperationType {
    /// Parse from string
    pub fn from_string(s: &str) -> OperationType {
        match s.to_lowercase().as_str() {
            "commit" => OperationType::Commit,
            "snapshot" => OperationType::Snapshot,
            "describe" => OperationType::Describe,
            "new" => OperationType::New,
            "edit" => OperationType::Edit,
            "abandon" => OperationType::Abandon,
            "rebase" => OperationType::Rebase,
            "squash" => OperationType::Squash,
            "resolve" => OperationType::Resolve,
            "branch" => OperationType::Branch,
            "branch-delete" => OperationType::BranchDelete,
            "bookmark" => OperationType::Bookmark,
            "tag" => OperationType::Tag,
            "checkout" => OperationType::Checkout,
            "restore" => OperationType::Restore,
            "split" => OperationType::Split,
            "duplicate" => OperationType::Duplicate,
            "undo" => OperationType::Undo,
            "fetch" => OperationType::Fetch,
            "git-fetch" => OperationType::GitFetch,
            "push" => OperationType::Push,
            "git-push" => OperationType::GitPush,
            "clone" => OperationType::Clone,
            "init" => OperationType::Init,
            "git-import" => OperationType::GitImport,
            "git-export" => OperationType::GitExport,
            "move" => OperationType::Move,
            "diffedit" => OperationType::Diffedit,
            "merge" => OperationType::Merge,
            "status" => OperationType::Status,
            "log" => OperationType::Log,
            "diff" => OperationType::Diff,
            _ => OperationType::Unknown,
        }
    }
}

/// Single jujutsu operation
///
/// Represents a single operation in the jujutsu operation log with metadata.
///
/// # Examples
///
/// ```rust
/// use agentic_jujutsu::operations::{JJOperation, OperationType};
///
/// let op = JJOperation::builder()
///     .operation_type(OperationType::Commit)
///     .command("jj commit".to_string())
///     .user("alice".to_string())
///     .build();
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct JJOperation {
    /// Unique operation ID (generated by wrapper)
    pub id: String,

    /// Operation ID from jj (e.g., "abc123@example.com")
    pub operation_id: String,

    /// Operation type (as string for N-API compatibility)
    pub operation_type: String,

    /// Command that created this operation
    pub command: String,

    /// User who performed the operation
    pub user: String,

    /// Hostname where operation was performed
    pub hostname: String,

    /// Operation timestamp (ISO 8601 format)
    pub timestamp: String,

    /// Tags associated with this operation
    pub tags: Vec<String>,

    /// Additional metadata (JSON string for N-API compatibility)
    pub metadata: String,

    /// Parent operation ID
    pub parent_id: Option<String>,

    /// Duration in milliseconds
    pub duration_ms: u32,

    /// Whether this operation was successful
    pub success: bool,

    /// Error message (if failed)
    pub error: Option<String>,

    /// Quantum fingerprint for fast integrity verification (hex string)
    pub quantum_fingerprint: Option<String>,

    /// Digital signature (hex-encoded, optional)
    pub signature: Option<String>,

    /// Public key used for signature verification (hex-encoded, optional)
    pub signature_public_key: Option<String>,
}

impl JJOperation {
    /// Create a new operation
    pub fn new(operation_id: String, command: String, user: String, hostname: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            operation_id,
            operation_type: OperationType::Unknown.as_string(),
            command,
            user,
            hostname,
            timestamp: Utc::now().to_rfc3339(),
            tags: Vec::new(),
            metadata: "{}".to_string(),
            parent_id: None,
            duration_ms: 0,
            success: true,
            error: None,
            quantum_fingerprint: None,
            signature: None,
            signature_public_key: None,
        }
    }

    /// Create a builder for constructing operations
    pub fn builder() -> JJOperationBuilder {
        JJOperationBuilder::default()
    }

    /// Get operation type enum (internal)
    pub(crate) fn get_operation_type(&self) -> OperationType {
        OperationType::from_string(&self.operation_type)
    }

    /// Set operation type from enum (internal)
    pub(crate) fn set_operation_type_enum(&mut self, op_type: OperationType) {
        self.operation_type = op_type.as_string();
    }

    /// Set operation type from string
    ///
    /// Recognized type names are canonicalized (e.g. `"describe"` -> `"Describe"`)
    /// so the stored value matches the `OperationType` enum representation used
    /// elsewhere. Unrecognized (custom) type strings are preserved as-is rather
    /// than being silently collapsed to `"Unknown"`.
    pub fn set_operation_type(&mut self, type_str: String) {
        let parsed = OperationType::from_string(&type_str);
        self.operation_type = if parsed == OperationType::Unknown
            && !type_str.eq_ignore_ascii_case("unknown")
        {
            type_str
        } else {
            parsed.as_string()
        };
    }

    /// Get timestamp as ISO 8601 string
    pub fn timestamp_iso(&self) -> String {
        self.timestamp.clone()
    }

    /// Short operation ID (first 12 characters)
    #[inline]
    pub fn short_id(&self) -> String {
        self.operation_id.chars().take(12).collect()
    }

    /// Check if operation is a snapshot
    #[inline]
    pub fn is_snapshot(&self) -> bool {
        self.get_operation_type() == OperationType::Snapshot
    }

    /// Check if operation is user-initiated (not automatic snapshot)
    #[inline]
    pub fn is_user_initiated(&self) -> bool {
        !self.is_snapshot()
    }

    /// Check if operation modifies history
    #[inline]
    pub fn modifies_history(&self) -> bool {
        self.get_operation_type().modifies_history()
    }

    /// Check if operation is remote
    #[inline]
    pub fn is_remote_operation(&self) -> bool {
        self.get_operation_type().is_remote_operation()
    }

    /// Add a tag to this operation
    pub fn add_tag(&mut self, tag: String) {
        if !self.tags.contains(&tag) {
            self.tags.push(tag);
        }
    }

    /// Get all tags
    pub fn tags(&self) -> &[String] {
        &self.tags
    }

    /// Get metadata as HashMap (internal)
    pub(crate) fn get_metadata_map(&self) -> HashMap<String, String> {
        serde_json::from_str(&self.metadata).unwrap_or_default()
    }

    /// Get a metadata value (internal)
    pub fn get_metadata(&self, key: &str) -> Option<String> {
        self.get_metadata_map().get(key).cloned()
    }

    /// Set a metadata value
    pub fn set_metadata(&mut self, key: String, value: String) {
        let mut map = self.get_metadata_map();
        map.insert(key, value);
        self.metadata = serde_json::to_string(&map).unwrap_or_else(|_| "{}".to_string());
    }

    /// Sign this operation with a secret key
    ///
    /// Creates a quantum-resistant digital signature for this operation.
    ///
    /// # Arguments
    ///
    /// * `secret_key` - The secret key in hex format
    /// * `public_key` - The corresponding public key in hex format
    ///
    /// # Examples
    ///
    /// ```rust
    /// use agentic_jujutsu::operations::JJOperation;
    /// use agentic_jujutsu::crypto::generate_signing_keypair;
    ///
    /// let mut op = JJOperation::new("op1".into(), "jj commit".into(), "alice".into(), "localhost".into());
    /// let keypair = generate_signing_keypair();
    /// op.sign(&keypair.secret_key, &keypair.public_key).unwrap();
    /// assert!(op.signature.is_some());
    /// ```
    pub fn sign(&mut self, secret_key: &str, public_key: &str) -> Result<()> {
        // Create canonical representation of operation data
        let message = hash_operation_data(
            &self.operation_id,
            &self.command,
            &self.timestamp,
            &self.user,
        );

        // Sign the message
        let signature = sign_message_internal(&message, secret_key)?;

        // Store signature and public key
        self.signature = Some(signature);
        self.signature_public_key = Some(public_key.to_string());

        Ok(())
    }

    /// Verify this operation's signature
    ///
    /// Verifies that the operation's signature is valid.
    ///
    /// # Returns
    ///
    /// `Ok(true)` if signature is valid, `Ok(false)` if invalid,
    /// `Err` if operation is not signed or verification fails.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use agentic_jujutsu::operations::JJOperation;
    /// use agentic_jujutsu::crypto::generate_signing_keypair;
    ///
    /// let mut op = JJOperation::new("op1".into(), "jj commit".into(), "alice".into(), "localhost".into());
    /// let keypair = generate_signing_keypair();
    /// op.sign(&keypair.secret_key, &keypair.public_key).unwrap();
    ///
    /// assert!(op.verify_signature().unwrap());
    /// ```
    pub fn verify_signature(&self) -> Result<bool> {
        // Check if operation is signed
        let signature = self.signature.as_ref()
            .ok_or_else(|| JJError::CryptoError("Operation is not signed".to_string()))?;

        let public_key = self.signature_public_key.as_ref()
            .ok_or_else(|| JJError::CryptoError("No public key found for verification".to_string()))?;

        // Recreate the message that was signed
        let message = hash_operation_data(
            &self.operation_id,
            &self.command,
            &self.timestamp,
            &self.user,
        );

        // Verify the signature
        verify_signature_internal(&message, signature, public_key)
    }

    /// Check if this operation is signed
    pub fn is_signed(&self) -> bool {
        self.signature.is_some() && self.signature_public_key.is_some()
    }

    /// Get signature as OperationSignature struct
    pub fn get_operation_signature(&self) -> Option<OperationSignature> {
        if let (Some(sig), Some(pubkey)) = (&self.signature, &self.signature_public_key) {
            Some(OperationSignature {
                signature: sig.clone(),
                public_key: pubkey.clone(),
                signed_at: self.timestamp.clone(),
                algorithm: "ML-DSA-44".to_string(),
            })
        } else {
            None
        }
    }

    /// Set operation type (internal)
    pub fn with_type(mut self, op_type: OperationType) -> Self {
        self.operation_type = op_type.as_string();
        self
    }

    /// Set success status
    pub fn with_success(mut self, success: bool) -> Self {
        self.success = success;
        self
    }

    /// Set duration
    pub fn with_duration(mut self, duration_ms: u64) -> Self {
        self.duration_ms = duration_ms as u32;
        self
    }

    /// Set quantum fingerprint
    pub fn with_quantum_fingerprint(mut self, fingerprint: String) -> Self {
        self.quantum_fingerprint = Some(fingerprint);
        self
    }

    /// Generate quantum fingerprint from operation data
    pub fn generate_quantum_fingerprint(&self) -> Result<String> {
        // Serialize operation data for fingerprinting
        let data = serde_json::to_string(self)
            .map_err(|e| JJError::SerializationError(e.to_string()))?;

        // Return the data as hex-encoded string for now
        // The actual quantum fingerprint generation will be done in wrapper.rs
        // using @qudag/napi-core
        Ok(hex::encode(data.as_bytes()))
    }

    /// Verify quantum fingerprint matches operation data
    pub fn verify_quantum_fingerprint(&self, fingerprint: &str) -> Result<bool> {
        let current = self.generate_quantum_fingerprint()?;
        Ok(current == fingerprint)
    }
}

/// Builder for JJOperation
pub struct JJOperationBuilder {
    operation_id: Option<String>,
    operation_type: Option<OperationType>,
    command: Option<String>,
    user: Option<String>,
    hostname: Option<String>,
    tags: Vec<String>,
    metadata: HashMap<String, String>,
    parent_id: Option<String>,
    duration_ms: u32,
    success: bool,
    error: Option<String>,
    quantum_fingerprint: Option<String>,
}

impl Default for JJOperationBuilder {
    fn default() -> Self {
        Self {
            operation_id: None,
            operation_type: None,
            command: None,
            user: None,
            hostname: None,
            tags: Vec::new(),
            metadata: HashMap::new(),
            parent_id: None,
            duration_ms: 0,
            success: true, // Default to successful operations
            error: None,
            quantum_fingerprint: None,
        }
    }
}

impl JJOperationBuilder {
    /// Set operation ID
    pub fn operation_id(mut self, id: String) -> Self {
        self.operation_id = Some(id);
        self
    }

    /// Set operation type
    pub fn operation_type(mut self, op_type: OperationType) -> Self {
        self.operation_type = Some(op_type);
        self
    }

    /// Set command
    pub fn command(mut self, command: String) -> Self {
        self.command = Some(command);
        self
    }

    /// Set user
    pub fn user(mut self, user: String) -> Self {
        self.user = Some(user);
        self
    }

    /// Set hostname
    pub fn hostname(mut self, hostname: String) -> Self {
        self.hostname = Some(hostname);
        self
    }

    /// Add a tag
    pub fn tag(mut self, tag: String) -> Self {
        self.tags.push(tag);
        self
    }

    /// Add metadata entry
    pub fn add_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }

    /// Set metadata
    pub fn metadata(mut self, metadata: HashMap<String, String>) -> Self {
        self.metadata = metadata;
        self
    }

    /// Set parent operation ID
    pub fn parent_id(mut self, parent_id: String) -> Self {
        self.parent_id = Some(parent_id);
        self
    }

    /// Set duration
    pub fn duration_ms(mut self, duration_ms: u32) -> Self {
        self.duration_ms = duration_ms;
        self
    }

    /// Mark as failed
    pub fn failed(mut self, error: String) -> Self {
        self.success = false;
        self.error = Some(error);
        self
    }

    /// Set quantum fingerprint
    pub fn quantum_fingerprint(mut self, fingerprint: String) -> Self {
        self.quantum_fingerprint = Some(fingerprint);
        self
    }

    /// Build the operation
    pub fn build(self) -> JJOperation {
        JJOperation {
            id: Uuid::new_v4().to_string(),
            operation_id: self
                .operation_id
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            operation_type: self.operation_type.unwrap_or(OperationType::Unknown).as_string(),
            command: self.command.unwrap_or_default(),
            user: self.user.unwrap_or_default(),
            hostname: self.hostname.unwrap_or_default(),
            timestamp: Utc::now().to_rfc3339(),
            tags: self.tags,
            metadata: serde_json::to_string(&self.metadata).unwrap_or_else(|_| "{}".to_string()),
            parent_id: self.parent_id,
            signature: None, // No signature for unsigned operations
            signature_public_key: None, // No public key for unsigned operations
            duration_ms: self.duration_ms,
            success: self.success,
            error: self.error,
            quantum_fingerprint: self.quantum_fingerprint,
        }
    }
}

/// Collection of operations with query capabilities
///
/// Provides methods for storing, querying, and analyzing jujutsu operations.
///
/// # Examples
///
/// ```rust
/// use agentic_jujutsu::operations::{JJOperationLog, JJOperation, OperationType};
///
/// let log = JJOperationLog::new(1000);
/// let op = JJOperation::builder()
///     .operation_type(OperationType::Commit)
///     .command("jj commit".to_string())
///     .user("alice".to_string())
///     .build();
/// log.add_operation(op);
///
/// // Query operations
/// let commits = log.get_by_type(OperationType::Commit);
/// assert_eq!(commits.len(), 1);
/// ```
#[derive(Debug, Clone)]
pub struct JJOperationLog {
    /// Operations stored in memory
    operations: Arc<Mutex<Vec<JJOperation>>>,

    /// Maximum number of operations to keep
    max_entries: usize,
}

impl JJOperationLog {
    /// Create a new operation log
    pub fn new(max_entries: usize) -> Self {
        Self {
            operations: Arc::new(Mutex::new(Vec::with_capacity(max_entries))),
            max_entries,
        }
    }

    /// Add an operation to the log
    pub fn add_operation(&self, operation: JJOperation) {
        let mut ops = self.operations.lock().unwrap();
        ops.push(operation);

        // Trim to max_entries if exceeded
        if ops.len() > self.max_entries {
            let excess = ops.len() - self.max_entries;
            ops.drain(0..excess);
        }
    }

    /// Get recent operations (most recent first)
    pub fn get_recent(&self, limit: usize) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter().rev().take(limit).cloned().collect()
    }

    /// Get all operations
    pub fn get_all(&self) -> Vec<JJOperation> {
        self.operations.lock().unwrap().clone()
    }

    /// Find operation by ID
    pub fn find_by_id(&self, id: &str) -> Option<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .find(|op| op.id == id || op.operation_id == id)
            .cloned()
    }

    /// Get operation by ID as Result
    pub fn get_operation(&self, id: &str) -> Result<JJOperation> {
        self.find_by_id(id)
            .ok_or_else(|| JJError::OperationNotFound(id.to_string()))
    }

    /// Filter operations by type
    pub fn filter_by_type(&self, op_type: OperationType) -> Vec<JJOperation> {
        self.get_by_type(op_type)
    }

    /// Get operations by type
    pub fn get_by_type(&self, op_type: OperationType) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| op.get_operation_type() == op_type)
            .cloned()
            .collect()
    }

    /// Filter operations by date range
    pub fn filter_by_date_range(
        &self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Vec<JJOperation> {
        let start_str = start.to_rfc3339();
        let end_str = end.to_rfc3339();
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| op.timestamp >= start_str && op.timestamp <= end_str)
            .cloned()
            .collect()
    }

    /// Filter operations by user
    pub fn filter_by_user(&self, user: &str) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter().filter(|op| op.user == user).cloned().collect()
    }

    /// Get operations in the last N hours
    pub fn recent_operations(&self, hours: i64) -> Vec<JJOperation> {
        let cutoff = (Utc::now() - Duration::hours(hours)).to_rfc3339();
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| op.timestamp >= cutoff)
            .cloned()
            .collect()
    }

    /// Search operations by command or description
    pub fn search(&self, query: &str) -> Vec<JJOperation> {
        let query_lower = query.to_lowercase();
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| op.command.to_lowercase().contains(&query_lower))
            .cloned()
            .collect()
    }

    /// Get failed operations
    pub fn failed_operations(&self) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter().filter(|op| !op.success).cloned().collect()
    }

    /// Get operations that modified history
    pub fn history_modifying_operations(&self) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| op.get_operation_type().modifies_history())
            .cloned()
            .collect()
    }

    /// Get remote operations
    pub fn remote_operations(&self) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| op.get_operation_type().is_remote_operation())
            .cloned()
            .collect()
    }

    /// Get user-initiated operations (exclude snapshots)
    pub fn get_user_operations(&self, limit: usize) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .rev()
            .filter(|op| op.is_user_initiated())
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get total operation count
    #[inline]
    pub fn count(&self) -> usize {
        self.operations.lock().unwrap().len()
    }

    /// Check if log is empty
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.operations.lock().unwrap().is_empty()
    }

    /// Get length
    #[inline]
    pub fn len(&self) -> usize {
        self.count()
    }

    /// Clear all operations
    pub fn clear(&self) {
        self.operations.lock().unwrap().clear();
    }

    /// Get statistics about operations
    pub fn statistics(&self) -> OperationStatistics {
        let ops = self.operations.lock().unwrap();
        let mut stats = OperationStatistics::default();

        for op in ops.iter() {
            *stats.by_type.entry(op.get_operation_type()).or_insert(0) += 1;

            if op.success {
                stats.successful += 1;
            } else {
                stats.failed += 1;
            }

            if op.duration_ms > 0 {
                stats.total_duration_ms += op.duration_ms as u64;
                if op.duration_ms as u64 > stats.max_duration_ms {
                    stats.max_duration_ms = op.duration_ms as u64;
                }
            }
        }

        stats.total = ops.len();
        if stats.total > 0 && stats.total_duration_ms > 0 {
            stats.avg_duration_ms = stats.total_duration_ms / stats.total as u64;
        }

        stats
    }

    /// Get average operation duration
    pub fn avg_duration_ms(&self) -> f64 {
        let ops = self.operations.lock().unwrap();
        if ops.is_empty() {
            return 0.0;
        }

        let total: u64 = ops.iter().map(|op| op.duration_ms as u64).sum();
        total as f64 / ops.len() as f64
    }

    /// Get success rate
    pub fn success_rate(&self) -> f64 {
        let ops = self.operations.lock().unwrap();
        if ops.is_empty() {
            return 0.0;
        }

        let successful = ops.iter().filter(|op| op.success).count();
        successful as f64 / ops.len() as f64
    }

    /// Get an iterator over operations
    pub fn iter(&self) -> Vec<JJOperation> {
        self.get_all()
    }

    /// Sign an operation by ID
    ///
    /// Signs the specified operation with the provided keypair.
    ///
    /// # Arguments
    ///
    /// * `operation_id` - The operation ID to sign (either wrapper ID or jj operation ID)
    /// * `secret_key` - The secret key in hex format
    /// * `public_key` - The corresponding public key in hex format
    ///
    /// # Examples
    ///
    /// ```rust
    /// use agentic_jujutsu::operations::{JJOperationLog, JJOperation, OperationType};
    /// use agentic_jujutsu::crypto::generate_signing_keypair;
    ///
    /// let log = JJOperationLog::new(100);
    /// let op = JJOperation::builder()
    ///     .operation_type(OperationType::Commit)
    ///     .command("jj commit".to_string())
    ///     .build();
    /// let op_id = op.id.clone();
    /// log.add_operation(op);
    ///
    /// let keypair = generate_signing_keypair();
    /// log.sign_operation(&op_id, &keypair.secret_key, &keypair.public_key).unwrap();
    /// ```
    pub fn sign_operation(&self, operation_id: &str, secret_key: &str, public_key: &str) -> Result<()> {
        let mut ops = self.operations.lock().unwrap();
        let operation = ops.iter_mut()
            .find(|op| op.id == operation_id || op.operation_id == operation_id)
            .ok_or_else(|| JJError::OperationNotFound(operation_id.to_string()))?;

        operation.sign(secret_key, public_key)?;
        Ok(())
    }

    /// Verify an operation's signature by ID
    ///
    /// Verifies the signature of the specified operation.
    ///
    /// # Arguments
    ///
    /// * `operation_id` - The operation ID to verify
    ///
    /// # Returns
    ///
    /// `Ok(true)` if signature is valid, `Ok(false)` if invalid,
    /// `Err` if operation not found or not signed.
    pub fn verify_operation_signature(&self, operation_id: &str) -> Result<bool> {
        let operation = self.get_operation(operation_id)?;
        operation.verify_signature()
    }

    /// Verify all operations in the log
    ///
    /// Verifies the signatures of all signed operations in the log.
    ///
    /// # Arguments
    ///
    /// * `public_key` - Optional public key to verify against. If None, uses each operation's stored public key.
    ///
    /// # Returns
    ///
    /// A tuple of (total_signed, valid_count, invalid_count)
    ///
    /// # Examples
    ///
    /// ```rust
    /// use agentic_jujutsu::operations::{JJOperationLog, JJOperation};
    /// use agentic_jujutsu::crypto::generate_signing_keypair;
    ///
    /// let log = JJOperationLog::new(100);
    /// let keypair = generate_signing_keypair();
    ///
    /// // Add and sign operations...
    /// let (total, valid, invalid) = log.verify_all_operations(None).unwrap();
    /// println!("Verified {}/{} operations ({} invalid)", valid, total, invalid);
    /// ```
    pub fn verify_all_operations(&self, public_key: Option<&str>) -> Result<(usize, usize, usize)> {
        let ops = self.operations.lock().unwrap();
        let mut total_signed = 0;
        let mut valid_count = 0;
        let mut invalid_count = 0;

        for operation in ops.iter() {
            if !operation.is_signed() {
                continue;
            }

            total_signed += 1;

            // If a specific public key is provided, verify against it
            let is_valid = if let Some(pk) = public_key {
                if let Some(op_pubkey) = &operation.signature_public_key {
                    // Check that operation's public key matches the provided one
                    if op_pubkey != pk {
                        false
                    } else {
                        operation.verify_signature().unwrap_or(false)
                    }
                } else {
                    false
                }
            } else {
                // Use operation's stored public key
                operation.verify_signature().unwrap_or(false)
            };

            if is_valid {
                valid_count += 1;
            } else {
                invalid_count += 1;
            }
        }

        Ok((total_signed, valid_count, invalid_count))
    }

    /// Get all signed operations
    pub fn signed_operations(&self) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| op.is_signed())
            .cloned()
            .collect()
    }

    /// Get all unsigned operations
    pub fn unsigned_operations(&self) -> Vec<JJOperation> {
        let ops = self.operations.lock().unwrap();
        ops.iter()
            .filter(|op| !op.is_signed())
            .cloned()
            .collect()
    }

    /// Sign all unsigned operations
    ///
    /// Batch signs all operations that don't have a signature.
    ///
    /// # Arguments
    ///
    /// * `secret_key` - The secret key in hex format
    /// * `public_key` - The corresponding public key in hex format
    ///
    /// # Returns
    ///
    /// The number of operations that were signed
    pub fn sign_all_operations(&self, secret_key: &str, public_key: &str) -> Result<usize> {
        let mut ops = self.operations.lock().unwrap();
        let mut signed_count = 0;

        for operation in ops.iter_mut() {
            if !operation.is_signed() {
                operation.sign(secret_key, public_key)?;
                signed_count += 1;
            }
        }

        Ok(signed_count)
    }

    /// Verify signature chain
    ///
    /// Verifies that all operations form a valid signature chain.
    /// This ensures that operations haven't been reordered or removed.
    ///
    /// # Returns
    ///
    /// `Ok(true)` if chain is valid, `Ok(false)` if broken
    pub fn verify_signature_chain(&self) -> Result<bool> {
        let ops = self.operations.lock().unwrap();
        let signed_ops: Vec<&JJOperation> = ops.iter()
            .filter(|op| op.is_signed())
            .collect();

        if signed_ops.is_empty() {
            return Ok(true);
        }

        // Verify each operation's signature
        for op in signed_ops.iter() {
            if !op.verify_signature()? {
                return Ok(false);
            }
        }

        // Verify parent-child relationships
        for i in 1..signed_ops.len() {
            let prev_op = signed_ops[i - 1];
            let curr_op = signed_ops[i];

            // Check if parent_id references the previous operation
            if let Some(ref parent_id) = curr_op.parent_id {
                if parent_id != &prev_op.id && parent_id != &prev_op.operation_id {
                    return Ok(false);
                }
            }
        }

        Ok(true)
    }
}

impl Default for JJOperationLog {
    fn default() -> Self {
        Self::new(1000)
    }
}

/// Statistics about operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(Default)]
pub struct OperationStatistics {
    /// Total number of operations
    pub total: usize,

    /// Number of successful operations
    pub successful: usize,

    /// Number of failed operations
    pub failed: usize,

    /// Operations by type
    pub by_type: HashMap<OperationType, usize>,

    /// Total duration in milliseconds
    pub total_duration_ms: u64,

    /// Average duration in milliseconds
    pub avg_duration_ms: u64,

    /// Maximum duration in milliseconds
    pub max_duration_ms: u64,
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_operation_type_conversion() {
        assert_eq!(
            OperationType::from_string("describe"),
            OperationType::Describe
        );
        assert_eq!(
            OperationType::from_string("SNAPSHOT"),
            OperationType::Snapshot
        );
        assert_eq!(
            OperationType::from_string("unknown_op"),
            OperationType::Unknown
        );
    }

    #[test]
    fn test_operation_type_checks() {
        assert!(OperationType::Commit.modifies_history());
        assert!(!OperationType::Fetch.modifies_history());
        assert!(OperationType::Push.is_remote_operation());
        assert!(!OperationType::Commit.is_remote_operation());
        assert!(OperationType::Snapshot.is_automatic());
        assert!(!OperationType::Commit.is_automatic());
    }

    #[test]
    fn test_operation_creation() {
        let mut op = JJOperation::new(
            "abc123@example.com".into(),
            "jj describe".into(),
            "alice".into(),
            "localhost".into(),
        );

        op.set_operation_type("describe".into());
        assert_eq!(op.operation_type, "Describe");
        assert!(op.is_user_initiated());
    }

    #[test]
    fn test_operation_builder() {
        let op = JJOperation::builder()
            .operation_type(OperationType::Rebase)
            .command("jj rebase".to_string())
            .user("alice".to_string())
            .hostname("localhost".to_string())
            .add_metadata("commits", "5")
            .duration_ms(1500)
            .build();

        assert_eq!(op.operation_type, "Rebase");
        assert_eq!(op.user, "alice");
        assert_eq!(op.get_metadata("commits"), Some("5".to_string()));
        assert_eq!(op.duration_ms, 1500);
    }

    #[test]
    fn test_operation_log() {
        let log = JJOperationLog::new(10);

        let op1 = JJOperation::new(
            "op1".into(),
            "jj new".into(),
            "alice".into(),
            "localhost".into(),
        )
        .with_type(OperationType::New)
        .with_duration(100);

        let op2 = JJOperation::new(
            "op2".into(),
            "jj describe".into(),
            "bob".into(),
            "localhost".into(),
        )
        .with_type(OperationType::Describe)
        .with_duration(200);

        log.add_operation(op1);
        log.add_operation(op2);

        assert_eq!(log.count(), 2);

        let recent = log.get_recent(1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].operation_id, "op2");

        let new_ops = log.get_by_type(OperationType::New);
        assert_eq!(new_ops.len(), 1);
        assert_eq!(new_ops[0].operation_id, "op1");
    }

    #[test]
    fn test_operation_log_limit() {
        let log = JJOperationLog::new(5);

        for i in 0..10 {
            let op = JJOperation::new(
                format!("op{}", i),
                "jj new".into(),
                "alice".into(),
                "localhost".into(),
            );
            log.add_operation(op);
        }

        // Should only keep last 5
        assert_eq!(log.count(), 5);

        let all = log.get_all();
        assert_eq!(all[0].operation_id, "op5");
        assert_eq!(all[4].operation_id, "op9");
    }

    #[test]
    fn test_filter_by_type() {
        let log = JJOperationLog::new(100);
        log.add_operation(
            JJOperation::builder()
                .operation_id("op1".to_string())
                .operation_type(OperationType::Commit)
                .command("jj commit".to_string())
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_id("op2".to_string())
                .operation_type(OperationType::Rebase)
                .command("jj rebase".to_string())
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_id("op3".to_string())
                .operation_type(OperationType::Commit)
                .command("jj commit".to_string())
                .build(),
        );

        let commits = log.filter_by_type(OperationType::Commit);
        assert_eq!(commits.len(), 2);
    }

    #[test]
    fn test_filter_by_user() {
        let log = JJOperationLog::new(100);
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Commit)
                .user("alice".to_string())
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Commit)
                .user("bob".to_string())
                .build(),
        );

        let alice_ops = log.filter_by_user("alice");
        assert_eq!(alice_ops.len(), 1);
    }

    #[test]
    fn test_search() {
        let log = JJOperationLog::new(100);
        log.add_operation(
            JJOperation::builder()
                .command("jj commit -m 'Add feature X'".to_string())
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .command("jj rebase".to_string())
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .command("jj commit -m 'Add feature Z'".to_string())
                .build(),
        );

        let results = log.search("feature");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_failed_operations() {
        let log = JJOperationLog::new(100);
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Commit)
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Push)
                .failed("Network error".to_string())
                .build(),
        );

        let failed = log.failed_operations();
        assert_eq!(failed.len(), 1);
    }

    #[test]
    fn test_statistics() {
        let log = JJOperationLog::new(100);
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Commit)
                .duration_ms(100)
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Commit)
                .duration_ms(200)
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Rebase)
                .duration_ms(300)
                .build(),
        );

        let stats = log.statistics();
        assert_eq!(stats.total, 3);
        assert_eq!(stats.successful, 3);
        assert_eq!(stats.by_type.get(&OperationType::Commit), Some(&2));
        assert_eq!(stats.max_duration_ms, 300);
    }

    #[test]
    fn test_history_modifying_operations() {
        let log = JJOperationLog::new(100);
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Commit)
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Fetch)
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Rebase)
                .build(),
        );

        let modifying = log.history_modifying_operations();
        assert_eq!(modifying.len(), 2);
    }

    #[test]
    fn test_remote_operations() {
        let log = JJOperationLog::new(100);
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Commit)
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Push)
                .build(),
        );
        log.add_operation(
            JJOperation::builder()
                .operation_type(OperationType::Fetch)
                .build(),
        );

        let remote = log.remote_operations();
        assert_eq!(remote.len(), 2);
    }
}
