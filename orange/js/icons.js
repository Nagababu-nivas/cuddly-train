/*
 * Orange icon set — original, minimal stroke glyphs.
 * Keeps the UI dependency-free and crisp at every size.
 */

const ICONS = {
  play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.1-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.7" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.8" y="5" width="3.7" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  prev: '<path d="M19 6.5v11a1 1 0 0 1-1.55.83L9 12.8V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5.2l8.45-5.53A1 1 0 0 1 19 6.5Z" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 6.5v11a1 1 0 0 0 1.55.83L15 12.8V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v5.2L6.55 5.67A1 1 0 0 0 5 6.5Z" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M3 6h2.2c1.1 0 2.1.5 2.8 1.4l7.9 9.2c.7.9 1.7 1.4 2.8 1.4H21"/><path d="m18 15 3 3-3 3"/><path d="M3 18h2.2c1.1 0 2.1-.5 2.8-1.4l.8-1"/><path d="M14.2 8.4l.7-.9C15.6 6.6 16.6 6 17.7 6H21"/><path d="m18 3 3 3-3 3"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  'repeat-one': '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 10.5 12.5 10v4" stroke-width="1.6"/>',
  volume: '<path d="M11 5 6.8 8.4H3.5v7.2h3.3L11 19V5Z"/><path d="M15.2 8.4a5 5 0 0 1 0 7.2"/><path d="M17.8 6a8 8 0 0 1 0 12"/>',
  'volume-1': '<path d="M11 5 6.8 8.4H3.5v7.2h3.3L11 19V5Z"/><path d="M15.2 8.4a5 5 0 0 1 0 7.2"/>',
  'volume-x': '<path d="M11 5 6.8 8.4H3.5v7.2h3.3L11 19V5Z"/><path d="m16 9 5 5"/><path d="m21 9-5 5"/>',
  heart: '<path d="M20.8 5.7a5.4 5.4 0 0 0-7.7 0L12 6.8l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.7l1.1 1.1L12 22l7.7-7.5 1.1-1.1a5.4 5.4 0 0 0 0-7.7Z"/>',
  queue: '<path d="M4 6h11"/><path d="M4 11h11"/><path d="M4 16h7"/><path d="M18 13v8"/><path d="m21 18-3 3-3-3"/>',
  lyrics: '<path d="M4 5h16v10H8l-4 4V5Z"/><path d="M8 9h8"/><path d="M8 12h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.7-3.7"/>',
  close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-right': '<path d="m12 5 7 7-7 7"/><path d="M5 12h14"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-down': '<path d="m19 12-7 7-7-7"/><path d="M12 5v14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.37a1.7 1.7 0 0 0-1 .63 1.7 1.7 0 0 0-.37 1.06V21h-4v-.06A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-.63-1 1.7 1.7 0 0 0-1.06-.37H3v-4h.06A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-.63 1.7 1.7 0 0 0 .37-1.06V3h4v.06A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9c.15.4.39.75.7 1 .3.25.68.38 1.06.37H21v4h-.06A1.7 1.7 0 0 0 19.4 15Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  library: '<path d="M4 4h4v16H4z"/><path d="M10 4h3v16h-3z"/><path d="m15.5 5 3.5-1 4.3 15-3.5 1z"/>',
  listen: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z" fill="currentColor" stroke="none"/>',
  browse: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  radio: '<path d="M4.9 8.5h14.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4.9a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="m7 8.5 9-5.5"/><circle cx="8" cy="13.5" r="1"/><path d="M15 12.5h3"/><path d="M15 16h3"/>',
  songs: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  albums: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.3"/><path d="M12 3a9 9 0 0 1 9 9"/>',
  artists: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  playlist: '<path d="M4 6h10"/><path d="M4 11h10"/><path d="M4 16h6"/><circle cx="17" cy="17" r="3"/><path d="M20 17V8l3-1"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4"/><path d="m8.6 13.5 6.8 4"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  sparkles: '<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/><path d="m5 14 .7 2.3L8 17l-2.3.7L5 20l-.7-2.3L2 17l2.3-.7L5 14Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
  headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5V14Z"/><path d="M20 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5V14Z"/>',
  sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h2"/><path d="M10 12h10"/><circle cx="8" cy="12" r="2"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="18" r="2"/>',
  expand: '<path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M21 16v5h-5"/><path d="M3 16v5h5"/>',
  minimize: '<path d="M3 8h5V3"/><path d="M21 8h-5V3"/><path d="M16 21v-5h5"/><path d="M8 21v-5H3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 4h16"/>',
  'file-audio': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M10 18v-5l4-1v5"/><circle cx="9" cy="18" r="1.4"/><circle cx="13" cy="17" r="1.4"/>',
  'wifi-off': '<path d="m2 2 20 20"/><path d="M8.5 8.5A13 13 0 0 1 22 9"/><path d="M5 12.5a12 12 0 0 1 3.2-1.7"/><path d="M8.5 16a7 7 0 0 1 7 0"/><path d="M12 20h.01"/>',
  external: '<path d="M15 3h6v6"/><path d="m10 14 11-11"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v3"/><path d="M12 18v3"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/><path d="M8 21h8"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
  alert: '<path d="M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  cast: '<path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 12a8 8 0 0 1 8 8"/><path d="M2 16a4 4 0 0 1 4 4"/><path d="M2 20h.01"/>',
  pin: '<path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
  sort: '<path d="M8 4v16"/><path d="m4 8 4-4 4 4"/><path d="M16 20V4"/><path d="m12 16 4 4 4-4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="m3 3 18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.7"/><path d="M6.6 6.7A17 17 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4.1-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  speaker: '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="6" r="1"/>',
  wave: '<path d="M3 12h2"/><path d="M7 8v8"/><path d="M11 4v16"/><path d="M15 7v10"/><path d="M19 10v4"/>',
  'chevron-expand': '<path d="m7 9 5-5 5 5"/><path d="m7 15 5 5 5-5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 2 2"/><path d="m15 8 2 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><path d="M12 18h.01"/>',
};

export function icon(name, options = {}) {
  const opts = typeof options === 'number' ? { size: options } : options;
  const size = opts.size ?? 18;
  const cls = opts.cls ? ` ${opts.cls}` : '';
  const stroke = opts.stroke ?? 1.8;
  const body = ICONS[name] || ICONS.music;
  return `<svg class="icon${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const name = node.getAttribute('data-icon');
    if (!name || node.dataset.iconHydrated === '1') return;
    node.innerHTML = icon(name, { size: node.dataset.iconSize ? Number(node.dataset.iconSize) : 18 });
    node.dataset.iconHydrated = '1';
  });
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export const iconNames = Object.keys(ICONS);
