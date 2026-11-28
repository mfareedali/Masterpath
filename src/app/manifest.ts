import type { MetadataRoute } from 'next';
import { semantic } from '@/theme';

/** Web app manifest, served at /manifest.webmanifest (linked from the root layout). Icons: scripts/make-brand.ts (npm run icons). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'MastersPath',
    short_name: 'MastersPath',
    description:
      'Free, evidence-first guide for Pakistani students applying to Masters abroad. Every fact links to its official source.',
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: semantic.page,
    theme_color: semantic.chrome,
    categories: ['education'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
