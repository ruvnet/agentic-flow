import { describe, it, expect, beforeEach } from 'vitest';
import { CodeQualityAnalyzer } from '../src/CodeQualityAnalyzer.js';

describe('CodeQualityAnalyzer', () => {
  let analyzer: CodeQualityAnalyzer;

  beforeEach(() => {
    analyzer = new CodeQualityAnalyzer();
  });

  describe('analyzeCode', () => {
    it('should analyze TypeScript code', async () => {
      const code = `
export function add(a: number, b: number): number {
  return a + b;
}
      `.trim();

      const metrics = await analyzer.analyzeCode(code, 'typescript');

      expect(metrics.syntaxValid).toBe(true);
      expect(metrics.complexity).toBeGreaterThan(0);
      expect(metrics.maintainability).toBeGreaterThan(0);
      expect(metrics.maintainability).toBeLessThanOrEqual(100);
      expect(metrics.securityScore).toBeGreaterThan(0);
      expect(metrics.bestPractices).toBeGreaterThan(0);
    });

    it('should detect syntax errors', async () => {
      const code = `
function broken(a, b {
  return a + b;
}
      `.trim();

      const metrics = await analyzer.analyzeCode(code, 'typescript');

      expect(metrics.syntaxValid).toBe(false);
    });

    it('should calculate complexity correctly', async () => {
      const simpleCode = 'function simple() { return 1; }';
      const complexCode = `
function complex(x) {
  if (x > 0) {
    for (let i = 0; i < x; i++) {
      if (i % 2 === 0 && i > 5) {
        console.log(i);
      } else {
        continue;
      }
    }
  } else {
    return 0;
  }
  return x;
}
      `.trim();

      const simpleMetrics = await analyzer.analyzeCode(simpleCode, 'javascript');
      const complexMetrics = await analyzer.analyzeCode(complexCode, 'javascript');

      expect(complexMetrics.complexity).toBeGreaterThan(simpleMetrics.complexity);
    });

    it('should penalize high complexity', async () => {
      const highComplexityCode = `
function tooComplex(x) {
  if (x) { if (x) { if (x) { if (x) { if (x) {
    return x;
  }}}}}
}
      `.trim();

      const metrics = await analyzer.analyzeCode(highComplexityCode, 'javascript');

      expect(metrics.complexity).toBeGreaterThan(10);
      expect(metrics.maintainability).toBeLessThan(80);
    });
  });

  describe('security analysis', () => {
    it('should detect eval usage', async () => {
      const code = `
function unsafe(input) {
  return eval(input);
}
      `.trim();

      const metrics = await analyzer.analyzeCode(code, 'javascript');

      expect(metrics.securityScore).toBeLessThan(0.9);
    });

    it('should detect hardcoded credentials', async () => {
      const code = `
const password = "secret123";
const api_key = "abc123xyz";
      `.trim();

      const metrics = await analyzer.analyzeCode(code, 'javascript');

      expect(metrics.securityScore).toBeLessThan(0.5);
    });

    it('should give good score to secure code', async () => {
      const code = `
export function secureFunction(data: string): string {
  return data.trim();
}
      `.trim();

      const metrics = await analyzer.analyzeCode(code, 'typescript');

      expect(metrics.securityScore).toBeGreaterThan(0.8);
    });
  });

  describe('best practices', () => {
    it('should reward modern JavaScript', async () => {
      const modernCode = `
const add = (a, b) => a + b;
export { add };
      `.trim();

      const legacyCode = `
var add = function(a, b) {
  return a + b;
};
      `.trim();

      const modernMetrics = await analyzer.analyzeCode(modernCode, 'javascript');
      const legacyMetrics = await analyzer.analyzeCode(legacyCode, 'javascript');

      expect(modernMetrics.bestPractices).toBeGreaterThan(legacyMetrics.bestPractices);
    });

    it('should reward TypeScript type annotations', async () => {
      const typedCode = `
function add(a: number, b: number): number {
  return a + b;
}
      `.trim();

      const untypedCode = `
function add(a, b) {
  return a + b;
}
      `.trim();

      const typedMetrics = await analyzer.analyzeCode(typedCode, 'typescript');
      const untypedMetrics = await analyzer.analyzeCode(untypedCode, 'javascript');

      expect(typedMetrics.bestPractices).toBeGreaterThan(untypedMetrics.bestPractices);
    });

    it('should reward Python docstrings', async () => {
      const documentedCode = `
def add(a, b):
    """Add two numbers together."""
    return a + b
      `.trim();

      const undocumentedCode = `
def add(a, b):
    return a + b
      `.trim();

      const docMetrics = await analyzer.analyzeCode(documentedCode, 'python');
      const noDocMetrics = await analyzer.analyzeCode(undocumentedCode, 'python');

      expect(docMetrics.bestPractices).toBeGreaterThan(noDocMetrics.bestPractices);
    });
  });

  describe('estimateTestCoverage', () => {
    it('should estimate test coverage', async () => {
      const code = `
function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function multiply(a, b) { return a * b; }
      `.trim();

      const testCode = `
test('add', () => {
  expect(add(1, 2)).toBe(3);
});

test('subtract', () => {
  expect(subtract(2, 1)).toBe(1);
});
      `.trim();

      const coverage = await analyzer.estimateTestCoverage(code, testCode);

      expect(coverage).toBeGreaterThan(0);
      expect(coverage).toBeLessThanOrEqual(1);
      // 2 out of 3 functions tested = 0.67
      expect(coverage).toBeCloseTo(0.67, 1);
    });

    it('should return 0 for no tests', async () => {
      const code = 'function add(a, b) { return a + b; }';
      const testCode = '';

      const coverage = await analyzer.estimateTestCoverage(code, testCode);

      expect(coverage).toBe(0);
    });
  });

  describe('language-specific analysis', () => {
    it('should analyze Python code', async () => {
      const code = `
def process(items: list) -> list:
    """Process items."""
    return [item * 2 for item in items]
      `.trim();

      const metrics = await analyzer.analyzeCode(code, 'python');

      expect(metrics.syntaxValid).toBe(true);
      expect(metrics.bestPractices).toBeGreaterThan(0.5);
    });

    it('should analyze Rust code', async () => {
      const code = `
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
      `.trim();

      const metrics = await analyzer.analyzeCode(code, 'rust');

      expect(metrics.syntaxValid).toBe(true);
      expect(metrics.bestPractices).toBeGreaterThan(0.5);
    });
  });
});
