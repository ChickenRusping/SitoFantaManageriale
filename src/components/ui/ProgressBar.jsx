// ── ProgressBar — Salary Cap e altri limiti ─────────────────────────────────
// Sostituisce la rappresentazione "Bilancio / SC usato / SC libero" a 3 box
// con un'unica barra + cifra disponibile, come richiesto (punto 8/16). Il
// CALCOLO di used/limite/sforamento resta identico a quello già presente in
// App.jsx (salaryCapUsato, salaryCapLimite, salaryCapSforato) — questo
// componente riceve solo i numeri già calcolati, non li ricalcola.

import { SEMANTIC, BRAND, RADIUS, FONT } from '../../design-system.js';
import { IconAlert } from './Icons.jsx';

export function ProgressBar({
  label,
  used,
  limit,
  formatValue = (n) => `${n.toFixed(1)}M`,
  overLimit = false, // passato dal chiamante — usa la stessa logica esistente (es. salaryCapSforato)
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const barColor = overLimit ? SEMANTIC.danger : BRAND.primary;
  const disponibile = limit - used;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7D879B', marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontFamily: FONT.mono }}>{formatValue(used)} / {formatValue(limit)}</span>
      </div>
      <div style={{ height: 6, borderRadius: RADIUS.pill, background: '#1C2230', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: RADIUS.pill, background: barColor, transition: 'width 0.2s' }} />
      </div>
      {overLimit ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: SEMANTIC.danger, marginTop: 4, fontWeight: 700 }}>
          <IconAlert size={13} /> {formatValue(Math.abs(disponibile))} oltre il limite
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: SEMANTIC.success, marginTop: 4 }}>
          {formatValue(disponibile)} disponibili
        </div>
      )}
    </div>
  );
}
