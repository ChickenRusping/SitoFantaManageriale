import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ougxeheoaifcuetnmgrw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZI75g_AJGpsblAxVDDFBIQ_-tqGXPym';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


// ─── OTTIMIZZAZIONE IMMAGINI CLIENT-SIDE ─────────────────────────────────────
// Comprimiamo e convertiamo gli upload in WebP prima di mandarli a Supabase.
// Questo riduce drasticamente Cached Egress e tempi di caricamento.
const IMAGE_UPLOAD_LIMIT_MB = 12;
const WEBP_MIME = 'image/webp';

function safeFileBaseName(name = 'immagine') {
  return String(name)
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'immagine';
}

async function canvasToBlob(canvas, type, quality) {
  return await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImageFile(file, {
  maxWidth = 1400,
  maxHeight = 1400,
  quality = 0.78,
  outputType = WEBP_MIME,
  suffix = '',
} = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.size > IMAGE_UPLOAD_LIMIT_MB * 1024 * 1024) {
    throw new Error(`Immagine troppo grande: max ${IMAGE_UPLOAD_LIMIT_MB}MB prima della compressione`);
  }

  // SVG/GIF animati non vengono ricodificati bene via canvas: li blocchiamo per evitare file pesanti o rotti.
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    throw new Error('Formato non supportato per upload ottimizzato. Usa PNG, JPG/JPEG o WebP.');
  }

  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height, 1);
    const targetWidth = Math.max(1, Math.round(bitmap.width * ratio));
    const targetHeight = Math.max(1, Math.round(bitmap.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const blob = await canvasToBlob(canvas, outputType, quality);
    if (!blob) throw new Error('Compressione immagine non riuscita');

    const originalBase = safeFileBaseName(file.name);
    const outName = `${originalBase}${suffix}.webp`;
    return new File([blob], outName, { type: outputType, lastModified: Date.now() });
  } catch (err) {
    throw new Error(`Compressione immagine non riuscita: ${err.message}`);
  }
}

async function compressForUpload(file, preset = 'news') {
  const presets = {
    avatar: { maxWidth: 500, maxHeight: 500, quality: 0.74 },
    stemma: { maxWidth: 500, maxHeight: 500, quality: 0.74 },
    maglia: { maxWidth: 1200, maxHeight: 1200, quality: 0.76 },
    squadra: { maxWidth: 1400, maxHeight: 1400, quality: 0.78 },
    news: { maxWidth: 1600, maxHeight: 1600, quality: 0.78 },
  };
  return await compressImageFile(file, presets[preset] || presets.news);
}

