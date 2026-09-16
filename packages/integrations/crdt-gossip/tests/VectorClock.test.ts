import { VectorClock } from '../src/VectorClock';

describe('VectorClock', () => {
  describe('Basic Operations', () => {
    it('should create empty vector clock', () => {
      const clock = new VectorClock();
      expect(clock.get('node1')).toBe(0);
      expect(clock.getTotalEvents()).toBe(0);
    });

    it('should increment clock for node', () => {
      const clock = new VectorClock();
      clock.increment('node1');
      expect(clock.get('node1')).toBe(1);

      clock.increment('node1');
      expect(clock.get('node1')).toBe(2);
    });

    it('should track multiple nodes', () => {
      const clock = new VectorClock();
      clock.increment('node1');
      clock.increment('node2');
      clock.increment('node1');

      expect(clock.get('node1')).toBe(2);
      expect(clock.get('node2')).toBe(1);
      expect(clock.getTotalEvents()).toBe(3);
    });
  });

  describe('Merge Operations', () => {
    it('should merge two clocks (take max)', () => {
      const clock1 = new VectorClock();
      clock1.increment('node1');
      clock1.increment('node1');

      const clock2 = new VectorClock();
      clock2.increment('node1');
      clock2.increment('node2');

      const merged = clock1.merge(clock2);

      expect(merged.get('node1')).toBe(2);
      expect(merged.get('node2')).toBe(1);
    });

    it('should be commutative', () => {
      const clock1 = new VectorClock();
      clock1.increment('node1');

      const clock2 = new VectorClock();
      clock2.increment('node2');

      const merged1 = clock1.merge(clock2);
      const merged2 = clock2.merge(clock1);

      expect(merged1.equals(merged2)).toBe(true);
    });
  });

  describe('Causal Ordering', () => {
    it('should detect happens-before relationship', () => {
      const clock1 = new VectorClock();
      clock1.increment('node1');

      const clock2 = clock1.clone();
      clock2.increment('node1');

      expect(clock1.happensBefore(clock2)).toBe(true);
      expect(clock2.happensBefore(clock1)).toBe(false);
    });

    it('should detect concurrent events', () => {
      const clock1 = new VectorClock();
      clock1.increment('node1');

      const clock2 = new VectorClock();
      clock2.increment('node2');

      expect(clock1.isConcurrent(clock2)).toBe(true);
      expect(clock2.isConcurrent(clock1)).toBe(true);
    });

    it('should detect equality', () => {
      const clock1 = new VectorClock();
      clock1.increment('node1');

      const clock2 = new VectorClock();
      clock2.increment('node1');

      expect(clock1.equals(clock2)).toBe(true);
    });
  });

  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      const clock = new VectorClock();
      clock.increment('node1');
      clock.increment('node2');

      const json = clock.toJSON();

      expect(json).toEqual({
        node1: 1,
        node2: 1,
      });
    });

    it('should deserialize from JSON', () => {
      const json = { node1: 2, node2: 1 };
      const clock = VectorClock.fromJSON(json);

      expect(clock.get('node1')).toBe(2);
      expect(clock.get('node2')).toBe(1);
    });

    it('should round-trip through JSON', () => {
      const clock1 = new VectorClock();
      clock1.increment('node1');
      clock1.increment('node2');

      const json = clock1.toJSON();
      const clock2 = VectorClock.fromJSON(json);

      expect(clock1.equals(clock2)).toBe(true);
    });
  });
});
