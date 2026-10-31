/**
 * Loader for the optional @ruvector/sona native engine.
 *
 * @ruvector/sona is an optionalDependency, so importing the SONA services must
 * not fail when it is absent. Constructing an engine without it throws a
 * SonaUnavailableError that says how to install it.
 */

let sonaEngineClass: any = null;
let loadError: unknown = null;

try {
  ({ SonaEngine: sonaEngineClass } = await import('@ruvector/sona'));
} catch (error) {
  loadError = error;
}

export class SonaUnavailableError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      '@ruvector/sona is not available, so SONA features are disabled. ' +
        'It is an optional dependency; install it with `npm install @ruvector/sona`. ' +
        `(load error: ${detail})`
    );
    this.name = 'SonaUnavailableError';
  }
}

export function isSonaAvailable(): boolean {
  return sonaEngineClass !== null;
}

/** The SonaEngine class, or a SonaUnavailableError if it could not be loaded. */
export function requireSonaEngine(): any {
  if (!sonaEngineClass) {
    throw new SonaUnavailableError(loadError ?? 'module did not export SonaEngine');
  }
  return sonaEngineClass;
}
