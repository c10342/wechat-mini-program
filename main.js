const { app, BrowserWindow, WebContentsView, ipcMain,dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const MINIAPP_DIR = path.join(__dirname, 'miniapp');

let mainWindow = null;

function loadMiniAppConfig() {
  const configPath = path.join(MINIAPP_DIR, 'app.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function createMainWindow(config) {
  const windowConfig = config.window || {};

  mainWindow = new BrowserWindow({
    width: windowConfig.width || 375,
    height: windowConfig.height || 667,
    show: false,
    title: windowConfig.navigationBarTitleText || 'Mini Program',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'container', 'container-preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'container', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('init-container', {
      config,
      appDir: MINIAPP_DIR,
    });
    mainWindow.show();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let viewIdCounter = 0;
const pageViews = {};

ipcMain.handle('create-page-view', async (event) => {
  const viewId = ++viewIdCounter;

  const view = new WebContentsView({
    webPreferences: {
      sandbox: false,
      preload: path.join(__dirname, 'container', 'page-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  view.webContents.openDevTools({ mode: 'detach' });
  pageViews[viewId] = view;
  mainWindow.contentView.addChildView(view);

  await new Promise((resolve) => {
    view.webContents.on('did-finish-load', resolve);
    view.webContents.loadFile(path.join(__dirname, 'src', 'page-view', 'page-view.html'));
  });

  return viewId;
});

ipcMain.on('set-page-view-bounds', (event, { viewId, bounds }) => {
  const view = pageViews[viewId];
  if (view) {
    view.setBounds(bounds);
  }
});

ipcMain.on('show-page-view', (event, { viewId }) => {
  const view = pageViews[viewId];
  if (view) {
    view.setVisible(true);
  }
});

ipcMain.on('hide-page-view', (event, { viewId }) => {
  const view = pageViews[viewId];
  if (view) {
    view.setVisible(false);
  }
});

ipcMain.on('destroy-page-view', (event, { viewId }) => {
  const view = pageViews[viewId];
  if (view) {
    mainWindow.contentView.removeChildView(view);
    delete pageViews[viewId];
  }
});

ipcMain.on('send-to-page-view', (event, { viewId, channel, data }) => {
  const view = pageViews[viewId];
  if (view) {
    view.webContents.send(channel, data);
  }
});

ipcMain.on('page-view-event', (event, { viewId, eventName, eventPayload }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('page-view-event', {
      viewId,
      eventName,
      eventPayload,
    });
  }
});

ipcMain.handle('read-file', async (event, relativePath) => {
  const fullPath = path.join(MINIAPP_DIR, relativePath);
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('build-worker-bundle', async () => {
  return path.join(__dirname, 'dist', 'worker.js');
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { cancelled: true, filePaths: [] };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || 'Select File',
    properties: options.multiple ? ['multiSelections', 'openFile'] : ['openFile'],
    filters: options.filters || [],
  });
  return result;
});

app.whenReady().then(() => {
  const config = loadMiniAppConfig();
  createMainWindow(config);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = loadMiniAppConfig();
    createMainWindow(config);
  }
});
