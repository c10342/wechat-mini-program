import { sendMessage, parseQuery } from '../utils/index.js';
import { loadPage } from '../page-loader/index.js';
import { incrementRequestIdCounter, pendingChooseFileCallbacks } from '../state.js';
import { appMethods } from '../state.js';
import { pageInstances } from '../state.js';

export const wx = {
  navigateTo: function (params) {
    const url = params.url;
    const queryIndex = url.indexOf('?');
    const cleanUrl = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    const queryStr = queryIndex >= 0 ? url.substring(queryIndex + 1) : '';
    let pagePath = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;
    if (pagePath.endsWith('/index')) {
      pagePath = pagePath.slice(0, -6);
    }
    const query = parseQuery(queryStr);
    console.log(
      '[Worker] navigateTo:',
      params.url,
      '-> pagePath:',
      pagePath,
      'query:',
      JSON.stringify(query),
    );
    sendMessage('navigateTo', { path: pagePath });
    loadPage(pagePath, query);
    if (params.success) params.success();
  },
  navigateBack: function (params) {
    console.log('[Worker] navigateBack');
    sendMessage('navigateBack', { delta: params.delta || 1 });
    if (params.success) params.success();
  },
  redirectTo: function (params) {
    const url = params.url;
    const queryIndex = url.indexOf('?');
    const cleanUrl = queryIndex >= 0 ? url.substring(0, queryIndex) : url;
    const queryStr = queryIndex >= 0 ? url.substring(queryIndex + 1) : '';
    let pagePath = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;
    if (pagePath.endsWith('/index')) {
      pagePath = pagePath.slice(0, -6);
    }
    const query = parseQuery(queryStr);
    console.log(
      '[Worker] redirectTo:',
      params.url,
      '-> pagePath:',
      pagePath,
      'query:',
      JSON.stringify(query),
    );
    sendMessage('redirectTo', { path: pagePath });
    loadPage(pagePath, query);
    if (params.success) params.success();
  },
  getSystemInfoSync: function () {
    return {
      brand: 'MiniProgram',
      model: 'Electron',
      pixelRatio: 1,
      screenWidth: 375,
      screenHeight: 667,
      windowWidth: 375,
      windowHeight: 667,
      platform: 'devtools',
    };
  },
  showToast: function (params) {
    sendMessage('showToast', params);
  },
  showNotification: function (params) {
    sendMessage('showNotification', {
      title: params.title || '',
      body: params.body || '',
      icon: params.icon || '',
      tag: params.tag || '',
    });
    if (params.success) params.success();
  },
  chooseFile: function (params) {
    params = params || {};
    const id = incrementRequestIdCounter();
    pendingChooseFileCallbacks[id] = {
      success: params.success || null,
      fail: params.fail || null,
    };
    sendMessage('chooseFile', {
      id: id,
      title: params.title || 'Select File',
      filters: params.filters || [],
      multiple: params.multiple || false,
    });
  },
  getApp: function () {
    return { globalData: appMethods.globalData };
  },
};

export function getCurrentPages() {
  return Object.values(pageInstances);
}

