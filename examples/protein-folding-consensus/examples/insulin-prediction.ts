/**
 * Example: Predict insulin structure with Byzantine consensus
 *
 * Insulin is a 51 amino acid peptide hormone (human insulin):
 * - Chain A: 21 residues
 * - Chain B: 30 residues
 * - Known structure: PDB ID 1MSO
 */

import { ProteinFoldingPipeline } from '../src';
import * as path from 'path';

async function main() {
  console.log('=== Insulin Structure Prediction Example ===\n');

  // Human insulin sequence (chains A and B)
  const insulinFasta = `>sp|P01308|INS_HUMAN Insulin OS=Homo sapiens
MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN`;

  // Actual mature insulin (after cleavage):
  // Chain B: FVNQHLCGSHLVEALYLVCGERGFFYTPKT
  // Chain A: GIVEQCCTSICSLYQLENYCN

  const matureInsulinFasta = `>insulin_chain_B
FVNQHLCGSHLVEALYLVCGERGFFYTPKT
>insulin_chain_A
GIVEQCCTSICSLYQLENYCN`;

  // Create pipeline with Byzantine consensus
  const pipeline = new ProteinFoldingPipeline(
    {
      numAgents: 7,
      faultTolerance: 2,
      consensusThreshold: 2/3,
      rmsdThreshold: 2.0
    },
    undefined, // Use default agents
    './data/insulin-patterns.db'
  );

  try {
    // Predict structure for chain B (larger chain)
    const outputDir = path.join(__dirname, '../output/insulin');

    const result = await pipeline.predict(matureInsulinFasta, outputDir);

    console.log('\n=== Results ===');
    console.log(`PDB file: ${result.pdbFile}`);
    console.log(`Total time: ${(result.metrics.totalTime / 1000).toFixed(2)}s`);
    console.log(`Byzantine agents detected: ${result.metrics.byzantineDetected}`);

    console.log('\n=== Comparison with Known Structure ===');
    console.log('Known structure: PDB ID 1MSO');
    console.log('To compare:');
    console.log('1. Download 1MSO from RCSB PDB: https://www.rcsb.org/structure/1MSO');
    console.log(`2. Align structures: pymol ${outputDir}/insulin_chain_B_visualize.pml`);
    console.log('3. Calculate RMSD: align predicted, 1MSO');

    console.log('\n=== Expected Performance ===');
    console.log('- Prediction time: <5 minutes');
    console.log('- Byzantine tolerance: 2 faulty agents');
    console.log('- Consensus agreement: >80%');
    console.log('- Expected accuracy: RMSD <3Å from crystal structure');

  } catch (error) {
    console.error('Prediction failed:', error);
    throw error;
  } finally {
    await pipeline.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };
