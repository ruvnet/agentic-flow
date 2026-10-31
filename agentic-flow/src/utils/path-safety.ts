// Path validation for tool and CLI inputs that become filesystem paths.
//
// Agent/command names and categories arrive from MCP callers and are joined
// under .claude/; file paths for the booster edit tools arrive the same way.
// Every such value is validated here, and the final path must stay inside its
// base directory.
import { existsSync, realpathSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';

const SEGMENT = /^[a-z0-9-]+$/;

/** A single name segment: lowercase letters, digits and hyphens. */
export function assertSlug(value: string, label = 'name'): string {
  if (typeof value !== 'string' || !SEGMENT.test(value)) {
    throw new Error(`Invalid ${label} '${value}': use lowercase letters, digits and hyphens only`);
  }
  return value;
}

/** Normalise a free-form agent name (lowercase, spaces to hyphens), then validate it. */
export function toAgentSlug(name: string): string {
  return assertSlug(String(name ?? '').trim().toLowerCase().replace(/\s+/g, '-'), 'agent name');
}

/** A category: slug segments joined by '/', e.g. `custom` or `team/backend`. */
export function assertCategoryPath(category: string): string[] {
  if (typeof category !== 'string' || category.length === 0) {
    throw new Error('Category is required');
  }
  return category.split('/').map((segment) => assertSlug(segment, `category segment in '${category}'`));
}

function isWithin(base: string, target: string): boolean {
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

/** Join segments under `base` and throw if the result escapes it. */
export function resolveWithin(base: string, ...segments: string[]): string {
  const root = resolve(base);
  const target = resolve(root, ...segments);
  if (!isWithin(root, target)) {
    throw new Error(`Path escapes ${root}: ${target}`);
  }
  return target;
}

/** `<cwd>/.claude/agents/<category...>`, with the category validated. */
export function resolveAgentDir(category: string, cwd: string = process.cwd()): string {
  return resolveWithin(join(cwd, '.claude', 'agents'), ...assertCategoryPath(category));
}

/** Resolve symlinks on the longest existing prefix of `target`. */
function realpathOfExistingPrefix(target: string): string {
  let existing = target;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

/**
 * Resolve a caller-supplied file path and require it to stay inside `cwd`,
 * after following symlinks. Throws on anything that escapes.
 */
export function resolveInsideCwd(filePath: string, cwd: string = process.cwd()): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required and must be a string');
  }
  if (filePath.length > 4096) {
    throw new Error('File path too long (max 4096 characters)');
  }
  if (filePath.includes('\0')) {
    throw new Error('File path contains a NUL byte');
  }
  const root = realpathSync(resolve(cwd));
  const target = resolve(root, filePath);
  if (!isWithin(root, target) || !isWithin(root, realpathOfExistingPrefix(target))) {
    throw new Error(`Path is outside the working directory (${root}): ${filePath}`);
  }
  return target;
}
