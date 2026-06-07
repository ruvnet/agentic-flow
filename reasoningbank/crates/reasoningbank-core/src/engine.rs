//! Main reasoning engine implementation

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info};

use crate::{Pattern, Result, SimilarityMetrics, VectorEmbedding};

/// Configuration for the reasoning engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    /// Number of similar patterns to retrieve
    pub top_k: usize,

    /// Minimum similarity threshold (0.0 to 1.0)
    pub similarity_threshold: f64,

    /// Embedding dimension
    pub embedding_dimension: usize,

    /// Maximum patterns to keep in memory cache
    pub max_cache_size: usize,

    /// Enable automatic pattern optimization
    pub enable_optimization: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            top_k: 5,
            similarity_threshold: 0.7,
            embedding_dimension: 384,
            max_cache_size: 1000,
            enable_optimization: true,
        }
    }
}

/// Main reasoning engine
pub struct ReasoningEngine {
    config: Arc<EngineConfig>,
}

impl ReasoningEngine {
    /// Create a new reasoning engine
    pub fn new(config: EngineConfig) -> Self {
        info!("Initializing reasoning engine with config: {:?}", config);
        Self {
            config: Arc::new(config),
        }
    }

    /// Create with default configuration
    pub fn default() -> Self {
        Self::new(EngineConfig::default())
    }

    /// Get the engine configuration
    pub fn config(&self) -> &EngineConfig {
        &self.config
    }

    /// Prepare a pattern for storage by generating embeddings
    pub fn prepare_pattern(&self, mut pattern: Pattern) -> Result<Pattern> {
        debug!("Preparing pattern: {}", pattern.id);

        // Generate embedding from task description if not present
        if pattern.embedding.is_none() {
            let embedding = VectorEmbedding::from_text(&pattern.task_description);
            pattern.embedding = Some(embedding.values);
        }

        Ok(pattern)
    }

    /// Score pattern similarity
    pub fn score_similarity(&self, pattern_a: &Pattern, pattern_b: &Pattern) -> SimilarityMetrics {
        SimilarityMetrics::calculate(pattern_a, pattern_b)
    }

    /// Find similar patterns from a list
    pub fn find_similar(
        &self,
        query: &Pattern,
        candidates: &[Pattern],
    ) -> Vec<(Pattern, SimilarityMetrics)> {
        crate::similarity::find_similar_patterns(query, candidates, self.config.top_k)
    }

    /// Filter patterns by similarity threshold
    pub fn filter_by_threshold(
        &self,
        results: Vec<(Pattern, SimilarityMetrics)>,
    ) -> Vec<(Pattern, SimilarityMetrics)> {
        results.into_iter()
            .filter(|(_, metrics)| metrics.overall_score >= self.config.similarity_threshold)
            .collect()
    }

    /// Recommend a strategy based on historical patterns
    pub fn recommend_strategy(
        &self,
        similar_patterns: &[(Pattern, SimilarityMetrics)],
    ) -> Option<RecommendedStrategy> {
        if similar_patterns.is_empty() {
            return None;
        }

        // Find the strategy with the highest success rate among similar patterns
        let mut strategy_scores: std::collections::HashMap<String, Vec<f64>> =
            std::collections::HashMap::new();

        for (pattern, _) in similar_patterns {
            strategy_scores
                .entry(pattern.strategy.clone())
                .or_insert_with(Vec::new)
                .push(pattern.outcome.success_score);
        }

        // Calculate average success score for each strategy
        let best_strategy = strategy_scores.iter()
            .map(|(strategy, scores)| {
                let avg_score = scores.iter().sum::<f64>() / scores.len() as f64;
                (strategy.clone(), avg_score, scores.len())
            })
            .max_by(|(_, score_a, _), (_, score_b, _)| {
                score_a.partial_cmp(score_b).unwrap_or(std::cmp::Ordering::Equal)
            });

        best_strategy.map(|(strategy, confidence, usage_count)| {
            RecommendedStrategy {
                strategy,
                confidence,
                usage_count,
                similar_patterns: similar_patterns.len(),
            }
        })
    }
}

/// A recommended strategy based on historical data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedStrategy {
    /// The recommended strategy name
    pub strategy: String,

    /// Confidence score (0.0 to 1.0) based on historical success
    pub confidence: f64,

    /// Number of times this strategy was used
    pub usage_count: usize,

    /// Number of similar patterns found
    pub similar_patterns: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TaskOutcome;

    #[test]
    fn test_engine_creation() {
        let engine = ReasoningEngine::default();
        assert_eq!(engine.config().top_k, 5);
    }

    #[test]
    fn test_prepare_pattern() {
        let engine = ReasoningEngine::default();
        let pattern = Pattern::new(
            "Test task".to_string(),
            "testing".to_string(),
            "test-strategy".to_string(),
        );

        let prepared = engine.prepare_pattern(pattern).unwrap();
        assert!(prepared.embedding.is_some());
    }

    #[test]
    fn test_recommend_strategy() {
        let engine = ReasoningEngine::default();

        let pattern1 = Pattern::new(
            "Task 1".to_string(),
            "cat-1".to_string(),
            "strategy-a".to_string(),
        ).with_outcome(TaskOutcome::partial(0.9, 1.0));

        let pattern2 = Pattern::new(
            "Task 2".to_string(),
            "cat-1".to_string(),
            "strategy-b".to_string(),
        ).with_outcome(TaskOutcome::partial(0.6, 1.0));

        let metrics1 = SimilarityMetrics::calculate(&pattern1, &pattern1);
        let metrics2 = SimilarityMetrics::calculate(&pattern2, &pattern1);

        let similar = vec![(pattern1, metrics1), (pattern2, metrics2)];
        let recommendation = engine.recommend_strategy(&similar).unwrap();

        assert_eq!(recommendation.strategy, "strategy-a");
        assert!(recommendation.confidence > 0.8);
    }

    #[test]
    fn test_filter_by_threshold() {
        let config = EngineConfig {
            similarity_threshold: 0.5,
            ..Default::default()
        };
        let engine = ReasoningEngine::new(config);

        let pattern = Pattern::new("Test".to_string(), "cat".to_string(), "strat".to_string());
        let mut metrics = SimilarityMetrics::calculate(&pattern, &pattern);

        let results = vec![
            (pattern.clone(), metrics.clone()),
        ];

        let filtered = engine.filter_by_threshold(results.clone());
        assert_eq!(filtered.len(), 1);

        // Lower the score below threshold
        metrics.overall_score = 0.3;
        let results_low = vec![(pattern, metrics)];
        let filtered_low = engine.filter_by_threshold(results_low);
        assert_eq!(filtered_low.len(), 0);
    }
}
