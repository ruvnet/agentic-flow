import { RGA } from '../src/crdts/RGA';

describe('RGA', () => {
  describe('CRDT Properties', () => {
    it('should satisfy commutativity', () => {
      const rga1 = new RGA<string>('node1');
      rga1.insert(0, 'a');

      const rga2 = new RGA<string>('node2');
      rga2.insert(0, 'b');

      const result1 = rga1.clone();
      result1.merge(rga2);

      const result2 = rga2.clone();
      result2.merge(rga1);

      expect(result1.value()).toEqual(result2.value());
    });

    it('should satisfy idempotence', () => {
      const rga1 = new RGA<string>('node1');
      rga1.insert(0, 'a');

      const rga2 = rga1.clone();
      rga1.merge(rga2);

      expect(rga1.value()).toEqual(['a']);
    });
  });

  describe('Basic Operations', () => {
    it('should insert at beginning', () => {
      const rga = new RGA<string>('node1');

      rga.insert(0, 'a');
      rga.insert(0, 'b');

      expect(rga.value()).toEqual(['b', 'a']);
    });

    it('should insert at end', () => {
      const rga = new RGA<string>('node1');

      rga.insert(0, 'a');
      rga.insert(1, 'b');
      rga.insert(2, 'c');

      expect(rga.value()).toEqual(['a', 'b', 'c']);
    });

    it('should insert in middle', () => {
      const rga = new RGA<string>('node1');

      rga.insert(0, 'a');
      rga.insert(1, 'c');
      rga.insert(1, 'b');

      expect(rga.value()).toEqual(['a', 'b', 'c']);
    });

    it('should delete elements', () => {
      const rga = new RGA<string>('node1');

      rga.insert(0, 'a');
      rga.insert(1, 'b');
      rga.insert(2, 'c');

      rga.delete(1); // Delete 'b'

      expect(rga.value()).toEqual(['a', 'c']);
    });

    it('should get element at position', () => {
      const rga = new RGA<string>('node1');

      rga.insert(0, 'a');
      rga.insert(1, 'b');

      expect(rga.get(0)).toBe('a');
      expect(rga.get(1)).toBe('b');
    });

    it('should return correct length', () => {
      const rga = new RGA<string>('node1');

      expect(rga.length()).toBe(0);

      rga.insert(0, 'a');
      expect(rga.length()).toBe(1);

      rga.insert(1, 'b');
      expect(rga.length()).toBe(2);

      rga.delete(0);
      expect(rga.length()).toBe(1);
    });
  });

  describe('Convergence', () => {
    it('should converge with concurrent inserts at same position', () => {
      const rga1 = new RGA<string>('node1');
      const rga2 = new RGA<string>('node2');

      // Both insert at position 0
      rga1.insert(0, 'a');
      rga2.insert(0, 'b');

      // Merge
      rga1.merge(rga2);
      rga2.merge(rga1);

      // Should converge to same sequence (ordered by vector clock)
      expect(rga1.value()).toEqual(rga2.value());
      expect(rga1.length()).toBe(2);
    });

    it('should handle concurrent insert and delete', () => {
      const rga1 = new RGA<string>('node1');
      const rga2 = new RGA<string>('node2');

      // Initial state
      rga1.insert(0, 'a');
      rga2.merge(rga1);

      // Concurrent operations
      rga1.delete(0); // Delete 'a'
      rga2.insert(1, 'b'); // Insert 'b' after 'a'

      // Merge
      rga1.merge(rga2);
      rga2.merge(rga1);

      // Should converge: 'a' deleted, 'b' present
      expect(rga1.value()).toEqual(['b']);
      expect(rga2.value()).toEqual(['b']);
    });

    it('should maintain order with complex concurrent edits', () => {
      const rga1 = new RGA<string>('node1');
      const rga2 = new RGA<string>('node2');
      const rga3 = new RGA<string>('node3');

      // Node 1 creates sequence
      rga1.insert(0, 'a');
      rga1.insert(1, 'b');
      rga1.insert(2, 'c');

      // Sync to all
      rga2.merge(rga1);
      rga3.merge(rga1);

      // Concurrent edits
      rga1.insert(1, 'x'); // a x b c
      rga2.insert(2, 'y'); // a b y c
      rga3.delete(1); // a c

      // Gossip merge
      rga1.merge(rga2);
      rga1.merge(rga3);
      rga2.merge(rga1);
      rga3.merge(rga1);

      // All should converge to same sequence
      expect(rga1.value()).toEqual(rga2.value());
      expect(rga2.value()).toEqual(rga3.value());
    });
  });

  describe('Text Editing', () => {
    it('should work for collaborative text editing', () => {
      const doc1 = new RGA<string>('alice');
      const doc2 = new RGA<string>('bob');

      // Alice types "Hello"
      doc1.insert(0, 'H');
      doc1.insert(1, 'e');
      doc1.insert(2, 'l');
      doc1.insert(3, 'l');
      doc1.insert(4, 'o');

      // Sync to Bob
      doc2.merge(doc1);
      expect(doc2.toString()).toBe('Hello');

      // Bob types " World"
      doc2.insert(5, ' ');
      doc2.insert(6, 'W');
      doc2.insert(7, 'o');
      doc2.insert(8, 'r');
      doc2.insert(9, 'l');
      doc2.insert(10, 'd');

      // Sync to Alice
      doc1.merge(doc2);

      // Both should have "Hello World"
      expect(doc1.toString()).toBe('Hello World');
      expect(doc2.toString()).toBe('Hello World');
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize', () => {
      const rga1 = new RGA<string>('node1');
      rga1.insert(0, 'a');
      rga1.insert(1, 'b');
      rga1.insert(2, 'c');

      const json = rga1.toJSON();
      const rga2 = RGA.fromJSON<string>(json);

      expect(rga2.value()).toEqual(['a', 'b', 'c']);
    });
  });
});
