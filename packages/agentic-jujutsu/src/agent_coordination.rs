/**
 * Agent Coordination Module
 *
 * Multi-agent coordination using QuantumDAG for conflict detection and resolution.
 * Integrates @qudag/napi-core for quantum-resistant security.
 */

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::operations::JJOperation;
use crate::Result;

/// Agent information stored in coordination system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    /// Unique agent identifier
    pub agent_id: String,
    /// Agent type (coder, reviewer, tester, etc.)
    pub agent_type: String,
    /// Number of operations performed
    pub operations_count: u64,
    /// Agent reputation score (0.0-1.0)
    pub reputation: f64,
    /// Last activity timestamp
    pub last_seen: DateTime<Utc>,
}

/// Message representing an agent operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    /// Agent that performed the operation
    pub agent_id: String,
    /// Unique operation identifier
    pub operation_id: String,
    /// Type of operation performed
    pub operation_type: String,
    /// Files/resources affected by operation
    pub affected_resources: Vec<String>,
    /// Operation timestamp
    pub timestamp: DateTime<Utc>,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

/// Conflict between agent operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConflict {
    /// First operation ID
    pub operation_a: String,
    /// Second operation ID
    pub operation_b: String,
    /// Agents involved in conflict
    pub agents: Vec<String>,
    /// Resources that conflict
    pub conflicting_resources: Vec<String>,
    /// Conflict severity (0=none, 1=minor, 2=moderate, 3=severe)
    pub severity: u8,
    /// Human-readable description
    pub description: String,
    /// Suggested resolution strategy
    pub resolution_strategy: String,
}

/// Statistics about agent activity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStats {
    /// Agent identifier
    pub agent_id: String,
    /// Agent type
    pub agent_type: String,
    /// Total operations performed
    pub operations_count: u64,
    /// Agent reputation (0.0-1.0)
    pub reputation: f64,
    /// Last activity timestamp (ISO 8601)
    pub last_seen: String,
}

/// Overall coordination statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoordinationStats {
    /// Total registered agents
    pub total_agents: usize,
    /// Currently active agents
    pub active_agents: usize,
    /// Total operations registered
    pub total_operations: usize,
    /// DAG vertices count (if using QuantumDAG)
    pub dag_vertices: usize,
    /// Current DAG tips (if using QuantumDAG)
    pub current_tips: usize,
}

/// Conflict detection rules
pub struct ConflictRules {
    /// Exclusive operation patterns that cannot run concurrently
    exclusive_patterns: Vec<(String, String)>,
}

impl ConflictRules {
    /// Create new conflict rules with default patterns
    pub fn new() -> Self {
        Self {
            exclusive_patterns: vec![
                // Same file edits
                ("edit".to_string(), "edit".to_string()),
                // Rebase conflicts with most operations
                ("rebase".to_string(), "edit".to_string()),
                ("rebase".to_string(), "rebase".to_string()),
                // Branch operations
                ("branch-create".to_string(), "branch-create".to_string()),
                ("branch-delete".to_string(), "branch-delete".to_string()),
            ],
        }
    }

    /// Check if two operations are exclusive
    pub fn are_exclusive(&self, op_a: &str, op_b: &str) -> bool {
        self.exclusive_patterns.iter().any(|(a, b)| {
            (a == op_a && b == op_b) || (a == op_b && b == op_a)
        })
    }
}

impl Default for ConflictRules {
    fn default() -> Self {
        Self::new()
    }
}

/// Agent coordination system
pub struct AgentCoordination {
    /// Registered agents
    agents: Arc<Mutex<HashMap<String, AgentInfo>>>,
    /// Operation messages
    operations: Arc<Mutex<Vec<AgentMessage>>>,
    /// Conflict detection rules
    conflict_rules: Arc<ConflictRules>,
    /// QuantumDAG enabled flag (integrated via JavaScript bridge at @qudag/napi-core)
    quantum_enabled: bool,
    /// DAG vertex IDs (managed by JavaScript quantum bridge)
    dag_vertices: Arc<Mutex<HashMap<String, String>>>, // operation_id -> vertex_id
    /// DAG tips cache (updated from JavaScript bridge)
    dag_tips: Arc<Mutex<Vec<String>>>,
}

