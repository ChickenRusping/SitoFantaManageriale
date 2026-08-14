import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// Cron lato server per le aste svincolati (art. 6.3).
//
// Finora tutto (apertura asta da chiamata scaduta, promemoria, rivelazione +
// assegnazione finale) dipendeva SOLO dal fatto che qualche presidente
// avesse la pagina Mercato aperta in quel momento (polling ogni 3 minuti
// lato client, vedi checkScadenzeAste in src/supabase.js). Se nessuno aveva
// l'app aperta, tutto restava bloccato finché un admin non interveniva a
// mano; se troppi la avevano aperta insieme, due esecuzioni concorrenti
// potevano rivelare la STESSA asta due volte (visto in produzione: rose
// duplicate). Questa funzione fa girare l'intero ciclo lato server, così non
// dipende più da nessuno dei due scenari. Va schedulata con pg_cron (vedi
// cron_check_aste_setup.sql) ogni 2-3 minuti.
//
// ATTENZIONE MANUTENZIONE: la logica di business qui sotto (calcolo
// scadenze, regole vivaio/clausole/riacquisto, selezione vincitore) è una
// copia 1:1 delle funzioni equivalenti in src/supabase.js (creaAstaDaChiamate,
// rivelaECompletaAsta, _avanzaMasterclass e i loro helper). Le due copie NON
// sono condivise: se cambi una regola in un posto, cambiala anche qui,
// altrimenti client e server finiscono per comportarsi diversamente.
//
// Il polling client continua comunque a girare in parallelo (non è stato
// tolto): il lock atomico (colonna elaborazione_lock su aste_svincolati)
// garantisce che, se client e server ci provano nello stesso momento, solo
// uno dei due porti a termine la rivelazione.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET   = Deno.env.get("CRON_SECRET"); // opzionale ma consigliato

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isMissingColumnError(error: any) {
  const msg = (error?.message || "").toLowerCase();
  return msg.includes("column") || msg.includes("schema cache") || msg.includes("could not find");
}

// ── Orario Italia (freeze notturno 00:00-08:00, mesi vivaio) ──────────────────
// Il client calcola queste cose con Date.getHours()/setHours()/getMonth(),
// che nel browser dei presidenti operano in ora locale italiana. Deno gira in
// UTC: per riottenere esattamente lo stesso risultato (comprese le ore legali/
// solari) convertiamo esplicitamente avanti e indietro dal fuso di Roma
// invece di limitarci a un'approssimazione a step fissi.
const IT_TZ = "Europe/Rome";

function italyWallClockParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: IT_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year), mo: Number(p.month), d: Number(p.day),
    h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second),
  };
}

// Offset (minuti) tra ora italiana e UTC nell'istante dato (+60 CET / +120 CEST).
function italyOffsetMinutes(instant: Date): number {
  const p = italyWallClockParts(instant);
  const asIfUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asIfUTC - instant.getTime()) / 60000);
}

// Costruisce l'istante UTC reale corrispondente a un dato orologio da parete
// italiano (y/mo/d/h/mi/s), gestendo correttamente il cambio ora legale.
function realDateFromItalyWallClock(y: number, mo: number, d: number, h: number, mi: number, s = 0): Date {
  const guessUTC = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset1 = italyOffsetMinutes(new Date(guessUTC));
  let real = guessUTC - offset1 * 60000;
  const offset2 = italyOffsetMinutes(new Date(real));
  if (offset2 !== offset1) real = guessUTC - offset2 * 60000;
  return new Date(real);
}

const FREEZE_INIZIO_H = 0;
const FREEZE_FINE_H = 8;
function isInFreezeOra(hour: number) { return hour >= FREEZE_INIZIO_H && hour < FREEZE_FINE_H; }

function isVivaioAcquistiAperti(date = new Date()) {
  const { mo } = italyWallClockParts(date); // 1=gennaio
  return mo >= 9 || mo <= 5; // 01/09 - 31/05
}

