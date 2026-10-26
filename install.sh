#!/usr/bin/env bash
# Instalador de ponta a ponta para Zorin OS / Ubuntu (GNOME). Roda tudo na ordem certa:
#   1) pacotes do sistema (scripts/install-deps.sh)      4) GNOME: Super+V + extensão (scripts/setup-gnome.sh)
#   2) Node.js >= 22.12, via nvm se preciso              5) inicia o app agora (e nos próximos logins)
#   3) app: npm, CSS, sandbox, launcher, autostart (scripts/install-app.sh)
#
# Uso: bash install.sh [--dry-run] [--skip-deps] [--skip-gnome] [--no-start] [--wayland-extras]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY=0; SKIP_DEPS=0; SKIP_GNOME=0; NO_START=0
EXTRAS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --skip-deps) SKIP_DEPS=1 ;;
    --skip-gnome) SKIP_GNOME=1 ;;
    --no-start) NO_START=1 ;;
    --wayland-extras) EXTRAS+=(--wayland-extras) ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "opção desconhecida: $1 (veja --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }

if [ "$(id -u)" -eq 0 ] && [ "${MVCLIP_ALLOW_ROOT:-0}" != 1 ]; then
  echo "Rode como usuário normal, não como root: o app, o atalho e o autostart são por usuário (o sudo é pedido só onde precisa). Em contêiner/CI: MVCLIP_ALLOW_ROOT=1." >&2
  exit 1
fi

# 1) pacotes do sistema
if [ "$SKIP_DEPS" = 1 ]; then
  say "1/5 Pacotes do sistema: pulado (--skip-deps)"
else
  say "1/5 Pacotes do sistema (apt)"
  run bash "$ROOT/scripts/install-deps.sh" ${EXTRAS[@]+"${EXTRAS[@]}"}
fi

# 2) Node.js >= 22.12 (carregado neste shell, para o PATH valer nos passos seguintes)
say "2/5 Node.js >= 22.12"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] ensure_node (instala nvm + Node 22 se o node atual for < 22.12)"
else
  # shellcheck disable=SC1091
  source "$ROOT/scripts/ensure-node.sh"
  ensure_node
fi

# 3) app
say "3/5 App (npm install, CSS, sandbox, launcher e autostart)"
run bash "$ROOT/scripts/install-app.sh"

# 4) GNOME
is_gnome() {
  command -v gsettings >/dev/null 2>&1 && gsettings list-schemas 2>/dev/null | grep -qx 'org.gnome.settings-daemon.plugins.media-keys'
}
if [ "$SKIP_GNOME" = 1 ]; then
  say "4/5 GNOME: pulado (--skip-gnome)"
elif [ "$DRY" = 1 ] || is_gnome; then
  say "4/5 GNOME/Zorin: atalho Super+V e extensão-ponte"
  run bash "$ROOT/scripts/setup-gnome.sh"
else
  say "4/5 GNOME: este desktop não é GNOME"
  echo "Registre o atalho Super+V no seu desktop com o comando: $HOME/.local/bin/mv-clipboard-ctl toggle"
fi

# 5) iniciar agora
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/mv-clipboard.log"
if [ "$NO_START" = 1 ]; then
  say "5/5 Iniciar: pulado (--no-start)"
elif [ "$DRY" != 1 ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  say "5/5 Iniciar: sem sessão gráfica neste terminal; o app inicia sozinho no próximo login"
else
  say "5/5 Iniciando o MV Clipboard (log: $LOG)"
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] setsid nohup $HOME/.local/bin/mv-clipboard > $LOG &"
  else
    mkdir -p "$(dirname "$LOG")"
    setsid nohup "$HOME/.local/bin/mv-clipboard" >"$LOG" 2>&1 </dev/null &
  fi
fi

echo
echo "Instalação concluída."
if [ "$DRY" != 1 ]; then
  echo "  Inicialização automática: $(bash "$ROOT/scripts/autostart.sh" status 2>/dev/null || echo desativada)"
fi
echo "  Em sessão Wayland (GNOME), SAIA e ENTRE de novo na sessão para a extensão carregar."
echo "  Diagnóstico: cd \"$ROOT\" && npm run doctor"
