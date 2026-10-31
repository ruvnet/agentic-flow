// Side-effect import: load cwd/.env (or --env-file <path>) before any other
// module reads process.env. Import it first. See env-loader.ts for the rules.
import { loadCliEnv } from './env-loader.js';

loadCliEnv();
