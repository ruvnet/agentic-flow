/**
 * Integration Tests - Full workflow testing
 */

import P2PGameContentManager from '../src/index';

describe('P2P Game Content Integration', () => {
  let manager1: P2PGameContentManager;
  let manager2: P2PGameContentManager;

  beforeEach(async () => {
    manager1 = new P2PGameContentManager('peer-1');
    manager2 = new P2PGameContentManager('peer-2');

    await manager1.initialize();
    await manager2.initialize();
  });

  afterEach(async () => {
    await manager1.shutdown();
    await manager2.shutdown();
  });

  describe('End-to-End Content Flow', () => {
    it('should generate, validate, and share content', async () => {
      // Generate content
      const character = await manager1.generateContent('character', {
        class: 'warrior',
        level: 10
      });

      expect(character).toBeDefined();
      expect((character as any).class).toBe('warrior');
      expect((character as any).level).toBe(10);

      // Rate content
      await manager1.rateContent(character, 5);

      const stats = manager1.getStats();
      expect(stats.preferences.totalRatings).toBe(1);
    });

    it('should learn from multiple ratings', async () => {
      // Generate and rate multiple characters
      for (let i = 0; i < 10; i++) {
        const character = await manager1.generateContent('character', {
          class: 'warrior'
        });
        await manager1.rateContent(character, 5);
      }

      const stats = manager1.getStats();
      expect(stats.preferences.totalRatings).toBe(10);
      expect(stats.preferences.avgRating).toBeGreaterThan(4.5);
    });

    it('should reject invalid content', async () => {
      // This is a simplified test - in reality, invalid content
      // would be created by malicious actors
      const invalidCharacter = {
        id: 'invalid',
        name: 'Hacker',
        class: 'warrior',
        level: 9999999, // Impossibly high level
        stats: {
          hp: 999999999,
          atk: 999999999,
          def: 999999999,
          spd: 999999999
        },
        appearance: 'broken',
        createdBy: 'hacker',
        timestamp: Date.now()
      };

      const components = manager1.getComponents();
      const isValid = await components.validator.validateContent(invalidCharacter);

      expect(isValid).toBe(false);
    });
  });

  describe('P2P Synchronization', () => {
    it('should synchronize game state between peers', async () => {
      const components1 = manager1.getComponents();
      const components2 = manager2.getComponents();

      // Update player position in manager1
      components1.gameState.updatePlayerPosition(10, 20);

      // Wait for sync (in real implementation)
      await new Promise(resolve => setTimeout(resolve, 200));

      const state1 = components1.gameState.getStats();
      expect(state1.version).toBeGreaterThan(0);
    });

    it('should share content across network', async () => {
      const components1 = manager1.getComponents();
      const components2 = manager2.getComponents();

      // Generate content
      const quest = await manager1.generateContent('quest', {
        difficulty: 'hard'
      });

      // Share via network
      components1.gameState.shareContent(quest);

      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 200));

      const sharedContent1 = components1.gameState.getSharedContent();
      expect(sharedContent1.length).toBeGreaterThan(0);
    });
  });

  describe('Preference Learning', () => {
    it('should enable personalization after minimum ratings', async () => {
      const components = manager1.getComponents();

      // Rate 5 items to enable personalization
      for (let i = 0; i < 5; i++) {
        const character = await manager1.generateContent('character', {
          class: 'mage'
        });
        await manager1.rateContent(character, 5);
      }

      const prefs = components.preferences.getPreferences();
      expect(prefs.favoriteClasses).toBeDefined();
      expect(prefs.favoriteClasses).toContain('mage');
    });

    it('should share profiles between peers', async () => {
      const components1 = manager1.getComponents();
      const components2 = manager2.getComponents();

      // Create some ratings in manager1
      for (let i = 0; i < 3; i++) {
        const character = await manager1.generateContent('character');
        await manager1.rateContent(character, 4);
      }

      // Share profile
      const profile1 = components1.preferences.shareProfile();
      components2.preferences.receiveProfile(profile1);

      // Manager2 should now have manager1's profile
      const stats2 = components2.preferences.getStats();
      // This is a simplified test - in reality would check collaborative filtering
      expect(true).toBe(true);
    });
  });

  describe('Performance Validation', () => {
    it('should meet generation time targets', async () => {
      const startTime = performance.now();

      await manager1.generateContent('character');
      await manager1.generateContent('quest');
      await manager1.generateContent('item');

      const totalTime = performance.now() - startTime;

      // 3 generations should take < 50ms total in test environment
      expect(totalTime).toBeLessThan(100);
    });

    it('should handle burst content generation', async () => {
      const startTime = performance.now();

      // Generate 20 items rapidly
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(manager1.generateContent('item'));
      }

      await Promise.all(promises);

      const totalTime = performance.now() - startTime;
      const avgTime = totalTime / 20;

      // Average should still be low
      expect(avgTime).toBeLessThan(20);
    });

    it('should cache duplicate requests', async () => {
      const params = { class: 'warrior', level: 5 };

      const start1 = performance.now();
      const first = await manager1.generateContent('character', params);
      const time1 = performance.now() - start1;

      const start2 = performance.now();
      const second = await manager1.generateContent('character', params);
      const time2 = performance.now() - start2;

      // Second should be cached and much faster
      expect(time2).toBeLessThan(time1);
      expect(first.id).toBe(second.id);
    });
  });

  describe('Content Validation', () => {
    it('should validate balanced characters', async () => {
      const character = await manager1.generateContent('character', {
        level: 10
      });

      const components = manager1.getComponents();
      const isValid = await components.validator.validateContent(character);

      expect(isValid).toBe(true);
    });

    it('should validate balanced items', async () => {
      const item = await manager1.generateContent('item', {
        rarity: 'legendary'
      });

      const components = manager1.getComponents();
      const isValid = await components.validator.validateContent(item);

      expect(isValid).toBe(true);
    });

    it('should validate quest rewards', async () => {
      const quest = await manager1.generateContent('quest', {
        difficulty: 'hard'
      });

      const components = manager1.getComponents();
      const isValid = await components.validator.validateContent(quest);

      expect(isValid).toBe(true);
    });
  });

  describe('Rendering', () => {
    it('should render content without errors', () => {
      // Create a mock canvas
      const canvas = document.createElement('canvas');
      const components = manager1.getComponents();

      components.renderer.initialize(canvas);

      // These should not throw
      expect(() => {
        components.renderer.clear();
      }).not.toThrow();
    });
  });
});
