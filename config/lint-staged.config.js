export default {
  '*.{js,jsx,tsx}': ['eslint --fix --max-warnings 0'],
  '*.ts': (filenames) => {
    const nonDeclaration = filenames.filter((f) => !f.endsWith('.d.ts'));
    if (nonDeclaration.length === 0) return [];
    return [`eslint --fix --max-warnings 0 ${nonDeclaration.map((f) => `"${f}"`).join(' ')}`];
  },
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
