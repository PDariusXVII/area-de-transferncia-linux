#!/usr/bin/env bash
# Pacotes do sistema para Zorin OS / Ubuntu / Debian + Node.js >= 22.12 (via nvm, se preciso).
#   bash scripts/install-deps.sh                  # essencial (X11 + XWayland + GNOME)
#   bash scripts/install-deps.sh --wayland-extras # + wtype e ydotool (Wayland fora do GNOME: KDE, Sway, Hyprland)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Este script usa apt (Zorin/Ubuntu/Debian)." >&2
  exit 1
fi
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# xdotool        : colar (Ctrl+V) em X11/XWayland e ativar a janela do app
# wl-clipboard   : wl-paste/wl-copy — monitorar o clipboard em KDE/Sway/Hyprland (no GNOME o app usa a extensão)
# libglib2.0-bin : gsettings, gdbus, gnome-extensions (atalho e extensão no GNOME/Zorin)
# python3        : usado pelos scripts de configuração do GNOME
# curl git       : baixar o nvm e dependências
PKGS=(xdotool wl-clipboard libglib2.0-bin python3 curl git)

$SUDO apt-get update
$SUDO apt-get install -y "${PKGS[@]}"

if [ "${1:-}" = "--wayland-extras" ]; then
  # Atenção: o ydotool dos repositórios Ubuntu/Zorin é o 0.1.8 (antigo). Funciona com o ydotoold rodando e acesso ao /dev/uinput
  # (veja "Wayland fora do GNOME" no README).
  $SUDO apt-get install -y wtype ydotool ydotoold || $SUDO apt-get install -y wtype ydotool
fi

echo
echo "Pacotes do sistema instalados. Verificando o Node.js..."
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-node.sh"
ensure_node