impl AgentCoordination {
    /// Create new coordination system
    pub fn new() -> Self {
        Self {
            agents: Arc::new(Mutex::new(HashMap::new())),
            operations: Arc::new(Mutex::new(Vec::new())),
            conflict_rules: Arc::new(ConflictRules::new()),
            quantum_enabled: false,
            dag_vertices: Arc::new(Mutex::new(HashMap::new())),
            dag_tips: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Enable QuantumDAG features (JavaScript bridge required)
    pub fn enable_quantum(&mut self) {
        self.quantum_enabled = true;
    }

    /// Check if QuantumDAG is enabled
    pub fn is_quantum_enabled(&self) -> bool {
        self.quantum_enabled
    }

    /// Register DAG vertex (called from JavaScript bridge)
    pub async fn register_dag_vertex(&self, operation_id: String, vertex_id: String) -> Result<()> {
        let mut vertices = self.dag_vertices.lock().await;
        vertices.insert(operation_id, vertex_id);
        Ok(())
    }

    /// Update DAG tips (called from JavaScript bridge)
    pub async fn update_dag_tips(&self, tips: Vec<String>) -> Result<()> {
        let mut dag_tips = self.dag_tips.lock().await;
        *dag_tips = tips;
        Ok(())
    }

    /// Get DAG vertex ID for operation
    pub async fn get_dag_vertex(&self, operation_id: &str) -> Result<Option<String>> {
        let vertices = self.dag_vertices.lock().await;
        Ok(vertices.get(operation_id).cloned())
    }

    /// Register a new agent
    pub async fn register_agent(&self, agent_id: String, agent_type: String) -> Result<()> {
        let mut agents = self.agents.lock().await;

        agents.insert(
            agent_id.clone(),
            AgentInfo {
                agent_id,
                agent_type,
                operations_count: 0,
                reputation: 1.0,
                last_seen: Utc::now(),
            },
        );

        Ok(())
    }

    /// Register an agent operation
    pub async fn register_operation(
        &self,
        agent_id: &str,
        operation: &JJOperation,
        affected_files: Vec<String>,
    ) -> Result<String> {
        // Update agent info
        {
            let mut agents = self.agents.lock().await;
            if let Some(agent) = agents.get_mut(agent_id) {
                agent.operations_count += 1;
                agent.last_seen = Utc::now();
            }
        }

        // Create message
        // Parse metadata string to HashMap if it's JSON, otherwise create empty
        let metadata = serde_json::from_str::<HashMap<String, String>>(&operation.metadata)
            .unwrap_or_else(|_| HashMap::new());

        let message = AgentMessage {
            agent_id: agent_id.to_string(),
            operation_id: operation.id.clone(),
            operation_type: operation.operation_type.clone(),
            affected_resources: affected_files,
            timestamp: Utc::now(),
            metadata,
        };

        // Store message
        let mut operations = self.operations.lock().await;
        operations.push(message.clone());

        // In future, this will add to QuantumDAG
        // For now, return operation ID
        Ok(operation.id.clone())
    }

    /// Check for conflicts with proposed operation
    pub async fn check_conflicts(
        &self,
        operation_id: &str,
        operation_type: &str,
        affected_files: Vec<String>,
    ) -> Result<Vec<AgentConflict>> {
        let operations = self.operations.lock().await;
        let mut conflicts = Vec::new();

        // Get recent operations (last 100)
        let recent_ops: Vec<_> = operations.iter().rev().take(100).collect();

        for op in recent_ops {
            // Skip if same operation
            if op.operation_id == operation_id {
                continue;
            }

            // Check for file conflicts
            let conflicting_files: Vec<String> = affected_files
                .iter()
                .filter(|f| op.affected_resources.contains(f))
                .cloned()
                .collect();

            if !conflicting_files.is_empty() {
                // Determine severity and resolution strategy
                let (severity, description, strategy) = self.analyze_conflict(
                    operation_type,
                    &op.operation_type,
                    &conflicting_files,
                );

                if severity > 0 {
                    conflicts.push(AgentConflict {
                        operation_a: operation_id.to_string(),
                        operation_b: op.operation_id.clone(),
                        agents: vec![op.agent_id.clone()],
                        conflicting_resources: conflicting_files,
                        severity,
                        description,
                        resolution_strategy: strategy,
                    });
                }
            }
        }

        Ok(conflicts)
    }

    /// Analyze conflict severity
    fn analyze_conflict(
        &self,
        op_a: &str,
        op_b: &str,
        files: &[String],
    ) -> (u8, String, String) {
        // Normalize operation types
        let op_a_lower = op_a.to_lowercase();
        let op_b_lower = op_b.to_lowercase();

        // Check if operations are exclusive
        if self.conflict_rules.are_exclusive(&op_a_lower, &op_b_lower) {
            return (
                3,
                format!(
                    "Severe conflict: {} and {} operations on same files: {}",
                    op_a,
                    op_b,
                    files.join(", ")
                ),
                "manual_resolution".to_string(),
            );
        }

        // Check for moderate conflicts (same operation type)
        if op_a_lower == op_b_lower {
            return (
                2,
                format!(
                    "Moderate conflict: Multiple {} operations on: {}",
                    op_a,
                    files.join(", ")
                ),
                "sequential_execution".to_string(),
            );
        }

        // Minor conflict (different operations, same files)
        (
            1,
            format!(
                "Minor conflict: {} and {} operations may interfere on: {}",
                op_a,
                op_b,
                files.join(", ")
            ),
            "auto_merge".to_string(),
        )
    }

    /// Get agent statistics
    pub async fn get_agent_stats(&self, agent_id: &str) -> Result<Option<AgentStats>> {
        let agents = self.agents.lock().await;

        Ok(agents.get(agent_id).map(|info| AgentStats {
            agent_id: info.agent_id.clone(),
            agent_type: info.agent_type.clone(),
            operations_count: info.operations_count,
            reputation: info.reputation,
            last_seen: info.last_seen.to_rfc3339(),
        }))
    }

    /// List all registered agents
    pub async fn list_agents(&self) -> Result<Vec<AgentStats>> {
        let agents = self.agents.lock().await;

        Ok(agents.values().map(|info| AgentStats {
            agent_id: info.agent_id.clone(),
            agent_type: info.agent_type.clone(),
            operations_count: info.operations_count,
            reputation: info.reputation,
            last_seen: info.last_seen.to_rfc3339(),
        }).collect())
    }

    /// Get coordination statistics
    pub async fn get_stats(&self) -> Result<CoordinationStats> {
        let agents = self.agents.lock().await;
        let operations = self.operations.lock().await;
        let vertices = self.dag_vertices.lock().await;
        let tips = self.dag_tips.lock().await;

        // Count active agents (seen in last hour)
        let one_hour_ago = Utc::now() - chrono::Duration::hours(1);
        let active_agents = agents
            .values()
            .filter(|a| a.last_seen > one_hour_ago)
            .count();

        Ok(CoordinationStats {
            total_agents: agents.len(),
            active_agents,
            total_operations: operations.len(),
            dag_vertices: vertices.len(),
            current_tips: tips.len(),
        })
    }

    /// Get coordination tips (DAG tips for coordination)
    pub async fn get_coordination_tips(&self) -> Result<Vec<String>> {
        let tips = self.dag_tips.lock().await;
        Ok(tips.clone())
    }
}

impl Default for AgentCoordination {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_agent_registration() {
        let coord = AgentCoordination::new();

        coord.register_agent("agent-1".to_string(), "coder".to_string())
            .await
            .unwrap();

        let stats = coord.get_agent_stats("agent-1").await.unwrap();
        assert!(stats.is_some());
        assert_eq!(stats.unwrap().agent_type, "coder");
    }

    #[tokio::test]
    async fn test_conflict_detection() {
        let coord = AgentCoordination::new();

        // Register operation. The second argument of `JJOperation::new` is the
        // *command*, not the operation type, so the type must be set explicitly
        // for the conflict analyzer to see this as an `edit` operation.
        let mut op = JJOperation::new(
            "op-1".to_string(),
            "jj edit".to_string(),
            "test".to_string(),
            "localhost".to_string(),
        );
        op.set_operation_type("edit".to_string());

        coord.register_operation("agent-1", &op, vec!["file.rs".to_string()])
            .await
            .unwrap();

        // Check for conflicts
        let conflicts = coord.check_conflicts(
            "op-2",
            "edit",
            vec!["file.rs".to_string()],
        ).await.unwrap();

        assert!(!conflicts.is_empty());
        assert!(conflicts[0].severity >= 2); // Moderate or severe
    }
}
