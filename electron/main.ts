import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { globalShortcut } from "electron";
import * as fs from "fs";
import {
  getAggregatedSnapshot,
  AggregatedSnapshot,
  getRawDump,
} from "../src/riotClient";
import { loadSettings, saveSettings, AppSettings } from "./settings";
import { TipsEngine } from "../src/tipsEngine";

let mainWindow: BrowserWindow | null = null;
let rawWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let pollIntervalMs = 1000;
let pollTimer: NodeJS.Timeout | null = null;
let lastSnapshot: AggregatedSnapshot | null = null;
const isDev = process.env.APP_DEV === "1" || !app.isPackaged;
let tipsEngine: TipsEngine | null = null;

// Avoid GPU shader disk cache writes (prevents Windows "Access is denied" cache errors)
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
// Ensure Chromium cache writes go to a writable location
try {
  const userDataDir = app.getPath("userData");
  const cacheDir = path.join(userDataDir, "Cache");
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {}
  app.setPath("cache", cacheDir);
} catch {}

function resolveAppPath(...segments: string[]): string {
  // When packaged, app.getAppPath() points inside app.asar
  // In dev, use the project root (cwd) so it matches current behavior
  const baseDir = app.isPackaged ? app.getAppPath() : process.cwd();
  return path.join(baseDir, ...segments);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    icon: path.join(resolveAppPath("assets", process.platform === "win32" ? "icon.ico" : "icon.png")),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.removeMenu();
  // Load the main dashboard
  win.loadFile(resolveAppPath("renderer", "index.html"));
  return win;
}

function createRawWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    icon: path.join(resolveAppPath("assets", process.platform === "win32" ? "icon.ico" : "icon.png")),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.removeMenu();
  win.loadFile(resolveAppPath("renderer", "raw.html"));
  win.on("closed", () => {
    rawWindow = null;
  });
  return win;
}

function createOverlayWindow(): BrowserWindow {
  const { screen } = require("electron");
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.bounds;
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  try {
    win.setIgnoreMouseEvents(true, { forward: true });
  } catch {
    win.setIgnoreMouseEvents(true);
  }
  try {
    // Helps keep above full-screen on some platforms
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}
  win.removeMenu();
  win.loadFile(resolveAppPath("renderer", "overlay.html"));
  win.on("closed", () => {
    overlayWindow = null;
  });
  return win;
}

async function pollOnce() {
  try {
    const snapshot = await getAggregatedSnapshot();
    lastSnapshot = snapshot;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("snapshot", snapshot);
    }
    // Also send to raw window if open
    if (rawWindow && !rawWindow.isDestroyed()) {
      // Raw window doesn't need snapshot updates, it polls its own data
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("snapshot", snapshot);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("snapshot", {
        ...(lastSnapshot ?? {}),
        error: true,
        message,
      });
    }
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollOnce, pollIntervalMs);
  void pollOnce();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

app.whenReady().then(async () => {
  const settings = await loadSettings();
  pollIntervalMs = settings.pollIntervalMs ?? 1000;

  mainWindow = createWindow();
  // Start polling for the main window
  startPolling();
  // Start tips engine (runs its own lightweight 1s tick)
  try {
    tipsEngine = new TipsEngine({
      getSnapshot: async () => await getAggregatedSnapshot(),
      configDir: require("path").join(resolveAppPath("data", "tips")),
    });
    tipsEngine.on("tip", (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("tip", payload);
      }
      if (rawWindow && !rawWindow.isDestroyed()) {
        rawWindow.webContents.send("tip", payload);
      }
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("tip", payload);
      }
    });
    tipsEngine.start();
  } catch {
    tipsEngine = null;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  // Global shortcut to toggle overlay visibility
  try {
    globalShortcut.register("CommandOrControl+Shift+O", () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        overlayWindow = createOverlayWindow();
        overlayWindow.showInactive();
      } else {
        if (overlayWindow.isVisible()) overlayWindow.hide();
        else overlayWindow.showInactive();
      }
    });
  } catch {}
});

app.on("window-all-closed", () => {
  if (tipsEngine) {
    try {
      tipsEngine.stop();
    } catch {}
    tipsEngine = null;
  }
  stopPolling();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch {}
});

ipcMain.handle("getSnapshot", async (): Promise<AggregatedSnapshot | null> => {
  if (!lastSnapshot) {
    await pollOnce();
  }
  return lastSnapshot;
});

ipcMain.handle("setPollingInterval", async (_evt, ms: number) => {
  const clamped = Math.max(250, Math.min(10000, Number(ms) || 1000));
  pollIntervalMs = clamped;
  const newSettings: AppSettings = { pollIntervalMs: clamped };
  await saveSettings(newSettings);
  startPolling();
  return { ok: true, pollIntervalMs };
});

ipcMain.handle("openRawWindow", async () => {
  if (!isDev) {
    // Disabled in packaged builds
    return { ok: false, disabled: true };
  }
  if (rawWindow && !rawWindow.isDestroyed()) {
    rawWindow.focus();
    return { ok: true };
  }
  rawWindow = createRawWindow();
  return { ok: true };
});

ipcMain.handle("getSettings", async () => {
  const s = await loadSettings();
  return {
    pollIntervalMs: s.pollIntervalMs ?? pollIntervalMs,
    isDev,
    version: app.getVersion(),
  };
});

ipcMain.handle("getRawDump", async () => {
  const dump = await getRawDump();
  return dump;
});

ipcMain.handle("emitTestTip", async (_evt, payload: any) => {
  const sample =
    payload && typeof payload === "object"
      ? payload
      : {
          id: "test_tip",
          title: "Test Notification",
          body: "This is a test tip to verify the pipeline.",
          icon: "🔔",
          severity: "warning",
          stickyMs: 5000,
        };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tip", sample);
  }
  return { ok: true };
});

ipcMain.handle("toggleOverlay", async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const visible = overlayWindow.isVisible();
    if (visible) {
      overlayWindow.hide();
      return { ok: true, visible: false };
    } else {
      overlayWindow.showInactive();
      return { ok: true, visible: true };
    }
  }
  overlayWindow = createOverlayWindow();
  overlayWindow.showInactive();
  return { ok: true, visible: true };
});

ipcMain.handle("showOverlay", async () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }
  overlayWindow.showInactive();
  return { ok: true, visible: true };
});

ipcMain.handle("hideOverlay", async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return { ok: true, visible: false };
});
