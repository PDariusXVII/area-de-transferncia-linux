#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${EUID} -eq 0 ]]; then echo 'Execute como usuário normal, sem sudo.' >&2; exit 1; fi
printf '\n=== Desinstalador MV Clipboard ===\n'
echo 'Remove apenas componentes identificados do MV Clipboard; não executa apt autoremove.'
read -r -p 'Desinstalar o MV Clipboard? [s/N] ' ok
[[ "$ok" =~ ^[sS]([iI][mM])?$ ]] || { echo 'Cancelado.'; exit 0; }
# Encerra via protocolo próprio antes de tentar sinais.
if [[ -x "$HOME/.local/bin/mv-clipboard-ctl" ]]; then "$HOME/.local/bin/mv-clipboard-ctl" quit 2>/dev/null || true; fi
sleep 1
# Limita os processos a executáveis cujos argumentos apontem ao projeto MV Clipboard.
if command -v pgrep >/dev/null; then
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ && "$pid" != "$$" && "$pid" != "$PPID" ]] || continue
    args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    if [[ "$args" == *'/mv-clipboard/main.js'* || "$args" == *'/mv-clipboard/node_modules/electron'* || "$args" == *'/mv-clipboard/bin/mv-clipboard'* ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done < <(pgrep -u "$(id -u)" -f 'mv-clipboard' || true)
fi
# Remove exclusivamente o atalho criado pelo instalador.
if command -v gsettings >/dev/null 2>&1 && gsettings list-schemas | grep -qx org.gnome.settings-daemon.plugins.media-keys; then
  python3 - <<'PY'
import ast, subprocess
base='org.gnome.settings-daemon.plugins.media-keys'
path='/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/mv-clipboard/'
def gs(*args): return subprocess.check_output(['gsettings',*args],text=True).strip()
try:
    raw=gs('get',base,'custom-keybindings').replace('@as ','')
    paths=ast.literal_eval(raw)
    if path in paths:
        subprocess.check_call(['gsettings','set',base,'custom-keybindings',str([p for p in paths if p != path])])
        print('Atalho MV Clipboard removido.')
except Exception as e: print('Aviso ao remover atalho:',e)
PY
fi
uuid='mv-clipboard-bridge@mv.local'
if command -v gnome-extensions >/dev/null 2>&1; then gnome-extensions disable "$uuid" 2>/dev/null || true; fi
if command -v gsettings >/dev/null 2>&1 && gsettings list-schemas | grep -qx org.gnome.shell; then
  python3 - <<'PY'
import ast,subprocess
try:
    key='enabled-extensions'; schema='org.gnome.shell'
    raw=subprocess.check_output(['gsettings','get',schema,key],text=True).strip().replace('@as ','')
    items=ast.literal_eval(raw)
    uuid='mv-clipboard-bridge@mv.local'
    if uuid in items: subprocess.check_call(['gsettings','set',schema,key,str([x for x in items if x != uuid])])
except Exception as e: print('Aviso ao desativar extensão:',e)
PY
fi
rm -f -- "$HOME/.local/bin/mv-clipboard" "$HOME/.local/bin/mv-clipboard-ctl"
rm -f -- "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/mv-clipboard.desktop"
rm -rf -- "$HOME/.local/share/gnome-shell/extensions/$uuid"
# Diretórios exclusivos do aplicativo.
rm -rf -- "${XDG_RUNTIME_DIR:-/tmp}/mv-clipboard" "${XDG_CONFIG_HOME:-$HOME/.config}/mv-clipboard" "${XDG_CACHE_HOME:-$HOME/.cache}/mv-clipboard"
read -r -p 'Apagar também a pasta do projeto extraída do ZIP? [s/N] ' apagar
if [[ "$apagar" =~ ^[sS]([iI][mM])?$ ]]; then
  echo 'Informe o caminho COMPLETO da pasta mv-clipboard extraída (não do ZIP):'
  read -r pasta
  if [[ -n "$pasta" && -d "$pasta" && ! -L "$pasta" && "$(basename -- "$pasta")" == 'mv-clipboard' && -f "$pasta/package.json" && -f "$pasta/main.js" ]]; then
    if grep -q '"name"[[:space:]]*:[[:space:]]*"mv-clipboard"' "$pasta/package.json"; then
      echo "Pasta identificada: $pasta"
      read -r -p 'Confirmar exclusão definitiva dessa pasta? [s/N] ' confirma
      if [[ "$confirma" =~ ^[sS]([iI][mM])?$ ]]; then rm -rf -- "$pasta"; echo 'Pasta removida.'; fi
    else echo 'Pasta não reconhecida. Preservada.'; fi
  else echo 'Caminho inválido ou pasta não reconhecida. Preservada.'; fi
fi
echo 'Desinstalação concluída. O ZIP original foi preservado.'
echo 'O script não altera atalhos de sistema de outros aplicativos nem desinstala Node/Electron compartilhados.'
