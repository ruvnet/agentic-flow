#!/usr/bin/env node
/**
 * Agent Booster CLI
 *
 * npx agent-booster apply <file> <edit>
 */

import { execFileSync } from 'child_process';
import { AgentBooster } from './index';
import * as fs from 'fs';
import * as path from 'path';

const USAGE = `
Agent Booster - Ultra-fast code editing (52x faster than Morph LLM)

USAGE:
  npx agent-booster apply <file> <edit> [options]
  npx agent-booster benchmark [options]

COMMANDS:
  apply <file> <edit>    Apply an edit to a file
  benchmark             Run performance benchmarks

OPTIONS:
  --language <lang>     Programming language (default: auto-detect)
  --confidence <num>    Minimum confidence threshold (default: 0.5)
  --output <file>       Output file (default: overwrite input)
  --dry-run            Show changes without writing

EXAMPLES:
  # Add type annotations to a function
  npx agent-booster apply src/utils.js "add TypeScript types"

  # Convert var to const/let
  npx agent-booster apply src/old.js "convert var to const/let"

  # Run benchmarks
  npx agent-booster benchmark

PERFORMANCE:
  Average latency: 7ms (vs Morph LLM: 352ms)
  Cost: $0.00 (vs Morph LLM: $0.01/edit)
  Speedup: 52x faster
`;

interface CliArgs {
  command: string;
  file?: string;
  edit?: string;
  language?: string;
  confidence?: number;
  output?: string;
  dryRun?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {
    command: args[0] || 'help',
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--language' && args[i + 1]) {
      parsed.language = args[++i];
    } else if (arg === '--confidence' && args[i + 1]) {
      parsed.confidence = parseFloat(args[++i]);
    } else if (arg === '--output' && args[i + 1]) {
      parsed.output = args[++i];
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (!parsed.file) {
      parsed.file = arg;
    } else if (!parsed.edit) {
      parsed.edit = arg;
    }
  }

  return parsed;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: { [key: string]: string } = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
  };

  return langMap[ext] || 'javascript';
}

async function applyCommand(args: CliArgs) {
  // Check for help flags FIRST (before stdin mode)
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  // Check if stdin has data (JSON mode for MCP)
  // Only use stdin mode if no file argument is provided
  if (!process.stdin.isTTY && !args.file) {
    return applyJsonStdin(args);
  }

  if (!args.file) {
    console.error('Error: File path required');
    console.log(USAGE);
    process.exit(1);
  }

  if (!args.edit) {
    console.error('Error: Edit instruction required');
    console.log(USAGE);
    process.exit(1);
  }

  // Read file
  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, 'utf-8');
  const language = args.language || detectLanguage(filePath);

  console.log(`\n📝 File: ${filePath}`);
  console.log(`🔤 Language: ${language}`);
  console.log(`✏️  Edit: ${args.edit}\n`);

  // Apply edit
  const booster = new AgentBooster({
    confidenceThreshold: args.confidence || 0.5,
  });

  const startTime = Date.now();
  const result = await booster.apply({
    code: code,
    edit: args.edit,
    language: language,
  });
  const elapsed = Date.now() - startTime;

  // Show results
  console.log(`✅ Success! (${elapsed}ms)`);
  console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`🔧 Strategy: ${result.strategy}`);

  if (args.dryRun) {
    console.log(`\n📄 Modified code:\n`);
    console.log(result.output);
  } else {
    const outputPath = args.output || filePath;
    fs.writeFileSync(outputPath, result.output, 'utf-8');
    console.log(`\n💾 Saved to: ${outputPath}`);
  }
}

async function applyJsonStdin(args: CliArgs): Promise<void> {
  return new Promise((_resolve, _reject) => {
    let input = '';

    process.stdin.on('data', (chunk) => {
      input += chunk;
    });

    process.stdin.on('end', async () => {
      try {
        const { code, edit } = JSON.parse(input);

        if (!code || !edit) {
          console.log(JSON.stringify({
            success: false,
            error: 'Missing required fields: code and edit'
          }));
          process.exit(1);
        }

        const booster = new AgentBooster({
          confidenceThreshold: args.confidence || 0.5,
        });

        const result = await booster.apply({
          code,
          edit,
          language: args.language || 'javascript'
        });

        // Output JSON result
        console.log(JSON.stringify(result));
        process.exit(result.success ? 0 : 1);
      } catch (error: unknown) {
        console.log(JSON.stringify({
          success: false,
          error: (error as Error).message
        }));
        process.exit(1);
      }
    });
  });
}

async function benchmarkCommand() {
  console.log('\n🚀 Running Agent Booster benchmarks...\n');

  const benchmarkScript = path.join(__dirname, '../benchmarks/run-real-benchmark.js');

  if (!fs.existsSync(benchmarkScript)) {
    console.error('Error: Benchmark script not found');
    console.log('Run: npm test');
    process.exit(1);
  }

  // Run benchmark script (use execFileSync with arg array to prevent shell injection)
  execFileSync(process.execPath, [benchmarkScript], { stdio: 'inherit' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    switch (args.command) {
      case 'apply':
        await applyCommand(args);
        break;

      case 'benchmark':
        await benchmarkCommand();
        break;

      case 'help':
      case '--help':
      case '-h':
        console.log(USAGE);
        break;

      default:
        console.error(`Unknown command: ${args.command}`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (error: unknown) {
    console.error(`\n❌ Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Run CLI
if (require.main === module) {
  main();
}
