//! Configuration for agentic-jujutsu

use serde::{Deserialize, Serialize};
use napi_derive::napi;

/// Validate repository path to prevent directory traversal attacks
fn validate_repo_path(path: &str) -> Result<String, String> {
    // Block obvious path traversal attempts
    if path.contains("..") {
        return Err("Path cannot contain '..' (directory traversal not allowed)".to_string());
    }

    // Block absolute paths outside of allowed areas (optional, can be configured)
    // This is a conservative check - adjust based on your security requirements

    // Block null bytes
    if path.contains('\0') {
        return Err("Path cannot contain null bytes".to_string());
    }

    Ok(path.to_string())
}

/// Configuration for JJWrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct JJConfig {
    /// Path to jj executable (default: "jj")
    pub jj_path: String,

    /// Repository path (default: current directory)
    pub repo_path: String,

    /// Timeout for operations in milliseconds
    pub timeout_ms: u32,

    /// Enable verbose logging
    pub verbose: bool,

    /// Maximum operation log entries to keep in memory
    pub max_log_entries: u32,

    /// Enable AgentDB sync
    pub enable_agentdb_sync: bool,
}

impl JJConfig {
    /// Create new configuration with defaults
    pub fn new() -> Self {
        Self::default()
    }

    /// Create default configuration
    pub fn default_config() -> Self {
        Self::default()
    }

    /// Set jj executable path
    pub fn set_jj_path(&mut self, path: String) {
        self.jj_path = path;
    }

    /// Set repository path
    pub fn set_repo_path(&mut self, path: String) {
        // Validate path for security
        if let Ok(validated) = validate_repo_path(&path) {
            self.repo_path = validated;
        } else {
            // Fall back to current directory if validation fails
            self.repo_path = ".".to_string();
        }
    }

    /// Set jj executable path (builder pattern)
    pub fn with_jj_path(mut self, path: String) -> Self {
        self.jj_path = path;
        self
    }

    /// Set repository path (builder pattern)
    pub fn with_repo_path(mut self, path: String) -> Self {
        // Validate path for security
        if let Ok(validated) = validate_repo_path(&path) {
            self.repo_path = validated;
        }
        // If validation fails, keep existing repo_path
        self
    }

    /// Set operation timeout
    pub fn with_timeout(mut self, timeout_ms: u32) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }

    /// Enable verbose logging
    pub fn with_verbose(mut self, verbose: bool) -> Self {
        self.verbose = verbose;
        self
    }

    /// Set max log entries
    pub fn with_max_log_entries(mut self, max: u32) -> Self {
        self.max_log_entries = max;
        self
    }

    /// Enable AgentDB synchronization
    pub fn with_agentdb_sync(mut self, enable: bool) -> Self {
        self.enable_agentdb_sync = enable;
        self
    }
}

impl Default for JJConfig {
    fn default() -> Self {
        // Try to get the embedded binary path, fallback to "jj" in PATH
        let jj_path = get_default_jj_path().unwrap_or_else(|_| "jj".to_string());

        Self {
            jj_path,
            repo_path: ".".to_string(),
            timeout_ms: 30000, // 30 seconds
            verbose: false,
            max_log_entries: 1000,
            enable_agentdb_sync: false,
        }
    }
}

/// Get the default jj binary path (checks for embedded binary first)
fn get_default_jj_path() -> Result<String, String> {
    // Check cache directory for extracted binary
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());

    let cache_dir = std::path::PathBuf::from(home)
        .join(".cache")
        .join("agentic-jujutsu");

    let binary_path = cache_dir.join("jj");

    // Check if embedded binary exists
    if binary_path.exists() {
        if let Ok(content) = std::fs::read(&binary_path) {
            if content.len() > 100 && content != b"SYSTEM_JJ" {
                return Ok(binary_path.to_string_lossy().to_string());
            }
        }
    }

    // Fallback to system jj in PATH
    Ok("jj".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = JJConfig::default();
        // The default jj path is either the system "jj" (on PATH) or, when a
        // binary has already been extracted, the cached path ending in "jj".
        // Asserting equality with "jj" makes this test depend on global cache
        // state (e.g. whether another test extracted the embedded binary).
        assert!(
            config.jj_path == "jj" || config.jj_path.ends_with("/jj"),
            "unexpected default jj_path: {}",
            config.jj_path
        );
        assert_eq!(config.timeout_ms, 30000);
        assert!(!config.verbose);
    }

    #[test]
    fn test_builder_pattern() {
        let config = JJConfig::default()
            .with_verbose(true)
            .with_timeout(60000)
            .with_max_log_entries(500);

        assert!(config.verbose);
        assert_eq!(config.timeout_ms, 60000);
        assert_eq!(config.max_log_entries, 500);
    }
}
