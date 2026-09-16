import { StateCRDT } from '../types';
import { VectorClock } from '../VectorClock';
import { v4 as uuidv4 } from 'uuid';

/**
 * RGA Element - represents a single character/item in the sequence
 */
interface RGAElement<T> {
  id: string;
  value: T;
  nodeId: string;
  vectorClock: VectorClock;
  isDeleted: boolean;
  after: string | null; // ID of element this comes after (null for head)
}

/**
 * RGA - Replicated Growable Array
 *
 * A sequence CRDT for collaborative text editing and ordered lists.
 * Uses causal ordering (vector clocks) to resolve concurrent insertions.
 *
 * Properties:
 * - Maintains sequential ordering
 * - Concurrent inserts ordered by vector clock (tie-break by node ID)
 * - Tombstone-based deletion (deleted elements remain for ordering)
 * - Convergent: All replicas converge to same sequence
 */
export class RGA<T> implements StateCRDT<RGA<T>> {
  private elements: Map<string, RGAElement<T>>;
  private nodeId: string;
  private clock: VectorClock;
  private headId: string; // Sentinel head element

  constructor(
    nodeId: string,
    elements: Map<string, RGAElement<T>> = new Map(),
    clock: VectorClock = new VectorClock()
  ) {
    this.nodeId = nodeId;
    this.elements = new Map(elements);
    this.clock = clock.clone();

    // Create head sentinel if not exists
    this.headId = 'HEAD';
    if (!this.elements.has(this.headId)) {
      this.elements.set(this.headId, {
        id: this.headId,
        value: null as T,
        nodeId: this.nodeId,
        vectorClock: new VectorClock(),
        isDeleted: false,
        after: null,
      });
    }
  }

  /**
   * Insert an element at the specified position
   */
  insert(position: number, value: T): string {
    // Increment clock for this operation
    this.clock.increment(this.nodeId);

    const id = uuidv4();
    const sequence = this.getSequence();

    // Find the element to insert after
    let afterId: string;
    if (position === 0) {
      afterId = this.headId;
    } else if (position >= sequence.length) {
      // Insert at end
      afterId = sequence.length > 0 ? sequence[sequence.length - 1].id : this.headId;
    } else {
      afterId = sequence[position - 1].id;
    }

    const element: RGAElement<T> = {
      id,
      value,
      nodeId: this.nodeId,
      vectorClock: this.clock.clone(),
      isDeleted: false,
      after: afterId,
    };

    this.elements.set(id, element);
    return id;
  }

  /**
   * Delete element at position
   */
  delete(position: number): void {
    const sequence = this.getSequence();

    if (position < 0 || position >= sequence.length) {
      throw new Error(`Position ${position} out of bounds [0, ${sequence.length})`);
    }

    const element = sequence[position];
    element.isDeleted = true;

    // Increment clock for delete operation
    this.clock.increment(this.nodeId);
  }

  /**
   * Get the current sequence (non-deleted elements in order)
   */
  value(): T[] {
    return this.getSequence().map((e) => e.value);
  }

  /**
   * Get the full sequence including metadata
   */
  private getSequence(): RGAElement<T>[] {
    const result: RGAElement<T>[] = [];
    const visited = new Set<string>();

    // Recursive function to traverse the sequence
    const traverse = (afterId: string) => {
      // Find all elements that come after the specified ID
      const nextElements = Array.from(this.elements.values())
        .filter((e) => e.after === afterId && !visited.has(e.id));

      if (nextElements.length === 0) {
        return;
      }

      // Sort by vector clock (REVERSE order - later inserts come first)
      // This ensures that when inserting at same position, newest insert appears first
      nextElements.sort((a, b) => {
        if (a.vectorClock.happensBefore(b.vectorClock)) return 1; // a before b → b comes first
        if (b.vectorClock.happensBefore(a.vectorClock)) return -1; // b before a → a comes first
        // Concurrent: tie-break by node ID (deterministic, reversed)
        return b.nodeId.localeCompare(a.nodeId);
      });

      // Process each element in sorted order
      for (const elem of nextElements) {
        if (visited.has(elem.id)) {
          continue;
        }

        visited.add(elem.id);

        // Add non-deleted elements to result
        if (!elem.isDeleted && elem.id !== this.headId) {
          result.push(elem);
        }

        // Recursively traverse elements after this one
        traverse(elem.id);
      }
    };

    // Start traversal from head
    traverse(this.headId);

    return result;
  }

  /**
   * Get character at position
   */
  get(position: number): T | undefined {
    const sequence = this.getSequence();
    return sequence[position]?.value;
  }

  /**
   * Get the length of the sequence
   */
  length(): number {
    return this.getSequence().length;
  }

  /**
   * Convert to string (useful for text editing)
   */
  toString(): string {
    return this.value().map(String).join('');
  }

  /**
   * Merge with another RGA
   * Satisfies: Commutative, Idempotent, Associative
   */
  merge(other: RGA<T>): void {
    // Merge vector clocks
    this.clock = this.clock.merge(other.clock);

    // Merge elements (union)
    for (const [id, element] of other.elements.entries()) {
      const existing = this.elements.get(id);

      if (!existing) {
        // New element, add it
        this.elements.set(id, {
          ...element,
          vectorClock: element.vectorClock.clone(),
        });
      } else if (element.isDeleted && !existing.isDeleted) {
        // Propagate deletion
        existing.isDeleted = true;
      }
    }
  }

  /**
   * Get the full state for transmission
   */
  getState(): {
    elements: Map<string, RGAElement<T>>;
    clock: VectorClock;
  } {
    const elements = new Map<string, RGAElement<T>>();
    for (const [id, element] of this.elements.entries()) {
      elements.set(id, {
        ...element,
        vectorClock: element.vectorClock.clone(),
      });
    }

    return {
      elements,
      clock: this.clock.clone(),
    };
  }

  /**
   * Clone this RGA
   */
  clone(): RGA<T> {
    const elements = new Map<string, RGAElement<T>>();
    for (const [id, element] of this.elements.entries()) {
      elements.set(id, {
        ...element,
        vectorClock: element.vectorClock.clone(),
      });
    }
    return new RGA(this.nodeId, elements, this.clock.clone());
  }

  /**
   * Serialize to JSON
   */
  toJSON(): {
    nodeId: string;
    elements: Array<[string, RGAElement<T>]>;
    clock: Record<string, number>;
  } {
    const elements: Array<[string, RGAElement<T>]> = [];
    for (const [id, element] of this.elements.entries()) {
      elements.push([
        id,
        {
          ...element,
          vectorClock: element.vectorClock.toJSON() as any,
        },
      ]);
    }

    return {
      nodeId: this.nodeId,
      elements,
      clock: this.clock.toJSON(),
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON<T>(json: {
    nodeId: string;
    elements: Array<[string, any]>;
    clock: Record<string, number>;
  }): RGA<T> {
    const elements = new Map<string, RGAElement<T>>();
    for (const [id, element] of json.elements) {
      elements.set(id, {
        ...element,
        vectorClock: VectorClock.fromJSON(element.vectorClock),
      });
    }

    return new RGA(json.nodeId, elements, VectorClock.fromJSON(json.clock));
  }

  /**
   * Garbage collect tombstones (deleted elements)
   * Should only be done when all replicas have observed the deletion
   */
  garbageCollect(knownDeletedIds: Set<string>): void {
    for (const id of knownDeletedIds) {
      this.elements.delete(id);
    }
  }
}
