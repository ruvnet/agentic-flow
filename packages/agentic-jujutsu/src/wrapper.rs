//! Main wrapper for Jujutsu operations

use crate::{
    agent_coordination::AgentCoordination,
    config::JJConfig,
    error::{JJError, Result},
    operations::{JJOperation, JJOperationLog, OperationType},
    reasoning_bank::{ReasoningBank, Trajectory},
    types::{JJBranch, JJCommit, JJConflict, JJDiff, JJResult},
    native::execute_jj_command,
};
use chrono::Utc;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use std::path::PathBuf;
use std::fs;
use std::io::Write;

// Include the embedded jj binary
const JJ_BINARY: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/jj"));

/// Extract embedded jj binary to cache directory
fn extract_embedded_binary() -> Result<PathBuf> {
    // Get cache directory path
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());

    let cache_dir = PathBuf::from(home)
        .join(".cache")
        .join("agentic-jujutsu");

    // Create cache directory if it doesn't exist
    fs::create_dir_all(&cache_dir)
        .map_err(|e| JJError::IoError(format!("Failed to create cache directory: {}", e)))?;

    let binary_path = cache_dir.join("jj");

    // Check if binary is already extracted and valid
    if binary_path.exists() {
        // Verify it's not a placeholder
        if let Ok(content) = fs::read(&binary_path) {
            if content.len() > 100 && content != b"SYSTEM_JJ" {
                return Ok(binary_path);
            }
        }
    }

    // Check if this is a placeholder indicating system jj should be used
    if JJ_BINARY == b"SYSTEM_JJ" {
        // Return "jj" to use system PATH
        return Ok(PathBuf::from("jj"));
    }

    // Extract embedded binary
    let mut file = fs::File::create(&binary_path)
        .map_err(|e| JJError::IoError(format!("Failed to create jj binary file: {}", e)))?;

    file.write_all(JJ_BINARY)
        .map_err(|e| JJError::IoError(format!("Failed to write jj binary: {}", e)))?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&binary_path)
            .map_err(|e| JJError::IoError(format!("Failed to get permissions: {}", e)))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary_path, perms)
            .map_err(|e| JJError::IoError(format!("Failed to set permissions: {}", e)))?;
    }

    Ok(binary_path)
}

/// Validate command arguments to prevent command injection
fn validate_command_args(args: &[&str]) -> Result<()> {
    for arg in args {
        // Block shell metacharacters that could enable command injection
        if arg.contains(&['$', '`', '&', '|', ';', '\n', '>', '<'][..]) {
            return Err(JJError::InvalidConfig(format!(
                "Invalid character in argument: {}. Shell metacharacters are not allowed.",
                arg
            )));
        }
        // Block null bytes
        if arg.contains('\0') {
            return Err(JJError::InvalidConfig(
                "Null bytes are not allowed in arguments".to_string(),
            ));
        }
    }
    Ok(())
}

/// Main wrapper for Jujutsu operations
#[napi]
#[derive(Clone)]
pub struct JJWrapper {
    config: JJConfig,
    operation_log: Arc<Mutex<JJOperationLog>>,
    reasoning_bank: Arc<ReasoningBank>,
    current_trajectory: Arc<Mutex<Option<Trajectory>>>,
    agent_coordination: Arc<tokio::sync::Mutex<Option<AgentCoordination>>>,
    /// Cached result of whether the configured jj uses the `bookmark` subcommand
    /// (jj >= 0.21) instead of the legacy `branch` subcommand. Probed once lazily.
    bookmark_subcommand: Arc<tokio::sync::OnceCell<bool>>,
}

#[napi]
impl JJWrapper {
    /// Create a new JJWrapper with default configuration
    #[napi(constructor)]
    pub fn new() -> napi::Result<JJWrapper> {
        // Extract embedded binary and get its path
        let jj_path = extract_embedded_binary()
            .map_err(|e| napi::Error::from_reason(format!("Failed to extract jj binary: {}", e)))?;

        // Create config with extracted binary path
        let mut config = JJConfig::default();
        config.jj_path = jj_path.to_string_lossy().to_string();

        Self::with_config(config)
            .map_err(|e| napi::Error::from_reason(format!("Failed to create JJWrapper: {}", e)))
    }

    /// Create a new JJWrapper with custom configuration
    #[napi]
    pub fn with_config(config: JJConfig) -> napi::Result<JJWrapper> {
        let operation_log = Arc::new(Mutex::new(JJOperationLog::new(config.max_log_entries as usize)));
        let reasoning_bank = Arc::new(ReasoningBank::new(1000)); // Store up to 1000 trajectories
        let current_trajectory = Arc::new(Mutex::new(None));
        let agent_coordination = Arc::new(tokio::sync::Mutex::new(None));

        Ok(JJWrapper {
            config,
            operation_log,
            reasoning_bank,
            current_trajectory,
            agent_coordination,
            bookmark_subcommand: Arc::new(tokio::sync::OnceCell::new()),
        })
    }

    /// Get the current configuration
    #[napi(js_name = "getConfig")]
    pub fn get_config(&self) -> JJConfig {
        self.config.clone()
    }

    /// Get operation log statistics as JSON string
    #[napi(js_name = "getStats")]
    pub fn get_stats(&self) -> String {
        let log = self.operation_log.lock().unwrap();
        serde_json::json!({
            "total_operations": log.count(),
            "avg_duration_ms": log.avg_duration_ms(),
            "success_rate": log.success_rate(),
        })
        .to_string()
    }

    /// Execute a jj command and return the result
    #[napi]
    pub async fn execute(&self, args: Vec<String>) -> napi::Result<JJResult> {
        // Convert Vec<String> to Vec<&str> for internal processing
        let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        // Validate arguments for security
        validate_command_args(&args_refs)
            .map_err(|e| napi::Error::from_reason(format!("Invalid arguments: {}", e)))?;

        let start = Instant::now();
        let command = format!("jj {}", args.join(" "));
        let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown".to_string());
        let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());

