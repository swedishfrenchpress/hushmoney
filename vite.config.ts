import { getRequestListener } from '@hono/node-server';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// In dev the API runs inside Vite: one process, one port, and editing a
// server file reloads it on the next request.
export default defineConfig({
  plugins: [
    {
      // ggwave's Emscripten build reaches for Node's fs and path only when it runs
      // under Node; in the browser build they're empty, and the build stays quiet.
      name: 'ggwave-browser',
      apply: 'build',
      enforce: 'pre',
      resolveId(id, importer) {
        return (id === 'fs' || id === 'path') && importer?.includes('/node_modules/ggwave/') ? '\0ggwave-node-only' : null;
      },
      load(id) {
        return id === '\0ggwave-node-only' ? 'export default {};' : null;
      },
    },
    {
      name: 'hushmoney-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          // The phone's page answers at /listen as well as /listen/ (and /how as /how/), as vercel.json does.
          if (req.url === '/listen' || req.url?.startsWith('/listen?')) req.url = req.url.replace('/listen', '/listen/');
          if (req.url === '/how' || req.url?.startsWith('/how?')) req.url = req.url.replace('/how', '/how/');
          if (req.url === '/music' || req.url?.startsWith('/music?')) req.url = req.url.replace('/music', '/music/');
          if (!req.url?.startsWith('/api/')) return next();
          try {
            const { app } = await server.ssrLoadModule('/server/app.ts');
            await getRequestListener(app.fetch)(req, res);
          } catch (e) {
            next(e);
          }
        });
      },
    },
  ],
  // Phones only allow the mic over HTTPS, so trying it on one goes through an ngrok tunnel.
  // Test output and design files aren't part of the app; writing them mustn't reload the page.
  server: { allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com'], watch: { ignored: ['**/test-results/**', '**/playwright-report/**', '**/design/**', '**/.data/**'] } },
  build: {
    // Three.js's renderer is about 520 kB minified, 130 kB gzipped. The phone loads
    // it after the page is up, and the plan's budget for the 3D is ~500 kB gzipped.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      input: {
        sing: resolve(import.meta.dirname, 'index.html'),
        listen: resolve(import.meta.dirname, 'listen/index.html'),
        how: resolve(import.meta.dirname, 'how/index.html'),
        music: resolve(import.meta.dirname, 'music/index.html'),
      },
    },
  },
});
