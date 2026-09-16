import { ORSet } from '../src/crdts/ORSet';

describe('ORSet', () => {
  describe('CRDT Properties', () => {
    it('should satisfy commutativity', () => {
      const set1 = new ORSet<string>('node1');
      set1.add('apple');

      const set2 = new ORSet<string>('node2');
      set2.add('banana');

      const result1 = set1.clone();
      result1.merge(set2);

      const result2 = set2.clone();
      result2.merge(set1);

      expect(Array.from(result1.value()).sort()).toEqual(Array.from(result2.value()).sort());
    });

    it('should satisfy idempotence', () => {
      const set1 = new ORSet<string>('node1');
      set1.add('apple');

      const set2 = set1.clone();
      set1.merge(set2);

      expect(set1.has('apple')).toBe(true);
      expect(set1.size()).toBe(1);
    });
  });

  describe('Basic Operations', () => {
    it('should add and check elements', () => {
      const set = new ORSet<string>('node1');

      set.add('apple');
      set.add('banana');

      expect(set.has('apple')).toBe(true);
      expect(set.has('banana')).toBe(true);
      expect(set.size()).toBe(2);
    });

    it('should remove elements', () => {
      const set = new ORSet<string>('node1');

      set.add('apple');
      set.add('banana');
      set.remove('apple');

      expect(set.has('apple')).toBe(false);
      expect(set.has('banana')).toBe(true);
    });

    it('should allow multiple additions of same value', () => {
      const set = new ORSet<string>('node1');

      const id1 = set.add('apple');
      const id2 = set.add('apple');

      expect(id1).not.toBe(id2);
      expect(set.size()).toBe(1); // Only unique values
      expect(set.getElements().length).toBe(2); // But 2 instances
    });

    it('should implement add-wins semantics', () => {
      const set1 = new ORSet<string>('node1');
      const set2 = new ORSet<string>('node2');

      // Node1 adds element
      set1.add('apple');

      // Sync
      set2.merge(set1);

      // Concurrent: node1 removes, node2 adds
      set1.remove('apple');
      set2.add('apple');

      // Merge
      set1.merge(set2);
      set2.merge(set1);

      // Add-wins: element should be present (new addition beats old removal)
      expect(set1.has('apple')).toBe(true);
      expect(set2.has('apple')).toBe(true);
    });
  });

  describe('Observed-Remove Semantics', () => {
    it('should only remove observed elements', () => {
      const set1 = new ORSet<string>('node1');
      const set2 = new ORSet<string>('node2');

      // Node1 adds element
      set1.add('apple');

      // Node2 (hasn't seen the add) tries to remove
      set2.remove('apple');

      // Merge
      set1.merge(set2);
      set2.merge(set1);

      // Element should still be present (remove didn't observe the add)
      expect(set1.has('apple')).toBe(true);
      expect(set2.has('apple')).toBe(true);
    });

    it('should remove by unique ID', () => {
      const set = new ORSet<string>('node1');

      const id = set.add('apple');
      set.removeById(id);

      expect(set.has('apple')).toBe(false);
    });
  });

  describe('Convergence', () => {
    it('should converge with concurrent operations', () => {
      const set1 = new ORSet<string>('node1');
      const set2 = new ORSet<string>('node2');
      const set3 = new ORSet<string>('node3');

      set1.add('a');
      set2.add('b');
      set3.add('c');

      set1.remove('a');

      // Gossip
      set1.merge(set2);
      set1.merge(set3);
      set2.merge(set1);
      set3.merge(set1);

      expect(set1.value()).toEqual(new Set(['b', 'c']));
      expect(set2.value()).toEqual(new Set(['b', 'c']));
      expect(set3.value()).toEqual(new Set(['b', 'c']));
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize', () => {
      const set1 = new ORSet<number>('node1');
      set1.add(1);
      set1.add(2);
      set1.remove(1);

      const json = set1.toJSON();
      const set2 = ORSet.fromJSON(json);

      expect(set2.has(1)).toBe(false);
      expect(set2.has(2)).toBe(true);
    });
  });
});
