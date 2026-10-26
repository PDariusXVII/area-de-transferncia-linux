'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PollMonitor, itemFromBridge, isPng, looksSensitive } = require('../src/monitor');
const { DEFAULTS } = require('../src/config');

const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(n))]);

const { createClipboardAdapter } = require('../src/clip-adapter');
const { makeFakeClipboard } = require('./helpers/fake-electron');

/** Monta um PollMonitor sobre o clipboard falso da geração pedida ('legacy' = Electron ≤ 43, 'modern' = ≥ 44). */
function setup(mode, state, cfg = DEFAULTS) {
  const out = [];
  const clip = createClipboardAdapter(makeFakeClipboard(mode, state));
  const m = new PollMonitor({ clip, cfg, emit: (i) => out.push(i), log: () => {} });
  return { m, out, clip };
}

for (const mode of ['legacy', 'modern']) {
  test(`[${mode}] adaptador escolhe a API certa`, () => {
    const { clip } = setup(mode, { formats: [], text: '', png: null });
    assert.equal(clip.mode, mode === 'legacy' ? 'sync' : 'async');
  });

  test(`[${mode}] poll: emite texto novo uma única vez`, async () => {
    const st = { formats: ['text/plain'], text: 'oi', png: null };
    const { m, out } = setup(mode, st);
    await m.tick(false); await m.tick(false);
    assert.deepEqual(out, [{ kind: 'text', text: 'oi' }]);
    st.text = 'tchau';
    await m.tick(false);
    assert.equal(out.length, 2);
  });

  test(`[${mode}] poll: copiar o mesmo texto de novo depois de outro conteúdo é capturado`, async () => {
    const st = { formats: ['text/plain'], text: 'a', png: null };
    const { m, out } = setup(mode, st);
    await m.tick(false);
    st.text = 'b'; await m.tick(false);
    st.text = 'a'; await m.tick(false);
    assert.deepEqual(out.map((i) => i.text), ['a', 'b', 'a']);
  });

  test(`[${mode}] poll: imagem emitida uma vez; só relê com pollNow, a cada 5 ciclos ou formato novo`, async () => {
    const st = { formats: ['image/png'], text: '', png: PNG(1) };
    const { m, out } = setup(mode, st);
    await m.tick(false);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'image');
    assert.deepEqual(out[0].png, PNG(1));

    st.png = PNG(2);                 // outra imagem, mesmos formatos: ainda não notou...
    await m.tick(false);
    assert.equal(out.length, 1);
    await m.pollNow();               // ...mas ao abrir a janela (pollNow) é capturada
    assert.equal(out.length, 2);
    await m.pollNow();               // idêntica: não duplica
    assert.equal(out.length, 2);
  });

  test(`[${mode}] poll: ignora conteúdo marcado por gerenciador de senhas`, async () => {
    const st = { formats: ['text/plain', 'x-kde-passwordManagerHint'], text: 'senha-super-secreta', png: null };
    const { m, out } = setup(mode, st);
    await m.tick(true);
    assert.deepEqual(out, []);
  });

  test(`[${mode}] poll: texto grande demais é ignorado`, async () => {
    const st = { formats: ['text/plain'], text: 'x'.repeat(100), png: null };
    const { m, out } = setup(mode, st, { ...DEFAULTS, maxTextBytes: 50 });
    await m.tick(true);
    assert.deepEqual(out, []);
  });

  test(`[${mode}] adaptador grava texto e imagem de volta no clipboard`, async () => {
    const st = { formats: [], text: '', png: null };
    const { clip } = setup(mode, st);
    await clip.writeText('colado');
    assert.equal(st.text, 'colado');
    await clip.writeImage(PNG(9));
    assert.deepEqual(st.png, PNG(9));
    assert.deepEqual(await clip.readImage().then((r) => r.png), PNG(9));
  });
}

test('poll: erro do clipboard não derruba o ciclo seguinte', async () => {
  let boom = true;
  const clip = {
    probe: async () => { if (boom) throw new Error('x11 ocupado'); return { sensitive: false, hasImage: false, sig: '' }; },
    readText: async () => 'ok',
  };
  const out = [];
  const m = new PollMonitor({ clip, cfg: DEFAULTS, emit: (i) => out.push(i), log: () => {} });
  await m.tick(true);
  boom = false;
  await m.tick(true);
  assert.deepEqual(out, [{ kind: 'text', text: 'ok' }]);
});

test('looksSensitive reconhece o marcador de gerenciadores de senha (sem diferenciar maiúsculas)', () => {
  assert.equal(looksSensitive(['X-KDE-PasswordManagerHint']), true);
  assert.equal(looksSensitive(['text/plain']), false);
});

test('itemFromBridge decodifica texto e PNG e rejeita lixo', () => {
  const text = itemFromBridge({ type: 'clip', kind: 'text', b64: Buffer.from('olá ✓').toString('base64') }, DEFAULTS);
  assert.deepEqual(text, { kind: 'text', text: 'olá ✓' });

  const img = itemFromBridge({ type: 'clip', kind: 'image', b64: PNG(7).toString('base64') }, DEFAULTS);
  assert.equal(img.kind, 'image');
  assert.ok(isPng(img.png));

  assert.equal(itemFromBridge({ type: 'clip', kind: 'image', b64: Buffer.from('não é png').toString('base64') }, DEFAULTS), null);
  assert.equal(itemFromBridge({ type: 'clip', kind: 'text', b64: '' }, DEFAULTS), null);
  assert.equal(itemFromBridge({ type: 'toggle' }, DEFAULTS), null);
  assert.equal(itemFromBridge(null, DEFAULTS), null);
});
