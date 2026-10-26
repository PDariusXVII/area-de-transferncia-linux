'use strict';
// Cenário de integração do processo principal (main.js) com Electron falso e ferramentas falsas no PATH.
// Roda uma vez por processo (require('../main.js') executa o app), por isso cada modo tem seu arquivo de teste.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defineScenario(clipboardMode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mvclip-smoke-${clipboardMode}-`));
  const userData = path.join(root, 'config');
  const runtime = path.join(root, 'run');
  const bin = path.join(root, 'bin');
  for (const d of [userData, runtime, bin]) fs.mkdirSync(d, { recursive: true });

  // xdotool falso: registra os argumentos; "getwindowfocus getwindowclassname" responde Firefox.
  const xdoLog = path.join(root, 'xdotool.log');
  fs.writeFileSync(path.join(bin, 'xdotool'), `#!/bin/sh\necho "$@" >> "${xdoLog}"\n[ "$1" = getwindowfocus ] && echo Firefox\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ pollMs: 100, pasteDelayMs: 10, blurGraceMs: 0 }));

  Object.assign(process.env, {
    XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'XFCE', DISPLAY: ':99', XDG_RUNTIME_DIR: runtime,
    HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'home', '.config'), // autostart de teste NUNCA toca no HOME real
    PATH: `${bin}:${process.env.PATH}`,
  });
  delete process.env.WAYLAND_DISPLAY;

  const { installFakeElectron } = require('./fake-electron');
  const env = installFakeElectron({ userData, clipboardMode });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(cond, label, ms = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return; await wait(15); }
    assert.fail(`timeout: ${label}`);
  }
  const inbox = path.join(runtime, 'mv-clipboard', 'inbox');
  function post(msg) {
    const f = path.join(inbox, `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(msg));
    fs.renameSync(`${f}.tmp`, `${f}.json`);
  }
  const own = () => ({ sender: env.windows[0].webContents });
  const list = () => env.handlers.get('history:list')(own());
  // Última lista enviada à UI pelo evento history:changed.
  const lastList = () => env.windows[0].webContents.sent.filter(([ch]) => ch === 'history:changed').at(-1)?.[1];

  test(`[clipboard ${clipboardMode}] fluxo completo: captura, atalho, colar, ponte e persistência`, async (t) => {
    // Limpeza garantida mesmo se uma asserção falhar (senão timers/watchers seguram o processo).
    t.after(() => { env.fake.app.emit('before-quit'); env.restore(); });
    require('../../main.js');
    await until(() => env.windows.length === 1, 'janela criada');
    const win = env.windows[0];

    // janela frameless/transparente/flutuante, escondida ao nascer
    assert.equal(win.opts.frame, false);
    assert.equal(win.opts.transparent, true);
    assert.equal(win.opts.alwaysOnTop, true);
    assert.equal(win.opts.skipTaskbar, true);
    assert.equal(win.opts.show, false);
    assert.equal(win.opts.webPreferences.contextIsolation, true);
    assert.equal(win.opts.webPreferences.sandbox, true);
    assert.equal(win.opts.webPreferences.nodeIntegration, false);
    assert.equal(win.opts.width, 428);
    assert.equal(win.opts.height, 628);
    assert.match(win.file, /renderer[\\/]index\.html$/);
    assert.equal(win.visible, false);
    await until(() => fs.existsSync(path.join(runtime, 'mv-clipboard', 'app.alive')), 'batimento do app');
    assert.deepEqual(await list(), []);

    // X11 fora do GNOME: tenta registrar Super+V via globalShortcut
    assert.deepEqual(env.calls.shortcuts, ['Super+V']);

    // 1) captura por polling
    env.state.formats = ['text/plain'];
    env.state.text = 'hello';
    await until(() => lastList()?.some((i) => i.text === 'hello'), 'texto capturado');
    let items = await list();
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'text');
    assert.equal(items[0].pinned, false);

    // 2) atalho (mv-clipboard-ctl -> inbox): abre no canto inferior direito e avisa a UI
    post({ type: 'toggle' });
    await until(() => win.visible, 'janela visível após toggle');
    assert.deepEqual(win.bounds, { x: 1920 - 12 - 380 - 24, y: 1040 - 12 - 580 - 24, width: 428, height: 628 });
    assert.ok(win.webContents.sent.some(([ch]) => ch === 'ui:shown'));
    await until(() => fs.existsSync(xdoLog) && /windowactivate 19088743/.test(fs.readFileSync(xdoLog, 'utf8')), 'xdotool windowactivate');

    // 3) fixar / desafixar
    assert.equal(await env.handlers.get('history:pin')(own(), items[0].id), true);
    assert.equal((await list())[0].pinned, true);
    assert.equal(await env.handlers.get('history:pin')(own(), items[0].id), false);

    // 4) colar: clipboard recebe o item, janela some, xdotool manda Ctrl+V
    assert.equal(await env.handlers.get('history:paste')(own(), items[0].id), true);
    assert.deepEqual(env.calls.written.at(-1), ['text', 'hello']);
    assert.equal(win.visible, false);
    const log = fs.readFileSync(xdoLog, 'utf8');
    assert.match(log, /getwindowfocus getwindowclassname/);
    assert.match(log, /key --clearmodifiers ctrl\+v\n/);
    assert.doesNotMatch(log, /ctrl\+shift\+v/);

    // 5) item vindo da extensão GNOME (ponte)
    post({ type: 'clip', kind: 'text', mime: 'text/plain', b64: Buffer.from('vindo da ponte').toString('base64') });
    await until(() => lastList()?.some((i) => i.text === 'vindo da ponte'), 'item da ponte no histórico');

    // 6) imagem pelo polling
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
    env.state.text = '';
    env.state.formats = ['image/png'];
    env.state.png = PNG;
    await until(() => lastList()?.some((i) => i.kind === 'image'), 'imagem capturada', 3500);
    items = await list();
    const img = items.find((i) => i.kind === 'image');
    assert.match(img.url, /^file:\/\/.*\/images\/[a-f0-9]{40}\.png$/);
    assert.equal(img.width, 2); // legado: do próprio clipboard; moderno: descoberto via nativeImage no main

    // 6b) colar imagem devolve os MESMOS bytes ao clipboard
    env.state.png = null;
    assert.equal(await env.handlers.get('history:paste')(own(), img.id), true);
    assert.deepEqual(env.calls.written.at(-1), ['image']);
    assert.deepEqual(env.state.png, PNG);

    // 7) segurança: chamadas IPC de fora da janela são ignoradas; ids inválidos também
    assert.deepEqual(await env.handlers.get('history:list')({ sender: {} }), []);
    assert.equal(await env.handlers.get('history:remove')(own(), '../../etc/passwd'), false);
    assert.equal(await env.handlers.get('history:paste')({ sender: {} }, items[0].id), false);


    // 7b) Configurações (IPC settings:get / settings:set)
    const get = () => env.handlers.get('settings:get')(own());
    const set = (patch) => env.handlers.get('settings:set')(own(), patch);
    const cfgFile = path.join(userData, 'config.json');
    const autostartFile = path.join(root, 'home', '.config', 'autostart', 'mv-clipboard.desktop');

    const s0 = await get();
    assert.equal(s0.hotkey, 'Super+V');
    assert.equal(s0.hotkeyMode, 'globalShortcut');
    assert.equal(s0.autostart, false);
    assert.equal(s0.maxItems, 50);
    assert.equal(s0.opacity, 0.88);
    assert.equal(s0.accent, '#60CDFF');
    assert.equal(s0.closeOnBlur, true);
    assert.deepEqual(s0.session, { type: 'x11', desktop: 'xfce' });

    // visual + comportamento: grava em config.json, avisa a UI e vale na hora (objeto vivo)
    const before = win.webContents.sent.filter(([ch]) => ch === 'settings:changed').length;
    const r1 = await set({ opacity: 0.7, accent: '#C58AF9', closeOnBlur: false, position: 'cursor' });
    assert.equal(r1.ok, true, JSON.stringify(r1.errors));
    assert.equal(r1.settings.opacity, 0.7);
    const saved1 = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert.equal(saved1.accent, '#C58AF9');
    assert.equal(saved1.closeOnBlur, false);
    assert.equal(win.webContents.sent.filter(([ch]) => ch === 'settings:changed').length, before + 1);
    assert.equal(win.webContents.sent.filter(([ch]) => ch === 'settings:changed').at(-1)[1].accent, '#C58AF9');
    //   closeOnBlur=false vale sem reiniciar: perder o foco não fecha a janela
    post({ type: 'show' });
    await until(() => win.visible, 'show antes do blur');
    win.emit('blur');
    assert.equal(win.visible, true, 'closeOnBlur=false: não fecha ao perder o foco');
    //   position=cursor: usa o ponteiro (fake: 100,100)
    post({ type: 'hide' });
    await until(() => !win.visible, 'hide');
    post({ type: 'show' });
    await until(() => win.visible, 'show perto do cursor');
    assert.deepEqual(win.bounds, { x: 100 + 8 - 24, y: 100 + 8 - 24, width: 428, height: 628 });
    assert.equal((await set({ closeOnBlur: true, position: 'bottom-right' })).ok, true);
    win.emit('blur');
    assert.equal(win.visible, false, 'closeOnBlur=true: fecha ao perder o foco');

    // atalho: troca o registro do globalShortcut (X11 fora do GNOME)
    const r2 = await set({ hotkey: 'ctrl+alt+v' });
    assert.equal(r2.ok, true, JSON.stringify(r2.errors));
    assert.equal(r2.settings.hotkey, 'Ctrl+Alt+V');
    assert.deepEqual(env.calls.shortcuts, ['Super+V', 'Ctrl+Alt+V']);
    assert.deepEqual(env.calls.unregistered, ['Super+V']);
    assert.equal(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).hotkey, 'Ctrl+Alt+V');
    // atalho inválido: recusado, nada muda
    const r3 = await set({ hotkey: 'Shift+V' });
    assert.equal(r3.ok, false);
    assert.match(r3.errors.hotkey, /Ctrl, Alt ou Super/);
    assert.equal(r3.settings.hotkey, 'Ctrl+Alt+V');
    assert.deepEqual(env.calls.shortcuts, ['Super+V', 'Ctrl+Alt+V']);

    // inicialização com o sistema: cria/remove ~/.config/autostart/mv-clipboard.desktop (HOME de teste)
    assert.ok(!fs.existsSync(autostartFile));
    const r4 = await set({ autostart: true });
    assert.equal(r4.ok, true, JSON.stringify(r4.errors));
    assert.equal(r4.settings.autostart, true);
    assert.match(fs.readFileSync(autostartFile, 'utf8'), /^Exec=.*bin\/mv-clipboard$/m);
    assert.equal((await get()).autostart, true);
    assert.ok(!('autostart' in JSON.parse(fs.readFileSync(cfgFile, 'utf8'))), 'autostart não vai para o config.json');
    assert.equal((await set({ autostart: false })).settings.autostart, false);
    assert.ok(!fs.existsSync(autostartFile));

    // limite do histórico: reduzir apaga os mais antigos na hora
    for (let i = 0; i < 8; i += 1) post({ type: 'clip', kind: 'text', mime: 'text/plain', b64: Buffer.from(`extra ${i}`).toString('base64') });
    await until(() => lastList()?.filter((x) => x.kind === 'text').length >= 8, 'itens extras no histórico');
    const r5 = await set({ maxItems: 5 });
    assert.equal(r5.ok, true);
    assert.equal((await list()).length, 5);
    assert.equal(lastList().length, 5);                      // a UI recebeu a lista já podada

    // validação: tudo que vem do renderer passa pelo esquema
    const bad = await set({ maxItems: 2, opacity: 3, accent: 'azul', position: 'left', bogus: 1, autostart: 'sim' });
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['accent', 'autostart', 'bogus', 'maxItems', 'opacity', 'position']);
    assert.equal(bad.settings.maxItems, 5);
    assert.equal((await set(null)).ok, false);
    assert.equal((await set([1])).ok, false);

    // segurança: de fora da janela, nada é lido nem gravado
    assert.equal(await env.handlers.get('settings:get')({ sender: {} }), null);
    const foreign = await env.handlers.get('settings:set')({ sender: {} }, { maxItems: 500 });
    assert.equal(foreign.ok, false);
    assert.equal((await get()).maxItems, 5);

    // fixados: "Limpar" preserva; "Apagar tudo" (clear-all) remove também os fixados
    const keep = (await list())[0];
    await env.handlers.get('history:pin')(own(), keep.id);
    await env.handlers.get('history:clear')(own());
    assert.deepEqual((await list()).map((i) => i.id), [keep.id]);
    await env.handlers.get('history:clear-all')(own());
    assert.deepEqual(await list(), []);
    assert.equal(await env.handlers.get('history:clear-all')({ sender: {} }), true); // ignorado (sem efeito)

    // config.json recarregado em outra sessão vale (persistência)
    const reloaded = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert.equal(reloaded.maxItems, 5);
    assert.equal(reloaded.opacity, 0.7);
    assert.equal(fs.statSync(cfgFile).mode & 0o777, 0o600);

    // "Encerrar": só vale vindo da nossa janela
    env.listeners.get('app:quit')({ sender: {} });
    assert.equal(env.calls.quit, 0);

    // 8) limpar + sair grava o histórico em disco
    await env.handlers.get('history:clear')(own());
    assert.deepEqual(await list(), []);
    post({ type: 'show' });
    await until(() => win.visible, 'show');
    post({ type: 'hide' });
    await until(() => !win.visible, 'hide');
    env.listeners.get('app:quit')(own());                 // botão "Encerrar" da tela de configurações
    assert.equal(env.calls.quit, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'history.json'), 'utf8'));
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.items, []);
    assert.ok(!fs.existsSync(path.join(runtime, 'mv-clipboard', 'app.alive')), 'batimento removido ao sair');
  });
}

module.exports = { defineScenario };
