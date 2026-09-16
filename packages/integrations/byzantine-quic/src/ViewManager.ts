/**
 * View Manager
 *
 * Manages view changes and primary election in Byzantine consensus
 * Implements timeout-based failure detection and view change protocol
 */

export interface ViewConfig {
  /** Total number of nodes in system */
  totalNodes: number;
  /** Maximum tolerated faults (f) */
  maxFaults: number;
  /** Timeout for view change (ms) */
  viewChangeTimeoutMs: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface ViewState {
  currentView: number;
  primaryNodeId: string;
  lastViewChange: number;
  inViewChange: boolean;
}

/**
 * Manages primary election and view changes
 */
export class ViewManager {
  private currentView: number = 0;
  private nodeIds: string[];
  private viewChangeTimeout: NodeJS.Timeout | null = null;
  private lastActivity: number = Date.now();
  private inViewChange: boolean = false;
  private config: Required<ViewConfig>;

  constructor(nodeIds: string[], config: ViewConfig) {
    this.nodeIds = [...nodeIds].sort(); // Deterministic ordering
    this.config = {
      ...config,
      debug: config.debug ?? false,
    };

    this.validateConfig();
    this.startViewChangeTimer();
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    const { totalNodes, maxFaults } = this.config;

    if (totalNodes < 3 * maxFaults + 1) {
      throw new Error(
        `Invalid configuration: Need at least 3f+1 nodes. ` +
        `Have ${totalNodes} nodes, but need ${3 * maxFaults + 1} for f=${maxFaults}`
      );
    }

    if (this.nodeIds.length !== totalNodes) {
      throw new Error(
        `Node count mismatch: Expected ${totalNodes} nodes, got ${this.nodeIds.length}`
      );
    }
  }

  /**
   * Get current view number
   */
  getCurrentView(): number {
    return this.currentView;
  }

  /**
   * Get current primary node ID
   * Primary rotates using round-robin: view % totalNodes
   */
  getPrimaryNodeId(): string {
    const primaryIndex = this.currentView % this.nodeIds.length;
    return this.nodeIds[primaryIndex];
  }

  /**
   * Check if given node is current primary
   */
  isPrimary(nodeId: string): boolean {
    return this.getPrimaryNodeId() === nodeId;
  }

  /**
   * Get view state
   */
  getViewState(): ViewState {
    return {
      currentView: this.currentView,
      primaryNodeId: this.getPrimaryNodeId(),
      lastViewChange: this.lastActivity,
      inViewChange: this.inViewChange,
    };
  }

  /**
   * Record activity (resets view change timer)
   */
  recordActivity(): void {
    this.lastActivity = Date.now();
    this.resetViewChangeTimer();
  }

  /**
   * Start view change protocol
   */
  startViewChange(): number {
    if (this.inViewChange) {
      if (this.config.debug) {
        console.log('[ViewManager] Already in view change');
      }
      return this.currentView + 1;
    }

    this.inViewChange = true;
    const newView = this.currentView + 1;

    if (this.config.debug) {
      console.log(
        `[ViewManager] Starting view change: ${this.currentView} -> ${newView}`
      );
      console.log(`[ViewManager] New primary will be: ${this.nodeIds[newView % this.nodeIds.length]}`);
    }

    return newView;
  }

  /**
   * Complete view change
   */
  completeViewChange(newView: number): void {
    if (newView <= this.currentView) {
      throw new Error(
        `Invalid view change: newView ${newView} must be > currentView ${this.currentView}`
      );
    }

    const oldView = this.currentView;
    const oldPrimary = this.getPrimaryNodeId();

    this.currentView = newView;
    this.inViewChange = false;
    this.lastActivity = Date.now();
    this.resetViewChangeTimer();

    if (this.config.debug) {
      console.log(
        `[ViewManager] View change complete: ${oldView} -> ${newView}`
      );
      console.log(
        `[ViewManager] Primary changed: ${oldPrimary} -> ${this.getPrimaryNodeId()}`
      );
    }
  }

  /**
   * Check if view change timeout has expired
   */
  shouldTriggerViewChange(): boolean {
    const elapsed = Date.now() - this.lastActivity;
    return elapsed > this.config.viewChangeTimeoutMs;
  }

  /**
   * Calculate quorum size for Byzantine consensus
   * Need 2f+1 votes for safety (can tolerate f Byzantine nodes)
   */
  getQuorumSize(): number {
    return 2 * this.config.maxFaults + 1;
  }

  /**
   * Get total number of nodes
   */
  getTotalNodes(): number {
    return this.config.totalNodes;
  }

  /**
   * Get maximum tolerated faults
   */
  getMaxFaults(): number {
    return this.config.maxFaults;
  }

  /**
   * Start view change timer
   */
  private startViewChangeTimer(): void {
    this.viewChangeTimeout = setInterval(() => {
      if (this.shouldTriggerViewChange() && !this.inViewChange) {
        if (this.config.debug) {
          console.log(
            `[ViewManager] View change timeout triggered after ${this.config.viewChangeTimeoutMs}ms`
          );
        }
      }
    }, this.config.viewChangeTimeoutMs / 2); // Check twice per timeout period
  }

  /**
   * Reset view change timer
   */
  private resetViewChangeTimer(): void {
    if (this.viewChangeTimeout) {
      clearInterval(this.viewChangeTimeout);
    }
    this.startViewChangeTimer();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.viewChangeTimeout) {
      clearInterval(this.viewChangeTimeout);
      this.viewChangeTimeout = null;
    }
  }
}
