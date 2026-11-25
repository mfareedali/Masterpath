import type { NextConfig } from 'next';
// Relative import and a dependency-free module on purpose: next.config.ts is loaded outside the app bundler.
import { buildCsp } from './src/lib/csp';

/**
 * Security headers. The Content Security Policy lives in src/lib/csp.ts (unit-tested): it only adds
 * 'upgrade-insecure-requests' on an HTTPS deployment (Vercel, or CSP_UPGRADE_INSECURE=1 at build time), so the
 * plain-HTTP laptop fallback in docs/DEMO.md still loads its CSS and JavaScript.
 * Built inside headers() so the environment is read when Next asks for the headers (at build time).
 */
function securityHeaders() {
  return [
    { key: 'Content-Security-Policy', value: buildCsp(process.env) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Browsers ignore HSTS on plain-HTTP responses, so this is harmless for the laptop fallback.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  ];
}

const nextConfig: NextConfig = {
  // Cache Components is off on purpose (DECISIONS.md #3): classic ISR/dynamic rendering, fewer framework surprises.
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders() },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;
