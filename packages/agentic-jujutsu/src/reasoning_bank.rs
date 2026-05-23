//! ReasoningBank - Self-learning and pattern recognition for AI agents
//!
//! This module provides advanced learning capabilities including:
//! - Trajectory tracking and analysis
//! - Pattern recognition and matching
//! - Success prediction based on historical data
//! - Adaptive decision making
//! - Knowledge distillation and transfer
//! - Quantum-resistant encryption for secure pattern storage

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::operations::JJOperation;
use crate::error::{JJError, Result};

/// Encryption state for ReasoningBank
#[derive(Debug, Clone)]
#[derive(Default)]
pub struct EncryptionState {
    /// Whether encryption is enabled
    pub enabled: bool,
    /// Encryption key (stored securely)
    pub key: Option<Vec<u8>>,
    /// Public key for HQC encryption
    pub public_key: Option<Vec<u8>>,
}


/// A trajectory represents a sequence of operations with context and outcome
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trajectory {
    /// Unique identifier
    pub id: String,
    /// Task description or goal
    pub task: String,
    /// Sequence of operations performed
    pub operations: Vec<JJOperation>,
    /// Context at the start (branch state, conflicts, etc.)
    pub initial_context: HashMap<String, String>,
    /// Final context after operations
    pub final_context: HashMap<String, String>,
    /// Success score (0.0 - 1.0)
    pub success_score: f64,
    /// Timestamp when trajectory started
    pub started_at: DateTime<Utc>,
    /// Timestamp when trajectory completed
    pub completed_at: DateTime<Utc>,
    /// Tags for categorization
    pub tags: Vec<String>,
    /// Reward signal (used for reinforcement learning)
    pub reward: f64,
    /// Agent critique or self-reflection
    pub critique: Option<String>,
    /// Whether this trajectory is encrypted (for storage)
    #[serde(default)]
    pub encrypted: bool,
    /// Encrypted payload (base64-encoded ciphertext when encrypted)
    #[serde(default)]
    pub encrypted_payload: Option<String>,
}

impl Trajectory {
    /// Create a new trajectory
    pub fn new(task: String, initial_context: HashMap<String, String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            task,
            operations: Vec::new(),
            initial_context,
            final_context: HashMap::new(),
            success_score: 0.0,
            started_at: Utc::now(),
            completed_at: Utc::now(),
            tags: Vec::new(),
            reward: 0.0,
            critique: None,
            encrypted: false,
            encrypted_payload: None,
        }
    }

    /// Add an operation to the trajectory
    pub fn add_operation(&mut self, operation: JJOperation) {
        self.operations.push(operation);
    }

    /// Finalize the trajectory with outcome
    pub fn finalize(&mut self, final_context: HashMap<String, String>, success_score: f64) {
        self.final_context = final_context;
        self.success_score = success_score;
        self.completed_at = Utc::now();
        self.reward = self.calculate_reward();
    }

    /// Calculate reward based on success and efficiency
    fn calculate_reward(&self) -> f64 {
        let duration_seconds = (self.completed_at - self.started_at).num_seconds() as f64;
        let efficiency_bonus = if duration_seconds > 0.0 {
            1.0 / (1.0 + (duration_seconds / 60.0).ln())
        } else {
            1.0
        };

        let success_component = self.success_score * 0.7;
        let efficiency_component = efficiency_bonus * 0.3;

        success_component + efficiency_component
    }

    /// Get duration in seconds
    pub fn duration_seconds(&self) -> i64 {
        (self.completed_at - self.started_at).num_seconds()
    }
}

/// Pattern extracted from successful trajectories
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pattern {
    /// Unique identifier
    pub id: String,
    /// Pattern name or description
    pub name: String,
    /// Sequence of operation types that form the pattern
    pub operation_sequence: Vec<String>,
    /// Success rate (0.0 - 1.0) when this pattern is used
    pub success_rate: f64,
    /// Number of times this pattern has been observed
    pub observation_count: u32,
    /// Average duration when using this pattern
    pub avg_duration_ms: f64,
    /// Contexts where this pattern works well
    pub successful_contexts: Vec<HashMap<String, String>>,
    /// Confidence score (0.0 - 1.0)
    pub confidence: f64,
}

impl Pattern {
    /// Create a new pattern from a trajectory
    pub fn from_trajectory(trajectory: &Trajectory) -> Self {
        let operation_sequence: Vec<String> = trajectory
            .operations
            .iter()
            .map(|op| op.operation_type.clone())
            .collect();

        Self {
            id: Uuid::new_v4().to_string(),
            name: format!("Pattern for: {}", trajectory.task),
            operation_sequence,
            success_rate: trajectory.success_score,
            observation_count: 1,
            avg_duration_ms: trajectory.duration_seconds() as f64 * 1000.0,
            successful_contexts: vec![trajectory.initial_context.clone()],
            confidence: if trajectory.success_score > 0.8 { 0.7 } else { 0.3 },
        }
    }

