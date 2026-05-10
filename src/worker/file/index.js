import { sendMessage } from '../utils/index.js';
import {
  pendingFileRequests,
  incrementRequestIdCounter,
} from '../state.js';

export function requestFile(relativePath) {
  return new Promise((resolve) => {
    const id = incrementRequestIdCounter();
    pendingFileRequests[id] = resolve;
    sendMessage('readFile', { id: id, path: relativePath });
  });
}
