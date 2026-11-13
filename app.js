(function () {
'use strict';
const DATA = window.ANNALES_DATA;
const IMGS = window.ANNALES_IMG || {};
const STORE_KEY = 'annales-revision-v1';
const app = document.getElementById('app');

/* ------------------------------------------------------------------ utilitaires */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 2) => (Math.round(x * 10 ** d) / 10 ** d).toString().replace('.', ',');
const fmtScore = x => x == null ? '–' : fmt(x, 2);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dateFr = t => t ? new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
const scClass = s => s == null ? 'na' : s >= 0.999 ? 'good' : s > 0 ? 'mid' : 'zero';
const imgSrc = p => IMGS[p] || p;

/* ------------------------------------------------------------------ index des données */
const SUBJ = {}, QIDX = {};
let MATIERES = [];
DATA.subjects.forEach(s => { if (!s.cycle) s.cycle = 'C10'; });
const CYCLES = (DATA.cycles || [{ id: 'C10', label: '' }]).map(c => ({ ...c, n: DATA.subjects.filter(s => s.cycle === c.id).length }));
const CYCLE_KEY = 'annales-cycle';
const cycleLabel = id => { const c = CYCLES.find(x => x.id === id); return c ? `${c.id}${c.label ? ' · ' + c.label : ''}` : id; };
function matieresOf(cycle) { const out = []; DATA.subjects.forEach(s => { if (s.cycle === cycle && !out.includes(s.matiere)) out.push(s.matiere); }); return out; }
DATA.subjects.forEach(s => {
  SUBJ[s.id] = s;
  s.dossiers.forEach(d => {
    d.sid = s.id;
    d.isBlock = !(d.kind === 'QI' || d.kind === 'SQI');
    d.questions.forEach(q => { q.key = s.id + '|' + d.id + '|' + q.n; q.d = d; q.s = s; QIDX[q.key] = q; });
  });
});
const subjQuestions = s => s.dossiers.flatMap(d => d.questions);
const scoredCount = s => subjQuestions(s).filter(q => q.scored).length;
const kindLabel = { QI: 'Questions isolées', SQI: 'Questions isolées', DP: 'Dossier progressif', KFP: 'KFP', mDP: 'Mini-dossier progressif', TCS: 'TCS · situation commune' };
const isSingle = q => q.type === 'QRU' || q.type === 'TCS';

/* ------------------------------------------------------------------ stockage local */
let storageOK = true;
function emptyStore() { return { v: 1, attempts: {}, rev: {}, carnet: {} }; }
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (!raw) return emptyStore(); const s = JSON.parse(raw); return Object.assign(emptyStore(), s); }
  catch (e) { storageOK = false; return emptyStore(); }
}
let store = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); storageOK = true; }
  catch (e) { storageOK = false; }
}
const attemptsOf = sid => (store.attempts[sid] = store.attempts[sid] || []);
const findAttempt = id => { for (const sid in store.attempts) { const a = store.attempts[sid].find(x => x.id === id); if (a) return a; } return null; };

/* ------------------------------------------------------------------ barème */
const isXN = q => q.type === 'QRM' && q.props.length >= 6;
const corrLetters = q => q.answer.filter(l => !q.neutral.includes(l));
function maxSel(q) { if (isSingle(q)) return 1; if (isXN(q)) return corrLetters(q).length; return q.props.length; }
const STOP = ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd'];
function normTxt(s) {
  return String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2').replace(/\.(?!\d)/g, ' ').replace(/[’'`´]/g, ' ').replace(/[^a-z0-9.%]+/g, ' ')
    .split(' ').filter(w => w && !STOP.includes(w)).map(w => w.length > 3 ? w.replace(/[sx]$/, '') : w).join(' ');
}
function qrocAuto(q, txt) { const n = normTxt(txt); return !!n && (q.accepted || []).some(a => normTxt(a) === n); }
function isAnswered(q, a) {
  if (q.type === 'QROC') return !!(a && String(a).trim());
  if (q.type === 'ASSOC') return Array.isArray(a) && a.some(x => x);
  return Array.isArray(a) && a.length > 0;
}
/* renvoie un nombre 0..1, null si non noté, 'pending' si QROC à auto-évaluer */
function scoreQ(q, a, ev) {
  if (!q.scored) return null;
  if (q.type === 'QROC') {
    const txt = (a || '').trim();
    if (!txt) return 0;
    if (qrocAuto(q, txt)) return 1;
    return ev == null ? 'pending' : ev;
  }
  if (q.type === 'ASSOC') {
    const n = q.answer.length; if (!n) return null;
    const arr = a || []; let ok = 0; q.answer.forEach((l, i) => { if (arr[i] === l) ok++; }); return ok / n;
  }
  const sel = (a || []).filter(l => !q.neutral.includes(l));
  const corr = corrLetters(q);
  if (!corr.length) return null;
  if (!sel.length) return 0;
  if (q.type === 'TCS') { const w = q.weights || {}; return sel.length === 1 ? (w[sel[0]] || 0) : 0; }
  if (q.type === 'QRU') return sel.length === 1 && corr.includes(sel[0]) ? 1 : 0;
  if (isXN(q)) { const x = sel.filter(l => corr.includes(l)).length; return Math.min(1, x / corr.length); }
  if (q.indisp.some(l => !sel.includes(l)) || q.inacc.some(l => sel.includes(l))) return 0;
  let disc = 0;
  q.props.forEach(p => { if (!q.neutral.includes(p.l) && sel.includes(p.l) !== corr.includes(p.l)) disc++; });
  return [1, 0.5, 0.2][disc] != null ? [1, 0.5, 0.2][disc] : 0;
}
function scoreWhy(q, a, s) {
  if (!q.scored) return q.status || 'Question non comptée';
  if (q.type === 'QROC') {
    if (!(a || '').trim()) return 'Pas de réponse';
    return qrocAuto(q, a) ? 'Réponse reconnue automatiquement' : 'Note issue de ton auto-évaluation';
  }
  if (q.type === 'ASSOC') return 'Proportion d\'éléments bien associés';
  if (!isAnswered(q, a)) return 'Pas de réponse';
  if (q.type === 'QRU') return 'Réponse unique : 1 ou 0';
  if (q.type === 'TCS') return 'TCS : note = part du panel d\'experts ayant fait ce choix';
  if (isXN(q)) { const corr = corrLetters(q); const x = (a || []).filter(l => corr.includes(l)).length; return `${q.props.length} propositions : ${x} bonne(s) réponse(s) cochée(s) sur ${corr.length} attendue(s)`; }
  const sel = a || [];
  const mi = q.indisp.filter(l => !sel.includes(l)), ia = q.inacc.filter(l => sel.includes(l));
  if (mi.length) return `Proposition indispensable non cochée (${mi.join(', ')}) : 0`;
  if (ia.length) return `Proposition inacceptable cochée (${ia.join(', ')}) : 0`;
  const corr = corrLetters(q); let disc = 0;
  q.props.forEach(p => { if (!q.neutral.includes(p.l) && sel.includes(p.l) !== corr.includes(p.l)) disc++; });
  return disc === 0 ? 'Aucune discordance' : `${disc} discordance${disc > 1 ? 's' : ''}`;
}

/* ------------------------------------------------------------------ état d'interface */
const ui = {
  tab: 'reviser', screen: null,
  cycle: null,
  rev: { matiere: null, n: 25, content: 'mix', pool: 'all', subjects: null },
  carnet: { matiere: 'all', status: 'active', cause: 'all', n: 10 }, noteT: null,
  armed: null, toastT: null
};
function setCycle(id, persist) {
  ui.cycle = id; MATIERES = matieresOf(id);
  ui.rev.matiere = MATIERES[0] || null; ui.rev.subjects = null; ui.carnet.matiere = 'all';
  if (persist) { try { localStorage.setItem(CYCLE_KEY, id); } catch (e) {} }
}
(function initCycle() {
  let saved = null; try { saved = localStorage.getItem(CYCLE_KEY); } catch (e) {}
  const valid = id => CYCLES.some(c => c.id === id && c.n);
  if (saved && valid(saved)) return setCycle(saved);
  const used = Object.keys(store.attempts).length || Object.keys(store.rev).length;
  if (used && valid('C10')) return setCycle('C10', true);
  if (CYCLES.filter(c => c.n).length === 1) return setCycle(CYCLES.find(c => c.n).id, true);
})();
function cycleBar() {
  return `<nav class="cycles" aria-label="Cycle">${CYCLES.map(c => c.n
    ? `<button class="cyc" data-act="cycle" data-v="${c.id}" aria-pressed="${ui.cycle === c.id}"><b>${c.id}</b><span>${esc(c.label)}</span></button>`
    : `<button class="cyc" disabled aria-label="${c.id} ${esc(c.label)}, bientôt"><b>${c.id}</b><span>${esc(c.label)} · bientôt</span></button>`).join('')}</nav>`;
}
function viewCycleChoice() {
  return `<header class="top"><div class="brand"><span class="brand-mark">A·B·C·D·E</span></div><h1>Quel cycle révises-tu ?<span class="sub">Tu pourras en changer à tout moment, en haut de l'écran</span></h1></header>
  <div class="list">${CYCLES.map(c => c.n
    ? `<button class="item cyc-card" data-act="cycle" data-v="${c.id}"><span class="name">${c.id} · ${esc(c.label)}</span><span class="pill none">${c.n} sujet${c.n > 1 ? 's' : ''}</span><span class="meta">${matieresOf(c.id).map(m => `<span>${esc(m)}</span>`).join('')}</span></button>`
    : `<div class="item cyc-card" aria-disabled="true"><span class="name">${c.id} · ${esc(c.label)}</span><span class="pill none">bientôt</span></div>`).join('')}</div>`;
}
function toast(msg) {
  let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(ui.toastT); ui.toastT = setTimeout(() => { t.hidden = true; }, 2600);
}
function go(screen, tab) { if (tab) ui.tab = tab; ui.screen = screen; ui.armed = null; render(true); }

/* ------------------------------------------------------------------ rendu commun */
const ICONS = {
  reviser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
  sujets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  progression: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>',
  carnet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z"/><path d="M9 3v18"/><path d="m12.5 9 3 3m0-3-3 3"/></svg>',
  reglages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
function tabbar() {
  const t = [['reviser', 'Réviser'], ['sujets', 'Sujets'], ['carnet', 'Carnet'], ['progression', 'Progression'], ['reglages', 'Réglages']];
  return `<div class="tabbar"><nav aria-label="Navigation">${t.map(([k, l]) => `<button class="tab" data-act="tab" data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}>${ICONS[k]}<span>${l}</span></button>`).join('')}</nav></div>`;
}
function topbar(title, sub, back) {
  return `<header class="top">${back ? `<button class="icon-btn" data-act="${back}" aria-label="Retour">←</button>` : ''}<h1>${title}${sub ? `<span class="sub">${sub}</span>` : ''}</h1></header>`;
}
function blocks(list) {
  return (list || []).map(b => b.img ? `<img src="${esc(imgSrc(b.img))}" alt="Image de l'énoncé" data-act="zoom" loading="lazy">` : `<p>${esc(b.t)}</p>`).join('');
}
function contextBox(d, open) {
  if (!d.isBlock || !d.context.length) return '';
  return `<details class="context" ${open ? 'open' : ''}><summary>Énoncé du dossier ${esc(d.id)}${d.title ? ' — ' + esc(d.title) : ''}</summary>${blocks(d.context)}</details>`;
}
/* Mixte : l'énoncé de départ reste repliable, l'énoncé de la question précédente reste toujours visible */
function prevInfo(q) {
  if (!q.d.isBlock) return '';
  const i = q.d.questions.indexOf(q); if (i <= 0) return '';
  const p = q.d.questions[i - 1];
  return `<div class="context prev"><span class="eyebrow">Énoncé de la question ${p.n}</span>${blocks(p.stem)}</div>`;
}
function dossierNav(d, current, opts) {
  /* questions déjà passées : consultables en lecture seule ; question en cours ; suivantes : fermées */
  return `<nav class="qnav" aria-label="Questions du dossier">${d.questions.map((x, i) => {
    if (i < current) return `<button data-act="${opts.act}" data-i="${opts.target ? opts.target(i) : i}" class="done" ${opts.viewing === i ? 'aria-current="true"' : ''} aria-label="Revoir la question ${x.n}">${x.n}</button>`;
    if (i === current) return `<button data-act="${opts.backAct}" ${opts.viewing == null ? 'aria-current="true"' : ''} aria-label="Question en cours">${x.n}</button>`;
    return `<button disabled aria-label="Question ${x.n}, pas encore accessible">${x.n}</button>`;
  }).join('')}</nav>`;
}
function typeLabel(q) {
  if (q.type === 'QRU') return 'QRU';
  if (q.type === 'TCS') return 'TCS';
  if (q.type === 'QROC') return 'QROC';
  if (q.type === 'ASSOC') return 'Association';
  return isXN(q) ? 'QRM · ' + corrLetters(q).length + ' attendues' : 'QRM';
}

/* ------------------------------------------------------------------ « Comprendre mon erreur » (ChatGPT) */
/* Pas d'API ni de clé : ouvre ChatGPT avec le prompt prérempli (paramètre ?q=, non documenté officiellement)
   et copie le prompt dans le presse-papiers en secours. */
const AI_PROMPTS = {};
const AI_URL = 'https://chatgpt.com/?q=';
const AI_MAX_URL = 7000;
function blocksTxt(list) { return (list || []).map(b => b.img ? '[image non transmise]' : b.t).filter(Boolean).join('\n'); }
function clip(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n) + ' […]' : t; }
function myAnswerText(q, a) {
  if (q.type === 'QROC') return a && String(a).trim() ? String(a).trim() : 'pas de réponse';
  if (q.type === 'ASSOC') return q.items.map((it, i) => `${i + 1}→${(a || [])[i] || '—'}`).join(' ; ');
  const sel = a || []; if (!sel.length) return 'pas de réponse';
  return sel.map(l => { const p = q.props.find(x => x.l === l); return p ? `${l}. ${p.t}` : l; }).join(' ; ');
}
function aiPrompt(q, a, s, ctxMax) {
  const L = [];
  L.push('Tu es tuteur d\'un étudiant en médecine français en DFASM qui prépare les EDN.',
    'Réponds en français, en 8 lignes maximum.',
    'Appuie-toi uniquement sur les référentiels des Collèges des enseignants (programme R2C des EDN) et sur les recommandations françaises en vigueur (HAS, sociétés savantes françaises), au niveau attendu d\'un étudiant de DFASM.',
    'Si tu n\'es pas sûr, écris « je ne sais pas » plutôt que d\'inventer. Ne cite une source que si tu peux la nommer précisément (organisme, titre, année).', '');
  L.push(`Matière : ${q.s.matiere}`);
  if (q.d.isBlock) {
    const ctx = blocksTxt(q.d.context);
    if (ctx) L.push(`Énoncé du dossier (${q.d.id}) :`, clip(ctx, ctxMax));
    const prev = q.d.questions.filter(x => x.n < q.n).map(x => `Q${x.n} : ${clip(blocksTxt(x.stem), Math.max(200, ctxMax / 4))}`);
    if (prev.length) L.push('Énoncés des questions précédentes du dossier :', ...prev);
  }
  L.push('', `Question ${q.n} (${typeLabel(q)}) :`, blocksTxt(q.stem));
  if (q.type === 'ASSOC') L.push('Choix :', ...q.props.map(p => `${p.l}. ${p.t}`), 'Éléments à associer :', ...q.items.map((it, i) => `${i + 1}. ${it}`));
  else if (q.type !== 'QROC') L.push('Propositions :', ...q.props.map(p => `${p.l}. ${p.t}`));
  L.push('', `Réponse attendue par le corrigé : ${answerText(q)}`);
  if (q.indisp && q.indisp.length) L.push(`Propositions indispensables : ${q.indisp.join(', ')}`);
  if (q.inacc && q.inacc.length) L.push(`Propositions inacceptables : ${q.inacc.join(', ')}`);
  if (q.neutral && q.neutral.length) L.push(`Propositions neutralisées : ${q.neutral.join(', ')}`);
  if (q.type === 'TCS' && q.weights) L.push(`Répartition du panel d'experts : ${Object.keys(q.weights).map(k => `${k} = ${fmt(q.weights[k])}`).join(', ')}`);
  if (q.s.unofficial) L.push('Attention : corrigé non officiel (reconstitué par des étudiants).');
  L.push(`Ma réponse : ${myAnswerText(q, a)} (note obtenue : ${fmtScore(s)} / 1)`);
  const rem = [...(q.notes || []).filter(Boolean), ...(q.expl || []).map(e => `${e.l} : ${e.t}`)];
  if (rem.length) L.push('Remarques du corrigé :', ...rem);
  L.push('', '1. Pour chaque proposition où je me suis trompé, explique en une phrase pourquoi.',
    '2. Dis si le corrigé te paraît exact, discutable ou erroné, avec la source précise qui le justifie.',
    '3. Termine par une phrase « À retenir ».');
  return L.join('\n');
}
function aiLink(q, a, s) {
  const full = aiPrompt(q, a, s, 4000); AI_PROMPTS[q.key] = full;
  let url = AI_URL + encodeURIComponent(full), short = '';
  if (url.length > AI_MAX_URL) { url = AI_URL + encodeURIComponent(aiPrompt(q, a, s, 600)); short = 'ctx'; }
  if (url.length > AI_MAX_URL) { url = 'https://chatgpt.com/'; short = 'all'; }
  return `<div class="ai-row"><a class="btn sm ghost ai-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="ai" data-key="${esc(q.key)}" data-short="${short}">Comprendre mon erreur <span aria-hidden="true">↗</span></a><span class="small muted">Ouvre ChatGPT (ton compte) et copie la question. ChatGPT peut se tromper.</span></div>`;
}

