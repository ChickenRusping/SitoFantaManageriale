import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useLocation, useParams, Navigate } from "react-router-dom";

// ─── STAGIONE / BIENNIO DINAMICI ─────────────────────────────────────────────
// Il cambio avviene automaticamente il 01/06 di ogni anno.
// Bienni: 25/26+26/27 → 2025-27, poi 27/28+28/29 → 2027-29, ecc.
function calcolaStaginoCorrente() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const dopoGiugno1 = m > 6 || (m === 6 && d >= 1);
  const startYear = dopoGiugno1 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}
function calcolaBiennioCorrente() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const dopoGiugno1 = m > 6 || (m === 6 && d >= 1);
  const startYear = dopoGiugno1 ? y : y - 1;
  const bStart = startYear % 2 === 1 ? startYear : startYear - 1;
  return `${bStart}-${String(bStart + 2).slice(2)}`;
}
const STAGIONE_CORRENTE = calcolaStaginoCorrente();
const BIENNIO_CORRENTE  = calcolaBiennioCorrente();

// ─── CACHE IN MEMORIA ────────────────────────────────────────────────────────
// Evita di ricaricare gli stessi dati ogni volta che si naviga tra le pagine.
// I dati vengono invalidati dopo TTL ms (default 90 secondi).
const _cache = new Map();
function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttl = 90000) {
  _cache.set(key, { data, exp: Date.now() + ttl });
}
function cacheInvalidate(pattern) {
  for (const key of _cache.keys()) {
    if (key.startsWith(pattern)) _cache.delete(key);
  }
}

// ─── SISTEMA DEADLINE & APP STATE ────────────────────────────────────────────
// Definisce tutte le deadline del calendario con logica di calcolo automatico.
// Il hook useDeadlineWatcher calcola il tempo alla prossima e schedula un timeout.
// Quando scatta: invalida la cache rilevante e notifica i subscriber.

const DEADLINE_CALENDARIO = [
  { id: 'mercato_estivo_open',    month: 6,  day: 1,  hour: 9,  type: 'mercato',  label: 'Apertura mercato estivo' },
  { id: 'mercato_estivo_close',   month: 9,  day: 15, hour: 24, type: 'mercato',  label: 'Chiusura mercato estivo' },
  { id: 'mercato_inv_open',       month: 1,  day: 1,  hour: 9,  type: 'mercato',  label: 'Apertura mercato invernale' },
  { id: 'mercato_inv_close',      month: 2,  day: 15, hour: 24, type: 'mercato',  label: 'Chiusura mercato invernale' },
  { id: 'tassa_settimanale',      weekday: 0, hour: 23, minute: 0, type: 'tassa', label: 'Tassa settimanale' },
  { id: 'stipendi_mensili',       day: 1,    hour: 0,  minute: 1,  type: 'stipendi', label: 'Pagamento stipendi' },
  { id: 'aggiornamento_stipendi_gen', month: 1, day: 1, hour: 8, type: 'stipendi', label: 'Aggiornamento stipendi 01/01' },
  { id: 'aggiornamento_stipendi_giu', month: 6, day: 1, hour: 8, type: 'stipendi', label: 'Aggiornamento stipendi 01/06' },
  { id: 'ribasso_stipendi',       month: 1,  day: 5,  hour: 20, type: 'stipendi', label: 'Scadenza ribasso stipendi' },
  { id: 'rinnovo_contratti',      month: 5,  day: 31, hour: 23, minute: 59, type: 'contratti', label: 'Scadenza rinnovo contratti' },
  { id: 'iscrizione_campionato',  month: 7,  day: 31, hour: 23, minute: 59, type: 'quote', label: 'Iscrizione campionato (30M)' },
];

function getNextOccurrence(def) {
  const now = new Date();
  const year = now.getFullYear();

  // Deadline settimanale (es. tassa domenica 23:00)
  if (def.weekday !== undefined) {
    const d = new Date(now);
    const diff = (def.weekday - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 && (d.getHours() > def.hour || (d.getHours() === def.hour && d.getMinutes() >= (def.minute||0))) ? 7 : diff));
    d.setHours(def.hour, def.minute || 0, 0, 0);
    return d;
  }

  // Deadline mensile (es. stipendi il 1 di ogni mese)
  if (!def.month && def.day) {
    let d = new Date(year, now.getMonth(), def.day, def.hour, def.minute || 0, 0, 0);
    if (d <= now) d = new Date(year, now.getMonth() + 1, def.day, def.hour, def.minute || 0, 0, 0);
    return d;
  }

  // Deadline annuale
  let d = new Date(year, def.month - 1, def.day, def.hour === 24 ? 23 : def.hour, def.hour === 24 ? 59 : (def.minute || 0), 0, 0);
  if (d <= now) d = new Date(year + 1, def.month - 1, def.day, def.hour === 24 ? 23 : def.hour, def.hour === 24 ? 59 : (def.minute || 0), 0, 0);
  return d;
}

// Calcola lo stato mercato corrente
function calcolaStatoMercato() {
  const now = new Date();
  const m = now.getMonth() + 1, d = now.getDate(), h = now.getHours();

  const inEstivo = (m === 6 && h >= 9) || (m > 6 && m < 9) || (m === 9 && (d < 15 || (d === 15 && h < 24)));
  const inInvernale = (m === 1 && h >= 9) || (m === 2 && (d < 15 || (d === 15 && h < 24)));
  const aperto = inEstivo || inInvernale;
  const periodo = inEstivo ? 'estivo' : inInvernale ? 'invernale' : null;

  return { aperto, periodo, now };
}

// Hook: si aggiorna automaticamente quando scatta una deadline
function useDeadlineWatcher(onDeadlineScattata) {
  const [statoMercato, setStatoMercato] = useState(calcolaStatoMercato);
  const cbRef = useRef(onDeadlineScattata);
  useEffect(() => { cbRef.current = onDeadlineScattata; }, [onDeadlineScattata]);

  useEffect(() => {
    let timer = null;

    function scheduleNext() {
      const now = new Date();
      // Trova la prossima deadline tra tutte quelle definite
      const prossima = DEADLINE_CALENDARIO
        .map(def => ({ def, date: getNextOccurrence(def) }))
        .filter(x => x.date > now)
        .sort((a, b) => a.date - b.date)[0];

      if (!prossima) return;

      const msToNext = prossima.date.getTime() - now.getTime();
      // Limita a max 1 ora per ricalcolare anche se la prossima è lontana
      const delay = Math.min(msToNext + 2000, 60 * 60 * 1000);

      timer = setTimeout(() => {
        const nuovoStato = calcolaStatoMercato();
        setStatoMercato(nuovoStato);

        // Invalida cache rilevante per tipo di deadline
        if (prossima.def.type === 'mercato') {
          cacheInvalidate('trattative');
          cacheInvalidate('aste');
        }
        if (prossima.def.type === 'stipendi') {
          cacheInvalidate('rosa_');
          cacheInvalidate('contratti_');
        }
        if (['mercato','stipendi','contratti','tassa'].includes(prossima.def.type)) {
          cacheInvalidate('classifica');
        }

        // Notifica il chiamante
        if (cbRef.current) cbRef.current(prossima.def);

        // Schedula la prossima
        scheduleNext();
      }, delay);
    }

    scheduleNext();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  return statoMercato;
}

async function cachedFetch(key, fetcher, ttl = 90000) {
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  const data = await fetcher();
  cacheSet(key, data, ttl);
  return data;
}


import { TEAMS, getFPStatus, getSCColor, getRoleColor, FREE_AGENTS } from "./data.js";
import { supabase, signIn, signOut, toggleFPFEsclusione, getPrestitiScaduti, eseguiScadenzaPrestito, applicaPagamentiAutomatici, getProfile, getSquadre, updateSquadra, getRosa, updateGiocatore, insertGiocatore, deleteGiocatore, subscribeRosa, getOfferte, insertOfferta, updateOffertaStato, deleteOfferta, getChiamate, insertChiamata, deleteChiamata, aggiungiInteresse, getChiamateByGiocatore, calcolaScadenzaInteresse, calcolaScadenzaOfferte, completaUnicoInteressato, creaAstaDaChiamate, getMovimenti, getMovimentiFPF, insertMovimento, deleteMovimento, subscribeOfferte, subscribeChiamate, subscribeSquadre, subscribeMovimenti, subscribeMovimentiAll, aggiornaSCNegativo, getContrattiInScadenza, getClubIdentity, updateClubIdentity, getAllClubIdentities, uploadImmagineSquadra, rimuoviImmagineSquadra, getObiettivi, updateObiettivo, insertObiettivo, deleteObiettivo, subscribeObiettivi, getTrattative, insertTrattativa, updateTrattativa, deleteTrattativa, subscribeTrattative, getAste, insertAsta, updateAsta, subscribeAste, eseguiTrasferimento, eseguiRescissioneAnticipataPrestito, checkEAggiornaPassaggi, resetPassaggiSessione, calcolaStatoNotificaOfferta, getOfferteInAttesa, getClausole, insertClausola, updateClausola, deleteClausola, subscribeClausole, getPrestitiAttivi, getClassifica, updateClassificaSquadra, upsertClassifica, subscribeClassifica, getSvincoli, getStagioneSvincoli, eseguiSvincolo, calcolaTassa, isTassaAttiva, getTassePagate, applicaTassaSettimana, getDomenicaCorrente, getFasciaBilancioNeg, getPenalitaNeg, getSemestreCorrente, calcolaNettoSpeso, calcolaFairSpending, getFairSpending, getAllenatori, getAllenatoreBySquadra, getObiettiviCarta, getProgressoObiettivi, upsertProgresso, scegliAllenatore, rimuoviAllenatore, getFpfTutteSquadre, getSCAllenatore, getInvestimenti, acquistaInvestimento, updateInvestimento, registraGuadagnoInvestimento, deleteInvestimento, getSponsor, insertSponsor, updateSponsor, getPenalita, insertPenalita, updatePenalita, deletePenalita, applicaMulta, countRecidive, getPremi, insertPremio, applicaPremio, calcolaPremio19a, calcolaPremiFinali, calcolaPremiCoppa, applicaIscrizioneCampionato, investiEuroExtra, ritiraBudgetExtra, resetBiennio, segnaQuotaPagata, applicaIscrizioneATutti, logAzione, getAuditLog, effettuaRollback, getVivaio, acquistaVivaio, promuoviDaVivaio, svincolaVivaio, aggiornaPresenzeVivaio, pagaCostoVivaio, filtraVivaioCandidati, getSvincolatiDB, upsertSvincolato, updateSvincolatoStats, deleteSvincolato, importSvincolatiDaArray, filtraVivaioCandidatiDB, calcolaTop5Aggiornamenti, calcolaAnteprimaAggiornamentoQuote, applicaAggiornamentoQuote, applicaRinnovoRialzo, applicaRinnovoRibasso, isFinestraRibasso, getAggiornamenti, getFinestraChiamate, getAsteSvincolati, insertAstaSvincolati, updateAstaSvincolati, getOfferteAsta, upsertOffertaAsta, rivelaAsta, confermaTrasferimentoAsta, checkAsteScadute, checkScadenzeAste, subscribeAsteSvincolati, calcolaScadenzaAsta, isVivaioAcquistiAperti,
  // Nuove funzioni mercato
  getListone, getListoneBySquadra, importListoneDaExcel, aggiornaFantaSquadraListone, aggiornaStipendioDopoTrasferimento,
  getBonusTrattativa, insertBonusTrattativa, deleteBonusTrattativa, checkECompletaBonus, getLabelBonus,
  getNotizie, insertNotizia, updateNotizia, deleteNotizia, togglePinnata, toggleReaction, uploadNotiziaImmagine, subscribeNotizie,
  getCommenti, insertCommento, updateCommento, deleteCommento, subscribeCommenti,
  calcolaStatoTrattativaMercato, applicaPenalitaRitardoAuto,
  // Contratti
  aggiornaContrattiAnnuali, confermRinnovoBiennale,
  // Admin Control Room
  getStadioInvestimenti, setStadioUpgrade, applicaEntrateStadioTutte,
  applicaTassaATutti, annullaTassaATutti, ripulisciAnomalieTasse, ripulisciStoricoTassePrimaDi, applicaStipendioATutti, getControlRoomStatus,
  // Extra Control Room
  updateProfile, uploadAvatar,
  getMercatoOverride, setMercatoOverride, getTrasferimentiDifferiti,
  applicaMulteFPFTutte, applicaPremiCampionato,
  // Database Fanta import + Rivalità lock
  importDatabaseFanta, getRivalitaLock, setRivalitaLock,
  calcolaTop5GlobaleQuotReale, applica01Gennaio, applica01GiugnoAgosto, importa01Agosto,
  getStagioneLabel, setStagioneLabel,
  getTorneo, setTorneo,
  // Telegram
  sendTelegramNotification, getTelegramRegistrations, deleteTelegramRegistration,
  // Albo d'Oro & Regolamento
  getStagioniPassate, upsertStagione, deleteStagione, uploadMaglia,
  getRegolamentoArticoli, upsertRegolamentoArticolo, insertRegolamentoArticolo, deleteRegolamentoArticolo,
} from "./supabase.js";

// ─── SORTABLE TABLE HOOK ──────────────────────────────────────────────────────
// Restituisce: { sorted, sortKey, sortDir, handleSort, SortTh }
// SortTh: componente <th> cliccabile con freccia direzionale
function useSortableTable(data, defaultKey, defaultDir = "asc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), "it", { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  // th component factory
  function SortTh({ col, label, align = "center", style: extraStyle = {}, className }) {
    const active = sortKey === col;
    const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
    return (
      <th
        onClick={() => handleSort(col)}
        className={className}
        style={{
          padding: "6px 8px",
          textAlign: align,
          fontSize: 10,
          fontWeight: 700,
          color: active ? "#a5b4fc" : "#555",
          letterSpacing: "0.07em",
          borderBottom: "1px solid #ffffff12",
          whiteSpace: "nowrap",
          cursor: "pointer",
          userSelect: "none",
          ...extraStyle,
        }}
      >
        {label}{arrow}
      </th>
    );
  }

  return { sorted, sortKey, sortDir, handleSort, SortTh };
}

/* ─── SHARED UI ─────────────────────────────────────────────────────────────── */
// Calcola lo stipendio corretto in base a quotazione, anno contratto ed età (art. 4.8 + 4.8.1)
function calcolaStipCorretto(quot, anniContratto, anni) {
  const base = parseFloat((Number(quot || 0) / 5).toFixed(2));
  const isU21 = anni > 0 && anni <= 21;
  const ac = anniContratto || 0;
  if (isU21 || ac <= 1) return base;
  if (ac === 2) return parseFloat((base * 1.1).toFixed(2));
  if (ac === 3) return parseFloat((base * 1.2).toFixed(2));
  return parseFloat((base * 0.9).toFixed(2)); // anno 4+: Bonus Fedeltà
}

function Badge({ children, color }) {
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function StatBar({ value, max, color, height = 6 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ background: "#ffffff12", borderRadius: 99, height, overflow: "hidden", width: "100%" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99 }} />
    </div>
  );
}

function TeamAvatar({ team, size = 38 }) {
  // Se disponibile lo stemma caricato, mostralo; altrimenti fallback al tag
  if (team?.stemma_url) {
    return (
      <div style={{ width: size, height: size, borderRadius: size * 0.28, overflow: "hidden", border: `2px solid ${team.color}66`, flexShrink: 0, boxShadow: `0 4px 14px ${team.color}33`, background: "#0d0f14" }}>
        <img src={team.stemma_url} alt={team.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.28, background: `linear-gradient(135deg,${team.color}cc,${team.color}44)`, border: `2px solid ${team.color}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.27, fontWeight: 900, color: "#fff", flexShrink: 0, fontFamily: "'Bebas Neue',sans-serif", boxShadow: `0 4px 14px ${team.color}33`, letterSpacing: "0.5px" }}>
      {team.tag}
    </div>
  );
}

/* ─── TEAM CARD ─────────────────────────────────────────────────────────────── */
function TeamCard({ team, onClick, scLive: scLiveProp, allenatore: allenatoreReale }) {
  const scLive = scLiveProp ?? team.salaryUsed ?? 0;

  // FPF = netto speso semestre corrente (uscite − entrate, escl. stipendi), passato da mergedTeams
  const fpf = team.fpf ?? null;
  const fpfDisplay = fpf !== null ? `${fpf.toFixed(1)}M` : "—";
  const fpfColor = fpf === null ? "#555" : fpf > 60 ? "#ef4444" : fpf > 55 ? "#f97316" : fpf > 50 ? "#f59e0b" : "#10b981";
  const scColor = scLive > 75 ? "#ef4444" : scLive > 74 ? "#f97316" : scLive > 70 ? "#f59e0b" : scLive > 65 ? "#fbbf24" : scLive > 60 ? "#888" : "#10b981";
  const scLibero = parseFloat((75 - scLive).toFixed(1));
  const scLiberoColor = scLibero >= 10 ? "#10b981" : scLibero >= 3 ? "#6ee7b7" : scLibero >= 0 ? "#888" : scLibero >= -5 ? "#f59e0b" : scLibero >= -10 ? "#f97316" : "#ef4444";
  const scLiberoStr = scLibero > 0 ? `+${scLibero.toFixed(1)}M` : `${scLibero.toFixed(1)}M`;
  const giocatori = team.giocatori || 0;
  const u21 = team.u21 || 0;
  const rosaColor = giocatori > 30 || giocatori < 25 ? "#ef4444" : giocatori >= 28 ? "#10b981" : "#888";
  const u21Required = giocatori >= 30 ? 3 : giocatori >= 29 ? 2 : giocatori >= 28 ? 1 : 0;
  const u21Color = u21Required === 0 ? "#888" : u21 >= u21Required ? "#10b981" : u21 === u21Required - 1 ? "#f59e0b" : "#ef4444";
  const bilColor = team.bilancio >= 20 ? "#10b981" : team.bilancio >= 10 ? "#888" : team.bilancio >= 5 ? "#fbbf24" : team.bilancio >= 0 ? "#f97316" : "#ef4444";
  const hasAlert = u21 < u21Required || team.bilancio < 5 || scLive > 75 || (fpf !== null && fpf > 50); // FPF warning from 50 (approaching limit)

  return (
    <div onClick={onClick} style={{ background: "#ffffff08", border: "1.5px solid #ffffff12", borderRadius: 16, padding: "16px 18px", cursor: "pointer", position: "relative", overflow: "hidden", transition: "all 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = team.color + "66"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#ffffff12"}>
      {hasAlert && <div style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 8px #ef4444", animation: "pulse 2s infinite" }} />}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <TeamAvatar team={team} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#f0f0f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.name}</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{allenatoreReale || "—"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
        {[
          { label: "BILANCIO",  value: `${team.bilancio.toFixed(1)}M`, color: bilColor },
          { label: "SC USATO",  value: `${scLive.toFixed(1)}M`,        color: scColor },
          { label: "SC LIBERO", value: scLiberoStr,                     color: scLiberoColor },
        ].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: 9, color: "#777", marginBottom: 2, letterSpacing: "0.06em" }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: s.color, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "0.5px" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ height: 3, background: "#ffffff20", borderRadius: 99, marginBottom: 10 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 14 }}>
        {[
          { label: "ROSA", value: String(giocatori), color: rosaColor },
          { label: "U-21", value: String(u21),       color: u21Color },
          { label: "FPF",  value: fpfDisplay,        color: fpfColor },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#777", marginBottom: 2, letterSpacing: "0.06em" }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: s.color, fontFamily: "'Bebas Neue',sans-serif" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: team.color + "18", border: `1px solid ${team.color}44`, borderRadius: 10, padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#ccc", fontWeight: 600 }}>Vedi pagina presidente</span>
        <span style={{ color: team.color, fontSize: 16 }}>→</span>
      </div>
    </div>
  );
}

/* ─── CLASSIFICA TABLE ───────────────────────────────────────────────────────── */
function ClassificaTable({ classificaRicca, mySquadra, editMode, editRow, setEditRow, salvaRiga, saving, inp }) {
  const { sorted, SortTh } = useSortableTable(classificaRicca, "pt", "desc");
  // Calcola posizione basata sull'ordine originale (pt desc, pt_totali desc)
  const posMap = {};
  [...classificaRicca].sort((a,b) => b.pt - a.pt || b.pt_totali - a.pt_totali).forEach((r, i) => { posMap[r.squadra] = i + 1; });

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ffffff15" }}>
            <th style={{ padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "#555" }}>#</th>
            <SortTh col="squadra"   label="Squadra"   align="left"   style={{ minWidth: 100 }} />
            <SortTh col="g"         label="G"         align="center" />
            <SortTh col="v"         label="V"         align="center" />
            <SortTh col="n"         label="N"         align="center" />
            <SortTh col="p"         label="P"         align="center" />
            <SortTh col="gf"        label="G+"        align="center" />
            <SortTh col="gs"        label="G−"        align="center" />
            <SortTh col="dr"        label="DR"        align="center" />
            <SortTh col="pt"        label="Pt"        align="center" />
            <SortTh col="pt_totali" label="Pt Tot"    align="center" />
            {editMode && <th style={{ width: 60 }}></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const pos = posMap[row.squadra];
            const rowColor = pos === 1 ? "#f59e0b" : pos === 2 ? "#9ca3af" : pos === 3 ? "#cd7f32" : null;
            const isMe = row.squadra === mySquadra;
            const isEditing = editRow?.squadra === row.squadra;
            return (
              <tr key={row.squadra}
                style={{ borderBottom: "1px solid #ffffff08", background: isMe ? "#6366f110" : "transparent", transition: "background 0.1s" }}
                onMouseEnter={e => { if (!isMe) e.currentTarget.style.background = "#ffffff05"; }}
                onMouseLeave={e => { if (!isMe) e.currentTarget.style.background = isMe ? "#6366f110" : "transparent"; }}
              >
                <td style={{ padding: "9px 4px", textAlign: "center", fontWeight: 900, fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, color: rowColor || "#555" }}>{pos}</td>
                <td style={{ padding: "9px 6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {row.team && <TeamAvatar team={row.team} size={22} />}
                    <span style={{ fontSize: 11, fontWeight: isMe ? 800 : 600, color: isMe ? "#f0f0f0" : "#ccc", wordBreak: "break-word" }}>
                      {row.squadra}
                      {isMe && <span style={{ fontSize: 8, color: "#6366f1", marginLeft: 5, background: "#6366f120", border: "1px solid #6366f133", borderRadius: 3, padding: "1px 4px" }}>TU</span>}
                    </span>
                  </div>
                </td>
                {isEditing ? (
                  <>
                    {["g","v","n","p","gf","gs","pt","pt_totali"].map(f => (
                      <td key={f} style={{ padding: "4px" }}
                        >
                        <input style={inp} type="number" value={editRow[f]}
                          onChange={e => setEditRow(r => ({ ...r, [f]: e.target.value,
                            dr: f === 'gf' ? Number(e.target.value) - Number(r.gs)
                              : f === 'gs' ? Number(r.gf) - Number(e.target.value)
                              : r.dr }))} />
                      </td>
                    ))}
                    <td style={{ padding: "4px 8px", textAlign: "center", color: (Number(editRow.gf)-Number(editRow.gs)) >= 0 ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: 12 }}>
                      {Number(editRow.gf)-Number(editRow.gs) >= 0 ? "+" : ""}{Number(editRow.gf)-Number(editRow.gs)}
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "9px 8px", textAlign: "center", color: "#aaa", fontSize: 12 }}>{row.g}</td>
                    <td style={{ padding: "9px 8px", textAlign: "center", color: "#aaa", fontSize: 12 }}>{row.v}</td>
                    <td style={{ padding: "9px 8px", textAlign: "center", color: "#aaa", fontSize: 12 }}>{row.n}</td>
                    <td style={{ padding: "9px 8px", textAlign: "center", color: "#aaa", fontSize: 12 }}>{row.p}</td>
                    <td style={{ padding: "9px 8px", textAlign: "center", color: "#aaa", fontSize: 12 }}>{row.gf}</td>
                    <td style={{ padding: "9px 8px", textAlign: "center", color: "#aaa", fontSize: 12 }}>{row.gs}</td>
                    <td style={{ padding: "9px 8px", textAlign: "center", color: row.dr > 0 ? "#10b981" : row.dr < 0 ? "#ef4444" : "#888", fontSize: 12, fontWeight: 600 }}>
                      {row.dr > 0 ? "+" : ""}{row.dr}
                    </td>
                    <td style={{ padding: "9px 8px", textAlign: "center", fontSize: 14, fontWeight: 900, color: rowColor || "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif" }}>{row.pt}</td>
                    <td style={{ padding: "9px 8px", textAlign: "center", fontSize: 12, color: "#888", fontWeight: 600 }}>{row.pt_totali}</td>
                  </>
                )}
                {editMode && (
                  <td style={{ padding: "4px 8px", textAlign: "center" }}>
                    {isEditing
                      ? <button onClick={salvaRiga} disabled={saving} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#10b98122", color: "#10b981", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{saving ? "…" : "✓"}</button>
                      : <button onClick={() => setEditRow({ ...row })} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#6366f118", color: "#818cf8", fontSize: 11, cursor: "pointer" }}>✏️</button>
                    }
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── CALCOLATORE GIORNATA ──────────────────────────────────────────────────── */
function CalcolatoreGiornata({ profile, teams }) {
  const mySquadra = profile?.squadra;
  const myTeam = teams?.find(t => t.name === mySquadra);

  const [giornata, setGiornata] = useState("");
  const [golSegnati, setGolSegnati] = useState(0);
  const [golSubiti, setGolSubiti] = useState(0);
  const [risultato, setRisultato] = useState(""); // "V" | "P" | "S"
  const [rivale, setRivale] = useState(false);   // partita contro la squadra rivale
  const [formazione, setFormazione] = useState(true); // formazione schierata
  // stadioPagato rimosso — stadio ora automatico il 1° del mese
  const [salvatoMsg, setSalvatoMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  // Costi giocatori (cumulativi da inserire manualmente)
  const [costiGiocatori, setCostiGiocatori] = useState({
    assist: 0, gol: 0, portaInviolata: 0, rigoriParati: 0, mvp: 0,
    ammonizioni: 0, espulsioni: 0, golSubitiGioc: 0, autogol: 0, rigoriSbagliati: 0,
  });

  // ── Tabella guadagni gol segnati (art. 8.1) ──────────────────────────────
  const tabellaGolSegnati = [0,1,2,3,4,5,6,7];
  const guadagnoGolSegnati = Math.min(golSegnati, 7);

  // Guadagno gol subiti
  const tabellaGolSubiti = { 0: 0.5, 1: -0.25, 2: -0.5, 3: -0.75, 4: -1, 5: -1.25, 6: -1.5, 7: -1.75, 8: -2 };
  const guadagnoGolSubiti = tabellaGolSubiti[Math.min(golSubiti, 8)] ?? -2;

  // Guadagno risultato
  const guadagnoRisultato = risultato === "V" ? (rivale ? 1 : 0.5)
                           : risultato === "P" ? (rivale ? 0.5 : 0.25)
                           : 0;

  // Costo giocatori (segno: negativo = costo, positivo = rimborso/multa)
  const costoGiocatori = parseFloat((
    - costiGiocatori.assist * 0.1
    - costiGiocatori.gol * 0.3
    - costiGiocatori.portaInviolata * 0.2
    - costiGiocatori.rigoriParati * 0.5
    - costiGiocatori.mvp * 0.2
    + costiGiocatori.ammonizioni * 0.1
    + costiGiocatori.espulsioni * 0.3
    + costiGiocatori.golSubitiGioc * 0.1
    + costiGiocatori.autogol * 0.5
    + costiGiocatori.rigoriSbagliati * 0.5
  ).toFixed(2));

  // Stadio (4M se 1° del mese)
  // Totale grezzo (stadio rimosso — ora automatico il 1° del mese)
  let totale = parseFloat((
    guadagnoGolSegnati + guadagnoGolSubiti + guadagnoRisultato + costoGiocatori
  ).toFixed(2));

  // Se formazione non schierata: perdite doppie, guadagni 0
  if (!formazione) {
    const perdite = Math.min(totale, 0) * 2;
    const guadagni = 0;
    totale = parseFloat((perdite + guadagni).toFixed(2));
  }

  const color = totale >= 0 ? "#10b981" : "#ef4444";

  async function salvaGuadagno() {
    if (!mySquadra || !giornata) return;
    setSaving(true);
    try {
      const oggi = new Date().toISOString().slice(0, 10);
      const desc = `Guadagno giornata ${giornata}${rivale ? " (vs rivale)" : ""}${!formazione ? " [no formaz.]" : ""}`;
      await insertMovimento({
        squadra: mySquadra,
        descrizione: desc,
        entrata: totale > 0 ? totale : null,
        uscita: totale < 0 ? Math.abs(totale) : null,
        data: oggi,
      });
      setSalvatoMsg(`✅ Giornata ${giornata}: ${totale >= 0 ? "+" : ""}${totale}M salvato nei movimenti`);
      setTimeout(() => setSalvatoMsg(null), 4000);
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  const inpNum = { padding: "5px 8px", borderRadius: 6, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12, width: "100%" };

  const VoceCalcolo = ({ label, valore, highlight = false }) => {
    if (valore === 0) return null;
    const c = valore > 0 ? "#10b981" : "#ef4444";
    return (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ffffff06" }}>
        <span style={{ fontSize: 11, color: highlight ? "#f0f0f0" : "#888" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: highlight ? 800 : 600, color: c }}>{valore > 0 ? "+" : ""}{valore}M</span>
      </div>
    );
  };

  return (
    <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 18, overflow: "hidden" }}>
      {/* Header cliccabile */}
      <div onClick={() => setOpen(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", cursor: "pointer" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em" }}>⚽ CALCOLATORE GUADAGNO GIORNATA</div>
          {myTeam && <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{myTeam.name}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {totale !== 0 && open && (
            <span style={{ fontSize: 16, fontWeight: 900, color, fontFamily: "'Bebas Neue',sans-serif" }}>
              {totale >= 0 ? "+" : ""}{totale}M
            </span>
          )}
          <span style={{ color: "#555", fontSize: 16 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "0 18px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>

            {/* Giornata */}
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>GIORNATA N°</div>
              <input style={inpNum} type="number" placeholder="es. 29" value={giornata} onChange={e => setGiornata(e.target.value)} />
            </div>

            {/* Risultato */}
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>RISULTATO</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[["V","Vittoria"],["P","Pareggio"],["S","Sconfitta"]].map(([v,l]) => (
                  <button key={v} onClick={() => setRisultato(risultato === v ? "" : v)}
                    style={{ flex: 1, padding: "5px 2px", borderRadius: 6, border: `1px solid ${risultato===v ? "#6366f1" : "#ffffff15"}`, background: risultato===v ? "#6366f122" : "transparent", color: risultato===v ? "#818cf8" : "#666", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Gol segnati */}
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>GOL SEGNATI (+{guadagnoGolSegnati}M)</div>
              <input style={inpNum} type="number" min="0" max="99" value={golSegnati} onChange={e => setGolSegnati(Number(e.target.value))} />
            </div>

            {/* Gol subiti */}
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>GOL SUBITI ({guadagnoGolSubiti >= 0 ? "+" : ""}{guadagnoGolSubiti}M)</div>
              <input style={inpNum} type="number" min="0" max="99" value={golSubiti} onChange={e => setGolSubiti(Number(e.target.value))} />
            </div>
          </div>

          {/* Costi giocatori */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 8 }}>STATISTICHE GIOCATORI (titolari + subentranti)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                ["assist",        "Assist",            "−0.1M cad."],
                ["gol",           "Gol (gioc.)",       "−0.3M cad."],
                ["portaInviolata","Porta Inviolata",   "−0.2M cad."],
                ["rigoriParati",  "Rigori Parati",     "−0.5M cad."],
                ["mvp",           "MVP",               "−0.2M cad."],
                ["ammonizioni",   "Ammonizioni",       "+0.1M cad."],
                ["espulsioni",    "Espulsioni",        "+0.3M cad."],
                ["golSubitiGioc", "Gol Subiti (gioc.)","  +0.1M cad."],
                ["autogol",       "Autogol",           "+0.5M cad."],
                ["rigoriSbagliati","Rigori Sbagliati", "+0.5M cad."],
              ].map(([key, label, hint]) => (
                <div key={key}>
                  <div style={{ fontSize: 9, color: "#555", marginBottom: 2 }}>{label} <span style={{ color: "#444" }}>{hint}</span></div>
                  <input style={inpNum} type="number" min="0" value={costiGiocatori[key]}
                    onChange={e => setCostiGiocatori(f => ({ ...f, [key]: Number(e.target.value) }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Toggle opzioni */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {[
              [rivale, setRivale, "⚔️ Partita contro rivale", "Vittoria +1M / Pareggio +0.5M"],
              [!formazione, v => setFormazione(!v), "⚠️ Formazione non schierata", "Perdite ×2 / Guadagni 0"],
            ].map(([val, setter, lbl, hint], i) => (
              <button key={i} onClick={() => setter(!val)}
                style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${val ? "#f59e0b" : "#ffffff15"}`, background: val ? "#f59e0b18" : "transparent", color: val ? "#f59e0b" : "#555", fontSize: 11, cursor: "pointer", textAlign: "left" }}>
                <div style={{ fontWeight: 700 }}>{lbl}</div>
                <div style={{ fontSize: 9, opacity: 0.7 }}>{hint}</div>
              </button>
            ))}
          </div>

          {/* Riepilogo calcolo */}
          <div style={{ background: "#ffffff08", borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 8 }}>RIEPILOGO</div>
            <VoceCalcolo label={`Gol segnati (${golSegnati})`} valore={guadagnoGolSegnati} />
            <VoceCalcolo label={`Gol subiti (${golSubiti})`} valore={guadagnoGolSubiti} />
            <VoceCalcolo label={`Risultato${rivale ? " (vs rivale)" : ""}`} valore={guadagnoRisultato} />
            <VoceCalcolo label="Costi/bonus giocatori" valore={costoGiocatori} />
            {!formazione && <div style={{ fontSize: 11, color: "#f59e0b", padding: "4px 0" }}>⚠️ Senza formazione: perdite ×2, guadagni 0</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px solid #ffffff12" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#ccc" }}>TOTALE GIORNATA {giornata || "—"}</span>
              <span style={{ fontSize: 22, fontWeight: 900, color, fontFamily: "'Bebas Neue',sans-serif" }}>
                {totale >= 0 ? "+" : ""}{totale}M
              </span>
            </div>
          </div>

          {salvatoMsg && (
            <div style={{ background: "#10b98115", border: "1px solid #10b98133", borderRadius: 9, padding: "9px 14px", fontSize: 12, color: "#10b981", marginBottom: 10 }}>
              {salvatoMsg}
            </div>
          )}

          {mySquadra ? (
            <button onClick={salvaGuadagno} disabled={saving || !giornata}
              style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: !giornata ? "#333" : "linear-gradient(135deg,#6366f1,#a855f7)", color: !giornata ? "#555" : "#fff", fontSize: 13, fontWeight: 700, cursor: giornata ? "pointer" : "not-allowed" }}>
              {saving ? "Salvataggio..." : `💾 Salva giornata ${giornata || "?"} nei movimenti`}
            </button>
          ) : (
            <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", textAlign: "center" }}>Effettua il login per salvare</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── SQUADRE PAGE ──────────────────────────────────────────────────────────── */
function SquadrePage({ onSelectTeam, teams = TEAMS, profile, isAdmin }) {
  const mySquadra = profile?.squadra;
  const myTeam = teams.find(t => t.name === mySquadra);

  const [classifica, setClassifica] = useState([]);
  const [myRosa, setMyRosa] = useState([]);
  const [myAllenatore, setMyAllenatore] = useState(null);
  const [roseCountMap, setRoseCountMap] = useState({});
  const [scLiveMap, setScLiveMap] = useState({});
  const [allenatoriMap, setAllenatoriMap] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [editRow, setEditRow] = useState(null); // { squadra, g, v, n, p, gf, gs, dr, pt, pt_totali }
  const [saving, setSaving] = useState(false);

  const [cols, setCols] = useState(() => {
    const w = window.innerWidth;
    if (w >= 1400) return 4;
    if (w >= 1000) return 3;
    if (w >= 600)  return 2;
    return 1;
  });

  useEffect(() => {
    const handler = () => {
      const w = window.innerWidth;
      if (w >= 1400) setCols(4);
      else if (w >= 1000) setCols(3);
      else if (w >= 600)  setCols(2);
      else setCols(1);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    getClassifica().then(d => setClassifica(d));
    const sub = subscribeClassifica(() => getClassifica().then(d => setClassifica(d)));
    return () => supabase.removeChannel(sub);
  }, []);

  useEffect(() => {
    if (!mySquadra) return;
    cachedFetch('rosa_' + mySquadra, () => getRosa(mySquadra), 120000).then(d => setMyRosa(d || []));
  }, [mySquadra]);
  // Allenatore: aggiornato quando allenatoriMap è popolato
  useEffect(() => {
    if (mySquadra && allenatoriMap[mySquadra] !== undefined) setMyAllenatore(allenatoriMap[mySquadra] || null);
  }, [mySquadra, allenatoriMap]);

  // Batch load: rosa counts + scLive per team + allenatori
  const teamNamesKey = teams.map(t => t.name).join(',');
  useEffect(() => {
    if (!teams.length) return;
    // One fetch per team (rose) — popola cache; single batch per allenatori
    Promise.all([
      Promise.all(teams.map(t => cachedFetch('rosa_' + t.name, () => getRosa(t.name), 120000).then(d => {
        const rosa = (d || []).filter(p => !p.in_vivaio);
        return [t.name, { count: rosa.length, sc: rosa.reduce((s, p) => s + calcolaStipCorretto(p.quot, p.anni_contratto, p.anni), 0) }];
      }))),
      getAllenatori(STAGIONE_CORRENTE),
    ]).then(([rosaEntries, allCoaches]) => {
      const counts = {}, scs = {};
      rosaEntries.forEach(([name, { count, sc }]) => { counts[name] = count; scs[name] = sc; });
      setRoseCountMap(counts);
      setScLiveMap(scs);
      const allMap = {};
      (allCoaches || []).forEach(a => { allMap[a.squadra] = a.nome; });
      setAllenatoriMap(allMap);
    });
  }, [teamNamesKey]);

  // Merge classifica con colori/loghi delle squadre
  const classificaRicca = classifica.map(c => {
    const team = teams.find(t => t.name === c.squadra);
    return { ...c, team };
  }).sort((a, b) => b.pt - a.pt || b.pt_totali - a.pt_totali);

  async function salvaRiga() {
    if (!editRow) return;
    setSaving(true);
    try {
      const aggiornamenti = {
        g: Number(editRow.g), v: Number(editRow.v), n: Number(editRow.n),
        p: Number(editRow.p), gf: Number(editRow.gf), gs: Number(editRow.gs),
        dr: Number(editRow.gf) - Number(editRow.gs),
        pt: Number(editRow.pt), pt_totali: Number(editRow.pt_totali),
      };
      // Salva snapshot prima del cambio
      const rigaPrima = classifica.find(c => c.squadra === editRow.squadra);
      await updateClassificaSquadra(editRow.squadra, aggiornamenti);
      await logAzione({ utente: 'admin', squadra: editRow.squadra, azione: 'classifica_modifica', entita: 'classifica', descrizione: `Classifica aggiornata: ${editRow.squadra} → Pt:${editRow.pt} PtTot:${editRow.pt_totali}`, dataPrima: { riga: rigaPrima }, dataDopo: { riga: { ...rigaPrima, ...aggiornamenti } }, rollbackPossibile: true });
      setEditRow(null);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  }

  // Mini-rosa summary: conta per ruolo (vivaio escluso — art. 3.4)
  const rosaAttiva = myRosa.filter(p => !p.in_vivaio);
  const ruoliCount = { Por: 0, Dif: 0, Cen: 0, Tre: 0, Att: 0 };
  rosaAttiva.forEach(p => {
    const r = p.ruolo || '';
    const roles = r.split(';').map(x => x.trim());
    const first = roles[0];
    if (first === 'Por') ruoliCount.Por++;
    else if (['Dc','Dd','Ds','B'].includes(first)) ruoliCount.Dif++;
    else if (['E','M','C'].includes(first)) ruoliCount.Cen++;
    else if (['T','W'].includes(first)) ruoliCount.Tre++;
    else ruoliCount.Att++;
  });
  const scUsato = myRosa.filter(p=>!p.in_vivaio).reduce((s, p) => s + calcolaStipCorretto(p.quot, p.anni_contratto, p.anni), 0);
  // FPF = netto speso semestre corrente, calcolato centralmente e passato via myTeam.fpf
  const fpf = myTeam?.fpf ?? null;
  const fpfDisplay = fpf !== null ? `${fpf.toFixed(1)}M` : "—";
  const fpfColor = fpf === null ? "#555" : fpf > 60 ? "#ef4444" : fpf > 55 ? "#f97316" : fpf > 50 ? "#f59e0b" : "#10b981";

  const inp = { padding: "4px 6px", borderRadius: 5, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, width: "100%" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── 1. LA TUA ROSA ── */}
      {myTeam && (
        <div
          onClick={() => onSelectTeam(myTeam)}
          style={{ background: `linear-gradient(135deg, ${myTeam.color}18, #ffffff06)`, border: `1.5px solid ${myTeam.color}44`, borderRadius: 18, padding: "18px 22px", cursor: "pointer", transition: "border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = myTeam.color + "88"}
          onMouseLeave={e => e.currentTarget.style.borderColor = myTeam.color + "44"}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: myTeam.color, letterSpacing: "0.12em", marginBottom: 12 }}>⚽ LA TUA ROSA</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <TeamAvatar team={myTeam} size={52} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>{myTeam.name}</div>
              <div style={{ fontSize: 12, color: "#888" }}>{myAllenatore || "—"}</div>
            </div>
            {/* Bilancio + SC + FPF */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {[
                { label: "BILANCIO", value: `${myTeam.bilancio?.toFixed(1)}M`, color: myTeam.bilancio < 10 ? "#f97316" : "#10b981" },
                { label: "SALARY CAP", value: `${scUsato.toFixed(1)} / 75M`, color: scUsato > 75 ? "#ef4444" : scUsato > 65 ? "#f59e0b" : "#10b981" },
                { label: "FPF", value: fpfDisplay, color: fpfColor },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 8, color: "#555", letterSpacing: "0.06em", marginBottom: 1 }}>{s.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats bar — ruoli + U21 + 31+ */}
          <div className="grid-stats-8" style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
            {[
              { label: "ROSA",      value: rosaAttiva.length, color: rosaAttiva.length < 25 || rosaAttiva.length > 30 ? "#ef4444" : "#10b981" },
              { label: "POR",       value: ruoliCount.Por, color: "#f59e0b" },
              { label: "DIFESA",    value: ruoliCount.Dif, color: "#10b981" },
              { label: "CENTRO",    value: ruoliCount.Cen, color: "#3b82f6" },
              { label: "TREQUARTI", value: ruoliCount.Tre, color: "#a78bfa" },
              { label: "ATTACCO",   value: ruoliCount.Att, color: "#ef4444" },
              { label: "U-21",      value: rosaAttiva.filter(p => p.anni > 0 && p.anni <= 21).length, color: "#c4b5fd" },
              { label: "31+",       value: rosaAttiva.filter(p => p.anni >= 31).length, color: "#fb923c" },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center", background: "#ffffff08", borderRadius: 10, padding: "7px 3px" }}>
                <div style={{ fontSize: 7, color: "#555", letterSpacing: "0.04em", marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif" }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "#666" }}>
              {myTeam.mercatoBloccato && <span style={{ color: "#ef4444" }}>🔒 mercato bloccato</span>}
            </div>
            <span style={{ fontSize: 12, color: myTeam.color, fontWeight: 600 }}>Vai alla pagina →</span>
          </div>
        </div>
      )}

      {/* ── 2. CALCOLATORE GIORNATA ── */}
      <CalcolatoreGiornata profile={profile} teams={teams} />

      {/* ── 3. TUTTE LE SQUADRE (esclusa la propria, già in cima) ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 14 }}>🏟️ TUTTE LE SQUADRE</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
          {teams
            .filter(t => t.name !== mySquadra)
            .map(team => {
              const liveCount = roseCountMap[team.name];
              const teamLive = liveCount !== undefined ? { ...team, giocatori: liveCount } : team;
              return <TeamCard key={team.id} team={teamLive} onClick={() => onSelectTeam(team)} scLive={scLiveMap[team.name]} allenatore={allenatoriMap[team.name] ?? null} />;
            })}
        </div>
      </div>

    </div>
  );
}

/* ─── TORNEI SECTION ─────────────────────────────────────────────────────────── */

// Dati iniziali hard-coded per la stagione 2026/27
const _COPPA_SQUADRE_A = ["Borjcellona","Finocchiona","AK Toio","Balillareal"];
const _COPPA_SQUADRE_B = ["Agnus Dei FC","Alcool Campi","Wehrmacht FC","Shalpe 104"];
function _emptyGirone(squadre) {
  return squadre.map(sq => ({ sq, g:0, v:0, n:0, p:0, gf:0, gs:0, dr:0, pt:0 }));
}

const COPPA_INIT = {
  gironi: {
    A: { classifica: _emptyGirone(_COPPA_SQUADRE_A) },
    B: { classifica: _emptyGirone(_COPPA_SQUADRE_B) },
  },
  semifinali: [
    {id:"SF1",label:"1°A vs 2°B",g_andata:26,g_ritorno:28,squadra_a:null,squadra_b:null,gol_aa:null,gol_ba:null,gol_ar:null,gol_br:null},
    {id:"SF2",label:"1°B vs 2°A",g_andata:26,g_ritorno:28,squadra_a:null,squadra_b:null,gol_aa:null,gol_ba:null,gol_ar:null,gol_br:null},
  ],
  finale: {g:32,squadra_a:null,squadra_b:null,gol_a:null,gol_b:null},
};

const SUPERCOPPA_INIT = {
  semifinali: [
    {id:"SC_SF1",label:"SF1",g:6,squadra_a:"Shalpe 104",squadra_b:"Agnus Dei FC",gol_a:null,gol_b:null},
    {id:"SC_SF2",label:"SF2",g:6,squadra_a:"AK Toio",squadra_b:"Borjcellona",gol_a:null,gol_b:null},
  ],
  finale: {g:8,squadra_a:null,squadra_b:null,gol_a:null,gol_b:null},
};

function vincitore(sf) {
  if (sf.gol_a === null || sf.gol_b === null) return null;
  const a = Number(sf.gol_a), b = Number(sf.gol_b);
  if (a > b) return sf.squadra_a;
  if (b > a) return sf.squadra_b;
  return null;
}

function vincitoreSFCoppa(sf) {
  if (sf.gol_aa === null || sf.gol_ba === null || sf.gol_ar === null || sf.gol_br === null) return null;
  const totA = Number(sf.gol_aa) + Number(sf.gol_ar);
  const totB = Number(sf.gol_ba) + Number(sf.gol_br);
  if (totA > totB) return sf.squadra_a;
  if (totB > totA) return sf.squadra_b;
  return null;
}

function ScoreInput({ val, onChange }) {
  return (
    <input type="number" min="0" value={val??''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      style={{ width:32, padding:'3px 4px', borderRadius:5, border:'1px solid #ffffff20', background:'#ffffff10', color:'#f0f0f0', fontSize:12, fontWeight:700, textAlign:'center', outline:'none' }} />
  );
}

function GironeTable({ classifica, isAdmin, onEdit }) {
  const sorted = [...classifica].sort((a,b) => b.pt-a.pt || b.dr-a.dr || b.gf-a.gf);
  const numInp = { width:28, padding:'3px 2px', borderRadius:5, border:'1px solid #ffffff18', background:'#ffffff08', color:'#f0f0f0', fontSize:11, fontWeight:600, textAlign:'center', outline:'none' };
  return (
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
      <thead>
        <tr>{['#','Squadra','V','N','P','G+','G−','DR','Pt'].map((c,i) => (
          <th key={i} style={{ padding:'4px 5px', color:'#555', fontWeight:700, fontSize:9, textAlign: i<=1?'left':'center', letterSpacing:'0.05em' }}>{c}</th>
        ))}</tr>
      </thead>
      <tbody>
        {sorted.map((r,i) => {
          const color = i===0?'#10b981':i===1?'#f59e0b':'#666';
          return (
            <tr key={r.sq} style={{ borderBottom:'1px solid #ffffff06' }}>
              <td style={{ padding:'5px', textAlign:'center', fontSize:10, fontWeight:900, color }}>{i+1}</td>
              <td style={{ padding:'5px', fontWeight:700, color:'#ddd', wordBreak:'break-word', maxWidth:130 }}>{r.sq}</td>
              {isAdmin ? (
                <>
                  {['v','n','p','gf','gs'].map(f => (
                    <td key={f} style={{ padding:'2px 3px', textAlign:'center' }}>
                      <input type="number" min="0" value={r[f]??''} style={numInp}
                        onChange={e => onEdit(r.sq, f, e.target.value === '' ? 0 : Number(e.target.value))} />
                    </td>
                  ))}
                  <td style={{ padding:'5px', textAlign:'center', color: r.dr>0?'#10b981':r.dr<0?'#ef4444':'#555', fontWeight:600, fontSize:11 }}>{r.dr>0?'+':''}{r.dr}</td>
                  <td style={{ padding:'5px', textAlign:'center', fontWeight:900, color, fontFamily:"'Bebas Neue',sans-serif", fontSize:14 }}>{r.pt}</td>
                </>
              ) : (
                <>
                  {[r.v,r.n,r.p,r.gf,r.gs].map((v,k) => <td key={k} style={{ padding:'5px', textAlign:'center', color:'#888' }}>{v}</td>)}
                  <td style={{ padding:'5px', textAlign:'center', color: r.dr>0?'#10b981':r.dr<0?'#ef4444':'#555', fontWeight:600 }}>{r.dr>0?'+':''}{r.dr}</td>
                  <td style={{ padding:'5px', textAlign:'center', fontWeight:900, color, fontFamily:"'Bebas Neue',sans-serif", fontSize:14 }}>{r.pt}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BracketMatch({ label, gLabel, squadra_a, squadra_b, gol_a, gol_b, isAdmin, onChange }) {
  const vic = vincitore({ squadra_a, squadra_b, gol_a, gol_b });
  const giocata = gol_a !== null && gol_b !== null;
  const tbd = !squadra_a || !squadra_b;
  return (
    <div style={{ background:'#ffffff06', border:'1px solid #ffffff12', borderRadius:10, padding:'10px 12px' }}>
      {label && <div style={{ fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.1em', marginBottom:6 }}>{label}{gLabel && <span style={{ color:'#333', marginLeft:6 }}>· {gLabel}</span>}</div>}
      {[{sq:squadra_a,gol:gol_a,field:'gol_a'},{sq:squadra_b,gol:gol_b,field:'gol_b'}].map(({sq,gol,field},i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom: i===0?'1px solid #ffffff08':'none' }}>
          <span style={{ flex:1, fontSize:11, fontWeight: vic===sq?800:600, color: tbd?'#444': vic===sq?'#10b981':'#ccc', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontStyle: tbd?'italic':'normal' }}>
            {sq||'?'}</span>
          {isAdmin && !tbd
            ? <ScoreInput val={gol} onChange={v => onChange(field, v)} />
            : <span style={{ fontSize:12, fontWeight:800, color: vic===sq?'#10b981':'#666', minWidth:20, textAlign:'center' }}>{giocata ? gol : '–'}</span>
          }
        </div>
      ))}
    </div>
  );
}

function BracketSFCoppa({ sf, isAdmin, onChange }) {
  const totA = Number(sf.gol_aa??0) + Number(sf.gol_ar??0);
  const totB = Number(sf.gol_ba??0) + Number(sf.gol_br??0);
  const vin = vincitoreSFCoppa(sf);
  const tbd = !sf.squadra_a || !sf.squadra_b;
  const hasAndata = sf.gol_aa !== null && sf.gol_ba !== null;
  const hasRitorno = sf.gol_ar !== null && sf.gol_br !== null;
  return (
    <div style={{ background:'#ffffff06', border:'1px solid #ffffff12', borderRadius:10, padding:'10px 12px' }}>
      <div style={{ fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.1em', marginBottom:8 }}>
        {sf.label} · <span style={{ color:'#333' }}>G{sf.g_andata} (and.) · G{sf.g_ritorno} (rit.)</span>
      </div>
      {[{sq:sf.squadra_a,fA:'gol_aa',fR:'gol_ar',tot:totA},{sq:sf.squadra_b,fA:'gol_ba',fR:'gol_br',tot:totB}].map(({sq,fA,fR,tot},i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 0', borderBottom: i===0?'1px solid #ffffff08':'none' }}>
          <span style={{ flex:1, fontSize:11, fontWeight: vin===sq?800:600, color: tbd?'#444': vin===sq?'#10b981':'#ccc', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sq||'?'}</span>
          {isAdmin && !tbd ? (
            <div style={{ display:'flex', gap:3, alignItems:'center' }}>
              <ScoreInput val={sf[fA]} onChange={v => onChange(fA, v)} />
              <span style={{ fontSize:9, color:'#333' }}>+</span>
              <ScoreInput val={sf[fR]} onChange={v => onChange(fR, v)} />
              {(hasAndata||hasRitorno) && <span style={{ fontSize:10, color: vin===sq?'#10b981':'#555', fontWeight:800, minWidth:24 }}>={tot}</span>}
            </div>
          ) : (
            <span style={{ fontSize:11, fontWeight:700, color: vin===sq?'#10b981':'#777' }}>
              {hasAndata ? `${sf[fA]}+${sf[fR]||'?'}=${tot}` : '–'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function TorneiSection({ isAdmin, forcedTab }) {
  const [coppa, setCoppa] = useState(null);
  const [superc, setSuperc] = useState(null);
  const [tab, setTab] = useState(forcedTab || 'coppa');
  const [saving, setSaving] = useState(false);

  // Sync tab when parent switches via forcedTab prop
  useEffect(() => { if (forcedTab) setTab(forcedTab); }, [forcedTab]);

  useEffect(() => {
    getTorneo('coppa_italia_2627').then(d => {
      const init = JSON.parse(JSON.stringify(COPPA_INIT));
      // compatibilità con versioni precedenti che avevano partite invece di classifica
      if (d && d.gironi) {
        ['A','B'].forEach(g => {
          if (d.gironi[g] && !d.gironi[g].classifica) d.gironi[g].classifica = init.gironi[g].classifica;
        });
      }
      setCoppa(d || init);
    });
    getTorneo('supercoppa_2627').then(d => setSuperc(d || JSON.parse(JSON.stringify(SUPERCOPPA_INIT))));
  }, []);

  async function saveCoppa(next) { setCoppa(next); setSaving(true); try { await setTorneo('coppa_italia_2627', next); } catch(e) { alert(`Errore salvataggio Coppa: ${e.message}`); } finally { setSaving(false); } }
  async function saveSuperc(next) { setSuperc(next); setSaving(true); try { await setTorneo('supercoppa_2627', next); } catch(e) { alert(`Errore salvataggio Supercoppa: ${e.message}`); } finally { setSaving(false); } }

  function editGirone(gruppo, sq, field, val) {
    const next = JSON.parse(JSON.stringify(coppa));
    const row = next.gironi[gruppo].classifica.find(r => r.sq === sq);
    if (!row) return;
    row[field] = val;
    row.g = row.v + row.n + row.p;
    row.pt = row.v * 3 + row.n;
    row.dr = row.gf - row.gs;
    // Propaga qualificate alle semifinali
    const sortG = g => [...next.gironi[g].classifica].sort((a,b) => b.pt-a.pt||b.dr-a.dr||b.gf-a.gf);
    const sA = sortG('A'), sB = sortG('B');
    next.semifinali[0].squadra_a = sA[0]?.sq||null;
    next.semifinali[0].squadra_b = sB[1]?.sq||null;
    next.semifinali[1].squadra_a = sB[0]?.sq||null;
    next.semifinali[1].squadra_b = sA[1]?.sq||null;
    saveCoppa(next);
  }

  function updateSF(sfId, field, val) {
    const next = JSON.parse(JSON.stringify(coppa));
    const sf = next.semifinali.find(s => s.id === sfId);
    if (sf) sf[field] = val;
    next.finale.squadra_a = vincitoreSFCoppa(next.semifinali[0]);
    next.finale.squadra_b = vincitoreSFCoppa(next.semifinali[1]);
    saveCoppa(next);
  }

  function updateFinale(field, val) {
    const next = JSON.parse(JSON.stringify(coppa));
    next.finale[field] = val;
    saveCoppa(next);
  }

  function updateSCSF(sfId, field, val) {
    const next = JSON.parse(JSON.stringify(superc));
    const sf = next.semifinali.find(s => s.id === sfId);
    if (sf) sf[field] = val;
    next.finale.squadra_a = vincitore(next.semifinali[0]);
    next.finale.squadra_b = vincitore(next.semifinali[1]);
    saveSuperc(next);
  }

  if (!coppa || !superc) return <div style={{ padding:20, color:'#555', fontSize:12 }}>⏳ Caricamento tornei…</div>;

  const card = { background:'#ffffff06', border:'1.5px solid #ffffff12', borderRadius:18, padding:18 };
  const vincCoppa = vincitore(coppa.finale);
  const vincSC = vincitore(superc.finale);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:22 }}>
      {!forcedTab && (
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {[['coppa','🏆 Coppa Italia'],['supercoppa','⭐ Supercoppa']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding:'7px 16px', borderRadius:9, border:'none', background: tab===k?'#6366f125':'transparent', color: tab===k?'#818cf8':'#555', fontWeight:700, fontSize:12, cursor:'pointer', borderBottom: tab===k?'2px solid #6366f1':'2px solid transparent' }}>
              {l}
            </button>
          ))}
          {saving && <span style={{ fontSize:10, color:'#555' }}>⏳</span>}
        </div>
      )}
      {saving && forcedTab && <span style={{ fontSize:10, color:'#555' }}>⏳</span>}

      {tab === 'coppa' && (
        <>
          {/* Gironi */}
          <div style={card}>
            <div style={{ fontSize:11, fontWeight:700, color:'#888', letterSpacing:'0.1em', marginBottom:16 }}>🏟 FASE A GIRONI · G10–G22</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:20 }}>
              {['A','B'].map(g => (
                <div key={g}>
                  <div style={{ fontSize:12, fontWeight:800, color:'#818cf8', marginBottom:8 }}>Girone {g}</div>
                  <GironeTable classifica={coppa.gironi[g].classifica} isAdmin={isAdmin}
                    onEdit={(sq, field, val) => editGirone(g, sq, field, val)} />
                  {isAdmin && <div style={{ fontSize:9, color:'#444', marginTop:6 }}>V/N/P e G+/G− editabili · Pt e DR calcolati automaticamente</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Tabellone */}
          <div style={card}>
            <div style={{ fontSize:11, fontWeight:700, color:'#888', letterSpacing:'0.1em', marginBottom:16 }}>⚔️ TABELLONE ELIMINAZIONE DIRETTA</div>
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.08em' }}>SEMIFINALI</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:12 }}>
                {coppa.semifinali.map(sf => (
                  <BracketSFCoppa key={sf.id} sf={sf} isAdmin={isAdmin}
                    onChange={(field, val) => updateSF(sf.id, field, val)} />
                ))}
              </div>
              <div style={{ textAlign:'center', fontSize:16, color:'#333' }}>↓</div>
              <div style={{ fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.08em' }}>FINALE · G{coppa.finale.g}</div>
              <div style={{ maxWidth:340 }}>
                <BracketMatch
                  squadra_a={coppa.finale.squadra_a} squadra_b={coppa.finale.squadra_b}
                  gol_a={coppa.finale.gol_a} gol_b={coppa.finale.gol_b}
                  isAdmin={isAdmin} onChange={(f,v) => updateFinale(f,v)} />
              </div>
              {vincCoppa && (
                <div style={{ display:'inline-flex', alignItems:'center', gap:10, background:'#f59e0b12', border:'1px solid #f59e0b30', borderRadius:12, padding:'10px 16px', alignSelf:'flex-start' }}>
                  <span style={{ fontSize:22 }}>🏆</span>
                  <div>
                    <div style={{ fontSize:9, color:'#f59e0b', fontWeight:700, letterSpacing:'0.1em' }}>VINCITORE COPPA ITALIA 2026/27</div>
                    <div style={{ fontSize:16, fontWeight:900, color:'#f0f0f0', fontFamily:"'Bebas Neue',sans-serif" }}>{vincCoppa}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'supercoppa' && (
        <div style={card}>
          <div style={{ fontSize:11, fontWeight:700, color:'#888', letterSpacing:'0.1em', marginBottom:6 }}>⭐ SUPERCOPPA 2026/27</div>
          <div style={{ fontSize:10, color:'#555', marginBottom:16, lineHeight:1.7 }}>
            Borjcellona ha vinto sia campionato che coppa 2025/26 → Shalpe 104 (finalista coppa) e AK Toio (3° campionato) ripescati.<br/>
            <b style={{ color:'#666' }}>SF1</b> Shalpe 104 vs Agnus Dei FC · <b style={{ color:'#666' }}>SF2</b> AK Toio vs Borjcellona
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:12 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.08em' }}>SEMIFINALI · G6</div>
                {superc.semifinali.map(sf => (
                  <BracketMatch key={sf.id} label={sf.label} gLabel={`G${sf.g}`}
                    squadra_a={sf.squadra_a} squadra_b={sf.squadra_b}
                    gol_a={sf.gol_a} gol_b={sf.gol_b}
                    isAdmin={isAdmin} onChange={(f,v) => updateSCSF(sf.id, f, v)} />
                ))}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.08em' }}>FINALE · G8</div>
                <BracketMatch
                  squadra_a={superc.finale.squadra_a} squadra_b={superc.finale.squadra_b}
                  gol_a={superc.finale.gol_a} gol_b={superc.finale.gol_b}
                  isAdmin={isAdmin} onChange={(f,v) => { const n=JSON.parse(JSON.stringify(superc)); n.finale[f]=v; saveSuperc(n); }} />
                {vincSC && (
                  <div style={{ background:'#f59e0b12', border:'1px solid #f59e0b30', borderRadius:10, padding:'10px 14px' }}>
                    <div style={{ fontSize:9, color:'#f59e0b', fontWeight:700 }}>⭐ VINCITORE SUPERCOPPA</div>
                    <div style={{ fontSize:16, fontWeight:900, color:'#f0f0f0', fontFamily:"'Bebas Neue',sans-serif" }}>{vincSC}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ─── LEGA PAGE ─────────────────────────────────────────────────────────────── */
function LegaPage({ teams = TEAMS, isAdmin }) {
  // ── Classifica ──────────────────────────────────────────────────────────────
  const [classifica, setClassifica] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDraft, setEditDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [compTab, setCompTab] = useState('serie_a');
  useEffect(() => {
    cachedFetch('classifica', () => getClassifica(), 60000).then(d => setClassifica(d || []));
    const sub = subscribeClassifica(() => {
      cacheInvalidate('classifica');
      getClassifica().then(d => setClassifica(d || []));
    });
    return () => supabase.removeChannel(sub);
  }, []);
  const classificaRicca = [...classifica].sort((a, b) => b.pt - a.pt || b.pt_totali - a.pt_totali).map(c => ({ ...c, team: teams.find(t => t.name === c.squadra) }));

  function apriModal() {
    const draft = {};
    for (const r of classifica) draft[r.squadra] = { g: r.g||0, v: r.v||0, n: r.n||0, p: r.p||0, gf: r.gf||0, gs: r.gs||0, pt: r.pt||0, pt_totali: r.pt_totali||0 };
    setEditDraft(draft);
    setShowEditModal(true);
  }

  function setField(squadra, field, val) {
    setEditDraft(prev => {
      const row = { ...prev[squadra], [field]: val };
      // auto-calcola pt da V/N/P e DR da GF/GS
      row.dr = Number(row.gf) - Number(row.gs);
      row.pt = Number(row.v) * 3 + Number(row.n);
      row.g  = Number(row.v) + Number(row.n) + Number(row.p);
      return { ...prev, [squadra]: row };
    });
  }

  async function salvaTutto() {
    setSaving(true);
    try {
      for (const [squadra, row] of Object.entries(editDraft)) {
        const ag = { g: Number(row.g), v: Number(row.v), n: Number(row.n), p: Number(row.p), gf: Number(row.gf), gs: Number(row.gs), dr: Number(row.gf)-Number(row.gs), pt: Number(row.pt), pt_totali: Number(row.pt_totali) };
        const prima = classifica.find(c => c.squadra === squadra);
        await updateClassificaSquadra(squadra, ag);
        await logAzione({ utente: 'admin', squadra, azione: 'classifica_modifica', entita: 'classifica', descrizione: `Classifica: ${squadra}`, dataPrima: { riga: prima }, dataDopo: { riga: { ...prima, ...ag } }, rollbackPossibile: true });
      }
      setShowEditModal(false);
    } finally { setSaving(false); }
  }
  // ── Rose non regolari ────────────────────────────────────────────────────────
  const [roseMap, setRoseMap] = useState({});
  // Carica rose una volta sola usando la cache — non dipende dall'oggetto teams
  // che cambia reference ad ogni render di AppInner
  const teamNames = teams.map(t => t.name).join(',');
  useEffect(() => {
    if (!teamNames) return;
    async function loadAll() {
      const names = teamNames.split(',');
      const cached = cacheGet('rose_all_' + teamNames);
      if (cached) { setRoseMap(cached); return; }
      const result = {};
      await Promise.all(names.map(async name => {
        const d = await cachedFetch('rosa_' + name, () => getRosa(name), 120000);
        if (d) result[name] = d;
      }));
      cacheSet('rose_all_' + teamNames, result, 120000);
      setRoseMap(result);
    }
    loadAll();
  }, [teamNames]);
  const complianceMap = {};
  Object.entries(roseMap).forEach(([name, players]) => { complianceMap[name] = checkRosaCompliance(players); });
  const roseIrregolari = Object.entries(complianceMap).filter(([, c]) => !c.regolare);
  // ── Deadline ─────────────────────────────────────────────────────────────────
  const [nowD, setNowD] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNowD(new Date()), 60000); return () => clearInterval(t); }, []);
  const DEADLINE_DEFS = [
    { label: "Apertura mercato estivo",             month: 6,  day: 1,  section: "Mercato", type: "annual",  note: "Ore 09:00" },
    { label: "Chiusura mercato estivo",             month: 9,  day: 15, section: "Mercato", type: "annual",  note: "Ore 24:00" },
    { label: "Apertura mercato invernale",          month: 1,  day: 1,  section: "Mercato", type: "annual",  note: "Ore 09:00" },
    { label: "Chiusura mercato invernale",          month: 2,  day: 15, section: "Mercato", type: "annual",  note: "Ore 24:00" },
    { label: "Quota iscrizione campionato (30M)",   month: 7,  day: 31, section: "Quote",   type: "annual",  note: "Detratta automaticamente" },
    { label: "Decisione investimento extra (0–10€)",month: 8,  day: 14, section: "Quote",   type: "annual",  note: "Entro le 23:59" },
    { label: "Pagamento quota (30€) al tesoriere",  month: 8,  day: 31, section: "Quote",   type: "annual",  note: "" },
    { label: "Inizio finestra ritiro budget extra",  month: 1,  day: 5,  section: "Quote",   type: "annual",  note: "Costo: 2× i milioni ottenuti" },
    { label: "Pagamento costo vivaio (4M)",          month: 8,  day: 15, section: "Rosa",    type: "annual",  note: "Obbligatorio per tutti" },
    { label: "Acquisto giocatori vivaio",            month: 9,  day: 1,  section: "Rosa",    type: "annual",  note: "Solo dopo aggiornamento listone" },
    { label: "Pagamento stipendi mensile",           day: 1,              section: "Stipendi",type: "monthly", note: "Alle 00:01" },
    { label: "Abbassamento stipendi in calo",        month: 1,  day: 5,  section: "Stipendi",type: "annual",  note: "Entro le 20:00 su WhatsApp" },
    { label: "Aggiornamento stipendi 01/01",         month: 1,  day: 1,  section: "Stipendi",type: "annual",  note: "Alle 08:00 — art. 4.5" },
    { label: "Aggiornamento stipendi 01/06",         month: 6,  day: 1,  section: "Stipendi",type: "annual",  note: "Alle 08:00 — art. 4.6" },
    { label: "Aggiornamento stipendi 01/08",         month: 8,  day: 1,  section: "Stipendi",type: "annual",  note: "Alle 08:00 — art. 4.7" },
    { label: "Rinnovo/non rinnovo contratti",        month: 5,  day: 31, section: "Stipendi",type: "annual",  note: "Entro le 23:59" },
    { label: "Vendita/svincolo contratti ribassati", month: 9,  day: 15, section: "Stipendi",type: "annual",  note: "Pena 5M + svincolo forzato" },
  ];
  function resolveDeadline(def) {
    const today = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate());
    if (def.type === 'monthly') {
      let d = new Date(nowD.getFullYear(), nowD.getMonth(), def.day);
      if (d <= today) d = new Date(nowD.getFullYear(), nowD.getMonth() + 1, def.day);
      return { dateObj: d, dateStr: `${String(def.day).padStart(2,'0')} ogni mese`, days: Math.round((d - today) / 86400000) };
    }
    let d = new Date(nowD.getFullYear(), def.month - 1, def.day);
    if (d < today) d = new Date(nowD.getFullYear() + 1, def.month - 1, def.day);
    const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return { dateObj: d, dateStr: `${String(def.day).padStart(2,'0')} ${mesi[def.month-1]} ${d.getFullYear()}`, days: Math.round((d - today) / 86400000) };
  }
  const resolvedDeadlines = DEADLINE_DEFS.map(def => ({ ...def, ...resolveDeadline(def) })).sort((a, b) => a.dateObj - b.dateObj);
  const entro100 = resolvedDeadlines.filter(d => d.days <= 60 && d.days >= 0);
  const recenti = DEADLINE_DEFS.map(def => {
    const r = resolveDeadline(def);
    let prev = new Date(r.dateObj);
    if (def.type === 'annual') prev = new Date(r.dateObj.getFullYear()-1, def.month-1, def.day);
    else prev = new Date(nowD.getFullYear(), nowD.getMonth()-1, def.day);
    const daysAgo = Math.round((new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()) - prev) / 86400000);
    if (daysAgo < 0 || daysAgo > 30) return null;
    const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return { ...def, dateObj: prev, dateStr: `${String(prev.getDate()).padStart(2,'0')} ${mesi[prev.getMonth()]} ${prev.getFullYear()}`, days: -daysAgo, daysAgo };
  }).filter(Boolean).sort((a,b) => a.daysAgo - b.daysAgo).slice(0, 3);
  const sC = { Mercato: "#6366f1", Quote: "#818cf8", Rosa: "#10b981", Stipendi: "#f97316" };
  const sI = { Mercato: "🤝", Quote: "💶", Rosa: "🌿", Stipendi: "💰" };
  // ── Premi ────────────────────────────────────────────────────────────────────

  const [premi, setPremi] = useState([]);
  const [classPr, setClassPr] = useState([]);
  const [montepremi, setMontepremi] = useState(0);
  const [savingPr, setSavingPr] = useState(false);
  const [premiIndivLega, setPremiIndivLega] = useState({});
  const [savingIndivLega, setSavingIndivLega] = useState(false);
  const [coppaSelezionata, setCoppaSelezionata] = useState({ 1: '', 2: '', 3: '', 4: '' });
  const [savingCoppa, setSavingCoppa] = useState(false);
  const loadPremi = useCallback(async () => {
    const [p, cl] = await Promise.all([getPremi(STAGIONE_CORRENTE), getClassifica()]);
    setPremi(p || []); setClassPr((cl||[]).sort((a,b) => b.pt - a.pt || b.pt_totali - a.pt_totali));
  }, []);
  useEffect(() => { loadPremi(); }, [loadPremi]);
  const primoPoints = classPr[0]?.pt || 0;
  const premi19a = classPr.map((r,i) => ({ squadra: r.squadra, posizione: i+1, importo: calcolaPremio19a(primoPoints, r.pt) }));
  const premiFinali = classPr.map((r,i) => ({ squadra: r.squadra, posizione: i+1, importo: calcolaPremiFinali(i+1) }));
  const premiApp = { p19: premi.some(p => p.tipo==='premio_19a'), finale: premi.some(p => p.tipo==='premio_finale'), individuali: premi.some(p => p.tipo==='premio_indiv' || p.tipo==='malus_indiv'), coppa: premi.some(p => p.tipo==='premio_coppa') };
  async function handleApplicaPremiCoppa() {
    const COPPA_DEF = [[1,5,'Vincitore Coppa'],[2,3,'Finalista Coppa'],[3,1,'Semifinalista Coppa'],[4,1,'Semifinalista Coppa']];
    const entries = COPPA_DEF.map(([pos,mln,label]) => ({ pos, mln, label, squadra: coppaSelezionata[pos] })).filter(e => e.squadra);
    if (!entries.length) { alert('Seleziona almeno una squadra.'); return; }
    if (!window.confirm(`Applicare premi Coppa Italia?\n\n${entries.map(e => `${e.label}: +${e.mln}M → ${e.squadra}`).join('\n')}`)) return;
    setSavingCoppa(true);
    try {
      for (const e of entries) {
        const rec = await insertPremio({ squadra: e.squadra, tipo: 'premio_coppa', importo: e.mln, posizione: e.pos, stagione: STAGIONE_CORRENTE, data_premio: new Date().toISOString().slice(0,10) });
        await applicaPremio(e.squadra, e.mln, e.label, rec.id);
      }
      await loadPremi();
    } catch(err) { alert(err.message); }
    finally { setSavingCoppa(false); }
  }
  async function handleIndivLega() {
    const entries = PREMI_INDIVIDUALI_DEF.map(d => ({ ...d, squadra: premiIndivLega[d.key] })).filter(d => d.squadra);
    if (!entries.length) { alert("Seleziona almeno una squadra."); return; }
    if (!window.confirm(`Applicare ${entries.length} premi/malus individuali?`)) return;
    setSavingIndivLega(true);
    try {
      for (const e of entries) {
        const rec = await insertPremio({ squadra: e.squadra, tipo: e.tipo, importo: e.importo, posizione: null, stagione: STAGIONE_CORRENTE, data_premio: new Date().toISOString().slice(0,10) });
        await applicaPremio(e.squadra, e.importo, e.label, rec.id);
      }
      await loadPremi();
    } catch(err) { alert(err.message); }
    finally { setSavingIndivLega(false); }
  }
  async function handlePr19() {
    if (!window.confirm("Applicare i premi 19ª giornata?")) return;
    setSavingPr(true);
    if (premiApp.p19) { alert('Premi 19ª già applicati.'); setSavingPr(false); return; }
    try { for (const p of premi19a) { const r = await insertPremio({squadra:p.squadra,tipo:'premio_19a',importo:p.importo,posizione:p.posizione,stagione:STAGIONE_CORRENTE,data_premio:new Date().toISOString().slice(0,10)}); await applicaPremio(p.squadra,p.importo,'19ª giornata',r.id); } await loadPremi(); }
    catch(e){alert(e.message);} finally{setSavingPr(false);}
  }
  async function handlePrFinali() {
    if (!window.confirm("Applicare i premi finali?")) return;
    setSavingPr(true);
    if (premiApp.finale) { alert('Premi finali già applicati.'); setSavingPr(false); return; }
    try { for (const p of premiFinali) { const r = await insertPremio({squadra:p.squadra,tipo:'premio_finale',importo:p.importo,posizione:p.posizione,stagione:STAGIONE_CORRENTE,data_premio:new Date().toISOString().slice(0,10)}); await applicaPremio(p.squadra,p.importo,`Premio finale (${p.posizione}°)`,r.id); } await loadPremi(); }
    catch(e){alert(e.message);} finally{setSavingPr(false);}
  }
  const inp = { padding: "4px 6px", borderRadius: 5, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, width: "100%" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── 1. SCADENZE ── */}
      <div style={{ background:"#ffffff06",border:"1.5px solid #ffffff12",borderRadius:16,padding:18 }}>
        <div style={{ fontSize:11,fontWeight:700,color:"#888",letterSpacing:"0.1em",marginBottom:16 }}>📅 SCADENZE</div>
        <style>{`@media(max-width:768px){.dl-cols{flex-direction:column!important;align-items:stretch!important}.dl-sep{display:none!important}}`}</style>
        <div className="dl-cols" style={{ display:"flex",gap:16,alignItems:"flex-start" }}>
          <div style={{ flex:"0 0 230px",minWidth:0 }}>
            <div style={{ fontSize:10,fontWeight:700,color:"#555",letterSpacing:"0.1em",marginBottom:8 }}>ULTIME 3 PASSATE</div>
            {recenti.length===0 ? <div style={{ fontSize:11,color:"#333",fontStyle:"italic" }}>Nessuna scadenza recente</div>
            : recenti.map((d,i) => (
              <div key={i} style={{ display:"flex",gap:10,padding:"6px 0",borderBottom:"1px solid #ffffff06",opacity:0.5 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11,color:"#777",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.label}</div>
                  <div style={{ fontSize:9,color:"#444" }}><span style={{ color:sC[d.section]||"#555" }}>{sI[d.section]}</span> {d.dateStr}</div>
                </div>
                <div style={{ fontSize:10,color:"#444",flexShrink:0,fontFamily:"monospace" }}>−{d.daysAgo}gg</div>
              </div>
            ))}
          </div>
          <div className="dl-sep" style={{ width:1,background:"#ffffff10",alignSelf:"stretch",minHeight:100 }}/>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontSize:10,fontWeight:700,color:"#888",letterSpacing:"0.1em",marginBottom:8 }}>PROSSIME 100 GIORNI</div>
            {entro100.length===0 ? <div style={{ fontSize:11,color:"#555",fontStyle:"italic" }}>Nessuna scadenza imminente</div>
            : entro100.map((d,i) => {
              const urg=d.days<=3, vic=d.days<=14;
              const bc=urg?"#ef4444":vic?"#f59e0b":sC[d.section]||"#6366f1";
              return (
                <div key={i} style={{ background:urg?"#ef444410":vic?"#f59e0b08":"#ffffff05",border:`1px solid ${urg?"#ef444430":vic?"#f59e0b25":"#ffffff0a"}`,borderRadius:10,padding:"8px 12px",marginBottom:5,display:"flex",gap:10,alignItems:"center" }}>
                  <div style={{ width:3,borderRadius:2,background:sC[d.section]||"#6366f1",alignSelf:"stretch",flexShrink:0 }}/>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:11,color:urg?"#fca5a5":"#ccc",fontWeight:600 }}>{urg?"🔴 ":vic&&!urg?"🟡 ":""}{d.label}</div>
                    <div style={{ fontSize:9,color:"#555" }}><span style={{ color:sC[d.section]||"#555",marginRight:4 }}>{sI[d.section]} {d.section}</span>{d.dateStr}{d.note?" · "+d.note:""}</div>
                  </div>
                  <div style={{ textAlign:"center",flexShrink:0 }}>
                    <div style={{ fontSize:d.days<=9?20:16,fontWeight:900,color:bc,fontFamily:"'Bebas Neue',sans-serif",lineHeight:1 }}>{d.days===0?"OGGI":d.days}</div>
                    {d.days>0&&<div style={{ fontSize:8,color:"#555" }}>gg</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 2. COMPETIZIONI (Serie A + Coppa Italia + Supercoppa) ── */}
      {(()=>{
        const COMP_TABS = [
          { key: 'serie_a',    label: '🏅 FantaSerie A' },
          { key: 'coppa',      label: '🏆 FantaCoppa Italia' },
          { key: 'supercoppa', label: '⭐ FantaSupercoppa' },
        ];
        return (
          <div style={{ background:"#ffffff06", border:"1.5px solid #ffffff12", borderRadius:18, padding:18 }}>
            {/* Tab bar */}
            <div style={{ display:"flex", gap:4, marginBottom:18, borderBottom:"1px solid #ffffff0a", paddingBottom:12, flexWrap:"wrap" }}>
              {COMP_TABS.map(t => (
                <button key={t.key} onClick={() => setCompTab(t.key)}
                  style={{ padding:"6px 14px", borderRadius:8, border:"none", background: compTab===t.key?"#6366f125":"transparent", color: compTab===t.key?"#818cf8":"#555", fontWeight:700, fontSize:12, cursor:"pointer", borderBottom: compTab===t.key?"2px solid #6366f1":"2px solid transparent" }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* FantaSerie A */}
            {compTab === 'serie_a' && (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:"0.1em" }}>CLASSIFICA</div>
                    {classifica[0]?.updated_at && <div style={{ fontSize:9, color:"#444", marginTop:2 }}>Agg.: {new Date(classifica[0].updated_at).toLocaleDateString("it-IT",{day:"2-digit",month:"short",year:"numeric"})}</div>}
                  </div>
                  {isAdmin && <button onClick={apriModal} style={{ padding:"6px 14px",borderRadius:8,border:"none",background:"#6366f120",color:"#818cf8",fontSize:11,fontWeight:700,cursor:"pointer" }}>✏️ Aggiorna</button>}
                </div>
                <div style={{ overflowX:"auto" }}>
                  <ClassificaTable classificaRicca={classificaRicca} mySquadra={null} editMode={false} editRow={null} setEditRow={()=>{}} salvaRiga={()=>{}} saving={false} inp={{}} />
                </div>
              </div>
            )}

            {/* FantaCoppa Italia + FantaSupercoppa */}
            {(compTab === 'coppa' || compTab === 'supercoppa') && (
              <TorneiSection isAdmin={isAdmin} forcedTab={compTab === 'coppa' ? 'coppa' : 'supercoppa'} />
            )}
          </div>
        );
      })()}

      {/* ── MODAL MODIFICA CLASSIFICA SERIE A ── */}
      {showEditModal && (
        <div style={{ position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16 }}
          onClick={e => e.target===e.currentTarget && setShowEditModal(false)}>
          <div style={{ background:"#0d0f14",border:"1px solid #ffffff15",borderRadius:18,padding:24,width:"100%",maxWidth:680,maxHeight:"90vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ fontSize:13,fontWeight:800,color:"#f0f0f0" }}>✏️ Aggiorna FantaSerie A</div>
                <div style={{ fontSize:10,color:"#555",marginTop:2 }}>Pt e DR calcolati automaticamente · Pt Tot = tiebreaker stagionale</div>
              </div>
              <button onClick={() => setShowEditModal(false)} style={{ background:"transparent",border:"none",color:"#555",fontSize:18,cursor:"pointer",lineHeight:1 }}>✕</button>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 44px 44px 44px 44px 44px 60px 60px",gap:4,alignItems:"center",padding:"0 4px" }}>
              {["Squadra","V","N","P","G+","G−","Pt Tot","Pt"].map((h,i) => (
                <div key={i} style={{ fontSize:9,fontWeight:700,color:"#555",textAlign:i>0?"center":"left",letterSpacing:"0.05em" }}>{h}</div>
              ))}
            </div>
            {classificaRicca.map(row => {
              const d = editDraft[row.squadra] || {};
              const numInp = { padding:"5px 6px",borderRadius:7,border:"1px solid #ffffff15",background:"#ffffff08",color:"#f0f0f0",fontSize:12,fontWeight:600,textAlign:"center",width:"100%",outline:"none",boxSizing:"border-box" };
              return (
                <div key={row.squadra} style={{ display:"grid",gridTemplateColumns:"1fr 44px 44px 44px 44px 44px 44px 44px",gap:4,alignItems:"center",background:"#ffffff04",borderRadius:10,padding:"8px 10px",border:"1px solid #ffffff08" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,minWidth:0 }}>
                    {row.team && <TeamAvatar team={row.team} size={22} />}
                    <span style={{ fontSize:11,fontWeight:700,color:"#ddd",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{row.squadra}</span>
                  </div>
                  <input type="number" min="0" style={numInp} value={d.v??''} onChange={e => setField(row.squadra,'v',e.target.value)} />
                  <input type="number" min="0" style={numInp} value={d.n??''} onChange={e => setField(row.squadra,'n',e.target.value)} />
                  <input type="number" min="0" style={numInp} value={d.p??''} onChange={e => setField(row.squadra,'p',e.target.value)} />
                  <input type="number" min="0" style={numInp} value={d.gf??''} onChange={e => setField(row.squadra,'gf',e.target.value)} />
                  <input type="number" min="0" style={numInp} value={d.gs??''} onChange={e => setField(row.squadra,'gs',e.target.value)} />
                  <input type="number" min="0" style={numInp} value={d.pt_totali??''} onChange={e => setEditDraft(p => ({ ...p, [row.squadra]: { ...p[row.squadra], pt_totali: e.target.value } }))} />
                  <div style={{ textAlign:"center",fontSize:13,fontWeight:900,color:"#818cf8",fontFamily:"'Bebas Neue',sans-serif" }}>{d.pt??0}</div>
                </div>
              );
            })}
            <div style={{ fontSize:9,color:"#444",lineHeight:1.6 }}>
              <b style={{ color:"#555" }}>Pt</b> = V×3 + N · <b style={{ color:"#555" }}>G</b> = V+N+P · <b style={{ color:"#555" }}>DR</b> = G+−G−
            </div>
            <button onClick={salvaTutto} disabled={saving}
              style={{ padding:"10px 0",borderRadius:10,border:"none",background:"linear-gradient(135deg,#6366f1,#a855f7)",color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",marginTop:4 }}>
              {saving ? "⏳ Salvataggio…" : "✅ Salva classifica"}
            </button>
          </div>
        </div>
      )}

      {/* ── 4. ROSE NON REGOLARI ── */}
      <div style={{ background: roseIrregolari.length>0?"#ef444408":"#ffffff06", border:`1.5px solid ${roseIrregolari.length>0?"#ef444430":"#ffffff12"}`, borderRadius:16, padding:18 }}>
        <div style={{ fontSize:11, fontWeight:700, color:roseIrregolari.length>0?"#ef4444":"#10b981", letterSpacing:"0.1em", marginBottom:roseIrregolari.length>0?14:0 }}>
          {roseIrregolari.length>0?"❌ ROSE NON REGOLARI":"✅ TUTTE LE ROSE REGOLARI"}
        </div>
        {roseIrregolari.map(([name, comp]) => {
          const team = teams.find(t=>t.name===name);
          return (
            <div key={name} style={{ background:"#ef444410",border:"1px solid #ef444428",borderRadius:10,padding:"10px 14px",marginBottom:6 }}>
              <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}>
                {team && <TeamAvatar team={team} size={22}/>}
                <span style={{ fontSize:13,fontWeight:700,color:"#f0f0f0" }}>{name}</span>
              </div>
              {comp.issues.filter(i=>i.tipo==="error").map((issue,idx) => <div key={idx} style={{ fontSize:11,color:"#ef4444",marginTop:2 }}>⛔ {issue.testo}</div>)}
              {comp.issues.filter(i=>i.tipo==="warn").map((issue,idx) => <div key={idx} style={{ fontSize:11,color:"#f59e0b",marginTop:2 }}>⚠️ {issue.testo}</div>)}
            </div>
          );
        })}
      </div>

      {/* ── 4. PREMI ── */}
      <div style={{ background:"#ffffff06",border:"1.5px solid #ffffff12",borderRadius:16,padding:18 }}>
        <div style={{ fontSize:11,fontWeight:700,color:"#888",letterSpacing:"0.1em",marginBottom:16 }}>🏆 PREMI · {STAGIONE_CORRENTE}</div>
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {/* 19a */}
          <div style={{ background:"#6366f108",border:"1.5px solid #6366f120",borderRadius:12,padding:14 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6 }}>
              <div style={{ fontSize:10,fontWeight:700,color:"#818cf8" }}>🏅 PREMI 19ª GIORNATA</div>
              {isAdmin&&!premiApp.p19&&<button onClick={handlePr19} disabled={savingPr} style={{ padding:"5px 10px",borderRadius:7,border:"none",background:"#6366f122",color:"#818cf8",fontSize:10,fontWeight:700,cursor:"pointer" }}>{savingPr?"...":"✅ Applica"}</button>}
              {premiApp.p19&&<Badge color="#10b981">✓ Applicati</Badge>}
            </div>
            {premi19a.map((p,i) => { const team=teams.find(t=>t.name===p.squadra); const cl=classPr[i]; return (
              <div key={p.squadra} style={{ display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #ffffff08" }}>
                <span style={{ fontSize:11,fontWeight:700,color:"#555",minWidth:18 }}>{i+1}</span>
                {team&&<TeamAvatar team={team} size={22}/>}
                <div style={{ flex:1 }}><div style={{ fontSize:11,fontWeight:600,color:"#ddd" }}>{p.squadra}</div><div style={{ fontSize:9,color:"#555" }}>{cl?.pt||0}pt</div></div>
                <div style={{ fontSize:14,fontWeight:900,color:"#818cf8",fontFamily:"'Bebas Neue',sans-serif" }}>+{p.importo}M</div>
              </div>
            );})}
          </div>
          {/* Finali */}
          <div style={{ background:"#f59e0b08",border:"1.5px solid #f59e0b20",borderRadius:12,padding:14 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6 }}>
              <div style={{ fontSize:10,fontWeight:700,color:"#f59e0b" }}>🏆 PREMI FINALI</div>
              {isAdmin&&!premiApp.finale&&<button onClick={handlePrFinali} disabled={savingPr} style={{ padding:"5px 10px",borderRadius:7,border:"none",background:"#f59e0b22",color:"#f59e0b",fontSize:10,fontWeight:700,cursor:"pointer" }}>{savingPr?"...":"✅ Applica"}</button>}
              {premiApp.finale&&<Badge color="#10b981">✓ Applicati</Badge>}
            </div>
            {[[1,20],[2,25],[3,30],[4,35],[5,40],[6,45],[7,50],[8,55]].map(([pos,mln]) => { const cl=classPr[pos-1]; const team=cl?teams.find(t=>t.name===cl.squadra):null; return (
              <div key={pos} style={{ display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #ffffff08" }}>
                <span style={{ fontSize:11,color:"#555",minWidth:18,fontWeight:700 }}>{pos}°</span>
                {team?<TeamAvatar team={team} size={22}/>:<div style={{ width:22,height:22,borderRadius:5,background:"#ffffff10" }}/>}
                <span style={{ flex:1,fontSize:11,color:cl?"#ddd":"#444" }}>{cl?.squadra||"—"}</span>
                <span style={{ fontSize:14,fontWeight:900,color:"#f59e0b",fontFamily:"'Bebas Neue',sans-serif" }}>+{mln}M</span>
              </div>
            );})}
          </div>
          {/* Coppa Italia */}
          <div style={{ background:"#10b98108",border:"1.5px solid #10b98120",borderRadius:12,padding:14 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6 }}>
              <div style={{ fontSize:10,fontWeight:700,color:"#10b981" }}>🥇 PREMI COPPA ITALIA (art. 12.3)</div>
              {isAdmin&&!premiApp.coppa&&<button onClick={handleApplicaPremiCoppa} disabled={savingCoppa} style={{ padding:"5px 10px",borderRadius:7,border:"none",background:"#10b98122",color:"#10b981",fontSize:10,fontWeight:700,cursor:"pointer" }}>{savingCoppa?"...":"✅ Applica"}</button>}
              {premiApp.coppa&&<Badge color="#10b981">✓ Applicati</Badge>}
            </div>
            {[[1,5,"🏆 Vincitore"],[2,3,"🥈 Finalista"],[3,1,"🥉 Semifinalista"],[4,1,"🥉 Semifinalista"]].map(([pos,mln,label]) => (
              <div key={pos} style={{ display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #ffffff08" }}>
                <div style={{ flex:1,fontSize:11,color:"#ccc" }}>{label}</div>
                <span style={{ fontSize:13,fontWeight:900,color:"#10b981",fontFamily:"'Bebas Neue',sans-serif",minWidth:32,textAlign:"right" }}>+{mln}M</span>
                {isAdmin&&!premiApp.coppa ? (
                  <select value={coppaSelezionata[pos]||''} onChange={e=>setCoppaSelezionata(v=>({...v,[pos]:e.target.value}))}
                    style={{ padding:"3px 6px",borderRadius:5,border:"1px solid #ffffff18",background:"#0d0f14",color:"#f0f0f0",fontSize:10,minWidth:120 }}>
                    <option value="">— Squadra —</option>
                    {teams.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize:10,color:coppaSelezionata[pos]?"#ddd":"#333",minWidth:120,textAlign:"right" }}>{coppaSelezionata[pos]||"—"}</span>
                )}
              </div>
            ))}
          </div>
          {/* Montepremi € */}
          <div style={{ background:"#ffffff06",border:"1.5px solid #ffffff10",borderRadius:12,padding:14 }}>
            <div style={{ fontSize:10,fontWeight:700,color:"#888",marginBottom:8 }}>💶 MONTEPREMI €</div>
            <input style={{ ...inp,width:"100%",marginBottom:8 }} type="number" placeholder="Inserisci €" value={montepremi||""} onChange={e=>setMontepremi(parseFloat(e.target.value)||0)}/>
            {montepremi>0&&[["½",montepremi/2,"1° posto"],["¼",montepremi/4,"2° posto"],["⅛",montepremi/8,"3° posto"],["⅛",montepremi/8,"Coppa"]].map(([fraz,imp,label],i) => (
              <div key={i} style={{ display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #ffffff08" }}>
                <span style={{ fontSize:10,color:"#888" }}>{fraz} {label}</span>
                <span style={{ fontSize:12,fontWeight:900,color:"#f59e0b",fontFamily:"'Bebas Neue',sans-serif" }}>{parseFloat(imp.toFixed(2))}€</span>
              </div>
            ))}
          </div>
          {/* Premi Individuali */}
          <div style={{ background:"#a855f708",border:"1.5px solid #a855f725",borderRadius:12,padding:14 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6 }}>
              <div style={{ fontSize:10,fontWeight:700,color:"#a855f7" }}>🏅 PREMI INDIVIDUALI (art. 12.4–12.5)</div>
              {isAdmin&&!premiApp.individuali&&<button onClick={handleIndivLega} disabled={savingIndivLega} style={{ padding:"5px 10px",borderRadius:7,border:"none",background:"#a855f722",color:"#a855f7",fontSize:10,fontWeight:700,cursor:"pointer" }}>{savingIndivLega?"...":"✅ Applica"}</button>}
              {premiApp.individuali&&<Badge color="#10b981">✓ Applicati</Badge>}
            </div>
            {PREMI_INDIVIDUALI_DEF.map(d => {
              const sel = premiIndivLega[d.key] || '';
              return (
                <div key={d.key} style={{ display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #ffffff08" }}>
                  <div style={{ flex:1,fontSize:11,color:"#ccc" }}>{d.label}</div>
                  <span style={{ fontSize:13,fontWeight:900,color:d.color,fontFamily:"'Bebas Neue',sans-serif",minWidth:32,textAlign:"right" }}>{d.importo>0?"+":""}{d.importo}M</span>
                  {isAdmin&&!premiApp.individuali ? (
                    <select value={sel} onChange={e=>setPremiIndivLega(v=>({...v,[d.key]:e.target.value}))}
                      style={{ padding:"3px 6px",borderRadius:5,border:"1px solid #ffffff18",background:"#0d0f14",color:"#f0f0f0",fontSize:10,minWidth:120 }}>
                      <option value="">— Squadra —</option>
                      {teams.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize:10,color:sel?"#ddd":"#333",minWidth:120,textAlign:"right" }}>{sel||"—"}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}

/* ─── DEADLINE PAGE ─────────────────────────────────────────────────────────── */
function DeadlinePage({ isAdmin }) {
  const [now, setNow] = useState(new Date());
  const [applicandoIscrizione, setApplicandoIscrizione] = useState(false);
  const [iscrizioneApplicata, setIscrizioneApplicata] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // 31/07 23:59 — iscrizione campionato automatica
  const y = now.getFullYear();
  const scadenzaIscrizione = new Date(y, 6, 31, 23, 59, 0);
  const iscrizioneScaduta = now >= scadenzaIscrizione;

  async function handleAutoIscrizione() {
    if (!window.confirm("Applicare la quota iscrizione campionato (−30M) a TUTTE le squadre?\n\nQuesta azione è irreversibile e registra un movimento per ognuna.")) return;
    setApplicandoIscrizione(true);
    try {
      const results = await applicaIscrizioneATutti();
      const applicati = results.filter(r => r.ok).length;
      const saltati   = results.filter(r => r.skip).length;
      setIscrizioneApplicata(true);
      alert(`✅ Fatto!\n${applicati} squadre aggiornate · ${saltati} già pagate`);
    } catch(e) { alert(`Errore: ${e.message}`); }
    finally { setApplicandoIscrizione(false); }
  }

  function parseDate(str) {
    // Formato "DD MMM YYYY" o "DD/MM/YYYY"
    const mesi = { "Gen":0,"Feb":1,"Mar":2,"Apr":3,"Mag":4,"Giu":5,"Lug":6,"Ago":7,"Set":8,"Ott":9,"Nov":10,"Dic":11 };
    const parts = str.split(" ");
    if (parts.length === 3 && mesi[parts[1]] !== undefined) {
      return new Date(parseInt(parts[2]), mesi[parts[1]], parseInt(parts[0]), 23, 59, 0);
    }
    return null;
  }

  function getDaysLeft(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return null;
    const diff = d - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function getStatus(days) {
    if (days === null) return { color: "#555", label: "—", bg: "#ffffff08", border: "#ffffff0a" };
    if (days < 0)      return { color: "#444", label: "Scaduta", bg: "#ffffff05", border: "#ffffff08" };
    if (days === 0)    return { color: "#ef4444", label: "OGGI", bg: "#ef444412", border: "#ef444440" };
    if (days <= 3)     return { color: "#ef4444", label: `${days}gg`, bg: "#ef444412", border: "#ef444430" };
    if (days <= 7)     return { color: "#f97316", label: `${days}gg`, bg: "#f9731610", border: "#f9731630" };
    if (days <= 30)    return { color: "#f59e0b", label: `${days}gg`, bg: "#f59e0b08", border: "#f59e0b20" };
    return { color: "#666", label: `${days}gg`, bg: "#ffffff08", border: "#ffffff0a" };
  }

  // ─── Definizione deadline ──────────────────────────────────────────────────
  // type: 'fixed' = data fissa una tantum
  //       'annual' = ricorre ogni anno (anno si aggiorna automaticamente)
  //       'monthly' = ricorre ogni mese (giorno fisso)
  //       'weekly' = ricorre ogni settimana (giorno della settimana)
  const DEADLINE_DEFS = [
    // MERCATO
    { label: "Apertura mercato estivo",             month: 6,  day: 1,  section: "Mercato", type: "annual",  note: "Ore 09:00" },
    { label: "Chiusura mercato estivo",             month: 9,  day: 15, section: "Mercato", type: "annual",  note: "Ore 24:00" },
    { label: "Apertura mercato invernale",          month: 1,  day: 1,  section: "Mercato", type: "annual",  note: "Ore 09:00" },
    { label: "Chiusura mercato invernale",          month: 2,  day: 15, section: "Mercato", type: "annual",  note: "Ore 24:00" },
    // QUOTE
    { label: "Quota iscrizione campionato (30M) — automatica", month: 7,  day: 31, section: "Quote",    type: "annual",  note: "Detratta automaticamente dal bilancio" },
    { label: "Decisione investimento extra budget (0–10€)",     month: 8,  day: 14, section: "Quote",    type: "annual",  note: "Entro le 23:59" },
    { label: "Pagamento quota iscrizione (30€) al tesoriere",   month: 8,  day: 31, section: "Quote",    type: "annual",  note: "" },
    { label: "Inizio finestra ritiro budget extra",             month: 1,  day: 5,  section: "Quote",    type: "annual",  note: "Costo: 2× i milioni ottenuti" },
    // ROSA
    { label: "Pagamento costo vivaio (4M)",                    month: 8,  day: 15, section: "Rosa",     type: "annual",  note: "Obbligatorio per tutti, anche senza vivaio attivo" },
    { label: "Acquisto giocatori vivaio (apertura)",            month: 9,  day: 1,  section: "Rosa",     type: "annual",  note: "Solo dopo aggiornamento listone post-mercato estivo" },
    // STIPENDI
    { label: "Pagamento stipendi mensile — automatico",         day: 1,              section: "Stipendi", type: "monthly", note: "Alle 00:01 — totale stipendi / 12" },
    { label: "Abbassamento stipendi giocatori in calo",         month: 1,  day: 5,  section: "Stipendi", type: "annual",  note: "Entro le 20:00 — da comunicare su WhatsApp" },
    { label: "Aggiornamento stipendi 01/01 (art. 4.5)",            month: 1,  day: 1,  section: "Stipendi", type: "annual",  note: "Alle 08:00 — importa listone da Modifica Rose → aggiorna top-5 rialzi/ribassi in tab Finanze" },
    { label: "Termine ribasso stipendi 01/01 (art. 4.5)",          month: 1,  day: 5,  section: "Stipendi", type: "annual",  note: "Entro le 20:00 — comunicare scelte su WhatsApp" },
    { label: "Aggiornamento stipendi fine stagione 01/06 (art. 4.6)", month: 6, day: 1, section: "Stipendi", type: "annual",  note: "Alle 08:00 — importa listone da Modifica Rose → aggiorna Q e stip di tutti i giocatori" },
    { label: "Aggiornamento stipendi pre-stagione 01/08 (art. 4.7)", month: 8,  day: 1,  section: "Stipendi", type: "annual",  note: "Alle 08:00 — importa listone aggiornato da Modifica Rose" },
    { label: "Rinnovo/non rinnovo contratti biennali",          month: 5,  day: 31, section: "Stipendi", type: "annual",  note: "Entro le 23:59 — non rinnovati diventano svincolati il 01/06" },
    { label: "Vivaio: pagamento costo mantenimento (4M)",         month: 8,  day: 15, section: "Stipendi", type: "annual",  note: "Entro le 23:59 — obbligatorio per tutti" },
    { label: "Vendita/svincolo giocatori contratto ribassato",  month: 9,  day: 15, section: "Stipendi", type: "annual",  note: "Pena 5M + svincolo forzato se non rispettato" },
  ];

  // Calcola la prossima occorrenza di una deadline e i giorni mancanti
  function resolveDeadline(def) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (def.type === 'monthly') {
      // Prossimo 1° del mese
      let candidate = new Date(now.getFullYear(), now.getMonth(), def.day);
      if (candidate <= today) candidate = new Date(now.getFullYear(), now.getMonth() + 1, def.day);
      const days = Math.round((candidate - today) / 86400000);
      return { dateObj: candidate, dateStr: `${String(def.day).padStart(2,'0')} ogni mese`, days, ricorrente: true };
    }

    if (def.type === 'annual') {
      // Prova quest'anno prima, poi anno prossimo
      let candidate = new Date(now.getFullYear(), def.month - 1, def.day);
      if (candidate < today) candidate = new Date(now.getFullYear() + 1, def.month - 1, def.day);
      const days = Math.round((candidate - today) / 86400000);
      const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
      const dateStr = `${String(def.day).padStart(2,'0')} ${mesi[def.month-1]} ${candidate.getFullYear()}`;
      return { dateObj: candidate, dateStr, days, ricorrente: true };
    }

    return null;
  }

  // Costruisce la lista finale ordinata per data
  const resolvedDeadlines = DEADLINE_DEFS.map(def => {
    const r = resolveDeadline(def);
    return { ...def, ...r };
  }).sort((a, b) => a.dateObj - b.dateObj);

  const sections = [...new Set(DEADLINE_DEFS.map(d => d.section))];
  const sectionIcons = { Mercato: "🤝", Quote: "💶", Rosa: "🌿", Stipendi: "💰" };
  const sectionColors = { Mercato: "#6366f1", Quote: "#818cf8", Rosa: "#10b981", Stipendi: "#f97316" };

  // Prossima scadenza assoluta
  const prossima = resolvedDeadlines[0];

  // Deadline entro 60 giorni (per timeline)
  const entro100 = resolvedDeadlines.filter(d => d.days <= 60 && d.days >= 0);
  // Ultime 3 deadline scadute di recente
  const recenti = DEADLINE_DEFS.map(def => {
    const r = resolveDeadline(def);
    if (!r) return null;
    let prev;
    if (def.type === 'monthly') {
      prev = new Date(now.getFullYear(), now.getMonth(), def.day);
      if (prev >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        prev = new Date(now.getFullYear(), now.getMonth() - 1, def.day);
      }
    } else if (def.type === 'annual') {
      prev = new Date(now.getFullYear(), def.month - 1, def.day);
      if (prev >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        prev = new Date(now.getFullYear() - 1, def.month - 1, def.day);
      }
    }
    if (!prev) return null;
    const daysAgo = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - prev) / 86400000);
    if (daysAgo < 0) return null;
    const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return { ...def, dateObj: prev, dateStr: `${String(def.type==='monthly'?def.day:def.day).padStart(2,'0')} ${def.type==='monthly'?mesi[now.getMonth()-1]||mesi[11]:mesi[def.month-1]}`, daysAgo };
  }).filter(Boolean).sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 3);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>DEADLINE</h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Scadenze del regolamento · aggiornate in tempo reale</p>
        </div>
        <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", background: "#ffffff08", borderRadius: 8, padding: "6px 12px" }}>
          🕐 {now.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} {now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      {/* Prossima scadenza in evidenza */}
      {prossima && (
        <div style={{ background: prossima.days <= 3 ? "#ef444412" : prossima.days <= 14 ? "#f59e0b10" : "#6366f112", border: `1.5px solid ${prossima.days <= 3 ? "#ef444440" : prossima.days <= 14 ? "#f59e0b33" : "#6366f133"}`, borderRadius: 16, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: "0.1em", marginBottom: 4 }}>⏳ PROSSIMA SCADENZA</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f0f0f0" }}>{prossima.label}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
              <span style={{ color: sectionColors[prossima.section] || "#888" }}>{sectionIcons[prossima.section]} {prossima.section}</span>
              {" · "}{prossima.dateStr}
              {prossima.note ? ` — ${prossima.note}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: prossima.days <= 3 ? "#ef4444" : prossima.days <= 14 ? "#f59e0b" : "#818cf8", fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>
              {prossima.days === 0 ? "OGGI" : `${prossima.days}`}
            </div>
            {prossima.days > 0 && <div style={{ fontSize: 10, color: "#666" }}>giorni</div>}
          </div>
        </div>
      )}

      {/* Banner auto-iscrizione 31/07 */}
      {isAdmin && iscrizioneScaduta && !iscrizioneApplicata && (
        <div style={{ background: "#f9731615", border: "1.5px solid #f9731640", borderRadius: 14, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f97316", letterSpacing: "0.08em", marginBottom: 4 }}>⚡ AZIONE AUTOMATICA — ISCRIZIONE CAMPIONATO</div>
            <div style={{ fontSize: 12, color: "#ccc" }}>La deadline 31/07 è scaduta — applicare la quota iscrizione (−30M) a tutte le squadre</div>
          </div>
          <button onClick={handleAutoIscrizione} disabled={applicandoIscrizione}
            style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "#f97316", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            {applicandoIscrizione ? "Applicazione..." : "⚡ Applica a tutte (−30M)"}
          </button>
        </div>
      )}
      {iscrizioneApplicata && (
        <div style={{ background: "#10b98115", border: "1px solid #10b98133", borderRadius: 10, padding: "10px 16px", fontSize: 12, color: "#10b981" }}>
          ✅ Iscrizione campionato applicata a tutte le squadre questa sessione
        </div>
      )}

      {/* ── LAYOUT: 2 colonne su desktop (passate | prossime 100gg) ── */}
      <style>{`@media(max-width:768px){.deadline-cols{flex-direction:column!important;align-items:stretch!important}.dl-sep{display:none!important}}`}</style>
      <div className="deadline-cols" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

        {/* COLONNA SINISTRA — Scadute recentemente */}
        <div style={{ flex: "0 0 280px", minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#555", display: "inline-block" }} />
            ULTIME 3 PASSATE
          </div>
          {recenti.length === 0 ? (
            <div style={{ fontSize: 11, color: "#333", fontStyle: "italic" }}>Nessuna scadenza negli ultimi 30 giorni</div>
          ) : recenti.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #ffffff06", opacity: 0.5 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#777", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
                <div style={{ fontSize: 9, color: "#444", marginTop: 1 }}>
                  <span style={{ color: sectionColors[d.section] || "#555" }}>{sectionIcons[d.section]}</span>
                  {" "}{d.dateStr}
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#444", flexShrink: 0, fontFamily: "monospace" }}>
                −{d.daysAgo}gg
              </div>
            </div>
          ))}
        </div>

        {/* LINEA DIVISORIA verticale */}
        <div className="dl-sep" style={{ width: 1, background: "#ffffff10", alignSelf: "stretch", minHeight: 200 }} />

        {/* COLONNA DESTRA — Prossime 100 giorni */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            PROSSIME 100 GIORNI
          </div>

          {entro100.length === 0 ? (
            <div style={{ fontSize: 11, color: "#555", fontStyle: "italic" }}>Nessuna scadenza nei prossimi 100 giorni</div>
          ) : entro100.map((d, i) => {
            const urgente = d.days <= 3;
            const vicino = d.days <= 14;
            const badgeColor = urgente ? "#ef4444" : vicino ? "#f59e0b" : sectionColors[d.section] || "#6366f1";
            const bgColor = urgente ? "#ef444410" : vicino ? "#f59e0b08" : "#ffffff06";
            const borderColor = urgente ? "#ef444430" : vicino ? "#f59e0b25" : "#ffffff10";
            return (
              <div key={i} style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, padding: "10px 14px", marginBottom: 6, display: "flex", gap: 12, alignItems: "center" }}>
                {/* Barra colore sezione */}
                <div style={{ width: 3, borderRadius: 2, background: sectionColors[d.section] || "#6366f1", alignSelf: "stretch", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: urgente ? "#fca5a5" : "#ccc", fontWeight: 600, marginBottom: 2 }}>
                    {urgente && "🔴 "}{vicino && !urgente && "🟡 "}{d.label}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, color: sectionColors[d.section] || "#555", background: (sectionColors[d.section] || "#6366f1") + "18", border: `1px solid ${(sectionColors[d.section] || "#6366f1")}30`, borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>
                      {sectionIcons[d.section]} {d.section}
                    </span>
                    <span style={{ fontSize: 10, color: "#555" }}>{d.dateStr}</span>
                    {d.type === 'monthly' && <span style={{ fontSize: 9, background: "#6366f120", color: "#818cf8", borderRadius: 4, padding: "1px 5px" }}>mensile</span>}
                  </div>
                  {d.note && <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>{d.note}</div>}
                </div>
                {/* Giorni rimanenti */}
                <div style={{ textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: d.days <= 9 ? 22 : 18, fontWeight: 900, color: badgeColor, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>
                    {d.days === 0 ? "OGGI" : d.days}
                  </div>
                  {d.days > 0 && <div style={{ fontSize: 8, color: "#555" }}>gg</div>}
                </div>
              </div>
            );
          })}

          {/* Altre deadline oltre 60gg */}
          {resolvedDeadlines.filter(d => d.days > 60).length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#333", fontStyle: "italic" }}>
              + {resolvedDeadlines.filter(d => d.days > 60).length} scadenze oltre 60 giorni
            </div>
          )}
        </div>
      </div>

      {/* ── RIEPILOGO PER SEZIONE (collassabile) ── */}
      <details style={{ background: "#ffffff06", border: "1px solid #ffffff10", borderRadius: 12, overflow: "hidden" }}>
        <summary style={{ padding: "12px 16px", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#666", letterSpacing: "0.08em" }}>
          📋 TUTTE LE SCADENZE (per sezione)
        </summary>
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          {sections.map(section => {
            const items = resolvedDeadlines.filter(d => d.section === section);
            return (
              <div key={section}>
                <div style={{ fontSize: 10, fontWeight: 700, color: sectionColors[section] || "#888", letterSpacing: "0.1em", marginBottom: 6 }}>
                  {sectionIcons[section]} {section.toUpperCase()}
                </div>
                {items.map((d, i) => {
                  const st = getStatus(d.days);
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid #ffffff08" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "#bbb", fontWeight: 600 }}>{d.label}</div>
                        <div style={{ fontSize: 9, color: "#444" }}>{d.dateStr}{d.note ? ` · ${d.note}` : ""}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: st.color, fontFamily: "'Bebas Neue',sans-serif", minWidth: 50, textAlign: "right" }}>
                        {d.days === 0 ? "OGGI" : `${d.days} gg`}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </details>

    </div>
  );
}


/* ─── ROSA COMPLIANCE CHECK ─────────────────────────────────────────────────── */
function checkRosaCompliance(players) {
  // I giocatori in vivaio NON contano nel totale rosa (art. 3.6)
  const rosaAttiva = players.filter(p => !p.in_vivaio);
  const inVivaio = players.filter(p => p.in_vivaio).length;
  const issues = [];
  const totale = rosaAttiva.length;
  const portieri = rosaAttiva.filter(p => p.ruolo === "Por").length;
  const movimento = totale - portieri;
  const u21 = rosaAttiva.filter(p => p.anni > 0 && p.anni <= 21).length;

  // art. 3.1 — min 25 totali (almeno 2 Por + 23 mov)
  if (totale < 25) issues.push({ tipo: "error", testo: `Solo ${totale} giocatori — minimo 25 richiesti` });
  if (portieri < 2) issues.push({ tipo: "error", testo: `Solo ${portieri} portier${portieri === 1 ? "e" : "i"} — servono almeno 2` });
  if (movimento < 23) issues.push({ tipo: "error", testo: `Solo ${movimento} giocatori di movimento — servono almeno 23` });

  // art. 3.2 — max 30 giocatori
  if (totale > 30) issues.push({ tipo: "error", testo: `${totale} giocatori in rosa — massimo 30 consentiti` });

  // art. 3.3 — U21 richiesti in base alla dimensione della rosa
  // 25-27: nessun obbligo · 28: min 1 · 29: min 2 · 30: min 3
  if (totale === 28 && u21 < 1) issues.push({ tipo: "error", testo: `Rosa a 28: serve almeno 1 U21 (hai ${u21})` });
  if (totale === 29 && u21 < 2) issues.push({ tipo: "error", testo: `Rosa a 29: servono almeno 2 U21 (hai ${u21})` });
  if (totale === 30 && u21 < 3) issues.push({ tipo: "error", testo: `Rosa a 30: servono almeno 3 U21 (hai ${u21})` });

  // art. 3.4 — max 5 giocatori della stessa squadra SA (solo rosa attiva)
  const contaSA = {};
  rosaAttiva.forEach(p => {
    if (p.squadra_serie_a) contaSA[p.squadra_serie_a] = (contaSA[p.squadra_serie_a] || 0) + 1;
  });
  Object.entries(contaSA).forEach(([sq, n]) => {
    if (n > 5) issues.push({ tipo: "error", testo: `${n} giocatori del ${sq} — massimo 5 per squadra SA` });
  });

  // Warnings preventivi
  if (totale === 27 && u21 === 0)
    issues.push({ tipo: "warn", testo: `Rosa a 27 — aggiungendo un giocatore servirà almeno 1 U21` });
  if (totale === 28 && u21 === 1)
    issues.push({ tipo: "warn", testo: `Rosa a 28 — aggiungendo un giocatore serviranno almeno 2 U21` });
  if (totale === 29 && u21 === 2)
    issues.push({ tipo: "warn", testo: `Rosa a 29 — aggiungendo un giocatore serviranno almeno 3 U21` });

  const regolare = issues.filter(i => i.tipo === "error").length === 0;
  return { regolare, issues, totale, portieri, movimento, u21, contaSA, inVivaio };
}

/* ─── PRESIDENTE PAGE ───────────────────────────────────────────────────────── */
function RosaVivaiTab({ team, isAdmin, mySquadra }) {
  const teamName = team.name;
  const navigate = useNavigate();
  const canEdit = isAdmin || mySquadra === teamName;
  const isOwn = mySquadra === teamName;

  const [players, setPlayers] = useState([]);
  const [vivaio, setVivaio] = useState([]);
  const [svincoli, setSvincoli] = useState([]);
  const [contatori, setContatori] = useState(null);
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null); // { player, mode:'own'|'other', anchorRef }
  const [saving, setSaving] = useState(false);
  const [tipoSvincolo, setTipoSvincolo] = useState('ordinario');
  const [estero, setEstero] = useState(false);
  const [offerMode, setOfferMode] = useState('cessione');

  const loadAll = useCallback(async () => {
    const [r, v, s, ct] = await Promise.all([
      cachedFetch('rosa_' + teamName, () => getRosa(teamName), 60000),
      cachedFetch('vivaio_' + teamName, () => getVivaio(teamName), 60000),
      getSvincoli(teamName),
      getStagioneSvincoli(teamName),
    ]);
    setPlayers((r||[]).filter(p => !p.in_vivaio));
    setVivaio(v||[]);
    setSvincoli(s||[]);
    setContatori(ct);
    setLoading(false);
  }, [teamName]);

  useEffect(() => {
    loadAll();
    const sub = subscribeRosa(teamName, loadAll);
    return () => supabase.removeChannel(sub);
  }, [loadAll, teamName]);

  const comp = checkRosaCompliance(players);
  const roleOrder = ["Por","Dc","Dd","Ds","B","E","M","C","T","W","A","Pc"];
  const playersRich = players.map(p => {
    const stipCorretto = calcolaStipCorretto(Number(p.quot||0), Number(p.anni_contratto||0), Number(p.anni||0));
    const isU21 = Number(p.anni||0) > 0 && Number(p.anni||0) <= 21;
    return {
      ...p,
      _ruoloOrd: (() => { const i = roleOrder.indexOf(p.ruolo.split(";")[0]); return i<0?99:i; })(),
      _stipNum: stipCorretto, _quotNum: Number(p.quot||0), _anniNum: Number(p.anni||0),
      _mvNum: Number(p.media_voto||0), _mfvNum: Number(p.media_fantavoto||0),
      _golNum: Number(p.gol||0), _assNum: Number(p.assist||0), _acNum: Number(p.anni_contratto||0),
      _stipCorretto: stipCorretto,
      _stipDiff: !isU21 && Math.abs(stipCorretto - Number(p.stip||0)) > 0.01,
    };
  });
  const { sorted, SortTh } = useSortableTable(playersRich, "_ruoloOrd", "asc");

  function calcolaPreview(player, tipo, estero) {
    if (!player) return null;
    const quot=Number(player.quot||0), stip=calcolaStipCorretto(player.quot,player.anni_contratto,player.anni), oggi=new Date();
    if (tipo==='ordinario') {
      const penale=quot<=10?0.5:quot<=20?1:quot<=30?1.5:2;
      const endYear=oggi.getMonth()<=4?oggi.getFullYear():oggi.getFullYear()+1;
      const mesi=(endYear*12+4)-(oggi.getFullYear()*12+oggi.getMonth())+1;
      const costoStip=parseFloat((mesi*stip/12).toFixed(2));
      return {label:"Costo totale",value:parseFloat((penale+costoStip).toFixed(2)),color:"#ef4444",dettaglio:`Penale ${penale}M + ${mesi} mens. fino a mag (${costoStip}M)`,positivo:false};
    }
    if (tipo==='straordinario_u21_nc') return {label:"Costo/Guadagno",value:0,color:"#888",dettaglio:"U21 nc — costo e guadagno 0",positivo:true};
    const ind=estero?parseFloat((quot/2).toFixed(2)):parseFloat((quot/4).toFixed(2));
    const julyYear=oggi.getMonth()>=5?oggi.getFullYear():oggi.getFullYear()-1;
    const mr=Math.max(0,(oggi.getFullYear()*12+oggi.getMonth())-(julyYear*12+6)+1);
    const rimb=parseFloat((mr*stip/12).toFixed(2));
    return {label:"Indennizzo + rimborso",value:parseFloat((ind+rimb).toFixed(2)),color:"#10b981",dettaglio:`Ind. ${ind}M${estero?' (estero ½)':' (¼)'} + ${mr} mens. rimborsate (${rimb}M)`,positivo:true};
  }

  function getValidazioni(player, tipo) {
    if (!player||!contatori) return [];
    const w=[], oggi=new Date(), isEstate=oggi.getMonth()>=5&&oggi.getMonth()<=8;
    if (player.data_acquisto) { const gg=Math.floor((oggi-new Date(player.data_acquisto))/86400000); if(gg<30)w.push({tipo:'error',testo:`Acquistato ${gg}gg fa — min 30gg`}); }
    if ((tipo==='straordinario'||tipo==='straordinario_u21')&&isEstate&&contatori.count_straord_estivi>=6) w.push({tipo:'error',testo:'Esauriti straord. estivi (6/6)'});
    if ((tipo==='straordinario'||tipo==='straordinario_u21')&&!isEstate&&contatori.count_straord_invernali>=4) w.push({tipo:'error',testo:'Esauriti straord. invernali (4/4)'});
    if (oggi.getMonth()===5||oggi.getMonth()===6) w.push({tipo:'error',testo:'Svincoli non consentiti a giugno/luglio (art. 6.1)'});
    if (tipo!=='straordinario_u21_nc'&&contatori.count_totale>=14) w.push({tipo:'warning',testo:'⚠️ Oltre 14 svincoli: penale +2M'});
    return w;
  }

  async function confermaVincolo() {
    const player=popup?.player; if(!player)return;
    const val=getValidazioni(player,tipoSvincolo); if(val.some(v=>v.tipo==='error'))return;
    const pe=tipoSvincolo!=='straordinario_u21_nc'&&contatori?.count_totale>=14?2:0;
    if(!window.confirm(`Confermi svincolo di ${player.nome}?
${pe>0?`⚠️ Penale extra +${pe}M
`:''}Irreversibile.`))return;
    setSaving(true);
    try {
      const {data:sq}=await supabase.from('squadre').select('bilancio').eq('name',teamName).single();
      await eseguiSvincolo({squadra:teamName,player,tipo:tipoSvincolo,estero,bilancioAttuale:(sq?.bilancio||0)-pe});
      await logAzione({utente:'admin/presidente',squadra:teamName,azione:'svincolo',entita:'rosa',entitaId:player.id,descrizione:`Svincolo (${tipoSvincolo}): ${player.nome} Q${player.quot}`,dataPrima:{giocatore:player},rollbackPossibile:false});
      if(pe>0)await supabase.from('movimenti').insert({squadra:teamName,descrizione:'Penale svincoli extra (>14)',uscita:pe,data:new Date().toISOString().slice(0,10)});
      sendTelegramNotification('svincolo', { giocatore: player.nome, quotazione: player.quot, squadra: teamName, tipo: tipoSvincolo });
      cacheInvalidate('rosa_' + teamName);
      cacheInvalidate('vivaio_' + teamName);
      setPopup(null); setTipoSvincolo('ordinario'); setEstero(false);
      await loadAll();
    } catch(e){alert(`Errore: ${e.message}`);}
    finally{setSaving(false);}
  }

  async function handleRinnovo(player) {
    const isU21=player.anni>0&&player.anni<=21, perc=isU21?0:20;
    const ns=parseFloat((Number(player.stip)*(1+perc/100)).toFixed(2));
    if(!window.confirm(`Rinnovare contratto di ${player.nome}?
${isU21?'U21 — nessun aumento':`+20% → ${ns}M`}
Passa all'anno 3.`))return;
    setSaving(true);
    try { await supabase.from('rosa').update({rinnovo_confermato:true,anni_contratto:(player.anni_contratto||0)+1,stip:ns}).eq('id',player.id); await loadAll(); setPopup(null); }
    catch(e){alert(e.message);} finally{setSaving(false);}
  }

  // ── apre popup: su desktop onClick, su mobile onClick (stesso gesto tap) ──
  function openPopup(e, player, mode) {
    e.preventDefault();
    e.stopPropagation();
    setTipoSvincolo('ordinario'); setEstero(false); setOfferMode('cessione');
    const rect = e.currentTarget.getBoundingClientRect();
    const popupW = Math.min(310, window.innerWidth - 16);
    const popupEstH = 420;
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - popupW - 8));
    const belowY = rect.bottom + 4;
    const aboveY = rect.top - popupEstH - 4;
    const y = belowY + popupEstH < window.innerHeight ? belowY : Math.max(8, aboveY);
    setPopup({ player, mode, x, y, w: popupW });
  }

  async function handleDemoteToVivaio(player) {
    if (!window.confirm(`Spostare ${player.nome} al Vivaio?\n\nRequisiti: Under-23, Q≤3, 0 presenze.`)) return;
    setSaving(true);
    try {
      await supabase.from('rosa').update({ in_vivaio: true, vivaio_presenze: 0, data_entrata_vivaio: new Date().toISOString().slice(0,10) }).eq('id', player.id);
      await loadAll(); setPopup(null);
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  const oggi = new Date();
  const isEstate = oggi.getMonth()>=5&&oggi.getMonth()<=8;
  const usatiStraord = isEstate?(contatori?.count_straord_estivi||0):(contatori?.count_straord_invernali||0);
  const maxStraord = isEstate?6:4;
  const isU21P = popup?.player?.anni>0&&popup?.player?.anni<=21;
  const tipoOptions = [
    {val:'ordinario',label:'Ordinario',desc:'Penale + mesi fino a giu'},
    ...(!isU21P?[{val:'straordinario',label:'Straordinario',desc:`${usatiStraord}/${maxStraord} · rimborso mensilità`}]:[]),
    ...(isU21P?[{val:'straordinario_u21',label:'Straord. U21 (conteggiato)',desc:`${usatiStraord}/${maxStraord}`},{val:'straordinario_u21_nc',label:'Straord. U21 (gratuito)',desc:'Non conta nel limite'}]:[]),
  ];
  const preview = popup?.mode==='own'?calcolaPreview(popup.player,tipoSvincolo,estero):null;
  const validazioni = popup?.mode==='own'?getValidazioni(popup.player,tipoSvincolo):[];
  const canConf = validazioni.filter(v=>v.tipo==='error').length===0;

  async function handlePromuoviVivaio(p) {
    if(players.length>=30){alert(`Rosa piena (${players.length}/30)`);return;}
    if(!window.confirm(`Promuovere ${p.nome} in rosa?
Stipendio: ${(p.quot/5).toFixed(2)}M`))return;
    setSaving(true);
    try{cacheInvalidate('rosa_'+teamName);cacheInvalidate('vivaio_'+teamName);await promuoviDaVivaio(p.id,teamName);await loadAll();}
    catch(e){alert(e.message);}finally{setSaving(false);}
  }

  async function handleSvincolaVivaio(p) {
    if(!window.confirm(`Svincolare ${p.nome} dal vivaio? (gratuito)`))return;
    setSaving(true);
    try{await svincolaVivaio(p.id,teamName);await loadAll();}
    catch(e){alert(e.message);}finally{setSaving(false);}
  }

  const maxVivaio=2;
  const alertProm=vivaio.filter(p=>(p.vivaio_presenze||0)>=2);
  const now=new Date(); const isVivaioPeriod=now.getMonth()>=8; // from Sept 1

  if(loading)return <div style={{fontSize:12,color:"#555",padding:12}}>Caricamento rosa...</div>;

  return (
    <div style={{ position: "relative" }}>
      {/* Click-away overlay — chiude popup quando clicchi fuori */}
      {popup && (
        <div
          style={{ position:"fixed",inset:0,zIndex:998 }}
          onClick={() => setPopup(null)}
          onTouchEnd={() => setPopup(null)}
        />
      )}

      {/* ── Compliance ── */}
      <div style={{ marginBottom:14,background:comp.regolare?"#10b98112":"#ef444412",border:`1.5px solid ${comp.regolare?"#10b98133":"#ef444433"}`,borderRadius:12,padding:"10px 14px" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:comp.issues.length>0?10:0 }}>
          <span style={{ fontWeight:800,fontSize:12,color:comp.regolare?"#10b981":"#ef4444" }}>{comp.regolare?"✅ ROSA REGOLARE":"❌ ROSA NON REGOLARE"}</span>
          <div style={{ display:"flex",gap:10,fontSize:11,color:"#888" }}>
            <span>🧤 {comp.portieri}</span><span>⚽ {comp.movimento}</span>
            <span style={{ color:comp.u21>=3||comp.totale<=27?"#a78bfa":"#ef4444" }}>🔮 {comp.u21} U21</span>
            <span style={{ fontWeight:700,color:comp.totale>30?"#ef4444":"#ccc" }}>{comp.totale}/30</span>
          </div>
        </div>
        {comp.issues.map((issue,i) => <div key={i} style={{ fontSize:11,color:issue.tipo==="error"?"#ef4444":"#f59e0b",marginTop:4 }}>{issue.tipo==="error"?"⛔":"⚠️"} {issue.testo}</div>)}
      </div>

      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
        <span style={{ fontSize:12,color:"#aaa" }}>{players.length} giocatori</span>
        <span style={{ fontSize:10,color:"#444",fontStyle:"italic" }}>
          {canEdit?"Tocca un giocatore per azioni":"Click intestazione per ordinare"}
        </span>
      </div>

      {/* ── Tabella ── */}
      <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <table style={{ width:"100%",minWidth:680,borderCollapse:"collapse",fontSize:12 }}>
          <thead>
            <tr>
              <SortTh col="_ruoloOrd" label="R"     align="center"/>
              <SortTh col="_anniNum"  label="Età"   align="center" />
              <SortTh col="nome"      label="Nome"  align="left"/>
              <SortTh col="squadra_serie_a" label="SA" align="left" />
              <SortTh col="_quotNum"  label="Q"     align="center"/>
              <SortTh col="_stipNum"  label="Stip." align="center"/>
              <SortTh col="_acNum"    label="A.C."  align="center" />
              <SortTh col="clausola"  label="Cl."   align="center" />
              <SortTh col="_mvNum"    label="MV"    align="center" />
              <SortTh col="_mfvNum"   label="MFV"   align="center" />
              <SortTh col="_golNum"   label="Gol"   align="center" />
              <SortTh col="_assNum"   label="Ass"   align="center" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const rc=getRoleColor(p.ruolo), fuori=p.fuori_lista, sel=popup?.player?.id===p.id;
              return (
                <tr key={p.id}
                  onClick={canEdit?(e)=>openPopup(e,p,isOwn?'own':'other'):undefined}
                  style={{ borderBottom:"1px solid #ffffff06",background:sel?"#6366f118":fuori?"#ef444408":"transparent",cursor:canEdit?"pointer":"default",transition:"background 0.1s" }}
                  onMouseEnter={e=>{if(!sel)e.currentTarget.style.background=fuori?"#ef444415":"#ffffff0c";}}
                  onMouseLeave={e=>{e.currentTarget.style.background=sel?"#6366f118":fuori?"#ef444408":"transparent";}}>
                  <td style={{ padding:"7px 6px",textAlign:"center" }}>
                    <span style={{ background:rc.bg,color:rc.text,border:`1px solid ${rc.border}`,borderRadius:5,padding:"2px 4px",fontSize:10,fontWeight:700 }}>{p.ruolo}</span>
                  </td>
                  <td style={{ padding:"7px 8px",textAlign:"center",color:p.anni<=21?"#a78bfa":p.anni>=31?"#f97316":"#888" }}>{p.anni||"—"}</td>
                  <td style={{ padding:"7px 6px",color:fuori?"#ef4444":"#e0e0e0",fontWeight:600,wordBreak:"break-word" }}>
                    {p.nome}
                    {fuori&&<span style={{ marginLeft:4,fontSize:9,background:"#ef444422",color:"#ef4444",border:"1px solid #ef444455",borderRadius:4,padding:"1px 4px",fontWeight:700 }}>FUORI</span>}
                    {!fuori&&p.anni>0&&p.anni<=21&&<span style={{ marginLeft:4,fontSize:9,background:"#8b5cf622",color:"#a78bfa",border:"1px solid #8b5cf644",borderRadius:4,padding:"1px 4px",fontWeight:700 }}>U21</span>}
                    {!fuori&&p.anni>=31&&<span style={{ marginLeft:4,fontSize:9,background:"#f9731622",color:"#fb923c",border:"1px solid #f9731644",borderRadius:4,padding:"1px 4px",fontWeight:700 }}>31+</span>}
                    {!p.in_vivaio&&p.anni>0&&p.anni<=23&&Number(p.quot||0)<=3&&(p.partite||0)===0&&vivaio.length<maxVivaio&&<span title="Eleggibile vivaio" style={{ marginLeft:4,fontSize:11 }}>🌱</span>}
                  </td>
                  <td style={{ padding:"7px 8px",color:"#666",fontSize:11 }}>{p.squadra_serie_a||"—"}</td>
                  <td style={{ padding:"7px 6px",textAlign:"center",fontWeight:800,color:p.quot>=20?"#f59e0b":"#ccc",fontFamily:"'Bebas Neue',sans-serif",fontSize:14 }}>
                    {p.quot}
                    {p.quot_reale && Number(p.quot_reale) !== Number(p.quot) && (
                      <div title={`Quotazione reale aggiornata: ${p.quot_reale} (stip. trasferimento: ${(p.quot_reale/5).toFixed(2)}M)`}
                        style={{ fontSize:9,fontWeight:700,color:Number(p.quot_reale)>Number(p.quot)?"#10b981":"#f97316",letterSpacing:0,fontFamily:"sans-serif",marginTop:1 }}>
                        {Number(p.quot_reale)>Number(p.quot)?'↑':'↓'}{p.quot_reale}
                      </div>
                    )}
                  </td>
                  <td style={{ padding:"7px 6px",textAlign:"center" }}>
                    {(()=>{
                      const isU21s = p.anni > 0 && p.anni <= 21;
                      const ac1 = (p.anni_contratto||0) <= 1;
                      const color = isU21s ? "#10b981" : p._stipDiff ? "#f59e0b" : ac1 ? "#aaa" : "#aaa";
                      const fw = (isU21s || p._stipDiff) ? 700 : 400;
                      const ttip = p._stipDiff ? `Stip. salvato: ${Number(p.stip).toFixed(2)}M · Calcolato: ${p._stipCorretto.toFixed(2)}M` : `Q${p.quot}/5${p._acNum>=2&&!isU21s?" +incremento contratto":""}`;
                      return <span style={{ color, fontWeight: fw }} title={ttip}>{p._stipCorretto.toFixed(2)}M</span>;
                    })()}
                  </td>
                  <td style={{ padding:"7px 8px",textAlign:"center" }}>
                    {(()=>{const ac=p.anni_contratto||0,isU21=p.anni>0&&p.anni<=21,color=ac===0?"#555":ac>=4?"#10b981":ac>=3?"#f59e0b":"#818cf8";
                    return <span style={{ background:color+"22",color,border:`1px solid ${color}44`,borderRadius:5,padding:"1px 6px",fontSize:10,fontWeight:700 }}>{ac||"—"}</span>;})()}
                  </td>
                  <td style={{ padding:"7px 8px",textAlign:"center",color:"#666" }}>{p.clausola}M</td>
                  <td style={{ padding:"7px 8px",textAlign:"center",color:p.media_voto>=6.5?"#10b981":p.media_voto>=6?"#f59e0b":"#888" }}>{p.media_voto>0?Number(p.media_voto).toFixed(2):"—"}</td>
                  <td style={{ padding:"7px 8px",textAlign:"center",color:p.media_fantavoto>=7?"#10b981":p.media_fantavoto>=6?"#f59e0b":"#888" }}>{p.media_fantavoto>0?Number(p.media_fantavoto).toFixed(2):"—"}</td>
                  <td style={{ padding:"7px 8px",textAlign:"center",color:p.gol>0?"#10b981":"#555" }}>{p.gol>0?p.gol:"—"}</td>
                  <td style={{ padding:"7px 8px",textAlign:"center",color:p.assist>0?"#60a5fa":"#555" }}>{p.assist>0?p.assist:"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {players.length>0&&(
        <div style={{ marginTop:10,paddingTop:10,borderTop:"1px solid #ffffff10",display:"flex",gap:16,flexWrap:"wrap" }}>
          <span style={{ fontSize:11,color:"#888" }}>Stipendi: <b style={{ color:"#ccc" }}>{playersRich.reduce((s,p)=>s+p._stipCorretto,0).toFixed(2)}M</b></span>
          <span style={{ fontSize:11,color:"#888" }}>Q media: <b style={{ color:"#ccc" }}>{(players.reduce((s,p)=>s+Number(p.quot),0)/players.length).toFixed(1)}</b></span>
        </div>
      )}

      {/* ── POPUP CONTESTUALE ── */}
      {popup&&(
        <div
          onClick={e=>e.stopPropagation()}
          onTouchEnd={e=>e.stopPropagation()}
          style={{ position:"fixed",zIndex:9999,left:popup.x,top:popup.y,width:popup.w||310,background:"#1a1d26",border:"1.5px solid #ffffff18",borderRadius:14,boxShadow:"0 8px 32px #00000099",padding:16,maxHeight:"90vh",overflowY:"auto" }}>
          {/* Header */}
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
            <div>
              <div style={{ fontSize:14,fontWeight:800,color:"#f0f0f0" }}>{popup.player.nome}</div>
              <div style={{ fontSize:11,color:"#888" }}>Q{popup.player.quot} · {popup.player.ruolo} · {popup.player.anni}aa · {calcolaStipCorretto(Number(popup.player.quot||0),Number(popup.player.anni_contratto||0),Number(popup.player.anni||0)).toFixed(2)}M</div>
              {popup.player.quot_reale && Number(popup.player.quot_reale) !== Number(popup.player.quot) && (
                <div style={{ marginTop:4,fontSize:10,background:"#f9731615",border:"1px solid #f9731630",borderRadius:6,padding:"3px 8px",color:"#f97316",fontWeight:600 }}>
                  ⚠️ Quot. reale aggiornata: <b>Q{popup.player.quot_reale}</b> → stip. trasferimento <b>{(popup.player.quot_reale/5).toFixed(2)}M</b>
                </div>
              )}
            </div>
            <button onClick={()=>setPopup(null)} style={{ background:"none",border:"none",color:"#555",fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1 }}>✕</button>
          </div>

          {popup.mode==='own'?(
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {/* Contatori */}
              <div style={{ display:"flex",gap:6 }}>
                <div style={{ flex:1,background:"#ffffff08",borderRadius:8,padding:"6px 10px",textAlign:"center" }}>
                  <div style={{ fontSize:8,color:"#555" }}>STAGIONE</div>
                  <div style={{ fontSize:14,fontWeight:900,color:(contatori?.count_totale||0)>=14?"#ef4444":"#888",fontFamily:"'Bebas Neue',sans-serif" }}>{contatori?.count_totale||0}/14</div>
                </div>
                <div style={{ flex:1,background:"#ffffff08",borderRadius:8,padding:"6px 10px",textAlign:"center" }}>
                  <div style={{ fontSize:8,color:"#555" }}>STRAORD.</div>
                  <div style={{ fontSize:14,fontWeight:900,color:usatiStraord>=maxStraord?"#ef4444":"#888",fontFamily:"'Bebas Neue',sans-serif" }}>{usatiStraord}/{maxStraord}</div>
                </div>
              </div>
              {/* Tipo svincolo */}
              <div>
                <div style={{ fontSize:9,color:"#666",marginBottom:5,letterSpacing:"0.06em" }}>TIPO SVINCOLO</div>
                {tipoOptions.map(t=>(
                  <button key={t.val} onClick={()=>setTipoSvincolo(t.val)}
                    style={{ display:"block",width:"100%",textAlign:"left",padding:"7px 10px",marginBottom:4,borderRadius:8,border:`1px solid ${tipoSvincolo===t.val?"#ef4444":"#ffffff15"}`,background:tipoSvincolo===t.val?"#ef444415":"transparent",color:tipoSvincolo===t.val?"#fca5a5":"#888",fontSize:11,fontWeight:600,cursor:"pointer" }}>
                    <span style={{ fontWeight:700 }}>{t.label}</span> <span style={{ fontSize:9,color:"#555" }}>{t.desc}</span>
                  </button>
                ))}
              </div>
              {tipoSvincolo==='straordinario'&&(
                <label style={{ display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:11,color:"#ccc" }}>
                  <input type="checkbox" checked={estero} onChange={e=>setEstero(e.target.checked)}/> Trasferito all'estero (rimb. ½)
                </label>
              )}
              {preview&&(
                <div style={{ background:preview.positivo?"#10b98112":"#ef444412",border:`1px solid ${preview.positivo?"#10b98133":"#ef444430"}`,borderRadius:9,padding:"9px 12px" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <span style={{ fontSize:11,color:"#888" }}>{preview.label}</span>
                    <span style={{ fontSize:16,fontWeight:900,color:preview.color,fontFamily:"'Bebas Neue',sans-serif" }}>{preview.positivo?"+":"-"}{Math.abs(preview.value)}M</span>
                  </div>
                  <div style={{ fontSize:10,color:"#555",marginTop:3 }}>{preview.dettaglio}</div>
                </div>
              )}
              {validazioni.map((v,i)=><div key={i} style={{ fontSize:11,color:v.tipo==='error'?"#ef4444":"#f59e0b" }}>{v.tipo==='error'?"⛔":"⚠️"} {v.testo}</div>)}
              <button onClick={confermaVincolo} disabled={!canConf||saving}
                style={{ padding:"9px",borderRadius:9,border:"none",background:canConf?"#ef4444":"#333",color:canConf?"#fff":"#555",fontSize:12,fontWeight:700,cursor:canConf?"pointer":"not-allowed" }}>
                {saving?"...":"✂️ Svincola "+popup.player.nome}
              </button>
              {(popup.player.anni_contratto||0)===2&&(
                <div style={{ borderTop:"1px solid #ffffff10",paddingTop:10 }}>
                  <div style={{ fontSize:9,color:"#666",marginBottom:5 }}>RINNOVO CONTRATTO (anno 2→3)</div>
                  <div style={{ fontSize:11,color:"#aaa",marginBottom:6 }}>
                    {popup.player.anni<=21?"U21 — nessun aumento":`+20% → ${parseFloat((calcolaStipCorretto(Number(popup.player.quot||0),Number(popup.player.anni_contratto||0),Number(popup.player.anni||0))*1.2).toFixed(2))}M`}
                  </div>
                  <button onClick={()=>handleRinnovo(popup.player)} disabled={saving}
                    style={{ width:"100%",padding:"8px",borderRadius:8,border:"none",background:"#10b98122",color:"#10b981",fontSize:12,fontWeight:700,cursor:"pointer" }}>
                    ✓ Rinnova contratto
                  </button>
                </div>
              )}
              {/* ── Vivaio ── */}
              {canEdit && (() => {
                const p = popup.player;
                if (p.in_vivaio) return (
                  <div style={{ borderTop:"1px solid #ffffff10",paddingTop:10 }}>
                    <div style={{ fontSize:9,color:"#10b981",marginBottom:5 }}>VIVAIO → ROSA</div>
                    <button onClick={()=>{ handlePromuoviVivaio(p); setPopup(null); }} disabled={saving}
                      style={{ width:"100%",padding:"8px",borderRadius:8,border:"none",background:"#10b98122",color:"#10b981",fontSize:12,fontWeight:700,cursor:"pointer" }}>
                      ↑ Promuovi in Rosa
                    </button>
                  </div>
                );
                const eligibile = p.anni > 0 && p.anni <= 23 && Number(p.quot||0) <= 3 && (p.partite||0) === 0 && vivaio.length < maxVivaio;
                if (!eligibile) return null;
                return (
                  <div style={{ borderTop:"1px solid #ffffff10",paddingTop:10 }}>
                    <div style={{ fontSize:9,color:"#6366f1",marginBottom:5 }}>ROSA → VIVAIO</div>
                    <div style={{ fontSize:10,color:"#555",marginBottom:6 }}>Under-23 · Q≤3 · 0 presenze · slot vivaio: {vivaio.length}/{maxVivaio}</div>
                    <button onClick={()=>handleDemoteToVivaio(p)} disabled={saving}
                      style={{ width:"100%",padding:"8px",borderRadius:8,border:"none",background:"#6366f115",color:"#818cf8",fontSize:12,fontWeight:700,cursor:"pointer" }}>
                      ↓ Sposta al Vivaio
                    </button>
                  </div>
                );
              })()}
            </div>
          ):(
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              <div style={{ fontSize:10,color:"#818cf8" }}>MANDA OFFERTA — ti reindirizzerà a Mercato</div>
              {[
                {val:'cessione',label:'💰 Acquisto diretto',desc:`Min ${(popup.player.quot/2).toFixed(1)}M`},
                {val:'clausola',label:'⚡ Clausola rescissoria',desc:`${(popup.player.quot*1.75).toFixed(1)}M`},
                {val:'prestito',label:'🔄 Proponi prestito',desc:'50–150% Q come costo di riscatto'},
              ].map(opt=>(
                <button key={opt.val} onClick={()=>setOfferMode(opt.val)}
                  style={{ textAlign:"left",padding:"8px 12px",borderRadius:8,border:`1px solid ${offerMode===opt.val?"#6366f1":"#ffffff15"}`,background:offerMode===opt.val?"#6366f118":"transparent",color:offerMode===opt.val?"#818cf8":"#888",fontSize:11,cursor:"pointer" }}>
                  <div style={{ fontWeight:700 }}>{opt.label}</div>
                  <div style={{ fontSize:9,color:"#555",marginTop:2 }}>{opt.desc}</div>
                </button>
              ))}
              <button onClick={()=>{setPopup(null);navigate(`/mercato?player=${encodeURIComponent(popup.player.nome)}&squadra=${encodeURIComponent(team.name)}&tipo=${offerMode}&quot=${popup.player.quot}`);}}
                style={{ padding:"9px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#6366f1,#a855f7)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer" }}>
                → Vai a Mercato
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Vivaio ── */}
      {(vivaio.length>0||isAdmin||mySquadra===teamName)&&(
        <div style={{ marginTop:24 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
            <div style={{ fontSize:11,fontWeight:700,color:"#10b981",letterSpacing:"0.08em" }}>🌱 VIVAIO</div>
            <span style={{ fontSize:10,color:"#555" }}>{vivaio.length}/{maxVivaio} slot · Under-23 · Q≤3</span>
          </div>
          {alertProm.length>0&&(
            <div style={{ background:"#ef444412",border:"1.5px solid #ef444433",borderRadius:10,padding:"10px 14px",marginBottom:10 }}>
              <div style={{ fontSize:11,fontWeight:700,color:"#ef4444",marginBottom:4 }}>⚠️ AZIONE RICHIESTA (art. 3.6.1)</div>
              {alertProm.map(p=><div key={p.id} style={{ fontSize:11,color:"#fca5a5" }}><b>{p.nome}</b> — {p.vivaio_presenze} presenze · promuovi o svincola entro 2gg</div>)}
            </div>
          )}
          {vivaio.length===0?<div style={{ fontSize:11,color:"#555",fontStyle:"italic" }}>Nessun giocatore in vivaio</div>
          :vivaio.map(p=>{
            const rc=getRoleColor(p.ruolo), na=(p.vivaio_presenze||0)>=2;
            return (
              <div key={p.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,background:na?"#ef444410":"#ffffff08",border:`1px solid ${na?"#ef444430":"#ffffff10"}`,marginBottom:6,flexWrap:"wrap" }}>
                <span style={{ background:rc.bg,color:rc.text,border:`1px solid ${rc.border}`,borderRadius:5,padding:"2px 5px",fontSize:9,fontWeight:700 }}>{p.ruolo}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12,fontWeight:700,color:na?"#fca5a5":"#e0e0e0" }}>{p.nome}</div>
                  <div style={{ fontSize:10,color:"#666" }}>{p.anni}aa · Q{p.quot} · {p.vivaio_presenze||0} presenze</div>
                </div>
                {canEdit&&(
                  <div style={{ display:"flex",gap:5 }}>
                    <button onClick={()=>handlePromuoviVivaio(p)} disabled={saving} style={{ padding:"4px 10px",borderRadius:6,border:"none",background:"#10b98122",color:"#10b981",fontSize:10,fontWeight:700,cursor:"pointer" }}>↑ Promuovi</button>
                    <button onClick={()=>handleSvincolaVivaio(p)} disabled={saving} style={{ padding:"4px 10px",borderRadius:6,border:"none",background:"#ffffff10",color:"#888",fontSize:10,cursor:"pointer" }}>Svincola</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Storico svincoli collassabile ── */}
      {svincoli.length>0&&(
        <details style={{ marginTop:16 }}>
          <summary style={{ fontSize:11,color:"#555",cursor:"pointer",padding:"6px 0" }}>📋 Storico svincoli stagione ({svincoli.length})</summary>
          <div style={{ marginTop:8 }}>
            {svincoli.map(s=>(
              <div key={s.id} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #ffffff08",flexWrap:"wrap",gap:4 }}>
                <div><span style={{ fontSize:12,color:"#ddd",fontWeight:600 }}>{s.giocatore}</span><span style={{ fontSize:10,color:"#555",marginLeft:8 }}>{s.tipo==='ordinario'?'📋':'⭐'} {s.data_svincolo}</span></div>
                <div>{s.costo_penale>0&&<span style={{ fontSize:11,color:"#ef4444" }}>-{s.costo_penale}M</span>}{s.indennizzo>0&&<span style={{ fontSize:11,color:"#10b981",marginLeft:6 }}>+{s.indennizzo}M</span>}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}


/* ─── SVINCOLI TAB ──────────────────────────────────────────────────────────── */
function SvincoliTab({ team, isAdmin }) {
  const [rosa, setRosa] = useState([]);
  const [svincoli, setSvincoli] = useState([]);
  const [contatori, setContatori] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(null); // player selezionato per svincolo
  const [tipoSvincolo, setTipoSvincolo] = useState('ordinario');
  const [estero, setEstero] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    const [r, s, c] = await Promise.all([
      getRosa(team.name),
      getSvincoli(team.name),
      getStagioneSvincoli(team.name),
    ]);
    setRosa(r || []);
    setSvincoli(s || []);
    setContatori(c);
    setLoading(false);
  }, [team.name]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Calcolo costo/indennizzo preview ─────────────────────────────────────
  function calcolaPreview(player, tipo, estero) {
    if (!player) return null;
    const quot = Number(player.quot || 0);
    const stip = calcolaStipCorretto(player.quot, player.anni_contratto, player.anni);
    const oggi = new Date();
    const isU21 = player.anni > 0 && player.anni <= 21;

    if (tipo === 'ordinario') {
      const penale = quot <= 10 ? 0.5 : quot <= 20 ? 1 : quot <= 30 ? 1.5 : 2;
      const endYear = oggi.getMonth() <= 4 ? oggi.getFullYear() : oggi.getFullYear() + 1;
      const mesi = (endYear * 12 + 4) - (oggi.getFullYear() * 12 + oggi.getMonth()) + 1;
      const costoStip = parseFloat((mesi * stip / 12).toFixed(2));
      return {
        label: "Costo totale",
        value: parseFloat((penale + costoStip).toFixed(2)),
        color: "#ef4444",
        dettaglio: `Penale ${penale}M + ${mesi} mensilità fino a mag (${costoStip}M)`,
        positivo: false,
      };
    }
    if (tipo === 'straordinario_u21_nc') {
      return { label: "Costo/Guadagno", value: 0, color: "#888", dettaglio: "Svincolo U21 non conteggiato — costo e guadagno 0", positivo: true };
    }
    // Straordinario
    const ind = estero ? parseFloat((quot / 2).toFixed(2)) : parseFloat((quot / 4).toFixed(2));
    const julyYear = oggi.getMonth() >= 5 ? oggi.getFullYear() : oggi.getFullYear() - 1;
    const mesiRimb = Math.max(0, (oggi.getFullYear() * 12 + oggi.getMonth()) - (julyYear * 12 + 6) + 1);
    const rimb = parseFloat((mesiRimb * stip / 12).toFixed(2));
    const totale = parseFloat((ind + rimb).toFixed(2));
    return {
      label: "Indennizzo + rimborso",
      value: totale,
      color: "#10b981",
      dettaglio: `Indennizzo ${ind}M${estero ? ' (estero ½)' : ' (¼)'} + ${mesiRimb} mens. rimborsate (${rimb}M)`,
      positivo: true,
    };
  }

  // ── Validazioni ───────────────────────────────────────────────────────────
  function getValidazioni(player, tipo) {
    if (!player || !contatori) return [];
    const warnings = [];
    const oggi = new Date();
    const isU21 = player.anni > 0 && player.anni <= 21;
    const isEstate = oggi.getMonth() >= 5 && oggi.getMonth() <= 8;

    // Vincolo 30 giorni dall'acquisto (art. 6.2)
    if (player.data_acquisto) {
      const gg = Math.floor((oggi - new Date(player.data_acquisto)) / 86400000);
      if (gg < 30) warnings.push({ tipo: 'error', testo: `Non svincolabile: acquistato ${gg} giorni fa (min. 30gg)` });
    }

    // Max straordinari (art. 6.1)
    if (tipo === 'straordinario' || tipo === 'straordinario_u21') {
      if (isEstate && contatori.count_straord_estivi >= 6)
        warnings.push({ tipo: 'error', testo: `Esauriti svincoli straordinari estivi (6/6)` });
      if (!isEstate && contatori.count_straord_invernali >= 4)
        warnings.push({ tipo: 'error', testo: `Esauriti svincoli straordinari invernali (4/4)` });
    }
    // Impossibile giu-lug per tutti i tipi (art. 6.1)
    if (oggi.getMonth() === 5 || oggi.getMonth() === 6)
      warnings.push({ tipo: 'error', testo: 'Svincoli non consentiti a giugno/luglio (art. 6.1)' });

    // Max 14 totali (art. 6.4)
    if (tipo !== 'straordinario_u21_nc' && contatori.count_totale >= 14)
      warnings.push({ tipo: 'warning', testo: `Oltre 14 svincoli stagione: penale +2M aggiuntivi` });
    if (tipo !== 'straordinario_u21_nc' && contatori.count_totale === 13)
      warnings.push({ tipo: 'warning', testo: `Attenzione: questo sarà il 14° svincolo stagionale` });

    return warnings;
  }

  async function confermaVincolo() {
    if (!showForm) return;
    const validazioni = getValidazioni(showForm, tipoSvincolo);
    if (validazioni.some(v => v.tipo === 'error')) return;

    const penaleExtra = tipoSvincolo !== 'straordinario_u21_nc' && contatori?.count_totale >= 14 ? 2 : 0;

    const msg = `Confermi lo svincolo di ${showForm.nome}?\n` +
      (penaleExtra > 0 ? `⚠️ Penale extra +${penaleExtra}M (oltre 14 svincoli)\n` : '') +
      `Questa azione è irreversibile.`;
    if (!window.confirm(msg)) return;

    setSaving(true);
    try {
      // Bilancio attuale della squadra
      const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', team.name).single();
      const bil = sq?.bilancio || 0;

      await eseguiSvincolo({
        squadra: team.name,
        player: showForm,
        tipo: tipoSvincolo,
        estero,
        bilancioAttuale: bil - penaleExtra,
      });

      await logAzione({ utente: 'admin/presidente', squadra: team.name, azione: 'svincolo', entita: 'rosa', entitaId: showForm.id, descrizione: `Svincolo (${tipoSvincolo}): ${showForm.nome} Q${showForm.quot}${estero ? ' [estero]' : ''}`, dataPrima: { bilancio: bil, giocatore: showForm }, rollbackPossibile: false });

      // Penale extra separata se >14
      if (penaleExtra > 0) {
        await supabase.from('movimenti').insert({ squadra: team.name, descrizione: 'Penale svincoli extra (>14)', uscita: penaleExtra, data: new Date().toISOString().slice(0,10) });
      }

      setShowForm(null);
      setEstero(false);
      setTipoSvincolo('ordinario');
      await loadAll();
    } catch (e) {
      alert(`Errore: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Checks riacquisto 60gg ────────────────────────────────────────────────
  function isRiacquistabile(nomeGiocatore) {
    if (!contatori?.svincolati_history) return true;
    const rec = contatori.svincolati_history.find(h => h.nome === nomeGiocatore);
    if (!rec) return true;
    return new Date() >= new Date(rec.riacquistabile_dal);
  }

  const preview = calcolaPreview(showForm, tipoSvincolo, estero);
  const validazioni = getValidazioni(showForm, tipoSvincolo);
  const canConfermare = validazioni.filter(v => v.tipo === 'error').length === 0;

  // Conteggio straordinari stagione
  const oggi = new Date();
  const isEstate = oggi.getMonth() >= 5 && oggi.getMonth() <= 8;
  const maxStraord = isEstate ? 6 : 4;
  const usatiStraord = isEstate ? (contatori?.count_straord_estivi || 0) : (contatori?.count_straord_invernali || 0);

  const tipoOptions = [
    { val: 'ordinario', label: '📋 Ordinario', desc: 'Penale + stipendi residui' },
    { val: 'straordinario', label: '⭐ Straordinario', desc: `Indennizzo ¼ + rimborso · ${usatiStraord}/${maxStraord} usati` },
    ...(showForm?.anni > 0 && showForm?.anni <= 21 ? [
      { val: 'straordinario_u21', label: '⭐ Straord. U21 (conteggiato)', desc: 'Come straordinario normale' },
      { val: 'straordinario_u21_nc', label: '🆓 U21 non conteggiato', desc: 'Costo e guadagno 0, illimitato' },
    ] : []),
  ];

  if (loading) return <div style={{ fontSize: 12, color: "#555", padding: 20 }}>Caricamento...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Contatori stagione ── */}
      <div className="grid-stats-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[
          { label: "TOTALE STAGIONE", value: `${contatori?.count_totale || 0} / 14`, color: (contatori?.count_totale || 0) >= 14 ? "#ef4444" : (contatori?.count_totale || 0) >= 12 ? "#f59e0b" : "#10b981" },
          { label: `STRAORD. ${isEstate ? 'ESTIVI' : 'INVERNALI'}`, value: `${usatiStraord} / ${maxStraord}`, color: usatiStraord >= maxStraord ? "#ef4444" : usatiStraord >= maxStraord - 1 ? "#f59e0b" : "#888" },
          { label: "ORDINARI", value: String(contatori?.count_ordinari || 0), color: "#888" },
        ].map(s => (
          <div key={s.label} style={{ background: "#ffffff08", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#555", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Warning giu/lug ── */}
      {(oggi.getMonth() === 5 || oggi.getMonth() === 6) && (
        <div style={{ background: "#f59e0b0a", border: "1px solid #f59e0b30", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#f59e0b" }}>
          ⚠️ Svincoli straordinari sospesi a giugno/luglio (art. 6.1)
        </div>
      )}

      {/* ── Form svincolo ── */}
      {(isAdmin || true) && (
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 12 }}>✂️ NUOVO SVINCOLO</div>

          {/* Selezione giocatore */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>SELEZIONA GIOCATORE</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {rosa.sort((a,b) => b.quot - a.quot).map(p => {
                const sel = showForm?.id === p.id;
                const noRiacq = !isRiacquistabile(p.nome);
                const rc = getRoleColor(p.ruolo);
                return (
                  <button key={p.id} onClick={() => { setShowForm(sel ? null : p); setTipoSvincolo('ordinario'); setEstero(false); }}
                    style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${sel ? "#ef4444" : "#ffffff15"}`, background: sel ? "#ef444418" : "#ffffff08", color: sel ? "#ef4444" : noRiacq ? "#555" : "#ccc", fontSize: 11, cursor: noRiacq ? "not-allowed" : "pointer", opacity: noRiacq ? 0.5 : 1 }}
                    title={noRiacq ? "Svincolo bloccato (30gg dall'acquisto)" : ""}>
                    <span style={{ fontSize: 9, color: rc.text, marginRight: 4 }}>{p.ruolo}</span>
                    {p.nome} <span style={{ color: "#555" }}>Q{p.quot}</span>
                    {p.anni <= 21 && <span style={{ color: "#a78bfa", marginLeft: 3 }}>U21</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tipo svincolo + dettagli */}
          {showForm && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>TIPO SVINCOLO</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {tipoOptions.map(t => (
                    <button key={t.val} onClick={() => setTipoSvincolo(t.val)}
                      style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${tipoSvincolo === t.val ? "#6366f1" : "#ffffff15"}`, background: tipoSvincolo === t.val ? "#6366f122" : "transparent", color: tipoSvincolo === t.val ? "#818cf8" : "#666", fontSize: 11, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                      <div>{t.label}</div>
                      <div style={{ fontSize: 9, color: "#555", fontWeight: 400 }}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Opzione estero per straordinario */}
              {tipoSvincolo === 'straordinario' && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "#ccc" }}>
                  <input type="checkbox" checked={estero} onChange={e => setEstero(e.target.checked)} />
                  Giocatore trasferito all'estero (indennizzo ½ anziché ¼)
                </label>
              )}

              {/* Preview costi */}
              {preview && (
                <div style={{ background: preview.positivo ? "#10b98112" : "#ef444412", border: `1px solid ${preview.positivo ? "#10b98133" : "#ef444430"}`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#888" }}>{preview.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: preview.color, fontFamily: "'Bebas Neue',sans-serif" }}>
                      {preview.positivo ? "+" : "-"}{Math.abs(preview.value)}M
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>{preview.dettaglio}</div>
                </div>
              )}

              {/* Validazioni */}
              {validazioni.map((v, i) => (
                <div key={i} style={{ fontSize: 11, color: v.tipo === 'error' ? "#ef4444" : "#f59e0b" }}>
                  {v.tipo === 'error' ? "⛔" : "⚠️"} {v.testo}
                </div>
              ))}

              <button onClick={confermaVincolo} disabled={!canConfermare || saving}
                style={{ padding: "10px", borderRadius: 10, border: "none", background: canConfermare ? "#ef4444" : "#333", color: canConfermare ? "#fff" : "#555", fontSize: 13, fontWeight: 700, cursor: canConfermare ? "pointer" : "not-allowed" }}>
                {saving ? "Elaborazione..." : `✂️ Svincola ${showForm.nome}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Storico svincoli stagione ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 12 }}>📋 STORICO SVINCOLI STAGIONE</div>
        {svincoli.length === 0
          ? <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessuno svincolo effettuato</div>
          : svincoli.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #ffffff08", flexWrap: "wrap", gap: 6 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#ddd" }}>{s.giocatore}</div>
                <div style={{ fontSize: 10, color: "#666" }}>
                  {s.tipo === 'ordinario' ? '📋 Ordinario' : s.tipo === 'straordinario_u21_nc' ? '🆓 U21 nc' : '⭐ Straordinario'}
                  {s.estero ? ' · estero' : ''} · {s.data_svincolo}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                {s.costo_penale > 0 && <div style={{ fontSize: 11, color: "#ef4444" }}>-{s.costo_penale}M penale</div>}
                {s.indennizzo > 0 && <div style={{ fontSize: 11, color: "#10b981" }}>+{s.indennizzo}M ind.</div>}
                <div style={{ fontSize: 10, color: "#555" }}>Q{s.quot}</div>
              </div>
            </div>
          ))
        }
      </div>

      {/* ── Giocatori svincolati (60gg) ── */}
      {contatori?.svincolati_history?.length > 0 && (
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 10 }}>⏳ BLOCCO RIACQUISTO (60gg)</div>
          {contatori.svincolati_history.map((h, i) => {
            const riacq = new Date(h.riacquistabile_dal);
            const ggMancanti = Math.ceil((riacq - new Date()) / 86400000);
            const scaduto = ggMancanti <= 0;
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #ffffff08", opacity: scaduto ? 0.4 : 1 }}>
                <div style={{ fontSize: 12, color: scaduto ? "#555" : "#ddd" }}>{h.nome}</div>
                <div style={{ fontSize: 11, color: scaduto ? "#555" : "#f59e0b" }}>
                  {scaduto ? "Riacquistabile" : `${ggMancanti}gg`}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

/* ─── CLAUSOLE RESCISSORIE TABLE ────────────────────────────────────────────── */
function ClausoleRescissorieTable({ rescissorie }) {
  const { sorted, SortTh } = useSortableTable(rescissorie, "clausola", "desc");
  return (
    <table style={{ width: "100%", minWidth: 360, borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr>
          <SortTh col="nome"         label="Giocatore"  align="left"   />
          <SortTh col="ruolo"        label="R"          align="center" />
          <SortTh col="quot"         label="Q"          align="center" />
          <SortTh col="clausola"     label="Clausola"   align="right"  />
          <SortTh col="nettoCedente" label="Al cedente" align="right"  />
        </tr>
      </thead>
      <tbody>
        {sorted.map((p, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #ffffff06", opacity: p.fuori_lista ? 0.5 : 1 }}>
            <td style={{ padding: "6px 8px", color: "#ddd", fontWeight: 600 }}>
              {p.nome}
              {p.fuori_lista && <span style={{ fontSize: 8, color: "#ef4444", marginLeft: 4 }}>FUORI</span>}
            </td>
            <td style={{ padding: "6px 8px", textAlign: "center", color: "#666", fontSize: 10 }}>{p.ruolo}</td>
            <td style={{ padding: "6px 8px", textAlign: "center", color: "#f59e0b", fontWeight: 700 }}>{p.quot}</td>
            <td style={{ padding: "6px 8px", textAlign: "right", color: "#ef4444", fontWeight: 800, fontFamily: "'Bebas Neue',sans-serif" }}>{p.clausola}M</td>
            <td style={{ padding: "6px 8px", textAlign: "right", color: "#10b981", fontWeight: 700 }}>{p.nettoCedente}M</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─── CLAUSOLE TAB ──────────────────────────────────────────────────────────── */
function ClausoleTab({ team, isAdmin }) {
  const [clausole, setClausole] = useState([]);
  const [rosaPlayers, setRosaPlayers] = useState([]);
  const [prestitiAttivi, setPrestitiAttivi] = useState([]);
  const [prestitiScaduti, setPrestitiScaduti] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rescindendo, setRescindendo] = useState(null);
  const [eseguendoScadenza, setEseguendoScadenza] = useState(null);

  const loadAll = useCallback(async () => {
    const [c, r, p, sc] = await Promise.all([
      getClausole(team.name),
      getRosa(team.name),
      getPrestitiAttivi(team.name),
      getPrestitiScaduti(),
    ]);
    setClausole(c);
    setRosaPlayers(r);
    setPrestitiAttivi(p);
    // Only show expired loans involving this team
    setPrestitiScaduti((sc || []).filter(item =>
      item.player.squadra === team.name || item.player.squadra_originale === team.name
    ));
    setLoading(false);
  }, [team.name]);

  useEffect(() => {
    loadAll();
    const sub = subscribeClausole(team.name, loadAll);
    return () => supabase.removeChannel(sub);
  }, [loadAll, team.name]);

  if (loading) return <div style={{ fontSize: 12, color: "#555", padding: 20 }}>Caricamento...</div>;

  const rescissorie = rosaPlayers.map(p => ({
    nome: p.nome, quot: p.quot, ruolo: p.ruolo,
    clausola: parseFloat((p.quot * 1.75).toFixed(2)),
    nettoCedente: parseFloat((p.quot * 1.75 * 5 / 7).toFixed(2)),
    fuori_lista: p.fuori_lista,
  })).sort((a, b) => b.clausola - a.clausola);

  // Tipi clausole speciali aggiornati (art. 5 regolamento)
  const tipiClausola = {
    rescissoria:      { label: "⚡ Rescissoria",        color: "#ef4444" },
    da_cedere:        { label: "📤 Da cedere obblig.",  color: "#f97316" },
    bonus_trasf:      { label: "💰 Bonus Rivendita",    color: "#10b981" },
    prestito_dir:     { label: "🔄 Diritto Riscatto",  color: "#6366f1" },
    prestito_obl:     { label: "⚡ Obbligo Riscatto",  color: "#f59e0b" },
    no_svincolo:      { label: "🔒 No-Svincolo",        color: "#818cf8" },
    opzione_acquisto: { label: "👁 Opzione Acquisto",   color: "#a855f7" },
    custom:           { label: "📝 Custom",             color: "#888"    },
  };

  const prestitiCeduti   = prestitiAttivi.filter(p => p.squadra_originale === team.name);
  const prestitiRicevuti = prestitiAttivi.filter(p => p.squadra === team.name && p.in_prestito);

  async function handleRescissione(player, chiPaga) {
    const pct = chiPaga === 'ricevente' ? 0.25 : 0.50;
    const ind = parseFloat((Number(player.quot) * pct).toFixed(2));
    const label = chiPaga === 'ricevente'
      ? `${team.name} paga ${ind}M a ${player.squadra_originale}`
      : `${player.squadra_originale} paga ${ind}M a ${team.name}`;
    if (!window.confirm(`Rescissione anticipata prestito — ${player.nome}\n\n${label}\n\nConfermare?`)) return;
    setRescindendo(player.id);
    try {
      await eseguiRescissioneAnticipataPrestito(player.id, chiPaga);
      await loadAll();
    } catch(e) { alert(`Errore: ${e.message}`); }
    finally { setRescindendo(null); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── PRESTITI IN CORSO ── */}
      {/* ── Prestiti scaduti da gestire ── */}
      {prestitiScaduti.length > 0 && (
        <div style={{ background: "#ef444410", border: "1.5px solid #ef444433", borderRadius: 14, padding: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", letterSpacing: "0.08em", marginBottom: 12 }}>⏰ PRESTITI SCADUTI — DA GESTIRE</div>
          {prestitiScaduti.map(item => {
            const { player, tipo, prezzo } = item;
            const isObl = tipo === 'prestito_obbligo';
            return (
              <div key={player.id} style={{ background: "#ffffff06", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f0f0f0" }}>{player.nome}</div>
                    <div style={{ fontSize: 10, color: "#888" }}>
                      {player.squadra_originale} → {player.squadra} · scad. {player.scadenza_prestito}
                    </div>
                    <div style={{ fontSize: 10, color: isObl ? "#f59e0b" : "#6366f1", marginTop: 2 }}>
                      {isObl ? `⚡ Obbligo riscatto — ${player.squadra} acquista definitivamente (${prezzo}M)` : `🔄 Secco/Diritto — rientra a ${player.squadra_originale}`}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(isObl ? `Eseguire obbligo di riscatto? ${player.squadra} acquista ${player.nome} per ${prezzo}M.` : `Rientrare ${player.nome} a ${player.squadra_originale}?`)) return;
                        setEseguendoScadenza(player.id);
                        try { await eseguiScadenzaPrestito(item); await loadAll(); }
                        catch(e) { alert(e.message); }
                        finally { setEseguendoScadenza(null); }
                      }}
                      disabled={eseguendoScadenza === player.id}
                      style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: isObl ? "#f59e0b" : "#6366f1", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {eseguendoScadenza === player.id ? "..." : isObl ? "✓ Esegui riscatto" : "↩ Rientra"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(prestitiCeduti.length > 0 || prestitiRicevuti.length > 0) && (
        <div style={{ background: "#6366f108", border: "1.5px solid #6366f125", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: "0.08em", marginBottom: 12 }}>🔄 PRESTITI IN CORSO</div>

          {prestitiRicevuti.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>RICEVUTI IN PRESTITO</div>
              {prestitiRicevuti.map(p => (
                <div key={p.id} style={{ padding: "9px 0", borderBottom: "1px solid #ffffff08" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#e0e0e0", fontWeight: 600 }}>{p.nome}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>da {p.squadra_originale} · scad. {p.scadenza_prestito || "—"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#6366f1" }}>Q{p.quot}</div>
                      {p.stip > 0 && <div style={{ fontSize: 10, color: "#888" }}>stip: {Number(p.stip).toFixed(1)}M</div>}
                    </div>
                  </div>
                  {/* Rescissione anticipata — chi riceve paga 25%Q (art. 5.8.1) */}
                  <div style={{ marginTop: 8, background: "#ffffff06", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 6 }}>RESCISSIONE ANTICIPATA (art. 5.8.1)</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => handleRescissione(p, 'ricevente')} disabled={rescindendo === p.id}
                        style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #f97316aa", background: "#f9731618", color: "#f97316", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Pago io {parseFloat((p.quot * 0.25).toFixed(2))}M (25%Q)
                      </button>
                      <button onClick={() => handleRescissione(p, 'cedente')} disabled={rescindendo === p.id}
                        style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #6366f1aa", background: "#6366f118", color: "#818cf8", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Paga {p.squadra_originale} {parseFloat((p.quot * 0.50).toFixed(2))}M (50%Q)
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {prestitiCeduti.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>CEDUTI IN PRESTITO</div>
              {prestitiCeduti.map(p => (
                <div key={p.id} style={{ padding: "9px 0", borderBottom: "1px solid #ffffff08" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#e0e0e0", fontWeight: 600 }}>{p.nome}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>a {p.squadra} · scad. {p.scadenza_prestito || "—"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#6366f1" }}>Q{p.quot}</div>
                      {p.stip_prestito_cedente > 0 && <div style={{ fontSize: 10, color: "#f97316" }}>stip tuo: {Number(p.stip_prestito_cedente).toFixed(1)}M</div>}
                    </div>
                  </div>
                  {/* Cedente paga 50%Q per rescissione (art. 5.8.1) */}
                  <div style={{ marginTop: 8, background: "#ffffff06", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 6 }}>RESCISSIONE ANTICIPATA (art. 5.8.1)</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => handleRescissione(p, 'cedente')} disabled={rescindendo === p.id}
                        style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #f97316aa", background: "#f9731618", color: "#f97316", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Pago io {parseFloat((p.quot * 0.50).toFixed(2))}M (50%Q)
                      </button>
                      <button onClick={() => handleRescissione(p, 'ricevente')} disabled={rescindendo === p.id}
                        style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #6366f1aa", background: "#6366f118", color: "#818cf8", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Paga {p.squadra} {parseFloat((p.quot * 0.25).toFixed(2))}M (25%Q)
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CLAUSOLE SPECIALI ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 12 }}>📋 CLAUSOLE SPECIALI</div>
        {clausole.length === 0
          ? <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessuna clausola speciale attiva</div>
          : clausole.map(c => {
            const tipo = tipiClausola[c.tipo] || tipiClausola.custom;
            return (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #ffffff08" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: tipo.color, background: tipo.color + "18", border: `1px solid ${tipo.color}30`, borderRadius: 5, padding: "1px 7px" }}>{tipo.label}</span>
                    <span style={{ fontSize: 12, color: "#e0e0e0", fontWeight: 600 }}>{c.giocatore || c.giocatore_coinvolto || "—"}</span>
                  </div>
                  {c.condizione && <div style={{ fontSize: 10, color: "#888" }}>Condizione: {c.condizione}</div>}
                  {c.data_scadenza && <div style={{ fontSize: 10, color: "#666" }}>Scade: {c.data_scadenza}</div>}
                  {c.note && <div style={{ fontSize: 10, color: "#555" }}>{c.note}</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: tipo.color, fontFamily: "'Bebas Neue',sans-serif" }}>{c.valore || c.valore_calcolato || "—"}M</div>
                  {c.attivata && <Badge color="#10b981">Attivata</Badge>}
                </div>
              </div>
            );
          })
        }
      </div>

      {/* ── CLAUSOLE RESCISSORIE STANDARD ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 4 }}>⚡ CLAUSOLE RESCISSORIE (quot × 1.75)</div>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 12 }}>Il cedente riceve 3/4 del valore · attivabile dopo 2 rifiuti o 48h dalla prima offerta (art. 5.5)</div>
        <div style={{ overflowX: "auto" }}>
          <ClausoleRescissorieTable rescissorie={rescissorie} />
        </div>
      </div>

    </div>
  );
}

function ContrattoRinnovoRow({ p, team, isAdmin, mySquadra, onToggle }) {
  const [confermando, setConfermando] = useState(false);
  const isU21 = p.anni > 0 && p.anni <= 21;
  const percAumento = isU21 ? 0 : 20;
  const nuovoStip = parseFloat((Number(p.stip) * (1 + percAumento / 100)).toFixed(2));

  async function toggle(nuovoValore) {
    setConfermando(true);
    try {
      const { error } = await supabase.from('rosa').update({ rinnovo_confermato: nuovoValore }).eq('id', p.id);
      if (error) throw error;
      onToggle(p.id, nuovoValore);
    } catch(e) { alert(e.message); }
    finally { setConfermando(false); }
  }

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #ffffff08", flexWrap: "wrap", gap: 8 }}>
      <div>
        <div style={{ fontSize: 12, color: "#e0e0e0", fontWeight: 600 }}>
          {p.nome}
          {isU21 && <span style={{ fontSize: 9, color: "#10b981", marginLeft: 6, background: "#10b98118", border: "1px solid #10b98130", borderRadius: 4, padding: "1px 5px" }}>U21</span>}
        </div>
        <div style={{ fontSize: 10, color: "#888" }}>
          Anno 2 → 3 · {isU21 ? "U21 — nessun aumento stipendio" : `+20% → ${nuovoStip}M`}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "#aaa" }}>{Number(p.stip).toFixed(2)}M</div>
          {!isU21 && <div style={{ fontSize: 11, fontWeight: 700, color: "#f97316" }}>→ {nuovoStip}M</div>}
        </div>
        {(isAdmin || team.name === mySquadra) && (
          p.rinnovo_confermato
            ? <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ Rinnovato</span>
                <button
                  disabled={confermando}
                  onClick={() => { if (window.confirm(`Annullare la conferma di rinnovo per ${p.nome}?`)) toggle(false); }}
                  style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ef444430", background: "#ef444410", color: "#ef4444", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>
                  {confermando ? "…" : "✕ Annulla"}
                </button>
              </div>
            : <button
                disabled={confermando}
                onClick={() => toggle(true)}
                style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: "#10b98122", color: "#10b981", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                {confermando ? "…" : "✓ Rinnova (+20%)"}
              </button>
        )}
      </div>
    </div>
  );
}

/* ─── FINANZE TAB ────────────────────────────────────────────────────────────── */
/* ─── AGGIORNAMENTO STIPENDI 01/01 ───────────────────────────────────────────── */
function AggiornamentoStipendiSection({ team, rosaPlayers, isAdmin, onRefresh }) {
  const [dati, setDati] = useState(null); // { rialzi, ribassi }
  const [storico, setStorico] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);
  const [nuoviStip, setNuoviStip] = useState({}); // { playerId: valore }
  const [open, setOpen] = useState(false);

  const finestraRibasso = isFinestraRibasso();
  // Periodo di aggiornamento: visibile sempre a gennaio, o se ci sono rinnovi pending
  const hasDaCedere = rosaPlayers.some(p => p.da_cedere);
  const ora = new Date();
  const isGennaio = ora.getMonth() === 0; // gennaio

  async function caricaDati() {
    setLoading(true);
    const [top5, stor] = await Promise.all([
      calcolaTop5Aggiornamenti(team.name),
      getAggiornamenti(team.name),
    ]);
    setDati(top5);
    setStorico(stor);
    setLoading(false);
  }

  useEffect(() => {
    if (open) caricaDati();
  }, [open, team.name]);

  async function handleRialzo(p) {
    const stip = nuoviStip[p.id];
    if (!stip || parseFloat(stip) <= Number(p.stip)) {
      alert(`Inserisci un valore maggiore dello stipendio attuale (${Number(p.stip).toFixed(2)}M)`);
      return;
    }
    setSaving(p.id);
    try {
      await applicaRinnovoRialzo(p.id, parseFloat(stip), team.name);
      await caricaDati();
      if (onRefresh) onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSaving(null); }
  }

  async function handleRibasso(p) {
    const stip = nuoviStip[p.id];
    if (!stip || parseFloat(stip) >= Number(p.stip)) {
      alert(`Inserisci un valore minore dello stipendio attuale (${Number(p.stip).toFixed(2)}M)`);
      return;
    }
    if (!finestraRibasso) {
      alert('La finestra per il ribasso è chiusa (01/01 → 05/01 ore 20:00)');
      return;
    }
    setSaving(p.id);
    try {
      const { deveCedere } = await applicaRinnovoRibasso(p.id, parseFloat(stip), team.name);
      if (deveCedere) alert(`⚠️ ${p.nome} (${p.anni}aa) deve essere ceduto/svincolato entro il 15/09, altrimenti penalità 5M + svincolo forzato.`);
      await caricaDati();
      if (onRefresh) onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSaving(null); }
  }

  // Mostra la sezione solo a gennaio o se ci sono rinnovi pending
  if (!isGennaio && !hasDaCedere && storico.length === 0) return null;

  const stipDefault = (p) => nuoviStip[p.id] ?? parseFloat((p.quot / 5).toFixed(2));

  return (
    <div style={{ background: "#f59e0b08", border: "1.5px solid #f59e0b25", borderRadius: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em" }}>
            📈 AGGIORNAMENTO STIPENDI 01/01 (art. 4.5)
          </div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
            {finestraRibasso
              ? "⏳ FINESTRA RIBASSO APERTA — entro 05/01 ore 20:00"
              : isGennaio ? "Gennaio — verifica i top-5 incrementi/decrementi"
              : "Storico rinnovi stagione"}
          </div>
        </div>
        <span style={{ color: "#555" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: "#555" }}>Calcolo in corso...</div>
          ) : dati ? (
            <>
              {/* TOP 5 RIALZI — obbligatorio */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#f97316", letterSpacing: "0.07em", marginBottom: 8 }}>
                  📈 TOP 5 INCREMENTI — RINNOVO OBBLIGATORIO AL RIALZO
                </div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 8 }}>
                  I 5 giocatori con maggior aumento di quotazione devono ricevere un aumento di stipendio.
                  Nuovo stipendio minimo: Q attuale / 5 = {dati.rialzi[0] ? `${(dati.rialzi[0].quot/5).toFixed(2)}M` : "—"}
                </div>
                {dati.rialzi.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#444", fontStyle: "italic" }}>Nessun incremento rilevato — aggiornare quot_precedente prima</div>
                ) : dati.rialzi.map(p => {
                  const gia = storico.find(s => s.giocatore_id === p.id && s.tipo === 'rialzo');
                  return (
                    <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #ffffff08", flexWrap: "wrap" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: gia ? "#10b981" : "#f0f0f0" }}>
                          {gia ? "✅ " : ""}{p.nome}
                          <span style={{ fontSize: 10, color: "#888", marginLeft: 6 }}>{p.anni}aa</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#888" }}>
                          Q precedente: {p.quot_precedente} → Q attuale: {p.quot}
                          <span style={{ color: "#10b981", marginLeft: 4 }}>Δ+{p.delta}</span>
                          · Stip attuale: {Number(p.stip).toFixed(2)}M
                        </div>
                      </div>
                      {gia ? (
                        <Badge color="#10b981">+{gia.nuovo_stip}M applicato</Badge>
                      ) : isAdmin ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="number" step="0.01" placeholder={`min ${(p.quot/5).toFixed(2)}`}
                            value={nuoviStip[p.id] ?? ""}
                            onChange={e => setNuoviStip(s => ({...s, [p.id]: e.target.value}))}
                            style={{ width: 72, padding: "4px 6px", borderRadius: 6, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11 }}
                          />
                          <button onClick={() => handleRialzo(p)} disabled={saving === p.id}
                            style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#f9731622", color: "#f97316", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                            {saving === p.id ? "..." : "↑ Applica"}
                          </button>
                        </div>
                      ) : <Badge color="#f59e0b">Da aggiornare</Badge>}
                    </div>
                  );
                })}
              </div>

              <div style={{ height: 1, background: "#ffffff10" }} />

              {/* TOP 5 RIBASSI — facoltativo entro 05/01 */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#10b981", letterSpacing: "0.07em", marginBottom: 8 }}>
                  📉 TOP 5 DECREMENTI — RIBASSO FACOLTATIVO (entro 05/01 ore 20:00)
                </div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 8 }}>
                  {finestraRibasso
                    ? "⏳ Finestra aperta — comunica le scelte su WhatsApp entro 05/01 ore 20:00"
                    : "Finestra chiusa — disponibile dal 01/01 al 05/01 ore 20:00"}
                </div>
                {dati.ribassi.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#444", fontStyle: "italic" }}>Nessun decremento rilevato</div>
                ) : dati.ribassi.map(p => {
                  const gia = storico.find(s => s.giocatore_id === p.id && s.tipo === 'ribasso');
                  const isU21 = p.anni <= 21;
                  const isOver31 = p.anni >= 31;
                  const deveCedere = p.anni >= 22 && p.anni <= 30;
                  return (
                    <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #ffffff08", flexWrap: "wrap" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: gia ? "#10b981" : isU21 ? "#555" : "#f0f0f0" }}>
                          {gia ? "✅ " : ""}{p.nome}
                          <span style={{ fontSize: 10, color: "#888", marginLeft: 6 }}>{p.anni}aa</span>
                          {isU21 && <Badge color="#555" style={{ marginLeft: 4 }}>U21 — non riducibile</Badge>}
                          {deveCedere && !gia && <Badge color="#f59e0b">22-30aa: dovrà cedere</Badge>}
                          {isOver31 && <Badge color="#10b981">31+ — nessun obbligo</Badge>}
                        </div>
                        <div style={{ fontSize: 10, color: "#888" }}>
                          Q: {p.quot_precedente} → {p.quot}
                          <span style={{ color: "#ef4444", marginLeft: 4 }}>Δ{p.delta}</span>
                          · Stip attuale: {Number(p.stip).toFixed(2)}M · Min ribasso: {(p.quot/5).toFixed(2)}M
                        </div>
                      </div>
                      {gia ? (
                        <Badge color="#10b981">{gia.nuovo_stip}M applicato{gia.note?.includes('cedere') ? ' · da cedere' : ''}</Badge>
                      ) : isU21 ? (
                        <Badge color="#555">Non riducibile</Badge>
                      ) : isAdmin && finestraRibasso ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="number" step="0.01" placeholder={`max ${(p.quot/5).toFixed(2)}`}
                            value={nuoviStip[p.id] ?? ""}
                            onChange={e => setNuoviStip(s => ({...s, [p.id]: e.target.value}))}
                            style={{ width: 72, padding: "4px 6px", borderRadius: 6, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11 }}
                          />
                          <button onClick={() => handleRibasso(p)} disabled={saving === p.id}
                            style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#10b98122", color: "#10b981", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                            {saving === p.id ? "..." : "↓ Applica"}
                          </button>
                        </div>
                      ) : !finestraRibasso ? (
                        <span style={{ fontSize: 9, color: "#444" }}>Finestra chiusa</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {/* Nota regolamento */}
              <div style={{ background: "#ffffff05", borderRadius: 9, padding: "8px 12px", fontSize: 10, color: "#444", lineHeight: 1.6 }}>
                📋 <b>Art. 4.5:</b> Rialzi obbligatori — nuovo stip almeno Q/5 attuale. Ribassi facoltativi:
                U21 non riducibili · 22-30aa riducibili ma devono cedere entro 15/09 (pena 5M + svincolo forzato) ·
                31+aa riducibili senza penalità. Comunicare le scelte su WhatsApp entro 05/01 ore 20:00.
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ─── FAIR SPENDING SECTION ──────────────────────────────────────────────────── */
function FairSpendingSection({ team, isAdmin }) {
  const [movimenti, setMovimenti]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [errore, setErrore]         = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [override, setOverride]     = useState("");

  // Calcola semestre internamente — non dipende da props esterne
  const sem = getSemestreCorrente();
  // Usa le stringhe ISO già calcolate in getSemestreCorrente (evita shift UTC)
  const inizioStr = sem.inizioStr;
  const fineStr   = sem.fineStr;

  async function carica() {
    setLoading(true);
    setErrore(null);
    try {
      const data = await getMovimentiFPF(team.name, inizioStr, fineStr);
      setMovimenti(data);
    } catch(e) {
      setErrore(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carica(); }, [team.name]);

  const movimentiInclusi = (movimenti || []).filter(m => !m.escluso);
  const nettoCalcolato   = parseFloat(movimentiInclusi.reduce((acc, m) => acc + m.contributo, 0).toFixed(2));
  const nettoSpeso       = override !== "" && !isNaN(parseFloat(override)) ? parseFloat(override) : nettoCalcolato;
  const fairResult       = calcolaFairSpending(nettoSpeso);
  const coloreFPF        = nettoSpeso > 60 ? "#ef4444" : nettoSpeso > 55 ? "#f97316" : nettoSpeso > 50 ? "#f59e0b" : "#10b981";

  return (
    <div style={{ background: fairResult?.zona === 'sicura' ? "#10b98108" : "#ef444408", border: `1.5px solid ${fairResult?.zona === 'sicura' ? "#10b98125" : "#ef444425"}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em" }}>⚖️ FAIR SPENDING (art. 7.3) — {sem.label}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={carica} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ffffff10", color: "#888", fontSize: 10, cursor: "pointer" }}>↻</button>
          <button onClick={() => setShowDetail(v => !v)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ffffff10", color: "#888", fontSize: 10, cursor: "pointer" }}>
            {showDetail ? "▲ Nascondi" : "▼ Dettaglio"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>
        {inizioStr} → {fineStr}
        {!loading && movimenti && ` · ${movimentiInclusi.length} inclusi / ${movimenti.length} totali`}
      </div>
      {errore && (
        <div style={{ background: "#ef444415", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#ef4444", marginBottom: 8 }}>
          ⚠️ Errore: {errore} <button onClick={carica} style={{ marginLeft: 8, fontSize: 10, cursor: "pointer", background: "none", border: "none", color: "#818cf8", textDecoration: "underline" }}>Riprova</button>
        </div>
      )}
      {loading ? (
        <div style={{ fontSize: 12, color: "#555", padding: "8px 0" }}>Caricamento...</div>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "baseline" }}>
              <span style={{ fontSize: 12, color: "#888" }}>Netto speso (uscite − entrate)</span>
              <span style={{ fontSize: 17, fontWeight: 900, color: coloreFPF, fontFamily: "'Bebas Neue',sans-serif" }}>
                {nettoSpeso.toFixed(2)}M <span style={{ fontSize: 11, color: "#555", fontFamily: "Inter,sans-serif", fontWeight: 400 }}>/ 50M</span>
              </span>
            </div>
            <StatBar value={Math.min(Math.max(nettoSpeso, 0), 75)} max={75} color={nettoSpeso > 65 ? "#ef4444" : nettoSpeso > 50 ? "#f59e0b" : "#10b981"} height={10} />
            <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>Esclusi: stipendi · guadagni giornata · premi · obiettivi · guadagni investimenti</div>
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "#555" }}>Correzione manuale:</span>
              <input type="number" step="0.1" placeholder={String(nettoCalcolato)} value={override}
                onChange={e => setOverride(e.target.value)}
                style={{ width: 75, padding: "3px 7px", borderRadius: 6, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11 }} />
              {override !== "" && <button onClick={() => setOverride("")} style={{ padding: "3px 7px", borderRadius: 5, border: "none", background: "#ffffff10", color: "#888", fontSize: 10, cursor: "pointer" }}>Reset</button>}
              <span style={{ fontSize: 9, color: "#444" }}>Sovrascrive il calcolo</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
            {[
              { soglia: "≤ 50M",  zona: "sicura", multa: "—",   pt: "—", euro: "—"  },
              { soglia: "50–55M", zona: "50-55",  multa: "10M", pt: "—", euro: "—"  },
              { soglia: "55–60M", zona: "55-60",  multa: "15M", pt: "2", euro: "—"  },
              { soglia: "> 60M",  zona: ">60",    multa: "20M", pt: "4", euro: "5€" },
            ].map(r => {
              const active = fairResult?.zona === r.zona;
              return (
                <div key={r.zona} style={{ display: "flex", gap: 6, padding: "4px 8px", borderRadius: 7, background: active ? "#ef444418" : "#ffffff05", border: `1px solid ${active ? "#ef444430" : "#ffffff08"}`, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: active ? "#f0f0f0" : "#555", minWidth: 52 }}>{r.soglia}</span>
                  <span style={{ flex: 1, fontSize: 10, color: active ? "#ef4444" : "#444" }}>{active && "▶ "}Multa {r.multa} · −{r.pt}pt · {r.euro}</span>
                </div>
              );
            })}
          </div>
          {fairResult?.zona === 'sicura'
            ? <div style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>✅ Zona sicura — nessuna penalità</div>
            : <div style={{ background: "#ef444415", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 4 }}>⚠️ SOGLIA SUPERATA</div>
                {fairResult.multa > 0 && <div style={{ fontSize: 11, color: "#ef4444" }}>💸 Multa: −{fairResult.multa}M</div>}
                {fairResult.giorni > 0 && <div style={{ fontSize: 11, color: "#f59e0b" }}>🔒 Mercato bloccato: {fairResult.giorni}gg</div>}
                {fairResult.pt > 0 && <div style={{ fontSize: 11, color: "#f59e0b" }}>📉 Penalità: −{fairResult.pt}pt</div>}
              </div>
          }
          {showDetail && movimenti && (
            <div style={{ marginTop: 12, borderTop: "1px solid #ffffff10", paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#555", marginBottom: 8 }}>
                MOVIMENTI {inizioStr} → {fineStr}
                {isAdmin && <span style={{ color: "#444", fontWeight: 400, marginLeft: 6 }}>· clicca 🚫 per escludere/includere manualmente dal FPF</span>}
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead style={{ position: "sticky", top: 0, background: "#0d0f14" }}>
                    <tr style={{ borderBottom: "1px solid #ffffff12" }}>
                      {["Data","Descrizione","Entrata","Uscita","FPF", ...(isAdmin?[""]:[])].map(h => (
                        <th key={h} style={{ padding: "4px 6px", textAlign: h==="Descrizione"?"left":"center", color: "#555", fontWeight: 700, fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movimenti.map((m, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #ffffff06", opacity: m.escluso ? 0.35 : 1 }}>
                        <td style={{ padding: "4px 6px", color: "#666", whiteSpace: "nowrap" }}>{m.data}</td>
                        <td style={{ padding: "4px 6px", color: m.escluso ? "#444" : "#ccc", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.descrizioneDisplay}>
                          {m.manuale && <span style={{ fontSize: 8, color: "#6366f1", marginRight: 3 }}>●</span>}
                          {m.descrizioneDisplay}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "center", color: "#10b981" }}>{m.entrata ? `+${Number(m.entrata).toFixed(2)}` : "—"}</td>
                        <td style={{ padding: "4px 6px", textAlign: "center", color: "#f97316" }}>{m.uscita  ? `−${Number(m.uscita).toFixed(2)}`  : "—"}</td>
                        <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700,
                          color: m.escluso ? "#333" : m.contributo > 0 ? "#f97316" : m.contributo < 0 ? "#10b981" : "#555" }}>
                          {m.escluso ? <span style={{ fontSize: 8, color: "#444" }}>excl.</span> : `${m.contributo > 0 ? "+" : ""}${m.contributo.toFixed(2)}`}
                        </td>
                        {isAdmin && (
                          <td style={{ padding: "2px 4px", textAlign: "center" }}>
                            <button
                              title={m.manuale ? "Rimuovi esclusione manuale" : (m.escluso ? "Già escluso automaticamente" : "Escludi dal FPF")}
                              disabled={m.escluso && !m.manuale}
                              onClick={async () => {
                                await toggleFPFEsclusione(m.id, m.descrizione, !m.manuale);
                                carica();
                              }}
                              style={{ padding: "2px 5px", borderRadius: 4, border: "none", fontSize: 9, cursor: m.escluso && !m.manuale ? "default" : "pointer",
                                background: m.manuale ? "#6366f122" : m.escluso ? "#ffffff08" : "#ef444415",
                                color: m.manuale ? "#818cf8" : m.escluso ? "#333" : "#ef4444" }}>
                              {m.manuale ? "↩" : m.escluso ? "—" : "🚫"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #ffffff20" }}>
                      <td colSpan={isAdmin ? 5 : 4} style={{ padding: "5px 6px", fontSize: 10, color: "#888", fontWeight: 700 }}>TOTALE</td>
                      <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 900, fontSize: 13, color: coloreFPF, fontFamily: "'Bebas Neue',sans-serif" }}>{nettoCalcolato.toFixed(2)}M</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}


function FinanzeTab({ team, salaryCapUsato, salaryCapRosa = 0, scAllenatore = 0, salaryCapSforato, scEsenteGiuLug, giorniSCNeg, contrattiScadenza: contrattiScadenzaProp, rosaPlayers, pagandoStipendi, handlePagaStipendi, isAdmin, mySquadra, onRefresh, onBilancioChange }) {
  const [contrattiScadenza, setContrattiScadenza] = useState(contrattiScadenzaProp || []);
  useEffect(() => { setContrattiScadenza(contrattiScadenzaProp || []); }, [contrattiScadenzaProp]);

  function handleToggleRinnovo(id, valore) {
    setContrattiScadenza(prev => prev.map(p => p.id === id ? { ...p, rinnovo_confermato: valore } : p));
    cacheInvalidate('contratti_' + team.name);
    if (onRefresh) onRefresh();
  }

  const [tasse, setTasse] = useState([]);
  const [fairSpending, setFairSpending] = useState([]);
  const [applicandoTassa, setApplicandoTassa] = useState(false);
  const [euroInput, setEuroInput] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);
  const [contrattiSort, setContrattiSort] = useState("ruolo"); // "ruolo" | "nome" | "quot"

  useEffect(() => {
    getTassePagate(team.name).then(setTasse);
    getFairSpending(team.name).then(setFairSpending);
  }, [team.name]);

  const bilancio = team.bilancio;
  const tassa = calcolaTassa(bilancio);
  const tasseAttive = isTassaAttiva();
  const fasciaNeg = getFasciaBilancioNeg(bilancio);
  const settNeg = team.bilancio_neg_settimane || 0;
  const penNeg = fasciaNeg ? getPenalitaNeg(bilancio, settNeg) : null;
  const sem = getSemestreCorrente();

  // ── Logica Quote ──────────────────────────────────────────────────────────

  const euroDisponibili = Math.max(0, 10 - (team.euroBiennio || 0));
  const maxEuroInvestibili = euroDisponibili; // quelli rimasti nel biennio
  const mlnOttenuti = team.mlnExtra || 0;
  const costoRitiro = parseFloat((mlnOttenuti * 2).toFixed(2));
  // Finestra ritiro: 05/01 → martedì dopo 19ª (approssimato qui come 05/01-28/02)
  const oggi = new Date();
  const meseOggi = oggi.getMonth() + 1;
  const giornoOggi = oggi.getDate();
  const finestraRitiroAperta = (meseOggi === 1 && giornoOggi >= 5) || meseOggi === 2;
  // Finestra investimento: entro 14/08
  const finestraInvestimentoAperta = (meseOggi < 8) || (meseOggi === 8 && giornoOggi <= 14);

  async function handleInvesti() {
    const euro = parseFloat(euroInput);
    if (!euro || euro < 1) return;
    if (euro > maxEuroInvestibili) { alert(`Puoi investire al massimo ${maxEuroInvestibili}€ nel biennio ${BIENNIO_CORRENTE}`); return; }
    if (!window.confirm(`Investire ${euro}€ extra per +${(euro*2.5).toFixed(1)}M al bilancio?\n\nAttenzione: gli €${euro} saranno conteggiati sul biennio ${BIENNIO_CORRENTE} e non recuperabili senza pagare il doppio.`)) return;
    setSavingQuote(true);
    try {
      await investiEuroExtra(team.name, euro);
      setEuroInput("");
      if (onRefresh) onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSavingQuote(false); }
  }

  async function handleRitira() {
    if (!finestraRitiroAperta) { alert("La finestra di ritiro è aperta solo tra il 05/01 e il martedì dopo la 19ª giornata."); return; }
    if (!window.confirm(`Ritirare il budget extra?\n\nRicevi: ${mlnOttenuti}M\nCosti: ${costoRitiro}M (2×)\nSaldo netto: −${mlnOttenuti}M\n\nGli €${team.euroInvestiti || 0} rimangono spesi nel biennio.`)) return;
    setSavingQuote(true);
    try {
      await ritiraBudgetExtra(team.name);
      if (onRefresh) onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSavingQuote(false); }
  }

  async function handleIscrizione() {
    if (team.iscrizionePagata) { alert("Iscrizione già applicata."); return; }
    if (!window.confirm("Applicare la quota iscrizione campionato (−30M)?")) return;
    setSavingQuote(true);
    try {
      await applicaIscrizioneCampionato(team.name);
      if (onRefresh) onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSavingQuote(false); }
  }

  async function handleApplicaTassa() {
    const domenica = getDomenicaCorrente();
    // Blocca se la tassa di questa domenica è già stata applicata
    const giaApplicata = tasse.some(t => t.data_controllo === domenica);
    if (giaApplicata) { alert(`La tassa di questa settimana (domenica ${domenica}) è già stata applicata.`); return; }
    if (!window.confirm(`Applicare tassa del ${tassa.perc}% (−${tassa.importo}M) al bilancio di ${team.name}?`)) return;
    setApplicandoTassa(true);
    try {
      await applicaTassaSettimana(team.name, bilancio, domenica);
      await logAzione({ utente: 'admin', squadra: team.name, azione: 'tassa_settimanale', entita: 'squadre', descrizione: `Tassa settimanale ${tassa.perc}% −${tassa.importo}M (bilancio era ${bilancio.toFixed(2)}M)`, dataPrima: { bilancio }, dataDopo: { bilancio: bilancio - tassa.importo }, rollbackPossibile: true });
      getTassePagate(team.name).then(setTasse);
      if (onBilancioChange) onBilancioChange(parseFloat((bilancio - tassa.importo).toFixed(2)));
    } catch(e) { alert(e.message); }
    finally { setApplicandoTassa(false); }
  }

  const Row = ({ label, value, color = "#aaa", large = false }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: "1px solid #ffffff08" }}>
      <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
      <span style={{ fontSize: large ? 16 : 13, fontWeight: large ? 900 : 700, color, fontFamily: large ? "'Bebas Neue',sans-serif" : "inherit" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── 1. BILANCIO LIQUIDO + STATO ── */}
      <div style={{ background: bilancio < 0 ? "#ef444410" : bilancio < 8 ? "#f9731610" : "#ffffff08", border: `1.5px solid ${bilancio < 0 ? "#ef444433" : bilancio < 8 ? "#f9731633" : "#ffffff12"}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 12 }}>💵 BILANCIO LIQUIDO</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 900, color: bilancio < 0 ? "#ef4444" : bilancio < 8 ? "#f97316" : "#10b981", fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>
              {bilancio.toFixed(2)} M
            </div>
            {bilancio < 0 && settNeg > 0 && (
              <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>
                ⚠️ Negativo da <b>{settNeg}</b> settiman{settNeg === 1 ? "a" : "e"}
                {settNeg >= 4 && <span style={{ color: "#ef4444", fontWeight: 700 }}> · MULTA IN EURO PREVISTA</span>}
                {(bilancio < -60 || settNeg >= 5) && <span style={{ color: "#ef4444", fontWeight: 900 }}> · ⚠️ RISCHIO FALLIMENTO</span>}
              </div>
            )}
          </div>
          {bilancio >= 0 && tasseAttive && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.06em" }}>TASSA LUNEDÌ</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>−{tassa.importo}M</div>
              <div style={{ fontSize: 9, color: "#555" }}>{tassa.perc}%</div>
            </div>
          )}
        </div>

        {/* Stato bilancio negativo - penalità progressive */}
        {bilancio < 0 && fasciaNeg && !fasciaNeg.fallimento && (
          <div style={{ background: "#ef444410", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: "0.08em", marginBottom: 8 }}>
              📉 FASCIA: {bilancio >= -20 ? "0/−20M" : bilancio >= -40 ? "−20/−40M" : "−40/−60M"}
            </div>
            {[
              { s: 1, pts: fasciaNeg.pts[0], label: "Sett. 1" },
              { s: 2, pts: fasciaNeg.pts[0]+fasciaNeg.pts[1], label: "Sett. 2" },
              { s: 3, pts: fasciaNeg.pts.reduce((a,b)=>a+b,0), label: "Sett. 3" },
              { s: 4, pts: null, euro: fasciaNeg.euro4, label: "Sett. 4" },
              { s: 5, pts: null, fallimento: true, label: "Sett. 5" },
            ].map(r => (
              <div key={r.s} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ffffff08", opacity: settNeg >= r.s ? 1 : 0.4 }}>
                <span style={{ fontSize: 11, color: settNeg >= r.s ? "#f0f0f0" : "#555", fontWeight: settNeg === r.s ? 800 : 400 }}>
                  {settNeg === r.s ? "▶ " : ""}{r.label}
                  {settNeg >= r.s && settNeg === r.s && " (ATTUALE)"}
                </span>
                <span style={{ fontSize: 11, color: r.fallimento ? "#ef4444" : r.euro ? "#f59e0b" : "#ef4444", fontWeight: 700 }}>
                  {r.fallimento ? "💀 FALLIMENTO" : r.euro ? `${r.euro}€ multa` : `−${r.pts}pt`}
                </span>
              </div>
            ))}
          </div>
        )}
        {bilancio < -60 && (
          <div style={{ background: "#ef444420", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#ef4444", fontWeight: 700 }}>
            💀 BILANCIO OLTRE −60M — FALLIMENTO IMMEDIATO
          </div>
        )}
        {team.fallimento && (
          <div style={{ background: "#ef444425", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#ef4444", fontWeight: 700, marginTop: 8 }}>
            💀 SOCIETÀ IN FALLIMENTO dal {team.fallimento_dal} — contattare gli admin
          </div>
        )}
      </div>

      {/* ── 2. TASSA SETTIMANALE (art. 7.1) ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 12 }}>📊 TASSA SETTIMANALE (art. 7.1)</div>
        {bilancio <= 0 ? (
          <div style={{ fontSize: 12, color: "#555" }}>Bilancio negativo — nessuna tassa applicabile</div>
        ) : (
          <>
            {tassa.flat && <div style={{ fontSize: 11, color: "#818cf8", marginBottom: 8 }}>📌 Periodo giu–ago: tassazione flat 1% per tutti (art. 7.1.2)</div>}
            {!tassa.flat && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[
                { r: "1–20M", p: "1%" }, { r: "21–40M", p: "2%" }, { r: "41–60M", p: "3%" },
                { r: "61–80M", p: "5%" }, { r: "81–100M", p: "8%" }, { r: ">100M", p: "10%" },
              ].map(f => {
                const active = (bilancio > 0 && bilancio <= 20 && f.p==="1%") ||
                               (bilancio > 20 && bilancio <= 40 && f.p==="2%") ||
                               (bilancio > 40 && bilancio <= 60 && f.p==="3%") ||
                               (bilancio > 60 && bilancio <= 80 && f.p==="5%") ||
                               (bilancio > 80 && bilancio <= 100 && f.p==="8%") ||
                               (bilancio > 100 && f.p==="10%");
                return (
                  <div key={f.r} style={{ textAlign: "center", background: active ? "#f59e0b18" : "#ffffff06", border: `1px solid ${active ? "#f59e0b44" : "#ffffff10"}`, borderRadius: 8, padding: "6px 4px" }}>
                    <div style={{ fontSize: 9, color: active ? "#f59e0b" : "#555" }}>{f.r}</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: active ? "#f59e0b" : "#444", fontFamily: "'Bebas Neue',sans-serif" }}>{f.p}</div>
                  </div>
                );
              })}
            </div>
            )}
            <div style={{ background: "#f59e0b10", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#888" }}>Tassa prossima domenica</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>−{tassa.importo}M <span style={{ fontSize: 12 }}>({tassa.perc}%)</span></span>
            </div>
            {isAdmin && (() => {
              const domenicaKey = getDomenicaCorrente();
              const giaFatta = tasse.some(t => t.data_controllo === domenicaKey);
              return (
                <div style={{ width: "100%", padding: "9px", borderRadius: 9, background: giaFatta ? "#10b98110" : "#f59e0b10", border: `1px solid ${giaFatta ? "#10b98130" : "#f59e0b30"}`, color: giaFatta ? "#10b981" : "#f59e0b", fontSize: 12, fontWeight: 700, textAlign: "center" }}>
                  {giaFatta ? `✓ Tassa settimana (${domenicaKey}) già applicata` : `⏳ Tassa ${domenicaKey} da applicare dalla Control Room`}
                </div>
              );
            })()}
          </>
        )}
        {/* Storico ultime tasse */}
        {tasse.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "1px solid #ffffff08", paddingTop: 10 }}>
            <div style={{ fontSize: 10, color: "#444", marginBottom: 6 }}>ULTIME TASSE</div>
            {tasse.slice(0, 4).map(t => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#666", padding: "3px 0" }}>
                <span>{t.data_controllo} · {t.percentuale}%</span>
                <span style={{ color: "#f59e0b" }}>−{t.importo_tassa}M</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 3. SALARY CAP ── */}
      <div style={{ background: salaryCapSforato ? "#ef444408" : "#ffffff06", border: `1.5px solid ${salaryCapSforato ? "#ef444430" : "#ffffff12"}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: salaryCapSforato ? "#ef4444" : "#888", letterSpacing: "0.08em", marginBottom: 14 }}>💰 SALARY CAP — STIPENDI</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#888" }}>Salary Cap usato (live)</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: salaryCapSforato ? "#ef4444" : "#10b981" }}>{salaryCapUsato.toFixed(1)}M / 75M</span>
          </div>
          <StatBar value={Math.min(salaryCapUsato, 75)} max={75} color={salaryCapSforato ? "#ef4444" : "#10b981"} height={10} />
          {salaryCapSforato
            ? <div style={{ marginTop: 4, fontSize: 11, color: "#ef4444", fontWeight: 700 }}>⛔ Sforato di {(salaryCapUsato - 75).toFixed(1)}M{scEsenteGiuLug ? " (esenzione giu/lug)" : ""}</div>
            : <div style={{ marginTop: 4, fontSize: 11, color: "#10b981" }}>✅ +{(75 - salaryCapUsato).toFixed(1)}M disponibile</div>}
        </div>
        {/* Breakdown: rosa + staff allenatore */}
        {scAllenatore > 0 && (
          <div style={{ background: "#ffffff06", borderRadius: 8, padding: "8px 12px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888" }}>
              <span>Stipendi rosa</span>
              <span>{salaryCapRosa.toFixed(1)}M</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#f59e0b" }}>
              <span>👔 Staff allenatore (fisso)</span>
              <span>+{scAllenatore.toFixed(1)}M</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "#ccc", borderTop: "1px solid #ffffff10", paddingTop: 4 }}>
              <span>Totale SC</span>
              <span>{salaryCapUsato.toFixed(1)}M</span>
            </div>
          </div>
        )}
        {salaryCapSforato && !scEsenteGiuLug && (
          <div style={{ background: "#ef444412", borderRadius: 10, padding: "10px 12px", fontSize: 11, color: "#ef4444", marginBottom: 12 }}>
            ⏱ SC negativo da <b>{giorniSCNeg}</b> giorn{giorniSCNeg === 1 ? "o" : "i"}
            {giorniSCNeg >= 5 && giorniSCNeg < 15 && <span> — penalità: <b>{giorniSCNeg * 2}gg</b> mercato bloccato</span>}
            {giorniSCNeg >= 15 && <span> — penalità: <b>{giorniSCNeg * 2}gg</b> bloccato + <b>multa 5€</b></span>}
          </div>
        )}
        <Row label="Rata mensile (1° del mese)" value={`−${(salaryCapUsato/12).toFixed(2)}M`} color="#f97316" large />
        <Row label="Totale annuale stipendi" value={`−${salaryCapUsato.toFixed(1)}M`} color="#f97316" large />
        {isAdmin && (
          <button onClick={handlePagaStipendi} disabled={pagandoStipendi} style={{ width: "100%", marginTop: 12, padding: "9px", borderRadius: 9, border: "1px solid #f9731633", background: "#f9731618", color: "#f97316", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {pagandoStipendi ? "Pagamento in corso..." : `💸 Paga stipendi (−${(salaryCapUsato/12).toFixed(2)}M)`}
          </button>
        )}
      </div>

      {/* ── 4. FAIR SPENDING (art. 7.3) ── */}
      <FairSpendingSection team={team} isAdmin={isAdmin} />

      {/* ── 5. QUOTE & BIENNIO 2025-27 ── */}
      <div style={{ background: "#6366f108", border: "1.5px solid #6366f125", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: "0.08em", marginBottom: 14 }}>💶 QUOTE & BUDGET BIENNIO {BIENNIO_CORRENTE}</div>

        {/* Status pagamenti */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Quota 30€ al tesoriere", ok: team.quotaPagata, deadline: "entro 31/08" },
            { label: "Iscrizione campionato (30M)", ok: team.iscrizionePagata, deadline: "automatica 31/07" },
          ].map(s => (
            <div key={s.label} style={{ background: s.ok ? "#10b98110" : "#f59e0b10", border: `1px solid ${s.ok ? "#10b98130" : "#f59e0b30"}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: "#555", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: s.ok ? "#10b981" : "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>
                {s.ok ? "✓ PAGATA" : "⏳ IN ATTESA"}
              </div>
              {!s.ok && <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>{s.deadline}</div>}
            </div>
          ))}
        </div>

        {/* Pulsanti admin */}
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {!team.iscrizionePagata && (
              <button onClick={handleIscrizione} disabled={savingQuote}
                style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#f9731618", color: "#f97316", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                📋 Applica iscrizione −30M
              </button>
            )}
            {!team.quotaPagata && (
              <button onClick={() => { if(window.confirm("Segnare la quota 30€ come pagata?")) segnaQuotaPagata(team.name).then(() => onRefresh && onRefresh()); }}
                style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#10b98118", color: "#10b981", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                ✓ Segna quota pagata
              </button>
            )}
          </div>
        )}

        <div style={{ height: 1, background: "#ffffff10", marginBottom: 12 }} />

        {/* Biennio barra */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#888" }}>Euro investiti nel biennio {BIENNIO_CORRENTE}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#818cf8" }}>{team.euroBiennio || 0}€ / 10€</span>
          </div>
          <StatBar value={team.euroBiennio || 0} max={10} color="#6366f1" height={8} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#555" }}>Questa stagione: {team.euroInvestiti || 0}€ → +{((team.euroInvestiti||0)*2.5).toFixed(1)}M</span>
            <span style={{ fontSize: 10, color: euroDisponibili > 0 ? "#818cf8" : "#555" }}>Residuo: {euroDisponibili}€</span>
          </div>
          <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>Reset biennio all'inizio della stagione 2027-28</div>
        </div>

        {/* Milioni extra attivi (solo visualizzazione, ritiro rimosso dal regolamento) */}
        {mlnOttenuti > 0 && (
          <div style={{ background: "#10b98110", border: "1px solid #10b98125", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#888" }}>Milioni extra attivi</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: "#10b981", fontFamily: "'Bebas Neue',sans-serif" }}>+{mlnOttenuti.toFixed(1)}M</span>
            </div>
          </div>
        )}

        {/* Investimento extra budget */}
        {finestraInvestimentoAperta && euroDisponibili > 0 && (
          <div style={{ background: "#6366f108", border: "1px solid #6366f120", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", marginBottom: 6 }}>💸 Investimento extra budget · entro 14/08 · 1€ = 2.5M</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {Array.from({ length: Math.min(euroDisponibili, 10) }, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => setEuroInput(euroInput === String(n) ? "" : String(n))}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${euroInput === String(n) ? "#818cf8" : "#ffffff15"}`, background: euroInput === String(n) ? "#6366f122" : "transparent", color: euroInput === String(n) ? "#818cf8" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {n}€
                </button>
              ))}
              {euroInput && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700 }}>→ +{(parseFloat(euroInput)*2.5).toFixed(1)}M</span>}
            </div>
            {isAdmin && euroInput && (
              <button onClick={handleInvesti} disabled={savingQuote}
                style={{ marginTop: 8, padding: "5px 12px", borderRadius: 7, border: "none", background: "#6366f122", color: "#818cf8", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                {savingQuote ? "..." : `✓ Investi ${euroInput}€ → +${(parseFloat(euroInput)*2.5).toFixed(1)}M`}
              </button>
            )}
          </div>
        )}
        {!finestraInvestimentoAperta && euroDisponibili > 0 && (
          <div style={{ fontSize: 10, color: "#444" }}>Investimento extra budget: finestra aperta entro 14/08 ogni stagione</div>
        )}
      </div>

      {/* ── 6. CONTRATTI IN SCADENZA (fine 2° anno — rinnovo biennale) ── */}
      {contrattiScadenza.length > 0 && (
        <div style={{ background: "#f59e0b08", border: "1.5px solid #f59e0b25", borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em" }}>📋 RINNOVO BIENNALE — CONFERMA ENTRO 31/05</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["ruolo","Ruolo"],["nome","Nome"],["quot","Q"]].map(([v,l]) => (
                <button key={v} onClick={() => setContrattiSort(v)}
                  style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${contrattiSort===v?"#f59e0b60":"#ffffff15"}`, background: contrattiSort===v?"#f59e0b18":"transparent", color: contrattiSort===v?"#f59e0b":"#555", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#666", marginBottom: 12 }}>
            Questi giocatori sono al <b style={{ color: "#aaa" }}>2° anno di contratto</b>. Devi decidere entro il 31/05 (art. 4.8):<br/>
            • <b style={{ color: "#10b981" }}>Conferma rinnovo</b> → il giocatore resta in rosa, stipendio +20%<br/>
            • <b style={{ color: "#ef4444" }}>Non confermare</b> → il giocatore viene svincolato automaticamente il 01/06
          </div>
          {[...contrattiScadenza].sort((a, b) => {
            if (contrattiSort === "nome") return (a.nome||"").localeCompare(b.nome||"");
            if (contrattiSort === "quot") return (b.quot||0) - (a.quot||0);
            // ruolo: sort by role category order
            const roleOrder = (r) => { const f=(r||"").split(";")[0].trim(); if(f==="Por")return 0; if(["Dc","Dd","Ds","B"].includes(f))return 1; if(["E","M","C"].includes(f))return 2; if(["T","W"].includes(f))return 3; return 4; };
            return roleOrder(a.ruolo) - roleOrder(b.ruolo) || (a.nome||"").localeCompare(b.nome||"");
          }).map(p => (
            <ContrattoRinnovoRow key={p.id} p={p} team={team} isAdmin={isAdmin} mySquadra={mySquadra} onToggle={handleToggleRinnovo} />
          ))}
        </div>
      )}

      {/* ── 7. AGGIORNAMENTO STIPENDI 01/01 (art. 4.5) ── */}
      <AggiornamentoStipendiSection team={team} rosaPlayers={rosaPlayers} isAdmin={isAdmin} onRefresh={onRefresh} />

      {/* ── 8. DA CEDERE ENTRO 15/09 (rinnovati al ribasso 22-30aa) ── */}
      {rosaPlayers.filter(p => p.da_cedere).length > 0 && (
        <div style={{ background: "#ef444408", border: "1.5px solid #ef444425", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", letterSpacing: "0.08em", marginBottom: 8 }}>🔴 DA CEDERE/SVINCOLARE ENTRO 15/09 (art. 4.5)</div>
          <div style={{ fontSize: 10, color: "#666", marginBottom: 10 }}>Giocatori 22-30aa rinnovati al ribasso — pena: 5M + svincolo ordinario forzato se non ceduti</div>
          {rosaPlayers.filter(p => p.da_cedere).map(p => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #ffffff08" }}>
              <div>
                <span style={{ fontSize: 12, color: "#f0f0f0", fontWeight: 600 }}>{p.nome}</span>
                <span style={{ fontSize: 10, color: "#888", marginLeft: 8 }}>{p.anni}aa · Q{p.quot} · {Number(p.stip).toFixed(2)}M</span>
              </div>
              <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>⛔ cedere entro 15/09</span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}



/* ─── CATALOGO INVESTIMENTI (art. 10) ──────────────────────────────────────── */
const CATALOGO_INVESTIMENTI = [
  // Piccoli (art. 10.2)
  { nome: "Scouting Estero",         categoria: "piccolo",   costo: 2,    desc: "Diritto esclusivo su 1 giocatore estero se arriva in Serie A entro 2 anni. Periodo 01/09–20/09.", richiedeNote: true, notePlaceholder: "Nome del giocatore estero selezionato:" },
  { nome: "Scommessa Rendimento",     categoria: "piccolo",   costo: 2,    desc: "Seleziona 2 giocatori della tua rosa: se uno migliora Q di ≥7, ottieni +2.5M per ognuno.", richiedeNote: true, notePlaceholder: "Nomi dei 2 giocatori puntati (es. Barella, Vlahovic):" },
  { nome: "Avvocato",                 categoria: "piccolo",   costo: 3,    desc: "Ogni 5 ammonizioni dei tuoi giocatori titolari o subentrati → +0.5M. Doppio giallo = 1 ammonizione." },
  { nome: "Vice Allenatore Premium",  categoria: "piccolo",   costo: 5,    desc: "3 volte/stagione puoi modificare un giocatore dopo il fischio d'inizio (il sostituto non deve aver giocato)." },
  { nome: "Ricapitalizzazione",       categoria: "piccolo",   costo: 5,    desc: "Abbassa il Fair Play Finanziario di 3M. Attivabile solo entro il 05/09." },
  // Medi (art. 10.3)
  { nome: "Settore Giovanile Avanzato", categoria: "medio",  costo: 6,    desc: "Alza il limite vivaio da 2 a 4 giocatori per l'anno seguente e il successivo." },
  { nome: "SuperClub",                categoria: "medio",    costo: 7,    desc: "+3M al tuo Salary Cap per la stagione." },
  { nome: "Accordi TV",               categoria: "medio",    costo: 8,    desc: "Ogni qualvolta segni almeno 2 gol in una partita → +0.5M extra." },
  { nome: "Clean Sheet",              categoria: "medio",    costo: 9,    desc: "+1.5M per ogni giornata in cui la squadra avversaria totalizza <66 punti fantacalcistici." },
  { nome: "The MVP",                  categoria: "medio",    costo: 9,    desc: "Ogni qualvolta un tuo giocatore titolare o subentrato prende l'MVP → +0.5M." },
  // Grandi (art. 10.4)
  { nome: "Ristrutturazione Stadio",  categoria: "grande",   costo: 10,   desc: "Dalla stagione successiva +1.5M/mese dallo stadio. Devono passare 3 anni tra investimenti." },
  { nome: "Branding Internazionale",  categoria: "grande",   costo: 10,   desc: "1°: +20M · 2°: +15M · 3°: +12M · 4°: +8M · Coppa: +5M · Finalista Coppa: +1M." },
  { nome: "DS Masterclass",           categoria: "grande",   costo: 12,   desc: "Aste svincolati: 2 volte/stagione conosci l'offerta più alta prima di formalizzare la tua." },
  { nome: "Centro Giovani U21",       categoria: "grande",   costo: 14,   desc: "1 giocatore U21 svincolato/stagione a ¼ Q. Scelta entro 15/08, in ordine di classifica precedente." },
  { nome: "Abbonamenti Premium",      categoria: "grande",   costo: 15,   desc: "Vittoria in casa: +1.5M (scarto ≥2 gol: +2M). Pareggio in casa: +1M. Valido 1 stagione." },
  // Invernali — 24/12–31/12, max 10M (art. 10.5)
  { nome: "Rientro in Grande",        categoria: "invernale", costo: 3,   desc: "1 infortunato: se nelle 5 giornate dal rientro prende voto ≥6 → +1.2M extra.", richiedeNote: true, notePlaceholder: "Nome del giocatore infortunato selezionato:" },
  { nome: "Deroga U-21",              categoria: "invernale", costo: 4,   desc: "Fino al 01/06: puoi avere 30 giocatori in rosa con solo 1 Under-21." },
  { nome: "Clausola Segreta",         categoria: "invernale", costo: 4,   desc: "Clausola rescissoria dei tuoi giocatori: da 1.75× a 2.0× la quotazione fino al 31/05." },
  { nome: "Re del Girone di Ritorno", categoria: "invernale", costo: 7,   desc: "Dalla 19ª giornata: se ottieni ≥10 punti in più rispetto alla prima metà → +10M a fine anno." },
  { nome: "Corso Analisi Video",      categoria: "invernale", costo: 10,  desc: "1 sostituzione extra rispetto alla formazione originaria. Non nelle ultime 5 giornate né in finale/semifinale Coppa. Usabile una volta." },
];

/* ─── ALLENATORE TAB ─────────────────────────────────────────────────────────── */
function AltroTab({ team, isAdmin }) {


  // ── BONUS TRATTATIVE ─────────────────────────────────────────────────────────
  const [bonusData, setBonusData] = useState([]);
  const [loadingBonus, setLoadingBonus] = useState(true);

  useEffect(() => {
    async function loadBonus() {
      const { data: tratt } = await supabase.from('trattative')
        .select('id,giocatore,da_squadra,a_squadra,stato')
        .or(`da_squadra.eq.${team.name},a_squadra.eq.${team.name}`)
        .in('stato',['completata','accettata','clausola_eseguita']);
      if (!tratt?.length) { setBonusData([]); setLoadingBonus(false); return; }
      const results = [];
      for (const tr of tratt) {
        const bonusList = await getBonusTrattativa(tr.id);
        if (!bonusList?.length) continue;
        const { data: lr } = await supabase.from('listone').select('*').ilike('nome',tr.giocatore).single().catch(()=>({data:null}));
        for (const b of bonusList) {
          const va = lr ? (()=>{
            switch(b.tipo_bonus){
              case 'partite_voto': return Number(lr.partite_voto||0);
              case 'gol_fatti': return Number(lr.gol_fatti||0);
              case 'assist': return Number(lr.assist||0);
              case 'bonus_tot': return Number(lr.gol_fatti||0)+Number(lr.assist||0);
              case 'ammonizioni': return Number(lr.ammonizioni||0);
              case 'espulsioni': return Number(lr.espulsioni||0);
              case 'gol_subiti': return Number(lr.gol_subiti||0);
              case 'malus_tot': return Number(lr.ammonizioni||0)+Number(lr.espulsioni||0)+Number(lr.gol_subiti||0);
              default: return 0;
            }
          })() : null;
          results.push({bonus:b,trattativa:tr,valoreAttuale:va});
        }
      }
      setBonusData(results); setLoadingBonus(false);
    }
    loadBonus();
  }, [team.name]);

  // ── ALLENATORE ───────────────────────────────────────────────────────────────
  const [coachPreview, setCoachPreview] = useState(null); // nome allenatore di cui mostrare obiettivi

  const OBIETTIVI_ALLENATORI = {
    "Guardiola": {
      moduli: "3-5-1-1 / 3-4-2-1",
      obiettivi: [
        "Ottieni ≥12 bonus dalla/e M titolare/i",
        "Vinci almeno ≥5 giornate con punteggio >80",
        "Per ≥20 giornate 5 giocatori blu e/o viola devono partire titolari",
      ],
      ds: ["Acquista ≥2 giocatori con clausola rescissoria"],
      dg: ["Acquista giocatori per una spesa totale ≥100M", "Mantieni un salary cap sempre ≥67M"],
    },
    "Klopp": {
      moduli: "4-3-3 / 3-4-3",
      obiettivi: [
        "Ottieni ≥3 bonus in una giornata dal tridente offensivo ≥5 volte",
        "Ottieni ≥19 bonus dalle A titolari",
        "Ottieni il record di giornata ≥5 volte (deve essere ≥78 per valere)",
      ],
      ds: ["Compra ≥4 giocatori che migliorino la quotazione di ≥5"],
      dg: ["Cedi giocatori per un totale di ≥100M", "Non spendere mai ≥25M di parte fissa in un singolo acquisto"],
    },
    "Luis Enrique": {
      moduli: "3-4-1-2 / 4-3-1-2",
      obiettivi: [
        "Ottieni ≥105 bonus schierati",
        "Completa ≥15 partite con ≥2 marcatori diversi",
        "Vinci contro tutti i presidenti almeno 1 volta, contro il rivale 2",
      ],
      ds: ["Mantieni una rosa di minimo 27 giocatori per ≥25 partite"],
      dg: ["Riduci ≥4 ingaggi a metà stagione", "Ogni ultimo del mese, non puoi avere >2 giocatori con stipendio ≥5M"],
    },
    "Conte": {
      moduli: "3-4-3 / 3-5-1-1",
      obiettivi: [
        "Completa ≥11 giornate con il bonus Fair Play attivo",
        "Ottieni ≥15 bonus dalle tue E e/o W schierate",
        "Vinci ≥7 giornate con scarto ≥10 punti",
      ],
      ds: ["Cedi, anche in prestito, ad altri presidenti ≥3 giocatori ≥31 anni"],
      dg: ["Concludi la trattativa più costosa in una sessione di mercato", "Spendi max 9M per un singolo investimento"],
    },
    "Capello": {
      moduli: "4-3-1-2 / 4-4-2",
      obiettivi: [
        "Mantieni ≥5 giornate con modificatore difesa ≥2 punti",
        "In ≥4 giornate le 2 Pc devono segnare entrambe",
        "Completa ≥22 giornate con massimo 1 gol subito",
      ],
      ds: ["Devono prendere voto ≥8 giocatori verdi diversi, 2 volte"],
      dg: ["Aumenta il valore totale rosa di ≥20M a fine anno (15/09→01/06)", "Non essere mai multato e non subire mai penalità"],
    },
    "Mourinho": {
      moduli: "4-2-3-1 / 4-4-1-1",
      obiettivi: [
        "≥1 giocatore verde e ≥1 rosso vanno a bonus nella stessa giornata ≥5 volte",
        "Ottieni ≥4 vittorie consecutive",
        "Mantieni un blocco difensivo stabile di 3 giocatori verdi per ≥15 giornate",
      ],
      ds: ["Fai fare ≥40 presenze ai tuoi over 33 in rosa"],
      dg: ["Arriva almeno in finale di Coppa e/o sul podio a fine anno", "Mantieni il FPF sotto 25M ai check di ottobre e febbraio"],
    },
    "Allegri": {
      moduli: "3-5-2 / 3-4-1-2",
      obiettivi: [
        "Chiudi ≥10 giornate con punteggio tra 66 e 70",
        "Vinci ≥2 giornate con scarto ≤2 punti",
        "La somma dei punti totali dei tuoi capitani a fine stagione deve essere ≥12",
      ],
      ds: ["Mantieni una rosa di massimo 26 giocatori per ≥25 partite"],
      dg: ["Acquista ≥2 giocatori per un valore (fisso+bonus) di ≥30M l'uno", "Ottieni ≥75M dai guadagni di giornata"],
    },
    "Lippi": {
      moduli: "4-4-1-1 / 4-1-4-1",
      obiettivi: [
        "Ottieni ≥18 clean sheet schierati",
        "Le tue W e A schierate fanno ≥24 bonus",
        "Completa ≥12 giornate con 11 voti pieni, non subentrati",
      ],
      ds: ["Fai fare ≥50 presenze ai tuoi Under-21 in rosa"],
      dg: ["Rimani con ≥15M di liquidità a fine mercato invernale", "I tuoi investimenti devono aver fruttato il 150% della spesa iniziale"],
    },
    "Sir Ferguson": {
      moduli: "4-4-2 / 3-5-2",
      obiettivi: [
        "Nella stessa partita una Pc segna e una Pc fa assist, ≥1 volta",
        "Le tue Pc schierate devono realizzare un totale di ≥20 gol",
        "In ≥4 giornate ≥3 giocatori blu e/o viola devono andare a voto con 6.5+",
      ],
      ds: ["Promuovi ≥1 giocatore dal vivaio e cedi/svincola ≥1 giocatore del vivaio"],
      dg: ["Non pagare ≥2 svincoli ordinari in stagione", "Acquista ≥2 giocatori Under-21 per un valore di ≥25M totali"],
    },
    "Ancelotti": {
      moduli: "3-4-2-1 / 4-3-3",
      obiettivi: [
        "Segna in ≥15 giornate con giocatori di ≥2 colori diversi",
        "Segna con ≥3 colori nella stessa giornata, ≥2 volte",
        "Completa ≥15 giornate con punteggio ≥75",
      ],
      ds: ["Mantieni ≥2 italiani per reparto Verde/Blu/Viola e ≥1 nei Gialli/Rossi; ≥100 presenze totali"],
      dg: ["Chiudi la stagione con saldo positivo ≥20M", "Ogni ultimo del mese, il valore di ogni colore deve essere ≤30% del totale rosa"],
    },
    "Sacchi": {
      moduli: "4-1-4-1 / 4-2-3-1",
      obiettivi: [
        "I tuoi giocatori verdi devono prendere voto 7+ in ≥13 giornate",
        "Le tue T e W schierate fanno ≥20 bonus",
        "Nei tuoi incontri deve realizzarsi l'over 3.5 in ≥16 match",
      ],
      ds: ["Acquista ≥3 giocatori stranieri con quotazione ≤8, devono fare ≥25 presenze totali"],
      dg: ["Compra ≥3 giocatori e rivendili a cifra più alta dell'acquisto", "Mantieni sempre ≥7M di liquidità"],
    },
  };

  const [allenatore, setAllenatore] = useState(null);
  const [obiettivi, setObiettivi] = useState([]);
  const [progresso, setProgresso] = useState([]);
  const [tuttiAllenatori, setTuttiAllenatori] = useState([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");

  const loadAll = useCallback(async () => {
    const [all, tutti] = await Promise.all([getAllenatoreBySquadra(team.name, STAGIONE_CORRENTE), getAllenatori(STAGIONE_CORRENTE)]);
    setAllenatore(all); setTuttiAllenatori(tutti);
    if (all) {
      const [obs, prog] = await Promise.all([getObiettiviCarta(all.nome, STAGIONE_CORRENTE), getProgressoObiettivi(team.name, STAGIONE_CORRENTE)]);
      setObiettivi(obs); setProgresso(prog);
    }
    setLoadingAll(false);
  }, [team.name]);
  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleScegli(nome) {
    if (!window.confirm(`Scegli ${nome}? Costo: 5M`)) return;
    setSavingAll(true);
    try { const {data:sq}=await supabase.from('squadre').select('bilancio').eq('name',team.name).single(); await scegliAllenatore(team.name,nome,sq?.bilancio||0); await loadAll(); }
    catch(e){alert(e.message);} finally{setSavingAll(false);}
  }

  async function handleRimuoviAllenatore(conRimborso = false) {
    if (!allenatore) return;
    const msg = conRimborso
      ? `Rimuovere "${allenatore.nome}" e rimborsare 5M a ${team.name}?`
      : `Rimuovere "${allenatore.nome}" da ${team.name} senza rimborso?

Gli obiettivi verranno azzerati.`;
    if (!window.confirm(msg)) return;
    setSavingAll(true);
    try {
      await rimuoviAllenatore(team.name, allenatore.nome, conRimborso ? 5 : 0);
      cacheInvalidate('investimenti_' + team.name);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSavingAll(false); }
  }
  async function handleToggleC(ob,pg) { setSavingAll(true); try{await upsertProgresso(team.name,ob.id,{completato:!pg?.completato,fallito:false},STAGIONE_CORRENTE);await loadAll();}catch(e){alert(e.message);}finally{setSavingAll(false);} }
  async function handleToggleF(ob,pg) { setSavingAll(true); try{await upsertProgresso(team.name,ob.id,{fallito:!pg?.fallito,completato:false},STAGIONE_CORRENTE);await loadAll();}catch(e){alert(e.message);}finally{setSavingAll(false);} }
  async function salvaProgrObj(obId) { await upsertProgresso(team.name,obId,{valore_attuale:parseFloat(editVal)||0},STAGIONE_CORRENTE); setEditId(null); await loadAll(); }

  const tipoInfo = {
    allenatore:{label:"🎯 Obiettivi Allenatore",color:"#6366f1",guadagno:3,desc:"3M a completamento"},
    ds:{label:"🏃 Direttore Sportivo",color:"#10b981",guadagno:5,desc:"5M · −2M se fallito"},
    dg:{label:"💼 Direttore Generale",color:"#f59e0b",guadagno:5,desc:"5M al 31/05 · −2M se fallito"},
  };
  const guadTot = obiettivi.reduce((s,o)=>s+(o.guadagno||0),0);
  const guadReal = obiettivi.reduce((s,o)=>{const p=progresso.find(pr=>pr.obiettivo_id===o.id);return s+(p?.completato?(o.guadagno||0):p?.fallito?-(o.penalita||0):0);},0);

  // ── INVESTIMENTI ─────────────────────────────────────────────────────────────
  const [investimenti, setInvestimenti] = useState([]);
  const [loadingInv, setLoadingInv] = useState(true);
  const [savingInv, setSavingInv] = useState(false);
  const [editGuad, setEditGuad] = useState(null);
  const [catFilter, setCatFilter] = useState("tutti");
  const [showCatalogo, setShowCatalogo] = useState(false);

  const loadInv = useCallback(async () => {
    const inv = await cachedFetch('investimenti_' + team.name, () => getInvestimenti(team.name), 60000);
    setInvestimenti(inv||[]); setLoadingInv(false);
  }, [team.name]);
  useEffect(() => { loadInv(); }, [loadInv]);

  async function handleAcquista(item) {
    if (!window.confirm(`Acquistare "${item.nome}" per ${item.costo}M?\n\n${item.desc}`)) return;
    let note = '';
    if (item.richiedeNote) {
      const risposta = window.prompt(item.notePlaceholder);
      if (risposta === null) return;
      note = risposta.trim();
    }
    setSavingInv(true);
    try{cacheInvalidate('investimenti_'+team.name);await acquistaInvestimento({squadra:team.name,nome:item.nome,categoria:item.categoria,costo:item.costo,note});await loadInv();}
    catch(e){alert(e.message);}finally{setSavingInv(false);}
  }
  async function handleGuadagno(invId) {
    const importo=parseFloat(editGuad?.val); if(!importo||importo<=0)return;
    setSavingInv(true);
    try{await registraGuadagnoInvestimento(invId,importo,team.name);setEditGuad(null);await loadInv();}
    catch(e){alert(e.message);}finally{setSavingInv(false);}
  }

  async function handleEliminaInv(inv) {
    const scelta = window.confirm(
      `Eliminare l'investimento "${inv.nome}" di ${team.name}?

` +
      `OK = elimina senza rimborso
Per rimborsare clicca Annulla e usa "Rimborsa" dal bilancio`
    );
    if (!scelta) return;
    const conRimborso = window.confirm(`Rimborsare ${inv.costo}M a ${team.name}?`);
    setSavingInv(true);
    try {
      if (conRimborso) {
        const {data:sq} = await supabase.from('squadre').select('bilancio').eq('name',team.name).single();
        const nuovoBil = parseFloat(((sq?.bilancio||0) + inv.costo).toFixed(2));
        await supabase.from('squadre').update({bilancio:nuovoBil}).eq('name',team.name);
        await supabase.from('movimenti').insert({
          squadra: team.name,
          descrizione: `Rimborso investimento: ${inv.nome}`,
          entrata: inv.costo,
          data: new Date().toISOString().slice(0,10),
        });
      }
      await deleteInvestimento(inv.id);
      cacheInvalidate('investimenti_' + team.name);
      await loadInv();
    } catch(e) { alert(e.message); }
    finally { setSavingInv(false); }
  }

  const totInv = investimenti.reduce((s,i)=>s+Number(i.costo),0);
  const totGuad = investimenti.reduce((s,i)=>s+Number(i.valore_accumulato||0),0);
  const invAttivi = investimenti.filter(i=>i.attivo);
  const nomiAttivi = new Set(invAttivi.map(i=>i.nome));
  const invFiltrati = catFilter==="tutti" ? CATALOGO_INVESTIMENTI : CATALOGO_INVESTIMENTI.filter(i=>i.categoria===catFilter);
  const cats = ["tutti","piccolo","medio","grande","invernale"];
  const ccol = { piccolo:"#10b981",medio:"#6366f1",grande:"#f59e0b",invernale:"#06b6d4" };

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>

      {/* ══ 1. BONUS TRATTATIVE ══ */}
      <div>
        <div style={{ fontSize:11,fontWeight:700,color:"#818cf8",letterSpacing:"0.1em",marginBottom:12 }}>📊 BONUS TRATTATIVE</div>
        {loadingBonus?<div style={{ fontSize:12,color:"#555" }}>Caricamento...</div>
        :bonusData.length===0?<div style={{ fontSize:12,color:"#555",fontStyle:"italic",background:"#ffffff06",border:"1px solid #ffffff10",borderRadius:10,padding:"14px" }}>Nessun bonus attivo nelle trattative.</div>
        :<div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {bonusData.map(({bonus,trattativa,valoreAttuale},i)=>{
            const soglia=Number(bonus.soglia),val=valoreAttuale??0;
            const pct=soglia>0?Math.min(100,Math.round((val/soglia)*100)):0;
            const completato=bonus.completato||val>=soglia;
            const ioPago=(bonus.direzione==='acquirente_paga'&&trattativa.a_squadra===team.name)||(bonus.direzione==='cedente_paga'&&trattativa.da_squadra===team.name);
            return (
              <div key={bonus.id} style={{ background:completato?"#10b98110":"#ffffff08",border:`1.5px solid ${completato?"#10b98130":"#ffffff12"}`,borderRadius:12,padding:"12px 14px" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8,flexWrap:"wrap" }}>
                  <div>
                    <div style={{ fontSize:13,fontWeight:700,color:completato?"#10b981":"#e0e0e0" }}>
                      {completato&&"✅ "}{trattativa.giocatore}
                      <span style={{ fontSize:10,color:"#555",fontWeight:400,marginLeft:6 }}>({trattativa.da_squadra} → {trattativa.a_squadra})</span>
                    </div>
                    <div style={{ fontSize:11,color:"#888",marginTop:2 }}>{getLabelBonus(bonus.tipo_bonus)} ≥ {soglia} · {ioPago?"⬆️ Tu paghi":"⬇️ Tu ricevi"}</div>
                  </div>
                  <div style={{ textAlign:"right",flexShrink:0 }}>
                    <div style={{ fontSize:16,fontWeight:900,color:ioPago?"#ef4444":"#10b981",fontFamily:"'Bebas Neue',sans-serif" }}>{ioPago?"-":"+"}{Number(bonus.valore_mln).toFixed(1)}M</div>
                    {valoreAttuale!==null&&<div style={{ fontSize:10,color:"#555" }}>{val}/{soglia}</div>}
                  </div>
                </div>
                {valoreAttuale!==null&&!completato&&(
                  <div>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                      <span style={{ fontSize:9,color:"#555" }}>Progressione</span>
                      <span style={{ fontSize:9,color:pct>=80?"#10b981":pct>=50?"#f59e0b":"#555",fontWeight:700 }}>{pct}%</span>
                    </div>
                    <StatBar value={val} max={soglia} color={pct>=80?"#10b981":pct>=50?"#f59e0b":"#6366f1"} height={5}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>}
      </div>

      {/* ══ 2. ALLENATORE ══ */}
      <div>
        <div style={{ fontSize:11,fontWeight:700,color:"#a855f7",letterSpacing:"0.1em",marginBottom:12 }}>🎩 ALLENATORE · {STAGIONE_CORRENTE}</div>
        {loadingAll?<div style={{ fontSize:12,color:"#555" }}>Caricamento...</div>
        :allenatore?(
          <>
            <div style={{ background:"linear-gradient(135deg,#6366f118,#a855f718)",border:"1.5px solid #6366f133",borderRadius:14,padding:16,marginBottom:12 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8 }}>
                <div style={{ cursor:"pointer" }} onClick={()=>setCoachPreview(allenatore.nome)}>
                  <div style={{ fontSize:18,fontWeight:900,color:"#f0f0f0",fontFamily:"'Bebas Neue',sans-serif" }}>{allenatore.nome} <span style={{ fontSize:11,color:"#6366f1" }}>📋</span></div>
                  <div style={{ fontSize:11,color:"#888" }}>Moduli: <span style={{ color:"#818cf8",fontWeight:700 }}>{allenatore.modulo1}</span> · <span style={{ color:"#818cf8",fontWeight:700 }}>{allenatore.modulo2}</span></div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:9,color:"#555" }}>POTENZIALE</div>
                  <div style={{ fontSize:16,fontWeight:900,color:"#10b981",fontFamily:"'Bebas Neue',sans-serif" }}>+{guadTot}M</div>
                  <div style={{ fontSize:11,fontWeight:700,color:guadReal>=0?"#10b981":"#ef4444" }}>{guadReal>=0?"+":""}{guadReal}M realizzato</div>
                </div>
              </div>
              <div style={{ marginTop:10 }}><StatBar value={Math.max(0,guadReal)} max={guadTot} color="#10b981" height={5}/></div>
            {isAdmin && (
              <div style={{ display:"flex",gap:8,marginTop:12,paddingTop:12,borderTop:"1px solid #ffffff10",flexWrap:"wrap" }}>
                <button onClick={()=>handleRimuoviAllenatore(false)} disabled={savingAll}
                  style={{ flex:1,minWidth:120,padding:"7px 10px",borderRadius:8,border:"1px solid #ef444430",background:"#ef444410",color:"#ef4444",fontSize:11,fontWeight:700,cursor:"pointer" }}>
                  🗑 Rimuovi
                </button>
                <button onClick={()=>handleRimuoviAllenatore(true)} disabled={savingAll}
                  style={{ flex:1,minWidth:140,padding:"7px 10px",borderRadius:8,border:"1px solid #10b98130",background:"#10b98110",color:"#10b981",fontSize:11,fontWeight:700,cursor:"pointer" }}>
                  ↩ Rimuovi + rimborso 5M
                </button>
              </div>
            )}
            </div>
            {["allenatore","ds","dg"].map(tipo=>{
              const items=obiettivi.filter(o=>o.tipo===tipo), info=tipoInfo[tipo];
              return (
                <div key={tipo} style={{ background:"#ffffff06",border:"1.5px solid #ffffff12",borderRadius:12,padding:14,marginBottom:8 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                    <div style={{ fontSize:10,fontWeight:700,color:info.color,letterSpacing:"0.08em" }}>{info.label}</div>
                    <Badge color={info.color}>+{info.guadagno}M cad.</Badge>
                  </div>
                  {items.map(ob=>{
                    const pg=progresso.find(p=>p.obiettivo_id===ob.id);
                    const comp=pg?.completato||false, fall=pg?.fallito||false;
                    return (
                      <div key={ob.id} style={{ background:comp?"#10b98110":fall?"#ef444410":"#ffffff08",border:`1px solid ${comp?"#10b98130":fall?"#ef444430":"#ffffff10"}`,borderRadius:9,padding:"10px 12px",marginBottom:6 }}>
                        <div style={{ display:"flex",gap:8,alignItems:"flex-start" }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:12,color:comp?"#10b981":fall?"#ef4444":"#ddd",fontWeight:600,lineHeight:1.4 }}>{comp?"✅ ":fall?"❌ ":""}{ob.testo}</div>
                            <div style={{ display:"flex",gap:8,alignItems:"center",marginTop:6,flexWrap:"wrap" }}>
                              {editId===ob.id?(
                                <div style={{ display:"flex",gap:4 }}>
                                  <input style={{ padding:"2px 6px",borderRadius:5,border:"1px solid #ffffff18",background:"#0d0f14",color:"#f0f0f0",fontSize:11,width:60 }} type="number" value={editVal} onChange={e=>setEditVal(e.target.value)}/>
                                  <button onClick={()=>salvaProgrObj(ob.id)} style={{ padding:"2px 8px",borderRadius:5,border:"none",background:"#10b98122",color:"#10b981",fontSize:10,cursor:"pointer" }}>✓</button>
                                  <button onClick={()=>setEditId(null)} style={{ padding:"2px 6px",borderRadius:5,border:"none",background:"#ffffff10",color:"#888",fontSize:10,cursor:"pointer" }}>✕</button>
                                </div>
                              ):(
                                <button onClick={()=>{setEditId(ob.id);setEditVal(pg?.valore_attuale||0);}} style={{ padding:"2px 8px",borderRadius:5,border:"1px solid #ffffff15",background:"transparent",color:"#666",fontSize:10,cursor:"pointer" }}>
                                  📊 {pg?.valore_attuale||0}{ob.soglia?`/${ob.soglia}`:""}
                                </button>
                              )}
                              {ob.soglia>0&&!comp&&<div style={{ flex:1,minWidth:60 }}><StatBar value={pg?.valore_attuale||0} max={ob.soglia} color={info.color} height={4}/></div>}
                              <Badge color={info.color}>+{ob.guadagno}M</Badge>
                              {ob.penalita>0&&<Badge color="#ef4444">−{ob.penalita}M</Badge>}
                            </div>
                          </div>
                          {isAdmin&&(
                            <div style={{ display:"flex",gap:4,flexShrink:0 }}>
                              <button onClick={()=>handleToggleC(ob,pg)} disabled={savingAll} style={{ padding:"4px 8px",borderRadius:6,border:"none",background:comp?"#10b98130":"#10b98115",color:"#10b981",fontSize:10,cursor:"pointer" }}>✓</button>
                              {ob.penalita>0&&<button onClick={()=>handleToggleF(ob,pg)} disabled={savingAll} style={{ padding:"4px 8px",borderRadius:6,border:"none",background:fall?"#ef444430":"#ef444415",color:"#ef4444",fontSize:10,cursor:"pointer" }}>✕</button>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        ):(
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            <div style={{ fontSize:11,color:"#888" }}>Nessun allenatore scelto per {STAGIONE_CORRENTE}.{isAdmin&&<span style={{ color:"#6366f1" }}> Scegli una carta (5M).</span>}</div>
            {/* Coach preview modal */}
            {coachPreview && (() => {
              const info = OBIETTIVI_ALLENATORI[coachPreview];
              const coachAll = tuttiAllenatori.find(a => a.nome === coachPreview);
              const disp = coachAll && !coachAll.squadra;
              return (
                <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}
                  onClick={()=>setCoachPreview(null)}>
                  <div style={{ background:"#1a1d26",border:"1.5px solid #6366f133",borderRadius:18,padding:20,maxWidth:420,width:"100%",maxHeight:"85vh",overflowY:"auto" }}
                    onClick={e=>e.stopPropagation()}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14 }}>
                      <div>
                        <div style={{ fontSize:22,fontWeight:900,color:"#f0f0f0",fontFamily:"'Bebas Neue',sans-serif" }}>{coachPreview}</div>
                        <div style={{ fontSize:11,color:"#818cf8",fontWeight:700 }}>{info?.moduli}</div>
                        {coachAll?.squadra && <div style={{ fontSize:10,color:"#f97316",marginTop:2 }}>Scelto da: {coachAll.squadra}</div>}
                      </div>
                      <button onClick={()=>setCoachPreview(null)} style={{ background:"none",border:"none",color:"#555",fontSize:18,cursor:"pointer",padding:4 }}>✕</button>
                    </div>
                    {info ? (
                      <>
                        <div style={{ marginBottom:12 }}>
                          <div style={{ fontSize:10,fontWeight:700,color:"#6366f1",letterSpacing:"0.08em",marginBottom:6 }}>🎯 OBIETTIVI ALLENATORE — +2M cad.</div>
                          {info.obiettivi.map((o,i)=>(
                            <div key={i} style={{ background:"#6366f110",border:"1px solid #6366f125",borderRadius:8,padding:"8px 12px",marginBottom:5,fontSize:12,color:"#c7d2fe",lineHeight:1.4 }}>{o}</div>
                          ))}
                        </div>
                        <div style={{ marginBottom:12 }}>
                          <div style={{ fontSize:10,fontWeight:700,color:"#10b981",letterSpacing:"0.08em",marginBottom:6 }}>🏃 DS — +5M · −2M se fallito</div>
                          {info.ds.map((o,i)=>(
                            <div key={i} style={{ background:"#10b98110",border:"1px solid #10b98125",borderRadius:8,padding:"8px 12px",marginBottom:5,fontSize:12,color:"#6ee7b7",lineHeight:1.4 }}>{o}</div>
                          ))}
                        </div>
                        <div style={{ marginBottom:16 }}>
                          <div style={{ fontSize:10,fontWeight:700,color:"#f59e0b",letterSpacing:"0.08em",marginBottom:6 }}>💼 DG — +5M al 31/05 · −2M se fallito</div>
                          {info.dg.map((o,i)=>(
                            <div key={i} style={{ background:"#f59e0b10",border:"1px solid #f59e0b25",borderRadius:8,padding:"8px 12px",marginBottom:5,fontSize:12,color:"#fcd34d",lineHeight:1.4 }}>{o}</div>
                          ))}
                        </div>
                        <div style={{ fontSize:10,color:"#555",marginBottom:14 }}>I moduli devono essere schierati complessivamente per ≥27 partite.</div>
                      </>
                    ) : (
                      <div style={{ color:"#555",fontSize:12 }}>Obiettivi non disponibili.</div>
                    )}
                    {isAdmin && disp && (
                      <button onClick={()=>{ setCoachPreview(null); handleScegli(coachPreview); }} disabled={savingAll}
                        style={{ width:"100%",padding:"10px",borderRadius:10,border:"1.5px solid #6366f150",background:"#6366f120",color:"#818cf8",fontSize:13,fontWeight:800,cursor:"pointer" }}>
                        Scegli {coachPreview} — 5M
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {tuttiAllenatori.map(all=>{
              const disp=!all.squadra;
              return (
                <div key={all.nome} onClick={()=>setCoachPreview(all.nome)}
                  style={{ background:disp?"#ffffff08":"#ffffff04",border:`1px solid ${disp?"#ffffff15":"#ffffff08"}`,borderRadius:10,padding:12,opacity:disp?1:0.5,cursor:"pointer" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:13,fontWeight:800,color:disp?"#f0f0f0":"#555" }}>{all.nome}</div>
                      <div style={{ fontSize:10,color:"#666" }}>{all.modulo1} · {all.modulo2}</div>
                      {all.squadra&&<div style={{ fontSize:9,color:"#ef4444" }}>Scelto da: {all.squadra}</div>}
                    </div>
                    <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                      <span style={{ fontSize:10,color:"#555" }}>📋 Dettagli</span>
                      {isAdmin&&disp&&<button onClick={e=>{e.stopPropagation();handleScegli(all.nome);}} disabled={savingAll} style={{ padding:"5px 12px",borderRadius:7,border:"none",background:"#6366f122",color:"#818cf8",fontSize:11,fontWeight:700,cursor:"pointer" }}>Scegli −5M</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ══ 3. INVESTIMENTI ══ */}
      <div>
        <div style={{ fontSize:11,fontWeight:700,color:"#f59e0b",letterSpacing:"0.1em",marginBottom:12 }}>💼 INVESTIMENTI</div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12 }}>
          {[{label:"USATO",value:`${totInv.toFixed(1)}M`,sub:"/ 30M",color:totInv>30?"#ef4444":"#f59e0b"},{label:"LIBERO",value:`${(30-totInv).toFixed(1)}M`,sub:"",color:(30-totInv)<5?"#ef4444":"#10b981"},{label:"GUADAGNI",value:`+${totGuad.toFixed(1)}M`,sub:"",color:"#10b981"}].map(s=>(
            <div key={s.label} style={{ background:"#ffffff08",borderRadius:10,padding:"10px 12px",textAlign:"center" }}>
              <div style={{ fontSize:8,color:"#555",letterSpacing:"0.06em",marginBottom:3 }}>{s.label}</div>
              <div style={{ fontSize:16,fontWeight:900,color:s.color,fontFamily:"'Bebas Neue',sans-serif" }}>{s.value}</div>
              {s.sub&&<div style={{ fontSize:9,color:"#444" }}>{s.sub}</div>}
            </div>
          ))}
        </div>
        <StatBar value={totInv} max={30} color={totInv>30?"#ef4444":"#f59e0b"} height={5}/>
        {invAttivi.length>0&&(
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:10,fontWeight:700,color:"#888",marginBottom:8 }}>✅ ATTIVI</div>
            {invAttivi.map(inv=>(
              <div key={inv.id} style={{ display:"flex",gap:10,alignItems:"center",padding:"8px 0",borderBottom:"1px solid #ffffff08",flexWrap:"wrap" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12,fontWeight:700,color:"#e0e0e0" }}>{inv.nome}</div>
                  <div style={{ fontSize:9,color:"#555" }}><span style={{ color:ccol[inv.categoria]||"#888" }}>{inv.categoria}</span> · {inv.data_acquisto}</div>
                  {inv.note&&<div style={{ fontSize:10,color:"#818cf8",marginTop:2 }}>📝 {inv.note}</div>}
                </div>
                <Badge color="#ef4444">−{inv.costo}M</Badge>
                {inv.valore_accumulato>0&&<Badge color="#10b981">+{Number(inv.valore_accumulato).toFixed(1)}M</Badge>}
                {isAdmin&&(editGuad?.id===inv.id?(
                  <div style={{ display:"flex",gap:4 }}>
                    <input style={{ padding:"3px 6px",borderRadius:5,border:"1px solid #ffffff18",background:"#0d0f14",color:"#f0f0f0",fontSize:11,width:56 }} type="number" step="0.1" value={editGuad.val} onChange={e=>setEditGuad(g=>({...g,val:e.target.value}))}/>
                    <button onClick={()=>handleGuadagno(inv.id)} style={{ padding:"3px 8px",borderRadius:5,border:"none",background:"#10b98122",color:"#10b981",fontSize:10,cursor:"pointer" }}>+M</button>
                    <button onClick={()=>setEditGuad(null)} style={{ padding:"3px 6px",borderRadius:5,border:"none",background:"#ffffff10",color:"#888",fontSize:10,cursor:"pointer" }}>✕</button>
                  </div>
                ):(
                  <div style={{ display:"flex",gap:4 }}>
                    <button onClick={()=>setEditGuad({id:inv.id,val:""})} style={{ padding:"3px 8px",borderRadius:5,border:"1px solid #ffffff15",background:"transparent",color:"#666",fontSize:10,cursor:"pointer" }}>+M</button>
                    <button onClick={()=>handleEliminaInv(inv)} style={{ padding:"3px 8px",borderRadius:5,border:"1px solid #ef444430",background:"#ef444410",color:"#ef4444",fontSize:10,cursor:"pointer" }}>🗑</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {isAdmin&&(
          <div style={{ marginTop:12 }}>
            <button onClick={()=>setShowCatalogo(v=>!v)} style={{ padding:"7px 16px",borderRadius:8,border:"none",background:showCatalogo?"#ffffff12":"linear-gradient(135deg,#6366f1,#a855f7)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:showCatalogo?10:0 }}>
              {showCatalogo?"✕ Chiudi catalogo":"+ Acquista investimento"}
            </button>
            {showCatalogo&&(
              <>
                <div style={{ display:"flex",gap:4,marginBottom:10,flexWrap:"wrap" }}>
                  {cats.map(cat=><button key={cat} onClick={()=>setCatFilter(cat)} style={{ padding:"4px 10px",borderRadius:7,border:"none",background:catFilter===cat?"#6366f133":"#ffffff0a",color:catFilter===cat?"#818cf8":"#666",fontSize:11,fontWeight:700,cursor:"pointer" }}>{cat}</button>)}
                </div>
                {invFiltrati.map(item=>{
                  const già=nomiAttivi.has(item.nome);
                  return (
                    <div key={item.nome} style={{ background:già?"#10b98110":"#ffffff08",border:`1px solid ${già?"#10b98130":"#ffffff12"}`,borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:5 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12,fontWeight:700,color:già?"#10b981":"#e0e0e0" }}>{già?"✓ ":""}{item.nome}</div>
                        <div style={{ fontSize:10,color:"#555",marginTop:2 }}>{item.desc}</div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                        <Badge color={ccol[item.categoria]||"#888"}>−{item.costo}M</Badge>
                        {!già&&<button onClick={()=>handleAcquista(item)} disabled={savingInv||totInv+item.costo>30} style={{ padding:"4px 10px",borderRadius:7,border:"none",background:"#6366f122",color:"#818cf8",fontSize:10,fontWeight:700,cursor:"pointer" }}>Acquista</button>}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}


/* ─── VIVAIO TAB ─────────────────────────────────────────────────────────────── */
function VivaiTab({ team, isAdmin }) {
  const [vivaio, setVivaio] = useState([]);
  const [rosaCount, setRosaCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editPresenze, setEditPresenze] = useState(null); // { id, val }

  const loadAll = useCallback(async () => {
    const [v, r] = await Promise.all([
      getVivaio(team.name),
      getRosa(team.name),
    ]);
    setVivaio(v || []);
    setRosaCount((r || []).filter(p => !p.in_vivaio).length);
    setLoading(false);
  }, [team.name]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Verifica se un giocatore deve essere promosso/svincolato (art. 3.6.1)
  function needsAction(p) {
    const presenze = p.vivaio_presenze || 0;
    const quotOrig = p.quot || 0;
    // 2+ presenze a voto OR salito di 2+ quotazione rispetto all'ingresso
    // (non abbiamo traccia della quot d'ingresso, usiamo la quot attuale come proxy)
    return presenze >= 2;
  }

  async function handlePromuovi(p) {
    if (rosaCount >= 30) {
      alert(`Rosa piena (${rosaCount}/30) — libera uno slot prima di promuovere ${p.nome}`);
      return;
    }
    if (!window.confirm(`Promuovere ${p.nome} dalla vivaio alla rosa?\n\nIl suo stipendio diventerà ${(p.quot/5).toFixed(2)}M (Q${p.quot}/5) e verrà conteggiato nel salary cap.`)) return;
    setSaving(true);
    try {
      await promuoviDaVivaio(p.id, team.name);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleSvincola(p) {
    if (!window.confirm(`Svincolare ${p.nome} dal vivaio?\n\nCosto: 0M (art. 3.6.1 — svincolo vivaio gratuito)`)) return;
    setSaving(true);
    try {
      await svincolaVivaio(p.id, team.name);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function salvaPresenze(p) {
    const nuove = Math.max(0, parseInt(editPresenze.val, 10) || 0);
    if (isNaN(parseInt(editPresenze.val, 10))) { alert('Inserisci un numero valido.'); return; }
    await aggiornaPresenzeVivaio(p.id, nuove);
    setEditPresenze(null);
    await loadAll();
  }

  async function handlePagaVivaio() {
    if (team.vivaio_pagato) { alert("Costo vivaio già pagato per questa stagione."); return; }
    if (!window.confirm("Pagare il costo vivaio annuale di 4M?")) return;
    setSaving(true);
    try {
      const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', team.name).single();
      await pagaCostoVivaio(team.name, sq?.bilancio || 0);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  // Conta slot disponibili
  const maxVivaio = 2; // diventa 4 con Settore Giovanile Avanzato
  const slotsLiberi = maxVivaio - vivaio.length;
  const alertPromozione = vivaio.filter(needsAction);

  if (loading) return <div style={{ fontSize: 12, color: "#555", padding: 20 }}>Caricamento...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Header info ── */}
      <div style={{ background: "#10b98108", border: "1.5px solid #10b98125", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", letterSpacing: "0.08em" }}>🌱 VIVAIO</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Fino a {maxVivaio} giocatori · Under-23 · Q ≤ 3 · 0 presenze a voto</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>I giocatori vivaio non gravano su salary cap né contano nel totale rosa</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Stato slot */}
            <div style={{ textAlign: "center", background: "#ffffff08", borderRadius: 8, padding: "6px 12px" }}>
              <div style={{ fontSize: 9, color: "#555" }}>SLOT</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: slotsLiberi > 0 ? "#10b981" : "#ef4444", fontFamily: "'Bebas Neue',sans-serif" }}>
                {vivaio.length}/{maxVivaio}
              </div>
            </div>
          </div>
        </div>

        {/* Stato pagamento 4M */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 10, background: team.vivaio_pagato ? "#10b98110" : "#f59e0b10", border: `1px solid ${team.vivaio_pagato ? "#10b98130" : "#f59e0b30"}` }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: team.vivaio_pagato ? "#10b981" : "#f59e0b" }}>
              {team.vivaio_pagato ? "✓ Costo vivaio pagato" : "⏳ Costo vivaio da pagare"}
            </div>
            <div style={{ fontSize: 9, color: "#555" }}>4M annuali · obbligatorio per tutti entro 15/08 (anche senza vivaio attivo)</div>
          </div>
          {isAdmin && !team.vivaio_pagato && (
            <button onClick={handlePagaVivaio} disabled={saving}
              style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#f59e0b18", color: "#f59e0b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Paga −4M
            </button>
          )}
        </div>
      </div>

      {/* ── Alert promozione obbligatoria ── */}
      {alertPromozione.length > 0 && (
        <div style={{ background: "#ef444412", border: "1.5px solid #ef444433", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 8 }}>⚠️ AZIONE RICHIESTA (art. 3.6.1)</div>
          {alertPromozione.map(p => (
            <div key={p.id} style={{ fontSize: 12, color: "#fca5a5", marginBottom: 4 }}>
              <b>{p.nome}</b> ha {p.vivaio_presenze} presenze a voto — promuovi in rosa o svincola entro 2 giorni (pena 2M)
            </div>
          ))}
        </div>
      )}

      {/* ── Giocatori in vivaio ── */}
      {vivaio.length === 0 ? (
        <div style={{ background: "#ffffff06", border: "1px solid #ffffff10", borderRadius: 12, padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🌱</div>
          <div style={{ fontSize: 13, color: "#555" }}>Nessun giocatore in vivaio</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Acquista svincolati under-23 con Q≤3 dalla tab Svincolati</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {vivaio.map(p => {
            const needAct = needsAction(p);
            const rc = getRoleColor(p.ruolo);
            return (
              <div key={p.id} style={{ background: needAct ? "#ef444410" : "#ffffff08", border: `1.5px solid ${needAct ? "#ef444430" : "#ffffff12"}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`, borderRadius: 5, padding: "2px 6px", fontSize: 10, fontWeight: 700 }}>{p.ruolo}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: needAct ? "#fca5a5" : "#f0f0f0" }}>
                      {p.nome}
                      {needAct && <span style={{ fontSize: 9, color: "#ef4444", marginLeft: 6, background: "#ef444420", borderRadius: 4, padding: "1px 5px" }}>AZIONE RICHIESTA</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>
                      {p.anni}aa · Q{p.quot} · Entrato: {p.data_entrata_vivaio || "—"}
                    </div>
                  </div>

                  {/* Presenze */}
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 8, color: "#555" }}>PRESENZE</div>
                    {editPresenze?.id === p.id ? (
                      <div style={{ display: "flex", gap: 3 }}>
                        <input style={{ width: 36, padding: "2px 4px", borderRadius: 4, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, textAlign: "center" }}
                          type="number" min="0" value={editPresenze.val}
                          onChange={e => setEditPresenze(ep => ({ ...ep, val: e.target.value }))} />
                        <button onClick={() => salvaPresenze(p)} style={{ padding: "2px 5px", borderRadius: 4, border: "none", background: "#10b98122", color: "#10b981", fontSize: 9, cursor: "pointer" }}>✓</button>
                        <button onClick={() => setEditPresenze(null)} style={{ padding: "2px 5px", borderRadius: 4, border: "none", background: "#ffffff10", color: "#888", fontSize: 9, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 16, fontWeight: 900, color: (p.vivaio_presenze||0) >= 2 ? "#ef4444" : "#10b981", fontFamily: "'Bebas Neue',sans-serif", cursor: isAdmin ? "pointer" : "default" }}
                        onClick={() => isAdmin && setEditPresenze({ id: p.id, val: p.vivaio_presenze || 0 })}>
                        {p.vivaio_presenze || 0}
                        {isAdmin && <span style={{ fontSize: 8, color: "#444", marginLeft: 2 }}>✏️</span>}
                      </div>
                    )}
                  </div>

                  {/* Azioni */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handlePromuovi(p)} disabled={saving}
                      style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: "#10b98122", color: "#10b981", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      ↑ Promuovi
                    </button>
                    <button onClick={() => handleSvincola(p)} disabled={saving}
                      style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: "#ffffff10", color: "#888", fontSize: 11, cursor: "pointer" }}>
                      Svincola
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Regole vivaio ── */}
      <div style={{ background: "#ffffff05", border: "1px solid #ffffff08", borderRadius: 10, padding: "10px 14px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.06em", marginBottom: 6 }}>📋 REGOLE VIVAIO (art. 3.6)</div>
        {[
          "Giocatori: under-23, Q ≤ 3, 0 presenze a voto in campionato",
          "Acquisto: solo dopo aggiornamento listone post-mercato estivo (01/09)",
          "Compravendita: possibile tutto l'anno (no scadenze mercato normale)",
          "A 2 presenze a voto o +2 di quotazione → promuovi o svincola entro 2gg (pena 2M)",
          "Promozione: lo stipendio diventa Q/5 e gravita sul salary cap",
          "Svincolo: sempre gratuito (costo 0, guadagno 0)",
          "Costo mantenimento: 4M annuali obbligatori entro 15/08 per tutti",
        ].map((r, i) => (
          <div key={i} style={{ fontSize: 10, color: "#555", padding: "2px 0" }}>• {r}</div>
        ))}
      </div>
    </div>
  );
}

function PresidentePage({ team, onBack, isAdmin, mySquadra }) {
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const tab = tabParam || "rosa";
  const setTab = (newTab) => {
    navigate(`/presidente/${team.id}/${newTab}`, { replace: false });
  };
  const [movimenti, setMovimenti] = useState([]);
  const [showMovForm, setShowMovForm] = useState(false);
  const [movForm, setMovForm] = useState({ descrizione: "", entrata: "", uscita: "", data: new Date().toISOString().slice(0, 10) });
  const [movSort, setMovSort] = useState("data_desc");
  const [rosaPlayers, setRosaPlayers] = useState([]);
  const [contrattiScadenza, setContrattiScadenza] = useState([]);
  const [pagandoStipendi, setPagandoStipendi] = useState(false);
  const [clubIdentity, setClubIdentity] = useState(null);
  const [obiettivi, setObiettivi] = useState([]);

  const [scAllenatore, setScAllenatore] = useState(0);
  const [allenatoreNome, setAllenatoreNome] = useState(null);
  const [bilancioLive, setBilancioLive] = useState(team.bilancio);
  useEffect(() => { setBilancioLive(team.bilancio); }, [team.bilancio]);

  const salaryDist = 75 - team.salaryUsed;
  const fpMax = Math.max(team.fairPlay1, team.fairPlay2);
  const fpStatus = getFPStatus(fpMax);
  const scColor = getSCColor(team.salaryUsed);
  const canEditMovimenti = isAdmin || mySquadra === team.name;

  // Salary cap: stipendi rosa + 5M staff allenatore (se carta scelta)
  const salaryCapRosa = rosaPlayers.reduce((s, p) => s + calcolaStipCorretto(p.quot, p.anni_contratto, p.anni), 0);
  const salaryCapUsato = parseFloat((salaryCapRosa + scAllenatore).toFixed(2));
  const salaryCapSforato = salaryCapUsato > 75;
  const oggi = new Date().toISOString().slice(0, 10);
  const mese = new Date().getMonth();
  const scEsenteGiuLug = mese === 5 || mese === 6;

  // Giorni SC negativo
  const giorniSCNeg = team.scNegativoDal
    ? Math.floor((new Date() - new Date(team.scNegativoDal)) / 86400000)
    : 0;

  // Contratti in scadenza (anni_contratto >= 2, entro 31/05)
  const now = new Date();
  const fine31Mag = new Date(now.getFullYear(), 4, 31); // 31 maggio
  const alertContratti = contrattiScadenza.filter(p => !p.anni_giocatore || p.anni > 21);

  const loadRosaStipendi = useCallback(async () => {
    // Invalida cache quando carichiamo di proposito (es. dopo svincolo)
    const data = await cachedFetch('rosa_' + team.name, () => getRosa(team.name), 60000);
    if (data) {
      const rosaAttiva = data.filter(p => !p.in_vivaio);
      setRosaPlayers(rosaAttiva);
      const sc = rosaAttiva.reduce((s, p) => s + calcolaStipCorretto(p.quot, p.anni_contratto, p.anni), 0);
      if (!scEsenteGiuLug) await aggiornaSCNegativo(team.name, sc, oggi);
    }
  }, [team.name]);

  const loadContratti = useCallback(async () => {
    const data = await cachedFetch('contratti_' + team.name, () => getContrattiInScadenza(team.name), 120000);
    if (data) setContrattiScadenza(data);
  }, [team.name]);

  const loadClubIdentity = useCallback(async () => {
    const data = await cachedFetch('identity_' + team.name, () => getClubIdentity(team.name), 300000);
    if (data) setClubIdentity(data);
  }, [team.name]);

  const loadObiettivi = useCallback(async () => {
    const data = await getObiettivi(team.name); // no cache: cambia spesso
    if (data) setObiettivi(data);
  }, [team.name]);

  useEffect(() => {
    // Lancia tutto in parallelo invece di sequenziale
    Promise.all([
      loadRosaStipendi(),
      loadContratti(),
      loadClubIdentity(),
      loadObiettivi(),
      getSCAllenatore(team.name).then(setScAllenatore),
      getAllenatoreBySquadra(team.name, STAGIONE_CORRENTE).then(a => setAllenatoreNome(a?.nome || null)),
    ]);
    const subObj = subscribeObiettivi(team.name, loadObiettivi);
    return () => supabase.removeChannel(subObj);
  }, [loadRosaStipendi, loadContratti, loadClubIdentity, loadObiettivi, team.name]);

  async function handlePagaStipendi() {
    if (!isAdmin) return;
    setPagandoStipendi(true);
    try {
      const rata = parseFloat((salaryCapUsato / 12).toFixed(2));
      const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', team.name).single();
      const bilPrima = sq?.bilancio || 0;
      const nuoviBilancio = parseFloat((bilPrima - rata).toFixed(2));
      await updateSquadra(team.name, { bilancio: nuoviBilancio, salary_used: salaryCapUsato });
      await insertMovimento({ squadra: team.name, descrizione: `Stipendi mensili (${new Date().toLocaleString('it-IT',{month:'long'})})`, uscita: rata, data: oggi });
      await logAzione({ utente: 'admin', squadra: team.name, azione: 'stipendi_pagati', entita: 'squadre', descrizione: `Stipendi pagati −${rata}M (SC: ${salaryCapUsato.toFixed(1)}M)`, dataPrima: { bilancio: bilPrima }, dataDopo: { bilancio: nuoviBilancio }, rollbackPossibile: true });
      setBilancioLive(nuoviBilancio);
    } catch(e) { alert(`Errore: ${e.message}`); }
    finally { setPagandoStipendi(false); }
  }

  const loadMovimenti = useCallback(async () => {
    const data = await cachedFetch('movimenti_' + team.name, () => getMovimenti(team.name), 45000);
    if (data) setMovimenti(data);
  }, [team.name]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadRosaStipendi(), loadContratti(), loadObiettivi()]);
  }, [loadRosaStipendi, loadContratti, loadObiettivi]);

  useEffect(() => {
    loadMovimenti();
    const sub = subscribeMovimenti(team.name, loadMovimenti);
    return () => supabase.removeChannel(sub);
  }, [loadMovimenti, team.name]);

  async function salvaMovimento() {
    if (!movForm.descrizione) return;
    const entrata = movForm.entrata ? parseFloat(movForm.entrata) : null;
    const uscita  = movForm.uscita  ? parseFloat(movForm.uscita)  : null;
    const dettaglio = entrata ? `Entrata: +${entrata}M` : uscita ? `Uscita: −${uscita}M` : "Nessun importo";
    if (!window.confirm(`Registrare il movimento?\n\n"${movForm.descrizione}"\n${dettaglio}`)) return;
    await insertMovimento({
      squadra: team.name,
      descrizione: movForm.descrizione,
      entrata, uscita,
      data: movForm.data,
    });
    // Ricalcola bilancio come somma di tutti i movimenti
    const nuovi = [...movimenti, { entrata, uscita }];
    const nuovoBilancio = parseFloat(nuovi.reduce((s, m) => s + (m.entrata || 0) - (m.uscita || 0), 0).toFixed(2));
    await updateSquadra(team.name, { bilancio: nuovoBilancio });
    // Notifica privata Telegram al presidente della squadra
    sendTelegramNotification('movimento_privato', {
      descrizione: movForm.descrizione,
      entrata: entrata || null,
      uscita: uscita || null,
      bilancio: nuovoBilancio,
    }, team.name);
    setBilancioLive(nuovoBilancio);
    setShowMovForm(false);
    setMovForm({ descrizione: "", entrata: "", uscita: "", data: new Date().toISOString().slice(0, 10) });
    await loadMovimenti();
  }

  async function rimuoviMovimento(id) {
    const mov = movimenti.find(m => m.id === id);
    if (!window.confirm(`Eliminare il movimento?\n\n"${mov?.descrizione || ''}"`)) return;
    const rimanenti = movimenti.filter(m => m.id !== id);
    const nuovoBilancio = parseFloat(rimanenti.reduce((s, m) => s + (m.entrata || 0) - (m.uscita || 0), 0).toFixed(2));
    await updateSquadra(team.name, { bilancio: nuovoBilancio });
    await deleteMovimento(id);
    setBilancioLive(nuovoBilancio);
    await loadMovimenti();
  }

  const tabs = [
    { key: "rosa",      label: "Rosa"      },
    { key: "finanze",   label: "Finanze"   },
    { key: "movimenti", label: "Movimenti" },
    { key: "altro",     label: "Altro"     },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: "#ffffff0f", border: "1px solid #ffffff18", borderRadius: 10, padding: "8px 12px", cursor: "pointer", color: "#aaa", fontSize: 13, fontWeight: 600 }}>← Indietro</button>
        <TeamAvatar team={team} size={48} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "0.5px" }}>{team.name}</div>
          {allenatoreNome && (
            <div style={{ fontSize: 12, color: "#888" }}>Allenatore: <span style={{ color: team.color, fontWeight: 700 }}>{allenatoreNome}</span></div>
          )}
        </div>
      </div>

      {/* Quick stats strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
        {[
          { label: "Bilancio",  value: `${team.bilancio.toFixed(1)}M`,            color: team.bilancio < 10 ? "#f97316" : "#f0f0f0" },
          { label: "SC Usato",  value: `${salaryCapUsato.toFixed(1)}M / 75M`,     color: salaryCapSforato ? "#ef4444" : "#10b981" },
          { label: "SC Libero", value: `+${(75 - salaryCapUsato).toFixed(1)}M`,   color: salaryCapSforato ? "#ef4444" : "#10b981" },
        ].map(s => (
          <div key={s.label} style={{ background: "#ffffff08", borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#777", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label.toUpperCase()}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: s.color, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "0.5px" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Two-column layout: tabs left, club identity right */}
      <style>{`@media(max-width:768px){.pres-layout{flex-direction:column!important;align-items:stretch!important}.pres-left{width:100%!important;min-width:0!important}.pres-right{width:100%!important}}`}</style>
      <div className="pres-layout" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

        {/* LEFT — tabs */}
        <div className="pres-left" style={{ flex: 1, minWidth: 0 }}>
          {/* Tab buttons */}
          <div style={{ display: "flex", gap: 4, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: tab === t.key ? team.color + "33" : "#ffffff0a", color: tab === t.key ? team.color : "#888", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", borderBottom: tab === t.key ? `2px solid ${team.color}` : "2px solid transparent" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>

            {tab === "rosa" && (
              <RosaVivaiTab team={team} isAdmin={isAdmin} mySquadra={mySquadra} />
            )}

            {tab === "finanze" && (
              <FinanzeTab
                team={{ ...team, bilancio: bilancioLive }}
                salaryCapUsato={salaryCapUsato}
                salaryCapRosa={salaryCapRosa}
                scAllenatore={scAllenatore}
                salaryCapSforato={salaryCapSforato}
                scEsenteGiuLug={scEsenteGiuLug}
                giorniSCNeg={giorniSCNeg}
                contrattiScadenza={contrattiScadenza}
                rosaPlayers={rosaPlayers}
                pagandoStipendi={pagandoStipendi}
                handlePagaStipendi={handlePagaStipendi}
                isAdmin={isAdmin}
                mySquadra={mySquadra}
                onRefresh={loadAll}
                onBilancioChange={setBilancioLive}
              />
            )}

            {tab === "altro" && (
              <AltroTab team={team} isAdmin={isAdmin} />
            )}

            {tab === "movimenti" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em" }}>📋 MOVIMENTI</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {[
                      { asc: "data_asc", desc: "data_desc", labelAsc: "📅 Vecchi", labelDesc: "📅 Recenti" },
                      { asc: "imp_asc",  desc: "imp_desc",  labelAsc: "💰 ↑",       labelDesc: "💰 ↓" },
                    ].map(s => {
                      const active = movSort === s.asc || movSort === s.desc;
                      const isDesc = movSort === s.desc;
                      const label = active ? (isDesc ? s.labelDesc : s.labelAsc) : s.labelDesc;
                      return (
                        <button key={s.desc} onClick={() => setMovSort(active && isDesc ? s.asc : s.desc)} style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: active ? "#6366f133" : "#ffffff0a", color: active ? "#818cf8" : "#666", fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          {label}
                        </button>
                      );
                    })}
                    {canEditMovimenti && (
                      <button onClick={() => setShowMovForm(v => !v)} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: showMovForm ? "#ffffff12" : "linear-gradient(135deg,#6366f1,#a855f7)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        {showMovForm ? "✕" : "+ Mov"}
                      </button>
                    )}
                  </div>
                </div>

                {showMovForm && (
                  <div style={{ background: "#ffffff08", border: "1px solid #6366f133", borderRadius: 12, padding: 14, marginBottom: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>DESCRIZIONE</div>
                        <input style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12 }}
                          placeholder="es. Vendita Barella" value={movForm.descrizione} onChange={e => setMovForm(f => ({ ...f, descrizione: e.target.value }))} />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#10b981", marginBottom: 4 }}>ENTRATA (M)</div>
                        <input style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #10b98133", background: "#0d0f14", color: "#10b981", fontSize: 12 }}
                          type="number" placeholder="0" value={movForm.entrata} onChange={e => setMovForm(f => ({ ...f, entrata: e.target.value, uscita: "" }))} />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 4 }}>USCITA (M)</div>
                        <input style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ef444433", background: "#0d0f14", color: "#ef4444", fontSize: 12 }}
                          type="number" placeholder="0" value={movForm.uscita} onChange={e => setMovForm(f => ({ ...f, uscita: e.target.value, entrata: "" }))} />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>DATA</div>
                        <input style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12 }}
                          type="date" value={movForm.data} onChange={e => setMovForm(f => ({ ...f, data: e.target.value }))} />
                      </div>
                    </div>
                    <button onClick={salvaMovimento} style={{ width: "100%", padding: "9px", borderRadius: 9, border: "none", background: "#6366f1", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      Salva movimento →
                    </button>
                  </div>
                )}

                {(() => {
                  const sorted = [...movimenti].sort((a, b) => {
                    const va = a.entrata ?? -(a.uscita ?? 0);
                    const vb = b.entrata ?? -(b.uscita ?? 0);
                    const da = new Date(a.data), db = new Date(b.data);
                    if (movSort === "data_desc") return db - da;
                    if (movSort === "data_asc")  return da - db;
                    if (movSort === "imp_desc")  return Math.abs(vb) - Math.abs(va);
                    if (movSort === "imp_asc")   return Math.abs(va) - Math.abs(vb);
                    return 0;
                  });
                  return sorted.length === 0
                    ? <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessun movimento registrato</div>
                    : sorted.map(m => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #ffffff08" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.entrata ? "#10b981" : "#ef4444", flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "#ddd", fontWeight: 600 }}>{m.descrizione}</div>
                          <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{new Date(m.data).toLocaleDateString("it-IT")}</div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: m.entrata ? "#10b981" : "#ef4444", fontFamily: "'Bebas Neue',sans-serif", whiteSpace: "nowrap" }}>
                          {m.entrata ? `+${m.entrata}M` : m.uscita ? `-${m.uscita}M` : "—"}
                        </div>
                        {canEditMovimenti && (
                          <button onClick={() => rimuoviMovimento(m.id)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ef444418", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>✕</button>
                        )}
                      </div>
                    ));
                })()}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — club identity, always visible */}
        <div className="pres-right" style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <ClubIdentityRight
            team={team}
            clubIdentity={clubIdentity}
            isAdmin={isAdmin}
            mySquadra={mySquadra}
            onRefresh={loadClubIdentity}
          />
          {/* Telegram self-registration — only for the team's own president */}
          {mySquadra === team.name && (
            <TelegramRegistrationCard squadra={team.name} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── IMAGE SLOT (standalone) ────────────────────────────────────────────────── */
function ImageSlot({ kind, url, label, slotStyle, canEdit, uploading, teamName, onUpload }) {
  const inputId = `upload-${kind}-${teamName}`;
  return (
    <div
      onClick={() => canEdit && document.getElementById(inputId).click()}
      style={{ position: "relative", cursor: canEdit ? "pointer" : "default", borderRadius: 10, overflow: "hidden", background: "#0d0f14", border: "1px solid #ffffff10", ...slotStyle }}>
      {url
        ? <img src={url} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        : <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, minHeight: 40 }}>
            <span style={{ fontSize: canEdit ? 20 : 14, opacity: 0.25 }}>{canEdit ? "+" : "—"}</span>
            {canEdit && <span style={{ fontSize: 8, color: "#444", textAlign: "center", padding: "0 4px" }}>{label}</span>}
          </div>}
      {uploading === kind && (
        <div style={{ position: "absolute", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: "#f59e0b" }}>⏳</span>
        </div>
      )}
      {canEdit && url && uploading !== kind && (
        <div style={{ position: "absolute", inset: 0, opacity: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "opacity 0.15s", fontSize: 9, color: "#fff", fontWeight: 700, letterSpacing: "0.06em" }}
          onMouseEnter={e => e.currentTarget.style.opacity = 1}
          onMouseLeave={e => { e.currentTarget.style.opacity = 0; e.currentTarget.style.background = "#00000000"; }}>
          <div style={{ background: "#000000cc", padding: "2px 6px", borderRadius: 4 }}>CAMBIA</div>
        </div>
      )}
      {canEdit && <input id={inputId} type="file" accept="image/*" style={{ display: "none" }} onChange={e => onUpload(kind, e)} />}
    </div>
  );
}

/* ─── TELEGRAM REGISTRATION CARD ────────────────────────────────────────────── */
function TelegramRegistrationCard({ squadra }) {
  const [reg, setReg] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Load current registration status from supabase
    supabase.from('telegram_registrations').select('chat_id, username, registered_at').eq('squadra', squadra).single()
      .then(({ data }) => { setReg(data || null); setLoaded(true); });
  }, [squadra]);

  // Build the deep-link URL using base64url of the squad name
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';
  const b64 = typeof btoa !== 'undefined'
    ? btoa(squadra).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    : '';
  const tgLink = botUsername ? `https://t.me/${botUsername}?start=${b64}` : null;

  return (
    <div style={{ background: '#6366f108', border: '1.5px solid #6366f125', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>✈️</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#c7d2fe' }}>Notifiche Telegram</span>
      </div>

      {!loaded && <div style={{ fontSize: 11, color: '#555' }}>Caricamento…</div>}

      {loaded && reg && (
        <div style={{ background: '#10b98110', border: '1px solid #10b98130', borderRadius: 9, padding: '8px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>✓ Registrato</div>
          <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
            @{reg.username || '?'} · dal {new Date(reg.registered_at).toLocaleDateString('it-IT')}
          </div>
        </div>
      )}

      {loaded && !reg && (
        <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
          Ricevi notifiche private su Telegram per trattative, aste e movimenti.
        </div>
      )}

      {tgLink ? (
        <a
          href={tgLink}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'block', textAlign: 'center', padding: '8px 14px', borderRadius: 9, background: '#6366f120', border: '1.5px solid #6366f140', color: '#818cf8', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
          {reg ? '🔄 Ri-registrati' : '📲 Registrati sul bot'}
        </a>
      ) : (
        <div style={{ fontSize: 10, color: '#444', fontStyle: 'italic' }}>
          Bot non ancora configurato.<br/>Contatta l'admin della lega.
        </div>
      )}
    </div>
  );
}

/* ─── CLUB IDENTITY RIGHT PANEL ─────────────────────────────────────────────── */
function ClubIdentityRight({ team, clubIdentity, isAdmin, mySquadra, onRefresh }) {
  const canEdit = isAdmin || mySquadra === team.name;
  const [uploading, setUploading] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (clubIdentity) {
      setForm({
        campionati:  clubIdentity.campionati  || "",
        coppe:       clubIdentity.coppe       || "",
        supercoppe:  clubIdentity.supercoppe  || "",
        fondazione:  clubIdentity.fondazione  || "",
        stadio:      clubIdentity.stadio      || "",
        rivali:      clubIdentity.rivali      || "",
        gemellato:   clubIdentity.gemellato   || "",
        motto:       clubIdentity.motto       || "",
        descrizione: clubIdentity.descrizione || "",
      });
    }
  }, [clubIdentity]);

  async function handleUpload(kind, e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(kind);
    try {
      await uploadImmagineSquadra(team.name, file, kind);
      await onRefresh();
    } catch(err) { alert(`Errore upload: ${err.message}`); }
    finally { setUploading(null); e.target.value = ""; }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateClubIdentity(team.name, {
        campionati:  form.campionati  || null,
        coppe:       form.coppe       || null,
        supercoppe:  form.supercoppe  || null,
        fondazione:  form.fondazione  || null,
        stadio:      form.stadio      || null,
        rivali:      form.rivali      || null,
        gemellato:   form.gemellato   || null,
        motto:       form.motto       || null,
        descrizione: form.descrizione || null,
      });
      await onRefresh();
      setEditing(false);
    } catch(err) { alert(`Errore: ${err.message}`); }
    finally { setSaving(false); }
  }

  const TEAMS_LIST = ["Alcool Campi","AK Toio","Agnus Dei FC","Balillareal","Borjcellona","Wehrmacht FC","Finocchiona AC","Shalpe 104"];
  const altreSquadre = TEAMS_LIST.filter(n => n !== team.name);

  // Rivale e Gemellato: bloccati se lock globale attivo OPPURE già scelti — solo admin può sempre modificare
  const rivaleGiaScelto    = !!(clubIdentity?.rivali);
  const gemellataGiaScelto = !!(clubIdentity?.gemellato);
  const canEditRivale    = isAdmin || (!_rivalitaBloccata && !rivaleGiaScelto);
  const canEditGemellato = isAdmin || (!_rivalitaBloccata && !gemellataGiaScelto);

  const inp = { width: "100%", padding: "5px 8px", borderRadius: 7, border: "1px solid #ffffff15", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, outline: "none" };

  return (
    <>
      {/* Stemma + Maglie */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 12 }}>
        <ImageSlot kind="stemma" url={clubIdentity?.stemma_url} label="Carica stemma"
          slotStyle={{ height: 120, marginBottom: 8 }}
          canEdit={canEdit} uploading={uploading} teamName={team.name} onUpload={handleUpload} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {[
            { kind: "maglia_casa",      label: "Casa"      },
            { kind: "maglia_trasferta", label: "Trasferta" },
            { kind: "maglia_terza",     label: "Terza"     },
          ].map(m => (
            <ImageSlot key={m.kind} kind={m.kind}
              url={clubIdentity?.[`${m.kind}_url`]}
              label={m.label}
              slotStyle={{ aspectRatio: "3/4" }}
              canEdit={canEdit} uploading={uploading} teamName={team.name} onUpload={handleUpload} />
          ))}
        </div>
        {canEdit && <div style={{ fontSize: 9, color: "#555", marginTop: 6, textAlign: "center" }}>Clicca per caricare · max 10MB</div>}
      </div>

      {/* Palmares */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: "0.1em" }}>🏅 PALMARES</div>
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 5, border: "1px solid #ffffff15", background: "transparent", color: "#666", cursor: "pointer" }}>✏️</button>
          )}
          {canEdit && editing && (
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={handleSave} disabled={saving} style={{ fontSize: 9, padding: "2px 10px", borderRadius: 5, border: "none", background: "#10b981", color: "#000", fontWeight: 700, cursor: "pointer" }}>{saving ? "..." : "✓"}</button>
              <button onClick={() => setEditing(false)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 5, border: "none", background: "#ffffff10", color: "#888", cursor: "pointer" }}>✕</button>
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[{ key: "campionati", label: "Scudetti" },{ key: "coppe", label: "Coppe" },{ key: "supercoppe", label: "Supercop" }].map(t => (
            <div key={t.key} style={{ background: "#ffffff08", borderRadius: 10, padding: "10px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#666", marginBottom: 4 }}>{t.label}</div>
              {editing
                ? <input type="number" min="0" value={form?.[t.key] || ""} onChange={e => setForm(f => ({...f, [t.key]: e.target.value}))}
                    style={{ ...inp, textAlign: "center", padding: "4px", fontSize: 16, fontFamily: "'Bebas Neue',sans-serif" }} />
                : <div style={{ fontSize: 20, fontWeight: 900, color: clubIdentity?.[t.key] ? "#f59e0b" : "#333", fontFamily: "'Bebas Neue',sans-serif" }}>
                    {clubIdentity?.[t.key] || "-"}
                  </div>}
            </div>
          ))}
        </div>
      </div>

      {/* Info Club */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: "0.1em", marginBottom: 12 }}>📋 INFO CLUB</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { key: "fondazione", label: "FONDAZIONE", placeholder: "es. 2021",      type: "text" },
            { key: "stadio",     label: "STADIO",     placeholder: "Nome stadio",   type: "text" },
            { key: "motto",      label: "MOTTO",      placeholder: "Motto del club", type: "text" },
          ].map(r => (
            <div key={r.key}>
              <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.06em", marginBottom: 3 }}>{r.label}</div>
              {editing
                ? <input type={r.type} placeholder={r.placeholder} value={form?.[r.key] || ""}
                    onChange={e => setForm(f => ({...f, [r.key]: e.target.value}))} style={inp} />
                : <div style={{ fontSize: 12, color: r.key === "motto" ? team.color : "#ddd", fontWeight: r.key === "motto" ? 700 : 600, fontStyle: r.key === "motto" ? "italic" : "normal" }}>
                    {clubIdentity?.[r.key] || <span style={{ color: "#444", fontWeight: 400, fontStyle: "normal" }}>—</span>}
                  </div>}
            </div>
          ))}

          {/* Gemellato — menu tendina con lock dopo scelta */}
          {(() => {
            const val = clubIdentity?.gemellato;
            return (
              <div>
                <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.06em", marginBottom: 3 }}>GEMELLATO</div>
                {editing && canEditGemellato
                  ? <select value={form?.gemellato || ""} onChange={e => setForm(f => ({...f, gemellato: e.target.value}))} style={inp}>
                      <option value="">— Nessun gemellato —</option>
                      {altreSquadre.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700 }}>
                        {val || <span style={{ color: "#444", fontWeight: 400 }}>—</span>}
                      </div>
                      {gemellataGiaScelto && !isAdmin && (
                        <span style={{ fontSize: 9, color: "#555", background: "#ffffff08", border: "1px solid #ffffff12", borderRadius: 4, padding: "1px 5px" }}>🔒 fisso</span>
                      )}
                    </div>
                }
                {editing && !canEditGemellato && (
                  <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>Il gemellato è già stato scelto e non può essere modificato (solo admin)</div>
                )}
              </div>
            );
          })()}

          {/* Rivale — menu tendina con lock dopo scelta */}
          <div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.06em", marginBottom: 3 }}>RIVALE</div>
            {editing && canEditRivale
              ? <select value={form?.rivali || ""} onChange={e => setForm(f => ({...f, rivali: e.target.value}))} style={inp}>
                  <option value="">— Nessun rivale —</option>
                  {altreSquadre.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 12, color: team.color, fontWeight: 700 }}>
                    {clubIdentity?.rivali || <span style={{ color: "#444", fontWeight: 400 }}>—</span>}
                  </div>
                  {rivaleGiaScelto && !isAdmin && (
                    <span style={{ fontSize: 9, color: "#555", background: "#ffffff08", border: "1px solid #ffffff12", borderRadius: 4, padding: "1px 5px" }}>🔒 fisso</span>
                  )}
                </div>
            }
            {editing && !canEditRivale && (
              <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>Il rivale è già stato scelto e non può essere modificato (solo admin)</div>
            )}
          </div>
        </div>
      </div>

      {/* Storia */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: "0.1em", marginBottom: 10 }}>📖 STORIA</div>
        {editing
          ? <textarea rows={6} placeholder="Storia del club..." value={form?.descrizione || ""}
              onChange={e => setForm(f => ({...f, descrizione: e.target.value}))}
              style={{ ...inp, resize: "vertical", lineHeight: 1.6 }} />
          : <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.7, whiteSpace: "pre-line", maxHeight: 220, overflowY: "auto" }}>
              {clubIdentity?.descrizione || <span style={{ color: "#444", fontStyle: "italic" }}>Descrizione non ancora inserita.</span>}
            </div>}
      </div>
    </>
  );
}

/* ─── CLUB IDENTITY CARD (standalone) ───────────────────────────────────────── */
function ClubIdentityCard({ team, isAdmin, mySquadra }) {
  const [clubIdentity, setClubIdentity] = useState(null);
  const reload = useCallback(() => {
    getClubIdentity(team.name).then(d => setClubIdentity(d || { squadra: team.name }));
  }, [team.name]);
  useEffect(() => { reload(); }, [reload]);
  return <ClubIdentityRight team={team} clubIdentity={clubIdentity} isAdmin={isAdmin} mySquadra={mySquadra} onRefresh={reload} />;
}

/* ─── MERCATO PAGE ──────────────────────────────────────────────────────────── */
/* ─── HELPERS MERCATO ───────────────────────────────────────────────────────── */

// Module-level override set by App on load
let _mercatoOverride = null;
let _rivalitaBloccata = false; // caricato all'avvio

// Finestre di mercato (art. 5.1)
// Estivo:   01/06 09:00 → 15/09 24:00
// Invernale: 01/01 09:00 → 15/02 24:00
function getMercatoStatus() {
  if (_mercatoOverride === 'aperto') return { aperto: true, label: 'Override Admin', giorniRimasti: '∞', override: true };
  if (_mercatoOverride === 'chiuso') return { aperto: false, label: 'Chiuso (Admin)', override: true, prossima: null, giorniApertura: '?', dataApertura: '—' };
  const now = new Date();
  const y = now.getFullYear();

  const windows = [
    { label: "Estivo",    open: new Date(y, 5, 1, 9, 0),  close: new Date(y, 8, 15, 24, 0) },
    { label: "Invernale", open: new Date(y, 0, 1, 9, 0),  close: new Date(y, 1, 15, 24, 0) },
    // Anche anno passato per invernale già chiuso
    { label: "Invernale", open: new Date(y-1, 0, 1, 9, 0), close: new Date(y-1, 1, 15, 24, 0) },
  ];

  // Mercato aperto?
  for (const w of windows) {
    if (now >= w.open && now <= w.close) {
      const giorniRimasti = Math.ceil((w.close - now) / 86400000);
      return { aperto: true, label: w.label, close: w.close, giorniRimasti };
    }
  }

  // Prossima apertura
  const future = [
    new Date(y, 5, 1, 9, 0),
    new Date(y, 0, 1, 9, 0),
    new Date(y+1, 0, 1, 9, 0),
  ].filter(d => d > now).sort((a, b) => a - b);

  const prossima = future[0];
  const giorniApertura = Math.ceil((prossima - now) / 86400000);
  const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  const label = prossima.getMonth() === 0 ? "Invernale" : "Estivo";
  return {
    aperto: false,
    label,
    prossima,
    giorniApertura,
    dataApertura: `${String(prossima.getDate()).padStart(2,'0')} ${mesi[prossima.getMonth()]} ${prossima.getFullYear()}`,
  };
}

// Calcola prezzo minimo offerta (art. 5.4): ≥ quot/2
function prezzoMinimo(quot) { return parseFloat((quot / 2).toFixed(2)); }

// Calcola clausola rescissoria (art. 5.5): quot × 1.75
function valoreClausola(quot) { return parseFloat((quot * 1.75).toFixed(2)); }

// Calcola scadenza prestito: prima scadenza fissa (01/01 o 01/06)
// non precedente alla durata scelta, calcolata dalla data dell'accordo (art. 5.8).
function scadenzaPrestito(mesi, dataInizio = new Date()) {
  const targetMinimo = new Date(dataInizio);
  targetMinimo.setHours(0, 0, 0, 0);
  targetMinimo.setMonth(targetMinimo.getMonth() + Number(mesi || 0));

  const candidates = [];
  for (let y = targetMinimo.getFullYear(); y <= targetMinimo.getFullYear() + 2; y++) {
    candidates.push(new Date(y, 0, 1), new Date(y, 5, 1));
  }
  const target = candidates.sort((a, b) => a - b).find(d => d >= targetMinimo);
  return target.toISOString().slice(0, 10);
}

// ── Freeze notte 00:00–08:00 (art. 5.11) ─────────────────────────────────────
// Esempio: offerta alle 23:20 → 40 min attivi fino a 00:00 → freeze → riprende
// alle 08:00 con 80 min rimasti → asta scade alle 09:20
const FREEZE_INIZIO = 0;  // 00:00
const FREEZE_FINE   = 8;  // 08:00

function isInFreeze(ora) { return ora >= FREEZE_INIZIO && ora < FREEZE_FINE; }

// Calcola i minuti "attivi" tra due istanti, escludendo la finestra 00:00-08:00
function minutiAttiviTrascorsi(startStr, now = new Date()) {
  let t = new Date(startStr);
  let attivi = 0;
  while (t < now) {
    const ora = t.getHours();
    if (isInFreeze(ora)) {
      // Salta direttamente alle 08:00
      const next08 = new Date(t);
      next08.setHours(FREEZE_FINE, 0, 0, 0);
      if (next08 <= t) next08.setDate(next08.getDate() + 1); // già passate le 8
      t = next08 < now ? next08 : now;
    } else {
      // Conta fino alla prossima 00:00 o a now
      const mezzanotte = new Date(t);
      mezzanotte.setDate(mezzanotte.getDate() + 1);
      mezzanotte.setHours(FREEZE_INIZIO, 0, 0, 0);
      const fine = mezzanotte < now ? mezzanotte : now;
      attivi += (fine.getTime() - t.getTime()) / 60000;
      t = fine;
    }
  }
  return Math.max(0, attivi);
}

// Calcola la scadenza rialzo +2h attivi (esclude 00:00-08:00)
function calcolaScadenzaRialzoConFreeze(fromTime = new Date()) {
  let rimasti = 120; // minuti attivi rimanenti
  let t = new Date(fromTime);
  while (rimasti > 0) {
    const ora = t.getHours();
    if (isInFreeze(ora)) {
      // Salta alle 08:00
      const next08 = new Date(t);
      next08.setHours(FREEZE_FINE, 0, 0, 0);
      if (next08 <= t) next08.setDate(next08.getDate() + 1);
      t = next08;
    } else {
      // Quanti minuti attivi fino alla prossima mezzanotte?
      const mezzanotte = new Date(t);
      mezzanotte.setDate(mezzanotte.getDate() + 1);
      mezzanotte.setHours(FREEZE_INIZIO, 0, 0, 0);
      const minutiFinestra = (mezzanotte.getTime() - t.getTime()) / 60000;
      if (minutiFinestra >= rimasti) {
        t = new Date(t.getTime() + rimasti * 60000);
        rimasti = 0;
      } else {
        rimasti -= minutiFinestra;
        t = mezzanotte; // entra nel freeze
      }
    }
  }
  return t.toISOString();
}

// Minuti attivi rimasti alla scadenza rialzo (from now to scadenza)
function minutiRimanentiRialzo(scadenzaStr, now = new Date()) {
  if (!scadenzaStr) return null;
  const scadenza = new Date(scadenzaStr);
  if (scadenza <= now) return 0;
  return Math.round(minutiAttiviTrascorsi(now.toISOString(), scadenza));
}

// Calcola prezzo a discesa live — esclude ore notturne (art. 5.11)
function prezzoDiscesaLive(quotBase, avviataAt) {
  const minutiAttivi = minutiAttiviTrascorsi(avviataAt);
  const riduzioni = Math.floor(minutiAttivi / 30);
  const prezzo = parseFloat((quotBase - riduzioni * 0.25).toFixed(2));
  const minimo = parseFloat((quotBase / 2).toFixed(2));
  return Math.max(prezzo, minimo);
}

/* ─── MERCATO PAGE ──────────────────────────────────────────────────────────── */

// ── Importa funzioni nuove (aggiunte in fondo a supabase.js) ─────────────────
// getBonusTrattativa, insertBonusTrattativa, deleteBonusTrattativa,
// checkECompletaBonus, getLabelBonus, calcolaStatoTrattativaMercato,
// applicaPenalitaRitardoAuto, getListoneBySquadra, importListoneDaExcel,
// aggiornaFantaSquadraListone, aggiornaStipendioDopoTrasferimento
// (importate globalmente via supabase.js)

const TIPI_BONUS = [
  { value: 'partite_voto', label: 'Partite a voto' },
  { value: 'gol_fatti',    label: 'Gol fatti' },
  { value: 'assist',       label: 'Assist' },
  { value: 'bonus_tot',    label: 'Bonus (Gol+Assist)' },
  { value: 'ammonizioni',  label: 'Ammonizioni' },
  { value: 'espulsioni',   label: 'Espulsioni' },
  { value: 'gol_subiti',   label: 'Gol subiti' },
  { value: 'malus_tot',    label: 'Malus (Amm+Esp+GS)' },
];

const URGENZA_COLORS_MERCATO = {
  ok:       { bg: '#10b98112', border: '#10b98133', text: '#10b981' },
  warn1:    { bg: '#f59e0b12', border: '#f59e0b33', text: '#f59e0b' },
  warn3:    { bg: '#f9731612', border: '#f9731633', text: '#f97316' },
  warn5:    { bg: '#ef444412', border: '#ef444433', text: '#ef4444' },
  critical: { bg: '#dc262612', border: '#dc262644', text: '#fca5a5' },
  scaduta:  { bg: '#7f1d1d22', border: '#ef444466', text: '#fca5a5' },
};

function MercatoPage({ profile, isAdmin, teams, offerteInAttesa = [], statoMercato }) {
  const location = useLocation();
  const [tab, setTab] = useState("trattative");
  const [mercatoSection, setMercatoSection] = useState("mercato");
  const [trattative, setTrattative] = useState([]);
  const [aste, setAste] = useState([]);
  const [asteSvinc, setAsteSvinc] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAstaForm, setShowAstaForm] = useState(false);
  const [now, setNow] = useState(new Date());

  // ── Picker squadra/giocatore (nuovo form trattativa) ──────────────────────
  const emptyForm = {
    squadraMittente: "",      // solo admin: squadra che invia l'offerta
    squadraTarget: "",        // squadra da cui acquistare
    giocatoreId: "",          // id giocatore selezionato
    giocatoreNome: "",
    quot: 0,
    tipo: "cessione",
    prezzo: "",
    durata_mesi: "6",
    stipendio_a_chi: "ricevente",
    note: "",
    // bonus
    bonusRows: [],            // [{ tipo_bonus, soglia, valore_mln, direzione }]
  };
  const [form, setForm] = useState(emptyForm);
  const [rosaTarget, setRosaTarget] = useState([]);
  const [loadingRosa, setLoadingRosa] = useState(false);

  // Form nuova asta
  const emptyAstaForm = { giocatore: "", quot: "", tipo_asta: "rialzo", note: "" };
  const [astaForm, setAstaForm] = useState(emptyAstaForm);
  const [myRosa, setMyRosa] = useState([]);

  const mySquadra = profile?.squadra;
  const squadraMittente = isAdmin ? (form.squadraMittente || mySquadra) : mySquadra;
  const mercato = getMercatoStatus();

  // Per gli admin la squadra mittente predefinita è sempre quella del proprio profilo.
  useEffect(() => {
    if (isAdmin && mySquadra && !form.squadraMittente) {
      setForm(f => ({ ...f, squadraMittente: mySquadra }));
    }
  }, [isAdmin, mySquadra, form.squadraMittente]);

  // Tick ogni minuto
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    const [t, a, as] = await Promise.all([
      cachedFetch('trattative', () => getTrattative(), 30000),
      cachedFetch('aste', () => getAste(), 30000),
      cachedFetch('aste_svincolati_all', () => getAsteSvincolati(), 30000),
    ]);
    setTrattative(t);
    setAste(a);
    setAsteSvinc(as || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const s1 = subscribeTrattative(loadAll);
    const s2 = subscribeAste(loadAll);
    const s3 = subscribeAsteSvincolati(loadAll);
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); supabase.removeChannel(s3); };
  }, [loadAll]);

  useEffect(() => {
    if (!mySquadra) return;
    getRosa(mySquadra).then(r => setMyRosa((r || []).filter(p => !p.in_vivaio).sort((a,b) => a.nome.localeCompare(b.nome))));
  }, [mySquadra]);

  // ── Polling auto-close aste rialzo scadute (ogni minuto) ─────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const scadute = aste.filter(a =>
        a.tipo_asta === 'rialzo' && a.stato === 'attiva' &&
        a.scadenza_asta && new Date(a.scadenza_asta) <= new Date()
      );
      if (scadute.length > 0) loadAll(); // refresh UI so admin sees "Chiudi asta" button
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [aste, loadAll]);

  // ── Polling penalità automatiche (ogni 5 min) ─────────────────────────────
  useEffect(() => {
    if (typeof applicaPenalitaRitardoAuto !== 'function') return;
    async function checkPenalita() {
      const inAttesa = trattative.filter(t =>
        (t.stato === 'in attesa' || t.stato === 'in_attesa') &&
        t.a_squadra === mySquadra
      );
      for (const t of inAttesa) {
        try { await applicaPenalitaRitardoAuto(t); } catch(e) { /* ignora */ }
      }
    }
    const interval = setInterval(checkPenalita, 5 * 60 * 1000);
    checkPenalita();
    return () => clearInterval(interval);
  }, [trattative, mySquadra]);

  // ── Pre-fill form da URL params (es. da popup Rosa di un'altra squadra) ─────
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const playerName = params.get('player');
    const squadra    = params.get('squadra');
    const tipo       = params.get('tipo') || 'cessione';
    const quotParam  = parseFloat(params.get('quot') || 0);
    if (!playerName || !squadra) return;

    setShowForm(true);
    setLoadingRosa(true);
    getRosa(squadra).then(data => {
      const rosa = (data || []).filter(p => !p.in_vivaio);
      setRosaTarget(rosa);
      const player = rosa.find(p => p.nome.toLowerCase() === playerName.toLowerCase());
      const quot = player?.quot || quotParam;
      const tipoNorm = tipo === 'prestito' ? 'prestito_diritto' : tipo;
      const prezzoDefault = tipoNorm === 'clausola'
        ? parseFloat((quot * 1.75).toFixed(2))
        : parseFloat((quot / 2).toFixed(2));
      setForm(f => ({
        ...f,
        squadraTarget: squadra,
        giocatoreId:   player ? String(player.id) : '',
        giocatoreNome: player ? player.nome : playerName,
        quot,
        tipo:          tipoNorm,
        prezzo:        String(prezzoDefault),
      }));
      setLoadingRosa(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // ── Carica rosa quando si sceglie la squadra target ───────────────────────
  async function onSquadraTargetChange(squadraNome) {
    setForm(f => ({ ...f, squadraTarget: squadraNome, giocatoreId: '', giocatoreNome: '', quot: 0, prezzo: '' }));
    if (!squadraNome) { setRosaTarget([]); return; }
    setLoadingRosa(true);
    const data = await getRosa(squadraNome);
    setRosaTarget((data || []).filter(p => !p.in_vivaio));
    setLoadingRosa(false);
  }

  // ── Selezione giocatore dal picker ────────────────────────────────────────
  function onGiocatoreChange(playerId) {
    const player = rosaTarget.find(p => String(p.id) === String(playerId));
    if (!player) { setForm(f => ({ ...f, giocatoreId: '', giocatoreNome: '', quot: 0, prezzo: '' })); return; }
    const passaggi = Number(player.passaggi_sessione || 0);
    const tipoForzato = form.tipo; // art. 5.6: qualsiasi tipo consentito, max 2 passaggi per sessione
    setForm(f => ({
      ...f,
      giocatoreId: playerId,
      giocatoreNome: player.nome,
      quot: player.quot,
      prezzo: String(parseFloat((player.quot / 2).toFixed(2))),
      tipo: tipoForzato,
    }));
  }

  // ── Aggiunge una riga bonus al form ───────────────────────────────────────

  function rimuoviBonusRow(idx) {
    setForm(f => ({ ...f, bonusRows: f.bonusRows.filter((_, i) => i !== idx) }));
  }

  // ── Salva trattativa + bonus ───────────────────────────────────────────────
  async function salvaTrattativa() {
    if (!form.giocatoreNome) { alert('Seleziona un giocatore'); return; }
    const quot = Number(form.quot);
    const prezzo = form.tipo === 'clausola' ? valoreClausola(quot) : parseFloat(form.prezzo) || 0;

    if (form.tipo !== 'clausola') {
      if (prezzo < prezzoMinimo(quot)) {
        alert(`Prezzo minimo: ${prezzoMinimo(quot)}M (½ della quotazione ${quot}M)`);
        return;
      }
      if (form.tipo.startsWith('prestito') && form.tipo !== 'prestito_secco') {
        if (prezzo < quot * 0.5 || prezzo > quot * 1.5) {
          alert(`Riscatto prestito: tra ${(quot*0.5).toFixed(1)}M e ${(quot*1.5).toFixed(1)}M`);
          return;
        }
      }
      if (form.tipo === 'prestito_secco' && prezzo < quot * 0.1) {
        alert(`Prestito secco: minimo ${(quot*0.1).toFixed(2)}M`);
        return;
      }
    }

    const da = squadraMittente;
    if (!da) { alert('Squadra mittente non disponibile'); return; }
    if (da === form.squadraTarget) { alert('La squadra mittente e la squadra cedente devono essere diverse'); return; }
    const scad = form.tipo.startsWith('prestito') ? scadenzaPrestito(parseInt(form.durata_mesi)) : null;
    const tipoLabel = { cessione:'Acquisto diretto', clausola:'Clausola rescissoria', prestito:'Prestito con riscatto', prestito_secco:'Prestito secco' }[form.tipo] || form.tipo;
    if (!window.confirm(`Inviare offerta?\n\n${tipoLabel}: ${form.giocatoreNome}\nDa: ${da} → ${form.squadraTarget}\nPrezzo: ${(form.tipo === 'clausola' ? valoreClausola(Number(form.quot)) : parseFloat(form.prezzo)||0).toFixed(2)}M`)) return;

    const trattativa = await insertTrattativa({
      da_squadra: da,
      a_squadra: form.squadraTarget,
      giocatore: form.giocatoreNome,
      quot_giocatore: quot,
      tipo: form.tipo,
      prezzo,
      durata_mesi: form.tipo.startsWith('prestito') ? parseInt(form.durata_mesi) : null,
      scadenza_prestito: scad,
      stipendio_a_chi: form.tipo.startsWith('prestito') ? 'ricevente' : null,
      fuori_mercato: !mercato.aperto,
      note: form.note,
      n_rifiuti: 0,
      penalta_applicata: 0,
      deadline_risposta: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });

    // Inserisci i bonus (parsa soglia e valore_mln da stringa a numero)
    for (const row of form.bonusRows) {
      const soglia = Number(row.soglia);
      const valore_mln = Number(row.valore_mln);
      if (!soglia || !valore_mln || soglia <= 0 || valore_mln <= 0) continue; // salta righe incomplete
      await insertBonusTrattativa({ ...row, soglia, valore_mln, trattativa_id: trattativa.id });
    }

    // Notify the receiving team via Telegram DM
    sendTelegramNotification('trattativa_ricevuta', {
      giocatore: form.giocatoreNome,
      importo: prezzo,
      da_squadra: da,
    }, form.squadraTarget);

    setShowForm(false);
    setForm({ ...emptyForm, squadraMittente: isAdmin ? mySquadra : "" });
    setRosaTarget([]);
  }

  // ── Risposta trattativa ────────────────────────────────────────────────────
  const [controffertaId, setControffertaId] = useState(null);
  const [controffertaPrezzo, setControffertaPrezzo] = useState("");

  async function eseguiAccettazione(t) {
    const mercatoAperto = getMercatoStatus().aperto;
    const isDifferito = t.fuori_mercato || !mercatoAperto;
    const msg = isDifferito
      ? `Confermi di accettare?\n\nIl trasferimento di ${t.giocatore} sarà IN ATTESA fino all'apertura del mercato (art. 5.1.1).\nGiocatore e soldi si muoveranno il 1° giorno di mercato disponibile.`
      : `Confermi il trasferimento di ${t.giocatore} per ${t.prezzo}M?`;
    if (!window.confirm(msg)) return;
    setLoading(true);
    try {
      if (isDifferito) {
        // Trasferimento differito: aggiorna solo lo stato, non muovere il giocatore
        await updateTrattativa(t.id, { stato: 'accettata_differita', updated_at: new Date().toISOString() });
      } else {
        await eseguiTrasferimento(t).catch(e => { throw new Error(`Trasferimento fallito: ${e.message}`); });
        await aggiornaFantaSquadraListone(t.giocatore, t.da_squadra).catch(e => { throw new Error(`Aggiornamento listoneSquadra fallito (giocatore trasferito ma listone non aggiornato): ${e.message}`); });
        await aggiornaStipendioDopoTrasferimento(t.giocatore, t.da_squadra).catch(e => { throw new Error(`Aggiornamento stipendio fallito (segnalarlo manualmente): ${e.message}`); });
        await logAzione({ utente: 'admin', squadra: t.da_squadra, azione: 'trasferimento', entita: 'trattative', entitaId: t.id, descrizione: `Trasferimento: ${t.giocatore} da ${t.a_squadra} a ${t.da_squadra} — ${t.prezzo}M (${t.tipo})`, dataPrima: { trattativa: t }, rollbackPossibile: false });
        // Notify both teams via DM + canale gruppo
        sendTelegramNotification('trattativa_accettata', { giocatore: t.giocatore, importo: t.prezzo, da_squadra: t.da_squadra, a_squadra: t.a_squadra }, t.da_squadra);
        sendTelegramNotification('trattativa_accettata', { giocatore: t.giocatore, importo: t.prezzo, da_squadra: t.da_squadra, a_squadra: t.a_squadra }, t.a_squadra);
        sendTelegramNotification('trattativa_accettata', { giocatore: t.giocatore, importo: t.prezzo, da_squadra: t.da_squadra, a_squadra: t.a_squadra });
      }
    } catch (e) {
      alert(`Errore: ${e.message}`);
    } finally {
      setLoading(false);
      await loadAll();
    }
  }

  // Esegue tutti i trasferimenti differiti (da chiamare all'apertura del mercato)
  async function eseguiTrasferimentiDifferiti() {
    const differiti = trattative.filter(t => t.stato === 'accettata_differita');
    if (!differiti.length) { alert("Nessun trasferimento differito in attesa."); return; }
    if (!window.confirm(`Eseguire ${differiti.length} trasferiment${differiti.length > 1 ? 'i' : 'o'} differit${differiti.length > 1 ? 'i' : 'o'}?\n\n${differiti.map(t => `${t.giocatore}: ${t.a_squadra} → ${t.da_squadra} (${t.prezzo}M)`).join('\n')}`)) return;
    setLoading(true);
    let ok = 0, err = [];
    for (const t of differiti) {
      try {
        await eseguiTrasferimento(t);
        await aggiornaFantaSquadraListone(t.giocatore, t.da_squadra);
        await aggiornaStipendioDopoTrasferimento(t.giocatore, t.da_squadra);
        ok++;
      } catch(e) { err.push(`${t.giocatore}: ${e.message}`); }
    }
    setLoading(false);
    await loadAll();
    alert(`✅ ${ok} trasferimenti eseguiti${err.length ? `\n\n❌ Errori:\n${err.join('\n')}` : ''}`);
  }

  async function rispondi(t, azione) {
    if (azione === 'accettata' || azione === 'completata') {
      await eseguiAccettazione(t);
      return;
    }

    // Rifiuta: incrementa n_rifiuti, reset deadline a now+24h
    const nuoviRifiuti = (Number(t.n_rifiuti) || 0) + 1;
    await updateTrattativa(t.id, {
      stato: 'rifiutata',
      n_rifiuti: nuoviRifiuti,
      updated_at: new Date().toISOString(),
      deadline_risposta: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    // Notify the offering team that their offer was refused
    sendTelegramNotification('trattativa_rifiutata', {
      giocatore: t.giocatore,
      importo: t.prezzo,
    }, t.da_squadra);
    await loadAll();
  }

  async function inviaControfferta(t) {
    const nuovoPrezzo = parseFloat(controffertaPrezzo);
    if (!nuovoPrezzo || nuovoPrezzo <= 0) { alert("Inserisci un prezzo valido"); return; }
    const quot = t.quot_giocatore || 0;
    if (nuovoPrezzo < quot / 2) { alert(`Prezzo minimo: ${(quot/2).toFixed(2)}M (½ della quotazione)`); return; }
    // Mantiene stabili acquirente (da_squadra) e cedente (a_squadra).
    // Lo stato controproposta indica che ora deve rispondere l'acquirente.
    await updateTrattativa(t.id, {
      stato: 'controproposta',
      prezzo: nuovoPrezzo,
      n_rifiuti: (Number(t.n_rifiuti) || 0) + 1,
      note: `[CONTROFFERTA ${nuovoPrezzo}M] ${t.note || ''}`.trim(),
      updated_at: new Date().toISOString(),
      deadline_risposta: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    setControffertaId(null);
    setControffertaPrezzo("");
    await loadAll();
  }

  // ── Asta tra presidenti ───────────────────────────────────────────────────
  async function salvaAsta() {
    const quot = parseFloat(astaForm.quot) || 0;
    const prezzoBase = parseFloat((quot / 2).toFixed(2));
    if (!window.confirm(`Indire asta per ${astaForm.giocatore} (Q${quot})?\nTipo: ${astaForm.tipo_asta === 'rialzo' ? 'Al rialzo' : 'Al ribasso'} · Prezzo base: ${prezzoBase}M`)) return;
    await insertAsta({
      proprietario: mySquadra || TEAMS[0].name,
      giocatore: astaForm.giocatore,
      quot_giocatore: quot,
      tipo_asta: astaForm.tipo_asta,
      prezzo_base: prezzoBase,
      offerta_attuale: astaForm.tipo_asta === 'rialzo' ? prezzoBase : quot,
      prezzo_corrente: astaForm.tipo_asta === 'discesa' ? quot : null,
      avviata_at: new Date().toISOString(),
      scadenza_asta: astaForm.tipo_asta === 'rialzo' ? calcolaScadenzaRialzoConFreeze() : null,
      note: astaForm.note,
    });
    setShowAstaForm(false);
    setAstaForm(emptyAstaForm);
    sendTelegramNotification('asta_tra_presidenti', {
      giocatore: astaForm.giocatore,
      quotazione: quot,
      proprietario: mySquadra || TEAMS[0].name,
      tipo_asta: astaForm.tipo_asta,
      prezzo_base: prezzoBase,
      note: astaForm.note || null,
    });
    cacheInvalidate('aste');
    await loadAll();
  }

  async function annullaAsta(asta) {
    if (!window.confirm(`Annullare l'asta per ${asta.giocatore}?`)) return;
    await updateAsta(asta.id, { stato: 'annullata' });
    cacheInvalidate('aste');
    await loadAll();
  }

  // ── Offerta su asta a rialzo ───────────────────────────────────────────────
  async function faiOffertaRialzo(asta) {
    const nuova = parseFloat((asta.offerta_attuale + 0.1).toFixed(2));
    // Controlla orario (00:00-08:00 congelato, art. 5.11)
    const ora = now.getHours();
    if (isInFreeze(ora)) {
      alert("Offerte congelate dalle 00:00 alle 08:00 (art. 5.11)");
      return;
    }
    const nuovaScadenza = calcolaScadenzaRialzoConFreeze(); // 2h attivi, freeze 00-08
    await updateAsta(asta.id, {
      offerta_attuale: nuova,
      miglior_offerente: mySquadra,
      ultima_offerta_at: new Date().toISOString(),
      scadenza_asta: nuovaScadenza,
    });
    cacheInvalidate('aste');
    await loadAll();
  }

  // ── Acquisto asta a discesa ────────────────────────────────────────────────
  async function acquistaDiscesa(asta) {
    const prezzoAcquisto = prezzoDiscesaLive(asta.quot_giocatore, asta.avviata_at);
    if (!window.confirm(`Acquistare ${asta.giocatore} per ${prezzoAcquisto.toFixed(2)}M?`)) return;
    setLoading(true);
    try {
      await updateAsta(asta.id, { stato: 'aggiudicata', vincitore: mySquadra, prezzo_finale: prezzoAcquisto });
      await eseguiTrasferimento({ da_squadra: asta.da_squadra, a_squadra: mySquadra, giocatore: asta.giocatore, prezzo: prezzoAcquisto, tipo: 'cessione', quot_giocatore: asta.quot_giocatore, fuori_mercato: false, id: asta.id });
      await aggiornaFantaSquadraListone(asta.giocatore, mySquadra);
      await aggiornaStipendioDopoTrasferimento(asta.giocatore, mySquadra);
      sendTelegramNotification('asta_assegnata', { giocatore: asta.giocatore, vincitore: mySquadra, importo: prezzoAcquisto.toFixed(2) });
      await loadAll();
    } catch(e) { alert(`Errore: ${e.message}`); }
    finally { setLoading(false); }
  }

  // ── Chiusura asta a rialzo (admin o auto quando scadenza < now) ─────────────
  async function chiudiAstaRialzo(asta) {
    if (!asta.miglior_offerente) {
      if (!window.confirm(`Nessuna offerta per ${asta.giocatore}. Chiudere l'asta senza vincitore?`)) return;
      await updateAsta(asta.id, { stato: 'scaduta' });
      sendTelegramNotification('asta_assegnata', { giocatore: asta.giocatore, vincitore: null, importo: null });
      await loadAll(); return;
    }
    if (!window.confirm(`Aggiudicare ${asta.giocatore} a ${asta.miglior_offerente} per ${asta.offerta_attuale.toFixed(2)}M?`)) return;
    setLoading(true);
    try {
      await updateAsta(asta.id, { stato: 'aggiudicata', vincitore: asta.miglior_offerente, prezzo_finale: asta.offerta_attuale });
      await eseguiTrasferimento({ da_squadra: asta.da_squadra, a_squadra: asta.miglior_offerente, giocatore: asta.giocatore, prezzo: asta.offerta_attuale, tipo: 'cessione', quot_giocatore: asta.quot_giocatore, fuori_mercato: false, id: asta.id });
      await aggiornaFantaSquadraListone(asta.giocatore, asta.miglior_offerente);
      await aggiornaStipendioDopoTrasferimento(asta.giocatore, asta.miglior_offerente);
      sendTelegramNotification('asta_assegnata', { giocatore: asta.giocatore, vincitore: asta.miglior_offerente, importo: asta.offerta_attuale.toFixed(2) });
      await loadAll();
    } catch(e) { alert(`Errore: ${e.message}`); }
    finally { setLoading(false); }
  }

  // ── Helpers display ───────────────────────────────────────────────────────
  const tipoLabel = {
    cessione: "💸 Cessione", prestito_diritto: "🔄 Prestito c/Diritto",
    prestito_obbligo: "🔄 Prestito c/Obbligo", prestito_secco: "🔄 Prestito Secco",
    clausola: "⚡ Clausola Rescissoria", scambio: "🔀 Scambio",
  };

  const statoColor = { "in attesa": "#f59e0b", accettata: "#10b981", rifiutata: "#ef4444", completata: "#6366f1", scaduta: "#555", fuori_mercato: "#f97316", controproposta: "#818cf8", accettata_differita: "#f97316" };

  // Scadenza risposta (24h)
  function hoursLeft(deadline) {
    const h = Math.max(0, Math.round((new Date(deadline) - now) / 3600000));
    return h;
  }

  const horaCongelata = isInFreeze(now.getHours()); // 00:00–08:00

  const myTrattative = trattative.filter(t => t.da_squadra === mySquadra || t.a_squadra === mySquadra);
  const tutteTrattative = isAdmin ? trattative : myTrattative;
  const astePending = aste.filter(a => a.stato === 'attiva');
  const asteChiuse  = aste.filter(a => a.stato !== 'attiva');

  const sel = { padding: "8px 12px", borderRadius: 8, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12, width: "100%" };
  const inp = { ...sel };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Banner stato mercato ── */}
      {statoMercato && (
        <div style={{
          padding: "10px 16px", borderRadius: 10, marginBottom: 4,
          background: statoMercato.aperto ? "#10b98112" : "#ef444412",
          border: `1px solid ${statoMercato.aperto ? "#10b98130" : "#ef444430"}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>{statoMercato.aperto ? "🟢" : "🔴"}</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: statoMercato.aperto ? "#10b981" : "#ef4444" }}>
              Mercato {statoMercato.aperto ? `aperto — sessione ${statoMercato.periodo}` : "chiuso"}
            </div>
          </div>
        </div>
      )}

      {/* ── Switcher Mercato / Svincolati ── */}
      <div style={{ display:"flex",gap:0,background:"#ffffff08",borderRadius:12,padding:4,alignSelf:"flex-start" }}>
        {[["mercato","🤝 Mercato"],["svincolati","🔍 Svincolati"]].map(([k,l])=>(
          <button key={k} onClick={()=>setMercatoSection(k)}
            style={{ padding:"8px 20px",borderRadius:9,border:"none",background:mercatoSection===k?(k==="mercato"?"#6366f1":"#10b981"):"transparent",color:mercatoSection===k?"#fff":"#666",fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s" }}>
            {l}
          </button>
        ))}
      </div>

      {mercatoSection === "svincolati" && <SvincolatiPage profile={profile} isAdmin={isAdmin} teams={teams} />}
      {mercatoSection === "mercato" && <>

      {/* Banner notifiche offerte in attesa */}
      {offerteInAttesa.length > 0 && (
        <div style={{ background: "#ef44441a", border: "1.5px solid #ef444440", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#ef4444", letterSpacing: "0.06em" }}>
            🔔 {offerteInAttesa.length} OFFERT{offerteInAttesa.length === 1 ? "A" : "E"} IN ATTESA DI RISPOSTA
          </div>
          {offerteInAttesa.map(o => {
            const stato = calcolaStatoNotificaOfferta(o);
            const colori = { ok: "#888", warning: "#f59e0b", danger: "#f97316", critical: "#ef4444", max: "#ef4444", scaduta: "#ef4444" };
            const daTeam = teams.find(t => t.name === o.da_squadra);
            const aTeam = teams.find(t => t.name === o.a_squadra);
            return (
              <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 11, padding: "6px 0", borderBottom: "1px solid #ffffff08", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {daTeam && <TeamAvatar team={daTeam} size={18} />}
                  <span style={{ color: "#555", fontWeight: 700 }}>→</span>
                  {aTeam && <TeamAvatar team={aTeam} size={18} />}
                  <span style={{ color: "#e0e0e0", fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.giocatore}
                  </span>
                </div>
                <span style={{ color: colori[stato.urgenza], fontWeight: 700 }}>{stato.messaggio}</span>
              </div>
            );
          })}
          <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>Penalità art. 5.3: 1M dopo 24h · 3M dopo 48h · 5M dopo 72h · acquisto forzato a ½Q dopo 96h</div>
        </div>
      )}

      {/* Header + stato mercato */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>MERCATO</h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Trattative tra presidenti · aste · clausole</p>
        </div>
        {/* Badge stato mercato */}
        <div style={{ background: mercato.aperto ? "#10b98112" : "#ef444412", border: `1.5px solid ${mercato.aperto ? "#10b98133" : "#ef444433"}`, borderRadius: 12, padding: "10px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: mercato.aperto ? "#10b981" : "#ef4444", marginBottom: 4 }}>
            {mercato.aperto ? "🟢 MERCATO APERTO" : "🔴 MERCATO CHIUSO"}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: mercato.aperto ? "#10b981" : "#ef4444", fontFamily: "'Bebas Neue',sans-serif" }}>
            {mercato.aperto
              ? `${mercato.label} · chiude in ${mercato.giorniRimasti}gg`
              : `Apre ${mercato.dataApertura} · ${mercato.giorniApertura}gg`}
          </div>
          {!mercato.aperto && (
            <div style={{ fontSize: 9, color: "#666", marginTop: 3 }}>Offerte possibili — trasferimenti al 1° giorno di mercato</div>
          )}
        </div>
      </div>

      {/* ⚠️ Alert asta congelata */}
      {horaCongelata && astePending.length > 0 && (
        <div style={{ background: "#f59e0b0a", border: "1px solid #f59e0b30", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#f59e0b" }}>
          🌙 Aste sospese (00:00 – 08:00) — nessuna offerta, timer e prezzi congelati
        </div>
      )}

      {/* Tab */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #ffffff12", paddingBottom: 8 }}>
        {[["trattative","🤝 Trattative"], ["aste","🏷️ Aste"], ["storico","📋 Storico"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: tab === k ? "#6366f133" : "transparent", color: tab === k ? "#818cf8" : "#666", fontSize: 12, fontWeight: 700, cursor: "pointer", borderBottom: tab === k ? "2px solid #6366f1" : "2px solid transparent" }}>
            {l} {k === 'trattative' && tutteTrattative.filter(t => t.stato === 'in attesa').length > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: "50%", padding: "1px 5px", fontSize: 9, marginLeft: 4 }}>{tutteTrattative.filter(t => t.stato === 'in attesa').length}</span>}
            {k === 'aste' && astePending.length > 0 && <span style={{ background: "#f59e0b", color: "#000", borderRadius: "50%", padding: "1px 5px", fontSize: 9, marginLeft: 4 }}>{astePending.length}</span>}
          </button>
        ))}
      </div>

      {/* ══ TAB: TRATTATIVE ══ */}
      {tab === "trattative" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Banner trasferimenti differiti */}
          {(() => { const differiti = tutteTrattative.filter(t => t.stato === 'accettata_differita'); return differiti.length > 0 && (
            <div style={{ background: "#f9731610", border: "1.5px solid #f9731633", borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#f97316" }}>📦 TRASFERIMENTI DIFFERITI ({differiti.length}) — in attesa apertura mercato</div>
                {isAdmin && getMercatoStatus().aperto && (
                  <button onClick={eseguiTrasferimentiDifferiti} disabled={loading}
                    style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    ▶ Esegui tutti ora
                  </button>
                )}
              </div>
              {differiti.map(t => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderTop: "1px solid #ffffff08", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#ddd" }}>{t.giocatore} · {t.da_squadra} → {t.a_squadra} · {t.prezzo}M</span>
                  {isAdmin && getMercatoStatus().aperto && (
                    <button onClick={async () => { setLoading(true); try { await eseguiTrasferimento(t); await aggiornaFantaSquadraListone(t.giocatore, t.da_squadra); await aggiornaStipendioDopoTrasferimento(t.giocatore, t.da_squadra); await loadAll(); } catch(e){alert(e.message);} finally{setLoading(false);} }}
                      style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#f9731622", color: "#f97316", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                      ▶ Esegui
                    </button>
                  )}
                </div>
              ))}
              {!getMercatoStatus().aperto && <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>Il bottone "Esegui" appare automaticamente all'apertura del mercato.</div>}
            </div>
          ); })()}

          <button onClick={() => setShowForm(v => !v)} style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#a855f7)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {showForm ? "✕ Annulla" : "+ Nuova trattativa"}
          </button>


          {showForm && (
            <div style={{ background: "#ffffff08", border: "1.5px solid #6366f130", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 16 }}>📤 NUOVA TRATTATIVA</div>

              {/* STEP 0 — Solo admin: scegli la squadra mittente */}
              {isAdmin && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>SQUADRA MITTENTE</div>
                  <select
                    style={sel}
                    value={squadraMittente || ""}
                    onChange={e => {
                      const nuovaMittente = e.target.value;
                      setForm(f => ({
                        ...f,
                        squadraMittente: nuovaMittente,
                        ...(f.squadraTarget === nuovaMittente ? { squadraTarget: "", giocatoreId: "", giocatoreNome: "", quot: 0, prezzo: "" } : {}),
                      }));
                      if (form.squadraTarget === nuovaMittente) setRosaTarget([]);
                    }}
                  >
                    {teams.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 5 }}>Predefinita: la squadra associata al tuo profilo.</div>
                </div>
              )}

              {/* STEP 1 — Scegli squadra */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>1. SQUADRA DA CUI ACQUISTARE</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {teams.filter(t => t.name !== squadraMittente).map(t => (
                    <button key={t.name} onClick={() => onSquadraTargetChange(t.name)} style={{
                      padding: "6px 12px", borderRadius: 8, border: `1px solid ${form.squadraTarget === t.name ? t.color : "#ffffff15"}`,
                      background: form.squadraTarget === t.name ? t.color + "22" : "transparent",
                      color: form.squadraTarget === t.name ? t.color : "#888",
                      fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
                    }}><TeamAvatar team={t} size={22} /><span>{t.name}</span></button>
                  ))}
                </div>
              </div>

              {/* STEP 2 — Scegli giocatore */}
              {form.squadraTarget && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>2. GIOCATORE</div>
                  {loadingRosa
                    ? <div style={{ fontSize: 12, color: "#555" }}>Caricamento rosa…</div>
                    : (
                      <select style={sel} value={form.giocatoreId} onChange={e => onGiocatoreChange(e.target.value)}>
                        <option value="">— Seleziona giocatore —</option>
                        {rosaTarget
                          .slice()
                          .sort((a, b) => {
                            const ruoli = ['P','D','Ds','E','M','T','W','A','Pc'];
                            const ia = ruoli.findIndex(r => (a.ruolo || '').startsWith(r));
                            const ib = ruoli.findIndex(r => (b.ruolo || '').startsWith(r));
                            return ia - ib || a.nome.localeCompare(b.nome);
                          })
                          .map(p => {
                            const passaggi = Number(p.passaggi_sessione || 0);
                            const soloP = false; // art. 5.6 aggiornato: nessun tipo forzato
                            return (
                              <option key={p.id} value={p.id}>
                                {p.ruolo} {p.nome} — Q{p.quot} · stip {p.stip}M{passaggi >= 2 ? ` 🔒 limite sessione (${passaggi}/2 pass.)` : passaggi === 1 ? ` ⚠️ ultimo passaggio (1/2)` : ''}
                              </option>
                            );
                          })}
                      </select>
                    )
                  }
                </div>
              )}

              {/* STEP 3 — Tipo e prezzo */}
              {form.giocatoreNome && (
                <>
                  {/* Info giocatore */}
                  <div style={{ background: "#ffffff08", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                    {[
                      { l: "QUOT.",       v: `${form.quot}M`,                             c: "#f0f0f0" },
                      { l: "OFFERTA MIN", v: `${prezzoMinimo(form.quot)}M`,               c: "#10b981" },
                      { l: "CLAUSOLA",   v: `${valoreClausola(form.quot)}M`,              c: "#f59e0b" },
                      { l: "PASS. SESS.", v: `${rosaTarget.find(p=>String(p.id)===String(form.giocatoreId))?.passaggi_sessione||0}/2`, c: (rosaTarget.find(p=>String(p.id)===String(form.giocatoreId))?.passaggi_sessione||0)>=2?"#ef4444":(rosaTarget.find(p=>String(p.id)===String(form.giocatoreId))?.passaggi_sessione||0)>=1?"#f59e0b":"#888" },
                    ].map(({ l, v, c }) => (
                      <div key={l} style={{ background: "#ffffff06", borderRadius: 7, padding: "6px 10px" }}>
                        <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.07em" }}>{l}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: c, fontFamily: "'Bebas Neue',sans-serif" }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Tipo */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>3. TIPO OPERAZIONE</div>
                    {(() => {
                      const passaggi = Number(rosaTarget.find(p=>String(p.id)===String(form.giocatoreId))?.passaggi_sessione || 0);
                      const soloP = false; // art. 5.6 aggiornato: nessun tipo forzato
                      const tipi = soloP
                        ? [["prestito_secco","🔄 Prestito Secco"],["prestito_diritto","🔄 c/Diritto"],["prestito_obbligo","🔄 c/Obbligo"]]
                        : [["cessione","💸 Cessione"],["prestito_diritto","🔄 c/Diritto"],["prestito_obbligo","🔄 c/Obbligo"],["prestito_secco","🔄 Prestito Secco"],["clausola","⚡ Clausola"]];
                      return (
                        <>
                          {soloP && <div style={{ fontSize: 10, color: "#f59e0b", marginBottom: 6 }}>⚠️ Giocatore già ceduto in sessione — solo prestiti disponibili (art. 5.6)</div>}
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {tipi.map(([v, l]) => (
                              <button key={v} onClick={() => setForm(f => ({ ...f, tipo: v, prezzo: v === 'clausola' ? String(valoreClausola(f.quot)) : f.prezzo }))}
                                style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${form.tipo === v ? "#6366f1" : "#ffffff15"}`, background: form.tipo === v ? "#6366f122" : "transparent", color: form.tipo === v ? "#818cf8" : "#888", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Prezzo */}
                  <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>
                        {form.tipo === 'clausola' ? `PREZZO CLAUSOLA (=${valoreClausola(form.quot)}M)` :
                         form.tipo === 'prestito_secco' ? `PREZZO PRESTITO (min ${(form.quot*0.1).toFixed(2)}M)` :
                         form.tipo.startsWith('prestito') ? `PREZZO RISCATTO (${(form.quot*0.5).toFixed(1)}–${(form.quot*1.5).toFixed(1)}M)` :
                         `PREZZO (min ${prezzoMinimo(form.quot)}M)`}
                      </div>
                      <input style={inp} type="number" step="0.1"
                        min={form.tipo === 'clausola' ? valoreClausola(form.quot) : prezzoMinimo(form.quot)}
                        value={form.prezzo}
                        onChange={e => {
                          if (form.tipo === 'clausola') return;
                          const val = parseFloat(e.target.value);
                          const minimo = form.tipo === 'prestito_secco' ? form.quot * 0.1 : prezzoMinimo(form.quot);
                          if (!isNaN(val) && val >= minimo) setForm(f => ({ ...f, prezzo: e.target.value }));
                          else if (e.target.value === '') setForm(f => ({ ...f, prezzo: '' }));
                        }}
                        readOnly={form.tipo === 'clausola'}
                      />
                    </div>

                    {form.tipo.startsWith('prestito') && (
                      <div>
                        <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>DURATA PRESTITO</div>
                        <select style={sel} value={form.durata_mesi} onChange={e => setForm(f => ({ ...f, durata_mesi: e.target.value }))}>
                          {[6,12,18,24].map(m => <option key={m} value={m}>{m} mesi → scad. {scadenzaPrestito(m)}</option>)}
                        </select>
                      </div>
                    )}

                    {/* stipendio_a_chi rimosso — sempre a carico del ricevente */}
                  </div>

                  {/* Note */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>NOTE</div>
                    <input style={inp} placeholder="Condizioni aggiuntive…" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
                  </div>

                  {/* BONUS */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: "#666", letterSpacing: "0.08em", fontWeight: 700 }}>4. BONUS (opz.)</div>
                      <button type="button"
                        onClick={() => setForm(f => ({ ...f, bonusRows: [...f.bonusRows, { tipo_bonus: 'gol_fatti', soglia: '', valore_mln: '', direzione: 'acquirente_paga' }] }))}
                        style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #6366f144", background: "#6366f118", color: "#818cf8", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        + Aggiungi bonus
                      </button>
                    </div>

                    {form.bonusRows.length === 0 && (
                      <div style={{ fontSize: 11, color: "#444", fontStyle: "italic", marginBottom: 6 }}>Nessun bonus — clicca "+ Aggiungi bonus" per aggiungerne uno</div>
                    )}

                    {form.bonusRows.map((row, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "minmax(100px,2fr) minmax(60px,1fr) minmax(60px,1fr) minmax(80px,1.5fr) auto", gap: 6, alignItems: "end", marginBottom: 6 }}>
                        <div>
                          {idx === 0 && <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>TIPO</div>}
                          <select style={{ ...sel, fontSize: 11 }} value={row.tipo_bonus}
                            onChange={e => setForm(f => ({ ...f, bonusRows: f.bonusRows.map((r, i) => i === idx ? { ...r, tipo_bonus: e.target.value } : r) }))}>
                            {TIPI_BONUS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                          </select>
                        </div>
                        <div>
                          {idx === 0 && <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>SOGLIA ≥</div>}
                          <input style={{ ...inp, fontSize: 11 }} type="number" min="1" placeholder="es. 10"
                            value={row.soglia}
                            onChange={e => setForm(f => ({ ...f, bonusRows: f.bonusRows.map((r, i) => i === idx ? { ...r, soglia: e.target.value } : r) }))} />
                        </div>
                        <div>
                          {idx === 0 && <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>MLN</div>}
                          <input style={{ ...inp, fontSize: 11 }} type="number" step="0.5" min="0.1" placeholder="es. 2"
                            value={row.valore_mln}
                            onChange={e => setForm(f => ({ ...f, bonusRows: f.bonusRows.map((r, i) => i === idx ? { ...r, valore_mln: e.target.value } : r) }))} />
                        </div>
                        <div>
                          {idx === 0 && <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>CHI PAGA</div>}
                          <select style={{ ...sel, fontSize: 11 }} value={row.direzione}
                            onChange={e => setForm(f => ({ ...f, bonusRows: f.bonusRows.map((r, i) => i === idx ? { ...r, direzione: e.target.value } : r) }))}>
                            <option value="acquirente_paga">Acquirente</option>
                            <option value="cedente_paga">Cedente</option>
                          </select>
                        </div>
                        <button type="button" onClick={() => rimuoviBonusRow(idx)}
                          style={{ padding: "8px 10px", borderRadius: 7, border: "none", background: "#ef444418", color: "#ef4444", fontSize: 13, cursor: "pointer", marginTop: idx === 0 ? 15 : 0 }}>✕</button>
                      </div>
                    ))}

                    {form.bonusRows.length > 0 && (
                      <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>I bonus vengono verificati automaticamente ad ogni aggiornamento del listone</div>
                    )}
                  </div>

                  {!mercato.aperto && (
                    <div style={{ background: "#f9731610", border: "1px solid #f9731630", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#f97316", marginBottom: 12 }}>
                      ⚠️ Mercato chiuso — il trasferimento avverrà il primo giorno della prossima sessione (art. 5.1.1)
                    </div>
                  )}

                  <button onClick={salvaTrattativa} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    Invia offerta →
                  </button>
                </>
              )}
            </div>
          )}

          {/* Lista trattative in attesa */}
          {loading ? <div style={{ fontSize: 12, color: "#555" }}>Caricamento...</div> : (
            <>
              {/* In attesa */}
              {tutteTrattative.filter(t => t.stato === 'in attesa' || t.stato === 'controproposta').length > 0 && (
                <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em", marginBottom: 14 }}>⏳ IN ATTESA DI RISPOSTA</div>
                  {tutteTrattative.filter(t => t.stato === 'in attesa' || t.stato === 'controproposta').map(t => {
                    const hLeft = hoursLeft(t.deadline_risposta);
                    const urgente = hLeft <= 6;
                    const daTeam = teams.find(x => x.name === t.da_squadra);
                    const aTeam  = teams.find(x => x.name === t.a_squadra);
                    const squadraCheDeveRispondere = t.stato === 'controproposta' ? t.da_squadra : t.a_squadra;
                    const canRispondi = squadraCheDeveRispondere === mySquadra || isAdmin;
                    return (
                      <div key={t.id} style={{ background: urgente ? "#ef444410" : "#ffffff08", border: `1px solid ${urgente ? "#ef444430" : "#ffffff10"}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                          {daTeam && <TeamAvatar team={daTeam} size={28} />}
                          <div style={{ fontSize: 11, color: "#666" }}>→</div>
                          {aTeam && <TeamAvatar team={aTeam} size={28} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#f0f0f0" }}>{t.giocatore}</div>
                            <div style={{ fontSize: 10, color: "#888" }}>{tipoLabel[t.tipo] || t.tipo}{t.scadenza_prestito ? ` · scad. ${t.scadenza_prestito}` : ""}{t.stipendio_a_chi ? ` · stip: ${t.stipendio_a_chi}` : ""}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: "#10b981", fontFamily: "'Bebas Neue',sans-serif" }}>{t.prezzo}M</div>
                            {t.quot_giocatore > 0 && <div style={{ fontSize: 9, color: "#555" }}>Q{t.quot_giocatore} · min {prezzoMinimo(t.quot_giocatore)}M</div>}
                          </div>
                        </div>

                        {/* Info aggiuntive */}
                        {t.giocatore_scambio && <div style={{ fontSize: 11, color: "#818cf8", marginBottom: 6 }}>🔀 Contropartita: {t.giocatore_scambio}</div>}
                        {t.note && <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>📝 {t.note}</div>}
                        {t.fuori_mercato && <div style={{ fontSize: 10, color: "#f97316", marginBottom: 6 }}>📦 Trasferimento differito al 1° giorno di mercato (art. 5.1.1)</div>}

                        {/* Stato notifica con penalità art. 5.3 */}
                        {(() => {
                          const stato = calcolaStatoTrattativaMercato(t);
                          const col = URGENZA_COLORS_MERCATO[stato.urgenza] || URGENZA_COLORS_MERCATO.ok;
                          return (
                            <div style={{ fontSize: 10, color: col.text, marginBottom: 6, fontWeight: stato.urgenza !== 'ok' ? 700 : 400, background: col.bg, border: `1px solid ${col.border}`, borderRadius: 6, padding: "4px 8px", display: "inline-block" }}>
                              {stato.messaggio}
                            </div>
                          );
                        })()}

                        {/* Clausola rescissoria: dopo 2 rifiuti OPPURE dopo 48h */}
                        {(() => {
                          const stato = calcolaStatoTrattativaMercato(t);
                          const isAcquirente = t.da_squadra === mySquadra;
                          if (!stato.clausolaAttivabile || !t.quot_giocatore || !isAcquirente) return null;
                          return (
                            <div style={{ background: "#f59e0b0a", border: "1px solid #f59e0b25", borderRadius: 9, padding: "8px 12px", marginBottom: 8 }}>
                              <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 4 }}>
                                ⚡ Clausola rescissoria attivabile
                                {Number(t.n_rifiuti||0) >= 2 ? ` (${t.n_rifiuti} rifiuti/controfferte)` : " (48h trascorse)"}
                              </div>
                              <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
                                Valore: {(Number(t.quot_giocatore) * 1.75).toFixed(2)}M · Al venditore: {(Number(t.quot_giocatore) * 1.75 * 3/4).toFixed(2)}M (art. 5.5.2)
                              </div>
                              <button onClick={async () => {
                                const prezzoClaus = parseFloat((Number(t.quot_giocatore) * 1.75).toFixed(2));
                                if (!window.confirm(`Attivare clausola rescissoria per ${t.giocatore}?\nCosto: ${prezzoClaus}M (al venditore: ${(prezzoClaus*3/4).toFixed(2)}M)\nIl proprietario non può rifiutarsi.`)) return;
                                try {
                                  await rispondi({ ...t, tipo: 'clausola', prezzo: prezzoClaus }, 'accettata');
                                } catch(e) { alert(e.message); }
                              }} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "#f59e0b", color: "#000", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                                ⚡ Acquista con clausola
                              </button>
                            </div>
                          );
                        })()}

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                          {/* Countdown risposta 24h (art. 5.3) */}
                          <div style={{ fontSize: 10, color: urgente ? "#ef4444" : "#555" }}>
                            ⏱ {hLeft}h rimaste · penalità: {hLeft > 24 ? "—" : hLeft > 0 ? "1M" : hLeft === 0 ? "5M" : "96h rule"}
                          </div>
                          {canRispondi && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => rispondi(t, 'accettata')} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#10b98120", color: "#10b981", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Accetta</button>
                                <button onClick={() => rispondi(t, 'rifiutata')} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#ef444420", color: "#ef4444", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✕ Rifiuta</button>
                                <button onClick={() => { setControffertaId(t.id); setControffertaPrezzo(String(t.prezzo || "")); }}
                                  style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #f59e0b33", background: "#f59e0b12", color: "#f59e0b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                  ↩ Controfferta
                                </button>
                                {isAdmin && <button onClick={() => rispondi(t, 'completata')} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#6366f120", color: "#818cf8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✅ Completata</button>}
                              </div>
                              {/* Form controfferta inline */}
                              {controffertaId === t.id && (
                                <div style={{ background: "#f59e0b0a", border: "1px solid #f59e0b25", borderRadius: 9, padding: "10px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700 }}>Proponi:</span>
                                  <input
                                    type="number" step="0.5" placeholder={`min ${(t.quot_giocatore/2).toFixed(2)}M`}
                                    value={controffertaPrezzo}
                                    onChange={e => setControffertaPrezzo(e.target.value)}
                                    style={{ width: 80, padding: "4px 8px", borderRadius: 6, border: "1px solid #f59e0b33", background: "#0d0f14", color: "#f0f0f0", fontSize: 12 }}
                                  />
                                  <span style={{ fontSize: 11, color: "#888" }}>M</span>
                                  <button onClick={() => inviaControfferta(t)} style={{ padding: "4px 12px", borderRadius: 7, border: "none", background: "#f59e0b", color: "#000", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                                    Invia
                                  </button>
                                  <button onClick={() => { setControffertaId(null); setControffertaPrezzo(""); }} style={{ padding: "4px 8px", borderRadius: 7, border: "none", background: "#ffffff10", color: "#888", fontSize: 11, cursor: "pointer" }}>
                                    ✕
                                  </button>
                                  <span style={{ fontSize: 9, color: "#555" }}>min {(t.quot_giocatore/2).toFixed(2)}M · scambia le parti</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Nessuna trattativa attiva */}
              {tutteTrattative.filter(t => t.stato === 'in attesa' || t.stato === 'controproposta').length === 0 && (
                <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", textAlign: "center", padding: 20 }}>Nessuna trattativa in corso</div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══ TAB: ASTE ══ */}
      {tab === "aste" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {(isAdmin || mySquadra) && (
            <button onClick={() => setShowAstaForm(v => !v)} style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#f59e0b,#f97316)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              {showAstaForm ? "✕ Annulla" : "🏷️ Indici asta"}
            </button>
          )}

          {showAstaForm && (
            <div style={{ background: "#ffffff08", border: "1.5px solid #f59e0b30", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em", marginBottom: 16 }}>🏷️ NUOVA ASTA (art. 5.11)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>GIOCATORE</div>
                  <select style={inp} value={astaForm.giocatore} onChange={e => {
                    const p = myRosa.find(x => x.nome === e.target.value);
                    setAstaForm(f => ({ ...f, giocatore: e.target.value, quot: p ? String(p.quot) : f.quot }));
                  }}>
                    <option value="">— Seleziona —</option>
                    {myRosa.map(p => <option key={p.id} value={p.nome}>{p.nome} (Q{p.quot})</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>QUOTAZIONE</div>
                  <input style={inp} type="number" placeholder="es. 20" value={astaForm.quot} onChange={e => setAstaForm(f => ({ ...f, quot: e.target.value }))} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>TIPO ASTA</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {[["rialzo","📈 A rialzo (parte da quot/2, +0.1M per offerta, scade 2h dopo ultima offerta)"],["discesa","📉 A discesa (parte da quot, -0.25M ogni 30min, min quot/2)"]].map(([v, l]) => (
                      <button key={v} onClick={() => setAstaForm(f => ({ ...f, tipo_asta: v }))} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${astaForm.tipo_asta === v ? "#f59e0b" : "#ffffff15"}`, background: astaForm.tipo_asta === v ? "#f59e0b15" : "transparent", color: astaForm.tipo_asta === v ? "#f59e0b" : "#666", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{l}</button>
                    ))}
                  </div>
                </div>
                {astaForm.quot && (
                  <div style={{ gridColumn: "1 / -1", background: "#ffffff06", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#888" }}>
                    {astaForm.tipo_asta === 'rialzo'
                      ? `📈 Parte da ${(parseFloat(astaForm.quot)/2).toFixed(2)}M · si aggiudica 2h dopo l'ultima offerta`
                      : `📉 Parte da ${parseFloat(astaForm.quot).toFixed(2)}M · scende a ${(parseFloat(astaForm.quot)/2).toFixed(2)}M · chiunque può comprare in qualsiasi momento`}
                  </div>
                )}
              </div>
              <button onClick={salvaAsta} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: "#f59e0b", color: "#000", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Avvia asta →</button>
            </div>
          )}

          {/* Aste attive */}
          {astePending.length === 0
            ? <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", textAlign: "center", padding: 20 }}>Nessuna asta attiva</div>
            : astePending.map(a => {
              const prezzoLive = a.tipo_asta === 'discesa' ? prezzoDiscesaLive(a.quot_giocatore, a.avviata_at) : a.offerta_attuale;
              const isFloor = prezzoLive <= a.quot_giocatore / 2;
              const minRilancio = parseFloat((a.offerta_attuale + 0.1).toFixed(2));
              const minsAttiviPassati = Math.floor(minutiAttiviTrascorsi(a.avviata_at, now));
              const scadFra = a.tipo_asta === 'rialzo' ? minutiRimanentiRialzo(a.scadenza_asta, now) : null;

              return (
                <div key={a.id} style={{ background: "#f59e0b08", border: "1.5px solid #f59e0b25", borderRadius: 16, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em" }}>
                        {a.tipo_asta === 'rialzo' ? "📈 ASTA A RIALZO" : "📉 ASTA A DISCESA"}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#f0f0f0", marginTop: 4 }}>{a.giocatore}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>indetta da {a.proprietario} · Q{a.quot_giocatore}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 28, fontWeight: 900, color: isFloor ? "#ef4444" : "#f59e0b", fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>{prezzoLive.toFixed(2)}M</div>
                      <div style={{ fontSize: 10, color: "#555" }}>
                        {a.tipo_asta === 'rialzo' && a.miglior_offerente ? `Miglior offerta: ${a.miglior_offerente}` : ""}
                        {a.tipo_asta === 'discesa' ? `− ${Math.floor(minsAttiviPassati/30) * 0.25}M in ${minsAttiviPassati}min attivi${horaCongelata ? " (⏸ congelato)" : ""}` : ""}
                      </div>
                    </div>
                  </div>

                  {a.tipo_asta === 'rialzo' && (
                    <div style={{ marginBottom: 10 }}>
                      {scadFra !== null && <div style={{ fontSize: 11, color: scadFra === 0 ? "#ef4444" : scadFra < 30 ? "#f97316" : "#888", marginBottom: 6 }}>⏱ {scadFra === 0 ? "⏰ SCADUTA — in attesa di chiusura" : `Scade in ${scadFra < 60 ? `${scadFra} min` : `${Math.floor(scadFra/60)}h ${scadFra%60}min`}`}{horaCongelata ? " (CONGELATO)" : ""}</div>}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {a.proprietario !== mySquadra && !isAdmin && !horaCongelata && scadFra !== 0 && (
                          <button onClick={() => faiOffertaRialzo(a)} style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "#f59e0b", color: "#000", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                            📈 Offri {minRilancio}M
                          </button>
                        )}
                        {isAdmin && (scadFra === 0 || scadFra === null) && (
                          <button onClick={() => chiudiAstaRialzo(a)} disabled={loading}
                            style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "#10b981", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                            🏁 Chiudi asta e assegna
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {a.tipo_asta === 'discesa' && (
                    <div style={{ marginBottom: 10 }}>
                      {isFloor
                        ? <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700 }}>⛔ Asta scaduta — prezzo minimo raggiunto</div>
                        : horaCongelata
                          ? <div style={{ fontSize: 11, color: "#555" }}>🌙 Acquisti sospesi (00:00–08:00)</div>
                          : a.proprietario !== mySquadra && !isAdmin && (
                            <button onClick={() => acquistaDiscesa(a)} style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "#f59e0b", color: "#000", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                              🛒 Acquista ora a {prezzoLive.toFixed(2)}M
                            </button>
                          )
                      }
                    </div>
                  )}

                  {a.note && <div style={{ fontSize: 11, color: "#888", borderTop: "1px solid #ffffff0a", paddingTop: 8 }}>📝 {a.note}</div>}

                  {(a.proprietario === mySquadra || isAdmin) && (isAdmin || !a.miglior_offerente) && a.stato === 'attiva' && (
                    <div style={{ borderTop: "1px solid #ffffff0a", paddingTop: 8, marginTop: 8 }}>
                      <button onClick={() => annullaAsta(a)} style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #ef444440", background: "#ef444410", color: "#ef4444", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        ✕ Annulla asta
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          }
        </div>
      )}

      {/* ══ TAB: STORICO ══ */}
      {tab === "storico" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 6 }}>📋 STORICO TRATTATIVE</div>
          {loading ? <div style={{ fontSize: 12, color: "#555" }}>Caricamento...</div>
            : tutteTrattative.filter(t => t.stato !== 'in attesa' && t.stato !== 'controproposta').length === 0
            ? <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessuna trattativa conclusa</div>
            : tutteTrattative.filter(t => t.stato !== 'in attesa' && t.stato !== 'controproposta').map(t => {
              const daTeam = teams.find(x => x.name === t.da_squadra);
              const aTeam  = teams.find(x => x.name === t.a_squadra);
              return (
                <div key={t.id} style={{ background: "#ffffff06", border: "1px solid #ffffff10", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {daTeam && <TeamAvatar team={daTeam} size={24} />}
                  <span style={{ fontSize: 10, color: "#555" }}>→</span>
                  {aTeam && <TeamAvatar team={aTeam} size={24} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#ddd" }}>{t.giocatore} · {tipoLabel[t.tipo] || t.tipo}</div>
                    <div style={{ fontSize: 10, color: "#666" }}>{new Date(t.created_at).toLocaleDateString("it-IT")}{t.fuori_mercato ? " · fuori mercato" : ""}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#aaa", fontFamily: "'Bebas Neue',sans-serif" }}>{t.prezzo}M</div>
                  <Badge color={statoColor[t.stato] || "#888"}>{t.stato}</Badge>
                  {isAdmin && <button onClick={() => { if (window.confirm(`Eliminare la trattativa per ${t.giocatore}?`)) deleteTrattativa(t.id); }} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ef444415", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>✕</button>}
                </div>
              );
            })
          }

          {/* Aste presidenti concluse */}
          {asteChiuse.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginTop: 16, marginBottom: 6 }}>🏷️ ASTE TRA PRESIDENTI CONCLUSE</div>
              {asteChiuse.map(a => (
                <div key={a.id} style={{ background: "#ffffff06", border: "1px solid #ffffff10", borderRadius: 12, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#ddd" }}>{a.giocatore} · {a.tipo_asta === 'rialzo' ? '📈' : '📉'}</div>
                    <div style={{ fontSize: 10, color: "#666" }}>da {a.proprietario}{a.vincitore ? ` → vinto da ${a.vincitore}` : ""}</div>
                  </div>
                  {a.prezzo_finale && <div style={{ fontSize: 14, fontWeight: 800, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>{a.prezzo_finale}M</div>}
                  <Badge color={a.stato === 'aggiudicata' ? "#10b981" : "#555"}>{a.stato}</Badge>
                </div>
              ))}
            </>
          )}

          {/* Aste svincolati concluse */}
          {(() => {
            const storSvinc = asteSvinc.filter(a => a.stato !== 'raccolta_offerte').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            if (!storSvinc.length) return null;
            return (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginTop: 16, marginBottom: 6 }}>📞 ASTE SVINCOLATI CONCLUSE</div>
                {storSvinc.map(a => {
                  const statoCol = a.stato === 'assegnata' ? "#10b981" : a.stato === 'annullata' ? "#ef4444" : "#555";
                  const vincTeam = a.vincitore ? teams.find(t => t.name === a.vincitore) : null;
                  return (
                    <div key={a.id} style={{ background: "#ffffff06", border: "1px solid #ffffff10", borderRadius: 12, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      {vincTeam && <TeamAvatar team={vincTeam} size={24} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#ddd" }}>
                          {a.giocatore}
                          {a.per_vivaio && <span style={{ marginLeft: 6, fontSize: 9, background: "#10b98118", color: "#10b981", border: "1px solid #10b98130", borderRadius: 6, padding: "1px 5px" }}>🌱 Vivaio</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "#666" }}>
                          {a.ruolo} · Q{a.quot}
                          {a.vincitore ? ` · assegnato a ${a.vincitore}` : ""}
                          {a.created_at ? ` · ${new Date(a.created_at).toLocaleDateString("it-IT")}` : ""}
                        </div>
                      </div>
                      {a.prezzo_finale != null && <div style={{ fontSize: 14, fontWeight: 800, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>{Number(a.prezzo_finale).toFixed(2)}M</div>}
                      <Badge color={statoCol}>{a.stato}</Badge>
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}

    </>
    }
    </div>
  );
}
/* ─── SVINCOLATI PAGE + ASTE A BUSTA CHIUSA (art. 6.3) ──────────────────────── */

// ── Helpers per periodo e scadenze ───────────────────────────────────────────
function formatCountdown(target) {
  const diff = new Date(target) - new Date();
  if (diff <= 0) return "Scaduto";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 48) return `${Math.floor(h/24)}g ${h%24}h`;
  return `${h}h ${m}m`;
}

// ── Componente: card giocatore chiamato ───────────────────────────────────────
function ChiamataCard({ chiamateGiocatore, mySquadra, isAdmin, onInteresse, onRefresh, aste, dsMasterclass }) {
  const [saving, setSaving] = useState(false);

  if (!chiamateGiocatore?.length) return null;
  const primaria = chiamateGiocatore.find(c => c.tipo === 'prima') || chiamateGiocatore[0];
  if (!primaria) return null;

  const interessati = chiamateGiocatore.map(c => c.squadra);
  const giaInteressato = interessati.includes(mySquadra);

  const scadInt = primaria.scadenza_interesse
    ? new Date(primaria.scadenza_interesse)
    : new Date(new Date(primaria.created_at || Date.now()).getTime() + 72 * 60 * 60 * 1000);
  const scadutaInteresse = new Date() > scadInt;

  const astaAttiva    = aste?.find(a => a.giocatore === primaria.giocatore && a.stato === 'raccolta_offerte');
  const astaAssegnata = aste?.find(a => a.giocatore === primaria.giocatore && a.stato === 'assegnata');
  const isCandidatoVivaio = primaria.anni <= 23 && primaria.quot <= 3;
  const isCaller = primaria.squadra === mySquadra;

  async function handleInteresse(perVivaio) {
    setSaving(true);
    try { await aggiungiInteresse(primaria.giocatore, mySquadra, perVivaio); await onRefresh(); }
    catch(e) { alert(e.message); } finally { setSaving(false); }
  }

  async function handleAssegnaDiretto() {
    if (!window.confirm(`Assegnare ${primaria.giocatore} a ${interessati[0]} per ${(primaria.quot * 0.75).toFixed(2)}M (unico interessato)?`)) return;
    setSaving(true);
    try { await completaUnicoInteressato(primaria.giocatore); await onRefresh(); }
    catch(e) { alert(e.message); } finally { setSaving(false); }
  }

  async function handleCreaAsta() {
    if (!window.confirm(`Creare asta busta chiusa per ${primaria.giocatore}? (${interessati.length} interessati)`)) return;
    setSaving(true);
    try { await creaAstaDaChiamate(primaria.giocatore); await onRefresh(); }
    catch(e) { alert(e.message); } finally { setSaving(false); }
  }

  async function handleCancellaChiamata() {
    if (!window.confirm(`Cancellare tutte le chiamate e le aste attive per ${primaria.giocatore}?`)) return;
    setSaving(true);
    try {
      // Elimina chiamate del giocatore
      const { error: errChi } = await supabase.from('chiamate').delete().eq('giocatore', primaria.giocatore);
      if (errChi) throw errChi;
      // Annulla aste attive per questo giocatore (by ID to avoid RLS issues)
      const asteDelGiocatore = (aste || []).filter(a =>
        a.giocatore === primaria.giocatore && ['raccolta_offerte', 'aperta'].includes(a.stato)
      );
      for (const a of asteDelGiocatore) {
        await updateAstaSvincolati(a.id, { stato: 'annullata' });
      }
      await onRefresh();
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  }

  return (
    <div style={{ background: astaAttiva ? "#6366f110" : "#f59e0b08", border: `1.5px solid ${astaAttiva ? "#6366f135" : "#f59e0b25"}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#f0f0f0" }}>{primaria.giocatore}</span>
            <span style={{ fontSize: 10, color: "#888" }}>{primaria.ruolo} · {primaria.anni}aa · Q{primaria.quot}</span>
            {isCandidatoVivaio && <span style={{ fontSize: 9, background: "#10b98118", color: "#10b981", border: "1px solid #10b98130", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>🌱 Vivaio</span>}
            {primaria.per_vivaio && <span style={{ fontSize: 9, background: "#10b98118", color: "#10b981", borderRadius: 10, padding: "1px 6px" }}>→ Vivaio</span>}
            {astaAttiva && <span style={{ fontSize: 9, background: "#6366f120", color: "#818cf8", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>🏷️ Asta in corso</span>}
            {astaAssegnata && <span style={{ fontSize: 9, background: "#10b98118", color: "#10b981", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>✅ Assegnato a {astaAssegnata.vincitore}</span>}
          </div>

          {/* Interessati */}
          <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "#555" }}>Interessati:</span>
            {interessati.map((sq, i) => (
              <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: sq === mySquadra ? "#f59e0b20" : "#ffffff10", color: sq === mySquadra ? "#f59e0b" : "#aaa", fontWeight: sq === mySquadra ? 700 : 400 }}>
                {sq}
              </span>
            ))}
          </div>

          {/* Scadenze */}
          {!astaAttiva && !astaAssegnata && (
            <div style={{ fontSize: 10, color: scadutaInteresse ? "#ef4444" : "#888" }}>
              {scadutaInteresse
                ? "⌛ Scadenza interesse passata — elaborazione in corso..."
                : `⏳ Interesse aperto fino a: ${scadInt.toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} (${formatCountdown(scadInt)})`}
            </div>
          )}
          {astaAttiva && (
            <div style={{ fontSize: 10, color: "#818cf8" }}>
              🏷️ Offerte entro: {new Date(astaAttiva.scadenza).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} ({formatCountdown(astaAttiva.scadenza)})
            </div>
          )}
        </div>

        {/* Azioni */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          {/* Azioni presidente */}
          {!astaAttiva && !astaAssegnata && !giaInteressato && !scadutaInteresse && mySquadra && !isAdmin && (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => handleInteresse(false)} disabled={saving}
                style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#000", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                {saving ? "..." : "✋ Mi interesso"}
              </button>
              {isCandidatoVivaio && (
                <button onClick={() => handleInteresse(true)} disabled={saving}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #10b98140", background: "#10b98118", color: "#10b981", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  🌱 Vivaio
                </button>
              )}
            </div>
          )}
          {giaInteressato && !astaAttiva && !astaAssegnata && !isAdmin && (
            <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600 }}>✅ Sei interessato</span>
          )}
          {/* Azioni admin */}
          {isAdmin && !astaAssegnata && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
              {!astaAttiva && (scadutaInteresse ? (
                <>
                  {interessati.length === 1 ? (
                    <button onClick={handleAssegnaDiretto} disabled={saving}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {saving ? "..." : `✓ Assegna a ${interessati[0]} (¾Q)`}
                    </button>
                  ) : (
                    <button onClick={handleCreaAsta} disabled={saving}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {saving ? "..." : `🏷️ Crea Asta (${interessati.length} interessati)`}
                    </button>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 10, color: "#555" }}>In attesa scadenza interesse</span>
              ))}
              <button onClick={handleCancellaChiamata} disabled={saving}
                style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ef444430", background: "transparent", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>
                🗑 Cancella
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Form offerta se asta attiva */}
      {astaAttiva && giaInteressato && mySquadra && (
        <OffertaInlineForm asta={astaAttiva} squadra={mySquadra} onRefresh={onRefresh}
          isCaller={isCaller} dsMasterclass={dsMasterclass} />
      )}
    </div>
  );
}

// ── Form offerta busta chiusa ─────────────────────────────────────────────────
function OffertaInlineForm({ asta, squadra, onRefresh, isCaller, dsMasterclass }) {
  const [offerta, setOfferta] = useState([]);
  const [importo, setImporto] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offertaRevelata, setOffertaRevelata] = useState(null);
  const [revealingSaving, setRevealingSaving] = useState(false);

  useEffect(() => {
    if (!asta?.id) { setLoading(false); return; }
    getOfferteAsta(asta.id)
      .then(offs => {
        setOfferta(offs || []);
        const mia = (offs || []).find(o => o.squadra === squadra && !o.assente);
        if (mia) setImporto(String(mia.importo));
      })
      .catch(() => setOfferta([]))
      .finally(() => setLoading(false));
  }, [asta?.id, squadra]);

  if (!asta) return null;
  const minOfferta = parseFloat((Number(asta.quot) * 0.75).toFixed(2));
  const miaOffertaInviata = offerta.find(o => o.squadra === squadra);
  const scaduta = asta.scadenza ? new Date() > new Date(asta.scadenza) : false;

  const utilizziUsati = dsMasterclass?.dati?.utilizzi_masterclass || 0;
  const utilizziRimasti = 2 - utilizziUsati;
  const puoUsareMasterclass = isCaller && dsMasterclass && utilizziRimasti > 0 && !offertaRevelata;

  async function invia() {
    const val = parseFloat(importo);
    if (!val || val < minOfferta) { alert(`Min ${minOfferta}M`); return; }
    if (!window.confirm(`Confermare offerta di ${val.toFixed(2)}M per ${asta.giocatore}?`)) return;
    setSaving(true);
    try {
      await upsertOffertaAsta(asta.id, squadra, val, asta.per_vivaio);
      const offs = await getOfferteAsta(asta.id);
      setOfferta(offs);
      await onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function usaMasterclass() {
    if (!window.confirm(`Usare 1 utilizzo del DS Masterclass per vedere l'offerta più alta? Rimangono ${utilizziRimasti} utilizzi su 2.`)) return;
    setRevealingSaving(true);
    try {
      const offs = await getOfferteAsta(asta.id);
      const offerteAvversari = offs.filter(o => o.squadra !== squadra && !o.assente);
      const maxOfferta = offerteAvversari.length
        ? Math.max(...offerteAvversari.map(o => Number(o.importo)))
        : null;
      // Decrementa utilizzo
      const nuoviDati = { ...(dsMasterclass.dati || {}), utilizzi_masterclass: utilizziUsati + 1 };
      await updateInvestimento(dsMasterclass.id, { dati: nuoviDati });
      setOffertaRevelata(maxOfferta !== null ? maxOfferta : 0);
      await onRefresh();
    } catch(e) { alert(e.message); }
    finally { setRevealingSaving(false); }
  }

  if (loading) return null;
  if (scaduta) return <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>Asta scaduta — elaborazione in corso...</div>;

  return (
    <div style={{ marginTop: 10, background: "#6366f108", borderRadius: 9, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#818cf8", fontWeight: 700 }}>🔒 Offerta segreta:</span>
        <input type="number" step="0.25" min={minOfferta} value={importo}
          onChange={e => setImporto(e.target.value)} placeholder={`min ${minOfferta}M`}
          style={{ width: 90, padding: "4px 8px", borderRadius: 6, border: "1px solid #6366f130", background: "#0d0f14", color: "#f0f0f0", fontSize: 12 }} />
        <span style={{ fontSize: 10, color: "#555" }}>M</span>
        <button onClick={invia} disabled={saving}
          style={{ padding: "4px 14px", borderRadius: 7, border: "none", background: "#6366f1", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          {saving ? "..." : miaOffertaInviata ? "↻ Aggiorna" : "📨 Invia"}
        </button>
        {miaOffertaInviata && !miaOffertaInviata.assente && (
          <span style={{ fontSize: 10, color: "#10b981" }}>✅ {Number(miaOffertaInviata.importo).toFixed(2)}M inviata</span>
        )}
        <span style={{ fontSize: 9, color: "#444" }}>Le altre offerte sono nascoste · max = tuo bilancio</span>
      </div>

      {/* DS Masterclass */}
      {isCaller && dsMasterclass && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {offertaRevelata !== null ? (
            <span style={{ fontSize: 11, background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b30", borderRadius: 7, padding: "4px 10px", fontWeight: 700 }}>
              🔍 DS Masterclass: offerta più alta avversari = {offertaRevelata > 0 ? <b>{offertaRevelata.toFixed(2)}M</b> : "nessuna offerta"}
            </span>
          ) : puoUsareMasterclass ? (
            <button onClick={usaMasterclass} disabled={revealingSaving}
              style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #f59e0b40", background: "#f59e0b12", color: "#f59e0b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {revealingSaving ? "..." : `🔍 DS Masterclass (${utilizziRimasti}/2 rimasti)`}
            </button>
          ) : utilizziRimasti <= 0 ? (
            <span style={{ fontSize: 10, color: "#555" }}>🔍 DS Masterclass esaurito (0/2 rimasti)</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Componente risultato asta ─────────────────────────────────────────────────
function RisultatoAstaCard({ asta, isAdmin }) {
  const [offerte, setOfferte] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) getOfferteAsta(asta.id).then(setOfferte);
  }, [open, asta.id]);

  return (
    <div style={{ background: "#10b98108", border: "1px solid #10b98125", borderRadius: 12, overflow: "hidden" }}>
      <div onClick={() => setOpen(v => !v)} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>✅ {asta.giocatore}</span>
          <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>→ {asta.vincitore} · {Number(asta.prezzo_finale).toFixed(2)}M{asta.per_vivaio ? " 🌱" : ""}</span>
        </div>
        <span style={{ fontSize: 10, color: "#555" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 14px 12px" }}>
          {offerte.map((o, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid #ffffff06" }}>
              <span style={{ color: o.squadra === asta.vincitore ? "#f59e0b" : "#888", fontWeight: o.squadra === asta.vincitore ? 700 : 400 }}>
                {o.squadra === asta.vincitore ? "🏆 " : ""}{o.squadra}
                {o.assente ? <span style={{ fontSize: 9, color: "#555", marginLeft: 4 }}>(assenza)</span> : null}
              </span>
              <span style={{ color: o.squadra === asta.vincitore ? "#f59e0b" : "#555" }}>{Number(o.importo).toFixed(2)}M</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SvincolatiPage principale ─────────────────────────────────────────────────
// ── SvincolatiTable ───────────────────────────────────────────────────────────
function SvincolatiTable({ filtered, chiamateAttive, mySquadra, isAdmin, setShowCallForm, onEditAdmin }) {
  const rich = (filtered || []).map(p => ({
    ...p,
    _quotNum:  Number(p.quot  || 0),
    _stipNum:  Number(p.stip  || 0),
    _clausNum: Number(p.clausola || 0),
    _anniNum:  Number(p.anni  || 0),
  }));
  const { sorted, SortTh } = useSortableTable(rich, "_quotNum", "desc");
  const finestra = getFinestraChiamate();

  return (
    <div style={{ overflowX: "auto" }}>
      {/* Badge finestra */}
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, background: finestra.aperta ? "#10b98118" : "#ffffff08", color: finestra.aperta ? "#10b981" : "#555", border: `1px solid ${finestra.aperta ? "#10b98130" : "#ffffff10"}`, fontWeight: 600 }}>
          {finestra.messaggio}
        </span>
        {isAdmin && !finestra.aperta && <span style={{ fontSize: 9, color: "#6366f1" }}>Admin: puoi chiamare sempre</span>}
      </div>

      <table style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <SortTh col="ruolo"     label="Ruolo"  align="center" />
            <SortTh col="_anniNum"  label="Età"    align="center" />
            <SortTh col="nome"      label="Nome"   align="left"   />
            <SortTh col="_quotNum"  label="Q"      align="center" />
            <SortTh col="_stipNum"  label="Stip."  align="center" />
            <SortTh col="_clausNum" label="Claus." align="center" />
            <th style={{ padding: "6px 8px", fontSize: 10, color: "#555", borderBottom: "1px solid #ffffff12" }}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const rc = getRoleColor(p.ruolo);
            const giaChi = chiamateAttive.some(c => c.giocatore === p.nome);
            const fuori  = p.fuoriLista || p.fuori_lista;
            const canCall = isAdmin || finestra.aperta;
            return (
              <tr key={i}
                style={{ borderBottom: "1px solid #ffffff06", background: fuori ? "#ef444406" : giaChi ? "#f59e0b06" : p.isVivaio ? "#10b98106" : "transparent" }}
                onMouseEnter={e => e.currentTarget.style.background = "#ffffff08"}
                onMouseLeave={e => e.currentTarget.style.background = fuori ? "#ef444406" : giaChi ? "#f59e0b06" : p.isVivaio ? "#10b98106" : "transparent"}>
                <td style={{ padding: "7px 8px", textAlign: "center" }}>
                  <span style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`, borderRadius: 5, padding: "2px 5px", fontSize: 10, fontWeight: 700 }}>{p.ruolo}</span>
                </td>
                <td style={{ padding: "7px 8px", textAlign: "center", color: p.anni <= 21 ? "#a78bfa" : p.anni >= 31 ? "#f97316" : "#888" }}>{p.anni}</td>
                <td style={{ padding: "7px 8px", color: fuori ? "#ef4444" : "#e0e0e0", fontWeight: 600 }}>
                  {p.nome}
                  {p.isVivaio && <span style={{ marginLeft: 5, fontSize: 9, background: "#10b98120", color: "#10b981", border: "1px solid #10b98140", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>🌱</span>}
                  {fuori && <span style={{ marginLeft: 5, fontSize: 9, background: "#ef444422", color: "#ef4444", border: "1px solid #ef444455", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>FUORI</span>}
                  {giaChi && <span style={{ marginLeft: 5, fontSize: 9, background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b40", borderRadius: 4, padding: "1px 4px" }}>📞</span>}
                  {!fuori && p.anni <= 21 && !p.isVivaio && <span style={{ marginLeft: 5, fontSize: 9, background: "#8b5cf622", color: "#a78bfa", borderRadius: 4, padding: "1px 4px" }}>U21</span>}
                  {!fuori && p.anni >= 31 && <span style={{ marginLeft: 5, fontSize: 9, background: "#f9731622", color: "#fb923c", borderRadius: 4, padding: "1px 4px" }}>31+</span>}
                </td>
                <td style={{ padding: "7px 8px", textAlign: "center", fontWeight: 800, color: p.quot >= 20 ? "#f59e0b" : "#ccc", fontFamily: "'Bebas Neue',sans-serif", fontSize: 14 }}>{p.quot}</td>
                <td style={{ padding: "7px 8px", textAlign: "center", color: "#aaa" }}>{p.stip}M</td>
                <td style={{ padding: "7px 8px", textAlign: "center", color: "#666" }}>{Number(p.clausola || 0).toFixed(1)}M</td>
                <td style={{ padding: "7px 8px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                    <button
                      onClick={() => canCall && setShowCallForm(p)}
                      disabled={!canCall}
                      title={!canCall ? finestra.messaggio : ""}
                      style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: giaChi ? "#f59e0b22" : canCall ? "#ffffff0f" : "#ffffff05", color: giaChi ? "#f59e0b" : canCall ? "#888" : "#333", fontSize: 10, fontWeight: 700, cursor: canCall ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
                      {giaChi ? "📞" : canCall ? "📞 Chiama" : "🔒"}
                    </button>
                    {isAdmin && onEditAdmin && (
                      <button onClick={() => onEditAdmin(p)} style={{ padding: "4px 7px", borderRadius: 6, border: "none", background: "#6366f118", color: "#818cf8", fontSize: 10, cursor: "pointer" }}>✏️</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SvincolatiPage({ profile, isAdmin, teams }) {
  const vivaioAperto = isVivaioAcquistiAperti();
  const [search, setSearch]           = useState("");
  const [ruoloFilter, setRuoloFilter] = useState("Tutti");
  const [soloVivaio, setSoloVivaio]   = useState(false);
  const [nascondiFuori, setNascondiFuori] = useState(true); // default: fuori lista nascosti
  const [chiamate, setChiamate]       = useState([]);
  const [svincolatiDB, setSvincolatiDB] = useState([]);
  const [aste, setAste]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showCallForm, setShowCallForm] = useState(null);
  const [callTeam, setCallTeam]       = useState(profile?.squadra || TEAMS[0].name);
  const [callVivaio, setCallVivaio]   = useState(false);
  const [investimenti, setInvestimenti] = useState([]);
  const [editSvincolato, setEditSvincolato] = useState(null);
  const [importando, setImportando]   = useState(false);
  const [now, setNow]                 = useState(new Date());
  const mySquadra = profile?.squadra;

  // Tick ogni 30s per aggiornare countdown
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    const [chiamateData, svincolatiData, asteData, invData] = await Promise.all([
      getChiamate(), getSvincolatiDB(), getAsteSvincolati(),
      mySquadra ? getInvestimenti(mySquadra) : Promise.resolve([]),
    ]);
    if (chiamateData) setChiamate(chiamateData);
    if (svincolatiData) setSvincolatiDB(svincolatiData);
    setAste(asteData);
    setInvestimenti(invData || []);
    setLoading(false);
  }, [mySquadra]);

  useEffect(() => {
    loadAll();
    const sub1 = subscribeChiamate(loadAll);
    const sub2 = subscribeAsteSvincolati(loadAll);
    return () => { supabase.removeChannel(sub1); supabase.removeChannel(sub2); };
  }, [loadAll]);

  // Check scadenze ogni minuto
  useEffect(() => {
    // checkScadenzeAste: controlla ogni 3 minuti invece di 1 (le aste hanno
    // scadenza prevedibile — il watcher delle deadline invaliderà prima se serve)
    const t = setInterval(() => checkScadenzeAste().then(r => { if (r.length) loadAll(); }), 3 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Raggruppa chiamate per giocatore (solo quelle non concluse con giocatore valido)
  const chiamatePerGiocatore = Object.values(
    chiamate
      .filter(c => c.stato !== 'conclusa' && c.giocatore)
      .reduce((acc, c) => {
        if (!acc[c.giocatore]) acc[c.giocatore] = [];
        acc[c.giocatore].push(c);
        return acc;
      }, {})
  );

  // Giocatori chiamati
  const giocatoriChiamati = new Set(
    chiamatePerGiocatore
      .filter(g => g.length > 0 && g[0]?.giocatore)
      .map(g => g[0].giocatore)
  );

  async function chiamaGiocatore(player, perVivaio = false) {
    if (perVivaio && !isVivaioAcquistiAperti()) { alert('⛔ Le chiamate per il vivaio sono consentite solo dal 01/09 al 31/05.'); return; }
    const finestra = getFinestraChiamate();
    if (!finestra.aperta && !isAdmin) {
      alert(`⛔ Finestra chiusa\n\n${finestra.messaggio}`); return;
    }
    const squadra = isAdmin ? callTeam : mySquadra;
    const giaChiamato = chiamate.some(c =>
      c.giocatore === player.nome && c.squadra === squadra && c.stato !== 'conclusa'
    );
    if (giaChiamato) { alert("Hai già manifestato interesse per questo giocatore"); return; }
    if (!window.confirm(`Manifestare interesse per ${player.nome} (Q${player.quot})${perVivaio ? ' per il vivaio' : ''}?`)) return;

    await insertChiamata({
      giocatore: player.nome, ruolo: player.ruolo, quot: player.quot,
      anni: player.anni || 0, squadra_serie_a: player.squadra_serie_a || '',
      squadra, per_vivaio: perVivaio,
    });
    // Notify channel about the chiamata
    sendTelegramNotification('chiamata_svincolati', {
      giocatore: player.nome,
      quotazione: player.quot,
      squadra,
    });
    setShowCallForm(null);
    setCallVivaio(false);
    await loadAll();
  }

  // Import Excel svincolati
  async function handleImportExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImportando(true);
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const n = await importSvincolatiDaArray(rows);
      alert(`✅ Importati ${n} svincolati`);
      await loadAll();
    } catch(err) { alert("Errore: " + err.message); }
    finally { setImportando(false); e.target.value = ""; }
  }

  async function salvaEditSvincol() {
    if (!editSvincolato) return;
    await updateSvincolatoStats(editSvincolato.id, {
      partite: Number(editSvincolato.partite||0),
      media_voto: Number(editSvincolato.media_voto||0),
      media_fantavoto: Number(editSvincolato.media_fantavoto||0),
      gol: Number(editSvincolato.gol||0),
      assist: Number(editSvincolato.assist||0),
      quot: Number(editSvincolato.quot||0),
      fuori_lista: Boolean(editSvincolato.fuori_lista),
    });
    setEditSvincolato(null);
    await loadAll();
  }

  // Filtri lista
  const gruppoRuoli = {
    "Tutti": null, "⚠️ Fuori Lista": "fuori",
    "Por": ["Por"],
    "Difensori": ["Dc","Dd","Ds","B","Ds;Dc","Dd;Dc","Ds;E","Dd;E","Dd;Ds;E","B;Ds;E","B;Dd;E","B;Dd","B;Ds"],
    "Centrocampisti": ["E","E;M","E;W","M","M;C","C","C;W","C;T"],
    "Trequartisti": ["T","W","W;T","T;A","W;T;A"],
    "Attaccanti": ["W;A","A","Pc"],
  };

  const finestra = getFinestraChiamate();
  const inpStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 13 };
  const inpSm = { padding: "4px 6px", borderRadius: 6, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11 };

  const filtered = svincolatiDB.filter(p => {
    if (ruoloFilter === "⚠️ Fuori Lista") return p.fuori_lista;
    if (nascondiFuori && p.fuori_lista) return false; // nascondi fuori lista di default
    if (soloVivaio) {
      if (!(p.anni <= 23 && p.quot <= 3 && (p.partite === 0 || p.partite == null))) return false;
    }
    if (ruoloFilter !== "Tutti" && ruoloFilter !== "⚠️ Fuori Lista") {
      const gruppo = gruppoRuoli[ruoloFilter];
      if (gruppo && !gruppo.some(r => p.ruolo === r || p.ruolo.startsWith(r + ";"))) return false;
    }
    if (search && !p.nome.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).map(p => ({
    ...p,
    fuoriLista: p.fuori_lista,
    clausola: p.clausola || parseFloat((p.quot * 1.75).toFixed(2)),
    isVivaio: p.anni <= 23 && p.quot <= 3 && (p.partite === 0 || p.partite == null),
    isChiamato: giocatoriChiamati.has(p.nome),
  }));

  // Aste concluse (storico)
  const asteConcluse = aste.filter(a => a.stato === 'assegnata');
  const asteAttive   = aste.filter(a => a.stato === 'raccolta_offerte');

  const dsMasterclass = investimenti.find(i => i.nome === 'DS Masterclass');

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>SVINCOLATI</h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{svincolatiDB.length} giocatori disponibili · live</p>
        </div>
        {/* Badge finestra */}
        <div style={{ fontSize: 11, padding: "5px 12px", borderRadius: 20, background: finestra.aperta ? "#10b98112" : "#ffffff08", color: finestra.aperta ? "#10b981" : "#555", border: `1px solid ${finestra.aperta ? "#10b98130" : "#ffffff10"}`, fontWeight: 600 }}>
          {finestra.messaggio}
        </div>
      </div>

      {/* ── GIOCATORI CHIAMATI (in cima, visibili a tutti) ── */}
      {chiamatePerGiocatore.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em" }}>
            📞 CHIAMATE ATTIVE ({chiamatePerGiocatore.length})
          </div>
          {chiamatePerGiocatore.map((gruppo, i) => {
            try {
              return (
                <ChiamataCard
                  key={i}
                  chiamateGiocatore={gruppo}
                  mySquadra={mySquadra}
                  isAdmin={isAdmin}
                  onInteresse={() => {}}
                  onRefresh={loadAll}
                  aste={aste}
                  dsMasterclass={dsMasterclass}
                />
              );
            } catch(e) {
              return <div key={i} style={{ fontSize: 11, color: "#ef4444", padding: 8 }}>Errore card: {e.message}</div>;
            }
          })}
        </div>
      )}

      {/* ── ASTE IN CORSO (busta chiusa) ── */}
      {asteAttive.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", letterSpacing: "0.08em" }}>
            🏷️ ASTE IN CORSO — OFFERTE BUSTA CHIUSA ({asteAttive.length})
          </div>
          {asteAttive.map(asta => {
            const scaduta = asta.scadenza ? new Date() > new Date(asta.scadenza) : false;
            const interessatiAsta = chiamate.filter(c => c.giocatore === asta.giocatore && c.stato === 'in_asta');
            const giaInteressato = interessatiAsta.some(c => c.squadra === mySquadra);
            const isPrimoChiamante = interessatiAsta.some(c => c.squadra === mySquadra && c.tipo === 'prima');
            return (
              <div key={asta.id} style={{ background: scaduta ? "#ef444408" : "#6366f108", border: `1.5px solid ${scaduta ? "#ef444430" : "#6366f130"}`, borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#f0f0f0" }}>{asta.giocatore}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{asta.ruolo} · {asta.anni}aa · Q{asta.quot} · base ¾Q = {(asta.quot * 0.75).toFixed(2)}M</div>
                    <div style={{ fontSize: 10, color: scaduta ? "#ef4444" : "#818cf8", marginTop: 4 }}>
                      {scaduta ? "⏰ Scadenza offerte passata" : `⏳ Offerte entro: ${new Date(asta.scadenza).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} (${formatCountdown(asta.scadenza)})`}
                    </div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                      Interessati: {interessatiAsta.map(c => c.squadra).join(", ") || "—"}
                    </div>
                  </div>
                  {/* Admin: rivela o cancella */}
                  {isAdmin && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                      {/* DS Masterclass notification */}
                      <button
                        onClick={async () => {
                          try {
                            // Get all offers so far
                            const offerte = await getOfferteAsta(asta.id);
                            // Get all teams interested in this auction (from chiamate)
                            const { data: chiamateAsta } = await supabase
                              .from('chiamate').select('squadra').eq('giocatore', asta.giocatore);
                            const squadreInteressate = (chiamateAsta || []).map(c => c.squadra);
                            // Get all investments named 'DS Masterclass' for interested teams
                            const { data: dsInvs } = await supabase
                              .from('investimenti')
                              .select('squadra, dati')
                              .eq('nome', 'DS Masterclass')
                              .in('squadra', squadreInteressate);
                            const dsTeams = (dsInvs || []).filter(d => {
                              const usati = d.dati?.utilizzi_masterclass || 0;
                              return usati < 2;
                            });
                            if (!dsTeams.length) { alert('Nessun presidente con DS Masterclass attivo e utilizzi rimasti.'); return; }
                            // Build offer summary (hide own offer, show others)
                            for (const ds of dsTeams) {
                              const altrui = offerte.filter(o => o.squadra !== ds.squadra && !o.assente);
                              const riepilogo = altrui.length
                                ? altrui.map(o => `• ${o.squadra}: ${Number(o.importo).toFixed(2)}M`).join('\n')
                                : 'Nessuna offerta ancora presente.';
                              sendTelegramNotification('ds_masterclass_offerte', {
                                giocatore: asta.giocatore,
                                riepilogo,
                                scadenza: new Date(asta.scadenza).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                              }, ds.squadra);
                            }
                            alert(`✅ Notifica inviata a ${dsTeams.length} presidente/i DS Masterclass.`);
                          } catch(e) { alert(e.message); }
                        }}
                        style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #f59e0b50", background: "#f59e0b10", color: "#f59e0b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        📡 Notifica DS Masterclass
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Rivelare le offerte e assegnare ${asta.giocatore}?`)) return;
                          try {
                            await rivelaAsta(asta.id);
                            await loadAll();
                            // Notify channel + winner/losers
                            sendTelegramNotification('asta_svincolati', {
                              giocatore: asta.giocatore,
                              quotazione: asta.quotazione,
                              squadra: asta.vincitore || '—',
                              ore: 0,
                            });
                            if (asta.vincitore) {
                              sendTelegramNotification('asta_vinta', {
                                giocatore: asta.giocatore,
                                importo: asta.offerta_attuale,
                              }, asta.vincitore);
                            }
                            // Notify losers
                            const tutteOfferte = await getOfferteAsta(asta.id);
                            for (const off of (tutteOfferte || [])) {
                              if (off.squadra !== asta.vincitore) {
                                sendTelegramNotification('asta_persa', {
                                  giocatore: asta.giocatore,
                                  vincitore: asta.vincitore || '—',
                                  importo: asta.offerta_attuale,
                                }, off.squadra);
                              }
                            }
                          }
                          catch(e) { alert(e.message); }
                        }}
                        style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: scaduta ? "#10b981" : "#6366f1", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        🏁 Rivela e Assegna
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Annullare l'asta per ${asta.giocatore}? Le chiamate saranno riaperte.`)) return;
                          try {
                            await updateAstaSvincolati(asta.id, { stato: 'annullata' });
                            await supabase.from('chiamate').update({ stato: 'aperta', asta_id: null }).eq('giocatore', asta.giocatore).eq('stato', 'in_asta');
                            await loadAll();
                          } catch(e) { alert(e.message); }
                        }}
                        style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ef444430", background: "transparent", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>
                        🗑 Annulla asta
                      </button>
                    </div>
                  )}
                </div>
                {/* Form offerta presidente interessato */}
                {giaInteressato && !scaduta && (
                  <OffertaInlineForm asta={asta} squadra={mySquadra} onRefresh={loadAll}
                    isCaller={isPrimoChiamante} dsMasterclass={dsMasterclass} />
                )}
                {giaInteressato && scaduta && (
                  <div style={{ fontSize: 11, color: "#555", fontStyle: "italic", marginTop: 6 }}>Offerte chiuse — in attesa di rivelazione</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── STORICO ASTE ── */}
      {asteConcluse.length > 0 && (
        <details style={{ background: "#ffffff04", border: "1px solid #ffffff08", borderRadius: 12 }}>
          <summary style={{ padding: "10px 14px", cursor: "pointer", fontSize: 11, color: "#555", fontWeight: 700 }}>
            📋 Aste concluse ({asteConcluse.length})
          </summary>
          <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            {asteConcluse.map(a => (
              <RisultatoAstaCard key={a.id} asta={a} isAdmin={isAdmin} />
            ))}
          </div>
        </details>
      )}

      {/* ── LISTA SVINCOLATI ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>

        {/* Filtri */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
          <input
            type="text" placeholder="🔍 Cerca giocatore..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inpStyle, flex: 1, minWidth: 140 }}
          />
          <select value={ruoloFilter} onChange={e => setRuoloFilter(e.target.value)} style={inpStyle}>
            {Object.keys(gruppoRuoli).map(k => <option key={k}>{k}</option>)}
          </select>
          <button onClick={() => setSoloVivaio(v => !v)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${soloVivaio ? "#10b98160" : "#ffffff18"}`, background: soloVivaio ? "#10b98118" : "transparent", color: soloVivaio ? "#10b981" : "#666", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            🌱 Solo Vivaio
          </button>
          <button onClick={() => setNascondiFuori(v => !v)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${nascondiFuori ? "#ef444460" : "#ffffff18"}`, background: nascondiFuori ? "#ef444418" : "transparent", color: nascondiFuori ? "#ef4444" : "#666", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {nascondiFuori ? "⚠️ Mostra Fuori Lista" : "✕ Nascondi Fuori Lista"}
          </button>
          {isAdmin && (
            <label style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ffffff18", background: "#ffffff08", color: "#888", fontSize: 11, cursor: "pointer" }}>
              {importando ? "⏳ Import..." : "📥 Import Excel"}
              <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImportExcel} disabled={importando} />
            </label>
          )}
        </div>

        {/* Info colonne */}
        <div style={{ fontSize: 10, color: "#444", marginBottom: 8, display: "flex", gap: 12 }}>
          <span>🌱 = Candidato vivaio (≤23aa, Q≤3, 0 presenze)</span>
          <span>📞 = In lista chiamate attive</span>
        </div>

        {/* Tabella */}
        <SvincolatiTable
          filtered={filtered}
          chiamateAttive={chiamate.filter(c => c.stato !== 'conclusa')}
          mySquadra={mySquadra}
          isAdmin={isAdmin}
          setShowCallForm={setShowCallForm}
          onEditAdmin={isAdmin ? (p) => setEditSvincolato({ ...p }) : null}
        />
      </div>

      {/* ── FORM CHIAMATA (modal overlay) ── */}
      {showCallForm && (
        <div onClick={() => { setShowCallForm(null); setCallVivaio(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 9000, background: "#00000088", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#1a1d26", border: "1.5px solid #f59e0b44", borderRadius: 16, padding: 22, width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 12px 48px #00000099" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b" }}>📞 {showCallForm.nome}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Q{showCallForm.quot} · {showCallForm.ruolo} · {showCallForm.anni}aa</div>
              </div>
              <button onClick={() => { setShowCallForm(null); setCallVivaio(false); }}
                style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>✕</button>
            </div>
            {/* Squadra */}
            <div>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>SQUADRA INTERESSATA</div>
              {isAdmin
                ? <select style={{ ...inpStyle, width: "100%" }} value={callTeam} onChange={e => setCallTeam(e.target.value)}>
                    {TEAMS.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                : <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 700 }}>{mySquadra}</span>}
            </div>
            {/* Destinazione: Rosa o Vivaio */}
            {showCallForm.isVivaio && (
              <div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>DESTINAZIONE</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCallVivaio(false)}
                    style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1.5px solid ${!callVivaio ? "#f59e0b" : "#ffffff15"}`, background: !callVivaio ? "#f59e0b18" : "#ffffff08", color: !callVivaio ? "#f59e0b" : "#666", fontSize: 12, fontWeight: !callVivaio ? 700 : 400, cursor: "pointer" }}>
                    ⚽ Rosa
                  </button>
                  <button onClick={() => vivaioAperto && setCallVivaio(true)} disabled={!vivaioAperto}
                    title={vivaioAperto ? "Inserisci nel vivaio" : "Vivaio disponibile dal 01/09 al 31/05"}
                    style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1.5px solid ${callVivaio ? "#10b981" : "#ffffff15"}`, background: callVivaio ? "#10b98118" : "#ffffff08", color: callVivaio ? "#10b981" : "#666", fontSize: 12, fontWeight: callVivaio ? 700 : 400, cursor: vivaioAperto ? "pointer" : "not-allowed", opacity: vivaioAperto ? 1 : 0.45 }}>
                    🌱 Vivaio{!vivaioAperto ? " (dal 01/09)" : ""}
                  </button>
                </div>
              </div>
            )}
            {/* Preview scadenze */}
            <div style={{ fontSize: 10, color: "#666", background: "#ffffff06", borderRadius: 8, padding: "10px 12px", lineHeight: 1.8 }}>
              {(() => {
                const scInt = calcolaScadenzaInteresse();
                const scOff = calcolaScadenzaOfferte(scInt);
                const minOfferta = parseFloat((showCallForm.quot * 0.75).toFixed(2));
                return <>
                  📅 Interesse aperto fino a: <b style={{ color: "#f59e0b" }}>{scInt.toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</b><br/>
                  🏷️ Se più interessati → asta busta chiusa<br/>
                  <span style={{ color: "#10b981" }}>✓ Se solo tu → giocatore a <b>¾Q = {minOfferta}M</b> automaticamente</span>
                </>;
              })()}
            </div>
            {/* Azioni */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => chiamaGiocatore(showCallForm, callVivaio)}
                style={{ flex: 1, padding: "11px", borderRadius: 10, border: "none", background: "#f59e0b", color: "#000", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ✓ Manifesta interesse
              </button>
              <button onClick={() => { setShowCallForm(null); setCallVivaio(false); }}
                style={{ padding: "11px 16px", borderRadius: 10, border: "none", background: "#ffffff10", color: "#888", fontSize: 13, cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT SVINCOLATO (admin) ── */}
      {editSvincolato && isAdmin && (
        <div style={{ background: "#6366f108", border: "1px solid #6366f130", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", marginBottom: 12 }}>✏️ Modifica {editSvincolato.nome}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px,1fr))", gap: 8, marginBottom: 12 }}>
            {[["Quota","quot"],["Partite","partite"],["Media Voto","media_voto"],["Media FV","media_fantavoto"],["Gol","gol"],["Assist","assist"]].map(([l,k]) => (
              <div key={k}>
                <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>{l}</div>
                <input type="number" step="0.01" value={editSvincolato[k]||0}
                  onChange={e => setEditSvincolato(s => ({...s, [k]: e.target.value}))}
                  style={{ ...inpSm, width: "100%" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={salvaEditSvincol} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#10b981", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Salva</button>
            <button onClick={() => setEditSvincolato(null)} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#ffffff10", color: "#888", fontSize: 12, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── MODIFICA ROSA TABLE ────────────────────────────────────────────────────── */
function ModificaRosaTable({ rosa, editGiocatore, setEditGiocatore, salvaGiocatore, eliminaGiocatore, ruoli, inp }) {
  const rich = rosa.map(p => ({
    ...p,
    _quotNum: Number(p.quot || 0),
  }));
  const { sorted, SortTh } = useSortableTable(rich, "_quotNum", "desc");

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ffffff15" }}>
            <SortTh col="ruolo" label="Ruolo" align="center" />
            <SortTh col="anni"  label="Età"   align="center" />
            <SortTh col="nome"  label="Nome"  align="left"   />
            <SortTh col="_quotNum" label="Q"  align="center" />
            <th style={{ padding: "6px 8px", fontSize: 10, color: "#555" }}>Stip.</th>
            <th style={{ padding: "6px 8px", fontSize: 10, color: "#555" }}>Clausola</th>
            <th style={{ padding: "6px 8px", fontSize: 10, color: "#555" }}>Azioni</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const rc = getRoleColor(p.ruolo);
            const isEdit = editGiocatore?.id === p.id;
            return (
              <tr key={p.id}
                style={{ borderBottom: "1px solid #ffffff06", background: isEdit ? "#6366f110" : "transparent" }}
                onMouseEnter={e => { if (!isEdit) e.currentTarget.style.background = "#ffffff06"; }}
                onMouseLeave={e => { if (!isEdit) e.currentTarget.style.background = "transparent"; }}>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                  {isEdit
                    ? <select style={{ ...inp, width: 70 }} value={editGiocatore.ruolo} onChange={e => setEditGiocatore(f => ({ ...f, ruolo: e.target.value }))}>
                        {ruoli.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    : <span style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`, borderRadius: 5, padding: "2px 5px", fontSize: 10, fontWeight: 700 }}>{p.ruolo}</span>}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center", color: "#888" }}>
                  {isEdit
                    ? <input style={{ ...inp, width: 50 }} type="number" value={editGiocatore.anni} onChange={e => setEditGiocatore(f => ({ ...f, anni: e.target.value }))} />
                    : p.anni}
                </td>
                <td style={{ padding: "6px 8px", color: "#e0e0e0", fontWeight: 600 }}>
                  {isEdit
                    ? <input style={inp} type="text" value={editGiocatore.nome} onChange={e => setEditGiocatore(f => ({ ...f, nome: e.target.value }))} />
                    : <>{p.nome}{p.in_vivaio && <span style={{ marginLeft: 5, fontSize: 9, background: "#10b98120", color: "#10b981", borderRadius: 4, padding: "1px 4px" }}>🌱</span>}</>}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center", color: "#f59e0b", fontWeight: 800, fontFamily: "'Bebas Neue',sans-serif", fontSize: 14 }}>
                  {isEdit
                    ? <input style={{ ...inp, width: 60 }} type="number" step="0.5" value={editGiocatore.quot} onChange={e => setEditGiocatore(f => ({ ...f, quot: e.target.value, stip: parseFloat((e.target.value/5).toFixed(2)) }))} />
                    : p.quot}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center", color: "#aaa" }}>
                  {isEdit
                    ? <input style={{ ...inp, width: 70 }} type="number" step="0.01" value={editGiocatore.stip} onChange={e => setEditGiocatore(f => ({ ...f, stip: e.target.value }))} />
                    : `${Number(p.stip).toFixed(2)}M`}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center", color: "#666" }}>
                  {isEdit
                    ? <input style={{ ...inp, width: 70 }} type="number" step="0.01" value={editGiocatore.clausola} onChange={e => setEditGiocatore(f => ({ ...f, clausola: e.target.value }))} />
                    : `${Number(p.clausola || 0).toFixed(2)}M`}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                  {isEdit ? (
                    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                      <button onClick={salvaGiocatore} style={{ padding: "3px 10px", borderRadius: 6, border: "none", background: "#10b981", color: "#000", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>✓</button>
                      <button onClick={() => setEditGiocatore(null)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ffffff12", color: "#888", fontSize: 10, cursor: "pointer" }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                      <button onClick={() => setEditGiocatore({ ...p })} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#6366f122", color: "#818cf8", fontSize: 10, cursor: "pointer" }}>✏️</button>
                      <button onClick={() => eliminaGiocatore(p.id)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ef444418", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>✕</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AggiornamentoContrattiSection({ onRefresh }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [risultato, setRisultato] = useState(null);

  async function esegui() {
    if (!window.confirm(
      "Aggiornare tutti i contratti al 01/06?\n\n" +
      "• Incrementa anni_contratto per tutti i giocatori\n" +
      "• Applica aumenti stipendio (+10%, +20% al biennio)\n" +
      "• Svincola automaticamente chi non ha confermato il rinnovo biennale\n\n" +
      "Operazione irreversibile."
    )) return;
    setRunning(true);
    setRisultato(null);
    try {
      const res = await aggiornaContrattiAnnuali();
      setRisultato(res);
      await onRefresh();
    } catch(e) { alert("Errore: " + e.message); }
    finally { setRunning(false); }
  }

  return (
    <div style={{ background: "#10b98108", border: "1.5px solid #10b98125", borderRadius: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", letterSpacing: "0.08em" }}>📅 AGGIORNAMENTO CONTRATTI 01/06 (art. 4.8)</div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Avanza anni contratto · applica aumenti stipendio · svincola chi non ha rinnovato</div>
        </div>
        <span style={{ color: "#555" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "#ffffff06", borderRadius: 8, padding: "8px 12px", fontSize: 10, color: "#666" }}>
            ⚠️ Da eseguire il <b style={{ color: "#aaa" }}>01/06</b> dopo aver raccolto le conferme di rinnovo da tutti i presidenti. I giocatori senza conferma vengono svincolati automaticamente.
          </div>
          <button onClick={esegui} disabled={running}
            style={{ padding: "9px 20px", borderRadius: 9, border: "none", background: "#10b981", color: "#000", fontSize: 13, fontWeight: 800, cursor: "pointer", alignSelf: "flex-start" }}>
            {running ? "⏳ Elaborazione..." : "▶ Esegui aggiornamento 01/06"}
          </button>
          {risultato && (
            <div style={{ background: "#10b98115", border: "1px solid #10b98133", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
              <div style={{ color: "#10b981", fontWeight: 700, marginBottom: 6 }}>
                ✅ {risultato.aggiornati.length} contratti aggiornati · {risultato.svincolati.length} giocatori svincolati
              </div>
              {risultato.svincolati.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, marginBottom: 4 }}>SVINCOLATI AUTOMATICAMENTE:</div>
                  {risultato.svincolati.map((p, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#fca5a5", marginLeft: 8 }}>• {p.nome} ({p.squadra})</div>
                  ))}
                </div>
              )}
              {risultato.aggiornati.filter(p => p.percAumento !== 0).length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 4 }}>STIPENDI AGGIORNATI:</div>
                  {risultato.aggiornati.filter(p => p.percAumento !== 0).map((p, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#aaa", marginLeft: 8 }}>
                      • {p.nome} ({p.squadra}) — anno {p.acPrima}→{p.acDopo} · {p.stipPrima.toFixed(2)}M → {p.stipDopo.toFixed(2)}M ({p.percAumento > 0 ? "+" : ""}{p.percAumento}%)
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImportListoneSection() {
  const [openListone, setOpenListone] = useState(false);
  const [importandoL, setImportandoL] = useState(false);
  const [resultListone, setResultListone] = useState(null);
  const [bonusCompletati, setBonusCompletati] = useState(null);

  async function handleImportListone(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImportandoL(true);
    setResultListone(null);
    setBonusCompletati(null);
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const n = await importListoneDaExcel(rows);
      setResultListone(n);
      const completati = await checkECompletaBonus();
      setBonusCompletati(completati);
    } catch(err) { alert("Errore import listone: " + err.message); }
    finally { setImportandoL(false); e.target.value = ""; }
  }

  return (
    <div style={{ background: "#6366f108", border: "1.5px solid #6366f125", borderRadius: 14, overflow: "hidden" }}>
      <div onClick={() => setOpenListone(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: "0.08em" }}>📋 IMPORT LISTONE SETTIMANALE (database giocatori)</div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Aggiorna statistiche rosa + controlla bonus trattativa automaticamente</div>
        </div>
        <span style={{ color: "#555" }}>{openListone ? "▲" : "▼"}</span>
      </div>
      {openListone && (
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "#ffffff06", borderRadius: 8, padding: "8px 12px", fontSize: 10, color: "#666" }}>
            📋 Carica il file <b style={{ color: "#aaa" }}>Database_Fanta.xlsx</b> — aggiorna le statistiche di tutti i giocatori in rosa e controlla automaticamente i bonus delle trattative. Quot e stipendio in rosa non vengono toccati (solo statistiche).
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 9, background: "#6366f122", color: "#818cf8", fontSize: 12, fontWeight: 700, cursor: "pointer", alignSelf: "flex-start" }}>
            {importandoL ? "⏳ Elaborazione..." : "📥 Carica Database_Fanta.xlsx"}
            <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImportListone} disabled={importandoL} />
          </label>
          {resultListone !== null && (
            <div style={{ background: "#10b98115", border: "1px solid #10b98133", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#10b981", fontWeight: 600 }}>
              ✅ Importati {resultListone} giocatori nel listone
              {bonusCompletati?.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#f59e0b" }}>
                  ⚡ {bonusCompletati.length} bonus completati automaticamente:
                  {bonusCompletati.map((b, i) => (
                    <div key={i} style={{ marginLeft: 8, color: "#aaa", marginTop: 2 }}>• {b.giocatore} — {b.tipo} → {b.importo}M da {b.squadraPaga} a {b.squadraRiceve}</div>
                  ))}
                </div>
              )}
              {bonusCompletati?.length === 0 && <div style={{ marginTop: 4, fontSize: 11, color: "#555" }}>Nessun bonus completato questa settimana</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModificaRosePage({ teams, onRefresh, isAdmin = true }) {
  const [squadraSelezionata, setSquadraSelezionata] = useState(teams[0]?.name || "");
  const [rosa, setRosa] = useState([]);
  const [loadingRosa, setLoadingRosa] = useState(false);
  const [editSquadra, setEditSquadra] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editGiocatore, setEditGiocatore] = useState(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ nome: "", ruolo: "A", anni: "", quot: "", stip: "", clausola: "", squadra_serie_a: "" });

  // ── Import quotazioni da Excel ──────────────────────────────────────────────
  const [importQuote, setImportQuote] = useState(false);
  const [anteprima, setAnteprima] = useState(null); // array differenze
  const [importando, setImportando] = useState(false);
  const [applicando, setApplicando] = useState(false);
  const [tipoAggiornamento, setTipoAggiornamento] = useState("01/06");
  const [filtroAnteprima, setFiltroAnteprima] = useState("tutti"); // "tutti"|"rialzi"|"ribassi"|"invariati"

  async function handleImportQuotazioni(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImportando(true);
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const diff = await calcolaAnteprimaAggiornamentoQuote(rows);
      setAnteprima(diff);
    } catch(err) { alert("Errore import: " + err.message); }
    finally { setImportando(false); e.target.value = ""; }
  }

  async function handleApplicaQuotazioni() {
    if (!anteprima?.length) return;
    const daApplicare = anteprima.filter(p => p.delta !== 0);
    if (!window.confirm(`Applicare le nuove quotazioni a ${daApplicare.length} giocatori?\n\nQuesto aggiornerà quot, stip (Q/5) e clausola (Q×1.75) per ogni giocatore modificato.\n\nL'operazione è irreversibile.`)) return;
    setApplicando(true);
    try {
      const n = await applicaAggiornamentoQuote(daApplicare, tipoAggiornamento);
      alert(`✅ Aggiornati ${n} giocatori`);
      setAnteprima(null);
      setImportQuote(false);
      await onRefresh();
    } catch(e) { alert(`Errore: ${e.message}`); }
    finally { setApplicando(false); }
  }

  const anteprimaFiltrata = anteprima?.filter(p => {
    if (filtroAnteprima === "rialzi")   return p.delta > 0;
    if (filtroAnteprima === "ribassi")  return p.delta < 0;
    if (filtroAnteprima === "invariati") return p.delta === 0;
    return true;
  });

  const rialziCount   = anteprima?.filter(p => p.delta > 0).length || 0;
  const ribassiCount  = anteprima?.filter(p => p.delta < 0).length || 0;
  const invariatiCount = anteprima?.filter(p => p.delta === 0).length || 0;
  // ────────────────────────────────────────────────────────────────────────────

  const team = teams.find(t => t.name === squadraSelezionata);

  const loadRosa = useCallback(async () => {
    if (!squadraSelezionata) return;
    setLoadingRosa(true);
    const data = await getRosa(squadraSelezionata);
    if (data) setRosa(data);
    setLoadingRosa(false);
  }, [squadraSelezionata]);

  useEffect(() => { loadRosa(); }, [loadRosa]);

  // Init squadra edit form
  useEffect(() => {
    if (team) setEditSquadra({
      bilancio: team.bilancio,
      salary_used: team.salaryUsed,
      giocatori: team.giocatori,
      u21: team.u21,
      fair_play1: team.fairPlay1,
      fair_play2: team.fairPlay2,
      penalita: team.penalita,
      allenatore: team.allenatore,
    });
  }, [squadraSelezionata, team?.name]);

  async function salvaSquadra() {
    setSaving(true);
    await updateSquadra(squadraSelezionata, editSquadra);
    await onRefresh();
    setSaving(false);
  }

  async function salvaGiocatore() {
    if (!editGiocatore) return;
    await updateGiocatore(editGiocatore.id, {
      nome: editGiocatore.nome, ruolo: editGiocatore.ruolo, anni: editGiocatore.anni,
      quot: editGiocatore.quot, stip: editGiocatore.stip, clausola: editGiocatore.clausola,
      squadra_serie_a: editGiocatore.squadra_serie_a,
    });
    setEditGiocatore(null);
    await loadRosa();
  }

  async function eliminaGiocatore(id) {
    if (!window.confirm("Rimuovere giocatore dalla rosa?")) return;
    await deleteGiocatore(id);
    await loadRosa();
  }

  async function aggiungiGiocatore() {
    if (!newPlayer.nome || !newPlayer.ruolo) return;
    await insertGiocatore({ ...newPlayer, squadra: squadraSelezionata, anni: Number(newPlayer.anni), quot: Number(newPlayer.quot), stip: Number(newPlayer.stip), clausola: Number(newPlayer.clausola) });
    setShowAddPlayer(false);
    setNewPlayer({ nome: "", ruolo: "A", anni: "", quot: "", stip: "", clausola: "", squadra_serie_a: "" });
    await loadRosa();
  }

  const inp = { padding: "7px 10px", borderRadius: 8, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12, width: "100%" };
  const ruoli = ["Por","Dc","Dd","Ds","B","E","M","C","T","W","A","Pc"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>✏️ MODIFICA ROSE</h1>
        <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Pannello admin · modifiche salvate in tempo reale</p>
      </div>

      {/* ── IMPORT LISTONE SETTIMANALE (database 2) ── */}
      <ImportListoneSection />

      {/* ── AGGIORNAMENTO CONTRATTI 01/06 (art. 4.8) ── */}
      {isAdmin && <AggiornamentoContrattiSection onRefresh={onRefresh} />}

      {/* ── IMPORT QUOTAZIONI DA EXCEL (art. 4.6/4.7) ── */}
      <div style={{ background: "#f59e0b08", border: "1.5px solid #f59e0b25", borderRadius: 14, overflow: "hidden" }}>
        <div onClick={() => setImportQuote(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em" }}>📊 AGGIORNAMENTO QUOTAZIONI DA EXCEL (art. 4.6/4.7)</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>01/06 e 01/08 — importa il listone, l'app aggiorna quot + stip (Q/5) + clausola (Q×1.75)</div>
          </div>
          <span style={{ color: "#555" }}>{importQuote ? "▲" : "▼"}</span>
        </div>

        {importQuote && (
          <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Tipo aggiornamento */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#888" }}>Tipo:</span>
              {["01/06", "01/08", "01/01"].map(t => (
                <button key={t} onClick={() => setTipoAggiornamento(t)}
                  style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${tipoAggiornamento===t ? "#f59e0b" : "#ffffff15"}`, background: tipoAggiornamento===t ? "#f59e0b22" : "transparent", color: tipoAggiornamento===t ? "#f59e0b" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Formato atteso */}
            <div style={{ background: "#ffffff06", borderRadius: 8, padding: "8px 12px", fontSize: 10, color: "#555" }}>
              📋 Formato Excel atteso: colonne <b style={{ color: "#aaa" }}>Nome</b> e <b style={{ color: "#aaa" }}>Quotazione</b> (o "Q"). Una riga per giocatore. Il listone completo di Leghe Fantacalcio va bene.
            </div>

            {/* Upload */}
            {!anteprima && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 9, background: "#f59e0b22", color: "#f59e0b", fontSize: 12, fontWeight: 700, cursor: "pointer", alignSelf: "flex-start" }}>
                {importando ? "⏳ Elaborazione..." : "📥 Carica Excel listone"}
                <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImportQuotazioni} disabled={importando} />
              </label>
            )}

            {/* Anteprima differenze */}
            {anteprima && (
              <>
                {/* Riepilogo */}
                <div className="grid-stats-4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { label: "TOTALE", val: anteprima.length, color: "#888", key: "tutti" },
                    { label: "📈 RIALZI", val: rialziCount, color: "#10b981", key: "rialzi" },
                    { label: "📉 RIBASSI", val: ribassiCount, color: "#ef4444", key: "ribassi" },
                    { label: "= INVARIATI", val: invariatiCount, color: "#555", key: "invariati" },
                  ].map(s => (
                    <button key={s.key} onClick={() => setFiltroAnteprima(s.key)}
                      style={{ padding: "8px", borderRadius: 8, border: `1px solid ${filtroAnteprima===s.key ? s.color : "#ffffff10"}`, background: filtroAnteprima===s.key ? s.color+"15" : "#ffffff06", cursor: "pointer", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "#555" }}>{s.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif" }}>{s.val}</div>
                    </button>
                  ))}
                </div>

                {/* Tabella anteprima */}
                <div style={{ maxHeight: 360, overflowY: "auto", overflowX: "auto", background: "#ffffff06", borderRadius: 10, border: "1px solid #ffffff10" }}>
                  <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 11 }}>
                    <thead style={{ position: "sticky", top: 0, background: "#0d0f14" }}>
                      <tr style={{ borderBottom: "1px solid #ffffff15" }}>
                        {["Squadra","Nome","Ruolo","Q prima","Q dopo","Δ","Stip prima","Stip dopo"].map(h => (
                          <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "#555" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(anteprimaFiltrata || []).map(p => (
                        <tr key={p.id} style={{ borderBottom: "1px solid #ffffff06" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#ffffff08"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <td style={{ padding: "5px 8px", color: "#666", fontSize: 10 }}>{p.squadra}</td>
                          <td style={{ padding: "5px 8px", color: "#e0e0e0", fontWeight: 600 }}>{p.nome}</td>
                          <td style={{ padding: "5px 8px", color: "#888" }}>{p.ruolo}</td>
                          <td style={{ padding: "5px 8px", color: "#888" }}>{p.quotPrima}</td>
                          <td style={{ padding: "5px 8px", color: "#f0f0f0", fontWeight: 700 }}>{p.quotDopo}</td>
                          <td style={{ padding: "5px 8px", fontWeight: 700, color: p.delta > 0 ? "#10b981" : p.delta < 0 ? "#ef4444" : "#555" }}>
                            {p.delta > 0 ? "+" : ""}{p.delta}
                          </td>
                          <td style={{ padding: "5px 8px", color: "#888" }}>{p.stipPrima.toFixed(2)}M</td>
                          <td style={{ padding: "5px 8px", fontWeight: 700, color: p.delta > 0 ? "#10b981" : p.delta < 0 ? "#ef4444" : "#888" }}>
                            {p.stipDopo.toFixed(2)}M
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Azioni */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={handleApplicaQuotazioni} disabled={applicando}
                    style={{ padding: "9px 20px", borderRadius: 9, border: "none", background: "#10b981", color: "#000", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                    {applicando ? "Applicazione..." : `✅ Applica ${anteprima.filter(p=>p.delta!==0).length} modifiche`}
                  </button>
                  <button onClick={() => setAnteprima(null)}
                    style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid #ffffff15", background: "transparent", color: "#888", fontSize: 12, cursor: "pointer" }}>
                    ✕ Annulla
                  </button>
                </div>

                {/* Avviso art. 4.5 */}
                {tipoAggiornamento === "01/01" && rialziCount > 0 && (
                  <div style={{ background: "#f59e0b10", border: "1px solid #f59e0b30", borderRadius: 8, padding: "8px 12px", fontSize: 10, color: "#f59e0b" }}>
                    ⚠️ Aggiornamento 01/01: dopo aver applicato, vai nella tab Finanze di ogni presidente per gestire i top-5 rialzi obbligatori e i ribassi facoltativi (art. 4.5).
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Selezione squadra */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {teams.map(t => (
          <button key={t.id} onClick={() => setSquadraSelezionata(t.name)} title={t.name} style={{ padding: "6px", borderRadius: 10, border: `1.5px solid ${squadraSelezionata === t.name ? t.color : "#ffffff12"}`, background: squadraSelezionata === t.name ? t.color + "22" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TeamAvatar team={t} size={30} />
          </button>
        ))}
      </div>

      {team && editSquadra && (
        <>
          {/* Dati squadra */}
          <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 14 }}>🏟 DATI SQUADRA — {team.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
              {[
                ["Bilancio (M)", "bilancio", "number"],
                ["Salary Cap usato (M)", "salary_used", "number"],
                ["Giocatori", "giocatori", "number"],
                ["U21", "u21", "number"],
                ["Fair Play P1 (M)", "fair_play1", "number"],
                ["Fair Play P2 (M)", "fair_play2", "number"],
                ["Penalità (pt)", "penalita", "number"],
                ["Allenatore", "allenatore", "text"],
              ].map(([label, key, type]) => (
                <div key={key}>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>{label.toUpperCase()}</div>
                  <input style={inp} type={type} value={editSquadra[key] ?? ""} onChange={e => setEditSquadra(f => ({ ...f, [key]: type === "number" ? parseFloat(e.target.value) || 0 : e.target.value }))} />
                </div>
              ))}
            </div>
            <button onClick={salvaSquadra} disabled={saving} style={{ padding: "9px 24px", borderRadius: 10, border: "none", background: saving ? "#333" : "#f59e0b", color: saving ? "#666" : "#000", fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer" }}>
              {saving ? "Salvataggio..." : "💾 Salva squadra"}
            </button>
          </div>

          {/* Rosa */}
          <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em" }}>👥 ROSA ({rosa.length} giocatori)</div>
              <button onClick={() => setShowAddPlayer(v => !v)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: showAddPlayer ? "#ffffff12" : "#10b98122", color: showAddPlayer ? "#888" : "#10b981", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                {showAddPlayer ? "✕ Annulla" : "+ Aggiungi giocatore"}
              </button>
            </div>

            {showAddPlayer && (
              <div style={{ background: "#10b98110", border: "1px solid #10b98133", borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, marginBottom: 10 }}>
                  {[["Nome","nome","text"],["Ruolo","ruolo","select"],["Età","anni","number"],["Quot","quot","number"],["Stip (M)","stip","number"],["Clausola (M)","clausola","number"],["Squadra SA","squadra_serie_a","text"]].map(([l,k,t]) => (
                    <div key={k}>
                      <div style={{ fontSize: 10, color: "#666", marginBottom: 3 }}>{l.toUpperCase()}</div>
                      {t === "select"
                        ? <select style={inp} value={newPlayer[k]} onChange={e => setNewPlayer(f => ({ ...f, [k]: e.target.value }))}>{ruoli.map(r => <option key={r} value={r}>{r}</option>)}</select>
                        : <input style={inp} type={t} value={newPlayer[k]} onChange={e => setNewPlayer(f => ({ ...f, [k]: e.target.value }))} />
                      }
                    </div>
                  ))}
                </div>
                <button onClick={aggiungiGiocatore} style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "#10b981", color: "#000", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Aggiungi →</button>
              </div>
            )}

            {loadingRosa ? <div style={{ fontSize: 12, color: "#555" }}>Caricamento...</div> : (
              <ModificaRosaTable rosa={rosa} editGiocatore={editGiocatore} setEditGiocatore={setEditGiocatore} salvaGiocatore={salvaGiocatore} eliminaGiocatore={eliminaGiocatore} ruoli={ruoli} inp={inp} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── PENALITÀ PAGE ──────────────────────────────────────────────────────────── */
function PenalitaPage({ isAdmin, teams = [] }) {
  const [penalita, setPenalita] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);


  const emptyForm = { squadra: teams[0]?.name || "", tipo: "multa_mln", importo: "", motivo: "", codice_tipo: "", note: "" };
  const [form, setForm] = useState(emptyForm);

  const loadAll = useCallback(async () => {
    const data = await getPenalita(null, STAGIONE_CORRENTE);
    setPenalita(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Conta recidive per squadra+tipo nella lista caricata
  function getRecidive(squadra, codiceTipo) {
    return penalita.filter(p => p.squadra === squadra && p.codice_tipo === codiceTipo).length;
  }

  async function salva() {
    if (!form.squadra || !form.motivo || !form.importo) return;
    setSaving(true);
    try {
      const nRec = form.codice_tipo ? getRecidive(form.squadra, form.codice_tipo) + 1 : 1;
      await insertPenalita({ ...form, importo: parseFloat(form.importo), stagione: STAGIONE_CORRENTE, n_recidiva: nRec, data_multa: new Date().toISOString().slice(0,10) });
      setShowForm(false);
      setForm(emptyForm);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleApplica(p) {
    if (p.tipo !== 'multa_mln') { alert("Applica manualmente i punti di penalizzazione in classifica."); return; }
    if (!window.confirm(`Applicare multa di ${p.importo}M a ${p.squadra}?\n\nMotivo: ${p.motivo}`)) return;
    setSaving(true);
    try {
      await applicaMulta(p.squadra, p.importo, p.motivo, p.id);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Rimuovere questa penalità?")) return;
    await deletePenalita(id);
    await loadAll();
  }

  // Raggruppa per squadra
  const bySquadra = {};
  for (const p of penalita) {
    if (!bySquadra[p.squadra]) bySquadra[p.squadra] = [];
    bySquadra[p.squadra].push(p);
  }

  const tipoLabel = { multa_mln: "💸 Multa M", punti_classifica: "📉 Punti", mercato_bloccato: "🔒 Mercato", altro: "⚠️ Altro" };
  const tipoColor = { multa_mln: "#ef4444", punti_classifica: "#f59e0b", mercato_bloccato: "#6366f1", altro: "#888" };

  const CODICI_COMUNI = [
    { value: "ritardo_risposta",     label: "Ritardo risposta offerta (art. 5.3)" },
    { value: "errore_formazione",    label: "Errore/mancata formazione (art. 8.2)" },
    { value: "mancato_sondaggio",    label: "Mancata risposta sondaggio (art. 11.4)" },
    { value: "spesa_non_segnata",    label: "Spesa non segnata entro 24h (art. 11.5)" },
    { value: "mancata_scelta_obv",   label: "Mancata scelta obiettivi (art. 9.1.1)" },
    { value: "falsa_accusa",         label: "Falsa accusa (art. 11.3)" },
    { value: "custom",               label: "Personalizzata" },
  ];

  const sel = { padding: "7px 10px", borderRadius: 7, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12, width: "100%" };
  const inp = { ...sel };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>PENALITÀ</h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Registro sanzioni · stagione {STAGIONE_CORRENTE}</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: showForm ? "#ef444422" : "linear-gradient(135deg,#ef4444,#f97316)", color: showForm ? "#ef4444" : "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {showForm ? "✕ Annulla" : "⚠️ Nuova penalità"}
          </button>
        )}
      </div>

      {/* ── Note regolamento ── */}
      <div style={{ background: "#ffffff06", border: "1px solid #ffffff10", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 5 }}>
        {[
          "Art. 11.2 — Alla 3ª recidiva dello stesso tipo la sanzione può essere maggiorata",
          "Art. 11.3 — Falsa accusa: multa specchiata verso il richiedente",
          "Art. 11.4 — Mancata risposta sondaggio WA entro 24h → −2M",
          "Art. 11.5 — Spesa non segnata entro 24h → multa pari all'importo + −1pt prossima stagione",
        ].map((r, i) => (
          <div key={i} style={{ fontSize: 11, color: "#555" }}>{r}</div>
        ))}
      </div>

      {/* ── Form nuova penalità ── */}
      {showForm && isAdmin && (
        <div style={{ background: "#ef444408", border: "1.5px solid #ef444425", borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", letterSpacing: "0.1em", marginBottom: 14 }}>⚠️ NUOVA PENALITÀ</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>SQUADRA</div>
              <select style={sel} value={form.squadra} onChange={e => setForm(f => ({ ...f, squadra: e.target.value }))}>
                {teams.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>TIPO SANZIONE</div>
              <select style={sel} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                <option value="multa_mln">💸 Multa in M</option>
                <option value="punti_classifica">📉 Punti penalizzazione</option>
                <option value="mercato_bloccato">🔒 Mercato bloccato</option>
                <option value="altro">⚠️ Altro</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>
                {form.tipo === 'multa_mln' ? 'IMPORTO (M)' : form.tipo === 'punti_classifica' ? 'PUNTI' : 'VALORE'}
              </div>
              <input style={inp} type="number" step="0.5" placeholder={form.tipo === 'multa_mln' ? "es. 2" : "es. 1"} value={form.importo} onChange={e => setForm(f => ({ ...f, importo: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>CODICE (per recidive)</div>
              <select style={sel} value={form.codice_tipo} onChange={e => setForm(f => ({ ...f, codice_tipo: e.target.value }))}>
                <option value="">— nessuno —</option>
                {CODICI_COMUNI.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>MOTIVO</div>
              <input style={inp} placeholder="Descrizione della penalità..." value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>NOTE</div>
              <input style={inp} placeholder="Note aggiuntive..." value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
          </div>

          {/* Preview recidive */}
          {form.codice_tipo && form.codice_tipo !== 'custom' && form.squadra && (
            <div style={{ background: "#f59e0b10", border: "1px solid #f59e0b30", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#f59e0b", marginBottom: 10 }}>
              ⚠️ Recidive di questo tipo per {form.squadra}: <b>{getRecidive(form.squadra, form.codice_tipo)}</b>
              {getRecidive(form.squadra, form.codice_tipo) >= 2 && " — TERZA VOLTA: sanzione maggiorata consigliata"}
            </div>
          )}

          <button onClick={salva} disabled={saving}
            style={{ width: "100%", padding: "10px", borderRadius: 9, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Salvataggio..." : "⚠️ Registra penalità"}
          </button>
        </div>
      )}

      {/* ── Lista penalità per squadra ── */}
      {loading ? <div style={{ fontSize: 12, color: "#555" }}>Caricamento...</div>
        : penalita.length === 0
        ? <div style={{ fontSize: 13, color: "#555", fontStyle: "italic", textAlign: "center", padding: 30 }}>Nessuna penalità registrata per questa stagione</div>
        : Object.entries(bySquadra).map(([nome, pens]) => {
          const team = teams.find(t => t.name === nome);
          const multeTot = pens.filter(p => p.tipo === 'multa_mln').reduce((s,p) => s + Number(p.importo), 0);
          const puntiTot = pens.filter(p => p.tipo === 'punti_classifica').reduce((s,p) => s + Number(p.importo), 0);
          return (
            <div key={nome} style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                {team && <TeamAvatar team={team} size={32} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#f0f0f0" }}>{nome}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>{pens.length} sanzioni · {STAGIONE_CORRENTE}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {multeTot > 0 && <Badge color="#ef4444">−{multeTot.toFixed(1)}M</Badge>}
                  {puntiTot > 0 && <Badge color="#f59e0b">−{puntiTot}pt</Badge>}
                </div>
              </div>
              {pens.map(p => (
                <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid #ffffff08", flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
                      <Badge color={tipoColor[p.tipo]}>{tipoLabel[p.tipo]}</Badge>
                      <span style={{ fontSize: 13, fontWeight: 700, color: tipoColor[p.tipo] }}>
                        {p.tipo === 'multa_mln' ? `−${p.importo}M` : p.tipo === 'punti_classifica' ? `−${p.importo}pt` : `${p.importo}`}
                      </span>
                      {p.n_recidiva >= 3 && <Badge color="#ef4444">🔁 {p.n_recidiva}ª volta</Badge>}
                      {p.applicata && <Badge color="#10b981">✓ applicata</Badge>}
                    </div>
                    <div style={{ fontSize: 12, color: "#ccc" }}>{p.motivo}</div>
                    {p.note && <div style={{ fontSize: 10, color: "#555" }}>{p.note}</div>}
                    <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{p.data_multa}</div>
                  </div>
                  {isAdmin && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {!p.applicata && p.tipo === 'multa_mln' && (
                        <button onClick={() => handleApplica(p)} disabled={saving}
                          style={{ padding: "4px 9px", borderRadius: 6, border: "none", background: "#ef444418", color: "#ef4444", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                          Applica
                        </button>
                      )}
                      <button onClick={() => handleDelete(p.id)}
                        style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: "#ffffff10", color: "#555", fontSize: 10, cursor: "pointer" }}>✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })
      }
    </div>
  );
}

/* ─── PREMI PAGE ─────────────────────────────────────────────────────────────── */
const PREMI_INDIVIDUALI_DEF = [
  { key: 'gol_schierati',     label: '⚽ Primo in gol schierati',           importo:  1, tipo: 'premio_indiv', color: '#10b981' },
  { key: 'gol_contro',        label: '🥅 Primo in gol schierati contro',     importo:  2, tipo: 'premio_indiv', color: '#10b981' },
  { key: 'miglior_marcatore', label: '🎯 Miglior marcatore in rosa',         importo:  1, tipo: 'premio_indiv', color: '#10b981' },
  { key: 'miglior_assist',    label: '🤝 Miglior assist man in rosa',        importo:  1, tipo: 'premio_indiv', color: '#10b981' },
  { key: 'clean_sheets',      label: '🧤 Maggior porte inviolate schierate', importo:  1, tipo: 'premio_indiv', color: '#10b981' },
  { key: 'ammonizioni',       label: '🟨 Maggior ammonizioni in campo',      importo: -1, tipo: 'malus_indiv',  color: '#ef4444' },
  { key: 'espulsioni',        label: '🟥 Maggior espulsioni in campo',       importo: -1, tipo: 'malus_indiv',  color: '#ef4444' },
];

function PremiPage({ isAdmin, teams = [] }) {
  const [premi, setPremi] = useState([]);
  const [classifica, setClassifica] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [montepremi, setMontepremi] = useState(0);
  const [premiIndiv, setPremiIndiv] = useState({});
  const [savingIndiv, setSavingIndiv] = useState(false);


  const loadAll = useCallback(async () => {
    const [p, c] = await Promise.all([getPremi(STAGIONE_CORRENTE), getClassifica()]);
    setPremi(p);
    setClassifica(c.sort((a,b) => b.pt - a.pt || b.pt_totali - a.pt_totali));
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Premio 19a: calcolato dalla classifica live
  const primoPoints = classifica[0]?.pt || 0;
  const premi19a = classifica.map((r, i) => ({
    squadra: r.squadra,
    posizione: i + 1,
    importo: calcolaPremio19a(primoPoints, r.pt),
  }));

  // Premio finale (art. 12.2) — posizione → M (inverso: 8° = 50M, 1° = 22M)
  const premiFinali = classifica.map((r, i) => ({
    squadra: r.squadra,
    posizione: i + 1,
    importo: calcolaPremiFinali(i + 1),
  }));

  // Premi in euro (art. 12.4)
  function calcolaPremiEuro(pos, hasVintatoCoppa) {
    const mp = montepremi;
    if (pos === 1) return parseFloat((mp / 2).toFixed(2));
    if (pos === 2) return parseFloat((mp / 4).toFixed(2));
    if (pos === 3) return parseFloat((mp / 8).toFixed(2));
    if (hasVintatoCoppa) return parseFloat((mp / 8).toFixed(2));
    return 0;
  }

  async function handleApplicaPremi19a() {
    if (!window.confirm("Applicare i premi 19ª giornata a tutte le squadre?")) return;
    if (premiApplicati.p19) { alert('Premi 19ª già applicati.'); return; }
    setSaving(true);
    try {
      for (const p of premi19a) {
        const rec = await insertPremio({ squadra: p.squadra, tipo: 'premio_19a', importo: p.importo, posizione: p.posizione, stagione: STAGIONE_CORRENTE, data_premio: new Date().toISOString().slice(0,10) });
        await applicaPremio(p.squadra, p.importo, '19ª giornata', rec.id);
      }
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleApplicaPremiFinali() {
    if (!window.confirm("Applicare i premi finali a tutte le squadre?\n\nQuesti si sommano ai premi coppa se inseriti.")) return;
    if (premiApplicati.finale) { alert('Premi finali già applicati.'); return; }
    setSaving(true);
    try {
      for (const p of premiFinali) {
        const rec = await insertPremio({ squadra: p.squadra, tipo: 'premio_finale', importo: p.importo, posizione: p.posizione, stagione: STAGIONE_CORRENTE, data_premio: new Date().toISOString().slice(0,10) });
        await applicaPremio(p.squadra, p.importo, `Premio finale (${p.posizione}°)`, rec.id);
      }
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleApplicaPremiIndividuali() {
    const entries = PREMI_INDIVIDUALI_DEF.map(d => ({ ...d, squadra: premiIndiv[d.key] })).filter(d => d.squadra);
    if (!entries.length) { alert("Seleziona almeno una squadra vincitrice."); return; }
    if (!window.confirm(`Applicare ${entries.length} premi/malus individuali?\n\n${entries.map(e => `${e.label}: ${e.importo > 0 ? '+' : ''}${e.importo}M → ${e.squadra}`).join('\n')}`)) return;
    setSavingIndiv(true);
    try {
      for (const e of entries) {
        const rec = await insertPremio({ squadra: e.squadra, tipo: e.tipo, importo: e.importo, posizione: null, stagione: STAGIONE_CORRENTE, data_premio: new Date().toISOString().slice(0,10) });
        await applicaPremio(e.squadra, e.importo, e.label, rec.id);
      }
      await loadAll();
    } catch(err) { alert(err.message); }
    finally { setSavingIndiv(false); }
  }

  const premiApplicati = {
    p19: premi.some(p => p.tipo === 'premio_19a'),
    finale: premi.some(p => p.tipo === 'premio_finale'),
    individuali: premi.some(p => p.tipo === 'premio_indiv' || p.tipo === 'malus_indiv'),
  };

  const inp = { padding: "7px 10px", borderRadius: 7, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12, width: "100%" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>PREMI</h1>
        <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Premi invernali e di fine stagione · {STAGIONE_CORRENTE}</p>
      </div>

      {/* ── 1. PREMI 19ª GIORNATA (art. 12.1) ── */}
      <div style={{ background: "#6366f108", border: "1.5px solid #6366f125", borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: "0.1em" }}>🏅 PREMI 19ª GIORNATA (art. 12.1)</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>3M + (distanza dal 1°) × 1.5 · chi è primo prende meno</div>
          </div>
          {isAdmin && !premiApplicati.p19 && (
            <button onClick={handleApplicaPremi19a} disabled={saving}
              style={{ padding: "7px 14px", borderRadius: 9, border: "none", background: "#6366f122", color: "#818cf8", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {saving ? "..." : "✅ Applica a tutti"}
            </button>
          )}
          {premiApplicati.p19 && <Badge color="#10b981">✓ Applicati</Badge>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {premi19a.map((p, i) => {
            const team = teams.find(t => t.name === p.squadra);
            const cl = classifica[i];
            return (
              <div key={p.squadra} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #ffffff08" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#555", minWidth: 20 }}>{i+1}</span>
                {team && <TeamAvatar team={team} size={26} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#ddd" }}>{p.squadra}</div>
                  <div style={{ fontSize: 10, color: "#555" }}>{cl?.pt || 0}pt · distanza: {primoPoints - (cl?.pt||0)}pt</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#818cf8", fontFamily: "'Bebas Neue',sans-serif" }}>+{p.importo}M</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 2. PREMI FINALI CAMPIONATO (art. 12.2) ── */}
      <div style={{ background: "#f59e0b08", border: "1.5px solid #f59e0b25", borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em" }}>🏆 PREMI FINALI CAMPIONATO (art. 12.2)</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Chi finisce ultimo vince di più (incentivo)</div>
          </div>
          {isAdmin && !premiApplicati.finale && (
            <button onClick={handleApplicaPremiFinali} disabled={saving}
              style={{ padding: "7px 14px", borderRadius: 9, border: "none", background: "#f59e0b22", color: "#f59e0b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {saving ? "..." : "✅ Applica a tutti"}
            </button>
          )}
          {premiApplicati.finale && <Badge color="#10b981">✓ Applicati</Badge>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            [1,22],[2,26],[3,30],[4,34],[5,38],[6,42],[7,46],[8,50]
          ].map(([pos, mln]) => {
            const cl = classifica[pos-1];
            const team = cl ? teams.find(t => t.name === cl.squadra) : null;
            return (
              <div key={pos} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #ffffff08" }}>
                <span style={{ fontSize: 12, color: "#555", minWidth: 20, fontWeight: 700 }}>{pos}°</span>
                {team ? <TeamAvatar team={team} size={24} /> : <div style={{ width: 24, height: 24, borderRadius: 6, background: "#ffffff10" }} />}
                <span style={{ flex: 1, fontSize: 12, color: cl ? "#ddd" : "#444" }}>{cl?.squadra || "—"}</span>
                <span style={{ fontSize: 16, fontWeight: 900, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>+{mln}M</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 3. PREMI COPPA ITALIA (art. 12.3) ── */}
      <div style={{ background: "#10b98108", border: "1.5px solid #10b98125", borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", letterSpacing: "0.1em", marginBottom: 14 }}>🥇 PREMI COPPA ITALIA (art. 12.3)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[[1,5,"Vincitore Coppa"],[2,3,"Finalista"],[3,1,"Semifinalista"],[4,1,"Semifinalista"]].map(([pos, mln, label]) => (
            <div key={pos} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #ffffff08" }}>
              <span style={{ fontSize: 12, color: "#888" }}>{pos}° — {label}</span>
              <span style={{ fontSize: 14, fontWeight: 900, color: "#10b981", fontFamily: "'Bebas Neue',sans-serif" }}>+{mln}M</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. PREMI INDIVIDUALI (art. 12.4 + 12.5) ── */}
      <div style={{ background: "#a855f708", border: "1.5px solid #a855f725", borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#a855f7", letterSpacing: "0.1em" }}>🏅 PREMI INDIVIDUALI (art. 12.4–12.5)</div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Premi e malus di fine stagione per record individuali</div>
          </div>
          {isAdmin && !premiApplicati.individuali && (
            <button onClick={handleApplicaPremiIndividuali} disabled={savingIndiv}
              style={{ padding: "7px 14px", borderRadius: 9, border: "none", background: "#a855f722", color: "#a855f7", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {savingIndiv ? "..." : "✅ Applica selezionati"}
            </button>
          )}
          {premiApplicati.individuali && <Badge color="#10b981">✓ Applicati</Badge>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PREMI_INDIVIDUALI_DEF.map(d => {
            const teamNames = teams.map(t => t.name);
            const sel = premiIndiv[d.key] || '';
            return (
              <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #ffffff08" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#ddd", fontWeight: 600 }}>{d.label}</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 900, color: d.color, fontFamily: "'Bebas Neue',sans-serif", minWidth: 36, textAlign: "right" }}>
                  {d.importo > 0 ? "+" : ""}{d.importo}M
                </span>
                {isAdmin && !premiApplicati.individuali ? (
                  <select value={sel} onChange={e => setPremiIndiv(v => ({ ...v, [d.key]: e.target.value }))}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, minWidth: 130 }}>
                    <option value="">— Scegli squadra —</option>
                    {teamNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize: 11, color: sel ? "#ddd" : "#444", minWidth: 130, textAlign: "right" }}>
                    {sel || <span style={{ color: "#333" }}>—</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 5. PREMI IN € (art. 12.6) ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 12 }}>💶 PREMI IN EURO REALI (art. 12.6)</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>MONTEPREMI TOTALE (€)</div>
          <input style={{ ...inp, width: "auto" }} type="number" placeholder="es. 120" value={montepremi || ""} onChange={e => setMontepremi(parseFloat(e.target.value) || 0)} />
        </div>
        {montepremi > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              [1, "½", montepremi/2, "1° posto"],
              [2, "¼", montepremi/4, "2° posto"],
              [3, "⅛", montepremi/8, "3° posto"],
              [null, "⅛", montepremi/8, "Vincitore Coppa"],
              [null, "+5€", 5, "Vincitore Supercoppa (da ultimo in classifica)"],
            ].map(([pos, fraz, importo, label], i) => {
              const cl = pos ? classifica[pos-1] : null;
              const team = cl ? teams.find(t => t.name === cl.squadra) : null;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #ffffff08" }}>
                  <span style={{ fontSize: 14, color: "#818cf8", minWidth: 28, fontWeight: 700 }}>{fraz}</span>
                  {team ? <TeamAvatar team={team} size={24} /> : <div style={{ width: 24, height: 24 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: cl ? "#ddd" : "#888" }}>{label}</div>
                    {cl && <div style={{ fontSize: 10, color: "#555" }}>{cl.squadra}</div>}
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 900, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>{parseFloat(importo.toFixed(2))}€</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 10, color: "#444", marginTop: 10 }}>Il Vincitore Supercoppa riceve i 5€ extra pagati dall'ultimo in classifica.</div>
      </div>

      {/* ── 6. STORICO PREMI APPLICATI ── */}
      {premi.length > 0 && (
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 12 }}>📋 STORICO PREMI ASSEGNATI</div>
          {premi.map(p => {
            const team = teams.find(t => t.name === p.squadra);
            return (
              <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #ffffff08", flexWrap: "wrap" }}>
                {team && <TeamAvatar team={team} size={24} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#ddd" }}>{p.squadra} · {p.tipo.replace(/_/g,' ')}</div>
                  <div style={{ fontSize: 10, color: "#555" }}>{p.data_premio}</div>
                </div>
                <Badge color="#10b981">+{p.importo}M</Badge>
                {p.applicato && <Badge color="#818cf8">✓</Badge>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── ADMIN CONTROL ROOM ─────────────────────────────────────────────────────── */
const STAGIONE_CR = STAGIONE_CORRENTE;

function AdminControlRoomPage({ teams }) {
  const [tab, setTab] = useState('panoramica');
  const [status, setStatus] = useState(null);
  const [stadioInv, setStadioInv] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // quale operazione sta girando
  const [lastResult, setLastResult] = useState(null);
  const [tgRegs, setTgRegs] = useState([]);
  const [tgLoading, setTgLoading] = useState(false);
  const [mercatoOvr, setMercatoOvr] = useState(null); // null=auto, 'aperto', 'chiuso'
  const [mercatoOvrLoading, setMercatoOvrLoading] = useState(false);
  const [asteAttive, setAsteAttive] = useState([]);
  const [fpfData, setFpfData] = useState(null);
  const [differiti, setDifferiti] = useState([]);
  const [classifica, setClassifica] = useState([]);
  const [svincoliAll, setSvincoliAll] = useState({}); // { squadra: stagione_svincoli }
  const [svincoliLoading, setSvincoliLoading] = useState(false);
  const [bilancioNegData, setBilancioNegData] = useState(null); // loaded on demand
  const [bilancioNegBusy, setBilancioNegBusy] = useState(null);
  const [rivalitaData, setRivalitaData] = useState(null); // all club_identity rivali+gemellati
  const [rivalitaBusy, setRivalitaBusy] = useState(null);
  const [lockGlobale, setLockGlobale] = useState(_rivalitaBloccata);
  const [lockBusy, setLockBusy] = useState(false);
  const [dbImportPreview, setDbImportPreview] = useState(null); // { rosaAggiornati, svinAggiornati, nonTrovati, totale }
  const [dbImportBusy, setDbImportBusy] = useState(false);
  const [dbImportDone, setDbImportDone] = useState(null);
  const [dbTipo, setDbTipo] = useState('settimanale');
  const [utenti, setUtenti] = useState([]);
  const [utentiLoading, setUtentiLoading] = useState(false);
  const [utentiEdit, setUtentiEdit] = useState(null); // { id, nome, bio, avatar_url, ruolo }
  const [utentiSaving, setUtentiSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [s, inv] = await Promise.all([
        getControlRoomStatus(),
        getStadioInvestimenti(STAGIONE_CR),
      ]);
      setStatus(s);
      setStadioInv(inv);
    } finally { setLoading(false); }
  }

  async function loadTgRegs() {
    setTgLoading(true);
    try { setTgRegs(await getTelegramRegistrations()); }
    catch(e) { alert(e.message); }
    finally { setTgLoading(false); }
  }

  async function loadMercatoOvr() {
    setMercatoOvrLoading(true);
    try { const v = await getMercatoOverride(); setMercatoOvr(v); }
    finally { setMercatoOvrLoading(false); }
  }

  async function loadAste() {
    const { data } = await supabase.from('aste_svincolati').select('*').eq('stato', 'raccolta_offerte').order('scadenza', { ascending: true });
    setAsteAttive(data || []);
  }

  async function loadFpf() {
    const map = await getFpfTutteSquadre();
    setFpfData(map);
  }

  async function loadDifferiti() {
    setDifferiti(await getTrasferimentiDifferiti());
  }

  async function loadClassifica() {
    const { data } = await supabase.from('classifica').select('squadra, punti, gf, gs').eq('stagione', STAGIONE_CR).order('punti', { ascending: false });
    setClassifica(data || []);
  }

  async function loadUtenti() {
    setUtentiLoading(true);
    try {
      const { data, error } = await supabase.from('profiles').select('*').order('squadra', { ascending: true });
      if (error) throw error;
      setUtenti(data || []);
    } catch(e) { alert(`Errore caricamento utenti: ${e.message}`); }
    finally { setUtentiLoading(false); }
  }

  async function salvaUtente(u) {
    setUtentiSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({
        nome: u.nome || null,
        bio: u.bio || null,
        avatar_url: u.avatar_url || null,
        ruolo: u.ruolo || null,
      }).eq('id', u.id);
      if (error) throw error;
      setUtenti(prev => prev.map(p => p.id === u.id ? { ...p, ...u } : p));
      setUtentiEdit(null);
    } catch(e) { alert(`Errore salvataggio: ${e.message}`); }
    finally { setUtentiSaving(false); }
  }

  useEffect(() => { loadMercatoOvr(); }, []);

  useEffect(() => { load(); }, []);

  const stadioSet = new Set(stadioInv.map(i => i.squadra));

  async function toggleStadio(squadra) {
    const haUpgrade = stadioSet.has(squadra);
    setBusy(`stadio_${squadra}`);
    try {
      await setStadioUpgrade(squadra, !haUpgrade, STAGIONE_CR);
      await load();
    } catch(e) { alert(e.message); }
    finally { setBusy(null); }
  }

  async function cleanupTasse() {
    const dataCorretta = status?.domenica || getDomenicaCorrente();
    if (!window.confirm(`Ripulire le anomalie tasse della settimana e conservare solo i record corretti del ${dataCorretta}?\n\nVerranno eliminati duplicati, date sbagliate e squadre non attive. I duplicati delle squadre attive verranno anche rimborsati nel bilancio.`)) return;
    setBusy('cleanup_tasse');
    try {
      const res = await ripulisciAnomalieTasse(dataCorretta);
      setLastResult({
        label: `Ripulite anomalie tasse ${dataCorretta}`,
        ok: res.rimossi?.length || 0,
        skip: res.tenuti || 0,
        ts: new Date().toLocaleTimeString('it-IT')
      });
      await load();
    } catch(e) { alert(e.message); }
    finally { setBusy(null); }
  }

  async function cleanupStoricoTasse() {
    const dataCorretta = status?.domenica || getDomenicaCorrente();
    if (!window.confirm(`Eliminare TUTTI i record tassa precedenti al ${dataCorretta}?\n\nQuesto serve a ripulire lo storico errato visibile nelle Finanze (es. 2026-06-06/07). Gli importi rimossi verranno rimborsati ai bilanci delle squadre attive. La tassa corretta del ${dataCorretta} resterà intatta.`)) return;
    setBusy('cleanup_tasse_storico');
    try {
      const res = await ripulisciStoricoTassePrimaDi(dataCorretta);
      setLastResult({
        label: `Ripulito storico tasse prima del ${dataCorretta}`,
        ok: res.rimossi?.length || 0,
        skip: res.rimborsi?.length || 0,
        ts: new Date().toLocaleTimeString('it-IT')
      });
      await load();
    } catch(e) { alert(e.message); }
    finally { setBusy(null); }
  }

  async function runBulk(fn, label) {
    if (!window.confirm(`Eseguire: ${label}?`)) return;
    setBusy(label);
    try {
      const res = await fn();
      const ok = res.filter(r => r.ok).length;
      const skip = res.filter(r => r.skip).length;
      setLastResult({ label, ok, skip, ts: new Date().toLocaleTimeString('it-IT') });
      await load();
      // Le funzioni bulk inviano già internamente l'eventuale notifica Telegram.
      // Non inviarla anche qui, altrimenti il canale riceve messaggi duplicati.
    } catch(e) { alert(e.message); }
    finally { setBusy(null); }
  }

  const tabs = [
    { key: 'panoramica',   icon: '📊', label: 'Panoramica' },
    { key: 'mercato',      icon: '🏪', label: 'Mercato' },
    { key: 'aste',         icon: '🔔', label: 'Aste' },
    { key: 'stadio',       icon: '🏟', label: 'Stadio' },
    { key: 'tasse',        icon: '📅', label: 'Tasse' },
    { key: 'stipendi',     icon: '💰', label: 'Stipendi' },
    { key: 'fpf',          icon: '⚖️', label: 'FPF' },
    { key: 'bilancio_neg', icon: '🔴', label: 'Bilancio −' },
    { key: 'svincoli_cr',  icon: '✂️', label: 'Svincoli' },
    { key: 'rivalita',     icon: '⚔️', label: 'Rivalità' },
    { key: 'database',     icon: '📊', label: 'Database' },
    { key: 'premi',        icon: '🏆', label: 'Premi' },
    { key: 'contratti',    icon: '📋', label: 'Contratti' },
    { key: 'differiti',    icon: '⏳', label: 'Differiti' },
    { key: 'stagione',     icon: '⚙️', label: 'Stagione' },
    { key: 'telegram',     icon: '✈️', label: 'Telegram' },
    { key: 'utenti',       icon: '👥', label: 'Utenti' },
  ];

  const isBusy = !!busy;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: '#f59e0b', fontFamily: "'Bebas Neue',sans-serif", letterSpacing: '2px', lineHeight: 1 }}>⚡ ADMIN CONTROL ROOM</div>
        <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Operazioni centrali · Stagione {STAGIONE_CR}</div>
      </div>

      {/* Last result toast */}
      {lastResult && (
        <div style={{ marginBottom: 16, background: '#10b98112', border: '1px solid #10b98130', borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 16 }}>✅</span>
          <div style={{ flex: 1, fontSize: 12, color: '#10b981' }}>
            <b>{lastResult.label}</b> — {lastResult.ok} applicate, {lastResult.skip} già eseguite
          </div>
          <span style={{ fontSize: 11, color: '#555' }}>{lastResult.ts}</span>
          <button onClick={() => setLastResult(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 14px', borderRadius: 10, border: `1.5px solid ${tab === t.key ? '#f59e0b60' : '#ffffff15'}`, background: tab === t.key ? '#f59e0b18' : 'transparent', color: tab === t.key ? '#f59e0b' : '#666', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#555', fontSize: 13, padding: 20 }}>Caricamento...</div>
      ) : (

        <>
          {/* ── PANORAMICA ── */}
          {tab === 'panoramica' && status && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', marginBottom: 14 }}>STATO SQUADRE — {status.meseISO}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #ffffff15' }}>
                      {['Squadra', 'Bilancio', 'Tassa (dom.)', 'Stipendi (mese)', 'Stadio (mese)', 'Entrate stadio'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#555', fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(status.squadre || []).sort((a,b) => (b.bilancio||0) - (a.bilancio||0)).map(sq => {
                      const team = teams?.find(t => t.name === sq.name);
                      const tassaOk = status.tassePagate.has(sq.name);
                      const stipOk  = status.stipendiPagati.has(sq.name);
                      const stadioOk= status.stadioPagato.has(sq.name);
                      const hasUpgrade = stadioSet.has(sq.name);
                      return (
                        <tr key={sq.name} style={{ borderBottom: '1px solid #ffffff08' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#ffffff05'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            {team && <TeamAvatar team={team} size={24} />}
                            <span style={{ fontWeight: 600, color: '#ddd' }}>{sq.name}</span>
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 800, color: sq.bilancio < 0 ? '#ef4444' : sq.bilancio < 10 ? '#f97316' : '#10b981', fontFamily: "'Bebas Neue',sans-serif", fontSize: 15 }}>{(sq.bilancio||0).toFixed(1)}M</td>
                          <td style={{ padding: '8px 10px' }}><StatusPill ok={tassaOk} /></td>
                          <td style={{ padding: '8px 10px' }}><StatusPill ok={stipOk} /></td>
                          <td style={{ padding: '8px 10px' }}><StatusPill ok={stadioOk} /></td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: hasUpgrade ? '#10b981' : '#888', fontSize: 13, fontFamily: "'Bebas Neue',sans-serif" }}>{hasUpgrade ? '+5.5M' : '+4M'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Riepilogo rapido */}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                {[
                  { label: 'Tasse pagate', n: status.tassePagate.size, tot: status.squadre.length, color: '#f59e0b', extra: status.tasseDettagli?.totaleRecord > status.squadre.length ? `${status.tasseDettagli.totaleRecord} record totali` : null },
                  { label: 'Stipendi pagati', n: status.stipendiPagati.size, tot: status.squadre.length, color: '#6366f1' },
                  { label: 'Stadio pagato', n: status.stadioPagato.size, tot: status.squadre.length, color: '#10b981' },
                ].map(s => (
                  <div key={s.label} style={{ flex: '1 1 140px', background: s.color + '10', border: `1px solid ${s.color}25`, borderRadius: 10, padding: '10px 14px' }}>
                    <div style={{ fontSize: 9, color: s.color, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>{s.label.toUpperCase()}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>{s.n}<span style={{ fontSize: 13, color: '#555' }}>/{s.tot}</span></div>
                    {s.extra && <div style={{ marginTop: 4, fontSize: 10, color: '#f59e0b' }}>⚠ {s.extra}</div>}
                  </div>
                ))}
              </div>

              {(status.tasseDettagli?.duplicate?.length > 0 || status.tasseDettagli?.mancanti?.length > 0 || status.tasseDettagli?.extra?.length > 0) && (
                <div style={{ marginTop: 14, background: '#f59e0b0d', border: '1px solid #f59e0b30', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.08em' }}>⚠ DETTAGLIO ANOMALIE TASSE</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={cleanupTasse}
                        disabled={isBusy}
                        style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #f59e0b55', background: '#f59e0b18', color: '#f59e0b', fontSize: 11, fontWeight: 800, cursor: isBusy ? 'not-allowed' : 'pointer' }}>
                        {busy === 'cleanup_tasse' ? 'Pulizia...' : `Pulisci anomalie · tieni ${status.domenica}`}
                      </button>
                      <button
                        onClick={cleanupStoricoTasse}
                        disabled={isBusy}
                        style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #ef444455', background: '#ef444418', color: '#ef4444', fontSize: 11, fontWeight: 800, cursor: isBusy ? 'not-allowed' : 'pointer' }}>
                        {busy === 'cleanup_tasse_storico' ? 'Pulizia storico...' : `Elimina storico prima del ${status.domenica}`}
                      </button>
                    </div>
                  </div>
                  {status.tasseDettagli?.duplicate?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#ddd', marginBottom: 6 }}><b style={{ color: '#f97316' }}>Pagate più di una volta:</b> {status.tasseDettagli.duplicate.map(x => `${x.squadra} (${x.count}×: ${x.date.join(', ')})`).join(' · ')}</div>
                  )}
                  {status.tasseDettagli?.mancanti?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#ddd', marginBottom: 6 }}><b style={{ color: '#ef4444' }}>Mancanti:</b> {status.tasseDettagli.mancanti.join(' · ')}</div>
                  )}
                  {status.tasseDettagli?.extra?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#ddd' }}><b style={{ color: '#f59e0b' }}>Record extra / squadre non attive:</b> {status.tasseDettagli.extra.map(x => `${x.squadra} (${x.count}×: ${x.date.join(', ')})`).join(' · ')}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STADIO ── */}
          {tab === 'stadio' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>🏟 ENTRATE STADIO MENSILI</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Base: 4M · Con Ristrutturazione Stadio: 5.5M · Pagamento il 1° di ogni mese</div>
                </div>
                <button
                  onClick={() => runBulk(applicaEntrateStadioTutte, 'Entrate stadio a tutti')}
                  disabled={isBusy}
                  style={{ padding: '8px 18px', borderRadius: 10, border: '1.5px solid #10b98150', background: '#10b98118', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1 }}>
                  {busy === 'Entrate stadio a tutti' ? '⏳ Esecuzione...' : '🏟 Applica entrate a tutti'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(status?.squadre || []).sort((a,b) => a.name.localeCompare(b.name)).map(sq => {
                  const team = teams?.find(t => t.name === sq.name);
                  const hasUpgrade = stadioSet.has(sq.name);
                  const stadioOk = status?.stadioPagato.has(sq.name);
                  const isBusyThis = busy === `stadio_${sq.name}`;
                  return (
                    <div key={sq.name} style={{ background: '#ffffff06', border: '1px solid #ffffff10', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      {team && <TeamAvatar team={team} size={36} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0' }}>{sq.name}</div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                          Entrate mensili: <b style={{ color: hasUpgrade ? '#10b981' : '#888' }}>{hasUpgrade ? '+5.5M' : '+4M'}</b>
                          {stadioOk && <span style={{ marginLeft: 8, color: '#10b981', fontSize: 10 }}>✓ pagato {status.meseISO}</span>}
                        </div>
                      </div>
                      {/* Toggle upgrade */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: '#555' }}>Ristrutturazione Stadio</span>
                        <button
                          onClick={() => toggleStadio(sq.name)}
                          disabled={isBusyThis || isBusy}
                          style={{ width: 44, height: 24, borderRadius: 12, border: 'none', background: hasUpgrade ? '#10b981' : '#ffffff15', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', opacity: isBusyThis ? 0.5 : 1 }}>
                          <div style={{ position: 'absolute', top: 3, left: hasUpgrade ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                        </button>
                        <span style={{ fontSize: 11, fontWeight: 700, color: hasUpgrade ? '#10b981' : '#555', minWidth: 36 }}>{hasUpgrade ? 'ON' : 'OFF'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── TASSE ── */}
          {tab === 'tasse' && status && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>📅 TASSA SETTIMANALE</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Domenica {status.domenica} · Art. 7.1</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => runBulk(applicaTassaATutti, 'Tassa settimanale a tutti')}
                    disabled={isBusy || !status.canApplicareTassa}
                    style={{ padding: '8px 18px', borderRadius: 10, border: '1.5px solid #f59e0b50', background: '#f59e0b18', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: (isBusy || !status.canApplicareTassa) ? 'not-allowed' : 'pointer', opacity: (isBusy || !status.canApplicareTassa) ? 0.55 : 1 }}>
                    {busy === 'Tassa settimanale a tutti' ? '⏳ Esecuzione...' : status.canApplicareTassa ? '📊 Applica tassa a tutti' : '✅ Tassa già applicata'}
                  </button>
                  <button
                    onClick={() => runBulk(annullaTassaATutti, `Annulla tassa ${status.domenica}`)}
                    disabled={isBusy || status.tassePagate.size === 0}
                    style={{ padding: '8px 14px', borderRadius: 10, border: '1.5px solid #ef444450', background: '#ef444418', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: (isBusy || status.tassePagate.size === 0) ? 'not-allowed' : 'pointer', opacity: (isBusy || status.tassePagate.size === 0) ? 0.55 : 1 }}>
                    {busy === `Annulla tassa ${status.domenica}` ? '⏳ Annullamento...' : '↩️ Annulla tassa settimana'}
                  </button>
                  <button
                    onClick={cleanupStoricoTasse}
                    disabled={isBusy}
                    style={{ padding: '8px 14px', borderRadius: 10, border: '1.5px solid #ef444450', background: '#ef444410', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.55 : 1 }}>
                    {busy === 'cleanup_tasse_storico' ? '⏳ Pulizia...' : `🧹 Elimina storico prima del ${status.domenica}`}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
                {(status.squadre || []).sort((a,b) => a.name.localeCompare(b.name)).map(sq => {
                  const team = teams?.find(t => t.name === sq.name);
                  const ok = status.tassePagate.has(sq.name);
                  const tassaCount = status.tasseDettagli?.countBySquadra?.[sq.name] || 0;
                  const tassaDates = status.tasseDettagli?.dateBySquadra?.[sq.name] || [];
                  const isDup = tassaCount > 1;
                  const tassa = calcolaTassa(sq.bilancio || 0);
                  return (
                    <div key={sq.name} style={{ background: isDup ? '#ef444408' : ok ? '#10b98108' : '#f59e0b08', border: `1px solid ${isDup ? '#ef444440' : ok ? '#10b98130' : '#f59e0b25'}`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      {team && <TeamAvatar team={team} size={28} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sq.name}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>{tassa.perc} → −{tassa.importo}M</div>
                        <div style={{ fontSize: 10, color: isDup ? '#ef4444' : ok ? '#10b981' : '#f59e0b', marginTop: 2 }}>
                          {tassaCount === 0 ? '0 pagamenti questa settimana' : `${tassaCount} pagamento${tassaCount > 1 ? 'i' : ''}: ${tassaDates.join(', ')}`}
                        </div>
                      </div>
                      <div style={{ fontSize: 18 }}>{isDup ? '⚠️' : ok ? '✅' : '⏳'}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 14, background: '#ffffff05', border: '1px solid #ffffff12', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#888', letterSpacing: '0.08em', marginBottom: 8 }}>🔎 CONTROLLO DETTAGLIATO TASSE</div>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                  Squadre OK: <b style={{ color: '#10b981' }}>{status.tassePagate.size}/{status.squadre.length}</b> · Record tassa totali nella settimana: <b style={{ color: status.tasseDettagli?.totaleRecord > status.squadre.length ? '#f59e0b' : '#888' }}>{status.tasseDettagli?.totaleRecord || 0}</b>
                </div>
                {status.tasseDettagli?.duplicate?.length > 0 ? (
                  <div style={{ fontSize: 11, color: '#ddd', marginBottom: 6 }}><b style={{ color: '#ef4444' }}>Pagate in più:</b> {status.tasseDettagli.duplicate.map(x => `${x.squadra} (${x.count}×: ${x.date.join(', ')})`).join(' · ')}</div>
                ) : <div style={{ fontSize: 11, color: '#10b981', marginBottom: 6 }}>✓ Nessuna squadra attiva ha più di una tassa nella settimana</div>}
                {status.tasseDettagli?.mancanti?.length > 0 ? (
                  <div style={{ fontSize: 11, color: '#ddd', marginBottom: 6 }}><b style={{ color: '#f59e0b' }}>Pagate in meno / mancanti:</b> {status.tasseDettagli.mancanti.join(' · ')}</div>
                ) : <div style={{ fontSize: 11, color: '#10b981', marginBottom: 6 }}>✓ Nessuna squadra attiva manca il pagamento</div>}
                {status.tasseDettagli?.extra?.length > 0 && (
                  <div style={{ fontSize: 11, color: '#ddd' }}><b style={{ color: '#f59e0b' }}>Record extra non associati a squadre attive:</b> {status.tasseDettagli.extra.map(x => `${x.squadra} (${x.count}×: ${x.date.join(', ')})`).join(' · ')}</div>
                )}
              </div>
            </div>
          )}

          {/* ── STIPENDI ── */}
          {tab === 'stipendi' && status && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>💰 STIPENDI MENSILI</div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Mese: {status.meseISO} · 1° del mese alle 9:00 · Art. 4.4</div>
                </div>
                <button
                  onClick={() => runBulk(applicaStipendioATutti, 'Stipendi mensili a tutti')}
                  disabled={isBusy}
                  style={{ padding: '8px 18px', borderRadius: 10, border: '1.5px solid #6366f150', background: '#6366f118', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1 }}>
                  {busy === 'Stipendi mensili a tutti' ? '⏳ Esecuzione...' : '💰 Applica stipendi a tutti'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
                {(status.squadre || []).sort((a,b) => a.name.localeCompare(b.name)).map(sq => {
                  const team = teams?.find(t => t.name === sq.name);
                  const ok = status.stipendiPagati.has(sq.name);
                  return (
                    <div key={sq.name} style={{ background: ok ? '#10b98108' : '#6366f108', border: `1px solid ${ok ? '#10b98130' : '#6366f125'}`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      {team && <TeamAvatar team={team} size={28} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sq.name}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>SC: {(sq.salary_used || 0).toFixed(1)}M → rata {((sq.salary_used || 0) / 12).toFixed(2)}M</div>
                      </div>
                      <div style={{ fontSize: 18 }}>{ok ? '✅' : '⏳'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STAGIONE ── */}
          {tab === 'stagione' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', marginBottom: 4 }}>⚙️ OPERAZIONI DI STAGIONE</div>
              {[
                { label: '📋 Iscrizione campionato a tutti (−30M)', fn: applicaIscrizioneATutti, color: '#f97316', desc: 'Applica il costo iscrizione alle squadre che non l\'hanno ancora pagata' },
                { label: '🔄 Aggiornamento quote (da Listone)', fn: null, color: '#6366f1', desc: 'Da eseguire da Mercato → Listone', disabled: true },
              ].map(op => (
                <div key={op.label} style={{ background: op.color + '08', border: `1px solid ${op.color}25`, borderRadius: 12, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: op.disabled ? '#444' : '#ccc' }}>{op.label}</div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>{op.desc}</div>
                  </div>
                  {!op.disabled && (
                    <button
                      onClick={() => op.fn && runBulk(op.fn, op.label)}
                      disabled={isBusy || op.disabled}
                      style={{ padding: '7px 16px', borderRadius: 9, border: `1.5px solid ${op.color}50`, background: op.color + '18', color: op.color, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                      Esegui
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab === 'telegram' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em', marginBottom: 4 }}>✈️ TELEGRAM — REGISTRAZIONI PRESIDENTI</div>

              {/* Info box */}
              <div style={{ background: '#6366f118', border: '1px solid #6366f130', borderRadius: 12, padding: '12px 16px', fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                I presidenti si registrano autonomamente cliccando il link nella loro <b style={{ color: '#c7d2fe' }}>Pagina Presidente</b>.<br/>
                Il bot invia notifiche private per: trattative, risultati aste, movimenti importanti.<br/>
                Il canale pubblico riceve: news pinnate, chiamate svincolati, tasse, stipendi, stadio.
              </div>

              {/* Load button */}
              <button
                onClick={loadTgRegs}
                disabled={tgLoading}
                style={{ alignSelf: 'flex-start', padding: '7px 18px', borderRadius: 9, border: '1.5px solid #6366f150', background: '#6366f118', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {tgLoading ? '…' : '🔄 Carica registrazioni'}
              </button>

              {/* Registrations table */}
              {tgRegs.length === 0 && !tgLoading && (
                <div style={{ color: '#555', fontSize: 12 }}>Nessuna registrazione trovata. Clicca "Carica registrazioni".</div>
              )}
              {tgRegs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tgRegs.map(r => (
                    <div key={r.squadra} style={{ background: '#10b98108', border: '1px solid #10b98120', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0' }}>{r.squadra}</div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                          @{r.username || '?'} · chat_id: {r.chat_id} · {new Date(r.registered_at).toLocaleDateString('it-IT')}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Rimuovere la registrazione di ${r.squadra}?`)) return;
                          await deleteTelegramRegistration(r.squadra);
                          setTgRegs(prev => prev.filter(x => x.squadra !== r.squadra));
                        }}
                        style={{ padding: '4px 12px', borderRadius: 7, border: '1px solid #ef444430', background: '#ef444410', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        ✕ Rimuovi
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Test message */}
              <div style={{ background: '#f59e0b08', border: '1px solid #f59e0b20', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 8 }}>🧪 Invia messaggio di test al canale</div>
                <button
                  onClick={() => {
                    sendTelegramNotification('nuova_notizia', {
                      squadra: 'Lega Admin',
                      titolo: '🧪 Test nuova notizia',
                      testo: 'Questo è un messaggio di test inviato dalla Control Room.',
                    });
                    alert('Messaggio inviato al canale (se configurato).');
                  }}
                  style={{ padding: '7px 16px', borderRadius: 9, border: '1.5px solid #f59e0b40', background: '#f59e0b15', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  📨 Invia test
                </button>
              </div>
            </div>
          )}
          {/* ── MERCATO ── */}
          {tab === 'mercato' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>🏪 MERCATO — OVERRIDE MANUALE</div>
              <div style={{ background: '#f59e0b08', border: '1px solid #f59e0b20', borderRadius: 12, padding: '14px 16px', fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                Di default il mercato segue le finestre automatiche (Estivo: 1/06–15/09, Invernale: 1/01–15/02).<br/>
                Puoi forzare apertura o chiusura manuale — si ripristina automaticamente impostando "Auto".
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { val: null,     label: '🔄 Auto (date fisse)',  color: '#6366f1' },
                  { val: 'aperto', label: '🟢 Forza APERTO',       color: '#10b981' },
                  { val: 'chiuso', label: '🔴 Forza CHIUSO',       color: '#ef4444' },
                ].map(opt => (
                  <button key={String(opt.val)} disabled={mercatoOvrLoading}
                    onClick={async () => {
                      setMercatoOvrLoading(true);
                      await setMercatoOverride(opt.val);
                      _mercatoOverride = opt.val;
                      setMercatoOvr(opt.val);
                      setMercatoOvrLoading(false);
                    }}
                    style={{ padding: '9px 18px', borderRadius: 10, border: `1.5px solid ${mercatoOvr === opt.val ? opt.color : opt.color + '40'}`, background: mercatoOvr === opt.val ? opt.color + '20' : 'transparent', color: mercatoOvr === opt.val ? opt.color : '#666', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {opt.label} {mercatoOvr === opt.val ? '✓' : ''}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#555' }}>
                Stato attuale: <b style={{ color: mercatoOvr === 'aperto' ? '#10b981' : mercatoOvr === 'chiuso' ? '#ef4444' : '#818cf8' }}>
                  {mercatoOvr === 'aperto' ? 'APERTO (override)' : mercatoOvr === 'chiuso' ? 'CHIUSO (override)' : 'Auto'}
                </b>
              </div>
            </div>
          )}

          {/* ── ASTE ── */}
          {tab === 'aste' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>🔔 ASTE SVINCOLATI ATTIVE</div>
                <button onClick={loadAste} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #6366f130', background: '#6366f110', color: '#818cf8', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🔄 Aggiorna</button>
              </div>
              {asteAttive.length === 0 && <div style={{ color: '#555', fontSize: 12 }}>Nessuna asta attiva. Clicca "Aggiorna".</div>}
              {asteAttive.map(asta => (
                <div key={asta.id} style={{ background: '#6366f108', border: '1px solid #6366f125', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#f0f0f0' }}>{asta.giocatore}</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                        Q{asta.quot} · chiamato da {asta.aperta_da} · {asta.n_interessati} interessati
                      </div>
                      <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                        ⏰ Scade: {new Date(asta.scadenza).toLocaleString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <button
                        onClick={async () => {
                          try {
                            const offerte = await getOfferteAsta(asta.id);
                            const { data: chiamateAsta } = await supabase.from('chiamate').select('squadra').eq('giocatore', asta.giocatore);
                            const squadreInteressate = (chiamateAsta || []).map(c => c.squadra);
                            const { data: dsInvs } = await supabase.from('investimenti').select('squadra, dati').eq('nome', 'DS Masterclass').in('squadra', squadreInteressate);
                            const dsTeams = (dsInvs || []).filter(d => (d.dati?.utilizzi_masterclass || 0) < 2);
                            if (!dsTeams.length) { alert('Nessun presidente con DS Masterclass disponibile.'); return; }
                            for (const ds of dsTeams) {
                              const altrui = offerte.filter(o => o.squadra !== ds.squadra && !o.assente);
                              const riepilogo = altrui.length ? altrui.map(o => `• ${o.squadra}: ${Number(o.importo).toFixed(2)}M`).join('\n') : 'Nessuna offerta ancora.';
                              sendTelegramNotification('ds_masterclass_offerte', { giocatore: asta.giocatore, riepilogo, scadenza: new Date(asta.scadenza).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) }, ds.squadra);
                            }
                            alert(`✅ Notifica DS inviata a ${dsTeams.length} presidente/i.`);
                          } catch(e) { alert(e.message); }
                        }}
                        style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #f59e0b40', background: '#f59e0b10', color: '#f59e0b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        📡 DS Masterclass
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── FPF ── */}
          {tab === 'fpf' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>⚖️ FAIR PLAY FINANZIARIO — CONTROLLO SEMESTRALE (art. 7.3)</div>
              <div style={{ background: '#ef444408', border: '1px solid #ef444420', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                Eseguire a <b style={{ color: '#f87171' }}>metà stagione (15/02)</b> e a <b style={{ color: '#f87171' }}>fine stagione (01/06)</b>.<br/>
                Soglia: <b>50M</b> netto speso per semestre · Multa: <b>20% dell'eccedenza</b> · Oltre 60M: penale punti aggiuntiva.<br/>
                <b style={{ color: '#f87171' }}>Operazione irreversibile</b> — verifica i dati prima di applicare.
              </div>
              <button onClick={loadFpf} style={{ alignSelf: 'flex-start', padding: '7px 16px', borderRadius: 9, border: '1px solid #6366f130', background: '#6366f110', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📊 Calcola situazione FPF</button>
              {fpfData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(fpfData).sort((a,b) => b[1]-a[1]).map(([squadra, netto]) => {
                    const { zona, multa, pt, euro } = calcolaFairSpending(netto);
                    const colore = multa > 0 ? (multa >= 20 ? '#ef4444' : multa >= 15 ? '#f97316' : '#f59e0b') : '#10b981';
                    return (
                      <div key={squadra} style={{ background: colore + '08', border: `1px solid ${colore}25`, borderRadius: 10, padding: '9px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0' }}>{squadra}</span>
                          <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>Netto: {netto.toFixed(1)}M</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {multa > 0 ? (
                            <>
                              <span style={{ fontSize: 11, color: colore, fontWeight: 700 }}>−{multa}M</span>
                              {pt > 0 && <span style={{ fontSize: 10, color: colore }}>−{pt}pt</span>}
                              {euro > 0 && <span style={{ fontSize: 10, color: colore }}>−{euro}€</span>}
                            </>
                          ) : <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>✓ In regola</span>}
                        </div>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => runBulk(() => applicaMulteFPFTutte(STAGIONE_CR), 'Multe FPF a tutti')}
                    disabled={isBusy}
                    style={{ marginTop: 8, padding: '9px 20px', borderRadius: 10, border: '1.5px solid #ef444450', background: '#ef444415', color: '#ef4444', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    ⚖️ Applica multe FPF a tutte le squadre
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── BILANCIO NEGATIVO (art. 7.2) ── */}
          {tab === 'bilancio_neg' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>🔴 BUDGET NEGATIVO — PENALIZZAZIONI (art. 7.2)</div>
              <div style={{ background: '#ef444408', border: '1px solid #ef444420', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                Squadre con bilancio negativo ricevono penalizzazioni punti ogni settimana:<br/>
                <b style={{ color: '#f87171' }}>0 → −10M</b>: −5 pt · <b style={{ color: '#f87171' }}>−10 → −20M</b>: −10 pt · <b style={{ color: '#f87171' }}>−20 → −30M</b>: −15 pt · <b style={{ color: '#f87171' }}>oltre −30M</b>: −15 pt (stessa fascia)
              </div>
              <button
                onClick={() => {
                  const neg = (teams || []).filter(t => (t.bilancio || 0) < 0);
                  setBilancioNegData(neg.map(t => ({
                    ...t,
                    fascia: getFasciaBilancioNeg(t.bilancio),
                    settimane: t.bilancioNegSettimane || 0,
                  })));
                }}
                style={{ alignSelf: 'flex-start', padding: '7px 16px', borderRadius: 9, border: '1px solid #ef444430', background: '#ef444410', color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                🔍 Controlla squadre in negativo
              </button>

              {bilancioNegData !== null && (
                bilancioNegData.length === 0
                  ? <div style={{ fontSize: 13, color: '#10b981', fontWeight: 700 }}>✓ Nessuna squadra in negativo</div>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {bilancioNegData.map(t => {
                        const penPunti = t.fascia?.pts || 0;
                        const isBusyThis = bilancioNegBusy === t.name;
                        return (
                          <div key={t.name} style={{ background: '#ef444408', border: '1px solid #ef444425', borderRadius: 12, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <TeamAvatar team={t} size={20} />
                                  {t.name}
                                </div>
                                <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                                  Bilancio: <span style={{ color: '#ef4444', fontWeight: 700 }}>{(t.bilancio || 0).toFixed(1)}M</span>
                                  {' · '}Settimane in neg.: <span style={{ color: '#f97316', fontWeight: 700 }}>{t.settimane}</span>
                                  {' · '}Fascia: <span style={{ color: '#f87171', fontWeight: 700 }}>−{penPunti} pt/sett.</span>
                                </div>
                              </div>
                              <button
                                disabled={isBusyThis || !penPunti}
                                onClick={async () => {
                                  if (!window.confirm(`Applicare penalizzazione di −${penPunti} pt a ${t.name}?\n\nBilancio: ${(t.bilancio||0).toFixed(1)}M`)) return;
                                  setBilancioNegBusy(t.name);
                                  try {
                                    await insertPenalita({
                                      squadra: t.name,
                                      stagione: STAGIONE_CR,
                                      codice_tipo: 'budget_negativo',
                                      descrizione: `Budget negativo ${(t.bilancio||0).toFixed(1)}M — penale ${penPunti} pt (art. 7.2)`,
                                      punti: -penPunti,
                                      data_multa: new Date().toISOString().slice(0, 10),
                                      applicata: true,
                                    });
                                    await updateClassificaSquadra(t.name, { punti: Math.max(0, ((teams.find(x=>x.name===t.name)?.penalita)||0) - penPunti) });
                                    alert(`✓ Penale −${penPunti} pt applicata a ${t.name}`);
                                    await load();
                                  } catch(e) { alert(e.message); }
                                  finally { setBilancioNegBusy(null); }
                                }}
                                style={{ padding: '6px 14px', borderRadius: 8, border: '1.5px solid #ef444450', background: '#ef444415', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: penPunti ? 1 : 0.4 }}>
                                {isBusyThis ? '…' : `⚠️ Applica −${penPunti} pt`}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
              )}
            </div>
          )}

          {/* ── SVINCOLI PANORAMICA (art. 6.5) ── */}
          {tab === 'svincoli_cr' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>✂️ SVINCOLI STAGIONE — PANORAMICA (art. 6.5)</div>
              <div style={{ background: '#6366f108', border: '1px solid #6366f125', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                Monitoraggio svincoli per ogni squadra. Oltre 14 svincoli stagionali: penale <b style={{ color: '#f87171' }}>+2M</b> per ogni svincolo eccedente (art. 6.5).
              </div>
              <button
                disabled={svincoliLoading}
                onClick={async () => {
                  setSvincoliLoading(true);
                  try {
                    const results = await Promise.all((teams || []).map(t =>
                      getStagioneSvincoli(t.name).then(d => [t.name, d])
                    ));
                    const map = {};
                    results.forEach(([name, d]) => { map[name] = d; });
                    setSvincoliAll(map);
                  } catch(e) { alert(e.message); }
                  finally { setSvincoliLoading(false); }
                }}
                style={{ alignSelf: 'flex-start', padding: '7px 16px', borderRadius: 9, border: '1px solid #6366f130', background: '#6366f110', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {svincoliLoading ? '⏳ Caricamento…' : '📊 Carica svincoli tutte le squadre'}
              </button>

              {Object.keys(svincoliAll).length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #ffffff15' }}>
                        {['Squadra', 'Totale', 'Ordinari', 'Straord.', 'Stato'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#555', fontWeight: 700, fontSize: 10 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(teams || [])
                        .map(t => ({ t, d: svincoliAll[t.name] || {} }))
                        .sort((a, b) => (b.d.count_totale || 0) - (a.d.count_totale || 0))
                        .map(({ t, d }) => {
                          const tot = d.count_totale || 0;
                          const overLimit = tot > 14;
                          const atLimit = tot === 14;
                          const color = overLimit ? '#ef4444' : atLimit ? '#f59e0b' : tot >= 12 ? '#f97316' : '#10b981';
                          return (
                            <tr key={t.name} style={{ borderBottom: '1px solid #ffffff08' }}
                              onMouseEnter={e => e.currentTarget.style.background = '#ffffff05'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <td style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <TeamAvatar team={t} size={20} />
                                <span style={{ fontWeight: 600, color: '#ddd' }}>{t.name}</span>
                              </td>
                              <td style={{ padding: '8px 10px', fontWeight: 900, color, fontFamily: "'Bebas Neue',sans-serif", fontSize: 16 }}>{tot}<span style={{ fontSize: 10, color: '#444' }}>/14</span></td>
                              <td style={{ padding: '8px 10px', color: '#888' }}>{d.count_ordinari || 0}</td>
                              <td style={{ padding: '8px 10px', color: '#888' }}>{(d.count_straord_estivi || 0) + (d.count_straord_invernali || 0)}</td>
                              <td style={{ padding: '8px 10px' }}>
                                {overLimit
                                  ? <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: '#ef444415', border: '1px solid #ef444430', borderRadius: 6, padding: '2px 7px' }}>⚠️ Penale +{(tot - 14) * 2}M</span>
                                  : atLimit
                                    ? <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#f59e0b15', border: '1px solid #f59e0b30', borderRadius: 6, padding: '2px 7px' }}>Al limite</span>
                                    : <span style={{ fontSize: 10, color: '#10b981' }}>✓ OK</span>}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── RIVALITÀ & GEMELLATI ── */}
          {tab === 'rivalita' && (() => {
            async function toggleLock() {
              if (!window.confirm(lockGlobale ? 'Sbloccare le scelte? I presidenti potranno modificare rivale e gemellato.' : 'Bloccare le scelte? Nessun presidente potrà più modificare rivale o gemellato.')) return;
              setLockBusy(true);
              try {
                await setRivalitaLock(!lockGlobale);
                _rivalitaBloccata = !lockGlobale;
                setLockGlobale(!lockGlobale);
              } catch(e) { alert(e.message); }
              finally { setLockBusy(false); }
            }
            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>⚔️ RIVALITÀ & GEMELLATI — GESTIONE ADMIN</div>

              {/* Lock globale */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: lockGlobale ? '#ef444410' : '#10b98110', border: `1px solid ${lockGlobale ? '#ef444430' : '#10b98130'}`, borderRadius: 12, padding: '12px 16px', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: lockGlobale ? '#ef4444' : '#10b981' }}>
                    {lockGlobale ? '🔒 Scelte bloccate' : '🔓 Scelte aperte'}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                    {lockGlobale ? 'I presidenti non possono modificare rivale/gemellato' : 'I presidenti possono scegliere o cambiare rivale/gemellato'}
                  </div>
                </div>
                <button
                  disabled={lockBusy}
                  onClick={toggleLock}
                  style={{ padding: '8px 18px', borderRadius: 9, border: `1.5px solid ${lockGlobale ? '#10b98150' : '#ef444450'}`, background: lockGlobale ? '#10b98115' : '#ef444415', color: lockGlobale ? '#10b981' : '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {lockBusy ? '…' : lockGlobale ? '🔓 Sblocca' : '🔒 Blocca'}
                </button>
              </div>

              <button
                disabled={!!rivalitaBusy}
                onClick={async () => {
                  setRivalitaBusy('load');
                  try {
                    const { data } = await supabase.from('club_identity').select('squadra, rivali, gemellato');
                    setRivalitaData(data || []);
                  } catch(e) { alert(e.message); }
                  finally { setRivalitaBusy(null); }
                }}
                style={{ alignSelf: 'flex-start', padding: '7px 16px', borderRadius: 9, border: '1px solid #6366f130', background: '#6366f110', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {rivalitaBusy === 'load' ? '⏳ Caricamento…' : '📋 Carica dati rivalità'}
              </button>

              {rivalitaData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(teams || []).map(t => {
                    const ci = rivalitaData.find(r => r.squadra === t.name) || {};
                    const TEAMS_LIST_CR = ["Alcool Campi","AK Toio","Agnus Dei FC","Balillareal","Borjcellona","Wehrmacht FC","Finocchiona AC","Shalpe 104"];
                    const altre = TEAMS_LIST_CR.filter(n => n !== t.name);
                    const isRivBusy = rivalitaBusy === `riv_${t.name}`;
                    const isGemBusy = rivalitaBusy === `gem_${t.name}`;
                    const selStyle = { padding: '4px 8px', borderRadius: 6, border: '1px solid #ffffff15', background: '#0d0f14', color: '#f0f0f0', fontSize: 11 };
                    async function salvaRivalita(field, val) {
                      const confirm_msg = field === 'rivali' ? `Impostare rivale di ${t.name} → ${val || '(nessuno)'}?` : `Impostare gemellato di ${t.name} → ${val || '(nessuno)'}?`;
                      if (!window.confirm(confirm_msg)) return;
                      setRivalitaBusy(`${field === 'rivali' ? 'riv' : 'gem'}_${t.name}`);
                      try {
                        await supabase.from('club_identity').upsert({ squadra: t.name, [field]: val || null, updated_at: new Date().toISOString() }, { onConflict: 'squadra' });
                        const { data } = await supabase.from('club_identity').select('squadra, rivali, gemellato');
                        setRivalitaData(data || []);
                      } catch(e) { alert(e.message); }
                      finally { setRivalitaBusy(null); }
                    }
                    return (
                      <div key={t.name} style={{ background: '#ffffff06', border: '1px solid #ffffff10', borderRadius: 12, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <TeamAvatar team={t} size={22} />
                          <span style={{ fontWeight: 700, color: '#f0f0f0', fontSize: 13 }}>{t.name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 180 }}>
                            <div style={{ fontSize: 9, color: '#555', letterSpacing: '0.06em', marginBottom: 4 }}>RIVALE (art. 8.3)</div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <select value={ci.rivali || ""} onChange={e => salvaRivalita('rivali', e.target.value)} disabled={isRivBusy} style={selStyle}>
                                <option value="">— Nessuno —</option>
                                {altre.map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                              {ci.rivali && <span style={{ fontSize: 9, color: '#ef4444', background: '#ef444415', border: '1px solid #ef444430', borderRadius: 4, padding: '1px 6px' }}>⚔️ {ci.rivali}</span>}
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 180 }}>
                            <div style={{ fontSize: 9, color: '#555', letterSpacing: '0.06em', marginBottom: 4 }}>GEMELLATO</div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <select value={ci.gemellato || ""} onChange={e => salvaRivalita('gemellato', e.target.value)} disabled={isGemBusy} style={selStyle}>
                                <option value="">— Nessuno —</option>
                                {altre.map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                              {ci.gemellato && <span style={{ fontSize: 9, color: '#a78bfa', background: '#a78bfa15', border: '1px solid #a78bfa30', borderRadius: 4, padding: '1px 6px' }}>💜 {ci.gemellato}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })()}

          {/* ── DATABASE FANTA ── */}
          {tab === 'database' && (() => {
            const TIPI = [
              { key: 'settimanale', label: '📅 Settimanale', desc: 'Stats + quot reale. Quota in rosa invariata.' },
              { key: '01/01',       label: '🗓 01/01',        desc: 'Top 5 rialzo obbligatorio + finestra ribasso fino 05/01 20:00.' },
              { key: '01/06',       label: '☀️ 01/06',        desc: 'Aggiornamento completo quotazioni per tutti.' },
              { key: '01/08',       label: '🏖 01/08',        desc: 'Aggiornamento completo quotazioni per tutti.' },
            ];
            const tipoColor = { settimanale: '#818cf8', '01/01': '#f59e0b', '01/06': '#10b981', '01/08': '#10b981' };
            const c = tipoColor[dbTipo] || '#818cf8';

            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>📊 IMPORT DATABASE FANTA.XLSX</div>

              {/* Selettore tipo */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TIPI.map(t => (
                  <button key={t.key} onClick={() => { setDbTipo(t.key); setDbImportPreview(null); setDbImportDone(null); }}
                    style={{ padding: '7px 14px', borderRadius: 9, border: `1.5px solid ${dbTipo===t.key ? tipoColor[t.key]+'80' : '#ffffff15'}`, background: dbTipo===t.key ? tipoColor[t.key]+'18' : 'transparent', color: dbTipo===t.key ? tipoColor[t.key] : '#555', fontSize: 11, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                    {t.label}<br/><span style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>{t.desc}</span>
                  </button>
                ))}
              </div>

              {/* Upload */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ padding: '8px 16px', borderRadius: 9, border: `1.5px solid ${c}50`, background: `${c}15`, color: c, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  📂 Carica Database Fanta.xlsx
                  <input type="file" accept=".xlsx" style={{ display: 'none' }}
                    onChange={async e => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setDbImportPreview(null); setDbImportDone(null); setDbImportBusy(true);
                      try {
                        const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
                        const buf = await file.arrayBuffer();
                        const wb = XLSX.read(buf);
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const rows = XLSX.utils.sheet_to_json(ws);
                        const rosaCheck = rows.filter(r => r['FantaSquadra']).length;
                        const svinCheck = rows.filter(r => !r['FantaSquadra'] && r['QUOT.'] > 0).length;
                        // Per 01/01: carica anteprima top5 dopo import
                        let top5Preview = null;
                        if (dbTipo === '01/01') {
                          // Prima importa il file per aggiornare quot_reale, poi calcola top5
                          await importDatabaseFanta(rows, STAGIONE_CR);
                          top5Preview = await calcolaTop5GlobaleQuotReale();
                        }
                        setDbImportPreview({ rows, rosaCheck, svinCheck, nomeFile: file.name, top5Preview });
                      } catch(err) { alert('Errore: ' + err.message); }
                      finally { setDbImportBusy(false); e.target.value = ''; }
                    }}
                  />
                </label>
                {dbImportBusy && <span style={{ fontSize: 12, color: '#555' }}>⏳ {dbTipo === '01/01' ? 'Import + calcolo top5…' : 'Lettura file…'}</span>}
              </div>

              {/* Anteprima */}
              {dbImportPreview && !dbImportDone && (
                <div style={{ background: '#ffffff06', border: '1px solid #ffffff12', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.06em' }}>ANTEPRIMA — {dbImportPreview.nomeFile} ({TIPI.find(t=>t.key===dbTipo)?.label})</div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Righe totali', value: dbImportPreview.rows.length, color: c },
                      { label: 'In rosa', value: dbImportPreview.rosaCheck, color: '#f59e0b' },
                      { label: 'Svincolati', value: dbImportPreview.svinCheck, color: '#10b981' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: '1 1 100px', background: s.color + '10', border: `1px solid ${s.color}25`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 8, color: s.color, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>{s.label.toUpperCase()}</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* 01/01: mostra top5 rialzo e ribasso */}
                  {dbTipo === '01/01' && dbImportPreview.top5Preview && (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {/* Top 5 rialzo */}
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#10b981', letterSpacing: '0.06em', marginBottom: 8 }}>📈 TOP 5 RIALZO OBBLIGATORIO</div>
                        {dbImportPreview.top5Preview.rialzi.length === 0
                          ? <div style={{ fontSize: 11, color: '#555' }}>Nessun rialzo</div>
                          : dbImportPreview.top5Preview.rialzi.map(p => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #ffffff08' }}>
                              <div>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#f0f0f0' }}>{p.nome}</span>
                                <span style={{ fontSize: 10, color: '#666', marginLeft: 6 }}>{p.squadra}</span>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>+{p.delta} Q</span>
                                <div style={{ fontSize: 9, color: '#555' }}>{p.quot} → {p.quot_reale}</div>
                              </div>
                            </div>
                          ))}
                      </div>
                      {/* Top 5 ribasso */}
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.06em', marginBottom: 8 }}>📉 TOP 5 RIBASSO (scelta presidenti entro 05/01 20:00)</div>
                        {dbImportPreview.top5Preview.ribassi.length === 0
                          ? <div style={{ fontSize: 11, color: '#555' }}>Nessun ribasso</div>
                          : dbImportPreview.top5Preview.ribassi.map(p => {
                            const isU21 = p.anni > 0 && p.anni <= 21;
                            const is3031 = p.anni >= 31;
                            return (
                              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #ffffff08' }}>
                                <div>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f0f0f0' }}>{p.nome}</span>
                                  <span style={{ fontSize: 10, color: '#666', marginLeft: 6 }}>{p.squadra}</span>
                                  {isU21 && <span style={{ fontSize: 9, color: '#ef4444', marginLeft: 4 }}>U21 ✗</span>}
                                  {!isU21 && !is3031 && <span style={{ fontSize: 9, color: '#f97316', marginLeft: 4 }}>22-30 (cedere)</span>}
                                  {is3031 && <span style={{ fontSize: 9, color: '#10b981', marginLeft: 4 }}>31+ OK</span>}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>{p.delta} Q</span>
                                  <div style={{ fontSize: 9, color: '#555' }}>{p.quot} → {p.quot_reale}</div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* 01/06 / 01/08: nota */}
                  {(dbTipo === '01/06' || dbTipo === '01/08') && (
                    <div style={{ background: '#10b98110', border: '1px solid #10b98130', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#10b981' }}>
                      ✅ Aggiornamento completo: quot = quot_reale per tutti i giocatori in rosa (U21: stip invariato).
                    </div>
                  )}

                  <button
                    disabled={dbImportBusy}
                    onClick={async () => {
                      const label = TIPI.find(t=>t.key===dbTipo)?.label || dbTipo;
                      if (!window.confirm(`Applicare aggiornamento ${label}?\n\n${dbTipo==='01/01' ? `• Top 5 rialzo: quotazioni applicate subito\n• Top 5 ribasso: finestra aperta per i presidenti fino al 05/01 20:00` : dbTipo==='settimanale' ? 'Stats + quot_reale aggiornati. Quotazioni in rosa invariate.' : 'Tutte le quotazioni in rosa verranno aggiornate a quot_reale.'}`)) return;
                      setDbImportBusy(true);
                      try {
                        let result;
                        if (dbTipo === 'settimanale') {
                          result = await importDatabaseFanta(dbImportPreview.rows, STAGIONE_CR);
                        } else if (dbTipo === '01/01') {
                          // Import già fatto al caricamento file, ora applica i rialzi
                          const { rialziApplicati } = await applica01Gennaio(dbImportPreview.top5Preview.rialzi, STAGIONE_CR);
                          result = { rosaAggiornati: rialziApplicati, svinAggiornati: 0, nonTrovati: [], totale: dbImportPreview.rows.length, note: 'Top 5 rialzi applicati. Finestra ribasso aperta per i presidenti.' };
                        } else if (dbTipo === '01/06') {
                          await importDatabaseFanta(dbImportPreview.rows, STAGIONE_CR);
                          const { aggiornati, totale } = await applica01GiugnoAgosto(STAGIONE_CR);
                          result = { rosaAggiornati: aggiornati, svinAggiornati: 0, nonTrovati: [], totale, note: 'Quotazioni aggiornate per tutti i giocatori in rosa.' };
                        } else {
                          // 01/08: full import con creazione nuovi giocatori
                          const r = await importa01Agosto(dbImportPreview.rows, STAGIONE_CR);
                          result = { rosaAggiornati: r.rosaAggiornati, svinAggiornati: r.svinAggiornati, nonTrovati: r.nonTrovati, totale: r.totale, note: `Aggiornamento completo: ${r.rosaAggiornati} in rosa, ${r.svinAggiornati} svincolati aggiornati, ${r.nuoviCreati} nuovi creati.` };
                        }
                        setDbImportDone(result);
                        setDbImportPreview(null);
                      } catch(err) { alert('Errore: ' + err.message); }
                      finally { setDbImportBusy(false); }
                    }}
                    style={{ padding: '9px 20px', borderRadius: 10, border: `1.5px solid ${c}50`, background: `${c}15`, color: c, fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' }}>
                    {dbImportBusy ? '⏳ In corso…' : `▶️ Applica aggiornamento ${TIPI.find(t=>t.key===dbTipo)?.label}`}
                  </button>
                </div>
              )}

              {/* Risultato */}
              {dbImportDone && (
                <div style={{ background: '#10b98110', border: '1px solid #10b98130', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>✅ Aggiornamento completato</div>
                  {dbImportDone.note && <div style={{ fontSize: 12, color: '#aaa' }}>{dbImportDone.note}</div>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Giocatori aggiornati', value: dbImportDone.rosaAggiornati, color: '#f59e0b' },
                      { label: 'Non trovati', value: dbImportDone.nonTrovati?.length || 0, color: (dbImportDone.nonTrovati?.length || 0) > 0 ? '#ef4444' : '#555' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: '1 1 120px', background: s.color + '10', border: `1px solid ${s.color}25`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 8, color: s.color, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>{s.label.toUpperCase()}</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {(dbImportDone.nonTrovati?.length || 0) > 0 && (
                    <details style={{ fontSize: 11, color: '#ef4444' }}>
                      <summary style={{ cursor: 'pointer' }}>⚠️ {dbImportDone.nonTrovati.length} non trovati</summary>
                      <div style={{ marginTop: 8, background: '#ef444408', borderRadius: 8, padding: '8px 12px', maxHeight: 160, overflowY: 'auto', lineHeight: 1.7, color: '#f87171', fontSize: 11 }}>
                        {dbImportDone.nonTrovati.join(' · ')}
                      </div>
                    </details>
                  )}
                  <button onClick={() => setDbImportDone(null)} style={{ alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 7, border: '1px solid #ffffff15', background: 'transparent', color: '#555', fontSize: 11, cursor: 'pointer' }}>
                    Nuovo import
                  </button>
                </div>
              )}
            </div>
            );
          })()}

          {/* ── PREMI ── */}
          {tab === 'premi' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>🏆 PREMI CAMPIONATO — DISTRIBUZIONE FINALE</div>
              <div style={{ background: '#f59e0b08', border: '1px solid #f59e0b20', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                Distribuisce i premi in base alla classifica finale della stagione {STAGIONE_CR}.<br/>
                Idempotente — salta le squadre già premiate.
              </div>
              <button onClick={loadClassifica} style={{ alignSelf: 'flex-start', padding: '7px 16px', borderRadius: 9, border: '1px solid #f59e0b30', background: '#f59e0b10', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📋 Carica classifica</button>
              {classifica.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {classifica.map((sq, i) => {
                    const pos = i + 1;
                    const premio = calcolaPremiFinali(pos);
                    return (
                      <div key={sq.squadra} style={{ background: '#ffffff06', border: '1px solid #ffffff10', borderRadius: 10, padding: '9px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 16, fontWeight: 900, color: pos <= 3 ? '#f59e0b' : '#555', fontFamily: "'Bebas Neue',sans-serif", width: 24 }}>{pos}°</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0' }}>{sq.squadra}</span>
                          <span style={{ fontSize: 11, color: '#666' }}>{sq.punti} pt</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: premio > 0 ? '#10b981' : '#444' }}>
                          {premio > 0 ? `+${premio}M` : '—'}
                        </span>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => runBulk(() => applicaPremiCampionato(STAGIONE_CR), 'Premi campionato')}
                    disabled={isBusy}
                    style={{ marginTop: 8, padding: '9px 20px', borderRadius: 10, border: '1.5px solid #10b98150', background: '#10b98115', color: '#10b981', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    🏆 Distribuisci premi campionato
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── CONTRATTI ── */}
          {tab === 'contratti' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>📋 CONTRATTI — RINNOVO ANNUALE</div>
              <div style={{ background: '#6366f108', border: '1px solid #6366f125', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                Esegui a fine stagione (01/06) per aggiornare tutti i contratti:<br/>
                • Avanza <b style={{ color: '#c7d2fe' }}>anni_contratto</b> per tutti i giocatori<br/>
                • Applica aumenti di stipendio automatici<br/>
                • Svincola automaticamente chi era all'anno 2 senza rinnovo confermato
              </div>
              <button
                onClick={async () => {
                  if (!window.confirm('Aggiornare tutti i contratti a fine stagione?\n\nI giocatori all\'anno 2 non confermati verranno svincolati automaticamente.')) return;
                  setBusy('Contratti annuali');
                  try {
                    const res = await aggiornaContrattiAnnuali();
                    setLastResult({ label: 'Contratti annuali', ok: res.aggiornati?.length || 0, skip: res.svincolati?.length || 0, ts: new Date().toLocaleTimeString('it-IT') });
                    if (res.svincolati?.length) alert(`⚠️ Svincolati automaticamente:\n${res.svincolati.map(s => `• ${s.nome} (${s.squadra})`).join('\n')}`);
                    cacheInvalidate('rosa_');
                    await load();
                  } catch(e) { alert(e.message); }
                  finally { setBusy(null); }
                }}
                disabled={isBusy}
                style={{ alignSelf: 'flex-start', padding: '9px 20px', borderRadius: 10, border: '1.5px solid #6366f150', background: '#6366f115', color: '#818cf8', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                📋 Aggiorna contratti annuali
              </button>
            </div>
          )}

          {/* ── UTENTI ── */}
          {tab === 'utenti' && (() => {
            const RUOLI = [
              { val: 'founder', label: '👑 Founder', color: '#f59e0b', bg: '#f59e0b18', border: '#f59e0b40' },
              { val: 'admin',   label: '⚡ Admin',   color: '#818cf8', bg: '#6366f118', border: '#6366f140' },
              { val: null,      label: '👤 Utente',  color: '#888',    bg: '#ffffff08', border: '#ffffff15' },
              { val: 'banned',  label: '🚫 Bannato', color: '#ef4444', bg: '#ef444418', border: '#ef444440' },
            ];
            const getRuolo = r => RUOLI.find(x => x.val === r) || RUOLI[2];

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>👥 GESTIONE UTENTI</div>
                  <button onClick={loadUtenti} disabled={utentiLoading} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #f59e0b30', background: '#f59e0b10', color: '#f59e0b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    {utentiLoading ? '...' : '🔄 Carica'}
                  </button>
                </div>

                {utenti.length === 0 && !utentiLoading && (
                  <div style={{ fontSize: 12, color: '#555', padding: 20, textAlign: 'center' }}>Clicca "Carica" per vedere tutti gli utenti.</div>
                )}

                {utenti.map(u => {
                  const ruoloInfo = getRuolo(u.ruolo);
                  const isEditing = utentiEdit?.id === u.id;
                  const ed = isEditing ? utentiEdit : null;

                  return (
                    <div key={u.id} style={{ background: '#ffffff06', border: `1px solid ${ruoloInfo.border}`, borderRadius: 12, padding: '14px 16px' }}>
                      {!isEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          {/* Avatar */}
                          <div style={{ flexShrink: 0 }}>
                            {u.avatar_url
                              ? <img src={u.avatar_url} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', border: `2px solid ${ruoloInfo.border}` }} />
                              : <div style={{ width: 44, height: 44, borderRadius: 10, background: ruoloInfo.bg, border: `2px solid ${ruoloInfo.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👤</div>
                            }
                          </div>
                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 140 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 800, fontSize: 14, color: '#f0f0f0' }}>{u.nome || u.email || u.id.slice(0,8)}</span>
                              <span style={{ padding: '2px 8px', borderRadius: 6, background: ruoloInfo.bg, border: `1px solid ${ruoloInfo.border}`, color: ruoloInfo.color, fontSize: 10, fontWeight: 700 }}>{ruoloInfo.label}</span>
                            </div>
                            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                              {u.squadra && <span style={{ marginRight: 10 }}>🏟 {u.squadra}</span>}
                              {u.email && <span style={{ color: '#444' }}>{u.email}</span>}
                            </div>
                            {u.bio && <div style={{ fontSize: 11, color: '#777', marginTop: 4, fontStyle: 'italic' }}>"{u.bio}"</div>}
                          </div>
                          {/* Edit btn */}
                          <button onClick={() => setUtentiEdit({ id: u.id, nome: u.nome || '', bio: u.bio || '', avatar_url: u.avatar_url || '', ruolo: u.ruolo || null })}
                            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ffffff15', background: '#ffffff08', color: '#aaa', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                            ✏️ Modifica
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#f0f0f0', marginBottom: 2 }}>
                            Modifica — {u.squadra || u.email || u.id.slice(0,8)}
                          </div>

                          {/* Ruolo selector */}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {RUOLI.map(r => (
                              <button key={String(r.val)} onClick={() => setUtentiEdit(e => ({ ...e, ruolo: r.val }))}
                                style={{ padding: '4px 10px', borderRadius: 8, border: `1.5px solid ${ed.ruolo === r.val ? r.border : '#ffffff15'}`, background: ed.ruolo === r.val ? r.bg : 'transparent', color: ed.ruolo === r.val ? r.color : '#555', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                {r.label}
                              </button>
                            ))}
                          </div>

                          {/* Nome */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontSize: 10, color: '#666', fontWeight: 700 }}>NOME VISUALIZZATO</label>
                            <input value={ed.nome} onChange={e => setUtentiEdit(v => ({ ...v, nome: e.target.value }))}
                              placeholder="Nome utente..."
                              style={{ background: '#0d0f14', border: '1px solid #ffffff18', borderRadius: 8, padding: '7px 10px', color: '#f0f0f0', fontSize: 12, outline: 'none' }} />
                          </div>

                          {/* Bio */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontSize: 10, color: '#666', fontWeight: 700 }}>BIO</label>
                            <textarea value={ed.bio} onChange={e => setUtentiEdit(v => ({ ...v, bio: e.target.value }))}
                              placeholder="Bio utente..."
                              rows={2}
                              style={{ background: '#0d0f14', border: '1px solid #ffffff18', borderRadius: 8, padding: '7px 10px', color: '#f0f0f0', fontSize: 12, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
                          </div>

                          {/* Avatar URL */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontSize: 10, color: '#666', fontWeight: 700 }}>URL AVATAR</label>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input value={ed.avatar_url} onChange={e => setUtentiEdit(v => ({ ...v, avatar_url: e.target.value }))}
                                placeholder="https://..."
                                style={{ flex: 1, background: '#0d0f14', border: '1px solid #ffffff18', borderRadius: 8, padding: '7px 10px', color: '#f0f0f0', fontSize: 12, outline: 'none' }} />
                              {ed.avatar_url && (
                                <img src={ed.avatar_url} alt="" onError={e => e.target.style.display='none'}
                                  style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', border: '1px solid #ffffff18', flexShrink: 0 }} />
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <button onClick={() => salvaUtente(ed)} disabled={utentiSaving}
                              style={{ padding: '7px 18px', borderRadius: 9, border: '1.5px solid #10b98150', background: '#10b98115', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              {utentiSaving ? 'Salvo...' : '✅ Salva'}
                            </button>
                            <button onClick={() => setUtentiEdit(null)}
                              style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid #ffffff15', background: 'transparent', color: '#666', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              Annulla
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── DIFFERITI ── */}
          {tab === 'differiti' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>⏳ TRASFERIMENTI DIFFERITI</div>
                <button onClick={loadDifferiti} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #f97316 30', background: '#f9731610', color: '#f97316', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🔄 Aggiorna</button>
              </div>
              <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>
                Trasferimenti accettati fuori mercato — in attesa di essere eseguiti all'apertura della prossima finestra.
              </div>
              {differiti.length === 0 && <div style={{ color: '#555', fontSize: 12 }}>Nessun trasferimento differito in attesa. Clicca "Aggiorna".</div>}
              {differiti.map(t => (
                <div key={t.id} style={{ background: '#f9731608', border: '1px solid #f9731625', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#f0f0f0' }}>{t.giocatore}</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{t.da_squadra} → {t.a_squadra} · {t.prezzo}M · {t.tipo}</div>
                      <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Accettato: {new Date(t.updated_at).toLocaleDateString('it-IT')}</div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: 8, background: '#f9731615', border: '1px solid #f9731630', fontSize: 10, fontWeight: 700, color: '#f97316' }}>⏳ In attesa mercato</span>
                  </div>
                </div>
              ))}
              {differiti.length > 0 && (
                <button
                  onClick={async () => {
                    if (!window.confirm(`Eseguire ${differiti.length} trasferiment${differiti.length > 1 ? 'i' : 'o'} differit${differiti.length > 1 ? 'i' : 'o'}?\n\n${differiti.map(t => `${t.giocatore}: ${t.a_squadra} → ${t.da_squadra} (${t.prezzo}M)`).join('\n')}`)) return;
                    setBusy('Trasferimenti differiti');
                    let ok = 0, errs = [];
                    for (const t of differiti) {
                      try {
                        await eseguiTrasferimento(t);
                        await aggiornaFantaSquadraListone(t.giocatore, t.da_squadra);
                        await aggiornaStipendioDopoTrasferimento(t.giocatore, t.da_squadra);
                        ok++;
                      } catch(e) { errs.push(`${t.giocatore}: ${e.message}`); }
                    }
                    setBusy(null);
                    await loadDifferiti();
                    setLastResult({ label: 'Trasferimenti differiti', ok, skip: errs.length, ts: new Date().toLocaleTimeString('it-IT') });
                    if (errs.length) alert(`⚠️ Errori:\n${errs.join('\n')}`);
                  }}
                  disabled={isBusy}
                  style={{ padding: '9px 20px', borderRadius: 10, border: '1.5px solid #10b98150', background: '#10b98115', color: '#10b981', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  ▶️ Esegui tutti i trasferimenti differiti
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── PROFILE SETTINGS PAGE ──────────────────────────────────────────────────
// ─── STORICO / ALBO D'ORO ────────────────────────────────────────────────────
function StoricoPage({ isAdmin, allClubIdentities = [] }) {
  const [tab, setTab] = useState('albo');
  const [stagioni, setStagioni] = useState([]);
  const [articoli, setArticoli] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editStagione, setEditStagione] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openArticoli, setOpenArticoli] = useState({});
  const [editArt, setEditArt] = useState(null);
  const [savingArt, setSavingArt] = useState(false);

  const TROPHIES = [
    { key: 'campione',       label: '🏆 Campione',        color: '#f59e0b' },
    { key: 'vice_campione',  label: '🥈 Vice Campione',   color: '#94a3b8' },
    { key: 'supercoppa',     label: '⭐ Supercoppa',       color: '#60a5fa' },
    { key: 'coppa_italia',   label: '🇮🇹 Coppa Italia',   color: '#34d399' },
    { key: 'miglior_attacco',label: '⚡ Miglior Attacco', color: '#fb923c' },
    { key: 'miglior_difesa', label: '🛡 Miglior Difesa',  color: '#a78bfa' },
  ];

  useEffect(() => {
    Promise.all([getStagioniPassate(), getRegolamentoArticoli()]).then(([s, a]) => {
      setStagioni(s);
      setArticoli(a);
      setLoading(false);
    });
  }, []);

  const getLogo = (squadra) => allClubIdentities?.find(c => c.squadra === squadra)?.logo_url || null;

  // ── Stagione edit ──
  const EMPTY_STAGIONE = { anno: '', campione: '', vice_campione: '', supercoppa: '', coppa_italia: '', miglior_attacco: '', miglior_difesa: '', mvp: '', cucchiaio: '', record_giornata_squadra: '', record_giornata_punti: '', affare_anno: '', note: '', classifica: [], maglie: [] };
  const openEdit = (s) => {
    setEditStagione(s ? { ...EMPTY_STAGIONE, ...s } : { ...EMPTY_STAGIONE });
    setEditMode(true);
  };
  const [uploadingMaglia, setUploadingMaglia] = useState({});
  const uploadMagliaFile = async (i, file) => {
    if (!editStagione?.anno) return;
    const squadra = editStagione.maglie[i]?.squadra || `maglia-${i}`;
    setUploadingMaglia(p => ({ ...p, [i]: true }));
    try {
      const url = await uploadMaglia(editStagione.anno, squadra, file);
      setEditStagione(p => { const mg = [...p.maglie]; mg[i] = { ...mg[i], url }; return { ...p, maglie: mg }; });
    } catch(e) { alert('Errore upload: ' + e.message); }
    setUploadingMaglia(p => ({ ...p, [i]: false }));
  };
  const salvaStagione = async () => {
    if (!editStagione?.anno) return;
    setSaving(true);
    try {
      await upsertStagione(editStagione);
      setStagioni(await getStagioniPassate());
      setEditMode(false);
    } catch(e) { alert('Errore: ' + e.message); }
    setSaving(false);
  };
  const eliminaStagione = async (anno) => {
    if (!confirm(`Eliminare la stagione ${anno}?`)) return;
    await deleteStagione(anno);
    setStagioni(s => s.filter(x => x.anno !== anno));
  };

  // ── Articolo edit ──
  const openEditArt = (a) => setEditArt(a ? { ...a } : { numero: '', titolo: '', testo: '', ordine: articoli.length });
  const salvaArticolo = async () => {
    if (!editArt?.titolo) return;
    setSavingArt(true);
    try {
      if (editArt.id) await upsertRegolamentoArticolo(editArt);
      else await insertRegolamentoArticolo(editArt);
      setArticoli(await getRegolamentoArticoli());
      setEditArt(null);
    } catch(e) { alert('Errore: ' + e.message); }
    setSavingArt(false);
  };
  const eliminaArticolo = async (id) => {
    if (!confirm('Eliminare questo articolo?')) return;
    await deleteRegolamentoArticolo(id);
    setArticoli(a => a.filter(x => x.id !== id));
  };

  const card = { background: '#ffffff08', border: '1px solid #ffffff12', borderRadius: 14, padding: '20px 24px', marginBottom: 14 };
  const inp = { width: '100%', background: '#ffffff0a', border: '1px solid #ffffff18', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
      <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 800, marginBottom: 20 }}>📚 Archivio Lega</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[{ key:'albo', label:"🏆 Albo d'Oro" }, { key:'regolamento', label:'📋 Regolamento' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: tab===t.key?'#f59e0b22':'#ffffff0a', color: tab===t.key?'#f59e0b':'#888', borderBottom: tab===t.key?'2px solid #f59e0b':'2px solid transparent' }}>{t.label}</button>
        ))}
      </div>

      {loading ? <div style={{ color:'#555', textAlign:'center', padding:40 }}>Caricamento…</div> : <>

        {/* ── ALBO D'ORO ── */}
        {tab === 'albo' && (
          <div>
            {isAdmin && <button onClick={() => openEdit(null)} style={{ background:'#f59e0b', color:'#000', border:'none', borderRadius:8, padding:'8px 16px', fontWeight:700, cursor:'pointer', fontSize:13, marginBottom:20 }}>+ Aggiungi Stagione</button>}

            {stagioni.length === 0 && (
              <div style={{ ...card, textAlign:'center', color:'#555', padding:48 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🏆</div>
                <div style={{ fontWeight:700, fontSize:15 }}>Nessuna stagione registrata</div>
                {isAdmin && <div style={{ color:'#444', fontSize:13, marginTop:6 }}>Usa il pulsante sopra per aggiungere la prima stagione</div>}
              </div>
            )}

            {stagioni.map(s => (
              <div key={s.anno} style={card}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:8 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                    <span style={{ background:'#f59e0b', color:'#000', borderRadius:6, padding:'3px 10px', fontSize:12, fontWeight:800 }}>STAGIONE {s.anno}</span>
                    {s.note && <span style={{ color:'#666', fontSize:12 }}>{s.note}</span>}
                  </div>
                  {isAdmin && (
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => openEdit(s)} style={{ background:'#ffffff10', border:'none', borderRadius:6, color:'#aaa', padding:'4px 10px', cursor:'pointer', fontSize:12 }}>✏️</button>
                      <button onClick={() => eliminaStagione(s.anno)} style={{ background:'#ef444415', border:'none', borderRadius:6, color:'#ef4444', padding:'4px 10px', cursor:'pointer', fontSize:12 }}>🗑</button>
                    </div>
                  )}
                </div>

                {/* Trofei */}
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {TROPHIES.map(t => s[t.key] ? (
                      <div key={t.key} style={{ display:'flex', alignItems:'center', gap:10, background:'#ffffff06', borderRadius:10, padding:'8px 12px', flex:'1 1 200px', minWidth:0 }}>
                        {getLogo(s[t.key]) && <img src={getLogo(s[t.key])} style={{ width:24, height:24, objectFit:'contain', borderRadius:4, flexShrink:0 }} alt="" />}
                        <div style={{ minWidth:0 }}>
                          <div style={{ color:'#555', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>{t.label}</div>
                          <div style={{ color:'#fff', fontSize:13, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s[t.key]}</div>
                        </div>
                      </div>
                    ) : null)}
                    {[
                      { key:'mvp',                    icon:'🌟', label:'MVP Stagione' },
                      { key:'cucchiaio',               icon:'🥄', label:'Cucchiaio di Legno' },
                      { key:'affare_anno',             icon:'💼', label:"Affare dell'Anno" },
                      { key:'record_giornata_squadra', icon:'⚡', label:'Record Giornata', suffix: s.record_giornata_punti ? ` · ${s.record_giornata_punti} pts` : '' },
                    ].filter(x => s[x.key]).map(x => (
                      <div key={x.key} style={{ display:'flex', alignItems:'center', gap:10, background:'#ffffff06', borderRadius:10, padding:'8px 12px', flex:'1 1 200px', minWidth:0 }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>{x.icon}</span>
                        <div style={{ minWidth:0 }}>
                          <div style={{ color:'#555', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>{x.label}</div>
                          <div style={{ color:'#fff', fontSize:13, fontWeight:700 }}>{s[x.key]}{x.suffix||''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Classifica — sempre a larghezza piena, scroll orizzontale garantito */}
                {s.classifica?.length > 0 && (
                  <div style={{ background:'#ffffff06', borderRadius:12, padding:'10px 0', marginBottom:12 }}>
                    <div style={{ color:'#555', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:8, padding:'0 14px' }}>Classifica Finale</div>
                    <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
                      <table style={{ width:'100%', minWidth:520, borderCollapse:'collapse', fontSize:11 }}>
                        <thead>
                          <tr style={{ borderBottom:'1px solid #ffffff12' }}>
                            {['#','Squadra','G','V','N','P','G+','G−','DR','Pt','Pt Tot'].map(h => (
                              <th key={h} style={{ padding:'4px 8px', color:'#444', fontWeight:700, textAlign: h==='Squadra'?'left':'center', whiteSpace:'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {s.classifica.map((r, i) => {
                            const rowColor = i===0?'#f59e0b':i===1?'#9ca3af':i===2?'#cd7f32':null;
                            const dr = r.dr ?? ((r.gf||0) - (r.gs||0));
                            return (
                              <tr key={i} style={{ borderBottom:'1px solid #ffffff06' }}>
                                <td style={{ padding:'5px 8px', textAlign:'center', fontWeight:900, color: rowColor||'#555', fontSize:13 }}>{i+1}</td>
                                <td style={{ padding:'5px 8px', minWidth:100 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                                    {getLogo(r.squadra) && <img src={getLogo(r.squadra)} style={{ width:16, height:16, objectFit:'contain', borderRadius:2, flexShrink:0 }} alt="" />}
                                    <span style={{ color: i===0?'#fff':'#bbb', fontWeight: i===0?700:400, whiteSpace:'nowrap' }}>{r.squadra}</span>
                                  </div>
                                </td>
                                {[r.g, r.v, r.n, r.p, r.gf, r.gs].map((v,ci) => (
                                  <td key={ci} style={{ padding:'5px 8px', textAlign:'center', color:'#888' }}>{v ?? '—'}</td>
                                ))}
                                <td style={{ padding:'5px 8px', textAlign:'center', color: dr>0?'#10b981':dr<0?'#ef4444':'#666', fontWeight:600 }}>{dr>0?'+':''}{dr ?? '—'}</td>
                                <td style={{ padding:'5px 8px', textAlign:'center', fontWeight:900, color: rowColor||'#f0f0f0', fontSize:13 }}>{r.pt ?? r.punti ?? '—'}</td>
                                <td style={{ padding:'5px 8px', textAlign:'center', color:'#555' }}>{r.pt_totali ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Maglie */}
                {s.maglie?.length > 0 && (
                  <div>
                    <div style={{ color:'#555', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Maglie Stagione</div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {s.maglie.map((m, i) => (
                        <div key={i} style={{ textAlign:'center' }}>
                          <img src={m.url} style={{ width:56, height:56, objectFit:'contain', borderRadius:8, background:'#ffffff08', border:'1px solid #ffffff10' }} alt={m.squadra} />
                          <div style={{ color:'#666', fontSize:9, marginTop:3, maxWidth:56, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.squadra}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── REGOLAMENTO ── */}
        {tab === 'regolamento' && (
          <div>
            {isAdmin && (
              <button onClick={() => openEditArt(null)} style={{ background:'#6366f1', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontWeight:700, cursor:'pointer', fontSize:13, marginBottom:20 }}>+ Aggiungi Articolo</button>
            )}

            {articoli.length === 0 && (
              <div style={{ ...card, textAlign:'center', color:'#555', padding:48 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
                <div style={{ fontWeight:700, fontSize:15 }}>Regolamento non ancora inserito</div>
                {isAdmin && <div style={{ color:'#444', fontSize:13, marginTop:6 }}>Usa il pulsante sopra per aggiungere articoli</div>}
              </div>
            )}

            {articoli.map(a => {
              const open = !!openArticoli[a.id];
              return (
                <div key={a.id} style={{ ...card, padding:0, overflow:'hidden' }}>
                  <div
                    onClick={() => setOpenArticoli(p => ({ ...p, [a.id]: !open }))}
                    style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px', cursor:'pointer', userSelect:'none' }}
                  >
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      {a.numero && <span style={{ background:'#6366f122', color:'#818cf8', borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:800, whiteSpace:'nowrap' }}>{a.numero}</span>}
                      <span style={{ color:'#fff', fontWeight:700, fontSize:14 }}>{a.titolo}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      {isAdmin && (
                        <>
                          <button onClick={e => { e.stopPropagation(); openEditArt(a); }} style={{ background:'#ffffff10', border:'none', borderRadius:6, color:'#aaa', padding:'3px 8px', cursor:'pointer', fontSize:11 }}>✏️</button>
                          <button onClick={e => { e.stopPropagation(); eliminaArticolo(a.id); }} style={{ background:'#ef444415', border:'none', borderRadius:6, color:'#ef4444', padding:'3px 8px', cursor:'pointer', fontSize:11 }}>🗑</button>
                        </>
                      )}
                      <span style={{ color:'#555', fontSize:16, transition:'transform 0.2s', display:'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                    </div>
                  </div>
                  {open && (
                    <div style={{ padding:'0 20px 16px', borderTop:'1px solid #ffffff0a' }}>
                      <p style={{ color:'#ccc', fontSize:13, lineHeight:1.7, whiteSpace:'pre-wrap', margin:'12px 0 0' }}>{a.testo}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>}

      {/* ── Stagione Modal ── */}
      {editMode && editStagione && (
        <div style={{ position:'fixed', inset:0, background:'#000000cc', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }} onClick={e => e.target===e.currentTarget && setEditMode(false)}>
          <div className="modal-pad" style={{ background:'#1a1d27', borderRadius:16, padding:28, width:'100%', maxWidth:600, maxHeight:'92vh', overflowY:'auto', border:'1px solid #ffffff15' }}>
            <h3 style={{ color:'#fff', marginBottom:20, fontSize:16, fontWeight:700 }}>{editStagione.anno ? `Modifica ${editStagione.anno}` : 'Nuova Stagione'}</h3>

            {/* Base fields */}
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
              {[
                { key:'anno',                    label:'Anno (es. 2024/25)' },
                { key:'campione',                label:'🏆 Campione' },
                { key:'vice_campione',           label:'🥈 Vice Campione' },
                { key:'supercoppa',              label:'⭐ Supercoppa' },
                { key:'coppa_italia',            label:'🇮🇹 Coppa Italia' },
                { key:'miglior_attacco',         label:'⚡ Miglior Attacco' },
                { key:'miglior_difesa',          label:'🛡 Miglior Difesa' },
                { key:'mvp',                     label:'🌟 MVP Stagione' },
                { key:'cucchiaio',               label:'🥄 Cucchiaio di Legno (ultimo)' },
                { key:'affare_anno',             label:"💼 Affare dell'Anno" },
                { key:'record_giornata_squadra', label:'⚡ Record Giornata (squadra)' },
                { key:'record_giornata_punti',   label:'⚡ Record Giornata (punti)' },
                { key:'note',                    label:'Note (opzionale)' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ color:'#888', fontSize:11, fontWeight:700, display:'block', marginBottom:3 }}>{f.label}</label>
                  <input value={editStagione[f.key]||''} onChange={e => setEditStagione(p => ({ ...p, [f.key]: e.target.value }))} style={inp} />
                </div>
              ))}
            </div>

            {/* Classifica editor */}
            <div style={{ borderTop:'1px solid #ffffff10', paddingTop:16, marginBottom:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <label style={{ color:'#888', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>📊 Classifica Finale</label>
                <button onClick={() => setEditStagione(p => ({ ...p, classifica: [...(p.classifica||[]), { squadra:'', punti:'' }] }))}
                  style={{ background:'#ffffff15', border:'none', borderRadius:6, color:'#aaa', padding:'3px 10px', cursor:'pointer', fontSize:12 }}>+ Riga</button>
              </div>
              {(editStagione.classifica||[]).map((r, i) => {
                const upd = (f, v) => setEditStagione(p => { const c=[...p.classifica]; c[i]={...c[i],[f]:v}; return {...p,classifica:c}; });
                return (
                  <div key={i} style={{ background:'#ffffff06', borderRadius:8, padding:'8px 10px', marginBottom:6 }}>
                    <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6 }}>
                      <span style={{ color:'#555', fontSize:12, width:20, flexShrink:0 }}>{i+1}.</span>
                      <input placeholder="Squadra" value={r.squadra||''} onChange={e=>upd('squadra',e.target.value)} style={{ ...inp, flex:1 }} />
                      <button onClick={() => setEditStagione(p => ({ ...p, classifica: p.classifica.filter((_,j)=>j!==i) }))} style={{ background:'#ef444418', border:'none', borderRadius:6, color:'#ef4444', padding:'4px 8px', cursor:'pointer', fontSize:12, flexShrink:0 }}>✕</button>
                    </div>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {[['g','G'],['v','V'],['n','N'],['p','P'],['gf','G+'],['gs','G−'],['pt','Pt'],['pt_totali','Pt Tot']].map(([f,label]) => (
                        <div key={f} style={{ textAlign:'center' }}>
                          <div style={{ color:'#555', fontSize:9, marginBottom:2 }}>{label}</div>
                          <input type="number" value={r[f]??''} onChange={e=>upd(f, e.target.value===''?'':Number(e.target.value))} style={{ ...inp, width:42, padding:'4px 6px', fontSize:12, textAlign:'center' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Maglie editor */}
            <div style={{ borderTop:'1px solid #ffffff10', paddingTop:16, marginBottom:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <label style={{ color:'#888', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>👕 Maglie Stagione</label>
                <button onClick={() => setEditStagione(p => ({ ...p, maglie: [...(p.maglie||[]), { squadra:'', url:'' }] }))}
                  style={{ background:'#ffffff15', border:'none', borderRadius:6, color:'#aaa', padding:'3px 10px', cursor:'pointer', fontSize:12 }}>+ Maglia</button>
              </div>
              {(editStagione.maglie||[]).map((m, i) => (
                <div key={i} style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center', background:'#ffffff06', borderRadius:8, padding:'8px 10px' }}>
                  {m.url && <img src={m.url} style={{ width:40, height:40, objectFit:'contain', borderRadius:6, background:'#ffffff10', flexShrink:0 }} alt="" />}
                  <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
                    <input placeholder="Nome squadra" value={m.squadra||''} onChange={e => setEditStagione(p => { const mg=[...p.maglie]; mg[i]={...mg[i],squadra:e.target.value}; return {...p,maglie:mg}; })} style={{ ...inp, fontSize:12 }} />
                    <label style={{ background:'#6366f120', color:'#818cf8', border:'1px solid #6366f140', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11, fontWeight:700, textAlign:'center', display:'block' }}>
                      {uploadingMaglia[i] ? 'Caricamento…' : m.url ? '🔄 Cambia immagine' : '📤 Carica immagine'}
                      <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => { const f=e.target.files?.[0]; if(f) uploadMagliaFile(i,f); }} />
                    </label>
                  </div>
                  <button onClick={() => setEditStagione(p => ({ ...p, maglie: p.maglie.filter((_,j)=>j!==i) }))} style={{ background:'#ef444418', border:'none', borderRadius:6, color:'#ef4444', padding:'4px 8px', cursor:'pointer', fontSize:12, flexShrink:0 }}>✕</button>
                </div>
              ))}
            </div>

            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button onClick={() => setEditMode(false)} style={{ background:'#ffffff10', border:'none', borderRadius:8, color:'#aaa', padding:'8px 16px', cursor:'pointer', fontWeight:700 }}>Annulla</button>
              <button onClick={salvaStagione} disabled={saving} style={{ background:'#f59e0b', border:'none', borderRadius:8, color:'#000', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>{saving ? 'Salvo…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Articolo Modal ── */}
      {editArt && (
        <div style={{ position:'fixed', inset:0, background:'#000000cc', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }} onClick={e => e.target===e.currentTarget && setEditArt(null)}>
          <div className="modal-pad" style={{ background:'#1a1d27', borderRadius:16, padding:28, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto', border:'1px solid #ffffff15' }}>
            <h3 style={{ color:'#fff', marginBottom:20, fontSize:16, fontWeight:700 }}>{editArt.id ? 'Modifica Articolo' : 'Nuovo Articolo'}</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ display:'flex', gap:10 }}>
                <div style={{ flex:'0 0 100px' }}>
                  <label style={{ color:'#888', fontSize:12, fontWeight:700, display:'block', marginBottom:4 }}>Numero</label>
                  <input value={editArt.numero||''} onChange={e => setEditArt(p=>({...p, numero:e.target.value}))} placeholder="Art. 1" style={inp} />
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ color:'#888', fontSize:12, fontWeight:700, display:'block', marginBottom:4 }}>Titolo</label>
                  <input value={editArt.titolo||''} onChange={e => setEditArt(p=>({...p, titolo:e.target.value}))} style={inp} />
                </div>
              </div>
              <div>
                <label style={{ color:'#888', fontSize:12, fontWeight:700, display:'block', marginBottom:4 }}>Testo</label>
                <textarea value={editArt.testo||''} onChange={e => setEditArt(p=>({...p, testo:e.target.value}))} rows={10} style={{ ...inp, resize:'vertical', fontFamily:'inherit', lineHeight:1.6 }} />
              </div>
              <div>
                <label style={{ color:'#888', fontSize:12, fontWeight:700, display:'block', marginBottom:4 }}>Ordine</label>
                <input type="number" value={editArt.ordine||0} onChange={e => setEditArt(p=>({...p, ordine:Number(e.target.value)}))} style={{ ...inp, width:80 }} />
              </div>
            </div>
            <div style={{ display:'flex', gap:10, marginTop:20, justifyContent:'flex-end' }}>
              <button onClick={() => setEditArt(null)} style={{ background:'#ffffff10', border:'none', borderRadius:8, color:'#aaa', padding:'8px 16px', cursor:'pointer', fontWeight:700 }}>Annulla</button>
              <button onClick={salvaArticolo} disabled={savingArt} style={{ background:'#6366f1', border:'none', borderRadius:8, color:'#fff', padding:'8px 20px', cursor:'pointer', fontWeight:700 }}>{savingArt ? 'Salvo…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileSettingsPage({ session, profile, onProfileUpdated }) {
  const [nome, setNome] = useState(profile?.nome || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef();

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadAvatar(session.user.id, file);
      setAvatarUrl(url);
      await updateProfile(session.user.id, { avatar_url: url });
      onProfileUpdated?.();
      setMsg({ ok: true, text: 'Avatar aggiornato!' });
    } catch(err) { setMsg({ ok: false, text: err.message }); }
    finally { setUploadingAvatar(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateProfile(session.user.id, { nome: nome.trim() || null, bio: bio.trim() || null });
      onProfileUpdated?.();
      setMsg({ ok: true, text: 'Profilo salvato!' });
    } catch(err) { setMsg({ ok: false, text: err.message }); }
    finally { setSaving(false); }
  }

  const initials = (nome || profile?.email || '?').slice(0, 2).toUpperCase();

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.1em' }}>👤 IMPOSTAZIONI PROFILO</div>

      {/* Avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
          {avatarUrl
            ? <img src={avatarUrl} alt="avatar" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid #6366f140' }} />
            : <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 900, color: '#fff', fontFamily: "'Bebas Neue',sans-serif" }}>{initials}</div>
          }
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
            {uploadingAvatar ? '⏳' : '📷'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0' }}>{profile?.nome || profile?.email}</div>
          <div style={{ fontSize: 11, color: '#666' }}>{profile?.squadra || (profile?.ruolo === 'admin' ? '⚡ Admin' : '')}</div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>Clicca per cambiare avatar</div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
      </div>

      {/* Nome / Username */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.08em' }}>NOME / USERNAME</label>
        <input
          value={nome}
          onChange={e => setNome(e.target.value)}
          placeholder="Come vuoi essere chiamato?"
          maxLength={32}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #ffffff15', background: '#ffffff08', color: '#f0f0f0', fontSize: 13, outline: 'none' }}
        />
        <div style={{ fontSize: 10, color: '#444', textAlign: 'right' }}>{nome.length}/32</div>
      </div>

      {/* Bio */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.08em' }}>BIO</label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          placeholder="Qualcosa su di te o sulla tua squadra..."
          maxLength={160}
          rows={3}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #ffffff15', background: '#ffffff08', color: '#f0f0f0', fontSize: 13, outline: 'none', resize: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ fontSize: 10, color: '#444', textAlign: 'right' }}>{bio.length}/160</div>
      </div>

      {/* Info non modificabili */}
      <div style={{ background: '#ffffff06', border: '1px solid #ffffff10', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: '0.08em', marginBottom: 4 }}>INFO ACCOUNT</div>
        {[
          { label: 'Email', value: session?.user?.email },
          { label: 'Ruolo', value: profile?.ruolo === 'admin' ? '⚡ Admin' : '🏟 Presidente' },
          { label: 'Squadra', value: profile?.squadra || '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: '#555' }}>{label}</span>
            <span style={{ color: '#aaa', fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Telegram */}
      {profile?.squadra && (() => {
        const slug = btoa(profile.squadra).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const botUser = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
        return (
          <div style={{ background: '#0088cc10', border: '1px solid #0088cc30', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', marginBottom: 6 }}>✈️ NOTIFICHE TELEGRAM</div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10, lineHeight: 1.5 }}>
              Ricevi notifiche private sul bot Telegram per trattative, aste e movimenti.
            </div>
            <a href={`https://t.me/${botUser}?start=${slug}`} target="_blank" rel="noreferrer"
              style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 9, background: '#0088cc', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              🤖 Collega Telegram
            </a>
          </div>
        );
      })()}

      {/* Salva */}
      <button onClick={handleSave} disabled={saving}
        style={{ padding: '11px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
        {saving ? 'Salvataggio...' : '💾 Salva modifiche'}
      </button>

      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: msg.ok ? '#10b98115' : '#ef444415', border: `1px solid ${msg.ok ? '#10b98130' : '#ef444430'}`, color: msg.ok ? '#10b981' : '#ef4444', fontSize: 12, fontWeight: 700 }}>
          {msg.ok ? '✅' : '❌'} {msg.text}
        </div>
      )}
    </div>
  );
}

function StatusPill({ ok }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: ok ? '#10b98118' : '#ffffff08', border: `1px solid ${ok ? '#10b98140' : '#ffffff15'}`, fontSize: 10, fontWeight: 700, color: ok ? '#10b981' : '#555', whiteSpace: 'nowrap' }}>
      {ok ? '✓ OK' : '⏳ Da fare'}
    </span>
  );
}

/* ─── ADMIN LOG PAGE ─────────────────────────────────────────────────────────── */
function AdminLogPage({ profile }) {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(null);
  const [filtroAzione, setFiltroAzione] = useState("tutti");
  const [filtroSquadra, setFiltroSquadra] = useState("tutti");
  const [cerca, setCerca] = useState("");
  const [expandId, setExpandId] = useState(null);

  const utente = profile?.email || profile?.nome || 'admin';

  const loadLog = useCallback(async () => {
    const data = await getAuditLog({ limit: 300 });
    setLog(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLog();
    // Polling ogni 30 secondi
    // Nessun polling: il log si ricarica manualmente o al mount
  }, [loadLog]);

  async function handleRollback(entry) {
    if (!window.confirm(`⚠️ ROLLBACK: "${entry.descrizione}"\n\nQuesto ripristinerà lo stato precedente all'operazione.\nContinuare?`)) return;
    setRolling(entry.id);
    try {
      await effettuaRollback(entry.id, utente);
      await loadLog();
      alert('✅ Rollback effettuato con successo');
    } catch(e) {
      alert(`❌ Rollback fallito: ${e.message}`);
    } finally {
      setRolling(null);
    }
  }

  // Icone e colori per tipo azione
  const azioneConfig = {
    bilancio_modifica:    { icon: "💰", color: "#f59e0b", label: "Bilancio" },
    tassa_settimanale:    { icon: "📊", color: "#f59e0b", label: "Tassa" },
    stipendi_pagati:      { icon: "💸", color: "#f97316", label: "Stipendi" },
    multa_applicata:      { icon: "⚠️", color: "#ef4444", label: "Multa" },
    premio_applicato:     { icon: "🏆", color: "#10b981", label: "Premio" },
    trasferimento:        { icon: "🤝", color: "#6366f1", label: "Trasferimento" },
    svincolo:             { icon: "✂️", color: "#ef4444", label: "Svincolo" },
    rosa_modifica:        { icon: "✏️", color: "#818cf8", label: "Rosa mod." },
    rosa_aggiungi:        { icon: "➕", color: "#10b981", label: "Rosa add." },
    rosa_rimuovi:         { icon: "➖", color: "#ef4444", label: "Rosa rim." },
    iscrizione_campionato:{ icon: "📋", color: "#f97316", label: "Iscrizione" },
    euro_extra_investiti: { icon: "💶", color: "#818cf8", label: "Euro extra" },
    investimento_acquisto:{ icon: "📈", color: "#3b82f6", label: "Investimento" },
    allenatore_scelto:    { icon: "🎩", color: "#a855f7", label: "Allenatore" },
    classifica_modifica:  { icon: "📊", color: "#f59e0b", label: "Classifica" },
    trattativa_accettata: { icon: "✅", color: "#10b981", label: "Trattativa" },
    asta_aggiudicata:     { icon: "🏷️", color: "#f59e0b", label: "Asta" },
    admin_generico:       { icon: "🔧", color: "#888",    label: "Admin" },
  };

  const squadreUniche = [...new Set(log.map(l => l.squadra).filter(Boolean))].sort();
  const azioniUniche  = [...new Set(log.map(l => l.azione).filter(Boolean))].sort();

  const filtered = log.filter(entry => {
    if (filtroSquadra !== "tutti" && entry.squadra !== filtroSquadra) return false;
    if (filtroAzione  !== "tutti" && entry.azione  !== filtroAzione)  return false;
    if (cerca && !entry.descrizione?.toLowerCase().includes(cerca.toLowerCase()) &&
        !entry.squadra?.toLowerCase().includes(cerca.toLowerCase())) return false;
    return true;
  });

  const sel = { padding: "5px 8px", borderRadius: 6, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>AUDIT LOG</h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>
            {filtered.length} operazioni · solo admin
          </p>
        </div>
        <button onClick={loadLog} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #ffffff18", background: "transparent", color: "#666", fontSize: 11, cursor: "pointer" }}>
          🔄 Aggiorna
        </button>
      </div>

      {/* Filtri */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...sel, flex: 1, minWidth: 140 }} placeholder="🔍 Cerca operazione..." value={cerca} onChange={e => setCerca(e.target.value)} />
        <select style={sel} value={filtroSquadra} onChange={e => setFiltroSquadra(e.target.value)}>
          <option value="tutti">Tutte le squadre</option>
          {squadreUniche.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={sel} value={filtroAzione} onChange={e => setFiltroAzione(e.target.value)}>
          <option value="tutti">Tutte le azioni</option>
          {azioniUniche.map(a => <option key={a} value={a}>{azioneConfig[a]?.label || a}</option>)}
        </select>
      </div>

      {/* Log entries */}
      {loading ? (
        <div style={{ fontSize: 12, color: "#555", textAlign: "center", padding: 30 }}>Caricamento log...</div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: "#555", fontStyle: "italic", textAlign: "center", padding: 30 }}>Nessuna operazione trovata</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(entry => {
            const cfg = azioneConfig[entry.azione] || { icon: "•", color: "#666", label: entry.azione };
            const isExpanded = expandId === entry.id;
            const ts = new Date(entry.timestamp);
            const tsStr = ts.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) + " " +
                          ts.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

            return (
              <div key={entry.id}
                style={{ background: entry.rollback_effettuato ? "#ffffff04" : "#ffffff07", border: `1px solid ${entry.rollback_effettuato ? "#ffffff08" : "#ffffff12"}`, borderRadius: 10, overflow: "hidden", opacity: entry.rollback_effettuato ? 0.5 : 1 }}>

                {/* Riga principale */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer" }}
                  onClick={() => setExpandId(isExpanded ? null : entry.id)}>

                  {/* Icona tipo */}
                  <div style={{ fontSize: 16, flexShrink: 0 }}>{cfg.icon}</div>

                  {/* Badge tipo */}
                  <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, background: cfg.color + "18", border: `1px solid ${cfg.color}33`, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                    {cfg.label}
                  </span>

                  {/* Descrizione */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: entry.rollback_effettuato ? "#555" : "#ddd", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.rollback_effettuato ? "🔄 [ROLLBACK] " : ""}{entry.descrizione}
                    </div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 1 }}>
                      {tsStr} · {entry.utente}
                      {entry.squadra && <span style={{ color: "#555" }}> · {entry.squadra}</span>}
                    </div>
                  </div>

                  {/* Rollback button */}
                  {entry.rollback_possibile && !entry.rollback_effettuato && (
                    <button
                      onClick={e => { e.stopPropagation(); handleRollback(entry); }}
                      disabled={rolling === entry.id}
                      style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 6, border: "1px solid #f9731633", background: "#f9731615", color: "#f97316", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                      {rolling === entry.id ? "..." : "↩ Annulla"}
                    </button>
                  )}
                  {entry.rollback_effettuato && (
                    <span style={{ flexShrink: 0, fontSize: 9, color: "#555", background: "#ffffff08", borderRadius: 4, padding: "2px 6px" }}>
                      annullato {entry.rollback_da ? `da ${entry.rollback_da}` : ""}
                    </span>
                  )}

                  <span style={{ color: "#444", fontSize: 12, flexShrink: 0 }}>{isExpanded ? "▲" : "▼"}</span>
                </div>

                {/* Dettaglio espanso */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid #ffffff08", padding: "10px 12px", background: "#ffffff04" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {entry.dati_prima && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 4 }}>STATO PRIMA</div>
                          <pre style={{ fontSize: 10, color: "#888", background: "#000000a0", borderRadius: 6, padding: "6px 8px", margin: 0, overflowX: "auto", maxHeight: 120, overflowY: "auto" }}>
                            {JSON.stringify(entry.dati_prima, null, 2)}
                          </pre>
                        </div>
                      )}
                      {entry.dati_dopo && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: "0.08em", marginBottom: 4 }}>STATO DOPO</div>
                          <pre style={{ fontSize: 10, color: "#888", background: "#000000a0", borderRadius: 6, padding: "6px 8px", margin: 0, overflowX: "auto", maxHeight: 120, overflowY: "auto" }}>
                            {JSON.stringify(entry.dati_dopo, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                    {entry.rollback_effettuato && (
                      <div style={{ marginTop: 8, fontSize: 10, color: "#f97316" }}>
                        🔄 Rollback effettuato il {new Date(entry.rollback_at).toLocaleString("it-IT")} da {entry.rollback_da}
                      </div>
                    )}
                    {!entry.rollback_possibile && !entry.rollback_effettuato && (
                      <div style={{ marginTop: 8, fontSize: 10, color: "#444" }}>
                        ℹ️ Rollback automatico non disponibile per questa operazione
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


/* ─── NEWS FEED PAGE ─────────────────────────────────────────────────────────── */

const CATEGORIE = [
  { val: "news",        label: "📰 News",          color: "#6366f1" },
  { val: "risultato",   label: "🏆 Risultato",      color: "#10b981" },
  { val: "trattativa",  label: "🤝 Trattativa",     color: "#f59e0b" },
  { val: "conferenza",  label: "🎙️ Conferenza",     color: "#a855f7" },
  { val: "prepartita",  label: "🔥 Prepartita",     color: "#ef4444" },
];

function getCatInfo(val) { return CATEGORIE.find(c => c.val === val) || CATEGORIE[0]; }

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "ora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}g`;
  return new Date(dateStr).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

function NewsCard({ notizia, myName, isAdmin, onReact, onDelete, onEdit, onPin, teams, profile }) {
  const [expanded, setExpanded] = useState(false);
  const [imgOpen, setImgOpen] = useState(null);
  const [showComments, setShowComments] = useState(false);
  const [commenti, setCommenti] = useState([]);
  const [loadingComm, setLoadingComm] = useState(false);
  const [nuovoCommento, setNuovoCommento] = useState("");
  const [postingComm, setPostingComm] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [commentCount, setCommentCount] = useState(Number(notizia.commenti_count || 0));
  const inputRef = useRef(null);

  const cat = getCatInfo(notizia.categoria);
  const team = teams?.find(t => t.name === notizia.squadra);
  const teamColor = team?.color || "#6366f1";
  const canDelete = isAdmin || notizia.autore === myName;
  const canEdit = canDelete;
  const EMOJIS = ["🔥","👏","😂","😤","🎯"];
  const testoLungo = notizia.testo.length > 280;
  const testoMostrato = testoLungo && !expanded ? notizia.testo.slice(0, 280) + "…" : notizia.testo;

  const loadCommenti = useCallback(async () => {
    setLoadingComm(true);
    try {
      const rows = await getCommenti(notizia.id);
      setCommenti(rows);
      setCommentCount(rows.length);
    } catch(e) { console.error(e); }
    finally { setLoadingComm(false); }
  }, [notizia.id]);

  useEffect(() => {
    if (!showComments) return;
    loadCommenti();
    const sub = subscribeCommenti(notizia.id, loadCommenti);
    return () => supabase.removeChannel(sub);
  }, [showComments, loadCommenti, notizia.id]);

  async function handleComment() {
    const testo = nuovoCommento.trim();
    if (!testo) return;
    setPostingComm(true);
    try {
      const autore = profile?.nome || profile?.email || myName;
      const squadra = profile?.squadra || null;
      const created = await insertCommento({
        notiziaId: notizia.id,
        autore,
        squadra,
        testo,
        parentCommentId: replyingTo?.id || null,
      });

      const postOwner = notizia.squadra || null;
      const replyOwner = replyingTo?.squadra || null;
      const notified = new Set();
      if (replyingTo && replyOwner && replyOwner !== squadra) {
        sendTelegramNotification('risposta_commento', {
          autore_squadra: squadra || autore,
          autore,
          titolo: notizia.titolo,
          testo,
        }, replyOwner);
        notified.add(replyOwner);
      }
      if (postOwner && postOwner !== squadra && !notified.has(postOwner)) {
        sendTelegramNotification('commento_ricevuto', {
          autore_squadra: squadra || autore,
          autore,
          titolo: notizia.titolo,
          testo,
        }, postOwner);
      }

      setNuovoCommento("");
      setReplyingTo(null);
      await loadCommenti();
    } catch(e) { alert(e.message); }
    finally { setPostingComm(false); }
  }

  async function handleDeleteComment(id) {
    if (!window.confirm("Eliminare questo commento?")) return;
    try { await deleteCommento(id); await loadCommenti(); }
    catch(e) { alert(e.message); }
  }

  function handleReply(comm) {
    const username = String(comm.autore || '').toLowerCase().replace(/\s/g, '');
    setReplyingTo(comm);
    setNuovoCommento(`@${username} `);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleEditComment(comm) {
    setEditingCommentId(comm.id);
    setEditingCommentText(comm.testo || "");
  }

  async function saveEditedComment(comm) {
    const testo = editingCommentText.trim();
    if (!testo) return;
    if (testo === comm.testo) {
      setEditingCommentId(null);
      setEditingCommentText("");
      return;
    }
    try {
      await updateCommento(comm.id, testo);
      setEditingCommentId(null);
      setEditingCommentText("");
      await loadCommenti();
    } catch(e) { alert(e.message); }
  }

  // count total reactions for display
  const totalReactions = Object.values(notizia.reactions || {}).reduce((s, a) => s + a.length, 0);

  return (
    <article style={{ background: "#0f111a", border: "1px solid #ffffff0e", borderRadius: 16, padding: "18px 20px", position: "relative", transition: "border-color 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#ffffff1a"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#ffffff0e"}>

      {notizia.pinnata && (
        <div style={{ position: "absolute", top: 12, right: 16, fontSize: 11, color: "#f59e0b", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>📌 In evidenza</div>
      )}

      {/* Header */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
        {team ? (
          <TeamAvatar team={team} size={42} />
        ) : notizia.autore === 'Admin' ? (
          <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", border: "2px solid #7c3aed88", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            🛡️
          </div>
        ) : (
          <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg,${teamColor}cc,${teamColor}44)`, border: `2px solid ${teamColor}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "#fff", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>
            {notizia.autore.slice(0,2).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: notizia.autore === 'Admin' ? "#a78bfa" : "#f0f0f0" }}>{notizia.squadra || (notizia.autore === 'Admin' ? '🛡️ Lega Admin' : notizia.autore)}</span>
            {notizia.autore === 'Admin' && <span style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "#7c3aed18", border: "1px solid #7c3aed30", borderRadius: 6, padding: "2px 7px", letterSpacing: "0.05em" }}>UFFICIALE</span>}
            {notizia.squadra && <span style={{ fontSize: 11, color: "#555" }}>@{notizia.autore.toLowerCase().replace(/\s/g,"")}</span>}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#444" }}>
              {timeAgo(notizia.created_at)}
              {notizia.updated_at && new Date(notizia.updated_at).getTime() > new Date(notizia.created_at).getTime() + 1000 && (
                <span style={{ marginLeft: 6, color: "#555" }}>· modificato</span>
              )}
            </span>
          </div>
          <span style={{ display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: cat.color, background: cat.color+"18", border: `1px solid ${cat.color}30`, borderRadius: 6, padding: "2px 8px" }}>{cat.label}</span>
        </div>
      </div>

      {/* Titolo */}
      <div style={{ fontSize: 17, fontWeight: 800, color: "#f0f0f0", lineHeight: 1.3, marginBottom: 10, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "0.5px" }}>{notizia.titolo}</div>

      {/* Testo */}
      <div style={{ fontSize: 14, color: "#aaa", lineHeight: 1.65, whiteSpace: "pre-wrap", marginBottom: 12 }}>
        {testoMostrato}
        {testoLungo && <button onClick={() => setExpanded(v=>!v)} style={{ background:"none",border:"none",color:cat.color,fontSize:13,fontWeight:700,cursor:"pointer",paddingLeft:6 }}>{expanded?"Mostra meno":"Leggi tutto"}</button>}
      </div>

      {/* Immagini */}
      {notizia.immagini?.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:notizia.immagini.length===1?"1fr":"1fr 1fr", gap:4, borderRadius:12, overflow:"hidden", marginBottom:14 }}>
          {notizia.immagini.slice(0,4).map((url,i) => (
            <div key={i} style={{ position:"relative", paddingBottom:notizia.immagini.length===1?"52%":"60%", cursor:"pointer" }} onClick={() => setImgOpen(url)}>
              <img src={url} alt="" style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover" }}/>
              {notizia.immagini.length>4&&i===3&&<div style={{ position:"absolute",inset:0,background:"#000000aa",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:900,color:"#fff" }}>+{notizia.immagini.length-4}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ height:1, background:"#ffffff08", margin:"12px 0" }}/>

      {/* Reactions + commenti count + admin actions */}
      <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
        {EMOJIS.map(emoji => {
          const who = notizia.reactions?.[emoji]||[], iR = who.includes(myName);
          const tooltipId = `react-${notizia.id}-${emoji}`;
          return (
            <div key={emoji} style={{ position:"relative" }}
              onMouseEnter={e => {
                if (who.length === 0) return;
                const tip = document.getElementById(tooltipId);
                if (tip) tip.style.display = "block";
              }}
              onMouseLeave={e => {
                const tip = document.getElementById(tooltipId);
                if (tip) tip.style.display = "none";
              }}>
              <button onClick={() => onReact(notizia.id, emoji, notizia.reactions)}
                style={{ display:"flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:20,border:`1px solid ${iR?cat.color+"60":"#ffffff10"}`,background:iR?cat.color+"15":"transparent",color:iR?cat.color:"#555",fontSize:13,cursor:"pointer",transition:"all 0.12s",fontWeight:iR?700:400 }}>
                {emoji}{who.length>0&&<span style={{ fontSize:11 }}>{who.length}</span>}
              </button>
              {who.length > 0 && (
                <div id={tooltipId} style={{
                  display: "none",
                  position: "absolute",
                  bottom: "calc(100% + 6px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "#1e2130",
                  border: "1px solid #ffffff18",
                  borderRadius: 8,
                  padding: "6px 10px",
                  whiteSpace: "nowrap",
                  zIndex: 100,
                  pointerEvents: "none",
                  boxShadow: "0 4px 16px #00000066",
                }}>
                  {/* Triangolino */}
                  <div style={{
                    position: "absolute", bottom: -5, left: "50%",
                    transform: "translateX(-50%)",
                    width: 8, height: 8,
                    background: "#1e2130",
                    border: "1px solid #ffffff18",
                    borderTop: "none", borderLeft: "none",
                    rotate: "45deg",
                  }}/>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4, letterSpacing: "0.06em" }}>
                    {emoji} {who.length} {who.length === 1 ? "reazione" : "reazioni"}
                  </div>
                  {who.map((name, i) => (
                    <div key={i} style={{
                      fontSize: 12, color: name === myName ? cat.color : "#ccc",
                      fontWeight: name === myName ? 700 : 400,
                      padding: "1px 0",
                    }}>
                      {name === myName ? "✓ Tu" : name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Bottone commenti */}
        <button onClick={() => setShowComments(v=>!v)}
          style={{ display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:20,border:`1px solid ${showComments?"#6366f160":"#ffffff10"}`,background:showComments?"#6366f115":"transparent",color:showComments?"#818cf8":"#555",fontSize:13,cursor:"pointer",transition:"all 0.12s",fontWeight:showComments?700:400 }}>
          💬{commentCount > 0 ? <span style={{ fontSize:11 }}>{commentCount}</span> : null}
        </button>

        <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
          {isAdmin && <button onClick={() => onPin(notizia.id, !notizia.pinnata)} style={{ padding:"5px 10px",borderRadius:8,border:"1px solid #ffffff10",background:"transparent",color:notizia.pinnata?"#f59e0b":"#444",fontSize:12,cursor:"pointer" }}>📌</button>}
          {canEdit && <button onClick={() => onEdit(notizia)} style={{ padding:"5px 10px",borderRadius:8,border:"1px solid #ffffff10",background:"transparent",color:"#444",fontSize:12,cursor:"pointer" }} onMouseEnter={e=>e.currentTarget.style.color="#818cf8"} onMouseLeave={e=>e.currentTarget.style.color="#444"}>✏️</button>}
          {canDelete && <button onClick={() => onDelete(notizia.id)} style={{ padding:"5px 10px",borderRadius:8,border:"1px solid #ffffff10",background:"transparent",color:"#444",fontSize:12,cursor:"pointer" }} onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#444"}>🗑</button>}
        </div>
      </div>

      {/* ── COMMENTI ── */}
      {showComments && (
        <div style={{ marginTop:14, borderTop:"1px solid #ffffff08", paddingTop:14 }}>

          {/* Lista commenti */}
          {loadingComm ? (
            <div style={{ fontSize:12, color:"#444", padding:"8px 0" }}>Caricamento commenti...</div>
          ) : commenti.length === 0 ? (
            <div style={{ fontSize:12, color:"#333", padding:"8px 0", fontStyle:"italic" }}>Ancora nessun commento. Scrivi il primo!</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
              {commenti.map(comm => {
                const ct = teams?.find(t => t.name === comm.squadra);
                const ctColor = ct?.color || "#6366f1";
                const canDelComm = isAdmin || comm.autore === (profile?.nome || profile?.email);
                return (
                  <div key={comm.id} style={{ display:"flex", gap:10, alignItems:"flex-start", marginLeft: comm.parent_comment_id ? 38 : 0, borderLeft: comm.parent_comment_id ? "2px solid #6366f125" : "none", paddingLeft: comm.parent_comment_id ? 10 : 0 }}>
                    {/* Mini avatar */}
                    {ct ? <TeamAvatar team={ct} size={30} /> : (
                      <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0, background:`linear-gradient(135deg,${ctColor}cc,${ctColor}44)`, border:`1.5px solid ${ctColor}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:"#fff", fontFamily:"'Bebas Neue',sans-serif" }}>
                        {comm.autore.slice(0,2).toUpperCase()}
                      </div>
                    )}
                    <div style={{ flex:1, background:"#ffffff06", borderRadius:"0 12px 12px 12px", padding:"8px 12px", position:"relative" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                        <span style={{ fontSize:12, fontWeight:700, color:"#ddd" }}>{comm.squadra || comm.autore}</span>
                        {comm.squadra && <span style={{ fontSize:10, color:"#444" }}>@{comm.autore.toLowerCase().replace(/\s/g,"")}</span>}
                        <span style={{ marginLeft:"auto", fontSize:10, color:"#333" }}>
                          {timeAgo(comm.created_at)}
                          {comm.updated_at && new Date(comm.updated_at).getTime() > new Date(comm.created_at).getTime() + 1000 && (
                            <span style={{ marginLeft:5, color:"#444" }}>· modificato</span>
                          )}
                        </span>
                        <button onClick={() => handleReply(comm)} title="Rispondi"
                          style={{ background:"none", border:"none", color:"#444", fontSize:11, cursor:"pointer", padding:"0 2px", lineHeight:1 }}>↩</button>
                        {canDelComm && <button onClick={() => handleEditComment(comm)} title="Modifica"
                          style={{ background:"none", border:"none", color:"#444", fontSize:11, cursor:"pointer", padding:"0 2px", lineHeight:1 }}>✏️</button>}
                        {canDelComm && (
                          <button onClick={() => handleDeleteComment(comm.id)}
                            style={{ background:"none", border:"none", color:"#333", fontSize:11, cursor:"pointer", padding:"0 2px", lineHeight:1 }}
                            onMouseEnter={e=>e.currentTarget.style.color="#ef4444"}
                            onMouseLeave={e=>e.currentTarget.style.color="#333"}>✕</button>
                        )}
                      </div>
                      {editingCommentId === comm.id ? (
                        <div>
                          <textarea
                            value={editingCommentText}
                            onChange={e => setEditingCommentText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                saveEditedComment(comm);
                              }
                              if (e.key === "Escape") {
                                setEditingCommentId(null);
                                setEditingCommentText("");
                              }
                            }}
                            autoFocus
                            rows={3}
                            style={{ width:"100%", background:"#0d0f14", border:"1px solid #6366f140", borderRadius:8, padding:"8px 10px", color:"#ddd", resize:"vertical", outline:"none", fontSize:13, lineHeight:1.5, fontFamily:"inherit" }}
                          />
                          <div style={{ display:"flex", justifyContent:"flex-end", gap:7, marginTop:7 }}>
                            <button onClick={() => { setEditingCommentId(null); setEditingCommentText(""); }}
                              style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #ffffff12", background:"transparent", color:"#777", fontSize:11 }}>Annulla</button>
                            <button onClick={() => saveEditedComment(comm)} disabled={!editingCommentText.trim()}
                              style={{ padding:"5px 12px", borderRadius:7, border:"none", background:editingCommentText.trim()?"#6366f1":"#333", color:editingCommentText.trim()?"#fff":"#666", fontSize:11, fontWeight:700 }}>Salva</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize:13, color:"#bbb", lineHeight:1.55, whiteSpace:"pre-wrap" }}>{comm.testo}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Input nuovo commento */}
          {replyingTo && (
            <div style={{ marginBottom:8, padding:"7px 10px", borderRadius:8, background:"#6366f112", border:"1px solid #6366f130", fontSize:11, color:"#818cf8", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ flex:1 }}>↩ Risposta a @{String(replyingTo.autore || '').toLowerCase().replace(/\s/g, '')}</span>
              <button onClick={() => { setReplyingTo(null); setNuovoCommento(''); }} style={{ background:"none", border:"none", color:"#777", cursor:"pointer" }}>✕</button>
            </div>
          )}
          {profile && (
            <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              {/* Avatar utente corrente */}
              {(() => {
                const mt = teams?.find(t => t.name === profile.squadra);
                const mc = mt?.color || "#6366f1";
                return (
                  mt ? <TeamAvatar team={mt} size={30} /> : (
                    <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0, background:`linear-gradient(135deg,${mc}cc,${mc}44)`, border:`1.5px solid ${mc}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:"#fff", fontFamily:"'Bebas Neue',sans-serif" }}>
                      {(profile.nome||profile.email||"?").slice(0,2).toUpperCase()}
                    </div>
                  )
                );
              })()}
              <div style={{ flex:1, background:"#ffffff08", borderRadius:"0 12px 12px 12px", border:"1px solid #ffffff10", padding:"8px 12px", display:"flex", gap:8, alignItems:"flex-end" }}>
                <textarea
                  ref={inputRef}
                  value={nuovoCommento}
                  onChange={e => setNuovoCommento(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleComment(); } }}
                  placeholder="Scrivi un commento… (Invio per inviare, Shift+Invio per andare a capo)"
                  rows={1}
                  style={{ flex:1, background:"transparent", border:"none", outline:"none", resize:"none", fontSize:13, color:"#ccc", lineHeight:1.5, fontFamily:"inherit", caretColor:"#6366f1", minHeight:24 }}
                />
                <button
                  onClick={handleComment}
                  disabled={postingComm || !nuovoCommento.trim()}
                  style={{ flexShrink:0, padding:"5px 14px", borderRadius:8, border:"none", background:nuovoCommento.trim()?"linear-gradient(135deg,#6366f1,#a855f7)":"#333", color:nuovoCommento.trim()?"#fff":"#555", fontSize:12, fontWeight:700, cursor:nuovoCommento.trim()?"pointer":"not-allowed", transition:"all 0.12s" }}>
                  {postingComm ? "…" : "→"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {imgOpen && (
        <div onClick={() => setImgOpen(null)} style={{ position:"fixed",inset:0,background:"#000000ee",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out" }}>
          <img src={imgOpen} alt="" style={{ maxWidth:"90vw",maxHeight:"90vh",borderRadius:12,objectFit:"contain" }} onClick={e=>e.stopPropagation()}/>
        </div>
      )}
    </article>
  );
}

function NewsComposer({ profile, teams, onPost, isAdmin, editingPost = null, onCancelEdit }) {
  const [open, setOpen] = useState(false);
  const [titolo, setTitolo] = useState("");
  const [testo, setTesto] = useState("");
  const [categoria, setCategoria] = useState("news");
  const [immagini, setImmagini] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postAsAdmin, setPostAsAdmin] = useState(false);
  const team = teams?.find(t => t.name === profile?.squadra);
  const isEditing = Boolean(editingPost);
  const teamColor = postAsAdmin ? "#7c3aed" : (team?.color || "#6366f1");

  useEffect(() => {
    if (!editingPost) return;
    setOpen(true);
    setTitolo(editingPost.titolo || "");
    setTesto(editingPost.testo || "");
    setCategoria(editingPost.categoria || "news");
    setImmagini(Array.isArray(editingPost.immagini) ? editingPost.immagini : []);
    setPostAsAdmin(editingPost.autore === 'Admin');
  }, [editingPost]);

  function resetComposer() {
    setTitolo("");
    setTesto("");
    setImmagini([]);
    setCategoria("news");
    setPostAsAdmin(false);
    setOpen(false);
  }

  async function handleImgUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    try {
      const urls = await Promise.all(files.map(async file => {
        const path = `${profile.squadra || 'admin'}/${Date.now()}_${file.name}`;
        return await uploadNotiziaImmagine(file, path);
      }));
      setImmagini(v => [...v, ...urls]);
    } catch(err) { alert("Errore upload: " + err.message); }
    finally { setUploading(false); }
  }

  async function handlePost() {
    if (!titolo.trim() || !testo.trim()) return;
    setPosting(true);
    try {
      if (isEditing) {
        await updateNotizia(editingPost.id, {
          categoria,
          titolo: titolo.trim(),
          testo: testo.trim(),
          immagini,
        });
      } else {
        await insertNotizia({
          autore: postAsAdmin ? 'Admin' : (profile.nome || profile.email),
          squadra: postAsAdmin ? null : (profile.squadra || null),
          categoria,
          titolo: titolo.trim(),
          testo: testo.trim(),
          immagini,
        });
        // Ogni nuova notizia viene annunciata normalmente nel canale Telegram.
        sendTelegramNotification('nuova_notizia', {
          squadra: postAsAdmin ? null : (profile.squadra || null),
          autore: postAsAdmin ? 'Admin' : (profile.nome || profile.email),
          titolo: titolo.trim(),
          testo: testo.trim(),
        });
      }
      resetComposer();
      if (isEditing) onCancelEdit?.();
      onPost?.();
    } catch(err) { alert(err.message); }
    finally { setPosting(false); }
  }

  const cat = getCatInfo(categoria);

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{
        width: "100%", padding: "16px 20px", borderRadius: 14,
        border: `1.5px dashed ${teamColor}40`,
        background: teamColor + "08",
        color: teamColor + "aa", fontSize: 14, fontWeight: 600,
        cursor: "pointer", textAlign: "left",
        display: "flex", alignItems: "center", gap: 12,
        transition: "all 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = teamColor + "15"; e.currentTarget.style.borderColor = teamColor + "60"; }}
      onMouseLeave={e => { e.currentTarget.style.background = teamColor + "08"; e.currentTarget.style.borderColor = teamColor + "40"; }}>
      {team ? <TeamAvatar team={team} size={36} /> : (
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg,${teamColor}cc,${teamColor}44)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>✏️</div>
      )}
      Scrivi una notizia, conferenza stampa, risultato…
    </button>
  );

  return (
    <div style={{ background: "#0f111a", border: `1.5px solid ${teamColor}40`, borderRadius: 16, padding: 20 }}>
      {/* Admin identity toggle */}
      {isAdmin && !isEditing && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "8px 12px", borderRadius: 10, background: postAsAdmin ? "#7c3aed18" : "#ffffff06", border: `1px solid ${postAsAdmin ? "#7c3aed40" : "#ffffff10"}` }}>
          {postAsAdmin ? (
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🛡️</div>
          ) : team ? (
            <TeamAvatar team={team} size={28} />
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#ffffff10", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>👤</div>
          )}
          <span style={{ flex: 1, fontSize: 12, color: postAsAdmin ? "#a78bfa" : "#666", fontWeight: 600 }}>
            {postAsAdmin ? "Pubblicazione come Lega Admin" : `Pubblicazione come ${team?.name || profile?.nome || "presidente"}`}
          </span>
          <button onClick={() => setPostAsAdmin(v => !v)}
            style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${postAsAdmin ? "#7c3aed60" : "#ffffff15"}`, background: postAsAdmin ? "#7c3aed22" : "transparent", color: postAsAdmin ? "#a78bfa" : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {postAsAdmin ? "🛡️ Admin" : "Passa ad Admin"}
          </button>
        </div>
      )}

      {isEditing && (
        <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: "#f59e0b12", border: "1px solid #f59e0b35", color: "#f59e0b", fontSize: 12, fontWeight: 700 }}>
          ✏️ Modifica del post in corso
        </div>
      )}

      {/* Categoria selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {CATEGORIE.map(c => (
          <button key={c.val} onClick={() => setCategoria(c.val)}
            style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${categoria === c.val ? c.color : "#ffffff15"}`, background: categoria === c.val ? c.color + "22" : "transparent", color: categoria === c.val ? c.color : "#555", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Titolo */}
      <input
        value={titolo} onChange={e => setTitolo(e.target.value)}
        placeholder="Titolo…"
        style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 18, fontWeight: 800, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "0.5px", marginBottom: 10, caretColor: cat.color }}
      />

      {/* Testo */}
      <textarea
        value={testo} onChange={e => setTesto(e.target.value)}
        placeholder="Scrivi qui il testo del post…"
        rows={4}
        style={{ width: "100%", background: "transparent", border: "none", outline: "none", resize: "vertical", fontSize: 14, color: "#aaa", lineHeight: 1.65, caretColor: cat.color }}
      />

      {/* Preview immagini */}
      {immagini.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {immagini.map((url, i) => (
            <div key={i} style={{ position: "relative", width: 80, height: 80 }}>
              <img src={url} alt="" style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover" }} />
              <button onClick={() => setImmagini(v => v.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#ef4444", border: "none", color: "#fff", fontSize: 11, fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 1, background: "#ffffff08", margin: "14px 0" }} />

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ cursor: "pointer", color: "#555", fontSize: 20 }}>
            🖼
            <input type="file" accept="image/*" multiple onChange={handleImgUpload} style={{ display: "none" }} />
          </label>
          {uploading && <span style={{ fontSize: 11, color: "#555" }}>Upload…</span>}
          <span style={{ fontSize: 11, color: "#444" }}>{testo.length} caratteri</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { resetComposer(); if (isEditing) onCancelEdit?.(); }}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ffffff15", background: "transparent", color: "#666", fontSize: 13, cursor: "pointer" }}>
            Annulla
          </button>
          <button onClick={handlePost} disabled={posting || !titolo.trim() || !testo.trim()}
            style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: titolo.trim() && testo.trim() ? `linear-gradient(135deg, ${cat.color}, ${cat.color}cc)` : "#333", color: "#fff", fontSize: 13, fontWeight: 700, cursor: titolo.trim() && testo.trim() ? "pointer" : "not-allowed" }}>
            {posting ? (isEditing ? "Salvataggio…" : "Pubblicazione…") : (isEditing ? "Salva modifiche →" : "Pubblica →")}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewsPage({ profile, isAdmin, teams }) {
  const [notizie, setNotizie] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState("tutti");
  const [nuoviDisponibili, setNuoviDisponibili] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const myName = profile?.nome || profile?.email || "";

  // Caricamento iniziale
  const loadNotizie = useCallback(async () => {
    try { setNotizie(await getNotizie()); }
    catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadNotizie(); }, [loadNotizie]);

  // Realtime: NON ricarica automaticamente — mostra solo il banner
  // In questo modo chi sta scrivendo non viene interrotto
  useEffect(() => {
    const sub = subscribeNotizie(() => setNuoviDisponibili(true));
    return () => supabase.removeChannel(sub);
  }, []);

  // Ricarica manuale (banner o dopo aver pubblicato)
  async function refreshFeed() {
    setNuoviDisponibili(false);
    await loadNotizie();
  }

  async function handleReact(id, emoji, current) {
    // Aggiorna ottimisticamente il feed locale senza ricaricare tutto
    try {
      const newReactions = await toggleReaction(id, emoji, myName, current);
      setNotizie(prev => prev.map(n => n.id === id ? { ...n, reactions: newReactions } : n));
    } catch(e) { alert(e.message); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Eliminare questo post?")) return;
    try {
      await deleteNotizia(id);
      setNotizie(prev => prev.filter(n => n.id !== id));
    } catch(e) { alert(e.message); }
  }

  function handleEdit(notizia) {
    setEditingPost(notizia);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handlePin(id, pinnata) {
    try {
      await togglePinnata(id, pinnata);
      setNotizie(prev => prev.map(n => n.id === id ? { ...n, pinnata } : n));
      // Il pin modifica solo la visibilità nel sito: la notizia è già stata annunciata alla pubblicazione.
    } catch(e) { alert(e.message); }
  }

  // Dopo la pubblicazione ricarica silenziosamente
  async function handlePostPublicato() {
    setNuoviDisponibili(false);
    await loadNotizie();
  }

  const notizieFiltered = filtroCategoria === "tutti"
    ? notizie
    : notizie.filter(n => n.categoria === filtroCategoria);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <style>{`textarea { font-family: 'Inter', system-ui, sans-serif; }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "2px", lineHeight: 1 }}>
          SALA STAMPA
        </div>
        <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>Stagione 2026/27 · {notizie.length} post</div>
      </div>

      {/* Composer — ha il suo stato interno, non viene toccato dal feed */}
      <div style={{ marginBottom: 20 }}>
        <NewsComposer profile={profile} teams={teams} onPost={handlePostPublicato} isAdmin={isAdmin} editingPost={editingPost} onCancelEdit={() => setEditingPost(null)} />
      </div>

      {/* Banner nuovi post — appare solo quando arrivano aggiornamenti */}
      {nuoviDisponibili && (
        <button onClick={refreshFeed}
          style={{ width: "100%", marginBottom: 12, padding: "10px", borderRadius: 10, border: "1px solid #6366f140", background: "#6366f112", color: "#818cf8", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          ↑ Nuovi post disponibili — clicca per aggiornare
        </button>
      )}

      {/* Filtri */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => setFiltroCategoria("tutti")}
          style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${filtroCategoria === "tutti" ? "#6366f1" : "#ffffff15"}`, background: filtroCategoria === "tutti" ? "#6366f122" : "transparent", color: filtroCategoria === "tutti" ? "#818cf8" : "#555", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Tutti
        </button>
        {CATEGORIE.map(cat => (
          <button key={cat.val} onClick={() => setFiltroCategoria(cat.val)}
            style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${filtroCategoria === cat.val ? cat.color : "#ffffff15"}`, background: filtroCategoria === cat.val ? cat.color + "22" : "transparent", color: filtroCategoria === cat.val ? cat.color : "#555", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1,2,3].map(i => (
            <div key={i} style={{ background: "#0f111a", border: "1px solid #ffffff0a", borderRadius: 16, padding: 20, opacity: 0.5 }}>
              <div style={{ height: 14, width: "40%", background: "#ffffff10", borderRadius: 6, marginBottom: 10 }} />
              <div style={{ height: 20, width: "70%", background: "#ffffff08", borderRadius: 6, marginBottom: 8 }} />
              <div style={{ height: 14, width: "90%", background: "#ffffff06", borderRadius: 6 }} />
            </div>
          ))}
        </div>
      ) : notizieFiltered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#333" }}>
          <div style={{ fontSize: 48 }}>📰</div>
          <div style={{ fontSize: 14, marginTop: 12 }}>Nessuna notizia ancora.</div>
          <div style={{ fontSize: 11, color: "#2a2a2a", marginTop: 4 }}>Sii il primo a scrivere qualcosa!</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notizieFiltered.map(n => (
            <NewsCard
              key={n.id}
              notizia={n}
              myName={myName}
              isAdmin={isAdmin}
              onReact={handleReact}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onPin={handlePin}
              teams={teams}
              profile={profile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── LOGIN PAGE ─────────────────────────────────────────────────────────────── */
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleLogin() {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
      onLogin();
    } catch {
      setError("Email o password errati");
    } finally {
      setLoading(false);
    }
  }

  const inp = { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #ffffff18", background: "#ffffff08", color: "#f0f0f0", fontSize: 14, outline: "none" };

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700;800;900&display=swap');*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{ width: 360, padding: 36, background: "#13151c", border: "1px solid #ffffff10", borderRadius: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 14px" }}>⚽</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "2px" }}>FANTA MANAGERIALE</div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>Stagione 2026/27</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input style={inp} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
          <input style={inp} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
          {error && <div style={{ fontSize: 12, color: "#ef4444", textAlign: "center" }}>{error}</div>}
          <button onClick={handleLogin} disabled={loading} style={{ padding: "13px", borderRadius: 10, border: "none", background: loading ? "#333" : "linear-gradient(135deg,#6366f1,#a855f7)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loading ? "default" : "pointer", marginTop: 4 }}>
            {loading ? "Accesso..." : "Accedi →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── APP ROOT ──────────────────────────────────────────────────────────────── */

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [squadreDB, setSquadreDB] = useState([]);
  const [fpfMap, setFpfMap] = useState({});
  const [clubIdentities, setClubIdentities] = useState({});
  const [offerteInAttesa, setOfferteInAttesa] = useState([]);
  const [mercatoOverride, setMercatoOverride_state] = useState(null); // null=auto, 'aperto', 'chiuso'
  const [stagioneLabel, setStagioneLabelState] = useState('2026/27');
  const [editingStagione, setEditingStagione] = useState(false);
  const [editingStagioneVal, setEditingStagioneVal] = useState('');

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); if (session) loadProfile(session.user.id); else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session); if (session) loadProfile(session.user.id); else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    try { setProfile(await getProfile(userId)); } catch {}
    setAuthLoading(false);
  }

  // ── Pagamenti automatici: solo stipendi mensili + stadio ───────────────
  // Le tasse settimanali sono volutamente escluse: si applicano solo dalla Control Room.
  useEffect(() => {
    if (!session) return;
    const now = new Date();
    const mKey = `autopay_stip_stadio_${now.toISOString().slice(0,7)}`;
    if (localStorage.getItem(mKey)) return;

    applicaPagamentiAutomatici().then(r => {
      if (r.stipendi?.length) { console.log(`✅ Stipendi auto: ${r.stipendi.length} squadre`); }
      if (r.stadio?.length)   { console.log(`✅ Stadio auto: ${r.stadio.length} squadre`); }
      localStorage.setItem(mKey, '1');
      if (r.errori?.length) console.warn('⚠️ Errori pagamenti auto:', r.errori);
      if (r.stipendi?.length || r.stadio?.length) {
        getSquadre().then(data => { if (data) setSquadreDB(data); });
      }
    }).catch(e => console.warn('Pagamenti auto:', e.message));
  }, [session]);

  // ── Squadre realtime ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    getSquadre().then(data => { if (data) setSquadreDB(data); });
    const sub = subscribeSquadre(() => getSquadre().then(data => { if (data) setSquadreDB(data); }));
    return () => supabase.removeChannel(sub);
  }, [session]);

  // ── Mercato override ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    getMercatoOverride().then(v => { _mercatoOverride = v; setMercatoOverride_state(v); }).catch(() => { _mercatoOverride = null; });
    getRivalitaLock().then(v => { _rivalitaBloccata = v; }).catch(() => { _rivalitaBloccata = false; });
    getStagioneLabel().then(v => { setStagioneLabelState(v); }).catch(() => {});
  }, [session]);

  // ── Offerte in attesa: solo realtime, nessun polling ─────────────────────
  const offerteRef = useRef([]);
  useEffect(() => {
    if (!session || !profile?.squadra) return;
    const load = async () => {
      const nuove = await getOfferteInAttesa(profile.squadra).catch(() => []);
      if (JSON.stringify(nuove.map(o=>o.id).sort()) !== JSON.stringify(offerteRef.current.map(o=>o.id).sort())) {
        offerteRef.current = nuove;
        setOfferteInAttesa(nuove);
      }
    };
    load();
    // Nessun setInterval — si aggiorna solo quando cambiano le trattative nel DB
    const sub = supabase.channel('trattative-notif')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trattative' }, load)
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [session, profile?.squadra]);

  // ── FPF: aggiorna solo su eventi reali (movimenti DB) ────────────────────
  const fpfRef = useRef({});
  useEffect(() => {
    if (!session) return;
    const load = async () => {
      const map = await getFpfTutteSquadre().catch(() => ({}));
      if (JSON.stringify(map) !== JSON.stringify(fpfRef.current)) {
        fpfRef.current = map;
        setFpfMap(map);
      }
    };
    load();
    // Nessun interval: si aggiorna solo quando cambiano i movimenti nel DB
    const sub = subscribeMovimentiAll(load);
    return () => supabase.removeChannel(sub);
  }, [session]);

  // ── Deadline watcher: aggiorna stato mercato e invalida cache ─────────────
  const statoMercato = useDeadlineWatcher(useCallback((def) => {
    console.info(`⏰ Deadline scattata: ${def.label}`);
    // Ricarica squadre (bilanci/stipendi potrebbero essere cambiati)
    if (['stipendi','tassa','mercato'].includes(def.type)) {
      getSquadre().then(data => { if (data) setSquadreDB(data); });
    }
  }, []));

  // ── Club identities ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    function loadCI() {
      getAllClubIdentities().then(rows => {
        const map = {};
        for (const r of rows || []) map[r.squadra] = { stemma_url: r.stemma_url, maglia_casa_url: r.maglia_casa_url, maglia_trasferta_url: r.maglia_trasferta_url, maglia_terza_url: r.maglia_terza_url };
        setClubIdentities(map);
      });
    }
    loadCI();
    const sub = supabase.channel('ci-all').on('postgres_changes', { event: '*', schema: 'public', table: 'club_identity' }, loadCI).subscribe();
    return () => supabase.removeChannel(sub);
  }, [session]);

  // ── Screen resize ─────────────────────────────────────────────────────────
  useEffect(() => {
    const h = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", h); return () => window.removeEventListener("resize", h);
  }, []);

  // useMemo evita di ricreare l'array ad ogni render quando i dati non cambiano
  const mergedTeams = useMemo(() => TEAMS.map(t => {
    const db = squadreDB.find(s => s.name === t.name);
    const ci = clubIdentities[t.name] || {};
    const base = { stemma_url: ci.stemma_url||null, maglia_casa_url: ci.maglia_casa_url||null, maglia_trasferta_url: ci.maglia_trasferta_url||null, maglia_terza_url: ci.maglia_terza_url||null };
    if (!db) return { ...t, ...base, fpf: fpfMap[t.name]??null };
    return { ...t, ...base, bilancio: db.bilancio, salaryUsed: db.salary_used, giocatori: db.giocatori, u21: db.u21, fairPlay1: db.fair_play1, fairPlay2: db.fair_play2, penalita: db.penalita, guadGiornate: db.guad_giornate, guadObiettivi: db.guad_obiettivi, guadInv: db.guad_inv, clausoleIn: db.clausole_in, clausoleOut: db.clausole_out, euroInvestiti: db.euro_investiti||0, mlnExtra: db.mln_extra||0, euroBiennio: db.euro_biennio||0, scNegativoDal: db.sc_negativo_dal||null, mercatoBloccato: db.mercato_bloccato||false, bilancioNegDal: db.bilancio_neg_dal||null, bilancioNegSettimane: db.bilancio_neg_settimane||0, fallimento: db.fallimento||false, fallimentoDal: db.fallimento_dal||null, fpf: fpfMap[t.name]??null, biennio: db.biennio||'2025-27', quotaPagata: db.quota_pagata||false, iscrizionePagata: db.iscrizione_pagata||false };
  }), [squadreDB, fpfMap, clubIdentities]);

  const isAdmin = profile?.ruolo === "admin" || profile?.ruolo === "founder";
  const mySquadra = profile?.squadra;
  const pathname = location.pathname;
  const currentPage = pathname==='/news'?'news':pathname==='/squadre'?'squadre':pathname.startsWith('/presidente')?'squadre':pathname==='/lega'?'lega':pathname==='/mercato'?'mercato':pathname==='/modifica'?'admin-control':pathname==='/adminlog'?'admin-control':pathname==='/admin-control'?'admin-control':pathname==='/profilo'?'profilo':pathname==='/storico'?'storico':'news';

  const navItems = [
    { key:"news",    path:"/news",    icon:"📰", label:"News"    },
    { key:"squadre", path:"/squadre", icon:"🏟", label:"Squadre" },
    { key:"lega",    path:"/lega",    icon:"📊", label:"Lega"    },
    { key:"mercato", path:"/mercato", icon:"🤝", label:"Mercato" },
    { key:"storico", path:"/storico", icon:"📚", label:"Archivio" },
    ...(isAdmin ? [{ key:"admin-control", path:"/admin-control", icon:"⚡", label:"Admin" }] : []),
  ];
  const SIDEBAR_W = 200;

  if (authLoading) return <div style={{ minHeight:"100vh",background:"#0d0f14",display:"flex",alignItems:"center",justifyContent:"center" }}><div style={{ color:"#555",fontSize:14 }}>Caricamento...</div></div>;
  if (!session) return <LoginPage onLogin={() => {}} />;

  const refreshSquadre = () => getSquadre().then(data => { if(data) setSquadreDB(data); });

  // ── PageContent come useMemo — NON si rimonta ad ogni re-render di AppInner
  // Le route vengono ri-renderizzate solo se le props che usano cambiano davvero
  const pageContent = (
    <Routes>
      <Route path="/" element={<Navigate to="/news" replace />}/>
      <Route path="/news" element={<NewsPage profile={profile} isAdmin={isAdmin} teams={mergedTeams}/>}/>
      <Route path="/squadre" element={<SquadrePage onSelectTeam={t=>navigate(`/presidente/${t.id}`)} teams={mergedTeams} profile={profile} isAdmin={isAdmin}/>}/>
      <Route path="/lega" element={<LegaPage teams={mergedTeams} isAdmin={isAdmin}/>}/>
      <Route path="/mercato" element={<MercatoPage profile={profile} isAdmin={isAdmin} teams={mergedTeams} offerteInAttesa={offerteInAttesa} statoMercato={statoMercato}/>}/>
      {isAdmin && <Route path="/admin-control" element={<AdminControlRoomPage teams={mergedTeams}/>}/>}
      <Route path="/storico" element={<StoricoPage isAdmin={isAdmin} allClubIdentities={Object.entries(clubIdentities).map(([squadra, ci]) => ({ squadra, logo_url: ci.stemma_url }))}/>}/>
      <Route path="/profilo" element={<ProfileSettingsPage session={session} profile={profile} onProfileUpdated={()=>getProfile(session.user.id).then(p=>setProfile(p))}/>}/>
      <Route path="/presidente/:teamId" element={<PresidentePageWrapper mergedTeams={mergedTeams} isAdmin={isAdmin} mySquadra={mySquadra}/>}/>
      <Route path="/presidente/:teamId/:tab" element={<PresidentePageWrapper mergedTeams={mergedTeams} isAdmin={isAdmin} mySquadra={mySquadra}/>}/>
      <Route path="*" element={<Navigate to="/news" replace />}/>
    </Routes>
  );

  return (
    <div style={{ minHeight:"100vh",background:"#0d0f14",fontFamily:"'Inter',system-ui,sans-serif",color:"#f0f0f0" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800;900&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#333;border-radius:2px}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}body{background:#0d0f14}@media(max-width:1100px){.main-content-pad{padding:20px 20px!important}}@media(max-width:900px){.main-content-pad{padding:16px 14px!important}}@media(max-width:768px){
input,select,textarea{font-size:16px!important;-webkit-text-size-adjust:100%}
.table-mob{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:8px}
.grid-stats-8{grid-template-columns:repeat(4,1fr)!important}
.grid-stats-3{grid-template-columns:repeat(3,1fr)!important}
.grid-stats-4{grid-template-columns:repeat(2,1fr)!important}
.modal-pad{padding:16px!important}
div:has(>table){overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;min-width:max-content}
}
@media(max-width:400px){.grid-stats-8{grid-template-columns:repeat(4,1fr)!important}.grid-stats-3{grid-template-columns:1fr 1fr!important}}`}</style>
      {isDesktop ? (
        <div style={{ display:"flex",minHeight:"100vh" }}>
          {/* Sidebar */}
          <div style={{ width:SIDEBAR_W,flexShrink:0,background:"#0a0c11",borderRight:"1px solid #ffffff0e",display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,height:"100vh",zIndex:100 }}>
            <div style={{ padding:"20px 18px 16px",borderBottom:"1px solid #ffffff0a" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                <img src="/icon-192.png" alt="logo" style={{ width:34,height:34,borderRadius:10,objectFit:"cover",flexShrink:0 }} />
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:15,fontWeight:900,color:"#f0f0f0",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"1.5px",lineHeight:1 }}>FantaManager</div>
                  {editingStagione && isAdmin ? (
                    <form onSubmit={async e => { e.preventDefault(); await setStagioneLabel(editingStagioneVal); setStagioneLabelState(editingStagioneVal); setEditingStagione(false); }} style={{ display:"flex",alignItems:"center",gap:4,marginTop:3 }}>
                      <input
                        value={editingStagioneVal}
                        onChange={e => setEditingStagioneVal(e.target.value)}
                        autoFocus
                        style={{ fontSize:10,background:"#ffffff12",border:"1px solid #6366f150",borderRadius:5,color:"#aaa",padding:"2px 5px",width:60,outline:"none" }}
                      />
                      <button type="submit" style={{ fontSize:9,background:"#6366f120",border:"none",borderRadius:4,color:"#818cf8",padding:"2px 5px",cursor:"pointer",fontWeight:700 }}>✓</button>
                      <button type="button" onClick={() => setEditingStagione(false)} style={{ fontSize:9,background:"transparent",border:"none",color:"#555",cursor:"pointer" }}>✕</button>
                    </form>
                  ) : (
                    <div
                      style={{ fontSize:10,color:"#555",marginTop:2,cursor:isAdmin?"pointer":"default",display:"inline-flex",alignItems:"center",gap:4 }}
                      onClick={() => { if (isAdmin) { setEditingStagioneVal(stagioneLabel); setEditingStagione(true); } }}
                      title={isAdmin ? "Clicca per modificare la stagione" : undefined}
                    >
                      {stagioneLabel}{isAdmin && <span style={{ fontSize:8,opacity:0.4 }}>✏️</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <nav style={{ padding:"14px 12px",flex:1,overflowY:"auto" }}>
              {navItems.map(item => {
                const active = currentPage === item.key;
                const badge = item.key === "mercato" && offerteInAttesa.length > 0 ? offerteInAttesa.length : 0;
                return (
                  <button key={item.key} onClick={() => navigate(item.path)}
                    style={{ width:"100%",display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:"none",background:active?"#6366f122":"transparent",color:active?"#818cf8":"#666",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:4,textAlign:"left",position:"relative" }}
                    onMouseEnter={e=>{if(!active){e.currentTarget.style.background="#ffffff08";e.currentTarget.style.color="#aaa";}}}
                    onMouseLeave={e=>{if(!active){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#666";}}}>
                    <span style={{ fontSize:18,position:"relative" }}>
                      {item.icon}
                      {badge>0&&<span style={{ position:"absolute",top:-4,right:-4,background:"#ef4444",color:"#fff",borderRadius:"50%",fontSize:8,width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900 }}>{badge}</span>}
                    </span>
                    {item.label}
                    {badge>0&&!active&&<span style={{ marginLeft:"auto",fontSize:9,color:"#ef4444",fontWeight:800 }}>{badge} nuov{badge===1?"a":"e"}</span>}
                    {active&&<div style={{ marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:"#6366f1" }}/>}
                  </button>
                );
              })}
              {isAdmin && (
                <div style={{ marginTop:20 }}>
                  <div style={{ fontSize:9,color:"#333",letterSpacing:"0.1em",fontWeight:700,padding:"0 12px",marginBottom:8 }}>⚡ ADMIN</div>
                  {[{key:"admin-control",path:"/admin-control",icon:"⚡",label:"Control Room"}].map(item => {
                    const active = currentPage === item.key;
                    return <button key={item.key} onClick={()=>navigate(item.path)} style={{ width:"100%",display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:"none",background:active?"#f59e0b22":"transparent",color:active?"#f59e0b":"#555",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:3,textAlign:"left" }} onMouseEnter={e=>{if(!active){e.currentTarget.style.background="#ffffff08";e.currentTarget.style.color="#aaa";}}} onMouseLeave={e=>{if(!active){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#555";}}}><span style={{ fontSize:16 }}>{item.icon}</span>{item.label}{active&&<div style={{ marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:"#f59e0b" }}/>}</button>;
                  })}
                </div>
              )}
              {pathname.startsWith('/presidente') && (
                <div style={{ marginTop:16 }}>
                  <div style={{ fontSize:9,color:"#333",letterSpacing:"0.1em",fontWeight:700,padding:"0 12px",marginBottom:8 }}>PRESIDENTI</div>
                  {mergedTeams.map(t => {
                    const isSel = pathname.startsWith(`/presidente/${t.id}`);
                    return <button key={t.id} onClick={()=>navigate(`/presidente/${t.id}`)} style={{ width:"100%",display:"flex",alignItems:"center",gap:8,padding:"7px 12px",borderRadius:8,border:"none",background:isSel?t.color+"22":"transparent",cursor:"pointer",marginBottom:2 }} onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background="#ffffff08";}} onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background="transparent";}}><TeamAvatar team={t} size={22} /><span style={{ fontSize:11,color:isSel?t.color:"#777",fontWeight:isSel?700:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{t.name}</span></button>;
                  })}
                </div>
              )}
            </nav>
            <div style={{ padding:"12px 16px",borderTop:"1px solid #ffffff0a" }}>
              {profile && <div onClick={()=>navigate('/profilo')} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8,cursor:"pointer",padding:"5px 6px",borderRadius:9,transition:"background 0.15s",background:currentPage==='profilo'?"#f59e0b22":"transparent" }} onMouseEnter={e=>{ if(currentPage!=='profilo') e.currentTarget.style.background="#ffffff0a"; }} onMouseLeave={e=>{ e.currentTarget.style.background=currentPage==='profilo'?"#f59e0b22":"transparent"; }}>{profile.avatar_url?<img src={profile.avatar_url} alt="" style={{ width:26,height:26,borderRadius:7,objectFit:"cover",outline:currentPage==='profilo'?"2px solid #f59e0b":"none" }}/>:<div style={{ width:26,height:26,borderRadius:7,background:currentPage==='profilo'?"#f59e0b22":"#ffffff12",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12 }}>👤</div>}<div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:11,fontWeight:700,color:currentPage==='profilo'?"#f59e0b":"#ccc",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{profile.nome||profile.email}</div><div style={{ fontSize:9,color:currentPage==='profilo'?"#f59e0b88":"#444" }}>{isAdmin?"⚡ Admin":profile.squadra}</div></div>{currentPage==='profilo'&&<div style={{ width:6,height:6,borderRadius:"50%",background:"#f59e0b",flexShrink:0 }}/>}</div>}
              <button onClick={()=>signOut()} style={{ width:"100%",padding:"7px",borderRadius:8,border:"1px solid #ffffff10",background:"transparent",color:"#555",fontSize:11,fontWeight:600,cursor:"pointer" }}>Esci</button>
            </div>
          </div>
          <div className="main-content-pad" style={{ marginLeft:SIDEBAR_W,flex:1,padding:"28px 32px",minWidth:0,position:"relative" }}>
            <button onClick={() => window.location.reload()} title="Aggiorna pagina"
              style={{ position:"absolute",top:18,right:24,zIndex:50,background:"#ffffff08",border:"1px solid #ffffff12",borderRadius:8,color:"#555",fontSize:14,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"background 0.15s,color 0.15s" }}
              onMouseEnter={e=>{e.currentTarget.style.background="#ffffff14";e.currentTarget.style.color="#aaa";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#ffffff08";e.currentTarget.style.color="#555";}}>
              ↻
            </button>
            {pageContent}
          </div>
        </div>
      ) : (
        <div style={{ paddingBottom:"calc(68px + env(safe-area-inset-bottom,0px))" }}>
          {!pathname.startsWith('/presidente') && (
            <div style={{ borderBottom:"1px solid #ffffff0e",background:"#0d0f14f0",backdropFilter:"blur(12px)",position:"sticky",top:0,zIndex:100,padding:"0 16px" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",height:50 }}>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <img src="/icon-192.png" alt="logo" style={{ width:28,height:28,borderRadius:8,objectFit:"cover",flexShrink:0 }} />
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:14,fontWeight:900,color:"#f0f0f0",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"1.5px",lineHeight:1 }}>FantaManager</div>
                    <div style={{ fontSize:9,color:"#555",lineHeight:1.2 }}>{stagioneLabel}</div>
                  </div>
                </div>
                <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                  <button onClick={()=>window.location.reload()} title="Aggiorna" style={{ width:28,height:28,borderRadius:7,border:"1px solid #ffffff12",background:"transparent",color:"#555",fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>↻</button>
                  {profile && (
                    <div onClick={()=>navigate('/profilo')} style={{ cursor:"pointer",display:"flex",alignItems:"center" }}>
                      {profile.avatar_url
                        ? <img src={profile.avatar_url} alt="" style={{ width:28,height:28,borderRadius:7,objectFit:"cover",outline:currentPage==='profilo'?"2px solid #f59e0b":"1px solid #ffffff18" }} />
                        : <div style={{ width:28,height:28,borderRadius:7,background:currentPage==='profilo'?"#f59e0b22":"#ffffff10",border:currentPage==='profilo'?"1px solid #f59e0b44":"1px solid #ffffff18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13 }}>👤</div>
                      }
                    </div>
                  )}
                  <button onClick={()=>signOut()} style={{ padding:"5px 10px",borderRadius:7,border:"1px solid #ffffff12",background:"transparent",color:"#555",fontSize:11,cursor:"pointer" }}>Esci</button>
                </div>
              </div>
            </div>
          )}
          <div style={{ padding:"16px 14px",position:"relative" }}>
            {pageContent}
          </div>
          <div style={{ position:"fixed",bottom:0,left:0,right:0,background:"#13151cee",backdropFilter:"blur(16px)",borderTop:"1px solid #ffffff10",display:"flex",flexDirection:"column",zIndex:200,paddingBottom:"env(safe-area-inset-bottom,0px)" }}><div style={{ display:"flex",height:68 }}>
            {navItems.map(item => {
              const active = currentPage === item.key;
              const badge = item.key === "mercato" && offerteInAttesa.length > 0 ? offerteInAttesa.length : 0;
              return <button key={item.key} onClick={()=>navigate(item.path)} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,border:"none",background:"transparent",cursor:"pointer",padding:"8px 0",position:"relative",minHeight:44 }}>
                {active&&<div style={{ position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:28,height:3,borderRadius:"0 0 3px 3px",background:"#6366f1" }}/>}
                <span style={{ fontSize:20,position:"relative" }}>{item.icon}{badge>0&&<span style={{ position:"absolute",top:-3,right:-5,background:"#ef4444",color:"#fff",borderRadius:"50%",fontSize:8,width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900 }}>{badge}</span>}</span>
                <span style={{ fontSize:10,fontWeight:700,color:active?"#6366f1":"#666" }}>{item.label}</span>
              </button>;
            })}
          </div></div>
        </div>
      )}
    </div>
  );
}


function PresidentePageWrapper({ mergedTeams, isAdmin, mySquadra }) {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const team = mergedTeams.find(t => String(t.id) === String(teamId));
  if (!team) return <div style={{ padding:40,textAlign:"center",color:"#555",fontSize:14 }}>Squadra non trovata. <button onClick={()=>navigate("/squadre")} style={{ color:"#818cf8",background:"none",border:"none",cursor:"pointer",fontSize:14,fontWeight:700 }}>← Torna alle squadre</button></div>;
  return <PresidentePage team={team} onBack={()=>navigate("/squadre")} isAdmin={isAdmin} mySquadra={mySquadra}/>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}