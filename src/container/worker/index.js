import { setWorker, worker } from '../state.js';
import { handleWorkerMessage } from '../handlers/index.js';

const ipcRenderer = window.containerBridge;

export function initWorker(bundlePath) {
  const workerUrl = new URL('file:///' + bundlePath.replace(/\\/g, '/'));
  const w = new Worker(workerUrl, { type: 'module' });

  w.onmessage = (e) => {
    handleWorkerMessage(e.data);
  };

  w.onerror = (err) => {
    console.error('[Container] Worker error:', err);
  };

  setWorker(w);
}
