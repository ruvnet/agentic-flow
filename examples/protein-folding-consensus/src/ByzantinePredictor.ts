/**
 * ByzantinePredictor - Fault-tolerant structure prediction with Byzantine consensus
 *
 * Implements Byzantine consensus (3f+1 nodes) for protein structure prediction:
 * - Spawn N prediction agents (N = 3f+1, typically N=7 for f=2)
 * - Collect predictions from all agents
 * - Byzantine voting on structure regions
 * - Requires 2/3 agreement (5/7 for N=7)
 * - Filter out hallucinated/malicious predictions
 */

import { StructurePredictionAgent } from './StructurePredictionAgent';
import { StructureMerger } from './StructureMerger';
import {
  ProteinSequence,
  ProteinStructure,
  ConsensusVote,
  ConsensusResult,
  ByzantineConfig,
  PredictionAgentConfig,
  Atom
} from './types';

export class ByzantinePredictor {
  private config: ByzantineConfig;
  private agents: StructurePredictionAgent[] = [];
  private merger: StructureMerger;

  constructor(config: Partial<ByzantineConfig> = {}) {
    // Default configuration: N=7, f=2, requires 5/7 agreement
    this.config = {
      numAgents: 7,
      faultTolerance: 2,
      consensusThreshold: 2/3, // 0.667
      rmsdThreshold: 2.0, // Angstroms
      timeout: 300000, // 5 minutes
      quicEnabled: false,
      ...config
    };

    // Validate Byzantine parameters
    if (this.config.numAgents < 3 * this.config.faultTolerance + 1) {
      throw new Error(
        `Invalid Byzantine configuration: N (${this.config.numAgents}) must be >= 3f+1 ` +
        `(3*${this.config.faultTolerance}+1 = ${3 * this.config.faultTolerance + 1})`
      );
    }

    this.merger = new StructureMerger();
  }

  /**
   * Initialize prediction agents with different models
   */
  initializeAgents(agentConfigs?: PredictionAgentConfig[]): void {
    if (agentConfigs && agentConfigs.length > 0) {
      // Use provided configurations
      this.agents = agentConfigs.map(config => new StructurePredictionAgent(config));
    } else {
      // Create default agents with different models
      const modelTypes: Array<'esmfold' | 'omegafold' | 'openfold' | 'rosettafold'> = [
        'esmfold',
        'omegafold',
        'openfold',
        'rosettafold',
        'esmfold', // Repeat for N=7
        'omegafold',
        'openfold'
      ];

      this.agents = modelTypes.slice(0, this.config.numAgents).map((modelType, i) => {
        return new StructurePredictionAgent({
          agentId: `agent-${i + 1}`,
          modelType,
          timeout: this.config.timeout
        });
      });
    }

    if (this.agents.length !== this.config.numAgents) {
      throw new Error(
        `Expected ${this.config.numAgents} agents, got ${this.agents.length}`
      );
    }
  }

  /**
   * Predict structure with Byzantine consensus
   */
  async predict(sequence: ProteinSequence): Promise<ConsensusResult> {
    const startTime = Date.now();

    // Ensure agents are initialized
    if (this.agents.length === 0) {
      this.initializeAgents();
    }

    console.log(`Starting Byzantine consensus with ${this.config.numAgents} agents...`);

    // Phase 1: Parallel prediction from all agents
    const votes = await this.collectVotes(sequence);

    console.log(`Collected ${votes.length} predictions`);

    // Phase 2: Byzantine consensus voting
    const consensusStructure = await this.performConsensus(votes, sequence);

    // Phase 3: Detect Byzantine agents
    const byzantineDetected = this.detectByzantineAgents(votes, consensusStructure);

    const convergenceTime = Date.now() - startTime;

    return {
      consensusStructure,
      votes,
      agreement: this.calculateAgreement(votes, consensusStructure),
      byzantineDetected,
      convergenceTime
    };
  }

