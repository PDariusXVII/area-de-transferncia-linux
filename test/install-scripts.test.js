'use strict';
// Scripts de instalação: ensure-node (nvm + Node >= 22.12), autostart, install-app e install.sh (dry-run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ENSURE = path.join(ROOT, 'scripts', 'ensure-node.sh');

const tmp = (p = 'mvclip-inst-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

// PATH mínimo, SEM node/curl/npm do sistema (a máquina que roda o teste pode ter Node 22 instalado).
const BASE_PATH = (() => {
  const dir = tmp('mvclip-tools-');
  for (const name of ['bash', 'sh', 'cat', 'mkdir', 'chmod', 'printf', 'sed', 'grep', 'dirname', 'head', 'env', 'ls', 'rm', 'ln',
    'date', 'readlink', 'sleep', 'tr', 'cut', 'basename', 'cp', 'touch', 'id', 'pgrep', 'setsid', 'nohup']) {
    const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
    if (found) fs.symlinkSync(found, path.join(dir, name));
  }
  return dir;
})();
const exe = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body, { mode: 0o755 }); };
const bash = (script, env) => spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });

// ---------- version_ge ----------
test('version_ge compara major.minor.patch numericamente', () => {
  const cases = [
    ['v22.12.0', '22.12.0', true], ['22.12.1', '22.12.0', true], ['v22.13.0', '22.12.0', true], ['v23.0.0', '22.12.0', true],
    ['v22.11.9', '22.12.0', false], ['v20.18.0', '22.12.0', false], ['v18.19.1', '22.12.0', false], ['v22.9.0', '22.12.0', false],
    ['v22.12', '22.12.0', true], ['v22.12.0-rc.1', '22.12.0', true], ['v9.0.0', '22.12.0', false], ['v100.0.0', '22.12.0', true],
  ];
  for (const [a, b, want] of cases) {
    const r = spawnSync('bash', ['-c', `source "${ENSURE}"; version_ge "${a}" "${b}"`], { encoding: 'utf8' });
    assert.equal(r.status === 0, want, `${a} >= ${b} deveria ser ${want}`);
  }
});

// ---------- ensure_node ----------
/** Ambiente com `node` falso (versão dada), nvm falso opcional e curl falso opcional. */
function nodeEnv({ nodeVersion = null, nvm = null, curlInstallsNvm = false, nvmFails = false } = {}) {
  const dir = tmp();
  const bin = path.join(dir, 'bin');
  const nvmDir = path.join(dir, 'nvm');
  const log = path.join(dir, 'calls.log');
  fs.mkdirSync(bin);
  if (nodeVersion) exe(path.join(bin, 'node'), `#!/bin/sh\necho ${nodeVersion}\n`);
  // nvm.sh falso: `nvm use 22` coloca um node v22.14.0 na frente do PATH. Usa variável não definida de propósito
  // (o nvm real quebra sob `set -u`; o script precisa tolerar isso).
  const nvmSh = `
echo "$UNSET_VAR_FROM_NVM" >/dev/null
nvm() {
  echo "$UNSET_VAR_FROM_NVM2" >/dev/null
  echo "nvm $*" >> "${log}"
  case "$1" in
    install) ${nvmFails ? 'return 1' : 'return 0'} ;;
    use) mkdir -p "${dir}/n22"; printf '#!/bin/sh\\necho v22.14.0\\n' > "${dir}/n22/node"; chmod +x "${dir}/n22/node"; PATH="${dir}/n22:$PATH"; export PATH; return 0 ;;
    alias) return 0 ;;
  esac
}
`;
  if (nvm) { fs.mkdirSync(nvmDir); fs.writeFileSync(path.join(nvmDir, 'nvm.sh'), nvmSh); }
  if (curlInstallsNvm) {
    // curl falso: devolve um "instalador" que cria o nvm.sh falso
    exe(path.join(bin, 'curl'), `#!/bin/sh\necho "curl $*" >> "${log}"\ncat <<'INSTALLER'\nmkdir -p "${nvmDir}"\ncat > "${nvmDir}/nvm.sh" <<'NVMSH'\n${nvmSh}\nNVMSH\nINSTALLER\n`);
  }
  const env = { PATH: `${bin}:${BASE_PATH}`, HOME: dir, NVM_DIR: nvmDir };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  return { env, calls, dir };
}
// Executa com os mesmos modos estritos que os scripts de instalação usam.
const strict = (body) => `set -euo pipefail; source "${ENSURE}"; ${body}`;

test('ensure_node: node 22.12+ já instalado -> não mexe em nada', () => {
  const e = nodeEnv({ nodeVersion: 'v22.12.0' });
  const r = bash(strict('ensure_node; node -v'), e.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Node\.js v22\.12\.0 ok/);
  assert.deepEqual(e.calls(), []);
});