function ensureWebpPath(path) {
  const raw = String(path || `immagini/${Date.now()}.webp`);
  if (/\.[^/.?#]+($|[?#])/.test(raw)) return raw.replace(/\.[^/.?#]+($|[?#])/, '.webp$1');
  return raw.replace(/\/$/, '') + '.webp';
}

function uniqueStoragePath(prefix, baseName = 'immagine') {
  const cleanPrefix = String(prefix || 'immagini').replace(/^\/+|\/+$/g, '');
  const safeBase = safeFileBaseName(baseName);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${cleanPrefix}/${Date.now()}_${rand}_${safeBase}.webp`;
}

function storagePathFromPublicUrl(url, bucket) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return null;
    return decodeURIComponent(u.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

async function removeOldStorageObject(bucket, publicUrl) {
  const oldPath = storagePathFromPublicUrl(publicUrl, bucket);
  if (!oldPath) return;
  try { await supabase.storage.from(bucket).remove([oldPath]); } catch {}
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, fields) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
  if (error) throw error;
}

export async function uploadAvatar(userId, file) {
  if (!file) throw new Error('Nessun file selezionato');
  const optimized = await compressForUpload(file, 'avatar');
  const path = uniqueStoragePath(`avatars/${userId}`, optimized.name);

  const { data: oldProfile } = await supabase.from('profiles').select('avatar_url').eq('id', userId).maybeSingle();

  const { error } = await supabase.storage.from('team-images').upload(path, optimized, {
    upsert: false,
    contentType: optimized.type || WEBP_MIME,
    cacheControl: '31536000',
  });
  if (error) throw error;
  const { data } = supabase.storage.from('team-images').getPublicUrl(path);
  const publicUrl = data.publicUrl;
  await removeOldStorageObject('team-images', oldProfile?.avatar_url);
  return publicUrl;
}

// ─── SQUADRE ──────────────────────────────────────────────────────────────────

export async function getSquadre() {
  const { data, error } = await supabase.from('squadre').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function updateSquadra(name, fields) {
  const { error } = await supabase.from('squadre').update({ ...fields, updated_at: new Date().toISOString() }).eq('name', name);
  if (error) throw error;
}

export function subscribeSquadre(callback) {
  return supabase.channel('squadre-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'squadre' }, callback)
    .subscribe();
}

// ─── ROSA ─────────────────────────────────────────────────────────────────────

export async function getRosa(squadra) {
  // Applica eventuali scadenze vivaio prima di restituire la rosa.
  // Se il SQL di migrazione non è ancora stato eseguito, non blocchiamo il caricamento.
  try { await processaDecisioniVivaio(squadra); } catch {}
  const { data, error } = await supabase.from('rosa').select('*').eq('squadra', squadra).order('ruolo');
  if (error) throw error;
  return data;
}

// ─── REGOLAMENTO ROSA (art. 3) ───────────────────────────────────────────────
export function calcolaRosaCompliance(players = []) {
  const rosaAttiva = (players || []).filter(p => !p.in_vivaio);
  const vivaio = (players || []).filter(p => p.in_vivaio);
  const totale = rosaAttiva.length;
  const portieri = rosaAttiva.filter(p => p.ruolo === 'Por').length;
  const movimento = totale - portieri;
  const u21 = rosaAttiva.filter(p => Number(p.anni || 0) > 0 && Number(p.anni || 0) <= 21).length;
  const issues = [];

  if (portieri < 2) issues.push(`Servono almeno 2 portieri: presenti ${portieri}.`);
  if (movimento < 23) issues.push(`Servono almeno 23 giocatori di movimento: presenti ${movimento}.`);
  if (totale > 30) issues.push(`Rosa oltre il massimo: ${totale}/30 giocatori.`);
  const u21Richiesti = totale >= 30 ? 3 : totale === 29 ? 2 : totale === 28 ? 1 : 0;
  if (u21 < u21Richiesti) issues.push(`Con ${totale} giocatori servono almeno ${u21Richiesti} Under-21: presenti ${u21}.`);

  const contaSerieA = {};
  for (const g of rosaAttiva) {
    const club = (g.squadra_serie_a || '').trim();
    if (!club) continue;
    contaSerieA[club] = (contaSerieA[club] || 0) + 1;
  }
  for (const [club, n] of Object.entries(contaSerieA)) {
    if (n > 5) issues.push(`Troppi giocatori del ${club}: ${n}/5.`);
  }
  if (vivaio.length > 2) issues.push(`Vivaio oltre il massimo: ${vivaio.length}/2 giocatori.`);

  return { regolare: issues.length === 0, issues, totale, portieri, movimento, u21, vivaio: vivaio.length, contaSerieA };
}

async function assertRosaDopoAggiunta(squadra, nuovoGiocatore, { ignoreMinimi = true } = {}) {
  if (nuovoGiocatore?.in_vivaio) return;
  const { data: rosa } = await supabase.from('rosa').select('*').eq('squadra', squadra).eq('in_vivaio', false);
  const futura = [...(rosa || []), { ...nuovoGiocatore, in_vivaio: false }];
  const check = calcolaRosaCompliance(futura);
  const blocchi = check.issues.filter(msg => {
    if (!ignoreMinimi) return true;
    return !msg.startsWith('Servono almeno');
  });
  if (blocchi.length) throw new Error(`Operazione non consentita dal regolamento rosa: ${blocchi.join(' ')}`);
}

async function assertVivaioDopoAggiunta(squadra, giocatore) {
  const anni = Number(giocatore.anni || 0);
  const quot = Number(giocatore.quot || 0);
  const presenze = Number(giocatore.presenze_voto ?? giocatore.partite ?? giocatore.vivaio_presenze ?? 0);
  if (!(anni > 0 && anni <= 23)) throw new Error(`${giocatore.nome} non è idoneo al vivaio: servono Under-23.`);
  if (quot > 3) throw new Error(`${giocatore.nome} non è idoneo al vivaio: Q${quot}, massimo Q3.`);
  if (presenze > 0) throw new Error(`${giocatore.nome} non è idoneo al vivaio: ha già ${presenze} presenze a voto.`);
  const { count } = await supabase.from('rosa').select('id', { count: 'exact', head: true }).eq('squadra', squadra).eq('in_vivaio', true);
  if ((count || 0) >= 2) throw new Error('Vivaio pieno: massimo 2 giocatori.');
}

export async function updateGiocatore(id, fields) {
  const { error } = await supabase.from('rosa').update(fields).eq('id', id);
  if (error) throw error;
  if ('quot' in (fields || {}) || 'vivaio_presenze' in (fields || {}) || 'presenze_voto' in (fields || {}) || 'partite' in (fields || {})) {
    try {
      const { data: player } = await supabase.from('rosa').select('*').eq('id', id).single();
      if (player?.in_vivaio) await processaDecisioniVivaio(player.squadra);
    } catch {}
  }
}

export async function insertGiocatore(giocatore) {
  if (giocatore?.in_vivaio) await assertVivaioDopoAggiunta(giocatore.squadra, giocatore);
  else await assertRosaDopoAggiunta(giocatore.squadra, giocatore);
  const { data, error } = await supabase.from('rosa').insert(giocatore).select().single();
  if (error) throw error;
  return data;
}

export async function deleteGiocatore(id) {
  const { error } = await supabase.from('rosa').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeRosa(squadra, callback) {
  return supabase.channel(`rosa-${squadra}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rosa', filter: `squadra=eq.${squadra}` }, callback)
    .subscribe();
}

// ─── OFFERTE ──────────────────────────────────────────────────────────────────

export async function getOfferte() {
  const { data, error } = await supabase.from('offerte').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertOfferta(offerta) {
  const { data, error } = await supabase.from('offerte').insert(offerta).select().single();
  if (error) throw error;
  return data;
}

export async function updateOffertaStato(id, stato) {
  const { error } = await supabase.from('offerte').update({ stato, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteOfferta(id) {
  const { error } = await supabase.from('offerte').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeOfferte(callback) {
  return supabase.channel('offerte-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'offerte' }, callback)
    .subscribe();
}

// ─── CHIAMATE ─────────────────────────────────────────────────────────────────

export async function getChiamate() {
  const { data, error } = await supabase
    .from('chiamate')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Recupera tutte le chiamate per un giocatore specifico
export async function getChiamateByGiocatore(nomeGiocatore) {
  const { data } = await supabase
    .from('chiamate')
    .select('*')
    .eq('giocatore', nomeGiocatore)
    .order('created_at', { ascending: true });
  return data || [];
}

// ── Calcola scadenza interesse lato JS (specchio del trigger DB) ──────────────
export function calcolaScadenzaInteresse(dataChiamata = new Date()) {
  const d = new Date(dataChiamata);
  // Sempre: prossimo giovedì alle 20:00 UTC (= 21:00 ora italiana)
  const dow = d.getUTCDay(); // 0=dom, 1=lun, ..., 4=gio
  const giorniDaLun = (dow === 0) ? 6 : dow - 1;
  const lun = new Date(d);
  lun.setUTCDate(d.getUTCDate() - giorniDaLun);
  lun.setUTCHours(0, 0, 0, 0);

  const gio = new Date(lun);
  gio.setUTCDate(lun.getUTCDate() + 3);
  gio.setUTCHours(20, 0, 0, 0);

  // Se siamo già oltre giovedì 20:00 UTC, vai alla settimana successiva
  if (d >= gio) gio.setUTCDate(gio.getUTCDate() + 7);
  return gio;
}

// Sempre: venerdì della stessa settimana, slot base 13:00 UTC (= 14:00 Italia)
export function calcolaScadenzaOfferte(scadenzaInteresse) {
  const d = new Date(scadenzaInteresse); // giovedì 20:00 UTC
  const ven = new Date(d);
  ven.setUTCDate(d.getUTCDate() + 1); // giovedì → venerdì
  ven.setUTCHours(13, 0, 0, 0); // 13:00 UTC = 14:00 Italia (slot base)
  return ven;
}

// Acquisti vivaio aperti dal 01/09 al 31/05 della stagione corrente.
export function isVivaioAcquistiAperti(date = new Date()) {
  const month = date.getMonth(); // 0=gennaio
  return month >= 8 || month <= 4;
}

// ── Inserisce la chiamata principale (tipo='prima') ───────────────────────────
export async function insertChiamata(chiamata) {
  const now = new Date();
  if (chiamata?.per_vivaio && !isVivaioAcquistiAperti(now)) throw new Error('Le chiamate per il vivaio sono consentite solo dal 01/09 al 31/05.');
  if (chiamata?.per_vivaio) {
    if (!(Number(chiamata.anni || 0) > 0 && Number(chiamata.anni || 0) <= 23)) throw new Error('Giocatore non idoneo al vivaio: deve essere Under-23.');
    if (Number(chiamata.quot || 0) > 3) throw new Error('Giocatore non idoneo al vivaio: quotazione massima Q3.');
  }
  const scadenzaInteresse = calcolaScadenzaInteresse(now);
  const { data, error } = await supabase
    .from('chiamate')
    .insert({
      ...chiamata,
      tipo: 'prima',
      stato: 'aperta',
      scadenza_interesse: scadenzaInteresse.toISOString(),
    })
    .select().single();
  if (error) throw error;
  return data;
}

// ── Aggiunge un interesse (tipo='interesse') ──────────────────────────────────
export async function aggiungiInteresse(nomeGiocatore, squadra, perVivaio = false) {
  if (perVivaio && !isVivaioAcquistiAperti()) throw new Error('Gli interessamenti per il vivaio sono consentiti solo dal 01/09 al 31/05.');
  // Recupera la chiamata principale per avere la scadenza_interesse
  const { data: primaria } = await supabase
    .from('chiamate')
    .select('*')
    .eq('giocatore', nomeGiocatore)
    .eq('tipo', 'prima')
    .single();
  if (!primaria) throw new Error('Chiamata principale non trovata');
  if (perVivaio) {
    if (!(Number(primaria.anni || 0) > 0 && Number(primaria.anni || 0) <= 23)) throw new Error('Giocatore non idoneo al vivaio: deve essere Under-23.');
    if (Number(primaria.quot || 0) > 3) throw new Error('Giocatore non idoneo al vivaio: quotazione massima Q3.');
  }
  if (new Date() > new Date(primaria.scadenza_interesse))
    throw new Error('Scadenza interesse superata');

  // Controlla duplicati
  const { data: gia } = await supabase.from('chiamate')
    .select('id').eq('giocatore', nomeGiocatore).eq('squadra', squadra);
  if (gia?.length) throw new Error('Hai già manifestato interesse per questo giocatore');

  const { data, error } = await supabase.from('chiamate')
    .insert({
      giocatore: nomeGiocatore,
      ruolo: primaria.ruolo,
      quot: primaria.quot,
      squadra,
      tipo: 'interesse',
      stato: 'aperta',
      per_vivaio: perVivaio,
      scadenza_interesse: primaria.scadenza_interesse,
    })
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteChiamata(id) {
  const { error } = await supabase.from('chiamate').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeChiamate(callback) {
  return supabase.channel('chiamate-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chiamate' }, callback)
    .subscribe();
}


// ─── MOVIMENTI ────────────────────────────────────────────────────────────────

export async function getMovimenti(squadra) {
  const { data, error } = await supabase.from('movimenti').select('*').eq('squadra', squadra).order('data', { ascending: false });
  if (error) throw error;
  return data;
}

// ─── LOGICA ESCLUSIONE FPF (centralizzata) ────────────────────────────────────
// Art. 7.3: esclusi stipendi mensili e guadagni giornata.
// Escluse anche penalità legate alla giornata (non sono operazioni di mercato).
function isFPFEscluso(descrizione) {
  if ((descrizione || '').startsWith('[~FPF]')) return true;
  const d = (descrizione || '').toLowerCase().trim();
  return (
    // Stipendi mensili
    d.startsWith('stipendi ') ||
    d.startsWith('pagamento stipendi') ||
    d.startsWith('paga stipendi') ||
    d === 'stipendi' ||
    d.includes('stipendi mensil') ||
    d.includes('pagamento mensile stipendi') ||
    // Guadagni giornata (tutte le varianti)
    d.startsWith('guadagno giornata') ||
    d.startsWith('guadagni giornata') ||
    d.startsWith('guad. giornata') ||
    d.startsWith('guad giornata') ||
    // Guadagno stadio mensile
    d.startsWith('guadagno stadio') ||
    d.startsWith('stadio mensile') ||
    d.includes('guadagno mensile stadio') ||
    d.includes('entrate stadio') ||
    d.includes('entrata stadio') ||
    // Tasse settimanali
    d.startsWith('tassa settimanale') ||
    d.includes('tassa sett') ||
    d.startsWith('tasse settimanali') ||
    // Stipendi (già coperti ma aggiungiamo varianti da control room)
    d.includes('stipendi applicati') ||
    d.includes('stipendi mensili') ||
    // TUTTE le penalità (non sono operazioni di mercato)
    d.startsWith('penalt') ||      // penalità, penalita, penalty...
    d.startsWith('penalit') ||     // variante senza à
    d.startsWith('multa') ||       // multa giornata, multa regolamento...
    d.startsWith('sanzione') ||
    d.includes('penalizzazione') ||
    // Premi e rimborsi obiettivi (non sono operazioni di mercato)
    d.startsWith('premio ') ||        // Premio 19ª, Premio finale, Premio coppa, Premio indiv...
    d.startsWith('vincitor') ||       // Vincitore Coppa, Vincitore Campionato...
    d.startsWith('miglior') ||        // Miglior Assist-man, Miglior Marcatore...
    d.startsWith('primo in ') ||      // Primo in gol schierati...
    d.startsWith('maggior ') ||       // Maggior ammonizioni, Maggior espulsioni...
    d.includes('u-21 migliorat') ||   // U-21 migliorato di più...
    d.includes('obiettivo') ||        // guadagno/penale obiettivo allenatore, ds, dg
    d.startsWith('riscossione invest') || // Riscossione investimento
    d.startsWith('guadagno invest')      // Guadagno investimento
  );
}

// Carica movimenti nel semestre FPF con flag isEscluso già calcolato
export async function getMovimentiFPF(squadra, inizioStr, fineStr) {
  const { data } = await supabase
    .from('movimenti')
    .select('id, data, descrizione, entrata, uscita')
    .eq('squadra', squadra)
    .gte('data', inizioStr)
    .lte('data', fineStr)
    .order('data', { ascending: false });

  return (data || []).map(m => {
    const manuale = (m.descrizione || '').startsWith('[~FPF]');
    const escluso = isFPFEscluso(m.descrizione);
    const contributo = escluso ? 0 : parseFloat((Number(m.uscita || 0) - Number(m.entrata || 0)).toFixed(2));
    const descrizioneDisplay = manuale ? m.descrizione.replace('[~FPF] ', '').replace('[~FPF]', '') : m.descrizione;
    return { ...m, escluso, manuale, contributo, descrizioneDisplay };
  });
}

export async function toggleFPFEsclusione(id, descrizione, escludi) {
  const nuova = escludi
    ? '[~FPF] ' + descrizione.replace('[~FPF] ', '').replace('[~FPF]', '').trim()
    : descrizione.replace('[~FPF] ', '').replace('[~FPF]', '').trim();
  const { error } = await supabase.from('movimenti').update({ descrizione: nuova }).eq('id', id);
  if (error) throw error;
  return nuova;
}

export async function insertMovimento(movimento) {
  const { data, error } = await supabase.from('movimenti').insert(movimento).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMovimento(id) {
  const { error } = await supabase.from('movimenti').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeMovimenti(squadra, callback) {
  return supabase.channel(`movimenti-${squadra}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'movimenti', filter: `squadra=eq.${squadra}` }, callback)
    .subscribe();
}

export function subscribeMovimentiAll(callback) {
  return supabase.channel('movimenti-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'movimenti' }, callback)
    .subscribe();
}

// ─── QUOTE ────────────────────────────────────────────────────────────────────

export async function updateQuote(squadra, fields) {
  const { error } = await supabase
    .from('squadre')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('name', squadra);
  if (error) throw error;
}

// ─── STIPENDI ─────────────────────────────────────────────────────────────────

export async function calcolaSalaryCap(squadra) {
  const { data, error } = await supabase.from('rosa').select('stip').eq('squadra', squadra);
  if (error) throw error;
  return data.reduce((s, p) => s + Number(p.stip), 0);
}

export async function pagaStipendi(squadra, totalStip, bilancioAttuale) {
  const rata = parseFloat((totalStip / 12).toFixed(2));
  const nuovoBilancio = parseFloat((bilancioAttuale - rata).toFixed(2));
  const oggi = new Date().toISOString().slice(0, 10);
  const mese = new Date().toLocaleString('it-IT', { month: 'long', year: 'numeric' });
  await supabase.from('movimenti').insert({ squadra, descrizione: `Pagamento stipendi ${mese}`, entrata: null, uscita: rata, data: oggi });
  const { error } = await supabase.from('squadre').update({ bilancio: nuovoBilancio, salary_used: totalStip }).eq('name', squadra);
  if (error) throw error;
  return { rata, nuovoBilancio };
}

export async function aggiornaSCNegativo(squadra, scUsato, oggi) {
  if (scUsato > 75) {
    const { data } = await supabase.from('squadre').select('sc_negativo_dal').eq('name', squadra).single();
    if (!data?.sc_negativo_dal) {
      await supabase.from('squadre').update({ sc_negativo_dal: oggi, mercato_bloccato: true }).eq('name', squadra);
    }
  } else {
    await supabase.from('squadre').update({ sc_negativo_dal: null, mercato_bloccato: false }).eq('name', squadra);
  }
}

export async function getContrattiInScadenza(squadra) {
  // Solo i giocatori al 2° anno di contratto (fine biennio — devono scegliere se rinnovare, art. 4.8)
  const { data, error } = await supabase.from('rosa').select('*')
    .eq('squadra', squadra)
    .eq('anni_contratto', 2)
    .eq('in_vivaio', false);
  if (error) throw error;
  return data || [];
}

// ─── CLUB IDENTITY ────────────────────────────────────────────────────────────

export async function getClubIdentity(squadra) {
  const { data } = await supabase.from('club_identity').select('*').eq('squadra', squadra).limit(1);
  return data?.[0] ?? null;
}

// Fetch tutte le identity in un colpo solo (per arricchire mergedTeams con stemmi)
export async function getAllClubIdentities() {
  const { data, error } = await supabase.from('club_identity').select('squadra, stemma_url, maglia_casa_url, maglia_trasferta_url, maglia_terza_url');
  if (error) return [];
  return data || [];
}

export async function updateClubIdentity(squadra, fields) {
  // upsert: se la riga non esiste la crea
  const { error } = await supabase.from('club_identity')
    .upsert({ squadra, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'squadra' });
  if (error) throw error;
}

// ── UPLOAD IMMAGINI SQUADRA ──────────────────────────────────────────────────
// kind: 'stemma' | 'maglia_casa' | 'maglia_trasferta' | 'maglia_terza'
export async function uploadImmagineSquadra(squadra, file, kind) {
  if (!file) throw new Error('Nessun file selezionato');

  const fieldMap = {
    stemma: 'stemma_url',
    maglia_casa: 'maglia_casa_url',
    maglia_trasferta: 'maglia_trasferta_url',
    maglia_terza: 'maglia_terza_url',
  };
  const col = fieldMap[kind];
  if (!col) throw new Error('Tipo immagine non valido');

  const preset = kind === 'stemma' ? 'stemma' : 'maglia';
  const optimized = await compressForUpload(file, preset);

  // Filename univoco + cache lunga: quando si cambia immagine cambia URL, senza ?v=Date.now().
  const slug = squadra.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const path = uniqueStoragePath(`${slug}/${kind}`, optimized.name);
  const { data: oldIdentity } = await supabase.from('club_identity').select(col).eq('squadra', squadra).maybeSingle();
  const oldUrl = oldIdentity?.[col];

  const { error: uploadErr } = await supabase.storage
    .from('team-images')
    .upload(path, optimized, {
      cacheControl: '31536000',
      upsert: false,
      contentType: optimized.type || WEBP_MIME,
    });
  if (uploadErr) throw uploadErr;

  const { data: urlData } = supabase.storage.from('team-images').getPublicUrl(path);
  const publicUrl = urlData?.publicUrl || null;
  if (!publicUrl) throw new Error('Impossibile ottenere URL pubblico');

  await updateClubIdentity(squadra, { [col]: publicUrl });
  await removeOldStorageObject('team-images', oldUrl);
  return publicUrl;
}

// Rimuovi immagine (setta URL a null)
export async function rimuoviImmagineSquadra(squadra, kind) {
  const fieldMap = {
    stemma: 'stemma_url',
    maglia_casa: 'maglia_casa_url',
    maglia_trasferta: 'maglia_trasferta_url',
    maglia_terza: 'maglia_terza_url',
  };
  const col = fieldMap[kind];
  if (!col) throw new Error('Tipo immagine non valido');
  await updateClubIdentity(squadra, { [col]: null });
}

// ─── OBIETTIVI ────────────────────────────────────────────────────────────────

export async function getObiettivi(squadra) {
  const { data, error } = await supabase.from('obiettivi').select('*').eq('squadra', squadra).order('ordine');
  if (error) return [];
  return data;
}

export async function updateObiettivo(id, fields) {
  const { error } = await supabase.from('obiettivi').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function insertObiettivo(obj) {
  const { data, error } = await supabase.from('obiettivi').insert(obj).select().single();
  if (error) throw error;
  return data;
}

export async function deleteObiettivo(id) {
  const { error } = await supabase.from('obiettivi').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeObiettivi(squadra, callback) {
  return supabase.channel(`obiettivi-${squadra}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'obiettivi', filter: `squadra=eq.${squadra}` }, callback)
    .subscribe();
}

// ─── TRATTATIVE ───────────────────────────────────────────────────────────────
// Tabella: trattative (sostituisce/estende offerte con logica regolamento)

export async function getTrattative() {
  const { data, error } = await supabase.from('trattative').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

export async function insertTrattativa(t) {
  const { data, error } = await supabase.from('trattative').insert(t).select().single();
  if (error) throw error;
  return data;
}

export async function updateTrattativa(id, fields) {
  const { error } = await supabase.from('trattative').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteTrattativa(id) {
  const { error } = await supabase.from('trattative').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeTrattative(callback) {
  return supabase.channel('trattative-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trattative' }, callback)
    .subscribe();
}

// ─── ASTE ─────────────────────────────────────────────────────────────────────
export async function getAste() {
  const { data, error } = await supabase.from('aste').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

export async function insertAsta(a) {
  const { data, error } = await supabase.from('aste').insert(a).select().single();
  if (error) throw error;
  return data;
}

export async function updateAsta(id, fields) {
  const { error } = await supabase.from('aste').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export function subscribeAste(callback) {
  return supabase.channel('aste-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'aste' }, callback)
    .subscribe();
}

// ─── TRASFERIMENTO AUTOMATICO ─────────────────────────────────────────────────
// Esegue atomicamente tutto quello che serve quando una trattativa viene accettata:
// 1. Sposta il giocatore nella rosa della squadra acquirente
// 2. Aggiorna lo stipendio in base alla nuova quotazione (art. 5.9)
// 3. Registra i movimenti di entrata/uscita per entrambe le squadre
// 4. Aggiorna i bilanci di entrambe le squadre
// 5. Marca la trattativa come "completata"
// Per prestiti: tiene traccia della scadenza, non sposta definitivamente
export async function eseguiTrasferimento(trattativa) {
  const { da_squadra, a_squadra, giocatore, prezzo, tipo, quota_giocatore,
          scadenza_prestito, stipendio_a_chi, fuori_mercato, id,
          giocatore_scambio } = trattativa;

  const oggi = new Date().toISOString().slice(0, 10);
  const tipoLabel = {
    cessione: "Cessione", prestito_diritto: "Prestito c/Dir.",
    prestito_obbligo: "Prestito c/Obl.", prestito_secco: "Prestito Secco",
    clausola: "Clausola Rescissoria", scambio: "Scambio",
  };
  const descLabel = tipoLabel[tipo] || tipo;
  const isPrestito = tipo.startsWith('prestito');

  // Convenzione trattative: da_squadra = acquirente/mittente; a_squadra = cedente/proprietario.
  const squadraAcquirente = da_squadra;
  const squadraCedente = a_squadra;

  // ── 1. Trova il giocatore nella rosa della squadra cedente ──────────────────
  const { data: rosaRows } = await supabase
    .from('rosa')
    .select('*')
    .eq('squadra', squadraCedente)
    .ilike('nome', `%${giocatore}%`);

  const player = rosaRows?.[0];
  if (!player) throw new Error(`${giocatore} non risulta nella rosa di ${squadraCedente}`);

  // Art. 3: il trasferimento non può portare la rosa acquirente oltre i limiti regolamentari.
  await assertRosaDopoAggiunta(squadraAcquirente, { ...player, squadra: squadraAcquirente, in_vivaio: false });

  if (player) {
    // ── 2. Calcola nuovo stipendio (art. 5.9): basato su quotazione attuale ──
    const nuovaQuot = trattativa.quot_giocatore || player.quot;
    const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));

    if (isPrestito) {
      // Prestito: aggiorna squadra temporanea, mantieni traccia del proprietario
      // Chi paga lo stipendio dipende da stipendio_a_chi
      await supabase.from('rosa').update({
        squadra: squadraAcquirente,
        in_prestito: true,
        squadra_originale: squadraCedente,
        scadenza_prestito,
        stip: stipendio_a_chi === 'cedente' ? 0 : nuovoStip, // cedente paga → 0 per ricevente
        stip_prestito_cedente: stipendio_a_chi === 'cedente' ? nuovoStip : 0,
      }).eq('id', player.id);
    } else {
      // Cessione definitiva: aggiorna squadra e stipendio
      await supabase.from('rosa').update({
        squadra: squadraAcquirente,
        stip: nuovoStip,
        stip_originale: nuovoStip,
        anni_contratto: 1, // reimposta da anno 1 (art. 5.9)
        data_acquisto: oggi,
        in_prestito: false,
        squadra_originale: null,
        scadenza_prestito: null,
      }).eq('id', player.id);
    }
  }
  // ── 2b. Per scambio: muovi anche il giocatore di contropartita ─────────────
  if (tipo === 'scambio' && giocatore_scambio) {
    const { data: rows2 } = await supabase.from('rosa').select('*')
      .eq('squadra', squadraAcquirente).ilike('nome', `%${giocatore_scambio}%`);
    const p2 = rows2?.[0];
    if (p2) {
      const nuovoStip2 = parseFloat((Number(p2.quot || 0) / 5).toFixed(2));
      await supabase.from('rosa').update({
        squadra: squadraCedente, stip: nuovoStip2, stip_originale: nuovoStip2,
        anni_contratto: 1, data_acquisto: oggi,
        in_prestito: false, squadra_originale: null, scadenza_prestito: null,
      }).eq('id', p2.id);
    }
  }

  // Se il giocatore non è trovato nella rosa (es. svincolato), non sposta nulla
  // ma registra comunque i movimenti finanziari

  // ── 3. Calcola importi per clausola rescissoria (art. 5.5.2): 3/4 al venditore ──
  const importoCedente = tipo === 'clausola'
    ? parseFloat((prezzo * 3 / 4).toFixed(2))
    : prezzo;
  const importoAcquirente = prezzo;

  // ── 4. Aggiorna bilanci ─────────────────────────────────────────────────────
  // Leggi bilanci attuali
  const { data: squadreData } = await supabase
    .from('squadre')
    .select('name, bilancio')
    .in('name', [squadraCedente, squadraAcquirente]);

  const bilCedente = squadreData?.find(s => s.name === squadraCedente)?.bilancio || 0;
  const bilAcquirente = squadreData?.find(s => s.name === squadraAcquirente)?.bilancio || 0;

  const nuovoBilCedente = parseFloat((bilCedente + importoCedente).toFixed(2));
  const nuovoBilAcquirente = parseFloat((bilAcquirente - importoAcquirente).toFixed(2));

  await supabase.from('squadre').update({ bilancio: nuovoBilCedente }).eq('name', squadraCedente);
  await supabase.from('squadre').update({ bilancio: nuovoBilAcquirente }).eq('name', squadraAcquirente);

  // ── 5. Registra movimenti ───────────────────────────────────────────────────
  const notaFuori = fuori_mercato ? " (trasf. differito)" : "";
  await supabase.from('movimenti').insert([
    {
      squadra: squadraCedente,
      descrizione: `${descLabel}: ${giocatore} → ${squadraAcquirente}${notaFuori}`,
      entrata: importoCedente,
      uscita: null,
      data: oggi,
    },
    {
      squadra: squadraAcquirente,
      descrizione: `${descLabel}: ${giocatore} da ${squadraCedente}${notaFuori}`,
      entrata: null,
      uscita: importoAcquirente,
      data: oggi,
    },
  ]);

  // Per clausola: registra la quota trattenuta (1/4 del valore — art. 5.5.2)
  if (tipo === 'clausola') {
    const diff = parseFloat((prezzo - importoCedente).toFixed(2));
    if (diff > 0) await supabase.from('movimenti').insert({
      squadra: squadraCedente,
      descrizione: `Ritenuta clausola rescissoria (1/4): ${giocatore}`,
      entrata: null, uscita: diff, data: oggi,
    });
  }

  // ── 6. Marca trattativa completata ─────────────────────────────────────────
  await supabase.from('trattative').update({
    stato: 'completata',
    updated_at: new Date().toISOString(),
  }).eq('id', id);

  // ── 7. Aggiorna tracciamento passaggi sessione (art. 5.6 — max 3 squadre) ─
  try {
    await checkEAggiornaPassaggi(giocatore, squadraAcquirente, tipo);
  } catch(passErr) {
    console.warn('Passaggi sessione:', passErr.message);
  }

  // ── 8. Inserisce bonus trattativa nella tab Clausole di entrambe le squadre ─
  try {
    const { data: bonusList } = await supabase
      .from('trattative_bonus')
      .select('*')
      .eq('trattativa_id', id);

    for (const bonus of bonusList || []) {
      const labelTipo = {
        partite_voto: 'Partite a voto', gol_fatti: 'Gol fatti', assist: 'Assist',
        bonus_tot: 'Bonus (Gol+Assist)', ammonizioni: 'Ammonizioni',
        espulsioni: 'Espulsioni', gol_subiti: 'Gol subiti', malus_tot: 'Malus',
      };
      const desc = `${labelTipo[bonus.tipo_bonus] || bonus.tipo_bonus} ≥ ${bonus.soglia}`;
      const squadraPaga = bonus.direzione === 'acquirente_paga' ? squadraAcquirente : squadraCedente;
      const squadraRiceve = bonus.direzione === 'acquirente_paga' ? squadraCedente : squadraAcquirente;

      // Inserisci per entrambe le squadre
      await supabase.from('clausole').insert([
        {
          squadra: squadraPaga,
          giocatore,
          tipo: 'bonus_trasf',
          condizione: desc,
          valore: bonus.valore_mln,
          note: `Paga ${bonus.valore_mln}M a ${squadraRiceve} al completamento · trattativa #${id}`,
          trattativa_bonus_id: bonus.id,
          completata: false,
        },
        {
          squadra: squadraRiceve,
          giocatore,
          tipo: 'bonus_trasf',
          condizione: desc,
          valore: bonus.valore_mln,
          note: `Riceve ${bonus.valore_mln}M da ${squadraPaga} al completamento · trattativa #${id}`,
          trattativa_bonus_id: bonus.id,
          completata: false,
        },
      ]);
    }
  } catch(bonusErr) {
    console.warn('Bonus clausole insert:', bonusErr.message);
  }

  return { ok: true, player, nuovoBilCedente, nuovoBilAcquirente };
}

// Rientro da prestito: riporta il giocatore alla squadra originale
export async function eseguiRientroPrestito(playerId, squadraOriginale) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!player) return;

  // Ripristina stipendio corretto (Q/5) per la squadra cedente
  const nuovoStip = parseFloat((Number(player.quot || 0) / 5).toFixed(2));
  await supabase.from('rosa').update({
    squadra: squadraOriginale,
    in_prestito: false,
    squadra_originale: null,
    scadenza_prestito: null,
    stip: nuovoStip,
    stip_prestito_cedente: 0,
  }).eq('id', playerId);

  await supabase.from('movimenti').insert({
    squadra: squadraOriginale,
    descrizione: `Rientro da prestito: ${player.nome}`,
    entrata: null, uscita: null, data: oggi,
  });
}

// ── Controllo e gestione prestiti scaduti (art. 5.8) ─────────────────────────
export async function getPrestitiScaduti() {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from('rosa')
    .select('id, nome, squadra, squadra_originale, quot, scadenza_prestito')
    .eq('in_prestito', true)
    .lte('scadenza_prestito', oggi);
  if (!data?.length) return [];

  // Per ogni prestito scaduto, cerca la trattativa originale per il tipo
  const results = [];
  for (const p of data) {
    const { data: tratt } = await supabase.from('trattative')
      .select('tipo, prezzo, id')
      .eq('giocatore', p.nome)
      .in('tipo', ['prestito_secco', 'prestito_diritto', 'prestito_obbligo'])
      .order('created_at', { ascending: false })
      .limit(1);
    const t = tratt?.[0];
    results.push({ player: p, tipo: t?.tipo || 'prestito_secco', prezzo: t?.prezzo || 0, trattativaId: t?.id });
  }
  return results;
}

export async function eseguiScadenzaPrestito(item) {
  const { player, tipo, prezzo } = item;
  const oggi = new Date().toISOString().slice(0, 10);

  if (tipo === 'prestito_obbligo') {
    const squadraRicevente = player.squadra;
    const squadraCedente = player.squadra_originale;
    if (!squadraCedente) throw new Error('Squadra cedente del prestito non disponibile');
    // Obbligo di riscatto: il giocatore passa definitivamente al ricevente
    const nuovoStip = parseFloat((Number(player.quot || 0) / 5).toFixed(2));
    await supabase.from('rosa').update({
      squadra: squadraRicevente, // rimane al ricevente
      in_prestito: false, squadra_originale: null, scadenza_prestito: null,
      stip: nuovoStip, stip_originale: nuovoStip, anni_contratto: 1,
    }).eq('id', player.id);
    // Pagamento riscatto
    if (prezzo > 0) {
      const { data: sqs } = await supabase.from('squadre').select('name,bilancio').in('name', [squadraRicevente, squadraCedente]);
      const bilRic = sqs?.find(s => s.name === squadraRicevente)?.bilancio || 0;
      const bilCed = sqs?.find(s => s.name === squadraCedente)?.bilancio || 0;
      await supabase.from('squadre').update({ bilancio: parseFloat((bilRic - prezzo).toFixed(2)) }).eq('name', squadraRicevente);
      await supabase.from('squadre').update({ bilancio: parseFloat((bilCed + prezzo).toFixed(2)) }).eq('name', squadraCedente);
      await supabase.from('movimenti').insert([
        { squadra: squadraRicevente, descrizione: `Riscatto obbligo ${player.nome}`, uscita: prezzo, data: oggi },
        { squadra: squadraCedente, descrizione: `Riscatto obbligo ${player.nome} (incasso)`, entrata: prezzo, data: oggi },
      ]);
    }
  } else {
    // Secco o diritto non esercitato: torna al cedente
    await eseguiRientroPrestito(player.id, player.squadra_originale);
  }
}

// ── Rescissione anticipata prestito (art. 5.8.1) ─────────────────────────────
// chiPaga: 'ricevente' (25% Q) | 'cedente' (50% Q)
export async function eseguiRescissioneAnticipataPrestito(playerId, chiPaga) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!player || !player.in_prestito) throw new Error('Giocatore non in prestito');

  const squadraRicevente = player.squadra;
  const squadraCedente   = player.squadra_originale;
  const quot = Number(player.quot);

  // Costo indennizzo: 25% Q per chi riceve, 50% Q per chi ha ceduto
  const pct = chiPaga === 'ricevente' ? 0.25 : 0.50;
  const indennizzo = parseFloat((quot * pct).toFixed(2));

  // Squadra che paga e squadra che riceve l'indennizzo
  const squadraPaga    = chiPaga === 'ricevente' ? squadraRicevente : squadraCedente;
  const squadraIncassa = chiPaga === 'ricevente' ? squadraCedente   : squadraRicevente;

  // Aggiorna bilanci
  const { data: sqs } = await supabase.from('squadre').select('name,bilancio')
    .in('name', [squadraPaga, squadraIncassa]);
  const bilPaga    = sqs?.find(s => s.name === squadraPaga)?.bilancio    || 0;
  const bilIncassa = sqs?.find(s => s.name === squadraIncassa)?.bilancio || 0;
  await supabase.from('squadre').update({ bilancio: parseFloat((bilPaga    - indennizzo).toFixed(2)) }).eq('name', squadraPaga);
  await supabase.from('squadre').update({ bilancio: parseFloat((bilIncassa + indennizzo).toFixed(2)) }).eq('name', squadraIncassa);

  // Riporta il giocatore alla squadra cedente (proprietario)
  const nuovoStip = parseFloat((quot / 5).toFixed(2));
  await supabase.from('rosa').update({
    squadra: squadraCedente,
    in_prestito: false,
    squadra_originale: null,
    scadenza_prestito: null,
    stip: nuovoStip,
  }).eq('id', playerId);

  // Movimenti
  await supabase.from('movimenti').insert([
    { squadra: squadraPaga,    descrizione: `Indennizzo rescissione prestito ${player.nome}`,         uscita: indennizzo, data: oggi },
    { squadra: squadraIncassa, descrizione: `Indennizzo rescissione prestito ${player.nome} (incasso)`, entrata: indennizzo, data: oggi },
  ]);

  return { indennizzo, squadraCedente, squadraRicevente };
}

// ── Tracciamento passaggi giocatore in sessione (art. 5.6) ────────────────────
// Aggiorna il contatore passaggi su rosa; blocca se già a 2 (terzo deve essere prestito)
export async function checkEAggiornaPassaggi(giocatoreNome, squadraDestinazione, tipo) {
  // Cerca giocatore in qualunque rosa
  const { data: rows } = await supabase.from('rosa').select('id,nome,squadra,passaggi_sessione')
    .ilike('nome', giocatoreNome).limit(1);
  const player = rows?.[0];
  if (!player) return { ok: true, passaggi: 0 };

  const passaggi = Number(player.passaggi_sessione || 0);

  // Art. 5.6 (aggiornato): la squadra iniziale conta come squadra 1, max 3 squadre totali
  // → massimo 2 trasferimenti per sessione, qualsiasi tipo (anche cessione permanente)
  if (passaggi >= 2) {
    throw new Error(`${giocatoreNome} ha già raggiunto il limite di 3 squadre in questa sessione (squadra iniziale = squadra 1).`);
  }

  await supabase.from('rosa').update({ passaggi_sessione: passaggi + 1 }).eq('id', player.id);
  return { ok: true, passaggi: passaggi + 1 };
}

// Reset passaggi a fine sessione di mercato (da chiamare quando si chiude il mercato)
export async function resetPassaggiSessione() {
  await supabase.from('rosa').update({ passaggi_sessione: 0 });
}

// ── Notifiche offerta — calcola scadenze risposta (art. 5.3) ─────────────────
// Restituisce per ogni offerta in attesa quanto tempo rimane e la penalità attuale
export function calcolaStatoNotificaOfferta(offerta) {
  const now = new Date();
  const creata = new Date(offerta.created_at);
  const orePassate = (now - creata) / 3600000;

  if (orePassate < 24)  return { urgenza: 'ok',       oreRimaste: 24 - orePassate,  penalita: null,    messaggio: `Risposta entro ${Math.round(24 - orePassate)}h` };
  if (orePassate < 36)  return { urgenza: 'warning',   oreRimaste: 36 - orePassate,  penalita: '1M',    messaggio: `⚠️ Penalità 1M · ${Math.round(36  - orePassate)}h al prossimo scatto` };
  if (orePassate < 48)  return { urgenza: 'danger',    oreRimaste: 48 - orePassate,  penalita: '3M',    messaggio: `🔴 Penalità 3M · ${Math.round(48  - orePassate)}h al prossimo scatto` };
  if (orePassate < 72)  return { urgenza: 'critical',  oreRimaste: 72 - orePassate,  penalita: '5M',    messaggio: `🚨 Penalità 5M · ${Math.round(72  - orePassate)}h al prossimo scatto` };
  if (orePassate < 96)  return { urgenza: 'max',       oreRimaste: 96 - orePassate,  penalita: 'Q/2',   messaggio: `💀 Acquisto forzato a ½Q tra ${Math.round(96 - orePassate)}h` };
  return { urgenza: 'scaduta', oreRimaste: 0, penalita: 'Q/2', messaggio: '💀 Scaduta — acquisto forzato a ½Q' };
}

// Numero offerte che richiedono risposta da mySquadra
export async function getOfferteInAttesa(mySquadra) {
  const { data } = await supabase.from('trattative').select('*')
    .eq('stato', 'in attesa')
    .eq('a_squadra', mySquadra)  // offerte RICEVUTE
    .order('created_at', { ascending: true });
  return data || [];
}

// ─── CLAUSOLE ────────────────────────────────────────────────────────────────

export async function getClausole(squadra) {
  const q = supabase.from('clausole').select('*').order('created_at', { ascending: false });
  if (squadra) q.eq('squadra', squadra);
  const { data, error } = await q;
  if (error) return [];
  return data;
}

export async function insertClausola(c) {
  const { data, error } = await supabase.from('clausole').insert(c).select().single();
  if (error) throw error;
  return data;
}

export async function updateClausola(id, fields) {
  const { error } = await supabase.from('clausole').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteClausola(id) {
  const { error } = await supabase.from('clausole').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeClausole(squadra, callback) {
  return supabase.channel(`clausole-${squadra}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clausole', filter: `squadra=eq.${squadra}` }, callback)
    .subscribe();
}

// Rosa in prestito attivi
export async function getPrestitiAttivi(squadra) {
  const { data, error } = await supabase.from('rosa').select('*')
    .eq('in_prestito', true)
    .or(`squadra.eq.${squadra},squadra_originale.eq.${squadra}`);
  if (error) return [];
  return data;
}

// ─── CLASSIFICA ───────────────────────────────────────────────────────────────
export async function getClassifica() {
  const { data, error } = await supabase
    .from('classifica')
    .select('*')
    .order('pt', { ascending: false });
  if (error) return [];
  return data;
}

export async function updateClassificaSquadra(squadra, fields) {
  const { error } = await supabase
    .from('classifica')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('squadra', squadra);
  if (error) throw error;
}

export async function upsertClassifica(rows) {
  // rows: array di oggetti { squadra, g, v, n, p, gf, gs, dr, pt, pt_totali }
  const { error } = await supabase
    .from('classifica')
    .upsert(rows, { onConflict: 'squadra' });
  if (error) throw error;
}

export function subscribeClassifica(callback) {
  return supabase.channel('classifica-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'classifica' }, callback)
    .subscribe();
}

// ─── SVINCOLI ────────────────────────────────────────────────────────────────

export async function getSvincoli(squadra) {
  const q = supabase.from('svincoli').select('*').order('data_svincolo', { ascending: false });
  if (squadra) q.eq('squadra', squadra);
  const { data, error } = await q;
  if (error) return [];
  return data;
}

export async function insertSvincolo(s) {
  const { data, error } = await supabase.from('svincoli').insert(s).select().single();
  if (error) throw error;
  return data;
}

export async function getStagioneSvincoli(squadra) {
  const { data, error } = await supabase.from('stagione_svincoli').select('*').eq('squadra', squadra).limit(1);
  if (error) throw error;
  if (data?.[0]) return data[0];

  // Se il record stagionale non esiste ancora, lo creo subito: senza questa riga
  // gli svincoli venivano eseguiti ma i contatori restavano fermi.
  const iniziale = {
    squadra,
    count_ordinari: 0,
    count_straord_estivi: 0,
    count_straord_invernali: 0,
    count_totale: 0,
    svincolati_history: [],
  };
  const { data: creato, error: insErr } = await supabase
    .from('stagione_svincoli')
    .insert(iniziale)
    .select()
    .single();
  if (insErr) throw insErr;
  return creato;
}

export async function updateStagioneSvincoli(squadra, fields) {
  const { error } = await supabase.from('stagione_svincoli').update(fields).eq('squadra', squadra);
  if (error) throw error;
}

// Esegue lo svincolo completo:
// 1. Rimuove il giocatore dalla rosa
// 2. Registra il movimento finanziario (penale o indennizzo)
// 3. Inserisce il record in svincoli
// 4. Aggiorna i contatori in stagione_svincoli
// 5. Aggiorna il bilancio della squadra
function stagioneDaData(data = new Date()) {
  const y = data.getFullYear();
  const start = (data.getMonth() > 5 || (data.getMonth() === 5 && data.getDate() >= 1)) ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

function giorniTra(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function _inizioGiorno(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function _isPeriodoSvincoliConsentito(date = new Date()) {
  const m = date.getMonth();
  // Art. 6.1: svincoli ammessi dal 01/08 al 31/05.
  return !(m === 5 || m === 6); // giugno, luglio
}

function _getPeriodoStraordinariSvincoli(date = new Date()) {
  const m = date.getMonth();
  const d = date.getDate();
  // Estivo = mercato estivo 01/06-15/09; giugno/luglio restano bloccati sopra,
  // quindi gli straordinari estivi effettivamente utilizzabili sono 01/08-15/09.
  if ((m === 5) || (m === 6) || (m === 7) || (m === 8 && d <= 15)) return 'estivo';
  // Invernale = mercato invernale 01/01-15/02.
  if (m === 0 || (m === 1 && d <= 15)) return 'invernale';
  return null;
}

function _contaMensilitaGiaPagate(date = new Date()) {
  // Stagione stipendiale nuova: reset immediato il 01/06 dopo il pagamento finale della stagione precedente.
  // Conteggio mensile: giugno=0, luglio=1, agosto=2, ..., maggio=11.
  const m = date.getMonth(); // 0=gennaio, ..., 5=giugno, 11=dicembre
  if (m >= 5) return m - 5;      // giu 0, lug 1, ..., dic 6
  return m + 7;                  // gen 7, feb 8, ..., mag 11
}

function _contaMensilitaResidueDaPagare(date = new Date()) {
  // Le mensilità residue sono quelle ancora da pagare fino al prossimo 01/06 incluso.
  return 12 - _contaMensilitaGiaPagate(date);
}

export async function eseguiSvincolo({ squadra, player, tipo, estero = false, bilancioAttuale }) {
  const oggi = new Date();
  const oggiStr = oggi.toISOString().slice(0, 10);

  if (!_isPeriodoSvincoliConsentito(oggi)) {
    throw new Error('Svincoli non consentiti a giugno/luglio: sono ammessi solo dal 01/08 al 31/05.');
  }

  const periodoStraordinari = _getPeriodoStraordinariSvincoli(oggi);
  if ((tipo === 'straordinario' || tipo === 'straordinario_u21') && !periodoStraordinari) {
    throw new Error('Gli svincoli straordinari sono consentiti solo durante il mercato estivo (01/06-15/09, con giugno/luglio bloccati per gli svincoli) o invernale (01/01-15/02).');
  }

  if (player.data_acquisto) {
    const acquistatoIl = new Date(`${player.data_acquisto}T00:00:00`);
    const trascorsi = giorniTra(acquistatoIl, oggi);
    if (trascorsi < 30) {
      const disponibileDal = new Date(acquistatoIl.getTime() + 30 * 86400000).toISOString().slice(0, 10);
      throw new Error(`Non puoi svincolare ${player.nome} prima di 30 giorni dall'acquisto. Disponibile dal ${disponibileDal}.`);
    }
  }

  const contatoriPre = await getStagioneSvincoli(squadra);
  const totalePre = Number(contatoriPre?.count_totale || 0);

  // ── Calcola costi/indennizzi ──────────────────────────────────────────────
  const quot = Number(player.quot || 0);
  // Usa lo stesso stipendio corretto della UI, così preview e registrazione reale coincidono.
  const stip = _calcolaStipCorretto(player.quot, player.anni_contratto, player.anni);
  const isU21 = player.anni > 0 && player.anni <= 21;

  let costoTotale = 0;
  let indennizzo = 0;
  let mesiRimborsati = 0;
  let costoPenale = 0;
  let movDesc = '';

  if (tipo === 'ordinario') {
    // Penale per quotazione (art. 6.1)
    costoPenale = quot <= 10 ? 0.5 : quot <= 20 ? 1 : quot <= 30 ? 1.5 : 2;

    // Mensilità residue da pagare: prossime scadenze mensili dopo lo svincolo fino al 01/06 incluso.
    const mesiRimasti = _contaMensilitaResidueDaPagare(oggi);
    const costoMensile = parseFloat((stip / 12).toFixed(2));
    const costoStipendi = parseFloat((mesiRimasti * costoMensile).toFixed(2));

    costoTotale = parseFloat((costoPenale + costoStipendi).toFixed(2));
    movDesc = `Svincolo ordinario: ${player.nome} (penale ${costoPenale}M + ${mesiRimasti} mens. residue ${costoStipendi}M)`;

  } else if (tipo === 'straordinario' || tipo === 'straordinario_u21') {
    // Indennizzo: ¼ quot (o ½ se estero) — art. 6.1
    indennizzo = estero
      ? parseFloat((quot / 2).toFixed(2))
      : parseFloat((quot / 4).toFixed(2));

    // Rimborso delle mensilità già pagate nella stagione: 01/07, 01/08, ..., fino alla data di svincolo.
    mesiRimborsati = _contaMensilitaGiaPagate(oggi);
    const rimborsoStipendi = parseFloat((mesiRimborsati * stip / 12).toFixed(2));

    // Netto: indennizzo + rimborso stipendi (entrate per la squadra)
    indennizzo = parseFloat((indennizzo + rimborsoStipendi).toFixed(2));
    costoTotale = -indennizzo; // negativo = entrata
    movDesc = `Svincolo straordinario: ${player.nome} (+${indennizzo}M ind.${estero?' estero':''}+rimb.)`;

  } else if (tipo === 'straordinario_u21_nc') {
    // U21 non conteggiato: costo e guadagno 0
    costoTotale = 0;
    movDesc = `Svincolo U21 (nc): ${player.nome}`;
  }

  // Penale extra: 2M per ogni svincolo conteggiato oltre il 14° (art. 6.5).
  const isConteggiatoPerTotale = tipo !== 'straordinario_u21_nc';
  const numeroProgressivo = totalePre + (isConteggiatoPerTotale ? 1 : 0);
  const penaleOltre14 = isConteggiatoPerTotale && numeroProgressivo > 14 ? 2 : 0;
  if (penaleOltre14 > 0) {
    costoTotale = parseFloat((costoTotale + penaleOltre14).toFixed(2));
    movDesc += ` + penale oltre 14 svincoli ${penaleOltre14}M`;
  }

  // ── 1. Salva stats nella tabella svincolati prima di rimuovere ───────────────
  await supabase.from('svincolati').upsert({
    nome: player.nome,
    ruolo: player.ruolo,
    anni: player.anni || 0,
    quot: player.quot || 0,
    stip: player.stip || 0,
    clausola: parseFloat(((player.quot || 0) * 1.75).toFixed(2)),
    fuori_lista: false,
    squadra_serie_a: player.squadra_serie_a || null,
    partite: player.partite || 0,
    media_voto: player.media_voto || 0,
    media_fantavoto: player.media_fantavoto || 0,
    gol: player.gol || 0,
    assist: player.assist || 0,
    ammonizioni: player.ammonizioni || 0,
    espulsioni: player.espulsioni || 0,
    autogol: player.autogol || 0,
    rigori_parati: player.rigori_parati || 0,
    rigori_segnati: player.rigori_segnati || 0,
    rigori_sbagliati: player.rigori_sbagliati || 0,
    gol_subiti: player.gol_subiti || 0,
    stagione: stagioneDaData(oggi),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'nome,stagione' });

  // ── 2. Rimuovi dalla rosa ─────────────────────────────────────────────────
  await supabase.from('rosa').delete().eq('id', player.id);

  // ── 3. Aggiorna bilancio ──────────────────────────────────────────────────
  const nuovoBilancio = parseFloat((bilancioAttuale - costoTotale).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);

  // ── 4. Movimento finanziario ──────────────────────────────────────────────
  await supabase.from('movimenti').insert({
    squadra,
    descrizione: movDesc,
    entrata: costoTotale < 0 ? Math.abs(costoTotale) : null,
    uscita: costoTotale > 0 ? costoTotale : null,
    data: oggiStr,
  });

  // ── 5. Record svincolo ────────────────────────────────────────────────────
  await supabase.from('svincoli').insert({
    squadra, giocatore: player.nome, quot, anni: player.anni,
    tipo, costo_penale: costoPenale, indennizzo,
    mesi_rimborsati: mesiRimborsati, estero,
    data_svincolo: oggiStr,
  });

  // ── 6. Aggiorna contatori stagione ────────────────────────────────────────
  const contatori = contatoriPre;
  if (contatori) {
    const history = Array.isArray(contatori.svincolati_history) ? contatori.svincolati_history : [];
    const riacquistabileDal = new Date(oggi.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    history.push({ nome: player.nome, data_svincolo: oggiStr, riacquistabile_dal: riacquistabileDal });

    const isConteggiato = tipo !== 'straordinario_u21_nc';
    const isStraord = tipo === 'straordinario' || tipo === 'straordinario_u21';
    const periodo = _getPeriodoStraordinariSvincoli(oggi);
    const isEstivo = periodo === 'estivo';
    const isInvernale = periodo === 'invernale';

    await updateStagioneSvincoli(squadra, {
      count_ordinari:            contatori.count_ordinari + (tipo === 'ordinario' ? 1 : 0),
      count_straord_estivi:      contatori.count_straord_estivi + (isStraord && isEstivo && isConteggiato ? 1 : 0),
      count_straord_invernali:   contatori.count_straord_invernali + (isStraord && isInvernale && isConteggiato ? 1 : 0),
      count_totale:              contatori.count_totale + (isConteggiato ? 1 : 0),
      svincolati_history:        history,
    });
  }

  return { ok: true, costoTotale, nuovoBilancio, movDesc };
}

// ─── TASSE SETTIMANALI (art. 7.1) ─────────────────────────────────────────────

// Calcola la tassa settimanale per un dato bilancio
// art. 7.1 + 7.1.2: tassa sempre attiva, ma giu-ago = 1% flat per tutti
export function calcolaTassa(bilancio) {
  if (bilancio <= 0) return { perc: 0, importo: 0 };
  const m = new Date().getMonth(); // 0-based
  const isPeriodoFlat = m === 5 || m === 6; // giu(5), lug(6) — art. 7.1.2: flat 1% solo dal 01/06 al 01/08
  if (isPeriodoFlat) return { perc: 1, importo: parseFloat((bilancio * 0.01).toFixed(2)), flat: true };
  if (bilancio <= 20)  return { perc: 1,  importo: parseFloat((bilancio * 0.01).toFixed(2)) };
  if (bilancio <= 40)  return { perc: 2,  importo: parseFloat((bilancio * 0.02).toFixed(2)) };
  if (bilancio <= 60)  return { perc: 3,  importo: parseFloat((bilancio * 0.03).toFixed(2)) };
  if (bilancio <= 80)  return { perc: 5,  importo: parseFloat((bilancio * 0.05).toFixed(2)) };
  if (bilancio <= 100) return { perc: 8,  importo: parseFloat((bilancio * 0.08).toFixed(2)) };
  return               { perc: 10, importo: parseFloat((bilancio * 0.10).toFixed(2)) };
}

// Tassa sempre attiva (art. 7.1 + 7.1.2: giu-ago = 1% flat, resto = scaglioni)
export function isTassaAttiva() {
  return true;
}

export async function getTassePagate(squadra) {
  const { data, error } = await supabase.from('tasse_settimanali')
    .select('*').eq('squadra', squadra).order('data_controllo', { ascending: false });
  if (error) return [];
  return data;
}

// Applica la tassa settimanale (domenica alle 23:00)
export async function applicaTassaSettimana(squadra, bilancioCorrente, dataControllo = null, settimanaLabel = null) {
  const { perc, importo, flat } = calcolaTassa(bilancioCorrente);
  if (importo <= 0) return { skip: true, motivo: 'Bilancio 0 o negativo' };

  const oggi = new Date().toISOString().slice(0, 10);
  const dataRef = dataControllo || oggi;
  const { week, year } = getWeekNumber(new Date(dataRef));
  const wLabel = settimanaLabel || `${week}/${year}`;

  // Deduplicazione per settimana ISO: controlla tutte le domeniche della stessa settimana
  // Questo previene doppi pagamenti quando la tassa viene applicata in giorni diversi
  // della stessa settimana (es. sabato E lunedì successivo) che hanno domeniche diverse.
  const lunedi = new Date(dataRef);
  const d = lunedi.getDay(); // 0=dom
  lunedi.setDate(lunedi.getDate() - (d === 0 ? 6 : d - 1)); // inizio settimana ISO (lunedì)
  const domenicaSettimana = new Date(lunedi);
  domenicaSettimana.setDate(lunedi.getDate() + 6); // domenica della stessa settimana ISO
  const lunediStr = lunedi.toISOString().slice(0, 10);
  const domenicaStr = domenicaSettimana.toISOString().slice(0, 10);

  const { data: giaSettimana } = await supabase
    .from('tasse_settimanali')
    .select('id')
    .eq('squadra', squadra)
    .gte('data_controllo', lunediStr)
    .lte('data_controllo', domenicaStr)
    .limit(1);
  if (giaSettimana?.length) return { skip: true, motivo: `Tassa settimana ${wLabel} già applicata` };

  // Inserisce record tassa — usa data_controllo = domenica per deduplicazione
  const { error: insErr } = await supabase.from('tasse_settimanali').insert({
    squadra, bilancio_al_controllo: bilancioCorrente,
    percentuale: perc, importo_tassa: importo,
    data_controllo: dataRef, applicata: true,
  });
  // Se l'insert fallisce (es. già inserito da altro client), salta silenziosamente
  if (insErr) return { skip: true, motivo: 'Già applicata (race condition)' };

  // Scala dal bilancio
  const nuovoBilancio = parseFloat((bilancioCorrente - importo).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  const desc = flat
    ? `Tassa settimanale 1% flat (bilancio ${bilancioCorrente.toFixed(2)}M) settimana ${wLabel}`
    : `Tassa settimanale ${perc}% (bilancio ${bilancioCorrente.toFixed(2)}M) settimana ${wLabel}`;
  await supabase.from('movimenti').insert({ squadra, descrizione: desc, uscita: importo, data: oggi });
  return { ok: true, importo, nuovoBilancio };
}

// ─── PAGAMENTI AUTOMATICI ─────────────────────────────────────────────────────
// Replicato da App.jsx per uso server-side
function _calcolaStipCorretto(quot, anniContratto, anni) {
  const base = parseFloat((Number(quot || 0) / 5).toFixed(2));
  const isU21 = anni > 0 && anni <= 21;
  const ac = anniContratto || 0;
  if (isU21 || ac <= 1) return base;
  if (ac === 2) return parseFloat((base * 1.1).toFixed(2));
  if (ac === 3) return parseFloat((base * 1.2).toFixed(2));
  return parseFloat((base * 0.9).toFixed(2));
}

// Restituisce la data dell'ultima domenica (YYYY-MM-DD)
// La tassa scatta ogni domenica alle 23:00 — la domenica è la chiave di deduplicazione settimanale
export function getDomenicaCorrente() {
  const d = new Date();
  const giorno = d.getDay(); // 0=dom, 1=lun, ..., 6=sab
  const diff = giorno === 0 ? 0 : -giorno; // rimane domenica se è domenica, altrimenti torna alla domenica precedente
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Restituisce il primo giorno del mese corrente (YYYY-MM-DD)
function getPrimoDiMese() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Numero settimana ISO (1-53) per identificare univocamente la settimana
function getWeekNumber(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { week: Math.ceil((((date - yearStart) / 86400000) + 1) / 7), year: date.getUTCFullYear() };
}

export async function applicaPagamentiAutomatici() {
  const oggi = new Date();
  const oggiStr = oggi.toISOString().slice(0, 10);
  const ora = oggi.getHours();
  const results = { tasse: [], stipendi: [], stadio: [], vivaio: [], vivaioDecisioni: [], errori: [] };
  try {
    const vivaioCheck = await processaDecisioniVivaio();
    if (vivaioCheck?.richieste?.length || vivaioCheck?.svincolati?.length) results.vivaioDecisioni.push(vivaioCheck);
  } catch(e) { results.errori.push(`Decisioni vivaio: ${e.message}`); }

  // Carica tutte le squadre
  const { data: squadre } = await supabase.from('squadre').select('name, bilancio');
  if (!squadre?.length) return results;

  // NOTA: le tasse settimanali NON sono più automatiche.
  // Si applicano solo manualmente dalla Admin Control Room, così resta sempre possibile
  // decidere quando confermarle e annullarle in caso di errore.

  // ── STIPENDI MENSILI + STADIO ────────────────────────────────────────────
  // Applica il 1° del mese DALLE 9:00 in poi
  const primoDiMese = getPrimoDiMese();
  const meseISO = oggi.toISOString().slice(0, 7); // YYYY-MM
  if (oggiStr === primoDiMese && ora >= 9) {
    for (const sq of squadre) {
      try {
        // Controlla se gli stipendi sono già stati pagati questo mese (chiave esatta: YYYY-MM)
        const stipDesc = `Pagamento stipendi ${meseISO}`;
        const { data: gia } = await supabase
          .from('movimenti')
          .select('id')
          .eq('squadra', sq.name)
          .eq('descrizione', stipDesc)
          .limit(1);
        if (gia?.length) continue;

        // Calcola totale stipendi dalla rosa attiva
        const { data: rosa } = await supabase
          .from('rosa')
          .select('quot, anni_contratto, anni')
          .eq('squadra', sq.name)
          .eq('in_vivaio', false);

        const stipRosa = (rosa || []).reduce(
          (sum, p) => sum + _calcolaStipCorretto(p.quot, p.anni_contratto, p.anni), 0
        );

        // SC allenatore (5M fissi se carta scelta)
        const { data: all } = await supabase
          .from('allenatori_carte')
          .select('stipendio_sc')
          .eq('squadra', sq.name)
          .single()
          .catch(() => ({ data: null }));
        const stipAll = Number(all?.stipendio_sc || 0);

        const totalStip = parseFloat((stipRosa + stipAll).toFixed(2));
        const rata = parseFloat((totalStip / 12).toFixed(2));
        const nuovoBilancio = parseFloat((sq.bilancio - rata).toFixed(2));

        await supabase.from('movimenti').insert({
          squadra: sq.name,
          descrizione: stipDesc,
          uscita: rata,
          data: oggiStr,
        });
        await supabase.from('squadre').update({
          bilancio: nuovoBilancio,
          salary_used: totalStip,
        }).eq('name', sq.name);

        sq.bilancio = nuovoBilancio;
        results.stipendi.push({ squadra: sq.name, rata, nuovoBilancio });
      } catch(e) { results.errori.push(`Stipendi ${sq.name}: ${e.message}`); }
    }

    // Entrate stadio mensili: 4M base, 5.5M se "Ristrutturazione Stadio" presente
    const stadioDesc = `Entrate stadio ${meseISO}`;
    for (const sq of squadre) {
      try {
        const { data: giaStadio } = await supabase
          .from('movimenti')
          .select('id')
          .eq('squadra', sq.name)
          .eq('descrizione', stadioDesc)
          .limit(1);
        if (giaStadio?.length) continue;

        const { data: inv } = await supabase
          .from('investimenti')
          .select('id')
          .eq('squadra', sq.name)
          .eq('nome', 'Ristrutturazione Stadio')
          .limit(1);
        const entrata = inv?.length ? 5.5 : 4;
        const nuovoBilancio = parseFloat((Number(sq.bilancio || 0) + entrata).toFixed(2));

        await supabase.from('movimenti').insert({
          squadra: sq.name,
          descrizione: stadioDesc,
          entrata,
          data: oggiStr,
        });
        await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', sq.name);

        sq.bilancio = nuovoBilancio;
        results.stadio.push({ squadra: sq.name, importo: entrata, nuovoBilancio });
      } catch(e) { results.errori.push(`Stadio ${sq.name}: ${e.message}`); }
    }

    if (results.stipendi.length > 0) {
      await sendTelegramNotification('stipendi_applicati', { mese: meseISO, automatico: true });
    }
    if (results.stadio.length > 0) {
      await sendTelegramNotification('stadio_applicato', { mese: meseISO, automatico: true });
    }
  }

  // ── COSTO VIVAIO ANNUALE ────────────────────────────────────────────────
  // Art. 3.4.4: 4M obbligatori per tutti entro il 15/08 alle 23:59.
  if (oggi.getMonth() + 1 === 8 && (oggi.getDate() > 15 || (oggi.getDate() === 15 && (oggi.getHours() > 23 || (oggi.getHours() === 23 && oggi.getMinutes() >= 59))))) {
    const stagione = getStagioneQuota(oggi);
    const desc = `Costo mantenimento vivaio ${stagione}`;
    for (const sq of squadre) {
      try {
        const { data: gia } = await supabase.from('movimenti')
          .select('id').eq('squadra', sq.name).eq('descrizione', desc).limit(1);
        if (gia?.length) continue;
        const nuovoBilancio = parseFloat((Number(sq.bilancio || 0) - 4).toFixed(2));
        await supabase.from('movimenti').insert({ squadra: sq.name, descrizione: desc, uscita: 4, data: oggiStr });
        await supabase.from('squadre').update({ bilancio: nuovoBilancio, vivaio_pagato: true, vivaio_stagione_pagata: stagione, vivaio_pagato_il: oggiStr }).eq('name', sq.name);
        sq.bilancio = nuovoBilancio;
        results.vivaio.push({ squadra: sq.name, importo: 4, nuovoBilancio });
      } catch(e) { results.errori.push(`Vivaio ${sq.name}: ${e.message}`); }
    }
  }

  return results;
}

// ─── BILANCIO NEGATIVO (art. 7.2) ─────────────────────────────────────────────

// Fasce penalità bilancio negativo (art. 7.2) — regolamento aggiornato
// Soglie semplificate: -10/-20/-30, penalità dopo 1 settimana (2 in periodo mercato)
const FASCE_NEG = [
  { max: -10, pts: 5  },
  { max: -20, pts: 10 },
  { max: -30, pts: 15 },
];

export function getFasciaBilancioNeg(bilancio) {
  if (bilancio >= 0) return null;
  if (bilancio >= -10) return FASCE_NEG[0];
  if (bilancio >= -20) return FASCE_NEG[1];
  if (bilancio >= -30) return FASCE_NEG[2];
  return FASCE_NEG[2]; // oltre -30M: stessa fascia massima
}

export function getPenalitaNeg(bilancio, settimane) {
  const fascia = getFasciaBilancioNeg(bilancio);
  if (!fascia) return null;
  return {
    punti: fascia.pts,
    euro4: null,
    fallimento5: false, // rimosso nel nuovo regolamento
  };
}

export async function aggiornaStatoBilancioNeg(squadra, bilancio) {
  const { data: sq } = await supabase.from('squadre').select('bilancio_neg_dal, bilancio_neg_settimane').eq('name', squadra).single();
  if (!sq) return;

  if (bilancio >= 0) {
    // Rientrato in positivo — reset
    await supabase.from('squadre').update({ bilancio_neg_dal: null, bilancio_neg_settimane: 0 }).eq('name', squadra);
    return { reset: true };
  }

  const oggi = new Date().toISOString().slice(0, 10);
  if (!sq.bilancio_neg_dal) {
    await supabase.from('squadre').update({ bilancio_neg_dal: oggi, bilancio_neg_settimane: 1 }).eq('name', squadra);
    return { settimane: 1 };
  }

  const settimane = (sq.bilancio_neg_settimane || 0) + 1;
  await supabase.from('squadre').update({ bilancio_neg_settimane: settimane }).eq('name', squadra);
  return { settimane };
}

// ─── FAIR SPENDING (art. 7.3) ─────────────────────────────────────────────────

// Determina il semestre corrente
// Periodo 1 (estivo):    16/09 incluso → 15/02 incluso
// Periodo 2 (invernale): 16/02 incluso → 15/09 incluso
export function getSemestreCorrente() {
  const oggi = new Date();
  const m = oggi.getMonth() + 1, d = oggi.getDate(), y = oggi.getFullYear();

  // Siamo nel Periodo 1 se: dal 16/09 in poi, oppure fino al 15/02 incluso
  const isPeriodo1 =
    (m === 9 && d >= 16) || m > 9 ||   // dal 16/09 in poi
    m === 1 ||                           // tutto gennaio
    (m === 2 && d <= 15);               // fino al 15/02 incluso

  if (isPeriodo1) {
    const anno = m >= 9 ? y : y - 1;
    const inizioStr = `${anno}-09-16`;
    const fineStr   = `${anno+1}-02-15`;
    return {
      label:  `Periodo 1 (${anno}-${anno+1})`,
      inizio: new Date(`${inizioStr}T12:00:00`), // mezzogiorno evita shift UTC
      fine:   new Date(`${fineStr}T12:00:00`),
      inizioStr,
      fineStr,
    };
  }

  // Periodo 2: 16/02 → 15/09
  const inizioStr = `${y}-02-16`;
  const fineStr   = `${y}-09-15`;
  return {
    label:  `Periodo 2 (${y})`,
    inizio: new Date(`${inizioStr}T12:00:00`),
    fine:   new Date(`${fineStr}T12:00:00`),
    inizioStr,
    fineStr,
  };
}

// Calcola il netto speso in un semestre dai movimenti
export async function calcolaNettoSpeso(squadra, dataInizio, dataFine) {
  // Accetta sia oggetti Date che stringhe ISO (YYYY-MM-DD)
  const inizioStr = typeof dataInizio === 'string' ? dataInizio : dataInizio.toISOString().slice(0,10);
  const fineStr   = typeof dataFine   === 'string' ? dataFine   : dataFine.toISOString().slice(0,10);
  const movs = await getMovimentiFPF(squadra, inizioStr, fineStr);
  return parseFloat(movs.reduce((acc, m) => acc + m.contributo, 0).toFixed(2));
}

// Calcola la penalità fair spending per un dato netto
export function calcolaFairSpending(netto) {
  // art. 7.3 — soglia sicura 50M, 3 fasce di penalità
  if (netto <= 50) return { zona: 'sicura', multa: 0,  giorni: 0, pt: 0, euro: 0 };
  if (netto <= 55) return { zona: '50-55',  multa: 10, giorni: 0, pt: 0, euro: 0 };
  if (netto <= 60) return { zona: '55-60',  multa: 15, giorni: 0, pt: 2, euro: 0 };
  return             { zona: '>60',    multa: 20, giorni: 0, pt: 4, euro: 5  };
}

export async function getFairSpending(squadra) {
  const { data, error } = await supabase.from('fair_spending')
    .select('*').eq('squadra', squadra).order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

// ─── ALLENATORI CARTE (art. 9) ────────────────────────────────────────────────

export async function getAllenatori(stagione = '2026-27') {
  const { data, error } = await supabase.from('allenatori_carte')
    .select('*').eq('stagione', stagione).order('nome');
  if (error) return [];
  return data;
}

export async function getAllenatoreBySquadra(squadra, stagione = '2026-27') {
  const { data } = await supabase.from('allenatori_carte')
    .select('*').eq('squadra', squadra).eq('stagione', stagione).limit(1);
  return data?.[0] ?? null;
}

export async function getObiettiviCarta(allenatore, stagione = '2026-27') {
  const { data, error } = await supabase.from('obiettivi_carte')
    .select('*').eq('allenatore', allenatore).eq('stagione', stagione).order('ordine');
  if (error) return [];
  return data;
}

export async function getProgressoObiettivi(squadra, stagione = '2026-27') {
  const { data, error } = await supabase.from('progresso_obiettivi')
    .select('*, obiettivi_carte(*)').eq('squadra', squadra).eq('stagione', stagione);
  if (error) return [];
  return data;
}

export async function upsertProgresso(squadra, obiettivoId, fields, stagione = '2026-27') {
  const { error } = await supabase.from('progresso_obiettivi').upsert({
    squadra, obiettivo_id: obiettivoId, stagione, ...fields
  }, { onConflict: 'squadra,obiettivo_id,stagione' });
  if (error) throw error;
}

export async function scegliAllenatore(squadra, nomeAllenatore, bilancioAttuale) {
  // 1. Assegna la carta alla squadra
  await supabase.from('allenatori_carte').update({ squadra }).eq('nome', nomeAllenatore);
  // 2. Scala 5M dal bilancio (costo carta)
  const nuovoBilancio = parseFloat((bilancioAttuale - 5).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  // 3. Movimento
  await supabase.from('movimenti').insert({
    squadra, descrizione: `Scelta carta allenatore: ${nomeAllenatore}`,
    uscita: 5, data: new Date().toISOString().slice(0, 10),
  });
  return nuovoBilancio;
}

// Calcola FPF (netto speso semestre corrente) per tutte le squadre in un colpo solo
export async function getFpfTutteSquadre() {
  const sem = getSemestreCorrente();
  const inizio = sem.inizioStr;
  const fine   = sem.fineStr;

  const { data: movs } = await supabase.from('movimenti')
    .select('squadra, descrizione, entrata, uscita, data')
    .gte('data', inizio)
    .lte('data', fine);

  if (!movs) return {};
  const map = {};
  for (const m of movs) {
    if (isFPFEscluso(m.descrizione)) continue;
    if (!map[m.squadra]) map[m.squadra] = 0;
    if (m.uscita)  map[m.squadra] += Number(m.uscita);
    if (m.entrata) map[m.squadra] -= Number(m.entrata);
  }
  for (const k of Object.keys(map)) map[k] = parseFloat(map[k].toFixed(2));
  return map;
}

// Salary cap allenatore: aggiunge 5M fissi al SC se la squadra ha una carta allenatore
export async function getSCAllenatore(squadra) {
  const { data } = await supabase.from('allenatori_carte')
    .select('stipendio_sc').eq('squadra', squadra).limit(1);
  return Number(data?.[0]?.stipendio_sc || 0);
}

// ─── INVESTIMENTI (art. 10) ───────────────────────────────────────────────────

export async function getInvestimenti(squadra, stagione = '2025-26') {
  const { data, error } = await supabase.from('investimenti')
    .select('*').eq('squadra', squadra).eq('stagione', stagione)
    .order('data_acquisto', { ascending: false });
  if (error) return [];
  return data;
}

export async function insertInvestimento(inv) {
  const { data, error } = await supabase.from('investimenti').insert(inv).select().single();
  if (error) throw error;
  return data;
}

export async function updateInvestimento(id, fields) {
  const { error } = await supabase.from('investimenti').update(fields).eq('id', id);
  if (error) throw error;
}

export async function deleteInvestimento(id) {
  const { error } = await supabase.from('investimenti').delete().eq('id', id);
  if (error) throw error;
}

// Acquista un investimento: scala il costo dal bilancio, inserisce movimento e record
export async function acquistaInvestimento({ squadra, nome, categoria, costo, stagione = '2025-26', dati = {}, note = '' }) {
  const oggi = new Date().toISOString().slice(0, 10);
  // Scala bilancio
  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  const nuovoBilancio = parseFloat(((sq?.bilancio || 0) - costo).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  // Movimento
  await supabase.from('movimenti').insert({
    squadra, descrizione: `Investimento: ${nome}`,
    uscita: costo, data: oggi,
  });
  // Record investimento
  const inv = await insertInvestimento({ squadra, nome, categoria, costo, stagione, dati, note, data_acquisto: oggi });
  return { inv, nuovoBilancio };
}

// Registra un guadagno da investimento attivo
export async function registraGuadagnoInvestimento(id, importo, squadra) {
  const oggi = new Date().toISOString().slice(0, 10);
  // Aggiorna valore accumulato nell'investimento
  const { data: inv } = await supabase.from('investimenti').select('valore_accumulato').eq('id', id).single();
  const nuovoValore = parseFloat(((inv?.valore_accumulato || 0) + importo).toFixed(2));
  await supabase.from('investimenti').update({ valore_accumulato: nuovoValore }).eq('id', id);
  // Aggiorna bilancio squadra
  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  const nuovoBilancio = parseFloat(((sq?.bilancio || 0) + importo).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  // Movimento
  await supabase.from('movimenti').insert({
    squadra, descrizione: `Guadagno investimento`,
    entrata: importo, data: oggi,
  });
  return nuovoBilancio;
}

// ─── SPONSOR ─────────────────────────────────────────────────────────────────

export async function getSponsor(squadra, stagione = '2025-26') {
  const { data, error } = await supabase.from('sponsor')
    .select('*').eq('squadra', squadra).eq('stagione', stagione);
  if (error) return [];
  return data;
}

export async function insertSponsor(s) {
  const { data, error } = await supabase.from('sponsor').insert(s).select().single();
  if (error) throw error;
  return data;
}

export async function updateSponsor(id, fields) {
  const { error } = await supabase.from('sponsor').update(fields).eq('id', id);
  if (error) throw error;
}

// ─── PENALITÀ (art. 11) ───────────────────────────────────────────────────────

export async function getPenalita(squadra, stagione) {
  const q = supabase.from('penalita').select('*').order('data_multa', { ascending: false });
  if (squadra) q.eq('squadra', squadra);
  if (stagione) q.eq('stagione', stagione);
  const { data, error } = await q;
  if (error) return [];
  return data;
}

export async function insertPenalita(p) {
  const { data, error } = await supabase.from('penalita').insert(p).select().single();
  if (error) throw error;
  return data;
}

export async function updatePenalita(id, fields) {
  const { error } = await supabase.from('penalita').update(fields).eq('id', id);
  if (error) throw error;
}

export async function deletePenalita(id) {
  const { error } = await supabase.from('penalita').delete().eq('id', id);
  if (error) throw error;
}

// Applica multa: scala M dal bilancio e registra movimento
export async function applicaMulta(squadra, importoMln, motivo, penaId) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  const nuovoBilancio = parseFloat(((sq?.bilancio || 0) - importoMln).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  await supabase.from('movimenti').insert({ squadra, descrizione: `Multa: ${motivo}`, uscita: importoMln, data: oggi });
  await supabase.from('penalita').update({ applicata: true }).eq('id', penaId);
  return nuovoBilancio;
}

// Conta recidive di un tipo per una squadra
export async function countRecidive(squadra, codiceTipo, stagione = '2025-26') {
  const { count } = await supabase.from('penalita')
    .select('id', { count: 'exact', head: true })
    .eq('squadra', squadra).eq('codice_tipo', codiceTipo).eq('stagione', stagione);
  return count || 0;
}

// ─── PREMI (art. 12) ─────────────────────────────────────────────────────────

export async function getPremi(stagione) {
  const q = supabase.from('premi').select('*').order('posizione', { ascending: true });
  if (stagione) q.eq('stagione', stagione);
  const { data, error } = await q;
  if (error) return [];
  return data;
}

export async function insertPremio(p) {
  const { data, error } = await supabase.from('premi').insert(p).select().single();
  if (error) throw error;
  return data;
}

export async function applicaPremio(squadra, importoMln, tipo, premioId) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  const nuovoBilancio = parseFloat(((sq?.bilancio || 0) + importoMln).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  await supabase.from('movimenti').insert({ squadra, descrizione: `Premio ${tipo}`, entrata: importoMln, data: oggi });
  await supabase.from('premi').update({ applicato: true }).eq('id', premioId);
  return nuovoBilancio;
}

// Calcola premio 19a giornata (art. 12.1)
// primoPoints = punti del primo in classifica
// mieiPoints  = punti della squadra
export function calcolaPremio19a(primoPoints, mieiPoints) {
  const distanza = primoPoints - mieiPoints;
  return parseFloat((3 + distanza * 1).toFixed(2));
}

// Calcola premi finali (art. 12.2) — inverso: 8° riceve di più
// art. 12.2 — premi finali aggiornati
const PREMI_FINALI = { 1: 20, 2: 25, 3: 30, 4: 35, 5: 40, 6: 45, 7: 50, 8: 55 };
export function calcolaPremiFinali(posizione) {
  return PREMI_FINALI[posizione] || 0;
}

// Premi coppa (art. 12.3)
const PREMI_COPPA = { 1: 5, 2: 3, 3: 1, 4: 1 };
export function calcolaPremiCoppa(posizione) {
  return PREMI_COPPA[posizione] || 0;
}

// ─── QUOTE (art. 1) ───────────────────────────────────────────────────────────

export const IMPORTO_QUOTA_EURO = 30;
export const IMPORTO_ISCRIZIONE_CAMPIONATO_MLN = 30;
export const MAX_EURO_EXTRA_BIENNIO = 10;
export const CAMBIO_EURO_MLN = 2.5;

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDateLocal(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function stagioneStartYear(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return (m > 6 || (m === 6 && d >= 1)) ? y : y - 1;
}
export function getStagioneQuota(date = new Date()) {
  const start = stagioneStartYear(date);
  return `${start}-${String(start + 1).slice(2)}`;
}
export function getBiennioQuota(date = new Date()) {
  const start = stagioneStartYear(date);
  const bStart = start % 2 === 1 ? start : start - 1;
  return `${bStart}-${String(bStart + 2).slice(2)}`;
}
export function getDeadlineExtraBudget(date = new Date()) {
  const start = stagioneStartYear(date);
  return new Date(start, 7, 14, 23, 59, 59, 999); // 14/08 23:59:59
}
export function isFinestraExtraBudget(date = new Date()) {
  const start = stagioneStartYear(date);
  const apertura = new Date(start, 5, 1, 0, 0, 0, 0); // 01/06
  return date >= apertura && date <= getDeadlineExtraBudget(date);
}
export function getScadenzaQuotaEuro(date = new Date()) {
  const start = stagioneStartYear(date);
  return new Date(start, 7, 31, 23, 59, 59, 999); // 31/08 23:59:59
}
export function getScadenzaIscrizioneCampionato(date = new Date()) {
  const start = stagioneStartYear(date);
  return new Date(start, 6, 31, 23, 59, 0, 0); // 31/07 23:59
}

async function safeUpdateSquadraQuote(squadra, fullFields, fallbackFields = {}) {
  const { error } = await supabase.from('squadre').update(fullFields).eq('name', squadra);
  if (!error) return;
  const msg = (error.message || '').toLowerCase();
  const schemaError = msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find');
  if (!schemaError || !Object.keys(fallbackFields).length) throw error;
  const retry = await supabase.from('squadre').update(fallbackFields).eq('name', squadra);
  if (retry.error) throw retry.error;
}

// Applica la quota iscrizione campionato (30M) — art. 1.3
// È stagionale: se esistono le colonne nuove usa iscrizione_stagione_pagata, altrimenti fallback su iscrizione_pagata.
export async function applicaIscrizioneCampionato(squadra, opts = {}) {
  const now = opts.data ? new Date(opts.data) : new Date();
  const stagione = opts.stagione || getStagioneQuota(now);
  const scadenza = getScadenzaIscrizioneCampionato(now);
  if (!opts.force && now < scadenza) {
    throw new Error(`L'iscrizione campionato si applica automaticamente dal 31/07 alle 23:59 (${stagione}).`);
  }

  const oggi = isoDateLocal(now);
  const { data: sq, error } = await supabase
    .from('squadre')
    .select('*')
    .eq('name', squadra)
    .single();
  if (error || !sq) throw error || new Error('Squadra non trovata');

  const giaPagata = sq.iscrizione_stagione_pagata === stagione || (!sq.iscrizione_stagione_pagata && sq.iscrizione_pagata === true);
  if (giaPagata) return { skip: true, stagione };

  const nuovoBilancio = parseFloat((Number(sq.bilancio || 0) - IMPORTO_ISCRIZIONE_CAMPIONATO_MLN).toFixed(2));
  await safeUpdateSquadraQuote(
    squadra,
    {
      bilancio: nuovoBilancio,
      iscrizione_pagata: true,
      iscrizione_stagione_pagata: stagione,
      iscrizione_pagata_il: oggi,
      updated_at: new Date().toISOString(),
    },
    { bilancio: nuovoBilancio, iscrizione_pagata: true }
  );

  await supabase.from('movimenti').insert({
    squadra,
    descrizione: `Iscrizione campionato ${stagione} (automatica 31/07)` ,
    uscita: IMPORTO_ISCRIZIONE_CAMPIONATO_MLN,
    data: oggi,
  });
  return { ok: true, nuovoBilancio, stagione };
}

// Investi euro extra budget (art. 1.2) — 1€ = 2,5M, entro il 14/08 23:59
export async function investiEuroExtra(squadra, euroAggiuntivi, opts = {}) {
  const now = opts.data ? new Date(opts.data) : new Date();
  if (!opts.force && !isFinestraExtraBudget(now)) {
    throw new Error('La decisione sugli € extra può essere effettuata solo dal 01/06 al 14/08 alle 23:59.');
  }

  const stagione = opts.stagione || getStagioneQuota(now);
  const biennio = opts.biennio || getBiennioQuota(now);
  const euro = Number(euroAggiuntivi);
  if (!Number.isFinite(euro) || euro <= 0 || euro > MAX_EURO_EXTRA_BIENNIO) throw new Error('Importo non valido (1-10€)');

  const { data: sq, error } = await supabase
    .from('squadre')
    .select('*')
    .eq('name', squadra)
    .single();
  if (error || !sq) throw error || new Error('Squadra non trovata');

  // Se il DB è ancora al biennio vecchio, il conteggio biennale riparte da 0.
  const euroBiennioAttuale = sq.biennio && sq.biennio !== biennio ? 0 : Number(sq.euro_biennio || 0);
  const euroStagioneAttuale = sq.extra_stagione && sq.extra_stagione !== stagione ? 0 : Number(sq.euro_investiti || 0);
  const maxDisponibili = Math.max(0, MAX_EURO_EXTRA_BIENNIO - euroBiennioAttuale);
  if (euro > maxDisponibili) throw new Error(`Puoi investire al massimo ${maxDisponibili}€ nel biennio ${biennio}`);

  const mlnGuadagnati = parseFloat((euro * CAMBIO_EURO_MLN).toFixed(2));
  const oggi = isoDateLocal(now);

  await safeUpdateSquadraQuote(
    squadra,
    {
      bilancio: parseFloat((Number(sq.bilancio || 0) + mlnGuadagnati).toFixed(2)),
      euro_investiti: euroStagioneAttuale + euro,
      euro_biennio: euroBiennioAttuale + euro,
      mln_extra: Number(sq.mln_extra || 0) + mlnGuadagnati,
      biennio,
      extra_stagione: stagione,
      extra_investito_il: oggi,
      updated_at: new Date().toISOString(),
    },
    {
      bilancio: parseFloat((Number(sq.bilancio || 0) + mlnGuadagnati).toFixed(2)),
      euro_investiti: euroStagioneAttuale + euro,
      euro_biennio: euroBiennioAttuale + euro,
      mln_extra: Number(sq.mln_extra || 0) + mlnGuadagnati,
      biennio,
    }
  );

  await supabase.from('movimenti').insert({
    squadra,
    descrizione: `Investimento extra budget ${stagione}: ${euro}€ → +${mlnGuadagnati}M`,
    entrata: mlnGuadagnati,
    data: oggi,
  });
  return mlnGuadagnati;
}

// Ritira budget extra: resta disponibile perché già presente nel sito, ma non è nella sezione quota 1.1-1.3.
export async function ritiraBudgetExtra(squadra) {
  const { data: sq } = await supabase.from('squadre').select('bilancio, mln_extra, euro_investiti').eq('name', squadra).single();
  if (!sq || !sq.mln_extra || sq.mln_extra <= 0) throw new Error('Nessun budget extra da ritirare');

  const costoRitiro = parseFloat((sq.mln_extra * 2).toFixed(2));
  if (sq.bilancio < costoRitiro) throw new Error(`Bilancio insufficiente: servono ${costoRitiro}M per ritirare ${sq.mln_extra}M`);

  const oggi = isoDateLocal(new Date());
  const nuovoBilancio = parseFloat((sq.bilancio - costoRitiro + sq.mln_extra).toFixed(2));

  await supabase.from('squadre').update({ bilancio: nuovoBilancio, mln_extra: 0 }).eq('name', squadra);
  await supabase.from('movimenti').insert([
    { squadra, descrizione: `Ritiro budget extra (rimborso ${sq.mln_extra}M)`, entrata: sq.mln_extra, data: oggi },
    { squadra, descrizione: `Costo ritiro budget extra (2× = ${costoRitiro}M)`, uscita: costoRitiro, data: oggi },
  ]);
  return { nuovoBilancio, costoRitiro, rimborso: sq.mln_extra };
}

// Reset biennio (ogni 2 anni). Viene anche applicato automaticamente da sincronizzaQuoteStagione.
export async function resetBiennio(squadra, nuovoBiennio = getBiennioQuota(new Date())) {
  await safeUpdateSquadraQuote(
    squadra,
    { euro_biennio: 0, euro_investiti: 0, mln_extra: 0, biennio: nuovoBiennio, extra_stagione: getStagioneQuota(new Date()), updated_at: new Date().toISOString() },
    { euro_biennio: 0, euro_investiti: 0, mln_extra: 0, biennio: nuovoBiennio }
  );
}

// Segna quota 30€ pagata al tesoriere (art. 1.1)
export async function segnaQuotaPagata(squadra, opts = {}) {
  const now = opts.data ? new Date(opts.data) : new Date();
  const stagione = opts.stagione || getStagioneQuota(now);
  const tesoriere = opts.tesoriere || opts.tesoriereLega || null;
  await safeUpdateSquadraQuote(
    squadra,
    {
      quota_pagata: true,
      quota_stagione_pagata: stagione,
      quota_pagata_il: isoDateLocal(now),
      quota_importo_euro: IMPORTO_QUOTA_EURO,
      quota_tesoriere: tesoriere,
      updated_at: new Date().toISOString(),
    },
    { quota_pagata: true }
  );
}

// Allinea campi stagionali/biennali quando cambia stagione o biennio.
// - Se inizia una nuova stagione, resetta i flag stagionali quota/iscrizione.
// - Se inizia un nuovo biennio, resetta euro_biennio.
export async function sincronizzaQuoteStagione(opts = {}) {
  const now = opts.data ? new Date(opts.data) : new Date();
  const stagione = opts.stagione || getStagioneQuota(now);
  const biennio = opts.biennio || getBiennioQuota(now);
  const { data: squadre, error } = await supabase
    .from('squadre')
    .select('*');
  if (error || !squadre) return [];

  const results = [];
  for (const sq of squadre) {
    const patch = {};
    const fallback = {};
    if (sq.quota_stagione_pagata && sq.quota_stagione_pagata !== stagione) {
      patch.quota_pagata = false;
      patch.quota_stagione_pagata = null;
      patch.quota_pagata_il = null;
      patch.quota_importo_euro = null;
      patch.quota_tesoriere = null;
      fallback.quota_pagata = false;
    }
    if (sq.iscrizione_stagione_pagata && sq.iscrizione_stagione_pagata !== stagione) {
      patch.iscrizione_pagata = false;
      patch.iscrizione_stagione_pagata = null;
      patch.iscrizione_pagata_il = null;
      fallback.iscrizione_pagata = false;
    }
    if (sq.extra_stagione && sq.extra_stagione !== stagione) {
      patch.euro_investiti = 0;
      patch.extra_stagione = stagione;
      fallback.euro_investiti = 0;
    }
    if (!sq.biennio || sq.biennio !== biennio) {
      patch.biennio = biennio;
      patch.euro_biennio = 0;
      fallback.biennio = biennio;
      fallback.euro_biennio = 0;
    }
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      await safeUpdateSquadraQuote(sq.name, patch, fallback);
      results.push({ squadra: sq.name, ok: true, patch });
    }
  }
  return results;
}

// Auto-applica iscrizione 30M a TUTTE le squadre dal 31/07 alle 23:59
export async function applicaIscrizioneATutti(opts = {}) {
  const now = opts.data ? new Date(opts.data) : new Date();
  const stagione = opts.stagione || getStagioneQuota(now);
  if (!opts.force && now < getScadenzaIscrizioneCampionato(now)) {
    throw new Error(`L'iscrizione campionato ${stagione} si applica automaticamente dal 31/07 alle 23:59.`);
  }
  await sincronizzaQuoteStagione({ data: now, stagione, biennio: opts.biennio });
  const { data: squadre } = await supabase.from('squadre').select('name');
  if (!squadre) return [];
  const results = [];
  for (const sq of squadre) {
    const r = await applicaIscrizioneCampionato(sq.name, { data: now, stagione, force: true });
    results.push({ squadra: sq.name, ...r });
  }
  return results;
}

export async function applicaQuoteAutomatiche(opts = {}) {
  const now = opts.data ? new Date(opts.data) : new Date();
  const results = { sync: [], iscrizioni: [], errori: [] };
  try { results.sync = await sincronizzaQuoteStagione({ data: now }); }
  catch(e) { results.errori.push(e.message); }
  if (now >= getScadenzaIscrizioneCampionato(now)) {
    try { results.iscrizioni = await applicaIscrizioneATutti({ data: now, force: true }); }
    catch(e) { results.errori.push(e.message); }
  }
  return results;
}


// ─── ADMIN CONTROL ROOM ───────────────────────────────────────────────────────

// Restituisce tutti gli investimenti "Ristrutturazione Stadio" attivi per la stagione
export async function getStadioInvestimenti(stagione = '2026-27') {
  const { data } = await supabase.from('investimenti')
    .select('*').eq('nome', 'Ristrutturazione Stadio').eq('stagione', stagione);
  return data || [];
}

// Aggiunge o rimuove il potenziamento stadio per un team (admin override, senza costo)
export async function setStadioUpgrade(squadra, attivo, stagione = '2026-27') {
  if (attivo) {
    const { error } = await supabase.from('investimenti').insert({
      squadra, nome: 'Ristrutturazione Stadio', categoria: 'grande',
      costo: 0, stagione,
      data_acquisto: new Date().toISOString().slice(0, 10),
      dati: { admin_override: true },
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('investimenti').delete()
      .eq('squadra', squadra).eq('nome', 'Ristrutturazione Stadio').eq('stagione', stagione);
    if (error) throw error;
  }
}

// Applica le entrate stadio a TUTTE le squadre (trigger manuale admin)
export async function applicaEntrateStadioTutte(stagione = '2026-27') {
  const oggi = new Date().toISOString().slice(0, 10);
  const meseISO = new Date().toISOString().slice(0, 7);
  const stadioDesc = `Entrate stadio ${meseISO}`;

  const { data: squadre } = await supabase.from('squadre').select('name, bilancio');
  if (!squadre?.length) return [];

  const { data: invAll } = await supabase.from('investimenti')
    .select('squadra').eq('nome', 'Ristrutturazione Stadio').eq('stagione', stagione);
  const potenziate = new Set((invAll || []).map(i => i.squadra));

  const results = [];
  for (const sq of squadre) {
    const { data: gia } = await supabase.from('movimenti').select('id')
      .eq('squadra', sq.name).eq('descrizione', stadioDesc).limit(1);
    if (gia?.length) { results.push({ squadra: sq.name, skip: true }); continue; }

    const entrata = potenziate.has(sq.name) ? 5.5 : 4;
    await supabase.from('movimenti').insert({ squadra: sq.name, descrizione: stadioDesc, entrata, data: oggi });
    await supabase.from('squadre').update({ bilancio: parseFloat((sq.bilancio + entrata).toFixed(2)) }).eq('name', sq.name);
    results.push({ squadra: sq.name, entrata, ok: true });
  }
  if (results.some(r => r.ok)) {
    await sendTelegramNotification('stadio_applicato', { mese: meseISO });
  }
  return results;
}

// Applica la tassa settimanale a TUTTE le squadre (trigger manuale admin)
export async function applicaTassaATutti() {
  const domenica = getDomenicaCorrente();
  const { week, year } = getWeekNumber(new Date());
  const settimanaLabel = `${week}/${year}`;
  const { data: squadre } = await supabase.from('squadre').select('name, bilancio');
  if (!squadre?.length) return [];
  const results = [];

  // Calcola inizio e fine settimana ISO per deduplicazione robusta
  const _lunediATT = new Date(domenica);
  const _dATT = _lunediATT.getDay();
  _lunediATT.setDate(_lunediATT.getDate() - (_dATT === 0 ? 6 : _dATT - 1));
  const _domATT = new Date(_lunediATT); _domATT.setDate(_lunediATT.getDate() + 6);
  const _lunediATTStr = _lunediATT.toISOString().slice(0, 10);
  const _domATTStr = _domATT.toISOString().slice(0, 10);

  for (const sq of squadre) {
    const { data: gia } = await supabase.from('tasse_settimanali').select('id')
      .eq('squadra', sq.name)
      .gte('data_controllo', _lunediATTStr)
      .lte('data_controllo', _domATTStr)
      .limit(1);
    if (gia?.length) { results.push({ squadra: sq.name, skip: true }); continue; }
    const r = await applicaTassaSettimana(sq.name, sq.bilancio, domenica, settimanaLabel);
    results.push({ squadra: sq.name, ...r });
  }
  if (results.some(r => r.ok)) {
    await sendTelegramNotification('tassa_applicata', { domenica });
  }
  return results;
}

// Annulla la tassa settimanale corrente per TUTTE le squadre.
// Rimborsa il bilancio, elimina i record in tasse_settimanali e cancella i movimenti collegati.
export async function annullaTassaATutti(dataRiferimento = null) {
  const dataRef = dataRiferimento || getDomenicaCorrente();
  const ref = new Date(dataRef);
  const { week, year } = getWeekNumber(ref);
  const settimanaLabel = `${week}/${year}`;

  const lunedi = new Date(ref);
  const d = lunedi.getDay();
  lunedi.setDate(lunedi.getDate() - (d === 0 ? 6 : d - 1));
  const domenica = new Date(lunedi);
  domenica.setDate(lunedi.getDate() + 6);
  const lunediStr = lunedi.toISOString().slice(0, 10);
  const domenicaStr = domenica.toISOString().slice(0, 10);

  const { data: tasse, error } = await supabase
    .from('tasse_settimanali')
    .select('id, squadra, importo_tassa, data_controllo')
    .gte('data_controllo', lunediStr)
    .lte('data_controllo', domenicaStr);
  if (error) throw error;
  if (!tasse?.length) return [];

  const bySquadra = new Map();
  for (const t of tasse) {
    bySquadra.set(t.squadra, parseFloat(((bySquadra.get(t.squadra) || 0) + Number(t.importo_tassa || 0)).toFixed(2)));
  }

  const results = [];
  for (const [squadra, rimborso] of bySquadra.entries()) {
    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
    const nuovoBilancio = parseFloat((Number(sq?.bilancio || 0) + rimborso).toFixed(2));
    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
    results.push({ squadra, rimborso, ok: true });
  }

  await supabase
    .from('tasse_settimanali')
    .delete()
    .gte('data_controllo', lunediStr)
    .lte('data_controllo', domenicaStr);

  await supabase
    .from('movimenti')
    .delete()
    .ilike('descrizione', 'Tassa settimanale%')
    .ilike('descrizione', `%settimana ${settimanaLabel}%`);

  return results;
}


// Ripulisce le anomalie della tassa settimanale: conserva una sola tassa per ogni squadra attiva
// nella data corretta (default: domenica corrente) e rimuove duplicati, date sbagliate e squadre non attive.
// Per ogni record rimosso rimborsa il bilancio della squadra attiva e cancella il movimento collegato.
export async function ripulisciAnomalieTasse(dataCorretta = null) {
  const keepDate = dataCorretta || getDomenicaCorrente();
  const ref = new Date(keepDate);

  const lunedi = new Date(ref);
  const d = lunedi.getDay();
  lunedi.setDate(lunedi.getDate() - (d === 0 ? 6 : d - 1));
  const domenica = new Date(lunedi);
  domenica.setDate(lunedi.getDate() + 6);
  const lunediStr = lunedi.toISOString().slice(0, 10);
  const domenicaStr = domenica.toISOString().slice(0, 10);

  const [{ data: squadre }, { data: tasse, error }] = await Promise.all([
    supabase.from('squadre').select('name, bilancio'),
    supabase.from('tasse_settimanali')
      .select('id, squadra, importo_tassa, data_controllo')
      .gte('data_controllo', lunediStr)
      .lte('data_controllo', domenicaStr)
      .order('data_controllo', { ascending: false })
      .order('id', { ascending: true }),
  ]);
  if (error) throw error;

  const squadreList = squadre || [];
  const squadreAttive = new Set(squadreList.map(s => s.name));
  const bilanci = new Map(squadreList.map(s => [s.name, Number(s.bilancio || 0)]));
  const records = tasse || [];

  const bySquadra = new Map();
  for (const t of records) {
    if (!bySquadra.has(t.squadra)) bySquadra.set(t.squadra, []);
    bySquadra.get(t.squadra).push(t);
  }

  const idsDaTenere = new Set();
  const rimossi = [];

  for (const [squadra, list] of bySquadra.entries()) {
    if (!squadreAttive.has(squadra)) {
      rimossi.push(...list.map(t => ({ ...t, motivo: 'squadra_non_attiva' })));
      continue;
    }

    // Preferisce un record esattamente nella domenica corretta; se ce ne sono più di uno,
    // ne tiene uno solo. Se non esiste un record nella data corretta, non inventa nulla:
    // tiene il più recente per non cancellare tutto accidentalmente.
    const corretti = list.filter(t => t.data_controllo === keepDate);
    const keep = corretti[0] || list[0];
    idsDaTenere.add(keep.id);

    for (const t of list) {
      if (t.id !== keep.id) {
        rimossi.push({ ...t, motivo: t.data_controllo === keepDate ? 'duplicato_stessa_data' : 'data_sbagliata' });
      }
    }
  }

  if (!rimossi.length) return { ok: true, rimossi: [], tenuti: idsDaTenere.size };

  const rimborsoBySquadra = new Map();
  for (const t of rimossi) {
    if (squadreAttive.has(t.squadra)) {
      rimborsoBySquadra.set(t.squadra, parseFloat(((rimborsoBySquadra.get(t.squadra) || 0) + Number(t.importo_tassa || 0)).toFixed(2)));
    }
  }

  for (const [squadra, rimborso] of rimborsoBySquadra.entries()) {
    const nuovoBilancio = parseFloat((Number(bilanci.get(squadra) || 0) + rimborso).toFixed(2));
    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  }

  const idsDaRimuovere = rimossi.map(t => t.id);
  await supabase.from('tasse_settimanali').delete().in('id', idsDaRimuovere);

  // Cancella esclusivamente il movimento collegato a ciascun record rimosso.
  // La settimana viene calcolata dalla data del singolo record, non dalla data da conservare:
  // in questo modo vengono rimossi correttamente anche record anomali appartenenti a settimane diverse.
  for (const t of rimossi) {
    const dataMovimento = new Date(t.data_controllo);
    const { week: recordWeek, year: recordYear } = getWeekNumber(dataMovimento);
    const recordSettimanaLabel = `${recordWeek}/${recordYear}`;

    await supabase.from('movimenti')
      .delete()
      .eq('squadra', t.squadra)
      .eq('data', t.data_controllo)
      .ilike('descrizione', `Tassa settimanale%settimana ${recordSettimanaLabel}%`);
  }

  return {
    ok: true,
    tenuti: idsDaTenere.size,
    rimossi: rimossi.map(t => ({ squadra: t.squadra, data: t.data_controllo, importo: Number(t.importo_tassa || 0), motivo: t.motivo })),
    rimborsi: Array.from(rimborsoBySquadra.entries()).map(([squadra, importo]) => ({ squadra, importo })),
    dataCorretta: keepDate,
  };
}


// Pulizia straordinaria: rimuove tutte le tasse precedenti alla data indicata.
// Serve per ripulire vecchi record storici errati (es. 06/06, 07/06) e lasciare visibili
// solo le tasse confermate correttamente dalla Control Room dalla data indicata in poi.
// ATTENZIONE: rimborsa ai bilanci delle squadre attive gli importi rimossi.
export async function ripulisciStoricoTassePrimaDi(dataLimite = null) {
  const keepFrom = dataLimite || getDomenicaCorrente();

  const [{ data: squadre }, { data: tasse, error }] = await Promise.all([
    supabase.from('squadre').select('name, bilancio'),
    supabase.from('tasse_settimanali')
      .select('id, squadra, importo_tassa, data_controllo')
      .lt('data_controllo', keepFrom)
      .order('data_controllo', { ascending: false }),
  ]);
  if (error) throw error;
  if (!tasse?.length) return { ok: true, rimossi: [], rimborsi: [], dataLimite: keepFrom };

  const squadreList = squadre || [];
  const squadreAttive = new Set(squadreList.map(s => s.name));
  const bilanci = new Map(squadreList.map(s => [s.name, Number(s.bilancio || 0)]));

  const rimborsoBySquadra = new Map();
  for (const t of tasse) {
    if (squadreAttive.has(t.squadra)) {
      rimborsoBySquadra.set(
        t.squadra,
        parseFloat(((rimborsoBySquadra.get(t.squadra) || 0) + Number(t.importo_tassa || 0)).toFixed(2))
      );
    }
  }

  for (const [squadra, rimborso] of rimborsoBySquadra.entries()) {
    const nuovoBilancio = parseFloat((Number(bilanci.get(squadra) || 0) + rimborso).toFixed(2));
    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  }

  const idsDaRimuovere = tasse.map(t => t.id);
  await supabase.from('tasse_settimanali').delete().in('id', idsDaRimuovere);

  // Cancella i movimenti tassa precedenti alla data tenuta. Usiamo data < keepFrom perché
  // i vecchi movimenti errati sono stati creati nei giorni errati; i movimenti della tassa
  // corretta del keepFrom e dei pagamenti futuri restano intatti.
  await supabase
    .from('movimenti')
    .delete()
    .lt('data', keepFrom)
    .ilike('descrizione', 'Tassa settimanale%');

  return {
    ok: true,
    dataLimite: keepFrom,
    rimossi: tasse.map(t => ({ squadra: t.squadra, data: t.data_controllo, importo: Number(t.importo_tassa || 0) })),
    rimborsi: Array.from(rimborsoBySquadra.entries()).map(([squadra, importo]) => ({ squadra, importo })),
  };
}

// Applica stipendi mensili a TUTTE le squadre (trigger manuale admin)
export async function applicaStipendioATutti() {
  const oggi = new Date().toISOString().slice(0, 10);
  const meseISO = new Date().toISOString().slice(0, 7);
  const stipDesc = `Pagamento stipendi ${meseISO}`;
  const { data: squadre } = await supabase.from('squadre').select('name, bilancio');
  if (!squadre?.length) return [];
  const results = [];
  for (const sq of squadre) {
    const { data: gia } = await supabase.from('movimenti').select('id')
      .eq('squadra', sq.name).eq('descrizione', stipDesc).limit(1);
    if (gia?.length) { results.push({ squadra: sq.name, skip: true }); continue; }
    const { data: rosa } = await supabase.from('rosa').select('quot, anni_contratto, anni')
      .eq('squadra', sq.name).eq('in_vivaio', false);
    const stipRosa = (rosa || []).reduce((s, p) => s + _calcolaStipCorretto(p.quot, p.anni_contratto, p.anni), 0);
    const { data: all } = await supabase.from('allenatori_carte').select('stipendio_sc')
      .eq('squadra', sq.name).single().catch(() => ({ data: null }));
    const totalStip = parseFloat((stipRosa + Number(all?.stipendio_sc || 0)).toFixed(2));
    const rata = parseFloat((totalStip / 12).toFixed(2));
    await supabase.from('movimenti').insert({ squadra: sq.name, descrizione: stipDesc, uscita: rata, data: oggi });
    await supabase.from('squadre').update({ bilancio: parseFloat((sq.bilancio - rata).toFixed(2)), salary_used: totalStip }).eq('name', sq.name);
    results.push({ squadra: sq.name, rata, ok: true });
  }
  if (results.some(r => r.ok)) {
    await sendTelegramNotification('stipendi_applicati', { mese: meseISO });
  }
  return results;
}

// Stato finanziario riepilogativo per il Control Room
export async function getControlRoomStatus() {
  const oggi = new Date().toISOString().slice(0, 10);
  const meseISO = new Date().toISOString().slice(0, 7);
  const domenica = getDomenicaCorrente();
  const stipDesc = `Pagamento stipendi ${meseISO}`;
  const stadioDesc = `Entrate stadio ${meseISO}`;

  const ref = new Date(domenica);
  const lunedi = new Date(ref);
  const d = lunedi.getDay();
  lunedi.setDate(lunedi.getDate() - (d === 0 ? 6 : d - 1));
  const fineDomenica = new Date(lunedi);
  fineDomenica.setDate(lunedi.getDate() + 6);
  const lunediStr = lunedi.toISOString().slice(0, 10);
  const domenicaStr = fineDomenica.toISOString().slice(0, 10);

  const [{ data: squadre }, { data: tasse }, { data: movMese }] = await Promise.all([
    supabase.from('squadre').select('*'),
    supabase.from('tasse_settimanali').select('squadra, data_controllo').gte('data_controllo', lunediStr).lte('data_controllo', domenicaStr),
    supabase.from('movimenti').select('squadra, descrizione').gte('data', `${meseISO}-01`),
  ]);

  const squadreList = squadre || [];
  const squadreAttive = new Set(squadreList.map(s => s.name));

  // Dettaglio tasse della settimana corrente: serve a vedere subito duplicati,
  // squadre mancanti e record rimasti da squadre non più presenti.
  const tasseCountBySquadra = {};
  const tasseDateBySquadra = {};
  for (const t of (tasse || [])) {
    tasseCountBySquadra[t.squadra] = (tasseCountBySquadra[t.squadra] || 0) + 1;
    if (!tasseDateBySquadra[t.squadra]) tasseDateBySquadra[t.squadra] = [];
    tasseDateBySquadra[t.squadra].push(t.data_controllo);
  }

  const tassePagate = new Set(Object.keys(tasseCountBySquadra).filter(squadra => squadreAttive.has(squadra) && tasseCountBySquadra[squadra] >= 1));
  const tasseDuplicate = Object.entries(tasseCountBySquadra)
    .filter(([squadra, count]) => squadreAttive.has(squadra) && count > 1)
    .map(([squadra, count]) => ({ squadra, count, date: tasseDateBySquadra[squadra] || [] }));
  const tasseMancanti = squadreList
    .filter(sq => !tasseCountBySquadra[sq.name])
    .map(sq => sq.name);
  const tasseExtra = Object.entries(tasseCountBySquadra)
    .filter(([squadra]) => !squadreAttive.has(squadra))
    .map(([squadra, count]) => ({ squadra, count, date: tasseDateBySquadra[squadra] || [] }));
  const tasseTotRecord = (tasse || []).length;
  const tasseDettagli = { countBySquadra: tasseCountBySquadra, dateBySquadra: tasseDateBySquadra, duplicate: tasseDuplicate, mancanti: tasseMancanti, extra: tasseExtra, totaleRecord: tasseTotRecord };
  const canApplicareTassa = tasseMancanti.length > 0;

  const stipendiPagati = new Set((movMese || []).filter(m => m.descrizione === stipDesc).map(m => m.squadra));
  const stadioPagato = new Set((movMese || []).filter(m => m.descrizione === stadioDesc).map(m => m.squadra));

  return { squadre: squadreList, tassePagate, tasseDettagli, canApplicareTassa, stipendiPagati, stadioPagato, domenica, meseISO };
}

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

export async function logAzione({ utente, squadraUtente = null, azione, entita, entitaId = null, squadra = null, descrizione, dataPrima = null, dataDopo = null, rollbackPossibile = false }) {
  try {
    await supabase.from('audit_log').insert({
      utente, squadra_utente: squadraUtente, azione, entita,
      entita_id: entitaId ? String(entitaId) : null,
      squadra, descrizione,
      dati_prima: dataPrima, dati_dopo: dataDopo,
      rollback_possibile: rollbackPossibile,
    });
  } catch(e) {
    // Il log non deve mai bloccare l'operazione principale
    console.warn('audit_log error:', e.message);
  }
}

export async function getAuditLog({ limit = 100, squadra = null, azione = null } = {}) {
  let q = supabase.from('audit_log').select('*').order('timestamp', { ascending: false }).limit(limit);
  if (squadra) q = q.eq('squadra', squadra);
  if (azione)  q = q.eq('azione', azione);
  const { data, error } = await q;
  if (error) return [];
  return data;
}

export async function effettuaRollback(logId, utente) {
  const { data: entry, error } = await supabase.from('audit_log').select('*').eq('id', logId).single();
  if (error || !entry) throw new Error('Log non trovato');
  if (!entry.rollback_possibile) throw new Error('Rollback non disponibile per questa operazione');
  if (entry.rollback_effettuato) throw new Error('Rollback già effettuato');
  if (!entry.dati_prima) throw new Error('Nessun snapshot disponibile per il rollback');

  const dataPrima = entry.dati_prima;
  
  // Esegui il rollback in base al tipo di azione
  switch(entry.azione) {
    case 'bilancio_modifica':
    case 'tassa_settimanale':
    case 'stipendi_pagati':
    case 'multa_applicata':
    case 'premio_applicato':
    case 'iscrizione_campionato':
    case 'euro_extra_investiti':
    case 'svincolo':
    case 'investimento_acquisto': {
      // Ripristina il bilancio
      if (dataPrima.bilancio !== undefined && entry.squadra) {
        await supabase.from('squadre').update({ bilancio: dataPrima.bilancio }).eq('name', entry.squadra);
        // Cancella il movimento associato se presente
        if (dataPrima.movimento_id) {
          await supabase.from('movimenti').delete().eq('id', dataPrima.movimento_id);
        }
      }
      break;
    }
    case 'rosa_modifica': {
      // Ripristina dati giocatore
      if (dataPrima.giocatore && dataPrima.giocatore.id) {
        await supabase.from('rosa').update(dataPrima.giocatore).eq('id', dataPrima.giocatore.id);
      }
      break;
    }
    case 'rosa_aggiungi': {
      // Rimuovi il giocatore aggiunto
      if (dataPrima.giocatore_id) {
        await supabase.from('rosa').delete().eq('id', dataPrima.giocatore_id);
      }
      break;
    }
    case 'rosa_rimuovi': {
      // Reinserisci il giocatore rimosso
      if (dataPrima.giocatore) {
        const { id, ...rest } = dataPrima.giocatore;
        await supabase.from('rosa').insert({ id, ...rest });
      }
      break;
    }
    case 'classifica_modifica': {
      if (dataPrima.riga && dataPrima.riga.squadra) {
        await supabase.from('classifica').update(dataPrima.riga).eq('squadra', dataPrima.riga.squadra);
      }
      break;
    }
    case 'trasferimento': {
      // Rollback trasferimento: troppo complesso, richiede conferma manuale
      throw new Error('Il rollback di un trasferimento richiede intervento manuale degli admin. Contatta il team.');
    }
    default:
      throw new Error(`Rollback automatico non disponibile per azione: ${entry.azione}`);
  }

  // Segna il rollback come effettuato
  await supabase.from('audit_log').update({
    rollback_effettuato: true,
    rollback_at: new Date().toISOString(),
    rollback_da: utente,
  }).eq('id', logId);

  // Log del rollback stesso
  await logAzione({
    utente,
    azione: 'admin_generico',
    entita: 'audit_log',
    entitaId: logId,
    squadra: entry.squadra,
    descrizione: `🔄 Rollback di: "${entry.descrizione}"`,
    rollbackPossibile: false,
  });

  return true;
}


// ─── DECISIONE VIVAIO 3 GIORNI (art. 3.4.1) ─────────────────────────────────
const VIVAIO_DECISIONE_GIORNI = 3;

function getMotiviDecisioneVivaio(player = {}) {
  const motivi = [];
  const presenze = Number(player.vivaio_presenze ?? player.presenze_voto ?? player.partite ?? 0);
  const quot = Number(player.quot || 0);
  const quotIniziale = Number(player.quot_iniziale_vivaio ?? player.quot || 0);
  const aumento = quot - quotIniziale;
  if (presenze >= 2) motivi.push(`${presenze} presenze a voto`);
  if (quotIniziale > 0 && aumento >= 2) motivi.push(`quotazione +${parseFloat(aumento.toFixed(2))}`);
  return motivi;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function richiediDecisioneVivaio(player, now = new Date()) {
  const motivi = getMotiviDecisioneVivaio(player);
  if (!motivi.length) return { richiesta: false };

  const update = {
    vivaio_decisione_richiesta: true,
    vivaio_motivo_decisione: motivi.join(' e '),
  };
  if (!player.vivaio_decisione_da) update.vivaio_decisione_da = now.toISOString();
  if (!player.vivaio_decisione_scadenza) update.vivaio_decisione_scadenza = addDays(now, VIVAIO_DECISIONE_GIORNI).toISOString();

  const { error } = await supabase.from('rosa').update(update).eq('id', player.id);
  if (error) throw error;
  return { richiesta: true, motivi };
}

async function svincolaVivaioAutomatico(player, motivo = 'Scadenza scelta vivaio superata') {
  const squadra = player.squadra;
  await supabase.from('rosa').delete().eq('id', player.id);
  await logAuditVivaio(
    squadra,
    'rosa_rimuovi',
    `Vivaio: svincolato automaticamente ${player.nome} (costo 0) — ${motivo}`,
    { giocatore: player, automatico: true }
  );
}

export async function processaDecisioniVivaio(squadra = null) {
  let query = supabase.from('rosa').select('*').eq('in_vivaio', true);
  if (squadra) query = query.eq('squadra', squadra);
  const { data, error } = await query;
  if (error) throw error;

  const now = new Date();
  const results = { richieste: [], svincolati: [], errori: [] };

  for (const player of data || []) {
    try {
      const scadenza = player.vivaio_decisione_scadenza ? new Date(player.vivaio_decisione_scadenza) : null;

      if (player.vivaio_decisione_richiesta && scadenza && scadenza <= now) {
        await svincolaVivaioAutomatico(player, 'mancata decisione entro 3 giorni');
        results.svincolati.push(player.nome);
        continue;
      }

      const motivi = getMotiviDecisioneVivaio(player);
      if (motivi.length && !player.vivaio_decisione_richiesta) {
        await richiediDecisioneVivaio(player, now);
        results.richieste.push(player.nome);
      } else if (motivi.length && player.vivaio_decisione_richiesta) {
        // Aggiorna solo il motivo se nel frattempo si è aggiunta una seconda causa.
        const motivo = motivi.join(' e ');
        if (motivo !== player.vivaio_motivo_decisione) {
          await supabase.from('rosa').update({ vivaio_motivo_decisione: motivo }).eq('id', player.id);
        }
      }
    } catch (e) {
      results.errori.push(`${player?.nome || 'Giocatore'}: ${e.message}`);
    }
  }
  return results;
}

// ─── VIVAIO (art. 3.6) ────────────────────────────────────────────────────────

export async function getVivaio(squadra) {
  try { await processaDecisioniVivaio(squadra); } catch {}
  const { data, error } = await supabase.from('rosa')
    .select('*').eq('squadra', squadra).eq('in_vivaio', true).order('quot', { ascending: false });
  if (error) return [];
  return data;
}

// Acquista giocatore per il vivaio (da svincolati)
// Validazioni: under-23, quot <= 3, 0 presenze a voto
export async function acquistaVivaio({ squadra, giocatore, bilancioAttuale }) {
  // Validazioni regolamento
  if (giocatore.anni > 23) throw new Error(`${giocatore.nome} ha ${giocatore.anni} anni — il vivaio ammette giocatori fino a 23 anni compresi`);
  if (giocatore.quot > 3) throw new Error(`${giocatore.nome} ha quotazione ${giocatore.quot} — il vivaio ammette solo Q ≤ 3`);
  const presenze = Number(giocatore.presenze_voto ?? giocatore.partite ?? giocatore.vivaio_presenze ?? 0);
  if (presenze > 0) throw new Error(`${giocatore.nome} ha già ${presenze} presenze a voto — per entrare nel vivaio deve averne 0`);

  const now = new Date();
  if (!isVivaioAcquistiAperti(now)) throw new Error('Gli acquisti per il vivaio sono consentiti solo dal 01/09 al 31/05.');
  const oggi = now.toISOString().slice(0, 10);

  // Conta vivaio attuale: art. 3.4 consente massimo 2 giocatori nel vivaio.
  await assertVivaioDopoAggiunta(squadra, giocatore);

  // Costo: normale asta svincolati (gestita esternamente)
  // Qui inseriamo il giocatore direttamente
  const { data: inserted, error } = await supabase.from('rosa').insert({
    squadra,
    nome: giocatore.nome,
    ruolo: giocatore.ruolo,
    anni: giocatore.anni,
    quot: giocatore.quot,
    stip: 0, // Non gravano sul SC (art. 3.6.2)
    in_vivaio: true,
    vivaio_presenze: 0,
    quot_iniziale_vivaio: giocatore.quot,
    data_entrata_vivaio: oggi,
    data_acquisto: oggi,
    vivaio_decisione_richiesta: false,
    vivaio_decisione_da: null,
    vivaio_decisione_scadenza: null,
    vivaio_motivo_decisione: null,
  }).select().single();
  if (error) throw error;

  await logAuditVivaio(squadra, 'rosa_aggiungi', `Vivaio: acquistato ${giocatore.nome} (Q${giocatore.quot}, ${giocatore.anni}aa)`, { giocatore_id: inserted.id });
  return inserted;
}

async function logAuditVivaio(squadra, azione, descrizione, dataPrima) {
  try {
    await supabase.from('audit_log').insert({
      utente: 'admin/presidente', squadra_utente: squadra, azione, entita: 'rosa',
      squadra, descrizione, dati_prima: dataPrima, rollback_possibile: false,
    });
  } catch {}
}

// Promuovi giocatore dal vivaio alla rosa normale
export async function promuoviDaVivaio(playerId, squadra) {
  const oggi = new Date().toISOString().slice(0, 10);
  // Controlla slot rosa (max 30 senza vivaio)
  const { count: rosaCount } = await supabase.from('rosa').select('id', { count: 'exact', head: true })
    .eq('squadra', squadra).eq('in_vivaio', false);
  if ((rosaCount || 0) >= 30) throw new Error('Rosa piena (30 giocatori) — libera uno slot prima di promuovere');

  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!player) throw new Error('Giocatore non trovato');

  const { data: rosaAttuale } = await supabase.from('rosa').select('id,anni,stip,squadra_serie_a')
    .eq('squadra', squadra).eq('in_vivaio', false);
  const futuraRosa = [...(rosaAttuale || []), player];
  const futuroTotale = futuraRosa.length;
  const u21 = futuraRosa.filter(p => Number(p.anni || 0) > 0 && Number(p.anni) <= 21).length;
  const u21Richiesti = futuroTotale >= 30 ? 3 : futuroTotale === 29 ? 2 : futuroTotale === 28 ? 1 : 0;
  if (u21 < u21Richiesti) throw new Error(`Promozione non consentita: con ${futuroTotale} giocatori servono almeno ${u21Richiesti} Under-21 (attuali ${u21}).`);

  if (player.squadra_serie_a) {
    const stessaSerieA = futuraRosa.filter(p => p.squadra_serie_a === player.squadra_serie_a).length;
    if (stessaSerieA > 5) throw new Error(`Promozione non consentita: supereresti il limite di 5 giocatori del ${player.squadra_serie_a}.`);
  }

  // Calcola stipendio normale (Q/5) e verifica salary cap base/attivo.
  const stipNormale = parseFloat((player.quot / 5).toFixed(2));
  const scGiocatori = (rosaAttuale || []).reduce((sum, p) => sum + Number(p.stip || 0), 0) + stipNormale;
  const { data: superClub } = await supabase.from('investimenti')
    .select('id').eq('squadra', squadra).eq('nome', 'SuperClub').eq('attivo', true).limit(1);
  const cap = 75 + (superClub?.length ? 3 : 0);
  if (scGiocatori > cap) throw new Error(`Promozione non consentita: salary cap ${scGiocatori.toFixed(2)}M su ${cap.toFixed(2)}M.`);

  await supabase.from('rosa').update({
    in_vivaio: false,
    vivaio_promosso: true,
    stip: stipNormale,
    stip_originale: stipNormale,
    anni_contratto: 1,
    data_acquisto: oggi,
    vivaio_decisione_richiesta: false,
    vivaio_decisione_da: null,
    vivaio_decisione_scadenza: null,
    vivaio_motivo_decisione: null,
  }).eq('id', playerId);

  await logAuditVivaio(squadra, 'rosa_modifica', `Vivaio → Rosa: promosso ${player.nome} (stipendio ora ${stipNormale}M)`, { giocatore: player });
}

// Svincola giocatore dal vivaio (costo 0, art. 3.6.1)
export async function svincolaVivaio(playerId, squadra) {
  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!player) throw new Error('Giocatore non trovato');
  await supabase.from('rosa').delete().eq('id', playerId);
  await logAuditVivaio(squadra, 'rosa_rimuovi', `Vivaio: svincolato ${player.nome} (costo 0)`, { giocatore: player });
}

// Aggiorna presenze vivaio (chiamato dall'admin dopo ogni giornata)
export async function aggiornaPresenzeVivaio(playerId, nuovePresenze) {
  const { error } = await supabase.from('rosa').update({ vivaio_presenze: nuovePresenze }).eq('id', playerId);
  if (error) throw error;
  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (player?.in_vivaio) await processaDecisioniVivaio(player.squadra);
}

// Paga costo vivaio 4M annuali (art. 3.6.3)
export async function pagaCostoVivaio(squadra, bilancioAttuale) {
  const COSTO = 4;
  const oggi = new Date().toISOString().slice(0, 10);
  if (bilancioAttuale < COSTO) throw new Error(`Bilancio insufficiente: servono ${COSTO}M`);
  const nuovoBilancio = parseFloat((bilancioAttuale - COSTO).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio, vivaio_pagato: true, vivaio_stagione_pagata: getStagioneQuota(new Date()), vivaio_pagato_il: oggi }).eq('name', squadra);
  await supabase.from('movimenti').insert({ squadra, descrizione: 'Costo mantenimento vivaio (annuale)', uscita: COSTO, data: oggi });
  return nuovoBilancio;
}

// Giocatori svincolati idonei per il vivaio (under-23, Q <= 3)
// NB: il requisito "0 presenze a voto" va verificato manualmente sulla piattaforma fantacalcio
// poiché il dato delle presenze non è disponibile nella lista svincolati statica
export function filtraVivaioCandidati(freeAgents) {
  return freeAgents.filter(p => p.anni > 0 && p.anni <= 23 && p.quot <= 3);
}
// ─── SVINCOLATI DB (art. 3.6, sostituisce FREE_AGENTS statico) ───────────────

export async function getSvincolatiDB(stagione = '2025-26') {
  const { data, error } = await supabase
    .from('svincolati')
    .select('*')
    .eq('stagione', stagione)
    .order('quot', { ascending: false });
  if (error) return [];
  return data;
}

export async function upsertSvincolato(player, stagione = '2025-26') {
  const { error } = await supabase.from('svincolati').upsert(
    { ...player, stagione, updated_at: new Date().toISOString() },
    { onConflict: 'nome,stagione' }
  );
  if (error) throw error;
}

export async function updateSvincolatoStats(id, stats) {
  const { error } = await supabase.from('svincolati')
    .update({ ...stats, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteSvincolato(id) {
  const { error } = await supabase.from('svincolati').delete().eq('id', id);
  if (error) throw error;
}

// Import da array Excel/XLSX — upsert massivo
export async function importSvincolatiDaArray(rows, stagione = '2025-26') {
  const mapped = rows.map(r => ({
    nome: r.nome || r.Nome || '',
    ruolo: r.ruolo || r.Ruolo || '',
    anni: Number(r.anni || r.Anni || 0),
    quot: Number(r.quot || r.Quotazione || r.Q || 0),
    stip: Number(r.stip || r.Stipendio || 0) || parseFloat(((Number(r.quot || r.Q || 0)) / 5).toFixed(2)),
    clausola: Number(r.clausola || r.Clausola || 0) || parseFloat(((Number(r.quot || r.Q || 0)) * 1.75).toFixed(2)),
    fuori_lista: Boolean(r.fuori_lista || r['Fuori Lista'] || false),
    squadra_serie_a: r.squadra_serie_a || r['Squadra SA'] || r.Squadra || null,
    partite: Number(r.partite || r.Partite || r.Pv || 0),
    media_voto: Number(r.media_voto || r['Media Voto'] || r.Mv || 0),
    media_fantavoto: Number(r.media_fantavoto || r['Media Fantavoto'] || r.Mfv || 0),
    gol: Number(r.gol || r.Gol || r.G || 0),
    assist: Number(r.assist || r.Assist || r.A || 0),
    ammonizioni: Number(r.ammonizioni || r.Amm || 0),
    espulsioni: Number(r.espulsioni || r.Esp || 0),
    autogol: Number(r.autogol || r.Aut || 0),
    rigori_parati: Number(r.rigori_parati || r.Rp || 0),
    rigori_segnati: Number(r.rigori_segnati || r.Rs || 0),
    rigori_sbagliati: Number(r.rigori_sbagliati || r.Rsb || 0),
    gol_subiti: Number(r.gol_subiti || r.Gs || 0),
    stagione,
  })).filter(r => r.nome && r.ruolo);

  // Upsert in batch da 100
  for (let i = 0; i < mapped.length; i += 100) {
    const batch = mapped.slice(i, i + 100);
    const { error } = await supabase.from('svincolati')
      .upsert(batch, { onConflict: 'nome,stagione' });
    if (error) throw error;
  }
  return mapped.length;
}

// Filtra candidati vivaio dal DB (under-23, Q<=3, partite=0)
// Ora funziona correttamente perché gli svincolati hanno le stats reali
export function filtraVivaioCandidatiDB(svincolati) {
  return svincolati.filter(p =>
    p.anni > 0 && p.anni <= 23 &&
    p.quot <= 3 &&
    (p.partite === 0 || p.partite === null || p.partite === undefined)
  );
}

// ─── AGGIORNAMENTO STIPENDI 01/01 (art. 4.5) ─────────────────────────────────

// Calcola i top-5 incrementi e decrementi per una squadra
// Confronta quot attuale vs quot_precedente
export async function calcolaTop5Aggiornamenti(squadra) {
  const { data: rosa } = await supabase
    .from('rosa')
    .select('id, nome, anni, ruolo, quot, quot_precedente, stip, rinnovo_ribasso, da_cedere')
    .eq('squadra', squadra)
    .eq('in_vivaio', false);

  if (!rosa?.length) return { rialzi: [], ribassi: [] };

  const conDelta = rosa
    .filter(p => p.quot_precedente != null)
    .map(p => ({
      ...p,
      delta: parseFloat((Number(p.quot) - Number(p.quot_precedente)).toFixed(2)),
      stipNuovo: parseFloat((Number(p.quot) / 5).toFixed(2)),
    }))
    .filter(p => p.delta !== 0);

  const rialzi  = [...conDelta].filter(p => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const ribassi = [...conDelta].filter(p => p.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);

  return { rialzi, ribassi };
}

// Applica rinnovo al rialzo obbligatorio (aggiorna stip e stip_originale)
export async function applicaRinnovoRialzo(playerId, nuovoStip, squadra) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: p } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!p) throw new Error('Giocatore non trovato');

  await supabase.from('rosa').update({
    stip: nuovoStip,
    stip_originale: nuovoStip,
    quot_precedente: p.quot,  // aggiorna la quot precedente al valore attuale
  }).eq('id', playerId);

  // Registra nel log aggiornamenti
  await supabase.from('aggiornamenti_stipendi').upsert({
    squadra, giocatore_id: playerId, nome: p.nome,
    quot_prima: p.quot_precedente || p.quot,
    quot_dopo: p.quot,
    delta: parseFloat((Number(p.quot) - Number(p.quot_precedente || p.quot)).toFixed(2)),
    tipo: 'rialzo',
    rinnovo_effettuato: true,
    nuovo_stip: nuovoStip,
    data_aggiornamento: oggi,
    stagione: stagioneDaData(oggi),
  }, { onConflict: 'stagione,giocatore_id' });

  return nuovoStip;
}

// Applica rinnovo al ribasso (entro 05/01 alle 20:00)
// Per 22-30 anni: imposta da_cedere=true
// Per 31+: nessun obbligo
// Per U21: non consentito
export async function applicaRinnovoRibasso(playerId, nuovoStip, squadra) {
  const { data: p } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!p) throw new Error('Giocatore non trovato');

  const isU21 = p.anni > 0 && p.anni <= 21;
  if (isU21) throw new Error(`${p.nome} è Under-21 — non è possibile ridurre il contratto`);

  const oggi = new Date().toISOString().slice(0, 10);
  const deveCedere = p.anni >= 22 && p.anni <= 30;

  await supabase.from('rosa').update({
    stip: nuovoStip,
    rinnovo_ribasso: true,
    da_cedere: deveCedere,
    data_rinnovo_ribasso: oggi,
    quot_precedente: p.quot,
  }).eq('id', playerId);

  await supabase.from('aggiornamenti_stipendi').upsert({
    squadra, giocatore_id: playerId, nome: p.nome,
    quot_prima: p.quot_precedente || p.quot,
    quot_dopo: p.quot,
    delta: parseFloat((Number(p.quot) - Number(p.quot_precedente || p.quot)).toFixed(2)),
    tipo: 'ribasso',
    rinnovo_effettuato: true,
    nuovo_stip: nuovoStip,
    data_aggiornamento: oggi,
    stagione: stagioneDaData(oggi),
    note: deveCedere ? 'Da cedere entro 15/09' : 'Over 31 - nessun obbligo',
  }, { onConflict: 'stagione,giocatore_id' });

  return { nuovoStip, deveCedere };
}

// Aggiorna quot_precedente a fine ciclo (da chiamare dopo aver fatto tutti i rinnovi)
export async function aggiornaPrecedenti(squadra) {
  await supabase.from('rosa')
    .update({ quot_precedente: supabase.rpc('get_quot', {}) })
    .eq('squadra', squadra);
  // Più semplice: aggiorna campo per campo
  const { data } = await supabase.from('rosa').select('id, quot').eq('squadra', squadra);
  for (const p of data || []) {
    await supabase.from('rosa').update({ quot_precedente: p.quot }).eq('id', p.id);
  }
}

// Verifica finestra ribasso (01/01 → 05/01 ore 20:00)
export function isFinestraRibasso() {
  const ora = new Date();
  const m = ora.getMonth() + 1, d = ora.getDate(), h = ora.getHours();
  if (m !== 1) return false;
  if (d === 1 || d === 2 || d === 3 || d === 4) return true;
  if (d === 5 && h < 20) return true;
  return false;
}

// Carica storico aggiornamenti per una squadra
export async function getAggiornamenti(squadra, stagione = '2025-26') {
  const { data } = await supabase.from('aggiornamenti_stipendi')
    .select('*').eq('squadra', squadra).eq('stagione', stagione)
    .order('data_aggiornamento', { ascending: false });
  return data || [];
}

// ─── AGGIORNAMENTO QUOTAZIONI DA EXCEL (art. 4.6/4.7) ────────────────────────
// Aggiorna quot e stip di tutti i giocatori di tutte le rose da un file Excel
// Formato atteso: Nome, Quotazione (o Q), Ruolo (opzionale)
// Restituisce un array di differenze per mostrare l'anteprima

export async function calcolaAnteprimaAggiornamentoQuote(rows) {
  // Fetch tutte le rose
  const { data: tuttiGiocatori } = await supabase.from('rosa').select('id, nome, quot, stip, anni, squadra, ruolo').eq('in_vivaio', false);
  if (!tuttiGiocatori) return [];

  // Mappa nome → nuova quotazione dall'Excel
  const nuoveQuote = {};
  for (const r of rows) {
    const nome = (r.Nome || r.nome || r.NOME || '').trim();
    const quot = parseFloat(r.Quotazione || r.Q || r.quot || r.QUOTAZIONE || 0);
    if (nome && quot > 0) nuoveQuote[nome] = quot;
  }

  // Calcola differenze
  const diff = [];
  for (const p of tuttiGiocatori) {
    const nuovaQuot = nuoveQuote[p.nome];
    if (nuovaQuot === undefined) continue; // non presente nell'Excel
    const vecchiaQuot = Number(p.quot);
    const delta = parseFloat((nuovaQuot - vecchiaQuot).toFixed(2));
    const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));
    diff.push({
      id: p.id,
      nome: p.nome,
      squadra: p.squadra,
      ruolo: p.ruolo,
      anni: p.anni,
      quotPrima: vecchiaQuot,
      quotDopo: nuovaQuot,
      delta,
      stipPrima: Number(p.stip),
      stipDopo: nuovoStip,
    });
  }
  return diff.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export async function applicaAggiornamentoQuote(diff, tipo = '01/06') {
  // Aggiorna ogni giocatore in batch
  const oggi = new Date().toISOString().slice(0, 10);
  let aggiornati = 0;
  for (const p of diff) {
    const isU21 = p.anni > 0 && p.anni <= 21;
    // Per art. 4.8.1: U21 non hanno mai aumenti contrattuali percentuali
    // Ma la quotazione si aggiorna ugualmente (è la quotazione di mercato)
    await supabase.from('rosa').update({
      quot: p.quotDopo,
      stip: p.stipDopo,
      stip_originale: p.stipDopo,
      clausola: parseFloat((p.quotDopo * 1.75).toFixed(2)),
      quot_precedente: p.quotPrima, // salva per art. 4.5 (top-5 incrementi/decrementi)
    }).eq('id', p.id);
    aggiornati++;
  }
  // Aggiorna anche la tabella svincolati con le nuove quotazioni
  const svincolatiAggiornati = diff.filter(p => p.squadra === null);
  // (gli svincolati vengono aggiornati separatamente via import nella SvincolatiPage)
  return aggiornati;
}

// ─── FINESTRA CHIAMATE SVINCOLATI (art. 6.3) ─────────────────────────────────

export function getFinestraChiamate() {
  const ora = new Date();
  const giorno = ora.getDay(); // 0=dom, 1=lun, 2=mar, 3=mer, 4=gio, 5=ven, 6=sab
  const oreMin = ora.getHours() * 60 + ora.getMinutes();

  // Infrasettimanale: nessuna asta (gestito manualmente, qui solo info)
  const finestraInteresse =
    (giorno === 2 && oreMin >= 9 * 60) ||   // martedì dalle 9:00
    (giorno === 3 && oreMin < 21 * 60);      // mercoledì prima delle 21:00

  const finestraAltriInteressi =
    (giorno === 3 && oreMin >= 21 * 60) ||   // mercoledì dalle 21:00
    (giorno === 4 && oreMin < 21 * 60);      // giovedì prima delle 21:00

  const giornoAste = giorno === 5; // venerdì

  return {
    aperta: finestraInteresse,
    finestraInteresse,
    finestraAltriInteressi,
    giornoAste,
    messaggio: finestraInteresse
      ? "✅ Finestra aperta — puoi manifestare interesse (fino a mer 21:00)"
      : finestraAltriInteressi
        ? "⏳ Finestra interesse altri presidenti (fino a gio 21:00)"
        : giornoAste
          ? "🏷️ Giorno aste"
          : `Finestra chiusa — riapre martedì alle 9:00`,
    giornoCorrente: ["dom","lun","mar","mer","gio","ven","sab"][giorno],
  };
}

// ─── ASTE SVINCOLATI / VIVAIO (art. 6.3) ─────────────────────────────────────

export async function getAsteSvincolati(filtroStato = null) {
  let q = supabase.from('aste_svincolati').select('*').order('created_at', { ascending: false });
  if (filtroStato) q = q.eq('stato', filtroStato);
  const { data } = await q;
  return data || [];
}

export async function insertAstaSvincolati(asta) {
  const { data, error } = await supabase.from('aste_svincolati').insert(asta).select().single();
  if (error) throw error;
  return data;
}

export async function updateAstaSvincolati(id, fields) {
  const { error } = await supabase.from('aste_svincolati').update(fields).eq('id', id);
  if (error) throw error;
}

export async function getOfferteAsta(astaId) {
  const { data } = await supabase.from('offerte_asta').select('*')
    .eq('asta_id', astaId).order('importo', { ascending: false });
  return data || [];
}

export async function upsertOffertaAsta(astaId, squadra, importo, perVivaio = false) {
  const { data: asta } = await supabase.from('aste_svincolati')
    .select('stato, quot, scadenza').eq('id', astaId).single();
  if (!asta) throw new Error('Asta non trovata');
  if (asta.stato !== 'raccolta_offerte') throw new Error('Asta chiusa');
  if (new Date() > new Date(asta.scadenza)) throw new Error('Scadenza offerte superata');
  const minOfferta = parseFloat((Number(asta.quot) * 0.75).toFixed(2));
  if (importo < minOfferta) throw new Error(`Offerta minima: ${minOfferta}M (¾ quotazione)`);

  const { data, error } = await supabase.from('offerte_asta')
    .upsert({ asta_id: astaId, squadra, importo, per_vivaio: perVivaio, assente: false },
             { onConflict: 'asta_id,squadra' })
    .select().single();
  if (error) throw error;
  return data;
}

// ── calcolaScadenzaAsta (alias per calcolaScadenzaOfferte) ────────────────────
export function calcolaScadenzaAsta(dataPrimaChiamata = new Date()) {
  const scInt = calcolaScadenzaInteresse(dataPrimaChiamata);
  return calcolaScadenzaOfferte(scInt);
}

// ── Calcola slot scalare venerdì per una nuova asta ──────────────────────────
// Prima asta del venerdì → 11:00 UTC (12:00 Italia); ogni asta successiva +30min
export async function calcolaSlotVenerdì(venerdìUTC) {
  // Cerca aste già programmate per quel venerdì UTC (da 00:00 a 23:59 UTC)
  const inizioGiorno = new Date(venerdìUTC);
  inizioGiorno.setUTCHours(0, 0, 0, 0);
  const fineGiorno = new Date(venerdìUTC);
  fineGiorno.setUTCHours(23, 59, 59, 999);

  const { data: asteGia } = await supabase
    .from('aste_svincolati')
    .select('scadenza')
    .gte('scadenza', inizioGiorno.toISOString())
    .lte('scadenza', fineGiorno.toISOString())
    .in('stato', ['raccolta_offerte', 'assegnata', 'rivelata']);

  return (asteGia || []).length;
}

// ── Crea asta da chiamate esistenti ──────────────────────────────────────────
export async function creaAstaDaChiamate(nomeGiocatore) {
  const { data: chiamate } = await supabase.from('chiamate')
    .select('*').eq('giocatore', nomeGiocatore).eq('stato', 'aperta')
    .order('created_at', { ascending: true });
  if (!chiamate?.length) throw new Error('Nessuna chiamata trovata');

  const primaria = chiamate.find(c => c.tipo === 'prima');
  if (!primaria) throw new Error('Chiamata principale non trovata');

  const scadenzaInteresse = new Date(primaria.scadenza_interesse);

  // Sempre: venerdì = giovedì + 1 giorno, slot base 13:00 UTC (14:00 Italia) + 30min per ogni asta già presente
  const ven = new Date(scadenzaInteresse);
  ven.setUTCDate(scadenzaInteresse.getUTCDate() + 1);
  ven.setUTCHours(13, 0, 0, 0);
  const slot = await calcolaSlotVenerdì(ven);
  ven.setUTCMinutes(slot * 30);
  const scadenzaOfferte = ven;

  const { data: asta, error } = await supabase.from('aste_svincolati')
    .insert({
      giocatore: nomeGiocatore,
      ruolo: primaria.ruolo,
      anni: primaria.anni || 0,
      quot: primaria.quot,
      squadra_serie_a: primaria.squadra_serie_a || '',
      per_vivaio: primaria.per_vivaio || false,
      aperta_da: primaria.squadra,
      scadenza_interesse: scadenzaInteresse.toISOString(),
      scadenza: scadenzaOfferte.toISOString(),
      stato: 'raccolta_offerte',
      n_interessati: chiamate.length,
    })
    .select().single();
  if (error) throw error;

  await supabase.from('chiamate')
    .update({ stato: 'in_asta', asta_id: asta.id })
    .eq('giocatore', nomeGiocatore).eq('stato', 'aperta');

  return asta;
}

// ── Rivela offerte + trasferimento automatico (unico interess. → Q/2) ─────────
async function verificaRiacquistoConsentito(squadra, giocatore) {
  const storico = await getStagioneSvincoli(squadra);
  const history = Array.isArray(storico?.svincolati_history) ? storico.svincolati_history : [];
  const record = [...history].reverse().find(h => String(h.nome || '').toLowerCase() === String(giocatore || '').toLowerCase());
  if (!record?.riacquistabile_dal) return true;
  const oggi = new Date().toISOString().slice(0, 10);
  if (oggi < record.riacquistabile_dal) {
    throw new Error(`${giocatore} non può essere riacquistato da ${squadra} prima del ${record.riacquistabile_dal} (60 giorni dallo svincolo).`);
  }
  return true;
}

export async function rivelaECompletaAsta(astaId) {
  const { data: asta } = await supabase.from('aste_svincolati')
    .select('*').eq('id', astaId).single();
  if (!asta) throw new Error('Asta non trovata');
  if (asta.per_vivaio && !isVivaioAcquistiAperti()) throw new Error('Le assegnazioni al vivaio sono consentite solo dal 01/09 al 31/05.');

  // Ordine interesse dal timestamp chiamate
  const { data: chiamate } = await supabase.from('chiamate')
    .select('squadra, created_at').eq('giocatore', asta.giocatore)
    .order('created_at', { ascending: true });
  const ordineInteresse = (chiamate || []).map(c => c.squadra);

  // Offerte presenti
  const { data: offerteEsistenti } = await supabase.from('offerte_asta')
    .select('*').eq('asta_id', astaId);
  const squadreConOfferta = new Set((offerteEsistenti || []).map(o => o.squadra));

  // Offerta automatica = quotazione per chi non ha offerto
  for (const sq of ordineInteresse) {
    if (!squadreConOfferta.has(sq)) {
      await supabase.from('offerte_asta').upsert({
        asta_id: astaId, squadra: sq,
        importo: Number(asta.quot),
        per_vivaio: asta.per_vivaio, assente: true,
      }, { onConflict: 'asta_id,squadra' });
    }
  }

  // Tutte le offerte ordinate
  const { data: tutteOfferte } = await supabase.from('offerte_asta')
    .select('*').eq('asta_id', astaId).order('importo', { ascending: false });

  // Vincitore: max importo; parità → prima chiamata
  const maxImporto = Number(tutteOfferte?.[0]?.importo || 0);
  const pareggi = (tutteOfferte || []).filter(o => Number(o.importo) === maxImporto);
  const vincitore = pareggi.length === 1
    ? pareggi[0].squadra
    : ordineInteresse.find(sq => pareggi.some(p => p.squadra === sq)) || pareggi[0]?.squadra;
  const prezzoFinale = maxImporto;

  if (!vincitore) throw new Error('Nessun offerente');
  await verificaRiacquistoConsentito(vincitore, asta.giocatore);

  // Trasferimento
  const oggi = new Date().toISOString().slice(0, 10);
  const stip  = parseFloat((Number(asta.quot) / 5).toFixed(2));
  const claus = parseFloat((Number(asta.quot) * 1.75).toFixed(2));

  if (asta.per_vivaio) {
    await assertVivaioDopoAggiunta(vincitore, { nome: asta.giocatore, anni: asta.anni, quot: asta.quot, presenze_voto: asta.presenze_voto || 0 });
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: asta.giocatore, ruolo: asta.ruolo,
      anni: asta.anni, quot: asta.quot, stip: 0, stip_originale: stip, clausola: claus,
      squadra_serie_a: asta.squadra_serie_a,
      in_vivaio: true, vivaio_presenze: 0, quot_iniziale_vivaio: asta.quot, vivaio_pagato: false,
      anni_contratto: 1, data_acquisto: oggi,
    });
  } else {
    await assertRosaDopoAggiunta(vincitore, { nome: asta.giocatore, ruolo: asta.ruolo, anni: asta.anni, quot: asta.quot, squadra_serie_a: asta.squadra_serie_a, in_vivaio: false });
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: asta.giocatore, ruolo: asta.ruolo,
      anni: asta.anni, quot: asta.quot, stip, clausola: claus,
      squadra_serie_a: asta.squadra_serie_a,
      in_vivaio: false, anni_contratto: 1, data_acquisto: oggi,
    });
    await supabase.from('svincolati').delete()
      .eq('nome', asta.giocatore);
  }

  // Scala bilancio
  const { data: sq } = await supabase.from('squadre')
    .select('bilancio').eq('name', vincitore).single();
  await supabase.from('squadre')
    .update({ bilancio: parseFloat((Number(sq.bilancio) - prezzoFinale).toFixed(2)) })
    .eq('name', vincitore);

  // Movimento
  await supabase.from('movimenti').insert({
    squadra: vincitore,
    descrizione: `Acquisto ${asta.giocatore} da Svincolati${asta.per_vivaio ? ' (Vivaio)' : ''}`,
    uscita: prezzoFinale, data: oggi,
  });

  // Elimina chiamate del giocatore
  await supabase.from('chiamate').delete().eq('giocatore', asta.giocatore);

  // Chiudi asta
  await updateAstaSvincolati(astaId, {
    stato: 'assegnata', vincitore, prezzo_finale: prezzoFinale,
  });

  return { vincitore, prezzoFinale, offerte: tutteOfferte };
}

// ── Trasferimento diretto per unico interessato (¾ Q — base d'asta) ──────────
export async function completaUnicoInteressato(nomeGiocatore) {
  const { data: chiamate } = await supabase.from('chiamate')
    .select('*').eq('giocatore', nomeGiocatore)
    .in('stato', ['aperta', 'in_asta'])
    .order('created_at', { ascending: true });
  if (!chiamate?.length) throw new Error('Nessuna chiamata trovata');

  const primaria = chiamate[0];
  if (primaria.per_vivaio && !isVivaioAcquistiAperti()) throw new Error('Le assegnazioni al vivaio sono consentite solo dal 01/09 al 31/05.');
  const vincitore = primaria.squadra;
  await verificaRiacquistoConsentito(vincitore, nomeGiocatore);
  // Unico interessato → paga la base d'asta = ¾ della quotazione (art. 6.3)
  const prezzoFinale = parseFloat((Number(primaria.quot) * 0.75).toFixed(2));
  const oggi = new Date().toISOString().slice(0, 10);
  const stip  = parseFloat((Number(primaria.quot) / 5).toFixed(2));
  const claus = parseFloat((Number(primaria.quot) * 1.75).toFixed(2));

  if (primaria.per_vivaio) {
    await assertVivaioDopoAggiunta(vincitore, { nome: nomeGiocatore, anni: primaria.anni || 0, quot: primaria.quot, presenze_voto: primaria.presenze_voto || 0 });
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: nomeGiocatore, ruolo: primaria.ruolo,
      anni: primaria.anni || 0, quot: primaria.quot, stip: 0, stip_originale: stip, clausola: claus,
      squadra_serie_a: primaria.squadra_serie_a || '',
      in_vivaio: true, vivaio_presenze: 0, quot_iniziale_vivaio: primaria.quot, vivaio_pagato: false,
      anni_contratto: 1, data_acquisto: oggi,
    });
  } else {
    await assertRosaDopoAggiunta(vincitore, { nome: nomeGiocatore, ruolo: primaria.ruolo, anni: primaria.anni || 0, quot: primaria.quot, squadra_serie_a: primaria.squadra_serie_a || '', in_vivaio: false });
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: nomeGiocatore, ruolo: primaria.ruolo,
      anni: primaria.anni || 0, quot: primaria.quot, stip, clausola: claus,
      squadra_serie_a: primaria.squadra_serie_a || '',
      in_vivaio: false, anni_contratto: 1, data_acquisto: oggi,
    });
    await supabase.from('svincolati').delete()
      .eq('nome', nomeGiocatore);
  }

  const { data: sq } = await supabase.from('squadre')
    .select('bilancio').eq('name', vincitore).single();
  await supabase.from('squadre')
    .update({ bilancio: parseFloat((Number(sq.bilancio) - prezzoFinale).toFixed(2)) })
    .eq('name', vincitore);

  await supabase.from('movimenti').insert({
    squadra: vincitore,
    descrizione: `Acquisto ${nomeGiocatore} da Svincolati${primaria.per_vivaio ? ' (Vivaio)' : ''} — unico interessato`,
    uscita: prezzoFinale, data: oggi,
  });

  await supabase.from('chiamate').delete().eq('giocatore', nomeGiocatore);

  return { vincitore, prezzoFinale };
}

// ── Check automatico: processa chiamate e aste scadute ───────────────────────
export async function checkScadenzeAste() {
  const ora = new Date();
  const oraISO = ora.toISOString();
  const risultati = [];

  // 1. Chiamate con scadenza_interesse scaduta → crea asta o processa unico
  const { data: chiamateScadute } = await supabase.from('chiamate')
    .select('giocatore, quot, per_vivaio, scadenza_interesse, squadra, tipo')
    .eq('stato', 'aperta').eq('tipo', 'prima').lte('scadenza_interesse', oraISO);

  for (const c of chiamateScadute || []) {
    // Conta tutti gli interessati
    const { data: tutti } = await supabase.from('chiamate')
      .select('id').eq('giocatore', c.giocatore).in('stato', ['aperta']);
    const nInteressati = tutti?.length || 1;

    if (nInteressati === 1) {
      // Unico interessato → Q/2 automatico (venerdì stesso)
      try {
        const r = await completaUnicoInteressato(c.giocatore);
        risultati.push({ tipo: 'unico', giocatore: c.giocatore, ...r });
      } catch(e) { risultati.push({ tipo: 'errore', giocatore: c.giocatore, error: e.message }); }
    } else {
      // Più interessati → crea asta
      try {
        const asta = await creaAstaDaChiamate(c.giocatore);
        risultati.push({ tipo: 'asta_creata', giocatore: c.giocatore, astaId: asta.id });
      } catch(e) {
        if (!e.message.includes('già esistente')) {
          risultati.push({ tipo: 'errore', giocatore: c.giocatore, error: e.message });
        }
      }
    }
  }

  // 2. Aste con scadenza offerte scaduta → rivela e completa
  const { data: asteScadute } = await supabase.from('aste_svincolati')
    .select('id, giocatore').eq('stato', 'raccolta_offerte').lte('scadenza', oraISO);

  for (const a of asteScadute || []) {
    try {
      const r = await rivelaECompletaAsta(a.id);
      risultati.push({ tipo: 'asta_completata', giocatore: a.giocatore, ...r });
    } catch(e) { risultati.push({ tipo: 'errore', id: a.id, error: e.message }); }
  }

  return risultati;
}

// Alias backward-compat
export const checkAsteScadute = checkScadenzeAste;
export const rivelaAsta = rivelaECompletaAsta;
export const confermaTrasferimentoAsta = async () => true;

export function subscribeAsteSvincolati(callback) {
  return supabase.channel('aste-svincolati-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'aste_svincolati' }, callback)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'offerte_asta' }, callback)
    .subscribe();
}

// ─── LISTONE (database 2 — tutti i giocatori) ────────────────────────────────

export async function getListone() {
  const { data, error } = await supabase.from('listone').select('*').order('quot', { ascending: false });
  if (error) return [];
  return data;
}

export async function getListoneBySquadra(fantaSquadra) {
  const { data, error } = await supabase.from('listone').select('*').eq('fanta_squadra', fantaSquadra).order('ruolo');
  if (error) return [];
  return data;
}

// Importa il listone da un array di righe Excel (usato nella pagina admin)
// Aggiorna SOLO statistiche per giocatori già in rosa; quot/stip/clausola vengono aggiornati solo nel listone
export async function importListoneDaExcel(rows) {
  const mapped = rows
    .filter(r => (r.Nome || r.nome || '').trim())
    .map(r => {
      const nome = (r.Nome || r.nome || '').trim();
      const quot = parseFloat(String(r['QUOT.'] || r.quot || r.Quotazione || 0).replace('€', '').replace(',', '.')) || 0;
      const salario = parseFloat(String(r['Salario'] || r.salario || 0).replace('€', '').replace(',', '.')) || parseFloat((quot / 5).toFixed(2));
      const clausola = parseFloat(String(r['Clausola Rescissoria'] || r.clausola || 0).replace('€', '').replace(',', '.')) || parseFloat((quot * 1.75).toFixed(2));
      return {
        numero:           Number(r['#'] || r.numero || 0) || null,
        nome,
        fuori_lista:      Boolean(r['Fuori lista'] || r.fuori_lista || false),
        squadra_serie_a:  (r['Sq.'] || r.squadra_serie_a || '').trim() || null,
        anni:             Number(r.Under || r.anni || 0) || null,
        ruolo:            (r['R.MANTRA'] || r.ruolo || '').trim() || null,
        quot,
        salario,
        clausola,
        fanta_squadra:    (r.FantaSquadra || r.fanta_squadra || '').trim() || null,
        partite_voto:     Number(r['Partite a voto'] || r.partite_voto || 0) || 0,
        media_voto:       parseFloat(r['Media Voto'] || r.media_voto || 0) || 0,
        media_fantavoto:  parseFloat(r['Media Fantavoto'] || r.media_fantavoto || 0) || 0,
        gol_fatti:        Number(r['Gol fatti'] || r.gol_fatti || 0) || 0,
        gol_subiti:       Number(r['Gol subiti'] || r.gol_subiti || 0) || 0,
        rigori_parati:    Number(r['Rigori Parati'] || r.rigori_parati || 0) || 0,
        rigori_calciati:  Number(r['Rigori Calciati'] || r.rigori_calciati || 0) || 0,
        rigori_segnati:   Number(r['Rigori Segnati'] || r.rigori_segnati || 0) || 0,
        rigori_sbagliati: Number(r['Rigori Sbagliati'] || r.rigori_sbagliati || 0) || 0,
        assist:           Number(r.Assist || r.assist || 0) || 0,
        ammonizioni:      Number(r.Ammonizioni || r.ammonizioni || 0) || 0,
        espulsioni:       Number(r.Espulsioni || r.espulsioni || 0) || 0,
        autogol:          Number(r.Autogol || r.autogol || 0) || 0,
        updated_at:       new Date().toISOString(),
      };
    });

  // Upsert in batch da 100
  for (let i = 0; i < mapped.length; i += 100) {
    const batch = mapped.slice(i, i + 100);
    const { error } = await supabase.from('listone').upsert(batch, { onConflict: 'nome' });
    if (error) throw error;
  }

  // Aggiorna solo le statistiche dei giocatori in rosa (NON quot/stip/clausola)
  const { data: rosa } = await supabase.from('rosa').select('id, nome').eq('in_vivaio', false);
  for (const p of rosa || []) {
    const riga = mapped.find(r => r.nome.toLowerCase() === p.nome.toLowerCase());
    if (!riga) continue;
    await supabase.from('rosa').update({
      partite:          riga.partite_voto,
      media_voto:       riga.media_voto,
      media_fantavoto:  riga.media_fantavoto,
      gol:              riga.gol_fatti,
      gol_subiti:       riga.gol_subiti,
      rigori_parati:    riga.rigori_parati,
      rigori_segnati:   riga.rigori_segnati,
      rigori_sbagliati: riga.rigori_sbagliati,
      assist:           riga.assist,
      ammonizioni:      riga.ammonizioni,
      espulsioni:       riga.espulsioni,
      autogol:          riga.autogol,
    }).eq('id', p.id);
  }

  // Controlla e aggiorna lo stipendio nei giocatori in rosa prendendo il valore dal listone
  // Solo quando un giocatore è stato trasferito (fanta_squadra aggiornata dall'app)
  // Questo è gestito da aggiornaStipendioDopoTrasferimento()

  return mapped.length;
}

// Aggiorna fanta_squadra nel listone quando avviene un trasferimento
export async function aggiornaFantaSquadraListone(nomeGiocatore, nuovaFantaSquadra) {
  const { error } = await supabase.from('listone')
    .update({ fanta_squadra: nuovaFantaSquadra, updated_at: new Date().toISOString() })
    .ilike('nome', nomeGiocatore);
  if (error) console.warn('aggiornaFantaSquadraListone:', error.message);
}

// Prende stipendio dal listone e lo applica alla rosa dopo un trasferimento
export async function aggiornaStipendioDopoTrasferimento(nomeGiocatore, squadraDestinazione) {
  const { data: listone } = await supabase.from('listone').select('salario, quot').ilike('nome', nomeGiocatore).single();
  if (!listone) return null;
  const stipDaListone = Number(listone.salario) || parseFloat((Number(listone.quot) / 5).toFixed(2));
  const { data: player } = await supabase.from('rosa').select('id')
    .eq('squadra', squadraDestinazione).ilike('nome', nomeGiocatore).single();
  if (!player) return null;
  await supabase.from('rosa').update({ stip: stipDaListone }).eq('id', player.id);
  return stipDaListone;
}

// ─── BONUS TRATTATIVA ────────────────────────────────────────────────────────

export async function getBonusTrattativa(trattativaId) {
  const { data, error } = await supabase.from('trattative_bonus')
    .select('*').eq('trattativa_id', trattativaId).order('created_at');
  if (error) return [];
  return data;
}

export async function insertBonusTrattativa(bonus) {
  const { data, error } = await supabase.from('trattative_bonus').insert(bonus).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBonusTrattativa(id) {
  const { error } = await supabase.from('trattative_bonus').delete().eq('id', id);
  if (error) throw error;
}

// Controlla tutti i bonus non completati e li confronta con i dati listone aggiornati.
// Da chiamare dopo ogni importListoneDaExcel.
// Per ogni bonus completato: trasferisce i mln, registra il movimento, segna come completato.
export async function checkECompletaBonus() {
  const oggi = new Date().toISOString().slice(0, 10);
  const risultati = [];

  // Prendi tutti i bonus non completati con la trattativa collegata
  const { data: bonusList } = await supabase
    .from('trattative_bonus')
    .select('*, trattative(id, giocatore, da_squadra, a_squadra, stato)')
    .eq('completato', false);

  if (!bonusList?.length) return risultati;

  for (const bonus of bonusList) {
    const trattativa = bonus.trattative;
    // Considera solo trattative completate o accettate
    if (!trattativa || !['completata', 'accettata', 'clausola_eseguita'].includes(trattativa.stato)) continue;

    // Trova il giocatore nel listone
    const { data: rigaListone } = await supabase.from('listone')
      .select('*').ilike('nome', trattativa.giocatore).single();
    if (!rigaListone) continue;

    // Calcola il valore attuale della statistica
    const valoreAttuale = _getStatListone(rigaListone, bonus.tipo_bonus);
    if (valoreAttuale < bonus.soglia) continue; // non ancora raggiunto

    // Bonus completato — determina chi paga e chi riceve
    // Convenzione: da_squadra = acquirente, a_squadra = cedente.
    const squadraPaga = bonus.direzione === 'acquirente_paga' ? trattativa.da_squadra : trattativa.a_squadra;
    const squadraRiceve = bonus.direzione === 'acquirente_paga' ? trattativa.a_squadra : trattativa.da_squadra;
    const importo = Number(bonus.valore_mln);

    // Aggiorna bilanci
    const { data: sqs } = await supabase.from('squadre').select('name, bilancio').in('name', [squadraPaga, squadraRiceve]);
    const bilPaga   = sqs?.find(s => s.name === squadraPaga)?.bilancio   || 0;
    const bilRiceve = sqs?.find(s => s.name === squadraRiceve)?.bilancio || 0;
    await supabase.from('squadre').update({ bilancio: parseFloat((bilPaga   - importo).toFixed(2)) }).eq('name', squadraPaga);
    await supabase.from('squadre').update({ bilancio: parseFloat((bilRiceve + importo).toFixed(2)) }).eq('name', squadraRiceve);

    // Movimenti (influiscono sul FPF)
    const descBonus = _labelBonus(bonus.tipo_bonus);
    await supabase.from('movimenti').insert([
      { squadra: squadraPaga,   descrizione: `Bonus clausola: ${trattativa.giocatore} — ${descBonus} ≥${bonus.soglia} (pagamento)`,  uscita: importo,  data: oggi },
      { squadra: squadraRiceve, descrizione: `Bonus clausola: ${trattativa.giocatore} — ${descBonus} ≥${bonus.soglia} (incasso)`,    entrata: importo, data: oggi },
    ]);

    // Segna bonus come completato
    await supabase.from('trattative_bonus').update({
      completato: true,
      data_completamento: oggi,
    }).eq('id', bonus.id);

    risultati.push({ bonus: bonus.id, giocatore: trattativa.giocatore, tipo: bonus.tipo_bonus, importo, squadraPaga, squadraRiceve });
  }

  return risultati;
}

function _getStatListone(riga, tipoBounus) {
  switch (tipoBounus) {
    case 'partite_voto':  return Number(riga.partite_voto  || 0);
    case 'gol_fatti':     return Number(riga.gol_fatti     || 0);
    case 'assist':        return Number(riga.assist        || 0);
    case 'bonus_tot':     return Number(riga.gol_fatti || 0) + Number(riga.assist || 0);
    case 'ammonizioni':   return Number(riga.ammonizioni   || 0);
    case 'espulsioni':    return Number(riga.espulsioni    || 0);
    case 'gol_subiti':    return Number(riga.gol_subiti    || 0);
    case 'malus_tot':     return Number(riga.ammonizioni || 0) + Number(riga.espulsioni || 0) + Number(riga.gol_subiti || 0);
    default: return 0;
  }
}

function _labelBonus(tipo) {
  const map = {
    partite_voto: 'Partite a voto',
    gol_fatti: 'Gol fatti',
    assist: 'Assist',
    bonus_tot: 'Bonus (Gol+Assist)',
    ammonizioni: 'Ammonizioni',
    espulsioni: 'Espulsioni',
    gol_subiti: 'Gol subiti',
    malus_tot: 'Malus (Amm+Esp+GS)',
  };
  return map[tipo] || tipo;
}

export function getLabelBonus(tipo) { return _labelBonus(tipo); }

// ─── PENALITÀ AUTOMATICHE MERCATO (art. 5.3) ─────────────────────────────────

// Calcola stato notifica trattativa — usato sia per display che per applicare penalità.
// Il countdown riparte da created_at/updated_at di ogni nuova offerta/controfferta.
export function calcolaStatoTrattativaMercato(trattativa) {
  const now = Date.now();
  const base = new Date(trattativa.updated_at || trattativa.created_at).getTime();
  const h = (now - base) / 3600000;
  const quot = Number(trattativa.quot_giocatore || 0);

  // Clausola attivabile: 2 rifiuti/controfferte OPPURE 48h passate
  const nRifiuti = Number(trattativa.n_rifiuti || 0);
  const clausolaAttivabile = nRifiuti >= 2 || h >= 48;

  let urgenza, penaltaMln, messaggio;
  if      (h < 24) { urgenza = 'ok';       penaltaMln = 0; messaggio = `Risposta entro ${_fmtH(24-h)}`; }
  else if (h < 48) { urgenza = 'warn1';    penaltaMln = 1; messaggio = `⚠️ +1M scattato · ${_fmtH(48-h)} al prossimo`; }
  else if (h < 72) { urgenza = 'warn3';    penaltaMln = 3; messaggio = `🔴 +3M scattato · ${_fmtH(72-h)} al prossimo`; }
  else if (h < 96) { urgenza = 'warn5';    penaltaMln = 5; messaggio = `🚨 +5M scattato · ${_fmtH(96-h)} all'acquisto forzato`; }
  else             { urgenza = 'scaduta';  penaltaMln = 5; messaggio = `💀 Scaduta — acquisto forzato ½Q attivo`; }

  return { urgenza, penaltaMln, messaggio, clausolaAttivabile, orePassate: h, quot };
}

function _fmtH(h) {
  if (h <= 0) return '0h';
  const ore = Math.floor(h), min = Math.round((h - ore) * 60);
  return ore > 0 ? `${ore}h${min > 0 ? ` ${min}m` : ''}` : `${min}m`;
}

// Applica penalità automatica per ritardo risposta.
// Da chiamare da un polling nel client (es. ogni 5 min) sulle trattative in attesa.
// Verifica che la penalità non sia già stata applicata per questo scatto.
export async function applicaPenalitaRitardoAuto(trattativa) {
  const stato = calcolaStatoTrattativaMercato(trattativa);
  if (stato.penaltaMln <= 0) return null;

  // Evita di applicare la stessa penalità due volte: controlla penalta_applicata
  const giaPagata = Number(trattativa.penalta_applicata || 0);
  if (giaPagata >= stato.penaltaMln) return null; // già applicata

  const squadra = trattativa.a_squadra; // chi deve rispondere paga
  const oggi = new Date().toISOString().slice(0, 10);

  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  const bil = Number(sq?.bilancio || 0);
  const importo = stato.penaltaMln - giaPagata; // paga solo la differenza
  const nuovoBil = parseFloat((bil - importo).toFixed(2));

  await supabase.from('squadre').update({ bilancio: nuovoBil }).eq('name', squadra);
  await supabase.from('movimenti').insert({
    squadra,
    descrizione: `Penalità ritardo risposta (art. 5.3): ${importo}M — offerta per ${trattativa.giocatore}`,
    uscita: importo,
    data: oggi,
  });
  await supabase.from('trattative').update({ penalta_applicata: stato.penaltaMln }).eq('id', trattativa.id);

  return { importo, nuovoBil, squadra };
}

// ─── AGGIORNAMENTO CONTRATTI 01/06 (art. 4.8) ────────────────────────────────
// Incrementa anni_contratto per tutti i giocatori in rosa e applica gli aumenti
// percentuali stipendio. Da chiamare il 01/06 (admin).
// Regole:
//   - U21: nessun aumento percentuale (art. 4.8.1)
//   - Anno 1→2: +10%
//   - Anno 2→3 (rinnovo biennale): +20%  — se non rinnovato: svincolo automatico
//   - Anno 3→4: +10%
//   - Anno 4+: bonus fedeltà -10% (una sola volta)
//   - Prestiti: non vengono aggiornati (anni_contratto non avanza sul prestito)
export async function aggiornaContrattiAnnuali() {
  const oggi = new Date().toISOString().slice(0, 10);

  const { data: tutti } = await supabase
    .from('rosa')
    .select('*')
    .eq('in_vivaio', false);

  if (!tutti?.length) return { aggiornati: [], svincolati: [] };

  const aggiornati = [];
  const svincolati = [];

  for (const p of tutti) {
    const isU21 = Number(p.anni || 0) <= 21;
    const ac = Number(p.anni_contratto || 1);
    const stipAttuale = Number(p.stip || 0);

    // Under-21: anni_contratto non avanza (art. 4.8.1 — nessun aumento contrattuale)
    if (isU21) {
      // Nessuna modifica: stip e anni_contratto rimangono invariati finché U21
      continue;
    }

    // Giocatori in prestito: avanza anni_contratto ma stipendio invariato
    if (p.in_prestito) {
      await supabase.from('rosa').update({ anni_contratto: ac + 1 }).eq('id', p.id);
      continue;
    }

    // Anno 2: rinnovo biennale — richiede conferma esplicita del presidente
    // Se non confermato → svincolo automatico 01/06 (art. 4.8)
    if (ac === 2 && !p.rinnovo_confermato) {
      await supabase.from('rosa').delete().eq('id', p.id);
      await supabase.from('svincolati').upsert({
        nome: p.nome, ruolo: p.ruolo, anni: p.anni, quot: p.quot,
        stip: p.stip, clausola: parseFloat((p.quot * 1.75).toFixed(2)),
        fuori_lista: false, squadra_serie_a: p.squadra_serie_a,
        stagione: stagioneDaData(oggi), updated_at: new Date().toISOString(),
      }, { onConflict: 'nome,stagione' });
      svincolati.push({ nome: p.nome, squadra: p.squadra, motivo: 'contratto_scaduto' });
      continue;
    }

    // Tutti gli altri anni: aumento automatico
    // Anno 1→2: +10% | Anno 2→3 (confermato): +20% | Anno 3→4: +10% | Anno 4+: -10% fedeltà
    let percAumento = 0;
    if (!isU21) {
      if (ac === 1) percAumento = 10;
      else if (ac === 2) percAumento = 20;  // rinnovo biennale confermato
      else if (ac === 3) percAumento = 10;
      else if (ac >= 4) percAumento = -10;  // bonus fedeltà (una sola volta al 4°)
    }

    const nuovoStip = percAumento !== 0
      ? parseFloat((stipAttuale * (1 + percAumento / 100)).toFixed(2))
      : stipAttuale;

    await supabase.from('rosa').update({
      anni_contratto: ac + 1,
      stip: nuovoStip,
      stip_originale: nuovoStip,
      rinnovo_confermato: false, // reset per il prossimo ciclo
    }).eq('id', p.id);

    aggiornati.push({
      nome: p.nome, squadra: p.squadra,
      acPrima: ac, acDopo: ac + 1,
      stipPrima: stipAttuale, stipDopo: nuovoStip,
      percAumento,
    });
  }

  return { aggiornati, svincolati };
}

// Conferma rinnovo biennale per un giocatore (da fare entro 31/05)
export async function confermRinnovoBiennale(playerId) {
  await supabase.from('rosa').update({ rinnovo_confermato: true }).eq('id', playerId);
}

// ─── PREMI INDIVIDUALI (art. 12.4-12.5) ──────────────────────────────────────

export async function calcolaPremiIndividuali(stagione = '2026-27') {
  // Legge tutte le rose e calcola le classifiche individuali
  const { data: squadre } = await supabase.from('squadre').select('name');
  if (!squadre) return null;

  const stats = {};
  for (const sq of squadre) {
    const { data: rosa } = await supabase.from('rosa').select('gol, assist, autogol, ammonizioni, espulsioni, gol_subiti, media_voto, nome, ruolo').eq('squadra', sq.name);
    if (!rosa) continue;
    stats[sq.name] = {
      golSchierati:   rosa.reduce((s,p) => s + (p.gol||0), 0),
      golSubiti:      rosa.reduce((s,p) => s + (p.gol_subiti||0), 0),
      porteInviolate: rosa.filter(p => p.ruolo?.startsWith('Por') && (p.gol_subiti||0) === 0).length,
      ammonizioni:    rosa.reduce((s,p) => s + (p.ammonizioni||0), 0),
      espulsioni:     rosa.reduce((s,p) => s + (p.espulsioni||0), 0),
      migliorMarcatore: Math.max(...rosa.map(p => p.gol||0)),
      migliorAssist:    Math.max(...rosa.map(p => p.assist||0)),
    };
  }

  const entries = Object.entries(stats);
  const maxGol      = Math.max(...entries.map(([,s]) => s.golSchierati));
  const maxGolSub   = Math.max(...entries.map(([,s]) => s.golSubiti));
  const maxPInviol  = Math.max(...entries.map(([,s]) => s.porteInviolate));
  const maxAmm      = Math.max(...entries.map(([,s]) => s.ammonizioni));
  const maxEsp      = Math.max(...entries.map(([,s]) => s.espulsioni));
  const maxMarcator = Math.max(...entries.map(([,s]) => s.migliorMarcatore));
  const maxAssist   = Math.max(...entries.map(([,s]) => s.migliorAssist));

  const premi = [];
  for (const [squadra, s] of entries) {
    let importo = 0;
    const voci = [];
    if (s.golSchierati  === maxGol     ) { importo += 1; voci.push('+1M (primo gol schierati)'); }
    if (s.golSubiti     === maxGolSub  ) { importo += 2; voci.push('+2M (primo gol subiti)'); }
    if (s.porteInviolate=== maxPInviol ) { importo += 1; voci.push('+1M (più porte inviolate)'); }
    if (s.migliorMarcatore===maxMarcator){ importo += 1; voci.push('+1M (miglior marcatore)'); }
    if (s.migliorAssist === maxAssist  ) { importo += 1; voci.push('+1M (miglior assist man)'); }
    if (s.ammonizioni   === maxAmm     ) { importo -= 1; voci.push('-1M (più ammonizioni)'); }
    if (s.espulsioni    === maxEsp     ) { importo -= 1; voci.push('-1M (più espulsioni)'); }
    if (importo !== 0 || voci.length > 0) premi.push({ squadra, importo, voci });
  }
  return premi;
}

// ─── NOTIZIE ──────────────────────────────────────────────────────────────────

export async function getNotizie(stagione = '2026-27', limit = 50) {
  const { data, error } = await supabase.from('notizie').select('*, commenti_notizie(count)').eq('stagione', stagione).order('pinnata', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  if (!error && data) data.forEach(n => { n.commenti_count = n.commenti_notizie?.[0]?.count ?? 0; delete n.commenti_notizie; });
  if (error) throw error;
  return data || [];
}
export async function insertNotizia({ autore, squadra, categoria, titolo, testo, immagini = [], stagione = '2026-27' }) {
  const { data, error } = await supabase.from('notizie').insert({ autore, squadra, categoria, titolo, testo, immagini, stagione }).select().single();
  if (error) throw error;
  return data;
}
export async function updateNotizia(id, fields) {
  const { data, error } = await supabase.from('notizie').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function deleteNotizia(id) { const { error } = await supabase.from('notizie').delete().eq('id', id); if (error) throw error; }
export async function togglePinnata(id, pinnata) { const { error } = await supabase.from('notizie').update({ pinnata }).eq('id', id); if (error) throw error; }
export async function toggleReaction(id, emoji, username, currentReactions) {
  const reactions = { ...currentReactions };
  if (!reactions[emoji]) reactions[emoji] = [];
  const idx = reactions[emoji].indexOf(username);
  if (idx >= 0) reactions[emoji].splice(idx, 1); else reactions[emoji].push(username);
  const { error } = await supabase.from('notizie').update({ reactions }).eq('id', id);
  if (error) throw error;
  return reactions;
}
export async function uploadNotiziaImmagine(file, path) {
  if (!file) throw new Error('Nessun file selezionato');
  const optimized = await compressForUpload(file, 'news');
  const requested = ensureWebpPath(path || `notizie/${optimized.name}`);
  const prefix = requested.split('/').slice(0, -1).join('/') || 'notizie';
  const finalPath = uniqueStoragePath(prefix, optimized.name);
  const { error } = await supabase.storage.from('notizie-immagini').upload(finalPath, optimized, {
    upsert: false,
    contentType: optimized.type || WEBP_MIME,
    cacheControl: '31536000',
  });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('notizie-immagini').getPublicUrl(finalPath);
  return publicUrl;
}
export function subscribeNotizie(callback) { return supabase.channel('notizie-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'notizie' }, callback).subscribe(); }
export async function getCommenti(notiziaId) { const { data, error } = await supabase.from('commenti_notizie').select('*').eq('notizia_id', notiziaId).order('created_at', { ascending: true }); if (error) throw error; return data || []; }
export async function insertCommento({ notiziaId, autore, squadra, testo, parentCommentId = null }) { const { data, error } = await supabase.from('commenti_notizie').insert({ notizia_id: notiziaId, autore, squadra, testo, parent_comment_id: parentCommentId }).select().single(); if (error) throw error; return data; }
export async function updateCommento(id, testo) { const { data, error } = await supabase.from('commenti_notizie').update({ testo, updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return data; }
export async function deleteCommento(id) { const { error } = await supabase.from('commenti_notizie').delete().eq('id', id); if (error) throw error; }
export function subscribeCommenti(notiziaId, callback) { return supabase.channel(`commenti-${notiziaId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'commenti_notizie', filter: `notizia_id=eq.${notiziaId}` }, callback).subscribe(); }
// ─── ADMIN CONTROL ROOM — EXTRA BULK OPERATIONS ──────────────────────────────

// Mercato override (stored in impostazioni table)
export async function getMercatoOverride() {
  const { data } = await supabase.from('impostazioni').select('valore').eq('chiave', 'mercato_override').limit(1);
  return data?.[0]?.valore ?? null; // null=auto, 'aperto', 'chiuso'
}

export async function setMercatoOverride(valore) {
  // valore: null (auto), 'aperto', 'chiuso'
  if (valore === null) {
    await supabase.from('impostazioni').delete().eq('chiave', 'mercato_override');
  } else {
    await supabase.from('impostazioni').upsert({ chiave: 'mercato_override', valore }, { onConflict: 'chiave' });
  }
}

// Trasferimenti differiti
export async function getTrasferimentiDifferiti() {
  const { data } = await supabase.from('trattative').select('*').eq('stato', 'accettata_differita').order('updated_at', { ascending: false });
  return data || [];
}

// FPF: applica multe a tutte le squadre che hanno sforato
export async function applicaMulteFPFTutte(stagione = '2026-27') {
  const fpfMap = await getFpfTutteSquadre();
  const oggi = new Date().toISOString().slice(0, 10);
  const results = [];

  for (const [squadra, netto] of Object.entries(fpfMap)) {
    const { multa, pt, euro } = calcolaFairSpending(netto);
    if (multa === 0) { results.push({ squadra, skip: true, motivo: 'in_regola' }); continue; }

    // Check già applicata questa stagione
    const { data: penGia } = await supabase.from('penalita')
      .select('id').eq('squadra', squadra).eq('codice_tipo', 'fpf').eq('stagione', stagione).eq('applicata', true).single();
    if (penGia) { results.push({ squadra, skip: true, motivo: 'gia_applicata' }); continue; }

    const { data: sq } = await supabase.from('squadre').select('bilancio, punti').eq('name', squadra).single();
    if (!sq) { results.push({ squadra, skip: true, motivo: 'squadra_not_found' }); continue; }

    const nuovoBilancio = parseFloat((sq.bilancio - multa).toFixed(2));
    const nuoviPunti = (sq.punti || 0) - pt;

    await supabase.from('squadre').update({ bilancio: nuovoBilancio, ...(pt > 0 ? { punti: nuoviPunti } : {}) }).eq('name', squadra);
    await supabase.from('movimenti').insert({ squadra, descrizione: `Multa FPF ${stagione} (netto: ${netto.toFixed(1)}M)`, uscita: multa, data: oggi });
    // Insert penalita record
    await supabase.from('penalita').insert({ squadra, stagione, codice_tipo: 'fpf', descrizione: `FPF ${stagione}`, importo: multa, pt_penalita: pt, euro_penalita: euro, applicata: true, data: oggi });

    results.push({ squadra, ok: true, netto, multa, pt, euro });
  }
  return results;
}

// Premi: distribuisci premi campionato in base alla classifica attuale
export async function applicaPremiCampionato(stagione = '2026-27') {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: classifica } = await supabase.from('classifica').select('squadra, punti').eq('stagione', stagione).order('punti', { ascending: false });
  if (!classifica?.length) throw new Error('Nessuna classifica trovata');

  const results = [];
  for (let i = 0; i < classifica.length; i++) {
    const squadra = classifica[i].squadra;
    const posizione = i + 1;
    const premio = calcolaPremiFinali(posizione);
    if (!premio) { results.push({ squadra, posizione, skip: true }); continue; }

    // Check già assegnato
    const { data: giaAssegnato } = await supabase.from('movimenti').select('id')
      .eq('squadra', squadra).ilike('descrizione', `Premio campionato ${stagione}%`).single();
    if (giaAssegnato) { results.push({ squadra, posizione, skip: true, motivo: 'gia_assegnato' }); continue; }

    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
    const nuovoBilancio = parseFloat(((sq?.bilancio || 0) + premio).toFixed(2));
    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
    await supabase.from('movimenti').insert({ squadra, descrizione: `Premio campionato ${stagione} (${posizione}° posto)`, entrata: premio, data: oggi });
    results.push({ squadra, posizione, ok: true, premio });
  }
  return results;
}

// ─── TELEGRAM NOTIFICATIONS ──────────────────────────────────────────────────

/**
 * Send a Telegram notification via the Edge Function.
 * type:    notification type key (see Edge Function index.ts for full list)
 * payload: data object for the message template
 * squadra: (optional) target team for private DMs; omit for public-only
 *
 * Never throws — errors are silently swallowed so they don't break app flows.
 */
// Message types reference (built in Edge Function):
// ds_masterclass_offerte — private DM with all rival offers before auction reveal

export async function sendTelegramNotification(type, payload = {}, squadra = null) {
  try {
    await supabase.functions.invoke('telegram-notify', {
      body: { type, payload, ...(squadra ? { squadra } : {}) },
    });
  } catch (e) {
    console.warn('[Telegram] notification failed silently:', type, e);
  }
}

// ─── TELEGRAM REGISTRATIONS (Admin) ──────────────────────────────────────────

export async function getTelegramRegistrations() {
  const { data, error } = await supabase
    .from('telegram_registrations')
    .select('squadra, chat_id, username, registered_at')
    .order('registered_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteTelegramRegistration(squadra) {
  const { error } = await supabase
    .from('telegram_registrations')
    .delete()
    .eq('squadra', squadra);
  if (error) throw error;
}

// ── Albo d'Oro ────────────────────────────────────────────────────────────────
export async function getStagioniPassate() {
  const { data, error } = await supabase.from('stagioni_passate').select('*').order('anno', { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function upsertStagione(stagione) {
  const { error } = await supabase.from('stagioni_passate').upsert(stagione, { onConflict: 'anno' });
  if (error) throw error;
}
export async function deleteStagione(anno) {
  const { error } = await supabase.from('stagioni_passate').delete().eq('anno', anno);
  if (error) throw error;
}
export async function uploadMaglia(stagione, squadra, file) {
  if (!file) throw new Error('Nessun file selezionato');
  const optimized = await compressForUpload(file, 'maglia');
  const safeSquadra = safeFileBaseName(squadra);
  const path = uniqueStoragePath(`maglie/${stagione.replace(/\//g,'-')}/${safeSquadra}`, optimized.name);
  const { error } = await supabase.storage.from('team-images').upload(path, optimized, {
    upsert: false,
    contentType: optimized.type || WEBP_MIME,
    cacheControl: '31536000',
  });
  if (error) throw error;
  const { data } = supabase.storage.from('team-images').getPublicUrl(path);
  return data.publicUrl;
}

export async function getRegolamentoArticoli() {
  const { data, error } = await supabase.from('regolamento_articoli').select('*').order('ordine').order('id');
  if (error) throw error;
  return data || [];
}
export async function upsertRegolamentoArticolo(art) {
  const { error } = await supabase.from('regolamento_articoli').upsert(art, { onConflict: 'id' });
  if (error) throw error;
}
export async function insertRegolamentoArticolo(art) {
  const { error } = await supabase.from('regolamento_articoli').insert(art);
  if (error) throw error;
}
export async function deleteRegolamentoArticolo(id) {
  const { error } = await supabase.from('regolamento_articoli').delete().eq('id', id);
  if (error) throw error;
}

export async function rimuoviAllenatore(squadra, nomeAllenatore, rimborso = 0) {
  await supabase.from('allenatori_carte').update({ squadra: null }).eq('nome', nomeAllenatore).eq('squadra', squadra);
  if (rimborso > 0) {
    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
    await supabase.from('squadre').update({ bilancio: parseFloat(((sq?.bilancio||0)+rimborso).toFixed(2)) }).eq('name', squadra);
    await supabase.from('movimenti').insert({ squadra, descrizione: `Rimozione carta allenatore: ${nomeAllenatore} (rimborso admin)`, entrata: rimborso, data: new Date().toISOString().slice(0,10) });
  }
  const { data: carta } = await supabase.from('allenatori_carte').select('id').eq('nome', nomeAllenatore).single();
  if (carta) {
    const { data: obIds } = await supabase.from('obiettivi_carte').select('id').eq('carta_id', carta.id);
    if (obIds?.length) await supabase.from('progressi_obiettivi').delete().in('obiettivo_id', obIds.map(o=>o.id)).eq('squadra', squadra);
  }
}

// ─── RIVALITÀ GLOBAL LOCK ─────────────────────────────────────────────────────

export async function getRivalitaLock() {
  const { data } = await supabase.from('impostazioni').select('valore').eq('chiave', 'rivalita_bloccata').limit(1);
  return data?.[0]?.valore === 'true';
}

export async function setRivalitaLock(bloccata) {
  if (bloccata) {
    await supabase.from('impostazioni').upsert({ chiave: 'rivalita_bloccata', valore: 'true' }, { onConflict: 'chiave' });
  } else {
    await supabase.from('impostazioni').upsert({ chiave: 'rivalita_bloccata', valore: 'false' }, { onConflict: 'chiave' });
  }
}

// ─── IMPORT DATABASE FANTA.XLSX ───────────────────────────────────────────────

export async function importDatabaseFanta(rows, stagione = '2026-27') {
  // 1. Aggiorna listone + stats rosa via funzione esistente (match case-insensitive per nome)
  const totaleListone = await importListoneDaExcel(rows);

  // 2. Carica rose (id + nome) per aggiornare quot_reale
  const { data: rosaAll } = await supabase.from('rosa').select('id, nome').eq('in_vivaio', false);
  const rosaMap = {};
  for (const p of (rosaAll || [])) rosaMap[p.nome.trim().toLowerCase()] = p;

  // 3. Costruisci mappa nome→quot dal file
  const quotMap = {};
  for (const r of rows) {
    const nome = (r['Nome'] || '').trim();
    const quot = Number(r['QUOT.'] || 0);
    if (nome && quot > 0) quotMap[nome.toLowerCase()] = { nome, quot, squadra_serie_a: r['Sq.'] || null };
  }

  // 4. Aggiorna quot_reale in rosa (case-insensitive)
  let rosaAggiornati = 0, nonTrovati = [];
  const BATCH = 50;
  const rosaEntries = Object.entries(rosaMap);
  for (let i = 0; i < rosaEntries.length; i += BATCH) {
    await Promise.all(rosaEntries.slice(i, i + BATCH).map(async ([nomeLower, p]) => {
      const q = quotMap[nomeLower];
      if (!q) { nonTrovati.push(p.nome); return; }
      await supabase.from('rosa').update({ quot_reale: q.quot, squadra_serie_a: q.squadra_serie_a }).eq('id', p.id);
      rosaAggiornati++;
    }));
  }

  // 5. Aggiorna svincolati: quot/stip/clausola + stats (già fatto dal listone, ma anche nella tabella svincolati)
  const { data: svinAll } = await supabase.from('svincolati').select('id, nome').eq('stagione', stagione);
  let svinAggiornati = 0;
  for (let i = 0; i < (svinAll || []).length; i += BATCH) {
    await Promise.all((svinAll || []).slice(i, i + BATCH).map(async s => {
      const q = quotMap[s.nome.trim().toLowerCase()];
      if (!q) return;
      const stip = parseFloat((q.quot / 5).toFixed(2));
      const clausola = parseFloat((q.quot * 1.75).toFixed(2));
      // Trova riga completa per le stats
      const row = rows.find(r => (r['Nome'] || '').trim().toLowerCase() === s.nome.trim().toLowerCase());
      if (!row) return;
      await supabase.from('svincolati').update({
        quot: q.quot, stip, clausola,
        partite: Number(row['Partite a voto'] || 0),
        media_voto: Number(row['Media Voto'] || 0),
        media_fantavoto: Number(row['Media Fantavoto'] || 0),
        gol: Number(row['Gol fatti'] || 0),
        gol_subiti: Number(row['Gol subiti'] || 0),
        rigori_parati: Number(row['Rigori Parati'] || 0),
        rigori_segnati: Number(row['Rigori Segnati'] || 0),
        rigori_sbagliati: Number(row['Rigori Sbagliati'] || 0),
        assist: Number(row['Assist'] || 0),
        ammonizioni: Number(row['Ammonizioni'] || 0),
        espulsioni: Number(row['Espulsioni'] || 0),
        autogol: Number(row['Autogol'] || 0),
      }).eq('id', s.id);
      svinAggiornati++;
    }));
  }

  return { rosaAggiornati, svinAggiornati, nonTrovati, totale: totaleListone };
}

// ─── AGGIORNAMENTI PERIODICI DATABASE ────────────────────────────────────────

// Calcola top5 rialzo/ribasso globale basandosi su quot_reale vs quot
export async function calcolaTop5GlobaleQuotReale() {
  const { data } = await supabase
    .from('rosa')
    .select('id, nome, anni, ruolo, quot, quot_reale, stip, squadra, rinnovo_ribasso, da_cedere')
    .eq('in_vivaio', false)
    .not('quot_reale', 'is', null);

  const conDelta = (data || [])
    .map(p => ({
      ...p,
      delta: parseFloat((Number(p.quot_reale) - Number(p.quot)).toFixed(2)),
      stipNuovo: parseFloat((Number(p.quot_reale) / 5).toFixed(2)),
    }))
    .filter(p => p.delta !== 0);

  const rialzi  = [...conDelta].filter(p => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const ribassi = [...conDelta].filter(p => p.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  return { rialzi, ribassi };
}

// Applica aggiornamento 01/01:
// - top 5 rialzo: overwrite quot/stip con quot_reale
// - top 5 ribasso: nessuna azione automatica (i presidenti scelgono entro 05/01)
export async function applica01Gennaio(top5Rialzo, stagione = '2026-27') {
  const oggi = new Date().toISOString().slice(0, 10);
  let rialziApplicati = 0;
  for (const p of top5Rialzo) {
    const nuovaQuot = Number(p.quot_reale);
    const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));
    const nuovaClausola = parseFloat((nuovaQuot * 1.75).toFixed(2));
    await supabase.from('rosa').update({
      quot: nuovaQuot,
      stip: nuovoStip,
      stip_originale: nuovoStip,
      clausola: nuovaClausola,
      quot_precedente: p.quot,
      quot_reale: nuovaQuot,
    }).eq('id', p.id);
    await supabase.from('aggiornamenti_stipendi').upsert({
      squadra: p.squadra, giocatore_id: p.id, nome: p.nome,
      quot_prima: p.quot, quot_dopo: nuovaQuot, delta: p.delta,
      tipo: 'rialzo', rinnovo_effettuato: true,
      nuovo_stip: nuovoStip, data_aggiornamento: oggi, stagione,
    }, { onConflict: 'stagione,giocatore_id' });
    rialziApplicati++;
  }
  return { rialziApplicati };
}

// Applica aggiornamento 01/06 o 01/08:
// Tutti i giocatori in rosa: quot = quot_reale, stip/clausola ricalcolati
export async function applica01GiugnoAgosto(stagione = '2026-27') {
  const { data } = await supabase
    .from('rosa')
    .select('id, nome, anni, quot, quot_reale, stip, squadra')
    .eq('in_vivaio', false)
    .not('quot_reale', 'is', null);

  const oggi = new Date().toISOString().slice(0, 10);
  let aggiornati = 0;
  const BATCH = 50;
  const players = (data || []).filter(p => Number(p.quot_reale) > 0);

  for (let i = 0; i < players.length; i += BATCH) {
    await Promise.all(players.slice(i, i + BATCH).map(async p => {
      const nuovaQuot = Number(p.quot_reale);
      const isU21 = p.anni > 0 && p.anni <= 21;
      const nuovoStip = isU21
        ? Number(p.stip) // U21: stip invariato per art. 4.8.1
        : parseFloat((nuovaQuot / 5).toFixed(2));
      const nuovaClausola = parseFloat((nuovaQuot * 1.75).toFixed(2));
      await supabase.from('rosa').update({
        quot: nuovaQuot,
        stip: nuovoStip,
        stip_originale: nuovoStip,
        clausola: nuovaClausola,
        quot_precedente: p.quot,
      }).eq('id', p.id);
      aggiornati++;
    }));
  }
  return { aggiornati, totale: players.length };
}

// Aggiornamento 01/08 – full import con creazione nuove voci per giocatori non presenti.
// Per ogni riga del file:
//   - Se il giocatore è in rosa (match per nome case-insensitive): aggiorna stats + quot_reale + squadra_serie_a + anni + ruolo, poi applica quot=quot_reale
//   - Se è in svincolati: aggiorna tutti i campi
//   - Se non esiste né in rosa né in svincolati: crea nuova voce in svincolati
export async function importa01Agosto(rows, stagione = '2026-27') {
  // Prima aggiorna listone completo
  await importListoneDaExcel(rows);

  const { data: rosaAll } = await supabase.from('rosa').select('id, nome, anni, stip').eq('in_vivaio', false);
  const { data: svinAll }  = await supabase.from('svincolati').select('id, nome').eq('stagione', stagione);

  const rosaMap  = {};
  for (const p of (rosaAll  || [])) rosaMap[p.nome.trim().toLowerCase()]  = p;
  const svinMap  = {};
  for (const s of (svinAll  || [])) svinMap[s.nome.trim().toLowerCase()]  = s;

  let rosaAggiornati = 0, svinAggiornati = 0, nuoviCreati = 0;
  const nonTrovati = [];
  const BATCH = 50;

  const validRows = rows.filter(r => (r['Nome'] || '').trim());

  for (let i = 0; i < validRows.length; i += BATCH) {
    await Promise.all(validRows.slice(i, i + BATCH).map(async r => {
      const nome = (r['Nome'] || '').trim();
      const nomeLower = nome.toLowerCase();
      const quot = Number(r['QUOT.'] || 0);
      const squadra_serie_a = (r['Sq.'] || '').trim() || null;
      const anni = Number(r['Under'] || r['Età'] || 0) || null;
      const ruolo = (r['R.MANTRA'] || '').trim() || null;
      const stip = parseFloat((quot / 5).toFixed(2));
      const clausola = parseFloat((quot * 1.75).toFixed(2));
      const statsRosa = {
        partite:          Number(r['Partite a voto'] || 0),
        media_voto:       parseFloat(r['Media Voto'] || 0) || 0,
        media_fantavoto:  parseFloat(r['Media Fantavoto'] || 0) || 0,
        gol:              Number(r['Gol fatti'] || 0),
        gol_subiti:       Number(r['Gol subiti'] || 0),
        rigori_parati:    Number(r['Rigori Parati'] || 0),
        rigori_segnati:   Number(r['Rigori Segnati'] || 0),
        rigori_sbagliati: Number(r['Rigori Sbagliati'] || 0),
        assist:           Number(r['Assist'] || 0),
        ammonizioni:      Number(r['Ammonizioni'] || 0),
        espulsioni:       Number(r['Espulsioni'] || 0),
        autogol:          Number(r['Autogol'] || 0),
      };
      const statsSvin = {
        partite:          statsRosa.partite,
        media_voto:       statsRosa.media_voto,
        media_fantavoto:  statsRosa.media_fantavoto,
        gol:              statsRosa.gol,
        gol_subiti:       statsRosa.gol_subiti,
        rigori_parati:    statsRosa.rigori_parati,
        rigori_segnati:   statsRosa.rigori_segnati,
        rigori_sbagliati: statsRosa.rigori_sbagliati,
        assist:           statsRosa.assist,
        ammonizioni:      statsRosa.ammonizioni,
        espulsioni:       statsRosa.espulsioni,
        autogol:          statsRosa.autogol,
      };

      if (rosaMap[nomeLower]) {
        const p = rosaMap[nomeLower];
        const isU21 = (anni || p.anni || 0) > 0 && (anni || p.anni || 0) <= 21;
        await supabase.from('rosa').update({
          quot_reale: quot, quot, squadra_serie_a, anni, ruolo,
          stip: isU21 ? Number(p.stip) : stip,
          stip_originale: isU21 ? Number(p.stip) : stip,
          clausola, quot_precedente: p.quot || quot,
          ...statsRosa,
        }).eq('id', p.id);
        rosaAggiornati++;
      } else if (svinMap[nomeLower]) {
        await supabase.from('svincolati').update({
          quot, stip, clausola, squadra_serie_a: squadra_serie_a || null,
          ...statsSvin,
        }).eq('id', svinMap[nomeLower].id);
        svinAggiornati++;
      } else if (quot > 0) {
        // Nuovo giocatore: inserisce in svincolati
        await supabase.from('svincolati').insert({
          nome, quot, stip, clausola, ruolo, stagione,
          squadra_serie_a: squadra_serie_a || null,
          ...statsSvin,
        });
        nuoviCreati++;
      } else {
        nonTrovati.push(nome);
      }
    }));
  }

  return { rosaAggiornati, svinAggiornati, nuoviCreati, nonTrovati, totale: validRows.length };
}

// ─── STAGIONE ─────────────────────────────────────────────────────────────────
export async function getStagioneLabel() {
  const { data } = await supabase.from('impostazioni').select('valore').eq('chiave', 'stagione_label').limit(1);
  return data?.[0]?.valore || '2026/27';
}
export async function setStagioneLabel(label) {
  await supabase.from('impostazioni').upsert({ chiave: 'stagione_label', valore: label }, { onConflict: 'chiave' });
}

// ─── TORNEI (Coppa Italia + Supercoppa) ──────────────────────────────────────
export async function getTorneo(chiave) {
  const { data } = await supabase.from('impostazioni').select('valore').eq('chiave', chiave).limit(1);
  if (!data?.[0]?.valore) return null;
  try { return JSON.parse(data[0].valore); } catch { return null; }
}
export async function setTorneo(chiave, obj) {
  await supabase.from('impostazioni').upsert({ chiave, valore: JSON.stringify(obj) }, { onConflict: 'chiave' });
}
