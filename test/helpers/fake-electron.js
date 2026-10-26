'use strict';
/**
 * "Electron de mentira" para testar main.js sem display/GPU: intercepta require('electron').
 * Cobre só o que o app usa (app, BrowserWindow, ipcMain, clipboard, nativeImage, screen, globalShortcut)
 * e simula as DUAS gerações da API de clipboard: legacy (Electron ≤ 43, síncrona) e modern (≥ 44, assíncrona).
 */
const { EventEmitter } = require('node:events');
const Module = require('node:module');

const image = (buf) => ({ isEmpty: () => !buf || !buf.length, getSize: () => ({ width: 2, height: 2 }), toPNG: () => buf });

/** Clipboards falsos. `state` = { formats, text, png }; `calls.written` registra o que o app escreveu. */
function makeFakeClipboard(mode, state, calls = { written: [] }) {
  if (mode === 'legacy') {
    return {
      clipboard: {
        availableFormats: () => state.formats,
        readText: () => state.text,
        readImage: () => image(state.png),
        writeText(t) { state.text = t; state.png = null; state.formats = ['text/plain']; calls.written.push(['text', t]); },
        writeImage(img) { state.png = img.toPNG(); state.text = ''; state.formats = ['image/png']; calls.written.push(['image']); },
      },
      nativeImage: { createFromBuffer: (buf) => image(buf) },
    };
  }

  // Electron 44+: assíncrono, sem availableFormats/readImage/writeImage
  class FakeClipboardItem {
    constructor(map) { this.map = map; this.types = Object.keys(map); }
    async getType(type) {
      const v = await this.map[type];
      return v instanceof Blob ? v : new Blob([v], { type });
    }
  }
  return {
    ClipboardItem: FakeClipboardItem,
    clipboard: {
      has: async (mime) => state.formats.includes(mime),
      readText: async () => state.text,
      read: async () => {
        const map = {};
        if (state.text) map['text/plain'] = state.text;
        if (state.png) map['image/png'] = new Blob([state.png], { type: 'image/png' });
        return Object.keys(map).length ? [new FakeClipboardItem(map)] : [];
      },
      writeText: async (t) => { state.text = t; state.png = null; state.formats = ['text/plain']; calls.written.push(['text', t]); },
      write: async (items) => {
        for (const it of items) {
          if (!it.types.includes('image/png')) continue;
          const blob = await it.getType('image/png');
          state.png = Buffer.from(await blob.arrayBuffer());
          state.text = '';
          state.formats = ['image/png'];
          calls.written.push(['image']);
        }
      },
    },
    nativeImage: { createFromBuffer: (buf) => image(buf) },
  };
}

function installFakeElectron({ userData, hasOzoneSwitch = false, ozoneValue = '', clipboardMode = 'legacy' } = {}) {
  const calls = { relaunch: [], exit: [], quit: 0, shortcuts: [], unregistered: [], written: [] };
  const state = { formats: [], text: '', png: null };
  const handlers = new Map(); // ipcMain.handle
  const listeners = new Map(); // ipcMain.on
  const windows = [];

  class FakeWebContents extends EventEmitter {
    constructor() { super(); this.sent = []; }
    send(channel, ...args) { this.sent.push([channel, ...args]); }
    setWindowOpenHandler() {}
  }
  class FakeWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.webContents = new FakeWebContents();
      this.visible = false;
      this.bounds = null;
      this.destroyed = false;
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    loadFile(file) { this.file = file; }
    setBounds(b) { this.bounds = b; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    getNativeWindowHandle() { const b = Buffer.alloc(4); b.writeUInt32LE(0x1234567); return b; }
  }

  const clip = makeFakeClipboard(clipboardMode, state, calls);
  const fake = {
    app: Object.assign(new EventEmitter(), {
      commandLine: { hasSwitch: () => hasOzoneSwitch, getSwitchValue: () => ozoneValue },
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      getPath: () => userData,
      relaunch: (o) => calls.relaunch.push(o),
      exit: (c) => calls.exit.push(c),
      quit() { calls.quit += 1; fake.app.emit('before-quit'); },
      disableHardwareAcceleration() {},
    }),
    BrowserWindow: FakeWindow,
    ipcMain: {
      handle: (ch, fn) => handlers.set(ch, fn),
      on: (ch, fn) => listeners.set(ch, fn),
    },
    clipboard: clip.clipboard,
    nativeImage: clip.nativeImage,
    ...(clip.ClipboardItem ? { ClipboardItem: clip.ClipboardItem } : {}),
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    },
    globalShortcut: {
      register: (accel, fn) => { calls.shortcuts.push(accel); fake.globalShortcut.fn = fn; return true; },
      unregister: (accel) => { calls.unregistered.push(accel); },
      unregisterAll() {},
    },
  };

  const original = Module._load;
  Module._load = function load(request, ...rest) {
    return request === 'electron' ? fake : original.call(this, request, ...rest);
  };
  return { fake, calls, state, handlers, listeners, windows, restore: () => { Module._load = original; } };
}

module.exports = { installFakeElectron, makeFakeClipboard };
