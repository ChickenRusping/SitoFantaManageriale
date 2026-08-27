// ── Surface — due sole famiglie di card ─────────────────────────────────────
// "standard": contenuto, sola lettura o azioni interne (bottoni propri).
// "interactive": l'intera card è cliccabile (riga squadra, riga giocatore
// compatta, ecc.) — aggiunge hover/tap feedback e cursor pointer.
// Deliberatamente NON ne esistono altre varianti: qualsiasi nuova esigenza
// visiva si ottiene componendo dentro una di queste due, non creandone una
// terza (punto 48 del brief: "due sole famiglie, non venti variazioni").

import { SURFACE, RADIUS, SPACE } from '../../design-system.js';

export function Surface({ interactive = false, density = 'standard', style, children, ...rest }) {
  const padY = density === 'compact' ? SPACE.sm : density === 'spacious' ? SPACE.lg : SPACE.md;
  return (
    <div
      style={{
        background: SURFACE.card,
        border: `1px solid ${SURFACE.border}`,
        borderRadius: RADIUS.card,
        padding: `${padY}px ${SPACE.lg}px`,
        cursor: interactive ? 'pointer' : 'default',
        transition: interactive ? 'background 0.15s' : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// Hero compatta (Club/Presidente, Player Detail) — unica variante "spacious"
// con superficie leggermente più chiara e radius maggiore.
export function HeroSurface({ style, children, ...rest }) {
  return (
    <div
      style={{
        background: SURFACE.card,
        borderRadius: RADIUS.hero,
        padding: SPACE.xl,
        textAlign: 'center',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// Riga sottile per liste dense (Rosa, Movimenti, Classifica) — non è una
// card, è un separatore leggero come richiesto per la Lista Premium.
export function Row({ style, children, ...rest }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SPACE.sm,
        padding: `${SPACE.sm}px 2px`,
        borderBottom: `1px solid ${SURFACE.border}`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
