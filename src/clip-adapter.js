'use strict';
/**
 * Adaptador da API de clipboard do Electron — uma interface única (sempre Promise) para duas gerações:
 *  - Electron ≤ 43: API síncrona (availableFormats, readText, readImage, writeText, writeImage).
 *  - Electron ≥ 44: API assíncrona no estilo W3C (read/has/readText/write/writeText + ClipboardItem).
 *    Nela readImage/writeImage/availableFormats foram REMOVIDOS (blog do Electron 44).
 *
 * Interface:
 *   probe()           -> { sensitive, hasImage, sig }   leitura barata a cada ciclo do polling
 *   readText()        -> string
 *   readImage()       -> { png: Buffer, width?, height? } | null
 *   writeText(text)   -> void
 *   writeImage(png)   -> void
 */

// Gerenciadores de senha marcam o conteúdo copiado com estes formatos: não guardamos no histórico.
// Grafia real do alvo (clipboard.has() é sensível a maiúsculas); a comparação da API legada ignora caixa.
const SENSITIVE_FORMATS = ['x-kde-passwordManagerHint'];
const SENSITIVE_LOWER = SENSITIVE_FORMATS.map((f) => f.toLowerCase());
const isSensitive = (formats) => formats.some((f) => SENSITIVE_LOWER.includes(String(f).toLowerCase()));

/** @param {{clipboard: any, nativeImage: any}} deps */
function legacyAdapter({ clipboard, nativeImage }) {
  return {
    mode: 'sync',
    async probe() {
      const formats = clipboard.availableFormats();
      return {
        sensitive: isSensitive(formats),
        hasImage: formats.some((f) => String(f).startsWith('image/')),
        sig: formats.join('|'),
      };
    },
    async readText() { return clipboard.readText(); },
    async readImage() {
      const img = clipboard.readImage();
      if (!img || img.isEmpty()) return null;
      const { width, height } = img.getSize();
      return { png: img.toPNG(), width, height };
    },
    async writeText(text) { clipboard.writeText(text); },
    async writeImage(png) { clipboard.writeImage(nativeImage.createFromBuffer(png)); },
  };
}

/** @param {{clipboard: any, ClipboardItem?: any}} deps */
function modernAdapter({ clipboard, ClipboardItem }) {
  const has = (mime) => Promise.resolve(clipboard.has(mime)).catch(() => false);
  return {
    mode: 'async',
    async probe() {
      const [hasImage, ...sens] = await Promise.all([has('image/png'), ...SENSITIVE_FORMATS.map(has)]);
      return { sensitive: sens.some(Boolean), hasImage, sig: hasImage ? 'image/png' : '' };
    },
    async readText() { return clipboard.readText(); },
    async readImage() {
      const items = await clipboard.read();
      for (const item of items) {
        if (!item.types.includes('image/png')) continue;
        const blob = await item.getType('image/png');
        const png = Buffer.from(await blob.arrayBuffer());
        return png.length ? { png } : null; // largura/altura: main.js descobre com nativeImage
      }
      return null;
    },
    async writeText(text) { await clipboard.writeText(text); },
    async writeImage(png) {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    },
  };
}

/** @param {{clipboard: any, nativeImage: any, ClipboardItem?: any}} electronLike  (o próprio require('electron') serve) */
function createClipboardAdapter(electronLike) {
  const { clipboard } = electronLike;
  const isModern = typeof clipboard.availableFormats !== 'function' && typeof clipboard.read === 'function';
  return isModern ? modernAdapter(electronLike) : legacyAdapter(electronLike);
}

module.exports = { createClipboardAdapter, SENSITIVE_FORMATS, isSensitive };
