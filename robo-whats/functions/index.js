/* Robô de WhatsApp da plataforma Ello · Gestão do Time
 * - Feedback novo  -> mensagem para a pessoa (ponto de melhoria / advertência / positivo / alinhamento)
 * - 3+ pontos de melhoria/advertências em 90 dias -> alerta de reincidência (separando aceitos x pendentes)
 * - Dias úteis 09:00 -> lembrete para quem tem feedback sem ciência há mais de 24h (no máx. a cada 2 dias)
 * Liga/desliga e modo teste: documento shared_data/whats_config (editável na plataforma, em 👥 Equipe).
 * A chave do WasenderAPI fica guardada como segredo (WASENDER_KEY), nunca no site.
 */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const WASENDER_KEY = defineSecret('WASENDER_KEY');
const REGIAO = process.env.REGIAO || 'us-central1'; // definido pelo instalar.sh conforme o local do banco
const LIMITE = 3, DIAS = 90;

const TIPOS = { positivo: '👍 Positivo', melhoria: '🎯 Ponto de melhoria', alinhamento: '🧭 Alinhamento', advertencia: '⚠️ Advertência' };
const NIVEIS = { verbal: 'Advertência verbal', escrita1: '1ª advertência escrita', escrita2: '2ª advertência escrita', escrita3: '3ª advertência escrita' };
const PROXIMO = { verbal: '1ª advertência escrita', escrita1: '2ª advertência escrita', escrita2: '3ª advertência escrita', escrita3: 'desligamento' };

const dm = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : String(iso || ''); };
const resumo = (t, n = 90) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const dataBR = v => { const d = typeof v === 'number' ? new Date(v - 3 * 3600000) : new Date(String(v)); return isNaN(d) ? '' : String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const respondido = f => !!(f.aceito || (f.respostas && f.respostas.length) || f.resposta);
const hojeISO = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

function telefone(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return '+' + d;
}

async function config() {
  const s = await db.doc('shared_data/whats_config').get();
  return s.exists ? s.data() : { ativo: false };
}
async function telDe(nome) {
  const s = await db.doc('shared_data/equipe').get();
  const p = ((s.exists && s.data().pessoas) || []).find(x => x.nome === nome);
  return p ? telefone(p.tel) : '';
}

/* reserva a chave antes de enviar: evita mensagem repetida se o Firebase reexecutar */
async function reservar(chave) {
  const ref = db.doc('shared_data/whats_log');
  return db.runTransaction(async tx => {
    const s = await tx.get(ref); const env = (s.exists && s.data().enviados) || {};
    if (env[chave]) return false;
    tx.set(ref, { enviados: { [chave]: Date.now() } }, { merge: true });
    return true;
  });
}
async function registrar(item) {
  const ref = db.doc('shared_data/whats_log');
  await db.runTransaction(async tx => {
    const s = await tx.get(ref); const h = ((s.exists && s.data().historico) || []).slice(-149);
    h.push(Object.assign({ ts: Date.now() }, item));
    tx.set(ref, { historico: h }, { merge: true });
  });
}

async function enviar(nome, texto, chave) {
  const cfg = await config();
  if (!cfg.ativo) return console.log('WhatsApp automático desligado; não enviei para', nome);
  if (chave && !(await reservar(chave))) return console.log('Já enviado:', chave);
  let para = await telDe(nome);
  if (cfg.teste) { para = telefone(cfg.teste); texto = `🧪 *TESTE* (seria para ${nome})\n\n` + texto; }
  if (!para) { await registrar({ nome, ok: false, erro: 'sem WhatsApp cadastrado em Equipe' }); return; }
  try {
    const r = await fetch('https://www.wasenderapi.com/api/send-message', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + WASENDER_KEY.value(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: para, text: texto })
    });
    const j = await r.json().catch(() => ({}));
    await registrar({ nome, ok: r.ok && j.success !== false, status: r.status, teste: !!cfg.teste, tipo: chave ? chave.split(':')[0] : 'msg' });
    if (!r.ok) console.error('Wasender', r.status, JSON.stringify(j));
  } catch (e) {
    console.error('Falha no envio', e);
    await registrar({ nome, ok: false, erro: String(e).slice(0, 120) });
  }
}