/* rendu d'une question. mode : 'answer' | 'review' */
function renderQuestion(q, a, mode, opts = {}) {
  const review = mode === 'review'; const ro = !!opts.readonly;
  let h = `<div class="stem">${blocks(q.stem)}</div>`;
  if (!q.scored) h += `<div class="banner">${esc(q.status || 'Question non comptée')}</div>`;
  if (q.type === 'QRM' || isSingle(q)) {
    const mx = maxSel(q), sel = a || [];
    if (!review) {
      const hint = q.type === 'TCS' ? 'Une seule réponse : que devient ton hypothèse avec cette nouvelle information ?' : q.type === 'QRU' ? 'Une seule réponse possible' : isXN(q) ? `<span><b>${mx}</b> réponses attendues — sélection limitée à ${mx}</span><span class="cnt">${sel.length} / ${mx}</span>` : 'Une ou plusieurs réponses';
      h += `<div class="hint">${hint}</div>`;
    } else if (isXN(q)) h += `<div class="hint"><span><b>${mx}</b> réponses attendues</span></div>`;
    const corr = corrLetters(q);
    h += `<div class="opts" data-key="${esc(q.key)}">` + q.props.map(p => {
      const on = sel.includes(p.l); let cls = isSingle(q) ? 'single' : '';
      let tags = '';
      if (review) {
        if (q.neutral.includes(p.l)) { cls += ' neutral'; tags += '<span class="tag neu">neutralisée</span>'; }
        else if (on && corr.includes(p.l)) cls += ' ok';
        else if (on) cls += ' bad';
        else if (corr.includes(p.l)) cls += ' miss';
        if (on) tags += '<span class="tag mine">ta réponse</span>';
        if (q.indisp.includes(p.l)) tags += '<span class="tag must">indispensable</span>';
        if (q.inacc.includes(p.l)) tags += '<span class="tag never">inacceptable</span>';
        if (q.type === 'TCS' && q.weights) tags += `<span class="tag neu">panel : ${fmt(q.weights[p.l] || 0)}</span>`;
      }
      const ex = review ? q.expl.filter(e => e.l === p.l).map(e => `<div class="expl">${esc(e.t)}</div>`).join('') : '';
      return `<button class="opt ${cls}" ${review || ro ? 'disabled' : `data-act="opt" data-l="${p.l}"`} aria-pressed="${on}"><span class="bubble">${p.l}</span><span class="txt">${esc(p.t)}${tags ? `<span class="tags">${tags}</span>` : ''}${ex}</span></button>`;
    }).join('') + '</div>';
  } else if (q.type === 'QROC') {
    if (ro) h += `<div class="verdict info"><div><span class="muted small">Ta réponse</span><br><b>${esc(a && String(a).trim() ? a : '— pas de réponse —')}</b></div></div>`;
    else if (!review) h += `<label class="hint" for="qroc-in">Réponse courte (1 à 5 mots)</label><input class="text-in" id="qroc-in" data-act="qroc" data-key="${esc(q.key)}" value="${esc(a || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">`;
    else {
      h += `<div class="verdict info"><div><span class="muted small">Ta réponse</span><br><b>${esc(a && a.trim() ? a : '— pas de réponse —')}</b></div><div><span class="muted small">Réponse attendue</span><br><b>${esc((q.accepted || []).join(' / ') || q.answer)}</b></div></div>`;
    }
  } else if (q.type === 'ASSOC') {
    h += `<ol class="choices">${q.props.map(p => `<li><b>${p.l}</b> ${esc(p.t)}</li>`).join('')}</ol><p class="hint">Une même lettre peut servir plusieurs fois.</p><div class="assoc-items">` +
      q.items.map((it, i) => {
        const v = (a || [])[i] || '';
        if (review) { const c = q.answer[i]; return `<div class="assoc-row ${v === c ? 'ok' : 'bad'}"><span>${i + 1}. ${esc(it)}</span><span class="small">Ta réponse : <b>${esc(v || '—')}</b> · attendue : <b>${esc(c)}</b></span></div>`; }
        return `<div class="assoc-row"><label for="as-${i}">${i + 1}. ${esc(it)}</label><select id="as-${i}" ${ro ? 'disabled' : `data-act="assoc" data-i="${i}" data-key="${esc(q.key)}"`}><option value="">— choisir —</option>${q.props.map(p => `<option value="${p.l}" ${v === p.l ? 'selected' : ''}>${p.l} — ${esc(p.t.length > 60 ? p.t.slice(0, 58) + '…' : p.t)}</option>`).join('')}</select></div>`;
      }).join('') + '</div>';
  }
  if (review) {
    const s = opts.score;
    if (q.s.unofficial) h += `<div class="banner small">Corrigé non officiel (reconstitué) : réponses et barème à prendre avec recul.</div>`;
    if (s === 'pending') h += `<div class="verdict mid"><div>Ta réponse ne correspond pas mot pour mot à la réponse attendue. Note-toi honnêtement :</div><div class="row">${[[1, 'Juste · 1'], [0.5, 'Partiel · 0,5'], [0, 'Faux · 0']].map(([v, l]) => `<button class="btn sm ghost" data-act="${opts.evalAct || 'reval'}" data-key="${esc(q.key)}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
    else if (q.scored && !opts.noVerdict) h += `<div class="verdict ${s >= 0.999 ? 'good' : s > 0 ? 'mid' : 'zero'}"><span class="big">${fmtScore(s)} / 1</span><span class="small">${esc(scoreWhy(q, a, s))}</span></div>`;
    const notes = q.notes.filter(Boolean);
    if (notes.length) h += `<div class="notes"><span class="eyebrow">Remarques de correction</span>${notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>`;
    if (q.scored && typeof s === 'number' && s < 0.999 && !opts.noVerdict) h += aiLink(q, a, s);
  }
  return h;
}
function qHead(q, label) {
  return `<div class="qhead"><span class="qn">${esc(label)}</span><span class="pill type">${esc(typeLabel(q))}</span></div>`;
}

