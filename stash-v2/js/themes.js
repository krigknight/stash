// themes.js — styles (shape + type) and palettes (colors), each palette in light and dark.
// Everything is CSS custom properties: this only sets data-style / data-palette / data-mode on <html>.
export const STYLES = [
  { id: 'retro', name: 'Retro', desc: 'Pixel headings, typewriter text, hard edges, scanlines', font: '"VT323", monospace' },
  { id: 'clean', name: 'Clean', desc: 'Neutral sans, thin borders, small corners, light shadows', font: '"IBM Plex Sans", sans-serif' },
  { id: 'modern', name: 'Modern', desc: 'Rounded cards, soft depth, gentle gradients', font: '"Space Grotesk", sans-serif' },
];

// swatches: [background, ink, accent] for light and dark (must match css/app.css)
export const PALETTES = [
  { id: 'paper', name: 'Paper & Ink', light: ['#ffffff', '#161616', '#b4381a'], dark: ['#1b1b1b', '#ececec', '#ff8a5c'] },
  { id: 'phosphor', name: 'Phosphor Green', light: ['#ffffff', '#0f2a12', '#1f6f2c'], dark: ['#161a12', '#c8e6a0', '#ffb000'] },
  { id: 'amber', name: 'Amber', light: ['#ffffff', '#2a1a00', '#a34a00'], dark: ['#1a1308', '#ffcc66', '#ffb000'] },
  { id: 'ocean', name: 'Ocean', light: ['#ffffff', '#0b2540', '#0b6690'], dark: ['#0c1d2b', '#d3e9f6', '#4cc9ef'] },
];

const systemDark = matchMedia('(prefers-color-scheme: dark)');

/** Apply a profile's appearance to the page. Unknown values fall back to Retro / Paper & Ink / light. */
export function applyTheme(p) {
  const html = document.documentElement;
  html.dataset.style = STYLES.some((s) => s.id === p.style) ? p.style : 'retro';
  html.dataset.palette = PALETTES.some((x) => x.id === p.palette) ? p.palette : 'paper';
  html.dataset.mode = p.theme === 'dark' || (p.theme === 'auto' && systemDark.matches) ? 'dark' : 'light';
}

/** Call back when the system light/dark setting changes (matters for "Match system"). */
export function onSystemChange(fn) { systemDark.addEventListener('change', fn); }

export const isDark = () => document.documentElement.dataset.mode === 'dark';
export const styleId = () => document.documentElement.dataset.style || 'retro';
