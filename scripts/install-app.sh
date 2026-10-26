#!/usr/bin/env bash
# Instala dependências do projeto, compila o CSS, ajusta o sandbox do Electron e cria launcher + autostart.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# O Electron 43 exige Node >= 22.12: se faltar, instala o nvm + Node 22 aqui mesmo.
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-node.sh"
ensure_node

npm install
npm run build:css

# Ubuntu 24.04 / Zorin 18 restringem user namespaces (AppArmor): o Electron instalado via npm precisa do
# chrome-sandbox como SUID root, senão aborta com "The SUID sandbox helper binary was found, but is not configured correctly".
SB="node_modules/electron/dist/chrome-sandbox"
if [ -f "$SB" ]; then
  echo "Configurando $SB (SUID root) — vai pedir sua senha de sudo."
  if sudo chown root:root "$SB" && sudo chmod 4755 "$SB"; then
    echo "chrome-sandbox ok."
  else
    echo "Não consegui configurar o sandbox. Alternativa (menos segura): MVCLIP_NO_SANDBOX=1 mv-clipboard" >&2
  fi
fi

# Bibliotecas do sistema que o binário do Electron precisa (normalmente já existem no desktop)
if command -v ldd >/dev/null 2>&1 && [ -f node_modules/electron/dist/electron ]; then
  missing="$(ldd node_modules/electron/dist/electron 2>/dev/null | grep 'not found' || true)"
  if [ -n "$missing" ]; then
    echo "Bibliotecas faltando para o Electron:"; echo "$missing"
    echo "Instale os pacotes correspondentes com apt (ex.: libnss3, libgbm1, libasound2t64 / libasound2)."
  fi
fi

chmod +x bin/mv-clipboard bin/mv-clipboard-ctl scripts/*.sh
mkdir -p "$HOME/.local/bin"
ln -sf "$ROOT/bin/mv-clipboard" "$HOME/.local/bin/mv-clipboard"
ln -sf "$ROOT/bin/mv-clipboard-ctl" "$HOME/.local/bin/mv-clipboard-ctl"

# Inicialização automática com a sessão (~/.config/autostart/mv-clipboard.desktop)
bash "$ROOT/scripts/autostart.sh" enable

echo
echo "App instalado. Launcher: $HOME/.local/bin/mv-clipboard (inicia sozinho nos próximos logins)."
