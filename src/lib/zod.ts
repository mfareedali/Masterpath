/**
 * The project's single zod entry point. Import `z` from here, never from 'zod' directly.
 *
 * jitless: zod 4 probes `new Function('')` to decide whether to compile parsers. Our Content Security Policy
 * blocks eval, so in the browser that probe logs a CSP violation (a Lighthouse best-practices issue). Jitless
 * mode skips the probe and the compiled parsers; the cost is negligible for our small schemas.
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
