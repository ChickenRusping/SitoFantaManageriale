import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ougxeheoaifcuetnmgrw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZI75g_AJGpsblAxVDDFBIQ_-tqGXPym';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  const { data, error } = await supabase.from('rosa').select('*').eq('squadra', squadra).order('ruolo');
  if (error) throw error;
  return data;
}

export async function updateGiocatore(id, fields) {
  const { error } = await supabase.from('rosa').update(fields).eq('id', id);
  if (error) throw error;
}

export async function insertGiocatore(giocatore) {
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
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const periodoCampionato = (m > 8) || (m === 8 && day >= 16) || (m < 6);

  if (periodoCampionato) {
    // Prossimo giovedì alle 19:00 UTC (= 20:00 ora italiana UTC+1)
    // Partiamo dal lunedì della settimana corrente (UTC)
    const dow = d.getUTCDay(); // 0=dom, 1=lun, 4=gio
    // Giorni dall'inizio settimana (lunedì=1 in UTC)
    const giorniDaLun = (dow === 0) ? 6 : dow - 1; // 0=lun, ..., 6=dom
    const lun = new Date(d);
    lun.setUTCDate(d.getUTCDate() - giorniDaLun);
    lun.setUTCHours(0, 0, 0, 0);

    // Giovedì = lunedì + 3 giorni, ore 19:00 UTC
    const gio = new Date(lun);
    gio.setUTCDate(lun.getUTCDate() + 3);
    gio.setUTCHours(19, 0, 0, 0);

    // Se siamo già oltre giovedì 19:00 UTC, vai alla settimana successiva
    if (d >= gio) gio.setUTCDate(gio.getUTCDate() + 7);
    return gio;
  } else {
    return new Date(d.getTime() + 72 * 60 * 60 * 1000);
  }
}

