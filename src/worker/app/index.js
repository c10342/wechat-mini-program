import { appMethods } from '../state.js';

export function registerApp(options) {
  if (options.globalData) {
    appMethods.globalData = options.globalData;
  }
  ['onLaunch', 'onShow', 'onHide'].forEach((hook) => {
    if (typeof options[hook] === 'function') {
      appMethods[hook] = options[hook];
    }
  });
  console.log('[Worker] App registered');
}
