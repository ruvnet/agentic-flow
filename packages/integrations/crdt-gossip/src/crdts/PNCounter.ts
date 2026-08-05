import { StateCRDT } from '../types';
import { GCounter } from './GCounter';

/**
 * PNCounter - Positive-Negative Counter
 *
 * A state-based CRDT that can both increment and decrement.
 * Implemented using two GCounters (one for increments, one for decrements).
 *
 * Properties:
 * - Convergence: All replicas eventually agree on (P - N)
 * - Bidirectional: Supports both increment and decrement
 * - Merge: Merge both underlying GCounters independently
 */
export class PNCounter implements StateCRDT<PNCounter> {
  private increments: GCounter;
  private decrements: GCounter;
  private nodeId: string;

  constructor(
    nodeId: string,
    increments?: GCounter,
    decrements?: GCounter
  ) {
    this.nodeId = nodeId;
    this.increments = increments || new GCounter(nodeId);
    this.decrements = decrements || new GCounter(nodeId);
  }

  /**
   * Increment the counter
   */
  increment(amount: number = 1): void {
    if (amount < 0) {
      throw new Error('Amount must be positive (use decrement for negative values)');
    }
    this.increments.increment(amount);
  }

  /**
   * Decrement the counter
   */
  decrement(amount: number = 1): void {
    if (amount < 0) {
      throw new Error('Amount must be positive');
    }
    this.decrements.increment(amount);
  }

  /**
   * Get the current value (increments - decrements)
   */
  value(): number {
    return this.increments.value() - this.decrements.value();
  }

  /**
   * Get the total increments
   */
  getIncrements(): number {
    return this.increments.value();
  }

  /**
   * Get the total decrements
   */
  getDecrements(): number {
    return this.decrements.value();
  }

  /**
   * Merge with another PNCounter
   * Satisfies: Commutative, Idempotent, Associative
   */
  merge(other: PNCounter): void {
    this.increments.merge(other.increments);
    this.decrements.merge(other.decrements);
  }

  /**
   * Get the full state for transmission
   */
  getState(): { increments: Map<string, number>; decrements: Map<string, number> } {
    return {
      increments: this.increments.getState(),
      decrements: this.decrements.getState(),
    };
  }

  /**
   * Clone this PNCounter
   */
  clone(): PNCounter {
    return new PNCounter(
      this.nodeId,
      this.increments.clone(),
      this.decrements.clone()
    );
  }

  /**
   * Serialize to JSON
   */
  toJSON(): {
    nodeId: string;
    increments: { nodeId: string; counters: Record<string, number> };
    decrements: { nodeId: string; counters: Record<string, number> };
  } {
    return {
      nodeId: this.nodeId,
      increments: this.increments.toJSON(),
      decrements: this.decrements.toJSON(),
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: {
    nodeId: string;
    increments: { nodeId: string; counters: Record<string, number> };
    decrements: { nodeId: string; counters: Record<string, number> };
  }): PNCounter {
    return new PNCounter(
      json.nodeId,
      GCounter.fromJSON(json.increments),
      GCounter.fromJSON(json.decrements)
    );
  }

  /**
   * Compare with another PNCounter
   */
  equals(other: PNCounter): boolean {
    return this.increments.equals(other.increments) &&
           this.decrements.equals(other.decrements);
  }

  toString(): string {
    return `PNCounter(${this.value()})`;
  }
}
