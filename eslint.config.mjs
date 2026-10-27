import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', '.next-stack/**', 'node_modules/**', 'next-env.d.ts', 'modules/**', 'playwright-report/**', 'test-results/**']),
]);
