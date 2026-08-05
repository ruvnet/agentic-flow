/**
 * FoldingPatternLearner - Learn and retrieve folding patterns using AgentDB
 *
 * Stores successful folding patterns in AgentDB vector database:
 * - Vector embeddings of sequence fragments
 * - 150x faster similarity search (HNSW indexing)
 * - Transfer learning from known structures
 * - Pattern recognition for similar proteins
 */

import { AgentDB } from 'agentdb';
import {
  ProteinStructure,
  FoldingPattern,
  Atom
} from './types';

export class FoldingPatternLearner {
  private db: AgentDB;
  private fragmentLength: number;
  private minOccurrences: number;

  constructor(
    dbPath: string = './folding-patterns.db',
    fragmentLength: number = 7,
    minOccurrences: number = 3
  ) {
    // Initialize AgentDB with vector search
    this.db = new AgentDB({
      path: dbPath,
      vectorDimensions: 768, // ESM-2 embedding size
      distanceMetric: 'cosine'
    });

    this.fragmentLength = fragmentLength;
    this.minOccurrences = minOccurrences;
  }

  /**
   * Store successful folding pattern
   */
  async storePattern(
    sequence: string,
    structure: ProteinStructure,
    confidence: number
  ): Promise<void> {
    // Extract fragments and store each one
    for (let i = 0; i <= sequence.length - this.fragmentLength; i++) {
      const fragment = sequence.substring(i, i + this.fragmentLength);
      const fragmentAtoms = structure.atoms.filter(
        atom => atom.residueNumber >= i + 1 && atom.residueNumber <= i + this.fragmentLength
      );

      if (fragmentAtoms.length === 0) continue;

      // Generate embedding for sequence fragment
      const embedding = await this.generateEmbedding(fragment);

      // Check if pattern already exists
      const existingPattern = await this.findExactPattern(fragment);

      if (existingPattern) {
        // Update existing pattern
        await this.updatePattern(existingPattern.id, confidence);
      } else {
        // Store new pattern
        const pattern: FoldingPattern = {
          id: this.generatePatternId(fragment),
          sequenceFragment: fragment,
          structureFragment: fragmentAtoms,
          embedding,
          confidence,
          occurrences: 1,
          successRate: confidence
        };

        await this.db.insert('patterns', pattern.id, pattern, embedding);
      }
    }
  }

  /**
   * Find similar folding patterns
   */
  async findSimilarPatterns(
    sequenceFragment: string,
    topK: number = 5,
    minConfidence: number = 0.7
  ): Promise<FoldingPattern[]> {
    // Generate embedding for query fragment
    const embedding = await this.generateEmbedding(sequenceFragment);

    // Vector similarity search (150x faster with HNSW)
    const results = await this.db.search('patterns', embedding, topK);

    // Filter by confidence and return
    return results
      .map(r => r.data as FoldingPattern)
      .filter(p => p.confidence >= minConfidence);
  }

  /**
   * Predict structure using learned patterns
   */
  async predictFromPatterns(sequence: string): Promise<Atom[]> {
    const predictedAtoms: Atom[] = [];

    // For each position in sequence
    for (let i = 0; i <= sequence.length - this.fragmentLength; i++) {
      const fragment = sequence.substring(i, i + this.fragmentLength);

      // Find similar patterns
      const patterns = await this.findSimilarPatterns(fragment, 3, 0.8);

      if (patterns.length > 0) {
        // Use best matching pattern
        const bestPattern = patterns[0];

        // Copy structure with offset
        for (const atom of bestPattern.structureFragment) {
          const offsetAtom = {
            ...atom,
            residueNumber: atom.residueNumber + i,
            atomId: predictedAtoms.length + 1
          };
          predictedAtoms.push(offsetAtom);
        }
      }
    }

    return predictedAtoms;
  }

  /**
   * Generate vector embedding for sequence fragment
   * In production, use ESM-2 or ProtTrans model
   */
  private async generateEmbedding(sequence: string): Promise<number[]> {
    // Mock implementation - in production, call ESM-2 API
    const embedding: number[] = new Array(768).fill(0);

    // Simple hash-based embedding for demonstration
    for (let i = 0; i < sequence.length; i++) {
      const aa = sequence[i];
      const aaIndex = aa.charCodeAt(0) - 65; // A=0, B=1, ...

      // Distribute across embedding dimensions
      const startIdx = (i * 100) % 768;
      for (let j = 0; j < 100; j++) {
        const idx = (startIdx + j) % 768;
        embedding[idx] += (aaIndex + 1) / (sequence.length + 1);
      }
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
  }

  /**
   * Find exact pattern match
   */
  private async findExactPattern(sequence: string): Promise<FoldingPattern | null> {
    const id = this.generatePatternId(sequence);

    try {
      const pattern = await this.db.get('patterns', id);
      return pattern as FoldingPattern;
    } catch {
      return null;
    }
  }

  /**
   * Update existing pattern statistics
   */
  private async updatePattern(id: string, newConfidence: number): Promise<void> {
    const pattern = await this.db.get('patterns', id) as FoldingPattern;

    if (pattern) {
      pattern.occurrences += 1;
      pattern.successRate = (
        (pattern.successRate * (pattern.occurrences - 1) + newConfidence) /
        pattern.occurrences
      );

      await this.db.update('patterns', id, pattern, pattern.embedding);
    }
  }

  /**
   * Generate unique ID for pattern
   */
  private generatePatternId(sequence: string): string {
    return `pattern-${sequence}`;
  }

  /**
   * Get statistics about learned patterns
   */
  async getStatistics(): Promise<{
    totalPatterns: number;
    avgOccurrences: number;
    avgSuccessRate: number;
    topPatterns: FoldingPattern[];
  }> {
    // Query all patterns
    const allPatterns = await this.db.query('patterns', {});

    if (allPatterns.length === 0) {
      return {
        totalPatterns: 0,
        avgOccurrences: 0,
        avgSuccessRate: 0,
        topPatterns: []
      };
    }

    const patterns = allPatterns.map(p => p.data as FoldingPattern);

    const avgOccurrences = patterns.reduce((sum, p) => sum + p.occurrences, 0) / patterns.length;
    const avgSuccessRate = patterns.reduce((sum, p) => sum + p.successRate, 0) / patterns.length;

    // Get top patterns by occurrences
    const topPatterns = [...patterns]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10);

    return {
      totalPatterns: patterns.length,
      avgOccurrences,
      avgSuccessRate,
      topPatterns
    };
  }

  /**
   * Export patterns to JSON
   */
  async exportPatterns(filepath: string): Promise<void> {
    const allPatterns = await this.db.query('patterns', {});
    const patterns = allPatterns.map(p => p.data);

    const fs = await import('fs/promises');
    await fs.writeFile(filepath, JSON.stringify(patterns, null, 2));
  }

  /**
   * Close database
   */
  async close(): Promise<void> {
    await this.db.close();
  }
}
