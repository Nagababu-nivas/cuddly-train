/* Shared UI primitives: toasts, modals, menus, theme and image fallbacks. */

import { $, $$, clamp, esc, uid } from './util.js?v=orange3';
import { icon } from './icons.js?v=orange3';

let activeModal = null;
let activeMenu = null;
let toastCount = 0;

export const accentPresets = [
  { name: 'Orange Red', value: '#fa2d48' },
  { name: 'Ocean Blue', value: '#0a84ff' },
  { name: 'Orchid', value: '#bf5af2' },
  { name: 'Mint', value: '#30d158' },
  { name: 'Sunset', value: '#ff9f0a' },
  { name: 'Rose', value: '#ff375f' },
  { name: 'Sky', value: '#64d2ff' },
  { name: 'Gold', value: '#ffd60a' },
];

export function toast(input, options = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};
  const config = typeof input === 'string' ? { message: input, ...options } : { ...input, ...options };
  const node = document.createElement('div');
  node.className = `toast${config.tone === 'error' ? ' toast-error' : ''}`;
  node.id = uid('toast');
  node.innerHTML = `${config.icon ? `<span class="toast-icon">${icon(config.icon, 16)}</span>` : ''}<span class="toast-text">${esc(config.message)}</span>`;
  let bar = null;
  if (typeof config.progress === 'number') {
    const track = document.createElement('span');
    track.className = 'toast-progress';
    bar = document.createElement('span');
    bar.className = 'toast-progress-fill';
    bar.style.width = `${clamp(Number(config.progress) || 0, 0, 100)}%`;
    track.appendChild(bar);
    node.appendChild(track);
  }
  root.appendChild(node);
  toastCount += 1;
  const duration = config.duration ?? (config.tone === 'error' ? 5200 : 3000);
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    node.classList.add('out');
    window.setTimeout(() => {
      node.remove();
      toastCount = Math.max(0, toastCount - 1);
    }, 220);
  };
  const timer = duration > 0 ? window.setTimeout(remove, duration) : 0;
  remove.update = (next = {}) => {
    if (removed) return;
    if (typeof next === 'string') {
      const text = node.querySelector('.toast-text');
      if (text) text.textContent = next;
      return;
    }
    if (next.message !== undefined) {
      const text = node.querySelector('.toast-text');
      if (text) text.textContent = next.message;
    }
    if (next.icon) {
      const iconNode = node.querySelector('.toast-icon');
      if (iconNode) iconNode.innerHTML = icon(next.icon, 16);
    }
    if (typeof next.progress === 'number' && bar) {
      bar.style.width = `${clamp(next.progress, 0, 100)}%`;
    }
  };
  node.addEventListener('click', () => {
    if (timer) window.clearTimeout(timer);
    remove();
  });
  while (root.children.length > 4) root.firstElementChild?.remove();
  return remove;
}

