"use strict";
/**
 * Example: Predict insulin structure with Byzantine consensus
 *
 * Insulin is a 51 amino acid peptide hormone (human insulin):
 * - Chain A: 21 residues
 * - Chain B: 30 residues
 * - Known structure: PDB ID 1MSO
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const src_1 = require("../src");
const path = __importStar(require("path"));
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
    const pipeline = new src_1.ProteinFoldingPipeline({
        numAgents: 7,
        faultTolerance: 2,
        consensusThreshold: 2 / 3,
        rmsdThreshold: 2.0
    }, undefined, // Use default agents
    './data/insulin-patterns.db');
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
    }
    catch (error) {
        console.error('Prediction failed:', error);
        throw error;
    }
    finally {
        await pipeline.close();
    }
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=insulin-prediction.js.map