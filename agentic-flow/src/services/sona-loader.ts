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

/**
 * Validate LoRA inputs before they reach the native engine.
 *
 * @ruvector/sona (checked through 0.1.10) asserts in Rust that the vector given
 * to applyMicroLora / applyBaseLora has exactly hiddenDim entries; a mismatch
 * panics across the NAPI boundary and aborts the whole Node process. Every
 * engine handed out by this loader throws a catchable RangeError instead.
 */
export function guardSonaEngine<T extends object>(engine: T, hiddenDim: number): T {
  const e = engine as any;
  if (!e || !Number.isInteger(hiddenDim) || hiddenDim <= 0) return engine;
  const check = (method: string, input: unknown) => {
    if (!Array.isArray(input) && !ArrayBuffer.isView(input)) {
      throw new TypeError(`SonaEngine.${method}: input must be an array of numbers`);
    }
    const length = (input as ArrayLike<number>).length;
    if (length !== hiddenDim) {
      throw new RangeError(`SonaEngine.${method}: input has ${length} values, the engine's hiddenDim is ${hiddenDim}`);
    }
  };
  for (const method of ['applyMicroLora', 'applyBaseLora'] as const) {
    const original = e[method];
    if (typeof original !== 'function') continue;
    const inputAt = method === 'applyBaseLora' ? 1 : 0;
    Object.defineProperty(e, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        check(method, args[inputAt]);
        return original.apply(e, args);
      },
    });
  }
  return engine;
}

let guardedClass: any = null;

function guardedSonaEngineClass(Native: any): any {
  const Guarded: any = function SonaEngine(hiddenDim: number) {
    return guardSonaEngine(new Native(hiddenDim), hiddenDim);
  };
  Guarded.withConfig = (config: { hiddenDim: number }) =>
    guardSonaEngine(Native.withConfig(config), config?.hiddenDim);
  Guarded.native = Native;
  return Guarded;
}

/**
 * The SonaEngine class (instances validated by guardSonaEngine), or a
 * SonaUnavailableError if it could not be loaded.
 */
export function requireSonaEngine(): any {
  if (!sonaEngineClass) {
    throw new SonaUnavailableError(loadError ?? 'module did not export SonaEngine');
  }
  guardedClass ??= guardedSonaEngineClass(sonaEngineClass);
  return guardedClass;
}
