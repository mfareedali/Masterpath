import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Product rule 9: never render data or scraped text as HTML.
    name: "masterspath/no-raw-html",
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "react/no-danger": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Never render data as HTML (product rule 9). Render text, and build links with safeHref() / SourceLink.",
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: "Never write HTML strings into the DOM (product rule 9). Set textContent instead.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Never write HTML strings into the DOM (product rule 9).",
        },
        {
          selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
          message: "document.write is not allowed.",
        },
      ],
    },
  },
  {
    // zod must be imported from @/lib/zod (jitless mode: no eval probe under our CSP).
    name: "masterspath/zod-entry",
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/zod.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "zod", message: "Import { z } from '@/lib/zod' (jitless, CSP-safe)." }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated or third-party output:
    "coverage/**",
    ".lighthouseci/**",
    // Plain service-worker script (no build step, browser/worker globals); covered by scripts/sw.test.ts.
    "public/sw.js",
  ]),
]);

export default eslintConfig;
