import { StateCRDT } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Element with unique identifier for observed-remove semantics
 */
interface ORElement<T> {
  value: T;
  uniqueId: string;
  nodeId: string;
  timestamp: number;
}

/**
 * ORSet - Observed-Remove Set (Add-Wins Set)
 *
 * A state-based CRDT set where add operations win over concurrent removes.
 * Each element has a unique ID, allowing multiple additions of the same value.
 *
 * Properties:
 * - Add-wins: Concurrent add and remove results in element being in set
 * - Observed-remove: Can only remove elements that have been observed
 * - No tombstones accumulation: Removed unique IDs can be garbage collected
 */
export class ORSet<T> implements StateCRDT<ORSet<T>> {
  private elements: Map<string, ORElement<T>>; // uniqueId -> element
  private tombstones: Set<string>; // uniqueIds of removed elements
  private nodeId: string;

  constructor(
    nodeId: string,
    elements: Map<string, ORElement<T>> = new Map(),
    tombstones: Set<string> = new Set()
  ) {
    this.nodeId = nodeId;
    this.elements = new Map(elements);
    this.tombstones = new Set(tombstones);
  }

  /**
   * Serialize value to string for comparison
   */
  private serializeValue(value: T): string {
    return JSON.stringify(value);
  }

  /**
   * Add an element to the set
   * Returns the unique ID of the added element
   */
  add(value: T, timestamp: number = Date.now()): string {
    const uniqueId = uuidv4();
    const element: ORElement<T> = {
      value,
      uniqueId,
      nodeId: this.nodeId,
      timestamp,
    };

    this.elements.set(uniqueId, element);
    return uniqueId;
  }

  /**
   * Remove an element from the set by value
   * Removes all observed instances of the value
   */
  remove(value: T): void {
    const serialized = this.serializeValue(value);

    for (const [uniqueId, element] of this.elements.entries()) {
      if (this.serializeValue(element.value) === serialized) {
        this.tombstones.add(uniqueId);
      }
    }
  }

  /**
   * Remove a specific element by its unique ID
   */
  removeById(uniqueId: string): void {
    if (this.elements.has(uniqueId)) {
      this.tombstones.add(uniqueId);
    }
  }

  /**
   * Check if an element is in the set
   */
  has(value: T): boolean {
    const serialized = this.serializeValue(value);

    for (const [uniqueId, element] of this.elements.entries()) {
      if (!this.tombstones.has(uniqueId) &&
          this.serializeValue(element.value) === serialized) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all elements in the set (unique values only)
   */
  value(): Set<T> {
    const result = new Set<T>();

    for (const [uniqueId, element] of this.elements.entries()) {
      if (!this.tombstones.has(uniqueId)) {
        result.add(element.value);
      }
    }

    return result;
  }

  /**
   * Get all element instances with their unique IDs
   */
  getElements(): Array<{ value: T; uniqueId: string; nodeId: string; timestamp: number }> {
    const result: Array<{ value: T; uniqueId: string; nodeId: string; timestamp: number }> = [];

    for (const [uniqueId, element] of this.elements.entries()) {
      if (!this.tombstones.has(uniqueId)) {
        result.push({
          value: element.value,
          uniqueId: element.uniqueId,
          nodeId: element.nodeId,
          timestamp: element.timestamp,
        });
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
   * Merge with another ORSet
   * - Union of elements
   * - Union of tombstones
   * Satisfies: Commutative, Idempotent, Associative
   */
  merge(other: ORSet<T>): void {
    // Merge elements (union)
    for (const [uniqueId, element] of other.elements.entries()) {
      if (!this.elements.has(uniqueId)) {
        this.elements.set(uniqueId, element);
      }
    }

    // Merge tombstones (union)
    for (const uniqueId of other.tombstones) {
      this.tombstones.add(uniqueId);
    }
  }

  /**
   * Garbage collect tombstones
   * Remove tombstones for elements that all replicas have observed
   * This requires coordination or periodic cleanup
   */
  garbageCollect(knownRemovedIds: Set<string>): void {
    for (const uniqueId of knownRemovedIds) {
      this.elements.delete(uniqueId);
      this.tombstones.delete(uniqueId);
    }
  }

  /**
   * Get the full state for transmission
   */
  getState(): {
    elements: Map<string, ORElement<T>>;
    tombstones: Set<string>;
  } {
    return {
      elements: new Map(this.elements),
      tombstones: new Set(this.tombstones),
    };
  }

  /**
   * Clone this ORSet
   */
  clone(): ORSet<T> {
    return new ORSet(
      this.nodeId,
      new Map(this.elements),
      new Set(this.tombstones)
    );
  }

  /**
   * Serialize to JSON
   */
  toJSON(): {
    nodeId: string;
    elements: Array<[string, ORElement<T>]>;
    tombstones: string[];
  } {
    return {
      nodeId: this.nodeId,
      elements: Array.from(this.elements.entries()),
      tombstones: Array.from(this.tombstones),
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON<T>(json: {
    nodeId: string;
    elements: Array<[string, ORElement<T>]>;
    tombstones: string[];
  }): ORSet<T> {
    return new ORSet(
      json.nodeId,
      new Map(json.elements),
      new Set(json.tombstones)
    );
  }

  toString(): string {
    return `ORSet(${Array.from(this.value()).join(', ')})`;
  }
}
