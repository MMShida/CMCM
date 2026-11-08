import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // This worktree shares node_modules with older checkouts. Separate Vite's
  // optimized dependency cache so concurrent dev servers cannot mix React copies.
  cacheDir: '.vite-cache',
  resolve: { dedupe: ['react', 'react-dom'] },
  base: './',
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
} as any);
