use crate::models::CodeChunk;
use strsim::normalized_levenshtein;

/// Result of similarity search
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// The matched code chunk
    pub chunk: CodeChunk,
    /// Similarity score (0.0 - 1.0)
    pub similarity: f32,
    /// Index in original chunks array
    pub chunk_index: usize,
}

/// Calculate similarity between edit snippet and code chunks
pub struct SimilarityMatcher;

impl SimilarityMatcher {
    /// Find the best matching chunk for an edit snippet
    pub fn find_best_match(edit_snippet: &str, chunks: &[CodeChunk]) -> Option<SearchResult> {
        if chunks.is_empty() {
            return None;
        }

        let normalized_edit = Self::normalize_code(edit_snippet);

        let mut best_match: Option<SearchResult> = None;
        let mut best_score = 0.0_f32;

        for (index, chunk) in chunks.iter().enumerate() {
            let normalized_chunk = Self::normalize_code(&chunk.code);

            // Calculate multiple similarity metrics and combine
            let levenshtein_score = normalized_levenshtein(&normalized_edit, &normalized_chunk) as f32;
            let token_score = Self::token_similarity(&normalized_edit, &normalized_chunk);
            let structure_score = Self::structure_similarity(edit_snippet, &chunk.code);

            // Weighted combination
            let combined_score = (levenshtein_score * 0.5) + (token_score * 0.3) + (structure_score * 0.2);

            if combined_score > best_score {
                best_score = combined_score;
                best_match = Some(SearchResult {
                    chunk: chunk.clone(),
                    similarity: combined_score,
                    chunk_index: index,
                });
            }
        }

        best_match
    }

    /// Find top K matching chunks
    pub fn find_top_k_matches(
        edit_snippet: &str,
        chunks: &[CodeChunk],
        k: usize,
    ) -> Vec<SearchResult> {
        if chunks.is_empty() {
            return Vec::new();
        }

        let normalized_edit = Self::normalize_code(edit_snippet);
        let mut results = Vec::with_capacity(chunks.len());

        for (index, chunk) in chunks.iter().enumerate() {
            let normalized_chunk = Self::normalize_code(&chunk.code);

            let levenshtein_score = normalized_levenshtein(&normalized_edit, &normalized_chunk) as f32;
            let token_score = Self::token_similarity(&normalized_edit, &normalized_chunk);
            let structure_score = Self::structure_similarity(edit_snippet, &chunk.code);

            let combined_score = (levenshtein_score * 0.5) + (token_score * 0.3) + (structure_score * 0.2);

            results.push(SearchResult {
                chunk: chunk.clone(),
                similarity: combined_score,
                chunk_index: index,
            });
        }

        // Sort by similarity (descending)
        results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));

        // Return top k
        results.into_iter().take(k).collect()
    }

    /// Normalize code for comparison (remove whitespace, comments, etc.)
    fn normalize_code(code: &str) -> String {
        code.lines()
            .map(|line| {
                // Remove leading/trailing whitespace
                let trimmed = line.trim();
                // Skip comment lines
                if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with("*") {
                    return String::new();
                }
                trimmed.to_string()
            })
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Calculate token-based similarity (word overlap)
    fn token_similarity(a: &str, b: &str) -> f32 {
        let tokens_a: Vec<&str> = a.split_whitespace().collect();
        let tokens_b: Vec<&str> = b.split_whitespace().collect();

        if tokens_a.is_empty() || tokens_b.is_empty() {
            return 0.0;
        }

        // Count common tokens
        let mut common_count = 0;
        for token in &tokens_a {
            if tokens_b.contains(token) {
                common_count += 1;
            }
        }

        let max_len = tokens_a.len().max(tokens_b.len()) as f32;
        if max_len == 0.0 {
            return 0.0;
        }

        common_count as f32 / max_len
    }

    /// Calculate structural similarity (braces, keywords, etc.)
    fn structure_similarity(a: &str, b: &str) -> f32 {
        let structural_chars = ['{', '}', '(', ')', '[', ']', ';'];
        let keywords = ["function", "class", "const", "let", "var", "if", "for", "return"];

        let mut score = 0.0_f32;
        let mut total_checks = 0.0_f32;

        // Check structural characters
        for &ch in &structural_chars {
            let count_a = a.matches(ch).count();
            let count_b = b.matches(ch).count();
            let max_count = count_a.max(count_b);

            if max_count > 0 {
                let min_count = count_a.min(count_b);
                score += (min_count as f32) / (max_count as f32);
                total_checks += 1.0;
            }
        }

        // Check keywords
        for keyword in &keywords {
            let has_a = a.contains(keyword);
            let has_b = b.contains(keyword);

            if has_a == has_b {
                score += 1.0;
            }
            total_checks += 1.0;
        }

        if total_checks == 0.0 {
            return 0.0;
        }

        score / total_checks
    }

    /// Calculate exact match (for high confidence scenarios)
    pub fn is_exact_match(a: &str, b: &str) -> bool {
        Self::normalize_code(a) == Self::normalize_code(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_chunk(code: &str) -> CodeChunk {
        CodeChunk {
            code: code.to_string(),
            start_byte: 0,
            end_byte: code.len(),
            start_line: 0,
            end_line: 0,
            node_type: "function_declaration".to_string(),
            parent_type: None,
        }
    }

    #[test]
    fn test_exact_match() {
        let code1 = "function test() { return 1; }";
        let code2 = "function test() { return 1; }";

        assert!(SimilarityMatcher::is_exact_match(code1, code2));
    }

    #[test]
    fn test_normalized_match() {
        let code1 = "function test() { return 1; }";
        let code2 = "function  test()  {  return  1;  }"; // extra whitespace

        assert!(SimilarityMatcher::is_exact_match(code1, code2));
    }

    #[test]
    fn test_find_best_match() {
        let chunks = vec![
            create_test_chunk("function foo() { return 1; }"),
            create_test_chunk("function bar() { return 2; }"),
            create_test_chunk("function baz() { return 3; }"),
        ];

        let edit = "function bar() { return 42; }";
        let result = SimilarityMatcher::find_best_match(edit, &chunks);

        assert!(result.is_some());
        let result = result.unwrap();
        assert!(result.chunk.code.contains("bar"));
        assert!(result.similarity > 0.7, "Similarity should be high for similar functions");
    }

    #[test]
    fn test_token_similarity() {
        let a = "function test return value";
        let b = "function test return something";

        let score = SimilarityMatcher::token_similarity(a, b);
        assert!(score > 0.5, "Should have high token overlap");
    }

    #[test]
    fn test_structure_similarity() {
        let a = "function test() { return 1; }";
        let b = "function other() { return 2; }";

        let score = SimilarityMatcher::structure_similarity(a, b);
        assert!(score > 0.7, "Should have high structural similarity");
    }

    #[test]
    fn test_top_k_matches() {
        let chunks = vec![
            create_test_chunk("function foo() { return 1; }"),
            create_test_chunk("function bar() { return 2; }"),
            create_test_chunk("function baz() { return 3; }"),
            create_test_chunk("const x = 42;"),
        ];

        let edit = "function test() { return 99; }";
        let results = SimilarityMatcher::find_top_k_matches(edit, &chunks, 3);

        assert_eq!(results.len(), 3);
        // First results should be functions, not const
        assert!(results[0].chunk.code.contains("function"));
    }
}
