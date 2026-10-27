import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const privateHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Hides the development-only issue badge. Errors still appear in the browser
  // console and the terminal; production builds never include the indicator.
  devIndicators: false,
  // Lets the full-stack test build (playwright.stack.config.ts) use its own output directory.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
  // Application modules live outside /public and are read at request time by
  // the protected routes, so they must be traced into those functions.
  // modules/*/source (original supplied files) is deliberately not included.
  outputFileTracingIncludes: {
    '/access/[id]/app/content': ['./modules/*/index.html'],
    '/access/[id]/app': ['./modules/*/index.html'],
    '/teacher/**': ['./modules/*/index.html'],
    '/api/teacher/**': ['./modules/*/index.html'],
  },
  async redirects() {
    return [
      { source: '/admin', destination: '/teacher/dashboard', permanent: false },
      { source: '/admin/:path*', destination: '/teacher/:path*', permanent: false },
      // Links shared before access management was renamed keep working.
      { source: '/classroom/:id/simulation', destination: '/access/:id/app', permanent: false },
      { source: '/classroom/:id', destination: '/access/:id', permanent: false },
      { source: '/teacher/classes', destination: '/teacher/access', permanent: false },
      { source: '/teacher/classes/:path*', destination: '/teacher/access/:path*', permanent: false },
      { source: '/teacher/simulations', destination: '/teacher/applications', permanent: false },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/(teacher|student|access)/:path*', headers: privateHeaders },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }] },
    ];
  },
};

export default nextConfig;
