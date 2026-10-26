'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const electron = require('electron');

const { app, ipcMain, nativeImage, globalShortcut } = electron;

const { Settings } = require('./src/settings');
const { createClipboardAdapter } = require('./src/clip-adapter');
const { detectSession, pickMonitors, pickPasteChain } = require('./src/session');
const { Store } = require('./src/store');
const { Mailbox } = require('./src/mailbox');
const { itemFromBridge, startMonitors } = require('./src/monitor');
const { simulatePaste, detectTerminalX11 } = require('./src/paste');
const { Popup } = require('./src/window');
const { HotkeyManager } = require('./src/hotkey');
const autostart = require('./src/autostart');

const log = (...args) => console.log('[mv-clipboard]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const session = detectSession();

// Placa de vídeo problemática (janela preta/transparência quebrada)? Rode com MVCLIP_DISABLE_GPU=1.
if (process.env.MVCLIP_DISABLE_GPU) app.disableHardwareAcceleration();

/**
 * Em sessão Wayland o Chromium (Electron 38+) escolhe Wayland nativo, onde o app NÃO pode posicionar a janela
 * nem ler o cursor. A plataforma gráfica é decidida antes do JS rodar, então reiniciamos uma única vez já com
 * --ozone-platform=x11 (XWayland). O launcher bin/mv-clipboard e `npm start` já passam a flag.
 */
const needsX11Relaunch = session.type === 'wayland' && session.hasDisplay
  && !process.env.MVCLIP_NATIVE_WAYLAND && !app.commandLine.hasSwitch('ozone-platform');

if (needsX11Relaunch) {
  log('Sessão Wayland: reiniciando uma vez com --ozone-platform=x11 (XWayland).');
  app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] });
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  app.quit(); // já existe uma instância; ela recebe o evento "second-instance"
} else {
  start();
}

/** Caminho do mv-clipboard-ctl: prefere o link do instalador em ~/.local/bin. */
function resolveCtl() {
  const link = path.join(process.env.HOME || os.homedir(), '.local', 'bin', 'mv-clipboard-ctl');
  try { fs.accessSync(link, fs.constants.X_OK); return link; } catch { return path.join(__dirname, 'bin', 'mv-clipboard-ctl'); }
}

function start() {
  let popup = null;
  let store = null;
  let mailbox = null;
  let monitors = null;
  let settings = null;
  let hotkeys = null;
  const clipboardRef = { current: null };

  const usingX11 = session.type === 'x11' || app.commandLine.getSwitchValue('ozone-platform') === 'x11';

  app.on('second-instance', (_e, argv) => {
    if (!popup) return;
    if (argv.includes('--toggle')) popup.toggle(); else popup.show();
  });
  app.on('window-all-closed', () => { /* app residente: nunca sai sozinho */ });
  app.on('before-quit', () => {
    if (popup) popup.quitting = true;
    monitors?.stop();
    mailbox?.stop();
    hotkeys?.stop();
    store?.flush();
  });

  app.whenReady().then(() => {
    const userData = app.getPath('userData'); // ~/.config/mv-clipboard
    settings = new Settings(userData);
    const cfg = settings.cfg; // objeto vivo: janela, monitores e store enxergam as mudanças na hora
    store = new Store(userData, { maxItems: cfg.maxItems });
    mailbox = new Mailbox({ root: Mailbox.defaultRoot() });
    popup = new Popup({
      electron, cfg, session, usingX11, log,
      preloadPath: path.join(__dirname, 'src', 'preload.js'),
      htmlPath: path.join(__dirname, 'renderer', 'index.html'),
    });
    popup.create();

    const ingest = (item) => {
      if (item.kind === 'text') return store.addText(item.text);
      let { width, height } = item;
      if (!width || !height) {
        const img = nativeImage.createFromBuffer(item.png);
        if (img.isEmpty()) return null;
        ({ width, height } = img.getSize());
      }
      return store.addImage(item.png, { width, height });
    };

    const clip = createClipboardAdapter(electron); // Electron 43 (síncrono) ou 44+ (assíncrono)
    clipboardRef.current = clip;
    const monitorNames = pickMonitors(session, cfg);
    monitors = startMonitors({ names: monitorNames, session, cfg, clip, emit: ingest, log });

    // Antes de abrir a janela, força uma leitura do clipboard: o item recém-copiado já aparece na lista.
    const open = async (toggle) => {
      if (!popup.visible) await monitors.pollNow();
      if (toggle) popup.toggle(); else popup.show();
    };

    const ctl = resolveCtl();
    hotkeys = new HotkeyManager({
      globalShortcut, session, log,
      forceGlobal: Boolean(process.env.MVCLIP_FORCE_GLOBALSHORTCUT),
      command: `${/\s/.test(ctl) ? `'${ctl}'` : ctl} toggle`,
      onTrigger: () => open(true),
    });

    // ---------- Configurações ----------
    const broadcast = (channel, payload) => {
      if (popup.win && !popup.win.isDestroyed()) popup.win.webContents.send(channel, payload);
    };

    /** Configurações como a tela as vê: valores do app + estado real do sistema (atalho do GNOME, autostart). */
    const fullSettings = async () => ({
      ...cfg,
      hotkey: await hotkeys.current(cfg.hotkey),
      autostart: autostart.isEnabled(process.env),
      hotkeyMode: hotkeys.mode,
      session: { type: session.type, desktop: session.desktop },
    });

    /** Valida, aplica efeitos colaterais (atalho, autostart, limite do histórico), grava e avisa a UI. */
    const applySettings = async (patch) => {
      const errors = {};
      const warnings = [];
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { ok: false, settings: await fullSettings(), errors: { _: 'esperava um objeto' }, warnings };
      }
      const { autostart: wantAutostart, ...rest } = patch;
      const { clean, errors: invalid } = settings.validate(rest);
      Object.assign(errors, invalid);

      if ('autostart' in patch) {
        if (typeof wantAutostart !== 'boolean') errors.autostart = 'esperava boolean';
        else {
          try { autostart.setEnabled(wantAutostart, { env: process.env, appRoot: __dirname }); } catch (err) { errors.autostart = err.message; }
        }
      }
      if ('hotkey' in clean) {
        const r = await hotkeys.apply(clean.hotkey);
        if (!r.ok) { errors.hotkey = r.error; delete clean.hotkey; } else if (r.note) warnings.push(r.note);
      }

      const changed = settings.commit(clean);
      if ('maxItems' in changed) store.setMaxItems(changed.maxItems);

      const full = await fullSettings();
      broadcast('settings:changed', full);
      return { ok: Object.keys(errors).length === 0, settings: full, errors, warnings };
    };

    registerIpc({
      ipcMain, store, popup, getMailbox: () => mailbox, getCfg: () => cfg, clipboardRef,
      settingsApi: { get: fullSettings, set: applySettings }, quit: () => app.quit(),
    });

    store.on('changed', () => broadcast('history:changed', viewList(store)));

    mailbox.on('message', async (msg) => {
      try {
        switch (msg.type) {
          case 'toggle': await open(true); break;
          case 'show': await open(false); break;
          case 'hide': popup.hide(); break;
          case 'quit': app.quit(); break;
          case 'clip': { const item = itemFromBridge(msg, cfg); if (item) ingest(item); break; }
          default: log('mensagem desconhecida:', msg.type);
        }
      } catch (err) {
        log('erro ao tratar mensagem', msg.type, err.message);
      }
    });
    mailbox.start();

    hotkeys.startup(cfg.hotkey);

    log(`sessão=${session.type} desktop=${session.desktop} x11=${usingX11} fontes=[${monitorNames}]`
      + ` colar=[${pickPasteChain(session, cfg, { bridgeAlive: mailbox.bridgeAlive() })}] ponte-gnome=${mailbox.bridgeAlive()}`);

    if (cfg.showOnStart || process.argv.includes('--show')) popup.show();
  });
}

