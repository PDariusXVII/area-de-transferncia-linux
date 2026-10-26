'use strict';
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');

const { isSensitive: looksSensitive } = require('./clip-adapter');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const isPng = (buf) => Buffer.isBuffer(buf) && buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG);

/**
 * Fonte 1 — polling da API de clipboard do Electron (via adaptador, que esconde a diferença sync/async).
 * Cobre X11 nativo e XWayland. No GNOME/Wayland só enxerga cópias feitas por apps X11 (limite do protocolo):
 * para o resto existe a extensão GNOME (fonte "bridge").
 * Texto é lido a cada ciclo (barato). Imagem só é relida quando os formatos mudam, a cada 5 ciclos
 * ou quando a janela vai abrir (pollNow) — evita recodificar PNG a cada 600 ms.
 */
class PollMonitor {
  constructor({ clip, cfg, emit, log }) {
    this.clip = clip;
    this.cfg = cfg;
    this.emit = emit;
    this.log = log;
    this.timer = null;
    this.busy = false;
    this.ticks = 0;
    this.lastText = null;
    this.lastSig = '';
    this.lastImgHash = null;
  }

  start() {
    this.tick(true);
    this.timer = setInterval(() => this.tick(false), this.cfg.pollMs);
  }

  stop() { clearInterval(this.timer); }

  pollNow() { return this.tick(true); }

  async tick(force) {
    if (this.busy) return;
    this.busy = true;
    try {
      const probe = await this.clip.probe();
      if (probe.sensitive) return;

      const text = await this.clip.readText();
      if (text) {
        if (text !== this.lastText) {
          this.lastText = text;
          this.lastImgHash = null;
          if (Buffer.byteLength(text) <= this.cfg.maxTextBytes) this.emit({ kind: 'text', text });
        }
        return;
      }
      this.lastText = null;

      if (!probe.hasImage) {
        this.lastImgHash = null;
        this.lastSig = '';
        return;
      }
      this.ticks += 1;
      if (!force && probe.sig === this.lastSig && this.ticks % 5 !== 0) return;
      this.lastSig = probe.sig;

      const img = await this.clip.readImage();
      if (!img) return;
      const hash = sha1(img.png);
      if (hash === this.lastImgHash) return;
      this.lastImgHash = hash;
      if (img.png.length <= this.cfg.maxImageBytes) this.emit({ kind: 'image', png: img.png, width: img.width, height: img.height });
    } catch (err) {
      this.log('poll: erro ao ler o clipboard:', err.message);
    } finally {
      this.busy = false;
    }
  }
}

function run(bin, args, { maxBuffer = 16 * 1024 * 1024, timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { encoding: 'buffer', maxBuffer, timeout }, (err, stdout) => {
      resolve({ ok: !err, stdout: stdout || Buffer.alloc(0) });
    });
  });
}

/**
 * Fonte 2 — `wl-paste --watch` (wl-clipboard). Exige o protocolo data-control do compositor:
 * existe em KDE/Sway/Hyprland etc.; o Mutter (GNOME) NÃO implementa — lá o processo sai logo e
 * este monitor se desativa (a extensão GNOME cobre o caso).
 */
class WlWatchMonitor {
  constructor({ wlPaste, cfg, emit, log }) {
    this.wlPaste = wlPaste;
    this.cfg = cfg;
    this.emit = emit;
    this.log = log;
    this.child = null;
    this.stopped = false;
    this.debounce = null;
  }

  start() { this.spawnWatcher(); }

  stop() {
    this.stopped = true;
    clearTimeout(this.debounce);
    this.child?.kill();
  }

  spawnWatcher() {
    const startedAt = Date.now();
    // O comando recebe o clipboard no stdin; só nos interessa o "aviso" de mudança (uma linha por mudança).
    const child = spawn(this.wlPaste, ['--watch', 'sh', '-c', 'cat >/dev/null; echo changed'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      if (lines.length) this.schedule();
    });
    child.stderr.on('data', (chunk) => this.log('wl-paste:', String(chunk).trim()));
    child.on('error', (err) => this.log('wl-paste: não foi possível iniciar:', err.message));
    child.on('exit', () => {
      if (this.stopped) return;
      if (Date.now() - startedAt < 2000) {
        this.log('wl-paste --watch indisponível neste compositor (sem data-control). Desativando esta fonte.');
        return;
      }
      setTimeout(() => this.spawnWatcher(), 1000);
    });
  }

  schedule() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.read().catch((e) => this.log('wl-paste:', e.message)), 60);
  }

  async read() {
    const types = (await run(this.wlPaste, ['--list-types'])).stdout.toString().split('\n').map((t) => t.trim()).filter(Boolean);
    if (!types.length || looksSensitive(types)) return;
    const hasText = types.some((t) => t.startsWith('text/') || t === 'UTF8_STRING' || t === 'STRING');
    if (hasText) {
      const out = await run(this.wlPaste, ['--no-newline'], { maxBuffer: this.cfg.maxTextBytes + 1024 });
      const text = out.stdout.toString('utf8');
      if (out.ok && text) this.emit({ kind: 'text', text });
    } else if (types.includes('image/png')) {
      const out = await run(this.wlPaste, ['--type', 'image/png'], { maxBuffer: this.cfg.maxImageBytes + 1024 });
      if (out.ok && isPng(out.stdout)) this.emit({ kind: 'image', png: out.stdout });
    }
  }
}

/** Converte a mensagem {type:'clip', kind, b64} vinda da extensão GNOME em item normalizado (ou null). */
function itemFromBridge(msg, cfg) {
  if (!msg || msg.type !== 'clip' || typeof msg.b64 !== 'string') return null;
  const data = Buffer.from(msg.b64, 'base64');
  if (msg.kind === 'text') {
    if (!data.length || data.length > cfg.maxTextBytes) return null;
    return { kind: 'text', text: data.toString('utf8') };
  }
  if (msg.kind === 'image' && isPng(data) && data.length <= cfg.maxImageBytes) return { kind: 'image', png: data };
  return null;
}

/** Liga as fontes escolhidas por pickMonitors(). A fonte "bridge" é passiva (mailbox) e vive em main.js. */
function startMonitors({ names, session, cfg, clip, emit, log }) {
  const running = [];
  if (names.includes('poll')) {
    const m = new PollMonitor({ clip, cfg, emit, log });
    m.start();
    running.push(m);
  }
  if (names.includes('wl-watch') && session.tools.wlPaste) {
    const m = new WlWatchMonitor({ wlPaste: session.tools.wlPaste, cfg, emit, log });
    m.start();
    running.push(m);
  }
  return {
    stop: () => running.forEach((m) => m.stop()),
    pollNow: () => Promise.all(running.map((m) => m.pollNow?.())),
  };
}

module.exports = { PollMonitor, WlWatchMonitor, itemFromBridge, startMonitors, isPng, looksSensitive };
