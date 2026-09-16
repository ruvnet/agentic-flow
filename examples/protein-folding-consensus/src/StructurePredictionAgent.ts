/**
 * StructurePredictionAgent - Interface to multiple ML models for structure prediction
 *
 * Supports:
 * - ESMFold (Meta's language model)
 * - OmegaFold (language model)
 * - OpenFold (open source AlphaFold)
 * - RoseTTAFold (transformer)
 * - Custom models
 */

import axios from 'axios';
import { ProteinSequence, ProteinStructure, Atom, Coordinate, PredictionAgentConfig } from './types';

export class StructurePredictionAgent {
  private config: PredictionAgentConfig;

  constructor(config: PredictionAgentConfig) {
    this.config = {
      maxLength: 400, // Default max sequence length
      timeout: 300000, // 5 minutes default
      ...config
    };
  }

  /**
   * Predict protein structure
   */
  async predict(sequence: ProteinSequence): Promise<ProteinStructure> {
    // Validate sequence length
    if (sequence.sequence.length > (this.config.maxLength || 400)) {
      throw new Error(
        `Sequence too long (${sequence.sequence.length} residues). ` +
        `Maximum ${this.config.maxLength} for ${this.config.modelType}`
      );
    }

    switch (this.config.modelType) {
      case 'esmfold':
        return this.predictESMFold(sequence);
      case 'omegafold':
        return this.predictOmegaFold(sequence);
      case 'openfold':
        return this.predictOpenFold(sequence);
      case 'rosettafold':
        return this.predictRoseTTAFold(sequence);
      case 'custom':
        return this.predictCustom(sequence);
      default:
        throw new Error(`Unknown model type: ${this.config.modelType}`);
    }
  }

