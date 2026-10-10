/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Tauri: keep Rust errors visible, use a fixed port, and leave src-tauri to cargo.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    testTimeout: 60000,
    // The ffmpeg and ffprobe the app ships, from scripts/fetch-ffmpeg.sh, come first on PATH.
    env: { PATH: `${fileURLToPath(new URL('./src-tauri/binaries/bin', import.meta.url))}:${process.env.PATH}` },
  },
}));
