// ── Badge — ruolo Mantra + semantico ────────────────────────────────────────
// RoleBadge riusa 1:1 la mappatura colore già esistente in data.js
// (getRoleColor/ROLE_COLORS) — non introduce una nuova palette, uniforma solo
// altezza/padding/radius/font come richiesto (punto 12 del brief).
// SemanticBadge copre le 4 categorie: neutral/success/warning/danger.

import { getRoleColor } from '../../design-system.js';
import { SEMANTIC, RADIUS, FONT } from '../../design-system.js';

const BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: 10,
  lineHeight: 1,
  padding: '4px 7px',
  borderRadius: RADIUS.small - 2, // 6px, coerente con badge piccoli esistenti
  whiteSpace: 'nowrap',
};

// Mostra sempre il ruolo Mantra REALE (es. "Dd;Dc", "B;Ds;E") — non lo
// semplifica mai in POR/DIF/CEN/ATT.
export function RoleBadge({ ruolo, style, ...rest }) {
  const rc = getRoleColor(ruolo);
  return (
    <span
      style={{
        ...BASE,
        background: rc.bg,
        color: rc.text,
        border: `1px solid ${rc.border}`,
        ...style,
      }}
      {...rest}
    >
      {ruolo}
    </span>
  );
}

const SEMANTIC_MAP = {
  neutral: { bg: '#ffffff11', text: '#aaa', border: '#ffffff22' },
  success: { bg: SEMANTIC.success + '22', text: SEMANTIC.success, border: SEMANTIC.success + '44' },
  warning: { bg: SEMANTIC.warning + '22', text: SEMANTIC.warning, border: SEMANTIC.warning + '44' },
  danger:  { bg: SEMANTIC.danger  + '22', text: SEMANTIC.danger,  border: SEMANTIC.danger  + '44' },
};

export function SemanticBadge({ tone = 'neutral', children, style, ...rest }) {
  const c = SEMANTIC_MAP[tone] || SEMANTIC_MAP.neutral;
  return (
    <span
      style={{
        ...BASE,
        fontFamily: FONT.body,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        borderRadius: RADIUS.pill,
        padding: '4px 9px',
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}

// Pillola tonda, per stati compatti dentro liste dense (es. U21).
export function Pill({ tone = 'neutral', children, style, ...rest }) {
  const c = SEMANTIC_MAP[tone] || SEMANTIC_MAP.neutral;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        fontFamily: FONT.body, fontWeight: 700, fontSize: 9,
        background: c.bg, color: c.text,
        padding: '2px 6px', borderRadius: RADIUS.pill,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
