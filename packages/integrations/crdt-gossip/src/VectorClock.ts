/**
 * VectorClock - Implements Lamport vector clocks for causal ordering
 *
 * Properties:
 * - Happens-before relationship: A -> B iff VC(A) < VC(B)
 * - Concurrent events: A || B iff VC(A) incomparable to VC(B)
 * - Monotonic: Clock values only increase
 */
export class VectorClock {
  private clock: Map<string, number>;

  constructor(initialClock: Map<string, number> = new Map()) {
    this.clock = new Map(initialClock);
  }

  /**
   * Increment the clock for a specific node
   */
  increment(nodeId: string): void {
    const current = this.clock.get(nodeId) || 0;
    this.clock.set(nodeId, current + 1);
  }

  /**
   * Get the clock value for a specific node
   */
  get(nodeId: string): number {
    return this.clock.get(nodeId) || 0;
  }

  /**
   * Merge two vector clocks (take max of each component)
   */
  merge(other: VectorClock): VectorClock {
    const merged = new Map(this.clock);

    for (const [nodeId, timestamp] of other.clock.entries()) {
      const current = merged.get(nodeId) || 0;
      merged.set(nodeId, Math.max(current, timestamp));
    }

    return new VectorClock(merged);
  }

  /**
   * Check if this clock happens-before another clock
   * Returns true if this <= other and this != other
   */
  happensBefore(other: VectorClock): boolean {
    let hasSmaller = false;

    // Check all entries in this clock
    for (const [nodeId, timestamp] of this.clock.entries()) {
      const otherTimestamp = other.get(nodeId);
      if (timestamp > otherTimestamp) {
        return false; // This is greater, not happens-before
      }
      if (timestamp < otherTimestamp) {
        hasSmaller = true;
      }
    }

    // Check if other has entries not in this clock
    for (const [nodeId] of other.clock.entries()) {
      if (!this.clock.has(nodeId) && other.get(nodeId) > 0) {
        hasSmaller = true;
      }
    }

    return hasSmaller;
  }

  /**
   * Check if two clocks are concurrent (neither happens-before the other)
   */
  isConcurrent(other: VectorClock): boolean {
    return !this.happensBefore(other) && !other.happensBefore(this) && !this.equals(other);
  }

  /**
   * Check if two clocks are equal
   */
  equals(other: VectorClock): boolean {
    // Check all entries in this clock
    for (const [nodeId, timestamp] of this.clock.entries()) {
      if (other.get(nodeId) !== timestamp) {
        return false;
      }
    }

    // Check all entries in other clock
    for (const [nodeId, timestamp] of other.clock.entries()) {
      if (this.get(nodeId) !== timestamp) {
        return false;
      }
    }

    return true;
  }

  /**
   * Create a copy of this clock
   */
  clone(): VectorClock {
    return new VectorClock(new Map(this.clock));
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [nodeId, timestamp] of this.clock.entries()) {
      result[nodeId] = timestamp;
    }
    return result;
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: Record<string, number>): VectorClock {
    const clock = new Map<string, number>();
    for (const [nodeId, timestamp] of Object.entries(json)) {
      clock.set(nodeId, timestamp);
    }
    return new VectorClock(clock);
  }

  /**
   * Get all node IDs in this clock
   */
  getNodeIds(): string[] {
    return Array.from(this.clock.keys());
  }

  /**
   * Get the total number of events (sum of all clock values)
   */
  getTotalEvents(): number {
    let total = 0;
    for (const count of this.clock.values()) {
      total += count;
    }
    return total;
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}
