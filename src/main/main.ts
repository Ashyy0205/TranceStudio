import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { ExportJobRequest, FileKind, RenderRequest } from '../shared/api';
import { type AnimationInfo, ANIMATION_EXTS, AUDIO_EXTS, FONT_EXTS, IMAGE_EXTS, type Session, TEXT_EXTS } from '../shared/types';
import { Exporter } from './export';
import { hardwareEncoder } from './ffmpeg';
import { log, logPath, startLogging, watchContents } from './log';
import { AnimationCache, listDir, listDirRecursive, readTextLines, scanFolder } from './media';
import { ThumbnailCache } from './thumbs';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
  },
  {
    scheme: 'tthumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
  },
]);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', webp: 'image/webp',
  avif: 'image/avif', gif: 'image/gif', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime',
  mkv: 'video/x-matroska', m4v: 'video/mp4', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff',
  woff2: 'font/woff2', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', aiff: 'audio/aiff', txt: 'text/plain',
};

const devServer = process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let exporter: Exporter | null = null;
let animations: AnimationCache;
let thumbnails: ThumbnailCache;

function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (devServer) void win.loadURL(devServer + (hash ? `#${hash}` : ''));
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash });
}

function webPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
  };
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#1d1d1d',
    autoHideMenuBar: true,
    title: 'Trance Studio',
    // Windows takes the icon from the .exe; Linux needs it set on the window.
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: webPreferences(),
  });
  loadRenderer(mainWindow);
  watchContents(mainWindow.webContents, 'editor');
  // The renderer blocks unload when there are unsaved changes; ask the user.
  mainWindow.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      buttons: ['Discard changes and quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'Quit without saving?',
    });
    if (choice === 0) e.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (process.env.TRANCE_SCREENSHOT) debugScreenshot(mainWindow, process.env.TRANCE_SCREENSHOT);
  else if (process.env.TRANCE_EVAL) {
    // Dev convenience: run a script in the editor once it has loaded.
    const win = mainWindow;
    win.webContents.once('did-finish-load', () =>
      setTimeout(() => void win.webContents.executeJavaScript(process.env.TRANCE_EVAL!).catch(() => {}), 1500),
    );
  }
}

// Debug hook used for visual checks: TRANCE_SCREENSHOT=out.png [TRANCE_EVAL=js]
// [TRANCE_SCREENSHOT_DELAY=ms] captures the window and quits.
function debugScreenshot(win: BrowserWindow, out: string): void {
  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') process.stdout.write(`[renderer ${e.level}] ${e.message}\n`);
    });
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') process.stdout.write(`[renderer ${e.level}] ${e.message}\n`);
  });
  win.webContents.once('did-finish-load', async () => {
    const delay = Number(process.env.TRANCE_SCREENSHOT_DELAY ?? 4000);
    await new Promise((r) => setTimeout(r, 1500));
    if (process.env.TRANCE_EVAL) {
      try {
        await win.webContents.executeJavaScript(process.env.TRANCE_EVAL, true);
      } catch (e) {
        console.error('eval failed', e);
      }
    }
    await new Promise((r) => setTimeout(r, delay));
    const image = await win.webContents.capturePage();
    await fs.writeFile(out, image.toPNG());
    app.exit(0);
  });
}

// A .trance file passed on the command line (e.g. via file association).
const initialFile = process.argv.slice(1).find((a) => a.toLowerCase().endsWith('.trance') && !a.startsWith('--'));

const FILTERS: Record<FileKind, Electron.FileFilter[]> = {
  images: [{ name: 'Images', extensions: IMAGE_EXTS }],
  animations: [{ name: 'Videos', extensions: ANIMATION_EXTS }],
  media: [{ name: 'Images and videos', extensions: [...IMAGE_EXTS, ...ANIMATION_EXTS] }],
  fonts: [{ name: 'Fonts', extensions: FONT_EXTS }],
  audio: [{ name: 'Audio', extensions: AUDIO_EXTS }],
  text: [{ name: 'Text', extensions: TEXT_EXTS }],
  session: [{ name: 'Trance Studio session', extensions: ['trance'] }],
};