// ── Calcola scadenza offerte (dopo che scade l'interesse) ─────────────────────
// Campionato: venerdì ore 16:00 (stesso weekend)
// Senza partite: +24h dalla scadenza interesse
// ── Calcola scadenza offerte (slot base venerdì 12:00 Italia = 11:00 UTC) ──────
export function calcolaScadenzaOfferte(scadenzaInteresse) {
  const d = new Date(scadenzaInteresse);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const periodoCampionato = (m > 8) || (m === 8 && day >= 16) || (m < 6);

  if (periodoCampionato) {
    // Venerdì della stessa settimana alle 11:00 UTC (= 12:00 Italia)
    // Partiamo dal lunedì UTC della settimana della scadenza interesse (giovedì)
    const dowUtc = d.getUTCDay(); // 4 = giovedì
    const giorniDaLun = (dowUtc === 0) ? 6 : dowUtc - 1;
    const lun = new Date(d);
    lun.setUTCDate(d.getUTCDate() - giorniDaLun);
    lun.setUTCHours(0, 0, 0, 0);

    // Venerdì = lunedì + 4 giorni, ore 11:00 UTC
    const ven = new Date(lun);
    ven.setUTCDate(lun.getUTCDate() + 4);
    ven.setUTCHours(11, 0, 0, 0);
    return ven;
  } else {
    return new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
}

// ── Inserisce la chiamata principale (tipo='prima') ───────────────────────────
export async function insertChiamata(chiamata) {
  const now = new Date();
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
  // Recupera la chiamata principale per avere la scadenza_interesse
  const { data: primaria } = await supabase
    .from('chiamate')
    .select('*')
    .eq('giocatore', nomeGiocatore)
    .eq('tipo', 'prima')
    .single();
  if (!primaria) throw new Error('Chiamata principale non trovata');
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
  const { data, error } = await supabase.from('club_identity').select('*').eq('squadra', squadra).single();
  if (error) return null;
  return data;
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
  if (file.size > 2 * 1024 * 1024) throw new Error('Immagine troppo grande (max 2MB)');

  // Sanitizza nome squadra per path
  const slug = squadra.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  // Aggiungi timestamp per bypassare cache
  const path = `${slug}/${kind}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('team-images')
    .upload(path, file, { cacheControl: '3600', upsert: true });
  if (uploadErr) throw uploadErr;

  const { data: urlData } = supabase.storage.from('team-images').getPublicUrl(path);
  const publicUrl = urlData?.publicUrl;
  if (!publicUrl) throw new Error('Impossibile ottenere URL pubblico');

  // Aggiorna il campo corrispondente su club_identity
  const fieldMap = {
    stemma: 'stemma_url',
    maglia_casa: 'maglia_casa_url',
    maglia_trasferta: 'maglia_trasferta_url',
    maglia_terza: 'maglia_terza_url',
  };
  const col = fieldMap[kind];
  if (!col) throw new Error('Tipo immagine non valido');

  await updateClubIdentity(squadra, { [col]: publicUrl });
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
          scadenza_prestito, stipendio_a_chi, fuori_mercato, id } = trattativa;

  const oggi = new Date().toISOString().slice(0, 10);
  const tipoLabel = {
    cessione: "Cessione", prestito_diritto: "Prestito c/Dir.",
    prestito_obbligo: "Prestito c/Obl.", prestito_secco: "Prestito Secco",
    clausola: "Clausola Rescissoria", scambio: "Scambio",
  };
  const descLabel = tipoLabel[tipo] || tipo;
  const isPrestito = tipo.startsWith('prestito');

  // ── 1. Trova il giocatore nella rosa della squadra cedente ──────────────────
  const { data: rosaRows } = await supabase
    .from('rosa')
    .select('*')
    .eq('squadra', da_squadra)
    .ilike('nome', `%${giocatore}%`);

  const player = rosaRows?.[0];

  if (player) {
    // ── 2. Calcola nuovo stipendio (art. 5.9): basato su quotazione attuale ──
    const nuovaQuot = trattativa.quot_giocatore || player.quot;
    const nuovoStip = parseFloat((nuovaQuot / 5).toFixed(2));

    if (isPrestito) {
      // Prestito: aggiorna squadra temporanea, mantieni traccia del proprietario
      // Chi paga lo stipendio dipende da stipendio_a_chi
      await supabase.from('rosa').update({
        squadra: a_squadra,
        in_prestito: true,
        squadra_originale: da_squadra,
        scadenza_prestito,
        stip: stipendio_a_chi === 'cedente' ? 0 : nuovoStip, // cedente paga → 0 per ricevente
        stip_prestito_cedente: stipendio_a_chi === 'cedente' ? nuovoStip : 0,
      }).eq('id', player.id);
    } else {
      // Cessione definitiva: aggiorna squadra e stipendio
      await supabase.from('rosa').update({
        squadra: a_squadra,
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
    .in('name', [da_squadra, a_squadra]);

  const bilDa = squadreData?.find(s => s.name === da_squadra)?.bilancio || 0;
  const bilA  = squadreData?.find(s => s.name === a_squadra)?.bilancio || 0;

  const nuovoBilDa = parseFloat((bilDa + importoCedente).toFixed(2));
  const nuovoBilA  = parseFloat((bilA  - importoAcquirente).toFixed(2));

  await supabase.from('squadre').update({ bilancio: nuovoBilDa }).eq('name', da_squadra);
  await supabase.from('squadre').update({ bilancio: nuovoBilA  }).eq('name', a_squadra);

  // ── 5. Registra movimenti ───────────────────────────────────────────────────
  const notaFuori = fuori_mercato ? " (trasf. differito)" : "";
  await supabase.from('movimenti').insert([
    {
      squadra: da_squadra,
      descrizione: `${descLabel}: ${giocatore} → ${a_squadra}${notaFuori}`,
      entrata: importoCedente,
      uscita: null,
      data: oggi,
    },
    {
      squadra: a_squadra,
      descrizione: `${descLabel}: ${giocatore} da ${da_squadra}${notaFuori}`,
      entrata: null,
      uscita: importoAcquirente,
      data: oggi,
    },
  ]);

  // Per clausola: registra anche la differenza trattenuta (2/7)
  if (tipo === 'clausola') {
    const diff = parseFloat((prezzo - importoCedente).toFixed(2));
    await supabase.from('movimenti').insert({
      squadra: da_squadra,
      descrizione: `Ritenuta clausola rescissoria (2/7): ${giocatore}`,
      entrata: null,
      uscita: diff,
      data: oggi,
    });
  }

  // ── 6. Marca trattativa completata ─────────────────────────────────────────
  await supabase.from('trattative').update({
    stato: 'completata',
    updated_at: new Date().toISOString(),
  }).eq('id', id);

  // ── 7. Aggiorna tracciamento passaggi sessione (art. 5.6 — max 3 squadre) ─
  try {
    await checkEAggiornaPassaggi(giocatore, a_squadra, tipo);
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
      const squadraPaga    = bonus.direzione === 'acquirente_paga' ? a_squadra : da_squadra;
      const squadraRiceve  = bonus.direzione === 'acquirente_paga' ? da_squadra : a_squadra;

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

  return { ok: true, player, nuovoBilDa, nuovoBilA };
}

// Rientro da prestito: riporta il giocatore alla squadra originale
export async function eseguiRientroPrestito(playerId, squadraOriginale) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: player } = await supabase.from('rosa').select('*').eq('id', playerId).single();
  if (!player) return;

  await supabase.from('rosa').update({
    squadra: squadraOriginale,
    in_prestito: false,
    squadra_originale: null,
    scadenza_prestito: null,
  }).eq('id', playerId);
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
  const isPrestito = tipo?.startsWith('prestito');

  // Art. 5.6: terzo passaggio DEVE essere prestito
  if (passaggi >= 2 && !isPrestito) {
    throw new Error(`${giocatoreNome} ha già cambiato ${passaggi} squadre in questa sessione — il terzo passaggio deve essere un prestito.`);
  }
  if (passaggi >= 3) {
    throw new Error(`${giocatoreNome} ha già raggiunto il limite di 3 squadre in questa sessione.`);
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
  const { data, error } = await supabase.from('stagione_svincoli').select('*').eq('squadra', squadra).single();
  if (error) return null;
  return data;
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
export async function eseguiSvincolo({ squadra, player, tipo, estero = false, bilancioAttuale }) {
  const oggi = new Date();
  const oggiStr = oggi.toISOString().slice(0, 10);

  // ── Calcola costi/indennizzi ──────────────────────────────────────────────
  const quot = Number(player.quot || 0);
  const stip = Number(player.stip || 0);
  const isU21 = player.anni > 0 && player.anni <= 21;

  let costoTotale = 0;
  let indennizzo = 0;
  let mesiRimborsati = 0;
  let costoPenale = 0;
  let movDesc = '';

  if (tipo === 'ordinario') {
    // Penale per quotazione (art. 6.1)
    costoPenale = quot <= 10 ? 0.5 : quot <= 20 ? 1 : quot <= 30 ? 1.5 : 2;

    // Mensilità da pagare fino al 01/06
    const dataFineContratto = new Date(oggi.getFullYear(), 5, 1); // 01/06
    if (dataFineContratto < oggi) dataFineContratto.setFullYear(oggi.getFullYear() + 1);
    const mesiRimasti = Math.ceil((dataFineContratto - oggi) / (30.44 * 86400000));
    const costoMensile = parseFloat((stip / 12).toFixed(2));
    const costoStipendi = parseFloat((mesiRimasti * costoMensile).toFixed(2));

    costoTotale = parseFloat((costoPenale + costoStipendi).toFixed(2));
    movDesc = `Svincolo ordinario: ${player.nome} (penale ${costoPenale}M + ${mesiRimasti} mens. ${costoStipendi}M)`;

  } else if (tipo === 'straordinario' || tipo === 'straordinario_u21') {
    // Indennizzo: ¼ quot (o ½ se estero) — art. 6.1
    indennizzo = estero
      ? parseFloat((quot / 2).toFixed(2))
      : parseFloat((quot / 4).toFixed(2));

    // Rimborso mensilità pagate da agosto (01/09) al momento dello svincolo
    // Conta i mesi interi trascorsi da settembre
    const agostoPagato = new Date(oggi.getMonth() >= 8 ? oggi.getFullYear() : oggi.getFullYear() - 1, 7, 1);
    mesiRimborsati = Math.max(0, Math.floor((oggi - agostoPagato) / (30.44 * 86400000)));
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

  // Penale extra se oltre 14 svincoli (art. 6.4) — calcolata dal chiamante se serve
  // (gestita nell'UI con warning)

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
    stagione: '2025-26',
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
  const contatori = await getStagioneSvincoli(squadra);
  if (contatori) {
    const history = Array.isArray(contatori.svincolati_history) ? contatori.svincolati_history : [];
    const riacquistabileDal = new Date(oggi.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    history.push({ nome: player.nome, data_svincolo: oggiStr, riacquistabile_dal: riacquistabileDal });

    const isConteggiato = tipo !== 'straordinario_u21_nc';
    const isStraord = tipo.startsWith('straordinario');
    const meseCorrente = oggi.getMonth(); // 0-11
    const isEstivo = meseCorrente >= 5 && meseCorrente <= 8; // giu-set

    await updateStagioneSvincoli(squadra, {
      count_ordinari:            contatori.count_ordinari + (tipo === 'ordinario' ? 1 : 0),
      count_straord_estivi:      contatori.count_straord_estivi + (isStraord && isEstivo && isConteggiato ? 1 : 0),
      count_straord_invernali:   contatori.count_straord_invernali + (isStraord && !isEstivo && isConteggiato ? 1 : 0),
      count_totale:              contatori.count_totale + (isConteggiato ? 1 : 0),
      svincolati_history:        history,
    });
  }

  return { ok: true, costoTotale, nuovoBilancio, movDesc };
}

// ─── TASSE SETTIMANALI (art. 7.1) ─────────────────────────────────────────────

// Calcola la tassa settimanale per un dato bilancio
export function calcolaTassa(bilancio) {
  if (bilancio <= 0)   return { perc: 0, importo: 0 };
  if (bilancio <= 20)  return { perc: 1,  importo: parseFloat((bilancio * 0.01).toFixed(2)) };
  if (bilancio <= 40)  return { perc: 2,  importo: parseFloat((bilancio * 0.02).toFixed(2)) };
  if (bilancio <= 60)  return { perc: 3,  importo: parseFloat((bilancio * 0.03).toFixed(2)) };
  if (bilancio <= 80)  return { perc: 5,  importo: parseFloat((bilancio * 0.05).toFixed(2)) };
  if (bilancio <= 100) return { perc: 8,  importo: parseFloat((bilancio * 0.08).toFixed(2)) };
  return               { perc: 10, importo: parseFloat((bilancio * 0.10).toFixed(2)) };
}

// Periodo di applicazione tasse: 01/08 → 31/05
export function isTassaAttiva() {
  const m = new Date().getMonth(); // 0-based
  return m >= 7 || m <= 4; // ago(7)-dic(11) o gen(0)-mag(4)
}

export async function getTassePagate(squadra) {
  const { data, error } = await supabase.from('tasse_settimanali')
    .select('*').eq('squadra', squadra).order('data_controllo', { ascending: false });
  if (error) return [];
  return data;
}

// Applica la tassa settimanale (chiamato dall'admin ogni lunedì sera)
export async function applicaTassaSettimana(squadra, bilancioCorrente) {
  if (!isTassaAttiva()) return { skip: true, motivo: 'Fuori periodo (giu-lug)' };
  const { perc, importo } = calcolaTassa(bilancioCorrente);
  if (importo <= 0) return { skip: true, motivo: 'Bilancio 0 o negativo' };

  const oggi = new Date().toISOString().slice(0, 10);
  // Inserisce record tassa
  await supabase.from('tasse_settimanali').insert({
    squadra, bilancio_al_controllo: bilancioCorrente,
    percentuale: perc, importo_tassa: importo,
    data_controllo: oggi, applicata: true,
  });
  // Scala dal bilancio
  const nuovoBilancio = parseFloat((bilancioCorrente - importo).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  await supabase.from('movimenti').insert({
    squadra, descrizione: `Tassa settimanale ${perc}% (bilancio ${bilancioCorrente}M)`,
    uscita: importo, data: oggi,
  });
  return { ok: true, importo, nuovoBilancio };
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
  // art. 7.3 — soglia sicura alzata a 50M, nuove penalità
  if (netto <= 50) return { zona: 'sicura', multa: 0,  giorni: 0, pt: 0, euro: 0  };
  if (netto <= 55) return { zona: '50-55',  multa: 5,  giorni: 0, pt: 0, euro: 0  };
  if (netto <= 60) return { zona: '55-60',  multa: 10, giorni: 0, pt: 0, euro: 0  };
  if (netto <= 65) return { zona: '60-65',  multa: 15, giorni: 0, pt: 2, euro: 0  };
  if (netto <= 70) return { zona: '65-70',  multa: 20, giorni: 0, pt: 4, euro: 5  };
  return             { zona: '>70',    multa: 25, giorni: 0, pt: 6, euro: 10 };
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
  const { data, error } = await supabase.from('allenatori_carte')
    .select('*').eq('squadra', squadra).eq('stagione', stagione).single();
  if (error) return null;
  return data;
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
  const { data, error } = await supabase.from('allenatori_carte')
    .select('stipendio_sc').eq('squadra', squadra).single();
  if (error || !data) return 0;
  return Number(data.stipendio_sc || 0);
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
  return parseFloat((3 + distanza * 1.5).toFixed(2));
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

// Applica la quota iscrizione campionato (30M) — art. 1.3
export async function applicaIscrizioneCampionato(squadra) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: sq } = await supabase.from('squadre').select('bilancio, iscrizione_pagata').eq('name', squadra).single();
  if (!sq || sq.iscrizione_pagata) return { skip: true };
  const nuovoBilancio = parseFloat((sq.bilancio - 30).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio, iscrizione_pagata: true }).eq('name', squadra);
  await supabase.from('movimenti').insert({ squadra, descrizione: 'Iscrizione campionato (automatica 31/07)', uscita: 30, data: oggi });
  return { ok: true, nuovoBilancio };
}

// Investi euro extra budget (art. 1.2) — aggiunge mln al bilancio
// euroAggiuntivi: 1-10, ma limitato da (10 - euro_biennio)
export async function investiEuroExtra(squadra, euroAggiuntivi) {
  const { data: sq } = await supabase.from('squadre').select('bilancio, euro_investiti, euro_biennio, mln_extra').eq('name', squadra).single();
  if (!sq) throw new Error('Squadra non trovata');

  const maxDisponibili = 10 - (sq.euro_biennio || 0);
  if (euroAggiuntivi > maxDisponibili) throw new Error(`Puoi investire al massimo ${maxDisponibili}€ (biennio 2025-27)`);
  if (euroAggiuntivi < 1 || euroAggiuntivi > 10) throw new Error('Importo non valido (1-10€)');

  const mlnGuadagnati = parseFloat((euroAggiuntivi * 2.5).toFixed(2));
  const oggi = new Date().toISOString().slice(0, 10);

  await supabase.from('squadre').update({
    bilancio:       parseFloat((sq.bilancio + mlnGuadagnati).toFixed(2)),
    euro_investiti: (sq.euro_investiti || 0) + euroAggiuntivi,
    euro_biennio:   (sq.euro_biennio  || 0) + euroAggiuntivi,
    mln_extra:      (sq.mln_extra     || 0) + mlnGuadagnati,
  }).eq('name', squadra);

  await supabase.from('movimenti').insert({
    squadra, descrizione: `Investimento extra budget: ${euroAggiuntivi}€ → +${mlnGuadagnati}M`,
    entrata: mlnGuadagnati, data: oggi,
  });
  return mlnGuadagnati;
}

// Ritira budget extra (art. 1.2.2): spende 2× i mln ricevuti per riaverli
// Solo tra 05/01 e il martedì dopo la 19ª giornata
export async function ritiraBudgetExtra(squadra) {
  const { data: sq } = await supabase.from('squadre').select('bilancio, mln_extra, euro_investiti').eq('name', squadra).single();
  if (!sq || !sq.mln_extra || sq.mln_extra <= 0) throw new Error('Nessun budget extra da ritirare');

  const costoRitiro = parseFloat((sq.mln_extra * 2).toFixed(2));
  if (sq.bilancio < costoRitiro) throw new Error(`Bilancio insufficiente: servono ${costoRitiro}M per ritirare ${sq.mln_extra}M`);

  const oggi = new Date().toISOString().slice(0, 10);
  // Restituisce i mln extra ma scala il costo (2×)
  // Netto: ricevi mln_extra, spendi mln_extra*2 → saldo netto = -mln_extra
  const nuovoBilancio = parseFloat((sq.bilancio - costoRitiro + sq.mln_extra).toFixed(2));

  await supabase.from('squadre').update({
    bilancio:   nuovoBilancio,
    mln_extra:  0,
    // euro_biennio e euro_investiti rimangono invariati (art. 1.2.2: "risulteranno comunque spesi")
  }).eq('name', squadra);

  await supabase.from('movimenti').insert([
    { squadra, descrizione: `Ritiro budget extra (rimborso ${sq.mln_extra}M)`, entrata: sq.mln_extra, data: oggi },
    { squadra, descrizione: `Costo ritiro budget extra (2× = ${costoRitiro}M)`, uscita: costoRitiro, data: oggi },
  ]);
  return { nuovoBilancio, costoRitiro, rimborso: sq.mln_extra };
}

// Reset biennio (ogni 2 anni, lato admin)
export async function resetBiennio(squadra, nuovoBiennio) {
  await supabase.from('squadre').update({ euro_biennio: 0, euro_investiti: 0, mln_extra: 0, biennio: nuovoBiennio }).eq('name', squadra);
}

// Segna quota 30€ pagata al tesoriere
export async function segnaQuotaPagata(squadra) {
  await supabase.from('squadre').update({ quota_pagata: true }).eq('name', squadra);
}

// Auto-applica iscrizione 30M a TUTTE le squadre (chiamato dal timer 31/07)
export async function applicaIscrizioneATutti() {
  const { data: squadre } = await supabase.from('squadre').select('name, bilancio, iscrizione_pagata');
  if (!squadre) return [];
  const results = [];
  for (const sq of squadre) {
    if (sq.iscrizione_pagata) { results.push({ squadra: sq.name, skip: true }); continue; }
    const r = await applicaIscrizioneCampionato(sq.name);
    results.push({ squadra: sq.name, ...r });
  }
  return results;
}

// ─── DEPOSITO FIDUCIARIO (art. 10.6) ─────────────────────────────────────────
// Scaglioni: 10M (+10% → 11M il 01/08), 15M (+12% → 16.8M il 15/08), 20M (+15% → 23M il 01/09)
export const DEPOSITO_SCAGLIONI = [
  { importo: 10, bonus: 10, totale: 11,   rimborso: '01/08', label: '10M → 11M (+10%) il 01/08' },
  { importo: 15, bonus: 12, totale: 16.8, rimborso: '15/08', label: '15M → 16.8M (+12%) il 15/08' },
  { importo: 20, bonus: 15, totale: 23,   rimborso: '01/09', label: '20M → 23M (+15%) il 01/09' },
];

// Apertura deposito: 08/01 → 15/01
export function isDepositoAperto() {
  const oggi = new Date();
  const m = oggi.getMonth() + 1, d = oggi.getDate();
  return m === 1 && d >= 8 && d <= 15;
}

export async function effettuaDeposito(squadra, importo) {
  const scaglione = DEPOSITO_SCAGLIONI.find(s => s.importo === importo);
  if (!scaglione) throw new Error('Importo non valido. Scegli tra 10M, 15M o 20M.');
  if (!isDepositoAperto()) throw new Error('Il deposito fiduciario è disponibile solo dall\'08/01 al 15/01.');

  const oggi = new Date().toISOString().slice(0, 10);
  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  if ((sq?.bilancio || 0) < importo) throw new Error(`Bilancio insufficiente: servono ${importo}M`);

  const nuovoBilancio = parseFloat(((sq?.bilancio || 0) - importo).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  await supabase.from('movimenti').insert({
    squadra, data: oggi,
    descrizione: `Deposito fiduciario: ${importo}M (rimborso ${scaglione.totale}M il ${scaglione.rimborso})`,
    uscita: importo,
  });
  // Registra come investimento per tracciarlo
  await supabase.from('investimenti').insert({
    squadra, nome: `Deposito Fiduciario ${importo}M`, categoria: 'deposito',
    costo: importo, data_acquisto: oggi,
    dati: { importo, bonus_perc: scaglione.bonus, totale: scaglione.totale, rimborso: scaglione.rimborso },
    note: scaglione.label,
  });
  return { nuovoBilancio, scaglione };
}

export async function rimborsoDeposito(squadra, investimentoId, totale) {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', squadra).single();
  const nuovoBilancio = parseFloat(((sq?.bilancio || 0) + totale).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', squadra);
  await supabase.from('movimenti').insert({ squadra, data: oggi, descrizione: `Rimborso deposito fiduciario: +${totale}M`, entrata: totale });
  await supabase.from('investimenti').update({ completato: true, valore_accumulato: totale }).eq('id', investimentoId);
  return nuovoBilancio;
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
    case 'deposito_fiduciario':
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

// ─── VIVAIO (art. 3.6) ────────────────────────────────────────────────────────

export async function getVivaio(squadra) {
  const { data, error } = await supabase.from('rosa')
    .select('*').eq('squadra', squadra).eq('in_vivaio', true).order('quot', { ascending: false });
  if (error) return [];
  return data;
}

// Acquista giocatore per il vivaio (da svincolati)
// Validazioni: under-23, quot <= 3, 0 presenze a voto
export async function acquistaVivaio({ squadra, giocatore, bilancioAttuale }) {
  // Validazioni regolamento
  if (giocatore.anni > 23) throw new Error(`${giocatore.nome} ha ${giocatore.anni} anni — il vivaio ammette solo under-23`);
  if (giocatore.quot > 3)  throw new Error(`${giocatore.nome} ha quotazione ${giocatore.quot} — il vivaio ammette solo Q ≤ 3`);

  const oggi = new Date().toISOString().slice(0, 10);

  // Conta vivaio attuale (max 2, o 4 con investimento Settore Giovanile Avanzato)
  const { count } = await supabase.from('rosa').select('id', { count: 'exact', head: true })
    .eq('squadra', squadra).eq('in_vivaio', true);
  // Controlla se hanno il Settore Giovanile Avanzato
  const { data: invSGA } = await supabase.from('investimenti')
    .select('id').eq('squadra', squadra).eq('nome', 'Settore Giovanile Avanzato').eq('attivo', true);
  const maxVivaio = invSGA?.length > 0 ? 4 : 2;
  if ((count || 0) >= maxVivaio) throw new Error(`Vivaio pieno (max ${maxVivaio}). Promuovi o svincola un giocatore prima.`);

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
    data_entrata_vivaio: oggi,
    data_acquisto: oggi,
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

  // Calcola stipendio normale (Q/5)
  const stipNormale = parseFloat((player.quot / 5).toFixed(2));

  await supabase.from('rosa').update({
    in_vivaio: false,
    vivaio_promosso: true,
    stip: stipNormale,
    stip_originale: stipNormale,
    anni_contratto: 1,
    data_acquisto: oggi,
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
  await supabase.from('rosa').update({ vivaio_presenze: nuovePresenze }).eq('id', playerId);
}

// Paga costo vivaio 4M annuali (art. 3.6.3)
export async function pagaCostoVivaio(squadra, bilancioAttuale) {
  const COSTO = 4;
  const oggi = new Date().toISOString().slice(0, 10);
  if (bilancioAttuale < COSTO) throw new Error(`Bilancio insufficiente: servono ${COSTO}M`);
  const nuovoBilancio = parseFloat((bilancioAttuale - COSTO).toFixed(2));
  await supabase.from('squadre').update({ bilancio: nuovoBilancio, vivaio_pagato: true }).eq('name', squadra);
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
    stagione: '2025-26',
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
    stagione: '2025-26',
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

  // Usa UTC per evitare shift di fuso orario
  const mUtc = scadenzaInteresse.getUTCMonth() + 1;
  const dayUtc = scadenzaInteresse.getUTCDate();
  const periodoCampionato = (mUtc > 8) || (mUtc === 8 && dayUtc >= 16) || (mUtc < 6);

  let scadenzaOfferte;
  if (periodoCampionato) {
    // Venerdì della stessa settimana UTC
    // scadenzaInteresse è giovedì 19:00 UTC → +1 giorno = venerdì
    const ven = new Date(scadenzaInteresse);
    ven.setUTCDate(scadenzaInteresse.getUTCDate() + 1); // giovedì → venerdì
    ven.setUTCHours(11, 0, 0, 0); // 11:00 UTC = 12:00 Italia (slot base)

    // Quante aste ci sono già quel venerdì → +30min per slot
    const slot = await calcolaSlotVenerdì(ven);
    ven.setUTCMinutes(slot * 30);
    scadenzaOfferte = ven;
  } else {
    scadenzaOfferte = new Date(scadenzaInteresse.getTime() + 24 * 60 * 60 * 1000);
  }

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
export async function rivelaECompletaAsta(astaId) {
  const { data: asta } = await supabase.from('aste_svincolati')
    .select('*').eq('id', astaId).single();
  if (!asta) throw new Error('Asta non trovata');

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

  // Trasferimento
  const oggi = new Date().toISOString().slice(0, 10);
  const stip  = parseFloat((Number(asta.quot) / 5).toFixed(2));
  const claus = parseFloat((Number(asta.quot) * 1.75).toFixed(2));

  if (asta.per_vivaio) {
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: asta.giocatore, ruolo: asta.ruolo,
      anni: asta.anni, quot: asta.quot, stip, clausola: claus,
      squadra_serie_a: asta.squadra_serie_a,
      in_vivaio: true, vivaio_presenze: 0, vivaio_pagato: false,
      anni_contratto: 1, data_acquisto: oggi,
    });
  } else {
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: asta.giocatore, ruolo: asta.ruolo,
      anni: asta.anni, quot: asta.quot, stip, clausola: claus,
      squadra_serie_a: asta.squadra_serie_a,
      in_vivaio: false, anni_contratto: 1, data_acquisto: oggi,
    });
    await supabase.from('svincolati').delete()
      .eq('nome', asta.giocatore).eq('stagione', '2025-26');
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

  // Chiudi chiamate
  await supabase.from('chiamate')
    .update({ stato: 'conclusa' })
    .eq('giocatore', asta.giocatore);

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
  const vincitore = primaria.squadra;
  // Unico interessato → paga la base d'asta = ¾ della quotazione (art. 6.3)
  const prezzoFinale = parseFloat((Number(primaria.quot) * 0.75).toFixed(2));
  const oggi = new Date().toISOString().slice(0, 10);
  const stip  = parseFloat((Number(primaria.quot) / 5).toFixed(2));
  const claus = parseFloat((Number(primaria.quot) * 1.75).toFixed(2));

  if (primaria.per_vivaio) {
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: nomeGiocatore, ruolo: primaria.ruolo,
      anni: primaria.anni || 0, quot: primaria.quot, stip, clausola: claus,
      squadra_serie_a: primaria.squadra_serie_a || '',
      in_vivaio: true, vivaio_presenze: 0, vivaio_pagato: false,
      anni_contratto: 1, data_acquisto: oggi,
    });
  } else {
    await supabase.from('rosa').insert({
      squadra: vincitore, nome: nomeGiocatore, ruolo: primaria.ruolo,
      anni: primaria.anni || 0, quot: primaria.quot, stip, clausola: claus,
      squadra_serie_a: primaria.squadra_serie_a || '',
      in_vivaio: false, anni_contratto: 1, data_acquisto: oggi,
    });
    await supabase.from('svincolati').delete()
      .eq('nome', nomeGiocatore).eq('stagione', '2025-26');
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

  await supabase.from('chiamate')
    .update({ stato: 'conclusa' })
    .eq('giocatore', nomeGiocatore);

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
      partite_voto:     riga.partite_voto,
      media_voto:       riga.media_voto,
      media_fantavoto:  riga.media_fantavoto,
      gol_fatti:        riga.gol_fatti,
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
    // direzione 'acquirente_paga': a_squadra paga, da_squadra riceve
    // direzione 'cedente_paga':   da_squadra paga, a_squadra riceve
    const squadraPaga    = bonus.direzione === 'acquirente_paga' ? trattativa.a_squadra : trattativa.da_squadra;
    const squadraRiceve  = bonus.direzione === 'acquirente_paga' ? trattativa.da_squadra : trattativa.a_squadra;
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
  else if (h < 36) { urgenza = 'warn1';    penaltaMln = 1; messaggio = `⚠️ +1M scattato · ${_fmtH(36-h)} al prossimo`; }
  else if (h < 48) { urgenza = 'warn3';    penaltaMln = 3; messaggio = `🔴 +3M scattato · ${_fmtH(48-h)} al prossimo`; }
  else if (h < 72) { urgenza = 'warn5';    penaltaMln = 5; messaggio = `🚨 +5M scattato`; }
  else if (h < 96) { urgenza = 'critical'; penaltaMln = 5; messaggio = `💀 Acquisto forzato ½Q disponibile (${_fmtH(96-h)})`; }
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
        stagione: '2025-26', updated_at: new Date().toISOString(),
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
  const { data, error } = await supabase.storage.from('notizie-immagini').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('notizie-immagini').getPublicUrl(path);
  return publicUrl;
}
export function subscribeNotizie(callback) { return supabase.channel('notizie-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'notizie' }, callback).subscribe(); }
export async function getCommenti(notiziaId) { const { data, error } = await supabase.from('commenti_notizie').select('*').eq('notizia_id', notiziaId).order('created_at', { ascending: true }); if (error) throw error; return data || []; }
export async function insertCommento({ notiziaId, autore, squadra, testo }) { const { data, error } = await supabase.from('commenti_notizie').insert({ notizia_id: notiziaId, autore, squadra, testo }).select().single(); if (error) throw error; return data; }
export async function deleteCommento(id) { const { error } = await supabase.from('commenti_notizie').delete().eq('id', id); if (error) throw error; }
export function subscribeCommenti(notiziaId, callback) { return supabase.channel(`commenti-${notiziaId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'commenti_notizie', filter: `notizia_id=eq.${notiziaId}` }, callback).subscribe(); }
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
