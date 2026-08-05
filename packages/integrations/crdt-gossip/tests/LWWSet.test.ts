import { LWWSet } from '../src/crdts/LWWSet';

describe('LWWSet', () => {
  describe('CRDT Properties', () => {
    it('should satisfy commutativity', () => {
      const set1 = new LWWSet<number>('node1');
      set1.add(1, 100);

      const set2 = new LWWSet<number>('node2');
      set2.add(2, 200);

      const result1 = set1.clone();
      result1.merge(set2);

      const result2 = set2.clone();
      result2.merge(set1);

      expect(Array.from(result1.value()).sort()).toEqual(Array.from(result2.value()).sort());
    });

    it('should satisfy idempotence', () => {
      const set1 = new LWWSet<string>('node1');
      set1.add('a', 100);

      const set2 = set1.clone();
      set1.merge(set2);

      expect(set1.has('a')).toBe(true);
      expect(set1.size()).toBe(1);
    });
  });

  describe('Basic Operations', () => {
    it('should add and check elements', () => {
      const set = new LWWSet<string>('node1');

      set.add('apple');
      set.add('banana');

      expect(set.has('apple')).toBe(true);
      expect(set.has('banana')).toBe(true);
      expect(set.has('orange')).toBe(false);
      expect(set.size()).toBe(2);
    });

    it('should remove elements', () => {
      const set = new LWWSet<string>('node1');

      set.add('apple', 100);
      set.add('banana', 100);
      set.remove('apple', 200);

      expect(set.has('apple')).toBe(false);
      expect(set.has('banana')).toBe(true);
    });

    it('should implement add-wins bias', () => {
      const set = new LWWSet<string>('node1');

      set.add('apple', 100);
      set.remove('apple', 100); // Same timestamp

      // Add-wins bias: element should be in set
      expect(set.has('apple')).toBe(true);
    });

    it('should respect last-write-wins', () => {
      const set = new LWWSet<string>('node1');

      set.add('apple', 100);
      set.remove('apple', 200);
      set.add('apple', 300); // Latest operation

      expect(set.has('apple')).toBe(true);
    });
  });

  describe('Convergence', () => {
    it('should converge with concurrent add operations', () => {
      const set1 = new LWWSet<string>('node1');
      const set2 = new LWWSet<string>('node2');

      set1.add('apple', 100);
      set2.add('banana', 100);

      set1.merge(set2);
      set2.merge(set1);

      expect(set1.value()).toEqual(new Set(['apple', 'banana']));
      expect(set2.value()).toEqual(new Set(['apple', 'banana']));
    });

    it('should converge with concurrent add-remove', () => {
      const set1 = new LWWSet<string>('node1');
      const set2 = new LWWSet<string>('node2');

      // Both start with element
      set1.add('apple', 100);
      set2.add('apple', 100);

      // Concurrent operations
      set1.add('apple', 150); // Re-add
      set2.remove('apple', 140); // Remove

      // Merge
      set1.merge(set2);
      set2.merge(set1);

      // Add at 150 > Remove at 140, so element is in set
      expect(set1.has('apple')).toBe(true);
      expect(set2.has('apple')).toBe(true);
    });

    it('should handle complex scenarios', () => {
      const set1 = new LWWSet<string>('node1');
      const set2 = new LWWSet<string>('node2');
      const set3 = new LWWSet<string>('node3');

      set1.add('a', 100);
      set2.add('b', 100);
      set3.add('c', 100);

      set1.remove('a', 200);
      set2.remove('b', 150);

      // Gossip merge
      set1.merge(set2);
      set1.merge(set3);
      set2.merge(set1);
      set3.merge(set1);

      // All should converge
      expect(set1.value()).toEqual(new Set(['c']));
      expect(set2.value()).toEqual(new Set(['c']));
      expect(set3.value()).toEqual(new Set(['c']));
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize', () => {
      const set1 = new LWWSet<number>('node1');
      set1.add(1, 100);
      set1.add(2, 200);
      set1.remove(1, 300);

      const json = set1.toJSON();
      const set2 = LWWSet.fromJSON(json);

      expect(set2.has(1)).toBe(false);
      expect(set2.has(2)).toBe(true);
    });
  });
});
