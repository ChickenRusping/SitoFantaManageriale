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
    // L'avatar profilo non è mai mostrato oltre i 72px in nessuna pagina
    // dell'app (26-28px in sidebar/header, 72px nella pagina profilo): 500px
    // era enormemente sovradimensionato ed era una delle fonti principali di
    // cached egress, essendo caricato ad ogni prima visita di ogni utente.
    // 160px copre anche schermi retina (72px x2).
    avatar: { maxWidth: 160, maxHeight: 160, quality: 0.78 },
    stemma: { maxWidth: 500, maxHeight: 500, quality: 0.74 },
    stemma_thumb: { maxWidth: 120, maxHeight: 120, quality: 0.7 },
    maglia: { maxWidth: 1200, maxHeight: 1200, quality: 0.76 },
    squadra: { maxWidth: 1400, maxHeight: 1400, quality: 0.78 },
    // La thumb è di gran lunga la più scaricata (una per ogni immagine di ogni
    // post visto nel feed, ad ogni visita — incluse quelle senza cache
    // persistente, es. browser interni di app come Telegram, che riscaricano
    // tutto da zero ignorando il cache-control). Va tenuta il più leggera
    // possibile: nel feed è mostrata al massimo a poche centinaia di px.
    news: { maxWidth: 1280, maxHeight: 1280, quality: 0.72 },
    news_thumb: { maxWidth: 480, maxHeight: 480, quality: 0.6 },
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

// Ricerca giocatori per nome su più squadre in UNA sola query, invece di una
// query per squadra come faceva prima il form nuova trattativa (7 query ad
// ogni digitazione con debounce). Nessun effetto collaterale di vivaio/prestiti
// qui: è solo lettura per la lista risultati, i dati completi e aggiornati si
// caricano con getRosa() solo quando l'utente sceglie effettivamente un giocatore.
export async function cercaGiocatoriInRose(query, squadre) {
  const q = (query || '').trim();
  if (q.length < 2 || !squadre?.length) return [];
  const { data, error } = await supabase
    .from('rosa')
    .select('id, nome, squadra, ruolo, quot, stip, in_vivaio')
    .in('squadra', squadre)
    .eq('in_vivaio', false)
    .ilike('nome', `%${q}%`)
    .limit(30);
  if (error) { console.warn('cercaGiocatoriInRose error:', error.message); return []; }
  return data || [];
}

export async function getRosa(squadra) {
  // Applica eventuali scadenze vivaio prima di restituire la rosa.
  // Se il SQL di migrazione non è ancora stato eseguito, non blocchiamo il caricamento.
  try { await processaDecisioniVivaio(squadra); } catch {}
  try { await processaRientriPrestitoProgrammato(); } catch {}
  const { data, error } = await supabase.from('rosa').select('*').eq('squadra', squadra).order('ruolo');
  if (error) throw error;
  return data;
}

// Riepilogo leggero di TUTTE le rose in un'unica query (niente side-effect
// vivaio/prestiti per squadra): usato per pagine di overview multi-squadra
// dove servono solo i campi necessari al calcolo del Salary Cap.
export async function getRosaLeggeraTutte() {
  const { data, error } = await supabase.from('rosa')
    .select('squadra, quot, anni_contratto, anni, in_vivaio');
  if (error) return [];
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

  const { data: rosa } = await supabase
    .from('rosa')
    .select('*')
    .eq('squadra', squadra)
    .eq('in_vivaio', false);

  const rosaAttuale = rosa || [];
  const playerInEntrata = { ...nuovoGiocatore, in_vivaio: false };
  const futura = [...rosaAttuale, playerInEntrata];

  const checkPrima = calcolaRosaCompliance(rosaAttuale);
  const checkDopo = calcolaRosaCompliance(futura);

  const totalePrima = rosaAttuale.length;
  const totaleDopo = futura.length;

  const u21Prima = rosaAttuale.filter(p => Number(p.anni || 0) > 0 && Number(p.anni || 0) <= 21).length;
  const u21Dopo = futura.filter(p => Number(p.anni || 0) > 0 && Number(p.anni || 0) <= 21).length;

  const u21RichiestiPrima = await _getU21RichiestiConDeroga(squadra, totalePrima, new Date());
  const u21RichiestiDopo = await _getU21RichiestiConDeroga(squadra, totaleDopo, new Date());

  const blocchi = [];

  // Il tetto di 30 giocatori è sforabile (non blocca più il mercato): resta
  // visibile come irregolarità nella compliance della rosa, ma un'operazione
  // (trattativa, asta, unico interessato) non va più invalidata solo per
  // questo. totaleDopo/totalePrima restano calcolati sopra perché servono
  // comunque al controllo U21 qui sotto.

  // Art. 3.2: blocca se l'operazione crea/peggiora il requisito U21.
  // Esempio: passare da 27 a 28 senza U21 richiesti può creare una nuova irregolarità.
  const u21IrregolarePrima = u21Prima < u21RichiestiPrima;
  const u21IrregolareDopo = u21Dopo < u21RichiestiDopo;
  if (u21IrregolareDopo && (!u21IrregolarePrima || u21RichiestiDopo > u21RichiestiPrima)) {
    blocchi.push(`Con ${totaleDopo} giocatori servono almeno ${u21RichiestiDopo} Under-21: presenti ${u21Dopo}.`);
  }

  // Art. 3.3: più di 5 giocatori della stessa squadra reale.
  // Questo limite NON blocca il mercato: serve come irregolarità di rosa/formazione,
  // ma una squadra deve poter comprare/vendere anche se l'operazione tocca o peggiora
  // quel conteggio. Il controllo resta visibile nella compliance della rosa.
  // Quindi qui non aggiungiamo blocchi per `Troppi giocatori del ...`.

  // Gli altri problemi già presenti in rosa non devono impedire una trattativa in entrata
  // se l'operazione non li crea o non li peggiora. Il blocco formazione resta gestito
  // dalla compliance della rosa, non dal mercato.
  if (!ignoreMinimi) {
    for (const msg of checkDopo.issues) {
      if (!checkPrima.issues.includes(msg) && !msg.startsWith('Con ') && !msg.includes('Troppi giocatori')) {
        blocchi.push(msg);
      }
    }
  }

  if (blocchi.length) {
    throw new Error(`Operazione non consentita dal regolamento rosa: ${[...new Set(blocchi)].join(' ')}`);
  }
}