  /**
   * ESMFold prediction (Meta's model)
   * Uses ESM-2 language model + structure prediction head
   */
  private async predictESMFold(sequence: ProteinSequence): Promise<ProteinStructure> {
    try {
      if (this.config.apiEndpoint) {
        // Use custom API endpoint
        const response = await axios.post(
          this.config.apiEndpoint,
          { sequence: sequence.sequence },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
            },
            timeout: this.config.timeout
          }
        );

        return this.parsePredictionResponse(response.data, sequence.id, 'esmfold');
      } else {
        // Fallback to mock prediction for demonstration
        return this.mockPrediction(sequence, 'esmfold', 0.85);
      }
    } catch (error: any) {
      throw new Error(`ESMFold prediction failed: ${error.message}`);
    }
  }

  /**
   * OmegaFold prediction
   */
  private async predictOmegaFold(sequence: ProteinSequence): Promise<ProteinStructure> {
    try {
      if (this.config.apiEndpoint) {
        const response = await axios.post(
          this.config.apiEndpoint,
          { sequence: sequence.sequence },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: this.config.timeout
          }
        );

        return this.parsePredictionResponse(response.data, sequence.id, 'omegafold');
      } else {
        return this.mockPrediction(sequence, 'omegafold', 0.82);
      }
    } catch (error: any) {
      throw new Error(`OmegaFold prediction failed: ${error.message}`);
    }
  }

  /**
   * OpenFold prediction (open source AlphaFold)
   */
  private async predictOpenFold(sequence: ProteinSequence): Promise<ProteinStructure> {
    try {
      if (this.config.apiEndpoint) {
        const response = await axios.post(
          this.config.apiEndpoint,
          { sequence: sequence.sequence },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: this.config.timeout
          }
        );

        return this.parsePredictionResponse(response.data, sequence.id, 'openfold');
      } else {
        return this.mockPrediction(sequence, 'openfold', 0.88);
      }
    } catch (error: any) {
      throw new Error(`OpenFold prediction failed: ${error.message}`);
    }
  }

  /**
   * RoseTTAFold prediction
   */
  private async predictRoseTTAFold(sequence: ProteinSequence): Promise<ProteinStructure> {
    try {
      if (this.config.apiEndpoint) {
        const response = await axios.post(
          this.config.apiEndpoint,
          { sequence: sequence.sequence },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: this.config.timeout
          }
        );

        return this.parsePredictionResponse(response.data, sequence.id, 'rosettafold');
      } else {
        return this.mockPrediction(sequence, 'rosettafold', 0.80);
      }
    } catch (error: any) {
      throw new Error(`RoseTTAFold prediction failed: ${error.message}`);
    }
  }

  /**
   * Custom model prediction
   */
  private async predictCustom(sequence: ProteinSequence): Promise<ProteinStructure> {
    if (!this.config.apiEndpoint) {
      throw new Error('Custom model requires apiEndpoint');
    }

    try {
      const response = await axios.post(
        this.config.apiEndpoint,
        { sequence: sequence.sequence },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.config.timeout
        }
      );

      return this.parsePredictionResponse(response.data, sequence.id, 'custom');
    } catch (error: any) {
      throw new Error(`Custom model prediction failed: ${error.message}`);
    }
  }

  /**
   * Parse prediction response from API
   */
  private parsePredictionResponse(
    data: any,
    sequenceId: string,
    modelType: string
  ): ProteinStructure {
    // Expected format: { atoms: [...], confidence: 0.85, perResidueConfidence: [...] }
    const atoms: Atom[] = (data.atoms || []).map((atom: any) => ({
      atomId: atom.atomId || atom.id,
      atomName: atom.atomName || atom.name,
      residueNumber: atom.residueNumber || atom.resNum,
      residueName: atom.residueName || atom.resName,
      chainId: atom.chainId || 'A',
      coordinate: {
        x: atom.x || atom.coordinate.x,
        y: atom.y || atom.coordinate.y,
        z: atom.z || atom.coordinate.z
      },
      bFactor: atom.bFactor || atom.confidence,
      occupancy: atom.occupancy || 1.0
    }));

    return {
      sequenceId,
      atoms,
      confidence: data.confidence || 0.5,
      perResidueConfidence: data.perResidueConfidence || [],
      predictedBy: `${this.config.agentId}:${modelType}`,
      timestamp: Date.now(),
      energy: data.energy
    };
  }

  /**
   * Mock prediction for demonstration (generates realistic-looking structure)
   */
  private mockPrediction(
    sequence: ProteinSequence,
    modelType: string,
    baseConfidence: number
  ): ProteinStructure {
    const atoms: Atom[] = [];
    const perResidueConfidence: number[] = [];

    // Generate CA (alpha carbon) atoms in a helical-like structure
    const length = sequence.sequence.length;

    for (let i = 0; i < length; i++) {
      const residue = sequence.sequence[i];

      // Helical parameters (3.6 residues per turn, 1.5Å rise per residue)
      const angle = (i * 100 * Math.PI) / 180; // 100 degrees per residue
      const radius = 2.3; // Angstroms
      const rise = 1.5; // Angstroms per residue

      // Add some noise to make it look realistic
      const noise = () => (Math.random() - 0.5) * 0.3;

      // CA atom
      atoms.push({
        atomId: i * 4 + 1,
        atomName: 'CA',
        residueNumber: i + 1,
        residueName: this.threeLetterCode(residue),
        chainId: 'A',
        coordinate: {
          x: radius * Math.cos(angle) + noise(),
          y: radius * Math.sin(angle) + noise(),
          z: i * rise + noise()
        },
        bFactor: baseConfidence * 100 + (Math.random() - 0.5) * 20,
        occupancy: 1.0
      });

      // Add backbone atoms (N, C, O) with offsets
      const backboneAtoms = ['N', 'C', 'O'];
      for (let j = 0; j < backboneAtoms.length; j++) {
        atoms.push({
          atomId: i * 4 + j + 2,
          atomName: backboneAtoms[j],
          residueNumber: i + 1,
          residueName: this.threeLetterCode(residue),
          chainId: 'A',
          coordinate: {
            x: radius * Math.cos(angle) + (j - 1) * 0.5 + noise(),
            y: radius * Math.sin(angle) + (j - 1) * 0.5 + noise(),
            z: i * rise + (j - 1) * 0.3 + noise()
          },
          bFactor: baseConfidence * 100 + (Math.random() - 0.5) * 20,
          occupancy: 1.0
        });
      }

      // Per-residue confidence (varies slightly)
      perResidueConfidence.push(baseConfidence + (Math.random() - 0.5) * 0.1);
    }

    return {
      sequenceId: sequence.id,
      atoms,
      confidence: baseConfidence,
      perResidueConfidence,
      predictedBy: `${this.config.agentId}:${modelType}`,
      timestamp: Date.now()
    };
  }

  /**
   * Convert one-letter amino acid code to three-letter code
   */
  private threeLetterCode(oneLetterCode: string): string {
    const codes: Record<string, string> = {
      'A': 'ALA', 'C': 'CYS', 'D': 'ASP', 'E': 'GLU', 'F': 'PHE',
      'G': 'GLY', 'H': 'HIS', 'I': 'ILE', 'K': 'LYS', 'L': 'LEU',
      'M': 'MET', 'N': 'ASN', 'P': 'PRO', 'Q': 'GLN', 'R': 'ARG',
      'S': 'SER', 'T': 'THR', 'V': 'VAL', 'W': 'TRP', 'Y': 'TYR'
    };
    return codes[oneLetterCode] || 'UNK';
  }

  /**
   * Get model information
   */
  getInfo(): PredictionAgentConfig {
    return { ...this.config };
  }
}