        // Execute command with timeout
        let timeout = std::time::Duration::from_millis(self.config.timeout_ms as u64);
        let result = execute_jj_command(&self.config.jj_path, &args_refs, timeout).await;

        // Log the operation (ALWAYS, even if failed)
        let duration_ms = start.elapsed().as_millis() as u64;
        let mut operation = JJOperation::new(
            format!("{}@{}", Utc::now().timestamp(), hostname),
            command.clone(),
            username.clone(),
            hostname.clone(),
        );

        operation.operation_type = Self::detect_operation_type(&args_refs).as_string();
        operation.duration_ms = duration_ms as u32;

        match &result {
            Ok(output) => {
                operation.success = true;
                let jj_result = JJResult::new(output.clone(), String::new(), 0, duration_ms);
                self.operation_log.lock().unwrap().add_operation(operation);
                Ok(jj_result)
            }
            Err(e) => {
                operation.success = false;
                operation.error = Some(e.to_string());
                self.operation_log.lock().unwrap().add_operation(operation);
                Err(napi::Error::from_reason(format!("Command failed: {}", e)))
            }
        }
    }

    /// Detect operation type from command arguments
    fn detect_operation_type(args: &[&str]) -> OperationType {
        if args.is_empty() {
            return OperationType::Unknown;
        }

        match args[0] {
            "describe" => OperationType::Describe,
            "new" => OperationType::New,
            "edit" => OperationType::Edit,
            "abandon" => OperationType::Abandon,
            "rebase" => OperationType::Rebase,
            "squash" => OperationType::Squash,
            "resolve" => OperationType::Resolve,
            "branch" => OperationType::Branch,
            "bookmark" => OperationType::Bookmark,
            "git" if args.len() > 1 && args[1] == "fetch" => OperationType::GitFetch,
            "git" if args.len() > 1 && args[1] == "push" => OperationType::GitPush,
            "undo" => OperationType::Undo,
            "restore" => OperationType::Restore,
            "status" => OperationType::Status,
            "log" => OperationType::Log,
            "diff" => OperationType::Diff,
            _ => OperationType::Unknown,
        }
    }

    /// Get operations from the operation log
    #[napi(js_name = "getOperations")]
    pub fn get_operations(&self, limit: u32) -> napi::Result<Vec<JJOperation>> {
        Ok(self.operation_log.lock().unwrap().get_recent(limit as usize))
    }

    /// Get user-initiated operations (exclude snapshots)
    #[napi(js_name = "getUserOperations")]
    pub fn get_user_operations(&self, limit: u32) -> napi::Result<Vec<JJOperation>> {
        Ok(self
            .operation_log
            .lock()
            .unwrap()
            .get_user_operations(limit as usize))
    }

    /// Get conflicts in the current commit or specified commit
    #[napi(js_name = "getConflicts")]
    pub async fn get_conflicts(&self, commit: Option<String>) -> napi::Result<Vec<JJConflict>> {
        let args = if let Some(c) = commit {
            vec!["resolve".to_string(), "--list".to_string(), "-r".to_string(), c]
        } else {
            vec!["resolve".to_string(), "--list".to_string()]
        };

        let result = self.execute(args).await?;
        Self::parse_conflicts(&result.stdout)
            .map_err(|e| napi::Error::from_reason(format!("Failed to parse conflicts: {}", e)))
    }

    /// Parse conflict list output
    fn parse_conflicts(output: &str) -> Result<Vec<JJConflict>> {
        let mut conflicts = Vec::new();

        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("No conflicts") {
                continue;
            }

            // Parse format: "path/to/file    2-sided conflict"
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let path = parts[0].to_string();
                let conflict_info = parts[1..].join(" ");

                let num_conflicts = conflict_info
                    .split('-')
                    .next()
                    .and_then(|s| s.trim().parse::<usize>().ok())
                    .unwrap_or(1);

                let mut conflict = JJConflict::new(path, num_conflicts as u32, "content".to_string());

                // Extract number of sides
                if conflict_info.contains("sided") {
                    for _ in 0..num_conflicts {
                        conflict.add_side(format!("side-{}", conflicts.len()));
                    }
                }

                conflicts.push(conflict);
            }
        }

        Ok(conflicts)
    }

    /// Describe the current commit with a message
    #[napi]
    pub async fn describe(&self, message: String) -> napi::Result<JJOperation> {
        let args = vec!["describe".to_string(), "-m".to_string(), message];
        let result = self.execute(args).await?;

        if !result.success() {
            return Err(napi::Error::from_reason(format!("Command failed: {}", result.stderr)));
        }

        // Return the most recent operation
        self.get_operations(1)?
            .into_iter()
            .next()
            .ok_or_else(|| napi::Error::from_reason("No operations found"))
    }

    /// Get repository status
    #[napi]
    pub async fn status(&self) -> napi::Result<JJResult> {
        self.execute(vec!["status".to_string()]).await
    }

    /// Get diff between two commits
    #[napi]
    pub async fn diff(&self, from: String, to: String) -> napi::Result<JJDiff> {
        let args = vec!["diff".to_string(), "--from".to_string(), from, "--to".to_string(), to];
        let result = self.execute(args).await?;

        Self::parse_diff(&result.stdout)
            .map_err(|e| napi::Error::from_reason(format!("Failed to parse diff: {}", e)))
    }

    /// Parse diff output
    fn parse_diff(output: &str) -> Result<JJDiff> {
        let mut diff = JJDiff::new();
        diff.content = output.to_string();

        for line in output.lines() {
            if line.starts_with("+++") {
                // Added file
                if let Some(path) = line.strip_prefix("+++ ") {
                    let path = path.trim_start_matches("b/");
                    if path != "/dev/null" {
                        diff.added.push(path.to_string());
                    }
                }
            } else if line.starts_with("---") {
                // Deleted file
                if let Some(path) = line.strip_prefix("--- ") {
                    let path = path.trim_start_matches("a/");
                    if path != "/dev/null" {
                        diff.deleted.push(path.to_string());
                    }
                }
            } else if line.starts_with("+") && !line.starts_with("+++") {
                diff.additions += 1;
            } else if line.starts_with("-") && !line.starts_with("---") {
                diff.deletions += 1;
            }
        }

        Ok(diff)
    }

    /// Create a new commit (renamed from 'new' to avoid confusion with constructor)
    #[napi(js_name = "newCommit")]
    pub async fn new_commit(&self, message: Option<String>) -> napi::Result<JJResult> {
        let mut args = vec!["new".to_string()];
        if let Some(msg) = message {
            args.push("-m".to_string());
            args.push(msg);
        }
        self.execute(args).await
    }

    /// Edit a commit
    #[napi]
    pub async fn edit(&self, revision: String) -> napi::Result<JJResult> {
        self.execute(vec!["edit".to_string(), revision]).await
    }

    /// Abandon a commit
    #[napi]
    pub async fn abandon(&self, revision: String) -> napi::Result<JJResult> {
        self.execute(vec!["abandon".to_string(), revision]).await
    }

    /// Squash commits
    #[napi]
    pub async fn squash(&self, from: Option<String>, to: Option<String>) -> napi::Result<JJResult> {
        let mut args = vec!["squash".to_string()];
        if let Some(f) = from {
            args.push("-r".to_string());
            args.push(f);
        }
        if let Some(t) = to {
            args.push("--into".to_string());
            args.push(t);
        }
        self.execute(args).await
    }

    /// Rebase commits
    #[napi]
    pub async fn rebase(&self, source: String, destination: String) -> napi::Result<JJResult> {
        self.execute(vec![
            "rebase".to_string(),
            "-s".to_string(),
            source,
            "-d".to_string(),
            destination,
        ])
        .await
    }

    /// Resolve conflicts
    #[napi]
    pub async fn resolve(&self, path: Option<String>) -> napi::Result<JJResult> {
        let mut args = vec!["resolve".to_string()];
        if let Some(p) = path {
            args.push(p);
        }
        self.execute(args).await
    }

    /// Create a branch (bookmark on jj >= 0.21)
    #[napi(js_name = "branchCreate")]
    pub async fn branch_create(&self, name: String, revision: Option<String>) -> napi::Result<JJResult> {
        let sub = self.bookmark_subcommand_name().await;
        let mut args = vec![sub.to_string(), "create".to_string(), name];
        if let Some(rev) = revision {
            args.push("-r".to_string());
            args.push(rev);
        }
        self.execute(args).await
    }

    /// Delete a branch (bookmark on jj >= 0.21)
    #[napi(js_name = "branchDelete")]
    pub async fn branch_delete(&self, name: String) -> napi::Result<JJResult> {
        let sub = self.bookmark_subcommand_name().await;
        self.execute(vec![sub.to_string(), "delete".to_string(), name]).await
    }

    /// List branches (bookmarks on jj >= 0.21)
    #[napi(js_name = "branchList")]
    pub async fn branch_list(&self) -> napi::Result<Vec<JJBranch>> {
        let sub = self.bookmark_subcommand_name().await;
        let result = self.execute(vec![sub.to_string(), "list".to_string()]).await?;
        Self::parse_branches(&result.stdout)
            .map_err(|e| napi::Error::from_reason(format!("Failed to parse branches: {}", e)))
    }

    /// Parse branch list output
    fn parse_branches(output: &str) -> Result<Vec<JJBranch>> {
        let mut branches = Vec::new();

        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // Parse format: "branch-name: commit-id"
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 2 {
                let name = parts[0].trim().to_string();
                let target = parts[1]
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_string();

                let is_remote = name.contains('/');
                let mut branch = JJBranch::new(name.clone(), target, is_remote);

                if is_remote {
                    if let Some((remote, _)) = name.split_once('/') {
                        branch.set_remote(remote.to_string());
                    }
                }

                branches.push(branch);
            }
        }

        Ok(branches)
    }

    /// Undo the last operation
    #[napi]
    pub async fn undo(&self) -> napi::Result<JJResult> {
        self.execute(vec!["undo".to_string()]).await
    }

    /// Restore files
    #[napi]
    pub async fn restore(&self, paths: Vec<String>) -> napi::Result<JJResult> {
        let mut args = vec!["restore".to_string()];
        args.extend(paths);
        self.execute(args).await
    }

    /// Show commit log
    #[napi]
    pub async fn log(&self, limit: Option<u32>) -> napi::Result<Vec<JJCommit>> {
        let mut args = vec!["log".to_string()];
        if let Some(l) = limit {
            args.push("--limit".to_string());
            args.push(l.to_string());
        }
        let result = self.execute(args).await?;
        Self::parse_log(&result.stdout)
            .map_err(|e| napi::Error::from_reason(format!("Failed to parse log: {}", e)))
    }

    /// Parse log output
    fn parse_log(output: &str) -> Result<Vec<JJCommit>> {
        let mut commits = Vec::new();

        // Simple parser - in production, use `jj log --template` with JSON output
        for block in output.split("\n\n") {
            let lines: Vec<&str> = block.lines().collect();
            if lines.is_empty() {
                continue;
            }

            let mut commit = JJCommit::new(
                "unknown".to_string(),
                "unknown".to_string(),
                String::new(),
                "unknown".to_string(),
                "unknown@example.com".to_string(),
            );

            for line in lines {
                if let Some(id) = line.strip_prefix("Commit ID: ") {
                    commit.id = id.trim().to_string();
                } else if let Some(change) = line.strip_prefix("Change ID: ") {
                    commit.change_id = change.trim().to_string();
                } else if let Some(author) = line.strip_prefix("Author: ") {
                    let parts: Vec<&str> = author.split('<').collect();
                    if parts.len() == 2 {
                        commit.author = parts[0].trim().to_string();
                        commit.author_email = parts[1].trim_end_matches('>').trim().to_string();
                    }
                }
            }

            commits.push(commit);
        }

        Ok(commits)
    }

    /// Clear operation log
    #[napi(js_name = "clearLog")]
    pub fn clear_log(&self) {
        self.operation_log.lock().unwrap().clear();
    }

    // ========== REASONING BANK METHODS ==========

    /// Start a learning trajectory for a task
    #[napi(js_name = "startTrajectory")]
    pub fn start_trajectory(&self, task: String) -> napi::Result<String> {
        let mut context = HashMap::new();

        // Try to get current branch as context
        if let Ok(result) = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(self.status()) {
            context.insert("status".to_string(), result.stdout);
        }

        let trajectory = Trajectory::new(task, context);
        let trajectory_id = trajectory.id.clone();

        let mut current = self.current_trajectory.lock().map_err(|e| {
            napi::Error::from_reason(format!("Failed to lock trajectory: {}", e))
        })?;
        *current = Some(trajectory);

        Ok(trajectory_id)
    }

    /// Add current operations to the active trajectory
    #[napi(js_name = "addToTrajectory")]
    pub fn add_to_trajectory(&self) -> napi::Result<()> {
        let mut current = self.current_trajectory.lock().map_err(|e| {
            napi::Error::from_reason(format!("Failed to lock trajectory: {}", e))
        })?;

        if let Some(ref mut trajectory) = *current {
            let operations = self.operation_log.lock().map_err(|e| {
                napi::Error::from_reason(format!("Failed to lock operations: {}", e))
            })?;

            // Get recent operations not yet in trajectory
            let recent_ops = operations.get_recent(10);
            for op in recent_ops {
                if !trajectory.operations.iter().any(|existing| existing.id == op.id) {
                    trajectory.add_operation(op);
                }
            }
        }

        Ok(())
    }

    /// Finalize trajectory with success score and store it
    #[napi(js_name = "finalizeTrajectory")]
    pub fn finalize_trajectory(&self, success_score: f64, critique: Option<String>) -> napi::Result<()> {
        let mut current = self.current_trajectory.lock().map_err(|e| {
            napi::Error::from_reason(format!("Failed to lock trajectory: {}", e))
        })?;

        if let Some(mut trajectory) = current.take() {
            let final_context = HashMap::new();
            // Note: Removed async status() call to avoid runtime deadlock
            // Users can add custom context before finalizing if needed

            trajectory.finalize(final_context, success_score);
            if let Some(c) = critique {
                trajectory.critique = Some(c);
            }

            // Store in reasoning bank
            self.reasoning_bank.store_trajectory(trajectory).map_err(|e| {
                napi::Error::from_reason(format!("Failed to store trajectory: {}", e))
            })?;
        }

        Ok(())
    }

    /// Get decision suggestion from reasoning bank
    #[napi(js_name = "getSuggestion")]
    pub fn get_suggestion(&self, task: String) -> napi::Result<String> {
        let context = HashMap::new();

        let suggestion = self.reasoning_bank
            .suggest_decision(&task, &context)
            .map_err(|e| napi::Error::from_reason(format!("Failed to get suggestion: {}", e)))?;

        serde_json::to_string(&suggestion)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize suggestion: {}", e)))
    }

    /// Get learning statistics from reasoning bank
    #[napi(js_name = "getLearningStats")]
    pub fn get_learning_stats(&self) -> napi::Result<String> {
        let stats = self.reasoning_bank.get_stats()
            .map_err(|e| napi::Error::from_reason(format!("Failed to get stats: {}", e)))?;

        serde_json::to_string(&stats)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize stats: {}", e)))
    }

    /// Get all discovered patterns
    #[napi(js_name = "getPatterns")]
    pub fn get_patterns(&self) -> napi::Result<String> {
        let patterns = self.reasoning_bank.get_patterns()
            .map_err(|e| napi::Error::from_reason(format!("Failed to get patterns: {}", e)))?;

        serde_json::to_string(&patterns)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize patterns: {}", e)))
    }

    /// Enable quantum-resistant encryption for ReasoningBank trajectory storage
    ///
    /// Uses HQC-128 encryption from @qudag/napi-core for quantum-resistant security
    ///
    /// # Arguments
    /// * `encryption_key` - Base64-encoded encryption key (32 bytes)
    /// * `public_key` - Optional base64-encoded public key for HQC
    ///
    /// # Example
    /// ```javascript
    /// const crypto = require('crypto');
    /// const encryptionKey = crypto.randomBytes(32).toString('base64');
    /// await wrapper.enableEncryption(encryptionKey);
    /// ```
    #[napi(js_name = "enableEncryption")]
    pub fn enable_encryption(&self, encryption_key: String, public_key: Option<String>) -> napi::Result<()> {
        use base64::Engine;
        use base64::engine::general_purpose::STANDARD;

        // Decode base64 encryption key
        let key_bytes = STANDARD.decode(&encryption_key)
            .map_err(|e| napi::Error::from_reason(format!("Invalid base64 encryption key: {}", e)))?;

        // Decode optional public key
        let public_key_bytes = if let Some(pk) = public_key {
            Some(STANDARD.decode(&pk)
                .map_err(|e| napi::Error::from_reason(format!("Invalid base64 public key: {}", e)))?)
        } else {
            None
        };

        self.reasoning_bank
            .enable_encryption(key_bytes, public_key_bytes)
            .map_err(|e| napi::Error::from_reason(format!("Failed to enable encryption: {}", e)))
    }

    /// Disable encryption for ReasoningBank
    #[napi(js_name = "disableEncryption")]
    pub fn disable_encryption(&self) -> napi::Result<()> {
        self.reasoning_bank
            .disable_encryption()
            .map_err(|e| napi::Error::from_reason(format!("Failed to disable encryption: {}", e)))
    }

    /// Check if encryption is enabled
    #[napi(js_name = "isEncryptionEnabled")]
    pub fn is_encryption_enabled(&self) -> napi::Result<bool> {
        self.reasoning_bank
            .is_encryption_enabled()
            .map_err(|e| napi::Error::from_reason(format!("Failed to check encryption status: {}", e)))
    }

    /// Decrypt a trajectory by ID
    ///
    /// # Arguments
    /// * `trajectory_id` - UUID of the trajectory to decrypt
    /// * `decrypted_payload` - Decrypted JSON payload from HQC decryption
    ///
    /// # Returns
    /// JSON string of the decrypted trajectory
    #[napi(js_name = "decryptTrajectory")]
    pub fn decrypt_trajectory(&self, trajectory_id: String, decrypted_payload: String) -> napi::Result<String> {
        let trajectory = self.reasoning_bank
            .decrypt_trajectory(&trajectory_id, &decrypted_payload)
            .map_err(|e| napi::Error::from_reason(format!("Failed to decrypt trajectory: {}", e)))?;

        serde_json::to_string(&trajectory)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize trajectory: {}", e)))
    }

    /// Get encrypted payload for a trajectory (for HQC encryption in JavaScript)
    ///
    /// Returns the plaintext payload that should be encrypted with HQC
    #[napi(js_name = "getTrajectoryPayload")]
    pub fn get_trajectory_payload(&self, trajectory_id: String) -> napi::Result<Option<String>> {
        self.reasoning_bank
            .get_trajectory_payload(&trajectory_id)
            .map_err(|e| napi::Error::from_reason(format!("Failed to get trajectory payload: {}", e)))
    }

    /// Query similar trajectories by task
    #[napi(js_name = "queryTrajectories")]
    pub fn query_trajectories(&self, task: String, limit: i32) -> napi::Result<String> {
        let trajectories = self.reasoning_bank
            .query_trajectories(&task, limit as usize)
            .map_err(|e| napi::Error::from_reason(format!("Failed to query trajectories: {}", e)))?;

        serde_json::to_string(&trajectories)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize trajectories: {}", e)))
    }

    /// Reset reasoning bank (clear all learning)
    #[napi(js_name = "resetLearning")]
    pub fn reset_learning(&self) -> napi::Result<()> {
        self.reasoning_bank.reset()
            .map_err(|e| napi::Error::from_reason(format!("Failed to reset: {}", e)))
    }

    // ===== Agent Coordination Methods =====

    /// Enable agent coordination with QuantumDAG
    #[napi(js_name = "enableAgentCoordination")]
    pub async fn enable_agent_coordination(&self) -> napi::Result<()> {
        let mut coord = self.agent_coordination.lock().await;
        *coord = Some(AgentCoordination::new());
        Ok(())
    }

    /// Register a new agent in the coordination system
    #[napi(js_name = "registerAgent")]
    pub async fn register_agent(&self, agent_id: String, agent_type: String) -> napi::Result<()> {
        let coord = self.agent_coordination.lock().await;
        if let Some(ref coordination) = *coord {
            coordination.register_agent(agent_id, agent_type).await
                .map_err(|e| napi::Error::from_reason(format!("Failed to register agent: {}", e)))?;
        } else {
            return Err(napi::Error::from_reason("Agent coordination not enabled. Call enableAgentCoordination() first."));
        }
        Ok(())
    }

    /// Register an agent operation in the coordination system
    #[napi(js_name = "registerAgentOperation")]
    pub async fn register_agent_operation(
        &self,
        agent_id: String,
        operation_id: String,
        affected_files: Vec<String>,
    ) -> napi::Result<String> {
        let coord = self.agent_coordination.lock().await;
        if let Some(ref coordination) = *coord {
            // Get operation from log (scoped to drop MutexGuard before await)
            let operation = {
                let op_log = self.operation_log.lock().map_err(|e| {
                    napi::Error::from_reason(format!("Failed to lock operation log: {}", e))
                })?;

                op_log.get_operation(&operation_id)
                    .map_err(|e| napi::Error::from_reason(format!("Failed to get operation: {}", e)))?
            };

            let vertex_id = coordination.register_operation(&agent_id, &operation, affected_files).await
                .map_err(|e| napi::Error::from_reason(format!("Failed to register operation: {}", e)))?;

            Ok(vertex_id)
        } else {
            Err(napi::Error::from_reason("Agent coordination not enabled. Call enableAgentCoordination() first."))
        }
    }

    /// Check for conflicts with proposed operation
    #[napi(js_name = "checkAgentConflicts")]
    pub async fn check_agent_conflicts(
        &self,
        operation_id: String,
        operation_type: String,
        affected_files: Vec<String>,
    ) -> napi::Result<String> {
        let coord = self.agent_coordination.lock().await;
        if let Some(ref coordination) = *coord {
            let conflicts = coordination.check_conflicts(&operation_id, &operation_type, affected_files).await
                .map_err(|e| napi::Error::from_reason(format!("Failed to check conflicts: {}", e)))?;

            serde_json::to_string(&conflicts)
                .map_err(|e| napi::Error::from_reason(format!("Failed to serialize conflicts: {}", e)))
        } else {
            Err(napi::Error::from_reason("Agent coordination not enabled. Call enableAgentCoordination() first."))
        }
    }

    /// Get agent statistics
    #[napi(js_name = "getAgentStats")]
    pub async fn get_agent_stats(&self, agent_id: String) -> napi::Result<String> {
        let coord = self.agent_coordination.lock().await;
        if let Some(ref coordination) = *coord {
            let stats = coordination.get_agent_stats(&agent_id).await
                .map_err(|e| napi::Error::from_reason(format!("Failed to get agent stats: {}", e)))?;

            serde_json::to_string(&stats)
                .map_err(|e| napi::Error::from_reason(format!("Failed to serialize stats: {}", e)))
        } else {
            Err(napi::Error::from_reason("Agent coordination not enabled."))
        }
    }

    /// List all registered agents
    #[napi(js_name = "listAgents")]
    pub async fn list_agents(&self) -> napi::Result<String> {
        let coord = self.agent_coordination.lock().await;
        if let Some(ref coordination) = *coord {
            let agents = coordination.list_agents().await
                .map_err(|e| napi::Error::from_reason(format!("Failed to list agents: {}", e)))?;

            serde_json::to_string(&agents)
                .map_err(|e| napi::Error::from_reason(format!("Failed to serialize agents: {}", e)))
        } else {
            Err(napi::Error::from_reason("Agent coordination not enabled."))
        }
    }

    /// Get coordination statistics
    #[napi(js_name = "getCoordinationStats")]
    pub async fn get_coordination_stats(&self) -> napi::Result<String> {
        let coord = self.agent_coordination.lock().await;
        if let Some(ref coordination) = *coord {
            let stats = coordination.get_stats().await
                .map_err(|e| napi::Error::from_reason(format!("Failed to get stats: {}", e)))?;

            serde_json::to_string(&stats)
                .map_err(|e| napi::Error::from_reason(format!("Failed to serialize stats: {}", e)))
        } else {
            Err(napi::Error::from_reason("Agent coordination not enabled."))
        }
    }

    /// Get coordination tips (DAG tips)
    #[napi(js_name = "getCoordinationTips")]
    pub async fn get_coordination_tips(&self) -> napi::Result<Vec<String>> {
        let coord = self.agent_coordination.lock().await;
        if let Some(ref coordination) = *coord {
            coordination.get_coordination_tips().await
                .map_err(|e| napi::Error::from_reason(format!("Failed to get tips: {}", e)))
        } else {
            Err(napi::Error::from_reason("Agent coordination not enabled."))
        }
    }

    // ===== Quantum Fingerprint Methods =====

    /// Generate a quantum fingerprint for an operation
    ///
    /// This method generates a quantum-resistant fingerprint using @qudag/napi-core
    /// for fast integrity verification of JJ operations.
    ///
    /// # Arguments
    /// * `operation_id` - The ID of the operation to fingerprint
    ///
    /// # Returns
    /// The quantum fingerprint as a hex string
    ///
    /// # Example
    /// ```javascript
    /// const wrapper = new JJWrapper();
    /// const fingerprint = await wrapper.generateOperationFingerprint(operationId);
    /// ```
    #[napi(js_name = "generateOperationFingerprint")]
    pub async fn generate_operation_fingerprint(&self, operation_id: String) -> napi::Result<String> {
        // Get operation from log
        let operation = {
            let op_log = self.operation_log.lock().map_err(|e| {
                napi::Error::from_reason(format!("Failed to lock operation log: {}", e))
            })?;

            op_log.get_operation(&operation_id)
                .map_err(|e| napi::Error::from_reason(format!("Failed to get operation: {}", e)))?
        };

        // Serialize operation to JSON
        let operation_json = serde_json::to_string(&operation)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize operation: {}", e)))?;

        // Note: The actual quantum fingerprint generation will be done in JavaScript
        // using @qudag/napi-core's generateQuantumFingerprint function
        // Here we just prepare the data and return a placeholder
        // The JavaScript wrapper will call @qudag/napi-core

        // For now, return a simple hash as placeholder
        // The JS wrapper will replace this with actual quantum fingerprint
        let fingerprint = hex::encode(operation_json.as_bytes());

        // Update operation with fingerprint
        {
            let op_log = self.operation_log.lock().map_err(|e| {
                napi::Error::from_reason(format!("Failed to lock operation log: {}", e))
            })?;

            // Find and update the operation
            let all_ops = op_log.get_all();
            op_log.clear();

            for mut op in all_ops {
                if op.id == operation_id {
                    op.quantum_fingerprint = Some(fingerprint.clone());
                }
                op_log.add_operation(op);
            }
        }

        Ok(fingerprint)
    }

    /// Verify an operation's quantum fingerprint
    ///
    /// Checks if the stored quantum fingerprint matches the current operation data.
    ///
    /// # Arguments
    /// * `operation_id` - The ID of the operation to verify
    /// * `fingerprint` - The expected fingerprint to verify against
    ///
    /// # Returns
    /// `true` if the fingerprint is valid, `false` otherwise
    ///
    /// # Example
    /// ```javascript
    /// const isValid = await wrapper.verifyOperationFingerprint(operationId, fingerprint);
    /// if (isValid) {
    ///   console.log('Operation integrity verified!');
    /// }
    /// ```
    #[napi(js_name = "verifyOperationFingerprint")]
    pub async fn verify_operation_fingerprint(
        &self,
        operation_id: String,
        fingerprint: String,
    ) -> napi::Result<bool> {
        // Get operation from log
        let operation = {
            let op_log = self.operation_log.lock().map_err(|e| {
                napi::Error::from_reason(format!("Failed to lock operation log: {}", e))
            })?;

            op_log.get_operation(&operation_id)
                .map_err(|e| napi::Error::from_reason(format!("Failed to get operation: {}", e)))?
        };

        // Check if operation has a fingerprint
        if let Some(stored_fingerprint) = &operation.quantum_fingerprint {
            // Verify against stored fingerprint
            if stored_fingerprint == &fingerprint {
                return Ok(true);
            }
        }

        // If no stored fingerprint, generate one and compare
        let current_fingerprint = operation.generate_quantum_fingerprint()
            .map_err(|e| napi::Error::from_reason(format!("Failed to generate fingerprint: {}", e)))?;

        Ok(current_fingerprint == fingerprint)
    }

    /// Get operation data for quantum fingerprint generation (helper method)
    ///
    /// Returns the serialized operation data that should be fingerprinted.
    /// This is used by the JavaScript wrapper to call @qudag/napi-core.
    ///
    /// # Arguments
    /// * `operation_id` - The ID of the operation
    ///
    /// # Returns
    /// The operation data as a Buffer (Uint8Array in JS)
    #[napi(js_name = "getOperationData")]
    pub fn get_operation_data(&self, operation_id: String) -> napi::Result<Vec<u8>> {
        let op_log = self.operation_log.lock().map_err(|e| {
            napi::Error::from_reason(format!("Failed to lock operation log: {}", e))
        })?;

        let operation = op_log.get_operation(&operation_id)
            .map_err(|e| napi::Error::from_reason(format!("Failed to get operation: {}", e)))?;

        let json = serde_json::to_string(&operation)
            .map_err(|e| napi::Error::from_reason(format!("Failed to serialize operation: {}", e)))?;

        Ok(json.into_bytes())
    }

    /// Update operation with quantum fingerprint
    ///
    /// Stores a quantum fingerprint for an operation.
    ///
    /// # Arguments
    /// * `operation_id` - The ID of the operation
    /// * `fingerprint` - The quantum fingerprint (hex string)
    #[napi(js_name = "setOperationFingerprint")]
    pub fn set_operation_fingerprint(
        &self,
        operation_id: String,
        fingerprint: String,
    ) -> napi::Result<()> {
        let op_log = self.operation_log.lock().map_err(|e| {
            napi::Error::from_reason(format!("Failed to lock operation log: {}", e))
        })?;

        // Find and update the operation
        let all_ops = op_log.get_all();
        op_log.clear();

        let mut found = false;
        for mut op in all_ops {
            if op.id == operation_id {
                op.quantum_fingerprint = Some(fingerprint.clone());
                found = true;
            }
            op_log.add_operation(op);
        }

        if !found {
            return Err(napi::Error::from_reason(format!("Operation not found: {}", operation_id)));
        }

        Ok(())
    }

    // ===== Operation Signing Methods =====

    /// Sign an operation by ID
    ///
    /// Creates a quantum-resistant digital signature for the specified operation.
    ///
    /// # Arguments
    ///
    /// * `operation_id` - The operation ID to sign
    /// * `secret_key` - The secret key in hex format
    /// * `public_key` - The corresponding public key in hex format
    #[napi(js_name = "signOperation")]
    pub fn sign_operation(
        &self,
        operation_id: String,
        secret_key: String,
        public_key: String,
    ) -> napi::Result<()> {
        self.operation_log
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("Failed to lock operation log: {}", e)))?
            .sign_operation(&operation_id, &secret_key, &public_key)
            .map_err(|e| napi::Error::from_reason(format!("Failed to sign operation: {}", e)))
    }

    /// Verify an operation's signature by ID
    ///
    /// # Arguments
    ///
    /// * `operation_id` - The operation ID to verify
    ///
    /// # Returns
    ///
    /// `true` if signature is valid, `false` if invalid
    #[napi(js_name = "verifyOperationSignature")]
    pub fn verify_operation_signature(&self, operation_id: String) -> napi::Result<bool> {
        self.operation_log
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("Failed to lock operation log: {}", e)))?
            .verify_operation_signature(&operation_id)
            .map_err(|e| napi::Error::from_reason(format!("Failed to verify signature: {}", e)))
    }

    /// Verify all operations in the log
    ///
    /// # Arguments
    ///
    /// * `public_key` - Optional public key to verify against
    ///
    /// # Returns
    ///
    /// JSON string with verification results: { total_signed, valid_count, invalid_count }
    #[napi(js_name = "verifyAllOperations")]
    pub fn verify_all_operations(&self, public_key: Option<String>) -> napi::Result<String> {
        let (total, valid, invalid) = self
            .operation_log
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("Failed to lock operation log: {}", e)))?
            .verify_all_operations(public_key.as_deref())
            .map_err(|e| napi::Error::from_reason(format!("Failed to verify operations: {}", e)))?;

        Ok(serde_json::json!({
            "total_signed": total,
            "valid_count": valid,
            "invalid_count": invalid,
        })
        .to_string())
    }

    /// Sign all unsigned operations
    ///
    /// # Arguments
    ///
    /// * `secret_key` - The secret key in hex format
    /// * `public_key` - The corresponding public key in hex format
    ///
    /// # Returns
    ///
    /// Number of operations that were signed
    #[napi(js_name = "signAllOperations")]
    pub fn sign_all_operations(&self, secret_key: String, public_key: String) -> napi::Result<u32> {
        let count = self
            .operation_log
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("Failed to lock operation log: {}", e)))?
            .sign_all_operations(&secret_key, &public_key)
            .map_err(|e| napi::Error::from_reason(format!("Failed to sign operations: {}", e)))?;

        Ok(count as u32)
    }

    /// Get count of signed operations
    #[napi(js_name = "getSignedOperationsCount")]
    pub fn get_signed_operations_count(&self) -> napi::Result<u32> {
        let count = self
            .operation_log
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("Failed to lock operation log: {}", e)))?
            .signed_operations()
            .len();

        Ok(count as u32)
    }

    /// Get count of unsigned operations
    #[napi(js_name = "getUnsignedOperationsCount")]
    pub fn get_unsigned_operations_count(&self) -> napi::Result<u32> {
        let count = self
            .operation_log
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("Failed to lock operation log: {}", e)))?
            .unsigned_operations()
            .len();

        Ok(count as u32)
    }

    /// Verify signature chain integrity
    ///
    /// Verifies that all signed operations form a valid chain.
    ///
    /// # Returns
    ///
    /// `true` if chain is valid, `false` if broken
    #[napi(js_name = "verifySignatureChain")]
    pub fn verify_signature_chain(&self) -> napi::Result<bool> {
        self.operation_log
            .lock()
            .map_err(|e| napi::Error::from_reason(format!("Failed to lock operation log: {}", e)))?
            .verify_signature_chain()
            .map_err(|e| napi::Error::from_reason(format!("Failed to verify chain: {}", e)))
    }
}

