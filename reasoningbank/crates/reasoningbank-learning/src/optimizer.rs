//! Strategy optimization based on performance data

use reasoningbank_core::Pattern;
use reasoningbank_storage::SqliteStorage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, info};

use crate::Result;

/// Strategy optimizer for performance improvement
pub struct StrategyOptimizer {
    storage: SqliteStorage,
}

impl StrategyOptimizer {
    /// Create a new optimizer
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    /// Optimize strategies for a given category
    pub fn optimize_for_category(&self, category: &str) -> Result<OptimizationResult> {
        debug!("Optimizing strategies for category: {}", category);

        let patterns = self.storage.get_patterns_by_category(category, 1000)?;

        if patterns.is_empty() {
            return Ok(OptimizationResult {
                category: category.to_string(),
                total_patterns: 0,
                strategy_rankings: Vec::new(),
                recommended_strategy: None,
            });
        }

        // Group by strategy
        let mut strategy_groups: HashMap<String, Vec<&Pattern>> = HashMap::new();
        for pattern in &patterns {
            strategy_groups
                .entry(pattern.strategy.clone())
                .or_insert_with(Vec::new)
                .push(pattern);
        }

        // Calculate metrics for each strategy
        let mut rankings: Vec<StrategyRanking> = strategy_groups
            .into_iter()
            .map(|(strategy, patterns)| {
                let usage_count = patterns.len();
                let success_rate = patterns.iter()
                    .filter(|p| p.outcome.success)
                    .count() as f64 / usage_count as f64;

                let avg_success_score = patterns.iter()
                    .map(|p| p.outcome.success_score)
                    .sum::<f64>() / usage_count as f64;

                let avg_duration = patterns.iter()
                    .map(|p| p.outcome.duration_seconds)
                    .sum::<f64>() / usage_count as f64;

                let avg_tokens = patterns.iter()
                    .filter_map(|p| p.outcome.tokens_used)
                    .sum::<u32>() as f64 / patterns.iter()
                    .filter(|p| p.outcome.tokens_used.is_some())
                    .count().max(1) as f64;

                // Composite score: success (50%), speed (25%), efficiency (25%)
                let speed_score = if avg_duration > 0.0 {
                    1.0 / (1.0 + avg_duration / 10.0) // Normalize to 0-1
                } else {
                    0.5
                };

                let efficiency_score = if avg_tokens > 0.0 {
                    1.0 / (1.0 + avg_tokens / 1000.0) // Normalize to 0-1
                } else {
                    0.5
                };

                let composite_score =
                    avg_success_score * 0.5 +
                    speed_score * 0.25 +
                    efficiency_score * 0.25;

                StrategyRanking {
                    strategy,
                    usage_count,
                    success_rate,
                    avg_success_score,
                    avg_duration_seconds: avg_duration,
                    avg_tokens_used: avg_tokens as u32,
                    composite_score,
                }
            })
            .collect();

        // Sort by composite score
        rankings.sort_by(|a, b| {
            b.composite_score.partial_cmp(&a.composite_score).unwrap_or(std::cmp::Ordering::Equal)
        });

        let recommended = rankings.first().map(|r| r.strategy.clone());

        info!("Optimization complete for category '{}': {} strategies analyzed",
              category, rankings.len());

        Ok(OptimizationResult {
            category: category.to_string(),
            total_patterns: patterns.len(),
            strategy_rankings: rankings,
            recommended_strategy: recommended,
        })
    }

    /// Get global optimization across all categories
    pub fn optimize_global(&self) -> Result<Vec<OptimizationResult>> {
        info!("Running global optimization");

        let all_patterns = self.storage.get_all_patterns(None)?;

        // Get unique categories
        let categories: std::collections::HashSet<_> = all_patterns.iter()
            .map(|p| p.task_category.clone())
            .collect();

        let mut results = Vec::new();

        for category in categories {
            let result = self.optimize_for_category(&category)?;
            results.push(result);
        }

        // Sort by number of patterns (most data first)
        results.sort_by(|a, b| b.total_patterns.cmp(&a.total_patterns));

        Ok(results)
    }
}

/// Optimization result for a category
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationResult {
    pub category: String,
    pub total_patterns: usize,
    pub strategy_rankings: Vec<StrategyRanking>,
    pub recommended_strategy: Option<String>,
}

/// Ranking for a strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyRanking {
    pub strategy: String,
    pub usage_count: usize,
    pub success_rate: f64,
    pub avg_success_score: f64,
    pub avg_duration_seconds: f64,
    pub avg_tokens_used: u32,
    pub composite_score: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use reasoningbank_core::TaskOutcome;

    #[test]
    fn test_optimizer_creation() {
        let storage = SqliteStorage::in_memory().unwrap();
        let _optimizer = StrategyOptimizer::new(storage);
    }

    #[test]
    fn test_optimize_empty_category() {
        let storage = SqliteStorage::in_memory().unwrap();
        let optimizer = StrategyOptimizer::new(storage);

        let result = optimizer.optimize_for_category("nonexistent").unwrap();
        assert_eq!(result.total_patterns, 0);
    }

    #[test]
    fn test_optimize_with_data() {
        let storage = SqliteStorage::in_memory().unwrap();

        // Add some test patterns
        let pattern1 = Pattern::new(
            "Task 1".to_string(),
            "test-category".to_string(),
            "strategy-a".to_string(),
        ).with_outcome(TaskOutcome::partial(0.9, 1.0));

        let pattern2 = Pattern::new(
            "Task 2".to_string(),
            "test-category".to_string(),
            "strategy-b".to_string(),
        ).with_outcome(TaskOutcome::partial(0.6, 2.0));

        storage.store_pattern(&pattern1).unwrap();
        storage.store_pattern(&pattern2).unwrap();

        let optimizer = StrategyOptimizer::new(storage);
        let result = optimizer.optimize_for_category("test-category").unwrap();

        assert_eq!(result.total_patterns, 2);
        assert_eq!(result.strategy_rankings.len(), 2);
        assert!(result.recommended_strategy.is_some());
    }
}
