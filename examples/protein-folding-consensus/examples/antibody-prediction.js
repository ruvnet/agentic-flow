"use strict";
/**
 * Example: Predict antibody structure with Byzantine consensus
 *
 * Antibodies are large (~150 kDa) proteins with multiple domains.
 * This example focuses on the variable domain (Fv fragment) which is
 * critical for antigen recognition.
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
    console.log('=== Antibody Variable Domain Prediction Example ===\n');
    // Antibody variable heavy chain (VH) - simplified example
    // Based on therapeutic antibody structure
    const antibodyFasta = `>antibody_VH Antibody variable heavy chain
EVQLVESGGGLVQPGGSLRLSCAASGFTFSSYAMSWVRQAPGKGLEWVSAISGSGGSTYYADSVKGRFTISRDNSKNTLYLQMNSLRAEDTAVYYCAKVSYLSTASSLDYWGQGTLVTVSS`;
    console.log('Sequence: Antibody variable heavy chain (VH)');
    console.log('Length: ~120 amino acids');
    console.log('Expected features:');
    console.log('- Beta-sheet framework');
    console.log('- Three hypervariable loops (CDRs)');
    console.log('- Disulfide bond (conserved cysteines)\n');
    // Create pipeline with increased agents for complex structure
    const pipeline = new src_1.ProteinFoldingPipeline({
        numAgents: 7,
        faultTolerance: 2,
        consensusThreshold: 2 / 3,
        rmsdThreshold: 2.5, // Slightly more tolerant for larger protein
        timeout: 600000 // 10 minutes
    }, undefined, './data/antibody-patterns.db');
    try {
        const outputDir = path.join(__dirname, '../output/antibody');
        const result = await pipeline.predict(antibodyFasta, outputDir);
        console.log('\n=== Results ===');
        console.log(`PDB file: ${result.pdbFile}`);
        console.log(`Total time: ${(result.metrics.totalTime / 1000).toFixed(2)}s`);
        console.log(`Prediction speed: ${(result.metrics.sequenceLength / (result.metrics.totalTime / 1000)).toFixed(2)} residues/sec`);
        console.log(`Byzantine agents detected: ${result.metrics.byzantineDetected}`);
        console.log('\n=== CDR Loop Analysis ===');
        console.log('CDR1 (complementarity-determining region 1): residues ~26-35');
        console.log('CDR2: residues ~50-65');
        console.log('CDR3: residues ~95-102');
        console.log('\nThese loops are critical for antigen binding and should show:');
        console.log('- High structural variability');
        console.log('- Lower confidence scores (more flexible)');
        console.log('- Exposed surface positions');
        console.log('\n=== Validation Checks ===');
        console.log('Expected disulfide bond: CYS23-CYS88');
        console.log('Framework: Beta-sheet core');
        console.log('Hydrophobic core: Buried residues');
        console.log('\n=== Comparison with Known Structures ===');
        console.log('Search PDB for similar antibodies:');
        console.log('https://www.rcsb.org/search?request=%7B%22query%22%3A%7B%22type%22%3A%22terminal%22%2C%22service%22%3A%22text%22%2C%22parameters%22%3A%7B%22value%22%3A%22antibody%22%7D%7D%7D');
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
//# sourceMappingURL=antibody-prediction.js.map