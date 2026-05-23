export default {
  // Use a function for JS/TS files to exclude dot-directories where ESLint
  // emits a "File ignored by default" warning that breaks --max-warnings 0
  '*.{js,jsx,ts,tsx}'(files) {
    const filteredFiles = files.filter(f => !f.includes('/.claude/') && !f.includes('/.husky/'));
    if (filteredFiles.length === 0) return [];
    return [`eslint --fix --max-warnings 0 ${filteredFiles.join(' ')}`];
  },
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
