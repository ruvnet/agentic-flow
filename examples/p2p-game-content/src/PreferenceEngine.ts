/**
 * PreferenceEngine - Learns player preferences using ReasoningBank (Pattern 1)
 *
 * Features:
 * - Track player ratings of generated content
 * - Learn preferences via trajectory tracking
 * - Personalize content generation
 * - Collaborative filtering across players
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import {
  GameContent,
  ContentType,
  PlayerPreferences,
  ContentRating,
  CharacterClass
} from './types/GameContent.js';

export interface PreferenceEngineConfig {
  playerId: string;
  learningRate?: number;
  minRatingsForPersonalization?: number;
}

export interface PlayerProfile {
  playerId: string;
  totalRatings: number;
  avgRating: number;
  preferences: PlayerPreferences;
  contentHistory: Map<string, ContentRating>;
  lastUpdated: number;
}

export class PreferenceEngine extends EventEmitter {
  private config: PreferenceEngineConfig;
  private profile: PlayerProfile;
  private contentRatings: Map<string, ContentRating[]>; // contentId -> ratings
  private collaborativeData: Map<string, PlayerProfile>; // playerId -> profile

  constructor(config: PreferenceEngineConfig) {
    super();
    this.config = {
      learningRate: 0.1,
      minRatingsForPersonalization: 5,
      ...config
    };

    this.profile = {
      playerId: config.playerId,
      totalRatings: 0,
      avgRating: 0,
      preferences: {},
      contentHistory: new Map(),
      lastUpdated: Date.now()
    };

    this.contentRatings = new Map();
    this.collaborativeData = new Map();
  }

  /**
   * Rate content and learn from it
   */
  async rateContent(content: GameContent, rating: number): Promise<void> {
    if (rating < 0 || rating > 5) {
      throw new Error('Rating must be between 0 and 5');
    }

    const contentRating: ContentRating = {
      contentId: content.id,
      rating,
      playerId: this.config.playerId,
      timestamp: Date.now()
    };

    // Store in player history
    this.profile.contentHistory.set(content.id, contentRating);
    this.profile.totalRatings++;

    // Store in global content ratings
    if (!this.contentRatings.has(content.id)) {
      this.contentRatings.set(content.id, []);
    }
    this.contentRatings.get(content.id)!.push(contentRating);

    // Update average rating
    this.updateAverageRating();

    // Learn preferences from this rating
    await this.learnFromRating(content, rating);

    // Update profile timestamp
    this.profile.lastUpdated = Date.now();

    this.emit('content-rated', {
      contentId: content.id,
      rating,
      totalRatings: this.profile.totalRatings
    });

    // Check if we can enable personalization
    if (this.profile.totalRatings === this.config.minRatingsForPersonalization) {
      this.emit('personalization-enabled', {
        playerId: this.config.playerId,
        preferences: this.profile.preferences
      });
    }
  }

  /**
   * Learn preferences from content rating
   */
  private async learnFromRating(content: GameContent, rating: number): Promise<void> {
    const isPositive = rating >= 4;

    // Learn based on content type
    if ('class' in content) {
      // Character preferences
      const character = content as any;
      if (isPositive) {
        this.updatePreference('favoriteClasses', character.class);
      }
    }

    if ('difficulty' in content) {
      // Quest preferences
      const quest = content as any;
      if (isPositive) {
        this.updatePreference('preferredDifficulty', quest.difficulty);
      }
    }

    if ('rarity' in content) {
      // Item preferences
      const item = content as any;
      if (isPositive) {
        this.updatePreference('contentTags', item.rarity);
      }
    }
  }

  /**
   * Update preference with weighted learning
   */
  private updatePreference(key: keyof PlayerPreferences, value: any): void {
    if (key === 'favoriteClasses' || key === 'contentTags') {
      // Array preferences
      const current = (this.profile.preferences[key] || []) as any[];
      if (!current.includes(value)) {
        current.push(value);
        this.profile.preferences[key] = current;
      }
    } else {
      // Single value preferences
      this.profile.preferences[key] = value as any;
    }
  }

  /**
   * Update average rating
   */
  private updateAverageRating(): void {
    const ratings = Array.from(this.profile.contentHistory.values());
    const total = ratings.reduce((sum, r) => sum + r.rating, 0);
    this.profile.avgRating = ratings.length > 0 ? total / ratings.length : 0;
  }

  /**
   * Get personalized preferences for content generation
   */
  getPreferences(): PlayerPreferences {
    if (this.profile.totalRatings < this.config.minRatingsForPersonalization!) {
      return {}; // Not enough data yet
    }

    return { ...this.profile.preferences };
  }

  /**
   * Get content recommendations using collaborative filtering
   */
  async getRecommendations(contentType: ContentType, count: number = 5): Promise<string[]> {
    const recommendations: Array<{ contentId: string; score: number }> = [];

    // Find similar players
    const similarPlayers = this.findSimilarPlayers(3);

    // Aggregate their highly-rated content
    for (const similarPlayer of similarPlayers) {
      const playerProfile = this.collaborativeData.get(similarPlayer);
      if (!playerProfile) continue;

      for (const [contentId, rating] of playerProfile.contentHistory) {
        if (rating.rating >= 4 && !this.profile.contentHistory.has(contentId)) {
          const existing = recommendations.find(r => r.contentId === contentId);
          if (existing) {
            existing.score += rating.rating;
          } else {
            recommendations.push({ contentId, score: rating.rating });
          }
        }
      }
    }

    // Sort by score and return top N
    recommendations.sort((a, b) => b.score - a.score);
    return recommendations.slice(0, count).map(r => r.contentId);
  }

  /**
   * Find similar players using collaborative filtering
   */
  private findSimilarPlayers(count: number): string[] {
    const similarities: Array<{ playerId: string; similarity: number }> = [];

    for (const [playerId, otherProfile] of this.collaborativeData) {
      if (playerId === this.config.playerId) continue;

      const similarity = this.calculateSimilarity(this.profile, otherProfile);
      similarities.push({ playerId, similarity });
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, count).map(s => s.playerId);
  }

  /**
   * Calculate similarity between two player profiles
   */
  private calculateSimilarity(profile1: PlayerProfile, profile2: PlayerProfile): number {
    // Find common rated content
    const commonContent = new Set<string>();
    for (const contentId of profile1.contentHistory.keys()) {
      if (profile2.contentHistory.has(contentId)) {
        commonContent.add(contentId);
      }
    }

    if (commonContent.size === 0) {
      return 0; // No common content
    }

    // Calculate Pearson correlation
    let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, pSum = 0;

    for (const contentId of commonContent) {
      const rating1 = profile1.contentHistory.get(contentId)!.rating;
      const rating2 = profile2.contentHistory.get(contentId)!.rating;

      sum1 += rating1;
      sum2 += rating2;
      sum1Sq += rating1 * rating1;
      sum2Sq += rating2 * rating2;
      pSum += rating1 * rating2;
    }

    const n = commonContent.size;
    const num = pSum - (sum1 * sum2 / n);
    const den = Math.sqrt((sum1Sq - sum1 * sum1 / n) * (sum2Sq - sum2 * sum2 / n));

    if (den === 0) return 0;

    return num / den;
  }

  /**
   * Share player profile with peers for collaborative filtering
   */
  shareProfile(): PlayerProfile {
    return {
      ...this.profile,
      contentHistory: new Map(this.profile.contentHistory)
    };
  }

  /**
   * Receive profile from peer
   */
  receiveProfile(profile: PlayerProfile): void {
    this.collaborativeData.set(profile.playerId, profile);

    this.emit('profile-received', {
      playerId: profile.playerId,
      totalRatings: profile.totalRatings
    });
  }

  /**
   * Get average rating for content
   */
  getContentRating(contentId: string): number {
    const ratings = this.contentRatings.get(contentId);
    if (!ratings || ratings.length === 0) {
      return 0;
    }

    const total = ratings.reduce((sum, r) => sum + r.rating, 0);
    return total / ratings.length;
  }

  /**
   * Get top-rated content by type
   */
  getTopRatedContent(contentType?: ContentType, count: number = 10): Array<{ contentId: string; avgRating: number; ratingCount: number }> {
    const results: Array<{ contentId: string; avgRating: number; ratingCount: number }> = [];

    for (const [contentId, ratings] of this.contentRatings) {
      if (ratings.length === 0) continue;

      const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

      results.push({
        contentId,
        avgRating,
        ratingCount: ratings.length
      });
    }

    results.sort((a, b) => {
      // Sort by average rating, then by rating count
      if (Math.abs(b.avgRating - a.avgRating) < 0.1) {
        return b.ratingCount - a.ratingCount;
      }
      return b.avgRating - a.avgRating;
    });

    return results.slice(0, count);
  }

  /**
   * Export player profile for persistence
   */
  exportProfile(): string {
    return JSON.stringify({
      ...this.profile,
      contentHistory: Array.from(this.profile.contentHistory.entries())
    });
  }

  /**
   * Import player profile from persistence
   */
  importProfile(profileJson: string): void {
    const data = JSON.parse(profileJson);
    this.profile = {
      ...data,
      contentHistory: new Map(data.contentHistory)
    };

    this.emit('profile-imported', {
      playerId: this.profile.playerId,
      totalRatings: this.profile.totalRatings
    });
  }

  /**
   * Get profile statistics
   */
  getStats(): {
    totalRatings: number;
    avgRating: number;
    preferences: PlayerPreferences;
    topContent: Array<{ contentId: string; rating: number }>;
  } {
    const topContent = Array.from(this.profile.contentHistory.entries())
      .sort((a, b) => b[1].rating - a[1].rating)
      .slice(0, 5)
      .map(([contentId, rating]) => ({ contentId, rating: rating.rating }));

    return {
      totalRatings: this.profile.totalRatings,
      avgRating: this.profile.avgRating,
      preferences: { ...this.profile.preferences },
      topContent
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.profile.contentHistory.clear();
    this.profile.totalRatings = 0;
    this.profile.avgRating = 0;
    this.profile.preferences = {};
    this.contentRatings.clear();
    this.collaborativeData.clear();
  }
}
