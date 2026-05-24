import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

// Check if building background script separately
const buildBackground = process.env.BUILD_BACKGROUND === 'true';

export default defineConfig({
  plugins: [react() as any],
  base: './', // Use relative paths
  build: {
    outDir: 'dist',
    // Don't empty dist when building background separately
    emptyOutDir: !buildBackground,
    sourcemap: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: buildBackground 
        ? { background: resolve(__dirname, 'src/background.ts') }
        : { popup: resolve(__dirname, 'src/popup.tsx') },
      output: {
        // Inline all imports for background script
        inlineDynamicImports: buildBackground,
        entryFileNames: buildBackground ? '[name].js' : '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    },
    target: 'chrome112',
    minify: false,
    watch: process.env.NODE_ENV === 'development' ? {
      include: 'src/**'
    } : null
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**'],
    // Increase timeout for property-based tests (100+ iterations)
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        '**/arbitraries.ts',
        '**/testUtils.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
