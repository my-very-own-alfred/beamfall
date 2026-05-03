import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  // Tauri expects a fixed port; fail if not available.
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 1421,
    },
    watch: {
      // tell vite to ignore watching src-tauri
      ignored: ['**/src-tauri/**'],
    },
  },
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // env variables prefixed with VITE_ are exposed to the client; TAURI_ prefix is
  // forwarded by the tauri CLI so we keep it intact.
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2022', 'chrome105', 'safari15'],
    minify: 'esbuild',
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['@tauri-apps/api'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
}));
