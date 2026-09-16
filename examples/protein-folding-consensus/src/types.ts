/**
 * Core type definitions for protein folding with Byzantine consensus
 */

/**
 * Amino acid sequence representation
 */
export interface ProteinSequence {
  id: string;
  sequence: string; // Single-letter amino acid codes (e.g., "MKVLWAALL...")
  organism?: string;
  function?: string;
  metadata?: Record<string, any>;
  chains?: Chain[];
}

/**
 * Protein chain (for multi-chain complexes)
 */
export interface Chain {
  chainId: string;
  sequence: string;
  length: number;
}

/**
 * 3D coordinate in space
 */
export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

/**
 * Atom in protein structure
 */
export interface Atom {
  atomId: number;
  atomName: string; // CA, N, C, O, etc.
  residueNumber: number;
  residueName: string; // ALA, GLY, etc.
  chainId: string;
  coordinate: Coordinate;
  bFactor?: number; // Confidence score
  occupancy?: number;
}

/**
 * Predicted protein structure
 */
export interface ProteinStructure {
  sequenceId: string;
  atoms: Atom[];
  confidence: number; // Overall confidence (0-1)
  perResidueConfidence: number[]; // Per-residue confidence (pLDDT scores)
  predictedBy: string; // Model/agent identifier
  timestamp: number;
  energy?: number; // Potential energy (kcal/mol)
}

/**
 * Byzantine consensus vote
 */
export interface ConsensusVote {
  agentId: string;
  structure: ProteinStructure;
  signature?: string; // Cryptographic signature
  timestamp: number;
}

/**
 * Byzantine consensus result
 */
export interface ConsensusResult {
  consensusStructure: ProteinStructure;
  votes: ConsensusVote[];
  agreement: number; // Percentage of agents in agreement
  byzantineDetected: string[]; // Agent IDs that disagreed significantly
  convergenceTime: number; // ms
}

/**
 * Prediction agent configuration
 */
export interface PredictionAgentConfig {
  agentId: string;
  modelType: 'esmfold' | 'omegafold' | 'openfold' | 'rosettafold' | 'custom';
  apiEndpoint?: string;
  apiKey?: string;
  maxLength?: number;
  timeout?: number;
}

/**
 * Byzantine coordinator configuration
 */
export interface ByzantineConfig {
  numAgents: number; // N = 3f+1 (typical N=7 for f=2)
  faultTolerance: number; // f = number of Byzantine faults tolerated
  consensusThreshold: number; // Required agreement (typically 2/3)
  rmsdThreshold: number; // RMSD threshold for structure comparison (Angstroms)
  timeout: number; // ms
  quicEnabled?: boolean;
}

/**
 * CRDT operation for structure merging
 */
export interface CRDTOperation {
  type: 'add' | 'update' | 'remove';
  timestamp: number;
  agentId: string;
  residueNumber: number;
  atoms: Atom[];
}

/**
 * Folding pattern stored in AgentDB
 */
export interface FoldingPattern {
  id: string;
  sequenceFragment: string; // Short sequence (5-10 residues)
  structureFragment: Atom[]; // Corresponding 3D structure
  embedding: number[]; // Vector embedding
  confidence: number;
  occurrences: number; // How many times seen
  successRate: number; // How often predictions were accurate
}

/**
 * Structure validation result
 */
export interface ValidationResult {
  isValid: boolean;
  energy: number; // Potential energy (kcal/mol)
  clashes: number; // Number of atomic clashes
  bondViolations: number;
  angleViolations: number;
  errors: string[];
  warnings: string[];
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  predictionTime: number; // ms
  consensusTime: number; // ms
  validationTime: number; // ms
  totalTime: number; // ms
  numAgents: number;
  sequenceLength: number;
  byzantineDetected: number;
}

/**
 * Scientific metrics for validation
 */
export interface ScientificMetrics {
  tmScore?: number; // Template Modeling score (0-1)
  rmsd?: number; // Root Mean Square Deviation (Angstroms)
  gdtTs?: number; // Global Distance Test (0-100)
  lddt?: number; // Local Distance Difference Test (0-1)
  referenceStructure?: string; // PDB ID or file path
}
