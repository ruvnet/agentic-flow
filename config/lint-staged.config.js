export default {
  // Use a function for JS/TS files to exclude:
  // - dot-directories (.claude/, .husky/) — ESLint warns "File ignored by default"
  // - declaration files (.d.ts) — covered by ignorePatterns in .eslintrc.json
  '*.{js,jsx,ts,tsx}'(files) {
    const filteredFiles = files.filter(
      f =>
        !f.includes('/.claude/') &&
        !f.includes('/.husky/') &&
        !f.endsWith('.d.ts'),
    );
    if (filteredFiles.length === 0) return [];
    return [`eslint --fix --max-warnings 0 ${filteredFiles.join(' ')}`];
  },
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