/* ------------------------------------------------------------------ onglet Réviser */
function revUnits(cfg) {
  const subs = DATA.subjects.filter(s => s.matiere === cfg.matiere && (!cfg.subjects || cfg.subjects.includes(s.id)));
  const units = [];
  subs.forEach(s => s.dossiers.forEach(d => {
    if (d.isBlock) { if (cfg.content !== 'qi') units.push({ keys: d.questions.map(q => q.key), block: true }); }
    else if (cfg.content !== 'dp') d.questions.filter(q => q.scored).forEach(q => units.push({ keys: [q.key], block: false }));
  }));
  const stat = k => store.rev[k];
  return units.filter(u => {
    const sc = u.keys.filter(k => QIDX[k].scored);
    if (cfg.pool === 'unseen') return sc.every(k => !stat(k));
    if (cfg.pool === 'missed') return sc.some(k => stat(k) && stat(k).last < 1);
    return true;
  });
}
function drawUnits(units, n) {
  const pool = shuffle(units.slice()); const tol = Math.max(2, Math.round(n * 0.15));
  const out = []; let count = 0;
  for (const u of pool) {
    const rem = n - count; if (rem <= 0) break;
    if (u.keys.length <= rem + (u.block ? tol : 0)) { out.push(u); count += u.keys.length; }
  }
  if (!out.length && pool.length) { const u = pool.slice().sort((a, b) => a.keys.length - b.keys.length)[0]; out.push(u); }
  return shuffle(out);
}
function viewReviser() {
  const r = ui.rev; const subs = DATA.subjects.filter(s => s.matiere === r.matiere);
  const units = revUnits(r); const avail = units.reduce((n, u) => n + u.keys.length, 0);
  const nb = units.filter(u => u.block).length;
  let h = `<header class="top"><div class="brand"><span class="brand-mark">A·B·C·D·E</span></div><h1>Réviser<span class="sub">Questions au hasard, correction immédiate</span></h1></header>` + cycleBar();
  if (!storageOK) h += `<div class="banner">Le stockage de ce navigateur est indisponible : ta progression ne sera pas conservée.</div>`;
  h += `<section class="panel"><span class="eyebrow">Matière</span><div class="chips">${MATIERES.map(m => `<button class="chip" data-act="rev-mat" data-v="${esc(m)}" aria-pressed="${r.matiere === m}">${esc(m)}</button>`).join('')}</div></section>`;
  h += `<section class="panel"><span class="eyebrow">Nombre de questions</span><div class="row">${[10, 25, 50].map(v => `<button class="chip" data-act="rev-n" data-v="${v}" aria-pressed="${r.n === v}">${v}</button>`).join('')}<label class="row small" for="rev-n-in">Autre <input class="num-input" id="rev-n-in" type="number" min="1" max="300" inputmode="numeric" value="${[10, 25, 50].includes(r.n) ? '' : r.n}" data-act="rev-n-in"></label></div>
  <p class="small muted">Un dossier progressif ou un KFP n'est jamais découpé : le total réel peut dépasser légèrement ton choix.</p></section>`;
  h += `<section class="panel"><span class="eyebrow">Contenu</span><div class="chips">${[['mix', 'Mélange'], ['qi', 'Questions isolées'], ['dp', 'Dossiers (DP, KFP)']].map(([k, l]) => `<button class="chip" data-act="rev-content" data-v="${k}" aria-pressed="${r.content === k}">${l}</button>`).join('')}</div>
  <span class="eyebrow">Questions</span><div class="chips">${[['all', 'Toutes'], ['unseen', 'Jamais faites'], ['missed', 'Déjà ratées']].map(([k, l]) => `<button class="chip" data-act="rev-pool" data-v="${k}" aria-pressed="${r.pool === k}">${l}</button>`).join('')}</div></section>`;
  h += `<section class="panel"><span class="eyebrow">Sujets inclus</span>${subs.map(s => `<label class="check"><input type="checkbox" data-act="rev-sub" data-v="${s.id}" ${!r.subjects || r.subjects.includes(s.id) ? 'checked' : ''}><span>${esc(s.title)}<br><span class="small muted">${esc(s.source)} · ${scoredCount(s)} questions</span></span></label>`).join('')}</section>`;
  h += `<p class="small muted" style="margin:0">Disponibles avec ces filtres : <b>${avail}</b> questions, dont ${nb} dossier${nb > 1 ? 's' : ''}.</p>`;
  h += `<button class="btn block" data-act="rev-start" ${avail ? '' : 'disabled'}>Lancer ${r.n} questions</button>`;
  return h;
}
function startRevision() {
  const units = drawUnits(revUnits(ui.rev), ui.rev.n);
  if (!units.length) { toast('Aucune question ne correspond à ces filtres.'); return; }
  const keys = units.flatMap(u => u.keys);
  ui.screen = { type: 'rev', keys, i: 0, phase: 'answer', ans: {}, ev: {}, sc: {}, blocks: units.filter(u => u.block).length, matiere: ui.rev.matiere };
  render(true);
}
function viewRevSession() {
  const S = ui.screen;
  const cur = QIDX[S.keys[S.i]];
  const pos = cur.d.isBlock && !S.carnet ? S.keys.map((k, j) => [k, j]).filter(([k]) => QIDX[k].d === cur.d) : [];
  const curIdx = pos.findIndex(([, j]) => j === S.i);
  const navDossier = curIdx > 0 && !S.fromSummary;
  if (navDossier && S.view != null && S.view < S.i) {
    const v = QIDX[S.keys[S.view]]; const vIdx = pos.findIndex(([, j]) => j === S.view);
    let h = topbar(`Révision · ${esc(v.d.id)} Q${v.n}`, 'Lecture seule · ' + esc(v.s.title), 'rev-quit');
    h += dossierNav(cur.d, curIdx, { act: 'rev-view', backAct: 'rev-current', viewing: vIdx, target: i => pos[i][1] });
    h += contextBox(v.d, vIdx === 0) + prevInfo(v);
    h += `<section class="panel"><div class="banner small">Question déjà corrigée : relecture seule.</div>${qHead(v, `${v.d.id} · Q${v.n}/${v.d.questions.length}`)}${renderQuestion(v, S.ans[v.key], 'review', { score: S.sc[v.key], readonly: true })}</section>`;
    h += `<div class="actionbar"><div class="inner"><button class="btn" data-act="rev-current">Revenir à la Q${cur.n}</button></div></div>`;
    return h;
  }
  delete S.view;
  const q = cur; const a = S.ans[q.key];
  const firstOfDossier = S.i === 0 || QIDX[S.keys[S.i - 1]].d !== q.d;
  const label = q.d.isBlock ? `${q.d.id} · Q${q.n}/${q.d.questions.length}` : `Question ${S.i + 1}`;
  let h = topbar(`${S.carnet ? 'Carnet' : 'Révision'} · ${S.i + 1}/${S.keys.length}`, `${esc(S.matiere)} · ${esc(q.s.title)}`, 'rev-quit');
  if (navDossier) h += dossierNav(q.d, curIdx, { act: 'rev-view', backAct: 'rev-current', viewing: null, target: i => pos[i][1] });
  h += S.carnet ? contextBox(q.d, true) + prevStems(q) : contextBox(q.d, firstOfDossier) + prevInfo(q);
  const sc = S.sc[q.key]; const showAnnot = S.phase === 'review' && typeof sc === 'number' && sc < 0.999 && store.carnet[q.key];
  h += `<section class="panel">${qHead(q, label)}${renderQuestion(q, a, S.phase === 'answer' ? 'answer' : 'review', { score: sc, evalAct: 'rev-eval' })}${showAnnot ? annotBox(q.key) : ''}</section>`;
  const last = S.i === S.keys.length - 1;
  let btn;
  if (S.phase === 'answer') btn = `<button class="btn" data-act="rev-validate">Valider</button>`;
  else btn = `<button class="btn" data-act="rev-next" ${S.sc[q.key] === 'pending' && !S.fromSummary ? 'disabled' : ''}>${last ? 'Voir le bilan' : 'Question suivante'}</button>`;
  if (S.fromSummary) btn = `<button class="btn ghost" data-act="rev-quit">Bilan</button>` + btn;
  h += `<div class="actionbar"><div class="inner">${btn}</div></div>`;
  return h;
}
function recordRev(q, s, a) {
  if (s == null || s === 'pending') return;
  const r = store.rev[q.key] || { n: 0, sum: 0 };
  r.n++; r.sum += s; r.last = s; r.t = Date.now(); store.rev[q.key] = r;
  const res = carnetRecord(q, s, a, ui.screen && ui.screen.carnet ? 'carnet' : 'rev');
  save();
  if (res === 'mastered') toast('Erreur maîtrisée : elle sort du carnet.');
  else if (res === 'progress') toast('Réussie : 1 sur 2 pour sortir du carnet (un autre jour).');
}

