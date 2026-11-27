/**
 * Side-effect import: `import './load-env';` as the FIRST import of a script, so .env.local is loaded before any
 * module that reads process.env at import time (for example the scraper's User-Agent). Prints nothing.
 */
import { loadLocalEnv } from '../src/lib/env/load-local-env';

loadLocalEnv();