  /**
   * Collect predictions from all agents in parallel
   */
  private async collectVotes(sequence: ProteinSequence): Promise<ConsensusVote[]> {
    const predictionPromises = this.agents.map(async (agent, i) => {
      try {
        const structure = await agent.predict(sequence);
        return {
          agentId: agent.getInfo().agentId,
          structure,
          timestamp: Date.now()
        };
      } catch (error: any) {
        console.error(`Agent ${i + 1} prediction failed:`, error.message);
        // Return null for failed predictions
        return null;
      }
    });

    const results = await Promise.all(predictionPromises);

    // Filter out failed predictions
    const validVotes = results.filter((vote): vote is ConsensusVote => vote !== null);

    // Require at least 2f+1 votes for consensus
    const minVotes = 2 * this.config.faultTolerance + 1;
    if (validVotes.length < minVotes) {
      throw new Error(
        `Insufficient votes for consensus: got ${validVotes.length}, need ${minVotes}`
      );
    }

    return validVotes;
  }

  /**
   * Perform Byzantine consensus voting
   * For each residue position, require 2/3 agreement within RMSD threshold
   */
  private async performConsensus(
    votes: ConsensusVote[],
    sequence: ProteinSequence
  ): Promise<ProteinStructure> {
    const length = sequence.sequence.length;
    const consensusAtoms: Atom[] = [];
    const perResidueConfidence: number[] = [];

    console.log('Performing per-residue Byzantine consensus...');

    // For each residue, vote on the coordinates
    for (let residueNum = 1; residueNum <= length; residueNum++) {
      // Extract CA atoms for this residue from all votes
      const residueVotes: Array<{ agentId: string; atoms: Atom[] }> = [];

      for (const vote of votes) {
        const residueAtoms = vote.structure.atoms.filter(
          atom => atom.residueNumber === residueNum
        );
        if (residueAtoms.length > 0) {
          residueVotes.push({
            agentId: vote.agentId,
            atoms: residueAtoms
          });
        }
      }

      if (residueVotes.length === 0) {
        console.warn(`No votes for residue ${residueNum}`);
        continue;
      }

      // Byzantine voting: find cluster with 2/3 agreement
      const consensusCluster = this.findConsensusCluster(residueVotes);

      if (consensusCluster) {
        // Use median coordinates from consensus cluster
        const medianAtoms = this.calculateMedianAtoms(consensusCluster);
        consensusAtoms.push(...medianAtoms);

        // Confidence based on cluster size
        const confidence = consensusCluster.length / residueVotes.length;
        perResidueConfidence.push(confidence);
      } else {
        console.warn(`No consensus for residue ${residueNum}`);
        // Use fallback: average of all votes
        const fallbackAtoms = this.calculateMedianAtoms(residueVotes);
        consensusAtoms.push(...fallbackAtoms);
        perResidueConfidence.push(0.3); // Low confidence
      }
    }

    // Calculate overall confidence
    const avgConfidence = perResidueConfidence.reduce((sum, c) => sum + c, 0) / perResidueConfidence.length;

    return {
      sequenceId: sequence.id,
      atoms: consensusAtoms,
      confidence: avgConfidence,
      perResidueConfidence,
      predictedBy: 'byzantine-consensus',
      timestamp: Date.now()
    };
  }

  /**
   * Find cluster of votes with 2/3 agreement (within RMSD threshold)
   */
  private findConsensusCluster(
    votes: Array<{ agentId: string; atoms: Atom[] }>
  ): Array<{ agentId: string; atoms: Atom[] }> | null {
    const requiredSize = Math.ceil(votes.length * this.config.consensusThreshold);

    // Try each vote as a potential cluster center
    for (const centerVote of votes) {
      const cluster = [centerVote];

      // Find all votes within RMSD threshold
      for (const otherVote of votes) {
        if (otherVote === centerVote) continue;

        const rmsd = this.calculateRMSD(centerVote.atoms, otherVote.atoms);
        if (rmsd <= this.config.rmsdThreshold) {
          cluster.push(otherVote);
        }
      }

      // Check if cluster size meets consensus threshold
      if (cluster.length >= requiredSize) {
        return cluster;
      }
    }

    return null;
  }

