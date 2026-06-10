// Supabase Edge Function — Telegram Notifications
// Deploy via: Supabase Dashboard → Edge Functions → New Function
//
// Required env vars (set in Supabase Dashboard → Settings → Edge Functions):
//   TELEGRAM_BOT_TOKEN      — from @BotFather
//   TELEGRAM_CHANNEL_ID     — e.g. "@fantamanageriale" or "-100xxxxxxxxxx"
//   TELEGRAM_BOT_USERNAME   — e.g. "fantamanagerialebot" (no @)

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHANNEL_ID       = Deno.env.get("TELEGRAM_CHANNEL_ID");
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Telegram helpers ─────────────────────────────────────────────────────────

async function sendMessage(chatId: string | number, text: string, extra: object = {}) {
  try {
    const res = await fetch(`${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra }),
    });
    const json = await res.json();
    if (!json.ok) console.warn("Telegram sendMessage error:", json.description);
    return json;
  } catch (e) {
    console.warn("Telegram fetch error:", e);
    return { ok: false };
  }
}

// ─── Message builder ──────────────────────────────────────────────────────────

function buildMessage(type: string, payload: Record<string, unknown>): string | null {
  switch (type) {

    // ── PUBLIC (channel) ──────────────────────────────────────────────────────

    case "chiamata_svincolati":
      return `📣 <b>Nuova chiamata!</b>\n\n⚽ <b>${payload.giocatore}</b> · Q${payload.quotazione}\n🏟 <b>${payload.squadra}</b> ha manifestato interesse\n⏰ Asta disponibile tra ${payload.ore ?? 24}h se altri si uniscono`;

    case "asta_svincolati":
      return `🔔 <b>Asta svincolati aperta!</b>\n\n⚽ <b>${payload.giocatore}</b> · Q${payload.quotazione}\n📣 Chiamato da: <b>${payload.squadra}</b>\n⏰ Scade tra <b>${payload.ore ?? 24}h</b> — fate le vostre offerte!`;

    case "notizia_pinnata":
      return `📌 <b>${payload.squadra ?? "Lega Admin"}</b>\n\n<b>${payload.titolo}</b>\n${String(payload.testo ?? "").slice(0, 300)}${String(payload.testo ?? "").length > 300 ? "…" : ""}`;

    case "scadenza_imminente":
      return `⏰ <b>Scadenza tra ${payload.giorni} giorn${Number(payload.giorni) === 1 ? "o" : "i"}!</b>\n\n📋 ${payload.label}\n📅 ${payload.data}`;

    case "mercato_aperto":
      return `🟢 <b>Mercato aperto</b> — sessione <b>${payload.periodo}</b>\nPotete ora fare offerte e trattative.`;

    case "mercato_chiuso":
      return `🔴 <b>Mercato chiuso</b>\nLa finestra di trasferimenti è terminata.`;

    case "tassa_applicata":
      return `📊 <b>Tasse settimanali applicate</b>\nSettimana del ${payload.domenica} — verificate i vostri bilanci.`;

    case "stipendi_applicati":
      return `💰 <b>Stipendi mensili addebitati</b>\nMese: <b>${payload.mese}</b> — verificate i vostri bilanci.`;

    case "stadio_applicato":
      return `🏟 <b>Entrate stadio accreditate</b>\nMese: <b>${payload.mese}</b>\n4M (base) · 5.5M (con Ristrutturazione Stadio)`;

    // ── PRIVATE (to specific team) ────────────────────────────────────────────

    case "trattativa_ricevuta":
      return `📨 <b>Nuova offerta ricevuta!</b>\n\n⚽ <b>${payload.giocatore}</b>\n💰 Offerta: <b>${payload.importo}M</b>\n🏟 Da: <b>${payload.da_squadra}</b>\nAccedi all'app per rispondere.`;

    case "trattativa_accettata":
      return `✅ <b>Trattativa accettata!</b>\n\n⚽ <b>${payload.giocatore}</b> si trasferisce per <b>${payload.importo}M</b>`;

    case "trattativa_rifiutata":
      return `❌ <b>Offerta rifiutata</b>\n\nL'offerta per <b>${payload.giocatore}</b> (${payload.importo}M) non è stata accettata.`;

    case "asta_vinta":
      return `🏆 <b>Asta vinta!</b>\n\n⚽ <b>${payload.giocatore}</b> è tuo per <b>${payload.importo}M</b>!\nBenvenuto in rosa 🎉`;

    case "asta_persa":
      return `😔 <b>Asta persa</b>\n\n⚽ <b>${payload.giocatore}</b>\nVincitore: <b>${payload.vincitore}</b> · ${payload.importo}M`;

    case "movimento_privato":
      return `💳 <b>Nuovo movimento</b>\n\n${payload.entrata ? `+${payload.entrata}` : `-${payload.uscita}`}M — ${payload.descrizione}\n💰 Bilancio aggiornato: <b>${payload.bilancio}M</b>`;

    default:
      return null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  // Allow CORS from the app
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const body = await req.json().catch(() => null);
  if (!body) return new Response("Bad request", { status: 400 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── A) Incoming webhook from Telegram ──────────────────────────────────────
  if ("update_id" in body) {
    const msg = body.message ?? body.channel_post;
    if (!msg?.text) return new Response("ok");

    const chatId   = msg.chat.id as number;
    const text     = (msg.text as string).trim();
    const username = (msg.from?.username ?? msg.from?.first_name ?? "?") as string;

    if (text.startsWith("/start")) {
      const slug = text.split(" ")[1] ?? "";

      if (!slug) {
        await sendMessage(chatId,
          "👋 Benvenuto al bot di <b>Fanta Manageriale</b>!\n\nPer ricevere notifiche private, clicca il link di registrazione nella tua pagina presidente sull'app.\n\nComandi:\n/status — mostra la tua registrazione"
        );
        return new Response("ok");
      }

      // Decode squad name (base64url)
      let squadra: string;
      try {
        squadra = atob(slug.replace(/-/g, "+").replace(/_/g, "/"));
      } catch {
        squadra = slug;
      }

      const { data: sq } = await db.from("squadre").select("name").eq("name", squadra).single();

      if (!sq) {
        await sendMessage(chatId,
          `❌ Squadra non trovata: <code>${squadra}</code>\n\nRiprova con il link dalla tua pagina presidente.`
        );
      } else {
        await db.from("telegram_registrations").upsert(
          { squadra, chat_id: chatId, username, registered_at: new Date().toISOString() },
          { onConflict: "squadra" }
        );
        await sendMessage(chatId,
          `✅ <b>Registrazione completata!</b>\n\n🏟 Squadra: <b>${squadra}</b>\n👤 Username: @${username}\n\nRiceverai notifiche private per:\n• 📨 Trattative ricevute\n• 🏆 Risultati aste svincolati\n• 💳 Movimenti importanti\n\nPer notifiche pubbliche (aste, news, scadenze) unisciti al canale della lega.`
        );
      }

    } else if (text === "/status") {
      const { data: reg } = await db.from("telegram_registrations").select("squadra, username, registered_at").eq("chat_id", chatId).single();
      if (reg) {
        const since = new Date(reg.registered_at as string).toLocaleDateString("it-IT");
        await sendMessage(chatId, `✅ Registrato come: <b>${reg.squadra}</b>\nDal: ${since}`);
      } else {
        await sendMessage(chatId, "❌ Non sei registrato.\nUsa il link dalla tua pagina presidente.");
      }

    } else if (text === "/unregister") {
      await db.from("telegram_registrations").delete().eq("chat_id", chatId);
      await sendMessage(chatId, "✅ Registrazione rimossa. Non riceverai più notifiche private.");
    }

    return new Response("ok");
  }

  // ── B) Outgoing notification (called from React app) ──────────────────────
  const { type, payload = {}, squadra: targetSquadra } = body as {
    type: string;
    payload: Record<string, unknown>;
    squadra?: string;
  };

  if (!type) return new Response("Missing type", { status: 400 });

  const text = buildMessage(type, payload);
  if (!text) return new Response(`Unknown type: ${type}`, { status: 400 });

  const results: Array<{ target: string; ok: boolean }> = [];

  // Public types → channel
  const publicTypes = [
    "chiamata_svincolati", "asta_svincolati", "notizia_pinnata",
    "scadenza_imminente", "mercato_aperto", "mercato_chiuso",
    "tassa_applicata", "stipendi_applicati", "stadio_applicato",
  ];

  if (publicTypes.includes(type) && CHANNEL_ID) {
    const r = await sendMessage(CHANNEL_ID, text);
    results.push({ target: "channel", ok: r.ok === true });
  }

  // Private types → specific team
  if (targetSquadra) {
    const { data: reg } = await db
      .from("telegram_registrations")
      .select("chat_id")
      .eq("squadra", targetSquadra)
      .single();

    if (reg?.chat_id) {
      const r = await sendMessage(reg.chat_id as number, text);
      results.push({ target: targetSquadra, ok: r.ok === true });
    } else {
      results.push({ target: targetSquadra, ok: false, ...{ reason: "not_registered" } });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
