import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true, // Enable sourcemaps for debugging
    assetsDir: 'assets', // Keep assets in their own directory
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup.tsx'),
        background: resolve(__dirname, 'src/background.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    },
    target: 'chrome112', // Target modern Chrome
    minify: false,
    watch: process.env.NODE_ENV === 'development' ? {
      include: 'src/**'
    } : null
  }
});