test('ensure_node: node antigo + nvm presente -> nvm install 22, use 22, alias default; node -v vira 22', () => {
  const e = nodeEnv({ nodeVersion: 'v20.11.0', nvm: true });
  const r = bash(strict('ensure_node; echo "FINAL=$(node -v)"'), e.env);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Node\.js v20\.11\.0 é antigo demais/);
  assert.match(r.stdout, /node -v → v22\.14\.0/);
  assert.match(r.stdout, /FINAL=v22\.14\.0/);
  assert.deepEqual(e.calls(), ['nvm install 22', 'nvm use 22', 'nvm alias default 22']);
});

test('ensure_node: sem node e sem nvm -> baixa e instala o nvm (versão fixa) e depois o Node 22', () => {
  const e = nodeEnv({ nodeVersion: null, curlInstallsNvm: true, nvm: false });
  const r = bash(strict('ensure_node; echo "FINAL=$(node -v)"'), e.env);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Node\.js não encontrado/);
  assert.match(r.stdout, /Instalando o nvm v0\.40\.8/);
  assert.match(r.stdout, /FINAL=v22\.14\.0/);
  const calls = e.calls();
  assert.match(calls[0], /^curl -fsSL https:\/\/raw\.githubusercontent\.com\/nvm-sh\/nvm\/v0\.40\.8\/install\.sh$/);
  assert.deepEqual(calls.slice(1), ['nvm install 22', 'nvm use 22', 'nvm alias default 22']);
});

