/* Small, dependency-free helpers shared by every Orange module. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function on(target, type, handler, options) {
  if (!target) return () => {};
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function uid(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function hashString(value) {
  let h = 2166136261;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function debounce(fn, wait = 250) {
  let timer = 0;
  return function debounced(...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer = 0;
  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      window.clearTimeout(timer);
      timer = 0;
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = window.setTimeout(() => {
        last = Date.now();
        timer = 0;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

export function shuffleArray(items) {
  const array = items.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function uniqueBy(items, keyFn = (item) => item.id) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return formatTime(seconds);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatCount(count) {
  const n = Number(count) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace('.0', '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}K`;
  return String(n);
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function yearOf(date) {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return String(date).slice(0, 4);
  return String(parsed.getFullYear());
}

export function relativeTime(timestamp) {
  const then = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return '';
  const delta = Math.max(0, Date.now() - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return 'Just now';
  if (delta < hour) return `${Math.floor(delta / minute)} min ago`;
  if (delta < day) return `${Math.floor(delta / hour)} hr ago`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function art(url, size = 600) {
  if (!url) return '';
  const value = String(url);
  // Apple's artwork service exposes arbitrary sizes. Other providers (for
  // example Audius) publish a fixed set of sizes, so leave their URLs alone.
  if (!/mzstatic\.com/i.test(value)) return value;
  return value
    .replace(/\/\d+x\d+(?:bb|sr|sc|bb-60|bb-75|bb-85|bb-100|bb-150|bb-200|bb-300|bb-400|bb-500|bb-600)\.(jpg|jpeg|png|webp)/i, `/${size}x${size}bb.$1`)
    .replace(/\/\d+x\d+\.(jpg|jpeg|png|webp)/i, `/${size}x${size}.$1`)
    .replace(/\d+x\d+bb/g, `${size}x${size}bb`);
}

export function hueFrom(value) {
  const str = String(value || 'orange');
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

export function gradientFor(value, alpha = 0.9) {
  const hue = hueFrom(value);
  const hue2 = (hue + 54) % 360;
  return `linear-gradient(135deg, hsl(${hue} 58% ${Math.round(28 * alpha + 8)}%) 0%, hsl(${hue2} 62% ${Math.round(20 * alpha + 6)}%) 100%)`;
}

export function accentFrom(value) {
  const hue = hueFrom(value);
  return `hsl(${hue} 72% 54%)`;
}

export function initials(value) {
  return String(value || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } finally {
    area.remove();
  }
  return Promise.resolve();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function downloadText(text, filename, type = 'application/json') {
  downloadBlob(new Blob([text], { type }), filename);
}

export function safeParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : safeParse(raw, fallback);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('[orange] storage write failed', error);
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/* Tiny event bus used to keep the player, views and shell decoupled. */
const listeners = new Map();

export const bus = {
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => bus.off(event, handler);
  },
  off(event, handler) {
    listeners.get(event)?.delete(handler);
  },
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    set.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[orange] handler failed for ${event}`, error);
      }
    });
  },
};

export function once(event, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const off = bus.on(event, (payload) => {
      window.clearTimeout(timer);
      off();
      resolve(payload);
    });
    if (timeout > 0) {
      timer = window.setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeout);
    }
  });
}

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/listen';
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: `/${segments.join('/')}`, segments, query: new URLSearchParams(queryPart) };
}

export function buildHash(path, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const qs = search.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function fileExt(name) {
  return String(name).split('.').pop().toLowerCase();
}

export function stripExt(name) {
  return String(name).replace(/\.[^.]+$/, '');
}

export function clampText(value, max = 120) {
  const str = String(value || '').trim();
  return str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str;
}

export function joinArtists(value) {
  return String(value || '').replace(/\s*&\s*/g, ' & ');
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function isApplePlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
}

export function shortcutLabel(key) {
  return isApplePlatform() ? `⌘${key}` : `Ctrl+${key}`;
}

export function supportsFileSystemAccess() {
  return typeof window.showOpenFilePicker === 'function';
}

export function safeUrl(url) {
  if (!url) return '';
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return '';
}
