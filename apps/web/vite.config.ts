import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const dashboardPort = Number.parseInt(
    env.DASHBOARD_PORT || env.VITE_DASHBOARD_PORT || process.env.DASHBOARD_PORT || '5173',
    10,
  );
  const apiProxy =
    env.VITE_API_PROXY ||
    process.env.VITE_API_PROXY ||
    process.env.CORE_API_BASE_URL ||
    'http://127.0.0.1:3000';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: Number.isFinite(dashboardPort) ? dashboardPort : 5173,
      host: true,
      proxy: {
        '/api': {
          target: apiProxy,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: Number.isFinite(dashboardPort) ? dashboardPort : 5173,
      host: true,
      proxy: {
        '/api': {
          target: apiProxy,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
  };
});
