/**
 * Tests for ConsensusValidator
 */

import { ConsensusValidator } from '../src/ConsensusValidator';
import { ProteinStructure, Atom } from '../src/types';

describe('ConsensusValidator', () => {
  let validator: ConsensusValidator;

  beforeEach(() => {
    validator = new ConsensusValidator();
  });

  describe('validate', () => {
    it('should validate ideal structure', () => {
      // Create ideal helical structure
      const atoms: Atom[] = [];

      for (let i = 0; i < 10; i++) {
        const angle = (i * 100 * Math.PI) / 180;
        const radius = 2.3;
        const rise = 1.5;

        // Backbone atoms
        atoms.push(
          {
            atomId: i * 4 + 1,
            atomName: 'N',
            residueNumber: i + 1,
            residueName: 'ALA',
            chainId: 'A',
            coordinate: {
              x: radius * Math.cos(angle),
              y: radius * Math.sin(angle),
              z: i * rise
            }
          },
          {
            atomId: i * 4 + 2,
            atomName: 'CA',
            residueNumber: i + 1,
            residueName: 'ALA',
            chainId: 'A',
            coordinate: {
              x: radius * Math.cos(angle) + 0.5,
              y: radius * Math.sin(angle) + 0.5,
              z: i * rise + 0.3
            }
          },
          {
            atomId: i * 4 + 3,
            atomName: 'C',
            residueNumber: i + 1,
            residueName: 'ALA',
            chainId: 'A',
            coordinate: {
              x: radius * Math.cos(angle) + 1.0,
              y: radius * Math.sin(angle) + 1.0,
              z: i * rise + 0.6
            }
          },
          {
            atomId: i * 4 + 4,
            atomName: 'O',
            residueNumber: i + 1,
            residueName: 'ALA',
            chainId: 'A',
            coordinate: {
              x: radius * Math.cos(angle) + 1.2,
              y: radius * Math.sin(angle) + 1.2,
              z: i * rise + 0.9
            }
          }
        );
      }

      const structure: ProteinStructure = {
        sequenceId: 'test',
        atoms,
        confidence: 0.95,
        perResidueConfidence: Array(10).fill(0.95),
        predictedBy: 'test',
        timestamp: Date.now()
      };

      const result = validator.validate(structure);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.energy).toBeGreaterThan(0);
    });

    it('should detect clashes', () => {
      // Create structure with deliberate clash
      const atoms: Atom[] = [
        {
          atomId: 1,
          atomName: 'CA',
          residueNumber: 1,
          residueName: 'ALA',
          chainId: 'A',
          coordinate: { x: 0, y: 0, z: 0 }
        },
        {
          atomId: 2,
          atomName: 'CA',
          residueNumber: 10, // Far apart in sequence
          residueName: 'ALA',
          chainId: 'A',
          coordinate: { x: 0.5, y: 0, z: 0 } // Too close (clash)
        }
      ];

      const structure: ProteinStructure = {
        sequenceId: 'test',
        atoms,
        confidence: 0.9,
        perResidueConfidence: [0.9, 0.9],
        predictedBy: 'test',
        timestamp: Date.now()
      };

      const result = validator.validate(structure);

      expect(result.clashes).toBeGreaterThan(0);
    });

    it('should detect missing atoms', () => {
      // Incomplete backbone (missing O atom)
      const atoms: Atom[] = [
        {
          atomId: 1,
          atomName: 'N',
          residueNumber: 1,
          residueName: 'ALA',
          chainId: 'A',
          coordinate: { x: 0, y: 0, z: 0 }
        },
        {
          atomId: 2,
          atomName: 'CA',
          residueNumber: 1,
          residueName: 'ALA',
          chainId: 'A',
          coordinate: { x: 1, y: 0, z: 0 }
        },
        {
          atomId: 3,
          atomName: 'C',
          residueNumber: 1,
          residueName: 'ALA',
          chainId: 'A',
          coordinate: { x: 2, y: 0, z: 0 }
        }
        // Missing O atom
      ];

      const structure: ProteinStructure = {
        sequenceId: 'test',
        atoms,
        confidence: 0.9,
        perResidueConfidence: [0.9],
        predictedBy: 'test',
        timestamp: Date.now()
      };

      const result = validator.validate(structure);

      expect(result.warnings.some(w => w.includes('missing'))).toBe(true);
    });
  });
});
