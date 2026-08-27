// ── Icone SVG lineari coerenti ───────────────────────────────────────────
// Sostituiscono le emoji come sistema iconografico PRINCIPALE (bottom nav,
// header, azioni). Le emoji restano ammesse nei contenuti editoriali (Sala
// Stampa) dove hanno già un valore comunicativo — qui non le tocco.
// Tutte accettano `size` (default = ICON_SIZE.action) e passano ogni altra
// prop (es. style, className) all'<svg>.

import { ICON_SIZE } from '../../design-system.js';

function Icon({ size = ICON_SIZE.action, children, ...rest }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (props) => (
  <Icon {...props}><path d="M3 11l9-7 9 7M5 10v9h5v-6h4v6h5v-9" /></Icon>
);

export const IconShield = (props) => (
  <Icon {...props}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></Icon>
);

export const IconTrophy = (props) => (
  <Icon {...props}>
    <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0zM3 5h4v3a3 3 0 01-4 2.8zM21 5h-4v3a3 3 0 004 2.8z" />
  </Icon>
);

export const IconMarket = (props) => (
  <Icon {...props}><path d="M4 9h16M4 15h16M8 5l-4 4 4 4M16 11l4 4-4 4" /></Icon>
);

export const IconMore = (props) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconBack = (props) => (
  <Icon {...props}><path d="M15 18l-6-6 6-6" /></Icon>
);

export const IconBell = (props) => (
  <Icon {...props}>
    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </Icon>
);

export const IconClose = (props) => (
  <Icon {...props}><path d="M18 6L6 18M6 6l12 12" /></Icon>
);

export const IconChevronRight = (props) => (
  <Icon {...props}><path d="M9 18l6-6-6-6" /></Icon>
);

export const IconChevronDown = (props) => (
  <Icon {...props}><path d="M6 9l6 6 6-6" /></Icon>
);

export const IconSearch = (props) => (
  <Icon {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Icon>
);

export const IconFilter = (props) => (
  <Icon {...props}><path d="M4 5h16M7 12h10M10 19h4" /></Icon>
);

export const IconEdit = (props) => (
  <Icon {...props}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></Icon>
);

export const IconTrash = (props) => (
  <Icon {...props}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></Icon>
);

export const IconCheck = (props) => (
  <Icon {...props}><path d="M20 6L9 17l-5-5" /></Icon>
);

export const IconAlert = (props) => (
  <Icon {...props}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  </Icon>
);

export const IconAdmin = (props) => (
  <Icon {...props}><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" /></Icon>
);

export const IconArchive = (props) => (
  <Icon {...props}><path d="M4 19V5a2 2 0 012-2h11l3 3v13a2 2 0 01-2 2H6a2 2 0 01-2-2z" /></Icon>
);
