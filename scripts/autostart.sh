#!/usr/bin/env bash
# Liga/desliga a inicialização automática com a sessão (GNOME, Xfce, KDE... — padrão freedesktop autostart).
#   bash scripts/autostart.sh enable | disable | status
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/mv-clipboard.desktop"

launcher() {
  # Prefere o link ~/.local/bin/mv-clipboard (criado pelo instalador); senão, o launcher da pasta do projeto.
  if [ -x "$HOME/.local/bin/mv-clipboard" ]; then echo "$HOME/.local/bin/mv-clipboard"; else echo "$ROOT/bin/mv-clipboard"; fi
}

case "${1:-enable}" in
  enable)
    exec_path="$(launcher)"
    case "$exec_path" in *[[:space:]]*) exec_path="\"$exec_path\"" ;; esac   # Exec com espaço precisa de aspas
    mkdir -p "$(dirname "$DESKTOP")"
    esc="$(printf '%s' "$exec_path" | sed 's/[&|\\]/\\&/g')"
    sed "s|@EXEC@|$esc|" "$ROOT/packaging/mv-clipboard.desktop.in" > "$DESKTOP"
    echo "Autostart ativado: $DESKTOP"
    grep '^Exec=' "$DESKTOP"
    ;;
  disable)
    rm -f "$DESKTOP"
    echo "Autostart desativado."
    ;;
  status)
    if [ -f "$DESKTOP" ] && ! grep -qiE '^(Hidden=true|X-GNOME-Autostart-enabled=false)' "$DESKTOP"; then
      echo "ativado ($(grep '^Exec=' "$DESKTOP"))"
    else
      echo "desativado"; exit 1
    fi
    ;;
  *) echo "uso: $0 enable|disable|status" >&2; exit 2 ;;
esac
