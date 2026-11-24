import logoUrl from '../assets/logo.svg';

// Minimal inline icon set (stroke icons, 24px grid).
const PATHS: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  restart: 'M4 4v6h6M4.5 10A8 8 0 1 1 6 16.5',
  toStart: 'M5 5h2.5v14H5zM19 5.5v13L9.5 12z',
  back: 'M11.5 6v12L3.5 12zM20.5 6v12l-8-6z',
  forward: 'M3.5 6v12l8-6zM12.5 6v12l8-6z',
  caret: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 3-3L20 16M15.5 9a1 1 0 1 0 0-.01',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  font: 'M4 20l6-16h1l6 16M7 14h7',
  export: 'M12 15V3M7 8l5-5 5 5M5 14v6h14v-6',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  open: 'M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 2h8.5A1.5 1.5 0 0 1 21 7.5V9M3 9h18l-2 11H5z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  close: 'M6 6l12 12M18 6L6 18',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  warning: 'M12 4l9 16H3zM12 10v4M12 17v.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6M12 16.8v.01',
};

const FILLED = new Set(['play', 'pause', 'toStart', 'back', 'forward']);

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

// The app logo (also the window and installer icon, from build/icon.svg).
export function Logo({ size = 18 }: { size?: number }) {
  return <img className="logo" src={logoUrl} width={size} height={size} alt="" draggable={false} />;
}
