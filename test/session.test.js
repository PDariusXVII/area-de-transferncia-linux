'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDesktop, detectSession, pickMonitors, pickPasteChain } = require('../src/session');
const { DEFAULTS } = require('../src/config');

const have = (...names) => (bin) => (names.includes(bin) ? `/usr/bin/${bin}` : null);

test('detectDesktop normaliza XDG_CURRENT_DESKTOP', () => {
  assert.equal(detectDesktop('ubuntu:GNOME'), 'gnome');
  assert.equal(detectDesktop('zorin:GNOME'), 'gnome');
  assert.equal(detectDesktop('X-Cinnamon'), 'cinnamon');
  assert.equal(detectDesktop('XFCE'), 'xfce');
  assert.equal(detectDesktop('KDE'), 'kde');
  assert.equal(detectDesktop('sway'), 'wlroots');
  assert.equal(detectDesktop('Hyprland'), 'wlroots');
  assert.equal(detectDesktop(''), 'other');
});

test('detectSession lê tipo de sessão e ferramentas', () => {
  const s = detectSession(
    { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'zorin:GNOME', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0', PATH: '/usr/bin' },
    have('xdotool', 'gsettings'),
  );
  assert.equal(s.type, 'wayland');
  assert.equal(s.desktop, 'gnome');
  assert.equal(s.hasDisplay, true);
  assert.ok(s.tools.xdotool);
  assert.equal(s.tools.wlPaste, null);
});

test('detectSession cai para WAYLAND_DISPLAY/DISPLAY quando XDG_SESSION_TYPE falta', () => {
  assert.equal(detectSession({ WAYLAND_DISPLAY: 'wayland-1' }, have()).type, 'wayland');
  assert.equal(detectSession({ DISPLAY: ':1' }, have()).type, 'x11');
  assert.equal(detectSession({}, have()).type, 'unknown');
});

test('pickMonitors: GNOME/Wayland não usa wl-watch (Mutter não tem data-control)', () => {
  const gnomeWl = detectSession({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME', DISPLAY: ':0' }, have('wl-paste'));
  assert.deepEqual(pickMonitors(gnomeWl, DEFAULTS), ['poll', 'bridge']);
});

test('pickMonitors: KDE/Wayland usa wl-watch + poll(XWayland) + bridge', () => {
  const kde = detectSession({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'KDE', DISPLAY: ':0' }, have('wl-paste'));
  assert.deepEqual(pickMonitors(kde, DEFAULTS), ['wl-watch', 'poll', 'bridge']);
});

test('pickMonitors: X11 puro e sem DISPLAY', () => {
  const x11 = detectSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, have());
  assert.deepEqual(pickMonitors(x11, DEFAULTS), ['poll', 'bridge']);
  const none = detectSession({ XDG_SESSION_TYPE: 'wayland' }, have());
  assert.deepEqual(pickMonitors(none, DEFAULTS), ['bridge']);
});

test('pickMonitors respeita override manual', () => {
  const s = detectSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, have());
  assert.deepEqual(pickMonitors(s, { ...DEFAULTS, monitor: 'poll' }), ['poll']);
});

test('pickPasteChain por ambiente', () => {
  const x11 = detectSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, have('xdotool'));
  assert.deepEqual(pickPasteChain(x11, DEFAULTS), ['xdotool']);

  const gnomeWl = detectSession({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME', DISPLAY: ':0' }, have('xdotool'));
  assert.deepEqual(pickPasteChain(gnomeWl, DEFAULTS, { bridgeAlive: true }), ['bridge', 'xdotool']);
  assert.deepEqual(pickPasteChain(gnomeWl, DEFAULTS, { bridgeAlive: false }), ['xdotool']);

  const sway = detectSession({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'sway', DISPLAY: ':0' }, have('wtype', 'ydotool', 'xdotool'));
  assert.deepEqual(pickPasteChain(sway, DEFAULTS), ['wtype', 'ydotool', 'xdotool']);

  const kde = detectSession({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'KDE', DISPLAY: ':0' }, have('wtype', 'ydotool'));
  assert.deepEqual(pickPasteChain(kde, DEFAULTS), ['ydotool']); // wtype só em wlroots
});
