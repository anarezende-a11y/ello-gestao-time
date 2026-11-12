#!/bin/bash
# Instala o robô de WhatsApp no Firebase (rodar no Google Cloud Shell)
set -e
P=pos-vendas-95eee
FB="npx -y firebase-tools@13"
cd "$(dirname "$0")"
git pull -q 2>/dev/null || true
echo "▶ Descobrindo onde fica o banco do Firebase..."
LOC=$(gcloud firestore databases describe --database='(default)' --project $P --format='value(locationId)' 2>/dev/null || true)
case "$LOC" in nam5|"") R=us-central1;; eur3) R=europe-west1;; *) R=$LOC;; esac
echo "REGIAO=$R" > functions/.env
echo "   banco: ${LOC:-desconhecido} → robô em $R"
echo "▶ Instalando dependências..."
(cd functions && npm install --silent --no-audit --no-fund)
echo ""
echo "▶ PASSO 1/3 — Login no Firebase"
if $FB login:list 2>/dev/null | grep -q "@"; then
  echo "   já está logada ✔"
else
  echo "   1) Clique no link que vai aparecer  2) escolha a conta dona do Firebase  3) copie o código"
  echo "   4) cole o código AQUI, logo depois de 'Enter authorization code:', e aperte Enter"
  $FB login --no-localhost
  $FB login:list 2>/dev/null | grep -q "@" || { echo "❌ Login não concluído. Rode o comando de novo."; exit 1; }
fi
echo ""
echo "▶ PASSO 2/3 — API Key do WasenderAPI"
read -r -s -p "   Cole a API Key e aperte Enter (não aparece nada na tela, é normal): " KEY; echo ""
[ -n "$KEY" ] || { echo "❌ Nenhuma chave colada. Rode o comando de novo."; exit 1; }
printf %s "$KEY" | $FB functions:secrets:set WASENDER_KEY --data-file=- --project $P --force >/dev/null
unset KEY
echo "   chave guardada no Firebase ✔"
echo ""
echo "▶ PASSO 3/3 — Publicando o robô (leva uns 3-5 minutos, não feche)..."
$FB deploy --only functions --project $P --force
echo ""
echo "✅ Pronto! Agora, na plataforma, abra 👥 Equipe e ligue o 'WhatsApp automático' (comece no modo teste)."
