/**
 * ConsensusValidator - Validate predicted protein structures
 *
 * Validates structures for:
 * - Physical feasibility (bond lengths, angles)
 * - Atomic clashes (van der Waals violations)
 * - Energy minimization
 * - Distance constraints
 */

import { ProteinStructure, ValidationResult, Atom, Coordinate } from './types';

export class ConsensusValidator {
  // Standard bond lengths (Angstroms)
  private static readonly BOND_LENGTHS = {
    'CA-N': { ideal: 1.46, tolerance: 0.1 },
    'CA-C': { ideal: 1.52, tolerance: 0.1 },
    'C-O': { ideal: 1.23, tolerance: 0.1 },
    'C-N': { ideal: 1.33, tolerance: 0.1 } // Peptide bond
  };

  // Standard bond angles (degrees)
  private static readonly BOND_ANGLES = {
    'N-CA-C': { ideal: 111.0, tolerance: 5.0 },
    'CA-C-N': { ideal: 117.0, tolerance: 5.0 },
    'CA-C-O': { ideal: 121.0, tolerance: 5.0 }
  };

  // Van der Waals radii (Angstroms)
  private static readonly VDW_RADII: Record<string, number> = {
    'C': 1.70,
    'N': 1.55,
    'O': 1.52,
    'S': 1.80,
    'H': 1.20
  };

  /**
   * Validate protein structure
   */
  validate(structure: ProteinStructure): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Extract backbone atoms
    const backboneAtoms = structure.atoms.filter(
      atom => ['N', 'CA', 'C', 'O'].includes(atom.atomName)
    );

    // 1. Validate bond lengths
    const bondViolations = this.validateBondLengths(backboneAtoms, errors, warnings);

    // 2. Validate bond angles
    const angleViolations = this.validateBondAngles(backboneAtoms, errors, warnings);

    // 3. Check for atomic clashes
    const clashes = this.detectClashes(structure.atoms, errors, warnings);

    // 4. Estimate energy
    const energy = this.estimateEnergy(structure, clashes);

    // 5. Check completeness
    this.checkCompleteness(structure, errors, warnings);

    const isValid = errors.length === 0 && bondViolations < 5 && angleViolations < 5;