async function assertVivaioDopoAggiunta(squadra, giocatore) {
  const anni = Number(giocatore.anni || 0);
  const quot = Number(giocatore.quot || 0);
  const presenze = Number(giocatore.presenze_voto ?? giocatore.partite ?? giocatore.vivaio_presenze ?? 0);
  if (!(anni > 0 && anni <= 23)) throw new Error(`${giocatore.nome} non è idoneo al vivaio: servono Under-23.`);
  if (quot > 3) throw new Error(`${giocatore.nome} non è idoneo al vivaio: Q${quot}, massimo Q3.`);
  if (presenze > 0) throw new Error(`${giocatore.nome} non è idoneo al vivaio: ha già ${presenze} presenze a voto.`);
  const { count } = await supabase.from('rosa').select('id', { count: 'exact', head: true }).eq('squadra', squadra).eq('in_vivaio', true);
  const limiteVivaio = await _getVivaioLimit(squadra, new Date());
  if ((count || 0) >= limiteVivaio) throw new Error(`Vivaio pieno: massimo ${limiteVivaio} giocatori.`);
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

// ── Calcola scadenza interesse lato JS (art. 6.4) ─────────────────────────
// La scadenza per manifestare interesse è giovedì alle 20:00, in orario locale
// dell'app/browser. Non usiamo più 20:00 UTC, perché spostava la scadenza reale
// alle 21/22 in Italia a seconda dell'ora legale.
export function calcolaScadenzaInteresse(dataChiamata = new Date()) {
  const d = new Date(dataChiamata);
  const dow = d.getDay(); // 0=dom, 1=lun, ..., 4=gio
  const giorniDaLun = (dow === 0) ? 6 : dow - 1;

  const lun = new Date(d);
  lun.setDate(d.getDate() - giorniDaLun);
  lun.setHours(0, 0, 0, 0);

  const gio = new Date(lun);
  gio.setDate(lun.getDate() + 3);
  gio.setHours(20, 0, 0, 0);

  // Se siamo già oltre giovedì 20:00 locali, vai alla settimana successiva
  if (d >= gio) gio.setDate(gio.getDate() + 7);
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
  const modalita = await getModalitaSvincolati();
  if (modalita === 'chiuso') throw new Error('Il mercato svincolati è momentaneamente chiuso.');
  if (chiamata?.per_vivaio && !isVivaioAcquistiAperti(now)) throw new Error('Le chiamate per il vivaio sono consentite solo dal 01/09 al 31/05.');
  if (chiamata?.per_vivaio) {
    if (!(Number(chiamata.anni || 0) > 0 && Number(chiamata.anni || 0) <= 23)) throw new Error('Giocatore non idoneo al vivaio: deve essere Under-23.');
    if (Number(chiamata.quot || 0) > 3) throw new Error('Giocatore non idoneo al vivaio: quotazione massima Q3.');
  }
  // Art. 6.3: non si può riacquistare un giocatore svincolato dalla propria squadra
  // prima di 60 giorni, nemmeno se nel frattempo è passato da altri presidenti.
  if (chiamata?.squadra && chiamata?.giocatore) {
    await verificaRiacquistoConsentito(chiamata.squadra, chiamata.giocatore);
  }
  // Cooldown di 30 minuti tra una chiamata e l'altra fatta dalla STESSA
  // squadra (indipendente per ogni presidente: gli altri possono continuare
  // a chiamare normalmente). Riguarda solo l'atto di chiamare per primo un
  // nuovo svincolato, non il manifestare interesse su una chiamata altrui.
  if (chiamata?.squadra) {
    const { data: ultimaChiamata } = await supabase
      .from('chiamate')
      .select('created_at')
      .eq('squadra', chiamata.squadra)
      .eq('tipo', 'prima')
      .order('created_at', { ascending: false })
      .limit(1);
    const ultima = ultimaChiamata?.[0]?.created_at ? new Date(ultimaChiamata[0].created_at) : null;
    if (ultima) {
      const minutiTrascorsi = (now.getTime() - ultima.getTime()) / 60000;
      if (minutiTrascorsi < 30) {
        const minutiRimasti = Math.ceil(30 - minutiTrascorsi);
        throw new Error(`Devi attendere ${minutiRimasti} minuti prima di poter chiamare un altro svincolato (cooldown di 30' dall'ultima chiamata).`);
      }
    }
  }
  // In modalità libera: 48h fisse dalla chiamata, nessun vincolo di giorno/orario.
  // In modalità normale: le finestre di calendario restano quelle di sempre
  // (l'enforcement in UI resta invariato, qui si calcola solo la scadenza).
  const scadenzaInteresse = modalita === 'libero' ? calcolaScadenzaInteresseLibero(now) : calcolaScadenzaInteresse(now);
  const payload = {
    ...chiamata,
    tipo: 'prima',
    stato: 'aperta',
    modalita,
    scadenza_interesse: scadenzaInteresse.toISOString(),
  };
  let { data, error } = await supabase.from('chiamate').insert(payload).select().single();
  if (error && isMissingColumnError(error)) {
    // Colonna 'modalita' non ancora migrata: riprova senza (la modalità libera
    // funziona comunque grazie alla scadenza_interesse già calcolata a 48h,
    // solo creaAstaDaChiamate non saprà distinguere in modo esplicito — vedi lì).
    const { modalita: _drop, ...fallbackPayload } = payload;
    ({ data, error } = await supabase.from('chiamate').insert(fallbackPayload).select().single());
  }
  if (error) throw error;
  return data;
}

// ── Aggiunge un interesse (tipo='interesse') ──────────────────────────────────
export async function aggiungiInteresse(nomeGiocatore, squadra, perVivaio = false) {
  const modalita = await getModalitaSvincolati();
  if (modalita === 'chiuso') throw new Error('Il mercato svincolati è momentaneamente chiuso.');
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
  await verificaRiacquistoConsentito(squadra, nomeGiocatore);
  if (new Date() > new Date(primaria.scadenza_interesse))
    throw new Error('Scadenza interesse superata');

  // Controlla duplicati
  const { data: gia } = await supabase.from('chiamate')
    .select('id').eq('giocatore', nomeGiocatore).eq('squadra', squadra);
  if (gia?.length) throw new Error('Hai già manifestato interesse per questo giocatore');

  const payload = {
    giocatore: nomeGiocatore,
    ruolo: primaria.ruolo,
    quot: primaria.quot,
    squadra,
    tipo: 'interesse',
    stato: 'aperta',
    per_vivaio: perVivaio,
    modalita: primaria.modalita || modalita,
    scadenza_interesse: primaria.scadenza_interesse,
  };
  let { data, error } = await supabase.from('chiamate').insert(payload).select().single();
  if (error && isMissingColumnError(error)) {
    const { modalita: _drop, ...fallbackPayload } = payload;
    ({ data, error } = await supabase.from('chiamate').insert(fallbackPayload).select().single());
  }
  if (error) throw error;
  return data;
}

export async function deleteChiamata(id, { forceAdmin = false, motivoAdmin = '' } = {}) {
  const { data: chiamata } = await supabase
    .from('chiamate')
    .select('id, giocatore, squadra, stato, tipo')
    .eq('id', id)
    .single();

  // Art. 6.4: in generale non è possibile ritirarsi dall'interesse.
  // L'eliminazione manuale resta consentita solo come azione admin esplicita
  // per infortuni/motivazioni speciali. Le pulizie automatiche post-asta usano
  // query dirette e non passano da questa funzione.
  if (chiamata && ['aperta', 'in_asta'].includes(chiamata.stato) && !forceAdmin) {
    throw new Error('Non è possibile ritirare un interesse già dichiarato. Serve approvazione admin per infortunio o motivazioni speciali.');
  }

  const { error } = await supabase.from('chiamate').delete().eq('id', id);
  if (error) throw error;

  if (forceAdmin && chiamata) {
    await supabase.from('audit_log').insert({
      azione: 'ritiro_interesse_admin',
      entita: 'chiamate',
      entita_id: String(id),
      squadra: chiamata.squadra,
      descrizione: `Ritiro interesse admin: ${chiamata.giocatore}${motivoAdmin ? ' — ' + motivoAdmin : ''}`,
      created_at: new Date().toISOString(),
    }).then(() => null);
  }
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
    d.startsWith('guadagno invest') ||    // Guadagno investimento
    // Iscrizione campionato (quota obbligatoria di lega, non un'operazione di mercato)
    d.startsWith('iscrizione campionato') ||
    d.startsWith('iscrizione al campionato')
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

export async function updateMovimento(id, fields) {
  const payload = { ...fields };
  if ('entrata' in payload && (payload.entrata === '' || payload.entrata === undefined)) payload.entrata = null;
  if ('uscita' in payload && (payload.uscita === '' || payload.uscita === undefined)) payload.uscita = null;
  const { data, error } = await supabase.from('movimenti').update(payload).eq('id', id).select().single();
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
  const { data, error } = await supabase.from('rosa').select('stip, in_vivaio').eq('squadra', squadra);
  if (error) throw error;
  return (data || [])
    .filter(p => !p.in_vivaio)
    .reduce((s, p) => s + Number(p.stip || 0), 0);
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

export async function aggiornaSCNegativo(squadra, scUsato, oggi, limiteCap = SALARY_CAP) {
  // Art. 4.3.2: nei mesi di giugno e luglio il salary cap può essere negativo senza penalità/blocco.
  const dataRef = oggi ? new Date(`${oggi}T12:00:00`) : new Date();
  if (isMeseEsenteSalaryCap(dataRef)) {
    await supabase.from('squadre').update({ sc_negativo_dal: null, mercato_bloccato: false }).eq('name', squadra);
    return { esente: true };
  }

  if (scUsato > limiteCap) {
    const { data } = await supabase.from('squadre').select('sc_negativo_dal').eq('name', squadra).single();
    if (!data?.sc_negativo_dal) {
      await supabase.from('squadre').update({ sc_negativo_dal: oggi, mercato_bloccato: true }).eq('name', squadra);
    }
  } else {
    await supabase.from('squadre').update({ sc_negativo_dal: null, mercato_bloccato: false }).eq('name', squadra);
  }
  return { esente: false };
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
  const { data, error } = await supabase.from('club_identity').select('squadra, stemma_url, stemma_thumb_url, maglia_casa_url, maglia_trasferta_url, maglia_terza_url');
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
  // Lo stemma viene mostrato quasi ovunque a 20-50px (TeamAvatar): generiamo anche
  // una thumbnail leggera così non si scarica la versione da 500px in ogni lista/tabella.
  const optimizedThumb = kind === 'stemma' ? await compressForUpload(file, 'stemma_thumb') : null;

  // Filename univoco + cache lunga: quando si cambia immagine cambia URL, senza ?v=Date.now().
  const slug = squadra.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const path = uniqueStoragePath(`${slug}/${kind}`, optimized.name);
  const thumbCol = kind === 'stemma' ? 'stemma_thumb_url' : null;
  const { data: oldIdentity } = await supabase.from('club_identity').select(`${col}${thumbCol ? `, ${thumbCol}` : ''}`).eq('squadra', squadra).maybeSingle();
  const oldUrl = oldIdentity?.[col];
  const oldThumbUrl = thumbCol ? oldIdentity?.[thumbCol] : null;

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

  const updateFields = { [col]: publicUrl };

  if (optimizedThumb) {
    const thumbPath = path.replace(/\.webp$/, '_thumb.webp');
    const { error: thumbErr } = await supabase.storage
      .from('team-images')
      .upload(thumbPath, optimizedThumb, {
        cacheControl: '31536000',
        upsert: false,
        contentType: optimizedThumb.type || WEBP_MIME,
      });
    if (thumbErr) throw thumbErr;
    const { data: thumbUrlData } = supabase.storage.from('team-images').getPublicUrl(thumbPath);
    updateFields[thumbCol] = thumbUrlData?.publicUrl || null;
  }

  await updateClubIdentity(squadra, updateFields);
  await removeOldStorageObject('team-images', oldUrl);
  if (oldThumbUrl) await removeOldStorageObject('team-images', oldThumbUrl);
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
  const updateFields = { [col]: null };
  if (kind === 'stemma') updateFields.stemma_thumb_url = null;
  await updateClubIdentity(squadra, updateFields);
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
  _validazioneEconomicaTrattativa(t);

  // Un giocatore attualmente in prestito è "in limbo": non può essere oggetto
  // di nessuna trattativa (né dal cedente né dal ricevente) finché non torna
  // definitivamente in una delle due rose (rientro o riscatto).
  if (t.giocatore && t.a_squadra) {
    const { data: targetRows } = await supabase.from('rosa')
      .select('in_prestito').eq('squadra', t.a_squadra).ilike('nome', t.giocatore).limit(1);
    if (targetRows?.[0]?.in_prestito) {
      throw new Error(`${t.giocatore} è attualmente in prestito: non può essere oggetto di trattative finché non rientra o viene riscattato.`);
    }
  }

  const payload = { ...t };
  if (String(payload.tipo || '').startsWith('prestito') && !payload.scadenza_prestito) {
    payload.scadenza_prestito = _scadenzaPrestitoRegolamento(payload.durata_mesi || 6);
  }

  if (payload.tipo === 'clausola') {
    const quot = _numero(payload.quot_giocatore ?? payload.quota_giocatore ?? payload.quot, 0);
    const clausola = await _calcolaClausolaPerSquadra(payload.a_squadra || payload.squadra || '', quot, new Date());
    if (quot > 0 && Math.abs(_numero(payload.prezzo) - clausola) > 0.01) {
      throw new Error(`Clausola non valida: deve essere pari alla clausola regolamentare (${clausola.toFixed(2)}M).`);
    }
  }

  // "oneroso" non serve a niente fuori dai prestiti con riscatto (diritto/
  // obbligo): non includerlo per gli altri tipi, così una trattativa normale
  // (cessione, clausola, prestito secco) non dipende dall'esistenza di quella
  // colonna. Se anche così la colonna manca ancora (migrazione non applicata)
  // e serve davvero (diritto/obbligo), ripieghiamo comunque sull'insert senza
  // il campo piuttosto che bloccare del tutto l'offerta.
  if (payload.tipo !== 'prestito_diritto' && payload.tipo !== 'prestito_obbligo') {
    delete payload.oneroso;
  }

  let { data, error } = await supabase.from('trattative').insert(payload).select().single();
  if (error && isMissingColumnError(error) && 'oneroso' in payload) {
    const { oneroso: _drop, ...fallbackPayload } = payload;
    ({ data, error } = await supabase.from('trattative').insert(fallbackPayload).select().single());
  }
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
  const quot = _numero(a.quot ?? a.quot_giocatore ?? a.quota_giocatore, 0);
  const tipo = a.tipo || a.modalita || 'rialzo';
  const prezzoBase = _numero(a.prezzo_base ?? a.prezzo_corrente ?? a.prezzo, 0);
  if (quot > 0 && tipo === 'rialzo' && prezzoBase < quot / 2) {
    throw new Error(`Asta a rialzo non valida: prezzo base minimo ½ quotazione (${(quot/2).toFixed(2)}M).`);
  }
  if (quot > 0 && tipo === 'discesa' && prezzoBase < quot / 2) {
    throw new Error(`Asta a discesa non valida: il prezzo non può partire sotto ½ quotazione (${(quot/2).toFixed(2)}M).`);
  }
  const { data, error } = await supabase.from('aste').insert(a).select().single();
  if (error) throw error;
  return data;
}

export async function updateAsta(id, fields) {
  // Validazioni minime backend per aste proprietario: no rilanci nulli/negativi e no prezzo sotto ½Q se noto.
  if (fields && ('offerta_corrente' in fields || 'prezzo_corrente' in fields || 'prezzo' in fields)) {
    const val = _numero(fields.offerta_corrente ?? fields.prezzo_corrente ?? fields.prezzo, 0);
    if (val <= 0) throw new Error('Offerta/prezzo asta non valido.');
  }
  const { error } = await supabase.from('aste').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ── Rilancio su asta a rialzo con lock ottimistico ────────────────────────────
// Legge il prezzo attuale direttamente dal DB (non da uno stato client che
// potrebbe essere qualche secondo indietro) e applica l'aggiornamento solo se
// nessun altro ha già rilanciato nel frattempo. Senza questo controllo, due
// rilanci quasi simultanei basati su un prezzo "vecchio" potrebbero far
// risultare vincitore chi ha offerto per ultimo anche senza aver davvero
// rilanciato sopra al prezzo reale.
export async function piazzaOffertaRialzo(astaId, squadra, { nuovaScadenza, incremento = 0.1 } = {}) {
  const { data: asta, error: e1 } = await supabase.from('aste').select('*').eq('id', astaId).single();
  if (e1 || !asta) throw new Error('Asta non trovata');
  if (asta.stato !== 'attiva') throw new Error('Questa asta non è più attiva.');
  if (asta.proprietario === squadra) throw new Error('Non puoi offrire sulla tua stessa asta.');
  if (asta.miglior_offerente === squadra) throw new Error('Sei già il miglior offerente su questa asta.');

  const offertaAttualeLetta = Number(asta.offerta_attuale || 0);
  const nuovaOfferta = parseFloat((offertaAttualeLetta + incremento).toFixed(2));

  const { data: updated, error } = await supabase.from('aste')
    .update({
      offerta_attuale: nuovaOfferta,
      miglior_offerente: squadra,
      ultima_offerta_at: new Date().toISOString(),
      scadenza_asta: nuovaScadenza,
      updated_at: new Date().toISOString(),
    })
    .eq('id', astaId)
    .eq('offerta_attuale', offertaAttualeLetta) // fallisce se qualcuno ha rilanciato nel frattempo
    .select();
  if (error) throw error;
  if (!updated?.length) throw new Error('Qualcuno ha rilanciato proprio ora — ricarica per vedere il nuovo prezzo e riprova.');
  return updated[0];
}

// ── Assegnazione vincitore con lock ottimistico ───────────────────────────────
// Usata sia per "Acquista ora" (discesa) sia per la chiusura manuale di un'asta
// a rialzo: garantisce che due acquisti/chiusure quasi simultanei non possano
// entrambi "vincere" lo stesso giocatore.
export async function assegnaAsta(astaId, vincitore, prezzoFinale) {
  const { data: updated, error } = await supabase.from('aste')
    .update({ stato: 'aggiudicata', vincitore, prezzo_finale: prezzoFinale, updated_at: new Date().toISOString() })
    .eq('id', astaId)
    .eq('stato', 'attiva') // fallisce se già assegnata/chiusa da qualcun altro
    .select();
  if (error) throw error;
  if (!updated?.length) throw new Error('Questa asta è già stata assegnata o chiusa da qualcun altro.');
  return updated[0];
}

// ── Chiusura senza vincitore (nessuna offerta ricevuta) ───────────────────────
export async function scadeAstaSenzaVincitore(astaId) {
  const { data: updated, error } = await supabase.from('aste')
    .update({ stato: 'scaduta', updated_at: new Date().toISOString() })
    .eq('id', astaId)
    .eq('stato', 'attiva')
    .select();
  if (error) throw error;
  return (updated?.length || 0) > 0;
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
// Quando un giocatore viene rivenduto prima che i bonus del suo acquisto
// precedente siano stati raggiunti, quell'accordo decadrebbe senza che il
// vecchio cedente incassi mai nulla. Alla rivendita liquidiamo quei bonus
// ancora pendenti al 50% forfettario del loro valore, indipendentemente da
// quanto il giocatore si sia avvicinato alla soglia.
async function _liquidaBonusPendentiAllaRivendita(giocatoreNome, squadraCedente) {
  // L'acquisto più recente con cui squadraCedente (che ora sta rivendendo)
  // aveva ottenuto questo giocatore — era lei l'acquirente in quella trattativa.
  const { data: acquisti } = await supabase
    .from('trattative')
    .select('id, da_squadra, a_squadra')
    .ilike('giocatore', giocatoreNome)
    .eq('da_squadra', squadraCedente)
    .in('stato', ['completata', 'accettata', 'clausola_eseguita'])
    .order('updated_at', { ascending: false })
    .limit(1);
  const acquisto = acquisti?.[0];
  if (!acquisto) return [];

  const { data: bonusPendenti } = await supabase
    .from('trattative_bonus')
    .select('*')
    .eq('trattativa_id', acquisto.id)
    .eq('completato', false);
  if (!bonusPendenti?.length) return [];

  const oggi = new Date().toISOString().slice(0, 10);
  const liquidati = [];
  for (const bonus of bonusPendenti) {
    const importo = parseFloat((Number(bonus.valore_mln || 0) * 0.5).toFixed(2));
    if (importo <= 0) continue;
    // Stessa convenzione di checkECompletaBonus: acquirente_paga = paga chi
    // aveva comprato (squadraCedente, ora rivenditore) verso chi glielo aveva
    // ceduto in origine; cedente_paga = il contrario.
    const squadraPaga   = bonus.direzione === 'acquirente_paga' ? acquisto.da_squadra : acquisto.a_squadra;
    const squadraRiceve = bonus.direzione === 'acquirente_paga' ? acquisto.a_squadra : acquisto.da_squadra;

    const { data: sqs } = await supabase.from('squadre').select('name, bilancio').in('name', [squadraPaga, squadraRiceve]);
    const bilPaga   = sqs?.find(s => s.name === squadraPaga)?.bilancio   || 0;
    const bilRiceve = sqs?.find(s => s.name === squadraRiceve)?.bilancio || 0;
    await supabase.from('squadre').update({ bilancio: parseFloat((bilPaga   - importo).toFixed(2)) }).eq('name', squadraPaga);
    await supabase.from('squadre').update({ bilancio: parseFloat((bilRiceve + importo).toFixed(2)) }).eq('name', squadraRiceve);

    const descBonus = _labelBonus(bonus.tipo_bonus);
    await supabase.from('movimenti').insert([
      { squadra: squadraPaga,   descrizione: `Liquidazione 50% bonus alla rivendita: ${giocatoreNome} — ${descBonus} ≥${bonus.soglia} (pagamento)`, uscita: importo,  data: oggi },
      { squadra: squadraRiceve, descrizione: `Liquidazione 50% bonus alla rivendita: ${giocatoreNome} — ${descBonus} ≥${bonus.soglia} (incasso)`,   entrata: importo, data: oggi },
    ]);

    await supabase.from('trattative_bonus').update({
      completato: true,
      data_completamento: oggi,
    }).eq('id', bonus.id);

    // Qui invece si cancella del tutto dalla pagina Altro di entrambe le
    // squadre coinvolte nell'accordo originale: non è stato "raggiunto" per
    // davvero, è stato liquidato forfettariamente perché il giocatore è stato
    // rivenduto — non ha senso restasse visibile come "Attivata".
    await supabase.from('clausole').delete().eq('trattativa_bonus_id', bonus.id);

    liquidati.push({ bonus: bonus.id, giocatore: giocatoreNome, importo, squadraPaga, squadraRiceve });
  }
  return liquidati;
}

export async function eseguiTrasferimento(trattativa) {
  const { da_squadra, a_squadra, giocatore, prezzo, tipo, quota_giocatore, quot_giocatore,
          scadenza_prestito, stipendio_a_chi, fuori_mercato, id, oneroso,
          giocatore_scambio } = trattativa;

  const oggi = new Date().toISOString().slice(0, 10);
  const tipoLabel = {
    cessione: "Cessione", prestito_diritto: "Prestito c/Dir.",
    prestito_obbligo: "Prestito c/Obl.", prestito_secco: "Prestito Secco",
    clausola: "Clausola Rescissoria", scambio: "Scambio",
  };
  const descLabel = tipoLabel[tipo] || tipo;
  const descLabelAcquirente = tipo === 'cessione' ? 'Acquisto'
    : tipo === 'clausola' ? 'Acquisto clausola'
    : tipo === 'scambio' ? 'Scambio in entrata'
    : descLabel;
  const isPrestito = tipo.startsWith('prestito');

  // Convenzione trattative: da_squadra = acquirente/mittente; a_squadra = cedente/proprietario.
  const squadraAcquirente = da_squadra;
  const squadraCedente = a_squadra;

  // Art. 5.1/5.1.1: fuori mercato l'accordo resta differito; giocatore e soldi si muovono alla riapertura.
  const mercato = getStatoMercatoRegolamento(new Date());
  if (!mercato.aperto && trattativa.stato !== 'accettata_differita' && !trattativa.esegui_ora) {
    if (id) {
      await supabase.from('trattative').update({
        stato: 'accettata_differita',
        trasferimento_previsto_il: getProssimaAperturaMercato(new Date()).toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      }).eq('id', id);
    }
    return { differito: true, previstoIl: getProssimaAperturaMercato(new Date()).toISOString().slice(0, 10) };
  }

  _validazioneEconomicaTrattativa(trattativa);

  // Art. 5.5: clausola = 1,75×Q e solo dopo due rifiuti/controfferte o 48h.
  if (tipo === 'clausola') {
    const quotClausola = _numero(quot_giocatore ?? quota_giocatore, 0);
    const valoreClausola = await _calcolaClausolaPerSquadra(squadraCedente, quotClausola, new Date());
    if (quotClausola > 0 && Math.abs(_numero(prezzo) - valoreClausola) > 0.01) {
      throw new Error(`Clausola non valida: valore richiesto ${valoreClausola.toFixed(2)}M.`);
    }
    if (!_isClausolaAttivabile(trattativa)) {
      throw new Error('Clausola non ancora attivabile: servono due rifiuti/controfferte o 48 ore dalla prima offerta.');
    }
  }

  // ── 1. Trova il giocatore nella rosa della squadra cedente ──────────────────
  const { data: rosaRows } = await supabase
    .from('rosa')
    .select('*')
    .eq('squadra', squadraCedente)
    .ilike('nome', `%${giocatore}%`);

  const player = rosaRows?.[0];
  if (!player) throw new Error(`${giocatore} non risulta nella rosa di ${squadraCedente}`);
  // Backstop (già controllato anche in insertTrattativa): un giocatore in
  // prestito non può essere scambiato/ceduto finché non torna in una rosa.
  if (player.in_prestito) throw new Error(`${giocatore} è attualmente in prestito: non può essere trasferito finché non rientra o viene riscattato.`);

  // Art. 3: il trasferimento non può portare la rosa acquirente oltre i limiti regolamentari.
  await assertRosaDopoAggiunta(squadraAcquirente, { ...player, squadra: squadraAcquirente, in_vivaio: false });

  // Art. 5.6: blocco passaggi prima di muovere giocatore/soldi.
  await checkEAggiornaPassaggi(giocatore, squadraAcquirente, tipo, { soloControllo: true });

  let nuovaQuot = null;
  if (player) {
    // ── 2. Calcola nuovo stipendio (art. 5.9): basato su quotazione attuale ──
    // Un trasferimento "scongela" la quotazione: il giocatore passa alla nuova
    // squadra con la quotazione reale di mercato (quot_reale), non con quella
    // congelata che aveva nella rosa di provenienza — coerente con la regola
    // per cui solo un cambio di proprietà (o le finestre 01/06/01/08/01/01)
    // possono far muovere la Q di un giocatore già in rosa.
    nuovaQuot = Number(player.quot_reale) > 0 ? Number(player.quot_reale) : (trattativa.quot_giocatore || player.quot);
    const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));
    const nuovaClausola = parseFloat((nuovaQuot * 1.75).toFixed(2));

    if (isPrestito) {
      // Prestito: aggiorna squadra temporanea, mantieni traccia del proprietario
      // Chi paga lo stipendio dipende da stipendio_a_chi
      await supabase.from('rosa').update({
        squadra: squadraAcquirente,
        quot: nuovaQuot,
        quot_precedente: player.quot,
        clausola: nuovaClausola,
        in_prestito: true,
        prestito_tipo: tipo,
        tag_rosa: tipo === 'prestito_secco' ? 'PRESTITO SECCO' : tipo === 'prestito_obbligo' ? 'PRESTITO OBBLIGO' : 'PRESTITO DIRITTO',
        squadra_originale: squadraCedente,
        scadenza_prestito: scadenza_prestito || _scadenzaPrestitoRegolamento(trattativa.durata_mesi || 6),
        stip: stipendio_a_chi === 'cedente' ? 0 : nuovoStip, // cedente paga → 0 per ricevente
        stip_prestito_cedente: stipendio_a_chi === 'cedente' ? nuovoStip : 0,
      }).eq('id', player.id);
    } else {
      // Cessione definitiva: aggiorna squadra e stipendio
      await supabase.from('rosa').update({
        squadra: squadraAcquirente,
        quot: nuovaQuot,
        quot_precedente: player.quot,
        clausola: nuovaClausola,
        stip: nuovoStip,
        stip_originale: nuovoStip,
        anni_contratto: 1, // reimposta da anno 1 (art. 5.9)
        rinnovo_confermato: false,
        rinnovo_ribasso: false,
        da_cedere: false,
        data_acquisto: oggi,
        in_prestito: false,
        prestito_tipo: null,
        tag_rosa: null,
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
        in_prestito: false, prestito_tipo: null, tag_rosa: null, squadra_originale: null, scadenza_prestito: null,
      }).eq('id', p2.id);
    }
  }

  // ── 2c. Liquidazione bonus pendenti di un precedente acquisto di questo
  // giocatore da parte del cedente (vedi _liquidaBonusPendentiAllaRivendita).
  // Solo cessioni/scambi trattati tra presidenti: un prestito non cambia
  // davvero la proprietà, e una clausola rescissoria è un acquisto unilaterale
  // (non una trattativa negoziata) — in nessuno dei due casi va liquidato il
  // bonus, così come non va mai liquidato in caso di svincolo (quella strada
  // non passa da eseguiTrasferimento).
  if (!isPrestito && tipo !== 'clausola') {
    try { await _liquidaBonusPendentiAllaRivendita(giocatore, squadraCedente); }
    catch (e) { console.warn('Liquidazione bonus alla rivendita fallita:', e.message); }
  }

  // Se il giocatore non è trovato nella rosa (es. svincolato), non sposta nulla
  // ma registra comunque i movimenti finanziari

  // ── 3. Calcola importo da pagare SUBITO ──────────────────────────────────────
  // Art. 5.7: nei prestiti con diritto/obbligo di riscatto si paga subito solo
  // l'oneroso (minimo 10% Q, ma pattuibile più alto tra le parti — già
  // validato in _validazioneEconomicaTrattativa) — la cifra per il riscatto
  // (50%-150% Q) NON si paga ora: si paga solo alla scadenza, e solo se
  // viene davvero esercitato (obbligo: sempre; diritto: solo se il ricevente
  // lo sceglie — vedi eseguiScadenzaPrestito).
  const isPrestitoConRiscatto = tipo === 'prestito_diritto' || tipo === 'prestito_obbligo';
  const baseOnorario = nuovaQuot ?? Number(quot_giocatore ?? quota_giocatore ?? 0);
  const importoSubito = isPrestitoConRiscatto
    ? parseFloat((Number(oneroso ?? baseOnorario * 0.10)).toFixed(2))
    : prezzo;
  // Art. 5.5.2: nella clausola rescissoria 3/4 vanno al venditore, 1/4 trattenuto.
  const importoCedente = tipo === 'clausola'
    ? parseFloat((importoSubito * 3 / 4).toFixed(2))
    : importoSubito;
  const importoAcquirente = importoSubito;

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
  const notaOneroso = isPrestitoConRiscatto ? ` — oneroso ${importoSubito}M (riscatto di ${prezzo}M da pagare solo se/quando esercitato)` : '';
  await supabase.from('movimenti').insert([
    {
      squadra: squadraCedente,
      descrizione: `${descLabel}: ${giocatore} → ${squadraAcquirente}${notaFuori}${notaOneroso}`,
      entrata: importoCedente,
      uscita: null,
      data: oggi,
    },
    {
      squadra: squadraAcquirente,
      descrizione: `${descLabelAcquirente}: ${giocatore} da ${squadraCedente}${notaFuori}${notaOneroso}`,
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
  await checkEAggiornaPassaggi(giocatore, squadraAcquirente, tipo);

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

// Processa i rientri programmati dopo rescissione anticipata (art. 5.8.2)
export async function processaRientriPrestitoProgrammato() {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from('rosa')
    .select('id,nome,squadra_originale,rescissione_prestito_scadenza')
    .eq('in_prestito', true)
    .eq('rescissione_prestito_attiva', true)
    .lte('rescissione_prestito_scadenza', oggi);

  const rientrati = [];
  for (const p of data || []) {
    if (!p.squadra_originale) continue;
    await eseguiRientroPrestito(p.id, p.squadra_originale);
    rientrati.push(p.nome);
  }
  return rientrati;
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
    prestito_tipo: null,
    tag_rosa: null,
    squadra_originale: null,
    scadenza_prestito: null,
    rescissione_prestito_attiva: false,
    rescissione_prestito_scadenza: null,
    rescissione_prestito_da: null,
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

// azione: rilevante solo per 'prestito_diritto' — 'riscatto' | 'rientro'
// (per 'prestito_obbligo' il riscatto è sempre forzato; per 'prestito_secco'
// il rientro è sempre forzato: in entrambi i casi il parametro viene ignorato).
export async function eseguiScadenzaPrestito(item, azione = null) {
  const { player, tipo, prezzo } = item;
  const oggi = new Date().toISOString().slice(0, 10);

  if (tipo === 'prestito_diritto' && !azione) {
    throw new Error('Prestito con diritto di riscatto: specifica se il ricevente esercita il riscatto o se il giocatore rientra al cedente.');
  }

  const eseguiRiscatto = tipo === 'prestito_obbligo' || (tipo === 'prestito_diritto' && azione === 'riscatto');

  if (eseguiRiscatto) {
    const squadraRicevente = player.squadra;
    const squadraCedente = player.squadra_originale;
    if (!squadraCedente) throw new Error('Squadra cedente del prestito non disponibile');
    // Riscatto (obbligo sempre, diritto se esercitato): il giocatore passa
    // definitivamente al ricevente, che paga ora la cifra pattuita (art. 5.7)
    // — l'oneroso 10% era già stato pagato all'accettazione del prestito.
    const nuovoStip = parseFloat((Number(player.quot || 0) / 5).toFixed(2));
    await supabase.from('rosa').update({
      squadra: squadraRicevente, // rimane al ricevente
      in_prestito: false, prestito_tipo: null, tag_rosa: null, squadra_originale: null, scadenza_prestito: null,
      rescissione_prestito_attiva: false, rescissione_prestito_scadenza: null, rescissione_prestito_da: null,
      stip: nuovoStip, stip_originale: nuovoStip, anni_contratto: 1,
    }).eq('id', player.id);
    if (prezzo > 0) {
      const { data: sqs } = await supabase.from('squadre').select('name,bilancio').in('name', [squadraRicevente, squadraCedente]);
      const bilRic = sqs?.find(s => s.name === squadraRicevente)?.bilancio || 0;
      const bilCed = sqs?.find(s => s.name === squadraCedente)?.bilancio || 0;
      await supabase.from('squadre').update({ bilancio: parseFloat((bilRic - prezzo).toFixed(2)) }).eq('name', squadraRicevente);
      await supabase.from('squadre').update({ bilancio: parseFloat((bilCed + prezzo).toFixed(2)) }).eq('name', squadraCedente);
      const labelRiscatto = tipo === 'prestito_obbligo' ? 'Riscatto obbligo' : 'Riscatto diritto (esercitato)';
      await supabase.from('movimenti').insert([
        { squadra: squadraRicevente, descrizione: `${labelRiscatto} ${player.nome}`, uscita: prezzo, data: oggi },
        { squadra: squadraCedente, descrizione: `${labelRiscatto} ${player.nome} (incasso)`, entrata: prezzo, data: oggi },
      ]);
    }
  } else {
    // Secco, o diritto non esercitato: torna al cedente, nessun altro costo
    // (l'oneroso 10% pagato all'inizio non viene restituito).
    await eseguiRientroPrestito(player.id, player.squadra_originale);
  }
}

// Riscatto ANTICIPATO di un prestito con diritto (art. 5.7): il ricevente può
// esercitarlo in qualsiasi momento durante il prestito, non solo a scadenza —
// riusa la stessa logica di eseguiScadenzaPrestito, recuperando la cifra
// pattuita dalla trattativa originale (mai stata ancora addebitata, dato che
// all'accettazione si paga solo l'oneroso 10%).
export async function eseguiRiscattoAnticipatoDiritto(playerId) {
  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!player || !player.in_prestito || player.prestito_tipo !== 'prestito_diritto') {
    throw new Error('Riscatto anticipato disponibile solo per un prestito con diritto di riscatto in corso.');
  }
  if (player.rescissione_prestito_attiva) {
    throw new Error('Per questo giocatore è già stata attivata una rescissione anticipata: non è più possibile riscattarlo.');
  }
  const { data: tratt } = await supabase.from('trattative')
    .select('prezzo').eq('giocatore', player.nome)
    .eq('a_squadra', player.squadra_originale).eq('da_squadra', player.squadra)
    .eq('tipo', 'prestito_diritto').order('created_at', { ascending: false }).limit(1);
  const prezzo = Number(tratt?.[0]?.prezzo || 0);
  return await eseguiScadenzaPrestito({ player, tipo: 'prestito_diritto', prezzo }, 'riscatto');
}

// ── Rescissione anticipata prestito (art. 5.8.1) ─────────────────────────────
// chiPaga: 'ricevente' (25% Q) | 'cedente' (50% Q)
export async function eseguiRescissioneAnticipataPrestito(playerId, chiPaga) {
  const oggi = new Date();
  const oggiStr = oggi.toISOString().slice(0, 10);
  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!player || !player.in_prestito) throw new Error('Giocatore non in prestito');
  if (player.rescissione_prestito_attiva) throw new Error('Rescissione già attivata per questo prestito.');

  const squadraRicevente = player.squadra;
  const squadraCedente   = player.squadra_originale;
  const quotReale = _numero(player.quot_reale ?? player.quot, 0);

  // Art. 5.8.1: 25% quotazione reale per chi ha ricevuto, 50% per chi ha dato in prestito.
  const pct = chiPaga === 'ricevente' ? 0.25 : 0.50;
  const indennizzo = parseFloat((quotReale * pct).toFixed(2));

  const squadraPaga    = chiPaga === 'ricevente' ? squadraRicevente : squadraCedente;
  const squadraIncassa = chiPaga === 'ricevente' ? squadraCedente   : squadraRicevente;

  const { data: sqs } = await supabase.from('squadre').select('name,bilancio')
    .in('name', [squadraPaga, squadraIncassa]);
  const bilPaga    = sqs?.find(s => s.name === squadraPaga)?.bilancio    || 0;
  const bilIncassa = sqs?.find(s => s.name === squadraIncassa)?.bilancio || 0;
  await supabase.from('squadre').update({ bilancio: parseFloat((bilPaga    - indennizzo).toFixed(2)) }).eq('name', squadraPaga);
  await supabase.from('squadre').update({ bilancio: parseFloat((bilIncassa + indennizzo).toFixed(2)) }).eq('name', squadraIncassa);

  // Art. 5.8.2: se mercato aperto rientra dopo 7 giorni esatti; fuori mercato al primo giorno utile.
  const mercato = getStatoMercatoRegolamento(oggi);
  const scadenza = mercato.aperto
    ? new Date(oggi.getTime() + 7 * 86400000)
    : getProssimaAperturaMercato(oggi);
  const scadenzaStr = scadenza.toISOString().slice(0, 10);

  await supabase.from('rosa').update({
    rescissione_prestito_attiva: true,
    rescissione_prestito_da: chiPaga,
    rescissione_prestito_scadenza: scadenzaStr,
    tag_rosa: 'PRESTITO - RIENTRO PROGRAMMATO',
  }).eq('id', playerId);

  await supabase.from('movimenti').insert([
    { squadra: squadraPaga,    descrizione: `Indennizzo rescissione prestito ${player.nome} (${Math.round(pct*100)}% Q reale)`, uscita: indennizzo, data: oggiStr },
    { squadra: squadraIncassa, descrizione: `Indennizzo rescissione prestito ${player.nome} (incasso)`, entrata: indennizzo, data: oggiStr },
  ]);

  return { indennizzo, squadraCedente, squadraRicevente, rientroProgrammatoIl: scadenzaStr };
}

// ── Tracciamento passaggi giocatore in sessione (art. 5.6) ────────────────────
// Max 3 squadre nella sessione: squadra iniziale conta come 1, quindi max 2 cambi.
// Il vivaio non conta mai come squadra: promozioni/acquisti vivaio non incrementano.
export async function checkEAggiornaPassaggi(giocatoreNome, squadraDestinazione, tipo, options = {}) {
  if (tipo === 'vivaio' || tipo === 'promozione_vivaio') return { ok: true, passaggi: 0, vivaio: true };

  const stagioneSessione = stagioneDaData(new Date());
  const { data: rows } = await supabase.from('rosa')
    .select('id,nome,squadra,passaggi_sessione,ultima_sessione_mercato,in_vivaio')
    .ilike('nome', giocatoreNome)
    .limit(1);
  const player = rows?.[0];
  if (!player || player.in_vivaio) return { ok: true, passaggi: 0 };

  const stessaSessione = player.ultima_sessione_mercato === stagioneSessione;
  const passaggi = stessaSessione ? Number(player.passaggi_sessione || 0) : 0;

  if (passaggi >= 2) {
    throw new Error(`${giocatoreNome} ha già raggiunto il limite di 3 squadre in questa sessione (art. 5.6).`);
  }

  if (options.soloControllo) return { ok: true, passaggi };

  await supabase.from('rosa').update({
    passaggi_sessione: passaggi + 1,
    ultima_sessione_mercato: stagioneSessione,
  }).eq('id', player.id);
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

function _rangeStagioneSvincoli(date = new Date()) {
  const y = date.getFullYear();
  const startYear = (date.getMonth() > 5 || (date.getMonth() === 5 && date.getDate() >= 1)) ? y : y - 1;
  return {
    start: `${startYear}-06-01`,
    end: `${startYear + 1}-05-31`,
  };
}

function _conteggiaSvincoliDaStorico(svincoli = []) {
  const ordinari = svincoli.filter(s => s.tipo === 'ordinario').length;
  const straord = svincoli.filter(s => ['straordinario', 'straordinario_u21'].includes(s.tipo));
  const estivi = straord.filter(s => {
    const m = new Date(s.data_svincolo).getMonth() + 1;
    return [6, 7, 8, 9].includes(m);
  }).length;
  const invernali = straord.filter(s => {
    const m = new Date(s.data_svincolo).getMonth() + 1;
    return [1, 2].includes(m);
  }).length;
  const countTotale = svincoli.filter(s => s.tipo !== 'straordinario_u21_nc').length;
  const history = svincoli
    .filter(s => s.tipo !== 'straordinario_u21_nc')
    .map(s => {
      const d = new Date(s.data_svincolo);
      const riacq = new Date(d);
      riacq.setDate(riacq.getDate() + 60);
      return {
        nome: s.giocatore || s.nome || s.player || '',
        tipo: s.tipo,
        data_svincolo: s.data_svincolo,
        riacquistabile_dal: riacq.toISOString().slice(0, 10),
      };
    });
  return {
    count_ordinari: ordinari,
    count_straord_estivi: estivi,
    count_straord_invernali: invernali,
    count_totale: countTotale,
    svincolati_history: history,
  };
}

export async function ricostruisciStagioneSvincoli(squadra) {
  const { start, end } = _rangeStagioneSvincoli();
  const { data, error } = await supabase
    .from('svincoli')
    .select('*')
    .eq('squadra', squadra)
    .gte('data_svincolo', start)
    .lte('data_svincolo', end)
    .order('data_svincolo', { ascending: true });
  if (error) throw error;
  return _conteggiaSvincoliDaStorico(data || []);
}

export async function getStagioneSvincoli(squadra) {
  const ricostruito = await ricostruisciStagioneSvincoli(squadra);

  const { data, error } = await supabase.from('stagione_svincoli').select('*').eq('squadra', squadra).limit(1);
  if (error) throw error;

  let record = data?.[0];
  if (!record) {
    const iniziale = { squadra, ...ricostruito };
    const { data: creato, error: insErr } = await supabase
      .from('stagione_svincoli')
      .insert(iniziale)
      .select()
      .single();
    if (insErr) throw insErr;
    return { ...creato, _ricostruito_da_storico: true };
  }

  const mismatch =
    Number(record.count_ordinari || 0) !== ricostruito.count_ordinari ||
    Number(record.count_straord_estivi || 0) !== ricostruito.count_straord_estivi ||
    Number(record.count_straord_invernali || 0) !== ricostruito.count_straord_invernali ||
    Number(record.count_totale || 0) !== ricostruito.count_totale;

  if (mismatch) {
    const { data: aggiornato, error: updErr } = await supabase
      .from('stagione_svincoli')
      .update({ ...ricostruito, updated_at: new Date().toISOString() })
      .eq('squadra', squadra)
      .select()
      .single();
    if (!updErr && aggiornato) return { ...aggiornato, _ricostruito_da_storico: true };
    return { ...record, ...ricostruito, _ricostruito_da_storico: true };
  }

  return record;
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

// ─── COSTANTI / DATE REGOLAMENTO ─────────────────────────────────────────────
export const SALARY_CAP = 75;

export function isMeseEsenteSalaryCap(date = new Date()) {
  const m = date.getMonth(); // 5=giugno, 6=luglio
  return m === 5 || m === 6;
}

export function getStatoMercatoRegolamento(date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  const min = date.getMinutes();
  const minutes = h * 60 + min;
  const inEstivo = (m === 6 && minutes >= 9 * 60) || (m > 6 && m < 9) || (m === 9 && d <= 15);
  const inInvernale = (m === 1 && minutes >= 9 * 60) || (m === 2 && d <= 15);
  return { aperto: inEstivo || inInvernale, periodo: inEstivo ? 'estivo' : inInvernale ? 'invernale' : null };
}

export function getProssimaAperturaMercato(date = new Date()) {
  const y = date.getFullYear();
  const candidates = [
    new Date(y, 0, 1, 9, 0, 0, 0),
    new Date(y, 5, 1, 9, 0, 0, 0),
    new Date(y + 1, 0, 1, 9, 0, 0, 0),
    new Date(y + 1, 5, 1, 9, 0, 0, 0),
  ].filter(d => d > date).sort((a,b) => a - b);
  return candidates[0];
}

function _numero(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _calcolaStipBaseDaQuotazione(quot) {
  return parseFloat((_numero(quot) / 5).toFixed(2));
}

function _calcolaClausolaRegolamento(quot) {
  return parseFloat((_numero(quot) * 1.75).toFixed(2));
}

function _scadenzaPrestitoRegolamento(mesi, dataInizio = new Date()) {
  const allowed = [6, 12, 18, 24];
  const durata = Number(mesi);
  if (!allowed.includes(durata)) throw new Error('Durata prestito non valida: sono ammessi solo 6, 12, 18 o 24 mesi.');
  const d = new Date(dataInizio);
  d.setMonth(d.getMonth() + durata);
  const year = d.getFullYear();
  const jan = new Date(year, 0, 1, 0, 0, 0, 0);
  const jun = new Date(year, 5, 1, 0, 0, 0, 0);
  const nextJan = new Date(year + 1, 0, 1, 0, 0, 0, 0);
  const candidates = [jan, jun, nextJan].filter(x => x >= d).sort((a,b) => a - b);
  return candidates[0].toISOString().slice(0, 10);
}

function _isScadenzaPrestitoValida(scadenza) {
  if (!scadenza) return false;
  const m = String(scadenza).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  return (m[2] === '01' && m[3] === '01') || (m[2] === '06' && m[3] === '01');
}

function _validazioneEconomicaTrattativa(t = {}) {
  const tipo = t.tipo || 'cessione';
  const prezzo = _numero(t.prezzo, 0);
  const quot = _numero(t.quot_giocatore ?? t.quota_giocatore ?? t.quot ?? t.quotazione, 0);
  const isPrestito = String(tipo).startsWith('prestito');

  if (['cessione', 'scambio'].includes(tipo) && quot > 0 && prezzo > 0 && prezzo < quot / 2) {
    throw new Error(`Offerta non valida: il minimo è ½ quotazione (${(quot / 2).toFixed(2)}M).`);
  }

  if (tipo === 'prestito_secco') {
    const min = quot * 0.10;
    if (quot > 0 && prezzo < min) throw new Error(`Prestito secco non valido: minimo 10% della quotazione (${min.toFixed(2)}M).`);
    if (prezzo <= 0) throw new Error('Non sono ammessi prestiti gratuiti.');
  }

  if (tipo === 'prestito_diritto' || tipo === 'prestito_obbligo') {
    const min = quot * 0.50;
    const max = quot * 1.50;
    if (quot > 0 && (prezzo < min || prezzo > max)) {
      throw new Error(`Prestito con riscatto non valido: costo tra ${min.toFixed(2)}M e ${max.toFixed(2)}M.`);
    }
    if (prezzo <= 0) throw new Error('Non sono ammessi prestiti gratuiti.');
    // Art. 5.7: l'oneroso pagato subito alla firma è ALMENO il 10% della
    // quotazione (come il prestito secco), ma non è fisso: le due parti
    // possono pattuirne uno più alto.
    const oneroso = _numero(t.oneroso, 0);
    const minOneroso = quot * 0.10;
    if (quot > 0 && oneroso < minOneroso) {
      throw new Error(`Oneroso non valido: minimo 10% della quotazione (${minOneroso.toFixed(2)}M).`);
    }
  }

  if (isPrestito) {
    if (t.durata_mesi && ![6,12,18,24].includes(Number(t.durata_mesi))) {
      throw new Error('Durata prestito non valida: sono ammessi solo 6, 12, 18 o 24 mesi.');
    }
    if (t.scadenza_prestito && !_isScadenzaPrestitoValida(t.scadenza_prestito)) {
      throw new Error('Scadenza prestito non valida: deve essere 01/01 o 01/06.');
    }
  }
}

function _isClausolaAttivabile(t = {}) {
  const rifiuti = Number(t.n_rifiuti || t.rifiuti || t.controffertate || 0);
  if (rifiuti >= 2) return true;
  const start = t.prima_offerta_at || t.created_at || t.data_offerta;
  if (!start) return false;
  return (new Date() - new Date(start)) >= 48 * 3600000;
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

  if (player.in_prestito) {
    throw new Error(`${player.nome} è attualmente in prestito: non può essere svincolato finché non rientra alla squadra originale o viene riscattato.`);
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
    // Indennizzo: ½ quot (o ¾ se estero) — art. 6.1
    indennizzo = estero
      ? parseFloat((quot * 0.75).toFixed(2))
      : parseFloat((quot * 0.5).toFixed(2));

    // Rimborso delle mensilità già pagate nella stagione: 01/07, 01/08, ..., fino alla data di svincolo.
    // Se il giocatore è stato acquisito a mercato aperto durante la stagione corrente
    // (data_acquisto dopo l'01/06), vanno rimborsate SOLO le mensilità pagate da questa
    // squadra da quando lo possiede — non quelle già pagate dal venditore prima della cessione.
    mesiRimborsati = _contaMensilitaGiaPagate(oggi);
    if (player.data_acquisto) {
      const acquistatoIl = new Date(`${player.data_acquisto}T00:00:00`);
      const inizioStagione = new Date(stagioneStartYear(oggi), 5, 1);
      if (acquistatoIl > inizioStagione) {
        const mesiPagatiAllAcquisto = _contaMensilitaGiaPagate(acquistatoIl);
        mesiRimborsati = Math.max(0, mesiRimborsati - mesiPagatiAllAcquisto);
      }
    }
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
  // IMPORTANTE: controlliamo l'errore. Se questa scrittura fallisce NON dobbiamo
  // procedere a cancellare il giocatore dalla rosa, altrimenti il giocatore
  // sparisce del tutto (né in rosa, né tra gli svincolati).
  let svincErr = null;
  try {
    await upsertSvincolatoSafe({
      nome: player.nome,
      ruolo: player.ruolo,
      anni: player.anni || 0,
      quot: player.quot || 0,
      stip: player.stip || 0,
      clausola: parseFloat(((player.quot || 0) * 1.75).toFixed(2)),
      fuori_lista: player.fuori_lista || false,
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
    }, stagioneDaData(oggi));
  } catch (e) { svincErr = e; }

  if (svincErr) {
    console.error('eseguiSvincolo: scrittura in svincolati fallita, ANNULLO lo svincolo per evitare di perdere il giocatore:', player.nome, svincErr);
    throw new Error(`Impossibile completare lo svincolo di ${player.nome}: errore nel salvataggio tra gli svincolati (${svincErr.message || svincErr.code || 'errore sconosciuto'}). Il giocatore è rimasto in rosa, nessuna modifica è stata applicata.`);
  }

  // ── 2. Rimuovi dalla rosa ─────────────────────────────────────────────────
  const { error: delErr } = await supabase.from('rosa').delete().eq('id', player.id);
  if (delErr) {
    console.error('eseguiSvincolo: cancellazione dalla rosa fallita dopo aver già scritto tra gli svincolati:', player.nome, delErr);
    throw new Error(`${player.nome} è stato salvato tra gli svincolati ma non è stato possibile rimuoverlo dalla rosa (${delErr.message || delErr.code || 'errore sconosciuto'}). Controlla manualmente per evitare un doppione.`);
  }

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
// art. 7.1 + 7.1.2: tassa sempre attiva. Di default (modalitaOverride='auto') il
// flat 1% scatta automaticamente giu-lug (art. 7.1.2); un admin può però forzare
// manualmente 'flat' o 'scaglioni' in qualsiasi momento dalla Control Room,
// bypassando il calendario.
export function calcolaTassa(bilancio, modalitaOverride = 'auto') {
  if (bilancio <= 0) return { perc: 0, importo: 0 };
  let isPeriodoFlat;
  if (modalitaOverride === 'flat') isPeriodoFlat = true;
  else if (modalitaOverride === 'scaglioni') isPeriodoFlat = false;
  else {
    const m = new Date().getMonth(); // 0-based
    isPeriodoFlat = m === 5 || m === 6; // giu(5), lug(6) — art. 7.1.2: flat 1% solo dal 01/06 al 01/08
  }
  if (isPeriodoFlat) return { perc: 1, importo: parseFloat((bilancio * 0.01).toFixed(2)), flat: true };
  if (bilancio <= 20)  return { perc: 1,  importo: parseFloat((bilancio * 0.01).toFixed(2)) };
  if (bilancio <= 40)  return { perc: 2,  importo: parseFloat((bilancio * 0.02).toFixed(2)) };
  if (bilancio <= 60)  return { perc: 3,  importo: parseFloat((bilancio * 0.03).toFixed(2)) };
  if (bilancio <= 80)  return { perc: 5,  importo: parseFloat((bilancio * 0.05).toFixed(2)) };
  if (bilancio <= 100) return { perc: 8,  importo: parseFloat((bilancio * 0.08).toFixed(2)) };
  return               { perc: 10, importo: parseFloat((bilancio * 0.10).toFixed(2)) };
}

// 'auto' (default, calendario giu-lug) | 'flat' (forza 1% sempre) | 'scaglioni' (forza scaglioni sempre)
export async function getModalitaTassazione() {
  const { data } = await supabase.from('impostazioni').select('valore').eq('chiave', 'modalita_tassazione').limit(1);
  return data?.[0]?.valore || 'auto';
}
export async function setModalitaTassazione(valore) {
  await supabase.from('impostazioni').upsert({ chiave: 'modalita_tassazione', valore }, { onConflict: 'chiave' });
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
export async function applicaTassaSettimana(squadra, bilancioCorrente, dataControllo = null, settimanaLabel = null, modalitaOverride = 'auto') {
  const { perc, importo, flat } = calcolaTassa(bilancioCorrente, modalitaOverride);
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
    ? `Tassa settimanale 1% flat (bilancio ${bilancioCorrente.toFixed(2)}M) settimana ${wLabel}${modalitaOverride === 'flat' ? ' [flat impostata da admin]' : ''}`
    : `Tassa settimanale ${perc}% (bilancio ${bilancioCorrente.toFixed(2)}M) settimana ${wLabel}${modalitaOverride === 'scaglioni' ? ' [scaglioni impostati da admin]' : ''}`;
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

function getMeseCorrenteRange() {
  const d = new Date();
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { start, end, meseISO: start.slice(0, 7) };
}

function isPagamentoStipendiDescrizione(descrizione = '') {
  const d = String(descrizione || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // Deve riconoscere tutti i formati storici/manuali usati nei movimenti:
  // - "Pagamento stipendi 2026-07"
  // - "Pagamento stipendi luglio 2026"
  // - "Stipendi mensili (luglio)"
  // - "Stipendi mensili luglio"
  // - "Stipendi luglio 2026"
  // Dal 1° del mese successivo lo stato torna da pagare perché il filtro data
  // di getControlRoomStatus/applicaStipendioATutti usa sempre il mese corrente.
  return (
    d.startsWith('pagamento stipendi') ||
    d.startsWith('paga stipendi') ||
    d.startsWith('stipendi mensili') ||
    d.startsWith('stipendio mensile') ||
    d === 'stipendi' ||
    /^stipendi(\s|\(|$)/.test(d)
  );
}

function isEntrateStadioDescrizione(descrizione = '') {
  const d = String(descrizione || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  return (
    d.startsWith('entrate stadio') ||
    d.startsWith('entrata stadio') ||
    d.startsWith('guadagno stadio') ||
    d.startsWith('stadio mensile') ||
    d.includes('guadagno mensile stadio')
  );
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
  try {
    const rientri = await processaRientriPrestitoProgrammato();
    if (rientri?.length) results.prestitiProgrammato = rientri;
  } catch(e) { results.errori.push(`Rientri prestito programmati: ${e.message}`); }

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
        // Controlla se gli stipendi sono già stati pagati in qualunque formato nel mese corrente.
        const stipDesc = `Pagamento stipendi ${meseISO}`;
        const { start: meseStartAuto, end: meseEndAuto } = getMeseCorrenteRange();
        const { data: gia } = await supabase
          .from('movimenti')
          .select('id, descrizione, data')
          .eq('squadra', sq.name)
          .gte('data', meseStartAuto)
          .lt('data', meseEndAuto);
        if ((gia || []).some(m => isPagamentoStipendiDescrizione(m.descrizione))) continue;

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
        const { start: meseStartStadio, end: meseEndStadio } = getMeseCorrenteRange();
        const { data: giaStadio } = await supabase
          .from('movimenti')
          .select('id, descrizione, data')
          .eq('squadra', sq.name)
          .gte('data', meseStartStadio)
          .lt('data', meseEndStadio);
        if ((giaStadio || []).some(m => isEntrateStadioDescrizione(m.descrizione))) continue;

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

export async function getAllenatori(stagione = getStagioneQuota()) {
  const { data, error } = await supabase.from('allenatori_carte')
    .select('*').eq('stagione', stagione).order('nome');
  if (error) return [];
  return data;
}

export async function getAllenatoreBySquadra(squadra, stagione = getStagioneQuota()) {
  const { data } = await supabase.from('allenatori_carte')
    .select('*').eq('squadra', squadra).eq('stagione', stagione).limit(1);
  return data?.[0] ?? null;
}

export async function getObiettiviCarta(allenatore, stagione = getStagioneQuota()) {
  const { data, error } = await supabase.from('obiettivi_carte')
    .select('*').eq('allenatore', allenatore).eq('stagione', stagione).order('ordine');
  if (error) return [];
  return data;
}

export async function getProgressoObiettivi(squadra, stagione = getStagioneQuota()) {
  const { data, error } = await supabase.from('progresso_obiettivi')
    .select('*, obiettivi_carte(*)').eq('squadra', squadra).eq('stagione', stagione);
  if (error) return [];
  return data;
}

function _fineCampionatoObiettivi(stagione = getStagioneQuota()) {
  const startYear = Number(String(stagione).slice(0, 4)) || new Date().getFullYear();
  return `${startYear + 1}-05-31`;
}

function _oggiISO() {
  return new Date().toISOString().slice(0, 10);
}

function _isObiettivoFinale(tipo) {
  return ['ds', 'dg'].includes(String(tipo || '').toLowerCase());
}

async function _getObiettivoCartaById(obiettivoId) {
  const { data, error } = await supabase.from('obiettivi_carte').select('*').eq('id', obiettivoId).single();
  if (error) throw error;
  return data;
}

async function _getBilancioSquadra(squadra) {
  const { data, error } = await supabase.from('squadre').select('bilancio, guad_obiettivi, sc_bonus_obiettivi').eq('name', squadra).single();
  if (error) throw error;
  return data || { bilancio: 0, guad_obiettivi: 0, sc_bonus_obiettivi: 0 };
}

async function _applicaMovimentoObiettivo({ squadra, obiettivo, importo, descrizione, data = _oggiISO() }) {
  const sq = await _getBilancioSquadra(squadra);
  const nuovoBilancio = parseFloat((Number(sq.bilancio || 0) + Number(importo || 0)).toFixed(2));
  const nuovoGuadObiettivi = parseFloat((Number(sq.guad_obiettivi || 0) + Number(importo || 0)).toFixed(2));
  const updateFields = { bilancio: nuovoBilancio, guad_obiettivi: nuovoGuadObiettivi };
  // Art. 9.4: ogni obiettivo allenatore completato dà anche +1M al limite salary cap.
  if (importo > 0 && String(obiettivo.tipo || '').toLowerCase() === 'allenatore') {
    updateFields.sc_bonus_obiettivi = parseFloat((Number(sq.sc_bonus_obiettivi || 0) + 1).toFixed(2));
  }
  await supabase.from('squadre').update(updateFields).eq('name', squadra);
  await supabase.from('movimenti').insert({
    squadra,
    descrizione,
    entrata: importo > 0 ? Number(importo) : null,
    uscita: importo < 0 ? Math.abs(Number(importo)) : null,
    data,
  });
  return nuovoBilancio;
}

export async function upsertProgresso(squadra, obiettivoId, fields, stagione = getStagioneQuota()) {
  const obiettivo = await _getObiettivoCartaById(obiettivoId);
  const tipo = String(obiettivo.tipo || '').toLowerCase();
  const completato = Boolean(fields.completato);
  const fallito = Boolean(fields.fallito);
  const finale = _isObiettivoFinale(tipo);
  const fineCampionato = _fineCampionatoObiettivi(stagione);

  const payload = {
    squadra,
    obiettivo_id: obiettivoId,
    stagione,
    ...fields,
  };

  if (completato) {
    payload.fallito = false;
    payload.completato_il = payload.completato_il || _oggiISO();
    payload.incassabile_il = finale ? fineCampionato : _oggiISO();
  }
  if (fallito) {
    payload.completato = false;
    payload.fallito_il = payload.fallito_il || _oggiISO();
  }
  if (fields.completato === false) {
    payload.incassato = false;
    payload.incassato_il = null;
    payload.incassabile_il = null;
  }
  if (fields.fallito === false) {
    payload.malus_applicato = false;
    payload.malus_applicato_il = null;
  }

  const { error } = await supabase.from('progresso_obiettivi').upsert(payload, { onConflict: 'squadra,obiettivo_id,stagione' });
  if (error) throw error;

  // Obiettivi allenatore: il premio è incassabile subito al completamento.
  // DS/DG: restano completati ma incassabili solo dal 31/05.
  if (completato && !finale) {
    await incassaObiettivo(squadra, obiettivoId, stagione);
  }

  // DS/DG falliti: applica subito il malus economico una sola volta.
  if (fallito && finale && Number(obiettivo.penalita || 0) > 0) {
    await applicaMalusObiettivo(squadra, obiettivoId, stagione);
  }
}

export async function incassaObiettivo(squadra, obiettivoId, stagione = getStagioneQuota()) {
  const obiettivo = await _getObiettivoCartaById(obiettivoId);
  const { data: prog, error: progErr } = await supabase.from('progresso_obiettivi')
    .select('*').eq('squadra', squadra).eq('obiettivo_id', obiettivoId).eq('stagione', stagione).single();
  if (progErr) throw progErr;
  if (!prog?.completato) throw new Error('Obiettivo non completato.');
  if (prog.incassato) return { giaIncassato: true };

  const tipo = String(obiettivo.tipo || '').toLowerCase();
  const finale = _isObiettivoFinale(tipo);
  const incassabileIl = prog.incassabile_il || (finale ? _fineCampionatoObiettivi(stagione) : _oggiISO());
  if (finale && _oggiISO() < incassabileIl) {
    throw new Error(`Gli obiettivi DS/DG sono incassabili dal ${incassabileIl}.`);
  }

  const importo = Number(obiettivo.guadagno || (finale ? 5 : 2));
  if (importo <= 0) throw new Error('Questo obiettivo non ha un premio economico configurato.');
  await _applicaMovimentoObiettivo({
    squadra,
    obiettivo,
    importo,
    descrizione: `Premio obiettivo ${tipo.toUpperCase()}: ${obiettivo.testo || obiettivo.nome || 'obiettivo'}`,
    data: _oggiISO(),
  });
  const { error } = await supabase.from('progresso_obiettivi').update({ incassato: true, incassato_il: _oggiISO() })
    .eq('squadra', squadra).eq('obiettivo_id', obiettivoId).eq('stagione', stagione);
  if (error) throw error;
  return { incassato: true, importo };
}

export async function applicaMalusObiettivo(squadra, obiettivoId, stagione = getStagioneQuota()) {
  const obiettivo = await _getObiettivoCartaById(obiettivoId);
  const { data: prog, error: progErr } = await supabase.from('progresso_obiettivi')
    .select('*').eq('squadra', squadra).eq('obiettivo_id', obiettivoId).eq('stagione', stagione).single();
  if (progErr) throw progErr;
  if (!prog?.fallito) throw new Error('Obiettivo non segnato come fallito.');
  if (prog.malus_applicato) return { giaApplicato: true };
  const importo = Number(obiettivo.penalita || 0);
  if (importo <= 0) return { nessunMalus: true };
  await _applicaMovimentoObiettivo({
    squadra,
    obiettivo,
    importo: -importo,
    descrizione: `Malus obiettivo ${String(obiettivo.tipo || '').toUpperCase()}: ${obiettivo.testo || obiettivo.nome || 'obiettivo'}`,
    data: _oggiISO(),
  });
  const { error } = await supabase.from('progresso_obiettivi').update({ malus_applicato: true, malus_applicato_il: _oggiISO() })
    .eq('squadra', squadra).eq('obiettivo_id', obiettivoId).eq('stagione', stagione);
  if (error) throw error;
  return { applicato: true, importo };
}

export async function incassaObiettiviFinali(squadra, stagione = getStagioneQuota()) {
  const fine = _fineCampionatoObiettivi(stagione);
  if (_oggiISO() < fine) throw new Error(`Gli obiettivi DS/DG sono incassabili dal ${fine}.`);
  const { data, error } = await supabase.from('progresso_obiettivi')
    .select('*, obiettivi_carte(*)')
    .eq('squadra', squadra).eq('stagione', stagione).eq('completato', true).eq('incassato', false);
  if (error) throw error;
  let tot = 0;
  for (const p of data || []) {
    const tipo = String(p.obiettivi_carte?.tipo || '').toLowerCase();
    if (!_isObiettivoFinale(tipo)) continue;
    const res = await incassaObiettivo(squadra, p.obiettivo_id, stagione);
    tot += Number(res.importo || 0);
  }
  return { totale: parseFloat(tot.toFixed(2)) };
}

export async function getModuloTracker(squadra, stagione = getStagioneQuota()) {
  const { data, error } = await supabase.from('moduli_allenatore_tracker')
    .select('*').eq('squadra', squadra).eq('stagione', stagione).order('giornata');
  if (error) return [];
  return data || [];
}

export async function upsertModuloTracker(squadra, giornata, modulo, stagione = getStagioneQuota()) {
  const { error } = await supabase.from('moduli_allenatore_tracker').upsert({
    squadra,
    stagione,
    giornata: Number(giornata),
    modulo: String(modulo || '').trim(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'squadra,stagione,giornata' });
  if (error) throw error;
}

export async function deleteModuloTracker(squadra, giornata, stagione = getStagioneQuota()) {
  const { error } = await supabase.from('moduli_allenatore_tracker')
    .delete().eq('squadra', squadra).eq('stagione', stagione).eq('giornata', Number(giornata));
  if (error) throw error;
}

export function conteggioModuliAllenatore(rows = [], allenatore = null) {
  const m1 = allenatore?.modulo1;
  const m2 = allenatore?.modulo2;
  const validi = rows.filter(r => r.modulo && (r.modulo === m1 || r.modulo === m2));
  return { validi: validi.length, totale: rows.filter(r => r.modulo).length, richiesti: 27, ok: validi.length >= 27 };
}

export async function scegliAllenatore(squadra, nomeAllenatore, bilancioAttuale) {
  // 1. Assegna la carta alla squadra
  await supabase.from('allenatori_carte').update({ squadra }).eq('nome', nomeAllenatore);
  // 2. Scala 5M dal bilancio (costo carta)
  const nuovoBilancio = parseFloat((bilancioAttuale - 5).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  // 3. Movimento (escluso dal FPF: la scelta della carta allenatore non deve
  //    gravare sul netto speso del semestre, resta solo un costo a bilancio)
  await supabase.from('movimenti').insert({
    squadra, descrizione: `[~FPF] Scelta carta allenatore: ${nomeAllenatore}`,
    uscita: 5, data: new Date().toISOString().slice(0, 10),
  });
  await sendTelegramNotification('scelta_allenatore', { squadra, nomeAllenatore });
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

const MAX_INVESTIMENTI_STAGIONE = 30;
const MAX_INVESTIMENTI_INVERNALI = 10;

function _stagioneStartFromLabel(stagione = getStagioneQuota(new Date())) {
  const m = String(stagione || '').match(/^(\d{4})/);
  return m ? Number(m[1]) : stagioneStartYear(new Date());
}
function _inRangeDateTime(date, start, end) {
  return date >= start && date <= end;
}
export function isFinestraInvestimentiEstiva(date = new Date()) {
  const start = stagioneStartYear(date);
  return _inRangeDateTime(date, new Date(start, 7, 1, 9, 0, 0, 0), new Date(start, 8, 20, 23, 59, 59, 999));
}
export function isFinestraInvestimentiInvernale(date = new Date()) {
  const y = date.getFullYear();
  return _inRangeDateTime(date, new Date(y, 11, 24, 0, 0, 0, 0), new Date(y, 11, 31, 23, 59, 59, 999));
}
async function _getInvestimentiStagione(squadra, stagione) {
  const { data } = await supabase.from('investimenti').select('*').eq('squadra', squadra).eq('stagione', stagione);
  return data || [];
}
async function _hasInvestimentoAttivo(squadra, nome, { stagione = getStagioneQuota(new Date()), date = new Date(), includePrecedenti = false } = {}) {
  let q = supabase.from('investimenti').select('*').eq('squadra', squadra).eq('nome', nome).eq('attivo', true);
  if (!includePrecedenti) q = q.eq('stagione', stagione);
  const { data } = await q;
  if (!data?.length) return false;
  if (nome === 'Clausola Segreta' || nome === 'Deroga U-21') {
    const start = stagioneStartYear(date);
    const fine = new Date(start + 1, 5, 1, 0, 0, 0, 0); // 01/06 successivo
    return date < fine;
  }
  return true;
}
async function _getVivaioLimit(squadra, date = new Date()) {
  const stagione = getStagioneQuota(date);
  const currentStart = _stagioneStartFromLabel(stagione);
  const { data } = await supabase.from('investimenti')
    .select('stagione')
    .eq('squadra', squadra)
    .eq('nome', 'Settore Giovanile Avanzato')
    .eq('attivo', true);
  const active = (data || []).some(inv => {
    const invStart = _stagioneStartFromLabel(inv.stagione);
    return currentStart >= invStart + 1 && currentStart <= invStart + 2;
  });
  return active ? 4 : 2;
}
async function _getU21RichiestiConDeroga(squadra, totale, date = new Date()) {
  const deroga = await _hasInvestimentoAttivo(squadra, 'Deroga U-21', { stagione: getStagioneQuota(date), date });
  if (deroga && totale >= 28) return 1;
  return totale >= 30 ? 3 : totale === 29 ? 2 : totale === 28 ? 1 : 0;
}
async function _getSalaryCapInvestimenti(squadra, stagione = getStagioneQuota(new Date())) {
  const hasSuperClub = await _hasInvestimentoAttivo(squadra, 'SuperClub', { stagione });
  return hasSuperClub ? 3 : 0;
}

// Tutte le squadre con SuperClub attivo in una sola query, per le pagine di
// overview multi-squadra (evita N query, una per squadra).
export async function getSquadreConSuperClub(stagione = getStagioneQuota(new Date())) {
  const { data } = await supabase.from('investimenti')
    .select('squadra').eq('nome', 'SuperClub').eq('attivo', true).eq('stagione', stagione);
  return new Set((data || []).map(r => r.squadra));
}
async function _calcolaClausolaPerSquadra(squadra, quot, date = new Date()) {
  const segreta = await _hasInvestimentoAttivo(squadra, 'Clausola Segreta', { stagione: getStagioneQuota(date), date });
  const moltiplicatore = segreta ? 2.0 : 1.75;
  return parseFloat((Number(quot || 0) * moltiplicatore).toFixed(2));
}
export async function getEffettiInvestimenti(squadra, stagione = getStagioneQuota(new Date())) {
  const date = new Date();
  const [vivaioLimit, scBonusInvestimenti, derogaU21, clausolaSegreta] = await Promise.all([
    _getVivaioLimit(squadra, date),
    _getSalaryCapInvestimenti(squadra, stagione),
    _hasInvestimentoAttivo(squadra, 'Deroga U-21', { stagione, date }),
    _hasInvestimentoAttivo(squadra, 'Clausola Segreta', { stagione, date }),
  ]);
  return { vivaioLimit, scBonusInvestimenti, derogaU21, clausolaSegreta, clausolaMoltiplicatore: clausolaSegreta ? 2.0 : 1.75 };
}

export async function getInvestimenti(squadra, stagione = getStagioneQuota(new Date())) {
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

// Acquista un investimento: valida finestre/budget, scala il costo dal bilancio, inserisce movimento e record
export async function acquistaInvestimento({ squadra, nome, categoria, costo, stagione = getStagioneQuota(new Date()), dati = {}, note = '', forceAdmin = false }) {
  const now = new Date();
  const oggi = isoDateLocal(now);
  const costoNum = Number(costo || 0);
  const isInvernale = categoria === 'invernale';

  if (!forceAdmin) {
    if (isInvernale && !isFinestraInvestimentiInvernale(now)) {
      throw new Error('Investimenti invernali consentiti solo dal 24/12 al 31/12.');
    }
    if (!isInvernale && !isFinestraInvestimentiEstiva(now)) {
      throw new Error('Investimenti estivi consentiti solo dal 01/08 alle 09:00 al 20/09 alle 23:59.');
    }
  }

  const invStagione = await _getInvestimentiStagione(squadra, stagione);
  const totaleStagione = invStagione.reduce((s, i) => s + Number(i.costo || 0), 0);
  const totaleInvernale = invStagione.filter(i => i.categoria === 'invernale').reduce((s, i) => s + Number(i.costo || 0), 0);
  if (!forceAdmin && totaleStagione + costoNum > MAX_INVESTIMENTI_STAGIONE) {
    throw new Error(`Budget investimenti superato: ${totaleStagione.toFixed(1)}M/${MAX_INVESTIMENTI_STAGIONE}M già usati.`);
  }
  if (!forceAdmin && isInvernale && totaleInvernale + costoNum > MAX_INVESTIMENTI_INVERNALI) {
    throw new Error(`Budget investimenti invernali superato: ${totaleInvernale.toFixed(1)}M/${MAX_INVESTIMENTI_INVERNALI}M già usati.`);
  }

  // Investimenti non ripetibili nella stessa stagione.
  if (invStagione.some(i => i.nome === nome && i.attivo !== false)) {
    throw new Error(`Investimento già attivo in questa stagione: ${nome}.`);
  }

  // Ristrutturazione Stadio: devono passare 3 anni prima di ripeterla.
  if (nome === 'Ristrutturazione Stadio') {
    const currentStart = _stagioneStartFromLabel(stagione);
    const { data: precedenti } = await supabase.from('investimenti')
      .select('stagione')
      .eq('squadra', squadra)
      .eq('nome', 'Ristrutturazione Stadio');
    const troppoRecente = (precedenti || []).some(i => currentStart - _stagioneStartFromLabel(i.stagione) < 3);
    if (!forceAdmin && troppoRecente) throw new Error('Ristrutturazione Stadio ripetibile solo dopo 3 anni.');
  }

  // Ricapitalizzazione: limite specifico 05/09.
  if (!forceAdmin && nome === 'Ricapitalizzazione') {
    const start = stagioneStartYear(now);
    if (now > new Date(start, 8, 5, 23, 59, 59, 999)) throw new Error('Ricapitalizzazione attivabile solo entro il 05/09.');
  }

  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  if (Number(sq?.bilancio || 0) < costoNum) throw new Error('Bilancio insufficiente per acquistare questo investimento.');
  const nuovoBilancio = parseFloat((Number(sq?.bilancio || 0) - costoNum).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);

  await supabase.from('movimenti').insert({
    squadra, descrizione: `Investimento: ${nome}`,
    uscita: costoNum, data: oggi,
  });

  const datiFinali = { ...(dati || {}) };
  if (nome === 'Settore Giovanile Avanzato') datiFinali.effetto = 'vivaio_limit_4_prossime_2_stagioni';
  if (nome === 'SuperClub') datiFinali.effetto = '+3M salary cap stagione';
  if (nome === 'Deroga U-21') datiFinali.effetto = 'rosa_30_con_1_u21_fino_01_06';
  if (nome === 'Clausola Segreta') datiFinali.effetto = 'clausola_2x_fino_31_05';

  const inv = await insertInvestimento({ squadra, nome, categoria, costo: costoNum, stagione, dati: datiFinali, note, data_acquisto: oggi, attivo: true });

  // Effetti immediati o agganciati a regole già presenti.
  if (nome === 'Clausola Segreta') {
    const { data: rosa } = await supabase.from('rosa').select('id, quot').eq('squadra', squadra).eq('in_vivaio', false);
    for (const p of rosa || []) {
      await supabase.from('rosa').update({ clausola: parseFloat((Number(p.quot || 0) * 2).toFixed(2)) }).eq('id', p.id);
    }
  }

  // Ricapitalizzazione: effetto immediato tracciato nei movimenti FPF come entrata specifica.
  if (nome === 'Ricapitalizzazione') {
    await supabase.from('movimenti').insert({ squadra, descrizione: 'Ricapitalizzazione investimento — riduzione FPF', entrata: 3, data: oggi });
  }

  await sendTelegramNotification('investimento_acquistato', { squadra, nome, costo: costoNum.toFixed(1) });

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


export async function aggiornaTrackerInvestimento(id, voce) {
  const { data: inv, error } = await supabase.from('investimenti').select('dati').eq('id', id).single();
  if (error) throw error;
  const dati = inv?.dati || {};
  const tracker = Array.isArray(dati.tracker) ? dati.tracker : [];
  tracker.push({ ...voce, data: new Date().toISOString() });
  const { error: updErr } = await supabase.from('investimenti').update({ dati: { ...dati, tracker } }).eq('id', id);
  if (updErr) throw updErr;
  return tracker;
}

// ─── SPONSOR ─────────────────────────────────────────────────────────────────

export async function getSponsor(squadra, stagione = getStagioneQuota()) {
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
export async function countRecidive(squadra, codiceTipo, stagione = getStagioneQuota()) {
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

  const { data: sq, error } = await supabase
    .from('squadre')
    .select('*')
    .eq('name', squadra)
    .single();
  if (error || !sq) throw error || new Error('Squadra non trovata');

  // Tetto biennale: normalmente MAX_EURO_EXTRA_BIENNIO (10€), ma può essere
  // personalizzato per singola squadra dalla Control Room (es. sanzioni/deroghe).
  const maxBiennio = (sq.max_euro_biennio !== null && sq.max_euro_biennio !== undefined)
    ? Number(sq.max_euro_biennio) : MAX_EURO_EXTRA_BIENNIO;

  const euro = Number(euroAggiuntivi);
  if (!Number.isFinite(euro) || euro <= 0 || euro > maxBiennio) throw new Error(`Importo non valido (1-${maxBiennio}€)`);

  // Se il DB è ancora al biennio vecchio, il conteggio biennale riparte da 0.
  const biennioCambiato = sq.biennio && sq.biennio !== biennio;
  const euroBiennioAttuale = biennioCambiato ? 0 : Number(sq.euro_biennio || 0);
  const euroStagioneAttuale = sq.extra_stagione && sq.extra_stagione !== stagione ? 0 : Number(sq.euro_investiti || 0);
  const maxDisponibili = Math.max(0, maxBiennio - euroBiennioAttuale);
  if (euro > maxDisponibili) throw new Error(`Puoi investire al massimo ${maxDisponibili}€ nel biennio ${biennio}`);

  const mlnGuadagnati = parseFloat((euro * CAMBIO_EURO_MLN).toFixed(2));
  const oggi = isoDateLocal(now);

  // Dettaglio per-stagione (per la Control Room): quanto investito in ciascuna delle
  // due stagioni del biennio corrente. Si azzera quando cambia il biennio.
  const stagioniPrec = biennioCambiato ? {} : (sq.euro_biennio_stagioni || {});
  const euroBiennioStagioni = { ...stagioniPrec, [stagione]: Number(stagioniPrec[stagione] || 0) + euro };

  await safeUpdateSquadraQuote(
    squadra,
    {
      bilancio: parseFloat((Number(sq.bilancio || 0) + mlnGuadagnati).toFixed(2)),
      euro_investiti: euroStagioneAttuale + euro,
      euro_biennio: euroBiennioAttuale + euro,
      euro_biennio_stagioni: euroBiennioStagioni,
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

// Correzione manuale admin dei campi budget extra (euro investiti stagione, euro
// cumulativi nel biennio, dettaglio per singola stagione del biennio, tetto biennale
// personalizzato, mln extra sbloccati). Usata dalla Control Room quando un valore
// risulta sbagliato rispetto al ledger reale (es. un versamento della stagione
// precedente non correttamente riportato nel nuovo biennio).
export async function aggiornaBudgetExtraSquadra(squadra, { euroInvestiti, euroBiennio, mlnExtra, euroBiennioStagioni, maxEuroBiennio } = {}) {
  const fields = {};
  if (euroInvestiti !== undefined && euroInvestiti !== null) fields.euro_investiti = Math.max(0, Number(euroInvestiti) || 0);
  if (mlnExtra !== undefined && mlnExtra !== null) fields.mln_extra = Math.max(0, Number(mlnExtra) || 0);
  if (maxEuroBiennio !== undefined) fields.max_euro_biennio = maxEuroBiennio === null ? null : Math.max(0, Number(maxEuroBiennio) || 0);

  if (euroBiennioStagioni !== undefined && euroBiennioStagioni !== null) {
    // Il dettaglio per-stagione è la fonte di verità: il totale del biennio viene
    // sempre ricalcolato come somma delle sue stagioni, così i due valori non
    // possono mai disallinearsi.
    const clean = {};
    for (const [stag, val] of Object.entries(euroBiennioStagioni)) clean[stag] = Math.max(0, Number(val) || 0);
    fields.euro_biennio_stagioni = clean;
    fields.euro_biennio = Object.values(clean).reduce((a, b) => a + b, 0);
  } else if (euroBiennio !== undefined && euroBiennio !== null) {
    fields.euro_biennio = Math.max(0, Number(euroBiennio) || 0);
  }

  if (!Object.keys(fields).length) return;
  fields.updated_at = new Date().toISOString();

  const { error } = await supabase.from('squadre').update(fields).eq('name', squadra);
  if (error) {
    // Fallback se la migrazione (euro_biennio_stagioni / max_euro_biennio) non è
    // ancora stata eseguita sul DB: riprova senza i campi nuovi.
    const msg = (error.message || '').toLowerCase();
    const schemaError = msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find');
    if (!schemaError) throw error;
    const { euro_biennio_stagioni, max_euro_biennio, ...rest } = fields;
    if (!Object.keys(rest).length) throw error;
    const { error: retryErr } = await supabase.from('squadre').update(rest).eq('name', squadra);
    if (retryErr) throw retryErr;
  }
}

// Reset biennio (ogni 2 anni). Viene anche applicato automaticamente da sincronizzaQuoteStagione.
export async function resetBiennio(squadra, nuovoBiennio = getBiennioQuota(new Date())) {
  await safeUpdateSquadraQuote(
    squadra,
    { euro_biennio: 0, euro_investiti: 0, mln_extra: 0, euro_biennio_stagioni: {}, biennio: nuovoBiennio, extra_stagione: getStagioneQuota(new Date()), updated_at: new Date().toISOString() },
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
      // I mln extra di salary cap dagli obiettivi allenatore completati valgono solo
      // per la stagione in cui sono stati guadagnati: si azzerano al cambio stagione.
      patch.sc_bonus_obiettivi = 0;
      fallback.sc_bonus_obiettivi = 0;
    }
    if (!sq.biennio || sq.biennio !== biennio) {
      patch.biennio = biennio;
      patch.euro_biennio = 0;
      patch.euro_biennio_stagioni = {};
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

// Stato iscrizione campionato per tutte le squadre nella stagione indicata,
// incluso il conteggio dei movimenti "Iscrizione campionato" effettivamente
// registrati per ciascuna (per scoprire pagamenti duplicati).
export async function getStatoIscrizioneTutte(stagione = getStagioneQuota()) {
  const [{ data: squadre }, { data: movimenti }] = await Promise.all([
    supabase.from('squadre').select('name, bilancio, iscrizione_pagata, iscrizione_stagione_pagata, iscrizione_pagata_il'),
    supabase.from('movimenti').select('id, squadra, uscita, data, descrizione').ilike('descrizione', `Iscrizione campionato ${stagione}%`),
  ]);
  const bySquadra = new Map();
  for (const m of (movimenti || [])) {
    if (!bySquadra.has(m.squadra)) bySquadra.set(m.squadra, []);
    bySquadra.get(m.squadra).push(m);
  }
  return (squadre || []).map(sq => {
    const movs = bySquadra.get(sq.name) || [];
    return {
      squadra: sq.name,
      pagata: sq.iscrizione_stagione_pagata === stagione || (!sq.iscrizione_stagione_pagata && sq.iscrizione_pagata === true),
      pagataIl: sq.iscrizione_pagata_il,
      nMovimenti: movs.length,
      totaleAddebitato: parseFloat(movs.reduce((a, m) => a + Number(m.uscita || 0), 0).toFixed(2)),
      duplicato: movs.length > 1,
    };
  });
}

// Rimuove l'iscrizione campionato da TUTTE le squadre per la stagione indicata:
// rimborsa quanto effettivamente addebitato (anche se per errore fosse più di
// una volta), elimina i movimenti collegati e resetta i flag così l'iscrizione
// può essere riapplicata più avanti quando sarà il momento giusto.
export async function annullaIscrizioneATutti(stagione = getStagioneQuota()) {
  const { data: movimenti, error } = await supabase
    .from('movimenti')
    .select('id, squadra, uscita')
    .ilike('descrizione', `Iscrizione campionato ${stagione}%`);
  if (error) throw error;
  if (!movimenti?.length) return [];

  const bySquadra = new Map();
  for (const m of movimenti) {
    bySquadra.set(m.squadra, parseFloat(((bySquadra.get(m.squadra) || 0) + Number(m.uscita || 0)).toFixed(2)));
  }

  const results = [];
  for (const [squadra, rimborso] of bySquadra.entries()) {
    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
    const nuovoBilancio = parseFloat((Number(sq?.bilancio || 0) + rimborso).toFixed(2));
    await safeUpdateSquadraQuote(
      squadra,
      { bilancio: nuovoBilancio, iscrizione_pagata: false, iscrizione_stagione_pagata: null, iscrizione_pagata_il: null, updated_at: new Date().toISOString() },
      { bilancio: nuovoBilancio, iscrizione_pagata: false }
    );
    results.push({ squadra, rimborso, ok: true });
  }

  await supabase.from('movimenti').delete().ilike('descrizione', `Iscrizione campionato ${stagione}%`);
  return results;
}

// Ripulisce solo i DUPLICATI (una squadra addebitata più di una volta per la
// stessa iscrizione): tiene il primo addebito, rimborsa e cancella gli altri.
// A differenza di annullaIscrizioneATutti, chi ha pagato una volta sola resta
// regolarmente iscritto.
export async function ripulisciDuplicatiIscrizione(stagione = getStagioneQuota()) {
  const { data: movimenti, error } = await supabase
    .from('movimenti')
    .select('id, squadra, uscita, data')
    .ilike('descrizione', `Iscrizione campionato ${stagione}%`)
    .order('data', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  const bySquadra = new Map();
  for (const m of (movimenti || [])) {
    if (!bySquadra.has(m.squadra)) bySquadra.set(m.squadra, []);
    bySquadra.get(m.squadra).push(m);
  }

  const results = [];
  for (const [squadra, list] of bySquadra.entries()) {
    if (list.length <= 1) continue; // nessun duplicato
    const [tieni, ...extra] = list;
    const rimborso = parseFloat(extra.reduce((a, m) => a + Number(m.uscita || 0), 0).toFixed(2));
    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
    const nuovoBilancio = parseFloat((Number(sq?.bilancio || 0) + rimborso).toFixed(2));
    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
    await supabase.from('movimenti').delete().in('id', extra.map(m => m.id));
    results.push({ squadra, rimborso, rimossi: extra.length, tenuto: tieni.id });
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

// Restituisce gli upgrade stadio che danno bonus nella stagione indicata.
// Regola: l'investimento acquistato in una stagione produce +1,5M dalla stagione successiva.
export async function getStadioInvestimenti(stagione = getStagioneQuota()) {
  const currentStart = _stagioneStartFromLabel(stagione);
  const { data } = await supabase.from('investimenti')
    .select('*')
    .eq('nome', 'Ristrutturazione Stadio')
    .eq('attivo', true);
  return (data || []).filter(i => _stagioneStartFromLabel(i.stagione) < currentStart);
}

// Toggle admin del BONUS ATTIVO nella stagione indicata.
// Per ottenere effetto nella stagione corrente, crea/rimuove un record nella stagione precedente.
export async function setStadioUpgrade(squadra, attivo, stagione = getStagioneQuota()) {
  const currentStart = _stagioneStartFromLabel(stagione);
  const stagioneOrigine = `${currentStart - 1}-${String(currentStart).slice(2)}`;
  if (attivo) {
    const { data: gia } = await supabase.from('investimenti')
      .select('id')
      .eq('squadra', squadra)
      .eq('nome', 'Ristrutturazione Stadio')
      .eq('stagione', stagioneOrigine)
      .limit(1);
    if (gia?.length) return;
    const { error } = await supabase.from('investimenti').insert({
      squadra, nome: 'Ristrutturazione Stadio', categoria: 'grande',
      costo: 0, stagione: stagioneOrigine, attivo: true,
      data_acquisto: `${currentStart - 1}-08-01`,
      dati: { admin_override_bonus_attivo: true, effetto_dalla_stagione: stagione },
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('investimenti').delete()
      .eq('squadra', squadra).eq('nome', 'Ristrutturazione Stadio').eq('stagione', stagioneOrigine);
    if (error) throw error;
  }
}

// Applica le entrate stadio a TUTTE le squadre (trigger manuale admin)
export async function applicaEntrateStadioTutte(stagione = getStagioneQuota()) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { start: meseStart, end: meseEnd, meseISO } = getMeseCorrenteRange();
  const stadioDesc = `Entrate stadio ${meseISO}`;

  const { data: squadre, error: sqErr } = await supabase.from('squadre').select('name, bilancio');
  if (sqErr) throw sqErr;
  if (!squadre?.length) return [];

  const currentStart = _stagioneStartFromLabel(stagione);
  const { data: invAll, error: invErr } = await supabase.from('investimenti')
    .select('squadra, stagione').eq('nome', 'Ristrutturazione Stadio').eq('attivo', true);
  if (invErr) throw invErr;
  const potenziate = new Set((invAll || [])
    .filter(i => _stagioneStartFromLabel(i.stagione) < currentStart)
    .map(i => i.squadra));

  const results = [];
  for (const sq of squadre) {
    try {
      // Considera già pagata qualsiasi entrata stadio presente nel mese, anche se in vecchie versioni
      // la descrizione non coincideva esattamente con `Entrate stadio YYYY-MM`.
      const { data: gia, error: giaErr } = await supabase.from('movimenti')
        .select('id, descrizione, data')
        .eq('squadra', sq.name)
        .gte('data', meseStart)
        .lt('data', meseEnd);
      if (giaErr) throw giaErr;
      if ((gia || []).some(m => isEntrateStadioDescrizione(m.descrizione))) {
        results.push({ squadra: sq.name, skip: true });
        continue;
      }

      const entrata = potenziate.has(sq.name) ? 5.5 : 4;
      const nuovoBilancio = parseFloat((Number(sq.bilancio || 0) + entrata).toFixed(2));
      const { error: movErr } = await supabase.from('movimenti').insert({ squadra: sq.name, descrizione: stadioDesc, entrata, data: oggi });
      if (movErr) throw movErr;
      const { error: updErr } = await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', sq.name);
      if (updErr) throw updErr;
      results.push({ squadra: sq.name, entrata, ok: true });
    } catch(e) {
      results.push({ squadra: sq.name, ok: false, error: e.message });
    }
  }
  if (results.some(r => r.ok)) {
    await sendTelegramNotification('stadio_applicato', { mese: meseISO });
  }
  return results;
}

// Rimuove le entrate stadio del mese corrente da TUTTE le squadre: storna
// l'importo esatto accreditato ed elimina i movimenti collegati (stesso
// approccio di annullaTassaATutti/annullaIscrizioneATutti).
export async function annullaEntrateStadioATutti() {
  const { start: meseStart, end: meseEnd } = getMeseCorrenteRange();
  const { data: movimenti, error } = await supabase
    .from('movimenti')
    .select('id, squadra, entrata, descrizione')
    .gte('data', meseStart).lt('data', meseEnd);
  if (error) throw error;
  const daRimuovere = (movimenti || []).filter(m => isEntrateStadioDescrizione(m.descrizione));
  if (!daRimuovere.length) return [];

  const results = [];
  for (const m of daRimuovere) {
    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', m.squadra).single();
    const nuovoBilancio = parseFloat((Number(sq?.bilancio || 0) - Number(m.entrata || 0)).toFixed(2));
    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', m.squadra);
    await supabase.from('movimenti').delete().eq('id', m.id);
    results.push({ squadra: m.squadra, storno: Number(m.entrata || 0) });
  }
  return results;
}

// Applica la tassa settimanale a TUTTE le squadre (trigger manuale admin)
export async function applicaTassaATutti() {
  const modalitaTassazione = await getModalitaTassazione();
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
    const r = await applicaTassaSettimana(sq.name, sq.bilancio, domenica, settimanaLabel, modalitaTassazione);
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
  const { start: meseStart, end: meseEnd, meseISO } = getMeseCorrenteRange();
  const stipDesc = `Pagamento stipendi ${meseISO}`;
  const { data: squadre, error: sqErr } = await supabase.from('squadre').select('name, bilancio');
  if (sqErr) throw sqErr;
  if (!squadre?.length) return [];
  const results = [];
  for (const sq of squadre) {
    try {
      // Se gli stipendi sono già stati pagati manualmente nel mese con una vecchia descrizione
      // tipo "Pagamento stipendi luglio 2026", la Control Room deve considerarli completati.
      const { data: gia, error: giaErr } = await supabase.from('movimenti')
        .select('id, descrizione, data')
        .eq('squadra', sq.name)
        .gte('data', meseStart)
        .lt('data', meseEnd);
      if (giaErr) throw giaErr;
      if ((gia || []).some(m => isPagamentoStipendiDescrizione(m.descrizione))) {
        results.push({ squadra: sq.name, skip: true });
        continue;
      }

      const { data: rosa, error: rosaErr } = await supabase.from('rosa').select('quot, stip, anni_contratto, anni')
        .eq('squadra', sq.name).eq('in_vivaio', false);
      if (rosaErr) throw rosaErr;
      const stipRosa = (rosa || []).reduce((s, p) => {
        const stipSalvato = Number(p.stip);
        return s + (Number.isFinite(stipSalvato) && stipSalvato > 0 ? stipSalvato : _calcolaStipCorretto(p.quot, p.anni_contratto, p.anni));
      }, 0);
      const { data: all } = await supabase.from('allenatori_carte').select('stipendio_sc')
        .eq('squadra', sq.name).maybeSingle();
      const totalStip = parseFloat((stipRosa + Number(all?.stipendio_sc || 0)).toFixed(2));
      const rata = parseFloat((totalStip / 12).toFixed(2));
      const nuovoBilancio = parseFloat((Number(sq.bilancio || 0) - rata).toFixed(2));
      const { error: movErr } = await supabase.from('movimenti').insert({ squadra: sq.name, descrizione: stipDesc, uscita: rata, data: oggi });
      if (movErr) throw movErr;
      const { error: updErr } = await supabase.from('squadre').update({ bilancio: nuovoBilancio, salary_used: totalStip }).eq('name', sq.name);
      if (updErr) throw updErr;
      results.push({ squadra: sq.name, rata, ok: true });
    } catch(e) {
      results.push({ squadra: sq.name, ok: false, error: e.message });
    }
  }
  if (results.some(r => r.ok)) {
    await sendTelegramNotification('stipendi_applicati', { mese: meseISO });
  }
  return results;
}

// Rimuove il pagamento stipendi del mese corrente da TUTTE le squadre: rimborsa
// l'importo esatto addebitato ed elimina i movimenti collegati (stesso approccio
// di annullaTassaATutti/annullaIscrizioneATutti). Non tocca salary_used, che
// riflette semplicemente il monte-ingaggi corrente della rosa, non un contatore
// di quanto pagato finora.
export async function annullaStipendiATutti() {
  const { start: meseStart, end: meseEnd } = getMeseCorrenteRange();
  const { data: movimenti, error } = await supabase
    .from('movimenti')
    .select('id, squadra, uscita, descrizione')
    .gte('data', meseStart).lt('data', meseEnd);
  if (error) throw error;
  const daRimuovere = (movimenti || []).filter(m => isPagamentoStipendiDescrizione(m.descrizione));
  if (!daRimuovere.length) return [];

  const results = [];
  for (const m of daRimuovere) {
    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', m.squadra).single();
    const nuovoBilancio = parseFloat((Number(sq?.bilancio || 0) + Number(m.uscita || 0)).toFixed(2));
    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', m.squadra);
    await supabase.from('movimenti').delete().eq('id', m.id);
    results.push({ squadra: m.squadra, rimborso: Number(m.uscita || 0) });
  }
  return results;
}

// Stato finanziario riepilogativo per il Control Room
export async function getControlRoomStatus() {
  const oggi = new Date().toISOString().slice(0, 10);
  const { start: meseStart, end: meseEnd, meseISO } = getMeseCorrenteRange();
  const domenica = getDomenicaCorrente();

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
    supabase.from('movimenti').select('squadra, descrizione, data').gte('data', meseStart).lt('data', meseEnd),
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

  const stipendiMovimenti = (movMese || []).filter(m => isPagamentoStipendiDescrizione(m.descrizione));
  const stadioMovimenti = (movMese || []).filter(m => isEntrateStadioDescrizione(m.descrizione));
  const stipendiPagati = new Set(stipendiMovimenti.map(m => m.squadra));
  const stadioPagato = new Set(stadioMovimenti.map(m => m.squadra));

  // Costo vivaio annuale (4M, art. 3.6.3): pagato se registrato per la stagione corrente,
  // oppure con il vecchio flag booleano (dati storici precedenti all'introduzione della stagione).
  const stagioneVivaio = getStagioneQuota(new Date());
  const vivaioPagato = new Set(
    squadreList
      .filter(sq => sq.vivaio_stagione_pagata === stagioneVivaio || (sq.vivaio_pagato && !sq.vivaio_stagione_pagata))
      .map(sq => sq.name)
  );

  return {
    squadre: squadreList,
    tassePagate,
    tasseDettagli,
    canApplicareTassa,
    stipendiPagati,
    stadioPagato,
    vivaioPagato,
    stagioneVivaio,
    stipendiDettagli: {
      movimenti: stipendiMovimenti,
      countBySquadra: stipendiMovimenti.reduce((acc, m) => {
        acc[m.squadra] = (acc[m.squadra] || 0) + 1;
        return acc;
      }, {}),
    },
    stadioDettagli: {
      movimenti: stadioMovimenti,
      countBySquadra: stadioMovimenti.reduce((acc, m) => {
        acc[m.squadra] = (acc[m.squadra] || 0) + 1;
        return acc;
      }, {}),
    },
    domenica,
    meseISO,
  };
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
  const quotIniziale = Number(player.quot_iniziale_vivaio ?? player.quot ?? 0);
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
  // Come un normale svincolo: il giocatore deve tornare disponibile tra gli
  // svincolati, non sparire del tutto dal database.
  await upsertSvincolatoSafe({
    nome: player.nome,
    ruolo: player.ruolo,
    anni: player.anni || 0,
    quot: player.quot || 0,
    stip: player.stip || 0,
    clausola: parseFloat(((player.quot || 0) * 1.75).toFixed(2)),
    fuori_lista: player.fuori_lista || false,
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
  }, stagioneDaData(new Date()));
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
  const u21Richiesti = await _getU21RichiestiConDeroga(squadra, futuroTotale, new Date());
  if (u21 < u21Richiesti) throw new Error(`Promozione non consentita: con ${futuroTotale} giocatori servono almeno ${u21Richiesti} Under-21 (attuali ${u21}).`);

  if (player.squadra_serie_a) {
    const stessaSerieA = futuraRosa.filter(p => p.squadra_serie_a === player.squadra_serie_a).length;
    if (stessaSerieA > 5) throw new Error(`Promozione non consentita: supereresti il limite di 5 giocatori del ${player.squadra_serie_a}.`);
  }

  // Calcola stipendio normale (Q/5) e verifica salary cap base/attivo.
  const stipNormale = parseFloat((player.quot / 5).toFixed(2));
  const scGiocatori = (rosaAttuale || []).reduce((sum, p) => sum + Number(p.stip || 0), 0) + stipNormale;
  const { data: sqCap } = await supabase.from('squadre').select('sc_bonus_obiettivi').eq('name', squadra).single();
  const cap = 75 + await _getSalaryCapInvestimenti(squadra, getStagioneQuota(new Date())) + Number(sqCap?.sc_bonus_obiettivi || 0);
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
  // Come un normale svincolo: torna disponibile tra gli svincolati, non sparisce.
  await upsertSvincolatoSafe({
    nome: player.nome,
    ruolo: player.ruolo,
    anni: player.anni || 0,
    quot: player.quot || 0,
    stip: player.stip || 0,
    clausola: parseFloat(((player.quot || 0) * 1.75).toFixed(2)),
    fuori_lista: player.fuori_lista || false,
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
  }, stagioneDaData(new Date()));
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

// Applica il pagamento del costo vivaio (4M) a tutte le squadre che non l'hanno ancora
// pagato per la stagione corrente. Salta le squadre già in regola (art. 3.6.3).
export async function applicaCostoVivaioATutti(opts = {}) {
  const stagione = opts.stagione || getStagioneQuota(new Date());
  const { data: squadre, error } = await supabase.from('squadre').select('name, bilancio, vivaio_pagato, vivaio_stagione_pagata');
  if (error) throw error;
  if (!squadre?.length) return [];
  const results = [];
  for (const sq of squadre) {
    const giaPagato = sq.vivaio_stagione_pagata === stagione || (sq.vivaio_pagato && !sq.vivaio_stagione_pagata);
    if (giaPagato) { results.push({ squadra: sq.name, skip: true }); continue; }
    try {
      await pagaCostoVivaio(sq.name, sq.bilancio || 0);
      results.push({ squadra: sq.name, ok: true });
    } catch(e) {
      results.push({ squadra: sq.name, ok: false, error: e.message });
    }
  }
  return results;
}

// Giocatori svincolati idonei per il vivaio (under-23, Q <= 3)
// NB: il requisito "0 presenze a voto" va verificato manualmente sulla piattaforma fantacalcio
// poiché il dato delle presenze non è disponibile nella lista svincolati statica
export function filtraVivaioCandidati(freeAgents) {
  return freeAgents.filter(p => p.anni > 0 && p.anni <= 23 && p.quot <= 3);
}
// ─── SVINCOLATI DB (art. 3.6, sostituisce FREE_AGENTS statico) ───────────────

export async function getSvincolatiDB(stagione = getStagioneQuota()) {
  const { data, error } = await supabase
    .from('svincolati')
    .select('*')
    .eq('stagione', stagione)
    .order('quot', { ascending: false });
  if (error) return [];
  return data;
}

// Scrive un giocatore in "svincolati" SENZA fare affidamento su un vincolo di
// unicità (nome,stagione) lato database — su Supabase quel vincolo può mancare,
// nel qual caso .upsert({onConflict:...}) non evita affatto i doppioni e ogni
// import ripetuto crea una nuova riga con ID diverso per lo stesso giocatore.
// Cerchiamo quindi prima la riga esistente per nome (case-insensitive) e
// stagione: se c'è, la aggiorniamo per id; altrimenti inseriamo una riga nuova.
async function upsertSvincolatoSafe(payload, stagione) {
  const nome = (payload.nome || '').toString().trim();
  const { data: existing, error: findErr } = await supabase
    .from('svincolati')
    .select('id')
    .eq('stagione', stagione)
    .ilike('nome', nome)
    .limit(1);
  if (findErr) throw findErr;
  const row = { ...payload, nome, stagione, updated_at: new Date().toISOString() };
  if (existing && existing[0]) {
    const { error } = await supabase.from('svincolati').update(row).eq('id', existing[0].id);
    if (error) throw error;
    return { id: existing[0].id, created: false };
  }
  const { data: inserted, error } = await supabase.from('svincolati').insert(row).select('id').single();
  if (error) throw error;
  return { id: inserted.id, created: true };
}

export async function upsertSvincolato(player, stagione = getStagioneQuota()) {
  await upsertSvincolatoSafe(player, stagione);
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
export async function importSvincolatiDaArray(rows, stagione = getStagioneQuota()) {
  const mapped = rows.map(r => ({
    nome: (r.nome || r.Nome || '').toString().trim(),
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
  })).filter(r => r.nome && r.ruolo);

  // Un giocatore alla volta tramite upsertSvincolatoSafe (select by nome+stagione,
  // poi update per id o insert): evita i doppioni con ID diverso che il semplice
  // .upsert({onConflict:'nome,stagione'}) non preveniva quando quel vincolo di
  // unicità non esiste davvero sul database.
  const BATCH = 20;
  for (let i = 0; i < mapped.length; i += BATCH) {
    await Promise.all(mapped.slice(i, i + BATCH).map(r => upsertSvincolatoSafe(r, stagione)));
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
// ─── AGGIORNAMENTO 01/01 PER SQUADRA (art. 4.5) ──────────────────────────────
// Basato su quot_reale (la quotazione di mercato aggiornata ad ogni import,
// mai congelata) confrontata con quot (la quotazione in vigore in rosa, ferma
// fino a 01/06/01/08/01/01 o un trasferimento): NON su quot_precedente, che con
// l'update Settimanale non tocca più quot per chi è già in rosa e quindi non
// si muove mai durante l'anno.
//
// Selezione: top-5 rialzo (esclusi gli U21, che non hanno aumenti — si passa
// al 6°, 7°... finché non se ne trovano 5) e top-5 ribasso, PER SQUADRA (non
// sulla lega intera). Se più giocatori sono a pari incremento/decremento
// esattamente sul confine del 5° posto, non si sceglie arbitrariamente: quei
// giocatori finiscono in "inSospeso" e il presidente decide lui chi occupa i
// posti rimasti (vedi sceltaTop5 in App.jsx).
function _selezionaTop5ConPareggi(candidatiOrdinati, postiTotali = 5) {
  if (!candidatiOrdinati.length) return { garantiti: [], inSospeso: [], postiLiberi: 0 };
  if (candidatiOrdinati.length <= postiTotali) return { garantiti: candidatiOrdinati, inSospeso: [], postiLiberi: 0 };
  const sogliaDelta = Math.abs(candidatiOrdinati[postiTotali - 1].delta);
  const garantiti = candidatiOrdinati.filter(p => Math.abs(p.delta) > sogliaDelta);
  const alPareggio = candidatiOrdinati.filter(p => Math.abs(p.delta) === sogliaDelta);
  const postiLiberi = postiTotali - garantiti.length;
  if (alPareggio.length <= postiLiberi) return { garantiti: [...garantiti, ...alPareggio], inSospeso: [], postiLiberi: 0 };
  return { garantiti, inSospeso: alPareggio, postiLiberi };
}

export async function calcolaTop5Aggiornamenti(squadra, stagione = getStagioneQuota()) {
  const { data: rosa } = await supabase
    .from('rosa')
    .select('id, nome, anni, ruolo, quot, quot_reale, stip, clausola, rinnovo_ribasso, da_cedere')
    .eq('squadra', squadra)
    .eq('in_vivaio', false);

  if (!rosa?.length) return { rialzi: [], ribassi: [], rialziInSospeso: [], ribassiInSospeso: [], postiRialziLiberi: 0, postiRibassiLiberi: 0 };

  // Chi ha già una decisione registrata questa stagione non va riproposto.
  const { data: decisi } = await supabase.from('decisioni_top5').select('giocatore_id, tipo').eq('squadra', squadra).eq('stagione', stagione);
  const idDecisi = { rialzo: new Set(), ribasso: new Set() };
  for (const d of (decisi || [])) idDecisi[d.tipo]?.add(d.giocatore_id);

  const conDelta = rosa
    .filter(p => p.quot_reale != null && Number(p.quot_reale) !== Number(p.quot))
    .map(p => ({
      ...p,
      delta: parseFloat((Number(p.quot_reale) - Number(p.quot)).toFixed(2)),
      stipNuovo: parseFloat((Number(p.quot_reale) / 5).toFixed(2)),
    }));

  const isU21 = p => Number(p.anni || 0) > 0 && Number(p.anni || 0) <= 21;

  // Rialzo obbligatorio: gli U21 non hanno aumenti contrattuali (art. 4.8.1),
  // vengono scartati e si passa ai successivi in graduatoria.
  const candidatiRialzo = conDelta
    .filter(p => p.delta > 0 && !isU21(p) && !idDecisi.rialzo.has(p.id))
    .sort((a, b) => b.delta - a.delta);
  // Stessa esclusione U21 per il ribasso: non potendo comunque ridurre il loro
  // stipendio (art. 4.8.1), non ha senso occupare un posto in classifica con loro.
  const candidatiRibasso = conDelta
    .filter(p => p.delta < 0 && !isU21(p) && !idDecisi.ribasso.has(p.id))
    .sort((a, b) => a.delta - b.delta);

  const { garantiti: rialzi, inSospeso: rialziInSospeso, postiLiberi: postiRialziLiberi } = _selezionaTop5ConPareggi(candidatiRialzo);
  const { garantiti: ribassi, inSospeso: ribassiInSospeso, postiLiberi: postiRibassiLiberi } = _selezionaTop5ConPareggi(candidatiRibasso);

  return { rialzi, ribassi, rialziInSospeso, ribassiInSospeso, postiRialziLiberi, postiRibassiLiberi };
}

// Applica il rialzo obbligatorio 01/01: quotazione, stipendio e clausola
// salgono al valore reale di mercato (quot_reale).
export async function applicaTop5Rialzo(playerId, squadra, stagione = getStagioneQuota()) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: p } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!p) throw new Error('Giocatore non trovato');
  const nuovaQuot = Number(p.quot_reale);
  const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));
  const nuovaClausola = parseFloat((nuovaQuot * 1.75).toFixed(2));

  await supabase.from('rosa').update({
    quot: nuovaQuot,
    quot_precedente: p.quot,
    stip: nuovoStip,
    stip_originale: nuovoStip,
    clausola: nuovaClausola,
  }).eq('id', playerId);

  await supabase.from('aggiornamenti_stipendi').upsert({
    squadra, giocatore_id: playerId, nome: p.nome,
    quot_prima: p.quot, quot_dopo: nuovaQuot,
    delta: parseFloat((nuovaQuot - Number(p.quot)).toFixed(2)),
    tipo: 'rialzo', rinnovo_effettuato: true,
    nuovo_stip: nuovoStip, data_aggiornamento: oggi, stagione,
  }, { onConflict: 'stagione,giocatore_id' });

  await supabase.from('decisioni_top5').upsert({
    squadra, giocatore_id: playerId, stagione, tipo: 'rialzo', esito: 'applicato', data: oggi,
  }, { onConflict: 'giocatore_id,stagione,tipo' });

  return { nuovaQuot, nuovoStip, nuovaClausola };
}

// Applica (o rifiuta) il ribasso opzionale 01/01 (entro 05/01 alle 20:00).
// Se il presidente riduce: quotazione, stipendio e clausola scendono al valore
// reale di mercato (esattamente come il rialzo), e per 22-30 anni scatta
// l'obbligo di cessione (da_cedere). Se NON riduce: nulla cambia (quotazione
// resta quella vecchia) — si registra solo la decisione per non riproporla.
// Per U21: non consentito (art. 4.8.1) — vengono già esclusi a monte da
// calcolaTop5Aggiornamenti, questo è un controllo di sicurezza in più.
export async function applicaTop5Ribasso(playerId, squadra, ridurre, stagione = getStagioneQuota()) {
  const { data: p } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!p) throw new Error('Giocatore non trovato');

  const isU21 = p.anni > 0 && p.anni <= 21;
  if (isU21) throw new Error(`${p.nome} è Under-21 — non è possibile ridurre il contratto`);

  const oggi = new Date().toISOString().slice(0, 10);

  if (!ridurre) {
    await supabase.from('decisioni_top5').upsert({
      squadra, giocatore_id: playerId, stagione, tipo: 'ribasso', esito: 'rifiutato', data: oggi,
    }, { onConflict: 'giocatore_id,stagione,tipo' });
    return { ridotto: false };
  }

  const nuovaQuot = Number(p.quot_reale);
  const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));
  const nuovaClausola = parseFloat((nuovaQuot * 1.75).toFixed(2));
  const deveCedere = p.anni >= 22 && p.anni <= 30;

  await supabase.from('rosa').update({
    quot: nuovaQuot,
    quot_precedente: p.quot,
    stip: nuovoStip,
    clausola: nuovaClausola,
    rinnovo_ribasso: true,
    da_cedere: deveCedere,
    data_rinnovo_ribasso: oggi,
  }).eq('id', playerId);

  await supabase.from('aggiornamenti_stipendi').upsert({
    squadra, giocatore_id: playerId, nome: p.nome,
    quot_prima: p.quot, quot_dopo: nuovaQuot,
    delta: parseFloat((nuovaQuot - Number(p.quot)).toFixed(2)),
    tipo: 'ribasso', rinnovo_effettuato: true,
    nuovo_stip: nuovoStip, data_aggiornamento: oggi, stagione,
    note: deveCedere ? 'Da cedere entro la 1ª giornata di Serie A (22/08)' : 'Over 31 - nessun obbligo',
  }, { onConflict: 'stagione,giocatore_id' });

  await supabase.from('decisioni_top5').upsert({
    squadra, giocatore_id: playerId, stagione, tipo: 'ribasso', esito: 'applicato', data: oggi,
  }, { onConflict: 'giocatore_id,stagione,tipo' });

  return { ridotto: true, nuovaQuot, nuovoStip, deveCedere };
}

// Verifica finestra ribasso / scelta pareggi (01/01 → 05/01 ore 20:00)
export function isFinestraRibasso() {
  const ora = new Date();
  const m = ora.getMonth() + 1, d = ora.getDate(), h = ora.getHours();
  if (m !== 1) return false;
  if (d === 1 || d === 2 || d === 3 || d === 4) return true;
  if (d === 5 && h < 20) return true;
  return false;
}

// Carica storico aggiornamenti per una squadra
export async function getAggiornamenti(squadra, stagione = getStagioneQuota()) {
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
    (giorno === 3 && oreMin < 20 * 60);      // mercoledì prima delle 20:00

  const finestraAltriInteressi =
    (giorno === 3 && oreMin >= 20 * 60) ||   // mercoledì dalle 20:00
    (giorno === 4 && oreMin < 20 * 60);      // giovedì prima delle 20:00

  const giornoAste = giorno === 5; // venerdì

  return {
    aperta: finestraInteresse,
    finestraInteresse,
    finestraAltriInteressi,
    giornoAste,
    messaggio: finestraInteresse
      ? "✅ Finestra aperta — puoi manifestare interesse (fino a mer 20:00)"
      : finestraAltriInteressi
        ? "⏳ Finestra interesse altri presidenti (fino a gio 20:00)"
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
    .select('stato, quot, scadenza, masterclass_squadra_attiva, masterclass_scadenza_attiva').eq('id', astaId).single();
  if (!asta) throw new Error('Asta non trovata');
  if (asta.stato !== 'raccolta_offerte') throw new Error('Asta chiusa');

  // DS Masterclass: durante la finestra extra di 10 minuti di una squadra,
  // l'asta è congelata per tutte le altre (nessuna può inviare/modificare
  // offerte), ma la squadra attiva può farlo anche oltre la scadenza normale.
  const ora = new Date();
  const finestraMasterclassMia = asta.masterclass_squadra_attiva === squadra
    && asta.masterclass_scadenza_attiva && ora <= new Date(asta.masterclass_scadenza_attiva);
  if (!finestraMasterclassMia) {
    if (asta.masterclass_squadra_attiva) throw new Error('Asta congelata: in corso un utilizzo del DS Masterclass da parte di un altro presidente.');
    if (ora > new Date(asta.scadenza)) throw new Error('Scadenza offerte superata');
  }
  const minOfferta = parseFloat((Number(asta.quot) * 0.75).toFixed(2));
  const offerta = parseFloat(Number(importo || 0).toFixed(2));
  // Tolleranza per errori di arrotondamento in virgola mobile (come già fatto
  // per il controllo del bilancio subito sotto): senza margine, un presidente
  // che digita ESATTAMENTE il minimo poteva vedersi rifiutare l'offerta per
  // colpa di un residuo tipo 6.749999999999999 invece di 6.75.
  if (offerta < minOfferta - 0.0001) throw new Error(`Offerta minima: ${minOfferta}M (¾ quotazione)`);

  // Art. 6.4: non è mai possibile offrire più della liquidità disponibile.
  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  const bilancio = Number(sq?.bilancio || 0);
  if (offerta > bilancio + 0.0001) {
    throw new Error(`Offerta non valida: ${squadra} ha ${bilancio.toFixed(2)}M disponibili, quindi non può offrire ${offerta.toFixed(2)}M.`);
  }

  const { data, error } = await supabase.from('offerte_asta')
    .upsert({ asta_id: astaId, squadra, importo: offerta, per_vivaio: perVivaio, assente: false },
             { onConflict: 'asta_id,squadra' })
    .select().single();
  if (error) throw error;
  return data;
}

// ─── DS MASTERCLASS ───────────────────────────────────────────────────────────
// Attivazione silenziosa: nessuno (né gli altri presidenti né gli admin) deve
// sapere che è stata usata finché non scade il termine per le offerte — a quel
// punto checkScadenzeAste (vedi _avanzaMasterclass) la elabora automaticamente:
// congela l'asta, rivela in privato al presidente l'offerta più alta del
// momento, gli concede 10 minuti extra, e avvisa il canale pubblico.
// Se più presidenti la attivano sulla stessa asta, vengono elaborati uno alla
// volta nell'ordine in cui si erano dichiarati interessati al giocatore (non
// nell'ordine in cui hanno cliccato il pulsante).
export async function attivaMasterclass(astaId, squadra) {
  const { data: asta } = await supabase.from('aste_svincolati').select('*').eq('id', astaId).single();
  if (!asta) throw new Error('Asta non trovata');
  if (asta.stato !== 'raccolta_offerte') throw new Error('Asta non in fase di raccolta offerte.');
  const ora = new Date();
  if (ora > new Date(asta.scadenza)) throw new Error('Il termine per mandare le offerte è già scaduto.');
  // Utilizzabile SOLO da chi ha chiamato per primo questo giocatore (asta.aperta_da),
  // non da un semplice interessato successivo.
  if (asta.aperta_da !== squadra) throw new Error('Puoi usare il DS Masterclass solo sui giocatori che hai chiamato tu.');

  const { data: chiamate } = await supabase.from('chiamate')
    .select('squadra, created_at').eq('giocatore', asta.giocatore).order('created_at', { ascending: true });
  const ordineInteresse = (chiamate || []).map(c => c.squadra);
  if (ordineInteresse.length <= 1) throw new Error('Nessun utilizzo possibile: sei l\'unico interessato a questo giocatore.');
  const ordine = ordineInteresse.indexOf(squadra);
  if (ordine < 0) throw new Error('Non risulti tra gli interessati a questo giocatore.');

  const { data: gia } = await supabase.from('masterclass_richieste')
    .select('id').eq('asta_id', astaId).eq('squadra', squadra).maybeSingle();
  if (gia) throw new Error('Hai già utilizzato il DS Masterclass per questa asta.');

  const { data: inv } = await supabase.from('investimenti')
    .select('*').eq('squadra', squadra).eq('nome', 'DS Masterclass').maybeSingle();
  if (!inv) throw new Error('Non hai il DS Masterclass attivo.');
  const usati = Number(inv.dati?.utilizzi_masterclass || 0);
  if (usati >= 2) throw new Error('Utilizzi DS Masterclass esauriti (2/2).');

  // L'utilizzo viene consumato subito, indipendentemente dal fatto che poi si
  // riesca o meno a formulare un'offerta entro i 10 minuti extra.
  await supabase.from('investimenti').update({
    dati: { ...(inv.dati || {}), utilizzi_masterclass: usati + 1 },
  }).eq('id', inv.id);

  const { error } = await supabase.from('masterclass_richieste').insert({
    asta_id: astaId, squadra, investimento_id: inv.id, ordine_interesse: ordine,
  });
  if (error) throw error;
  return { ok: true, utilizziRimasti: 2 - (usati + 1) };
}

// Stato della mia eventuale richiesta per questa asta (per la UI: bottone
// "attiva" vs "richiesta inviata, in coda" vs "finestra extra attiva").
export async function getMasterclassRichiesta(astaId, squadra) {
  const { data } = await supabase.from('masterclass_richieste')
    .select('*').eq('asta_id', astaId).eq('squadra', squadra).maybeSingle();
  return data || null;
}

// Elaborazione automatica, chiamata da checkScadenzeAste per ogni asta scaduta
// PRIMA di rivelarla: gestisce l'avanzamento della coda dei Masterclass
// attivati su quell'asta. Ritorna true quando non c'è più nulla da aspettare
// (nessuna richiesta in coda) e si può quindi procedere con rivelaECompletaAsta.
async function _avanzaMasterclass(asta) {
  const ora = new Date();

  // Una finestra extra è già in corso: se non è ancora scaduta, aspetta.
  if (asta.masterclass_squadra_attiva) {
    if (ora < new Date(asta.masterclass_scadenza_attiva)) return false;
    // Scaduta: chiudila prima di valutare la prossima richiesta in coda.
    await supabase.from('aste_svincolati').update({
      masterclass_squadra_attiva: null, masterclass_scadenza_attiva: null,
    }).eq('id', asta.id);
  }

  const { data: prossime } = await supabase.from('masterclass_richieste')
    .select('*').eq('asta_id', asta.id).is('avviato_at', null)
    .order('ordine_interesse', { ascending: true }).limit(1);
  const prossima = prossime?.[0];
  if (!prossima) return true; // nessun Masterclass in coda: pronta per il reveal finale

  // Offerta più alta al momento (avversarie reali, non le auto-bid che
  // vengono generate solo in fase di reveal finale).
  const { data: offerte } = await supabase.from('offerte_asta')
    .select('squadra, importo, assente').eq('asta_id', asta.id);
  const avversarie = (offerte || []).filter(o => o.squadra !== prossima.squadra && !o.assente);
  const maxOfferta = avversarie.length ? Math.max(...avversarie.map(o => Number(o.importo))) : 0;

  const scadenzaExtra = new Date(ora.getTime() + 10 * 60000);
  await supabase.from('aste_svincolati').update({
    masterclass_squadra_attiva: prossima.squadra,
    masterclass_scadenza_attiva: scadenzaExtra.toISOString(),
  }).eq('id', asta.id);
  await supabase.from('masterclass_richieste').update({
    avviato_at: ora.toISOString(), offerta_rivelata: maxOfferta,
  }).eq('id', prossima.id);

  await sendTelegramNotification('ds_masterclass_usato', { giocatore: asta.giocatore, squadra: prossima.squadra });
  await sendTelegramNotification('ds_masterclass_offerte', {
    giocatore: asta.giocatore,
    offertaRivelata: maxOfferta > 0 ? maxOfferta.toFixed(2) : null,
    scadenza: scadenzaExtra.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
  }, prossima.squadra);

  return false; // finestra appena avviata: non ancora pronta per il reveal finale
}

// ── calcolaScadenzaAsta (alias per calcolaScadenzaOfferte) ────────────────────
export function calcolaScadenzaAsta(dataPrimaChiamata = new Date()) {
  const scInt = calcolaScadenzaInteresse(dataPrimaChiamata);
  return calcolaScadenzaOfferte(scInt);
}

// ── Calcola slot scalare venerdì per una nuova asta ──────────────────────────
// Prima asta del venerdì → 13:00 UTC (14:00 Italia); ogni asta successiva +30min.
// Lo slot è determinato dall'ORDINE DI CHIAMATA (scadenza_interesse della
// chiamata principale), non dall'ordine in cui le aste vengono create: contare
// semplicemente le aste già create per quel venerdì è fragile, perché se
// un admin crea le aste manualmente in un ordine diverso da quello delle
// chiamate (o se automatico e manuale si mescolano), lo slot non rispecchia
// più chi ha chiamato per primo. Qui invece si conta quante chiamate
// principali di quello stesso venerdì hanno una scadenza_interesse precedente
// alla chiamata corrente: è deterministico e indipendente da quando/come
// viene creata l'asta.
export async function calcolaSlotVenerdì(venerdìUTC, scadenzaInteresseChiamata) {
  // Tutte le chiamate la cui scadenza_interesse cade nel giorno (giovedì) che
  // porta a QUESTO venerdì di aste: stessa finestra di 24h usata per calcolare
  // "ven" in creaAstaDaChiamate (scadenzaInteresse + 1 giorno).
  const giornoChiamate = new Date(venerdìUTC);
  giornoChiamate.setUTCDate(giornoChiamate.getUTCDate() - 1);
  giornoChiamate.setUTCHours(0, 0, 0, 0);
  const fineGiornoChiamate = new Date(giornoChiamate);
  fineGiornoChiamate.setUTCHours(23, 59, 59, 999);

  const { data: chiamateStessoVenerdi } = await supabase
    .from('chiamate')
    .select('scadenza_interesse')
    .eq('tipo', 'prima')
    .gte('scadenza_interesse', giornoChiamate.toISOString())
    .lte('scadenza_interesse', fineGiornoChiamate.toISOString());

  const targetISO = new Date(scadenzaInteresseChiamata).toISOString();
  // Slot = quante chiamate di questo stesso venerdì sono state fatte prima
  // (scadenza_interesse minore) della chiamata corrente.
  return (chiamateStessoVenerdi || []).filter(c => c.scadenza_interesse < targetISO).length;
}

// ── Crea asta da chiamate esistenti ──────────────────────────────────────────
// Calcola quando scadrebbe/scade la raccolta offerte per una chiamata
// principale, con la stessa identica logica usata da creaAstaDaChiamate
// (freeze notturno + distacco minimo 30' in modalità libera, slot del
// venerdì in modalità normale). Pura lettura, nessuna scrittura: usata sia
// per creare davvero l'asta sia per mostrarne un'anteprima mentre l'interesse
// è ancora aperto (l'asta non esiste ancora).
export async function calcolaScadenzaOfferteAttesa(primaria) {
  const scadenzaInteresse = new Date(primaria.scadenza_interesse);
  const modalita = primaria.modalita || 'normale';

  if (modalita === 'libero') {
    // Modalità libera: 12h "attive" dalla scadenza interesse (il freeze
    // notturno 00:00-08:00 non conta, come per le aste a discesa), con
    // distanziamento minimo di 30' rispetto a TUTTE le chiamate precedenti
    // (già trasformate in asta oppure ancora in attesa) — vedi
    // _calcolaScadenzaOfferteLiberoConCoda per il perché non basta guardare
    // solo le aste già esistenti.
    return await _calcolaScadenzaOfferteLiberoConCoda(primaria);
  }
  // Sempre: venerdì = giovedì + 1 giorno, slot base 13:00 UTC (14:00 Italia) + 30min per ogni chiamata precedente
  const ven = new Date(scadenzaInteresse);
  ven.setUTCDate(scadenzaInteresse.getUTCDate() + 1);
  ven.setUTCHours(13, 0, 0, 0);
  const slot = await calcolaSlotVenerdì(ven, primaria.scadenza_interesse);
  ven.setUTCMinutes(slot * 30);
  return ven;
}

export async function creaAstaDaChiamate(nomeGiocatore) {
  // Evita la doppia creazione se checkScadenzeAste parte quasi in contemporanea
  // da due tab/presidenti diversi (race condition): senza questo controllo
  // entrambe le chiamate potevano superare il check "chiamate aperte" prima
  // che una delle due avesse già inserito l'asta, creandone due per lo stesso
  // giocatore. Il messaggio esatto "già esistente" è quello che
  // checkScadenzeAste si aspetta per ignorare l'errore in silenzio.
  const { data: astaEsistente } = await supabase.from('aste_svincolati')
    .select('id').eq('giocatore', nomeGiocatore).eq('stato', 'raccolta_offerte').maybeSingle();
  if (astaEsistente) throw new Error('Asta già esistente per questo giocatore.');

  const { data: chiamate } = await supabase.from('chiamate')
    .select('*').eq('giocatore', nomeGiocatore).eq('stato', 'aperta')
    .order('created_at', { ascending: true });
  if (!chiamate?.length) throw new Error('Nessuna chiamata trovata');

  const primaria = chiamate.find(c => c.tipo === 'prima');
  if (!primaria) throw new Error('Chiamata principale non trovata');

  const scadenzaInteresse = new Date(primaria.scadenza_interesse);
  const modalita = primaria.modalita || 'normale';
  const scadenzaOfferte = await calcolaScadenzaOfferteAttesa(primaria);

  const payload = {
    giocatore: nomeGiocatore,
    ruolo: primaria.ruolo,
    anni: primaria.anni || 0,
    quot: primaria.quot,
    squadra_serie_a: primaria.squadra_serie_a || '',
    per_vivaio: primaria.per_vivaio || false,
    aperta_da: primaria.squadra,
    modalita,
    scadenza_interesse: scadenzaInteresse.toISOString(),
    scadenza: scadenzaOfferte.toISOString(),
    stato: 'raccolta_offerte',
    n_interessati: chiamate.length,
  };
  let { data: asta, error } = await supabase.from('aste_svincolati').insert(payload).select().single();
  if (error && isMissingColumnError(error)) {
    const { modalita: _drop, ...fallbackPayload } = payload;
    ({ data: asta, error } = await supabase.from('aste_svincolati').insert(fallbackPayload).select().single());
  }
  // Backstop a livello DB (indice unico parziale, vedi migrazione SQL): se
  // nonostante il controllo sopra due richieste sono passate quasi in
  // contemporanea, il DB rifiuta il secondo insert — normalizziamo l'errore
  // allo stesso messaggio così checkScadenzeAste lo ignora in silenzio.
  if (error?.code === '23505') throw new Error('Asta già esistente per questo giocatore.');
  if (error) throw error;

  await supabase.from('chiamate')
    .update({ stato: 'in_asta', asta_id: asta.id })
    .eq('giocatore', nomeGiocatore).eq('stato', 'aperta');

  // Notifica privata a OGNI interessato (non sul canale pubblico): è iniziata
  // la fase per mandare le offerte a busta chiusa. Copre sia Telegram sia il
  // centro notifiche in-app (stessa chiamata, vedi sendTelegramNotification).
  const oreResidue = Math.max(1, Math.round((scadenzaOfferte.getTime() - Date.now()) / 3600000));
  await Promise.all((chiamate || []).map(c => sendTelegramNotification('asta_svincolati', {
    giocatore: nomeGiocatore, quotazione: primaria.quot, squadra: primaria.squadra, ore: oreResidue,
  }, c.squadra)));

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

  // Guardia DS Masterclass: non si può rivelare/assegnare (nemmeno a mano da
  // admin) finché c'è una finestra extra ancora attiva o richieste in coda
  // non ancora avviate — altrimenti si scavalcherebbe la sequenza e si
  // spenderebbe prima del previsto rispetto all'ordine di interesse.
  if (asta.masterclass_squadra_attiva && new Date() < new Date(asta.masterclass_scadenza_attiva)) {
    throw new Error('Impossibile rivelare ora: un presidente sta usando il DS Masterclass, attendi la sua finestra extra.');
  }
  const { data: masterclassInCoda } = await supabase.from('masterclass_richieste')
    .select('id').eq('asta_id', astaId).is('avviato_at', null).limit(1);
  if (masterclassInCoda?.length) {
    throw new Error('Impossibile rivelare ora: ci sono utilizzi del DS Masterclass ancora in coda per questa asta.');
  }

  // Ordine interesse dal timestamp chiamate
  const { data: chiamate } = await supabase.from('chiamate')
    .select('squadra, created_at').eq('giocatore', asta.giocatore)
    .order('created_at', { ascending: true });
  const ordineInteresse = (chiamate || []).map(c => c.squadra);

  let vincitore, prezzoFinale, tutteOfferte = [];

  if (ordineInteresse.length <= 1) {
    // Unico interessato: nessuna vera competizione, quindi niente raccolta
    // offerte — il prezzo resta fissato a ¾Q come sempre. L'asta viene
    // comunque creata e messa in coda come tutte le altre (rispetta l'ordine
    // di chiamata e il distanziamento minimo tra le scadenze): a differenziarla
    // dalle altre è solo che qui il prezzo non dipende da nessuna offerta.
    vincitore = ordineInteresse[0] || asta.aperta_da;
    if (!vincitore) throw new Error('Nessun interessato trovato per questa asta.');
    prezzoFinale = parseFloat((Number(asta.quot || 0) * 0.75).toFixed(2));
  } else {
    // Offerte presenti
    const { data: offerteEsistenti } = await supabase.from('offerte_asta')
      .select('*').eq('asta_id', astaId);
    const squadreConOfferta = new Set((offerteEsistenti || []).map(o => o.squadra));

    // Offerta automatica per assenti: di norma pari alla quotazione;
    // resta però valido il limite massimo della liquidità disponibile (art. 6.4).
    const minOffertaAsta = parseFloat((Number(asta.quot || 0) * 0.75).toFixed(2));
    for (const sq of ordineInteresse) {
      if (!squadreConOfferta.has(sq)) {
        const { data: squadraOfferente } = await supabase.from('squadre')
          .select('bilancio').eq('name', sq).single();
        const bilancioDisp = Number(squadraOfferente?.bilancio || 0);
        const offertaAutomatica = parseFloat(Math.min(Number(asta.quot || 0), bilancioDisp).toFixed(2));

        // Se non ha liquidità nemmeno per la base d'asta, resta registrato come assente
        // ma non può essere considerato valido per l'aggiudicazione.
        if (offertaAutomatica >= minOffertaAsta) {
          await supabase.from('offerte_asta').upsert({
            asta_id: astaId, squadra: sq,
            importo: offertaAutomatica,
            per_vivaio: asta.per_vivaio, assente: true,
          }, { onConflict: 'asta_id,squadra' });
        }
      }
    }

    // Tutte le offerte ordinate. Ricontrolliamo la liquidità al momento della rivelazione:
    // un'offerta rimasta superiore al bilancio disponibile non può vincere.
    const { data: offerteRaw } = await supabase.from('offerte_asta')
      .select('*').eq('asta_id', astaId).order('importo', { ascending: false });
    for (const off of (offerteRaw || [])) {
      const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', off.squadra).single();
      if (Number(off.importo || 0) <= Number(sq?.bilancio || 0) + 0.0001) tutteOfferte.push(off);
    }
    if (!tutteOfferte.length) throw new Error('Nessuna offerta valida: nessun interessato ha liquidità sufficiente.');

    // Vincitore: max importo; parità → prima chiamata
    const maxImporto = Number(tutteOfferte?.[0]?.importo || 0);
    const pareggi = (tutteOfferte || []).filter(o => Number(o.importo) === maxImporto);
    vincitore = pareggi.length === 1
      ? pareggi[0].squadra
      : ordineInteresse.find(sq => pareggi.some(p => p.squadra === sq)) || pareggi[0]?.squadra;
    prezzoFinale = maxImporto;
    if (!vincitore) throw new Error('Nessun offerente');
  }

  await verificaRiacquistoConsentito(vincitore, asta.giocatore);

  // Trasferimento
  const oggi = new Date().toISOString().slice(0, 10);
  const stip  = parseFloat((Number(asta.quot) / 5).toFixed(2));
  const claus = await _calcolaClausolaPerSquadra(vincitore, Number(asta.quot), new Date());

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

  // Notifica Telegram: centralizzata qui così parte SEMPRE, sia che il reveal
  // avvenga in automatico (checkScadenzeAste, ogni 3 minuti) sia che lo
  // scateni un admin a mano — prima solo il secondo caso notificava.
  // Canale pubblico: risultato completo con l'elenco di tutte le offerte
  // ricevute. Privato: solo l'esito secco (vinta/persa) a chi era coinvolto.
  const altreOfferte = (tutteOfferte || []).filter(o => o.squadra !== vincitore);
  const elencoAltri = altreOfferte.length
    ? altreOfferte.map(o => `${o.squadra}: ${Number(o.importo).toFixed(2)}M${o.assente ? ' (auto)' : ''}`).join('\n')
    : null;
  await sendTelegramNotification('asta_svincolati_conclusa', {
    giocatore: asta.giocatore, vincitore, prezzo: prezzoFinale.toFixed(2), elencoAltri,
  });
  await sendTelegramNotification('asta_vinta', { giocatore: asta.giocatore, importo: prezzoFinale.toFixed(2) }, vincitore);
  for (const perdente of ordineInteresse.filter(sq => sq !== vincitore)) {
    await sendTelegramNotification('asta_persa', { giocatore: asta.giocatore, vincitore, importo: prezzoFinale.toFixed(2) }, perdente);
  }

  return { vincitore, prezzoFinale, offerte: tutteOfferte };
}

// (La vecchia completaUnicoInteressato — assegnazione istantanea per unico
// interessato, che saltava del tutto la coda e la scadenza a 12h/venerdì —
// è stata rimossa: ora anche l'unico interessato passa da un'asta vera,
// creata e messa in coda come tutte le altre, per rispettare sempre l'ordine
// di chiamata. Il prezzo resta comunque fissato a ¾Q, vedi rivelaECompletaAsta.)

// ── Check automatico: processa chiamate e aste scadute ───────────────────────
export async function checkScadenzeAste() {
  const ora = new Date();
  const oraISO = ora.toISOString();
  const risultati = [];

  // 1. Chiamate con scadenza_interesse scaduta → crea SEMPRE l'asta, anche con
  // un solo interessato (il prezzo resta comunque fissato a ¾Q, vedi
  // rivelaECompletaAsta). Prima un unico interessato veniva assegnato
  // all'istante, saltando la coda: questo rompeva l'ordine di chiamata e il
  // distanziamento minimo tra le scadenze per tutti quelli dopo di lui.
  // Ordine di elaborazione = ordine di scadenza (quindi di chiamata): niente
  // di arbitrario, la prima chiamata in ordine di tempo viene sempre gestita
  // prima delle successive.
  const { data: chiamateScadute } = await supabase.from('chiamate')
    .select('giocatore, quot, per_vivaio, scadenza_interesse, squadra, tipo')
    .eq('stato', 'aperta').eq('tipo', 'prima').lte('scadenza_interesse', oraISO)
    .order('scadenza_interesse', { ascending: true });

  for (const c of chiamateScadute || []) {
    try {
      const asta = await creaAstaDaChiamate(c.giocatore);
      risultati.push({ tipo: 'asta_creata', giocatore: c.giocatore, astaId: asta.id });
    } catch(e) {
      if (!e.message.includes('già esistente')) {
        risultati.push({ tipo: 'errore', giocatore: c.giocatore, error: e.message });
      }
    }
  }

  // 1.5. Aste ancora in raccolta offerte ma che scadono entro 1 ora → avvisa
  // (una sola volta, vedi flag promemoria_1h_inviato) chi non ha ancora
  // mandato un'offerta: prima si notificava solo all'apertura, ma per aste
  // lunghe (giorni) i presidenti se ne dimenticano.
  const traUnOra = new Date(ora.getTime() + 60 * 60000).toISOString();
  const { data: asteInScadenza } = await supabase.from('aste_svincolati')
    .select('id, giocatore, quot, scadenza, promemoria_1h_inviato')
    .eq('stato', 'raccolta_offerte').gt('scadenza', oraISO).lte('scadenza', traUnOra);

  for (const a of asteInScadenza || []) {
    if (a.promemoria_1h_inviato) continue;
    try {
      const [{ data: chiamate }, { data: offerte }] = await Promise.all([
        supabase.from('chiamate').select('squadra').eq('asta_id', a.id),
        supabase.from('offerte_asta').select('squadra').eq('asta_id', a.id),
      ]);
      const giaOfferto = new Set((offerte || []).map(o => o.squadra));
      const daAvvisare = [...new Set((chiamate || []).map(c => c.squadra))].filter(s => !giaOfferto.has(s));
      await Promise.all(daAvvisare.map(squadra => sendTelegramNotification('asta_svincolati_promemoria', {
        giocatore: a.giocatore, quotazione: a.quot,
      }, squadra)));
      const { error: updErr } = await supabase.from('aste_svincolati')
        .update({ promemoria_1h_inviato: true }).eq('id', a.id);
      if (updErr && !isMissingColumnError(updErr)) throw updErr;
      risultati.push({ tipo: 'promemoria_inviato', giocatore: a.giocatore, squadre: daAvvisare });
    } catch(e) {
      if (!isMissingColumnError(e)) risultati.push({ tipo: 'errore', giocatore: a.giocatore, error: e.message });
    }
  }

  // 2. Aste con scadenza offerte scaduta → rivela e completa
  // Stesso principio: elaborate in ordine di scadenza (= ordine di chiamata
  // originale), non nell'ordine arbitrario in cui il database le restituisce.
  // Importante per il bilancio: se una squadra vince più aste scadute insieme,
  // ora "spende" prima su quella chiamata per prima, in modo prevedibile.
  const { data: asteScadute } = await supabase.from('aste_svincolati')
    .select('*').eq('stato', 'raccolta_offerte').lte('scadenza', oraISO)
    .order('scadenza', { ascending: true });

  for (const a of asteScadute || []) {
    try {
      // Se qualcuno ha attivato il DS Masterclass su questa asta, l'asta resta
      // "raccolta_offerte" oltre la scadenza finché la coda di attivazioni non
      // si esaurisce (vedi _avanzaMasterclass): finché non è pronta, questo
      // ciclo la rivede a ogni giro senza rivelarla.
      const pronta = await _avanzaMasterclass(a);
      if (!pronta) { risultati.push({ tipo: 'masterclass_in_corso', giocatore: a.giocatore }); continue; }
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
  // Colonne effettivamente usate dal Listone (evita di scaricare gol_subiti,
  // rigori_calciati, autogol, numero, updated_at per ~650 righe ad ogni caricamento).
  const { data, error } = await supabase
    .from('listone')
    .select('id, nome, ruolo, anni, squadra_serie_a, fanta_squadra, quot, salario, clausola, fuori_lista, partite_voto, media_voto, media_fantavoto, gol_fatti, assist, ammonizioni, espulsioni, rigori_parati, rigori_segnati, rigori_sbagliati')
    .order('quot', { ascending: false });
  if (error) return [];
  return data;
}

export async function getListoneBySquadra(fantaSquadra) {
  const { data, error } = await supabase.from('listone').select('*').eq('fanta_squadra', fantaSquadra).order('ruolo');
  if (error) return [];
  return data;
}

// Storico delle variazioni di quotazione di un giocatore (tabella
// storico_quotazioni, popolata da importListoneDaExcel ad ogni import in cui
// la quotazione cambia). Usato dal mini-grafico "trend quotazione".
export async function getStoricoQuotazioni(nome) {
  if (!nome) return [];
  const { data, error } = await supabase
    .from('storico_quotazioni')
    .select('quot, registrato_il')
    .ilike('nome', nome.trim())
    .order('registrato_il', { ascending: true });
  if (error) return [];
  return data || [];
}

// Righe del listone con una FantaSquadra assegnata che però non corrisponde a
// nessuna delle squadre canoniche (nomeSquadre): quasi sempre un cambio di
// grafia del nome tra l'Excel e l'app (vedi caso Castro/Finocchiona) che
// altrimenti passa inosservato finché qualcuno non nota lo stemma mancante o
// la rosa non aggiornata. squadreCanoniche va passato dal chiamante (App.jsx,
// dove vive già l'elenco squadre) per non duplicarlo qui.
export async function getConflittiListone(squadreCanoniche) {
  const { data, error } = await supabase
    .from('listone')
    .select('nome, fanta_squadra, squadra_serie_a, quot')
    .not('fanta_squadra', 'is', null);
  if (error) return [];
  const norm = s => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  const canoniciNorm = new Set((squadreCanoniche || []).map(norm));
  return (data || []).filter(r => r.fanta_squadra && !canoniciNorm.has(norm(r.fanta_squadra)));
}

// Importa il listone da un array di righe Excel (usato nella pagina admin)
// Aggiorna SOLO statistiche per giocatori già in rosa; quot/stip/clausola vengono aggiornati solo nel listone
export async function importListoneDaExcel(rows) {
  const mapped = rows
    .filter(r => (r.Nome || r.nome || '').trim())
    .map(r => {
      const nome = (r.Nome || r.nome || '').trim();
      const quot = parseFloat(String(r['QUOT.'] || r.quot || r.Quotazione || 0).replace('€', '').replace(',', '.')) || 0;
      // .toFixed(2) su ENTRAMBI i rami: se "Salario"/"Clausola Rescissoria" arrivano
      // dal file Excel come numero (non stringa), SheetJS può portarsi dietro la
      // precisione doppia grezza della cella (es. 6.800000000000001 invece di 6.8)
      // — senza arrotondare qui quel valore veniva salvato e mostrato così com'è.
      const salario = parseFloat((parseFloat(String(r['Salario'] || r.salario || 0).replace('€', '').replace(',', '.')) || (quot / 5)).toFixed(2));
      const clausola = parseFloat((parseFloat(String(r['Clausola Rescissoria'] || r.clausola || 0).replace('€', '').replace(',', '.')) || (quot * 1.75)).toFixed(2));
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

  // Rileva le variazioni di quotazione PRIMA di sovrascrivere il listone, per
  // poterle registrare in storico_quotazioni (alimenta il grafico "trend
  // quotazione" mostrato nei popup giocatore). Letture in batch da 200 nomi
  // con .in(), non una query per giocatore.
  const quotPrecedenti = {};
  for (let i = 0; i < mapped.length; i += 200) {
    const nomiBatch = mapped.slice(i, i + 200).map(r => r.nome);
    const { data } = await supabase.from('listone').select('nome, quot').in('nome', nomiBatch);
    for (const r of (data || [])) quotPrecedenti[r.nome] = r.quot;
  }
  const oggi = new Date().toISOString().slice(0, 10);
  const nuovoStorico = mapped
    .filter(r => r.quot > 0 && Number(quotPrecedenti[r.nome]) !== Number(r.quot))
    .map(r => ({ nome: r.nome, quot: r.quot, registrato_il: oggi }));

  // Upsert in batch da 100
  for (let i = 0; i < mapped.length; i += 100) {
    const batch = mapped.slice(i, i + 100);
    const { error } = await supabase.from('listone').upsert(batch, { onConflict: 'nome' });
    if (error) throw error;
  }

  // Scrive lo storico quotazioni (best-effort: se la tabella non esiste ancora
  // non deve bloccare l'import del listone).
  try {
    for (let i = 0; i < nuovoStorico.length; i += 200) {
      await supabase.from('storico_quotazioni').insert(nuovoStorico.slice(i, i + 200));
    }
  } catch (e) { console.warn('storico_quotazioni: scrittura fallita (tabella creata?):', e.message); }

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

  // Controlla e paga i bonus clausola non ancora completati (best-effort: se
  // fallisce non deve bloccare l'import, che è la parte critica). Prima questa
  // chiamata esisteva solo in una pagina admin senza alcuna route collegata,
  // quindi in pratica i bonus non venivano mai controllati/pagati.
  try { await checkECompletaBonus(); } catch (e) { console.warn('checkECompletaBonus fallito dopo import listone:', e.message); }

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
  if (!trattativaId) return [];
  const { data, error } = await supabase
    .from('trattative_bonus')
    .select('*')
    .eq('trattativa_id', trattativaId);
  if (error) {
    console.warn('getBonusTrattativa error:', error.message);
    return [];
  }
  return (data || []).sort((a, b) =>
    String(a.created_at || a.id || '').localeCompare(String(b.created_at || b.id || ''))
  );
}

// Come getBonusTrattativa ma per più trattative in una volta sola (1 query invece
// di N): usata dalla pagina Mercato che altrimenti farebbe una query per ogni
// trattativa visibile ad ogni refresh (anche in risposta a un realtime event
// scatenato da un'azione di un altro utente).
export async function getBonusTrattativeBatch(trattativaIds) {
  const ids = (trattativaIds || []).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('trattative_bonus')
    .select('*')
    .in('trattativa_id', ids);
  if (error) {
    console.warn('getBonusTrattativeBatch error:', error.message);
    return {};
  }
  const byId = {};
  for (const id of ids) byId[id] = [];
  for (const b of (data || [])) {
    (byId[b.trattativa_id] ||= []).push(b);
  }
  for (const id of ids) {
    byId[id].sort((a, b) => String(a.created_at || a.id || '').localeCompare(String(b.created_at || b.id || '')));
  }
  return byId;
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

    // Segna come attivate (non le cancelliamo: restano visibili come storico
    // "Attivata" nella pagina Altro di entrambe le squadre coinvolte).
    await supabase.from('clausole').update({ completata: true, attivata: true }).eq('trattativa_bonus_id', bonus.id);

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
  const oggi = new Date();
  const oggiStr = oggi.toISOString().slice(0, 10);

  const { data: tutti } = await supabase
    .from('rosa')
    .select('*')
    .eq('in_vivaio', false);

  if (!tutti?.length) return { aggiornati: [], svincolati: [] };

  const aggiornati = [];
  const svincolati = [];

  for (const p of tutti) {
    const isU21 = Number(p.anni || 0) > 0 && Number(p.anni || 0) <= 21;
    const ac = Number(p.anni_contratto || 1);
    const stipAttuale = Number(p.stip || 0);

    // Prestiti: il contratto del cartellino continua, ma non cambiamo lo stipendio temporaneo del ricevente.
    if (p.in_prestito) {
      await supabase.from('rosa').update({ anni_contratto: ac + 1 }).eq('id', p.id);
      aggiornati.push({ nome: p.nome, squadra: p.squadra, acPrima: ac, acDopo: ac + 1, prestito: true, percAumento: 0 });
      continue;
    }

    // Fine secondo anno: se non confermato entro il 31/05, svincolo automatico il 01/06.
    if (ac === 2 && !p.rinnovo_confermato) {
      await supabase.from('rosa').delete().eq('id', p.id);
      await supabase.from('svincolati').upsert({
        nome: p.nome, ruolo: p.ruolo, anni: p.anni, quot: p.quot,
        stip: p.stip, clausola: _calcolaClausolaRegolamento(p.quot),
        fuori_lista: p.fuori_lista || false, squadra_serie_a: p.squadra_serie_a,
        stagione: stagioneDaData(oggi), updated_at: new Date().toISOString(),
      }, { onConflict: 'nome,stagione' });
      svincolati.push({ nome: p.nome, squadra: p.squadra, motivo: 'contratto_biennale_non_rinnovato' });
      continue;
    }

    // Gli anni di contratto avanzano sempre, anche per U21 (art. 4.8.1).
    // Gli U21 non subiscono aumenti/riduzioni percentuali finché restano U21.
    let percAumento = 0;
    if (!isU21) {
      if (ac === 1) percAumento = 10;
      else if (ac === 2) percAumento = 20;
      else if (ac === 3 && !p.bonus_fedelta_applicato) percAumento = -10;
      else percAumento = 0;
    }

    const nuovoStip = percAumento !== 0
      ? parseFloat((stipAttuale * (1 + percAumento / 100)).toFixed(2))
      : stipAttuale;

    const update = {
      anni_contratto: ac + 1,
      stip: nuovoStip,
      stip_originale: nuovoStip,
      rinnovo_confermato: false,
    };
    if (ac === 3 && !isU21) update.bonus_fedelta_applicato = true;

    await supabase.from('rosa').update(update).eq('id', p.id);

    aggiornati.push({
      nome: p.nome, squadra: p.squadra,
      acPrima: ac, acDopo: ac + 1,
      stipPrima: stipAttuale, stipDopo: nuovoStip,
      percAumento, isU21,
    });
  }

  return { aggiornati, svincolati };
}

// Conferma rinnovo biennale per un giocatore (da fare entro 31/05)
export async function confermRinnovoBiennale(playerId) {
  const now = new Date();
  const deadline = new Date(now.getFullYear(), 4, 31, 23, 59, 59, 999); // 31/05 23:59
  const seasonStarted = new Date(now.getFullYear(), 5, 1, 0, 0, 0, 0);
  if (now >= seasonStarted || now > deadline) {
    throw new Error('Rinnovo non consentito: la scadenza è il 31/05 alle 23:59.');
  }
  const { error } = await supabase.from('rosa').update({ rinnovo_confermato: true }).eq('id', playerId);
  if (error) throw error;
}

// ─── PREMI INDIVIDUALI (art. 12.4-12.5) ──────────────────────────────────────

export async function calcolaPremiIndividuali(stagione = getStagioneQuota()) {
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

export async function getNotizie(stagione = getStagioneQuota(), limit = 50) {
  const { data, error } = await supabase.from('notizie').select('*, commenti_notizie(count)').eq('stagione', stagione).order('pinnata', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  if (!error && data) data.forEach(n => { n.commenti_count = n.commenti_notizie?.[0]?.count ?? 0; delete n.commenti_notizie; });
  if (error) throw error;
  return data || [];
}
function isMissingColumnError(error) {
  const msg = (error?.message || '').toLowerCase();
  return msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find');
}

export async function insertNotizia({ autore, squadra, categoria, titolo, testo, immagini = [], immaginiThumb = [], stagione = getStagioneQuota() }) {
  const payload = { autore, squadra, categoria, titolo, testo, immagini, immagini_thumb: immaginiThumb, stagione };
  let { data, error } = await supabase.from('notizie').insert(payload).select().single();
  if (error && isMissingColumnError(error)) {
    // La colonna immagini_thumb non esiste ancora (migrazione non eseguita):
    // riprova salvando solo l'immagine full-size, niente si perde.
    const { immagini_thumb, ...fallbackPayload } = payload;
    ({ data, error } = await supabase.from('notizie').insert(fallbackPayload).select().single());
  }
  if (error) throw error;
  return data;
}
export async function updateNotizia(id, fields) {
  const payload = { ...fields, updated_at: new Date().toISOString() };
  let { data, error } = await supabase.from('notizie').update(payload).eq('id', id).select().single();
  if (error && isMissingColumnError(error) && 'immagini_thumb' in payload) {
    const { immagini_thumb, ...fallbackPayload } = payload;
    ({ data, error } = await supabase.from('notizie').update(fallbackPayload).eq('id', id).select().single());
  }
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
// Genera due versioni dell'immagine: una "thumb" leggera per il feed (dove viene
// mostrata comunque piccola dentro una griglia) e una "full" per il visualizzatore
// a schermo intero. Questo evita che ogni utente scarichi l'immagine da 1600px
// solo per vederla renderizzata a ~300px nella griglia del post — la causa
// principale dei picchi di cached egress quando viene pubblicata una notizia con foto.
export async function uploadNotiziaImmagine(file, path) {
  if (!file) throw new Error('Nessun file selezionato');
  const [optimizedFull, optimizedThumb] = await Promise.all([
    compressForUpload(file, 'news'),
    compressForUpload(file, 'news_thumb'),
  ]);
  const requested = ensureWebpPath(path || `notizie/${optimizedFull.name}`);
  const prefix = requested.split('/').slice(0, -1).join('/') || 'notizie';
  const finalPath = uniqueStoragePath(prefix, optimizedFull.name);
  const thumbPath = finalPath.replace(/\.webp$/, '_thumb.webp');

  const { error } = await supabase.storage.from('notizie-immagini').upload(finalPath, optimizedFull, {
    upsert: false,
    contentType: optimizedFull.type || WEBP_MIME,
    cacheControl: '31536000',
  });
  if (error) throw error;

  const { error: thumbError } = await supabase.storage.from('notizie-immagini').upload(thumbPath, optimizedThumb, {
    upsert: false,
    contentType: optimizedThumb.type || WEBP_MIME,
    cacheControl: '31536000',
  });
  if (thumbError) throw thumbError;

  const { data: { publicUrl: full } } = supabase.storage.from('notizie-immagini').getPublicUrl(finalPath);
  const { data: { publicUrl: thumb } } = supabase.storage.from('notizie-immagini').getPublicUrl(thumbPath);
  return { full, thumb };
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

// ─── MODALITÀ MERCATO SVINCOLATI ──────────────────────────────────────────────
// 'chiuso'  → nessuna chiamata/offerta possibile
// 'normale' → comportamento di sempre (chiamate mar-mer, aste il venerdì)
// 'libero'  → chiamabili in ogni momento; 48h per manifestare interesse, poi
//             12h a busta chiusa se c'è più di un interessato (altrimenti va
//             subito all'unico interessato, come nel normale)
// Default 'normale' se non è mai stata impostata (nessuna migrazione richiesta:
// la chiave semplicemente non esiste finché un admin non la cambia).
export async function getModalitaSvincolati() {
  const { data } = await supabase.from('impostazioni').select('valore').eq('chiave', 'modalita_svincolati').limit(1);
  return data?.[0]?.valore || 'normale';
}

export async function setModalitaSvincolati(valore) {
  // valore: 'chiuso' | 'normale' | 'libero'
  await supabase.from('impostazioni').upsert({ chiave: 'modalita_svincolati', valore }, { onConflict: 'chiave' });
}

// Modalità libera (art. 6.3-bis): 48h fisse dalla chiamata per l'interesse,
// poi 12h fisse a busta chiusa — nessun ancoraggio al calendario settimanale.
// La scadenza viene calcolata e salvata sulla singola chiamata nel momento in
// cui viene effettuata: cambiare questa costante non è mai retroattivo,
// riguarda solo le chiamate fatte da qui in avanti.
export function calcolaScadenzaInteresseLibero(dataChiamata = new Date()) {
  return new Date(new Date(dataChiamata).getTime() + 48 * 60 * 60 * 1000);
}

// Stesso freeze notturno delle aste a discesa (00:00-08:00, ora locale): i
// minuti passati in quella finestra non contano ai fini della scadenza.
const _FREEZE_INIZIO_H = 0;
const _FREEZE_FINE_H = 8;
function _isInFreezeOra(ora) { return ora >= _FREEZE_INIZIO_H && ora < _FREEZE_FINE_H; }

// Calcola una scadenza a "minutiAttivi" minuti di distanza da fromTime,
// saltando interamente la finestra di freeze 00:00-08:00 (se l'intervallo la
// attraversa, quei minuti vengono "recuperati" dopo le 08:00).
function _scadenzaConFreeze(fromTime, minutiAttivi) {
  let rimasti = minutiAttivi;
  let t = new Date(fromTime);
  while (rimasti > 0) {
    const ora = t.getHours();
    if (_isInFreezeOra(ora)) {
      const next08 = new Date(t);
      next08.setHours(_FREEZE_FINE_H, 0, 0, 0);
      if (next08 <= t) next08.setDate(next08.getDate() + 1);
      t = next08;
    } else {
      const mezzanotte = new Date(t);
      mezzanotte.setDate(mezzanotte.getDate() + 1);
      mezzanotte.setHours(_FREEZE_INIZIO_H, 0, 0, 0);
      const minutiFinestra = (mezzanotte.getTime() - t.getTime()) / 60000;
      if (minutiFinestra >= rimasti) {
        t = new Date(t.getTime() + rimasti * 60000);
        rimasti = 0;
      } else {
        rimasti -= minutiFinestra;
        t = mezzanotte;
      }
    }
  }
  return t;
}

export function calcolaScadenzaOfferteLibero(scadenzaInteresse) {
  return _scadenzaConFreeze(scadenzaInteresse, 12 * 60);
}

// Intervallo minimo di 30 minuti tra le scadenze offerte di due aste in
// modalità libera. IMPORTANTE: non basta guardare le aste GIÀ create (tabella
// aste_svincolati) — se più chiamate sono ancora contemporaneamente in attesa
// che scada il loro interesse (nessuna asta esiste ancora per nessuna di
// loro), bisogna simulare l'intera coda delle chiamate con scadenza_interesse
// precedente o uguale a quella data, applicando lo stesso distanziamento che
// verrà realmente usato quando ciascuna, in ordine, diventerà un'asta vera.
// Per le chiamate già trasformate in un'asta reale si usa la sua scadenza
// effettiva (non viene ricalcolata), per le altre si simula.
async function _calcolaScadenzaOfferteLiberoConCoda(primariaTarget) {
  try {
    const { data: coda } = await supabase
      .from('chiamate')
      .select('giocatore, scadenza_interesse, asta_id')
      .eq('tipo', 'prima')
      .eq('modalita', 'libero')
      .lte('scadenza_interesse', primariaTarget.scadenza_interesse)
      .order('scadenza_interesse', { ascending: true });

    let lista = coda || [];
    if (!lista.some(c => c.giocatore === primariaTarget.giocatore)) {
      lista = [...lista, {
        giocatore: primariaTarget.giocatore,
        scadenza_interesse: primariaTarget.scadenza_interesse,
        asta_id: primariaTarget.asta_id || null,
      }].sort((a, b) => new Date(a.scadenza_interesse) - new Date(b.scadenza_interesse));
    }

    // Scadenze reali delle chiamate già convertite in asta, in un'unica query.
    const astaIds = [...new Set(lista.map(c => c.asta_id).filter(Boolean))];
    const scadenzeReali = {};
    if (astaIds.length) {
      const { data: asteReali } = await supabase.from('aste_svincolati').select('id, scadenza').in('id', astaIds);
      for (const a of (asteReali || [])) scadenzeReali[a.id] = new Date(a.scadenza);
    }

    let ultima = null;
    for (const c of lista) {
      let effettiva;
      if (c.asta_id && scadenzeReali[c.asta_id]) {
        effettiva = scadenzeReali[c.asta_id];
      } else {
        const naturale = calcolaScadenzaOfferteLibero(new Date(c.scadenza_interesse));
        // Anche lo spostamento per il distanziamento minimo deve rispettare il
        // freeze notturno: "+30 minuti" da un orario vicino a mezzanotte non
        // può ricadere dentro la finestra 00:00-08:00, va calcolato come 30
        // minuti ATTIVI (esattamente come le 12h iniziali), altrimenti si
        // ottengono scadenze tipo 00:18 o 00:48 dentro il freeze.
        const minimaSuccessiva = ultima ? _scadenzaConFreeze(ultima, 30) : null;
        effettiva = minimaSuccessiva && naturale < minimaSuccessiva ? minimaSuccessiva : naturale;
      }
      if (c.giocatore === primariaTarget.giocatore) return effettiva;
      ultima = effettiva;
    }
    return calcolaScadenzaOfferteLibero(new Date(primariaTarget.scadenza_interesse));
  } catch {
    // Best-effort: se qualche colonna non esiste ancora (migrazione non
    // applicata), non blocchiamo comunque la creazione/anteprima dell'asta.
    return calcolaScadenzaOfferteLibero(new Date(primariaTarget.scadenza_interesse));
  }
}

// Trasferimenti differiti
export async function getTrasferimentiDifferiti() {
  const { data } = await supabase.from('trattative').select('*').eq('stato', 'accettata_differita').order('updated_at', { ascending: false });
  return data || [];
}

// FPF: applica multe a tutte le squadre che hanno sforato
// Art. 7.3/7.3.1: il controllo avviene due volte per stagione sportiva.
// Correzione v11: la penalità viene considerata già applicata solo per lo stesso
// periodo FPF, non per tutta la stagione. Così il controllo 16/02→15/09 e quello
// 16/09→15/02 possono entrambi generare una multa nella stessa stagione.
export async function applicaMulteFPFTutte(stagione = getStagioneQuota()) {
  const sem = getSemestreCorrente();
  const fpfMap = await getFpfTutteSquadre();
  const oggi = new Date().toISOString().slice(0, 10);
  const results = [];
  const periodoKey = `${sem.inizioStr}_${sem.fineStr}`;
  const descrizionePenalita = `FPF ${stagione} — ${sem.label} (${sem.inizioStr} → ${sem.fineStr})`;

  for (const [squadra, netto] of Object.entries(fpfMap)) {
    const { multa, pt, euro } = calcolaFairSpending(netto);
    if (multa === 0) { results.push({ squadra, skip: true, motivo: 'in_regola', periodo: periodoKey }); continue; }

    // Check già applicata per questa squadra, stagione e specifico periodo FPF.
    // Non usiamo solo codice_tipo='fpf' + stagione perché il regolamento prevede due controlli annuali.
    const { data: penGia } = await supabase.from('penalita')
      .select('id')
      .eq('squadra', squadra)
      .eq('codice_tipo', 'fpf')
      .eq('stagione', stagione)
      .eq('applicata', true)
      .ilike('descrizione', `%${periodoKey}%`)
      .limit(1);
    if (penGia?.length) { results.push({ squadra, skip: true, motivo: 'gia_applicata_periodo', periodo: periodoKey }); continue; }

    const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
    if (!sq) { results.push({ squadra, skip: true, motivo: 'squadra_not_found', periodo: periodoKey }); continue; }

    const nuovoBilancio = parseFloat((sq.bilancio - multa).toFixed(2));

    await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
    if (pt > 0) {
      const { data: cls } = await supabase.from('classifica').select('pt').eq('squadra', squadra).single();
      if (cls) await supabase.from('classifica').update({ pt: Math.max(0, Number(cls.pt || 0) - pt), updated_at: new Date().toISOString() }).eq('squadra', squadra);
    }
    await supabase.from('movimenti').insert({ squadra, descrizione: `Multa FPF ${stagione} ${periodoKey} (netto: ${netto.toFixed(1)}M)`, uscita: multa, data: oggi });
    // Insert penalita record: descrizione contiene periodoKey per evitare che il primo controllo annuale blocchi il secondo.
    await supabase.from('penalita').insert({ squadra, stagione, codice_tipo: 'fpf', descrizione: `${descrizionePenalita} [${periodoKey}]`, importo: multa, pt_penalita: pt, euro_penalita: euro, applicata: true, data: oggi });

    results.push({ squadra, ok: true, netto, multa, pt, euro, periodo: periodoKey });
  }
  return results;
}

// Premi: distribuisci premi campionato in base alla classifica attuale
export async function applicaPremiCampionato(stagione = getStagioneQuota()) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: classifica } = await supabase.from('classifica').select('squadra, pt, pt_totali').order('pt', { ascending: false });
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
  try {
    await _insertNotificaApp(type, payload, squadra);
  } catch (e) {
    console.warn('[NotificheApp] insert failed silently:', type, e);
  }
}

// ─── CENTRO NOTIFICHE IN-APP ──────────────────────────────────────────────────
// Specchio (in italiano semplice, senza HTML) dei messaggi Telegram, salvato
// nel DB per la campanella in header. squadra_destinataria = null → notifica
// pubblica, visibile a tutte le squadre (letta/non letta è comunque per-utente,
// vedi notifiche_lette). Un tipo non gestito qui non genera nessuna riga.
function _formatNotificaApp(type, p = {}) {
  const LINK = {
    notizia_pinnata: '/news', nuova_notizia: '/news', commento_ricevuto: '/news',
    risposta_commento: '/news', scadenza_imminente: '/news',
    mercato_aperto: '/mercato', mercato_chiuso: '/mercato', trattativa_ricevuta: '/mercato',
    trattativa_accettata: '/mercato', trattativa_rifiutata: '/mercato', trattativa_controfferta: '/mercato',
    chiamata_svincolati: '/mercato', asta_svincolati: '/mercato', asta_svincolati_promemoria: '/mercato', asta_svincolati_conclusa: '/mercato',
    asta_tra_presidenti: '/mercato', asta_assegnata: '/mercato', asta_vinta: '/mercato', asta_persa: '/mercato',
    ds_masterclass_offerte: '/mercato', ds_masterclass_usato: '/mercato', svincolo: '/mercato',
    scelta_allenatore: '/squadre', investimento_acquistato: '/squadre', movimento_privato: '/squadre',
    tassa_applicata: '/squadre', stipendi_applicati: '/squadre', stadio_applicato: '/squadre',
  };
  const link = LINK[type] || null;
  switch (type) {
    case 'chiamata_svincolati': return { titolo: 'Nuova chiamata', corpo: `${p.giocatore} · Q${p.quotazione} — ${p.squadra} ha manifestato interesse`, link };
    case 'asta_svincolati': return { titolo: 'Asta svincolati aperta', corpo: `${p.giocatore} · Q${p.quotazione} — chiamato da ${p.squadra}`, link };
    case 'asta_svincolati_promemoria': return { titolo: 'Ultima chiamata — manca 1 ora', corpo: `${p.giocatore} · Q${p.quotazione} — non hai ancora inviato un'offerta`, link };
    case 'asta_svincolati_conclusa': return { titolo: 'Asta conclusa', corpo: `${p.giocatore} vinta da ${p.vincitore} per ${p.prezzo}M`, link };
    case 'asta_tra_presidenti': return { titolo: 'Nuova asta tra presidenti', corpo: `${p.giocatore} · Q${p.quotazione} — indetta da ${p.proprietario}`, link };
    case 'asta_assegnata': return { titolo: 'Asta conclusa', corpo: p.vincitore ? `${p.giocatore} acquistato da ${p.vincitore} per ${p.importo}M` : `${p.giocatore} — asta chiusa senza vincitore`, link };
    case 'asta_vinta': return { titolo: 'Asta vinta!', corpo: `${p.giocatore} è tuo per ${p.importo}M`, link };
    case 'asta_persa': return { titolo: 'Asta persa', corpo: `${p.giocatore} — vincitore: ${p.vincitore} (${p.importo}M)`, link };
    case 'ds_masterclass_offerte': return { titolo: 'DS Masterclass attivato', corpo: `${p.giocatore} — offerta più alta: ${p.offertaRivelata ? p.offertaRivelata + 'M' : 'nessuna offerta'}`, link };
    case 'ds_masterclass_usato': return { titolo: 'DS Masterclass utilizzato', corpo: `${p.squadra} ha attivato un utilizzo per l'asta di ${p.giocatore}`, link };
    case 'svincolo': return { titolo: 'Giocatore svincolato', corpo: `${p.giocatore} · Q${p.quotazione} — lascia ${p.squadra}`, link };
    case 'scelta_allenatore': return { titolo: 'Nuova scelta allenatore', corpo: `${p.squadra} — ${p.nomeAllenatore}`, link };
    case 'investimento_acquistato': return { titolo: 'Nuovo investimento', corpo: `${p.squadra} — ${p.nome} (${p.costo}M)`, link };
    case 'trattativa_ricevuta': return { titolo: 'Nuova offerta ricevuta', corpo: `${p.giocatore} — ${p.importo}M da ${p.da_squadra}`, link };
    case 'trattativa_accettata': return { titolo: 'Trasferimento completato', corpo: `${p.giocatore} per ${p.importo}M — da ${p.a_squadra} a ${p.da_squadra}`, link };
    case 'trattativa_rifiutata': return { titolo: 'Offerta rifiutata', corpo: `${p.giocatore} (${p.importo}M) non accettata`, link };
    case 'trattativa_controfferta': return { titolo: 'Controfferta ricevuta', corpo: `${p.giocatore} — nuova richiesta ${p.importo}M`, link };
    case 'nuova_notizia': return { titolo: p.squadra || p.autore || 'Lega Admin', corpo: p.titolo, link };
    case 'notizia_pinnata': return { titolo: 'Notizia pinnata', corpo: p.titolo, link };
    case 'commento_ricevuto': return { titolo: 'Nuovo commento', corpo: `${p.autore_squadra || p.autore} ha commentato: ${p.titolo}`, link };
    case 'risposta_commento': return { titolo: 'Nuova risposta', corpo: `${p.autore_squadra || p.autore} ti ha risposto: ${p.titolo}`, link };
    case 'scadenza_imminente': return { titolo: `Scadenza tra ${p.giorni} giorn${Number(p.giorni) === 1 ? 'o' : 'i'}`, corpo: p.label, link };
    case 'mercato_aperto': return { titolo: 'Mercato aperto', corpo: `Sessione ${p.periodo}`, link };
    case 'mercato_chiuso': return { titolo: 'Mercato chiuso', corpo: 'La finestra di trasferimenti è terminata.', link };
    case 'tassa_applicata': return { titolo: 'Tasse settimanali applicate', corpo: `Settimana del ${p.domenica}`, link };
    case 'stipendi_applicati': return { titolo: 'Stipendi mensili addebitati', corpo: `Mese: ${p.mese}`, link };
    case 'stadio_applicato': return { titolo: 'Entrate stadio accreditate', corpo: `Mese: ${p.mese}`, link };
    case 'movimento_privato': return { titolo: 'Movimento', corpo: `${p.entrata ? '+' + p.entrata : '-' + p.uscita}M — ${p.descrizione}`, link };
    default: return null;
  }
}

async function _insertNotificaApp(type, payload, squadra) {
  const f = _formatNotificaApp(type, payload);
  if (!f) return; // tipo non mappato: nessuna notifica in-app
  await supabase.from('notifiche_app').insert({
    tipo: type, titolo: f.titolo, corpo: f.corpo || null, link_pagina: f.link,
    squadra_destinataria: squadra || null,
  });
}

// Notifiche visibili a `squadra` (private sue + pubbliche di tutti), più recenti
// prima, escluse quelle che questa squadra ha eliminato dalla propria vista.
export async function getNotificheApp(squadra, limit = 30) {
  const { data: notifiche } = await supabase.from('notifiche_app')
    .select('*')
    .or(`squadra_destinataria.eq.${squadra},squadra_destinataria.is.null`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!notifiche?.length) return [];
  const ids = notifiche.map(n => n.id);
  const { data: stati } = await supabase.from('notifiche_lette')
    .select('notifica_id, nascosta').eq('squadra', squadra).in('notifica_id', ids);
  const letteSet = new Set((stati || []).map(l => l.notifica_id));
  const nascosteSet = new Set((stati || []).filter(l => l.nascosta).map(l => l.notifica_id));
  return notifiche
    .filter(n => !nascosteSet.has(n.id))
    .map(n => ({ ...n, letta: letteSet.has(n.id) }));
}

export async function segnaNotificaLetta(notificaId, squadra) {
  await supabase.from('notifiche_lette').upsert(
    { squadra, notifica_id: notificaId }, { onConflict: 'squadra,notifica_id' }
  );
}

export async function segnaTutteNotificheLette(notificheIds, squadra) {
  if (!notificheIds?.length) return;
  await supabase.from('notifiche_lette').upsert(
    notificheIds.map(id => ({ squadra, notifica_id: id })), { onConflict: 'squadra,notifica_id' }
  );
}

// Elimina una notifica dalla propria visualizzazione (per-squadra): se è
// pubblica resta visibile alle altre squadre, solo chi la elimina non la
// vede più. Implicitamente la segna anche come letta.
export async function nascondiNotifica(notificaId, squadra) {
  await supabase.from('notifiche_lette').upsert(
    { squadra, notifica_id: notificaId, nascosta: true }, { onConflict: 'squadra,notifica_id' }
  );
}

export function subscribeNotificheApp(callback) {
  return supabase.channel('notifiche-app-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifiche_app' }, callback)
    .subscribe();
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
    if (obIds?.length) await supabase.from('progresso_obiettivi').delete().in('obiettivo_id', obIds.map(o=>o.id)).eq('squadra', squadra);
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

// Nucleo comune a "Settimanale" e "01/08": stessa identica logica di
// riconoscimento (giocatore in rosa / tra gli svincolati / nuovo / uscito dal
// database), differiscono SOLO per se la quotazione (quindi stipendio e
// clausola) dei giocatori già in rosa viene aggiornata subito oppure no.
// L'unificazione evita che le due versioni si comportino diversamente per un
// dettaglio dimenticato in una sola delle due (come successo con la creazione
// dei nuovi svincolati, che esisteva solo in una delle due funzioni).
async function _importDatabaseCore(rows, stagione, { aggiornaQuotazioneRosa }) {
  // Aggiorna listone + stats rosa via funzione esistente (match case-insensitive per nome)
  await importListoneDaExcel(rows);

  const { data: rosaAll } = await supabase.from('rosa').select('id, nome, anni, stip, fuori_lista').eq('in_vivaio', false);
  const { data: svinAll }  = await supabase.from('svincolati').select('id, nome, fuori_lista').eq('stagione', stagione);

  // Normalizza accenti e spazi multipli (non la punteggiatura, per non fondere
  // per errore giocatori realmente diversi come "Castro" e "Castro S."): serve
  // solo a tollerare piccole variazioni di formattazione tra Excel e database.
  const normPlayerName = s => (s || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

  const rosaMap  = {};
  for (const p of (rosaAll  || [])) rosaMap[normPlayerName(p.nome)]  = p;
  const svinMap  = {};
  for (const s of (svinAll  || [])) svinMap[normPlayerName(s.nome)]  = s;

  let rosaAggiornati = 0, svinAggiornati = 0, nuoviCreati = 0;
  const nonTrovati = [];
  const nuoviCreatiNomi = [];
  const BATCH = 50;

  const validRows = rows.filter(r => (r['Nome'] || '').trim());
  const nomiExcel = new Set(validRows.map(r => normPlayerName(r['Nome'])));

  for (let i = 0; i < validRows.length; i += BATCH) {
    await Promise.all(validRows.slice(i, i + BATCH).map(async r => {
      const nome = (r['Nome'] || '').trim();
      const nomeLower = normPlayerName(nome);
      const quot = Number(r['QUOT.'] || 0);
      const squadra_serie_a = (r['Sq.'] || '').trim() || null;
      const anni = Number(r['Under'] || r['Età'] || 0) || null;
      const ruolo = (r['R.MANTRA'] || '').trim() || null;
      const fuoriListaRiga = Boolean((r['Fuori lista'] || '').toString().trim());
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
      const statsSvin = { ...statsRosa };

      if (rosaMap[nomeLower]) {
        const p = rosaMap[nomeLower];
        const updatePayload = {
          quot_reale: quot, squadra_serie_a, anni, ruolo,
          // Rispetta l'asterisco "Fuori lista" del file: se il file lo marca
          // fuori lista lo segna tale, altrimenti lo rimette in lista (utile
          // se era stato marcato in un import precedente e ora è rientrato).
          fuori_lista: fuoriListaRiga,
          ...statsRosa,
        };
        if (aggiornaQuotazioneRosa) {
          // Art. 4.2/4.8.1: gli U21 non hanno aumenti contrattuali percentuali,
          // ma lo stipendio base segue sempre la quotazione aggiornata (Q/5).
          Object.assign(updatePayload, {
            quot, stip, stip_originale: stip, clausola,
            quot_precedente: p.quot || quot,
          });
        }
        await supabase.from('rosa').update(updatePayload).eq('id', p.id);
        rosaAggiornati++;
      } else if (svinMap[nomeLower]) {
        await supabase.from('svincolati').update({
          quot, stip, clausola, ruolo, anni, squadra_serie_a: squadra_serie_a || null,
          fuori_lista: fuoriListaRiga,
          ...statsSvin,
        }).eq('id', svinMap[nomeLower].id);
        svinAggiornati++;
      } else if (quot > 0 && !(r['FantaSquadra'] || '').toString().trim()) {
        // Nuovo giocatore libero (nessuna FantaSquadra nel file): crea in svincolati.
        // upsertSvincolatoSafe cerca prima per nome+stagione ed evita così i
        // doppioni con ID diverso che si formavano quando il vincolo di
        // unicità (nome,stagione) non esisteva davvero sul database.
        try {
          await upsertSvincolatoSafe({
            nome, quot, stip, clausola, ruolo, anni,
            squadra_serie_a: squadra_serie_a || null,
            fuori_lista: fuoriListaRiga,
            ...statsSvin,
          }, stagione);
          nuoviCreati++;
          nuoviCreatiNomi.push({ nome, ruolo, quot });
        } catch (nuovoErr) {
          console.error('_importDatabaseCore: creazione svincolato fallita:', nome, nuovoErr);
          nonTrovati.push(`${nome} (errore creazione: ${nuovoErr.message || nuovoErr.code || 'sconosciuto'})`);
        }
      } else if (quot > 0) {
        // Il file indica una FantaSquadra per questo nome, ma non è stato trovato
        // né in rosa né tra gli svincolati: quasi certamente un cambio di grafia
        // del nome (es. "Castro" → "Castro S.") rispetto a quanto salvato in rosa.
        // NON va creato come svincolato: sarebbe un doppione fantasma per un
        // giocatore che in realtà è già assegnato a una squadra. Segnaliamo per
        // la verifica manuale del nome invece di inserirlo silenziosamente.
        nonTrovati.push(`${nome} (FantaSquadra "${(r['FantaSquadra'] || '').toString().trim()}" nel file ma nessun match in rosa/svincolati — verificare il nome, es. cambio grafia)`);
      } else {
        nonTrovati.push(nome);
      }
    }));
  }

  // Giocatori in rosa che NON compaiono più nel nuovo database: restano nella rosa
  // della squadra con la quotazione e i valori del vecchio database invariati, ma
  // vengono segnati automaticamente come "fuori lista" (art. 4.7).
  const usciti = (rosaAll || []).filter(p => !nomiExcel.has(normPlayerName(p.nome)) && !p.fuori_lista);
  for (let i = 0; i < usciti.length; i += BATCH) {
    await Promise.all(usciti.slice(i, i + BATCH).map(p =>
      supabase.from('rosa').update({ fuori_lista: true }).eq('id', p.id)
    ));
  }

  // Stessa cosa per gli svincolati: se un giocatore sparisce del tutto dal
  // nuovo database (es. trasferito all'estero), va segnato fuori lista anche
  // lì — prima questo controllo esisteva solo per la rosa, mai per gli
  // svincolati, quindi restavano "in lista" per sempre anche se il file non
  // li conteneva più.
  const svinUsciti = (svinAll || []).filter(s => !nomiExcel.has(normPlayerName(s.nome)) && !s.fuori_lista);
  for (let i = 0; i < svinUsciti.length; i += BATCH) {
    await Promise.all(svinUsciti.slice(i, i + BATCH).map(s =>
      supabase.from('svincolati').update({ fuori_lista: true }).eq('id', s.id)
    ));
  }

  // Nomi (non solo il conteggio) dei giocatori appena segnati fuori lista in
  // QUESTO import, per poterli mostrare subito in Control Room invece di
  // doverli scovare a mano tra tutti i fuori lista storici.
  const fuoriListaNomi = [
    ...usciti.map(p => ({ nome: p.nome, squadra: p.squadra })),
    ...svinUsciti.map(s => ({ nome: s.nome, squadra: null })),
  ];

  return { rosaAggiornati, svinAggiornati, nuoviCreati, nuoviCreatiNomi, nonTrovati, fuoriListaSegnati: usciti.length + svinUsciti.length, fuoriListaNomi, totale: validRows.length };
}

// Update Settimanale: come l'update di fine stagione/inizio stagione in
// miniatura — stessi controlli (nuovi giocatori → svincolati, spariti →
// fuori lista, stats e squadra aggiornate per tutti) MA la quotazione (quindi
// stipendio e clausola) dei giocatori già in rosa NON cambia: viene solo
// registrata in quot_reale, "in ombra", pronta per essere applicata nelle
// finestre 01/06, 01/08 o 01/01.
export async function importDatabaseFanta(rows, stagione = getStagioneQuota()) {
  return _importDatabaseCore(rows, stagione, { aggiornaQuotazioneRosa: false });
}

// ─── AGGIORNAMENTI PERIODICI DATABASE ────────────────────────────────────────
// (l'aggiornamento 01/01 non ha più un tipo di import dedicato: vedi
// calcolaTop5Aggiornamenti/applicaTop5Rialzo/applicaTop5Ribasso più sopra,
// calcolate per squadra invece che su un unico top-5 di lega)

// Applica aggiornamento 01/06 o 01/08:
// Tutti i giocatori in rosa: quot = quot_reale, stip/clausola ricalcolati
export async function applica01GiugnoAgosto(stagione = getStagioneQuota()) {
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
      // Niente eccezione U21 qui: la quotazione (e quindi lo stip base Q/5)
      // aggiorna tutti allo stesso modo. L'unica cosa che gli U21 NON hanno è
      // il bonus percentuale di rinnovo contrattuale (+10%/+20%), che è un
      // calcolo di visualizzazione fatto in calcolaStipCorretto() lato rosa,
      // non qualcosa da congelare qui in fase di import.
      const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));
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

// Aggiornamento 01/08 — full import con creazione nuove voci per giocatori non
// presenti e, a differenza di Settimanale, applica SUBITO la nuova quotazione
// (quindi stipendio e clausola) ai giocatori già in rosa.
export async function importa01Agosto(rows, stagione = getStagioneQuota()) {
  return _importDatabaseCore(rows, stagione, { aggiornaQuotazioneRosa: true });
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
