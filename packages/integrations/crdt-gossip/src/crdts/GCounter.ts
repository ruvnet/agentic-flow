import { StateCRDT } from '../types';

/**
 * GCounter - Grow-only Counter
 *
 * A state-based CRDT that can only increment.
 * Each node maintains its own counter, and the total is the sum of all counters.
 *
 * Properties:
 * - Convergence: All replicas eventually agree on the sum
 * - Monotonic: Value can only increase
 * - Merge: Take max of each node's counter
 */
export class GCounter implements StateCRDT<GCounter> {
  private counters: Map<string, number>;
  private nodeId: string;

  constructor(nodeId: string, initialCounters: Map<string, number> = new Map()) {
    this.nodeId = nodeId;
    this.counters = new Map(initialCounters);

    // Ensure this node has an entry
    if (!this.counters.has(nodeId)) {
      this.counters.set(nodeId, 0);
    }
  }

  /**
   * Increment the counter for this node
   */
  increment(amount: number = 1): void {
    if (amount < 0) {
      throw new Error('GCounter can only increment (use PNCounter for decrement)');
    }

    const current = this.counters.get(this.nodeId) || 0;
    this.counters.set(this.nodeId, current + amount);
  }

  /**
   * Get the total count across all nodes
   */
  value(): number {
    let total = 0;
    for (const count of this.counters.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get the count for a specific node
   */
  getNodeCount(nodeId: string): number {
    return this.counters.get(nodeId) || 0;
  }

  /**
   * Merge with another GCounter (take max of each node's counter)
   * Satisfies: Commutative, Idempotent, Associative
   */
  merge(other: GCounter): void {
    for (const [nodeId, count] of other.counters.entries()) {
      const current = this.counters.get(nodeId) || 0;
      this.counters.set(nodeId, Math.max(current, count));
    }
  }

  /**
   * Get the full state for transmission
   */
  getState(): Map<string, number> {
    return new Map(this.counters);
  }

  /**
   * Clone this GCounter
   */
  clone(): GCounter {
    return new GCounter(this.nodeId, new Map(this.counters));
  }

  /**
   * Serialize to JSON
   */
  toJSON(): { nodeId: string; counters: Record<string, number> } {
    const counters: Record<string, number> = {};
    for (const [nodeId, count] of this.counters.entries()) {
      counters[nodeId] = count;
    }
    return { nodeId: this.nodeId, counters };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: { nodeId: string; counters: Record<string, number> }): GCounter {
    const counters = new Map<string, number>();
    for (const [nodeId, count] of Object.entries(json.counters)) {
      counters.set(nodeId, count);
    }
    return new GCounter(json.nodeId, counters);
  }

  /**
   * Compare with another GCounter
   */
  equals(other: GCounter): boolean {
    if (this.counters.size !== other.counters.size) {
      return false;
    }

    for (const [nodeId, count] of this.counters.entries()) {
      if (other.getNodeCount(nodeId) !== count) {
        return false;
      }
    }

    return true;
  }

  toString(): string {
    return `GCounter(${this.value()})`;
  }
}
