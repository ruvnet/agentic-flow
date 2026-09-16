/**
 * P2P Game Content Generator - Main Entry Point
 *
 * A decentralized procedural game content generator using:
 * - Pattern 1: Self-Improving Codegen (Agent Booster + ReasoningBank)
 * - Pattern 3: CRDT Gossip (decentralized synchronization)
 * - Pattern 4: Ephemeral Memory (on-demand agent spawning)
 * - Pattern 5: Multi-Model Consensus (Byzantine validation)
 */

export { ContentGenerator } from './ContentGenerator.js';
export { P2PNetwork } from './P2PNetwork.js';
export { ContentValidator } from './ContentValidator.js';
export { PreferenceEngine } from './PreferenceEngine.js';
export { AssetRenderer } from './AssetRenderer.js';
export { GameState } from './GameState.js';

export * from './types/GameContent.js';
export * from './types/Network.js';

import { ContentGenerator } from './ContentGenerator.js';
import { P2PNetwork } from './P2PNetwork.js';
import { ContentValidator } from './ContentValidator.js';
import { PreferenceEngine } from './PreferenceEngine.js';
import { AssetRenderer } from './AssetRenderer.js';
import { GameState } from './GameState.js';
import { nanoid } from 'nanoid';

/**
 * Main P2P Game Content Manager
 * Orchestrates all components
 */
export class P2PGameContentManager {
  private playerId: string;
  private network: P2PNetwork;
  private generator: ContentGenerator;
  private validator: ContentValidator;
  private preferences: PreferenceEngine;
  private renderer: AssetRenderer;
  private gameState: GameState;
  private initialized: boolean;

  constructor(playerId?: string) {
    this.playerId = playerId || nanoid();
    this.initialized = false;

    // Initialize components
    this.network = new P2PNetwork({ peerId: this.playerId });
    this.generator = new ContentGenerator({ tenantId: this.playerId });
    this.validator = new ContentValidator(this.network);
    this.preferences = new PreferenceEngine({ playerId: this.playerId });
    this.renderer = new AssetRenderer();
    this.gameState = new GameState(this.network, { playerId: this.playerId });

    this.setupIntegrations();
  }

  /**
   * Initialize the P2P game content system
   */
  async initialize(canvas?: HTMLCanvasElement): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize network
    await this.network.initialize();

    // Initialize game state
    await this.gameState.initialize();

    // Initialize renderer if canvas provided
    if (canvas) {
      this.renderer.initialize(canvas);
    }

    this.initialized = true;

    console.log(`[P2PGameContent] Initialized with peer ID: ${this.playerId}`);
  }

  /**
   * Setup integrations between components
   */
  private setupIntegrations(): void {
    // When content is generated, share it via network
    this.generator.on('content-generated', async ({ type, contentId }) => {
      // Content will be validated before sharing
    });

    // When content is rated, learn from it
    this.preferences.on('content-rated', async ({ contentId, rating }) => {
      await this.generator.learnFromRating(contentId, rating);
    });

    // When content is shared, receive it
    this.network.onMessage('content_share', (message) => {
      const { content } = message.payload;
      this.gameState.shareContent(content);
    });

    // Share player preferences periodically
    setInterval(() => {
      if (this.network.getConnectedPeers().length > 0) {
        const profile = this.preferences.shareProfile();
        this.network.gossip({
          type: 'player-profile',
          profile
        });
      }
    }, 30000); // Every 30 seconds

    // Receive player profiles
    this.network.on('gossip-received', ({ content }) => {
      if (content.type === 'player-profile') {
        this.preferences.receiveProfile(content.profile);
      }
    });
  }

  /**
   * Generate and validate content
   */
  async generateContent(type: any, params?: any): Promise<any> {
    // Get player preferences for personalization
    const playerPreferences = this.preferences.getPreferences();

    // Generate content
    const content = await this.generator.generateContent({
      type,
      params: {
        ...params,
        createdBy: this.playerId
      },
      playerPreferences
    });

    // Validate with Byzantine consensus
    const isValid = await this.validator.validateContent(content);

    if (isValid) {
      // Share with network
      this.network.broadcastContent(content);

      // Add to game state
      this.gameState.shareContent(content);

      return content;
    } else {
      throw new Error('Content failed validation');
    }
  }

  /**
   * Rate content
   */
  async rateContent(content: any, rating: number): Promise<void> {
    await this.preferences.rateContent(content, rating);
  }

  /**
   * Connect to a peer
   */
  async connectToPeer(peerId: string): Promise<void> {
    await this.network.connectToPeer(peerId);
  }

  /**
   * Get all components
   */
  getComponents() {
    return {
      network: this.network,
      generator: this.generator,
      validator: this.validator,
      preferences: this.preferences,
      renderer: this.renderer,
      gameState: this.gameState
    };
  }

  /**
   * Get system statistics
   */
  getStats() {
    return {
      playerId: this.playerId,
      network: this.network.getStats(),
      generation: this.generator.getPerformanceStats(),
      preferences: this.preferences.getStats(),
      gameState: this.gameState.getStats()
    };
  }

  /**
   * Shutdown the system
   */
  async shutdown(): Promise<void> {
    await this.generator.shutdown();
    await this.validator.shutdown();
    await this.gameState.shutdown();
    await this.network.shutdown();

    this.initialized = false;

    console.log('[P2PGameContent] Shutdown complete');
  }
}

// Default export
export default P2PGameContentManager;
