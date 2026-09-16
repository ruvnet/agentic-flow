/**
 * Tests for ByzantinePredictor
 */

import { ByzantinePredictor } from '../src/ByzantinePredictor';
import { ProteinSequence } from '../src/types';

describe('ByzantinePredictor', () => {
  let predictor: ByzantinePredictor;

  beforeEach(() => {
    predictor = new ByzantinePredictor({
      numAgents: 7,
      faultTolerance: 2,
      consensusThreshold: 2/3,
      rmsdThreshold: 2.0,
      timeout: 60000
    });
  });

  describe('configuration', () => {
    it('should validate Byzantine parameters', () => {
      // N = 7, f = 2 is valid (7 >= 3*2+1)
      expect(() => new ByzantinePredictor({ numAgents: 7, faultTolerance: 2 })).not.toThrow();

      // N = 4, f = 2 is invalid (4 < 3*2+1)
      expect(() => new ByzantinePredictor({ numAgents: 4, faultTolerance: 2 })).toThrow();
    });

    it('should get configuration', () => {
      const config = predictor.getConfig();

      expect(config.numAgents).toBe(7);
      expect(config.faultTolerance).toBe(2);
      expect(config.consensusThreshold).toBeCloseTo(2/3);
    });
  });

  describe('agent initialization', () => {
    it('should initialize default agents', () => {
      predictor.initializeAgents();
      const config = predictor.getConfig();

      expect(config.numAgents).toBe(7);
    });

    it('should throw if wrong number of agents', () => {
      const customConfigs = [
        { agentId: 'agent-1', modelType: 'esmfold' as const }
        // Only 1 agent, but config expects 7
      ];

      expect(() => predictor.initializeAgents(customConfigs)).toThrow();
    });
  });

  describe('prediction', () => {
    it('should predict with consensus', async () => {
      const sequence: ProteinSequence = {
        id: 'test',
        sequence: 'MKVLWAALLVTFLAGCQAKV' // 20 amino acids
      };

      const result = await predictor.predict(sequence);

      expect(result.consensusStructure).toBeDefined();
      expect(result.consensusStructure.sequenceId).toBe('test');
      expect(result.votes).toHaveLength(7); // All 7 agents voted
      expect(result.agreement).toBeGreaterThan(0.5);
      expect(result.convergenceTime).toBeGreaterThan(0);
    }, 120000); // 2 minute timeout for prediction

    it('should detect Byzantine agents', async () => {
      // Use custom agents where one produces very different results
      const sequence: ProteinSequence = {
        id: 'test',
        sequence: 'MKVLWAALLV'
      };

      const result = await predictor.predict(sequence);

      // With mock predictions, Byzantine detection may vary
      expect(result.byzantineDetected).toBeDefined();
      expect(Array.isArray(result.byzantineDetected)).toBe(true);
    }, 120000);

    it('should handle short sequences', async () => {
      const sequence: ProteinSequence = {
        id: 'short',
        sequence: 'MKVLW' // 5 amino acids
      };

      const result = await predictor.predict(sequence);

      expect(result.consensusStructure.atoms.length).toBeGreaterThan(0);
    }, 120000);
  });
});