    return {
      isValid,
      energy,
      clashes,
      bondViolations,
      angleViolations,
      errors,
      warnings
    };
  }

  /**
   * Validate bond lengths
   */
  private validateBondLengths(
    backboneAtoms: Atom[],
    errors: string[],
    warnings: string[]
  ): number {
    let violations = 0;

    // Group atoms by residue
    const residues = this.groupByResidue(backboneAtoms);

    for (let i = 0; i < residues.length; i++) {
      const residue = residues[i];

      // Check intra-residue bonds
      const bonds = [
        ['N', 'CA'],
        ['CA', 'C'],
        ['C', 'O']
      ];

      for (const [atom1Name, atom2Name] of bonds) {
        const atom1 = residue.find(a => a.atomName === atom1Name);
        const atom2 = residue.find(a => a.atomName === atom2Name);

        if (atom1 && atom2) {
          const distance = this.calculateDistance(atom1.coordinate, atom2.coordinate);
          const bondKey = `${atom1Name}-${atom2Name}`;
          const bondSpec = ConsensusValidator.BOND_LENGTHS[bondKey];

          if (bondSpec) {
            const deviation = Math.abs(distance - bondSpec.ideal);
            if (deviation > bondSpec.tolerance) {
              violations++;
              warnings.push(
                `Bond ${bondKey} in residue ${atom1.residueNumber}: ` +
                `${distance.toFixed(3)}Å (expected ${bondSpec.ideal}Å ± ${bondSpec.tolerance}Å)`
              );
            }
          }
        }
      }

      // Check peptide bond to next residue
      if (i < residues.length - 1) {
        const currentC = residue.find(a => a.atomName === 'C');
        const nextN = residues[i + 1].find(a => a.atomName === 'N');

        if (currentC && nextN) {
          const distance = this.calculateDistance(currentC.coordinate, nextN.coordinate);
          const bondSpec = ConsensusValidator.BOND_LENGTHS['C-N'];

          if (bondSpec) {
            const deviation = Math.abs(distance - bondSpec.ideal);
            if (deviation > bondSpec.tolerance) {
              violations++;
              warnings.push(
                `Peptide bond C${currentC.residueNumber}-N${nextN.residueNumber}: ` +
                `${distance.toFixed(3)}Å (expected ${bondSpec.ideal}Å ± ${bondSpec.tolerance}Å)`
              );
            }
          }
        }
      }
    }

    return violations;
  }

  /**
   * Validate bond angles
   */
  private validateBondAngles(
    backboneAtoms: Atom[],
    errors: string[],
    warnings: string[]
  ): number {
    let violations = 0;

    const residues = this.groupByResidue(backboneAtoms);

    for (const residue of residues) {
      // Check N-CA-C angle
      const n = residue.find(a => a.atomName === 'N');
      const ca = residue.find(a => a.atomName === 'CA');
      const c = residue.find(a => a.atomName === 'C');

      if (n && ca && c) {
        const angle = this.calculateAngle(n.coordinate, ca.coordinate, c.coordinate);
        const angleSpec = ConsensusValidator.BOND_ANGLES['N-CA-C'];

        const deviation = Math.abs(angle - angleSpec.ideal);
        if (deviation > angleSpec.tolerance) {
          violations++;
          warnings.push(
            `Angle N-CA-C in residue ${ca.residueNumber}: ` +
            `${angle.toFixed(1)}° (expected ${angleSpec.ideal}° ± ${angleSpec.tolerance}°)`
          );
        }
      }
    }

    return violations;
  }

  /**
   * Detect atomic clashes (van der Waals violations)
   */
  private detectClashes(
    atoms: Atom[],
    errors: string[],
    warnings: string[]
  ): number {
    let clashes = 0;

    // Check all atom pairs
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const atom1 = atoms[i];
        const atom2 = atoms[j];

        // Skip atoms in same or adjacent residues
        if (Math.abs(atom1.residueNumber - atom2.residueNumber) <= 1) {
          continue;
        }

        const distance = this.calculateDistance(atom1.coordinate, atom2.coordinate);

        // Get van der Waals radii
        const radius1 = this.getVdwRadius(atom1.atomName);
        const radius2 = this.getVdwRadius(atom2.atomName);
        const minDistance = (radius1 + radius2) * 0.8; // 80% of sum (slight overlap allowed)

        if (distance < minDistance) {
          clashes++;
          if (clashes <= 10) { // Limit warnings
            warnings.push(
              `Clash between ${atom1.atomName}${atom1.residueNumber} and ` +
              `${atom2.atomName}${atom2.residueNumber}: ${distance.toFixed(2)}Å ` +
              `(minimum ${minDistance.toFixed(2)}Å)`
            );
          }
        }
      }
    }

    if (clashes > 10) {
      warnings.push(`... and ${clashes - 10} more clashes`);
    }

    return clashes;
  }

  /**
   * Estimate potential energy (simplified force field)
   */
  private estimateEnergy(structure: ProteinStructure, clashes: number): number {
    // Very simplified energy estimation
    // Real energy calculation would use AMBER, CHARMM, etc.

    let energy = 0;

    // Clash penalty (1 kcal/mol per clash)
    energy += clashes * 1.0;

    // Bond energy (harmonic potential)
    const backboneAtoms = structure.atoms.filter(
      atom => ['N', 'CA', 'C', 'O'].includes(atom.atomName)
    );
    const residues = this.groupByResidue(backboneAtoms);

    for (const residue of residues) {
      const ca = residue.find(a => a.atomName === 'CA');
      const n = residue.find(a => a.atomName === 'N');
      const c = residue.find(a => a.atomName === 'C');

      if (ca && n && c) {
        // Bond stretching energy: k * (r - r0)^2
        const k = 500; // Force constant (kcal/mol/Å^2)

        const distCA_N = this.calculateDistance(ca.coordinate, n.coordinate);
        const distCA_C = this.calculateDistance(ca.coordinate, c.coordinate);

        energy += k * Math.pow(distCA_N - 1.46, 2);
        energy += k * Math.pow(distCA_C - 1.52, 2);
      }
    }

    return energy;
  }

  /**
   * Check structure completeness
   */
  private checkCompleteness(
    structure: ProteinStructure,
    errors: string[],
    warnings: string[]
  ): void {
    // Check for missing backbone atoms
    const residues = this.groupByResidue(structure.atoms);

    for (const residue of residues) {
      const requiredAtoms = ['N', 'CA', 'C', 'O'];
      const missingAtoms = requiredAtoms.filter(
        atomName => !residue.some(a => a.atomName === atomName)
      );

      if (missingAtoms.length > 0) {
        const resNum = residue[0].residueNumber;
        warnings.push(
          `Residue ${resNum} missing atoms: ${missingAtoms.join(', ')}`
        );
      }
    }
  }

  /**
   * Calculate distance between two coordinates
   */
  private calculateDistance(coord1: Coordinate, coord2: Coordinate): number {
    const dx = coord1.x - coord2.x;
    const dy = coord1.y - coord2.y;
    const dz = coord1.z - coord2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Calculate angle between three points (in degrees)
   */
  private calculateAngle(
    coord1: Coordinate,
    coord2: Coordinate,
    coord3: Coordinate
  ): number {
    // Vectors from coord2 to coord1 and coord3
    const v1 = {
      x: coord1.x - coord2.x,
      y: coord1.y - coord2.y,
      z: coord1.z - coord2.z
    };

    const v2 = {
      x: coord3.x - coord2.x,
      y: coord3.y - coord2.y,
      z: coord3.z - coord2.z
    };

    // Dot product
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;

    // Magnitudes
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

    // Angle in radians
    const angleRad = Math.acos(dot / (mag1 * mag2));

    // Convert to degrees
    return (angleRad * 180) / Math.PI;
  }

  /**
   * Get van der Waals radius for atom
   */
  private getVdwRadius(atomName: string): number {
    const element = atomName[0]; // First character is element
    return ConsensusValidator.VDW_RADII[element] || 1.7;
  }

  /**
   * Group atoms by residue number
   */
  private groupByResidue(atoms: Atom[]): Atom[][] {
    const residueMap = new Map<number, Atom[]>();

    for (const atom of atoms) {
      if (!residueMap.has(atom.residueNumber)) {
        residueMap.set(atom.residueNumber, []);
      }
      residueMap.get(atom.residueNumber)!.push(atom);
    }

    return Array.from(residueMap.values());
  }
}
