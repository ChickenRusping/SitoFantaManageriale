import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// Cron lato server per le aste svincolati (art. 6.3).
//
// Finora l'apertura automatica dell'asta quando scade il termine per
// manifestare interesse dipendeva SOLO dal fatto che qualche presidente
// avesse la pagina Mercato aperta in quel momento (polling ogni 3 minuti
// lato client, vedi checkScadenzeAste in src/supabase.js). Se nessuno aveva
// l'app aperta, la chiamata restava bloccata finché un admin non premeva
// "Crea Asta" a mano.
//
// Questa funzione replica SOLO la parte "creazione asta da chiamata scaduta"
// + il promemoria a 1h dalla scadenza offerte, così gira sempre, a
// prescindere da chi ha l'app aperta. Va schedulata con pg_cron (vedi
// cron_check_aste_setup.sql) ogni 2-3 minuti.
//
// La fase di "rivela e assegna" (che muove soldi e giocatori) resta
// intenzionalmente basata sul polling client per ora, per non duplicare
// tutta la logica finanziaria (bonus vivaio, clausole, riacquisti, ecc.) in
// due posti separati con rischio di disallineamento — se serve, si può
// portare qui in un secondo momento.
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

// ── Notifiche (Telegram privato + centro notifiche in-app) ────────────────
async function notificaPrivata(type: string, payload: Record<string, unknown>, squadra: string) {
  try {
    await supabase.functions.invoke("telegram-notify", { body: { type, payload, squadra } });
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
    default:
      return null;
  }
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
  await Promise.all((chiamate || []).map((c: any) => notificaPrivata("asta_svincolati", {
    giocatore: nomeGiocatore, quotazione: primaria.quot, squadra: primaria.squadra, ore: oreResidue,
  }, c.squadra)));

  return asta;
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
      await Promise.all(daAvvisare.map((squadra: any) => notificaPrivata("asta_svincolati_promemoria", {
        giocatore: a.giocatore, quotazione: a.quot,
      }, squadra)));
      await supabase.from("aste_svincolati").update({ promemoria_1h_inviato: true }).eq("id", a.id);
      risultati.push({ tipo: "promemoria_inviato", giocatore: a.giocatore, squadre: daAvvisare });
    } catch (e) {
      risultati.push({ tipo: "errore", giocatore: a.giocatore, error: e.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, risultati }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