/* ------------------------------------------------------------------ carnet d'erreurs */
const CAUSES = [['savais', 'Je ne savais pas'], ['lu', 'Lu trop vite'], ['piege', 'Piège de formulation'], ['calcul', 'Calcul'], ['hesite', "J'ai hésité et changé"]];
const causeLabel = k => (CAUSES.find(c => c[0] === k) || [0, 'Non renseignée'])[1];
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
/* s < 1 : l'erreur entre (ou revient) dans le carnet.
   s = 1 : compte comme réussite seulement un autre jour que celui de l'erreur et de la réussite précédente ;
   2 réussites ainsi espacées = erreur maîtrisée (archivée). */
function carnetRecord(q, s, a, src, t, legacy) {
  if (s == null || s === 'pending' || !q.scored) return null;
  t = t || Date.now(); const C = store.carnet; let e = C[q.key];
  if (s < 0.999) {
    if (!legacy && src !== 'carnet' && !isAnswered(q, a)) return null;
    if (!e) e = C[q.key] = { added: t, cause: null, note: '', hist: [] };
    Object.assign(e, { ans: a == null ? null : JSON.parse(JSON.stringify(a)), score: s, lastWrong: t, src, streak: 0, okDay: null, archived: false });
    e.hist.push({ t, s, src }); if (e.hist.length > 20) e.hist.shift();
    return 'added';
  }
  if (!e || e.archived) return null;
  e.hist.push({ t, s, src }); if (e.hist.length > 20) e.hist.shift();
  const dk = dayKey(t);
  if (dk === dayKey(e.lastWrong) || dk === e.okDay) return 'sameday';
  e.streak = (e.streak || 0) + 1; e.okDay = dk;
  if (e.streak >= 2) { e.archived = true; e.archivedAt = t; return 'mastered'; }
  return 'progress';
}
function migrateCarnet() {
  if (store.carnetInit) return;
  store.carnet = store.carnet || {};
  const ev = [];
  Object.values(store.attempts).forEach(list => list.filter(a => a.status === 'termine' && SUBJ[a.sid]).forEach(a => {
    subjQuestions(SUBJ[a.sid]).forEach(q => ev.push({ t: a.end, q, s: scoreQ(q, a.ans[q.key], a.ev[q.key]), a: a.ans[q.key], src: 'exam' }));
  }));
  Object.keys(store.rev).forEach(k => { const r = store.rev[k]; if (QIDX[k] && r.last < 1) ev.push({ t: r.t, q: QIDX[k], s: r.last, a: null, src: 'rev', legacy: true }); });
  ev.sort((x, y) => x.t - y.t).forEach(x => carnetRecord(x.q, x.s, x.a, x.src, x.t, x.legacy));
  store.carnetInit = 1; save();
}
function answerText(q) {
  if (q.type === 'QROC') return (q.accepted || []).join(' / ') || String(q.answer);
  if (q.type === 'ASSOC') return q.items.map((it, i) => `${i + 1}→${q.answer[i]}`).join(' ; ');
  return corrLetters(q).map(l => { const p = q.props.find(x => x.l === l); return p ? `${l}. ${p.t}` : l; }).join(' ; ');
}
function annotBox(key) {
  const e = store.carnet[key]; if (!e) return '';
  return `<div class="annot" data-key="${esc(key)}"><span class="eyebrow">Carnet d'erreurs · pourquoi ? (facultatif)</span>
  <div class="chips">${CAUSES.map(([k, l]) => `<button class="chip sm" data-act="cause" data-key="${esc(key)}" data-v="${k}" aria-pressed="${e.cause === k}">${l}</button>`).join('')}</div>
  <label class="small muted" for="note-${esc(key)}">À retenir</label><textarea class="note-in" id="note-${esc(key)}" data-act="note" data-key="${esc(key)}" rows="2" placeholder="Ce que je dois retenir pour ne plus me tromper">${esc(e.note || '')}</textarea></div>`;
}
function prevStems(q) {
  if (!q.d.isBlock) return '';
  const prev = q.d.questions.filter(x => x.n < q.n);
  if (!prev.length) return '';
  return `<details class="context"><summary>Questions précédentes du dossier (${prev.length})</summary>${prev.map(x => `<div><span class="eyebrow">Q${x.n}</span>${blocks(x.stem)}</div>`).join('')}</details>`;
}
function carnetList(f) {
  return Object.keys(store.carnet).filter(k => QIDX[k]).map(k => ({ k, e: store.carnet[k], q: QIDX[k] }))
    .filter(x => x.q.s.cycle === ui.cycle && (f.matiere === 'all' || x.q.s.matiere === f.matiere) && (f.status === 'mastered' ? x.e.archived : !x.e.archived) && (f.cause === 'all' || (f.cause === 'none' ? !x.e.cause : x.e.cause === f.cause)))
    .sort((a, b) => (f.status === 'mastered' ? b.e.archivedAt - a.e.archivedAt : b.e.lastWrong - a.e.lastWrong));
}
function canProgressToday(e) { const dk = dayKey(Date.now()); return dk !== dayKey(e.lastWrong) && dk !== e.okDay; }
function viewCarnet() {
  const f = ui.carnet; const fm = { matiere: f.matiere, status: 'active', cause: 'all' };
  const active = carnetList(fm); const ready = active.filter(x => canProgressToday(x.e)).length;
  const mastered = carnetList({ matiere: f.matiere, status: 'mastered', cause: 'all' }).length;
  let h = `<header class="top"><h1>Carnet d'erreurs<span class="sub">${esc(cycleLabel(ui.cycle))} · ${active.length} à retravailler · ${mastered} maîtrisée${mastered > 1 ? 's' : ''}</span></h1></header>` + cycleBar();
  h += `<section class="panel"><div class="chips">${[['all', 'Toutes matières'], ...MATIERES.map(m => [m, m])].map(([k, l]) => `<button class="chip" data-act="carnet-mat" data-v="${esc(k)}" aria-pressed="${f.matiere === k}">${esc(l)}</button>`).join('')}</div>`;
  if (active.length) {
    h += `<span class="eyebrow">Refaire mes erreurs</span><div class="chips">${[[10, '10'], [20, '20'], [0, 'Toutes']].map(([v, l]) => `<button class="chip" data-act="carnet-n" data-v="${v}" aria-pressed="${f.n === v}">${l}</button>`).join('')}</div>
    <button class="btn block" data-act="carnet-start">Refaire ${f.n && f.n < active.length ? f.n : active.length} erreur${active.length > 1 ? 's' : ''}</button>
    <p class="small muted" style="margin:0">Une erreur sort du carnet après 2 réussites, un autre jour que celui de l'erreur et à deux jours différents. ${ready} peuvent progresser aujourd'hui ; les autres sont reposées en dernier.</p>`;
  }
  h += `</section>`;
  const ann = active.filter(x => x.e.cause);
  if (active.length) {
    const counts = CAUSES.map(([k, l]) => [l, active.filter(x => x.e.cause === k).length]).concat([['Non renseignée', active.length - ann.length]]);
    h += `<section class="panel"><span class="eyebrow">Pourquoi tu te trompes</span><div class="bars">${counts.map(([l, n]) => `<div class="bar-row wide"><span class="lbl">${esc(l)}</span><span class="bar"><i style="width:${(n / active.length * 100).toFixed(1)}%"></i></span><span class="v">${n}</span></div>`).join('')}</div>
    ${ann.length ? `<p class="small muted" style="margin:0">${ann.length > 1 ? `Sur les ${ann.length} erreurs annotées` : 'Sur la seule erreur annotée'}, la cause principale est « ${esc(counts.slice(0, -1).sort((a, b) => b[1] - a[1])[0][0])} ».</p>` : '<p class="small muted" style="margin:0">Annote quelques erreurs pour voir ce qui revient le plus.</p>'}</section>`;
  }
  const list = carnetList(f);
  h += `<div class="chips">${[['active', 'À retravailler'], ['mastered', 'Maîtrisées']].map(([k, l]) => `<button class="chip" data-act="carnet-status" data-v="${k}" aria-pressed="${f.status === k}">${l}</button>`).join('')}</div>
  <div class="chips">${[['all', 'Toutes causes'], ...CAUSES, ['none', 'Non renseignée']].map(([k, l]) => `<button class="chip sm" data-act="carnet-cause" data-v="${k}" aria-pressed="${f.cause === k}">${esc(l)}</button>`).join('')}</div>`;
  if (!list.length) h += `<p class="empty">${Object.keys(store.carnet).length ? 'Rien dans cette catégorie.' : 'Aucune erreur pour l\'instant. Les questions ratées en révision ou en examen arrivent ici automatiquement.'}</p>`;
  else h += `<div class="list">${list.map((x, i) => `<button class="item" data-act="carnet-see" data-i="${i}"><span class="name">${esc(x.q.s.title)} · ${esc(x.q.d.id)} Q${x.q.n}</span><span class="sc ${scClass(x.e.score)}">${fmtScore(x.e.score)}</span><span class="meta"><span class="clip">${esc((x.q.stem.find(b => b.t) || {}).t || '')}</span><span>${esc(causeLabel(x.e.cause))}</span>${x.e.archived ? '<span>Maîtrisée</span>' : `<span>Réussites ${x.e.streak || 0}/2</span>`}${x.e.note ? '<span>Note ✎</span>' : ''}<span>${dateFr(x.e.lastWrong)}</span></span></button>`).join('')}</div>`;
  if (list.length) h += `<button class="btn ghost block" data-act="carnet-export">Copier ces erreurs et mes notes</button><textarea class="dump" id="carnet-dump" readonly hidden></textarea>`;
  return h;
}
function startCarnet(keys) {
  if (!keys.length) { toast('Aucune erreur à refaire.'); return; }
  ui.screen = { type: 'rev', keys, i: 0, phase: 'answer', ans: {}, ev: {}, sc: {}, matiere: 'Carnet d\'erreurs', carnet: true };
  render(true);
}
function pickCarnet() {
  const f = ui.carnet; const act = carnetList({ matiere: f.matiere, status: 'active', cause: 'all' });
  const ready = shuffle(act.filter(x => canProgressToday(x.e))), later = shuffle(act.filter(x => !canProgressToday(x.e)));
  const all = ready.concat(later).map(x => x.k);
  return f.n ? all.slice(0, f.n) : all;
}
function viewCarnetDetail() {
  const S = ui.screen; const k = S.keys[S.idx]; const e = store.carnet[k]; const q = QIDX[k];
  let h = topbar(`${esc(q.d.id)} · Q${q.n}`, `${esc(q.s.title)} · ${S.idx + 1}/${S.keys.length}`, 'carnet-back');
  h += contextBox(q.d, false) + prevStems(q);
  if (!e) return h + '<p class="empty">Cette erreur a été retirée.</p>';
  if (e.ans == null) h += `<div class="banner">Erreur enregistrée avant la création du carnet : ta réponse n'a pas été conservée (note obtenue : ${fmtScore(e.score)}). Les bonnes réponses sont en pointillés verts.</div>`;
  h += `<section class="panel">${qHead(q, 'Question ' + q.n)}${renderQuestion(q, e.ans || (q.type === 'QROC' ? '' : []), 'review', { score: e.score, noVerdict: e.ans == null })}${annotBox(k)}</section>`;
  h += `<section class="panel"><dl class="kv"><dt>Statut</dt><dd>${e.archived ? 'Maîtrisée le ' + dateFr(e.archivedAt) : `À retravailler · réussites ${e.streak || 0}/2`}</dd><dt>Dernière erreur</dt><dd>${dateFr(e.lastWrong)} (${{ rev: 'révision', exam: 'examen', carnet: 'carnet' }[e.src] || ''})</dd><dt>Historique</dt><dd>${e.hist.slice(-8).map(x => `<span class="sc ${scClass(x.s)}">${fmtScore(x.s)}</span>`).join(' ')}</dd></dl>
  <div class="row"><button class="btn sm" data-act="carnet-redo-one">Refaire cette question</button>${e.archived ? '<button class="btn sm ghost" data-act="carnet-restore">Remettre dans le carnet</button>' : '<button class="btn sm ghost" data-act="carnet-archive" data-confirm="Marquer comme maîtrisée ?">Marquer comme maîtrisée</button>'}</div></section>`;
  h += `<div class="actionbar"><div class="inner"><button class="btn ghost" data-act="carnet-prev" ${S.idx === 0 ? 'disabled' : ''}>Précédente</button><button class="btn" data-act="carnet-next" ${S.idx === S.keys.length - 1 ? 'disabled' : ''}>Suivante</button></div></div>`;
  return h;
}
function carnetExport(list) {
  const lines = [`CARNET D'ERREURS — copié le ${new Date().toLocaleDateString('fr-FR')}`, ''];
  let cur = null;
  list.forEach(x => {
    if (x.q.s.matiere !== cur) { cur = x.q.s.matiere; lines.push(`== ${cur} ==`, ''); }
    const st = (x.q.stem.filter(b => b.t).map(b => b.t).join(' ') || '').slice(0, 220);
    lines.push(`[${x.q.s.title} · ${x.q.d.id} Q${x.q.n}] ${st}`, `Réponse attendue : ${answerText(x.q)}`, `Cause : ${causeLabel(x.e.cause)}`);
    if (x.e.note) lines.push(`À retenir : ${x.e.note}`);
    lines.push('');
  });
  return lines.join('\n');
}
function viewRevSummary() {
  const S = ui.screen; const qs = S.keys.map(k => QIDX[k]).filter(q => q.scored);
  const tot = qs.reduce((n, q) => n + (typeof S.sc[q.key] === 'number' ? S.sc[q.key] : 0), 0);
  let h = topbar('Bilan de la révision', esc(S.matiere), 'rev-done');
  h += `<section class="panel"><div class="hero-score"><span class="n">${fmt(qs.length ? tot / qs.length * 20 : 0, 2)}</span><span class="d">/ 20</span></div><p class="small muted" style="margin:0">${fmt(tot, 2)} point${tot >= 2 ? 's' : ''} sur ${qs.length} questions notées.</p></section>`;
  h += `<div class="list">${S.keys.map((k, i) => { const q = QIDX[k]; const s = S.sc[k]; return `<button class="res-item" data-act="rev-see" data-i="${i}"><span class="q">${esc(q.d.id)} Q${q.n}</span><span class="s">${esc((q.stem.find(b => b.t) || {}).t || '')}</span><span class="sc ${scClass(typeof s === 'number' ? s : null)}">${fmtScore(typeof s === 'number' ? s : null)}</span></button>`; }).join('')}</div>`;
  h += `<div class="actionbar"><div class="inner"><button class="btn ghost" data-act="rev-done">Terminer</button><button class="btn" data-act="rev-again">Nouvelle série</button></div></div>`;
  return h;
}