// Porting 1:1 di _scadenzaConFreeze (src/supabase.js), con setHours/setDate
// (ora locale del browser) sostituiti dall'equivalente ora-di-Roma esplicito.
function scadenzaConFreeze(fromTime: Date, minutiAttivi: number): Date {
  let rimasti = minutiAttivi;
  let t = new Date(fromTime);
  let guard = 0;
  while (rimasti > 0 && guard++ < 1000) {
    const p = italyWallClockParts(t);
    if (isInFreezeOra(p.h)) {
      // Prossime 08:00 italiane (oggi se t è prima delle 08:00, altrimenti già garantito dal ramo else)
      let next08 = realDateFromItalyWallClock(p.y, p.mo, p.d, FREEZE_FINE_H, 0, 0);
      if (next08.getTime() <= t.getTime()) {
        const dPlus1 = new Date(realDateFromItalyWallClock(p.y, p.mo, p.d, 12, 0, 0).getTime() + 24 * 3600000);
        const p2 = italyWallClockParts(dPlus1);
        next08 = realDateFromItalyWallClock(p2.y, p2.mo, p2.d, FREEZE_FINE_H, 0, 0);
      }
      t = next08;
    } else {
      const mezzanotteDomaniBase = new Date(realDateFromItalyWallClock(p.y, p.mo, p.d, 12, 0, 0).getTime() + 24 * 3600000);
      const p2 = italyWallClockParts(mezzanotteDomaniBase);
      const mezzanotte = realDateFromItalyWallClock(p2.y, p2.mo, p2.d, FREEZE_INIZIO_H, 0, 0);
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

function calcolaScadenzaOfferteLibero(scadenzaInteresse: Date): Date {
  return scadenzaConFreeze(scadenzaInteresse, 12 * 60);
}

// ── Slot venerdì (modalità normale) ────────────────────────────────────────
async function calcolaSlotVenerdì(venerdìUTC: Date, scadenzaInteresseChiamata: string) {
  const giornoChiamate = new Date(venerdìUTC);
  giornoChiamate.setUTCDate(giornoChiamate.getUTCDate() - 1);
  giornoChiamate.setUTCHours(0, 0, 0, 0);
  const fineGiornoChiamate = new Date(giornoChiamate);
  fineGiornoChiamate.setUTCHours(23, 59, 59, 999);

  const { data: chiamateStessoVenerdi } = await supabase
    .from("chiamate")
    .select("scadenza_interesse")
    .gte("scadenza_interesse", giornoChiamate.toISOString())
    .lte("scadenza_interesse", fineGiornoChiamate.toISOString());

  const targetISO = new Date(scadenzaInteresseChiamata).toISOString();
  return (chiamateStessoVenerdi || []).filter((c: any) => c.scadenza_interesse < targetISO).length;
}

// ── Coda modalità libera (distanziamento minimo 30' tra scadenze offerte) ──
async function calcolaScadenzaOfferteLiberoConCoda(primariaTarget: any): Promise<Date> {
  try {
    const { data: coda } = await supabase
      .from("chiamate")
      .select("giocatore, scadenza_interesse, asta_id")
      .eq("tipo", "prima")
      .eq("modalita", "libero")
      .lte("scadenza_interesse", primariaTarget.scadenza_interesse)
      .order("scadenza_interesse", { ascending: true });

    let lista = coda || [];
    if (!lista.some((c: any) => c.giocatore === primariaTarget.giocatore)) {
      lista = [...lista, {
        giocatore: primariaTarget.giocatore,
        scadenza_interesse: primariaTarget.scadenza_interesse,
        asta_id: primariaTarget.asta_id || null,
      }].sort((a: any, b: any) => new Date(a.scadenza_interesse).getTime() - new Date(b.scadenza_interesse).getTime());
    }

    const astaIds = [...new Set(lista.map((c: any) => c.asta_id).filter(Boolean))];
    const scadenzeReali: Record<string, Date> = {};
    if (astaIds.length) {
      const { data: asteReali } = await supabase.from("aste_svincolati").select("id, scadenza").in("id", astaIds);
      for (const a of (asteReali || [])) scadenzeReali[a.id] = new Date(a.scadenza);
    }

    let ultima: Date | null = null;
    for (const c of lista) {
      let effettiva: Date;
      if (c.asta_id && scadenzeReali[c.asta_id]) {
        effettiva = scadenzeReali[c.asta_id];
      } else {
        const naturale = calcolaScadenzaOfferteLibero(new Date(c.scadenza_interesse));
        const minimaSuccessiva = ultima ? scadenzaConFreeze(ultima, 30) : null;
        effettiva = minimaSuccessiva && naturale.getTime() < minimaSuccessiva.getTime() ? minimaSuccessiva : naturale;
      }
      if (c.giocatore === primariaTarget.giocatore) return effettiva;
      ultima = effettiva;
    }
    return calcolaScadenzaOfferteLibero(new Date(primariaTarget.scadenza_interesse));
  } catch {
    return calcolaScadenzaOfferteLibero(new Date(primariaTarget.scadenza_interesse));
  }
}

async function calcolaScadenzaOfferteAttesa(primaria: any): Promise<Date> {
  const scadenzaInteresse = new Date(primaria.scadenza_interesse);
  const modalita = primaria.modalita || "normale";

  if (modalita === "libero") {
    return await calcolaScadenzaOfferteLiberoConCoda(primaria);
  }
  const ven = new Date(scadenzaInteresse);
  ven.setUTCDate(scadenzaInteresse.getUTCDate() + 1);
  ven.setUTCHours(13, 0, 0, 0);
  const slot = await calcolaSlotVenerdì(ven, primaria.scadenza_interesse);
  ven.setUTCMinutes(slot * 30);
  return ven;
}

// ── Notifiche (Telegram + centro notifiche in-app) — squadra omessa = pubblica
async function notifica(type: string, payload: Record<string, unknown>, squadra: string | null = null) {
  try {
    await supabase.functions.invoke("telegram-notify", {
      body: { type, payload, ...(squadra ? { squadra } : {}) },
    });
  } catch (e) {
    console.warn("[cron-check-aste] telegram-notify failed:", e);
  }
  try {
    const formatted = formatNotificaApp(type, payload);
    if (formatted) {
      await supabase.from("notifiche_app").insert({
        tipo: type, titolo: formatted.titolo, corpo: formatted.corpo,
        link_pagina: formatted.link, squadra_destinataria: squadra,
      });
    }
  } catch (e) {
    console.warn("[cron-check-aste] notifiche_app insert failed:", e);
  }
}

function formatNotificaApp(type: string, p: Record<string, any>): { titolo: string; corpo: string; link: string } | null {
  const link = "/mercato";
  switch (type) {
    case "asta_svincolati":
      return { titolo: "Asta svincolati aperta", corpo: `${p.giocatore} · Q${p.quotazione} — chiamato da ${p.squadra}`, link };
    case "asta_svincolati_promemoria":
      return { titolo: "Ultima chiamata — manca 1 ora", corpo: `${p.giocatore} · Q${p.quotazione} — non hai ancora inviato un'offerta`, link };
    case "asta_svincolati_conclusa":
      return { titolo: "Asta conclusa", corpo: `${p.giocatore} vinta da ${p.vincitore} per ${p.prezzo}M`, link };
    case "asta_vinta":
      return { titolo: "Asta vinta!", corpo: `${p.giocatore} è tuo per ${p.importo}M`, link };
    case "asta_persa":
      return { titolo: "Asta persa", corpo: `${p.giocatore} — vincitore: ${p.vincitore} (${p.importo}M)`, link };
    case "ds_masterclass_offerte":
      return { titolo: "DS Masterclass attivato", corpo: `${p.giocatore} — offerta più alta: ${p.offertaRivelata ? p.offertaRivelata + "M" : "nessuna offerta"}`, link };
    case "ds_masterclass_usato":
      return { titolo: "DS Masterclass utilizzato", corpo: `${p.squadra} ha attivato un utilizzo per l'asta di ${p.giocatore}`, link };
    case "scadenza_imminente":
      return { titolo: "Scadenza oggi", corpo: `${p.label} — ${p.data}`, link: "/lega" };
    default:
      return null;
  }
}

// ── Scadenze pubbliche (art. vari del regolamento) — notifica alle 9:00.
// ATTENZIONE MANUTENZIONE: stessa lista di DEADLINE_DEFS in App.jsx (pagina
// Lega e pagina Deadline) — se cambi una scadenza in un posto, cambiala anche
// negli altri due.
// `precoce: true` = l'orario reale della scadenza è tra le 00:00 e le 09:00
// (quindi le 9 di quel giorno sarebbero già tardi): si notifica alle 9:00 del
// giorno PRIMA. Tutte le altre (orario preciso dalle 9 in poi, o nessun
// orario preciso indicato — in tal caso si intende "entro le 24") si
// notificano alle 9:00 del giorno stesso.
const DEADLINE_DEFS_PUBBLICHE: { label: string; month?: number; day: number; type: "annual" | "monthly"; precoce?: boolean }[] = [
  { label: "Apertura mercato estivo", month: 6, day: 1, type: "annual" },
  { label: "Chiusura mercato estivo", month: 9, day: 15, type: "annual" },
  { label: "Apertura mercato invernale", month: 1, day: 1, type: "annual" },
  { label: "Chiusura mercato invernale", month: 2, day: 15, type: "annual" },
  { label: "Quota iscrizione campionato (30M)", month: 7, day: 31, type: "annual" },
  { label: "Decisione investimento extra budget (0–10€)", month: 8, day: 14, type: "annual" },
  { label: "Pagamento quota iscrizione (30€) al tesoriere", month: 8, day: 31, type: "annual" },
  { label: "Inizio finestra ritiro budget extra", month: 1, day: 5, type: "annual" },
  { label: "Pagamento costo vivaio (4M)", month: 8, day: 15, type: "annual" },
  { label: "Acquisto giocatori vivaio (apertura)", month: 9, day: 1, type: "annual" },
  { label: "Pagamento stipendi mensile", day: 1, type: "monthly", precoce: true }, // 00:01
  { label: "Abbassamento stipendi giocatori in calo", month: 1, day: 5, type: "annual" },
  { label: "Aggiornamento stipendi 01/01", month: 1, day: 1, type: "annual", precoce: true }, // 08:00
  { label: "Termine ribasso stipendi 01/01", month: 1, day: 5, type: "annual" },
  { label: "Aggiornamento stipendi fine stagione 01/06", month: 6, day: 1, type: "annual", precoce: true }, // 08:00
  { label: "Aggiornamento stipendi pre-stagione 01/08", month: 8, day: 1, type: "annual", precoce: true }, // 08:00
  { label: "Rinnovo/non rinnovo contratti biennali", month: 5, day: 31, type: "annual" },
  { label: "Vendita/svincolo giocatori contratto ribassato", month: 9, day: 15, type: "annual" },
  { label: "Scelta obiettivo — 8° classificato", month: 8, day: 6, type: "annual" }, // 15:00
  { label: "Scelta obiettivo — 7° classificato", month: 8, day: 7, type: "annual", precoce: true }, // 03:00
  { label: "Scelta obiettivo — 6° classificato", month: 8, day: 7, type: "annual" }, // 15:00
  { label: "Scelta obiettivo — 5° classificato", month: 8, day: 8, type: "annual", precoce: true }, // 03:00
  { label: "Scelta obiettivo — 4° classificato", month: 8, day: 8, type: "annual" }, // 15:00
  { label: "Scelta obiettivo — 3° classificato", month: 8, day: 9, type: "annual", precoce: true }, // 03:00
  { label: "Scelta obiettivo — 2° classificato", month: 8, day: 9, type: "annual" }, // 15:00
  { label: "Scelta obiettivo — 1° classificato", month: 8, day: 10, type: "annual", precoce: true }, // 03:00
  { label: "Apertura comunicazione investimenti", month: 8, day: 1, type: "annual" },
  { label: "Chiusura comunicazione investimenti", month: 9, day: 20, type: "annual" },
  { label: "Scadenza Ricapitalizzazione", month: 9, day: 5, type: "annual" },
  { label: "Apertura investimenti invernali", month: 12, day: 24, type: "annual" },
  { label: "Chiusura investimenti invernali", month: 12, day: 31, type: "annual" },
];

// ── Step 4: notifica pubblica alle 9:00 (ora italiana) per le scadenze del
// giorno — o del giorno prima, per quelle con orario reale precoce (00-09).
async function notificaScadenzeDelGiorno(ora: Date) {
  const { y, mo, d, h, mi } = italyWallClockParts(ora);
  // Il cron gira ogni 2-3 minuti: la finestra 9:00-9:03 cattura sempre un solo
  // tick al giorno. La tabella scadenze_notificate resta comunque la vera
  // protezione da doppi invii (es. riavvii, trigger manuali).
  if (h !== 9 || mi >= 3) return [];

  // Giorno successivo a oggi (per individuare le scadenze "precoci" di domani,
  // da annunciare invece oggi alle 9): pura aritmetica di calendario, nessun
  // problema di fuso — y/mo/d sono già l'orologio da parete italiano.
  const domani = new Date(Date.UTC(y, mo - 1, d) + 86400000);
  const domaniMo = domani.getUTCMonth() + 1, domaniD = domani.getUTCDate();

  const mesi = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
  const oggiMatch = DEADLINE_DEFS_PUBBLICHE.filter(def => {
    const targetMo = def.precoce ? domaniMo : mo;
    const targetD = def.precoce ? domaniD : d;
    return def.type === "monthly" ? def.day === targetD : (def.month === targetMo && def.day === targetD);
  });

  const risultati: any[] = [];
  for (const def of oggiMatch) {
    // La chiave usa comunque la data REALE della scadenza (non quella di
    // invio), così resta unica anche per le notifiche precoci del giorno prima.
    const scadeMo = def.precoce ? domaniMo : mo, scadeD = def.precoce ? domaniD : d;
    const scadeY = def.precoce && domaniMo === 1 && mo === 12 ? y + 1 : y;
    const chiave = `${def.label}|${scadeY}-${String(scadeMo).padStart(2, "0")}-${String(scadeD).padStart(2, "0")}`;
    const { error: insErr } = await supabase.from("scadenze_notificate").insert({ chiave });
    if (insErr) continue; // già notificata oggi (violazione unique) o tabella non ancora creata
    const dataStr = def.type === "monthly" ? `${String(scadeD).padStart(2, "0")} del mese` : `${String(scadeD).padStart(2, "0")} ${mesi[scadeMo - 1]}`;
    await notifica("scadenza_imminente", { giorni: 0, label: def.label, data: dataStr }, null);
    risultati.push({ tipo: "scadenza_notificata", label: def.label });
  }
  return risultati;
}

// ── Step 1: chiamate scadute → crea asta ───────────────────────────────────
async function creaAstaDaChiamate(nomeGiocatore: string) {
  const { data: astaEsistente } = await supabase.from("aste_svincolati")
    .select("id").eq("giocatore", nomeGiocatore).eq("stato", "raccolta_offerte").maybeSingle();
  if (astaEsistente) throw new Error("Asta già esistente per questo giocatore.");

  const { data: chiamate } = await supabase.from("chiamate")
    .select("*").eq("giocatore", nomeGiocatore).eq("stato", "aperta")
    .order("created_at", { ascending: true });
  if (!chiamate?.length) throw new Error("Nessuna chiamata trovata");

  const primaria = chiamate.find((c: any) => c.tipo === "prima");
  if (!primaria) throw new Error("Chiamata principale non trovata");

  const scadenzaInteresse = new Date(primaria.scadenza_interesse);
  const modalita = primaria.modalita || "normale";
  const scadenzaOfferte = await calcolaScadenzaOfferteAttesa(primaria);

  const payload = {
    giocatore: nomeGiocatore,
    ruolo: primaria.ruolo,
    anni: primaria.anni || 0,
    quot: primaria.quot,
    squadra_serie_a: primaria.squadra_serie_a || "",
    per_vivaio: primaria.per_vivaio || false,
    aperta_da: primaria.squadra,
    modalita,
    scadenza_interesse: scadenzaInteresse.toISOString(),
    scadenza: scadenzaOfferte.toISOString(),
    stato: "raccolta_offerte",
    n_interessati: chiamate.length,
  };
  const { data: asta, error } = await supabase.from("aste_svincolati").insert(payload).select().single();
  if (error?.code === "23505") throw new Error("Asta già esistente per questo giocatore.");
  if (error) throw error;

  await supabase.from("chiamate")
    .update({ stato: "in_asta", asta_id: asta.id })
    .eq("giocatore", nomeGiocatore).eq("stato", "aperta");

  const oreResidue = Math.max(1, Math.round((scadenzaOfferte.getTime() - Date.now()) / 3600000));
  await Promise.all((chiamate || []).map((c: any) => notifica("asta_svincolati", {
    giocatore: nomeGiocatore, quotazione: primaria.quot, squadra: primaria.squadra, ore: oreResidue,
  }, c.squadra)));

  return asta;
}

// ── Stagione / investimenti (per limite vivaio, clausola segreta, ecc.) ────
// Porting minimale di getStagioneQuota / _hasInvestimentoAttivo /
// _getVivaioLimit / _calcolaClausolaPerSquadra da src/supabase.js.
// Etichetta stagione usata per il tracking dei passaggi sessione (art. 5.6) —
// porting di stagioneDaData in src/supabase.js (boundary 01/06, non 01/07
// come stagioneStartYear qui sotto: sono due calcoli distinti nel codice
// originale, non unificarli).
function stagioneDaData(date = new Date()): string {
  const { y, mo, d } = italyWallClockParts(date);
  const start = (mo > 6 || (mo === 6 && d >= 1)) ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

function stagioneStartYear(date = new Date()): number {
  const { y, mo, d } = italyWallClockParts(date);
  return (mo > 6 || (mo === 6 && d >= 1)) ? y : y - 1;
}
function getStagioneQuota(date = new Date()): string {
  const start = stagioneStartYear(date);
  return `${start}-${String(start + 1).slice(2)}`;
}
function stagioneStartFromLabel(stagione: string): number {
  const m = String(stagione || "").match(/^(\d{4})/);
  return m ? Number(m[1]) : stagioneStartYear(new Date());
}
async function hasInvestimentoAttivo(squadra: string, nome: string, date = new Date()): Promise<boolean> {
  const stagione = getStagioneQuota(date);
  const { data } = await supabase.from("investimenti").select("*")
    .eq("squadra", squadra).eq("nome", nome).eq("attivo", true).eq("stagione", stagione);
  if (!data?.length) return false;
  if (nome === "Clausola Segreta" || nome === "Deroga U-21") {
    const start = stagioneStartYear(date);
    const fine = realDateFromItalyWallClock(start + 1, 6, 1, 0, 0, 0); // 01/06 successivo
    return date < fine;
  }
  return true;
}
async function getVivaioLimit(squadra: string, date = new Date()): Promise<number> {
  const stagione = getStagioneQuota(date);
  const currentStart = stagioneStartFromLabel(stagione);
  const { data } = await supabase.from("investimenti").select("stagione")
    .eq("squadra", squadra).eq("nome", "Settore Giovanile Avanzato").eq("attivo", true);
  const active = (data || []).some((inv: any) => {
    const invStart = stagioneStartFromLabel(inv.stagione);
    return currentStart >= invStart + 1 && currentStart <= invStart + 2;
  });
  return active ? 4 : 2;
}
async function calcolaClausolaPerSquadra(squadra: string, quot: number, date = new Date()): Promise<number> {
  const segreta = await hasInvestimentoAttivo(squadra, "Clausola Segreta", date);
  const moltiplicatore = segreta ? 2.0 : 1.75;
  return parseFloat((Number(quot || 0) * moltiplicatore).toFixed(2));
}

// Eleggibilità vivaio (età/quotazione/presenze + slot disponibili). A
// differenza dei paletti di composizione rosa (U21, tetto 30, max 5 stesso
// club) — non più bloccanti da nessuna parte, vedi assertRosaDopoAggiunta in
// src/supabase.js — questi restano requisiti reali del programma vivaio, non
// "forma" della rosa: qui vanno rispettati anche in un'assegnazione forzata.
async function assertVivaioDopoAggiunta(squadra: string, giocatore: any) {
  const anni = Number(giocatore.anni || 0);
  const quot = Number(giocatore.quot || 0);
  const presenze = Number(giocatore.presenze_voto ?? giocatore.partite ?? giocatore.vivaio_presenze ?? 0);
  if (!(anni > 0 && anni <= 23)) throw new Error(`${giocatore.nome} non è idoneo al vivaio: servono Under-23.`);
  if (quot > 3) throw new Error(`${giocatore.nome} non è idoneo al vivaio: Q${quot}, massimo Q3.`);
  if (presenze > 0) throw new Error(`${giocatore.nome} non è idoneo al vivaio: ha già ${presenze} presenze a voto.`);
  const { count } = await supabase.from("rosa").select("id", { count: "exact", head: true })
    .eq("squadra", squadra).eq("in_vivaio", true);
  const limiteVivaio = await getVivaioLimit(squadra, new Date());
  if ((count || 0) >= limiteVivaio) throw new Error(`Vivaio pieno: massimo ${limiteVivaio} giocatori.`);
}

// Riacquisto entro 60gg dallo svincolo: lettura diretta di stagione_svincoli
// (semplificata rispetto a getStagioneSvincoli in src/supabase.js, che fa
// anche riconciliazione/creazione del record — qui serve solo la lettura).
async function verificaRiacquistoConsentito(squadra: string, giocatore: string) {
  const { data } = await supabase.from("stagione_svincoli").select("svincolati_history")
    .eq("squadra", squadra).limit(1);
  const history = Array.isArray(data?.[0]?.svincolati_history) ? data![0].svincolati_history : [];
  const record = [...history].reverse().find((h: any) => String(h.nome || "").toLowerCase() === String(giocatore || "").toLowerCase());
  if (!record?.riacquistabile_dal) return true;
  const oggi = new Date().toISOString().slice(0, 10);
  if (oggi < record.riacquistabile_dal) {
    throw new Error(`${giocatore} non può essere riacquistato da ${squadra} prima del ${record.riacquistabile_dal} (60 giorni dallo svincolo).`);
  }
  return true;
}

// ── DS Masterclass: avanza la coda di finestre extra prima del reveal finale
async function avanzaMasterclass(asta: any): Promise<boolean> {
  const ora = new Date();

  if (asta.masterclass_squadra_attiva) {
    if (ora < new Date(asta.masterclass_scadenza_attiva)) return false;
    await supabase.from("aste_svincolati").update({
      masterclass_squadra_attiva: null, masterclass_scadenza_attiva: null,
    }).eq("id", asta.id);
  }

  const { data: prossime } = await supabase.from("masterclass_richieste")
    .select("*").eq("asta_id", asta.id).is("avviato_at", null)
    .order("ordine_interesse", { ascending: true }).limit(1);
  const prossima = prossime?.[0];
  if (!prossima) return true; // nessun Masterclass in coda: pronta per il reveal finale

  const { data: offerte } = await supabase.from("offerte_asta")
    .select("squadra, importo, assente").eq("asta_id", asta.id);
  const avversarie = (offerte || []).filter((o: any) => o.squadra !== prossima.squadra && !o.assente);
  const maxOfferta = avversarie.length ? Math.max(...avversarie.map((o: any) => Number(o.importo))) : 0;

  const scadenzaExtra = new Date(ora.getTime() + 10 * 60000);
  await supabase.from("aste_svincolati").update({
    masterclass_squadra_attiva: prossima.squadra,
    masterclass_scadenza_attiva: scadenzaExtra.toISOString(),
  }).eq("id", asta.id);
  await supabase.from("masterclass_richieste").update({
    avviato_at: ora.toISOString(), offerta_rivelata: maxOfferta,
  }).eq("id", prossima.id);

  await notifica("ds_masterclass_usato", { giocatore: asta.giocatore, squadra: prossima.squadra });
  await notifica("ds_masterclass_offerte", {
    giocatore: asta.giocatore,
    offertaRivelata: maxOfferta > 0 ? maxOfferta.toFixed(2) : null,
  }, prossima.squadra);

  return false; // finestra appena avviata: non ancora pronta per il reveal finale
}

// ── Step 3: rivela offerte + trasferimento automatico ──────────────────────
async function rivelaECompletaAsta(astaId: number) {
  const { data: asta } = await supabase.from("aste_svincolati").select("*").eq("id", astaId).single();
  if (!asta) throw new Error("Asta non trovata");
  if (asta.per_vivaio && !isVivaioAcquistiAperti()) throw new Error("Le assegnazioni al vivaio sono consentite solo dal 01/09 al 31/05.");

  if (asta.masterclass_squadra_attiva && new Date() < new Date(asta.masterclass_scadenza_attiva)) {
    throw new Error("Impossibile rivelare ora: un presidente sta usando il DS Masterclass, attendi la sua finestra extra.");
  }
  const { data: masterclassInCoda } = await supabase.from("masterclass_richieste")
    .select("id").eq("asta_id", astaId).is("avviato_at", null).limit(1);
  if (masterclassInCoda?.length) {
    throw new Error("Impossibile rivelare ora: ci sono utilizzi del DS Masterclass ancora in coda per questa asta.");
  }

  // Lock atomico: stesso meccanismo (stessa colonna) usato dal client in
  // src/supabase.js — se client e server (o due giri di cron) ci provano
  // nello stesso momento, solo uno riesce a "prendere in carico" l'asta.
  const { data: lockRows, error: lockErr } = await supabase.from("aste_svincolati")
    .update({ elaborazione_lock: new Date().toISOString() })
    .eq("id", astaId).eq("stato", "raccolta_offerte").is("elaborazione_lock", null)
    .select("id");
  const lockDisponibile = !lockErr;
  if (lockDisponibile && !lockRows?.length) {
    throw new Error("Asta già in elaborazione da un altro processo (o già completata).");
  }

  try {
    const { data: chiamate } = await supabase.from("chiamate")
      .select("squadra, created_at").eq("giocatore", asta.giocatore)
      .order("created_at", { ascending: true });
    const ordineInteresse = (chiamate || []).map((c: any) => c.squadra);

    let vincitore: string, prezzoFinale: number, tutteOfferte: any[] = [];

    if (ordineInteresse.length <= 1) {
      vincitore = ordineInteresse[0] || asta.aperta_da;
      if (!vincitore) throw new Error("Nessun interessato trovato per questa asta.");
      prezzoFinale = parseFloat((Number(asta.quot || 0) * 0.75).toFixed(2));
    } else {
      const { data: offerteEsistenti } = await supabase.from("offerte_asta").select("*").eq("asta_id", astaId);
      const squadreConOfferta = new Set((offerteEsistenti || []).map((o: any) => o.squadra));

      const minOffertaAsta = parseFloat((Number(asta.quot || 0) * 0.75).toFixed(2));
      for (const sq of ordineInteresse) {
        if (!squadreConOfferta.has(sq)) {
          const { data: squadraOfferente } = await supabase.from("squadre").select("bilancio").eq("name", sq).single();
          const bilancioDisp = Number(squadraOfferente?.bilancio || 0);
          const offertaAutomatica = parseFloat(Math.min(Number(asta.quot || 0), bilancioDisp).toFixed(2));
          if (offertaAutomatica >= minOffertaAsta) {
            await supabase.from("offerte_asta").upsert({
              asta_id: astaId, squadra: sq, importo: offertaAutomatica,
              per_vivaio: asta.per_vivaio, assente: true,
            }, { onConflict: "asta_id,squadra" });
          }
        }
      }

      const { data: offerteRaw } = await supabase.from("offerte_asta")
        .select("*").eq("asta_id", astaId).order("importo", { ascending: false });
      for (const off of (offerteRaw || [])) {
        const { data: sq } = await supabase.from("squadre").select("bilancio").eq("name", off.squadra).single();
        if (Number(off.importo || 0) <= Number(sq?.bilancio || 0) + 0.0001) tutteOfferte.push(off);
      }
      if (!tutteOfferte.length) throw new Error("Nessuna offerta valida: nessun interessato ha liquidità sufficiente.");

      const maxImporto = Number(tutteOfferte?.[0]?.importo || 0);
      const pareggi = tutteOfferte.filter((o: any) => Number(o.importo) === maxImporto);
      vincitore = pareggi.length === 1
        ? pareggi[0].squadra
        : (ordineInteresse.find((sq: string) => pareggi.some((p: any) => p.squadra === sq)) || pareggi[0]?.squadra);
      prezzoFinale = maxImporto;
      if (!vincitore) throw new Error("Nessun offerente");
    }

    await verificaRiacquistoConsentito(vincitore, asta.giocatore);

    const oggi = new Date().toISOString().slice(0, 10);
    const stip = parseFloat((Number(asta.quot) / 5).toFixed(2));
    const claus = await calcolaClausolaPerSquadra(vincitore, Number(asta.quot), new Date());

    if (asta.per_vivaio) {
      await assertVivaioDopoAggiunta(vincitore, { nome: asta.giocatore, anni: asta.anni, quot: asta.quot, presenze_voto: asta.presenze_voto || 0 });
      await supabase.from("rosa").insert({
        squadra: vincitore, nome: asta.giocatore, ruolo: asta.ruolo,
        anni: asta.anni, quot: asta.quot, stip: 0, stip_originale: stip, clausola: claus,
        squadra_serie_a: asta.squadra_serie_a,
        in_vivaio: true, vivaio_presenze: 0, quot_iniziale_vivaio: asta.quot, vivaio_pagato: false,
        anni_contratto: 1, data_acquisto: oggi,
      });
    } else {
      // Nessun assertRosaDopoAggiunta qui: i paletti di forma della rosa
      // (U21, tetto 30, max 5 stesso club) non bloccano più un'assegnazione
      // d'asta — vedi assertRosaDopoAggiunta in src/supabase.js.
      // Art. 5.6: essere svincolato conta come una squadra nella catena dei
      // passaggi — l'acquisto da svincolati È il primo passaggio.
      await supabase.from("rosa").insert({
        squadra: vincitore, nome: asta.giocatore, ruolo: asta.ruolo,
        anni: asta.anni, quot: asta.quot, stip, clausola: claus,
        squadra_serie_a: asta.squadra_serie_a,
        in_vivaio: false, anni_contratto: 1, data_acquisto: oggi,
        passaggi_sessione: 1, ultima_sessione_mercato: stagioneDaData(new Date()),
      });
      await supabase.from("svincolati").delete().eq("nome", asta.giocatore);
    }

    const { data: sq } = await supabase.from("squadre").select("bilancio").eq("name", vincitore).single();
    await supabase.from("squadre").update({ bilancio: parseFloat((Number(sq!.bilancio) - prezzoFinale).toFixed(2)) }).eq("name", vincitore);

    await supabase.from("movimenti").insert({
      squadra: vincitore,
      descrizione: `Acquisto ${asta.giocatore} da Svincolati${asta.per_vivaio ? " (Vivaio)" : ""}`,
      uscita: prezzoFinale, data: oggi,
    });

    await supabase.from("chiamate").delete().eq("giocatore", asta.giocatore);

    await supabase.from("aste_svincolati").update({
      stato: "assegnata", vincitore, prezzo_finale: prezzoFinale,
    }).eq("id", astaId);

    const altreOfferte = tutteOfferte.filter((o: any) => o.squadra !== vincitore);
    const elencoAltri = altreOfferte.length
      ? altreOfferte.map((o: any) => `${o.squadra}: ${Number(o.importo).toFixed(2)}M${o.assente ? " (auto)" : ""}`).join("\n")
      : null;
    await notifica("asta_svincolati_conclusa", {
      giocatore: asta.giocatore, vincitore, prezzo: prezzoFinale.toFixed(2), elencoAltri,
    });
    await notifica("asta_vinta", { giocatore: asta.giocatore, importo: prezzoFinale.toFixed(2) }, vincitore);
    for (const perdente of ordineInteresse.filter((sq: string) => sq !== vincitore)) {
      await notifica("asta_persa", { giocatore: asta.giocatore, vincitore, importo: prezzoFinale.toFixed(2) }, perdente);
    }

    return { vincitore, prezzoFinale, offerte: tutteOfferte };
  } catch (e) {
    if (lockDisponibile) {
      await supabase.from("aste_svincolati").update({ elaborazione_lock: null })
        .eq("id", astaId).eq("stato", "raccolta_offerte");
    }
    throw e;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (CRON_SECRET) {
    const auth = req.headers.get("x-cron-secret");
    if (auth !== CRON_SECRET) {
      return new Response("unauthorized", { status: 401, headers: CORS });
    }
  }

  const risultati: any[] = [];
  const ora = new Date();
  const oraISO = ora.toISOString();

  // 1) Chiamate con scadenza_interesse scaduta → crea asta
  const { data: chiamateScadute } = await supabase.from("chiamate")
    .select("giocatore, quot, per_vivaio, scadenza_interesse, squadra, tipo")
    .eq("stato", "aperta").eq("tipo", "prima").lte("scadenza_interesse", oraISO)
    .order("scadenza_interesse", { ascending: true });

  for (const c of chiamateScadute || []) {
    try {
      const asta = await creaAstaDaChiamate(c.giocatore);
      risultati.push({ tipo: "asta_creata", giocatore: c.giocatore, astaId: asta.id });
    } catch (e) {
      if (!String(e.message).includes("già esistente")) {
        risultati.push({ tipo: "errore", giocatore: c.giocatore, error: e.message });
      }
    }
  }

  // 2) Aste in raccolta offerte che scadono entro 1h → promemoria a chi non
  // ha ancora offerto (una sola volta, vedi promemoria_1h_inviato).
  const traUnOra = new Date(ora.getTime() + 60 * 60000).toISOString();
  const { data: asteInScadenza } = await supabase.from("aste_svincolati")
    .select("id, giocatore, quot, scadenza, promemoria_1h_inviato")
    .eq("stato", "raccolta_offerte").gt("scadenza", oraISO).lte("scadenza", traUnOra);

  for (const a of asteInScadenza || []) {
    if (a.promemoria_1h_inviato) continue;
    try {
      const [{ data: chiamate }, { data: offerte }] = await Promise.all([
        supabase.from("chiamate").select("squadra").eq("asta_id", a.id),
        supabase.from("offerte_asta").select("squadra").eq("asta_id", a.id),
      ]);
      const giaOfferto = new Set((offerte || []).map((o: any) => o.squadra));
      const daAvvisare = [...new Set((chiamate || []).map((c: any) => c.squadra))].filter((s: any) => !giaOfferto.has(s));
      await Promise.all(daAvvisare.map((squadra: any) => notifica("asta_svincolati_promemoria", {
        giocatore: a.giocatore, quotazione: a.quot,
      }, squadra)));
      await supabase.from("aste_svincolati").update({ promemoria_1h_inviato: true }).eq("id", a.id);
      risultati.push({ tipo: "promemoria_inviato", giocatore: a.giocatore, squadre: daAvvisare });
    } catch (e) {
      risultati.push({ tipo: "errore", giocatore: a.giocatore, error: e.message });
    }
  }

  // 3) Aste con scadenza offerte scaduta → rivela e completa (in ordine di
  // scadenza, come il polling client).
  const { data: asteScadute } = await supabase.from("aste_svincolati")
    .select("*").eq("stato", "raccolta_offerte").lte("scadenza", oraISO)
    .order("scadenza", { ascending: true });

  for (const a of asteScadute || []) {
    try {
      const pronta = await avanzaMasterclass(a);
      if (!pronta) { risultati.push({ tipo: "masterclass_in_corso", giocatore: a.giocatore }); continue; }
      const r = await rivelaECompletaAsta(a.id);
      risultati.push({ tipo: "asta_completata", giocatore: a.giocatore, ...r });
    } catch (e) {
      risultati.push({ tipo: "errore", id: a.id, error: e.message });
    }
  }

  // 4) Scadenze pubbliche del giorno (alle 9:00 ora italiana)
  try {
    risultati.push(...await notificaScadenzeDelGiorno(ora));
  } catch (e) {
    risultati.push({ tipo: "errore", contesto: "scadenze_pubbliche", error: e.message });
  }

  return new Response(JSON.stringify({ ok: true, risultati }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
