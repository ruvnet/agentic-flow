"use strict";
/**
 * Example: Demonstrate Byzantine fault tolerance
 *
 * This example shows how the system handles:
 * - Malicious agents returning incorrect predictions
 * - Faulty agents with high error rates
 * - Byzantine consensus detection and recovery
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const src_1 = require("../src");
async function main() {
    console.log('=== Byzantine Fault Tolerance Demonstration ===\n');
    // Test sequence
    const parser = new src_1.ProteinSequenceParser();
    const sequence = parser.createSequence('test', 'MKVLWAALLVTFLAGCQAKV');
    console.log(`Testing with sequence: ${sequence.id} (${sequence.sequence.length} residues)\n`);
    // Test 1: Normal operation (all honest agents)
    console.log('Test 1: All Honest Agents');
    console.log('-------------------------');
    const normalPredictor = new src_1.ByzantinePredictor({
        numAgents: 7,
        faultTolerance: 2,
        consensusThreshold: 2 / 3,
        rmsdThreshold: 2.0
    });
    const normalResult = await normalPredictor.predict(sequence);
    console.log(`Agreement: ${(normalResult.agreement * 100).toFixed(2)}%`);
    console.log(`Byzantine detected: ${normalResult.byzantineDetected.length}`);
    console.log(`Consensus confidence: ${(normalResult.consensusStructure.confidence * 100).toFixed(2)}%\n`);
    // Test 2: Inject faulty agents (simulate Byzantine behavior)
    console.log('Test 2: With 2 Byzantine Agents (Maximum Tolerated)');
    console.log('----------------------------------------------------');
    // Create custom agents where 2 are "Byzantine" (produce very different results)
    const customAgents = [
        { agentId: 'honest-1', modelType: 'esmfold' },
        { agentId: 'honest-2', modelType: 'omegafold' },
        { agentId: 'honest-3', modelType: 'openfold' },
        { agentId: 'honest-4', modelType: 'rosettafold' },
        { agentId: 'honest-5', modelType: 'esmfold' },
        { agentId: 'byzantine-1', modelType: 'custom' }, // Will produce bad predictions
        { agentId: 'byzantine-2', modelType: 'custom' } // Will produce bad predictions
    ];
    const byzantinePredictor = new src_1.ByzantinePredictor({
        numAgents: 7,
        faultTolerance: 2,
        consensusThreshold: 2 / 3,
        rmsdThreshold: 2.0
    });
    byzantinePredictor.initializeAgents(customAgents);
    const byzantineResult = await byzantinePredictor.predict(sequence);
    console.log(`Agreement: ${(byzantineResult.agreement * 100).toFixed(2)}%`);
    console.log(`Byzantine detected: ${byzantineResult.byzantineDetected.length}`);
    console.log(`Detected agents: ${byzantineResult.byzantineDetected.join(', ')}`);
    console.log(`Consensus confidence: ${(byzantineResult.consensusStructure.confidence * 100).toFixed(2)}%\n`);
    // Validate both structures
    const validator = new src_1.ConsensusValidator();
    console.log('Validation Results');
    console.log('------------------');
    const normalValidation = validator.validate(normalResult.consensusStructure);
    const byzantineValidation = validator.validate(byzantineResult.consensusStructure);
    console.log('Normal (all honest):');
    console.log(`  Valid: ${normalValidation.isValid}`);
    console.log(`  Energy: ${normalValidation.energy.toFixed(2)} kcal/mol`);
    console.log(`  Clashes: ${normalValidation.clashes}`);
    console.log('\nWith Byzantine agents:');
    console.log(`  Valid: ${byzantineValidation.isValid}`);
    console.log(`  Energy: ${byzantineValidation.energy.toFixed(2)} kcal/mol`);
    console.log(`  Clashes: ${byzantineValidation.clashes}`);
    // Compare structures
    console.log('\n=== Structure Comparison ===');
    const rmsd = calculateRMSD(normalResult.consensusStructure.atoms.filter(a => a.atomName === 'CA'), byzantineResult.consensusStructure.atoms.filter(a => a.atomName === 'CA'));
    console.log(`RMSD between structures: ${rmsd.toFixed(3)}Å`);
    if (rmsd < 3.0) {
        console.log('✓ Byzantine consensus successfully recovered correct structure!');
    }
    else {
        console.log('⚠ Structures differ significantly despite consensus');
    }
    // Export results
    const visualizer = new src_1.VisualizationEngine();
    await visualizer.exportComparison(normalResult.consensusStructure, byzantineResult.consensusStructure, './output/byzantine-comparison');
    console.log('\n=== Key Insights ===');
    console.log('1. Byzantine consensus can tolerate up to f=2 faulty agents');
    console.log('2. Requires N=3f+1=7 total agents for consensus');
    console.log('3. Consensus threshold of 2/3 ensures majority agreement');
    console.log('4. RMSD threshold filters out outlier predictions');
    console.log('5. System maintains correctness despite Byzantine faults\n');
}
/**
 * Calculate RMSD between two atom sets
 */
function calculateRMSD(atoms1, atoms2) {
    if (atoms1.length !== atoms2.length || atoms1.length === 0) {
        return Infinity;
    }
    let sumSquaredDistance = 0;
    for (let i = 0; i < atoms1.length; i++) {
        const dx = atoms1[i].coordinate.x - atoms2[i].coordinate.x;
        const dy = atoms1[i].coordinate.y - atoms2[i].coordinate.y;
        const dz = atoms1[i].coordinate.z - atoms2[i].coordinate.z;
        sumSquaredDistance += dx * dx + dy * dy + dz * dz;
    }
    return Math.sqrt(sumSquaredDistance / atoms1.length);
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=byzantine-fault-injection.js.map