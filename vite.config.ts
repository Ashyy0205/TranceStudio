import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Strict Content-Security-Policy for production builds. (The dev server needs
// inline scripts for hot reload, so it is only applied at build time.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' tmedia: tthumb: data: blob:",
  "media-src 'self' tmedia: blob:",
  "font-src 'self' tmedia: data:",
  "connect-src 'self' tmedia:",
  "object-src 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'trance-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp()],
  build: {
    outDir: '../../out/renderer',
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: { port: 5173, strictPort: true },
});
