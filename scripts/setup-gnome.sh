#!/usr/bin/env bash
# GNOME / Zorin OS: libera o Super+V, registra o atalho "mv-clipboard-ctl toggle" e instala a extensão-ponte.
# Idempotente (pode rodar de novo sem duplicar nada).
#   bash scripts/setup-gnome.sh                       # atalho Super+V + extensão
#   bash scripts/setup-gnome.sh --no-extension        # só o atalho (ex.: sessão Xorg)
#   bash scripts/setup-gnome.sh --binding '<Control><Alt>v'   # outro atalho (formato do GNOME)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HOME/.local/bin"
UUID="mv-clipboard-bridge@mv.local"
BINDING="${MVCLIP_BINDING:-<Super>v}"
WITH_EXTENSION=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-extension) WITH_EXTENSION=0 ;;
    --binding) shift; BINDING="${1:?--binding precisa de um valor, ex.: '<Super>v'}" ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v gsettings >/dev/null 2>&1 || { echo "gsettings não encontrado: este script é só para GNOME/Zorin." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 é necessário." >&2; exit 1; }

# Zorin Lite (Xfce), KDE etc. não têm os esquemas do GNOME: avisa em vez de quebrar no meio.
if ! gsettings list-schemas 2>/dev/null | grep -qx 'org.gnome.settings-daemon.plugins.media-keys'; then
  cat >&2 <<MSG
Este desktop não tem o esquema de atalhos do GNOME (org.gnome.settings-daemon.plugins.media-keys).
Registre o atalho Super+V no seu desktop com o comando:
  $BIN/mv-clipboard-ctl toggle
(Xfce: Configurações → Teclado → Atalhos de aplicativos; KDE: Configurações do Sistema → Atalhos.)
MSG
  chmod +x "$ROOT/bin/mv-clipboard" "$ROOT/bin/mv-clipboard-ctl"
  mkdir -p "$BIN"
  ln -sf "$ROOT/bin/mv-clipboard-ctl" "$BIN/mv-clipboard-ctl"
  ln -sf "$ROOT/bin/mv-clipboard" "$BIN/mv-clipboard"
  exit 1
fi

chmod +x "$ROOT/bin/mv-clipboard" "$ROOT/bin/mv-clipboard-ctl"
mkdir -p "$BIN"
ln -sf "$ROOT/bin/mv-clipboard" "$BIN/mv-clipboard"
ln -sf "$ROOT/bin/mv-clipboard-ctl" "$BIN/mv-clipboard-ctl"

export CTL="$BIN/mv-clipboard-ctl toggle" BINDING
python3 - <<'PY'
import ast, os, subprocess

def gs(*args):
    return subprocess.check_output(['gsettings', *args], text=True).strip()

def parse_list(text):
    text = text.replace('@as ', '')
    return ast.literal_eval(text) if text else []

binding = os.environ['BINDING']

# 1) Se o atalho for Super+V: libera-o no GNOME (lá ele abre a bandeja de notificações/calendário).
if binding.lower() == '<super>v':
    key = ('org.gnome.shell.keybindings', 'toggle-message-tray')
    try:
        current = parse_list(gs('get', *key))
        kept = [k for k in current if k.lower() != '<super>v']
        if kept != current:
            subprocess.check_call(['gsettings', 'set', *key, repr(kept)])
            print(f'Super+V liberado em toggle-message-tray: {current} -> {kept}')
        else:
            print('Super+V já estava livre em toggle-message-tray.')
    except subprocess.CalledProcessError:
        print('Aviso: não encontrei org.gnome.shell.keybindings/toggle-message-tray (versão do GNOME diferente?).')

# 2) Atalho personalizado -> mv-clipboard-ctl toggle
base = 'org.gnome.settings-daemon.plugins.media-keys'
path = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/mv-clipboard/'
lst = parse_list(gs('get', base, 'custom-keybindings'))
if path not in lst:
    lst.append(path)
    subprocess.check_call(['gsettings', 'set', base, 'custom-keybindings', repr(lst)])
slot = f'{base}.custom-keybinding:{path}'
subprocess.check_call(['gsettings', 'set', slot, 'name', 'MV Clipboard'])
subprocess.check_call(['gsettings', 'set', slot, 'command', os.environ['CTL']])
subprocess.check_call(['gsettings', 'set', slot, 'binding', binding])
print(f'Atalho registrado: {binding} -> ' + os.environ['CTL'])
PY

echo "Procurando outros usos de $BINDING no GNOME..."
gsettings list-recursively 2>/dev/null | grep -iF "$BINDING" | grep -v 'mv-clipboard' || echo "  nenhum conflito encontrado."

if [ "$WITH_EXTENSION" = 1 ]; then
  SHELL_VER="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -n1 || true)"
  if [ -z "$SHELL_VER" ]; then
    echo "gnome-shell não encontrado: extensão ignorada."
  else
    if [ "$SHELL_VER" -ge 45 ]; then SRC="esm"; else SRC="legacy"; fi
    DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
    mkdir -p "$DEST"
    cp "$ROOT/gnome-extension/$SRC/extension.js" "$ROOT/gnome-extension/$SRC/metadata.json" "$DEST/"
    echo "Extensão ($SRC) instalada em $DEST (GNOME Shell $SHELL_VER)."

    # Extensões de usuário podem estar desligadas globalmente: sem isso a ponte nunca carrega.
    if [ "$(gsettings get org.gnome.shell disable-user-extensions 2>/dev/null || true)" = "true" ]; then
      gsettings set org.gnome.shell disable-user-extensions false
      echo "Extensões de usuário estavam desativadas: reativei."
    fi

    # Deixa habilitada para os próximos logins (o Shell só descobre extensões novas ao reiniciar).
    UUID="$UUID" python3 - <<'PY'
import ast, os, subprocess
uuid = os.environ['UUID']
cur = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', 'enabled-extensions'], text=True).strip().replace('@as ', '')
lst = ast.literal_eval(cur) if cur else []
if uuid not in lst:
    lst.append(uuid)
    subprocess.check_call(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', repr(lst)])
    print('Extensão marcada como habilitada.')
PY
    gnome-extensions enable "$UUID" 2>/dev/null || true
    if command -v gnome-extensions >/dev/null 2>&1; then
      echo "Estado da extensão: $(gnome-extensions info "$UUID" 2>/dev/null | grep -i 'state' | head -n1 | sed 's/^ *//' || true)"
    fi
  fi
fi

echo
if [ "${XDG_SESSION_TYPE:-}" = "x11" ]; then
  echo "Pronto. Sessão Xorg: pressione Alt+F2, digite r e Enter para o GNOME Shell carregar a extensão (ou saia e entre)."
else
  echo "Pronto. Em sessão Wayland, SAIA e ENTRE de novo na sessão para o GNOME carregar a extensão."
fi
echo "Depois confira com:  npm run doctor"
