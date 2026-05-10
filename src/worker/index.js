import './app/index.js';
import './page/index.js';
import './component/index.js';
import './wx-api/index.js';
import { registerApp } from './app/index.js';
import { registerPage } from './page/index.js';
import { registerComponent } from './component/index.js';
import { wx, getCurrentPages } from './wx-api/index.js';
import { handleMessage } from './handlers/index.js';

self.wx = wx;
self.getCurrentPages = getCurrentPages;
self.App = registerApp;
self.Page = registerPage;
self.Component = registerComponent;

self.onmessage = async function (e) {
  await handleMessage(e.data);
};