const ID_OK = (id) => typeof id === 'string' && id.length === 40;

function viewList(store) {
  return store.list().map((it) => (it.kind === 'text'
    ? { id: it.id, kind: 'text', pinned: it.pinned, chars: it.text.length, text: it.text.slice(0, 1500) }
    : { id: it.id, kind: 'image', pinned: it.pinned, width: it.width, height: it.height, url: pathToFileURL(store.imagePath(it)).href }));
}

function registerIpc({ ipcMain, store, popup, getMailbox, getCfg, clipboardRef, settingsApi, quit }) {
  // Só aceita chamadas vindas da nossa janela.
  const own = (e) => popup.win && !popup.win.isDestroyed() && e.sender === popup.win.webContents;

  ipcMain.handle('history:list', (e) => (own(e) ? viewList(store) : []));
  ipcMain.handle('history:pin', (e, id) => (own(e) && ID_OK(id) ? store.togglePin(id) : null));
  ipcMain.handle('history:remove', (e, id) => (own(e) && ID_OK(id) ? store.remove(id) : false));
  ipcMain.handle('history:clear', (e) => { if (own(e)) store.clear({ keepPinned: true }); return true; });
  ipcMain.handle('history:clear-all', (e) => { if (own(e)) store.clear({ keepPinned: false }); return true; });
  ipcMain.on('ui:hide', (e) => { if (own(e)) popup.hide(); });
  ipcMain.on('app:quit', (e) => { if (own(e)) quit(); });

  ipcMain.handle('settings:get', (e) => (own(e) ? settingsApi.get() : null));
  ipcMain.handle('settings:set', (e, patch) => (own(e)
    ? settingsApi.set(patch)
    : { ok: false, settings: null, errors: { _: 'não autorizado' }, warnings: [] }));

  ipcMain.handle('history:paste', async (e, id) => {
    if (!own(e) || !ID_OK(id)) return false;
    const item = store.get(id);
    if (!item) return false;
    const cfg = getCfg();
    const mailbox = getMailbox();

    // 1) devolve o item ao clipboard do sistema  2) esconde a janela  3) espera o foco voltar  4) Ctrl+V
    if (item.kind === 'text') await clipboardRef.current.writeText(item.text);
    else await clipboardRef.current.writeImage(store.readImage(item));
    popup.hide();
    await sleep(cfg.pasteDelayMs);

    const bridgeAlive = mailbox.bridgeAlive();
    const terminal = !bridgeAlive && session.hasDisplay ? await detectTerminalX11(session.tools) : false;
    const chain = pickPasteChain(session, cfg, { bridgeAlive });
    const used = await simulatePaste({ chain, tools: session.tools, mailbox, terminal, log });
    if (!used) log('Não consegui simular Ctrl+V (rode `npm run doctor`). O item já está no clipboard: cole com Ctrl+V.');
    return Boolean(used);
  });
}
