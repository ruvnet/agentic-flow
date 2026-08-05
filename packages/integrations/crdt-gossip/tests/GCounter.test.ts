import { GCounter } from '../src/crdts/GCounter';

describe('GCounter', () => {
  describe('CRDT Properties', () => {
    it('should satisfy commutativity: merge(A, B) = merge(B, A)', () => {
      const counter1 = new GCounter('node1');
      counter1.increment(5);

      const counter2 = new GCounter('node2');
      counter2.increment(3);

      const result1 = counter1.clone();
      result1.merge(counter2);

      const result2 = counter2.clone();
      result2.merge(counter1);

      expect(result1.value()).toBe(result2.value());
      expect(result1.equals(result2)).toBe(true);
    });

    it('should satisfy idempotence: merge(A, A) = A', () => {
      const counter1 = new GCounter('node1');
      counter1.increment(5);

      const counter2 = counter1.clone();
      counter1.merge(counter2);

      expect(counter1.equals(counter2)).toBe(true);
    });

    it('should satisfy associativity: merge(merge(A, B), C) = merge(A, merge(B, C))', () => {
      const a = new GCounter('node1');
      a.increment(1);

      const b = new GCounter('node2');
      b.increment(2);

      const c = new GCounter('node3');
      c.increment(3);

      // (A ∪ B) ∪ C
      const result1 = a.clone();
      result1.merge(b);
      result1.merge(c);

      // A ∪ (B ∪ C)
      const result2 = a.clone();
      const bc = b.clone();
      bc.merge(c);
      result2.merge(bc);

      expect(result1.value()).toBe(result2.value());
    });
  });

  describe('Basic Operations', () => {
    it('should start at zero', () => {
      const counter = new GCounter('node1');
      expect(counter.value()).toBe(0);
    });

    it('should increment', () => {
      const counter = new GCounter('node1');
      counter.increment();
      expect(counter.value()).toBe(1);

      counter.increment(5);
      expect(counter.value()).toBe(6);
    });

    it('should throw on negative increment', () => {
      const counter = new GCounter('node1');
      expect(() => counter.increment(-1)).toThrow();
    });
  });

  describe('Convergence', () => {
    it('should converge to same value after merge', () => {
      const counter1 = new GCounter('node1');
      counter1.increment(10);

      const counter2 = new GCounter('node2');
      counter2.increment(20);

      counter1.merge(counter2);
      counter2.merge(counter1);

      expect(counter1.value()).toBe(30);
      expect(counter2.value()).toBe(30);
    });

    it('should converge with concurrent increments', () => {
      const counter1 = new GCounter('node1');
      const counter2 = new GCounter('node2');
      const counter3 = new GCounter('node3');

      // Concurrent increments
      counter1.increment(5);
      counter2.increment(3);
      counter3.increment(7);

      // Gossip merge
      counter1.merge(counter2);
      counter1.merge(counter3);

      counter2.merge(counter1);
      counter3.merge(counter1);

      // All should converge
      expect(counter1.value()).toBe(15);
      expect(counter2.value()).toBe(15);
      expect(counter3.value()).toBe(15);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize', () => {
      const counter1 = new GCounter('node1');
      counter1.increment(5);

      const json = counter1.toJSON();
      const counter2 = GCounter.fromJSON(json);

      expect(counter2.value()).toBe(5);
      expect(counter1.equals(counter2)).toBe(true);
    });
  });
});
