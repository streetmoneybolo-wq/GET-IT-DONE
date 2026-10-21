'use strict';
const { app, BrowserWindow, shell, Menu } = require('electron');
const APP_URL = 'https://sml-platform-api.onrender.com/app/';
const INTERNAL = /^https:\/\/(sml-platform-api\.onrender\.com|([a-z0-9-]+\.)?stockmarketloop\.com)(\/|$)/i;

function create() {
  const win = new BrowserWindow({ width: 1180, height: 820, minWidth: 380, minHeight: 560, backgroundColor: '#06110d', title: 'StockMarketLoop', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadURL(APP_URL);
  // links to anywhere else open in the system browser, never inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => { if (INTERNAL.test(url)) return { action: 'allow' }; shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!INTERNAL.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on('did-fail-load', (_e, code, _d, _u, isMain) => { if (isMain && code !== -3) win.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#06110d;color:#dfe9ee;font:16px system-ui;display:grid;place-content:center;height:100vh;text-align:center"><div><h2>No connection</h2><p>StockMarketLoop needs the internet.</p><button onclick="location.href=\'' + APP_URL + '\'" style="padding:10px 18px;border-radius:8px;border:0;background:#00c47d;font-weight:700">Try again</button></div></body>')); });
}
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit(); else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(null); create(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) create(); }); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
