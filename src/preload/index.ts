import { contextBridge, ipcRenderer } from "electron";
import type { HostConfig, PageInboundMessage, PageOutboundMessage, WindowControlAction, WindowState } from "../shared/types";

function currentPageId(): string {
  const arg = process.argv.find((item) => item.startsWith("--page-id="));
  if (arg) return arg.slice("--page-id=".length);
  return new URLSearchParams(location.search).get("pageId") ?? "host";
}

function currentIpcNamespace(): string {
  const arg = process.argv.find((item) => item.startsWith("--mini-ipc="));
  return arg ? arg.slice("--mini-ipc=".length) : "mini-program:default";
}

const ipcNamespace = currentIpcNamespace();

contextBridge.exposeInMainWorld("miniHost", {
  pageId: currentPageId(),
  send(message: PageOutboundMessage) {
    ipcRenderer.send(`${ipcNamespace}:page-message`, message);
  },
  onMessage(listener: (message: PageInboundMessage) => void) {
    const handler = (_event: Electron.IpcRendererEvent, message: PageInboundMessage) => listener(message);
    ipcRenderer.on("mini:message", handler);
    return () => ipcRenderer.off("mini:message", handler);
  },
  onStack(listener: (stack: unknown[]) => void) {
    const handler = (_event: Electron.IpcRendererEvent, stack: unknown[]) => listener(stack);
    ipcRenderer.on("host:stack", handler);
    return () => ipcRenderer.off("host:stack", handler);
  },
  onHostConfig(listener: (config: HostConfig) => void) {
    const handler = (_event: Electron.IpcRendererEvent, config: HostConfig) => listener(config);
    ipcRenderer.on("host:config", handler);
    return () => ipcRenderer.off("host:config", handler);
  },
  windowControl(action: WindowControlAction) {
    ipcRenderer.send(`${ipcNamespace}:window-control`, action);
  },
  onWindowState(listener: (state: WindowState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowState) => listener(state);
    ipcRenderer.on("host:window-state", handler);
    return () => ipcRenderer.off("host:window-state", handler);
  }
});