export function openModal({
  title = '',
  eyebrow = '',
  body = '',
  footer = '',
  wide = false,
  className = '',
  dismissible = true,
  onMount = null,
} = {}) {
  closeModal();
  const root = document.getElementById('modal-root');
  if (!root) return () => {};
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <div class="modal-heading">
          ${eyebrow ? `<div class="modal-eyebrow">${esc(eyebrow)}</div>` : ''}
          ${title ? `<h2>${esc(title)}</h2>` : ''}
        </div>
        ${dismissible ? `<button class="icon-btn" data-close-modal aria-label="Close">${icon('close', 18)}</button>` : ''}
      </header>
      <div class="modal-body"></div>
      ${footer || footer === 0 ? '<footer class="modal-foot"></footer>' : ''}
    </section>`;
  const modal = backdrop.querySelector('.modal');
  const bodyNode = backdrop.querySelector('.modal-body');
  if (body instanceof Node) bodyNode.appendChild(body);
  else bodyNode.innerHTML = body;
  const footerNode = backdrop.querySelector('.modal-foot');
  if (footerNode) {
    if (footer instanceof Node) footerNode.appendChild(footer);
    else footerNode.innerHTML = footer;
  }
  root.appendChild(backdrop);
  activeModal = { backdrop, modal, dismissible, lastFocus: document.activeElement };
  const close = () => closeModal();
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop && dismissible) close();
  });
  backdrop.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', close));
  backdrop.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', close));
  if (typeof onMount === 'function') onMount(modal, close);
  window.requestAnimationFrame(() => {
    const focusable = modal.querySelector('input, textarea, select, button:not([data-close-modal])');
    focusable?.focus({ preventScroll: true });
  });
  return close;
}

export function closeModal() {
  if (!activeModal) return;
  const { backdrop, lastFocus } = activeModal;
  activeModal = null;
  backdrop.classList.add('closing');
  window.setTimeout(() => backdrop.remove(), 150);
  if (lastFocus && typeof lastFocus.focus === 'function') {
    try {
      lastFocus.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
}

export function isModalOpen() {
  return Boolean(activeModal);
}

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false,
  eyebrow = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    const close = openModal({
      title,
      eyebrow,
      body: `<p class="dialog-message">${esc(message)}</p>`,
      footer: `
        <button class="pill-btn secondary" data-dialog-cancel>${esc(cancelLabel)}</button>
        <button class="pill-btn ${danger ? 'danger' : ''}" data-dialog-confirm>${esc(confirmLabel)}</button>`,
      onMount(modal) {
        modal.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(false));
        modal.querySelector('[data-dialog-confirm]').addEventListener('click', () => finish(true));
      },
    });
    const originalClose = close;
    activeModal = activeModal || null;
    // Replace the modal's close button behaviour so X also resolves false.
    const backdrop = document.querySelector('.modal-backdrop:last-child');
    backdrop?.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => finish(false));
    });
    backdrop?.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(false);
    });
    // Keep a reference so a caller-driven Esc also resolves false.
    backdrop?.addEventListener('orange:force-close', () => finish(false));
    void originalClose;
  });
}

export function promptDialog({
  title = 'Enter a value',
  label = '',
  value = '',
  placeholder = '',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  multiline = false,
  maxLength = 120,
  eyebrow = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(result);
    };
    const field = multiline
      ? `<textarea id="dialog-input" maxlength="${maxLength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="dialog-input" type="text" maxlength="${maxLength}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`;
    openModal({
      title,
      eyebrow,
      body: `<div class="field"><label for="dialog-input">${esc(label)}</label>${field}</div>`,
      footer: `<button class="pill-btn secondary" data-dialog-cancel>${esc(cancelLabel)}</button><button class="pill-btn" data-dialog-confirm>${esc(confirmLabel)}</button>`,
      onMount(modal) {
        const input = modal.querySelector('#dialog-input');
        const submit = () => finish(input.value.trim());
        modal.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(null));
        modal.querySelector('[data-dialog-confirm]').addEventListener('click', submit);
        modal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => finish(null)));
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        });
        window.setTimeout(() => {
          input.focus();
          input.select?.();
        }, 30);
      },
    });
    const backdrop = document.querySelector('.modal-backdrop:last-child');
    backdrop?.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(null);
    });
    backdrop?.addEventListener('orange:force-close', () => finish(null));
  });
}

export function openMenu({ x = 0, y = 0, items = [], anchor = null, align = 'left' } = {}) {
  closeMenu();
  const root = document.getElementById('menu-root');
  if (!root) return () => {};
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  const valid = items.filter(Boolean);
  valid.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'sep';
      menu.appendChild(sep);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.disabled = Boolean(item.disabled);
    if (item.danger) button.classList.add('danger');
    button.innerHTML = `${item.icon ? icon(item.icon, 16) : '<span class="menu-icon-spacer"></span>'}<span>${esc(item.label)}</span>${item.shortcut ? `<span class="menu-shortcut">${esc(item.shortcut)}</span>` : ''}`;
    button.addEventListener('click', () => {
      closeMenu();
      item.onClick?.();
    });
    menu.appendChild(button);
  });
  root.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const anchorRect = anchor?.getBoundingClientRect?.();
  let left = anchorRect ? anchorRect.right - rect.width : x;
  let top = anchorRect ? anchorRect.bottom + 6 : y;
  if (align === 'left' && anchorRect) left = anchorRect.left;
  if (left + rect.width > window.innerWidth - 10) left = window.innerWidth - rect.width - 10;
  if (top + rect.height > window.innerHeight - 10) {
    top = anchorRect ? anchorRect.top - rect.height - 6 : Math.max(10, y - rect.height);
  }
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${Math.max(10, top)}px`;
  activeMenu = menu;
  const onOutside = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  const onScroll = () => closeMenu();
  const timer = window.setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onScroll, true);
  }, 0);
  menu._cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', onScroll, true);
  };
  return closeMenu;
}

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu._cleanup?.();
  activeMenu.remove();
  activeMenu = null;
}

