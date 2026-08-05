import { StateCRDT } from '../types';

/**
 * Element with timestamp for LWW conflict resolution
 */
interface LWWElement<T> {
  value: T;
  timestamp: number;
  nodeId: string;
}

/**
 * LWWSet - Last-Write-Wins Element Set
 *
 * A state-based CRDT set where conflicts are resolved by timestamp.
 * Uses separate add and remove sets with timestamps.
 *
 * Properties:
 * - Last-write-wins: Most recent operation wins conflicts
 * - Add-wins: If timestamps equal, add operation wins over remove
 * - Convergence: All replicas eventually agree on the set
 */
export class LWWSet<T> implements StateCRDT<LWWSet<T>> {
  private addSet: Map<string, LWWElement<T>>;
  private removeSet: Map<string, LWWElement<T>>;
  private nodeId: string;

  constructor(
    nodeId: string,
    addSet: Map<string, LWWElement<T>> = new Map(),
    removeSet: Map<string, LWWElement<T>> = new Map()
  ) {
    this.nodeId = nodeId;
    this.addSet = new Map(addSet);
    this.removeSet = new Map(removeSet);
  }

  /**
   * Serialize value to string key for map storage
   */
  private serializeKey(value: T): string {
    return JSON.stringify(value);
  }

  /**
   * Add an element to the set
   */
  add(value: T, timestamp: number = Date.now()): void {
    const key = this.serializeKey(value);
    const element: LWWElement<T> = {
      value,
      timestamp,
      nodeId: this.nodeId,
    };

    const existing = this.addSet.get(key);
    if (!existing || timestamp > existing.timestamp) {
      this.addSet.set(key, element);
    }
  }

  /**
   * Remove an element from the set
   */
  remove(value: T, timestamp: number = Date.now()): void {
    const key = this.serializeKey(value);
    const element: LWWElement<T> = {
      value,
      timestamp,
      nodeId: this.nodeId,
    };

    const existing = this.removeSet.get(key);
    if (!existing || timestamp > existing.timestamp) {
      this.removeSet.set(key, element);
    }
  }

  /**
   * Check if an element is in the set
   * Element is in set if:
   * - It's in addSet AND
   * - Either not in removeSet OR removeSet timestamp <= addSet timestamp (add-wins bias)
   */
  has(value: T): boolean {
    const key = this.serializeKey(value);
    const addElement = this.addSet.get(key);
    const removeElement = this.removeSet.get(key);

    if (!addElement) {
      return false;
    }

    if (!removeElement) {
      return true;
    }

    // Add-wins bias: if timestamps equal, element is in set
    return addElement.timestamp >= removeElement.timestamp;
  }

  /**
   * Get all elements in the set
   */
  value(): Set<T> {
    const result = new Set<T>();

    for (const [key, addElement] of this.addSet.entries()) {
      const removeElement = this.removeSet.get(key);

      // Include if not removed or add timestamp >= remove timestamp
      if (!removeElement || addElement.timestamp >= removeElement.timestamp) {
        result.add(addElement.value);
      }
    }

    return result;
  }

  /**
   * Get the size of the set
   */
  size(): number {
    return this.value().size;
  }

  /**
   * Merge with another LWWSet
   * For each element, take the version with the highest timestamp
   * Satisfies: Commutative, Idempotent, Associative
   */
  merge(other: LWWSet<T>): void {
    // Merge add sets
    for (const [key, otherElement] of other.addSet.entries()) {
      const thisElement = this.addSet.get(key);

      if (!thisElement ||
          otherElement.timestamp > thisElement.timestamp ||
          (otherElement.timestamp === thisElement.timestamp &&
           otherElement.nodeId > thisElement.nodeId)) {
        this.addSet.set(key, otherElement);
      }
    }

    // Merge remove sets
    for (const [key, otherElement] of other.removeSet.entries()) {
      const thisElement = this.removeSet.get(key);

      if (!thisElement ||
          otherElement.timestamp > thisElement.timestamp ||
          (otherElement.timestamp === thisElement.timestamp &&
           otherElement.nodeId > thisElement.nodeId)) {
        this.removeSet.set(key, otherElement);
      }
    }
  }

  /**
   * Get the full state for transmission
   */
  getState(): {
    addSet: Map<string, LWWElement<T>>;
    removeSet: Map<string, LWWElement<T>>;
  } {
    return {
      addSet: new Map(this.addSet),
      removeSet: new Map(this.removeSet),
    };
  }

  /**
   * Clone this LWWSet
   */
  clone(): LWWSet<T> {
    return new LWWSet(
      this.nodeId,
      new Map(this.addSet),
      new Map(this.removeSet)
    );
  }

  /**
   * Serialize to JSON
   */
  toJSON(): {
    nodeId: string;
    addSet: Array<[string, LWWElement<T>]>;
    removeSet: Array<[string, LWWElement<T>]>;
  } {
    return {
      nodeId: this.nodeId,
      addSet: Array.from(this.addSet.entries()),
      removeSet: Array.from(this.removeSet.entries()),
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON<T>(json: {
    nodeId: string;
    addSet: Array<[string, LWWElement<T>]>;
    removeSet: Array<[string, LWWElement<T>]>;
  }): LWWSet<T> {
    return new LWWSet(
      json.nodeId,
      new Map(json.addSet),
      new Map(json.removeSet)
    );
  }

  toString(): string {
    return `LWWSet(${Array.from(this.value()).join(', ')})`;
  }
}
