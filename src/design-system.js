// ── Design System — FantaManager redesign ──────────────────────────────────
// Token centralizzati per la nuova direzione "Football Professional + Fantasy
// Premium leggero". Nessun dato di business qui: solo spaziatura, colori di
// superficie/brand/semantici, tipografia, radius. I colori RUOLO (Mantra)
// restano quelli esistenti in data.js (ROLE_COLORS/getRoleColor) — qui non
// vengono ridefiniti, solo re-esportati per comodità di import unico.

export { ROLE_COLORS, getRoleColor, getSCColor, getFPStatus, FP_THRESHOLDS } from './data.js';

// ── Superfici (dark navy / charcoal) ────────────────────────────────────────
export const SURFACE = {
  bg:       '#0B0E14', // sfondo app
  card:     '#11151D', // card standard
  card2:    '#171C26', // sheet/body sotto header
  elevated: '#1C2230', // elementi in rilievo dentro una card (chip, pill attiva)
  border:   'rgba(255,255,255,0.07)', // border quasi invisibile
};

// ── Brand (indigo/viola, primary globale — usato con parsimonia) ───────────
export const BRAND = {
  primary: '#6C6FE0',
  primarySoft: '#6C6FE022',
  gold: '#E8B84B', // piccolo accento premium, mai come primary
};

// ── Semantic (separati da brand e da colore squadra) ────────────────────────
export const SEMANTIC = {
  success: '#4ADE80',
  warning: '#FBBF24',
  danger:  '#F87171',
  info:    '#60A5FA',
};

// ── Testo ────────────────────────────────────────────────────────────────
export const INK = {
  primary: '#E9ECF4',
  secondary: '#B9C1D3',
  soft: '#7D879B',
};

// ── Spacing scale (4/8/12/16/20/24/32) ──────────────────────────────────────
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

// ── Radius scale ─────────────────────────────────────────────────────────
export const RADIUS = { small: 8, control: 12, card: 16, hero: 20, pill: 999 };

// ── Tipografia (scala + famiglie) ───────────────────────────────────────────
// Inter per (quasi) tutto; Bebas Neue solo per nome club, valori grandi,
// classifiche/heading sportivi — mai per corpo di testo o tabelle dense.
export const FONT = {
  body: "'Inter',system-ui,sans-serif",
  display: "'Bebas Neue',sans-serif",
  mono: "'IBM Plex Mono',ui-monospace,monospace",
};

export const TYPE = {
  display: 32,
  h1: 24,
  h2: 20,
  h3: 16,
  body: 15,
  bodySm: 14,
  meta: 12,
  micro: 11, // eccezione, da evitare sotto questo
};

// ── Icone / stemmi (dimensioni standard) ────────────────────────────────────
export const ICON_SIZE = { inline: 16, action: 20, nav: 24 };
export const CREST_SIZE = { small: 24, medium: 44, large: 84 };

// ── Densità (tre livelli, come da spec) ─────────────────────────────────────
// 'compact'  → Rosa, Classifiche, Listone
// 'standard' → Mercato, News, notifiche
// 'spacious' → Club Hero, Player Detail, trofei
export const DENSITY = {
  compact:  { padY: SPACE.sm,  gap: SPACE.xs, fontSize: TYPE.bodySm },
  standard: { padY: SPACE.md,  gap: SPACE.sm, fontSize: TYPE.body },
  spacious: { padY: SPACE.lg,  gap: SPACE.md, fontSize: TYPE.body },
};

// ── Touch target minimo (mobile) ────────────────────────────────────────────
export const MIN_TOUCH = 44;
