#!/bin/bash
# Instala o robô de WhatsApp no Firebase (rodar no Google Cloud Shell)
set -e
P=pos-vendas-95eee
FB="npx -y firebase-tools@13"
cd "$(dirname "$0")"
echo "▶ Descobrindo onde fica o banco do Firebase..."
LOC=$(gcloud firestore databases describe --database='(default)' --project $P --format='value(locationId)' 2>/dev/null || true)
case "$LOC" in nam5|"") R=us-central1;; eur3) R=europe-west1;; *) R=$LOC;; esac
echo "REGIAO=$R" > functions/.env
echo "   banco: ${LOC:-desconhecido} → robô em $R"
echo "▶ Instalando dependências..."
(cd functions && npm install --silent --no-audit --no-fund)
echo "▶ Entrando no Firebase (siga o link, escolha a conta dona do Firebase e cole o código aqui)..."
$FB login --no-localhost || true
echo "▶ Cole a API Key do WasenderAPI quando pedir (ela não aparece na tela — é normal):"
$FB functions:secrets:set WASENDER_KEY --project $P
echo "▶ Publicando o robô (leva uns 3-5 minutos)..."
$FB deploy --only functions --project $P --force
echo ""
echo "✅ Pronto! Agora, na plataforma, abra 👥 Equipe e ligue o 'WhatsApp automático' (comece no modo teste)."
