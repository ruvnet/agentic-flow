# Quick Start Guide

Get started with protein structure prediction in 5 minutes!

## Installation

```bash
cd /home/user/agentic-flow/examples/protein-folding-consensus
npm install
npm run build
```

## Your First Prediction

### 1. Create a FASTA file

Create `insulin.fasta`:

```fasta
>insulin_chain_B
FVNQHLCGSHLVEALYLVCGERGFFYTPKT
```

### 2. Run prediction

```bash
npm run predict -- insulin.fasta
```

Or with TypeScript:

```typescript
import { ProteinFoldingPipeline } from './src';

const pipeline = new ProteinFoldingPipeline();

const fasta = `>insulin
FVNQHLCGSHLVEALYLVCGERGFFYTPKT`;

const result = await pipeline.predict(fasta, './output');

console.log(`✓ Prediction complete!`);
console.log(`PDB file: ${result.pdbFile}`);
console.log(`Time: ${(result.metrics.totalTime / 1000).toFixed(2)}s`);

await pipeline.close();
```

### 3. View results

```bash
# View in PyMOL
pymol output/insulin_chain_B.pdb

# Or run the generated script
pymol output/insulin_chain_B_visualize.pml

# View HTML report
open output/insulin_chain_B_report.html
```

## Examples

### Example 1: Insulin (Basic)

```bash
npm run example insulin
```

Output:
- `output/insulin/insulin_chain_B.pdb`
- `output/insulin/insulin_chain_B_report.html`
- `output/insulin/insulin_chain_B_visualize.pml`

### Example 2: Antibody (Complex)

```bash
npm run example antibody
```

### Example 3: Byzantine Fault Tolerance (Demo)

```bash
npm run example byzantine
```

This demonstrates how the system handles faulty agents.

## Understanding the Output

### PDB File

Standard Protein Data Bank format. Can be opened in:
- PyMOL: `pymol file.pdb`
- Chimera: `chimera file.pdb`
- VMD: `vmd file.pdb`
- Online: https://www.rcsb.org/3d-view

### Confidence Scores

Encoded in B-factor column:
- **>90**: Very high confidence (blue in PyMOL)
- **70-90**: High confidence (cyan)
- **50-70**: Medium confidence (yellow)
- **<50**: Low confidence (red)

### HTML Report

Contains:
- Overall confidence score
- Validation results
- Energy estimation
- Warnings and errors
- Structural metrics

## Configuration

### Byzantine Parameters

Edit `config/default.json`:

```json
{
  "byzantine": {
    "numAgents": 7,          // Total agents (N = 3f+1)
    "faultTolerance": 2,     // Max Byzantine faults (f)
    "consensusThreshold": 0.667,  // 2/3 agreement
    "rmsdThreshold": 2.0     // Angstroms
  }
}
```

### Custom Agents

```typescript
const agentConfigs = [
  {
    agentId: 'agent-1',
    modelType: 'esmfold',
    apiEndpoint: 'https://api.example.com/esmfold',
    apiKey: process.env.API_KEY
  }
];

const pipeline = new ProteinFoldingPipeline(
  { numAgents: 7, faultTolerance: 2 },
  agentConfigs
);
```

## Testing

```bash
# Run all tests
npm test

# Run specific test
npm test -- ProteinSequenceParser

# With coverage
npm test -- --coverage
```

## Benchmarking

```bash
# Quick benchmark (10, 20, 50 residues)
npm run benchmark

# Custom lengths
npm run benchmark -- -s 10,50,100,200
```

## Common Issues

### Issue: "Invalid amino acid"

**Cause**: Sequence contains non-standard amino acids (X, B, Z)

**Solution**: Replace with standard 20 amino acids or remove

### Issue: "Sequence too long"

**Cause**: Exceeds model limit (typically 400 residues)

**Solution**:
- Split into domains
- Use models with higher limits
- Adjust `maxLength` in config

### Issue: "Insufficient votes for consensus"

**Cause**: Too many agents failed

**Solution**:
- Check network connectivity
- Verify API endpoints
- Reduce timeout
- Check agent configurations

### Issue: "High energy / many clashes"

**Cause**: Poor prediction quality

**Solution**:
- Check input sequence
- Try different models
- Increase RMSD threshold
- Manual refinement in PyMOL

## Next Steps

1. **Read the Scientific Background**: `docs/SCIENTIFIC_BACKGROUND.md`
2. **Explore API**: `docs/API.md`
3. **Try Advanced Examples**: `examples/`
4. **Customize Configuration**: `config/default.json`
5. **Integrate with Your Workflow**: See API documentation

## Performance Tips

### Speed Up Predictions

1. **Use fewer agents** (minimum N=4 for f=1)
2. **Shorter sequences** (<100 residues)
3. **Local models** (no API calls)
4. **Batch processing** (reuse pipeline)

### Improve Accuracy

1. **More agents** (N=7 or N=10)
2. **Diverse models** (ESMFold, OmegaFold, OpenFold, RoseTTAFold)
3. **Tighter RMSD threshold** (<1.5Å)
4. **Higher consensus threshold** (75% instead of 67%)

### Save Resources

1. **Pattern learning** (reuse learned patterns)
2. **Cache predictions** (store in database)
3. **Limit agent timeout** (fail fast)

## Support

- **Documentation**: `README.md`, `docs/`
- **Issues**: GitHub Issues
- **Examples**: `examples/`
- **API Reference**: `docs/API.md`

## Quick Reference

```bash
# Predict
npm run predict -- input.fasta -o ./output

# Test
npm test

# Benchmark
npm run benchmark

# Examples
npm run example insulin
npm run example antibody
npm run example byzantine

# Build
npm run build

# Lint
npm run lint

# Type check
npm run typecheck
```

## What's Next?

Now that you've run your first prediction, explore:

1. **Customize agents** for your specific use case
2. **Integrate with AlphaFold3** when available
3. **Add QUIC transport** for lower latency
4. **Scale to more agents** (10, 20, 50+)
5. **Contribute improvements** via GitHub

Happy protein folding! 🧬