  /**
   * Calculate RMSD (Root Mean Square Deviation) between two atom sets
   */
  private calculateRMSD(atoms1: Atom[], atoms2: Atom[]): number {
    if (atoms1.length !== atoms2.length) {
      return Infinity;
    }

    let sumSquaredDistance = 0;
    let count = 0;

    // Match atoms by name and residue number
    for (const atom1 of atoms1) {
      const atom2 = atoms2.find(
        a => a.atomName === atom1.atomName && a.residueNumber === atom1.residueNumber
      );

      if (atom2) {
        const dx = atom1.coordinate.x - atom2.coordinate.x;
        const dy = atom1.coordinate.y - atom2.coordinate.y;
        const dz = atom1.coordinate.z - atom2.coordinate.z;
        sumSquaredDistance += dx * dx + dy * dy + dz * dz;
        count++;
      }
    }

    if (count === 0) return Infinity;

    return Math.sqrt(sumSquaredDistance / count);
  }

  /**
   * Calculate median coordinates from a cluster of votes
   */
  private calculateMedianAtoms(
    cluster: Array<{ agentId: string; atoms: Atom[] }>
  ): Atom[] {
    if (cluster.length === 0) return [];

    const result: Atom[] = [];
    const referenceAtoms = cluster[0].atoms;

    for (const refAtom of referenceAtoms) {
      // Collect corresponding atoms from all votes
      const correspondingAtoms = cluster
        .map(vote => vote.atoms.find(
          a => a.atomName === refAtom.atomName && a.residueNumber === refAtom.residueNumber
        ))
        .filter((a): a is Atom => a !== undefined);

      if (correspondingAtoms.length === 0) continue;

      // Calculate median coordinates
      const xValues = correspondingAtoms.map(a => a.coordinate.x).sort((a, b) => a - b);
      const yValues = correspondingAtoms.map(a => a.coordinate.y).sort((a, b) => a - b);
      const zValues = correspondingAtoms.map(a => a.coordinate.z).sort((a, b) => a - b);

      const median = (values: number[]) => {
        const mid = Math.floor(values.length / 2);
        return values.length % 2 === 0
          ? (values[mid - 1] + values[mid]) / 2
          : values[mid];
      };

      result.push({
        ...refAtom,
        coordinate: {
          x: median(xValues),
          y: median(yValues),
          z: median(zValues)
        },
        bFactor: correspondingAtoms.reduce((sum, a) => sum + (a.bFactor || 0), 0) / correspondingAtoms.length
      });
    }

    return result;
  }

  /**
   * Detect Byzantine (malicious/faulty) agents
   */
  private detectByzantineAgents(
    votes: ConsensusVote[],
    consensusStructure: ProteinStructure
  ): string[] {
    const byzantineAgents: string[] = [];

    for (const vote of votes) {
      // Calculate RMSD between vote and consensus
      const caAtomsVote = vote.structure.atoms.filter(a => a.atomName === 'CA');
      const caAtomsConsensus = consensusStructure.atoms.filter(a => a.atomName === 'CA');

      const rmsd = this.calculateRMSD(caAtomsVote, caAtomsConsensus);

      // If RMSD exceeds threshold, mark as Byzantine
      if (rmsd > this.config.rmsdThreshold * 2) {
        byzantineAgents.push(vote.agentId);
        console.log(`Byzantine agent detected: ${vote.agentId} (RMSD: ${rmsd.toFixed(2)}Å)`);
      }
    }

    return byzantineAgents;
  }

  /**
   * Calculate agreement percentage
   */
  private calculateAgreement(
    votes: ConsensusVote[],
    consensusStructure: ProteinStructure
  ): number {
    let totalAgreement = 0;

    for (const vote of votes) {
      const caAtomsVote = vote.structure.atoms.filter(a => a.atomName === 'CA');
      const caAtomsConsensus = consensusStructure.atoms.filter(a => a.atomName === 'CA');

      const rmsd = this.calculateRMSD(caAtomsVote, caAtomsConsensus);

      // Agreement score: 1.0 if within threshold, decreases with RMSD
      const agreement = Math.max(0, 1 - rmsd / (this.config.rmsdThreshold * 2));
      totalAgreement += agreement;
    }

    return totalAgreement / votes.length;
  }

  /**
   * Get configuration
   */
  getConfig(): ByzantineConfig {
    return { ...this.config };
  }
}
