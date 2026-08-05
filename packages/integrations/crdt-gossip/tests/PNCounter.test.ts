import { PNCounter } from '../src/crdts/PNCounter';

describe('PNCounter', () => {
  describe('CRDT Properties', () => {
    it('should satisfy commutativity', () => {
      const counter1 = new PNCounter('node1');
      counter1.increment(5);

      const counter2 = new PNCounter('node2');
      counter2.decrement(3);

      const result1 = counter1.clone();
      result1.merge(counter2);

      const result2 = counter2.clone();
      result2.merge(counter1);

      expect(result1.value()).toBe(result2.value());
      expect(result1.equals(result2)).toBe(true);
    });

    it('should satisfy idempotence', () => {
      const counter1 = new PNCounter('node1');
      counter1.increment(5);
      counter1.decrement(2);

      const counter2 = counter1.clone();
      counter1.merge(counter2);

      expect(counter1.equals(counter2)).toBe(true);
    });
  });

  describe('Basic Operations', () => {
    it('should start at zero', () => {
      const counter = new PNCounter('node1');
      expect(counter.value()).toBe(0);
    });

    it('should increment and decrement', () => {
      const counter = new PNCounter('node1');

      counter.increment(5);
      expect(counter.value()).toBe(5);

      counter.decrement(2);
      expect(counter.value()).toBe(3);

      counter.decrement(10);
      expect(counter.value()).toBe(-7);
    });

    it('should track increments and decrements separately', () => {
      const counter = new PNCounter('node1');

      counter.increment(10);
      counter.decrement(3);

      expect(counter.getIncrements()).toBe(10);
      expect(counter.getDecrements()).toBe(3);
      expect(counter.value()).toBe(7);
    });
  });

  describe('Convergence', () => {
    it('should converge with concurrent operations', () => {
      const counter1 = new PNCounter('node1');
      const counter2 = new PNCounter('node2');

      // Concurrent operations
      counter1.increment(10);
      counter2.decrement(5);

      // Merge
      counter1.merge(counter2);
      counter2.merge(counter1);

      expect(counter1.value()).toBe(5);
      expect(counter2.value()).toBe(5);
    });

    it('should handle complex merge scenarios', () => {
      const counter1 = new PNCounter('node1');
      const counter2 = new PNCounter('node2');
      const counter3 = new PNCounter('node3');

      counter1.increment(15);
      counter2.decrement(5);
      counter3.increment(10);
      counter3.decrement(3);

      // Partial merge - counter1 gets counter2's state
      counter1.merge(counter2);

      // Final merge - need to merge all states bidirectionally
      counter1.merge(counter3);
      counter2.merge(counter1); // counter2 needs counter1's increments
      counter2.merge(counter3); // counter2 needs counter3's state
      counter3.merge(counter1); // counter3 needs full state
      counter3.merge(counter2); // Ensure all have seen all states

      // All converge to: 15 + 10 - 5 - 3 = 17
      expect(counter1.value()).toBe(17);
      expect(counter2.value()).toBe(17);
      expect(counter3.value()).toBe(17);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize', () => {
      const counter1 = new PNCounter('node1');
      counter1.increment(10);
      counter1.decrement(3);

      const json = counter1.toJSON();
      const counter2 = PNCounter.fromJSON(json);

      expect(counter2.value()).toBe(7);
      expect(counter1.equals(counter2)).toBe(true);
    });
  });
});
