import { readFileSync } from 'fs';
const msg = readFileSync(process.argv[2] || '.git/COMMIT_EDITMSG', 'utf8').trim();
const pattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .{1,100}/;
if (!pattern.test(msg.split('\n')[0])) {
  console.error('Commit message must follow Conventional Commits format.');
  process.exit(1);
}
process.exit(0);
