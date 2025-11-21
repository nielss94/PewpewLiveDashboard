import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  onSnapshot: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("snapshot", listener as any);
    return () => ipcRenderer.removeListener("snapshot", listener as any);
  },
  onTip: (callback: (tip: unknown) => void) => {
    const listener = (_event: unknown, tip: unknown) => callback(tip);
    ipcRenderer.on("tip", listener as any);
    return () => ipcRenderer.removeListener("tip", listener as any);
  },
  getSnapshot: () => ipcRenderer.invoke("getSnapshot"),
  setPollingInterval: (ms: number) =>
    ipcRenderer.invoke("setPollingInterval", ms),
  getSettings: () => ipcRenderer.invoke("getSettings"),
  getRawDump: () => ipcRenderer.invoke("getRawDump"),
  emitTestTip: (payload: unknown) => ipcRenderer.invoke("emitTestTip", payload),
  openRawWindow: () => ipcRenderer.invoke("openRawWindow"),
  toggleOverlay: () => ipcRenderer.invoke("toggleOverlay"),
  showOverlay: () => ipcRenderer.invoke("showOverlay"),
  hideOverlay: () => ipcRenderer.invoke("hideOverlay"),
});