test('ensure_node: NVM_VERSION e MVCLIP_NODE_MIN podem ser sobrescritos', () => {
  const e = nodeEnv({ nodeVersion: 'v20.11.0', curlInstallsNvm: true });
  const r = bash(strict('ensure_node'), { ...e.env, NVM_VERSION: 'v0.40.1', MVCLIP_NODE_MIN: '20.0.0' });
  assert.equal(r.status, 0);                   // 20.11 satisfaz o mínimo 20.0.0: nada a instalar
  assert.deepEqual(e.calls(), []);
  const r2 = bash(strict('ensure_node'), { ...e.env, NVM_VERSION: 'v0.40.1' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(e.calls()[0], /nvm\/v0\.40\.1\/install\.sh/);
});

test('ensure_node: falha do nvm install -> erro claro e status != 0', () => {
  const e = nodeEnv({ nodeVersion: 'v18.0.0', nvm: true, nvmFails: true });
  const r = bash(strict('ensure_node'), e.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /não conseguiu instalar o Node 22/);
});

test('ensure_node: sem internet para o nvm (curl falha) -> erro claro', () => {
  const e = nodeEnv({ nodeVersion: null });
  exe(path.join(e.dir, 'bin', 'curl'), '#!/bin/sh\nexit 6\n');
  const r = bash(strict('ensure_node'), e.env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Falha ao instalar o nvm/);
});

// ---------- autostart.sh ----------
function autostartEnv() {
  const home = tmp('mvclip-as-');
  const env = { PATH: BASE_PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const file = path.join(env.XDG_CONFIG_HOME, 'autostart', 'mv-clipboard.desktop');
  const run = (cmd) => spawnSync('bash', [path.join(ROOT, 'scripts', 'autostart.sh'), cmd], { env, encoding: 'utf8' });
  return { home, env, file, run };
}

test('autostart.sh: enable cria o .desktop com Exec no launcher do projeto; disable remove; status reflete', () => {
  const a = autostartEnv();
  assert.equal(a.run('status').status, 1);                       // ainda desativado
  const r = a.run('enable');
  assert.equal(r.status, 0, r.stderr);
  const desktop = fs.readFileSync(a.file, 'utf8');
  assert.match(desktop, /^\[Desktop Entry\]$/m);
  assert.match(desktop, /^Type=Application$/m);
  assert.match(desktop, /^X-GNOME-Autostart-enabled=true$/m);
  assert.match(desktop, /^X-GNOME-Autostart-Delay=3$/m);
  assert.match(desktop, new RegExp(`^Exec=${path.join(ROOT, 'bin', 'mv-clipboard').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'));
  assert.doesNotMatch(desktop, /@EXEC@/);
  assert.equal(a.run('status').status, 0);
  assert.equal(a.run('enable').status, 0);                       // idempotente
  assert.equal(a.run('disable').status, 0);
  assert.ok(!fs.existsSync(a.file));
  assert.equal(a.run('status').status, 1);
  assert.equal(a.run('nada').status, 2);
});

test('autostart.sh: prefere ~/.local/bin/mv-clipboard quando existir', () => {
  const a = autostartEnv();
  const link = path.join(a.home, '.local', 'bin', 'mv-clipboard');
  exe(link, '#!/bin/sh\n');
  a.run('enable');
  assert.match(fs.readFileSync(a.file, 'utf8'), new RegExp(`^Exec=${link.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'));
});

test('autostart.sh: status considera X-GNOME-Autostart-enabled=false como desativado', () => {
  const a = autostartEnv();
  a.run('enable');
  fs.writeFileSync(a.file, fs.readFileSync(a.file, 'utf8').replace('enabled=true', 'enabled=false'));
  assert.equal(a.run('status').status, 1);
});

// ---------- install-app.sh (com npm/sudo falsos) ----------
test('install-app.sh: garante Node, roda npm install + build:css, cria links e autostart', () => {
  const dir = tmp('mvclip-app-');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls.log');
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  exe(path.join(bin, 'node'), '#!/bin/sh\necho v22.14.0\n');
  exe(path.join(bin, 'npm'), `#!/bin/sh\necho "npm $*" >> "${log}"\n`);
  exe(path.join(bin, 'sudo'), `#!/bin/sh\necho "sudo $*" >> "${log}"\n`);
  const env = { PATH: `${bin}:${BASE_PATH}`, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'install-app.sh')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').filter((l) => l.startsWith('npm')), ['npm install', 'npm run build:css']);
  assert.ok(fs.lstatSync(path.join(home, '.local/bin/mv-clipboard')).isSymbolicLink());
  assert.ok(fs.lstatSync(path.join(home, '.local/bin/mv-clipboard-ctl')).isSymbolicLink());
  const desktop = fs.readFileSync(path.join(home, '.config/autostart/mv-clipboard.desktop'), 'utf8');
  assert.match(desktop, new RegExp(`^Exec=${path.join(home, '.local/bin/mv-clipboard').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'));
});

test('install-app.sh: Node antigo sem nvm e sem rede -> aborta antes do npm install', () => {
  const dir = tmp('mvclip-app2-');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls.log');
  fs.mkdirSync(path.join(dir, 'home'));
  exe(path.join(bin, 'node'), '#!/bin/sh\necho v18.19.1\n');
  exe(path.join(bin, 'npm'), `#!/bin/sh\necho "npm $*" >> "${log}"\n`);
  exe(path.join(bin, 'curl'), '#!/bin/sh\nexit 6\n');
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'install-app.sh')], {
    env: { PATH: `${bin}:${BASE_PATH}`, HOME: path.join(dir, 'home'), NVM_DIR: path.join(dir, 'nvm') }, encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(log), 'npm não deve rodar com Node antigo');
});

// ---------- install.sh ----------
const install = (args, env = {}) => spawnSync('bash', [path.join(ROOT, 'install.sh'), ...args], {
  env: { PATH: BASE_PATH, HOME: tmp('mvclip-ih-'), MVCLIP_ALLOW_ROOT: '1', ...env }, encoding: 'utf8',
});

test('install.sh --dry-run lista os 5 passos na ordem e não executa nada', () => {
  const r = install(['--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  const order = ['1/5 Pacotes do sistema', '2/5 Node.js >= 22.12', '3/5 App', '4/5 GNOME/Zorin', '5/5 Iniciando'].map((t) => r.stdout.indexOf(t));
  assert.ok(order.every((i) => i >= 0), r.stdout);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(r.stdout, /\[dry-run\] bash .*scripts\/install-deps\.sh/);
  assert.match(r.stdout, /\[dry-run\] ensure_node/);
  assert.match(r.stdout, /\[dry-run\] bash .*scripts\/install-app\.sh/);
  assert.match(r.stdout, /\[dry-run\] bash .*scripts\/setup-gnome\.sh/);
});

test('install.sh: --skip-deps, --skip-gnome, --no-start e --wayland-extras', () => {
  const r = install(['--dry-run', '--skip-deps', '--skip-gnome', '--no-start']);
  assert.match(r.stdout, /1\/5 Pacotes do sistema: pulado/);
  assert.match(r.stdout, /4\/5 GNOME: pulado/);
  assert.match(r.stdout, /5\/5 Iniciar: pulado/);
  assert.doesNotMatch(r.stdout, /install-deps\.sh/);
  const x = install(['--dry-run', '--wayland-extras']);
  assert.match(x.stdout, /install-deps\.sh --wayland-extras/);
});

test('install.sh: opção desconhecida -> status 2; --help funciona', () => {
  assert.equal(install(['--nada']).status, 2);
  const h = install(['--help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Instalador de ponta a ponta/);
});

test('install.sh: recusa rodar como root sem MVCLIP_ALLOW_ROOT', { skip: process.getuid && process.getuid() !== 0 ? 'só vale como root' : false }, () => {
  const r = install(['--dry-run'], { MVCLIP_ALLOW_ROOT: '0' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Rode como usuário normal/);
});
