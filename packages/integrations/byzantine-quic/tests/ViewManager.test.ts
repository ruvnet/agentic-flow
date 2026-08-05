/**
 * View Manager Tests
 *
 * Tests primary election, view changes, and timeout management
 */

import { ViewManager } from '../src/ViewManager.js';

describe('ViewManager', () => {
  const createViewManager = (numNodes: number = 4, maxFaults: number = 1) => {
    const nodeIds = Array.from({ length: numNodes }, (_, i) => `node-${i}`);
    return new ViewManager(nodeIds, {
      totalNodes: numNodes,
      maxFaults,
      viewChangeTimeoutMs: 100, // Short timeout for testing
      debug: false,
    });
  };

  describe('Initialization', () => {
    it('should initialize with valid configuration', () => {
      const vm = createViewManager(4, 1);

      expect(vm.getCurrentView()).toBe(0);
      expect(vm.getPrimaryNodeId()).toBe('node-0');
    });

    it('should reject invalid configuration (not enough nodes)', () => {
      expect(() => {
        new ViewManager(['node-0', 'node-1'], {
          totalNodes: 2,
          maxFaults: 1, // Need 3f+1 = 4 nodes
          viewChangeTimeoutMs: 1000,
        });
      }).toThrow('Need at least 3f+1 nodes');
    });

    it('should reject configuration with mismatched node count', () => {
      expect(() => {
        new ViewManager(['node-0', 'node-1'], {
          totalNodes: 4, // Says 4 but only 2 nodes provided
          maxFaults: 1,
          viewChangeTimeoutMs: 1000,
        });
      }).toThrow('Node count mismatch');
    });
  });

  describe('Primary Election', () => {
    it('should elect primary using round-robin', () => {
      const vm = createViewManager(4, 1);

      // View 0: node-0
      expect(vm.getPrimaryNodeId()).toBe('node-0');
      expect(vm.isPrimary('node-0')).toBe(true);
      expect(vm.isPrimary('node-1')).toBe(false);

      // Simulate view change
      vm.completeViewChange(1);
      expect(vm.getPrimaryNodeId()).toBe('node-1');
      expect(vm.isPrimary('node-1')).toBe(true);
      expect(vm.isPrimary('node-0')).toBe(false);

      // View 2: node-2
      vm.completeViewChange(2);
      expect(vm.getPrimaryNodeId()).toBe('node-2');

      // View 3: node-3
      vm.completeViewChange(3);
      expect(vm.getPrimaryNodeId()).toBe('node-3');

      // View 4: wraps around to node-0
      vm.completeViewChange(4);
      expect(vm.getPrimaryNodeId()).toBe('node-0');

      vm.destroy();
    });

    it('should provide deterministic ordering', () => {
      const vm1 = createViewManager(4, 1);
      const vm2 = createViewManager(4, 1);

      // Both should have same primary
      expect(vm1.getPrimaryNodeId()).toBe(vm2.getPrimaryNodeId());

      vm1.destroy();
      vm2.destroy();
    });
  });

  describe('View Changes', () => {
    it('should start view change', () => {
      const vm = createViewManager(4, 1);

      const newView = vm.startViewChange();

      expect(newView).toBe(1);
      expect(vm.getViewState().inViewChange).toBe(true);

      vm.destroy();
    });

    it('should complete view change', () => {
      const vm = createViewManager(4, 1);

      const newView = vm.startViewChange();
      vm.completeViewChange(newView);

      expect(vm.getCurrentView()).toBe(1);
      expect(vm.getViewState().inViewChange).toBe(false);
      expect(vm.getPrimaryNodeId()).toBe('node-1');

      vm.destroy();
    });

    it('should reject invalid view change (not increasing)', () => {
      const vm = createViewManager(4, 1);

      vm.completeViewChange(1);

      expect(() => {
        vm.completeViewChange(1); // Same view
      }).toThrow('must be > currentView');

      expect(() => {
        vm.completeViewChange(0); // Lower view
      }).toThrow('must be > currentView');

      vm.destroy();
    });

    it('should trigger view change on timeout', async () => {
      const vm = createViewManager(4, 1);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(vm.shouldTriggerViewChange()).toBe(true);

      vm.destroy();
    });

    it('should reset timeout on activity', async () => {
      const vm = createViewManager(4, 1);

      // Wait half timeout
      await new Promise(resolve => setTimeout(resolve, 50));

      // Record activity
      vm.recordActivity();

      // Wait another half timeout (should not trigger)
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(vm.shouldTriggerViewChange()).toBe(false);

      vm.destroy();
    });
  });

  describe('Quorum Calculation', () => {
    it('should calculate correct quorum for f=1', () => {
      const vm = createViewManager(4, 1);

      // Need 2f+1 = 2*1+1 = 3
      expect(vm.getQuorumSize()).toBe(3);

      vm.destroy();
    });

    it('should calculate correct quorum for f=2', () => {
      const vm = createViewManager(7, 2);

      // Need 2f+1 = 2*2+1 = 5
      expect(vm.getQuorumSize()).toBe(5);

      vm.destroy();
    });

    it('should calculate correct quorum for f=3', () => {
      const vm = createViewManager(10, 3);

      // Need 2f+1 = 2*3+1 = 7
      expect(vm.getQuorumSize()).toBe(7);

      vm.destroy();
    });
  });

  describe('View State', () => {
    it('should provide current view state', () => {
      const vm = createViewManager(4, 1);

      const state = vm.getViewState();

      expect(state.currentView).toBe(0);
      expect(state.primaryNodeId).toBe('node-0');
      expect(state.inViewChange).toBe(false);
      expect(state.lastViewChange).toBeGreaterThan(0);

      vm.destroy();
    });

    it('should update state after view change', () => {
      const vm = createViewManager(4, 1);

      vm.startViewChange();
      const state1 = vm.getViewState();
      expect(state1.inViewChange).toBe(true);

      vm.completeViewChange(1);
      const state2 = vm.getViewState();
      expect(state2.currentView).toBe(1);
      expect(state2.primaryNodeId).toBe('node-1');
      expect(state2.inViewChange).toBe(false);

      vm.destroy();
    });
  });
});
