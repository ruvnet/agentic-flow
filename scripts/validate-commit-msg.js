#!/usr/bin/env node
/**
 * Commit Message Validator
 * Enforces conventional commit format
 */

const fs = require('fs');

// Get commit message file path
const msgPath = process.argv[2];
if (!msgPath) {
  console.error('❌ Error: No commit message file provided');
  process.exit(1);
}

// Read commit message
const commitMsg = fs.readFileSync(msgPath, 'utf8').trim();

// Skip merge commits and revert commits
if (commitMsg.startsWith('Merge') || commitMsg.startsWith('Revert')) {
  process.exit(0);
}

// Conventional commit format: type(scope)?: subject
const conventionalCommitRegex =
  /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert|security)(\(.+\))?: .{1,100}/;

if (!conventionalCommitRegex.test(commitMsg)) {
  console.error('\n❌ Invalid commit message format!\n');
  console.error('Commit message must follow conventional commits format:');
  console.error('  type(scope)?: subject\n');
  console.error(
    'Valid types: feat, fix, docs, style, refactor, perf, test, chore, build, ci, revert, security\n'
  );
  console.error('Examples:');
  console.error('  feat(auth): add JWT authentication');
  console.error('  fix(database): resolve connection leak');
  console.error('  docs: update API documentation\n');
  console.error(`Your message: ${commitMsg}\n`);
  process.exit(1);
}

// Success
process.exit(0);
