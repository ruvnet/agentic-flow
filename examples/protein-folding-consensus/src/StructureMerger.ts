/**
 * StructureMerger - CRDT-based conflict-free structure merging
 *
 * Implements CRDT (Conflict-free Replicated Data Type) for merging partial
 * protein structure predictions without conflicts.
 *
 * Uses LWW (Last-Write-Wins) strategy with lamport timestamps.
 */

import { ProteinStructure, Atom, CRDTOperation } from './types';

interface AtomKey {
  chainId: string;
  residueNumber: number;
  atomName: string;
}

interface AtomState {
  atom: Atom;
  timestamp: number;
  agentId: string;
}

export class StructureMerger {
  private atomStates: Map<string, AtomState> = new Map();
  private operations: CRDTOperation[] = [];

  /**
   * Merge multiple structure predictions using CRDT
   */
  merge(structures: ProteinStructure[]): ProteinStructure {
    if (structures.length === 0) {
      throw new Error('No structures to merge');
    }

    // Reset state
    this.atomStates.clear();
    this.operations = [];

    // Apply all operations in timestamp order
    const allOperations: CRDTOperation[] = [];

    for (const structure of structures) {
      for (const atom of structure.atoms) {
        allOperations.push({
          type: 'add',
          timestamp: structure.timestamp,
          agentId: structure.predictedBy,
          residueNumber: atom.residueNumber,
          atoms: [atom]
        });
      }
    }

    // Sort by timestamp (Lamport clock)
    allOperations.sort((a, b) => a.timestamp - b.timestamp);

    // Apply operations
    for (const op of allOperations) {
      this.applyOperation(op);
    }

    // Extract merged atoms
    const mergedAtoms: Atom[] = [];
    for (const state of this.atomStates.values()) {
      mergedAtoms.push(state.atom);
    }

    // Sort by residue number and atom name
    mergedAtoms.sort((a, b) => {
      if (a.residueNumber !== b.residueNumber) {
        return a.residueNumber - b.residueNumber;
      }
      return a.atomName.localeCompare(b.atomName);
    });

    // Calculate merged confidence (average)
    const avgConfidence = structures.reduce((sum, s) => sum + s.confidence, 0) / structures.length;

    // Merge per-residue confidence
    const perResidueConfidence = this.mergePerResidueConfidence(structures);

    return {
      sequenceId: structures[0].sequenceId,
      atoms: mergedAtoms,
      confidence: avgConfidence,
      perResidueConfidence,
      predictedBy: 'crdt-merged',
      timestamp: Date.now()
    };
  }

  /**
   * Apply CRDT operation (LWW strategy)
   */
  private applyOperation(op: CRDTOperation): void {
    this.operations.push(op);

    for (const atom of op.atoms) {
      const key = this.atomKey(atom);
      const existing = this.atomStates.get(key);

      if (op.type === 'remove') {
        // Remove operation
        if (existing && op.timestamp > existing.timestamp) {
          this.atomStates.delete(key);
        }
      } else {
        // Add or update operation
        if (!existing || op.timestamp > existing.timestamp) {
          this.atomStates.set(key, {
            atom,
            timestamp: op.timestamp,
            agentId: op.agentId
          });
        } else if (op.timestamp === existing.timestamp && op.agentId > existing.agentId) {
          // Tie-break by agent ID (deterministic)
          this.atomStates.set(key, {
            atom,
            timestamp: op.timestamp,
            agentId: op.agentId
          });
        }
      }
    }
  }

  /**
   * Generate unique key for atom
   */
  private atomKey(atom: Atom): string {
    return `${atom.chainId}:${atom.residueNumber}:${atom.atomName}`;
  }

  /**
   * Merge per-residue confidence scores
   */
  private mergePerResidueConfidence(structures: ProteinStructure[]): number[] {
    if (structures.length === 0) return [];

    const maxLength = Math.max(
      ...structures.map(s => s.perResidueConfidence?.length || 0)
    );

    const merged: number[] = [];

    for (let i = 0; i < maxLength; i++) {
      const values = structures
        .map(s => s.perResidueConfidence?.[i])
        .filter((v): v is number => v !== undefined);

      if (values.length > 0) {
        // Use average
        merged.push(values.reduce((sum, v) => sum + v, 0) / values.length);
      } else {
        merged.push(0.5); // Default
      }
    }

    return merged;
  }

  /**
   * Align structures using Kabsch algorithm (simplified)
   * This minimizes RMSD between two structures
   */
  alignStructures(reference: ProteinStructure, target: ProteinStructure): ProteinStructure {
    // Extract CA atoms for alignment
    const refCA = reference.atoms.filter(a => a.atomName === 'CA');
    const targetCA = target.atoms.filter(a => a.atomName === 'CA');

    if (refCA.length === 0 || targetCA.length === 0) {
      console.warn('No CA atoms for alignment');
      return target;
    }

    // Match atoms by residue number
    const pairs: Array<[Atom, Atom]> = [];
    for (const refAtom of refCA) {
      const targetAtom = targetCA.find(a => a.residueNumber === refAtom.residueNumber);
      if (targetAtom) {
        pairs.push([refAtom, targetAtom]);
      }
    }

    if (pairs.length < 3) {
      console.warn('Insufficient matched atoms for alignment');
      return target;
    }

    // Calculate centroids
    const refCentroid = this.calculateCentroid(pairs.map(p => p[0]));
    const targetCentroid = this.calculateCentroid(pairs.map(p => p[1]));

    // Translate target to origin
    const translatedAtoms = target.atoms.map(atom => ({
      ...atom,
      coordinate: {
        x: atom.coordinate.x - targetCentroid.x,
        y: atom.coordinate.y - targetCentroid.y,
        z: atom.coordinate.z - targetCentroid.z
      }
    }));

    // For simplicity, we skip the rotation matrix calculation (Kabsch algorithm)
    // In production, use a proper linear algebra library

    // Translate to reference centroid
    const alignedAtoms = translatedAtoms.map(atom => ({
      ...atom,
      coordinate: {
        x: atom.coordinate.x + refCentroid.x,
        y: atom.coordinate.y + refCentroid.y,
        z: atom.coordinate.z + refCentroid.z
      }
    }));

    return {
      ...target,
      atoms: alignedAtoms
    };
  }

  /**
   * Calculate centroid of atoms
   */
  private calculateCentroid(atoms: Atom[]): { x: number; y: number; z: number } {
    if (atoms.length === 0) return { x: 0, y: 0, z: 0 };

    const sum = atoms.reduce(
      (acc, atom) => ({
        x: acc.x + atom.coordinate.x,
        y: acc.y + atom.coordinate.y,
        z: acc.z + atom.coordinate.z
      }),
      { x: 0, y: 0, z: 0 }
    );

    return {
      x: sum.x / atoms.length,
      y: sum.y / atoms.length,
      z: sum.z / atoms.length
    };
  }

  /**
   * Get merge operations history
   */
  getOperations(): CRDTOperation[] {
    return [...this.operations];
  }
}