export function closeTopLayer() {
  if (activeMenu) {
    closeMenu();
    return true;
  }
  if (activeModal) {
    if (activeModal.dismissible) {
      activeModal.backdrop.dispatchEvent(new CustomEvent('orange:force-close'));
      closeModal();
    }
    return true;
  }
  return false;
}

export function progressModal({ title = 'Importing music', subtitle = '', eyebrow = 'Library' } = {}) {
  let bar;
  let label;
  let detail;
  const body = document.createElement('div');
  body.innerHTML = `
    <p class="dialog-message" id="progress-subtitle">${esc(subtitle)}</p>
    <div class="progress-bar"><div></div></div>
    <div class="progress-stats"><span id="progress-label">Preparing…</span><span id="progress-detail"></span></div>`;
  const close = openModal({
    title,
    eyebrow,
    body,
    dismissible: false,
    onMount(modal) {
      bar = modal.querySelector('.progress-bar > div');
      label = modal.querySelector('#progress-label');
      detail = modal.querySelector('#progress-detail');
      const subtitleNode = modal.querySelector('#progress-subtitle');
      if (!subtitle) subtitleNode.remove();
    },
  });
  return {
    setProgress(percent, text = '', extra = '') {
      if (bar) bar.style.width = `${clamp(percent, 0, 100)}%`;
      if (label && text) label.textContent = text;
      if (detail) detail.textContent = extra;
    },
    close,
  };
}

export function setTheme(settings) {
  const root = document.documentElement;
  let theme = settings.theme || 'dark';
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.dataset.theme = theme;
  const accent = settings.accent || '#fa2d48';
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-2', lighten(accent, 14));
  root.style.setProperty('--accent-soft', hexToRgba(accent, 0.16));
  root.style.setProperty('--accent-strong', darken(accent, 12));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f4f6' : '#08080a');
  document.body?.classList.toggle('reduced-motion', Boolean(settings.reduceMotion));
  document.body?.classList.toggle('compact-rows', Boolean(settings.compactRows));
}

let themeListener = null;
export function watchSystemTheme(getSettings) {
  if (themeListener) themeListener.removeEventListener?.('change', themeListener.handler);
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    if ((getSettings()?.theme || 'dark') === 'system') setTheme(getSettings());
  };
  media.addEventListener?.('change', handler);
  themeListener = { media, handler };
}

export function hexToRgba(hex, alpha = 1) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return `rgba(250, 45, 72, ${alpha})`;
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lighten(hex, amount = 12) {
  return adjustHex(hex, amount);
}

export function darken(hex, amount = 12) {
  return adjustHex(hex, -amount);
}

function adjustHex(hex, amount) {
  const value = String(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return hex;
  const clampChannel = (channel) => clamp(channel + amount, 0, 255);
  const r = clampChannel((number >> 16) & 255);
  const g = clampChannel((number >> 8) & 255);
  const b = clampChannel(number & 255);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function wireImageFallbacks() {
  document.addEventListener('error', (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.dataset.art) {
      target.style.display = 'none';
      const holder = target.closest('.card-art, .detail-art, .mini-art, .player-art, .np-art, .queue-art, .lyrics-art, .result-art');
      holder?.classList.add('art-missing');
    }
  }, true);
}

export function setBusy(button, busy = true, label = '') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${label ? `<span>${esc(label)}</span>` : ''}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

export function stagger(root, selector = '.stagger', step = 26) {
  $$(selector, root).forEach((node, index) => {
    node.style.animationDelay = `${Math.min(index * step, 320)}ms`;
  });
}

export function bindGlobalUi() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTopLayer();
  });
  document.addEventListener('contextmenu', (event) => {
    if (event.target.closest('[data-no-context]')) event.preventDefault();
  });
}

export function showToastForError(error) {
  toast({
    message: error?.message || 'Something went wrong.',
    icon: 'alert',
    tone: 'error',
  });
}

export function formatMenuPosition(anchor) {
  const rect = anchor.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 6, anchor };
}

export function focusSearch() {
  const input = $('#search-input');
  if (!input) return;
  input.focus();
  input.select();
}
