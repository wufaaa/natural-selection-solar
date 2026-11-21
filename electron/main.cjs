const { app, BrowserWindow, Menu, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-webgl');

let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
      try {
        const url = new URL(request.url);
        let relPath = decodeURIComponent(url.pathname || '/');
        if (relPath === '/' || relPath === '') relPath = '/index.html';
        const safeRel = relPath.replace(/^\/+/, '');
        const resolved = path.resolve(DIST_DIR, safeRel);
        const relCheck = path.relative(DIST_DIR, resolved);
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
          return new Response('Forbidden', { status: 403 });
        }
        const data = await fs.promises.readFile(resolved);
        const ext = path.extname(resolved).toLowerCase();
        return new Response(data, {
          status: 200,
          headers: { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' },
        });
      } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
          return new Response('Not Found', { status: 404 });
        }
        return new Response('Internal Error', { status: 500 });
      }
    });

    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === 'pointerLock' || permission === 'fullscreen';
    });
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'pointerLock' || permission === 'fullscreen');
    });

    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 840,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: '#02060f',
      title: '自然选择号：太阳系防线 | NATURAL SELECTION: SOLARIS',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = (input.key || '').toLowerCase();
      if (input.key === 'F11' || (process.platform === 'darwin' && input.meta && input.control && key === 'f')) {
        event.preventDefault();
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      } else if (process.platform === 'darwin' && input.meta && key === 'q') {
        event.preventDefault();
        app.quit();
      }
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    mainWindow.loadURL('app://solaris/index.html');
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