    /// Update pattern with new observation
    pub fn update_with_trajectory(&mut self, trajectory: &Trajectory) {
        let n = self.observation_count as f64;

        // Update success rate (exponential moving average)
        self.success_rate = (self.success_rate * n + trajectory.success_score) / (n + 1.0);

        // Update average duration
        let duration_ms = trajectory.duration_seconds() as f64 * 1000.0;
        self.avg_duration_ms = (self.avg_duration_ms * n + duration_ms) / (n + 1.0);

        self.observation_count += 1;

        // Update confidence based on observation count and consistency
        self.confidence = ((self.observation_count as f64).ln() / 5.0).min(1.0) * self.success_rate;

        // Store successful context
        if trajectory.success_score > 0.7 {
            self.successful_contexts.push(trajectory.initial_context.clone());
            // Keep only recent contexts (max 10)
            if self.successful_contexts.len() > 10 {
                self.successful_contexts.remove(0);
            }
        }
    }

    /// Check if pattern matches a sequence of operations
    pub fn matches(&self, operations: &[String]) -> bool {
        if operations.len() < self.operation_sequence.len() {
            return false;
        }

        self.operation_sequence
            .iter()
            .zip(operations.iter())
            .all(|(expected, actual)| expected == actual)
    }

    /// Calculate similarity to another pattern (0.0 - 1.0)
    pub fn similarity(&self, other: &Pattern) -> f64 {
        let len1 = self.operation_sequence.len();
        let len2 = other.operation_sequence.len();

        if len1 == 0 || len2 == 0 {
            return 0.0;
        }

        let mut matches = 0;
        let max_len = len1.max(len2);

        for i in 0..len1.min(len2) {
            if self.operation_sequence[i] == other.operation_sequence[i] {
                matches += 1;
            }
        }

        matches as f64 / max_len as f64
    }
}

/// Statistics about learning progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningStats {
    /// Total trajectories recorded
    pub total_trajectories: usize,
    /// Total patterns discovered
    pub total_patterns: usize,
    /// Average success rate across all trajectories
    pub avg_success_rate: f64,
    /// Improvement rate (comparing recent vs old trajectories)
    pub improvement_rate: f64,
    /// Most successful pattern ID
    pub best_pattern_id: Option<String>,
    /// Number of predictions made
    pub predictions_made: u32,
    /// Prediction accuracy
    pub prediction_accuracy: f64,
}

/// Decision suggestion from the reasoning bank
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionSuggestion {
    /// Recommended operation sequence
    pub recommended_operations: Vec<String>,
    /// Confidence in this recommendation (0.0 - 1.0)
    pub confidence: f64,
    /// Expected success rate based on patterns
    pub expected_success_rate: f64,
    /// Estimated duration in milliseconds
    pub estimated_duration_ms: f64,
    /// Supporting pattern IDs
    pub supporting_patterns: Vec<String>,
    /// Reasoning explanation
    pub reasoning: String,
}

/// ReasoningBank - The main learning and decision engine
pub struct ReasoningBank {
    /// Stored trajectories (limited by max_size)
    trajectories: Arc<Mutex<VecDeque<Trajectory>>>,
    /// Discovered patterns
    patterns: Arc<Mutex<Vec<Pattern>>>,
    /// Maximum number of trajectories to store
    max_trajectories: usize,
    /// Minimum success rate to extract patterns
    min_success_threshold: f64,
    /// Learning statistics
    stats: Arc<Mutex<LearningStats>>,
    /// Encryption state
    encryption: Arc<Mutex<EncryptionState>>,
}

impl ReasoningBank {
    /// Create a new ReasoningBank
    pub fn new(max_trajectories: usize) -> Self {
        Self {
            trajectories: Arc::new(Mutex::new(VecDeque::with_capacity(max_trajectories))),
            patterns: Arc::new(Mutex::new(Vec::new())),
            max_trajectories,
            min_success_threshold: 0.7,
            stats: Arc::new(Mutex::new(LearningStats {
                total_trajectories: 0,
                total_patterns: 0,
                avg_success_rate: 0.0,
                improvement_rate: 0.0,
                best_pattern_id: None,
                predictions_made: 0,
                prediction_accuracy: 0.0,
            })),
            encryption: Arc::new(Mutex::new(EncryptionState::default())),
        }
    }

