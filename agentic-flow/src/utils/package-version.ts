// The installed agentic-flow version, for commands we write or print.
//
// Generated hooks, statuslines and help text run `npx agentic-flow@<this>`,
// never a dist-tag: @alpha still resolves to the deprecated March 3.0.0-alpha
// line, and @latest changes under an installed project without notice.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const VERSION_RE = /^\d+\.\d+\.\d+[\w.+-]*$/;
let cached: string | undefined;

/**
 * Version from this package's package.json, found by walking up from this
 * file (src/utils under tsx, dist/utils when built). Throws if it is missing,
 * which only happens in a broken install, rather than falling back to a tag.
 */
export function readPackageVersion(): string {
  if (cached) return cached;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (pkg.name === 'agentic-flow' && typeof pkg.version === 'string' && VERSION_RE.test(pkg.version)) {
        cached = pkg.version as string;
        return cached;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('agentic-flow: cannot find its own package.json to pin the version');
    dir = parent;
  }
}

/** `agentic-flow@<installed version>`, for npx commands. */
export function packageSpec(): string {
  return `agentic-flow@${readPackageVersion()}`;
}