function registerIpc(): void {
  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:openFiles', async (_e, kind: FileKind, multiple: boolean) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: FILTERS[kind],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:saveSession', async (_e, name: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: name, filters: FILTERS.session });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:saveVideo', async (_e, name: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: name,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('media:scanFolder', (_e, root: string, classic: boolean) => scanFolder(root, { classic }));
  ipcMain.handle('media:readText', (_e, file: string, classic: boolean) => readTextLines(file, { classic }));
  ipcMain.handle('media:listDir', (_e, dir: string) => listDir(dir));
  ipcMain.handle('media:listDirRecursive', (_e, dir: string) => listDirRecursive(dir));
  ipcMain.handle('media:prepareAnimations', async (_e, paths: string[]) => {
    const out: Record<string, AnimationInfo> = {};
    await Promise.all(paths.map(async (p) => (out[p] = await animations.prepare(p))));
    return out;
  });

  ipcMain.handle('session:load', async (_e, file: string) => JSON.parse(await fs.readFile(file, 'utf8')));
  ipcMain.handle('session:save', async (_e, file: string, session: Session) => {
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(session, null, 2), 'utf8');
    await fs.rename(tmp, file);
  });

  ipcMain.handle('export:hardwareEncoder', () => hardwareEncoder());
  ipcMain.handle('export:begin', async (_e, job: ExportJobRequest) => {
    if (exporter) await exporter.cancel();
    const encoder = (job.hardware && (await hardwareEncoder())) || 'libx264';
    log(`export: ${job.width}x${job.height} @${job.fps} ${job.quality}, ${job.pixelFormat}, encoder ${encoder}`);
    exporter = new Exporter({ ...job, encoder });
    return { encoder };
  });
  ipcMain.handle('export:frame', async (_e, data: Uint8Array) => {
    if (!exporter) throw new Error('no export in progress');
    await exporter.writeFrame(data);
  });
  ipcMain.handle('export:finish', async () => {
    const e = exporter;
    exporter = null;
    await e?.finish();
  });
  ipcMain.handle('export:cancel', async () => {
    const e = exporter;
    exporter = null;
    await e?.cancel();
  });

  ipcMain.handle('app:initialFile', () => (initialFile && !cliRenderRequest() ? path.resolve(initialFile) : null));

  ipcMain.on('shell:showItem', (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.on('log:write', (_e, message: string) => log(String(message).slice(0, 4000)));
  ipcMain.handle('log:path', () => logPath());
}

// Command-line rendering: trance-studio --render session.trance --out video.mp4
// [--seconds N] [--width W] [--height H] [--fps F] [--quality q] [--seed S]
function cliArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function cliRenderRequest(): RenderRequest | null {
  const session = cliArg('render');
  const out = cliArg('out');
  if (!session || !out) return null;
  const num = (n: string) => (cliArg(n) !== undefined ? Number(cliArg(n)) : undefined);
  return {
    session: path.resolve(session),
    out: path.resolve(out),
    seconds: num('seconds'),
    width: num('width'),
    height: num('height'),
    fps: num('fps'),
    quality: cliArg('quality'),
    seed: num('seed'),
    software: process.argv.includes('--software'),
  };
}

function runCliRender(req: RenderRequest): void {
  ipcMain.handle('render:request', () => req);
  ipcMain.on('render:progress', (_e, line: string) => process.stdout.write(line + '\n'));
  ipcMain.on('render:done', (_e, error: string | null) => {
    if (error) process.stderr.write(`render failed: ${error}\n`);
    else process.stdout.write(`wrote ${req.out}\n`);
    app.exit(error ? 1 : 0);
  });
  const win = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: webPreferences() });
  loadRenderer(win, 'render');
}

app.whenReady().then(() => {
  startLogging();
  animations = new AnimationCache(path.join(app.getPath('userData'), 'animation-cache'));
  thumbnails = new ThumbnailCache(path.join(app.getPath('userData'), 'thumbnail-cache'));

  // Small cached thumbnails for the media browser: tthumb://local/<encoded path>.
  protocol.handle('tthumb', async (request) => {
    const file = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const thumb = await thumbnails.get(file);
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000' };
    if (!thumb) return new Response('no thumbnail', { status: 404, headers });
    return new Response(Readable.toWeb(createReadStream(thumb)) as ReadableStream, { status: 200, headers });
  });

  // Serves local media files to the renderer: tmedia://local/<encoded path>.
  // Supports byte ranges so audio can stream and seek.
  protocol.handle('tmedia', async (request) => {
    const url = new URL(request.url);
    const file = decodeURIComponent(url.pathname.slice(1));
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Type': MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream',
    });
    let size: number;
    try {
      size = (await fs.stat(file)).size;
    } catch {
      return new Response('not found', { status: 404, headers });
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) return new Response(null, { status: 416, headers });
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      headers.set('Content-Length', String(end - start + 1));
      const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
      return new Response(stream, { status: 206, headers });
    }
    headers.set('Content-Length', String(size));
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
  });

  registerIpc();
  const renderRequest = cliRenderRequest();
  if (renderRequest) {
    runCliRender(renderRequest);
    return;
  }
  createMainWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  void exporter?.cancel();
  app.quit();
});
