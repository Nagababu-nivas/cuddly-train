/*
 * Orange bootstrap: hydrate the shell, restore state, then hand routing to
 * the views layer. Everything runs locally; no account or subscription.
 */

import { $, parseHash, buildHash, bus } from './util.js?v=orange3';
import { hydrateIcons } from './icons.js?v=orange3';
import { store } from './store.js?v=orange3';
import { player } from './player.js?v=orange3';
import { showToastForError, toast } from './ui.js?v=orange3';
import { initViews, renderRoute } from './views.js?v=orange3';

const DEFAULT_HASH = buildHash('/listen');

function readRoute() {
  const route = parseHash(window.location.hash);
  if (!route.segments.length) return parseHash(DEFAULT_HASH);
  return route;
}

function normalizeLocation() {
  const raw = window.location.hash;
  if (!raw || raw === '#' || raw === '#/') {
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${DEFAULT_HASH}`);
    } catch {
      /* history can be unavailable in some embedded contexts */
    }
  }
}

function navigate(path) {
  const target = String(path || '').startsWith('#') ? String(path) : `#${path}`;
  if (window.location.hash === target) {
    renderRoute(readRoute());
    return;
  }
  window.location.hash = target;
}

let lastErrorAt = 0;

function reportError(error) {
  const now = Date.now();
  if (now - lastErrorAt < 2500) {
    console.error('[orange]', error);
    return;
  }
  lastErrorAt = now;
  console.error('[orange]', error);
  const message = error?.message || String(error || 'Something went wrong.');
  if (/ResizeObserver loop/i.test(message)) return;
  showToastForError(error instanceof Error ? error : new Error(message));
}

function boot() {
  normalizeLocation();
  hydrateIcons();
  store.init();
  player.init();
  initViews({ navigator: navigate });

  renderRoute(readRoute());

  window.addEventListener('hashchange', () => {
    renderRoute(readRoute());
    hydrateIcons();
  });

  window.addEventListener('error', (event) => {
    reportError(event.error || new Error(event.message || 'Unexpected error'));
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unhandled rejection')));
  });

  window.addEventListener('online', () => {
    toast({ message: 'Back online', icon: 'globe', duration: 1800 });
  });
  window.addEventListener('offline', () => {
    toast({ message: 'You are offline. Saved previews and local files still play.', icon: 'wifi-off', tone: 'error', duration: 3200 });
  });

  bus.on('store:local-media', () => hydrateIcons());

  $('#main')?.focus?.({ preventScroll: true });

  store.loadLocalMedia()
    .then(() => {
      if (readRoute().path.startsWith('/library')) renderRoute(readRoute());
    })
    .catch((error) => console.warn('[orange] local media could not be restored', error));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
