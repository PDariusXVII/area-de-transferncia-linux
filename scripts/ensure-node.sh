#!/usr/bin/env bash
# Garante Node.js >= 22.12 (exigido pelo pacote do Electron 43: engines "node >= 22.12.0").
# Se o Node estiver ausente ou antigo: instala o nvm, depois `nvm install 22 && nvm use 22`, define o 22 como padrão
# e valida com `node -v`.
#
#   bash scripts/ensure-node.sh              # executa
#   source scripts/ensure-node.sh; ensure_node   # carrega e deixa o PATH atualizado no shell chamador
#
# Variáveis: MVCLIP_NODE_MIN (padrão 22.12.0), NVM_VERSION (padrão v0.40.8), NVM_DIR (padrão ~/.nvm)

NODE_MIN="${MVCLIP_NODE_MIN:-22.12.0}"
NVM_VERSION="${NVM_VERSION:-v0.40.8}"

# version_ge A B -> sucesso se A >= B (compara major.minor.patch numericamente; ignora "v" e sufixos como -rc1)
version_ge() {
  local a="${1#v}" b="${2#v}" i x y
  local -a av bv
  IFS=. read -r -a av <<<"${a%%[-+]*}"
  IFS=. read -r -a bv <<<"${b%%[-+]*}"
  for i in 0 1 2; do
    x="${av[i]:-0}"; y="${bv[i]:-0}"
    x=$((10#${x:-0})); y=$((10#${y:-0}))
    if (( x > y )); then return 0; fi
    if (( x < y )); then return 1; fi
  done
  return 0
}

node_ok() {
  command -v node >/dev/null 2>&1 && version_ge "$(node -v)" "$NODE_MIN"
}

# O nvm.sh não tolera `set -u`: roda tudo do nvm com nounset desligado e restaura depois.
nvm_run() {
  local had_u=0 rc
  case $- in *u*) had_u=1; set +u ;; esac
  "$@"; rc=$?
  if [ "$had_u" = 1 ]; then set -u; fi
  return "$rc"
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    nvm_run . "$NVM_DIR/nvm.sh" || true
  fi
  command -v nvm >/dev/null 2>&1 || type nvm >/dev/null 2>&1
}

ensure_node() {
  if node_ok; then
    echo "Node.js $(node -v) ok (>= $NODE_MIN)."
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    echo "Node.js $(node -v) é antigo demais (o Electron 43 exige >= $NODE_MIN)."
  else
    echo "Node.js não encontrado."
  fi

  if ! load_nvm; then
    command -v curl >/dev/null 2>&1 || { echo "curl é necessário para instalar o nvm: sudo apt install curl" >&2; return 1; }
    echo "Instalando o nvm $NVM_VERSION em ${NVM_DIR:-$HOME/.nvm}..."
    if ! curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash; then
      echo "Falha ao instalar o nvm (sem internet?)." >&2
      return 1
    fi
    load_nvm || { echo "nvm instalado, mas não consegui carregá-lo de ${NVM_DIR:-$HOME/.nvm}." >&2; return 1; }
  fi

  echo "Instalando o Node 22 via nvm (nvm install 22 && nvm use 22)..."
  if ! { nvm_run nvm install 22 && nvm_run nvm use 22 && nvm_run nvm alias default 22 >/dev/null; }; then
    echo "O nvm não conseguiu instalar o Node 22 (sem internet?)." >&2
    return 1
  fi
  hash -r 2>/dev/null || true

  if ! node_ok; then
    echo "Depois da instalação, node -v = $(node -v 2>/dev/null || echo ausente), ainda abaixo de $NODE_MIN." >&2
    return 1
  fi
  echo "node -v → $(node -v) (padrão do nvm = 22; o instalador do nvm já cuida do ~/.bashrc)."
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  ensure_node
fi
