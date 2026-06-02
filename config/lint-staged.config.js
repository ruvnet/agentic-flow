export default {
  '*.{js,jsx,ts,tsx}': (filenames) => {
    const files = filenames.filter((f) => !f.endsWith('.d.ts') && !f.endsWith('vite.config.ts'));
    if (!files.length) return [];
    return [`eslint --fix --max-warnings 0 ${files.join(' ')}`];
  },
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
