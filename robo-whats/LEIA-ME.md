# Robô de WhatsApp · Ello Gestão do Time

Envia pelo WasenderAPI:
- **Feedback novo** → mensagem para a pessoa (positivo, ponto de melhoria, alinhamento, advertência).
- **3+ pontos de melhoria/advertências em 90 dias** → alerta de reincidência, separando o que já foi aceito do que está pendente.
- **Dias úteis às 9h** → lembrete para quem tem feedback sem ciência há mais de 24h (no máximo a cada 2 dias).

Liga/desliga e **modo teste** ficam na plataforma, em 👥 Equipe → "WhatsApp automático".
A chave do WasenderAPI fica guardada como segredo no Firebase (`WASENDER_KEY`), nunca no site.

## Instalar (Google Cloud Shell)
```bash
git clone https://github.com/anarezende-a11y/ello-gestao-time.git
bash ello-gestao-time/robo-whats/instalar.sh
```
Pré-requisito: projeto `pos-vendas-95eee` no plano **Blaze**.

## Trocar a chave depois
```bash
npx -y firebase-tools@13 functions:secrets:set WASENDER_KEY --project pos-vendas-95eee
npx -y firebase-tools@13 deploy --only functions --project pos-vendas-95eee
```
