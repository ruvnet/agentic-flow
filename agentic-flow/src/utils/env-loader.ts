// .env loading for the CLI.
//
// The CLI used to walk up from cwd and load the first .env it found. A cloned
// repository can ship a .env, and one that sets OPENROUTER_BASE_URL (or any
// other endpoint) sends the user's real API key to whoever wrote it. So:
//   - only cwd/.env is read, never a parent directory's;
//   - keys that redirect traffic (*_BASE_URL, *_PROXY_*, HTTP(S)_PROXY) are
//     ignored when they come from that implicit file;
//   - `--env-file <path>` names a file the user chose, and is loaded whole.
// Values already in the process environment always win.
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

const REDIRECT_KEY_PATTERNS = [/_BASE_URL$/i, /_PROXY_/i, /^(HTTPS?|ALL)_PROXY$/i];

/** True for keys that change where requests (and their API keys) are sent. */
export function isRedirectKey(key: string): boolean {
  return REDIRECT_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** Value of `--env-file <path>` or `--env-file=<path>`, if present. */
export function explicitEnvFile(argv: string[] = process.argv.slice(2)): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env-file' && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith('--env-file=')) return argv[i].slice('--env-file='.length);
  }
  return undefined;
}

export interface EnvLoadResult {
  path?: string;
  loaded: string[];
  /** Redirect keys present in an implicit .env and deliberately not applied. */
  ignored: string[];
}

/**
 * Load environment for a CLI run. Returns what was applied and what was
 * skipped, and warns on stderr when redirect keys were skipped.
 */
export function loadCliEnv(
  options: { cwd?: string; argv?: string[]; env?: NodeJS.ProcessEnv } = {},
): EnvLoadResult {
  const env = options.env ?? process.env;
  const explicit = explicitEnvFile(options.argv);
  const path = explicit
    ? pathResolve(options.cwd ?? process.cwd(), explicit)
    : pathResolve(options.cwd ?? process.cwd(), '.env');

  if (!existsSync(path)) {
    if (explicit) console.error(`⚠️  --env-file ${explicit}: file not found`);
    return { loaded: [], ignored: [] };
  }

  const parsed = dotenv.parse(readFileSync(path));
  const loaded: string[] = [];
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue;
    if (!explicit && isRedirectKey(key)) {
      ignored.push(key);
      continue;
    }
    env[key] = value;
    loaded.push(key);
  }

  if (ignored.length > 0) {
    console.error(
      `⚠️  Ignoring ${ignored.join(', ')} from ${path}: endpoint overrides are not read from an ` +
        'implicit .env. Export them, or pass --env-file <path> to trust that file.',
    );
  }
  return { path, loaded, ignored };
}