// Additional impl block for Rust-only methods
impl JJWrapper {
    /// Create wrapper with config (Rust-only, returns Result<JJWrapper>)
    pub fn with_config_checked(config: JJConfig) -> Result<JJWrapper> {
        let operation_log = Arc::new(Mutex::new(JJOperationLog::new(config.max_log_entries as usize)));
        let reasoning_bank = Arc::new(ReasoningBank::new(1000));
        let current_trajectory = Arc::new(Mutex::new(None));
        let agent_coordination = Arc::new(tokio::sync::Mutex::new(None));

        Ok(JJWrapper {
            config,
            operation_log,
            reasoning_bank,
            current_trajectory,
            agent_coordination,
            bookmark_subcommand: Arc::new(tokio::sync::OnceCell::new()),
        })
    }

    /// Decide whether a jj version string uses the `bookmark` subcommand.
    ///
    /// jj renamed `branch` -> `bookmark` in 0.21. Given the `jj --version`
    /// output (e.g. `"jj 0.35.0"`), returns `true` for jj >= 0.21. Falls back
    /// to `true` (modern jj) when the version cannot be parsed.
    fn version_uses_bookmark(version_output: &str) -> bool {
        let parsed = version_output.split_whitespace().find_map(|tok| {
            let mut parts = tok.split('.');
            let major = parts
                .next()?
                .trim_start_matches(|c: char| !c.is_ascii_digit())
                .parse::<u32>()
                .ok()?;
            let minor = parts.next()?.parse::<u32>().ok()?;
            Some((major, minor))
        });

        match parsed {
            Some((major, minor)) => major > 0 || minor >= 21,
            None => true,
        }
    }

