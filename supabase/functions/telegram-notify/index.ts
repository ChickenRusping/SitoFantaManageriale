import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID   = Deno.env.get("TELEGRAM_CHANNEL_ID");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG           = `https://api.telegram.org/bot${BOT_TOKEN}`;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown = null) {
  if (body === null) return new Response("ok", { headers: CORS });
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(msg: string, status = 400) {
  return new Response(msg, { status, headers: CORS });
}

async function sendMessage(chatId: string | number, text: string) {
  try {
    const res = await fetch(`${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const json = await res.json();
    if (!json.ok) console.warn("TG error:", json.description);
    return json;
  } catch (e) {
    console.warn("TG fetch error:", e);
    return { ok: false };
  }
}

const APP = "https://fanta-manageriale.vercel.app";

// Nessun link cliccabile in nessun messaggio: portava i presidenti a navigare
// nell'app tramite il browser interno di Telegram, che ignora il
// cache-control e riscarica tutto da zero ad ogni apertura — causa di grossi
// picchi di cached egress su Supabase Storage anche su pagine leggere.

const CATEGORY_BADGE: Record<string, string> = {
  notizia_pinnata:        "━━━  📰  NEWS  📰  ━━━",
  nuova_notizia:          "━━━  📰  NEWS  📰  ━━━",
  commento_ricevuto:     "━━━  💬  COMMENTO  💬  ━━━",
  risposta_commento:     "━━━  ↩️  RISPOSTA  ↩️  ━━━",
  mercato_aperto:        "━━━  🏪  MERCATO  🏪  ━━━",
  mercato_chiuso:        "━━━  🏪  MERCATO  🏪  ━━━",
  trattativa_ricevuta:   "━━━  🤝  MERCATO  🤝  ━━━",
  trattativa_accettata:  "━━━  🤝  MERCATO  🤝  ━━━",
  trattativa_rifiutata:  "━━━  🤝  MERCATO  🤝  ━━━",
  trattativa_controfferta: "━━━  🤝  MERCATO  🤝  ━━━",
  chiamata_svincolati:   "━━━  ⚽  SVINCOLATI  ⚽  ━━━",
  asta_svincolati:       "━━━  🔔  ASTE  🔔  ━━━",
  asta_svincolati_conclusa: "━━━  🏁  ASTE  🏁  ━━━",
  asta_vinta:            "━━━  🏆  ASTA VINTA  🏆  ━━━",
  asta_persa:            "━━━  😔  ASTE  😔  ━━━",
  ds_masterclass_offerte:"━━━  🔍  DS MASTERCLASS  🔍  ━━━",
  ds_masterclass_usato:  "━━━  📡  DS MASTERCLASS  📡  ━━━",
  asta_tra_presidenti:   "━━━  🏛  ASTE TRA PRESIDENTI  🏛  ━━━",
  asta_assegnata:        "━━━  🏛  ASTE TRA PRESIDENTI  🏛  ━━━",
  svincolo:              "━━━  🔓  MERCATO  🔓  ━━━",
  scelta_allenatore:     "━━━  🎓  ALLENATORE  🎓  ━━━",
  investimento_acquistato: "━━━  📈  INVESTIMENTI  📈  ━━━",
  movimento_privato:     "━━━  💳  MOVIMENTO  💳  ━━━",
  tassa_applicata:       "━━━  📊  BILANCIO  📊  ━━━",
  stipendi_applicati:    "━━━  💰  STIPENDI  💰  ━━━",
  stadio_applicato:      "━━━  🏟  STADIO  🏟  ━━━",
  scadenza_imminente:    "━━━  ⏰  SCADENZA  ⏰  ━━━",
};

function buildMessage(type: string, p: Record<string, unknown>): string | null {
  const badge = CATEGORY_BADGE[type] ? `<b>${CATEGORY_BADGE[type]}</b>\n\n` : "";
  const link  = ""; // nessun link cliccabile in nessun messaggio (vedi nota sopra CATEGORY_BADGE)

  switch (type) {
    case "chiamata_svincolati":
      return `${badge}📣 <b>Nuova chiamata!</b>\n\n⚽ <b>${p.giocatore}</b> · Q${p.quotazione}\n🏟 <b>${p.squadra}</b> ha manifestato interesse\n⏰ Asta disponibile tra ${p.ore ?? 24}h se altri si uniscono${link}`;

    case "asta_svincolati":
      return `${badge}🔔 <b>Asta svincolati aperta!</b>\n\n⚽ <b>${p.giocatore}</b> · Q${p.quotazione}\n📣 Chiamato da: <b>${p.squadra}</b>\n⏰ Scade tra <b>${p.ore ?? 24}h</b> — fate le vostre offerte!${link}`;

    case "asta_svincolati_conclusa":
      return `${badge}🏁 <b>Asta conclusa!</b>\n\n⚽ <b>${p.giocatore}</b>\n🏆 Vinta da: <b>${p.vincitore}</b> per <b>${p.prezzo}M</b>${p.elencoAltri ? `\n\n📋 Altri interessati:\n${p.elencoAltri}` : ""}${link}`;

    case "asta_tra_presidenti":
      return `${badge}🏛 <b>Nuova asta tra presidenti!</b>\n\n⚽ <b>${p.giocatore}</b> · Q${p.quotazione}\n🏟 Indetta da: <b>${p.proprietario}</b>\n📊 Tipo: <b>${p.tipo_asta === "rialzo" ? "Al rialzo 📈" : "Al ribasso 📉"}</b>\n💰 Prezzo base: <b>${p.prezzo_base}M</b>${p.note ? `\n📝 ${p.note}` : ""}${link}`;

    case "asta_assegnata":
      return `${badge}🏁 <b>Asta conclusa!</b>\n\n⚽ <b>${p.giocatore}</b>${p.vincitore ? `\n🏆 Acquistato da: <b>${p.vincitore}</b> per <b>${p.importo}M</b>` : "\n❌ Nessuna offerta — asta chiusa senza vincitore"}${link}`;

    case "svincolo":
      return `${badge}🔓 <b>Giocatore svincolato</b>\n\n⚽ <b>${p.giocatore}</b> · Q${p.quotazione}\n🏟 Lascia: <b>${p.squadra}</b>${p.tipo ? `\n📋 Tipo: ${p.tipo}` : ""}${link}`;

    case "scelta_allenatore":
      return `${badge}🎓 <b>Nuova scelta allenatore!</b>\n\n🏟 <b>${p.squadra}</b>\n🎓 Allenatore: <b>${p.nomeAllenatore}</b>${link}`;

    case "investimento_acquistato":
      return `${badge}📈 <b>Nuovo investimento!</b>\n\n🏟 <b>${p.squadra}</b>\n💼 ${p.nome} · <b>${p.costo}M</b>${link}`;

    case "trattativa_ricevuta": {
      const bonus = Number(p.bonus || 0);
      const potenziale = Number(p.importo_potenziale || 0);
      const bonusLine = bonus > 0
        ? `\n🎯 Bonus: <b>+${bonus}M</b> · Totale potenziale: <b>${potenziale || (Number(p.importo || 0) + bonus)}M</b>`
        : "";

      return `${badge}📨 <b>Nuova offerta ricevuta!</b>\n\n⚽ <b>${p.giocatore}</b>\n💰 Offerta fissa: <b>${p.importo}M</b>${bonusLine}\n🏟 Da: <b>${p.da_squadra}</b>${link}`;
    }

    case "trattativa_accettata":
      // Convenzione payload: da_squadra = acquirente, a_squadra = cedente.
      // Il trasferimento va mostrato nel verso reale del giocatore: cedente → acquirente.
      return `${badge}✅ <b>Trasferimento completato!</b>\n\n⚽ <b>${p.giocatore}</b> si trasferisce per <b>${p.importo}M</b>\n📤 Da: <b>${p.a_squadra}</b> → 📥 <b>${p.da_squadra}</b>${link}`;

    case "trattativa_rifiutata":
      return `${badge}❌ <b>Offerta rifiutata</b>\n\nL'offerta per <b>${p.giocatore}</b> (${p.importo}M) non è stata accettata.${link}`;

    case "trattativa_controfferta":
      return `${badge}↩️ <b>Controfferta ricevuta</b>\n\n⚽ <b>${p.giocatore}</b>\n💰 Nuova richiesta: <b>${p.importo}M</b>${p.importo_precedente ? `\nPrecedente: ${p.importo_precedente}M` : ""}\n🏟 ${p.a_squadra ?? "Cedente"} ↔ ${p.da_squadra ?? "Acquirente"}${link}`;

    case "nuova_notizia":
      return `${badge}<b>${p.squadra ?? p.autore ?? "Lega Admin"}</b>\n\n<b>${p.titolo}</b>\n${String(p.testo ?? "").slice(0, 300)}${String(p.testo ?? "").length > 300 ? "…" : ""}${link}`;

    case "notizia_pinnata":
      return `${badge}📌 <b>${p.squadra ?? "Lega Admin"}</b>\n\n<b>${p.titolo}</b>\n${String(p.testo ?? "").slice(0, 300)}${String(p.testo ?? "").length > 300 ? "…" : ""}${link}`;

    case "commento_ricevuto":
      return `${badge}💬 <b>Nuovo commento al tuo post</b>\n\n🏟 <b>${p.autore_squadra ?? p.autore ?? "Un presidente"}</b> ha commentato:\n<b>${p.titolo}</b>\n\n“${String(p.testo ?? "").slice(0, 280)}${String(p.testo ?? "").length > 280 ? "…" : ""}”${link}`;

    case "risposta_commento":
      return `${badge}↩️ <b>Nuova risposta al tuo commento</b>\n\n🏟 <b>${p.autore_squadra ?? p.autore ?? "Un presidente"}</b> ti ha risposto nel post:\n<b>${p.titolo}</b>\n\n“${String(p.testo ?? "").slice(0, 280)}${String(p.testo ?? "").length > 280 ? "…" : ""}”${link}`;

    case "scadenza_imminente":
      return `${badge}⏰ <b>Scadenza tra ${p.giorni} giorn${Number(p.giorni) === 1 ? "o" : "i"}!</b>\n\n📋 ${p.label}\n📅 ${p.data}${link}`;

    case "mercato_aperto":
      return `${badge}🟢 <b>Mercato aperto</b> — sessione <b>${p.periodo}</b>\nPotete ora fare offerte e trattative.${link}`;

    case "mercato_chiuso":
      return `${badge}🔴 <b>Mercato chiuso</b>\nLa finestra di trasferimenti è terminata.${link}`;

    case "tassa_applicata":
      return `${badge}📊 <b>Tasse settimanali applicate</b>\nSettimana del ${p.domenica} — verificate i vostri bilanci.${link}`;

    case "stipendi_applicati":
      return `${badge}💰 <b>Stipendi mensili addebitati</b>\nMese: <b>${p.mese}</b> — verificate i vostri bilanci.${link}`;

    case "stadio_applicato":
      return `${badge}🏟 <b>Entrate stadio accreditate</b>\nMese: <b>${p.mese}</b>\n4M (base) · 5.5M (con Ristrutturazione Stadio)${link}`;

    case "asta_vinta":
      return `${badge}🏆 <b>Asta vinta!</b>\n\n⚽ <b>${p.giocatore}</b> è tuo per <b>${p.importo}M</b>!\nBenvenuto in rosa 🎉${link}`;

    case "asta_persa":
      return `${badge}😔 <b>Asta persa</b>\n\n⚽ <b>${p.giocatore}</b>\nVincitore: <b>${p.vincitore}</b> · ${p.importo}M${link}`;

    case "movimento_privato":
      return `${badge}${p.entrata ? `+${p.entrata}` : `-${p.uscita}`}M — ${p.descrizione}\n💰 Bilancio aggiornato: <b>${p.bilancio}M</b>${link}`;

    case "ds_masterclass_offerte":
      return `${badge}🔍 <b>DS Masterclass attivato!</b>\n\n⚽ <b>${p.giocatore}</b>\n💰 Offerta più alta al momento: <b>${p.offertaRivelata ? p.offertaRivelata + "M" : "nessuna offerta"}</b>\n⏰ Hai tempo fino alle <b>${p.scadenza}</b> per formulare/aggiornare la tua offerta.${link}`;

    case "ds_masterclass_usato":
      return `${badge}📡 <b>DS Masterclass utilizzato!</b>\n\n🏟 <b>${p.squadra}</b> ha attivato un utilizzo del DS Masterclass per l'asta di <b>${p.giocatore}</b>.\n⏳ 10 minuti di tempo extra per la sua offerta.${link}`;

    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const body = await req.json().catch(() => null);
  if (!body) return err("Bad request");

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── A) Incoming Telegram webhook ──────────────────────────────────────────
  if ("update_id" in body) {
    const msg = body.message ?? body.channel_post;
    if (!msg?.text) return ok();

    const chatId   = msg.chat.id as number;
    const text     = (msg.text as string).trim();
    const username = (msg.from?.username ?? msg.from?.first_name ?? "?") as string;

    if (text.startsWith("/start")) {
      const slug = text.split(" ")[1] ?? "";
      if (!slug) {
        await sendMessage(chatId, "👋 Benvenuto al bot di <b>Fanta Manageriale</b>!\n\nPer ricevere notifiche private, clicca il link nella tua pagina presidente.\n\nComandi:\n/status — mostra registrazione\n/unregister — rimuovi registrazione");
        return ok();
      }

      let squadra: string;
      try {
        squadra = atob(slug.replace(/-/g, "+").replace(/_/g, "/"));
      } catch {
        squadra = slug;
      }

      const { data: sq } = await db.from("squadre").select("name").eq("name", squadra).single();

      if (!sq) {
        await sendMessage(chatId, `❌ Squadra non trovata: <code>${squadra}</code>\n\nRiprova con il link dalla tua pagina presidente.`);
      } else {
        await db.from("telegram_registrations").upsert(
          { squadra, chat_id: chatId, username, registered_at: new Date().toISOString() },
          { onConflict: "squadra" }
        );

        await sendMessage(chatId, `✅ <b>Registrazione completata!</b>\n\n🏟 Squadra: <b>${squadra}</b>\n👤 Username: @${username}\n\nRiceverai notifiche private per:\n• 📨 Trattative ricevute\n• 🏆 Risultati aste svincolati\n• 💳 Movimenti importanti`);
      }

    } else if (text === "/status") {
      const { data: reg } = await db.from("telegram_registrations").select("squadra, registered_at").eq("chat_id", chatId).single();

      if (reg) {
        await sendMessage(chatId, `✅ Registrato come: <b>${reg.squadra}</b>\nDal: ${new Date(reg.registered_at as string).toLocaleDateString("it-IT")}`);
      } else {
        await sendMessage(chatId, "❌ Non sei registrato.\nUsa il link dalla tua pagina presidente.");
      }

    } else if (text === "/unregister") {
      await db.from("telegram_registrations").delete().eq("chat_id", chatId);
      await sendMessage(chatId, "✅ Registrazione rimossa.");
    }

    return ok();
  }

  // ── B) Outgoing notification from React app ───────────────────────────────
  const { type, payload = {}, squadra: targetSquadra } = body as {
    type: string;
    payload: Record<string, unknown>;
    squadra?: string;
  };

  if (!type) return err("Missing type");

  const text = buildMessage(type, payload);
  if (!text) return err(`Unknown type: ${type}`);

  const results: Array<{ target: string; ok: boolean }> = [];

  const publicTypes = [
    "chiamata_svincolati",
    // "asta_svincolati" NON è pubblica: annuncia l'apertura della fase offerte
    // privatamente solo agli interessati (vedi creaAstaDaChiamate).
    "asta_svincolati_conclusa",
    "ds_masterclass_usato",
    "asta_tra_presidenti",
    "asta_assegnata",
    "svincolo",
    "scelta_allenatore",
    "investimento_acquistato",
    "trattativa_accettata",
    "nuova_notizia",
    "scadenza_imminente",
    "mercato_aperto",
    "mercato_chiuso",
    "tassa_applicata",
    "stipendi_applicati",
    "stadio_applicato",
  ];

  if (publicTypes.includes(type) && CHANNEL_ID) {
    const r = await sendMessage(CHANNEL_ID, text);
    results.push({ target: "channel", ok: r.ok === true });
  }

  if (targetSquadra) {
    // ilike + trim: tollerante a differenze di maiuscole/spazi tra il nome
    // squadra salvato in telegram_registrations (via /start) e quello passato
    // dall'app (profilo/notizia/commento) — un mismatch qui fa fallire in
    // silenzio l'invio privato senza che nessun errore sia visibile.
    const { data: reg } = await db
      .from("telegram_registrations")
      .select("chat_id")
      .ilike("squadra", targetSquadra.trim())
      .maybeSingle();

    if (reg?.chat_id) {
      const r = await sendMessage(reg.chat_id as number, text);
      results.push({ target: targetSquadra, ok: r.ok === true });
    } else {
      results.push({ target: targetSquadra, ok: false });
    }
  }

  return ok({ ok: true, results });
});