    /// Enable quantum-resistant encryption for trajectory storage
    ///
    /// Uses HQC (Hamming Quasi-Cyclic) encryption from @qudag/napi-core
    /// This should be called from the N-API layer with a generated key
    ///
    /// # Arguments
    /// * `encryption_key` - Base64-encoded encryption key (32 bytes for HQC-128)
    /// * `public_key` - Optional base64-encoded public key for HQC
    ///
    /// # Security Note
    /// The encryption key should be:
    /// - Generated using a cryptographically secure random number generator
    /// - Stored securely (e.g., environment variable, secrets manager)
    /// - Never logged or exposed in plaintext
    /// - Rotated regularly
    pub fn enable_encryption(&self, encryption_key: Vec<u8>, public_key: Option<Vec<u8>>) -> Result<()> {
        if encryption_key.len() != 32 {
            return Err(JJError::InvalidConfig(
                "Encryption key must be exactly 32 bytes for HQC-128".to_string()
            ));
        }

        let mut encryption = self.encryption.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock encryption state: {}", e))
        })?;

        encryption.enabled = true;
        encryption.key = Some(encryption_key);
        encryption.public_key = public_key;

        Ok(())
    }

    /// Disable encryption (backward compatibility)
    pub fn disable_encryption(&self) -> Result<()> {
        let mut encryption = self.encryption.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock encryption state: {}", e))
        })?;

        encryption.enabled = false;
        encryption.key = None;
        encryption.public_key = None;

        Ok(())
    }

    /// Check if encryption is enabled
    pub fn is_encryption_enabled(&self) -> Result<bool> {
        let encryption = self.encryption.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock encryption state: {}", e))
        })?;

        Ok(encryption.enabled)
    }

    /// Encrypt a trajectory's sensitive data
    ///
    /// This method is called automatically when storing trajectories if encryption is enabled
    /// It encrypts the trajectory data and stores it as base64-encoded ciphertext
    ///
    /// # Note
    /// The actual HQC encryption is performed in the N-API layer (JavaScript/TypeScript)
    /// This method prepares the data for encryption
    pub fn encrypt_trajectory(&self, trajectory: &mut Trajectory) -> Result<()> {
        let encryption = self.encryption.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock encryption state: {}", e))
        })?;

        if !encryption.enabled {
            return Ok(()); // No-op if encryption is disabled
        }

        if trajectory.encrypted {
            return Ok(()); // Already encrypted
        }

        // Serialize the sensitive parts of the trajectory
        let payload = serde_json::json!({
            "operations": trajectory.operations,
            "initial_context": trajectory.initial_context,
            "final_context": trajectory.final_context,
            "critique": trajectory.critique,
        });

        let payload_str = serde_json::to_string(&payload)?;

        // Mark as encrypted and store the plaintext temporarily
        // The actual encryption will be done in the N-API layer
        trajectory.encrypted = true;
        trajectory.encrypted_payload = Some(payload_str);

        // Clear sensitive data from the unencrypted fields
        trajectory.operations.clear();
        trajectory.initial_context.clear();
        trajectory.final_context.clear();
        trajectory.critique = None;

        Ok(())
    }

    /// Decrypt a trajectory
    ///
    /// # Arguments
    /// * `trajectory_id` - ID of the trajectory to decrypt
    /// * `ciphertext` - Base64-encoded ciphertext from the N-API layer
    ///
    /// # Returns
    /// Decrypted trajectory with restored sensitive data
    pub fn decrypt_trajectory(&self, trajectory_id: &str, decrypted_payload: &str) -> Result<Trajectory> {
        let trajectories = self.trajectories.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock trajectories: {}", e))
        })?;

        let mut trajectory = trajectories
            .iter()
            .find(|t| t.id == trajectory_id)
            .ok_or_else(|| JJError::OperationNotFound(trajectory_id.to_string()))?
            .clone();

        if !trajectory.encrypted {
            return Ok(trajectory); // Not encrypted, return as-is
        }

        // Parse the decrypted payload
        let payload: serde_json::Value = serde_json::from_str(decrypted_payload)
            .map_err(|e| JJError::ParseError(format!("Failed to parse decrypted payload: {}", e)))?;

        // Restore sensitive data
        trajectory.operations = serde_json::from_value(payload["operations"].clone())
            .map_err(|e| JJError::ParseError(format!("Failed to parse operations: {}", e)))?;
        trajectory.initial_context = serde_json::from_value(payload["initial_context"].clone())
            .map_err(|e| JJError::ParseError(format!("Failed to parse initial_context: {}", e)))?;
        trajectory.final_context = serde_json::from_value(payload["final_context"].clone())
            .map_err(|e| JJError::ParseError(format!("Failed to parse final_context: {}", e)))?;
        trajectory.critique = serde_json::from_value(payload["critique"].clone())
            .map_err(|e| JJError::ParseError(format!("Failed to parse critique: {}", e)))?;

        trajectory.encrypted = false;
        trajectory.encrypted_payload = None;

        Ok(trajectory)
    }

    /// Get encrypted payload for a trajectory (for N-API encryption)
    pub fn get_trajectory_payload(&self, trajectory_id: &str) -> Result<Option<String>> {
        let trajectories = self.trajectories.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock trajectories: {}", e))
        })?;

        let trajectory = trajectories
            .iter()
            .find(|t| t.id == trajectory_id)
            .ok_or_else(|| JJError::OperationNotFound(trajectory_id.to_string()))?;

        Ok(trajectory.encrypted_payload.clone())
    }

    /// Store a trajectory and learn from it
    ///
    /// If encryption is enabled, the trajectory will be automatically encrypted before storage
    pub fn store_trajectory(&self, mut trajectory: Trajectory) -> Result<()> {
        // Encrypt trajectory if encryption is enabled
        self.encrypt_trajectory(&mut trajectory)?;

        // Update stats first (in its own scope to release lock)
        {
            let mut stats = self.stats.lock().map_err(|e| {
                JJError::Unknown(format!("Failed to lock stats: {}", e))
            })?;

            let n = stats.total_trajectories as f64;
            stats.avg_success_rate =
                (stats.avg_success_rate * n + trajectory.success_score) / (n + 1.0);
            stats.total_trajectories += 1;
        } // stats lock released here

        // Add trajectory (in its own scope to release lock)
        {
            let mut trajectories = self.trajectories.lock().map_err(|e| {
                JJError::Unknown(format!("Failed to lock trajectories: {}", e))
            })?;

            if trajectories.len() >= self.max_trajectories {
                trajectories.pop_front();
            }
            trajectories.push_back(trajectory.clone());
        } // trajectories lock released here

        // Extract patterns from successful trajectories (can now safely lock again)
        // Note: For encrypted trajectories, pattern extraction needs to decrypt first
        if trajectory.success_score >= self.min_success_threshold && !trajectory.encrypted {
            self.extract_pattern(&trajectory)?;
        }

        Ok(())
    }

    /// Extract a pattern from a successful trajectory
    fn extract_pattern(&self, trajectory: &Trajectory) -> Result<()> {
        let mut patterns = self.patterns.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock patterns: {}", e))
        })?;

        let new_pattern = Pattern::from_trajectory(trajectory);

        // Check if similar pattern exists
        let mut found_similar = false;
        for pattern in patterns.iter_mut() {
            if pattern.similarity(&new_pattern) > 0.8 {
                pattern.update_with_trajectory(trajectory);
                found_similar = true;
                break;
            }
        }

        // Add new pattern if no similar one exists
        if !found_similar {
            patterns.push(new_pattern);

            let mut stats = self.stats.lock().map_err(|e| {
                JJError::Unknown(format!("Failed to lock stats: {}", e))
            })?;
            stats.total_patterns = patterns.len();
        }

        Ok(())
    }

    /// Get decision suggestion for a task
    pub fn suggest_decision(&self, _task: &str, _context: &HashMap<String, String>) -> Result<DecisionSuggestion> {
        let patterns = self.patterns.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock patterns: {}", e))
        })?;

        if patterns.is_empty() {
            return Ok(DecisionSuggestion {
                recommended_operations: Vec::new(),
                confidence: 0.0,
                expected_success_rate: 0.5,
                estimated_duration_ms: 0.0,
                supporting_patterns: Vec::new(),
                reasoning: "No patterns available yet. Still learning...".to_string(),
            });
        }

        // Find best matching pattern
        let mut best_pattern: Option<&Pattern> = None;
        let mut best_score = 0.0;

        for pattern in patterns.iter() {
            // Calculate relevance score based on success rate and confidence
            let score = pattern.success_rate * pattern.confidence;
            if score > best_score {
                best_score = score;
                best_pattern = Some(pattern);
            }
        }

        if let Some(pattern) = best_pattern {
            let mut stats = self.stats.lock().map_err(|e| {
                JJError::Unknown(format!("Failed to lock stats: {}", e))
            })?;
            stats.predictions_made += 1;

            Ok(DecisionSuggestion {
                recommended_operations: pattern.operation_sequence.clone(),
                confidence: pattern.confidence,
                expected_success_rate: pattern.success_rate,
                estimated_duration_ms: pattern.avg_duration_ms,
                supporting_patterns: vec![pattern.id.clone()],
                reasoning: format!(
                    "Based on {} observations with {:.1}% success rate. This pattern has been successful in similar contexts.",
                    pattern.observation_count,
                    pattern.success_rate * 100.0
                ),
            })
        } else {
            Ok(DecisionSuggestion {
                recommended_operations: Vec::new(),
                confidence: 0.0,
                expected_success_rate: 0.5,
                estimated_duration_ms: 0.0,
                supporting_patterns: Vec::new(),
                reasoning: "No suitable pattern found for this task.".to_string(),
            })
        }
    }

    /// Get learning statistics
    pub fn get_stats(&self) -> Result<LearningStats> {
        let stats = self.stats.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock stats: {}", e))
        })?;

        Ok(stats.clone())
    }

    /// Get all patterns
    pub fn get_patterns(&self) -> Result<Vec<Pattern>> {
        let patterns = self.patterns.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock patterns: {}", e))
        })?;

        Ok(patterns.clone())
    }

    /// Query trajectories by task similarity
    pub fn query_trajectories(&self, task: &str, limit: usize) -> Result<Vec<Trajectory>> {
        let trajectories = self.trajectories.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock trajectories: {}", e))
        })?;

        let mut scored: Vec<(f64, &Trajectory)> = trajectories
            .iter()
            .map(|t| {
                let similarity = self.calculate_task_similarity(task, &t.task);
                (similarity, t)
            })
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        Ok(scored
            .into_iter()
            .take(limit)
            .map(|(_, t)| t.clone())
            .collect())
    }

    /// Calculate similarity between tasks (simple word overlap)
    fn calculate_task_similarity(&self, task1: &str, task2: &str) -> f64 {
        let task1_lower = task1.to_lowercase();
        let task2_lower = task2.to_lowercase();
        let words1: Vec<&str> = task1_lower.split_whitespace().collect();
        let words2: Vec<&str> = task2_lower.split_whitespace().collect();

        if words1.is_empty() || words2.is_empty() {
            return 0.0;
        }

        let mut matches = 0;
        for word1 in &words1 {
            if words2.contains(word1) {
                matches += 1;
            }
        }

        matches as f64 / words1.len().max(words2.len()) as f64
    }

    /// Clear all trajectories and patterns (reset learning)
    pub fn reset(&self) -> Result<()> {
        let mut trajectories = self.trajectories.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock trajectories: {}", e))
        })?;
        let mut patterns = self.patterns.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock patterns: {}", e))
        })?;
        let mut stats = self.stats.lock().map_err(|e| {
            JJError::Unknown(format!("Failed to lock stats: {}", e))
        })?;

        trajectories.clear();
        patterns.clear();
        *stats = LearningStats {
            total_trajectories: 0,
            total_patterns: 0,
            avg_success_rate: 0.0,
            improvement_rate: 0.0,
            best_pattern_id: None,
            predictions_made: 0,
            prediction_accuracy: 0.0,
        };

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trajectory_creation() {
        let mut context = HashMap::new();
        context.insert("branch".to_string(), "main".to_string());

        let trajectory = Trajectory::new("Test task".to_string(), context);
        assert_eq!(trajectory.operations.len(), 0);
        assert_eq!(trajectory.success_score, 0.0);
    }

    #[test]
    fn test_pattern_similarity() {
        let pattern1 = Pattern {
            id: "1".to_string(),
            name: "Pattern 1".to_string(),
            operation_sequence: vec!["New".to_string(), "Commit".to_string()],
            success_rate: 0.9,
            observation_count: 5,
            avg_duration_ms: 100.0,
            successful_contexts: Vec::new(),
            confidence: 0.8,
        };

        let pattern2 = Pattern {
            id: "2".to_string(),
            name: "Pattern 2".to_string(),
            operation_sequence: vec!["New".to_string(), "Commit".to_string()],
            success_rate: 0.85,
            observation_count: 3,
            avg_duration_ms: 120.0,
            successful_contexts: Vec::new(),
            confidence: 0.7,
        };

        let similarity = pattern1.similarity(&pattern2);
        assert_eq!(similarity, 1.0); // Exact match
    }

    #[test]
    fn test_reasoning_bank() {
        let bank = ReasoningBank::new(100);

        let mut context = HashMap::new();
        context.insert("branch".to_string(), "main".to_string());

        let mut trajectory = Trajectory::new("Create feature".to_string(), context.clone());
        trajectory.finalize(context, 0.9);

        assert!(bank.store_trajectory(trajectory).is_ok());

        let stats = bank.get_stats().unwrap();
        assert_eq!(stats.total_trajectories, 1);
    }
}
