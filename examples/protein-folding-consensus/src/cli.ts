#!/usr/bin/env node
/**
 * CLI tool for protein structure prediction with Byzantine consensus
 */

import { Command } from 'commander';
import { ProteinFoldingPipeline } from './index';
import * as fs from 'fs/promises';
import * as path from 'path';

const program = new Command();

program
  .name('protein-folding')
  .description('Predict protein structures with Byzantine consensus')
  .version('1.0.0');

program
  .command('predict')
  .description('Predict protein structure from FASTA file')
  .argument('<fasta-file>', 'Path to FASTA file')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-n, --num-agents <number>', 'Number of prediction agents', '7')
  .option('-f, --fault-tolerance <number>', 'Byzantine fault tolerance', '2')
  .option('-t, --threshold <number>', 'Consensus threshold (0-1)', '0.667')
  .option('-r, --rmsd <number>', 'RMSD threshold (Angstroms)', '2.0')
  .option('--timeout <ms>', 'Prediction timeout (ms)', '300000')
  .option('--db <path>', 'Pattern database path', './patterns.db')
  .action(async (fastaFile, options) => {
    try {
      console.log('=== Protein Folding Prediction ===\n');

      // Read FASTA file
      const fastaContent = await fs.readFile(fastaFile, 'utf-8');
      console.log(`Loaded FASTA: ${fastaFile}\n`);

      // Parse options
      const numAgents = parseInt(options.numAgents);
      const faultTolerance = parseInt(options.faultTolerance);
      const threshold = parseFloat(options.threshold);
      const rmsd = parseFloat(options.rmsd);
      const timeout = parseInt(options.timeout);

      // Validate Byzantine parameters
      if (numAgents < 3 * faultTolerance + 1) {
        console.error(`Error: num-agents (${numAgents}) must be >= 3 * fault-tolerance + 1 (${3 * faultTolerance + 1})`);
        process.exit(1);
      }

      // Create pipeline
      const pipeline = new ProteinFoldingPipeline(
        {
          numAgents,
          faultTolerance,
          consensusThreshold: threshold,
          rmsdThreshold: rmsd,
          timeout
        },
        undefined,
        options.db
      );

      // Run prediction
      const result = await pipeline.predict(fastaContent, options.output);

      console.log('\n=== Success! ===');
      console.log(`PDB file: ${result.pdbFile}`);
      console.log(`Report: ${options.output}/*_report.html`);
      console.log(`PyMOL script: ${options.output}/*_visualize.pml`);
      console.log('\nTo visualize:');
      console.log(`  pymol ${result.pdbFile}`);

      await pipeline.close();
      process.exit(0);
    } catch (error: any) {
      console.error('Prediction failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('benchmark')
  .description('Run performance benchmarks')
  .option('-s, --sequences <lengths>', 'Comma-separated sequence lengths', '10,20,50,100,200')
  .option('-o, --output <file>', 'Output file', './benchmark-results.json')
  .action(async (options) => {
    try {
      console.log('=== Protein Folding Benchmark ===\n');

      const lengths = options.sequences.split(',').map((s: string) => parseInt(s.trim()));
      const results: any[] = [];

      for (const length of lengths) {
        console.log(`Testing sequence length: ${length}...`);

        // Generate random sequence
        const aminoAcids = 'ACDEFGHIKLMNPQRSTVWY';
        const sequence = Array.from({ length }, () =>
          aminoAcids[Math.floor(Math.random() * aminoAcids.length)]
        ).join('');

        const fasta = `>benchmark_${length}\n${sequence}`;

        const pipeline = new ProteinFoldingPipeline();
        const startTime = Date.now();

        try {
          const result = await pipeline.predict(fasta, `./output/benchmark-${length}`);
          const totalTime = Date.now() - startTime;

          results.push({
            length,
            totalTime,
            metrics: result.metrics,
            throughput: length / (totalTime / 1000)
          });

          console.log(`  Completed in ${(totalTime / 1000).toFixed(2)}s`);
          console.log(`  Throughput: ${(length / (totalTime / 1000)).toFixed(2)} residues/sec\n`);

          await pipeline.close();
        } catch (error: any) {
          console.error(`  Failed: ${error.message}\n`);
          results.push({
            length,
            error: error.message
          });
        }
      }

      // Write results
      await fs.writeFile(options.output, JSON.stringify(results, null, 2));
      console.log(`Results written to: ${options.output}`);

      // Print summary
      console.log('\n=== Summary ===');
      const successful = results.filter(r => !r.error);
      if (successful.length > 0) {
        const avgThroughput = successful.reduce((sum, r) => sum + r.throughput, 0) / successful.length;
        console.log(`Average throughput: ${avgThroughput.toFixed(2)} residues/sec`);
        console.log(`Successful: ${successful.length}/${results.length}`);
      }

      process.exit(0);
    } catch (error: any) {
      console.error('Benchmark failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('example')
  .description('Run example prediction')
  .argument('<name>', 'Example name (insulin, antibody, byzantine)')
  .action(async (name) => {
    try {
      let exampleModule;

      switch (name.toLowerCase()) {
        case 'insulin':
          exampleModule = await import('../examples/insulin-prediction');
          break;
        case 'antibody':
          exampleModule = await import('../examples/antibody-prediction');
          break;
        case 'byzantine':
          exampleModule = await import('../examples/byzantine-fault-injection');
          break;
        default:
          console.error(`Unknown example: ${name}`);
          console.error('Available examples: insulin, antibody, byzantine');
          process.exit(1);
      }

      await exampleModule.main();
      process.exit(0);
    } catch (error: any) {
      console.error('Example failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate PDB structure')
  .argument('<pdb-file>', 'Path to PDB file')
  .action(async (pdbFile) => {
    try {
      console.log('=== Structure Validation ===\n');
      console.log('Note: This requires implementation of PDB parser');
      console.log('Use external tools like:');
      console.log('  - MolProbity: http://molprobity.biochem.duke.edu/');
      console.log('  - ProCheck: https://www.ebi.ac.uk/thornton-srv/software/PROCHECK/');
      console.log('  - WHATIF: https://swift.cmbi.umcn.nl/whatif/');
      process.exit(0);
    } catch (error: any) {
      console.error('Validation failed:', error.message);
      process.exit(1);
    }
  });

program.parse();
