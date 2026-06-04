import { useState, useEffect, useCallback } from "react";
import { TEAMS, getFPStatus, getSCColor, getRoleColor, FREE_AGENTS } from "./data.js";
import { supabase, signIn, signOut, getProfile, getSquadre, updateSquadra, getRosa, updateGiocatore, insertGiocatore, deleteGiocatore, subscribeRosa, getOfferte, insertOfferta, updateOffertaStato, deleteOfferta, getChiamate, insertChiamata, deleteChiamata, aggiungiInteresse, getChiamateByGiocatore, calcolaScadenzaInteresse, calcolaScadenzaOfferte, completaUnicoInteressato, creaAstaDaChiamate, getMovimenti, getMovimentiFPF, insertMovimento, deleteMovimento, subscribeOfferte, subscribeChiamate, subscribeSquadre, subscribeMovimenti, subscribeMovimentiAll, aggiornaSCNegativo, getContrattiInScadenza, getClubIdentity, updateClubIdentity, getAllClubIdentities, uploadImmagineSquadra, rimuoviImmagineSquadra, getObiettivi, updateObiettivo, insertObiettivo, deleteObiettivo, subscribeObiettivi, getTrattative, insertTrattativa, updateTrattativa, deleteTrattativa, subscribeTrattative, getAste, insertAsta, updateAsta, subscribeAste, eseguiTrasferimento, eseguiRescissioneAnticipataPrestito, checkEAggiornaPassaggi, resetPassaggiSessione, calcolaStatoNotificaOfferta, getOfferteInAttesa, getClausole, insertClausola, updateClausola, deleteClausola, subscribeClausole, getPrestitiAttivi, getClassifica, updateClassificaSquadra, upsertClassifica, subscribeClassifica, getSvincoli, getStagioneSvincoli, eseguiSvincolo, calcolaTassa, isTassaAttiva, getTassePagate, applicaTassaSettimana, getFasciaBilancioNeg, getPenalitaNeg, getSemestreCorrente, calcolaNettoSpeso, calcolaFairSpending, getFairSpending, getAllenatori, getAllenatoreBySquadra, getObiettiviCarta, getProgressoObiettivi, upsertProgresso, scegliAllenatore, getFpfTutteSquadre, getSCAllenatore, getInvestimenti, acquistaInvestimento, registraGuadagnoInvestimento, deleteInvestimento, getSponsor, insertSponsor, updateSponsor, getPenalita, insertPenalita, updatePenalita, deletePenalita, applicaMulta, countRecidive, getPremi, insertPremio, applicaPremio, calcolaPremio19a, calcolaPremiFinali, calcolaPremiCoppa, applicaIscrizioneCampionato, investiEuroExtra, ritiraBudgetExtra, resetBiennio, segnaQuotaPagata, applicaIscrizioneATutti, DEPOSITO_SCAGLIONI, isDepositoAperto, effettuaDeposito, rimborsoDeposito, logAzione, getAuditLog, effettuaRollback, getVivaio, acquistaVivaio, promuoviDaVivaio, svincolaVivaio, aggiornaPresenzeVivaio, pagaCostoVivaio, filtraVivaioCandidati, getSvincolatiDB, upsertSvincolato, updateSvincolatoStats, deleteSvincolato, importSvincolatiDaArray, filtraVivaioCandidatiDB, calcolaTop5Aggiornamenti, calcolaAnteprimaAggiornamentoQuote, applicaAggiornamentoQuote, applicaRinnovoRialzo, applicaRinnovoRibasso, isFinestraRibasso, getAggiornamenti, getFinestraChiamate, getAsteSvincolati, insertAstaSvincolati, updateAstaSvincolati, getOfferteAsta, upsertOffertaAsta, rivelaAsta, confermaTrasferimentoAsta, checkAsteScadute, checkScadenzeAste, subscribeAsteSvincolati, calcolaScadenzaAsta,
  // Nuove funzioni mercato
  getListone, getListoneBySquadra, importListoneDaExcel, aggiornaFantaSquadraListone, aggiornaStipendioDopoTrasferimento,
  getBonusTrattativa, insertBonusTrattativa, deleteBonusTrattativa, checkECompletaBonus, getLabelBonus,
  calcolaStatoTrattativaMercato, applicaPenalitaRitardoAuto,
  // Contratti
  aggiornaContrattiAnnuali, confermRinnovoBiennale,
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
  function SortTh({ col, label, align = "center", style: extraStyle = {} }) {
    const active = sortKey === col;
    const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
    return (
      <th
        onClick={() => handleSort(col)}
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
function TeamCard({ team, onClick }) {
  const [scLive, setScLive] = useState(team.salaryUsed || 0);

  useEffect(() => {
    getRosa(team.name).then(data => {
      if (data) setScLive(data.reduce((s, p) => s + Number(p.stip), 0));
    });
    const sub = subscribeRosa(team.name, () => {
      getRosa(team.name).then(data => { if (data) setScLive(data.reduce((s, p) => s + Number(p.stip), 0)); });
    });
    return () => supabase.removeChannel(sub);
  }, [team.name]);

  // FPF = netto speso semestre corrente (uscite − entrate, escl. stipendi), passato da mergedTeams
  const fpf = team.fpf ?? null;
  const fpfDisplay = fpf !== null ? `${fpf.toFixed(1)}M` : "—";
  const fpfColor = fpf === null ? "#555" : fpf > 40 ? "#ef4444" : fpf > 25 ? "#f59e0b" : fpf < 0 ? "#10b981" : "#888";
  const scColor = scLive > 75 ? "#ef4444" : scLive > 65 ? "#f59e0b" : "#10b981";
  const hasAlert = team.u21 < 2 || team.bilancio < 8 || scLive > 75 || (fpf !== null && fpf > 45);

  return (
    <div onClick={onClick} style={{ background: "#ffffff08", border: "1.5px solid #ffffff12", borderRadius: 16, padding: "16px 18px", cursor: "pointer", position: "relative", overflow: "hidden", transition: "all 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = team.color + "66"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#ffffff12"}>
      {hasAlert && <div style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 8px #ef4444", animation: "pulse 2s infinite" }} />}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <TeamAvatar team={team} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#f0f0f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.name}</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{team.allenatore}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
        {[
          { label: "BILANCIO",  value: `${team.bilancio.toFixed(1)}M`,  color: team.bilancio < 10 ? "#f97316" : "#f0f0f0" },
          { label: "SC USATO",  value: `${scLive.toFixed(1)}M`,         color: scColor },
          { label: "SC LIBERO", value: `+${(75 - scLive).toFixed(1)}M`, color: scColor },
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
          { label: "ROSA", value: String(team.giocatori), color: team.giocatori < 25 || team.giocatori > 30 ? "#ef4444" : "#f0f0f0" },
          { label: "U-21", value: String(team.u21),       color: team.u21 < 2 ? "#ef4444" : team.u21 < 3 ? "#f59e0b" : "#10b981" },
          { label: "FPF",  value: fpfDisplay, color: fpfColor },
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ffffff15" }}>
            <th style={{ padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "#555", whiteSpace: "nowrap" }}>#</th>
            <SortTh col="squadra"   label="Squadra"   align="left"   style={{ minWidth: 130 }} />
            <SortTh col="g"         label="G"         align="center" />
            <SortTh col="v"         label="V"         align="center" />
            <SortTh col="n"         label="N"         align="center" />
            <SortTh col="p"         label="P"         align="center" />
            <SortTh col="gf"        label="G+"        align="center" />
            <SortTh col="gs"        label="G−"        align="center" />
            <SortTh col="dr"        label="DR"        align="center" />
            <SortTh col="pt"        label="Pt"        align="center" />
            <SortTh col="pt_totali" label="Pt Totali" align="center" />
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
                <td style={{ padding: "9px 8px", textAlign: "center", fontWeight: 900, fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, color: rowColor || "#555", minWidth: 28 }}>{pos}</td>
                <td style={{ padding: "9px 8px", minWidth: 140 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {row.team && <TeamAvatar team={row.team} size={24} />}
                    <span style={{ fontSize: 12, fontWeight: isMe ? 800 : 600, color: isMe ? "#f0f0f0" : "#ccc", whiteSpace: "nowrap" }}>
                      {row.squadra}
                      {isMe && <span style={{ fontSize: 8, color: "#6366f1", marginLeft: 5, background: "#6366f120", border: "1px solid #6366f133", borderRadius: 3, padding: "1px 4px" }}>TU</span>}
                    </span>
                  </div>
                </td>
                {isEditing ? (
                  <>
                    {["g","v","n","p","gf","gs","pt","pt_totali"].map(f => (
                      <td key={f} style={{ padding: "4px" }}>
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
                    {[row.g, row.v, row.n, row.p, row.gf, row.gs].map((v, ci) => (
                      <td key={ci} style={{ padding: "9px 8px", textAlign: "center", color: "#aaa", fontSize: 12 }}>{v}</td>
                    ))}
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
  const [stadioPagato, setStadioPagato] = useState(false); // è il 1° del mese?
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
  const guadagnoStadio = stadioPagato ? 4 : 0;

  // Totale grezzo
  let totale = parseFloat((
    guadagnoGolSegnati + guadagnoGolSubiti + guadagnoRisultato + costoGiocatori + guadagnoStadio
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
              [stadioPagato, setStadioPagato, "🏟️ 1° del mese", "+4M stadio"],
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
            <VoceCalcolo label="Stadio (1° del mese)" valore={guadagnoStadio} />
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
    if (mySquadra) getRosa(mySquadra).then(d => setMyRosa(d || []));
  }, [mySquadra]);

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

  // Mini-rosa summary: conta per ruolo
  const ruoliCount = { Por: 0, Dif: 0, Cen: 0, Att: 0 };
  myRosa.forEach(p => {
    if (p.ruolo === 'Por') ruoliCount.Por++;
    else if (['Dc','Dd','Ds','B'].some(r => p.ruolo.includes(r))) ruoliCount.Dif++;
    else if (['E','M','C'].some(r => p.ruolo.includes(r))) ruoliCount.Cen++;
    else ruoliCount.Att++;
  });
  const scUsato = myRosa.reduce((s, p) => s + Number(p.stip || 0), 0);
  // FPF = netto speso semestre corrente, calcolato centralmente e passato via myTeam.fpf
  const fpf = myTeam?.fpf ?? null;
  const fpfDisplay = fpf !== null ? `${fpf.toFixed(1)}M` : "—";
  const fpfColor = fpf === null ? "#555" : fpf > 40 ? "#ef4444" : fpf > 25 ? "#f59e0b" : fpf < 0 ? "#10b981" : "#888";

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
              <div style={{ fontSize: 12, color: "#888" }}>{myTeam.allenatore}</div>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {[
              { label: "ROSA",    value: myRosa.length, color: myRosa.length < 25 || myRosa.length > 30 ? "#ef4444" : "#10b981" },
              { label: "POR",     value: ruoliCount.Por, color: "#6366f1" },
              { label: "DIFESA",  value: ruoliCount.Dif, color: "#3b82f6" },
              { label: "CENTRO",  value: ruoliCount.Cen, color: "#f59e0b" },
              { label: "ATTACCO", value: ruoliCount.Att, color: "#ef4444" },
              { label: "U-21",    value: myRosa.filter(p => p.anni > 0 && p.anni <= 21).length, color: "#a78bfa" },
              { label: "31+",     value: myRosa.filter(p => p.anni >= 31).length, color: "#fb923c" },
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

      {/* ── 2. CLASSIFICA FANTACALCIO ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 18, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em" }}>🏆 CLASSIFICA FANTACALCIO</div>
            {classifica[0]?.updated_at && (
              <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>
                Aggiornata: {new Date(classifica[0].updated_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
              </div>
            )}
          </div>
          {isAdmin && (
            <button onClick={() => { setEditMode(v => !v); setEditRow(null); }} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: editMode ? "#ef444420" : "#6366f120", color: editMode ? "#ef4444" : "#818cf8", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {editMode ? "✕ Chiudi" : "✏️ Modifica"}
            </button>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          <ClassificaTable classificaRicca={classificaRicca} mySquadra={mySquadra} editMode={editMode} editRow={editRow} setEditRow={setEditRow} salvaRiga={salvaRiga} saving={saving} inp={{ padding: "4px 6px", borderRadius: 5, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, width: "100%" }} />
        </div>
      </div>

      {/* ── 3. CALCOLATORE GIORNATA ── */}
      <CalcolatoreGiornata profile={profile} teams={teams} />

      {/* ── 4. TUTTE LE SQUADRE (esclusa la propria, già in cima) ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 14 }}>🏟️ TUTTE LE SQUADRE</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
          {teams
            .filter(t => t.name !== mySquadra)
            .map(team => (
              <TeamCard key={team.id} team={team} onClick={() => onSelectTeam(team)} />
            ))}
        </div>
      </div>

    </div>
  );
}

/* ─── LEGA PAGE ─────────────────────────────────────────────────────────────── */
function LegaPage({ teams = TEAMS }) {
  const sorted = [...teams].sort((a, b) => b.guadGiornate - a.guadGiornate);
  const maxGuad = Math.max(...teams.map(t => t.guadGiornate));
  const alerts = teams.filter(t => t.u21 < 2 || t.bilancio < 8 || (t.fpf !== null && t.fpf > 40));

  // Carica rose di tutte le squadre per compliance
  const [roseMap, setRoseMap] = useState({});
  useEffect(() => {
    async function loadAll() {
      const result = {};
      await Promise.all(teams.map(async t => {
        const data = await getRosa(t.name);
        if (data) result[t.name] = data;
      }));
      setRoseMap(result);
    }
    loadAll();
  }, [teams]);

  const complianceMap = {};
  Object.entries(roseMap).forEach(([name, players]) => {
    complianceMap[name] = checkRosaCompliance(players);
  });
  const roseIrregolari = Object.entries(complianceMap).filter(([, c]) => !c.regolare);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>LEGA</h1>
        <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Panoramica generale della lega</p>
      </div>

      {/* ── RIGA 1: Classifica + Alert Lega ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}
           className="lega-grid">
        <style>{`@media(max-width:700px){.lega-grid{grid-template-columns:1fr!important}}`}</style>

        {/* Classifica guadagni */}
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 14 }}>🏆 CLASSIFICA GUADAGNI GIORNATE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sorted.map((team, i) => (
              <div key={team.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 22, fontSize: 13, fontWeight: 800, color: i < 3 ? team.color : "#555", textAlign: "right", fontFamily: "'Bebas Neue',sans-serif" }}>{i + 1}</div>
                <TeamAvatar team={team} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#ccc", fontWeight: 600, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.name}</div>
                  <StatBar value={team.guadGiornate} max={maxGuad} color={team.color} height={5} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: team.color, fontFamily: "'Bebas Neue',sans-serif", minWidth: 48, textAlign: "right" }}>{team.guadGiornate}M</div>
              </div>
            ))}
          </div>
        </div>

        {/* Alert lega */}
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 14 }}>⚠️ ALERT LEGA</div>
          {alerts.length === 0
            ? <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Nessun alert attivo</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alerts.map(team => (
                  <div key={team.id} style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <TeamAvatar team={team} size={24} />
                      <span style={{ fontSize: 13, color: "#f0f0f0", fontWeight: 700 }}>{team.name}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {team.u21 < 2 && <Badge color="#ef4444">⚠ Solo {team.u21} U21</Badge>}
                      {team.bilancio < 8 && <Badge color="#f97316">⚠ Bilancio basso</Badge>}
                      {team.u21 < 2 && <Badge color="#f59e0b">⚠ Under-21</Badge>}
                      {team.fpf !== null && team.fpf > 40 && <Badge color="#ef4444">⚠ FP alto</Badge>}
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {/* ── RIGA 2: Stato Rose + Rose Non Regolari ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}
           className="lega-grid">

        {/* Stato rose */}
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 14 }}>🌿 STATO ROSE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {teams.map(team => {
              const comp = complianceMap[team.name];
              if (!comp) return (
                <div key={team.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #ffffff08" }}>
                  <TeamAvatar team={team} size={22} />
                  <span style={{ fontSize: 12, color: "#555", flex: 1 }}>{team.name}</span>
                  <span style={{ fontSize: 10, color: "#333" }}>...</span>
                </div>
              );
              return (
                <div key={team.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #ffffff08" }}>
                  <TeamAvatar team={team} size={22} />
                  <span style={{ fontSize: 12, color: "#ccc", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.name}</span>
                  <span style={{ fontSize: 10, color: "#555", whiteSpace: "nowrap" }}>🧤{comp.portieri} ⚽{comp.movimento} 🔮{comp.u21}</span>
                  <span style={{ fontSize: 10, color: "#555", minWidth: 36, textAlign: "right" }}>{comp.totale}/30</span>
                  <span style={{ fontSize: 13, minWidth: 18, textAlign: "center" }}>{comp.regolare ? "✅" : "❌"}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rose non regolari */}
        <div style={{ background: roseIrregolari.length > 0 ? "#ef444408" : "#ffffff06", border: `1.5px solid ${roseIrregolari.length > 0 ? "#ef444430" : "#ffffff12"}`, borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: roseIrregolari.length > 0 ? "#ef4444" : "#888", letterSpacing: "0.1em", marginBottom: 14 }}>❌ ROSE NON REGOLARI</div>
          {roseIrregolari.length === 0
            ? <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Tutte le rose sono regolari ✅</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {roseIrregolari.map(([name, comp]) => {
                  const team = teams.find(t => t.name === name);
                  return (
                    <div key={name} style={{ background: "#ef444410", border: "1px solid #ef444428", borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        {team && <TeamAvatar team={team} size={22} />}
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f0f0" }}>{name}</span>
                        <span style={{ fontSize: 10, color: "#888", marginLeft: "auto" }}>{comp.totale} gioc.</span>
                      </div>
                      {comp.issues.filter(i => i.tipo === "error").map((issue, idx) => (
                        <div key={idx} style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>⛔ {issue.testo}</div>
                      ))}
                      {comp.issues.filter(i => i.tipo === "warn").map((issue, idx) => (
                        <div key={idx} style={{ fontSize: 11, color: "#f59e0b", marginTop: 3 }}>⚠️ {issue.testo}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>


      {/* ── PREMI INDIVIDUALI (art. 12.4-12.5) ── */}
      <div style={{ background:"#ffffff06",border:"1.5px solid #ffffff12",borderRadius:16,padding:18 }}>
        <div style={{ fontSize:11,fontWeight:700,color:"#888",letterSpacing:"0.1em",marginBottom:14 }}>🏅 PREMI INDIVIDUALI · Fine stagione (art. 12.4-12.5)</div>
        <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
          {[
            { label:"🥇 Primo in gol schierati",         colore:"#10b981", val:"+1M" },
            { label:"🛡 Primo in gol subiti schierati",  colore:"#f59e0b", val:"+2M" },
            { label:"🧤 Più porte inviolate schierate",  colore:"#10b981", val:"+1M" },
            { label:"⚽ Miglior marcatore in rosa",      colore:"#10b981", val:"+1M" },
            { label:"🎯 Miglior assist man in rosa",     colore:"#10b981", val:"+1M" },
            { label:"🟨 Più ammonizioni in campo",       colore:"#ef4444", val:"−1M" },
            { label:"🟥 Più espulsioni in campo",        colore:"#ef4444", val:"−1M" },
          ].map((r,i) => (
            <div key={i} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",borderRadius:8,background:"#ffffff05" }}>
              <span style={{ fontSize:12,color:"#aaa" }}>{r.label}</span>
              <span style={{ fontSize:13,fontWeight:900,color:r.colore,fontFamily:"'Bebas Neue',sans-serif" }}>{r.val}</span>
            </div>
          ))}
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

  // Deadline entro 100 giorni (per timeline)
  const entro100 = resolvedDeadlines.filter(d => d.days <= 100 && d.days >= 0);
  // Deadline scadute di recente (ultimi 30 giorni)
  const recenti = DEADLINE_DEFS.map(def => {
    const r = resolveDeadline(def);
    if (!r) return null;
    // Calcola la scadenza PRECEDENTE (quella già passata)
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
    if (daysAgo < 0 || daysAgo > 30) return null;
    const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return { ...def, dateObj: prev, dateStr: `${String(def.type==='monthly'?def.day:def.day).padStart(2,'0')} ${def.type==='monthly'?mesi[now.getMonth()-1]||mesi[11]:mesi[def.month-1]}`, daysAgo };
  }).filter(Boolean).sort((a, b) => a.daysAgo - b.daysAgo);

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
      <style>{`@media(max-width:700px){.deadline-cols{flex-direction:column!important}}`}</style>
      <div className="deadline-cols" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

        {/* COLONNA SINISTRA — Scadute recentemente */}
        <div style={{ flex: "0 0 280px", minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.1em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#555", display: "inline-block" }} />
            RECENTI (ultimi 30gg)
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
        <div style={{ width: 1, background: "#ffffff10", alignSelf: "stretch", minHeight: 200 }} />

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

          {/* Altre deadline oltre 100gg */}
          {resolvedDeadlines.filter(d => d.days > 100).length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#333", fontStyle: "italic" }}>
              + {resolvedDeadlines.filter(d => d.days > 100).length} scadenze oltre 100 giorni
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
function RosaTable({ teamName, isAdmin, mySquadra }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadRosa = useCallback(async () => {
    const data = await getRosa(teamName);
    // Escludi giocatori in vivaio — appaiono solo nella tab Vivaio
    if (data) setPlayers(data.filter(p => !p.in_vivaio));
    setLoading(false);
  }, [teamName]);

  useEffect(() => {
    loadRosa();
    const sub = subscribeRosa(teamName, loadRosa);
    return () => supabase.removeChannel(sub);
  }, [loadRosa, teamName]);

  // Arricchisce i player con un campo numerico per ruolo (per ordinamento)
  const roleOrder = ["Por", "Dc", "Dd", "Ds", "B", "E", "M", "C", "T", "W", "A", "Pc"];
  const playersRich = players.map(p => ({
    ...p,
    _ruoloOrd: (() => { const i = roleOrder.indexOf(p.ruolo.split(";")[0]); return i < 0 ? 99 : i; })(),
    _stipNum: Number(p.stip || 0),
    _quotNum: Number(p.quot || 0),
    _anniNum: Number(p.anni || 0),
    _mvNum: Number(p.media_voto || 0),
    _mfvNum: Number(p.media_fantavoto || 0),
    _golNum: Number(p.gol || 0),
    _assNum: Number(p.assist || 0),
    _acNum: Number(p.anni_contratto || 0),
  }));

  const { sorted, SortTh } = useSortableTable(playersRich, "_ruoloOrd", "asc");
  const comp = checkRosaCompliance(players);

  if (loading) return <div style={{ fontSize: 12, color: "#555", padding: 12 }}>Caricamento rosa...</div>;

  return (
    <div>
      {/* ── Indicatore compliance ── */}
      <div style={{ marginBottom: 14, background: comp.regolare ? "#10b98112" : "#ef444412", border: `1.5px solid ${comp.regolare ? "#10b98133" : "#ef444433"}`, borderRadius: 12, padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: comp.issues.length > 0 ? 10 : 0 }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: comp.regolare ? "#10b981" : "#ef4444", letterSpacing: "0.06em" }}>
            {comp.regolare ? "✅ ROSA REGOLARE" : "❌ ROSA NON REGOLARE"}
          </span>
          <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#888" }}>
            <span>🧤 {comp.portieri} Por</span>
            <span>⚽ {comp.movimento} Mov</span>
            <span style={{ color: comp.u21 >= 3 || comp.totale <= 27 ? "#a78bfa" : "#ef4444" }}>🔮 {comp.u21} U21</span>
            <span style={{ fontWeight: 700, color: comp.totale > 30 ? "#ef4444" : "#ccc" }}>Tot: {comp.totale}</span>
          </div>
        </div>
        {comp.issues.map((issue, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11, color: issue.tipo === "error" ? "#ef4444" : "#f59e0b" }}>
            <span>{issue.tipo === "error" ? "⛔" : "⚠️"}</span>
            <span>{issue.testo}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#aaa" }}>{players.length} giocatori</span>
        <span style={{ fontSize: 10, color: "#444", fontStyle: "italic" }}>Clicca intestazione per ordinare</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <SortTh col="_ruoloOrd" label="Ruolo"   align="center" />
              <SortTh col="_anniNum"  label="Età"     align="center" />
              <SortTh col="nome"      label="Nome"    align="left"   />
              <SortTh col="squadra_serie_a" label="Sq. SA" align="left" />
              <SortTh col="_quotNum"  label="Q"       align="center" />
              <SortTh col="_stipNum"  label="Stip."   align="center" />
              <SortTh col="_acNum"    label="Anno C." align="center" />
              <SortTh col="clausola"  label="Claus."  align="center" />
              <SortTh col="_mvNum"    label="MV"      align="center" />
              <SortTh col="_mfvNum"   label="MFV"     align="center" />
              <SortTh col="_golNum"   label="Gol"     align="center" />
              <SortTh col="_assNum"   label="Ass"     align="center" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const rc = getRoleColor(p.ruolo);
              const fuori = p.fuori_lista;
              return (
                <tr key={p.id} onMouseEnter={e => e.currentTarget.style.background = fuori ? "#ef444415" : "#ffffff08"} onMouseLeave={e => e.currentTarget.style.background = fuori ? "#ef444408" : "transparent"} style={{ borderBottom: "1px solid #ffffff06", background: fuori ? "#ef444408" : "transparent" }}>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>
                    <span style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`, borderRadius: 5, padding: "2px 5px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{p.ruolo}</span>
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "center", color: p.anni <= 21 ? "#a78bfa" : p.anni >= 31 ? "#f97316" : "#888" }}>{p.anni || "—"}</td>
                  <td style={{ padding: "7px 8px", color: fuori ? "#ef4444" : "#e0e0e0", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {p.nome}
                    {fuori && <span style={{ marginLeft: 5, fontSize: 9, background: "#ef444422", color: "#ef4444", border: "1px solid #ef444455", borderRadius: 4, padding: "1px 5px", fontWeight: 700, animation: "pulse 1.2s infinite" }}>FUORI</span>}
                    {!fuori && p.anni > 0 && p.anni <= 21 && <span style={{ marginLeft: 5, fontSize: 9, background: "#8b5cf622", color: "#a78bfa", border: "1px solid #8b5cf644", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>U21</span>}
                    {!fuori && p.anni >= 31 && <span style={{ marginLeft: 5, fontSize: 9, background: "#f9731622", color: "#fb923c", border: "1px solid #f9731644", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>31+</span>}
                  </td>
                  <td style={{ padding: "7px 8px", color: "#666", fontSize: 11 }}>{p.squadra_serie_a || "—"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center", fontWeight: 800, color: p.quot >= 20 ? "#f59e0b" : "#ccc", fontFamily: "'Bebas Neue',sans-serif", fontSize: 14 }}>{p.quot}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center", color: "#aaa" }}>{Number(p.stip).toFixed(1)}M</td>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>
                    {(() => {
                      const ac = p.anni_contratto || 0;
                      const isU21 = p.anni > 0 && p.anni <= 21;
                      const color = ac === 0 ? "#555" : ac >= 4 ? "#10b981" : ac >= 3 ? "#f59e0b" : "#818cf8";
                      const label = ac === 0 ? "—" : `A${ac}`;
                      const title = isU21 ? "U21: nessun aumento" : ac >= 4 ? "Bonus fedeltà -10%" : ac === 3 ? "Rinnovo +20%" : ac >= 2 ? "+10%" : "Primo anno";
                      return <span title={title} style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 5, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{label}</span>;
                    })()}
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "center", color: "#666" }}>{p.clausola}M</td>
                  <td style={{ padding: "7px 8px", textAlign: "center", color: p.media_voto >= 6.5 ? "#10b981" : p.media_voto >= 6 ? "#f59e0b" : "#888" }}>{p.media_voto > 0 ? Number(p.media_voto).toFixed(2) : "—"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center", color: p.media_fantavoto >= 7 ? "#10b981" : p.media_fantavoto >= 6 ? "#f59e0b" : "#888" }}>{p.media_fantavoto > 0 ? Number(p.media_fantavoto).toFixed(2) : "—"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center", color: p.gol > 0 ? "#10b981" : "#555" }}>{p.gol > 0 ? p.gol : "—"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center", color: p.assist > 0 ? "#60a5fa" : "#555" }}>{p.assist > 0 ? p.assist : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {players.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #ffffff10", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#888" }}>Stipendi: <b style={{ color: "#ccc" }}>{players.reduce((s, p) => s + Number(p.stip), 0).toFixed(1)}M</b></span>
          <span style={{ fontSize: 11, color: "#888" }}>Quot. media: <b style={{ color: "#ccc" }}>{(players.reduce((s, p) => s + Number(p.quot), 0) / players.length).toFixed(1)}</b></span>
          <span style={{ fontSize: 11, color: "#888" }}>Top: <b style={{ color: "#f59e0b" }}>{[...players].sort((a, b) => b.quot - a.quot)[0]?.nome}</b></span>
        </div>
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
    const stip = Number(player.stip || 0);
    const oggi = new Date();
    const isU21 = player.anni > 0 && player.anni <= 21;

    if (tipo === 'ordinario') {
      const penale = quot <= 10 ? 0.5 : quot <= 20 ? 1 : quot <= 30 ? 1.5 : 2;
      const dataFine = new Date(oggi.getFullYear(), 5, 1);
      if (dataFine < oggi) dataFine.setFullYear(oggi.getFullYear() + 1);
      const mesi = Math.ceil((dataFine - oggi) / (30.44 * 86400000));
      const costoStip = parseFloat((mesi * stip / 12).toFixed(2));
      return {
        label: "Costo totale",
        value: parseFloat((penale + costoStip).toFixed(2)),
        color: "#ef4444",
        dettaglio: `Penale ${penale}M + ${mesi} mensilità (${costoStip}M)`,
        positivo: false,
      };
    }
    if (tipo === 'straordinario_u21_nc') {
      return { label: "Costo/Guadagno", value: 0, color: "#888", dettaglio: "Svincolo U21 non conteggiato — costo e guadagno 0", positivo: true };
    }
    // Straordinario
    const ind = estero ? parseFloat((quot / 2).toFixed(2)) : parseFloat((quot / 4).toFixed(2));
    const agostoPagato = new Date(oggi.getMonth() >= 8 ? oggi.getFullYear() : oggi.getFullYear() - 1, 7, 1);
    const mesiRimb = Math.max(0, Math.floor((oggi - agostoPagato) / (30.44 * 86400000)));
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
      // Impossibile giu-lug (art. 6.1)
      if (oggi.getMonth() === 5 || oggi.getMonth() === 6)
        warnings.push({ tipo: 'error', testo: 'Svincoli straordinari non consentiti a giugno/luglio' });
    }

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
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
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
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
  const [loading, setLoading] = useState(true);
  const [rescindendo, setRescindendo] = useState(null); // id giocatore in rescissione

  const loadAll = useCallback(async () => {
    const [c, r, p] = await Promise.all([
      getClausole(team.name),
      getRosa(team.name),
      getPrestitiAttivi(team.name),
    ]);
    setClausole(c);
    setRosaPlayers(r);
    setPrestitiAttivi(p);
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

function ContrattoRinnovoRow({ p, team, isAdmin, mySquadra, onRefresh }) {
  const [confermando, setConfermando] = useState(false);
  const isU21 = p.anni > 0 && p.anni <= 21;
  // Sempre anno 2 → rinnovo biennale: +20% (U21: nessun aumento, art. 4.8.1)
  const percAumento = isU21 ? 0 : 20;
  const nuovoStip = parseFloat((Number(p.stip) * (1 + percAumento / 100)).toFixed(2));

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
            ? <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓ Rinnovato</span>
            : <button
                disabled={confermando}
                onClick={async () => {
                  setConfermando(true);
                  try {
                    await supabase.from('rosa').update({ rinnovo_confermato: true }).eq('id', p.id);
                    await onRefresh();
                  } catch(e) { alert(e.message); }
                  finally { setConfermando(false); }
                }}
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
  const coloreFPF        = nettoSpeso > 50 ? "#ef4444" : nettoSpeso < 0 ? "#10b981" : "#f0f0f0";

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
            <StatBar value={Math.min(Math.max(nettoSpeso, 0), 80)} max={80} color={nettoSpeso > 65 ? "#ef4444" : nettoSpeso > 50 ? "#f59e0b" : "#10b981"} height={10} />
            <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>Esclusi: pagamenti stipendi mensili · guadagni giornata</div>
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
              { soglia: "≤ 50M",  zona: "sicura", multa: "—",   pt: "—", euro: "—"   },
              { soglia: "50–55M", zona: "50-55",  multa: "5M",  pt: "—", euro: "—"   },
              { soglia: "55–60M", zona: "55-60",  multa: "10M", pt: "—", euro: "—"   },
              { soglia: "60–65M", zona: "60-65",  multa: "15M", pt: "2", euro: "—"   },
              { soglia: "65–70M", zona: "65-70",  multa: "20M", pt: "4", euro: "5€"  },
              { soglia: ">70M",   zona: ">70",    multa: "25M", pt: "6", euro: "10€" },
            ].map(r => {
              const active = fairResult?.zona === r.zona;
              return (
                <div key={r.zona} style={{ display: "flex", gap: 6, padding: "4px 8px", borderRadius: 7, background: active ? "#ef444418" : "#ffffff05", border: `1px solid ${active ? "#ef444430" : "#ffffff08"}`, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: active ? "#f0f0f0" : "#555", minWidth: 52 }}>{r.soglia}</span>
                  <span style={{ flex: 1, fontSize: 10, color: active ? "#ef4444" : "#444" }}>{active && "▶ "}Multa {r.multa} · −{r.pt}pt {r.euro !== "—" ? `· ${r.euro}` : ""}</span>
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
              <div style={{ fontSize: 10, fontWeight: 700, color: "#555", marginBottom: 8 }}>MOVIMENTI {inizioStr} → {fineStr}</div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead style={{ position: "sticky", top: 0, background: "#0d0f14" }}>
                    <tr style={{ borderBottom: "1px solid #ffffff12" }}>
                      {["Data","Descrizione","Entrata","Uscita","FPF"].map(h => (
                        <th key={h} style={{ padding: "4px 6px", textAlign: h==="Descrizione"?"left":"center", color: "#555", fontWeight: 700, fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movimenti.map((m, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #ffffff06", opacity: m.escluso ? 0.3 : 1 }}>
                        <td style={{ padding: "4px 6px", color: "#666", whiteSpace: "nowrap" }}>{m.data}</td>
                        <td style={{ padding: "4px 6px", color: m.escluso ? "#444" : "#ccc", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.descrizione}>{m.descrizione}</td>
                        <td style={{ padding: "4px 6px", textAlign: "center", color: "#10b981" }}>{m.entrata ? `+${Number(m.entrata).toFixed(2)}` : "—"}</td>
                        <td style={{ padding: "4px 6px", textAlign: "center", color: "#f97316" }}>{m.uscita  ? `−${Number(m.uscita).toFixed(2)}`  : "—"}</td>
                        <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700,
                          color: m.escluso ? "#333" : m.contributo > 0 ? "#f97316" : m.contributo < 0 ? "#10b981" : "#555" }}>
                          {m.escluso ? <span style={{ fontSize: 8, color: "#444" }}>excl.</span> : `${m.contributo > 0 ? "+" : ""}${m.contributo.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #ffffff20" }}>
                      <td colSpan={4} style={{ padding: "5px 6px", fontSize: 10, color: "#888", fontWeight: 700 }}>TOTALE</td>
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


function FinanzeTab({ team, salaryCapUsato, salaryCapRosa = 0, scAllenatore = 0, salaryCapSforato, scEsenteGiuLug, giorniSCNeg, contrattiScadenza, rosaPlayers, pagandoStipendi, handlePagaStipendi, isAdmin, mySquadra, onRefresh }) {
  const [tasse, setTasse] = useState([]);
  const [fairSpending, setFairSpending] = useState([]);
  const [applicandoTassa, setApplicandoTassa] = useState(false);
  const [euroInput, setEuroInput] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);

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
  const BIENNIO = '2025-27';
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
    if (euro > maxEuroInvestibili) { alert(`Puoi investire al massimo ${maxEuroInvestibili}€ nel biennio ${BIENNIO}`); return; }
    if (!window.confirm(`Investire ${euro}€ extra per +${(euro*2.5).toFixed(1)}M al bilancio?\n\nAttenzione: gli €${euro} saranno conteggiati sul biennio ${BIENNIO} e non recuperabili senza pagare il doppio.`)) return;
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
    if (!window.confirm(`Applicare tassa del ${tassa.perc}% (−${tassa.importo}M) al bilancio di ${team.name}?`)) return;
    setApplicandoTassa(true);
    try {
      await applicaTassaSettimana(team.name, bilancio);
      await logAzione({ utente: 'admin', squadra: team.name, azione: 'tassa_settimanale', entita: 'squadre', descrizione: `Tassa settimanale ${tassa.perc}% −${tassa.importo}M (bilancio era ${bilancio.toFixed(2)}M)`, dataPrima: { bilancio }, dataDopo: { bilancio: bilancio - tassa.importo }, rollbackPossibile: true });
      getTassePagate(team.name).then(setTasse);
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
        {!tasseAttive ? (
          <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Sospesa: periodo giugno/luglio (01/06–31/07)</div>
        ) : bilancio <= 0 ? (
          <div style={{ fontSize: 12, color: "#555" }}>Bilancio negativo — nessuna tassa applicabile</div>
        ) : (
          <>
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
            <div style={{ background: "#f59e0b10", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#888" }}>Tassa prossimo lunedì</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>−{tassa.importo}M <span style={{ fontSize: 12 }}>({tassa.perc}%)</span></span>
            </div>
            {isAdmin && (
              <button onClick={handleApplicaTassa} disabled={applicandoTassa}
                style={{ width: "100%", padding: "9px", borderRadius: 9, border: "1px solid #f59e0b33", background: "#f59e0b18", color: "#f59e0b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {applicandoTassa ? "Applicazione..." : `📊 Applica tassa settimana (−${tassa.importo}M)`}
              </button>
            )}
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
        <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: "0.08em", marginBottom: 14 }}>💶 QUOTE & BUDGET BIENNIO {BIENNIO}</div>

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
            <span style={{ fontSize: 12, color: "#888" }}>Euro investiti nel biennio {BIENNIO}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#818cf8" }}>{team.euroBiennio || 0}€ / 10€</span>
          </div>
          <StatBar value={team.euroBiennio || 0} max={10} color="#6366f1" height={8} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#555" }}>Questa stagione: {team.euroInvestiti || 0}€ → +{((team.euroInvestiti||0)*2.5).toFixed(1)}M</span>
            <span style={{ fontSize: 10, color: euroDisponibili > 0 ? "#818cf8" : "#555" }}>Residuo: {euroDisponibili}€</span>
          </div>
          <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>Reset biennio all'inizio della stagione 2027-28</div>
        </div>

        {/* Milioni extra attivi + ritiro */}
        {mlnOttenuti > 0 && (
          <div style={{ background: "#10b98110", border: "1px solid #10b98125", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#888" }}>Milioni extra attivi</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: "#10b981", fontFamily: "'Bebas Neue',sans-serif" }}>+{mlnOttenuti.toFixed(1)}M</span>
            </div>
            <div style={{ fontSize: 10, color: "#666" }}>
              Ritiro: spendi <b style={{ color: "#f59e0b" }}>{costoRitiro}M</b> (2×) tra 05/01 e martedì post 19ª giornata.
              Gli {team.euroInvestiti || 0}€ restano spesi nel biennio.
            </div>
            {finestraRitiroAperta ? (
              <button onClick={handleRitira} disabled={savingQuote || bilancio < costoRitiro}
                style={{ marginTop: 8, padding: "5px 12px", borderRadius: 7, border: "none", background: bilancio >= costoRitiro ? "#f59e0b18" : "#333", color: bilancio >= costoRitiro ? "#f59e0b" : "#555", fontSize: 11, fontWeight: 700, cursor: bilancio >= costoRitiro ? "pointer" : "not-allowed" }}>
                {savingQuote ? "..." : `💸 Ritira (costa ${costoRitiro}M, ricevi ${mlnOttenuti}M)`}
              </button>
            ) : (
              <div style={{ fontSize: 9, color: "#555", marginTop: 4 }}>Finestra chiusa — disponibile 05/01 → martedì post 19ª giornata</div>
            )}
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
          <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em", marginBottom: 4 }}>📋 RINNOVO BIENNALE — CONFERMA ENTRO 31/05</div>
          <div style={{ fontSize: 10, color: "#666", marginBottom: 12 }}>
            Questi giocatori sono al <b style={{ color: "#aaa" }}>2° anno di contratto</b>. Devi decidere entro il 31/05 (art. 4.8):<br/>
            • <b style={{ color: "#10b981" }}>Conferma rinnovo</b> → il giocatore resta in rosa, stipendio +20%<br/>
            • <b style={{ color: "#ef4444" }}>Non confermare</b> → il giocatore viene svincolato automaticamente il 01/06
          </div>
          {contrattiScadenza.map(p => (
            <ContrattoRinnovoRow key={p.id} p={p} team={team} isAdmin={isAdmin} mySquadra={mySquadra} onRefresh={onRefresh} />
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

/* ─── ALLENATORE TAB ─────────────────────────────────────────────────────────── */
function AllenatoreTab({ team, isAdmin }) {
  const [allenatore, setAllenatore] = useState(null);  // carta scelta
  const [obiettivi, setObiettivi] = useState([]);
  const [progresso, setProgresso] = useState([]);
  const [tuttiAllenatori, setTuttiAllenatori] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");

  const STAGIONE_PROSSIMA = '2026-27';

  const loadAll = useCallback(async () => {
    const [all, tutti] = await Promise.all([
      getAllenatoreBySquadra(team.name, STAGIONE_PROSSIMA),
      getAllenatori(STAGIONE_PROSSIMA),
    ]);
    setAllenatore(all);
    setTuttiAllenatori(tutti);
    if (all) {
      const [obs, prog] = await Promise.all([
        getObiettiviCarta(all.nome, STAGIONE_PROSSIMA),
        getProgressoObiettivi(team.name, STAGIONE_PROSSIMA),
      ]);
      setObiettivi(obs);
      setProgresso(prog);
    }
    setLoading(false);
  }, [team.name]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleScegli(nomeAllenatore) {
    if (!window.confirm(`Scegli ${nomeAllenatore} come allenatore? Costo: 5M\n\nQuesta scelta è permanente per la stagione 2026-27.`)) return;
    setSaving(true);
    try {
      const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', team.name).single();
      await scegliAllenatore(team.name, nomeAllenatore, sq?.bilancio || 0);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleToggleCompletato(ob, prog) {
    setSaving(true);
    try {
      await upsertProgresso(team.name, ob.id, { completato: !prog?.completato, fallito: false }, STAGIONE_PROSSIMA);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleToggleFallito(ob, prog) {
    setSaving(true);
    try {
      await upsertProgresso(team.name, ob.id, { fallito: !prog?.fallito, completato: false }, STAGIONE_PROSSIMA);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function salvaProgresso(obId) {
    await upsertProgresso(team.name, obId, { valore_attuale: parseFloat(editVal) || 0 }, STAGIONE_PROSSIMA);
    setEditId(null);
    await loadAll();
  }

  const tipoInfo = {
    allenatore: { label: "🎯 Obiettivi Allenatore", color: "#6366f1", guadagno: 2, desc: "2M a completamento · solo con moduli allenatore" },
    ds:         { label: "🏃 Direttore Sportivo",   color: "#10b981", guadagno: 5, desc: "5M a completamento · −2M se fallito" },
    dg:         { label: "💼 Direttore Generale",   color: "#f59e0b", guadagno: 5, desc: "5M al 31/05 · −2M se fallito" },
  };

  // Calcola guadagno potenziale totale
  const guadagnoTot = obiettivi.reduce((s, o) => s + (o.guadagno || 0), 0);
  const guadagnoRealizzato = obiettivi.reduce((s, o) => {
    const p = progresso.find(pr => pr.obiettivo_id === o.id);
    return s + (p?.completato ? (o.guadagno || 0) : p?.fallito ? -(o.penalita || 0) : 0);
  }, 0);

  if (loading) return <div style={{ fontSize: 12, color: "#555", padding: 20 }}>Caricamento...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── BANNER: prossima stagione ── */}
      <div style={{ background: "#6366f110", border: "1.5px solid #6366f130", borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "#818cf8" }}>
        📅 Gli obiettivi allenatore sono attivi dalla <b>stagione 2026-27</b>. La scelta delle carte avviene in agosto secondo la classifica finale inversa.
      </div>

      {/* ── SE HA GIÀ UNA CARTA ── */}
      {allenatore ? (
        <>
          {/* Header carta */}
          <div style={{ background: `linear-gradient(135deg, #6366f118, #a855f718)`, border: "1.5px solid #6366f133", borderRadius: 16, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", letterSpacing: "0.1em", marginBottom: 4 }}>🎩 ALLENATORE — {STAGIONE_PROSSIMA}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>{allenatore.nome}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  Moduli: <span style={{ color: "#818cf8", fontWeight: 700 }}>{allenatore.modulo1}</span> · <span style={{ color: "#818cf8", fontWeight: 700 }}>{allenatore.modulo2}</span>
                  <span style={{ color: "#555", marginLeft: 8 }}>— min {allenatore.partite_modulo_min} partite totali con questi moduli</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, color: "#555" }}>STIPENDIO STAFF (SC)</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#f97316", fontFamily: "'Bebas Neue',sans-serif" }}>−5M</div>
                <div style={{ fontSize: 9, color: "#555", marginTop: 4 }}>POTENZIALE</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#10b981", fontFamily: "'Bebas Neue',sans-serif" }}>+{guadagnoTot}M</div>
              </div>
            </div>
            {/* Barra progresso guadagno */}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#555" }}>Realizzato</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: guadagnoRealizzato >= 0 ? "#10b981" : "#ef4444" }}>
                  {guadagnoRealizzato >= 0 ? "+" : ""}{guadagnoRealizzato}M / +{guadagnoTot}M
                </span>
              </div>
              <StatBar value={Math.max(0, guadagnoRealizzato)} max={guadagnoTot} color="#10b981" height={6} />
            </div>
          </div>

          {/* Obiettivi per tipo */}
          {["allenatore", "ds", "dg"].map(tipo => {
            const items = obiettivi.filter(o => o.tipo === tipo);
            const info = tipoInfo[tipo];
            return (
              <div key={tipo} style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: info.color, letterSpacing: "0.08em" }}>{info.label}</div>
                    <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>{info.desc}</div>
                  </div>
                  <Badge color={info.color}>+{info.guadagno}M cad.</Badge>
                </div>
                {items.map(ob => {
                  const prog = progresso.find(p => p.obiettivo_id === ob.id);
                  const completato = prog?.completato || false;
                  const fallito = prog?.fallito || false;
                  const bgColor = completato ? "#10b98110" : fallito ? "#ef444410" : "#ffffff08";
                  const borderColor = completato ? "#10b98130" : fallito ? "#ef444430" : "#ffffff10";
                  return (
                    <div key={ob.id} style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: completato ? "#10b981" : fallito ? "#ef4444" : "#ddd", fontWeight: 600, lineHeight: 1.4 }}>
                            {completato ? "✅ " : fallito ? "❌ " : ""}{ob.testo}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                            {/* Progresso numerico */}
                            {editId === ob.id ? (
                              <div style={{ display: "flex", gap: 4 }}>
                                <input style={{ padding: "2px 6px", borderRadius: 5, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, width: 60 }}
                                  type="number" value={editVal} onChange={e => setEditVal(e.target.value)} />
                                <button onClick={() => salvaProgresso(ob.id)} style={{ padding: "2px 8px", borderRadius: 5, border: "none", background: "#10b98122", color: "#10b981", fontSize: 10, cursor: "pointer" }}>✓</button>
                                <button onClick={() => setEditId(null)} style={{ padding: "2px 6px", borderRadius: 5, border: "none", background: "#ffffff10", color: "#888", fontSize: 10, cursor: "pointer" }}>✕</button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditId(ob.id); setEditVal(prog?.valore_attuale || 0); }}
                                style={{ padding: "2px 8px", borderRadius: 5, border: "1px solid #ffffff15", background: "transparent", color: "#666", fontSize: 10, cursor: "pointer" }}>
                                📊 {prog?.valore_attuale || 0}
                              </button>
                            )}
                            {/* +M */}
                            <Badge color={info.color}>+{ob.guadagno}M</Badge>
                            {ob.penalita > 0 && <Badge color="#ef4444">−{ob.penalita}M se fallito</Badge>}
                          </div>
                        </div>
                        {/* Azioni admin */}
                        {isAdmin && (
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button onClick={() => handleToggleCompletato(ob, prog)} disabled={saving}
                              style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: completato ? "#10b98130" : "#10b98115", color: "#10b981", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                              ✓
                            </button>
                            {ob.penalita > 0 && (
                              <button onClick={() => handleToggleFallito(ob, prog)} disabled={saving}
                                style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: fallito ? "#ef444430" : "#ef444415", color: "#ef4444", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                ✕
                              </button>
                            )}
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
      ) : (
        /* ── SELEZIONE CARTA ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, color: "#888" }}>
            Nessun allenatore scelto per la stagione 2026-27.
            {isAdmin && <span style={{ color: "#6366f1" }}> Scegli una carta qui sotto (5M).</span>}
          </div>

          {tuttiAllenatori.map(all => {
            const disponibile = !all.squadra;
            return (
              <div key={all.nome} style={{ background: disponibile ? "#ffffff08" : "#ffffff04", border: `1px solid ${disponibile ? "#ffffff15" : "#ffffff08"}`, borderRadius: 12, padding: 14, opacity: disponibile ? 1 : 0.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: disponibile ? "#f0f0f0" : "#555" }}>{all.nome}</div>
                    <div style={{ fontSize: 11, color: "#666" }}>{all.modulo1} · {all.modulo2}</div>
                    {all.squadra && <div style={{ fontSize: 10, color: "#ef4444", marginTop: 2 }}>Scelto da: {all.squadra}</div>}
                  </div>
                  {isAdmin && disponibile && (
                    <button onClick={() => handleScegli(all.nome)} disabled={saving}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#6366f122", color: "#818cf8", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Scegli −5M
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

/* ─── DEPOSITO FIDUCIARIO ────────────────────────────────────────────────────── */
function DepositoFiduciarioSection({ team, isAdmin, investimenti, onRefresh }) {
  const [saving, setSaving] = useState(false);
  const depositoAperto = isDepositoAperto();

  // Depositi attivi (non ancora rimborsati)
  const depositiAttivi = investimenti.filter(i => i.categoria === 'deposito' && !i.completato);

  async function handleDeposita(importo) {
    const sc = DEPOSITO_SCAGLIONI.find(s => s.importo === importo);
    if (!window.confirm(`Depositare ${importo}M?\n\nRimborso: ${sc.totale}M (+${sc.bonus}%) il ${sc.rimborso}\n\nI soldi sono rimossi dal bilancio ora e non soggetti alla tassa settimanale.`)) return;
    setSaving(true);
    try {
      await effettuaDeposito(team.name, importo);
      onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleRimborsa(inv) {
    const dati = inv.dati || {};
    if (!window.confirm(`Accreditare il rimborso di ${dati.totale}M a ${team.name}?`)) return;
    setSaving(true);
    try {
      await rimborsoDeposito(team.name, inv.id, dati.totale);
      onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  // Controlla se la data di rimborso è passata
  function isRimborsabile(inv) {
    const dati = inv.dati || {};
    if (!dati.rimborso) return false;
    // Formato "DD/MM"
    const [dd, mm] = dati.rimborso.split('/').map(Number);
    const oggi = new Date();
    const scadenza = new Date(oggi.getFullYear(), mm - 1, dd);
    return oggi >= scadenza;
  }

  return (
    <div style={{ background: "#10b98108", border: "1.5px solid #10b98125", borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", letterSpacing: "0.08em", marginBottom: 12 }}>🏦 DEPOSITO FIDUCIARIO (art. 10.6)</div>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 12, lineHeight: 1.6 }}>
        Disponibile <b>08/01–15/01</b>. I M depositati escono dal bilancio e non sono soggetti alla tassa settimanale.
        Vengono riaccreditati con bonus a fine estate.
      </div>

      {/* Scaglioni disponibili */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {DEPOSITO_SCAGLIONI.map(sc => {
          const giàDepositato = depositiAttivi.some(d => (d.dati?.importo || d.costo) === sc.importo);
          return (
            <div key={sc.importo} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 9, background: giàDepositato ? "#10b98115" : "#ffffff08", border: `1px solid ${giàDepositato ? "#10b98130" : "#ffffff10"}` }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: giàDepositato ? "#10b981" : "#ddd" }}>{sc.label}</div>
                <div style={{ fontSize: 9, color: "#555" }}>Rimborso il {sc.rimborso} · esenzione tassa settimanale</div>
              </div>
              {giàDepositato
                ? <Badge color="#10b981">✓ Depositato</Badge>
                : depositoAperto && isAdmin
                ? <button onClick={() => handleDeposita(sc.importo)} disabled={saving}
                    style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#10b98122", color: "#10b981", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Deposita
                  </button>
                : <span style={{ fontSize: 10, color: "#444" }}>
                    {depositoAperto ? "Solo admin" : "Finestra: 08–15 gen"}
                  </span>
              }
            </div>
          );
        })}
      </div>

      {/* Depositi attivi da rimborsare */}
      {depositiAttivi.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.06em", marginBottom: 8 }}>DEPOSITI ATTIVI</div>
          {depositiAttivi.map(inv => {
            const dati = inv.dati || {};
            const puòRimborsare = isRimborsabile(inv);
            return (
              <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", borderRadius: 8, background: "#10b98110", border: "1px solid #10b98125", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981" }}>{inv.costo}M depositati → rimborso {dati.totale}M</div>
                  <div style={{ fontSize: 9, color: "#555" }}>Rimborso il {dati.rimborso} · {inv.data_acquisto}</div>
                </div>
                {isAdmin && puòRimborsare && (
                  <button onClick={() => handleRimborsa(inv)} disabled={saving}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#10b981", color: "#000", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>
                    Rimborsa
                  </button>
                )}
                {!puòRimborsare && (
                  <span style={{ fontSize: 9, color: "#444" }}>Rimborso il {dati.rimborso}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── INVESTIMENTI TAB ───────────────────────────────────────────────────────── */

// Catalogo completo investimenti (art. 10)
const CATALOGO_INVESTIMENTI = [
  // Piccoli
  { nome: "Scouting Estero",         categoria: "piccolo",   costo: 2,  desc: "Diritto esclusivo su 1 giocatore estero se arriva in Serie A entro 2 anni." },
  { nome: "Scommessa Rendimento",     categoria: "piccolo",   costo: 2,  desc: "2 giocatori della rosa: se migliorano Q di 7+, ottieni 2.5M per ognuno." },
  { nome: "Preparatore Atletico",     categoria: "piccolo",   costo: 3,  desc: "+1M ogni giornata in cui 7+ giocatori prendono voto ≥6.5." },
  { nome: "Ufficio Stampa",           categoria: "piccolo",   costo: 3,  desc: "2 volte per stagione annulli una penalità minore (roleplay)." },
  { nome: "Avvocato",                 categoria: "piccolo",   costo: 4,  desc: "Ogni 5 ammonizioni dei tuoi titolari/subentrati → +0.5M." },
  { nome: "Vice Allenatore Premium",  categoria: "piccolo",   costo: 5,  desc: "3 volte/stagione modifichi un giocatore dopo il fischio d'inizio." },
  { nome: "Medico di Base",           categoria: "piccolo",   costo: 5,  desc: "Scegli 5 giocatori: +2M per ognuno che salta 5+ giornate per infortunio." },
  { nome: "Ricapitalizzazione",       categoria: "piccolo",   costo: 5,  desc: "Abbassa il Fair Play Finanziario di 3M. Solo entro il 05/09." },
  // Medi
  { nome: "Settore Giovanile Avanzato", categoria: "medio",  costo: 6,  desc: "Alza il limite vivaio da 2 a 4 giocatori per l'anno seguente." },
  { nome: "Scommessa Serie B",         categoria: "medio",   costo: 6,  desc: "Indovina la promosse dalla B: acquista 1 suo giocatore a ¼ Qi." },
  { nome: "Meno è meglio",            categoria: "medio",   costo: 7,  desc: "SC nella TOP-3 più bassi + TOP-4 campionato → +10M." },
  { nome: "SuperClub",                categoria: "medio",   costo: 7,  desc: "+3M al tuo Salary Cap per la stagione." },
  { nome: "Accordi TV",               categoria: "medio",   costo: 8,  desc: "Ogni partita con 2+ gol segnati → +0.5M extra." },
  { nome: "Jolly della Stagione",     categoria: "medio",   costo: 8,  desc: "4 volte/stagione raddoppi i guadagni di una singola giornata." },
  { nome: "Clean Sheet",              categoria: "medio",   costo: 9,  desc: "+1M per ogni giornata in cui la squadra avversaria fa <66 punti." },
  { nome: "The MVP",                  categoria: "medio",   costo: 9,  desc: "Ogni MVP di un tuo giocatore → +0.4M." },
  // Grandi
  { nome: "Ristrutturazione Stadio",  categoria: "grande",  costo: 10, desc: "+1.5M/mese dallo stadio a partire dalla stagione successiva (min. 3 anni tra investimenti)." },
  { nome: "Branding Internazionale",  categoria: "grande",  costo: 10, desc: "1° posto: +20M · 2°: +15M · 3°: +12M · 4°: +8M · Coppa: +5M." },
  { nome: "DS Masterclass",           categoria: "grande",  costo: 10, desc: "Nelle aste svincolati: 2 volte/stagione conosci l'offerta più alta prima di formalizzare la tua." },
  { nome: "Centro Giovani U21",       categoria: "grande",  costo: 12, desc: "1 giocatore U21 svincolato/stagione a ¼ Qi. Mantenimento 1M/anno." },
  { nome: "Fondo Speculativo",        categoria: "grande",  costo: 12, desc: "Ogni giornata >75: +1M al fondo. <60: -0.3M. Ricevi tutto a fine stagione." },
  { nome: "Centro Analisi Tattica",   categoria: "grande",  costo: 13.5, desc: "Ogni giornata col modulo principale del tuo allenatore → +0.5M." },
  { nome: "Fondo Pensione Atleti",    categoria: "grande",  costo: 15, desc: "Per giocatori ≥32 anni lo stipendio si calcola Q/7 invece di Q/5. Dura 1 anno." },
  { nome: "Abbonamenti Premium",      categoria: "grande",  costo: 15, desc: "Vittoria in casa: +1.5M (scarto ≥2: +2M). Pareggio in casa: +1M. Dura 1 stagione." },
  // Invernali (24/12-31/12, max 10M)
  { nome: "Rientro in Grande",        categoria: "invernale", costo: 3, desc: "1 infortunato: se nelle 5 giornate dal rientro prende voto ≥6 → +1.2M." },
  { nome: "Deroga U-21",              categoria: "invernale", costo: 4, desc: "Fino al 01/06: puoi avere 30 giocatori con solo 1 U21." },
  { nome: "Clausola Segreta",         categoria: "invernale", costo: 4, desc: "Clausola rescissoria: da 1.75× a 2.0× la quotazione fino al 31/05." },
  { nome: "Scouting Rapido",          categoria: "invernale", costo: 5, desc: "+1 svincolo straordinario extra nella sessione invernale." },
  { nome: "Re del Girone di Ritorno", categoria: "invernale", costo: 7, desc: "7+ punti in più nella seconda metà vs prima metà → +10M a fine anno." },
  { nome: "Corso Analisi Video",      categoria: "invernale", costo: 10, desc: "1 sostituzione extra (non nelle ultime 3 giornate o finale Coppa)." },
];

const CATALOGO_SPONSOR = {
  tecnico: [
    { nome: "Nike",    desc: "3 giocatori diversi segnano nella stessa partita → +1M." },
    { nome: "Adidas",  desc: "Punteggio >82 in una partita → +1M." },
    { nome: "Puma",    desc: "Vittoria con ≥2 gol di scarto o pareggio over 5.5 → +1M." },
    { nome: "Kappa",   desc: "7+ giocatori degli 11 a punteggio hanno bonus/malus → +1M." },
  ],
  bevande: [
    { nome: "Coca-Cola",  desc: "Bonus da un subentrato → +1M." },
    { nome: "Heineken",   desc: "2+ bonus da un singolo giocatore → +1M." },
    { nome: "Red Bull",   desc: "Un giocatore prende ≥7 senza bonus/malus → +1M." },
    { nome: "Burger King",desc: "Portiere con porta inviolata e voto ≥6.5 → +1M." },
  ],
  hitech: [
    { nome: "Apple",   desc: "Rosa con più stipendi a fine stagione → +3M." },
    { nome: "Samsung", desc: "2+ premi individuali stagionali → +3M." },
    { nome: "Google",  desc: "Avversario 0.5M sotto la soglia successiva 4+ volte → +3M." },
    { nome: "Spotify", desc: "Vittorie vs rivale ≥ (sconfitte + pareggi) → +3M." },
  ],
};

const catLabel = { piccolo: "🔹 Piccoli", medio: "🔷 Medi", grande: "💎 Grandi", invernale: "❄️ Invernali" };
const catColor = { piccolo: "#6366f1", medio: "#3b82f6", grande: "#f59e0b", invernale: "#818cf8" };
const sponsorCatLabel = { tecnico: "👕 Sponsor Tecnico (max 5/stagione)", bevande: "🍺 Sponsor Bevande (max 5/stagione)", hitech: "💻 Sponsor Hi-Tech (fine stagione)" };

function InvestimentiTab({ team, isAdmin }) {
  const [investimenti, setInvestimenti] = useState([]);
  const [sponsor, setSponsor] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [showSponsors, setShowSponsors] = useState(false);
  const [catFilter, setCatFilter] = useState("tutti");
  const [saving, setSaving] = useState(false);
  const [editGuadagno, setEditGuadagno] = useState(null); // { id, val }

  const loadAll = useCallback(async () => {
    const [inv, spo] = await Promise.all([
      getInvestimenti(team.name),
      getSponsor(team.name),
    ]);
    setInvestimenti(inv);
    setSponsor(spo);
    setLoading(false);
  }, [team.name]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleAcquista(item) {
    if (!window.confirm(`Acquistare "${item.nome}" per ${item.costo}M?\n\n${item.desc}`)) return;
    setSaving(true);
    try {
      await acquistaInvestimento({ squadra: team.name, nome: item.nome, categoria: item.categoria, costo: item.costo });
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleAcquistaSponsor(cat, nome) {
    if (!window.confirm(`Scegliere ${nome} come sponsor ${cat}?`)) return;
    setSaving(true);
    try {
      const { data: sq } = await supabase.from('squadre').select('bilancio').eq('name', team.name).single();
      const costo = 1; // 1M per nuovo sponsor
      const nuovoBilancio = parseFloat(((sq?.bilancio || 0) - costo).toFixed(2));
      await supabase.from('squadre').update({ bilancio: nuovoBilancio }).eq('name', team.name);
      await supabase.from('movimenti').insert({ squadra: team.name, descrizione: `Sponsor ${cat}: ${nome}`, uscita: costo, data: new Date().toISOString().slice(0,10) });
      await insertSponsor({ squadra: team.name, categoria: cat, nome });
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleRegistraGuadagno(invId) {
    const importo = parseFloat(editGuadagno?.val);
    if (!importo || importo <= 0) return;
    setSaving(true);
    try {
      await registraGuadagnoInvestimento(invId, importo, team.name);
      setEditGuadagno(null);
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Rimuovere questo investimento?")) return;
    await deleteInvestimento(id);
    await loadAll();
  }

  // Totale investito e guadagnato
  const totInvestito = investimenti.reduce((s, i) => s + Number(i.costo), 0);
  const totGuadagnato = investimenti.reduce((s, i) => s + Number(i.valore_accumulato || 0), 0);
  const budgetUsato = totInvestito;
  const budgetMax = 30;

  const cats = ["tutti", "piccolo", "medio", "grande", "invernale"];
  const invAttivi = investimenti.filter(i => i.attivo);
  const invFiltrati = catFilter === "tutti" ? CATALOGO_INVESTIMENTI : CATALOGO_INVESTIMENTI.filter(i => i.categoria === catFilter);
  const nomiAttivi = new Set(invAttivi.map(i => i.nome));

  if (loading) return <div style={{ fontSize: 12, color: "#555", padding: 20 }}>Caricamento...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Riepilogo budget ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "BUDGET USATO", value: `${budgetUsato.toFixed(1)}M`, sub: `/ ${budgetMax}M max`, color: budgetUsato > budgetMax ? "#ef4444" : "#f59e0b" },
          { label: "BUDGET LIBERO", value: `${(budgetMax - budgetUsato).toFixed(1)}M`, sub: "", color: budgetMax - budgetUsato < 5 ? "#ef4444" : "#10b981" },
          { label: "GUADAGNI TOT", value: `+${totGuadagnato.toFixed(1)}M`, sub: "", color: "#10b981" },
        ].map(s => (
          <div key={s.label} style={{ background: "#ffffff08", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#555", letterSpacing: "0.06em", marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: s.color, fontFamily: "'Bebas Neue',sans-serif" }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 9, color: "#444" }}>{s.sub}</div>}
          </div>
        ))}
      </div>
      <StatBar value={budgetUsato} max={budgetMax} color={budgetUsato > budgetMax ? "#ef4444" : "#f59e0b"} height={6} />

      {/* ── Investimenti attivi ── */}
      {invAttivi.length > 0 && (
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 12 }}>✅ INVESTIMENTI ATTIVI</div>
          {invAttivi.map(inv => (
            <div key={inv.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #ffffff08", flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e0e0" }}>{inv.nome}</div>
                <div style={{ fontSize: 10, color: "#555" }}>
                  <span style={{ color: catColor[inv.categoria] }}>{catLabel[inv.categoria]}</span>
                  {" · "}Acquistato {inv.data_acquisto}
                  {inv.note && <span> · {inv.note}</span>}
                </div>
              </div>
              <Badge color="#ef4444">−{inv.costo}M</Badge>
              {inv.valore_accumulato > 0 && <Badge color="#10b981">+{Number(inv.valore_accumulato).toFixed(1)}M</Badge>}
              {/* Registra guadagno */}
              {isAdmin && (
                editGuadagno?.id === inv.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input style={{ padding: "3px 6px", borderRadius: 5, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 11, width: 56 }}
                      type="number" step="0.1" value={editGuadagno.val}
                      onChange={e => setEditGuadagno(g => ({ ...g, val: e.target.value }))} />
                    <button onClick={() => handleRegistraGuadagno(inv.id)} style={{ padding: "3px 8px", borderRadius: 5, border: "none", background: "#10b98122", color: "#10b981", fontSize: 10, cursor: "pointer" }}>+M</button>
                    <button onClick={() => setEditGuadagno(null)} style={{ padding: "3px 6px", borderRadius: 5, border: "none", background: "#ffffff10", color: "#888", fontSize: 10, cursor: "pointer" }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setEditGuadagno({ id: inv.id, val: "" })}
                    style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #10b98130", background: "#10b98112", color: "#10b981", fontSize: 10, cursor: "pointer" }}>💰 +M</button>
                )
              )}
              {isAdmin && <button onClick={() => handleDelete(inv.id)} style={{ padding: "3px 7px", borderRadius: 5, border: "none", background: "#ef444415", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>✕</button>}
            </div>
          ))}
        </div>
      )}

      {/* ── Sponsor attivi ── */}
      {sponsor.length > 0 && (
        <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 10 }}>🎯 SPONSOR ATTIVI</div>
          {sponsor.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #ffffff08" }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e0e0" }}>{s.nome}</span>
                <span style={{ fontSize: 10, color: "#555", marginLeft: 8 }}>{s.categoria}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {s.guadagno_tot > 0 && <Badge color="#10b981">+{s.guadagno_tot}M</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Catalogo investimenti ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, overflow: "hidden" }}>
        <div onClick={() => setShowCatalogo(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em" }}>📋 CATALOGO INVESTIMENTI</div>
          <span style={{ color: "#555" }}>{showCatalogo ? "▲" : "▼"}</span>
        </div>
        {showCatalogo && (
          <div style={{ padding: "0 16px 16px" }}>
            {/* Filtro categoria */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
              {cats.map(c => (
                <button key={c} onClick={() => setCatFilter(c)}
                  style={{ padding: "4px 10px", borderRadius: 7, border: `1px solid ${catFilter===c ? catColor[c]||"#6366f1" : "#ffffff15"}`, background: catFilter===c ? (catColor[c]||"#6366f1")+"20" : "transparent", color: catFilter===c ? (catColor[c]||"#818cf8") : "#555", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                  {c === "tutti" ? "Tutti" : catLabel[c]}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {invFiltrati.map(item => {
                const giàAttivo = nomiAttivi.has(item.nome);
                return (
                  <div key={item.nome} style={{ background: giàAttivo ? "#10b98110" : "#ffffff06", border: `1px solid ${giàAttivo ? "#10b98130" : "#ffffff10"}`, borderRadius: 10, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: giàAttivo ? "#10b981" : "#ddd" }}>{item.nome}</span>
                        <span style={{ fontSize: 9, color: catColor[item.categoria], background: catColor[item.categoria]+"18", border: `1px solid ${catColor[item.categoria]}33`, borderRadius: 4, padding: "1px 5px" }}>{catLabel[item.categoria]}</span>
                        {giàAttivo && <span style={{ fontSize: 9, color: "#10b981" }}>✓ attivo</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#666", lineHeight: 1.4 }}>{item.desc}</div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: "#f59e0b", fontFamily: "'Bebas Neue',sans-serif" }}>{item.costo}M</div>
                      {isAdmin && !giàAttivo && (
                        <button onClick={() => handleAcquista(item)} disabled={saving}
                          style={{ marginTop: 4, padding: "3px 10px", borderRadius: 6, border: "none", background: "#6366f122", color: "#818cf8", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                          Acquista
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Catalogo sponsor ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 14, overflow: "hidden" }}>
        <div onClick={() => setShowSponsors(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em" }}>🎯 CATALOGO SPONSOR</div>
          <span style={{ color: "#555" }}>{showSponsors ? "▲" : "▼"}</span>
        </div>
        {showSponsors && (
          <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(CATALOGO_SPONSOR).map(([cat, items]) => {
              const attivoCat = sponsor.find(s => s.categoria === cat);
              return (
                <div key={cat}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#666", letterSpacing: "0.08em", marginBottom: 6 }}>{sponsorCatLabel[cat]}</div>
                  {items.map(item => {
                    const isAttivo = attivoCat?.nome === item.nome;
                    return (
                      <div key={item.nome} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 10px", borderRadius: 8, background: isAttivo ? "#10b98110" : "#ffffff06", border: `1px solid ${isAttivo ? "#10b98130" : "#ffffff08"}`, marginBottom: 4 }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isAttivo ? "#10b981" : "#ddd" }}>{item.nome}</span>
                          {isAttivo && <span style={{ fontSize: 9, color: "#10b981", marginLeft: 6 }}>✓ attivo</span>}
                          <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{item.desc}</div>
                        </div>
                        {isAdmin && !attivoCat && (
                          <button onClick={() => handleAcquistaSponsor(cat, item.nome)} disabled={saving}
                            style={{ padding: "3px 10px", borderRadius: 6, border: "none", background: "#6366f122", color: "#818cf8", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                            1M
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: "#444" }}>Rinnovo sponsor: 2M · Cambio sponsor: 1M · Entro il 15/08</div>
          </div>
        )}
      </div>

      {/* ── DEPOSITO FIDUCIARIO (art. 10.6) ── */}
      <DepositoFiduciarioSection team={team} isAdmin={isAdmin} investimenti={investimenti} onRefresh={loadAll} />

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
    const nuove = parseInt(editPresenze.val) || 0;
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
  const [tab, setTab] = useState("rosa");
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

  const salaryDist = 75 - team.salaryUsed;
  const fpMax = Math.max(team.fairPlay1, team.fairPlay2);
  const fpStatus = getFPStatus(fpMax);
  const scColor = getSCColor(team.salaryUsed);
  const canEditMovimenti = isAdmin || mySquadra === team.name;

  // Salary cap: stipendi rosa + 5M staff allenatore (se carta scelta)
  const salaryCapRosa = rosaPlayers.reduce((s, p) => s + Number(p.stip), 0);
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
    const data = await getRosa(team.name);
    if (data) {
      // I giocatori vivaio hanno stip=0 e non gravano sul SC, ma li escludiamo per pulizia
      const rosaAttiva = data.filter(p => !p.in_vivaio);
      setRosaPlayers(rosaAttiva);
      const sc = rosaAttiva.reduce((s, p) => s + Number(p.stip), 0);
      if (!scEsenteGiuLug) await aggiornaSCNegativo(team.name, sc, oggi);
    }
  }, [team.name]);

  const loadContratti = useCallback(async () => {
    const data = await getContrattiInScadenza(team.name);
    if (data) setContrattiScadenza(data);
  }, [team.name]);

  const loadClubIdentity = useCallback(async () => {
    const data = await getClubIdentity(team.name);
    if (data) setClubIdentity(data);
  }, [team.name]);

  const loadObiettivi = useCallback(async () => {
    const data = await getObiettivi(team.name);
    if (data) setObiettivi(data);
  }, [team.name]);

  useEffect(() => {
    loadRosaStipendi();
    loadContratti();
    loadClubIdentity();
    loadObiettivi();
    // SC allenatore: 5M fissi se carta scelta (art. 9.1.2)
    getSCAllenatore(team.name).then(setScAllenatore);
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
    } catch(e) { alert(`Errore: ${e.message}`); }
    finally { setPagandoStipendi(false); }
  }

  const loadMovimenti = useCallback(async () => {
    const data = await getMovimenti(team.name);
    if (data) setMovimenti(data);
  }, [team.name]);

  useEffect(() => {
    loadMovimenti();
    const sub = subscribeMovimenti(team.name, loadMovimenti);
    return () => supabase.removeChannel(sub);
  }, [loadMovimenti, team.name]);

  async function salvaMovimento() {
    if (!movForm.descrizione) return;
    const entrata = movForm.entrata ? parseFloat(movForm.entrata) : null;
    const uscita  = movForm.uscita  ? parseFloat(movForm.uscita)  : null;
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
    setShowMovForm(false);
    setMovForm({ descrizione: "", entrata: "", uscita: "", data: new Date().toISOString().slice(0, 10) });
    await loadMovimenti();
  }

  async function rimuoviMovimento(id) {
    const rimanenti = movimenti.filter(m => m.id !== id);
    const nuovoBilancio = parseFloat(rimanenti.reduce((s, m) => s + (m.entrata || 0) - (m.uscita || 0), 0).toFixed(2));
    await updateSquadra(team.name, { bilancio: nuovoBilancio });
    await deleteMovimento(id);
    await loadMovimenti();
  }

  const tabs = [
    { key: "rosa",         label: "Rosa"         },
    { key: "vivaio",       label: "Vivaio"       },
    { key: "finanze",      label: "Finanze"      },
    { key: "movimenti",    label: "Movimenti"    },
    { key: "svincoli",     label: "Svincoli"     },
    { key: "clausole",     label: "Clausole"     },
    { key: "allenatore",   label: "Allenatore"   },
    { key: "investimenti", label: "Investimenti" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: "#ffffff0f", border: "1px solid #ffffff18", borderRadius: 10, padding: "8px 12px", cursor: "pointer", color: "#aaa", fontSize: 13, fontWeight: 600 }}>← Indietro</button>
        <TeamAvatar team={team} size={48} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "0.5px" }}>{team.name}</div>
          <div style={{ fontSize: 12, color: "#888" }}>Allenatore: <span style={{ color: team.color, fontWeight: 700 }}>{team.allenatore}</span></div>
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
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

        {/* LEFT — tabs */}
        <div style={{ flex: 1, minWidth: 0 }}>
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

            {tab === "rosa" && <RosaTable teamName={team.name} isAdmin={isAdmin} mySquadra={mySquadra} />}

            {tab === "finanze" && (
              <FinanzeTab
                team={team}
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
                onRefresh={() => {}}
              />
            )}

            {tab === "vivaio" && (
              <VivaiTab team={team} isAdmin={isAdmin} />
            )}

            {tab === "svincoli" && (
              <SvincoliTab team={team} isAdmin={isAdmin} />
            )}

            {tab === "clausole" && (
              <ClausoleTab team={team} isAdmin={isAdmin} />
            )}

            {tab === "allenatore" && (
              <AllenatoreTab team={team} isAdmin={isAdmin} />
            )}

            {tab === "investimenti" && (
              <InvestimentiTab team={team} isAdmin={isAdmin} />
            )}

            {tab === "movimenti" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em" }}>📋 MOVIMENTI</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {/* Sort buttons */}
                    {[
                      { key: "data_desc", label: "📅 Recenti" },
                      { key: "data_asc",  label: "📅 Vecchi"  },
                      { key: "imp_desc",  label: "💰 Importo ↓" },
                      { key: "imp_asc",   label: "💰 Importo ↑" },
                    ].map(s => (
                      <button key={s.key} onClick={() => setMovSort(s.key)} style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: movSort === s.key ? "#6366f133" : "#ffffff0a", color: movSort === s.key ? "#818cf8" : "#666", fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {s.label}
                      </button>
                    ))}
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
        <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <ClubIdentityRight
            team={team}
            clubIdentity={clubIdentity}
            isAdmin={isAdmin}
            mySquadra={mySquadra}
            onRefresh={loadClubIdentity}
          />
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

  const TEAMS_LIST = ["Alcool Campi","AK Toio","Agnus Dei FC","Balillareal","Borjcellona","Consules FC","Finocchiona AC","Shalpe 104"];
  const squadreRivali = TEAMS_LIST.filter(n => n !== team.name);

  // Rivale: bloccato dopo la scelta — solo admin può cambiarlo (art. 8.3)
  const rivaleGiaScelto = !!(clubIdentity?.rivali);
  const canEditRivale = isAdmin || !rivaleGiaScelto;

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
        {canEdit && <div style={{ fontSize: 9, color: "#555", marginTop: 6, textAlign: "center" }}>Clicca per caricare · max 2MB</div>}
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
            { key: "fondazione", label: "FONDAZIONE", placeholder: "es. 2021",         type: "text"   },
            { key: "stadio",     label: "STADIO",     placeholder: "Nome stadio",       type: "text"   },
            { key: "gemellato",  label: "GEMELLATO",  placeholder: "Club gemellato",    type: "text"   },
            { key: "motto",      label: "MOTTO",      placeholder: "Motto del club",    type: "text"   },
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
          {/* Rivale — menu tendina con lock dopo scelta */}
          <div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.06em", marginBottom: 3 }}>RIVALE</div>
            {editing && canEditRivale
              ? <select value={form?.rivali || ""} onChange={e => setForm(f => ({...f, rivali: e.target.value}))} style={inp}>
                  <option value="">— Nessun rivale —</option>
                  {squadreRivali.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 12, color: team.color, fontWeight: 700 }}>
                    {clubIdentity?.rivali || <span style={{ color: "#444", fontWeight: 400 }}>—</span>}
                  </div>
                  {rivaleGiaScelto && !isAdmin && (
                    <span style={{ fontSize: 9, color: "#555", background: "#ffffff08", border: "1px solid #ffffff12", borderRadius: 4, padding: "1px 5px" }}>🔒 fisso</span>
                  )}
                  {rivaleGiaScelto && isAdmin && editing && (
                    <button onClick={() => setForm(f => ({...f, rivali: ""}))}
                      style={{ fontSize: 9, color: "#f59e0b", background: "#f59e0b12", border: "1px solid #f59e0b30", borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}>
                      admin: cambia
                    </button>
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

// Finestre di mercato (art. 5.1)
// Estivo:   01/06 09:00 → 15/09 24:00
// Invernale: 01/01 09:00 → 15/02 24:00
function getMercatoStatus() {
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

// Calcola scadenza prestito: prossima data 01/01 o 01/06 + mesi (art. 5.8)
function scadenzaPrestito(mesi) {
  const now = new Date();
  const y = now.getFullYear();
  const candidates = [
    new Date(y, 0, 1), new Date(y, 5, 1),
    new Date(y+1, 0, 1), new Date(y+1, 5, 1),
    new Date(y+2, 0, 1),
  ];
  const start = candidates.find(d => d > now) || candidates[candidates.length - 1];
  const end = new Date(start);
  end.setMonth(end.getMonth() + mesi);
  // Arrotonda a 01/01 o 01/06 più vicina
  const jan = new Date(end.getFullYear(), 0, 1);
  const jun = new Date(end.getFullYear(), 5, 1);
  const target = Math.abs(end - jan) < Math.abs(end - jun) ? jan : jun;
  return target.toISOString().slice(0, 10);
}

// Calcola prezzo a discesa live (art. 5.11)
function prezzoDiscesaLive(quotBase, avviataAt) {
  const minutiPassati = (new Date() - new Date(avviataAt)) / 60000;
  const riduzioni = Math.floor(minutiPassati / 30);
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

function MercatoPage({ profile, isAdmin, teams, offerteInAttesa = [] }) {
  const [tab, setTab] = useState("trattative");
  const [trattative, setTrattative] = useState([]);
  const [aste, setAste] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAstaForm, setShowAstaForm] = useState(false);
  const [now, setNow] = useState(new Date());

  // ── Picker squadra/giocatore (nuovo form trattativa) ──────────────────────
  const emptyForm = {
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
  const [bonusDraft, setBonusDraft] = useState({ tipo_bonus: 'gol_fatti', soglia: '', valore_mln: '', direzione: 'acquirente_paga' });

  // Form nuova asta
  const emptyAstaForm = { giocatore: "", quot: "", tipo_asta: "rialzo", note: "" };
  const [astaForm, setAstaForm] = useState(emptyAstaForm);

  const mySquadra = profile?.squadra;
  const mercato = getMercatoStatus();

  // Tick ogni minuto
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    const [t, a] = await Promise.all([getTrattative(), getAste()]);
    setTrattative(t);
    setAste(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const s1 = subscribeTrattative(loadAll);
    const s2 = subscribeAste(loadAll);
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); };
  }, [loadAll]);

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
    // Se ≥1 passaggio in sessione: solo prestito
    const tipoForzato = passaggi >= 1 ? 'prestito_secco' : form.tipo;
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
  function aggiungiBonusDraft() {
    const soglia = parseInt(bonusDraft.soglia);
    const valore = parseFloat(bonusDraft.valore_mln);
    if (!soglia || !valore || soglia <= 0 || valore <= 0) return;
    setForm(f => ({ ...f, bonusRows: [...f.bonusRows, { ...bonusDraft, soglia, valore_mln: valore }] }));
    setBonusDraft({ tipo_bonus: 'gol_fatti', soglia: '', valore_mln: '', direzione: 'acquirente_paga' });
  }

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

    const da = isAdmin ? form.squadraTarget : mySquadra;
    const scad = form.tipo.startsWith('prestito') ? scadenzaPrestito(parseInt(form.durata_mesi)) : null;

    const trattativa = await insertTrattativa({
      da_squadra: mySquadra,
      a_squadra: form.squadraTarget,
      giocatore: form.giocatoreNome,
      quot_giocatore: quot,
      tipo: form.tipo,
      prezzo,
      durata_mesi: form.tipo.startsWith('prestito') ? parseInt(form.durata_mesi) : null,
      scadenza_prestito: scad,
      stipendio_a_chi: form.tipo.startsWith('prestito') ? form.stipendio_a_chi : null,
      fuori_mercato: !mercato.aperto,
      note: form.note,
      n_rifiuti: 0,
      penalta_applicata: 0,
      deadline_risposta: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });

    // Inserisci i bonus
    for (const row of form.bonusRows) {
      await insertBonusTrattativa({ ...row, trattativa_id: trattativa.id });
    }

    setShowForm(false);
    setForm(emptyForm);
    setRosaTarget([]);
  }

  // ── Risposta trattativa ────────────────────────────────────────────────────
  const [controffertaId, setControffertaId] = useState(null);
  const [controffertaPrezzo, setControffertaPrezzo] = useState("");

  async function rispondi(t, azione) {
    if (azione === 'accettata') {
      const mercatoAperto = getMercatoStatus().aperto;
      const msg = t.fuori_mercato || !mercatoAperto
        ? `Confermi di accettare? Il trasferimento di ${t.giocatore} sarà registrato come "differito".`
        : `Confermi il trasferimento di ${t.giocatore} per ${t.prezzo}M?`;
      if (!window.confirm(msg)) return;
      setLoading(true);
      try {
        await checkEAggiornaPassaggi(t.giocatore, t.a_squadra, t.tipo);
        await eseguiTrasferimento(t);
        // Aggiorna fanta_squadra nel listone e stipendio da listone
        await aggiornaFantaSquadraListone(t.giocatore, t.a_squadra);
        await aggiornaStipendioDopoTrasferimento(t.giocatore, t.a_squadra);
        await logAzione({ utente: 'admin', squadra: t.da_squadra, azione: 'trasferimento', entita: 'trattative', entitaId: t.id, descrizione: `Trasferimento: ${t.giocatore} da ${t.da_squadra} a ${t.a_squadra} — ${t.prezzo}M (${t.tipo})`, dataPrima: { trattativa: t }, rollbackPossibile: false });
      } catch (e) {
        alert(`Errore durante il trasferimento: ${e.message}`);
      } finally {
        setLoading(false);
        await loadAll();
      }
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
    await loadAll();
  }

  async function inviaControfferta(t) {
    const nuovoPrezzo = parseFloat(controffertaPrezzo);
    if (!nuovoPrezzo || nuovoPrezzo <= 0) { alert("Inserisci un prezzo valido"); return; }
    const quot = t.quot_giocatore || 0;
    if (nuovoPrezzo < quot / 2) { alert(`Prezzo minimo: ${(quot/2).toFixed(2)}M (½ della quotazione)`); return; }
    // Scambia le parti e incrementa n_rifiuti; reset deadline a now+24h
    await updateTrattativa(t.id, {
      stato: 'in attesa',
      prezzo: nuovoPrezzo,
      da_squadra: t.a_squadra,
      a_squadra: t.da_squadra,
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
    await insertAsta({
      proprietario: mySquadra || TEAMS[0].name,
      giocatore: astaForm.giocatore,
      quot_giocatore: quot,
      tipo_asta: astaForm.tipo_asta,
      prezzo_base: prezzoBase,
      offerta_attuale: astaForm.tipo_asta === 'rialzo' ? prezzoBase : quot,
      prezzo_corrente: astaForm.tipo_asta === 'discesa' ? quot : null,
      avviata_at: new Date().toISOString(),
      scadenza_asta: astaForm.tipo_asta === 'rialzo' ? new Date(Date.now() + 2 * 3600 * 1000).toISOString() : null,
      note: astaForm.note,
    });
    setShowAstaForm(false);
    setAstaForm(emptyAstaForm);
  }

  // ── Offerta su asta a rialzo ───────────────────────────────────────────────
  async function faiOffertaRialzo(asta) {
    const nuova = parseFloat((asta.offerta_attuale + 0.1).toFixed(2));
    // Controlla orario (21:00-09:00 congelato, art. 5.11)
    const ora = now.getHours();
    if (ora >= 21 || ora < 9) {
      alert("Offerte congelate dalle 21:00 alle 09:00 (art. 5.11)");
      return;
    }
    const nuovaScadenza = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    await updateAsta(asta.id, {
      offerta_attuale: nuova,
      miglior_offerente: mySquadra,
      ultima_offerta_at: new Date().toISOString(),
      scadenza_asta: nuovaScadenza,
    });
  }

  // ── Acquisto asta a discesa ────────────────────────────────────────────────
  async function acquistaDiscesa(asta) {
    const prezzoAcquisto = prezzoDiscesaLive(asta.quot_giocatore, asta.avviata_at);
    await updateAsta(asta.id, {
      stato: 'aggiudicata',
      vincitore: mySquadra,
      prezzo_finale: prezzoAcquisto,
    });
  }

  // ── Helpers display ───────────────────────────────────────────────────────
  const tipoLabel = {
    cessione: "💸 Cessione", prestito_diritto: "🔄 Prestito c/Diritto",
    prestito_obbligo: "🔄 Prestito c/Obbligo", prestito_secco: "🔄 Prestito Secco",
    clausola: "⚡ Clausola Rescissoria", scambio: "🔀 Scambio",
  };

  const statoColor = { "in attesa": "#f59e0b", accettata: "#10b981", rifiutata: "#ef4444", completata: "#6366f1", scaduta: "#555", fuori_mercato: "#f97316", controproposta: "#818cf8" };

  // Scadenza risposta (24h)
  function hoursLeft(deadline) {
    const h = Math.max(0, Math.round((new Date(deadline) - now) / 3600000));
    return h;
  }

  const horaCongelata = now.getHours() >= 21 || now.getHours() < 9;

  const myTrattative = trattative.filter(t => t.da_squadra === mySquadra || t.a_squadra === mySquadra);
  const tutteTrattative = isAdmin ? trattative : myTrattative;
  const astePending = aste.filter(a => a.stato === 'attiva');
  const asteChiuse  = aste.filter(a => a.stato !== 'attiva');

  const sel = { padding: "8px 12px", borderRadius: 8, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12, width: "100%" };
  const inp = { ...sel };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Banner notifiche offerte in attesa */}
      {offerteInAttesa.length > 0 && (
        <div style={{ background: "#ef44441a", border: "1.5px solid #ef444440", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#ef4444", letterSpacing: "0.06em" }}>
            🔔 {offerteInAttesa.length} OFFERT{offerteInAttesa.length === 1 ? "A" : "E"} IN ATTESA DI RISPOSTA
          </div>
          {offerteInAttesa.map(o => {
            const stato = calcolaStatoNotificaOfferta(o);
            const colori = { ok: "#888", warning: "#f59e0b", danger: "#f97316", critical: "#ef4444", max: "#ef4444", scaduta: "#ef4444" };
            return (
              <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, padding: "4px 0", borderBottom: "1px solid #ffffff08" }}>
                <span style={{ color: "#e0e0e0", fontWeight: 600 }}>{o.giocatore} <span style={{ color: "#555", fontWeight: 400 }}>da {o.da_squadra}</span></span>
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
      {horaCongelata && astePending.some(a => a.tipo_asta === 'rialzo') && (
        <div style={{ background: "#f59e0b0a", border: "1px solid #f59e0b30", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "#f59e0b" }}>
          🌙 Offerte aste a rialzo congelate (21:00 – 09:00) — i timer sono sospesi
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

          <button onClick={() => setShowForm(v => !v)} style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#a855f7)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {showForm ? "✕ Annulla" : "+ Nuova trattativa"}
          </button>


          {showForm && (
            <div style={{ background: "#ffffff08", border: "1.5px solid #6366f130", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 16 }}>📤 NUOVA TRATTATIVA</div>

              {/* STEP 1 — Scegli squadra */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>1. SQUADRA DA CUI ACQUISTARE</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {TEAMS.filter(t => t.name !== mySquadra).map(t => (
                    <button key={t.name} onClick={() => onSquadraTargetChange(t.name)} style={{
                      padding: "6px 12px", borderRadius: 8, border: `1px solid ${form.squadraTarget === t.name ? t.color : "#ffffff15"}`,
                      background: form.squadraTarget === t.name ? t.color + "22" : "transparent",
                      color: form.squadraTarget === t.name ? t.color : "#888",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                    }}>{t.tag} {t.name}</button>
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
                            const soloP = passaggi >= 1;
                            return (
                              <option key={p.id} value={p.id}>
                                {p.ruolo} {p.nome} — Q{p.quot} · stip {p.stip}M{soloP ? ` ⚠️ solo prestito (${passaggi}/3 pass.)` : ''}
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
                      { l: "PASS. SESS.", v: `${rosaTarget.find(p=>String(p.id)===String(form.giocatoreId))?.passaggi_sessione||0}/3`, c: (rosaTarget.find(p=>String(p.id)===String(form.giocatoreId))?.passaggi_sessione||0)>=2?"#f59e0b":"#888" },
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
                      const soloP = passaggi >= 1;
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

                    {form.tipo.startsWith('prestito') && (
                      <div>
                        <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>STIPENDIO A CARICO DI</div>
                        <select style={sel} value={form.stipendio_a_chi} onChange={e => setForm(f => ({ ...f, stipendio_a_chi: e.target.value }))}>
                          <option value="ricevente">Chi riceve ({mySquadra})</option>
                          <option value="cedente">Chi presta ({form.squadraTarget})</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Note */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>NOTE</div>
                    <input style={inp} placeholder="Condizioni aggiuntive…" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
                  </div>

                  {/* BONUS */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, color: "#666", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 700 }}>4. BONUS (opz.)</div>

                    {/* Righe già aggiunte */}
                    {form.bonusRows.length > 0 && (
                      <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                        {form.bonusRows.map((row, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, background: "#ffffff08", borderRadius: 8, padding: "6px 12px" }}>
                            <span style={{ fontSize: 11, color: "#ccc", flex: 1 }}>
                              {TIPI_BONUS.find(b => b.value === row.tipo_bonus)?.label} ≥{row.soglia} → {row.valore_mln}M
                              <span style={{ color: row.direzione === 'acquirente_paga' ? "#818cf8" : "#10b981", marginLeft: 6 }}>
                                ({row.direzione === 'acquirente_paga' ? 'acquirente paga' : 'cedente paga'})
                              </span>
                            </span>
                            <button onClick={() => rimuoviBonusRow(idx)} style={{ padding: "2px 8px", borderRadius: 5, border: "none", background: "#ef444418", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Draft nuovo bonus */}
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.5fr auto", gap: 6, alignItems: "end" }}>
                      <div>
                        <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>TIPO</div>
                        <select style={{ ...sel, fontSize: 11 }} value={bonusDraft.tipo_bonus} onChange={e => setBonusDraft(b => ({ ...b, tipo_bonus: e.target.value }))}>
                          {TIPI_BONUS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>SOGLIA</div>
                        <input style={{ ...inp, fontSize: 11 }} type="number" min="1" placeholder="es. 10" value={bonusDraft.soglia} onChange={e => setBonusDraft(b => ({ ...b, soglia: e.target.value }))} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>MΛN</div>
                        <input style={{ ...inp, fontSize: 11 }} type="number" step="0.5" min="0.1" placeholder="es. 2" value={bonusDraft.valore_mln} onChange={e => setBonusDraft(b => ({ ...b, valore_mln: e.target.value }))} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>CHI PAGA</div>
                        <select style={{ ...sel, fontSize: 11 }} value={bonusDraft.direzione} onChange={e => setBonusDraft(b => ({ ...b, direzione: e.target.value }))}>
                          <option value="acquirente_paga">Acquirente</option>
                          <option value="cedente_paga">Cedente</option>
                        </select>
                      </div>
                      <button onClick={aggiungiBonusDraft} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#6366f133", color: "#818cf8", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+</button>
                    </div>
                    <div style={{ fontSize: 9, color: "#555", marginTop: 4 }}>I bonus vengono controllati automaticamente ad ogni aggiornamento del listone</div>
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
                    const daTeam = TEAMS.find(x => x.name === t.da_squadra);
                    const aTeam  = TEAMS.find(x => x.name === t.a_squadra);
                    const isRicevente = t.a_squadra === mySquadra;
                    const canRispondi = isRicevente || isAdmin;
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
                                Valore: {(Number(t.quot_giocatore) * 1.75).toFixed(2)}M · Al venditore: {(Number(t.quot_giocatore) * 1.75 * 5/7).toFixed(2)}M (art. 5.5.2)
                              </div>
                              <button onClick={async () => {
                                const prezzoClaus = parseFloat((Number(t.quot_giocatore) * 1.75).toFixed(2));
                                if (!window.confirm(`Attivare clausola rescissoria per ${t.giocatore}?\nCosto: ${prezzoClaus}M (al venditore: ${(prezzoClaus*5/7).toFixed(2)}M)\nIl proprietario non può rifiutarsi.`)) return;
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
                  <input style={inp} placeholder="Nome" value={astaForm.giocatore} onChange={e => setAstaForm(f => ({ ...f, giocatore: e.target.value }))} />
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
              const minsPassati = Math.floor((now - new Date(a.avviata_at)) / 60000);
              const scadFra = a.scadenza_asta ? Math.max(0, Math.round((new Date(a.scadenza_asta) - now) / 60000)) : null;

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
                        {a.tipo_asta === 'discesa' ? `− ${Math.floor(minsPassati/30) * 0.25}M in ${minsPassati}min` : ""}
                      </div>
                    </div>
                  </div>

                  {a.tipo_asta === 'rialzo' && (
                    <div style={{ marginBottom: 10 }}>
                      {scadFra !== null && <div style={{ fontSize: 11, color: scadFra < 30 ? "#ef4444" : "#888", marginBottom: 6 }}>⏱ Scade in {scadFra < 60 ? `${scadFra} min` : `${Math.floor(scadFra/60)}h ${scadFra%60}min`}{horaCongelata ? " (CONGELATO)" : ""}</div>}
                      {a.proprietario !== mySquadra && !isAdmin && !horaCongelata && (
                        <button onClick={() => faiOffertaRialzo(a)} style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "#f59e0b", color: "#000", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                          📈 Offri {minRilancio}M
                        </button>
                      )}
                    </div>
                  )}

                  {a.tipo_asta === 'discesa' && (
                    <div style={{ marginBottom: 10 }}>
                      {isFloor
                        ? <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700 }}>⛔ Asta scaduta — prezzo minimo raggiunto</div>
                        : a.proprietario !== mySquadra && !isAdmin && (
                          <button onClick={() => acquistaDiscesa(a)} style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "#f59e0b", color: "#000", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                            🛒 Acquista ora a {prezzoLive.toFixed(2)}M
                          </button>
                        )
                      }
                    </div>
                  )}

                  {a.note && <div style={{ fontSize: 11, color: "#888", borderTop: "1px solid #ffffff0a", paddingTop: 8 }}>📝 {a.note}</div>}
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
              const daTeam = TEAMS.find(x => x.name === t.da_squadra);
              const aTeam  = TEAMS.find(x => x.name === t.a_squadra);
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
                  {isAdmin && <button onClick={() => deleteTrattativa(t.id)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ef444415", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>✕</button>}
                </div>
              );
            })
          }

          {/* Aste concluse */}
          {asteChiuse.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginTop: 16, marginBottom: 6 }}>🏷️ ASTE CONCLUSE</div>
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
        </div>
      )}

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
function ChiamataCard({ chiamateGiocatore, mySquadra, isAdmin, onInteresse, onRefresh, aste }) {
  const [saving, setSaving] = useState(false);

  // Guard: se array vuoto o dati mancanti, non renderizzare
  if (!chiamateGiocatore?.length) return null;

  const primaria = chiamateGiocatore.find(c => c.tipo === 'prima') || chiamateGiocatore[0];
  if (!primaria) return null;

  const interessati = chiamateGiocatore.map(c => c.squadra);
  const giaInteressato = interessati.includes(mySquadra);

  // scadenza_interesse potrebbe essere null su chiamate vecchie → fallback a +72h
  const scadInt = primaria.scadenza_interesse
    ? new Date(primaria.scadenza_interesse)
    : new Date(new Date(primaria.created_at || Date.now()).getTime() + 72 * 60 * 60 * 1000);
  const scadutaInteresse = new Date() > scadInt;

  const astaAttiva = aste?.find(a => a.giocatore === primaria.giocatore && a.stato === 'raccolta_offerte');
  const astaAssegnata = aste?.find(a => a.giocatore === primaria.giocatore && a.stato === 'assegnata');

  async function handleInteresse(perVivaio) {
    setSaving(true);
    try {
      await aggiungiInteresse(primaria.giocatore, mySquadra, perVivaio);
      await onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  const isCandidatoVivaio = primaria.anni <= 23 && primaria.quot <= 3;

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
          {!astaAttiva && !astaAssegnata && !giaInteressato && !scadutaInteresse && mySquadra && (
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
          {giaInteressato && !astaAttiva && !astaAssegnata && (
            <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600 }}>✅ Sei interessato</span>
          )}
        </div>
      </div>

      {/* Form offerta se asta attiva */}
      {astaAttiva && giaInteressato && (
        <OffertaInlineForm asta={astaAttiva} squadra={mySquadra} onRefresh={onRefresh} />
      )}
    </div>
  );
}

// ── Form offerta busta chiusa ─────────────────────────────────────────────────
function OffertaInlineForm({ asta, squadra, onRefresh }) {
  const [offerta, setOfferta] = useState([]);
  const [importo, setImporto] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

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

  async function invia() {
    const val = parseFloat(importo);
    if (!val || val < minOfferta) { alert(`Min ${minOfferta}M`); return; }
    setSaving(true);
    try {
      await upsertOffertaAsta(asta.id, squadra, val, asta.per_vivaio);
      const offs = await getOfferteAsta(asta.id);
      setOfferta(offs);
      await onRefresh();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return null;
  if (scaduta) return <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>Asta scaduta — elaborazione in corso...</div>;

  return (
    <div style={{ marginTop: 10, background: "#6366f108", borderRadius: 9, padding: "10px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
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
  const [editSvincolato, setEditSvincolato] = useState(null);
  const [importando, setImportando]   = useState(false);
  const [now, setNow]                 = useState(new Date());
  const mySquadra = profile?.squadra;

  // Tick ogni 30s per aggiornare countdown
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    const [chiamateData, svincolatiData, asteData] = await Promise.all([
      getChiamate(), getSvincolatiDB(), getAsteSvincolati()
    ]);
    if (chiamateData) setChiamate(chiamateData);
    if (svincolatiData) setSvincolatiDB(svincolatiData);
    setAste(asteData);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const sub1 = subscribeChiamate(loadAll);
    const sub2 = subscribeAsteSvincolati(loadAll);
    return () => { supabase.removeChannel(sub1); supabase.removeChannel(sub2); };
  }, [loadAll]);

  // Check scadenze ogni minuto
  useEffect(() => {
    const t = setInterval(() => checkScadenzeAste().then(r => { if (r.length) loadAll(); }), 60000);
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
    const finestra = getFinestraChiamate();
    if (!finestra.aperta && !isAdmin) {
      alert(`⛔ Finestra chiusa\n\n${finestra.messaggio}`); return;
    }
    const squadra = isAdmin ? callTeam : mySquadra;
    const giaChiamato = chiamate.some(c =>
      c.giocatore === player.nome && c.squadra === squadra && c.stato !== 'conclusa'
    );
    if (giaChiamato) { alert("Hai già manifestato interesse per questo giocatore"); return; }

    await insertChiamata({
      giocatore: player.nome, ruolo: player.ruolo, quot: player.quot,
      anni: player.anni || 0, squadra_serie_a: player.squadra_serie_a || '',
      squadra, per_vivaio: perVivaio,
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
                />
              );
            } catch(e) {
              return <div key={i} style={{ fontSize: 11, color: "#ef4444", padding: 8 }}>Errore card: {e.message}</div>;
            }
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

      {/* ── FORM CHIAMATA ── */}
      {showCallForm && (
        <div style={{ background: "#f59e0b0f", border: "1.5px solid #f59e0b33", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#e0e0e0", fontWeight: 600, flex: 1 }}>
              📞 Chiama <b style={{ color: "#f59e0b" }}>{showCallForm.nome}</b>
              <span style={{ fontSize: 10, color: "#888", marginLeft: 6 }}>Q{showCallForm.quot} · {showCallForm.ruolo} · {showCallForm.anni}aa</span>
            </span>
            {isAdmin
              ? <select style={inpStyle} value={callTeam} onChange={e => setCallTeam(e.target.value)}>
                  {TEAMS.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              : <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 700 }}>{mySquadra}</span>}
          </div>
          {showCallForm.isVivaio && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "#10b981" }}>
              <input type="checkbox" checked={callVivaio} onChange={e => setCallVivaio(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "#10b981" }} />
              🌱 Acquisto per il <b>Vivaio</b>
            </label>
          )}
          {/* Preview scadenze */}
          <div style={{ fontSize: 10, color: "#555", background: "#ffffff06", borderRadius: 8, padding: "8px 10px", lineHeight: 1.7 }}>
            {(() => {
              const scInt = calcolaScadenzaInteresse();
              const scOff = calcolaScadenzaOfferte(scInt);
              const minOfferta = parseFloat((showCallForm.quot * 0.75).toFixed(2));
              return <>
                📅 Interesse aperto fino a: <b style={{ color: "#f59e0b" }}>{scInt.toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</b><br/>
                🏷️ Se più interessati → asta busta chiusa, scadenza offerte: <b style={{ color: "#818cf8" }}>{scOff.toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</b> (slot scalare)<br/>
                <span style={{ color: "#10b981" }}>✓ Se solo tu sei interessato → giocatore a <b>¾Q = {minOfferta}M</b> automaticamente</span>
              </>;
            })()}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => chiamaGiocatore(showCallForm, callVivaio)}
              style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "#f59e0b", color: "#000", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ✓ Manifesta interesse
            </button>
            <button onClick={() => { setShowCallForm(null); setCallVivaio(false); }}
              style={{ padding: "8px 12px", borderRadius: 9, border: "none", background: "#ffffff10", color: "#888", fontSize: 13, cursor: "pointer" }}>✕</button>
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
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
                <div style={{ maxHeight: 360, overflowY: "auto", background: "#ffffff06", borderRadius: 10, border: "1px solid #ffffff10" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
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
          <button key={t.id} onClick={() => setSquadraSelezionata(t.name)} style={{ padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${squadraSelezionata === t.name ? t.color : "#ffffff12"}`, background: squadraSelezionata === t.name ? t.color + "22" : "transparent", color: squadraSelezionata === t.name ? t.color : "#666", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {t.tag}
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
  const STAGIONE = '2025-26';

  const emptyForm = { squadra: teams[0]?.name || "", tipo: "multa_mln", importo: "", motivo: "", codice_tipo: "", note: "" };
  const [form, setForm] = useState(emptyForm);

  const loadAll = useCallback(async () => {
    const data = await getPenalita(null, STAGIONE);
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
      await insertPenalita({ ...form, importo: parseFloat(form.importo), stagione: STAGIONE, n_recidiva: nRec, data_multa: new Date().toISOString().slice(0,10) });
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
          <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Registro sanzioni · stagione {STAGIONE}</p>
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
                  <div style={{ fontSize: 11, color: "#666" }}>{pens.length} sanzioni · {STAGIONE}</div>
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
function PremiPage({ isAdmin, teams = [] }) {
  const [premi, setPremi] = useState([]);
  const [classifica, setClassifica] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [montepremi, setMontepremi] = useState(0);
  const STAGIONE = '2025-26';

  const loadAll = useCallback(async () => {
    const [p, c] = await Promise.all([getPremi(STAGIONE), getClassifica()]);
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
    setSaving(true);
    try {
      for (const p of premi19a) {
        const rec = await insertPremio({ squadra: p.squadra, tipo: 'premio_19a', importo: p.importo, posizione: p.posizione, stagione: STAGIONE, data_premio: new Date().toISOString().slice(0,10) });
        await applicaPremio(p.squadra, p.importo, '19ª giornata', rec.id);
      }
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleApplicaPremiFinali() {
    if (!window.confirm("Applicare i premi finali a tutte le squadre?\n\nQuesti si sommano ai premi coppa se inseriti.")) return;
    setSaving(true);
    try {
      for (const p of premiFinali) {
        const rec = await insertPremio({ squadra: p.squadra, tipo: 'premio_finale', importo: p.importo, posizione: p.posizione, stagione: STAGIONE, data_premio: new Date().toISOString().slice(0,10) });
        await applicaPremio(p.squadra, p.importo, `Premio finale (${p.posizione}°)`, rec.id);
      }
      await loadAll();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  const premiApplicati = {
    p19: premi.some(p => p.tipo === 'premio_19a'),
    finale: premi.some(p => p.tipo === 'premio_finale'),
  };

  const inp = { padding: "7px 10px", borderRadius: 7, border: "1px solid #ffffff18", background: "#0d0f14", color: "#f0f0f0", fontSize: 12, width: "100%" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>PREMI</h1>
        <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>Premi invernali e di fine stagione · {STAGIONE}</p>
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
            [1,20],[2,25],[3,30],[4,35],[5,40],[6,45],[7,50],[8,55]
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

      {/* ── 4. PREMI IN € (art. 12.4) ── */}
      <div style={{ background: "#ffffff06", border: "1.5px solid #ffffff12", borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.1em", marginBottom: 12 }}>💶 PREMI IN EURO REALI (art. 12.4)</div>
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

      {/* ── 5. STORICO PREMI APPLICATI ── */}
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
    const t = setInterval(loadLog, 30000);
    return () => clearInterval(t);
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
    deposito_fiduciario:  { icon: "🏦", color: "#10b981", label: "Deposito" },
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
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>Stagione 2025/26</div>
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
export default function App() {
  const [page, setPage] = useState("squadre");
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  // Auth
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Live data
  const [squadreDB, setSquadreDB] = useState([]);
  const [fpfMap, setFpfMap] = useState({});
  const [clubIdentities, setClubIdentities] = useState({});
  const [offerteInAttesa, setOfferteInAttesa] = useState([]); // notifiche offerte ricevute

  // Session check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    try { setProfile(await getProfile(userId)); } catch {}
    setAuthLoading(false);
  }

  // Load + subscribe squadre
  useEffect(() => {
    if (!session) return;
    getSquadre().then(data => { if (data) setSquadreDB(data); });
    const sub = subscribeSquadre(() => getSquadre().then(data => { if (data) setSquadreDB(data); }));
    return () => supabase.removeChannel(sub);
  }, [session]);

  // Polling notifiche offerte ricevute (ogni 60s)
  useEffect(() => {
    if (!session || !profile?.squadra) return;
    const load = () => getOfferteInAttesa(profile.squadra).then(setOfferteInAttesa);
    load();
    const t = setInterval(load, 60000);
    const sub = supabase.channel('trattative-notif')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trattative' }, load)
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(sub); };
  }, [session, profile?.squadra]);

  // Carica FPF (netto speso semestre) per tutte le squadre
  useEffect(() => {
    if (!session) return;
    getFpfTutteSquadre().then(map => setFpfMap(map));
    // Refresh ogni 60 secondi
    const interval = setInterval(() => getFpfTutteSquadre().then(setFpfMap), 60 * 1000);
    // Refresh immediato quando cambiano i movimenti (Realtime)
    const sub = subscribeMovimentiAll(() => getFpfTutteSquadre().then(setFpfMap));
    return () => { clearInterval(interval); supabase.removeChannel(sub); };
  }, [session]);

  // Carica identità club (stemma + maglie) per tutte le squadre
  useEffect(() => {
    if (!session) return;
    function loadIdentities() {
      getAllClubIdentities().then(rows => {
        const map = {};
        for (const r of rows || []) {
          map[r.squadra] = {
            stemma_url: r.stemma_url,
            maglia_casa_url: r.maglia_casa_url,
            maglia_trasferta_url: r.maglia_trasferta_url,
            maglia_terza_url: r.maglia_terza_url,
          };
        }
        setClubIdentities(map);
      });
    }
    loadIdentities();
    // Refresh su cambi nella tabella club_identity
    const sub = supabase.channel('club-identity-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_identity' }, loadIdentities)
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [session]);

  // Merge DB data into TEAMS — aggiunge fpf calcolato dai movimenti + stemma/maglie
  const mergedTeams = TEAMS.map(t => {
    const db = squadreDB.find(s => s.name === t.name);
    const ci = clubIdentities[t.name] || {};
    const base = {
      stemma_url: ci.stemma_url || null,
      maglia_casa_url: ci.maglia_casa_url || null,
      maglia_trasferta_url: ci.maglia_trasferta_url || null,
      maglia_terza_url: ci.maglia_terza_url || null,
    };
    if (!db) return { ...t, ...base, fpf: fpfMap[t.name] ?? null };
    return { ...t, ...base, bilancio: db.bilancio, salaryUsed: db.salary_used, giocatori: db.giocatori, u21: db.u21, fairPlay1: db.fair_play1, fairPlay2: db.fair_play2, penalita: db.penalita, guadGiornate: db.guad_giornate, guadObiettivi: db.guad_obiettivi, guadInv: db.guad_inv, clausoleIn: db.clausole_in, clausoleOut: db.clausole_out, euroInvestiti: db.euro_investiti || 0, mlnExtra: db.mln_extra || 0, euroBiennio: db.euro_biennio || 0, scNegativoDal: db.sc_negativo_dal || null, mercatoBloccato: db.mercato_bloccato || false, bilancioNegDal: db.bilancio_neg_dal || null, bilancioNegSettimane: db.bilancio_neg_settimane || 0, fallimento: db.fallimento || false, fallimentoDal: db.fallimento_dal || null, fpf: fpfMap[t.name] ?? null, biennio: db.biennio || '2025-27', quotaPagata: db.quota_pagata || false, iscrizionePagata: db.iscrizione_pagata || false };
  });

  // Screen size
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  function handleSelectTeam(team) { setSelectedTeam(team); setPage("presidente"); }
  function handleBack() { setPage("squadre"); setSelectedTeam(null); }

  const isAdmin = profile?.ruolo === "admin";
  const mySquadra = profile?.squadra;

  const navItems = [
    { key: "squadre",    icon: "🏟", label: "Squadre"    },
    { key: "lega",       icon: "📊", label: "Lega"       },
    { key: "mercato",    icon: "🤝", label: "Mercato"    },
    { key: "svincolati", icon: "🔍", label: "Svincolati" },
    { key: "deadline",   icon: "📅", label: "Deadline"   },
    { key: "penalita",   icon: "⚠️", label: "Penalità"   },
    { key: "premi",      icon: "🏆", label: "Premi"      },
  ];
  const SIDEBAR_W = 220;

  // Loading screen
  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#0d0f14", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#555", fontSize: 14 }}>Caricamento...</div>
    </div>
  );

  // Login screen
  if (!session) return <LoginPage onLogin={() => {}} />;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f14", fontFamily: "'Inter',system-ui,sans-serif", color: "#f0f0f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        body{background:#0d0f14}
      `}</style>

      {isDesktop ? (
        /* ── DESKTOP ── */
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <div style={{ width: SIDEBAR_W, flexShrink: 0, background: "#0a0c11", borderRight: "1px solid #ffffff0e", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, height: "100vh", zIndex: 100 }}>

            {/* Logo */}
            <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid #ffffff0a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>⚽</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px", lineHeight: 1 }}>FANTA</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px", lineHeight: 1 }}>MANAGERIALE</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>2025/26</div>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav style={{ padding: "14px 12px", flex: 1, overflowY: "auto" }}>
              {navItems.map(item => {
                const active = page === item.key || (page === "presidente" && item.key === "squadre");
                const badge = item.key === "mercato" && offerteInAttesa.length > 0 ? offerteInAttesa.length : 0;
                return (
                  <button key={item.key} onClick={() => { setPage(item.key); if (item.key !== "squadre") setSelectedTeam(null); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "none", background: active ? "#6366f122" : "transparent", color: active ? "#818cf8" : "#666", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 4, textAlign: "left", position: "relative" }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#ffffff08"; e.currentTarget.style.color = "#aaa"; } }}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#666"; } }}>
                    <span style={{ fontSize: 18, position: "relative" }}>
                      {item.icon}
                      {badge > 0 && (
                        <span style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", color: "#fff", borderRadius: "50%", fontSize: 8, width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, lineHeight: 1 }}>{badge}</span>
                      )}
                    </span>
                    {item.label}
                    {badge > 0 && !active && <span style={{ marginLeft: "auto", fontSize: 9, color: "#ef4444", fontWeight: 800 }}>{badge} nuov{badge === 1 ? "a" : "e"}</span>}
                    {active && <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#6366f1" }} />}
                  </button>
                );
              })}

              {/* Admin-only section */}
              {isAdmin && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.1em", fontWeight: 700, padding: "0 12px", marginBottom: 8 }}>⚡ ADMIN</div>
                  {[{ key: "modifica", icon: "✏️", label: "Modifica Rose" }, { key: "adminlog", icon: "🗂️", label: "Audit Log" }].map(item => {
                    const active = page === item.key;
                    return (
                      <button key={item.key} onClick={() => { setPage(item.key); setSelectedTeam(null); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "none", background: active ? "#f59e0b22" : "transparent", color: active ? "#f59e0b" : "#666", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 4, textAlign: "left" }}
                        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#ffffff08"; e.currentTarget.style.color = "#aaa"; } }}
                        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#666"; } }}>
                        <span style={{ fontSize: 18 }}>{item.icon}</span>
                        {item.label}
                        {active && <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />}
                      </button>
                    );
                  })}
                </div>
              )}

              {page === "presidente" && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.1em", fontWeight: 700, padding: "0 12px", marginBottom: 8 }}>PRESIDENTI</div>
                  {mergedTeams.map(t => (
                    <button key={t.id} onClick={() => handleSelectTeam(t)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 8, border: "none", background: selectedTeam?.id === t.id ? t.color + "22" : "transparent", cursor: "pointer", marginBottom: 2 }}
                      onMouseEnter={e => { if (selectedTeam?.id !== t.id) e.currentTarget.style.background = "#ffffff08"; }}
                      onMouseLeave={e => { if (selectedTeam?.id !== t.id) e.currentTarget.style.background = "transparent"; }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: `linear-gradient(135deg,${t.color}cc,${t.color}44)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 900, color: "#fff", fontFamily: "'Bebas Neue',sans-serif", flexShrink: 0 }}>{t.tag}</div>
                      <span style={{ fontSize: 12, color: selectedTeam?.id === t.id ? t.color : "#888", fontWeight: selectedTeam?.id === t.id ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </nav>

            {/* User info + logout */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid #ffffff0a" }}>
              {profile && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#ffffff12", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>👤</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.nome || profile.email}</div>
                    <div style={{ fontSize: 10, color: "#555" }}>{isAdmin ? "⚡ Admin" : profile.squadra}</div>
                  </div>
                </div>
              )}
              <button onClick={() => signOut()} style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #ffffff10", background: "transparent", color: "#555", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Esci
              </button>
            </div>
          </div>

          {/* Main content */}
          <div style={{ marginLeft: SIDEBAR_W, flex: 1, padding: "28px 32px", minWidth: 0 }}>
            {page === "squadre"    && <SquadrePage onSelectTeam={t => handleSelectTeam(mergedTeams.find(m => m.id === t.id) || t)} teams={mergedTeams} profile={profile} isAdmin={isAdmin} />}
            {page === "lega"       && <LegaPage teams={mergedTeams} />}
            {page === "mercato"    && <MercatoPage profile={profile} isAdmin={isAdmin} teams={mergedTeams} offerteInAttesa={offerteInAttesa} />}
            {page === "svincolati" && <SvincolatiPage profile={profile} isAdmin={isAdmin} teams={mergedTeams} />}
            {page === "deadline"   && <DeadlinePage isAdmin={isAdmin} />}
            {page === "penalita"   && <PenalitaPage isAdmin={isAdmin} teams={mergedTeams} />}
            {page === "premi"      && <PremiPage isAdmin={isAdmin} teams={mergedTeams} />}
            {page === "modifica"   && isAdmin && mergedTeams.length > 0 && <ModificaRosePage teams={mergedTeams} isAdmin={isAdmin} onRefresh={() => getSquadre().then(data => { if (data) setSquadreDB(data); })} />}
            {page === "adminlog"  && isAdmin && <AdminLogPage profile={profile} />}
            {page === "presidente" && selectedTeam && <PresidentePage team={selectedTeam} onBack={handleBack} isAdmin={isAdmin} mySquadra={mySquadra} />}
          </div>
        </div>

      ) : (
        /* ── MOBILE ── */
        <div style={{ paddingBottom: 72 }}>
          {page !== "presidente" && (
            <div style={{ borderBottom: "1px solid #ffffff0e", background: "#0d0f14f0", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100, padding: "0 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 50 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚽</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#f0f0f0", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: "1px" }}>FANTA MANAGERIALE</div>
                </div>
                <button onClick={() => signOut()} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #ffffff12", background: "transparent", color: "#555", fontSize: 11, cursor: "pointer" }}>Esci</button>
              </div>
            </div>
          )}

          <div style={{ padding: "16px 14px" }}>
            {page === "squadre"    && <SquadrePage onSelectTeam={t => handleSelectTeam(mergedTeams.find(m => m.id === t.id) || t)} teams={mergedTeams} profile={profile} isAdmin={isAdmin} />}
            {page === "lega"       && <LegaPage teams={mergedTeams} />}
            {page === "mercato"    && <MercatoPage profile={profile} isAdmin={isAdmin} teams={mergedTeams} offerteInAttesa={offerteInAttesa} />}
            {page === "svincolati" && <SvincolatiPage profile={profile} isAdmin={isAdmin} teams={mergedTeams} />}
            {page === "deadline"   && <DeadlinePage isAdmin={isAdmin} />}
            {page === "penalita"   && <PenalitaPage isAdmin={isAdmin} teams={mergedTeams} />}
            {page === "premi"      && <PremiPage isAdmin={isAdmin} teams={mergedTeams} />}
            {page === "modifica"   && isAdmin && mergedTeams.length > 0 && <ModificaRosePage teams={mergedTeams} isAdmin={isAdmin} onRefresh={() => getSquadre().then(data => { if (data) setSquadreDB(data); })} />}
            {page === "adminlog"  && isAdmin && <AdminLogPage profile={profile} />}
            {page === "presidente" && selectedTeam && <PresidentePage team={selectedTeam} onBack={handleBack} isAdmin={isAdmin} mySquadra={mySquadra} />}
          </div>

          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#13151cee", backdropFilter: "blur(16px)", borderTop: "1px solid #ffffff10", display: "flex", zIndex: 200, height: 68 }}>
            {navItems.map(item => {
              const active = page === item.key || (page === "presidente" && item.key === "squadre");
              return (
                <button key={item.key} onClick={() => { setPage(item.key); if (item.key !== "squadre") setSelectedTeam(null); }} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, border: "none", background: "transparent", cursor: "pointer", padding: "8px 0", position: "relative" }}>
                  {active && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 28, height: 3, borderRadius: "0 0 3px 3px", background: "#6366f1" }} />}
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: active ? "#6366f1" : "#666" }}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
