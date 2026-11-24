// Starts the app. Default: Vite dev server + Electron with hot reload.
// --prod: runs the built app from ./out (run `npm run build` first).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prod = process.argv.includes('--prod');
const passthrough = process.argv.slice(2).filter((a) => a !== '--prod');

// Some hosts (e.g. VS Code terminals) set this, which makes Electron run as plain Node.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

let server = null;
if (!prod) {
  const tsc = require.resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.main.json'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const { createServer } = await import('vite');
  // TRANCE_DEV_PORT lets a second dev instance run alongside the first.
  const port = process.env.TRANCE_DEV_PORT ? Number(process.env.TRANCE_DEV_PORT) : undefined;
  server = await createServer({ configFile: 'vite.config.ts', ...(port ? { server: { port } } : {}) });
  await server.listen();
  env.VITE_DEV_SERVER_URL = `http://localhost:${server.config.server.port}/`;
  console.log(`renderer dev server: ${env.VITE_DEV_SERVER_URL}`);
}

const electron = require('electron');
const child = spawn(electron, ['.', ...passthrough], { stdio: 'inherit', env });
child.on('close', async (code) => {
  await server?.close();
  process.exit(code ?? 0);
});
