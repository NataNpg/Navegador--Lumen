'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = new Set([
  'settings:get',
  'settings:set',
  'adblock:get',
  'adblock:toggle-global',
  'adblock:toggle-youtube',
  'adblock:toggle-site',
  'adblock:unpause-all',
  'adblock:update',
  'bookmarks:list',
  'bookmarks:add',
  'bookmarks:remove',
  'history:list',
  'history:remove',
  'history:clear',
  'history:top-sites',
  'downloads:list',
  'downloads:show',
  'downloads:clear',
  'tab:ready',
  'external:open',
  'clipboard:read',
  'clipboard:write',
  'nav:stop',
  'find:close',
  'session:save',
  'session:load',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:is-maximized',
  'app:info',
]);

const EVENTS = new Set([
  'lumen:stats',
  'lumen:download',
  'lumen:popup',
  'lumen:shortcut',
  'lumen:wc-gone',
  'lumen:settings',
]);

contextBridge.exposeInMainWorld('lumen', {
  invoke(channel, payload) {
    if (!CHANNELS.has(channel)) {
      return Promise.reject(new Error(`canal não permitido: ${channel}`));
    }
    return ipcRenderer.invoke('lumen:invoke', channel, payload);
  },
  on(event, handler) {
    if (!EVENTS.has(event)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  pathForFile(file) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});