// ── Button — Primary / Secondary / Ghost / Destructive ──────────────────────
// Componente di presentazione puro: non contiene business logic. onClick e
// disabled arrivano dal chiamante esattamente come per un <button> nativo,
// così sostituire un bottone inline esistente non richiede toccare i
// gestori/le funzioni già presenti in App.jsx.

import { BRAND, SEMANTIC, RADIUS, SPACE, FONT, MIN_TOUCH } from '../../design-system.js';

const VARIANTS = {
  primary: {
    background: BRAND.primary,
    color: '#fff',
    border: 'none',
  },
  secondary: {
    background: '#ffffff0f',
    color: '#ddd',
    border: '1px solid #ffffff18',
  },
  ghost: {
    background: 'transparent',
    color: '#999',
    border: 'none',
  },
  destructive: {
    background: SEMANTIC.danger + '18',
    color: SEMANTIC.danger,
    border: 'none',
  },
};

export function Button({
  variant = 'primary',
  size = 'md', // 'sm' | 'md'
  fullWidth = false,
  disabled = false,
  style,
  children,
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const padY = size === 'sm' ? SPACE.sm : SPACE.md;
  return (
    <button
      disabled={disabled}
      style={{
        ...v,
        width: fullWidth ? '100%' : undefined,
        minHeight: MIN_TOUCH,
        padding: `${padY}px ${SPACE.lg}px`,
        borderRadius: RADIUS.control,
        fontFamily: FONT.body,
        fontWeight: 700,
        fontSize: size === 'sm' ? 12.5 : 13.5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACE.xs,
        transition: 'opacity 0.15s, background 0.15s',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// Bottone icona quadrato, touch target 44x44 come richiesto per mobile.
export function IconButton({ style, children, ...rest }) {
  return (
    <button
      style={{
        width: MIN_TOUCH, height: MIN_TOUCH,
        borderRadius: RADIUS.control,
        border: '1px solid #ffffff12',
        background: '#ffffff08',
        color: '#aaa',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