/* ------------------------------------------------------------------ onglet Sujets / examen */
function subjStatus(sid) {
  const at = attemptsOf(sid);
  const run = at.find(a => a.status !== 'termine');
  const done = at.filter(a => a.status === 'termine');
  const last = done[done.length - 1];
  const best = done.reduce((m, a) => Math.max(m, a.result.note20), -1);
  return { run, done, last, best: best < 0 ? null : best };
}
function statusPill(st) {
  if (st.run) return '<span class="pill run">En cours</span>';
  if (st.done.length) return '<span class="pill done">Terminé</span>';
  return '<span class="pill none">Jamais fait</span>';
}
function viewSujets() {
  let h = `<header class="top"><h1>Sujets<span class="sub">Mode examen : le sujet complet, la note à la fin</span></h1></header>` + cycleBar();
  MATIERES.forEach(m => {
    h += `<h2 class="section-title">${esc(m)}</h2><div class="list">`;
    DATA.subjects.filter(s => s.matiere === m).forEach(s => {
      const st = subjStatus(s.id);
      h += `<button class="item" data-act="subject" data-sid="${s.id}"><span class="name">${esc(s.title)}</span>${statusPill(st)}<span class="meta"><span>${esc(s.source)}</span><span>${scoredCount(s)} questions · ${s.dossiers.filter(d => d.isBlock).length} dossiers</span>${st.last ? `<span>Dernier : <b class="score">${fmt(st.last.result.note20)}/20</b></span>` : ''}</span></button>`;
    });
    h += '</div>';
  });
  return h;
}
function answeredCount(at) { return Object.keys(at.ans).filter(k => QIDX[k] && isAnswered(QIDX[k], at.ans[k])).length; }
function viewSubject() {
  const s = SUBJ[ui.screen.sid]; const st = subjStatus(s.id); const total = subjQuestions(s).length;
  let h = topbar(esc(s.title), `${esc(s.matiere)} · ${esc(s.source)}`, 'back-tab');
  if (s.unofficial) h += `<div class="banner">Ce sujet n'a pas de correction officielle : le corrigé a été reconstitué. Certaines questions sont signalées « barème discutable » ou « nuance » dans les remarques.</div>`;
  h += `<section class="panel"><dl class="kv"><dt>Questions</dt><dd>${total} (${scoredCount(s)} notées)</dd><dt>Dossiers</dt><dd>${s.dossiers.map(d => `${d.id} (${d.questions.length})`).join(' · ')}</dd><dt>Passages</dt><dd>${st.done.length} terminé${st.done.length > 1 ? 's' : ''}</dd>${st.last ? `<dt>Dernier</dt><dd><b class="score">${fmt(st.last.result.note20)}/20</b> · ${dateFr(st.last.end)}</dd><dt>Meilleur</dt><dd><b class="score">${fmt(st.best)}/20</b></dd>` : ''}</dl></section>`;
  if (st.run) {
    h += `<button class="btn block" data-act="exam-resume" data-id="${st.run.id}">Reprendre (${answeredCount(st.run)}/${total} répondues)</button>`;
    h += `<button class="btn block ghost" data-act="exam-restart" data-sid="${s.id}" data-confirm="Abandonner le passage en cours ?">Recommencer à zéro</button>`;
  } else h += `<button class="btn block" data-act="exam-start" data-sid="${s.id}">${st.done.length ? 'Refaire le sujet' : 'Commencer le sujet'}</button>`;
  if (st.done.length) {
    h += `<h2 class="section-title">Historique</h2><div class="list">${st.done.slice().reverse().map((a, i) => `<button class="item" data-act="results" data-id="${a.id}"><span class="name">Passage ${st.done.length - i}</span><span class="score">${fmt(a.result.note20)}/20</span><span class="meta"><span>${dateFr(a.end)}</span><span>${fmt(a.result.pts)} pts sur ${a.result.n}</span></span></button>`).join('')}</div>`;
    h += `<div class="stack"><button class="btn block danger" data-act="del-last" data-sid="${s.id}" data-confirm="Supprimer définitivement ce passage ?">Supprimer mon dernier passage</button><button class="btn block danger" data-act="reset-subj" data-sid="${s.id}" data-confirm="Tout effacer pour ce sujet ?">Réinitialiser ce sujet</button></div>`;
  }
  return h;
}
function newAttempt(sid) {
  const at = { id: uid(), sid, start: Date.now(), status: 'en_cours', ans: {}, locked: {}, ev: {}, pos: {} };
  attemptsOf(sid).push(at); save(); return at;
}
function viewExamSommaire() {
  const at = findAttempt(ui.screen.id); const s = SUBJ[at.sid]; const total = subjQuestions(s).length;
  let h = topbar(esc(s.title), `Mode examen · ${answeredCount(at)}/${total} répondues`, 'back-subject');
  h += `<p class="small muted" style="margin:0">Tu peux traiter les dossiers dans l'ordre que tu veux. Dans un DP ou un KFP, une réponse validée est définitive.</p><div class="list">`;
  s.dossiers.forEach(d => {
    const n = d.questions.length; let state, pill;
    if (d.isBlock) { const lk = d.questions.filter(q => at.locked[q.key]).length; state = lk === n ? 'Terminé' : lk ? `En cours · Q${lk + 1}/${n}` : 'Non commencé'; pill = lk === n ? 'done' : lk ? 'run' : 'none'; }
    else { const an = d.questions.filter(q => isAnswered(q, at.ans[q.key])).length; state = `${an}/${n} répondues`; pill = an === n ? 'done' : an ? 'run' : 'none'; }
    h += `<button class="item" data-act="exam-dossier" data-did="${d.id}"><span class="name">${esc(d.id)}${d.title ? ' — ' + esc(d.title) : ''}</span><span class="pill ${pill}">${state}</span><span class="meta"><span>${kindLabel[d.kind]}</span><span>${n} question${n > 1 ? 's' : ''}</span></span></button>`;
  });
  h += '</div>';
  const missing = total - answeredCount(at);
  h += `<div class="actionbar"><div class="inner"><button class="btn" data-act="exam-finish" ${missing ? `data-confirm="${missing} question${missing > 1 ? 's' : ''} sans réponse : terminer quand même ?"` : ''}>Terminer le sujet</button></div></div>`;
  return h;
}
function viewExamDossier() {
  const at = findAttempt(ui.screen.id); const s = SUBJ[at.sid]; const d = s.dossiers.find(x => x.id === ui.screen.did);
  let idx;
  if (d.isBlock) { idx = d.questions.findIndex(q => !at.locked[q.key]); if (idx < 0) { go({ type: 'exam', id: at.id }); return ''; } }
  else idx = Math.min(ui.screen.idx || 0, d.questions.length - 1);
  at.pos[d.id] = idx; const q = d.questions[idx];
  const view = d.isBlock && ui.screen.view != null && ui.screen.view < idx ? ui.screen.view : null;
  if (view != null) {
    const v = d.questions[view];
    let h = topbar(`${esc(d.id)} · Q${v.n}/${d.questions.length}`, 'Lecture seule · ' + esc(d.title || kindLabel[d.kind]), 'exam-sommaire');
    h += dossierNav(d, idx, { act: 'exam-view', backAct: 'exam-current', viewing: view });
    h += contextBox(d, view === 0) + prevInfo(v);
    h += `<section class="panel"><div class="banner small">Question déjà validée : tu peux la relire avec ta réponse, plus la modifier.</div>${qHead(v, 'Question ' + v.n)}${renderQuestion(v, at.ans[v.key], 'answer', { readonly: true })}</section>`;
    h += `<div class="actionbar"><div class="inner"><button class="btn ghost" data-act="exam-view" data-i="${view - 1}" ${view === 0 ? 'disabled' : ''}>Précédente</button><button class="btn" data-act="exam-current">Revenir à la Q${q.n}</button></div></div>`;
    return h;
  }
  let h = topbar(`${esc(d.id)} · Q${q.n}/${d.questions.length}`, esc(d.title || kindLabel[d.kind]), 'exam-sommaire');
  if (!d.isBlock) h += `<nav class="qnav" aria-label="Questions">${d.questions.map((x, i) => `<button data-act="exam-jump" data-i="${i}" class="${isAnswered(x, at.ans[x.key]) ? 'done' : ''}" ${i === idx ? 'aria-current="true"' : ''}>${x.n}</button>`).join('')}</nav>`;
  else if (idx > 0) h += dossierNav(d, idx, { act: 'exam-view', backAct: 'exam-current', viewing: null });
  h += contextBox(d, idx === 0) + prevInfo(q);
  h += `<section class="panel">${qHead(q, 'Question ' + q.n)}${renderQuestion(q, at.ans[q.key], 'answer')}</section>`;
  if (d.isBlock) {
    const empty = !isAnswered(q, at.ans[q.key]);
    h += `<div class="actionbar"><div class="inner"><button class="btn" data-act="exam-lock" ${empty ? 'data-confirm="Valider sans réponse ?"' : ''}>${idx === d.questions.length - 1 ? 'Valider et finir le dossier' : 'Valider et continuer'}</button></div></div>`;
  } else {
    h += `<div class="actionbar"><div class="inner"><button class="btn ghost" data-act="exam-prev" ${idx === 0 ? 'disabled' : ''}>Précédente</button><button class="btn" data-act="${idx === d.questions.length - 1 ? 'exam-sommaire' : 'exam-next'}">${idx === d.questions.length - 1 ? 'Sommaire' : 'Suivante'}</button></div></div>`;
  }
  return h;
}
function pendingQroc(at) {
  return subjQuestions(SUBJ[at.sid]).filter(q => q.type === 'QROC' && scoreQ(q, at.ans[q.key], at.ev[q.key]) === 'pending');
}
function viewExamEval() {
  const at = findAttempt(ui.screen.id); const s = SUBJ[at.sid];
  const list = subjQuestions(s).filter(q => q.type === 'QROC' && q.scored && (at.ans[q.key] || '').trim() && !qrocAuto(q, at.ans[q.key]));
  const left = list.filter(q => at.ev[q.key] == null).length;
  let h = topbar('Auto-évaluation des QROC', `${esc(s.title)} · avant la note finale`, null);
  h += `<p class="small muted" style="margin:0">Ces réponses ne correspondent pas mot pour mot à la correction. Compare et note-toi : juste (1), partiel (0,5) ou faux (0).</p>`;
  list.forEach(q => {
    const v = at.ev[q.key];
    h += `<section class="panel">${qHead(q, q.d.id + ' · Q' + q.n)}<div class="stem small">${blocks(q.stem.filter(b => b.t).slice(-1))}</div><div class="verdict info"><div><span class="muted small">Ta réponse</span><br><b>${esc(at.ans[q.key])}</b></div><div><span class="muted small">Réponse attendue</span><br><b>${esc(q.accepted.join(' / '))}</b></div></div><div class="chips">${[[1, 'Juste · 1'], [0.5, 'Partiel · 0,5'], [0, 'Faux · 0']].map(([x, l]) => `<button class="chip" data-act="exam-eval" data-key="${esc(q.key)}" data-v="${x}" aria-pressed="${v === x}">${l}</button>`).join('')}</div></section>`;
  });
  h += `<div class="actionbar"><div class="inner"><button class="btn" data-act="exam-close" ${left ? 'disabled' : ''}>${left ? `Encore ${left} à noter` : 'Voir ma note'}</button></div></div>`;
  return h;
}
function computeResult(at) {
  const s = SUBJ[at.sid]; let pts = 0, n = 0; const per = {};
  s.dossiers.forEach(d => {
    let dp = 0, dn = 0;
    d.questions.forEach(q => { const sc = scoreQ(q, at.ans[q.key], at.ev[q.key]); if (sc == null) return; const v = typeof sc === 'number' ? sc : 0; dp += v; dn++; });
    per[d.id] = { pts: dp, n: dn, note20: dn ? dp / dn * 20 : 0 }; pts += dp; n += dn;
  });
  return { pts, n, note20: n ? pts / n * 20 : 0, per };
}
function closeAttempt(at) {
  at.result = computeResult(at); at.status = 'termine'; at.end = Date.now();
  subjQuestions(SUBJ[at.sid]).forEach(q => carnetRecord(q, scoreQ(q, at.ans[q.key], at.ev[q.key]), at.ans[q.key], 'exam', at.end));
  save();
}
function finishExam(at) {
  s_lockAll(at);
  if (pendingQroc(at).length) { at.status = 'eval'; save(); go({ type: 'eval', id: at.id }); }
  else { closeAttempt(at); go({ type: 'results', id: at.id, filter: 'all' }); }
}
function s_lockAll(at) { subjQuestions(SUBJ[at.sid]).forEach(q => { at.locked[q.key] = true; }); }
function viewResults() {
  const at = findAttempt(ui.screen.id); const s = SUBJ[at.sid]; const r = at.result; const f = ui.screen.filter || 'all';
  let h = topbar('Résultats', `${esc(s.title)} · ${dateFr(at.end)}`, 'back-subject');
  h += `<section class="panel"><div class="hero-score"><span class="n">${fmt(r.note20)}</span><span class="d">/ 20</span></div><p class="small muted" style="margin:0">${fmt(r.pts)} points sur ${r.n} questions notées (moyenne des questions × 20).</p>
  <div class="bars">${s.dossiers.map(d => { const p = r.per[d.id]; return `<div class="bar-row"><span class="lbl">${esc(d.id)}</span><span class="bar"><i style="width:${(p.note20 / 20 * 100).toFixed(1)}%"></i></span><span class="v">${fmt(p.note20, 1)}</span></div>`; }).join('')}</div></section>`;
  const items = resultList(at, f);
  h += `<div class="chips">${[['all', 'Toutes'], ['err', 'Mes erreurs'], ['empty', 'Sans réponse']].map(([k, l]) => `<button class="chip" data-act="res-filter" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>`;
  h += items.length ? `<div class="list">${items.map((q, i) => { const sc = scoreQ(q, at.ans[q.key], at.ev[q.key]); const v = typeof sc === 'number' ? sc : null; return `<button class="res-item" data-act="res-see" data-i="${i}"><span class="q">${esc(q.d.id)} Q${q.n}</span><span class="s">${esc((q.stem.find(b => b.t) || {}).t || '')}</span><span class="sc ${scClass(v)}">${fmtScore(v)}</span></button>`; }).join('')}</div>` : `<p class="empty">Rien dans cette catégorie.</p>`;
  return h;
}
function resultList(at, f) {
  return subjQuestions(SUBJ[at.sid]).filter(q => {
    const sc = scoreQ(q, at.ans[q.key], at.ev[q.key]);
    if (f === 'err') return typeof sc === 'number' && sc < 0.999;
    if (f === 'empty') return q.scored && !isAnswered(q, at.ans[q.key]);
    return true;
  });
}
function viewResultDetail() {
  const at = findAttempt(ui.screen.id); const items = resultList(at, ui.screen.filter || 'all'); const i = ui.screen.detail; const q = items[i];
  const sc = scoreQ(q, at.ans[q.key], at.ev[q.key]);
  let h = topbar(`${esc(q.d.id)} · Q${q.n}`, `Correction ${i + 1}/${items.length}`, 'res-back');
  h += contextBox(q.d, false) + prevInfo(q);
  h += `<section class="panel">${qHead(q, 'Question ' + q.n)}${renderQuestion(q, at.ans[q.key], 'review', { score: sc })}${typeof sc === 'number' && sc < 0.999 && store.carnet[q.key] && !store.carnet[q.key].archived ? annotBox(q.key) : ''}</section>`;
  h += `<div class="actionbar"><div class="inner"><button class="btn ghost" data-act="res-prev" ${i === 0 ? 'disabled' : ''}>Précédente</button><button class="btn" data-act="res-next" ${i === items.length - 1 ? 'disabled' : ''}>Suivante</button></div></div>`;
  return h;
}

/* ------------------------------------------------------------------ onglet Progression */
function viewProgression() {
  let h = `<header class="top"><h1>Progression<span class="sub">${esc(cycleLabel(ui.cycle))} · enregistré sur cet appareil uniquement</span></h1></header>` + cycleBar();
  MATIERES.forEach(m => {
    const subs = DATA.subjects.filter(s => s.matiere === m);
    const keys = subs.flatMap(s => subjQuestions(s).filter(q => q.scored).map(q => q.key));
    const seen = keys.filter(k => store.rev[k]); const avg = seen.length ? seen.reduce((n, k) => n + store.rev[k].last, 0) / seen.length : null;
    const done = subs.filter(s => subjStatus(s.id).done.length).length;
    h += `<h2 class="section-title">${esc(m)}</h2><section class="panel"><dl class="kv"><dt>Sujets faits en entier</dt><dd>${done} / ${subs.length}</dd><dt>Révision aléatoire</dt><dd>${seen.length} / ${keys.length} questions travaillées${avg != null ? ` · réussite ${fmt(avg * 100, 0)}&nbsp;%` : ''}</dd></dl>
    <div class="bar"><i style="width:${keys.length ? (seen.length / keys.length * 100).toFixed(1) : 0}%"></i></div></section><div class="list">`;
    subs.forEach(s => {
      const st = subjStatus(s.id);
      h += `<button class="item" data-act="subject" data-sid="${s.id}"><span class="name">${esc(s.title)}</span>${statusPill(st)}<span class="meta">${st.last ? `<span>Dernier <b class="score">${fmt(st.last.result.note20)}/20</b></span><span>Meilleur <b class="score">${fmt(st.best)}/20</b></span><span>${dateFr(st.last.end)}</span><span>${st.done.length} passage${st.done.length > 1 ? 's' : ''}</span>` : `<span>${st.run ? `${answeredCount(st.run)}/${subjQuestions(s).length} répondues` : 'Pas encore de note'}</span>`}</span></button>`;
    });
    h += '</div>';
  });
  return h;
}

/* ------------------------------------------------------------------ onglet Réglages */
function viewReglages() {
  const nq = DATA.subjects.reduce((n, s) => n + subjQuestions(s).length, 0);
  let h = `<header class="top"><h1>Réglages</h1></header>`;
  h += `<section class="panel"><span class="eyebrow">Sauvegarde</span><p class="small" style="margin:0">Ta progression vit uniquement dans ce navigateur. Si tu effaces les données du navigateur ou que tu changes de téléphone, elle disparaît. Copie-la de temps en temps et colle-la dans une note ou un mail à toi-même.</p>
  <button class="btn ghost block" data-act="export">Copier ma progression</button><textarea class="dump" id="dump" readonly hidden></textarea></section>`;
  h += `<section class="panel"><span class="eyebrow">Restaurer</span><p class="small" style="margin:0">Colle ici une progression copiée, ou choisis le fichier texte où tu l'as gardée. Elle remplace celle de cet appareil.</p>
  <textarea class="dump" id="import-txt" placeholder="Colle ta progression ici"></textarea><input type="file" id="import-file" accept=".json,.txt,application/json,text/plain" data-act="import-file">
  <button class="btn ghost block" data-act="import" data-confirm="Remplacer la progression de cet appareil ?">Restaurer cette progression</button></section>`;
  h += `<section class="panel"><span class="eyebrow">Barème appliqué</span><ul class="rules">
  <li><b>QRU</b> : un seul choix, 1 ou 0.</li>
  <li><b>QRM jusqu'à 5 propositions</b> : 0 discordance = 1 ; 1 = 0,5 ; 2 = 0,2 ; 3 ou plus = 0. Proposition indispensable non cochée ou inacceptable cochée = 0.</li>
  <li><b>6 propositions ou plus</b> : le nombre de réponses attendues est affiché, la sélection est limitée à ce nombre, note = bonnes réponses cochées / réponses attendues.</li>
  <li><b>QROC</b> : réponse reconnue automatiquement si elle correspond à la correction (majuscules, accents, articles et pluriels ignorés). Sinon tu t'auto-évalues : 1, 0,5 ou 0. En mode examen, à la fin du sujet.</li>
  <li><b>Association</b> : proportion d'éléments bien associés.</li>
  <li><b>TCS</b> : un seul choix sur l'échelle proposée ; note = part du panel d'experts ayant fait ce choix.</li>
  <li>Questions annulées ou neutralisées par la fac : affichées, non comptées. Propositions neutralisées : ignorées.</li>
  <li><b>Note /20</b> : moyenne des questions notées × 20.</li></ul>
  <p class="small muted" style="margin:0">Référence : CNG, Règles générales de notation R2C, 31/01/2023.</p></section>`;
  h += `<section class="panel"><span class="eyebrow">Contenu</span><p class="small" style="margin:0">${DATA.subjects.length} sujets · ${nq} questions. Annales et sujets d'entraînement, usage personnel.</p></section>`;
  h += `<button class="btn danger block" data-act="wipe" data-confirm="Effacer toute la progression de cet appareil ?">Tout effacer</button>`;
  return h;
}

