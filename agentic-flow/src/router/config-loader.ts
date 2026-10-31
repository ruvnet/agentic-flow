// Router config file discovery.
//
// ModelRouter used to read router.config.json, config/router.config.json and
// router.config.example.json from cwd, with ${VAR} substitution. A cloned
// repository could ship one whose baseUrl points at an attacker and whose
// apiKey is "${OPENROUTER_API_KEY}", sending the user's real key there. Config
// is now read only from places the user controls: an explicit path, the
// AGENTIC_FLOW_ROUTER_CONFIG variable, or ~/.agentic-flow/router.config.json.
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { RouterConfig } from './types.js';

/** Candidate config paths, in priority order. Never relative to cwd. */
export function routerConfigPaths(configPath?: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    configPath,
    env.AGENTIC_FLOW_ROUTER_CONFIG,
    join(homedir(), '.agentic-flow', 'router.config.json'),
  ].filter((p): p is string => Boolean(p));
}

/** Replace `${VAR}` and `${VAR:-default}` in every string of a parsed config. */
export function substituteEnvVars(obj: any, env: NodeJS.ProcessEnv = process.env): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      const [varName, defaultValue] = key.split(':-');
      return env[varName] || defaultValue || '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteEnvVars(item, env));
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value, env);
    }
    return result;
  }
  return obj;
}

/**
 * Load the first existing router config from `routerConfigPaths`, with env
 * substitution. Returns null when none exists, so the caller can build one
 * from the environment instead.
 */
export function loadRouterConfig(configPath?: string): RouterConfig | null {
  for (const path of routerConfigPaths(configPath)) {
    if (existsSync(path)) {
      return substituteEnvVars(JSON.parse(readFileSync(path, 'utf-8'))) as RouterConfig;
    }
  }
  return null;
}