function recentes(lista, nome) {
  const d = new Date(Date.now() - DIAS * 86400000).toISOString().slice(0, 10);
  return lista.filter(f => f.liderado === nome && (f.tipo === 'melhoria' || f.tipo === 'advertencia') && (f.data || '') >= d)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

function msgAlerta(nome, itens) {
  const pend = itens.filter(f => !respondido(f));
  const linhas = itens.map(f => {
    const ok = respondido(f);
    const t = (f.tipo === 'advertencia' ? (NIVEIS[f.nivel] || 'Advertência') + ' – ' : '') + resumo(f.texto, 70);
    return ok ? `✅ ${dm(f.data)} – ${t} _(ciente${f.aceitoEm ? ' em ' + dataBR(f.aceitoEm) : ''})_`
              : `⏳ *${dm(f.data)} – ${t} – AGUARDANDO SEU ACEITE*`;
  }).join('\n');
  let m = `🚨 *ALERTA – Ello Solar*\n\nOlá, ${nome}. Você está com *${itens.length} pontos de melhoria* nos últimos ${DIAS} dias:\n\n${linhas}\n\n`;
  if (pend.length) m += `Você ainda não deu ciência ${pend.length > 1 ? 'nos feedbacks de *' + pend.map(f => dm(f.data)).join(', ') + '*' : 'no feedback de *' + dm(pend[0].data) + '*'}. Entre hoje na plataforma, leia e clique em *"Li e estou ciente"*.\n\n`;
  m += `Isso é sério: a medida disciplinar da Ello segue *1 advertência verbal → 3 advertências escritas → desligamento*.\n\nVamos conversar ainda hoje.\nAna`;
  return m;
}

function msgNovo(f) {
  const t = resumo(f.texto, 160);
  if (f.tipo === 'positivo') return `👏 *Feedback positivo – Ello Solar*\n\nOlá, ${f.liderado}! A Ana deixou um reconhecimento para você:\n\n_"${t}"_\n\nEntre na plataforma, leia e dê o seu aceite. Parabéns! 🎉`;
  if (f.tipo === 'advertencia') return `⚠️ *ADVERTÊNCIA – Ello Solar*\n\n${f.liderado}, foi registrada uma *${NIVEIS[f.nivel] || 'advertência'}* em ${dm(f.data)}:\n\n_"${t}"_\n\nPróximo passo, se houver reincidência: *${PROXIMO[f.nivel] || 'próxima advertência'}*.\n\nEntre hoje na plataforma, leia e clique em *"Li e estou ciente"*.\nAna`;
  if (f.tipo === 'melhoria') return `🎯 *Ponto de melhoria – Ello Solar*\n\nOlá, ${f.liderado}. Foi registrado um ponto de melhoria em ${dm(f.data)}:\n\n_"${t}"_\n\nEntre na plataforma, leia e clique em *"Li e estou ciente"*. Se quiser, responda por lá.\nAna`;
  return `🧭 *Alinhamento – Ello Solar*\n\nOlá, ${f.liderado}. A Ana registrou um alinhamento para você em ${dm(f.data)}:\n\n_"${t}"_\n\nEntre na plataforma, leia e dê o seu aceite.`;
}

/* 1) feedback novo */
exports.whatsFeedbackNovo = onDocumentWritten(
  { document: 'shared_data/feedbacks', region: REGIAO, secrets: [WASENDER_KEY] },
  async ev => {
    const antes = ((ev.data.before.exists && ev.data.before.data().lista) || []);
    const depois = ((ev.data.after.exists && ev.data.after.data().lista) || []);
    const ids = new Set(antes.map(f => f.id));
    const novos = depois.filter(f => f && f.id && !ids.has(f.id) && f.liderado);
    for (const f of novos) {
      const rec = recentes(depois, f.liderado);
      const conta = (f.tipo === 'melhoria' || f.tipo === 'advertencia') && rec.length >= LIMITE;
      await enviar(f.liderado, conta ? msgAlerta(f.liderado, rec) : msgNovo(f), 'novo:' + f.id);
    }
  });

/* 2) lembrete de ciência pendente — dias úteis às 9h */
exports.whatsLembreteCiencia = onSchedule(
  { schedule: '0 9 * * 1-5', timeZone: 'America/Sao_Paulo', region: REGIAO, secrets: [WASENDER_KEY] },
  async () => {
    const s = await db.doc('shared_data/feedbacks').get();
    const lista = (s.exists && s.data().lista) || [];
    const ontem = new Date(Date.now() - 27 * 3600000).toISOString().slice(0, 10); // 24h no fuso de Brasília
    const porPessoa = {};
    lista.filter(f => f.liderado && !respondido(f) && (f.data || '') <= ontem).forEach(f => (porPessoa[f.liderado] = porPessoa[f.liderado] || []).push(f));
    const log = await db.doc('shared_data/whats_log').get();
    const ult = (log.exists && log.data().ultimoLembrete) || {};
    for (const nome of Object.keys(porPessoa)) {
      if (ult[nome] && Date.now() - ult[nome] < 47 * 3600000) continue;
      const pend = porPessoa[nome].sort((a, b) => String(a.data).localeCompare(String(b.data)));
      const rec = recentes(lista, nome);
      const txt = rec.length >= LIMITE ? msgAlerta(nome, rec)
        : `⏳ *Lembrete – Ello Solar*\n\nOlá, ${nome}. Você tem *${pend.length} feedback${pend.length > 1 ? 's' : ''} aguardando sua ciência*:\n\n` +
          pend.map(f => `• ${dm(f.data)} – ${TIPOS[f.tipo] || 'Feedback'}: ${resumo(f.texto, 60)}`).join('\n') +
          `\n\nEntre na plataforma, leia e clique em *"Li e estou ciente"*. Leva 1 minuto. 🙂`;
      await enviar(nome, txt, 'lembrete:' + nome + ':' + hojeISO());
      await db.doc('shared_data/whats_log').set({ ultimoLembrete: { [nome]: Date.now() } }, { merge: true });
      await new Promise(r => setTimeout(r, 6000)); // espaça os envios para proteger o número
    }
  });