/* ------------------------------------------------------------------ rendu principal */
function render(scrollTop) {
  const sc = ui.screen; let h, tabs = true;
  if (!sc && !ui.cycle && ui.tab !== 'reglages') h = viewCycleChoice();
  else if (!sc) h = { reviser: viewReviser, sujets: viewSujets, carnet: viewCarnet, progression: viewProgression, reglages: viewReglages }[ui.tab]();
  else {
    tabs = sc.type === 'subject';
    h = { rev: viewRevSession, revsum: viewRevSummary, subject: viewSubject, exam: viewExamSommaire, dossier: viewExamDossier, eval: viewExamEval, results: viewResults, detail: viewResultDetail, cdetail: viewCarnetDetail }[sc.type]();
    if (sc.type === 'results') tabs = true;
  }
  if (h === '') return;
  app.innerHTML = `<div class="wrap ${tabs ? '' : 'no-tabs'}">${h}</div>${tabs ? tabbar() : ''}`;
  if (scrollTop) window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ interactions */
function currentHolder() {
  const sc = ui.screen;
  if (sc && sc.type === 'rev') return { ans: sc.ans, persist: () => {} };
  if (sc && sc.type === 'dossier') { const at = findAttempt(sc.id); return { ans: at.ans, persist: save }; }
  return null;
}
function refreshOpts(container, q, a) {
  container.querySelectorAll('.opt').forEach(b => b.setAttribute('aria-pressed', String((a || []).includes(b.dataset.l))));
  const cnt = container.parentElement.querySelector('.cnt'); if (cnt) cnt.textContent = `${(a || []).length} / ${maxSel(q)}`;
  const lock = document.querySelector('[data-act="exam-lock"]');
  if (lock) { if (isAnswered(q, a)) { delete lock.dataset.confirm; } else lock.dataset.confirm = 'Valider sans réponse ?'; }
}
function disarm() { if (ui.armed) { ui.armed.el.textContent = ui.armed.label; ui.armed.el.classList.remove('armed'); ui.armed = null; } }

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (el.dataset.confirm) {
    if (!ui.armed || ui.armed.el !== el) { disarm(); ui.armed = { el, label: el.textContent }; el.textContent = el.dataset.confirm + ' Touche encore pour confirmer'; el.classList.add('armed'); setTimeout(() => { if (ui.armed && ui.armed.el === el) disarm(); }, 5000); return; }
    ui.armed = null;
  }
  const sc = ui.screen;
  switch (act) {
    case 'tab': ui.tab = el.dataset.tab; ui.screen = null; render(true); break;
    case 'cycle': setCycle(el.dataset.v, true); ui.screen = null; toast(`Cycle ${cycleLabel(el.dataset.v)}`); render(true); break;
    case 'zoom': openZoom(el.getAttribute('src')); break;
    case 'ai': {
      const txt = AI_PROMPTS[el.dataset.key] || '';
      const msg = el.dataset.short === 'all' ? 'Dossier trop long pour le lien : prompt copié, colle-le dans ChatGPT.' : el.dataset.short === 'ctx' ? 'Énoncé raccourci dans le lien. Version complète copiée : colle-la si besoin.' : 'Prompt copié aussi : si ChatGPT s\'ouvre vide, colle-le.';
      try { navigator.clipboard.writeText(txt).then(() => toast(msg), () => toast('ChatGPT ouvert. Copie impossible ici.')); } catch (err) { toast('ChatGPT ouvert. Copie impossible ici.'); }
      break;
    }
    /* réglages de révision */
    case 'rev-mat': ui.rev.matiere = el.dataset.v; ui.rev.subjects = null; render(); break;
    case 'rev-n': ui.rev.n = +el.dataset.v; render(); break;
    case 'rev-content': ui.rev.content = el.dataset.v; render(); break;
    case 'rev-pool': ui.rev.pool = el.dataset.v; render(); break;
    case 'rev-start': startRevision(); break;
    case 'rev-quit':
      if (!sc.fromSummary && sc.phase === 'answer' && sc.i === 0) { go(null); break; }
      go({ ...sc, type: 'revsum', fromSummary: false }); break;
    case 'opt': {
      const box = el.closest('.opts'); const q = QIDX[box.dataset.key]; const H = currentHolder(); if (!H) break;
      let a = (H.ans[q.key] || []).slice(); const l = el.dataset.l;
      if (isSingle(q)) a = a[0] === l ? [] : [l];
      else if (a.includes(l)) a = a.filter(x => x !== l);
      else if (a.length >= maxSel(q)) { toast(`Maximum ${maxSel(q)} réponses : décoche d'abord une proposition.`); break; }
      else a.push(l);
      a.sort(); H.ans[q.key] = a; H.persist(); refreshOpts(box, q, a); break;
    }
    case 'rev-validate': {
      const q = QIDX[sc.keys[sc.i]]; const a = sc.ans[q.key];
      if (!isAnswered(q, a) && !el.dataset.empty) { el.dataset.empty = '1'; el.textContent = 'Valider sans réponse ?'; break; }
      sc.sc[q.key] = scoreQ(q, a, null); sc.phase = 'review'; recordRev(q, sc.sc[q.key], a); render(); break;
    }
    case 'rev-eval': { const q = QIDX[el.dataset.key]; sc.sc[q.key] = +el.dataset.v; recordRev(q, sc.sc[q.key], sc.ans[q.key]); render(); break; }
    case 'rev-next':
      if (sc.i < sc.keys.length - 1) { sc.i++; if (!sc.fromSummary) sc.phase = 'answer'; render(true); }
      else go({ ...sc, type: 'revsum', fromSummary: false }); break;
    case 'rev-see': { const i = +el.dataset.i; go({ ...sc, type: 'rev', i, phase: 'review', fromSummary: true }); break; }
    case 'rev-done': go(null, sc && sc.carnet ? 'carnet' : 'reviser'); break;
    case 'rev-again': if (sc && sc.carnet) { ui.tab = 'carnet'; startCarnet(pickCarnet()); } else { go(null, 'reviser'); startRevision(); } break;
    /* carnet */
    case 'carnet-mat': ui.carnet.matiere = el.dataset.v; render(); break;
    case 'carnet-n': ui.carnet.n = +el.dataset.v; render(); break;
    case 'carnet-status': ui.carnet.status = el.dataset.v; render(); break;
    case 'carnet-cause': ui.carnet.cause = el.dataset.v; render(); break;
    case 'carnet-start': startCarnet(pickCarnet()); break;
    case 'carnet-see': go({ type: 'cdetail', keys: carnetList(ui.carnet).map(x => x.k), idx: +el.dataset.i }); break;
    case 'carnet-back': go(null, 'carnet'); break;
    case 'carnet-prev': sc.idx--; render(true); break;
    case 'carnet-next': sc.idx++; render(true); break;
    case 'carnet-redo-one': ui.tab = 'carnet'; startCarnet([sc.keys[sc.idx]]); break;
    case 'carnet-archive': { const e = store.carnet[sc.keys[sc.idx]]; e.archived = true; e.archivedAt = Date.now(); save(); toast('Erreur marquée comme maîtrisée.'); render(); break; }
    case 'carnet-restore': { const e = store.carnet[sc.keys[sc.idx]]; e.archived = false; e.streak = 0; e.okDay = null; e.lastWrong = Date.now(); save(); toast('Erreur remise dans le carnet.'); render(); break; }
    case 'cause': {
      const e = store.carnet[el.dataset.key]; if (!e) break;
      e.cause = e.cause === el.dataset.v ? null : el.dataset.v; save();
      el.parentElement.querySelectorAll('[data-act="cause"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === e.cause)));
      break;
    }
    case 'carnet-export': {
      const txt = carnetExport(carnetList(ui.carnet)); const ta = document.getElementById('carnet-dump'); ta.hidden = false; ta.value = txt;
      const fail = () => { ta.focus(); ta.select(); toast('Copie automatique impossible : le texte est sélectionné, copie-le à la main.'); };
      try { navigator.clipboard.writeText(txt).then(() => toast('Erreurs et notes copiées.'), fail); } catch (err) { fail(); }
      break;
    }
    /* sujets */
    case 'subject': go({ type: 'subject', sid: el.dataset.sid }); break;
    case 'back-tab': go(null); break;
    case 'exam-start': { const at = newAttempt(el.dataset.sid); go({ type: 'exam', id: at.id }); break; }
    case 'exam-resume': { const at = findAttempt(el.dataset.id); go(at.status === 'eval' ? { type: 'eval', id: at.id } : { type: 'exam', id: at.id }); break; }
    case 'exam-restart': { const sid = el.dataset.sid; store.attempts[sid] = attemptsOf(sid).filter(a => a.status === 'termine'); const at = newAttempt(sid); go({ type: 'exam', id: at.id }); break; }
    case 'back-subject': { const at = findAttempt(sc.id); go({ type: 'subject', sid: at.sid }); break; }
    case 'exam-sommaire': go({ type: 'exam', id: sc.id }); break;
    case 'exam-dossier': { const at = findAttempt(sc.id); go({ type: 'dossier', id: sc.id, did: el.dataset.did, idx: at.pos[el.dataset.did] || 0 }); break; }
    case 'exam-jump': sc.idx = +el.dataset.i; render(true); break;
    case 'exam-view': sc.view = +el.dataset.i; render(true); break;
    case 'exam-current': delete sc.view; render(true); break;
    case 'rev-view': sc.view = +el.dataset.i; render(true); break;
    case 'rev-current': delete sc.view; render(true); break;
    case 'exam-prev': sc.idx = Math.max(0, sc.idx - 1); render(true); break;
    case 'exam-next': sc.idx = sc.idx + 1; render(true); break;
    case 'exam-lock': {
      const at = findAttempt(sc.id); const d = SUBJ[at.sid].dossiers.find(x => x.id === sc.did); const q = d.questions.find(x => !at.locked[x.key]);
      at.locked[q.key] = true; save();
      if (d.questions.every(x => at.locked[x.key])) { toast(`${d.id} terminé.`); go({ type: 'exam', id: at.id }); } else render(true);
      break;
    }
    case 'exam-finish': finishExam(findAttempt(sc.id)); break;
    case 'exam-eval': { const at = findAttempt(sc.id); at.ev[el.dataset.key] = +el.dataset.v; save(); render(); break; }
    case 'exam-close': { const at = findAttempt(sc.id); closeAttempt(at); go({ type: 'results', id: at.id, filter: 'all' }); break; }
    case 'results': go({ type: 'results', id: el.dataset.id, filter: 'all' }); break;
    case 'res-filter': sc.filter = el.dataset.v; render(); break;
    case 'res-see': go({ type: 'detail', id: sc.id, filter: sc.filter, detail: +el.dataset.i }); break;
    case 'res-back': go({ type: 'results', id: sc.id, filter: sc.filter }); break;
    case 'res-prev': sc.detail--; render(true); break;
    case 'res-next': sc.detail++; render(true); break;
    case 'del-last': { const sid = el.dataset.sid; const at = attemptsOf(sid); for (let i = at.length - 1; i >= 0; i--) if (at[i].status === 'termine') { at.splice(i, 1); break; } save(); toast('Dernier passage supprimé.'); render(); break; }
    case 'reset-subj': { delete store.attempts[el.dataset.sid]; save(); toast('Sujet réinitialisé.'); render(); break; }
    /* réglages */
    case 'export': {
      const txt = JSON.stringify(store); const ta = document.getElementById('dump'); ta.hidden = false; ta.value = txt;
      const done = () => toast('Progression copiée.'); const fail = () => { ta.focus(); ta.select(); toast('Copie automatique impossible : le texte est sélectionné, copie-le à la main.'); };
      try { navigator.clipboard.writeText(txt).then(done, fail); } catch (err) { fail(); }
      break;
    }
    case 'import': {
      const raw = document.getElementById('import-txt').value.trim();
      try { const s = JSON.parse(raw); if (!s || typeof s.attempts !== 'object' || typeof s.rev !== 'object') throw new Error('format'); store = Object.assign(emptyStore(), s); migrateCarnet(); save(); toast('Progression restaurée.'); render(true); }
      catch (err) { toast('Ce texte n\'est pas une progression valide.'); }
      break;
    }
    case 'wipe': store = emptyStore(); save(); toast('Progression effacée.'); render(true); break;
  }
});
app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.act === 'note') { const c = store.carnet[el.dataset.key]; if (c) { c.note = el.value; clearTimeout(ui.noteT); ui.noteT = setTimeout(save, 400); } }
  if (el.dataset.act === 'qroc') { const H = currentHolder(); if (H) { H.ans[el.dataset.key] = el.value; H.persist(); const lock = document.querySelector('[data-act="exam-lock"]'); if (lock) { if (el.value.trim()) delete lock.dataset.confirm; else lock.dataset.confirm = 'Valider sans réponse ?'; } } }
  if (el.dataset.act === 'rev-n-in') { const v = parseInt(el.value, 10); if (v > 0) { ui.rev.n = Math.min(300, v); document.querySelectorAll('[data-act="rev-n"]').forEach(b => b.setAttribute('aria-pressed', 'false')); const st = document.querySelector('[data-act="rev-start"]'); if (st) st.textContent = `Lancer ${ui.rev.n} questions`; } }
});
app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'assoc') { const H = currentHolder(); if (!H) return; const k = el.dataset.key; const q = QIDX[k]; const a = (H.ans[k] || new Array(q.items.length).fill('')).slice(); a[+el.dataset.i] = el.value; H.ans[k] = a; H.persist(); }
  if (el.dataset.act === 'rev-sub') { const all = DATA.subjects.filter(s => s.matiere === ui.rev.matiere).map(s => s.id); let cur = ui.rev.subjects || all.slice(); cur = el.checked ? [...new Set([...cur, el.dataset.v])] : cur.filter(x => x !== el.dataset.v); ui.rev.subjects = cur.length === all.length ? null : cur; render(); }
  if (el.dataset.act === 'import-file' && el.files && el.files[0]) { const fr = new FileReader(); fr.onload = () => { document.getElementById('import-txt').value = fr.result; toast('Fichier chargé : touche « Restaurer » pour valider.'); }; fr.readAsText(el.files[0]); }
});
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.act === 'qroc') e.target.blur(); });

function openZoom(src) {
  const z = document.createElement('div'); z.className = 'zoom'; z.setAttribute('role', 'dialog'); z.setAttribute('aria-label', 'Image agrandie');
  z.innerHTML = `<div class="zbar"><button data-z="full">Taille réelle</button><button data-z="close">Fermer</button></div><img src="${esc(src)}" alt="Image agrandie">`;
  z.addEventListener('click', ev => { const b = ev.target.closest('[data-z]'); if (!b) return; if (b.dataset.z === 'close') z.remove(); else { z.classList.toggle('full'); b.textContent = z.classList.contains('full') ? 'Ajuster' : 'Taille réelle'; } });
  document.body.appendChild(z); z.querySelector('[data-z="close"]').focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const z = document.querySelector('.zoom'); if (z) z.remove(); } });

/* exposé pour les tests */
window.__annales = { aiPrompt, AI_PROMPTS, setCycle, CYCLES, get cycle() { return ui.cycle; }, scoreQ, normTxt, qrocAuto, drawUnits, revUnits, QIDX, SUBJ, isXN, maxSel, carnetRecord, dayKey, get store() { return store; } };
migrateCarnet();
render(true);
})();
