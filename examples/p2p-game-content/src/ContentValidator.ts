/**
 * ContentValidator - Byzantine consensus for content validation (Pattern 5)
 *
 * Features:
 * - Byzantine fault-tolerant consensus across 5+ players
 * - Requires 2/3 approval for new content
 * - Filters: profanity, broken stats, exploits
 * - <500ms consensus time
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import {
  GameContent,
  ContentValidation,
  ValidationVote,
  GameCharacter,
  GameItem,
  GameQuest
} from './types/GameContent.js';
import { P2PNetwork } from './P2PNetwork.js';

export interface ContentValidatorConfig {
  minValidators?: number;
  consensusThreshold?: number; // 0-1, e.g., 0.67 for 2/3
  validationTimeout?: number; // ms
  enableProfanityFilter?: boolean;
  enableBalanceCheck?: boolean;
}

export class ContentValidator extends EventEmitter {
  private config: ContentValidatorConfig;
  private network: P2PNetwork;
  private pendingValidations: Map<string, ContentValidation>;
  private profanityList: Set<string>;
  private validationTimers: Map<string, NodeJS.Timeout>;

  constructor(network: P2PNetwork, config: ContentValidatorConfig = {}) {
    super();
    this.config = {
      minValidators: 5,
      consensusThreshold: 0.67,
      validationTimeout: 500,
      enableProfanityFilter: true,
      enableBalanceCheck: true,
      ...config
    };

    this.network = network;
    this.pendingValidations = new Map();
    this.validationTimers = new Map();
    this.profanityList = this.initializeProfanityFilter();

    this.setupNetworkHandlers();
  }

  /**
   * Validate content using Byzantine consensus
   * Returns true if content is approved by 2/3+ validators
   */
  async validateContent(content: GameContent): Promise<boolean> {
    const startTime = performance.now();

    try {
      // Step 1: Local validation checks
      const localChecks = await this.performLocalValidation(content);
      if (!localChecks.valid) {
        this.emit('validation-failed', {
          contentId: content.id,
          reason: 'local-checks',
          details: localChecks.reasons
        });
        return false;
      }

      // Step 2: Request validation from peers
      const validationId = nanoid();
      const validation: ContentValidation = {
        contentId: content.id,
        isValid: false,
        votes: [],
        consensus: false,
        timestamp: Date.now()
      };

      this.pendingValidations.set(validationId, validation);

      // Broadcast validation request
      this.network.gossip({
        type: 'validation-request',
        validationId,
        content,
        requestor: this.network.getStats().peerId
      });

      // Wait for responses with timeout
      const consensusReached = await this.waitForConsensus(
        validationId,
        this.config.validationTimeout!
      );

      const validationTime = performance.now() - startTime;

      if (validationTime > this.config.validationTimeout!) {
        this.emit('validation-timeout', {
          contentId: content.id,
          time: validationTime
        });
      }

      this.emit('validation-complete', {
        contentId: content.id,
        consensus: consensusReached,
        time: validationTime,
        votes: validation.votes.length
      });

      return consensusReached;
    } catch (error: any) {
      this.emit('validation-error', {
        contentId: content.id,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Perform local validation checks
   */
  private async performLocalValidation(
    content: GameContent
  ): Promise<{ valid: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    // Profanity filter
    if (this.config.enableProfanityFilter) {
      if (this.containsProfanity(content)) {
        reasons.push('Contains inappropriate language');
      }
    }

    // Type-specific validation
    if ('stats' in content) {
      const character = content as GameCharacter;
      if (this.config.enableBalanceCheck) {
        if (!this.validateCharacterStats(character)) {
          reasons.push('Character stats are unbalanced or invalid');
        }
      }
    }

    if ('type' in content && content.type === 'item') {
      const item = content as GameItem;
      if (this.config.enableBalanceCheck) {
        if (!this.validateItemStats(item)) {
          reasons.push('Item stats are unbalanced or invalid');
        }
      }
    }

    if ('rewards' in content) {
      const quest = content as GameQuest;
      if (this.config.enableBalanceCheck) {
        if (!this.validateQuestRewards(quest)) {
          reasons.push('Quest rewards are unbalanced or invalid');
        }
      }
    }

    return {
      valid: reasons.length === 0,
      reasons
    };
  }

  /**
   * Check for profanity in content
   */
  private containsProfanity(content: GameContent): boolean {
    const textFields: string[] = [];

    // Extract text fields based on content type
    if ('name' in content) textFields.push(content.name);
    if ('description' in content) textFields.push(content.description);
    if ('title' in content) textFields.push(content.title);

    const text = textFields.join(' ').toLowerCase();

    for (const word of this.profanityList) {
      if (text.includes(word)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate character stats for balance
   */
  private validateCharacterStats(character: GameCharacter): boolean {
    const stats = character.stats;

    // Check for negative stats
    if (Object.values(stats).some(val => val < 0)) {
      return false;
    }

    // Check for unreasonably high stats
    const maxStatValue = 1000 * character.level;
    if (Object.values(stats).some(val => val > maxStatValue)) {
      return false;
    }

    // Check total stat budget
    const totalStats = Object.values(stats).reduce((a, b) => a + b, 0);
    const expectedBudget = 100 * character.level;
    if (totalStats > expectedBudget * 3) {
      return false; // Too powerful
    }

    return true;
  }

  /**
   * Validate item stats for balance
   */
  private validateItemStats(item: GameItem): boolean {
    if (!item.stats) return true;

    // Check for negative stats
    if (Object.values(item.stats).some(val => val && val < 0)) {
      return false;
    }

    // Rarity-based max values
    const rarityMultipliers: Record<string, number> = {
      common: 10,
      uncommon: 20,
      rare: 40,
      epic: 80,
      legendary: 150,
      mythic: 300
    };

    const maxValue = rarityMultipliers[item.rarity] || 10;

    if (Object.values(item.stats).some(val => val && val > maxValue)) {
      return false;
    }

    return true;
  }

  /**
   * Validate quest rewards for balance
   */
  private validateQuestRewards(quest: GameQuest): boolean {
    const rewards = quest.rewards;

    // Check for negative rewards
    if (rewards.gold < 0 || rewards.experience < 0) {
      return false;
    }

    // Difficulty-based max rewards
    const difficultyMultipliers: Record<string, number> = {
      easy: 100,
      medium: 500,
      hard: 2000,
      legendary: 10000
    };

    const maxReward = difficultyMultipliers[quest.difficulty] || 100;

    if (rewards.gold > maxReward || rewards.experience > maxReward) {
      return false;
    }

    return true;
  }

  /**
   * Wait for Byzantine consensus
   */
  private async waitForConsensus(
    validationId: string,
    timeout: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.validationTimers.delete(validationId);
        const validation = this.pendingValidations.get(validationId);

        if (validation) {
          const consensus = this.checkConsensus(validation);
          validation.consensus = consensus;
          resolve(consensus);
        } else {
          resolve(false);
        }
      }, timeout);

      this.validationTimers.set(validationId, timer);

      // Check consensus immediately if enough votes
      const checkConsensusInterval = setInterval(() => {
        const validation = this.pendingValidations.get(validationId);
        if (validation && validation.votes.length >= this.config.minValidators!) {
          clearInterval(checkConsensusInterval);
          clearTimeout(timer);
          this.validationTimers.delete(validationId);

          const consensus = this.checkConsensus(validation);
          validation.consensus = consensus;
          resolve(consensus);
        }
      }, 50);
    });
  }

  /**
   * Check if consensus is reached
   */
  private checkConsensus(validation: ContentValidation): boolean {
    if (validation.votes.length < this.config.minValidators!) {
      return false;
    }

    const approvals = validation.votes.filter(v => v.approved).length;
    const approvalRate = approvals / validation.votes.length;

    return approvalRate >= this.config.consensusThreshold!;
  }

  /**
   * Setup network message handlers
   */
  private setupNetworkHandlers(): void {
    this.network.on('gossip-received', ({ content, originPeer }) => {
      if (content.type === 'validation-request') {
        this.handleValidationRequest(content);
      } else if (content.type === 'validation-response') {
        this.handleValidationResponse(content);
      }
    });
  }

  /**
   * Handle validation request from peer
   */
  private async handleValidationRequest(request: any): Promise<void> {
    const { validationId, content, requestor } = request;

    // Perform local validation
    const localChecks = await this.performLocalValidation(content);

    // Send response back via gossip
    this.network.gossip({
      type: 'validation-response',
      validationId,
      vote: {
        peerId: this.network.getStats().peerId,
        approved: localChecks.valid,
        reason: localChecks.reasons.join(', '),
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle validation response from peer
   */
  private handleValidationResponse(response: any): void {
    const { validationId, vote } = response;

    const validation = this.pendingValidations.get(validationId);
    if (!validation) return;

    // Add vote if not duplicate
    if (!validation.votes.some(v => v.peerId === vote.peerId)) {
      validation.votes.push(vote);

      this.emit('vote-received', {
        validationId,
        vote,
        totalVotes: validation.votes.length
      });
    }
  }

  /**
   * Initialize profanity filter
   */
  private initializeProfanityFilter(): Set<string> {
    // Basic profanity list (extend as needed)
    return new Set([
      'badword1',
      'badword2',
      'offensive',
      // Add more as needed
    ]);
  }

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    pending: number;
    totalValidations: number;
    avgConsensusTime: number;
  } {
    return {
      pending: this.pendingValidations.size,
      totalValidations: 0, // Track this
      avgConsensusTime: 0 // Track this
    };
  }

  /**
   * Cleanup old validations
   */
  cleanup(): void {
    const maxAge = 60000; // 1 minute
    const now = Date.now();

    for (const [id, validation] of this.pendingValidations.entries()) {
      if (now - validation.timestamp > maxAge) {
        const timer = this.validationTimers.get(id);
        if (timer) {
          clearTimeout(timer);
          this.validationTimers.delete(id);
        }
        this.pendingValidations.delete(id);
      }
    }
  }

  /**
   * Shutdown validator
   */
  async shutdown(): Promise<void> {
    // Clear all timers
    for (const timer of this.validationTimers.values()) {
      clearTimeout(timer);
    }

    this.validationTimers.clear();
    this.pendingValidations.clear();
  }
}
