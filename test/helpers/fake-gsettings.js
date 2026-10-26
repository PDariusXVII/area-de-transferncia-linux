'use strict';
// gsettings falso (Python) que guarda o estado num JSON em $FAKE_GS_DB. Usado nos testes do GNOME.
const fs = require('node:fs');
const path = require('node:path');

const FAKE_GSETTINGS = `#!/usr/bin/env python3
import json, os, sys
db = os.environ['FAKE_GS_DB']
data = json.load(open(db)) if os.path.exists(db) else {}
defaults = {
  ('org.gnome.shell.keybindings', 'toggle-message-tray'): "['<Super>v', '<Super>m']",
  ('org.gnome.settings-daemon.plugins.media-keys', 'custom-keybindings'): "@as []",
  ('org.gnome.shell', 'enabled-extensions'): "['user-theme@gnome-shell-extensions.gcampax.github.com']",
  ('org.gnome.shell', 'disable-user-extensions'): 'true' if os.environ.get('FAKE_GS_DISABLE_EXT') else 'false',
}
a = sys.argv[1:]
if a[0] == 'get':
    print(data.get(a[1] + '|' + a[2], defaults.get((a[1], a[2]), "''")))
elif a[0] == 'set':
    data[a[1] + '|' + a[2]] = a[3]
    json.dump(data, open(db, 'w'))
elif a[0] == 'list-schemas':
    if os.environ.get('FAKE_GS_NO_GNOME'):
        print('org.xfce.mcs')
    else:
        print('org.gnome.shell\\norg.gnome.shell.keybindings\\norg.gnome.settings-daemon.plugins.media-keys')
elif a[0] == 'list-recursively':
    for k, v in data.items():
        s, key = k.split('|', 1)
        print(s, key, v)
`;

function writeFakeGsettings(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'gsettings');
  fs.writeFileSync(file, FAKE_GSETTINGS, { mode: 0o755 });
  return file;
}

module.exports = { FAKE_GSETTINGS, writeFakeGsettings };