    /// Lazily probe `jj --version` (once) to decide between the modern
    /// `bookmark` subcommand and the legacy `branch` subcommand.
    async fn bookmark_subcommand_name(&self) -> &'static str {
        let uses_bookmark = *self
            .bookmark_subcommand
            .get_or_init(|| async {
                let timeout =
                    std::time::Duration::from_millis(self.config.timeout_ms as u64);
                match execute_jj_command(&self.config.jj_path, &["--version"], timeout).await {
                    Ok(output) => Self::version_uses_bookmark(&output),
                    // If the probe fails, assume modern jj (the bundled binary is current).
                    Err(_) => true,
                }
            })
            .await;

        if uses_bookmark {
            "bookmark"
        } else {
            "branch"
        }
    }
}

impl Default for JJWrapper {
    fn default() -> Self {
        Self::new().expect("Failed to create default JJWrapper")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wrapper_creation() {
        let wrapper = JJWrapper::new();
        assert!(wrapper.is_ok());

        let config = JJConfig::default().with_verbose(true);
        let wrapper = JJWrapper::with_config_checked(config);
        assert!(wrapper.is_ok());
    }

    #[test]
    fn test_detect_operation_type() {
        assert_eq!(
            JJWrapper::detect_operation_type(&["describe", "-m", "test"]),
            OperationType::Describe
        );
        assert_eq!(
            JJWrapper::detect_operation_type(&["new"]),
            OperationType::New
        );
        assert_eq!(
            JJWrapper::detect_operation_type(&["git", "fetch"]),
            OperationType::GitFetch
        );
    }

    #[test]
    fn test_parse_conflicts() {
        let output = "file1.txt    2-sided conflict\nfile2.rs    3-sided conflict";
        let conflicts = JJWrapper::parse_conflicts(output).unwrap();

        assert_eq!(conflicts.len(), 2);
        assert_eq!(conflicts[0].path, "file1.txt");
        assert_eq!(conflicts[0].num_conflicts, 2);
        assert_eq!(conflicts[1].path, "file2.rs");
        assert_eq!(conflicts[1].num_conflicts, 3);
    }

    #[test]
    fn test_parse_diff() {
        let output = r#"
+++ b/new.txt
--- a/deleted.txt
+Added line
-Removed line
        "#;

        let diff = JJWrapper::parse_diff(output).unwrap();
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 1);
    }

    #[test]
    fn test_parse_branches() {
        let output = "main: abc123\norigin/main: def456";
        let branches = JJWrapper::parse_branches(output).unwrap();

        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].name, "main");
        assert!(!branches[0].is_remote);
        assert_eq!(branches[1].name, "origin/main");
        assert!(branches[1].is_remote);
    }

    #[test]
    fn test_version_uses_bookmark() {
        // jj >= 0.21 uses the `bookmark` subcommand.
        assert!(JJWrapper::version_uses_bookmark("jj 0.35.0"));
        assert!(JJWrapper::version_uses_bookmark("jj 0.21.0"));
        assert!(JJWrapper::version_uses_bookmark("jj 1.0.0"));
        // Older jj still uses the legacy `branch` subcommand.
        assert!(!JJWrapper::version_uses_bookmark("jj 0.20.0"));
        assert!(!JJWrapper::version_uses_bookmark("jj 0.15.1"));
        // Unparseable output falls back to modern (bookmark).
        assert!(JJWrapper::version_uses_bookmark("unknown"));
    }
}
