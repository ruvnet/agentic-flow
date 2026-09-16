/**
 * Protein Folding with Byzantine Consensus
 *
 * Main entry point for distributed protein structure prediction system
 */

export { ProteinSequenceParser } from './ProteinSequenceParser';
export { StructurePredictionAgent } from './StructurePredictionAgent';
export { ByzantinePredictor } from './ByzantinePredictor';
export { StructureMerger } from './StructureMerger';
export { FoldingPatternLearner } from './FoldingPatternLearner';
export { ConsensusValidator } from './ConsensusValidator';
export { VisualizationEngine } from './VisualizationEngine';

export * from './types';

// Main workflow class
import { ProteinSequenceParser } from './ProteinSequenceParser';
import { ByzantinePredictor } from './ByzantinePredictor';
import { FoldingPatternLearner } from './FoldingPatternLearner';
import { ConsensusValidator } from './ConsensusValidator';
import { VisualizationEngine } from './VisualizationEngine';
import {
  ProteinSequence,
  ByzantineConfig,
  PredictionAgentConfig,
  PerformanceMetrics,
  ScientificMetrics
} from './types';

export class ProteinFoldingPipeline {
  private parser: ProteinSequenceParser;
  private predictor: ByzantinePredictor;
  private learner: FoldingPatternLearner;
  private validator: ConsensusValidator;
  private visualizer: VisualizationEngine;

  constructor(
    byzantineConfig?: Partial<ByzantineConfig>,
    agentConfigs?: PredictionAgentConfig[],
    learnerDbPath?: string
  ) {
    this.parser = new ProteinSequenceParser();
    this.predictor = new ByzantinePredictor(byzantineConfig);
    this.learner = new FoldingPatternLearner(learnerDbPath);
    this.validator = new ConsensusValidator();
    this.visualizer = new VisualizationEngine();

    // Initialize prediction agents
    if (agentConfigs) {
      this.predictor.initializeAgents(agentConfigs);
    }
  }

  /**
   * Run complete prediction pipeline
   */
  async predict(
    fastaContent: string,
    outputDir: string = './output'
  ): Promise<{
    metrics: PerformanceMetrics;
    pdbFile: string;
  }> {
    const startTime = Date.now();

    console.log('=== Protein Folding Pipeline ===\n');

    // 1. Parse sequence
    console.log('Step 1: Parsing FASTA sequence...');
    const sequences = this.parser.parseFasta(fastaContent);
    if (sequences.length === 0) {
      throw new Error('No valid sequences found in FASTA content');
    }
    const sequence = sequences[0];
    console.log(`Parsed sequence: ${sequence.id} (${sequence.sequence.length} residues)\n`);

    // 2. Byzantine consensus prediction
    console.log('Step 2: Running Byzantine consensus prediction...');
    const predictionStart = Date.now();
    const consensusResult = await this.predictor.predict(sequence);
    const predictionTime = Date.now() - predictionStart;
    console.log(`Prediction completed in ${(predictionTime / 1000).toFixed(2)}s`);
    console.log(`Agreement: ${(consensusResult.agreement * 100).toFixed(2)}%`);
    console.log(`Byzantine agents detected: ${consensusResult.byzantineDetected.length}\n`);

    // 3. Validate structure
    console.log('Step 3: Validating structure...');
    const validationStart = Date.now();
    const validation = this.validator.validate(consensusResult.consensusStructure);
    const validationTime = Date.now() - validationStart;
    console.log(`Validation: ${validation.isValid ? 'PASSED' : 'FAILED'}`);
    console.log(`Energy: ${validation.energy.toFixed(2)} kcal/mol`);
    console.log(`Clashes: ${validation.clashes}\n`);

    // 4. Store patterns (if valid)
    if (validation.isValid) {
      console.log('Step 4: Storing folding patterns...');
      await this.learner.storePattern(
        sequence.sequence,
        consensusResult.consensusStructure,
        consensusResult.consensusStructure.confidence
      );
      const stats = await this.learner.getStatistics();
      console.log(`Total patterns learned: ${stats.totalPatterns}\n`);
    }

    // 5. Export results
    console.log('Step 5: Exporting results...');
    const fs = await import('fs/promises');
    await fs.mkdir(outputDir, { recursive: true });

    const pdbFile = `${outputDir}/${sequence.id}.pdb`;
    await this.visualizer.exportWithConfidence(consensusResult.consensusStructure, pdbFile);

    const reportFile = `${outputDir}/${sequence.id}_report.html`;
    await this.visualizer.generateReport(
      consensusResult.consensusStructure,
      validation,
      reportFile
    );

    const scriptFile = `${outputDir}/${sequence.id}_visualize.pml`;
    await this.visualizer.generatePyMOLScript(pdbFile, scriptFile, {
      showConfidence: true,
      showBackbone: true
    });

    console.log(`Results exported to: ${outputDir}\n`);

    // Calculate metrics
    const totalTime = Date.now() - startTime;
    const metrics: PerformanceMetrics = {
      predictionTime,
      consensusTime: consensusResult.convergenceTime,
      validationTime,
      totalTime,
      numAgents: this.predictor.getConfig().numAgents,
      sequenceLength: sequence.sequence.length,
      byzantineDetected: consensusResult.byzantineDetected.length
    };

    console.log('=== Performance Metrics ===');
    console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`Prediction: ${(predictionTime / 1000).toFixed(2)}s`);
    console.log(`Consensus: ${(consensusResult.convergenceTime / 1000).toFixed(2)}s`);
    console.log(`Validation: ${(validationTime / 1000).toFixed(2)}s`);
    console.log(`Throughput: ${(sequence.sequence.length / (totalTime / 1000)).toFixed(2)} residues/sec\n`);

    return {
      metrics,
      pdbFile
    };
  }

  /**
   * Close resources
   */
  async close(): Promise<void> {
    await this.learner.close();
  }
}
