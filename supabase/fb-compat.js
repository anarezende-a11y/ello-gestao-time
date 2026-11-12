/* Ello · Gestão do Time — camada de compatibilidade Firebase → Supabase
 * Expõe a MESMA interface que a plataforma já usa (window.fb.doc, setDoc, onSnapshot, ...),
 * mas grava/lê na tabela public.docs do Supabase. Assim o resto do código não muda.
 */
export function criarFbSupabase(createClient, URL, KEY) {
  const sb = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const T = 'docs';
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function merge(a, b) {
    if (!isObj(a) || !isObj(b)) return clone(b);
    const r = clone(a);
    Object.keys(b).forEach(k => { r[k] = (k in r) ? merge(r[k], b[k]) : clone(b[k]); });
    return r;
  }
  const erro = (e, code) => { const x = new Error((e && e.message) || String(e)); x.code = code || (e && /permission|policy|rls|JWT/i.test(e.message || '') ? 'permission-denied' : 'unknown'); return x; };

  /* ---------- referências ---------- */
  const db = { tipo: 'supabase' };
  function doc(_db, ...p) { p = p.join('/').split('/').filter(Boolean); return { tipo: 'doc', col: p.slice(0, -1).join('/'), id: p[p.length - 1], path: p.join('/') }; }
  function collection(_db, ...p) { p = p.join('/').split('/').filter(Boolean); return { tipo: 'col', col: p.join('/'), path: p.join('/') }; }
  function orderBy(campo, dir) { return { _ord: campo, _dir: dir || 'asc' }; }
  function limit(n) { return { _lim: n }; }
  function query(ref, ...ops) { const q = Object.assign({}, ref); ops.forEach(o => { if (o && o._ord) { q.ord = o._ord; q.dir = o._dir; } if (o && o._lim) q.lim = o._lim; }); return q; }

  /* ---------- cache local + ouvintes ---------- */
  const cache = {};            // 'col|id' -> data | null
  const ouvDoc = {};           // 'col|id' -> Set(fn)
  const ouvCol = {};           // col -> Set({ref, fn})
  const k = (c, i) => c + '|' + i;
  const snapDoc = (ref, data) => ({ id: ref.id, ref, exists: () => data != null, data: () => clone(data == null ? undefined : data) });
  function snapCol(ref) {
    let ids = Object.keys(cache).filter(x => x.startsWith(ref.col + '|') && cache[x] != null).map(x => x.slice(ref.col.length + 1));
    let docs = ids.map(id => ({ id, ref: doc(null, ref.col, id), exists: () => true, data: () => clone(cache[k(ref.col, id)]) }));
    if (ref.ord) { const f = ref.ord, s = ref.dir === 'desc' ? -1 : 1; docs.sort((a, b) => { const x = (cache[k(ref.col, a.id)] || {})[f], y = (cache[k(ref.col, b.id)] || {})[f]; return x === y ? 0 : (x > y ? s : -s); }); }
    if (ref.lim) docs = docs.slice(0, ref.lim);
    return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) };
  }
  function avisar(col, id) {
    const kk = k(col, id);
    (ouvDoc[kk] || new Set()).forEach(fn => { try { fn(snapDoc({ col, id }, cache[kk])); } catch (e) { console.error(e); } });
    (ouvCol[col] || new Set()).forEach(o => { try { o.fn(snapCol(o.ref)); } catch (e) { console.error(e); } });
  }
  async function buscar(col, id) {
    const { data, error } = await sb.from(T).select('data').eq('col', col).eq('id', id).maybeSingle();
    if (error) throw erro(error);
    cache[k(col, id)] = data ? data.data : null;
    return cache[k(col, id)];
  }

  /* ---------- tempo real: um canal para a tabela toda ---------- */
  let canal = null;
  function ligarTempoReal() {
    if (canal) return;
    canal = sb.channel('docs-tudo')
      .on('postgres_changes', { event: '*', schema: 'public', table: T }, async p => {
        const r = p.new && p.new.col ? p.new : p.old;
        if (!r || !r.col) return;
        if (p.eventType === 'DELETE') { cache[k(r.col, r.id)] = null; avisar(r.col, r.id); return; }
        const quer = ouvDoc[k(r.col, r.id)] || ouvCol[r.col];
        if (!quer) return;
        try { await buscar(r.col, r.id); avisar(r.col, r.id); } catch (e) { console.warn('[supabase] tempo real', e); }
      })
      .subscribe();
  }

  /* ---------- leitura e escrita ---------- */
  async function getDoc(ref) { return snapDoc(ref, await buscar(ref.col, ref.id)); }
  async function getDocs(ref) {
    const { data, error } = await sb.from(T).select('id,data').eq('col', ref.col);
    if (error) throw erro(error);
    data.forEach(r => (cache[k(ref.col, r.id)] = r.data));
    return snapCol(ref);
  }
  async function setDoc(ref, dados, opt) {
    const kk = k(ref.col, ref.id), antes = cache[kk];
    cache[kk] = opt && opt.merge ? merge(antes || {}, dados) : clone(dados);
    avisar(ref.col, ref.id);                                 // atualiza a tela na hora, como o Firebase
    const r = opt && opt.merge
      ? await sb.rpc('doc_merge', { p_col: ref.col, p_id: ref.id, p_data: dados })
      : await sb.from(T).upsert({ col: ref.col, id: ref.id, data: dados, updated_at: new Date().toISOString() });
    if (r.error) { cache[kk] = antes; avisar(ref.col, ref.id); throw erro(r.error); }
  }
  async function updateDoc(ref, dados) {
    if (cache[k(ref.col, ref.id)] == null) await buscar(ref.col, ref.id);
    if (cache[k(ref.col, ref.id)] == null) throw erro({ message: 'Documento não existe' }, 'not-found');
    return setDoc(ref, dados, { merge: true });
  }
  async function deleteDoc(ref) {
    const kk = k(ref.col, ref.id), antes = cache[kk];
    cache[kk] = null; avisar(ref.col, ref.id);
    const { error } = await sb.from(T).delete().eq('col', ref.col).eq('id', ref.id);
    if (error) { cache[kk] = antes; avisar(ref.col, ref.id); throw erro(error); }
  }
  async function addDoc(colRef, dados) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const ref = doc(null, colRef.col, id);
    await setDoc(ref, dados);
    return ref;
  }

  function onSnapshot(ref, fn, ferr) {
    ligarTempoReal();
    let vivo = true;
    if (ref.tipo === 'doc') {
      const kk = k(ref.col, ref.id), cb = s => vivo && fn(s);
      (ouvDoc[kk] = ouvDoc[kk] || new Set()).add(cb);
      buscar(ref.col, ref.id).then(d => cb(snapDoc(ref, d))).catch(e => ferr && ferr(e));
      return () => { vivo = false; ouvDoc[kk].delete(cb); };
    }
    const o = { ref, fn: s => vivo && fn(s) };
    (ouvCol[ref.col] = ouvCol[ref.col] || new Set()).add(o);
    getDocs(ref).then(s => o.fn(snapCol(ref))).catch(e => ferr && ferr(e));
    return () => { vivo = false; ouvCol[ref.col].delete(o); };
  }

  /* ---------- login ---------- */
  const auth = { currentUser: null };
  const usuario = u => (u ? { uid: u.id, email: u.email } : null);
  async function signInWithEmailAndPassword(_a, email, senha) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) {
      const m = (error.message || '').toLowerCase();
      throw erro(error, m.includes('invalid') ? 'auth/invalid-credential' : m.includes('rate') || m.includes('too many') ? 'auth/too-many-requests' : 'auth/unknown');
    }
    auth.currentUser = usuario(data.user);
    return { user: auth.currentUser };
  }
  function onAuthStateChanged(_a, fn) {
    let ultimo = '__';
    const emitir = u => { const id = u ? u.id : ''; if (id === ultimo) return; ultimo = id; auth.currentUser = usuario(u); fn(auth.currentUser); };
    sb.auth.getSession().then(({ data }) => emitir(data.session && data.session.user));
    const { data } = sb.auth.onAuthStateChange((_e, s) => emitir(s && s.user));
    return () => data.subscription.unsubscribe();
  }
  async function signOut() { await sb.auth.signOut(); }
  async function trocarSenha(nova) { const { error } = await sb.auth.updateUser({ password: nova }); if (error) throw erro(error); }

  return { supabase: sb, backend: 'supabase', auth, db, signInWithEmailAndPassword, onAuthStateChanged, signOut, trocarSenha,
           doc, getDoc, getDocs, setDoc, onSnapshot, collection, addDoc, updateDoc, deleteDoc, query, orderBy, limit };
}
