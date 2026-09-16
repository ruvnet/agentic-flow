# API Documentation

## Table of Contents

- [ProteinSequenceParser](#proteinsequenceparser)
- [StructurePredictionAgent](#structurepredictionagent)
- [ByzantinePredictor](#byzantinepredictor)
- [StructureMerger](#structuremerger)
- [FoldingPatternLearner](#foldingpatternlearner)
- [ConsensusValidator](#consensusvalidator)
- [VisualizationEngine](#visualizationengine)
- [ProteinFoldingPipeline](#proteinfoldingpipeline)

---

## ProteinSequenceParser

Parse and validate FASTA format protein sequences.

### Constructor

```typescript
new ProteinSequenceParser()
```

### Methods

#### `parseFasta(fastaContent: string): ProteinSequence[]`

Parse FASTA format file.

**Parameters:**
- `fastaContent`: FASTA formatted string

**Returns:** Array of `ProteinSequence` objects

**Throws:** Error if invalid amino acid or empty sequence

**Example:**

```typescript
const parser = new ProteinSequenceParser();
const sequences = parser.parseFasta(`
>insulin
FVNQHLCGSHLVEALYLVCGERGFFYTPKT
`);
```

#### `createSequence(id: string, sequence: string): ProteinSequence`

Create sequence from string.

**Parameters:**
- `id`: Sequence identifier
- `sequence`: Amino acid sequence (one-letter codes)

**Returns:** `ProteinSequence` object

#### `getStatistics(sequence: string): Record<string, any>`

Calculate sequence statistics.

**Returns:**
- `length`: Number of residues
- `composition`: Amino acid frequencies
- `hydrophobicFraction`: Fraction of hydrophobic residues
- `chargedFraction`: Fraction of charged residues
- `polarFraction`: Fraction of polar residues
- `molecularWeight`: Estimated mass (Da)
- `isoelectricPoint`: Estimated pI

#### `splitChains(sequence: string, delimiter: string): Chain[]`

Split multi-chain complex.

**Parameters:**
- `sequence`: Combined sequence
- `delimiter`: Chain separator (default: "/")

**Returns:** Array of `Chain` objects

---

## StructurePredictionAgent

Interface to ML models for structure prediction.

### Constructor

```typescript
new StructurePredictionAgent(config: PredictionAgentConfig)
```

**Parameters:**
- `agentId`: Unique agent identifier
- `modelType`: "esmfold" | "omegafold" | "openfold" | "rosettafold" | "custom"
- `apiEndpoint?`: API endpoint URL
- `apiKey?`: API authentication key
- `maxLength?`: Maximum sequence length (default: 400)
- `timeout?`: Request timeout in ms (default: 300000)

### Methods

#### `predict(sequence: ProteinSequence): Promise<ProteinStructure>`

Predict protein structure.

**Parameters:**
- `sequence`: Input protein sequence

**Returns:** Promise resolving to `ProteinStructure`

**Throws:** Error if prediction fails or sequence too long

**Example:**

```typescript
const agent = new StructurePredictionAgent({
  agentId: 'agent-1',
  modelType: 'esmfold',
  apiEndpoint: 'https://api.example.com/esmfold'
});

const structure = await agent.predict(sequence);
console.log(`Confidence: ${structure.confidence}`);
```

#### `getInfo(): PredictionAgentConfig`

Get agent configuration.

**Returns:** Agent configuration object

---

## ByzantinePredictor

Coordinate multiple agents with Byzantine consensus.

### Constructor

```typescript
new ByzantinePredictor(config?: Partial<ByzantineConfig>)
```

**Parameters:**
- `numAgents`: Total number of agents (default: 7)
- `faultTolerance`: Maximum Byzantine faults (default: 2)
- `consensusThreshold`: Required agreement fraction (default: 2/3)
- `rmsdThreshold`: RMSD threshold in Angstroms (default: 2.0)
- `timeout`: Prediction timeout in ms (default: 300000)
- `quicEnabled`: Use QUIC transport (default: false)

**Throws:** Error if `numAgents < 3 * faultTolerance + 1`

### Methods

#### `initializeAgents(agentConfigs?: PredictionAgentConfig[]): void`

Initialize prediction agents.

**Parameters:**
- `agentConfigs`: Optional custom agent configurations

**Note:** If not provided, creates default agents with different models.

#### `predict(sequence: ProteinSequence): Promise<ConsensusResult>`

Predict structure with Byzantine consensus.

**Parameters:**
- `sequence`: Input protein sequence

**Returns:** Promise resolving to `ConsensusResult` containing:
- `consensusStructure`: Agreed-upon structure
- `votes`: Individual agent predictions
- `agreement`: Consensus agreement fraction (0-1)
- `byzantineDetected`: Array of Byzantine agent IDs
- `convergenceTime`: Consensus time in ms

**Example:**

```typescript
const predictor = new ByzantinePredictor({
  numAgents: 7,
  faultTolerance: 2
});

predictor.initializeAgents();

const result = await predictor.predict(sequence);
console.log(`Agreement: ${result.agreement * 100}%`);
console.log(`Byzantine agents: ${result.byzantineDetected.join(', ')}`);
```

#### `getConfig(): ByzantineConfig`

Get Byzantine configuration.

**Returns:** Configuration object

---

## StructureMerger

Merge partial predictions using CRDT.

### Constructor

```typescript
new StructureMerger()
```

### Methods

#### `merge(structures: ProteinStructure[]): ProteinStructure`

Merge multiple structures using CRDT (Last-Write-Wins).

**Parameters:**
- `structures`: Array of structures to merge

**Returns:** Merged `ProteinStructure`

**Throws:** Error if no structures provided

**Example:**

```typescript
const merger = new StructureMerger();
const merged = merger.merge([structure1, structure2, structure3]);
```

#### `alignStructures(reference: ProteinStructure, target: ProteinStructure): ProteinStructure`

Align target structure to reference using simplified Kabsch algorithm.

**Parameters:**
- `reference`: Reference structure
- `target`: Structure to align

**Returns:** Aligned structure

#### `getOperations(): CRDTOperation[]`

Get merge operation history.

**Returns:** Array of CRDT operations

---

## FoldingPatternLearner

Learn and retrieve folding patterns using AgentDB.

### Constructor

```typescript
new FoldingPatternLearner(
  dbPath?: string,
  fragmentLength?: number,
  minOccurrences?: number
)
```

**Parameters:**
- `dbPath`: Database file path (default: "./folding-patterns.db")
- `fragmentLength`: Fragment size for patterns (default: 7)
- `minOccurrences`: Minimum pattern occurrences (default: 3)

### Methods

#### `storePattern(sequence: string, structure: ProteinStructure, confidence: number): Promise<void>`

Store successful folding pattern.

**Parameters:**
- `sequence`: Amino acid sequence
- `structure`: Predicted structure
- `confidence`: Prediction confidence (0-1)

**Example:**

```typescript
const learner = new FoldingPatternLearner('./patterns.db');
await learner.storePattern(sequence, structure, 0.95);
```

#### `findSimilarPatterns(sequenceFragment: string, topK?: number, minConfidence?: number): Promise<FoldingPattern[]>`

Find similar folding patterns.

**Parameters:**
- `sequenceFragment`: Query sequence fragment
- `topK`: Number of results (default: 5)
- `minConfidence`: Minimum confidence threshold (default: 0.7)

**Returns:** Array of similar `FoldingPattern` objects

#### `predictFromPatterns(sequence: string): Promise<Atom[]>`

Predict structure using learned patterns.

**Parameters:**
- `sequence`: Full amino acid sequence

**Returns:** Array of predicted atoms

#### `getStatistics(): Promise<object>`

Get learning statistics.

**Returns:**
- `totalPatterns`: Number of stored patterns
- `avgOccurrences`: Average pattern occurrences
- `avgSuccessRate`: Average success rate
- `topPatterns`: Top 10 most frequent patterns

#### `close(): Promise<void>`

Close database connection.

---

## ConsensusValidator

Validate predicted protein structures.

### Constructor

```typescript
new ConsensusValidator()
```

### Methods

#### `validate(structure: ProteinStructure): ValidationResult`

Validate protein structure.

**Parameters:**
- `structure`: Structure to validate

**Returns:** `ValidationResult` containing:
- `isValid`: Overall validity (boolean)
- `energy`: Estimated potential energy (kcal/mol)
- `clashes`: Number of atomic clashes
- `bondViolations`: Number of bond length violations
- `angleViolations`: Number of bond angle violations
- `errors`: Array of error messages
- `warnings`: Array of warning messages

**Example:**

```typescript
const validator = new ConsensusValidator();
const validation = validator.validate(structure);

if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
}

console.log(`Energy: ${validation.energy.toFixed(2)} kcal/mol`);
console.log(`Clashes: ${validation.clashes}`);
```

---

## VisualizationEngine

Export and visualize protein structures.

### Constructor

```typescript
new VisualizationEngine()
```

### Methods

#### `exportPDB(structure: ProteinStructure, filepath: string): Promise<void>`

Export structure to PDB format.

**Parameters:**
- `structure`: Structure to export
- `filepath`: Output PDB file path

**Example:**

```typescript
const visualizer = new VisualizationEngine();
await visualizer.exportPDB(structure, './output.pdb');
```

#### `exportWithConfidence(structure: ProteinStructure, filepath: string): Promise<void>`

Export structure with confidence encoded as B-factors.

**Parameters:**
- `structure`: Structure with per-residue confidence
- `filepath`: Output PDB file path

#### `generatePyMOLScript(pdbFile: string, scriptPath: string, options?: object): Promise<void>`

Generate PyMOL visualization script.

**Parameters:**
- `pdbFile`: Path to PDB file
- `scriptPath`: Output script path
- `options`:
  - `showConfidence`: Color by confidence (default: true)
  - `showBackbone`: Show backbone (default: false)
  - `showSurface`: Show surface (default: false)

**Example:**

```typescript
await visualizer.generatePyMOLScript(
  './output.pdb',
  './visualize.pml',
  { showConfidence: true, showBackbone: true }
);
```

#### `exportComparison(structure1: ProteinStructure, structure2: ProteinStructure, outputDir: string): Promise<void>`

Export comparison between two structures.

**Parameters:**
- `structure1`: First structure
- `structure2`: Second structure
- `outputDir`: Output directory

**Generates:**
- `structure1.pdb` and `structure2.pdb`
- `rmsd.txt`: Per-residue RMSD data
- `compare.pml`: PyMOL comparison script

#### `generateReport(structure: ProteinStructure, validation: ValidationResult, outputPath: string): Promise<void>`

Generate HTML visualization report.

**Parameters:**
- `structure`: Predicted structure
- `validation`: Validation results
- `outputPath`: Output HTML file path

---

## ProteinFoldingPipeline

Complete prediction pipeline.

### Constructor

```typescript
new ProteinFoldingPipeline(
  byzantineConfig?: Partial<ByzantineConfig>,
  agentConfigs?: PredictionAgentConfig[],
  learnerDbPath?: string
)
```

**Parameters:**
- `byzantineConfig`: Byzantine consensus configuration
- `agentConfigs`: Custom agent configurations
- `learnerDbPath`: Pattern database path

### Methods

#### `predict(fastaContent: string, outputDir?: string): Promise<object>`

Run complete prediction pipeline.

**Parameters:**
- `fastaContent`: FASTA format sequence
- `outputDir`: Output directory (default: "./output")

**Returns:** Object containing:
- `metrics`: `PerformanceMetrics`
  - `predictionTime`: Prediction time (ms)
  - `consensusTime`: Consensus time (ms)
  - `validationTime`: Validation time (ms)
  - `totalTime`: Total time (ms)
  - `numAgents`: Number of agents used
  - `sequenceLength`: Input sequence length
  - `byzantineDetected`: Number of Byzantine agents
- `pdbFile`: Path to generated PDB file

**Example:**

```typescript
const pipeline = new ProteinFoldingPipeline({
  numAgents: 7,
  faultTolerance: 2
});

const result = await pipeline.predict(fastaContent, './output');
console.log(`PDB: ${result.pdbFile}`);
console.log(`Time: ${result.metrics.totalTime}ms`);

await pipeline.close();
```

#### `close(): Promise<void>`

Close all resources.

---

## Type Definitions

### ProteinSequence

```typescript
interface ProteinSequence {
  id: string;
  sequence: string;
  organism?: string;
  function?: string;
  metadata?: Record<string, any>;
  chains?: Chain[];
}
```

### ProteinStructure

```typescript
interface ProteinStructure {
  sequenceId: string;
  atoms: Atom[];
  confidence: number;
  perResidueConfidence: number[];
  predictedBy: string;
  timestamp: number;
  energy?: number;
}
```

### Atom

```typescript
interface Atom {
  atomId: number;
  atomName: string;
  residueNumber: number;
  residueName: string;
  chainId: string;
  coordinate: Coordinate;
  bFactor?: number;
  occupancy?: number;
}
```

### Coordinate

```typescript
interface Coordinate {
  x: number;
  y: number;
  z: number;
}
```

---

## Error Handling

All async methods may throw errors. Wrap in try-catch:

```typescript
try {
  const result = await predictor.predict(sequence);
} catch (error) {
  console.error('Prediction failed:', error.message);
}
```

Common errors:

- `Invalid amino acid`: Sequence contains non-standard amino acids
- `Sequence too long`: Exceeds model maximum length
- `Insufficient votes`: Less than required for consensus
- `Timeout`: Prediction exceeded time limit

---

## Performance Tips

1. **Batch Processing**: Reuse pipeline for multiple sequences
2. **Agent Configuration**: Customize agents for your use case
3. **Database Cleanup**: Periodically prune old patterns
4. **Parallel Predictions**: Use multiple pipelines for throughput
5. **Caching**: Store results in learner database

---

## CLI Usage

```bash
# Predict from FASTA file
protein-folding predict input.fasta -o ./output

# Run benchmark
protein-folding benchmark -s 10,20,50,100

# Run example
protein-folding example insulin

# Custom parameters
protein-folding predict input.fasta \
  --num-agents 7 \
  --fault-tolerance 2 \
  --threshold 0.667 \
  --rmsd 2.0
```

---

For more examples, see the `/examples` directory.
