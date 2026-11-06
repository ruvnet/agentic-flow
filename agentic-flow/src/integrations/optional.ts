/**
 * Optional ecosystem packages — one place to load them.
 *
 * Every package loaded here is an `optionalDependency` of agentic-flow: npm
 * installs it by default, but it may be missing (`--omit=optional`, an
 * unsupported platform, a failed native build). Callers therefore always get
 * either the module or `null`, never a throw, and keep a built-in fallback.
 *
 * Two loaders:
 * - `requireOptional` is synchronous (createRequire) for CommonJS packages that
 *   must be usable from synchronous code paths (e.g. input validation).
 * - `importOptional` is asynchronous for ESM packages.
 *
 * Results (including "not installed") are cached per specifier.
 */

import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

type CacheEntry = { mod: any | null; error?: string };
const syncCache = new Map<string, CacheEntry>();
const asyncCache = new Map<string, Promise<CacheEntry>>();

/** Synchronously load a CommonJS optional package, or return null. */
export function requireOptional<T = any>(specifier: string): T | null {
  const cached = syncCache.get(specifier);
  if (cached) return cached.mod as T | null;
  let entry: CacheEntry;
  try {
    entry = { mod: nodeRequire(specifier) };
  } catch (err: any) {
    entry = { mod: null, error: err?.message ?? String(err) };
  }
  syncCache.set(specifier, entry);
  return entry.mod as T | null;
}

/**
 * Whether a package is installed, without loading it. ESM-only packages whose
 * exports map has no require/default condition cannot be require.resolve()d,
 * but that error itself proves the package is there.
 */
export function isOptionalInstalled(specifier: string): boolean {
  try {
    nodeRequire.resolve(specifier);
    return true;
  } catch (err: any) {
    return err?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  }
}

/** Asynchronously import an optional package (ESM or CJS), or return null. */
export async function importOptional<T = any>(specifier: string): Promise<T | null> {
  let pending = asyncCache.get(specifier);
  if (!pending) {
    pending = (async (): Promise<CacheEntry> => {
      try {
        return { mod: await import(specifier) };
      } catch (err: any) {
        return { mod: null, error: err?.message ?? String(err) };
      }
    })();
    asyncCache.set(specifier, pending);
  }
  return (await pending).mod as T | null;
}

/** Why the last load of `specifier` failed, if it did. */
export function optionalLoadError(specifier: string): string | undefined {
  return syncCache.get(specifier)?.error;
}

/** Resolve a package's entry file without loading it, or null if absent. */
export function resolveOptional(specifier: string): string | null {
  try {
    return nodeRequire.resolve(specifier);
  } catch {
    return null;
  }
}

/** Test hook: forget cached load results. */
export function _resetOptionalCache(): void {
  syncCache.clear();
  asyncCache.clear();
}
