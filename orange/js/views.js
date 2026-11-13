/*
 * Orange shell: routing, sidebar, player chrome, now-playing overlay,
 * queue/lyrics panels, interactions and dialogs.
 */

import {
  $, $$, esc, parseHash, buildHash, formatTime, formatBytes, clamp, shuffleArray,
  uniqueBy, sleep, copyText, downloadText, plural, art, debounce, isTypingTarget,
  shortcutLabel, safeUrl, bus,
} from './util.js?v=orange3';
import { icon } from './icons.js?v=orange3';
import { store } from './store.js?v=orange3';
import { player, EQ_FREQUENCIES, EQ_PRESETS } from './player.js?v=orange3';
import { db } from './db.js?v=orange3';
import * as api from './api.js?v=orange3';
import * as pages from './pages.js?v=orange3';
import { importFiles, isSupportedAudio } from './metadata.js?v=orange3';
import {
  viewState, setNavigator, go, goAlbum, goArtist, goSearch, resetView, setHeader,
  scrollMainTop, getTrackList, getTrackContext, registerTrackList, registerList,
  pageHead, shelf, card, emptyState, trackTable, groupLibraryAlbums,
  groupLibraryArtists, artworkOf, displayName, fallbackStyle, artMedia, likeButton,
  totalDuration, downloadPreview,
} from './viewkit.js?v=orange3';
import {
  toast, openModal, closeModal, confirmDialog, promptDialog, openMenu, closeMenu,
  setTheme, watchSystemTheme, accentPresets, progressModal, showToastForError,
  closeTopLayer, bindGlobalUi, wireImageFallbacks,
} from './ui.js?v=orange3';

let currentRoute = '/listen';
let routeToken = 0;
let lastPath = '';
let npSideTab = 'queue';
let rightTab = 'queue';
let lyricsState = { trackId: null, status: 'idle', data: null, activeIndex: -1 };
let lyricsRequest = 0;
let rightLyricsKey = '';
let npLyricsKey = '';
let lyricsFrame = 0;
let visualizerFrame = 0;
let librarySort = 'recent';
let npBuilt = false;

export function initViews({ navigator } = {}) {
  if (typeof navigator === 'function') setNavigator(navigator);
  bindGlobalUi();
  wireImageFallbacks();
  bindStaticControls();
  bindActionDelegation();
  bindBus();
  bindPlaylistContextMenu();
  bindLibraryInputs();
  watchSystemTheme(store.getSettings);
  applySettings();
  renderSidebar();
  renderPlayer();
  renderRightPanel();
  ensureLyrics(player.getCurrent());
  startLyricsLoop();
  return { renderRoute };
}

export function applySettings() {
  const settings = store.getSettings();
  setTheme(settings);
  api.setCatalogCountry(settings.country);
  const body = document.body;
  if (body) {
    body.classList.toggle('reduce-motion', Boolean(settings.reduceMotion));
    body.classList.toggle('compact-rows', Boolean(settings.compactRows));
    body.classList.toggle('flat-art', settings.animatedArt === false);
    body.classList.toggle('hide-explicit', settings.explicit === false);
  }
  document.documentElement.style.setProperty('--accent', settings.accent || '#fa2d48');
}

export function renderRoute(route) {
  const token = ++routeToken;
  currentRoute = route.path;
  resetView(route.path);
  closeMenu();
  renderSidebar();
  if (lastPath !== route.path) scrollMainTop();
  lastPath = route.path;
  syncSearchField(route);
  const alive = () => token === routeToken && currentRoute === route.path;
  const [section, id] = route.segments;
  if (!section || route.path === '/listen') {
    pages.renderListen(alive);
    return;
  }
  if (section === 'browse') {
    pages.renderBrowse(alive);
    return;
  }
  if (section === 'radio') {
    pages.renderRadio(alive);
    return;
  }
  if (section === 'search') {
    pages.renderSearch(alive, (route.query.get('q') || '').trim(), route.query.get('type') || 'all');
    return;
  }
  if (section === 'genre' && id) {
    pages.renderGenre(alive, id);
    return;
  }
  if (section === 'mix' && id) {
    pages.renderMix(alive, id);
    return;
  }
  if (section === 'album' && id) {
    pages.renderAlbum(alive, id);
    return;
  }
  if (section === 'artist' && id) {
    pages.renderArtist(alive, id);
    return;
  }
  if (section === 'playlist' && id) {
    pages.renderPlaylist(alive, id);
    return;
  }
  if (section === 'library') {
    switch (id) {
      case 'songs':
        pages.renderLibrarySongs(alive, route.query.get('sort') || librarySort);
        return;
      case 'albums':
        pages.renderLibraryAlbums(alive);
        return;
      case 'artists':
        pages.renderLibraryArtists(alive);
        return;
      case 'downloaded':
        pages.renderLibraryDownloaded(alive);
        return;
      case 'liked':
        pages.renderLibraryLiked(alive);
        return;
      case 'made':
        pages.renderLibraryMade(alive);
        return;
      case 'recent':
      default:
        pages.renderLibraryRecent(alive);
        return;
    }
  }
  pages.renderNotFound();
  renderSidebar();
}

function refreshCurrent() {
  renderRoute(parseHash(window.location.hash));
}

function syncSearchField(route) {
  const input = $('#search-input');
  const clear = $('#search-clear');
  if (!input) return;
  if (route.path === '/search') {
    const q = route.query.get('q') || '';
    if (input.value !== q) input.value = q;
    clear?.classList.toggle('hidden', !q);
  } else {
    input.value = '';
    clear?.classList.add('hidden');
  }
}

function renderSidebar() {
  const nav = $('#sidebar-nav');
  if (!nav) return;
  const stats = store.libraryStats();
  const playlists = store.playlists();
  const item = (path, iconName, label, count = null, extra = '') => {
    const active = currentRoute === path || (path === '/library/recent' && currentRoute === '/library');
    return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${esc(path)}" ${active ? 'aria-current="page"' : ''}>
      ${icon(iconName, 17)}<span>${esc(label)}</span>${count !== null ? `<span class="nav-count">${count}</span>` : ''}${extra}
    </button>`;
  };
  nav.innerHTML = `
    <div class="nav-section">Discover</div>
    ${item('/listen', 'listen', 'Listen Now')}
    ${item('/browse', 'browse', 'Browse')}
    ${item('/radio', 'radio', 'Radio')}
    ${item('/search', 'search', 'Search')}
    <div class="nav-section">Library</div>
    ${item('/library/recent', 'clock', 'Recently Added', stats.tracks)}
    ${item('/library/songs', 'songs', 'Songs', stats.tracks)}
    ${item('/library/albums', 'albums', 'Albums', stats.albums)}
    ${item('/library/artists', 'artists', 'Artists', stats.artists)}
    ${item('/library/liked', 'heart', 'Loved', stats.liked)}
    ${item('/library/downloaded', 'download', 'Downloaded', stats.local)}
    ${item('/library/made', 'sparkles', 'Made for You')}
    <div class="nav-section nav-section-row"><span>Playlists</span><button class="nav-mini-btn" data-act="new-playlist" title="New Playlist" aria-label="New Playlist">${icon('plus', 13)}</button></div>
    ${playlists.length ? playlists.map((playlist) => `
      <button class="nav-item playlist-row ${currentRoute === `/playlist/${playlist.id}` ? 'active' : ''}" data-nav="/playlist/${encodeURIComponent(playlist.id)}" data-playlist-id="${esc(playlist.id)}">
        <span class="playlist-glyph">${icon('playlist', 13)}</span>
        <span class="pl-name">${esc(playlist.name)}</span>
        <span class="nav-count">${playlist.trackIds.length}</span>
      </button>`).join('') : ''}
    <button class="nav-new" data-act="new-playlist">${icon('plus', 14)}<span>New Playlist</span></button>`;
  const active = nav.querySelector('.nav-item.active');
  active?.scrollIntoView?.({ block: 'nearest' });
}

/* ------------------------------------------------------------------ */
/* Player chrome                                                       */
/* ------------------------------------------------------------------ */

function updateLikeButtons() {
  $$('[data-act="like"]').forEach((button) => {
    const liked = store.isLiked(button.dataset.id);
    button.classList.toggle('liked', liked);
    button.setAttribute('aria-pressed', String(liked));
    button.title = liked ? 'Remove from Loved' : 'Love';
  });
}

function syncDownloadButtonState(trackId, stored) {
  if (!trackId) return;
  $$('[data-act="download-track"]').forEach((button) => {
    if (button.dataset.id !== trackId) return;
    button.classList.toggle('downloaded', stored);
    button.title = stored ? 'Stored in your library' : 'Download for offline listening';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = icon(stored ? 'check' : 'download', 16);
  });
  const current = player.getCurrent();
  if (current?.id !== trackId) return;
  if (stored) {
    const saved = store.trackById(trackId);
    current.offline = true;
    current.downloaded = true;
    if (saved?.audioKey) current.audioKey = saved.audioKey;
  } else {
    delete current.offline;
    delete current.downloaded;
    delete current.audioKey;
  }
  renderPlayer();
}

function setButtonIcon(button, name, size = 18) {
  if (button) button.innerHTML = icon(name, size);
}

function renderPlayer() {
  const state = player.getState();
  const current = state.current;
  const footer = $('#player');
  if (!footer) return;
  footer.classList.toggle('live', state.live);
  const artButton = $('#player-art');
  if (artButton) {
    const artwork = artworkOf(current);
    artButton.classList.toggle('placeholder', !artwork);
    artButton.innerHTML = artwork
      ? `<img data-art src="${esc(artwork)}" alt="${esc(current?.title || '')}">`
      : `<span class="player-art-fallback">${icon('music', 20)}</span>`;
  }
  $('#player-title').textContent = current ? current.title : 'Nothing playing';
  const artistName = current?.artist || '';
  const liveSuffix = current?.source === 'radio' && !/live radio/i.test(artistName) ? ' · Live radio' : '';
  const localSuffix = player.usingLocalMatch ? ' · Your local file' : '';
  const audiusSuffix = current?.source === 'audius' && !player.usingLocalMatch ? ' · Audius' : '';
  const previewSuffix = current && !player.usingLocalMatch && current.source !== 'radio' && current.source !== 'local' && current.preview ? ' · Free preview' : '';
  $('#player-artist').textContent = current
    ? `${artistName}${liveSuffix}${localSuffix}${audiusSuffix}${previewSuffix}`
    : 'Choose a song to begin';
  const like = $('#player-like');
  if (like) {
    const liked = current ? store.isLiked(current.id) : false;
    like.classList.toggle('liked', liked);
    like.disabled = !current;
    like.title = liked ? 'Remove from Loved' : 'Love';
    like.setAttribute('aria-pressed', String(liked));
  }
  const download = $('#download-btn');
  if (download) {
    const stored = Boolean(current && (current.source === 'local' || current.offline));
    const audius = current?.source === 'audius';
    const available = Boolean(current && current.source !== 'radio' && !audius && (stored || current.preview));
    download.hidden = !current || current.source === 'radio';
    download.classList.toggle('downloaded', stored);
    download.disabled = !available;
    download.title = stored
      ? 'Stored in your library'
      : audius
        ? 'Audius streams play online and are not saved here'
        : available
          ? 'Download'
          : 'Download unavailable';
    download.setAttribute('aria-label', download.title);
    setButtonIcon(download, stored ? 'check' : 'download', 17);
  }
  setButtonIcon($('#play-btn'), state.playing ? 'pause' : 'play', 18);
  $('#play-btn').title = state.playing ? 'Pause' : 'Play';
  $('#play-btn').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  $('#shuffle-btn').classList.toggle('active', state.shuffle);
  $('#repeat-btn').classList.toggle('active', state.repeat !== 'off');
  setButtonIcon($('#repeat-btn'), state.repeat === 'one' ? 'repeat-one' : 'repeat', 17);
  $('#repeat-btn').title = state.repeat === 'off' ? 'Repeat Off' : state.repeat === 'all' ? 'Repeat All' : 'Repeat One';
  const volume = state.muted ? 0 : state.volume;
  const volumeFill = $('#volume-fill');
  if (volumeFill) volumeFill.style.width = `${volume * 100}%`;
  const volumeSlider = $('#volume');
  if (volumeSlider) volumeSlider.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
  setButtonIcon($('#mute-btn'), state.muted || volume === 0 ? 'volume-x' : volume < 0.45 ? 'volume-1' : 'volume', 17);
  const queueButton = $('#queue-btn');
  const lyricsButton = $('#lyrics-btn');
  const panelOpen = document.body.classList.contains('right-open');
  queueButton?.classList.toggle('active', panelOpen && rightTab === 'queue');
  lyricsButton?.classList.toggle('active', panelOpen && rightTab === 'lyrics');
  $('#right-panel-btn')?.classList.toggle('active', panelOpen);
  updatePlayerTime(state);
  if (npBuilt) updateNowPlaying(state);
  if (document.body.classList.contains('right-open')) {
    const body = $('#right-panel-body');
    if (body) {
      if (rightTab !== 'lyrics') {
        body.innerHTML = renderSideContent(rightTab);
      } else {
        const key = `${current?.id || ''}:${lyricsState.status}`;
        if (key !== rightLyricsKey) {
          rightLyricsKey = key;
          body.innerHTML = renderSideContent(rightTab);
        }
      }
    }
  }
}

function updatePlayerTime(state = player.getTimeState()) {
  const currentTime = state.currentTime || 0;
  const duration = state.duration || 0;
  const progress = state.live ? 0 : duration ? currentTime / duration : 0;
  $('#time-current').textContent = state.live ? 'LIVE' : formatTime(currentTime);
  $('#time-total').textContent = state.live ? 'LIVE' : formatTime(duration);
  const fill = $('#scrubber-fill');
  if (fill) fill.style.width = `${progress * 100}%`;
  const thumb = $('#scrubber-thumb');
  if (thumb) thumb.style.left = `${progress * 100}%`;
  const scrubber = $('#scrubber');
  if (scrubber) {
    scrubber.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    scrubber.setAttribute('aria-valuetext', `${formatTime(currentTime)} of ${state.live ? 'live radio' : formatTime(duration)}`);
  }
  if (npBuilt) updateNowPlayingTime(state);
  updateLyricsActive(currentTime);
}

/* ------------------------------------------------------------------ */
/* Now playing                                                         */
/* ------------------------------------------------------------------ */

function openNowPlaying() {
  npLyricsKey = '';
  if (npBuilt) {
    document.body.classList.add('now-playing-open');
    updateNowPlaying(player.getState());
    return;
  }
  const root = $('#now-playing-root');
  if (!root) return;
  root.innerHTML = `
    <div class="now-playing" id="now-playing" role="dialog" aria-modal="true" aria-label="Now Playing">
      <div class="np-bg" id="np-bg"></div>
      <div class="np-top">
        <div class="np-label">${icon('disc', 15)} Now Playing</div>
        <button class="icon-btn" data-act="close-now-playing" title="Close" aria-label="Close">${icon('chevron-down', 20)}</button>
      </div>
      <div class="np-main">
        <div class="np-left">
          <div class="np-art" id="np-art" style="${fallbackStyle(player.getCurrent() || { title: 'Orange' })}"></div>
          <canvas class="np-visualizer" id="np-visualizer" width="440" height="42" aria-hidden="true"></canvas>
          <div class="np-meta">
            <div class="np-title" id="np-title">Nothing playing</div>
            <div class="np-artist" id="np-artist">Choose a song or station</div>
            <div class="np-actions">
              <button class="icon-btn like-btn" id="np-like" data-act="like-current" title="Love">${icon('heart', 18)}</button>
              <button class="icon-btn" data-act="toggle-right-panel" title="Queue and lyrics">${icon('queue', 18)}</button>
            </div>
          </div>
          <div class="np-controls">
            <div class="scrubber-row">
              <span class="time" id="np-time-current">0:00</span>
              <div class="scrubber" id="np-scrubber" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
                <div class="scrubber-track"><div class="scrubber-fill" id="np-scrubber-fill"></div><div class="scrubber-thumb" id="np-scrubber-thumb"></div></div>
              </div>
              <span class="time" id="np-time-total">0:00</span>
            </div>
            <div class="np-transport">
              <button class="icon-btn" id="np-shuffle" data-act="shuffle-toggle" title="Shuffle">${icon('shuffle', 18)}</button>
              <button class="icon-btn" data-act="prev-track" title="Previous">${icon('prev', 20)}</button>
              <button class="play-btn" id="np-play" data-act="toggle-play" title="Play">${icon('play', 20)}</button>
              <button class="icon-btn" data-act="next-track" title="Next">${icon('next', 20)}</button>
              <button class="icon-btn" id="np-repeat" data-act="repeat-toggle" title="Repeat">${icon('repeat', 18)}</button>
            </div>
          </div>
        </div>
        <div class="np-right">
          <div class="right-panel-head">
            <div class="segmented" id="np-tabs">
              <button data-act="np-tab" data-tab="queue">Up Next</button>
              <button data-act="np-tab" data-tab="lyrics">Lyrics</button>
            </div>
            <button class="icon-btn" data-act="close-now-playing" title="Close" aria-label="Close">${icon('close', 17)}</button>
          </div>
          <div class="right-panel-body" id="np-side"></div>
        </div>
      </div>
    </div>`;
  npBuilt = true;
  document.body.classList.add('now-playing-open');
  bindFractionSlider($('#np-scrubber'), (fraction) => player.seekFraction(fraction));
  updateNowPlaying(player.getState());
  startVisualizer();
}

function closeNowPlaying() {
  const root = $('#now-playing-root');
  if (root) root.innerHTML = '';
  npBuilt = false;
  npLyricsKey = '';
  document.body.classList.remove('now-playing-open');
  stopVisualizer();
}

function isNowPlayingOpen() {
  return npBuilt;
}

function updateNowPlaying(state = player.getState()) {
  if (!npBuilt) return;
  const current = state.current;
  const bg = $('#np-bg');
  const artwork = artworkOf(current);
  if (bg) bg.style.backgroundImage = artwork ? `url('${esc(art(artwork, 1000))}')` : '';
  const artNode = $('#np-art');
  if (artNode) {
    artNode.style.cssText = fallbackStyle(current || { title: 'Orange' });
    artNode.innerHTML = artwork ? artMedia(current, { alt: current?.title || '' }) : `<span class="art-fallback">${icon('disc', 88)}</span>`;
  }
  $('#np-title').textContent = current ? current.title : 'Nothing playing';
  $('#np-artist').textContent = current ? [current.artist, current.album].filter(Boolean).join(' · ') : 'Choose a song or station';
  const like = $('#np-like');
  if (like) {
    const liked = current ? store.isLiked(current.id) : false;
    like.classList.toggle('liked', liked);
    like.disabled = !current;
    like.setAttribute('aria-pressed', String(liked));
  }
  setButtonIcon($('#np-play'), state.playing ? 'pause' : 'play', 20);
  $('#np-shuffle')?.classList.toggle('active', state.shuffle);
  $('#np-repeat')?.classList.toggle('active', state.repeat !== 'off');
  setButtonIcon($('#np-repeat'), state.repeat === 'one' ? 'repeat-one' : 'repeat', 18);
  updateNowPlayingTime(player.getTimeState());
  updateNpSide();
}

function updateNowPlayingTime(state) {
  if (!npBuilt) return;
  const progress = state.live ? 0 : state.duration ? state.currentTime / state.duration : 0;
  $('#np-time-current').textContent = state.live ? 'LIVE' : formatTime(state.currentTime);
  $('#np-time-total').textContent = state.live ? 'LIVE' : formatTime(state.duration);
  $('#np-scrubber-fill').style.width = `${progress * 100}%`;
  $('#np-scrubber-thumb').style.left = `${progress * 100}%`;
  const scrubber = $('#np-scrubber');
  if (scrubber) {
    scrubber.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    scrubber.setAttribute('aria-valuetext', `${formatTime(state.currentTime)} of ${state.live ? 'live radio' : formatTime(state.duration)}`);
  }
}

function updateNpSide(force = false) {
  if (!npBuilt) return;
  const tabs = $$('#np-tabs button');
  tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === npSideTab));
  const side = $('#np-side');
  if (!side) return;
  if (npSideTab !== 'lyrics') {
    side.innerHTML = renderSideContent(npSideTab);
    return;
  }
  const key = `${player.getCurrent()?.id || ''}:${lyricsState.status}`;
  if (force || key !== npLyricsKey) {
    npLyricsKey = key;
    side.innerHTML = renderSideContent(npSideTab);
  }
}

function startVisualizer() {
  stopVisualizer();
  const canvas = $('#np-visualizer');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const draw = () => {
    if (!npBuilt) return;
    const data = player.getAnalyserData();
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const bars = 42;
    const gap = 4;
    const barWidth = (width - gap * (bars - 1)) / bars;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#fa2d48';
    context.fillStyle = accent;
    context.globalAlpha = 0.82;
    for (let index = 0; index < bars; index += 1) {
      const value = data ? data[Math.min(data.length - 1, index)] / 255 : 0.12 + Math.random() * 0.06;
      const barHeight = Math.max(2, value * height);
      const x = index * (barWidth + gap);
      const y = (height - barHeight) / 2;
      context.beginPath();
      context.roundRect?.(x, y, barWidth, barHeight, 2);
      if (context.roundRect) context.fill();
      else context.fillRect(x, y, barWidth, barHeight);
    }
    visualizerFrame = window.requestAnimationFrame(draw);
  };
  draw();
}

function stopVisualizer() {
  if (visualizerFrame) window.cancelAnimationFrame(visualizerFrame);
  visualizerFrame = 0;
}

/* ------------------------------------------------------------------ */
/* Right panel and side content                                        */
/* ------------------------------------------------------------------ */

function toggleRightPanel(force = null) {
  const isOpen = document.body.classList.contains('right-open');
  const next = force === null ? !isOpen : Boolean(force);
  document.body.classList.toggle('right-open', next);
  rightLyricsKey = '';
  if (next) {
    renderRightPanel();
    if (rightTab === 'lyrics') ensureLyrics(player.getCurrent());
  }
  renderPlayer();
}

function setRightTab(tab) {
  rightTab = tab === 'lyrics' ? 'lyrics' : 'queue';
  renderRightPanel();
  if (rightTab === 'lyrics') ensureLyrics(player.getCurrent());
  renderPlayer();
}

function renderRightPanel() {
  const tabs = $$('#right-tabs button');
  tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.rightTab === rightTab));
  const body = $('#right-panel-body');
  if (body) body.innerHTML = renderSideContent(rightTab);
}

function renderSideContent(tab) {
  if (tab === 'lyrics') return renderLyricsPanel();
  return renderQueuePanel();
}

function queueItem(track, index, { current = false } = {}) {
  return `<div class="queue-item ${current ? 'current' : ''}" data-act="jump-queue" data-index="${index}" title="${current ? 'Now playing' : 'Play this track'}">
    <span class="mini-art" style="${fallbackStyle(track)}">${artMedia(track, { alt: track.title })}</span>
    <span class="q-info">
      <span class="q-title">${esc(track.title)}</span>
      <span class="q-sub">${esc(track.artist || '')}${track.source === 'local' ? ' · Local' : ''}</span>
    </span>
    <span class="q-right">${track.duration ? formatTime(track.duration) : ''}</span>
    ${!current ? `<button class="icon-btn q-remove" data-act="remove-queue" data-index="${index}" title="Remove from queue" aria-label="Remove from queue">${icon('close', 13)}</button>` : ''}
  </div>`;
}

function renderQueuePanel() {
  const state = player.getState();
  if (state.live) {
    return `<div class="queue-live">
      <div class="queue-live-icon">${icon('radio', 26)}</div>
      <h3>${esc(state.liveStation?.name || 'Live Radio')}</h3>
      <p>${esc(state.liveStation?.subtitle || 'Public live stream')}</p>
      <button class="pill-btn secondary" data-act="stop-radio">${icon('pause', 15)}Stop radio</button>
    </div>`;
  }
  const { queue, index } = state;
  if (!queue.length) {
    return emptyState({
      iconName: 'queue',
      title: 'Your queue is empty',
      description: 'Play a song or add one from any track menu.',
      small: true,
      actions: `<button class="pill-btn secondary" data-nav="/listen">${icon('listen', 15)}Listen Now</button>`,
    });
  }
  const current = queue[index];
  const next = queue.slice(index + 1);
  return `<div class="queue-panel">
    ${current ? `<div class="queue-section-title">Now Playing</div>${queueItem(current, index, { current: true })}` : ''}
    <div class="queue-section-head">
      <div class="queue-section-title">Next Up <span>${next.length}</span></div>
      <button class="section-link" data-act="clear-queue">Clear</button>
    </div>
    ${next.length ? next.map((track, offset) => queueItem(track, index + 1 + offset)).join('') : '<p class="queue-empty">Nothing else queued. Add songs with the ••• menu.</p>'}
  </div>`;
}

function parsePlainLyrics(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ time: null, text: line }));
}

function renderLyricsPanel() {
  const current = player.getCurrent();
  if (!current) {
    return emptyState({ iconName: 'lyrics', title: 'No song playing', description: 'Lyrics appear here when a track is playing.', small: true });
  }
  if (lyricsState.trackId !== current.id) ensureLyrics(current);
  const state = lyricsState.trackId === current.id ? lyricsState : { status: 'loading', data: null };
  let content = '';
  if (current.source === 'radio') {
    content = `<p class="lyrics-empty">Live radio does not include lyrics.</p>`;
  } else if (state.status === 'loading' || state.status === 'idle') {
    content = `<div class="lyrics-loading"><span class="spinner"></span><span>Looking for lyrics…</span></div>`;
  } else if (state.status === 'error') {
    content = `<p class="lyrics-empty">Lyrics could not be loaded right now.<br><button class="section-link" data-act="retry-lyrics">Try again</button></p>`;
  } else if (!state.data) {
    content = `<p class="lyrics-empty">No lyrics are available for this track.<br><span class="small">Lyrics are provided by LRCLIB when available.</span></p>`;
  } else if (state.data.instrumental) {
    content = `<p class="lyrics-empty">${icon('music', 22)}<br>This track is instrumental.</p>`;
  } else {
    const lines = state.data.lines || [];
    const synced = Boolean(state.data.synced);
    const previewTiming = synced && current.preview && current.source !== 'local' && !current.offline && !player.usingLocalMatch;
    content = `<div class="lyrics-scroll" data-lyrics-container>
      ${lines.map((line) => line.time !== null
        ? `<button class="lyric-line" data-act="seek-lyric" data-time="${line.time}" data-lyric-time="${line.time}" title="Play from this line">${esc(line.text)}</button>`
        : `<div class="lyric-line static">${esc(line.text)}</div>`).join('')}
    </div>
    <div class="lyrics-credit">Lyrics via LRCLIB${synced ? '' : ' · Not time-synced'}</div>
    ${synced
      ? (previewTiming ? '<p class="lyrics-note">This 30-second preview is an excerpt of the full song, so the highlighted line may not match what you hear.</p>' : '')
      : '<p class="lyrics-note">This track has no time-synced lyrics yet, so highlighting and line seeking are unavailable.</p>'}`;
  }
  return `<div class="lyrics-wrap">
    <div class="lyrics-head">
      <span class="mini-art" style="${fallbackStyle(current)}">${artMedia(current, { alt: current.title })}</span>
      <div><div class="lyrics-song">${esc(current.title)}</div><div class="lyrics-artist">${esc(current.artist || '')}</div></div>
    </div>
    ${content}
  </div>`;
}

async function ensureLyrics(track) {
  if (!track || track.source === 'radio') {
    lyricsState = { trackId: track?.id || null, status: 'idle', data: null, activeIndex: -1 };
    return;
  }
  if (lyricsState.trackId === track.id) return;
  const request = ++lyricsRequest;
  lyricsState = { trackId: track.id, status: 'loading', data: null, activeIndex: -1 };
  refreshLyricsViews();
  try {
    let data = null;
    if (track.lyrics) {
      data = { instrumental: false, synced: false, lines: parsePlainLyrics(track.lyrics), plain: track.lyrics, source: 'local' };
    } else {
      data = await api.lyricsFor(track);
    }
    if (request !== lyricsRequest) return;
    lyricsState = { trackId: track.id, status: 'ready', data, activeIndex: -1 };
  } catch (error) {
    if (request !== lyricsRequest) return;
    lyricsState = { trackId: track.id, status: 'error', data: null, activeIndex: -1 };
  }
  refreshLyricsViews();
}

function refreshLyricsViews() {
  if (document.body.classList.contains('right-open') && rightTab === 'lyrics') {
    const body = $('#right-panel-body');
    if (body) {
      rightLyricsKey = `${player.getCurrent()?.id || ''}:${lyricsState.status}`;
      body.innerHTML = renderLyricsPanel();
    }
  }
  if (npBuilt && npSideTab === 'lyrics') updateNpSide(true);
  lyricsState.activeIndex = -1;
  updateLyricsActive(player.getTimeState().currentTime);
}

function updateLyricsActive(currentTime) {
  if (!lyricsState.data?.synced) return;
  const groups = $$('.lyrics-scroll')
    .map((container) => ({ container, nodes: $$('.lyric-line[data-lyric-time]', container) }))
    .filter((group) => group.nodes.length);
  if (!groups.length) return;
  groups.forEach(({ container, nodes }) => {
    let active = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      const time = Number(nodes[index].dataset.lyricTime);
      if (Number.isFinite(time) && time <= currentTime + 0.12) active = index;
      else break;
    }
    const domActive = nodes.findIndex((node) => node.classList.contains('active'));
    if (domActive === active) return;
    lyricsState.activeIndex = active;
    nodes.forEach((node, index) => {
      node.classList.toggle('active', index === active);
      node.classList.toggle('past', index < active);
    });
    const activeNode = nodes[active];
    if (activeNode) {
      const target = activeNode.offsetTop - container.clientHeight / 2 + activeNode.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  });
}

/* The media element remains the single source of time. This loop only samples
   `audio.currentTime` on animation frames so line changes land on frame
   boundaries instead of waiting for the next throttled timeupdate event. */
function startLyricsLoop() {
  if (lyricsFrame) return;
  const tick = () => {
    lyricsFrame = window.requestAnimationFrame(tick);
    if (!lyricsState.data?.synced || !player.isPlaying()) return;
    updateLyricsActive(player.getTimeState().currentTime);
  };
  lyricsFrame = window.requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

function findTrack(id) {
  if (!id) return null;
  const direct = store.trackById(id);
  if (direct) return direct;
  const current = player.getCurrent();
  if (current?.id === id) return current;
  for (const list of Object.values(viewState.trackLists || {})) {
    const found = (list || []).find((track) => track?.id === id);
    if (found) return found;
  }
  for (const playlist of store.playlists()) {
    if (playlist.trackIds.includes(id)) {
      const found = store.playlistTracks(playlist.id).find((track) => track.id === id);
      if (found) return found;
    }
  }
  return null;
}

function trackFromElement(element) {
  if (!element) return null;
  const listKey = element.dataset.list || '';
  const index = Number(element.dataset.index);
  const list = listKey ? getTrackList(listKey) : [];
  if (Number.isFinite(index) && index >= 0 && list[index]) return list[index];
  return findTrack(element.dataset.id);
}

function anchorOrPoint(target) {
  if (target && typeof target.getBoundingClientRect === 'function') return { anchor: target };
  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) return { x: target.x, y: target.y };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/* ------------------------------------------------------------------ */
/* Static controls                                                     */
/* ------------------------------------------------------------------ */

function bindStaticControls() {
  const back = $('#back-btn');
  const forward = $('#forward-btn');
  back?.addEventListener('click', () => window.history.back());
  forward?.addEventListener('click', () => window.history.forward());
  const refreshHistory = () => {
    if (back) back.disabled = window.history.length <= 1;
    if (forward) forward.disabled = window.history.length <= 1;
  };
  refreshHistory();
  window.addEventListener('hashchange', refreshHistory);

  const searchInput = $('#search-input');
  const searchClear = $('#search-clear');
  const clearSearch = () => {
    if (!searchInput) return;
    searchInput.value = '';
    searchClear?.classList.add('hidden');
    if (currentRoute === '/search') go('/search');
    searchInput.focus();
  };
  searchInput?.addEventListener('input', () => {
    searchClear?.classList.toggle('hidden', !searchInput.value.trim());
  });
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const value = searchInput.value.trim();
      if (value) {
        store.addSearchHistory(value);
        goSearch(value);
      } else {
        go('/search');
      }
      searchInput.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
      searchInput.blur();
    }
  });
  searchClear?.addEventListener('click', clearSearch);

  $('#add-music-btn')?.addEventListener('click', () => openImportDialog());
  $('#right-panel-btn')?.addEventListener('click', () => toggleRightPanel());
  $('#settings-btn')?.addEventListener('click', () => openSettings());
  $$('[data-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.modal === 'settings') openSettings();
      else openAbout();
    });
  });

  $$('#right-tabs button').forEach((tab) => {
    tab.addEventListener('click', () => setRightTab(tab.dataset.rightTab));
  });
  $('#right-close')?.addEventListener('click', () => toggleRightPanel(false));

  $('#play-btn')?.addEventListener('click', () => player.toggle());
  $('#prev-btn')?.addEventListener('click', () => player.previous());
  $('#next-btn')?.addEventListener('click', () => player.next());
  $('#shuffle-btn')?.addEventListener('click', () => player.toggleShuffle());
  $('#repeat-btn')?.addEventListener('click', () => player.cycleRepeat());
  $('#mute-btn')?.addEventListener('click', () => player.toggleMute());
  $('#lyrics-btn')?.addEventListener('click', () => openRightPanel('lyrics'));
  $('#queue-btn')?.addEventListener('click', () => openRightPanel('queue'));
  $('#eq-btn')?.addEventListener('click', () => openEqualizer());

  [$('#player-art'), $('#player-title'), $('#player-artist')].forEach((node) => {
    node?.addEventListener('click', () => openNowPlaying());
  });
  $('#player-like')?.addEventListener('click', toggleCurrentLike);
  $('#download-btn')?.addEventListener('click', () => {
    const current = player.getCurrent();
    if (!current || current.source === 'radio') return;
    if (current.offline) removeOfflineTrack(current);
    else saveOfflineTrack(current);
  });

  bindFractionSlider($('#scrubber'), (fraction) => player.seekFraction(fraction));
  bindFractionSlider($('#volume'), (fraction) => player.setVolume(fraction));

  const main = $('#main');
  main?.addEventListener('scroll', () => {
    $('#topbar')?.classList.toggle('scrolled', main.scrollTop > 6);
  }, { passive: true });

  document.addEventListener('keydown', onGlobalKeydown);
  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
      document.body.classList.add('dragging-files');
    }
  });
  document.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) document.body.classList.remove('dragging-files');
  });
  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    document.body.classList.remove('dragging-files');
    runImport(event.dataTransfer.files);
  });
}

function openRightPanel(tab = rightTab) {
  rightTab = tab === 'lyrics' ? 'lyrics' : 'queue';
  toggleRightPanel(true);
  setRightTab(rightTab);
}

function onGlobalKeydown(event) {
  if (event.defaultPrevented) return;
  const key = event.key;
  const lower = key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (key === 'Escape') {
    if (isNowPlayingOpen()) {
      closeNowPlaying();
      return;
    }
    if (document.body.classList.contains('right-open')) {
      toggleRightPanel(false);
      return;
    }
    return;
  }
  if (isTypingTarget(event.target)) return;
  if (event.altKey) return;

  if (mod && lower === 'k') {
    event.preventDefault();
    $('#search-input')?.focus();
    return;
  }
  if (mod && lower === 'f') {
    event.preventDefault();
    $('#search-input')?.focus();
    $('#search-input')?.select?.();
    return;
  }
  if (mod && lower === 'r') {
    event.preventDefault();
    refreshCurrent();
    return;
  }

  if (event.code === 'Space') {
    if (event.target.closest?.('button, a, [role="button"]')) return;
    event.preventDefault();
    player.toggle();
    return;
  }

  switch (lower) {
    case 'arrowright':
      if (mod) {
        event.preventDefault();
        player.next();
      } else if (!event.shiftKey) {
        event.preventDefault();
        player.seekBy(5);
      }
      break;
    case 'arrowleft':
      if (mod) {
        event.preventDefault();
        player.previous();
      } else if (!event.shiftKey) {
        event.preventDefault();
        player.seekBy(-5);
      }
      break;
    case 'arrowup':
      event.preventDefault();
      player.setVolume(clamp(player.volume + 0.05, 0, 1));
      break;
    case 'arrowdown':
      event.preventDefault();
      player.setVolume(clamp(player.volume - 0.05, 0, 1));
      break;
    case 'm':
      player.toggleMute();
      break;
    case 'l':
      toggleCurrentLike();
      break;
    case 's':
      player.toggleShuffle();
      break;
    case 'r':
      player.cycleRepeat();
      break;
    case 'q':
      openRightPanel('queue');
      break;
    case '/':
      event.preventDefault();
      $('#search-input')?.focus();
      break;
    case '?':
      openShortcuts();
      break;
    case 'n':
      if (mod) {
        event.preventDefault();
        createPlaylistFlow();
      }
      break;
    default:
      break;
  }
}

function updateHistoryButtons() {
  const back = $('#back-btn');
  const forward = $('#forward-btn');
  if (back) back.disabled = window.history.length <= 1;
  if (forward) forward.disabled = window.history.length <= 1;
}

function bindFractionSlider(element, onChange) {
  if (!element) return;
  const fractionFrom = (event) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return 0;
    return clamp((event.clientX - rect.left) / rect.width, 0, 1);
  };
  let dragging = false;
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    element.classList.add('dragging');
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    onChange(fractionFrom(event));
  });
  element.addEventListener('pointermove', (event) => {
    if (dragging) onChange(fractionFrom(event));
  });
  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove('dragging');
    try {
      element.releasePointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
  };
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.1 : 0.03;
    const current = Number(element.getAttribute('aria-valuenow') || 0) / 100;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onChange(clamp(current - step, 0, 1));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onChange(clamp(current + step, 0, 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(1);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Action delegation                                                   */
/* ------------------------------------------------------------------ */

function bindActionDelegation() {
  document.addEventListener('click', (event) => {
    const navTarget = event.target.closest('[data-nav]');
    if (navTarget) {
      event.preventDefault();
      const path = navTarget.dataset.nav;
      if (path) go(path);
      return;
    }
    const actionTarget = event.target.closest('[data-act]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.act;
    if (!action) return;
    event.preventDefault();
    Promise.resolve(handleAction(action, actionTarget)).catch(showToastForError);
  });
}

async function handleAction(action, element) {
  switch (action) {
    case 'open':
      return openItem(element);
    case 'card-play':
      return playCard(element);
    case 'play-row':
      return playRow(element.dataset.list, Number(element.dataset.index));
    case 'play-list':
      return playList(element.dataset.list, { shuffle: element.dataset.shuffle === '1' });
    case 'shuffle-toggle':
      player.toggleShuffle();
      return;
    case 'repeat-toggle':
      player.cycleRepeat();
      return;
    case 'toggle-play':
      player.toggle();
      return;
    case 'prev-track':
      player.previous();
      return;
    case 'next-track':
      player.next();
      return;
    case 'like':
      return handleLike(element.dataset.id);
    case 'download-track': {
      const track = findTrack(element.dataset.id);
      if (!track) return;
      if (track.offline) return removeOfflineTrack(track);
      return saveOfflineTrack(track);
    }
    case 'like-current':
      return toggleCurrentLike();
    case 'track-menu':
      return openTrackMenu(element);
    case 'album-menu':
      return openAlbumMenu(element.dataset.id, element);
    case 'playlist-menu':
      return openPlaylistMenu(element.dataset.id, element);
    case 'toggle-album':
      return toggleAlbum(element.dataset.id, element.dataset.list);
    case 'toggle-artist':
      return toggleArtist(element.dataset.id);
    case 'play-station':
      return playStation(element.dataset.id);
    case 'retry':
      scrollMainTop();
      return refreshCurrent();
    case 'search-tab':
      return handleSearchTab(element.dataset.query, element.dataset.type);
    case 'search-term':
      store.addSearchHistory(element.dataset.term);
      return goSearch(element.dataset.term);
    case 'clear-history':
      store.clearSearchHistory();
      return refreshCurrent();
    case 'open-add-music':
      return openImportDialog();
    case 'clear-queue':
      return clearUpcoming();
    case 'remove-queue':
      return player.removeFromQueue(Number(element.dataset.index));
    case 'jump-queue':
      return player.jumpTo(Number(element.dataset.index));
    case 'stop-radio':
      player.toggle();
      return;
    case 'np-tab':
      npSideTab = element.dataset.tab === 'lyrics' ? 'lyrics' : 'queue';
      return updateNpSide(true);
    case 'toggle-right-panel':
      return toggleRightPanel();
    case 'close-now-playing':
      return closeNowPlaying();
    case 'retry-lyrics':
      lyricsState = { trackId: null, status: 'idle', data: null, activeIndex: -1 };
      return ensureLyrics(player.getCurrent());
    case 'seek-lyric': {
      const time = Number(element.dataset.time);
      if (Number.isFinite(time)) {
        player.seek(time);
        bus.emit('player:time', player.getTimeState());
      }
      return;
    }
    case 'new-playlist':
      return createPlaylistFlow();
    case 'edit-playlist':
      return openEditPlaylist(element.dataset.id);
    case 'open-album-link': {
      const id = element.dataset.id;
      if (id) return goAlbum(id);
      return;
    }
    case 'open-artist':
      return goArtist(element.dataset.id);
    case 'settings':
      return openSettings(element.dataset.tab || 'general');
    case 'shortcuts':
      return openShortcuts();
    default:
      return;
  }
}

async function handleSearchTab(query, type) {
  const value = String(query || '').trim();
  if (!value) return go('/search');
  store.addSearchHistory(value);
  go(buildHash('/search', { q: value, type: type === 'all' ? '' : type }));
}

function openItem(element) {
  const kind = element.dataset.kind;
  const id = element.dataset.id;
  if (!kind || !id) return;
  switch (kind) {
    case 'album':
      return goAlbum(id);
    case 'artist':
      return goArtist(id);
    case 'playlist':
      return go(`/playlist/${encodeURIComponent(id)}`);
    case 'mix':
      return go(`/mix/${encodeURIComponent(id)}`);
    case 'genre':
      return go(`/genre/${encodeURIComponent(id)}?q=${encodeURIComponent(element.dataset.query || '')}`);
    case 'local-album':
      return openLocalAlbum(id);
    case 'local-artist':
      return openLocalArtist(id);
    case 'station':
      return playStation(id);
    case 'track': {
      const track = findTrack(id);
      if (track?.albumId) return goAlbum(track.albumId);
      if (track) return player.playTracks([track], 0, { type: 'track', title: track.title });
      return;
    }
    default:
      return;
  }
}

function playRow(listKey, index) {
  const list = getTrackList(listKey);
  if (!list.length) {
    toast({ message: 'There is nothing to play here.', icon: 'music' });
    return;
  }
  const safeIndex = clamp(Number(index) || 0, 0, list.length - 1);
  player.playTracks(list, safeIndex, getTrackContext(listKey) || { type: 'list', title: 'Music' });
}

async function playList(listKey, { shuffle = false } = {}) {
  const list = getTrackList(listKey);
  if (!list.length) {
    toast({ message: 'There is nothing to play here.', icon: 'music' });
    return;
  }
  if (shuffle && !player.shuffle) player.toggleShuffle(true);
  await player.playTracks(list, 0, getTrackContext(listKey) || { type: 'list', title: 'Music' });
}

async function playCard(element) {
  const kind = element.dataset.kind;
  const id = element.dataset.id;
  const listKey = element.dataset.list || '';
  const index = Number(element.dataset.index);

  if (kind === 'track' && listKey && getTrackList(listKey).length) {
    return playRow(listKey, Number.isFinite(index) ? index : 0);
  }

  switch (kind) {
    case 'track': {
      const track = findTrack(id);
      if (!track) return;
      return player.playTracks([track], 0, { type: 'track', title: track.title });
    }
    case 'album': {
      const data = await api.albumDetails(id);
      if (!data.tracks.length) {
        toast({ message: 'This album has no free previews right now.', icon: 'alert', tone: 'error' });
        return;
      }
      return player.playTracks(data.tracks, 0, {
        type: 'album',
        id,
        title: data.album?.title || 'Album',
      });
    }
    case 'local-album': {
      const album = resolveLocalAlbum(id);
      if (!album?.tracks?.length) return;
      return player.playTracks(album.tracks, 0, { type: 'album', id, title: album.title });
    }
    case 'artist': {
      const data = await api.artistDetails(id);
      if (!data.tracks.length) {
        toast({ message: 'This artist has no free previews right now.', icon: 'alert', tone: 'error' });
        return;
      }
      return player.playTracks(data.tracks, 0, {
        type: 'artist',
        id,
        title: data.artist?.name || 'Artist',
      });
    }
    case 'local-artist': {
      const artist = resolveLocalArtist(id);
      if (!artist?.tracks?.length) return;
      return player.playTracks(artist.tracks, 0, { type: 'artist', id, title: artist.name });
    }
    case 'playlist': {
      const tracks = store.playlistTracks(id);
      if (!tracks.length) {
        toast({ message: 'This playlist is empty.', icon: 'playlist' });
        return;
      }
      const playlist = store.playlistById(id);
      return player.playTracks(tracks, 0, { type: 'playlist', id, title: playlist?.name || 'Playlist' });
    }
    case 'mix': {
      const mix = api.mixes.find((item) => item.id === id);
      if (!mix) return;
      const tracks = await api.searchSongs(mix.query, { limit: 50 });
      if (!tracks.length) {
        toast({ message: 'This mix is empty right now.', icon: 'sparkles' });
        return;
      }
      registerTrackList('mix-tracks', tracks, { type: 'mix', id, title: mix.title });
      return player.playTracks(tracks, 0, { type: 'mix', id, title: mix.title });
    }
    case 'genre': {
      const genre = pages.findGenre(id) || { name: id.replace(/-/g, ' '), query: id.replace(/-/g, ' ') };
      const tracks = await api.searchSongs(genre.query, { limit: 50 });
      if (!tracks.length) {
        toast({ message: 'This genre is empty right now.', icon: 'search' });
        return;
      }
      registerTrackList('genre-songs', tracks, { type: 'genre', id, title: genre.name });
      return player.playTracks(tracks, 0, { type: 'genre', id, title: genre.name });
    }
    case 'station':
      return playStation(id);
    default:
      return;
  }
}

async function playStation(id) {
  const live = api.radioStations.find((station) => station.id === id);
  if (live) {
    await player.playStream(live);
    toast({ message: `Tuning in to ${live.name}`, icon: 'radio', duration: 1800 });
    return;
  }
  const station = api.previewStations.find((item) => item.id === id);
  if (!station) return;
  try {
    const tracks = await api.searchSongs(station.query, { limit: 40 });
    if (!tracks.length) {
      toast({ message: 'This station has no previews right now.', icon: 'alert', tone: 'error' });
      return;
    }
    registerTrackList(`station-${id}`, tracks, { type: 'station', id, title: station.name });
    if (player.shuffle) player.toggleShuffle(false);
    await player.playTracks(tracks, 0, { type: 'station', id, title: station.name });
    toast({ message: `Playing ${station.name}`, icon: 'wave', duration: 1800 });
  } catch (error) {
    showToastForError(error);
  }
}

function handleLike(id) {
  const track = findTrack(id);
  if (!track) return;
  const liked = store.toggleLike(track);
  refreshLikeUi();
  toast({ message: liked ? 'Added to Loved' : 'Removed from Loved', icon: 'heart', duration: 1500 });
}

function toggleCurrentLike() {
  const current = player.getCurrent();
  if (!current || current.source === 'radio') return;
  const liked = store.toggleLike(current);
  refreshLikeUi();
  toast({ message: liked ? 'Added to Loved' : 'Removed from Loved', icon: 'heart', duration: 1500 });
}

function refreshLikeUi() {
  updateLikeButtons();
  renderPlayer();
  updateNowPlaying();
}

async function toggleAlbum(id, listKey) {
  let album = store.albumById(id);
  let tracks = listKey ? getTrackList(listKey) : [];
  if (!album) {
    try {
      const data = await api.albumDetails(id);
      album = data.album;
      if (!tracks.length) tracks = data.tracks;
    } catch {
      /* ignore */
    }
  }
  if (!album) return;
  if (!tracks.length) tracks = store.allLibraryTracks().filter((track) => track.albumId === id);
  const saved = store.toggleSavedAlbum(album, tracks);
  toast({ message: saved ? 'Added to Library' : 'Removed from Library', icon: saved ? 'check' : 'minus' });
  refreshCurrent();
}

async function toggleArtist(id) {
  let artist = store.artistById(id);
  if (!artist) {
    try {
      const data = await api.artistDetails(id);
      artist = data.artist;
    } catch {
      /* ignore */
    }
  }
  if (!artist) return;
  const saved = store.toggleSavedArtist(artist);
  toast({ message: saved ? 'Following artist' : 'Stopped following', icon: saved ? 'check' : 'minus' });
  refreshCurrent();
}

function clearUpcoming() {
  const state = player.getState();
  if (state.live) return;
  player.clearQueue({ keepCurrent: true });
  toast({ message: 'Up next cleared', icon: 'queue', duration: 1600 });
}

/* ------------------------------------------------------------------ */
/* Event bus                                                           */
/* ------------------------------------------------------------------ */

let refreshTimer = 0;
const refreshKinds = new Set([
  'playlists', 'saved-track', 'saved-album', 'saved-artist',
  'local-add', 'local-remove', 'import', 'reset', 'likes', 'offline',
]);
const panelKinds = new Set([
  'playlists', 'saved-track', 'saved-album', 'saved-artist',
  'local-add', 'local-remove', 'import', 'reset', 'likes', 'offline',
]);

function scheduleRefresh(delay = 180) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => refreshCurrent(), delay);
}

function bindBus() {
  bus.on('player:track', (track) => {
    renderPlayer();
    ensureLyrics(track);
  });
  bus.on('player:state', () => renderPlayer());
  bus.on('player:time', (state) => updatePlayerTime(state));
  bus.on('player:buffering', (buffering) => {
    $('#player')?.classList.toggle('buffering', Boolean(buffering));
  });
  bus.on('player:queue', () => {
    renderPlayer();
    if (document.body.classList.contains('right-open') && rightTab === 'queue') renderRightPanel();
  });
  bus.on('player:mode', () => renderPlayer());
  bus.on('player:volume', () => renderPlayer());
  bus.on('player:queue-end', handleQueueEnd);
  bus.on('player:sleep', (payload) => {
    if (!payload) return;
    if (payload.finished) return;
    if (!payload.at) {
      toast({ message: 'Sleep timer off', icon: 'moon', duration: 1600 });
      return;
    }
    const minutes = Math.max(1, Math.round((payload.at - Date.now()) / 60000));
    toast({ message: `Sleep timer set for ${plural(minutes, 'minute')}`, icon: 'moon', duration: 2200 });
  });
  bus.on('store:change', onStoreChange);
  bus.on('store:error', ({ message }) => {
    if (message) toast({ message, icon: 'alert', tone: 'error' });
  });
  bus.on('toast', (payload) => {
    if (payload) toast(payload);
  });
}

function onStoreChange(change = {}) {
  const kind = change.kind;
  renderSidebar();
  updateLikeButtons();
  if (kind === 'offline' && change.id) syncDownloadButtonState(change.id, !change.removed);
  if (kind === 'settings') {
    applySettings();
    renderPlayer();
  }
  if (panelKinds.has(kind) && document.body.classList.contains('right-open')) renderRightPanel();
  if (refreshKinds.has(kind)) {
    if (
      currentRoute.startsWith('/library') ||
      currentRoute.startsWith('/playlist') ||
      currentRoute === '/listen'
    ) {
      scheduleRefresh();
    }
  }
}

async function handleQueueEnd({ queue }) {
  if (!store.getSettings().autoplay) return;
  const last = queue?.[queue.length - 1];
  if (!last || last.source === 'radio') return;
  const seed = last.artist || last.title;
  if (!seed) return;
  try {
    const results = await api.searchSongs(seed, { limit: 24 });
    if (player.getCurrent()?.id !== last.id) return;
    const existing = new Set(player.getQueue().map((track) => track.id));
    const extra = uniqueBy(
      results.filter((track) => track?.id && !existing.has(track.id) && (track.preview || track.trackId)),
      (track) => track.id,
    ).slice(0, 10);
    if (!extra.length) return;
    player.appendTracks(extra);
    const index = player.getQueue().findIndex((track) => track.id === extra[0].id);
    if (index >= 0) player.playIndex(index);
    toast({ message: 'Autoplay is continuing with similar songs', icon: 'sparkles', duration: 2200 });
  } catch {
    /* autoplay is best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* Context menus and delegated inputs                                  */
/* ------------------------------------------------------------------ */

function bindPlaylistContextMenu() {
  document.addEventListener('contextmenu', (event) => {
    const playlistRow = event.target.closest('.playlist-row');
    if (playlistRow) {
      event.preventDefault();
      openPlaylistMenu(playlistRow.dataset.playlistId, { x: event.clientX, y: event.clientY });
      return;
    }
    const trackRow = event.target.closest('tr.track-row');
    if (trackRow) {
      event.preventDefault();
      openTrackMenu(trackRow, { x: event.clientX, y: event.clientY });
    }
  });
}

function bindLibraryInputs() {
  const runFilter = debounce((input) => {
    if (!input || !document.body.contains(input)) return;
    const term = String(input.value || '').trim().toLowerCase();
    let visible = 0;
    $$('#main tr.track-row').forEach((row) => {
      const match = !term || (row.dataset.search || '').includes(term);
      row.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    const wrap = $('.table-wrap');
    if (wrap) {
      let note = document.getElementById('library-filter-empty');
      if (!note) {
        note = document.createElement('p');
        note.id = 'library-filter-empty';
        note.className = 'muted small table-empty hidden';
        note.textContent = 'No songs match that filter.';
        wrap.after(note);
      }
      note.classList.toggle('hidden', visible > 0);
    }
  }, 110);

  document.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-library-filter]');
    if (input) runFilter(input);
  });

  document.addEventListener('change', (event) => {
    const select = event.target.closest?.('[data-library-sort]');
    if (!select) return;
    librarySort = select.value;
    go(buildHash('/library/songs', { sort: select.value }));
  });
}

function openTrackMenu(element, point = null) {
  const track = trackFromElement(element) || (element.dataset?.id ? findTrack(element.dataset.id) : null);
  if (!track) return;
  const listKey = element.dataset?.list || '';
  const list = listKey ? getTrackList(listKey) : [track];
  const index = Number(element.dataset?.index);
  const context = getTrackContext(listKey) || { type: 'track', title: track.title };
  const liked = store.isLiked(track.id);
  const isLocal = track.source === 'local';
  const isOffline = Boolean(track.offline);
  const isAudius = track.source === 'audius';
  const playlistContext = getTrackContext(listKey);
  const items = [
    {
      label: 'Play',
      icon: 'play',
      onClick: () => player.playTracks(
        list.length ? list : [track],
        clamp(Number.isFinite(index) ? index : 0, 0, Math.max(0, list.length - 1)),
        context,
      ),
    },
    { label: 'Play Next', icon: 'queue', onClick: () => player.addToQueue([track], { next: true }) },
    { label: 'Add to Queue', icon: 'plus', onClick: () => player.addToQueue([track]) },
    { separator: true },
    { label: liked ? 'Remove from Loved' : 'Love', icon: 'heart', onClick: () => handleLike(track.id) },
    { label: 'Add to Playlist…', icon: 'playlist', onClick: () => openPlaylistPicker(track) },
    {
      label: isOffline
        ? 'Remove Download'
        : isLocal
          ? 'Stored in Library'
          : isAudius
            ? 'Streamed from Audius'
            : 'Download',
      icon: isOffline ? 'minus' : isLocal || isAudius ? 'check' : 'download',
      disabled: isAudius || (!track.preview && !isOffline) || isLocal,
      onClick: () => (isOffline ? removeOfflineTrack(track) : saveOfflineTrack(track)),
    },
  ];

  if (playlistContext?.type === 'playlist' && playlistContext.id) {
    items.push({ separator: true });
    items.push({
      label: 'Remove from Playlist',
      icon: 'minus',
      danger: true,
      onClick: () => {
        store.removeFromPlaylist(playlistContext.id, track.id);
        toast({ message: 'Removed from playlist', icon: 'minus', duration: 1600 });
        refreshCurrent();
      },
    });
  }

  if (track.albumId && !String(track.albumId).startsWith('local-album')) {
    items.push({ label: 'Go to Album', icon: 'albums', onClick: () => goAlbum(track.albumId) });
  }
  if (track.artistId && !String(track.artistId).startsWith('local-artist')) {
    items.push({ label: 'Go to Artist', icon: 'artists', onClick: () => goArtist(track.artistId) });
  }

  if (isLocal) {
    items.push({ separator: true });
    items.push({
      label: 'Delete from Library',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Delete this file?',
          message: `“${track.title}” will be removed from Orange's library on this device. The original file on disk is not touched.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        await store.removeLocalTrack(track.id);
        if (player.getCurrent()?.id === track.id) player.next();
        toast({ message: 'Removed from library', icon: 'trash' });
        refreshCurrent();
      },
    });
  } else if (store.isSaved(track.id)) {
    items.push({ label: 'Remove from Library', icon: 'minus', onClick: () => { store.removeSavedTrack(track.id); toast({ message: 'Removed from Library', icon: 'minus', duration: 1600 }); } });
  } else {
    items.push({ label: 'Add to Library', icon: 'plus', onClick: () => { store.saveTrack(track); toast({ message: 'Added to Library', icon: 'check', duration: 1600 }); } });
  }

  items.push({ separator: true });
  items.push({
    label: 'Copy Song Info',
    icon: 'copy',
    onClick: () => copyText(`${track.title} — ${track.artist}`)
      .then(() => toast({ message: 'Copied song info', icon: 'copy', duration: 1500 }))
      .catch(() => {}),
  });

  const placement = point ? anchorOrPoint(point) : anchorOrPoint(element);
  if (placement.anchor) openMenu({ anchor: placement.anchor, align: 'right', items });
  else openMenu({ x: placement.x, y: placement.y, items });
}

function openAlbumMenu(id, target) {
  const album = store.albumById(id) || findAlbumByTrackId(id);
  if (!album) return;
  const saved = store.isAlbumSaved(id);
  const play = () => playCard({ dataset: { kind: 'album', id } });
  const items = [
    { label: 'Play', icon: 'play', onClick: play },
    { label: 'Shuffle', icon: 'shuffle', onClick: () => { player.toggleShuffle(true); play(); } },
    {
      label: saved ? 'Remove from Library' : 'Add to Library',
      icon: saved ? 'minus' : 'plus',
      onClick: () => toggleAlbum(id, 'album-tracks'),
    },
    { separator: true },
  ];
  if (album.artistId) items.push({ label: 'Go to Artist', icon: 'artists', onClick: () => goArtist(album.artistId) });
  items.push({
    label: 'Copy Link',
    icon: 'copy',
    onClick: () => copyText(`${window.location.origin}${window.location.pathname}#/album/${encodeURIComponent(id)}`)
      .then(() => toast({ message: 'Link copied', icon: 'copy', duration: 1500 }))
      .catch(() => {}),
  });
  const placement = anchorOrPoint(target);
  if (placement.anchor) openMenu({ anchor: placement.anchor, align: 'right', items });
  else openMenu({ x: placement.x, y: placement.y, items });
}

function findAlbumByTrackId(id) {
  const track = findTrack(id);
  return track?.albumId ? store.albumById(track.albumId) : null;
}

function openPlaylistMenu(id, target) {
  const playlist = store.playlistById(id);
  if (!playlist) return;
  const items = [
    {
      label: 'Play',
      icon: 'play',
      onClick: () => {
        const tracks = store.playlistTracks(id);
        if (!tracks.length) {
          toast({ message: 'This playlist is empty.', icon: 'playlist' });
          return;
        }
        player.playTracks(tracks, 0, { type: 'playlist', id, title: playlist.name });
      },
    },
    {
      label: 'Shuffle',
      icon: 'shuffle',
      onClick: () => {
        const tracks = store.playlistTracks(id);
        if (!tracks.length) return;
        player.toggleShuffle(true);
        player.playTracks(tracks, 0, { type: 'playlist', id, title: playlist.name });
      },
    },
    { separator: true },
    {
      label: 'Rename Playlist',
      icon: 'edit',
      onClick: async () => {
        const name = await promptDialog({
          title: 'Rename Playlist',
          label: 'Name',
          value: playlist.name,
          confirmLabel: 'Rename',
        });
        if (name === null) return;
        store.updatePlaylist(id, { name });
        toast({ message: 'Playlist renamed', icon: 'check', duration: 1600 });
        refreshCurrent();
      },
    },
    { label: 'Edit Playlist…', icon: 'list', onClick: () => openEditPlaylist(id) },
    {
      label: 'Duplicate Playlist',
      icon: 'copy',
      onClick: () => {
        const copy = store.createPlaylist(`${playlist.name} Copy`);
        store.addToPlaylist(copy.id, store.playlistTracks(id));
        toast({ message: 'Playlist duplicated', icon: 'copy', duration: 1600 });
        go(`/playlist/${encodeURIComponent(copy.id)}`);
      },
    },
    { separator: true },
    {
      label: 'Delete Playlist',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Delete playlist?',
          message: `“${playlist.name}” will be deleted. Songs remain in your library.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        store.deletePlaylist(id);
        toast({ message: 'Playlist deleted', icon: 'trash' });
        go('/library/recent');
      },
    },
  ];
  const placement = anchorOrPoint(target);
  if (placement.anchor) openMenu({ anchor: placement.anchor, align: 'right', items });
  else openMenu({ x: placement.x, y: placement.y, items });
}

async function saveOfflineTrack(track) {
  if (track?.source === 'local') {
    toast({ message: 'This file is already stored in your library.', icon: 'check' });
    return;
  }
  if (track?.source === 'audius') {
    toast({
      message: 'Audius tracks stream online and are not saved to this device.',
      icon: 'info',
      duration: 3000,
    });
    return;
  }
  if (!track?.preview) {
    toast({ message: 'This track has no preview available to download.', icon: 'alert', tone: 'error' });
    return;
  }
  const dismiss = toast({
    message: `Downloading “${track.title}”…`,
    icon: 'download',
    duration: 0,
    progress: 0,
  });
  try {
    await downloadPreview(track, (percent) => {
      dismiss.update?.(percent === null
        ? { message: `Downloading “${track.title}”…` }
        : { message: `Downloading “${track.title}”… ${percent}%`, progress: percent });
    });
    dismiss();
    toast({ message: 'Downloaded for offline listening', icon: 'check' });
    if (currentRoute.startsWith('/library') || currentRoute === '/listen') scheduleRefresh();
  } catch (error) {
    dismiss();
    showToastForError(error);
  }
}

async function removeOfflineTrack(track) {
  const ok = await confirmDialog({
    title: 'Remove download?',
    message: `The downloaded audio for “${track.title}” will be removed from this device.`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  await store.removeOfflineTrack(track.id);
  toast({ message: 'Download removed', icon: 'trash' });
  refreshCurrent();
}

/* ------------------------------------------------------------------ */
/* Local collections and playlists                                     */
/* ------------------------------------------------------------------ */

function resolveLocalAlbum(id) {
  const found = groupLibraryAlbums().find((album) => album.id === id);
  if (found) return found;
  const tracks = viewState.localAlbums[id];
  if (tracks?.length) {
    return {
      id,
      title: tracks[0].album || 'Imported Album',
      artist: tracks[0].artist || 'Unknown Artist',
      artwork: artworkOf(tracks[0]),
      tracks,
    };
  }
  return null;
}

function resolveLocalArtist(id) {
  const found = groupLibraryArtists().find((artist) => artist.id === id);
  if (found) return { ...found, tracks: found.tracks || [] };
  const entry = viewState.localArtists[id];
  if (!entry) return null;
  const tracks = entry.tracks?.length
    ? entry.tracks
    : store.allLibraryTracks().filter((track) => track.artist === entry.name);
  return { ...entry, tracks };
}

function openLocalAlbum(id) {
  const album = resolveLocalAlbum(id);
  if (!album) {
    toast({ message: 'This album is no longer in your library.', icon: 'alert', tone: 'error' });
    return;
  }
  const listKey = `local-album-${id}`;
  const context = { type: 'album', id, title: album.title };
  registerTrackList(listKey, album.tracks, context);
  const body = `
    <div class="collection-head">
      <div class="detail-art small" style="${fallbackStyle(album)}">
        ${artMedia(album, { alt: album.title })}
      </div>
      <div class="collection-meta">
        <div class="detail-kicker">Local Album</div>
        <h2 class="collection-title">${esc(album.title)}</h2>
        <p class="muted small">${esc(album.artist || 'Unknown Artist')} · ${plural(album.tracks.length, 'song')}</p>
      </div>
    </div>
    <div class="action-row" style="margin:16px 0 14px">
      <button class="play-large" data-act="play-list" data-list="${esc(listKey)}">${icon('play', 15)}Play</button>
      <button class="play-large secondary" data-act="play-list" data-list="${esc(listKey)}" data-shuffle="1">${icon('shuffle', 15)}Shuffle</button>
    </div>
    ${trackTable(album.tracks, { listKey, context })}`;
  openModal({ title: album.title, eyebrow: 'Local Album', wide: true, body });
}

function openLocalArtist(id) {
  const artist = resolveLocalArtist(id);
  if (!artist) {
    toast({ message: 'This artist is no longer in your library.', icon: 'alert', tone: 'error' });
    return;
  }
  const listKey = `local-artist-${id}`;
  const context = { type: 'artist', id, title: artist.name || artist.title };
  registerTrackList(listKey, artist.tracks, context);
  const body = `
    <div class="collection-head">
      <div class="detail-art small round" style="${fallbackStyle(artist)}">
        ${artMedia(artist, { alt: artist.name || artist.title })}
      </div>
      <div class="collection-meta">
        <div class="detail-kicker">Local Artist</div>
        <h2 class="collection-title">${esc(artist.name || artist.title || 'Artist')}</h2>
        <p class="muted small">${plural(artist.tracks.length, 'song')} in your library</p>
      </div>
    </div>
    <div class="action-row" style="margin:16px 0 14px">
      <button class="play-large" data-act="play-list" data-list="${esc(listKey)}">${icon('play', 15)}Play</button>
      <button class="play-large secondary" data-act="play-list" data-list="${esc(listKey)}" data-shuffle="1">${icon('shuffle', 15)}Shuffle</button>
    </div>
    ${trackTable(artist.tracks, { listKey, context })}`;
  openModal({ title: artist.name || artist.title || 'Artist', eyebrow: 'Local Artist', wide: true, body });
}

async function createPlaylistFlow() {
  const name = await promptDialog({
    title: 'New Playlist',
    label: 'Playlist name',
    value: 'New Playlist',
    confirmLabel: 'Create',
  });
  if (name === null) return;
  const playlist = store.createPlaylist(name);
  toast({ message: 'Playlist created', icon: 'check', duration: 1600 });
  go(`/playlist/${encodeURIComponent(playlist.id)}`);
}

function openPlaylistPicker(track) {
  if (!track?.id) return;
  const body = document.createElement('div');
  const render = () => {
    const playlists = store.playlists();
    body.innerHTML = `
      ${playlists.length
        ? `<div class="picker-list">${playlists.map((playlist) => `
            <button class="picker-row" data-pick="${esc(playlist.id)}">
              <span class="picker-icon">${icon('playlist', 16)}</span>
              <span class="picker-name">${esc(playlist.name)}</span>
              <span class="picker-count">${playlist.trackIds.length}</span>
              ${playlist.trackIds.includes(track.id) ? `<span class="picker-check">${icon('check', 14)}</span>` : ''}
            </button>`).join('')}</div>`
        : '<p class="muted small table-empty">You have no playlists yet.</p>'}
      <div class="divider"></div>
      <button class="pill-btn" data-new-picker>${icon('plus', 15)}New Playlist</button>`;
    body.querySelectorAll('[data-pick]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.pick;
        store.addToPlaylist(id, [track]);
        const playlist = store.playlistById(id);
        toast({ message: `Added to ${playlist?.name || 'playlist'}`, icon: 'check', duration: 1800 });
        closeModal();
      });
    });
    body.querySelector('[data-new-picker]')?.addEventListener('click', async () => {
      const name = await promptDialog({
        title: 'New Playlist',
        label: 'Playlist name',
        value: `${track.title} Mix`,
        confirmLabel: 'Create',
      });
      if (name === null) return;
      const playlist = store.createPlaylist(name);
      store.addToPlaylist(playlist.id, [track]);
      toast({ message: `Created “${playlist.name}”`, icon: 'check', duration: 1800 });
      closeModal();
    });
  };
  render();
  openModal({
    title: 'Add to Playlist',
    eyebrow: track.title,
    body,
    footer: '<button class="pill-btn secondary" data-close-modal>Done</button>',
  });
}

function openEditPlaylist(id) {
  let playlist = store.playlistById(id);
  if (!playlist) return;
  const body = document.createElement('div');
  const render = () => {
    playlist = store.playlistById(id) || playlist;
    const tracks = store.playlistTracks(id);
    body.innerHTML = `
      <div class="field">
        <label for="edit-playlist-name">Name</label>
        <input id="edit-playlist-name" type="text" maxlength="120" value="${esc(playlist.name)}">
      </div>
      <div class="field">
        <label for="edit-playlist-desc">Description</label>
        <textarea id="edit-playlist-desc" maxlength="600" placeholder="Optional">${esc(playlist.description || '')}</textarea>
      </div>
      <div class="section-head"><h3 class="section-title">Tracks <span class="count">${tracks.length}</span></h3></div>
      ${tracks.length
        ? `<div class="edit-tracks">${tracks.map((track, index) => `
            <div class="edit-track">
              <span class="mini-art" style="${fallbackStyle(track)}">${artMedia(track, { alt: track.title })}</span>
              <span class="edit-track-info">
                <span class="edit-track-title">${esc(track.title)}</span>
                <span class="edit-track-sub">${esc(track.artist || '')}</span>
              </span>
              <span class="edit-track-actions">
                <button class="icon-btn" data-move="up" data-index="${index}" title="Move up" ${index === 0 ? 'disabled' : ''}>${icon('chevron-up', 14)}</button>
                <button class="icon-btn" data-move="down" data-index="${index}" title="Move down" ${index === tracks.length - 1 ? 'disabled' : ''}>${icon('chevron-down', 14)}</button>
                <button class="icon-btn" data-remove="${esc(track.id)}" title="Remove" aria-label="Remove">${icon('close', 14)}</button>
              </span>
            </div>`).join('')}</div>`
        : '<p class="muted small table-empty">No tracks yet. Use a track menu to add songs.</p>'}`;
    body.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        store.removeFromPlaylist(id, button.dataset.remove);
        render();
        refreshCurrent();
      });
    });
    body.querySelectorAll('[data-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        const target = button.dataset.move === 'up' ? index - 1 : index + 1;
        store.movePlaylistTrack(id, index, target);
        render();
        refreshCurrent();
      });
    });
  };
  render();
  openModal({
    title: 'Edit Playlist',
    eyebrow: 'Playlist',
    wide: true,
    body,
    footer: '<button class="pill-btn secondary" data-cancel>Cancel</button><button class="pill-btn" data-save>Save</button>',
    onMount(modal, close) {
      modal.querySelector('[data-cancel]')?.addEventListener('click', close);
      modal.querySelector('[data-save]')?.addEventListener('click', () => {
        const name = modal.querySelector('#edit-playlist-name')?.value ?? playlist.name;
        const description = modal.querySelector('#edit-playlist-desc')?.value ?? playlist.description;
        store.updatePlaylist(id, { name, description });
        toast({ message: 'Playlist saved', icon: 'check', duration: 1600 });
        close();
        refreshCurrent();
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function openImportDialog(fileList = null) {
  if (fileList) {
    runImport(fileList);
    return;
  }
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="dropzone" id="import-dropzone">
      <div class="dropzone-icon">${icon('upload', 26)}</div>
      <h3>Drop music here</h3>
      <p>MP3, M4A, AAC, FLAC, WAV, Ogg and Opus. Audio stays on this device.</p>
      <div class="action-row" style="justify-content:center">
        <button class="pill-btn" id="import-pick-files">${icon('file-audio', 15)}Choose files</button>
        <button class="pill-btn secondary" id="import-pick-folder">${icon('folder', 15)}Choose folder</button>
      </div>
    </div>
    <p class="muted small import-note">Orange copies imported audio into its local library. Nothing is uploaded, and no account is required.</p>
    <input id="import-file-input" type="file" accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus" multiple hidden>
    <input id="import-folder-input" type="file" webkitdirectory multiple hidden>`;
  openModal({
    title: 'Add Music',
    eyebrow: 'Library',
    wide: true,
    body,
    onMount(modal, close) {
      const fileInput = modal.querySelector('#import-file-input');
      const folderInput = modal.querySelector('#import-folder-input');
      const dropzone = modal.querySelector('#import-dropzone');
      modal.querySelector('#import-pick-files')?.addEventListener('click', () => fileInput?.click());
      modal.querySelector('#import-pick-folder')?.addEventListener('click', () => folderInput?.click());
      const handleFiles = (files) => {
        if (!files?.length) return;
        close();
        runImport(files);
      };
      fileInput?.addEventListener('change', () => handleFiles(fileInput.files));
      folderInput?.addEventListener('change', () => handleFiles(folderInput.files));
      dropzone?.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropzone.classList.add('over');
      });
      dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('over'));
      dropzone?.addEventListener('drop', (event) => {
        event.preventDefault();
        dropzone.classList.remove('over');
        handleFiles(event.dataTransfer?.files);
      });
    },
  });
}

async function runImport(fileList) {
  const all = Array.from(fileList || []);
  const files = all.filter(isSupportedAudio);
  if (!files.length) {
    toast({ message: 'No supported audio files were found.', icon: 'alert', tone: 'error' });
    return;
  }
  const progress = progressModal({
    title: files.length === 1 ? 'Importing track' : `Importing ${files.length} tracks`,
    subtitle: 'Reading tags and storing audio on this device.',
    eyebrow: 'Library',
  });
  let imported = 0;
  let failed = 0;
  try {
    const result = await importFiles(files, {
      onProgress(index, total, file, fraction) {
        const percent = ((index + fraction) / total) * 100;
        progress.setProgress(percent, `Reading ${file.name}`, `${index + 1} of ${total}`);
      },
      async onFile(item) {
        const { track, artworkBlob, file } = item;
        try {
          await db.putAudio(track.audioKey, file);
          if (track.artworkKey && artworkBlob) await db.putArtwork(track.artworkKey, artworkBlob);
          store.addLocalTrack(track);
          imported += 1;
        } catch (error) {
          failed += 1;
          console.error('[orange] import failed', error);
        }
      },
    });
    failed += result.errors.length;
    progress.setProgress(100, 'Finishing up…', `${imported} imported`);
    await store.loadLocalMedia();
    progress.close();
    if (imported) toast({ message: `Imported ${plural(imported, 'track')}`, icon: 'check', duration: 2400 });
    if (failed) toast({ message: `${plural(failed, 'file')} could not be imported`, icon: 'alert', tone: 'error' });
    if (imported && (currentRoute.startsWith('/library') || currentRoute === '/listen')) refreshCurrent();
  } catch (error) {
    progress.close();
    showToastForError(error);
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

let settingsTab = 'general';

const COUNTRIES = [
  ['us', 'United States'], ['gb', 'United Kingdom'], ['ca', 'Canada'],
  ['au', 'Australia'], ['de', 'Germany'], ['fr', 'France'],
  ['jp', 'Japan'], ['br', 'Brazil'], ['mx', 'Mexico'],
  ['in', 'India'], ['es', 'Spain'], ['it', 'Italy'],
  ['nl', 'Netherlands'], ['se', 'Sweden'], ['kr', 'South Korea'],
];

function openSettings(tab = settingsTab) {
  settingsTab = tab;
  openModal({
    title: 'Settings',
    eyebrow: 'Orange',
    wide: true,
    className: 'settings-modal',
    body: '<div class="settings-layout"><nav class="settings-nav" id="settings-nav" aria-label="Settings sections"></nav><div class="settings-pane" id="settings-pane"></div></div>',
    onMount(modal) {
      renderSettings(modal);
    },
  });
}

function renderSettings(modal) {
  const nav = modal.querySelector('#settings-nav');
  const pane = modal.querySelector('#settings-pane');
  if (!nav || !pane) return;
  const tabs = [
    ['general', 'General'],
    ['playback', 'Playback'],
    ['equalizer', 'Equalizer'],
    ['library', 'Library'],
    ['about', 'About'],
  ];
  nav.innerHTML = tabs.map(([key, label]) => `
    <button class="settings-tab ${settingsTab === key ? 'active' : ''}" data-settings-tab="${key}">${esc(label)}</button>`).join('');
  nav.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      settingsTab = button.dataset.settingsTab;
      renderSettings(modal);
    });
  });
  pane.innerHTML = settingsPane(settingsTab);
  bindSettingsPane(pane, modal);
  if (settingsTab === 'library') hydrateStorageUsage(pane);
}

function toggleRow(label, description, checked, key) {
  return `<div class="setting-row">
    <div class="s-copy">
      <div class="s-label">${esc(label)}</div>
      <div class="s-desc">${esc(description)}</div>
    </div>
    <div class="s-right">
      <button class="switch ${checked ? 'on' : ''}" role="switch" aria-checked="${checked}" data-toggle="${esc(key)}" aria-label="${esc(label)}"></button>
    </div>
  </div>`;
}

function settingsPane(tab) {
  const settings = store.getSettings();
  if (tab === 'playback') {
    const sleepRemaining = player.sleepAt ? Math.max(0, Math.ceil((player.sleepAt - Date.now()) / 60000)) : 0;
    return `
      <div class="settings-group">
        <h3 class="settings-title">Playback</h3>
        ${toggleRow('Autoplay', 'Keep the music going with similar songs when the queue ends.', settings.autoplay, 'autoplay')}
        ${toggleRow('Prefer local files', 'When a catalog song matches an imported file, play your full-length copy instead of the preview.', settings.preferLocal, 'preferLocal')}
        ${toggleRow('Crossfade', 'Blend the end of one song into the next.', settings.crossfadeOn, 'crossfadeOn')}
        <div class="setting-row">
          <div class="s-copy"><div class="s-label">Crossfade length</div><div class="s-desc">How long the blend lasts.</div></div>
          <div class="s-right range-wrap">
            <input type="range" min="1" max="12" step="1" value="${Number(settings.crossfade) || 3}" data-range="crossfade" ${settings.crossfadeOn ? '' : 'disabled'} aria-label="Crossfade seconds">
            <span id="crossfade-value">${Number(settings.crossfade) || 3}s</span>
          </div>
        </div>
        ${toggleRow('Show lyrics', 'Load synced lyrics from LRCLIB when available.', settings.showLyrics, 'showLyrics')}
        ${toggleRow('Now Playing visualizer', 'Show the live audio spectrum in the full player.', settings.showVisualizer, 'showVisualizer')}
        ${toggleRow('Radio fade', 'Gently fade in live radio streams.', settings.radioFade, 'radioFade')}
      </div>
      <div class="settings-group">
        <h3 class="settings-title">Sleep timer</h3>
        <div class="setting-row">
          <div class="s-copy"><div class="s-label">${sleepRemaining ? `Stops in ${plural(sleepRemaining, 'minute')}` : 'Off'}</div><div class="s-desc">Pause playback after a set time.</div></div>
          <div class="s-right action-row">
            ${[15, 30, 60].map((minutes) => `<button class="pill-btn secondary ${sleepRemaining === minutes ? 'active' : ''}" data-sleep="${minutes}">${minutes}m</button>`).join('')}
            <button class="pill-btn ghost" data-sleep="0">Off</button>
          </div>
        </div>
      </div>`;
  }

  if (tab === 'equalizer') return equalizerMarkup();

  if (tab === 'library') {
    const stats = store.libraryStats();
    return `
      <div class="settings-group">
        <h3 class="settings-title">Your library</h3>
        <div class="library-summary settings-stats">
          <div><strong>${stats.tracks}</strong><span>Tracks</span></div>
          <div><strong>${stats.albums}</strong><span>Albums</span></div>
          <div><strong>${stats.artists}</strong><span>Artists</span></div>
          <div><strong>${stats.local}</strong><span>Local files</span></div>
          <div><strong>${stats.playlists}</strong><span>Playlists</span></div>
        </div>
        <div class="setting-row">
          <div class="s-copy"><div class="s-label">Device storage</div><div class="s-desc" id="storage-usage">Checking…</div></div>
          <div class="s-right"><button class="pill-btn ghost" data-library-action="refresh-storage">${icon('refresh', 14)}Refresh</button></div>
        </div>
        <div class="setting-row">
          <div class="s-copy"><div class="s-label">Backup library</div><div class="s-desc">Export playlists, saved music and settings as a JSON file. Imported audio files are not included.</div></div>
          <div class="s-right action-row">
            <button class="pill-btn secondary" data-library-action="export">${icon('download', 14)}Export</button>
            <button class="pill-btn secondary" data-library-action="import">${icon('upload', 14)}Import</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="s-copy"><div class="s-label">Reset Orange</div><div class="s-desc">Remove saved songs, playlists, downloads and imported files from this device.</div></div>
          <div class="s-right"><button class="pill-btn danger" data-library-action="reset">${icon('trash', 14)}Reset</button></div>
        </div>
      </div>`;
  }

  if (tab === 'about') {
    return `
      <div class="about-hero">
        <div class="brand-mark large" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="34" height="34"><path fill="currentColor" d="M13 5.2v14.1a4.6 4.6 0 1 0 2.2 3.9V9.4l8.1-2.1v9.3a4.6 4.6 0 1 0 2.2 3.9V4.1L13 5.2Z"/></svg>
        </div>
        <div><h2>Orange</h2><p class="muted small">Version 1.0.0 · Independent music client</p></div>
      </div>
      <div class="about-text">
        <p><strong>Orange</strong> is an independent, local-first music app. It is not affiliated with, endorsed by, or connected to Apple or Audius, and it does not include or bypass any DRM.</p>
        <p>Metadata, artwork and free 30-second previews come from the public iTunes Search API. Charts use Apple's public RSS feeds. Free full-length tracks come from the Audius public API, streamed directly from Audius. Lyrics come from LRCLIB. Live radio is provided by Radio Paradise. Your own audio files never leave this device.</p>
        <p>Orange does not sign in to a music subscription and does not unlock paid streaming. Nothing here bypasses DRM or account checks. Full-length catalog tracks from Apple Music require the service that hosts them.</p>
        <p class="small">Audius needs no account or key here: public search and streaming identify Orange with an app name only. Streams are subject to each artist's permissions and may be unavailable if an artist removes a track.</p>
      </div>
      <div class="action-row" style="margin-top:16px">
        <button class="pill-btn secondary" data-act="shortcuts">${icon('help', 15)}Keyboard shortcuts</button>
      </div>`;
  }

  return `
    <div class="settings-group">
      <h3 class="settings-title">Appearance</h3>
      <div class="setting-row">
        <div class="s-copy"><div class="s-label">Theme</div><div class="s-desc">Match the room or follow your system.</div></div>
        <div class="s-right">
          <div class="segmented theme-seg">
            ${['dark', 'light', 'system'].map((theme) => `<button class="${settings.theme === theme ? 'active' : ''}" data-theme-choice="${theme}">${theme[0].toUpperCase() + theme.slice(1)}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="setting-row">
        <div class="s-copy"><div class="s-label">Accent color</div><div class="s-desc">Used for highlights, controls and Now Playing.</div></div>
        <div class="s-right">
          <div class="theme-swatches">
            ${accentPresets.map((accent) => `<button class="theme-swatch ${settings.accent === accent.value ? 'active' : ''}" style="background:${accent.value}" data-accent="${accent.value}" title="${esc(accent.name)}" aria-label="${esc(accent.name)}"></button>`).join('')}
          </div>
        </div>
      </div>
      <div class="setting-row">
        <div class="s-copy"><div class="s-label">Catalog storefront</div><div class="s-desc">Changes the free iTunes catalog and charts.</div></div>
        <div class="s-right">
          <select class="settings-select" data-setting-select="country">
            ${COUNTRIES.map(([code, name]) => `<option value="${code}" ${settings.country === code ? 'selected' : ''}>${esc(name)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${toggleRow('Show explicit content', 'Include tracks marked explicit in search and charts.', settings.explicit, 'explicit')}
      ${toggleRow('Animated artwork', 'Let artwork breathe in the full player.', settings.animatedArt, 'animatedArt')}
      ${toggleRow('Reduce motion', 'Trim animations and transitions.', settings.reduceMotion, 'reduceMotion')}
      ${toggleRow('Compact rows', 'Fit more songs on screen.', settings.compactRows, 'compactRows')}
    </div>
    <div class="settings-group">
      <h3 class="settings-title">About this app</h3>
      <p class="about-text">Orange plays free previews, public radio and your own files. No account, subscription or DRM is involved.</p>
      <div class="action-row" style="margin-top:12px">
        <button class="pill-btn secondary" data-act="shortcuts">${icon('help', 15)}Keyboard shortcuts</button>
        <button class="pill-btn ghost" data-act="settings" data-tab="about">${icon('info', 15)}About Orange</button>
      </div>
    </div>`;
}

function bindSettingsPane(pane, modal) {
  pane.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.toggle;
      const settings = store.getSettings();
      const next = !settings[key];
      store.updateSettings({ [key]: next });
      if (key === 'eqEnabled') player.applyEq(true);
      if (key === 'showLyrics' && next) ensureLyrics(player.getCurrent());
      renderSettings(modal);
    });
  });

  pane.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      store.updateSettings({ theme: button.dataset.themeChoice });
      applySettings();
      renderSettings(modal);
    });
  });

  pane.querySelectorAll('[data-accent]').forEach((button) => {
    button.addEventListener('click', () => {
      store.updateSettings({ accent: button.dataset.accent });
      applySettings();
      renderSettings(modal);
    });
  });

  pane.querySelector('[data-setting-select="country"]')?.addEventListener('change', (event) => {
    store.updateSettings({ country: event.target.value });
    api.setCatalogCountry(event.target.value);
    refreshCurrent();
    toast({ message: 'Catalog storefront updated', icon: 'globe', duration: 1800 });
  });

  const crossfade = pane.querySelector('[data-range="crossfade"]');
  crossfade?.addEventListener('input', () => {
    const label = pane.querySelector('#crossfade-value');
    if (label) label.textContent = `${crossfade.value}s`;
  });
  crossfade?.addEventListener('change', () => {
    store.updateSettings({ crossfade: Number(crossfade.value) || 3 });
  });

  pane.querySelectorAll('[data-sleep]').forEach((button) => {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset.sleep) || 0;
      player.setSleepTimer(minutes);
      renderSettings(modal);
    });
  });

  bindEqControls(pane, () => renderSettings(modal));

  pane.querySelectorAll('[data-library-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.libraryAction;
      if (action === 'export') exportLibraryFile();
      else if (action === 'import') importLibraryFile(modal);
      else if (action === 'reset') resetLibrary(modal);
      else if (action === 'refresh-storage') hydrateStorageUsage(pane);
    });
  });
}

function hydrateStorageUsage(pane) {
  const node = pane.querySelector('#storage-usage');
  if (!node) return;
  node.textContent = 'Checking…';
  db.estimate().then(({ usage, quota }) => {
    if (!node.isConnected) return;
    node.textContent = quota
      ? `${formatBytes(usage)} used of ${formatBytes(quota)} available`
      : `${formatBytes(usage)} used`;
  }).catch(() => {
    if (node.isConnected) node.textContent = 'Storage information is unavailable.';
  });
}

function exportLibraryFile() {
  try {
    const payload = store.exportLibrary();
    payload.trackCache = store.getState().trackCache;
    const date = new Date().toISOString().slice(0, 10);
    downloadText(JSON.stringify(payload, null, 2), `orange-library-${date}.json`);
    toast({ message: 'Library exported', icon: 'download' });
  } catch (error) {
    showToastForError(error);
  }
}

function importLibraryFile(modal) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      store.importLibrary(payload);
      await store.loadLocalMedia();
      applySettings();
      renderSidebar();
      refreshCurrent();
      toast({ message: 'Library imported', icon: 'check', duration: 2400 });
      renderSettings(modal);
    } catch (error) {
      showToastForError(error);
    }
  });
  input.click();
}

async function resetLibrary(modal) {
  const ok = await confirmDialog({
    title: 'Reset Orange?',
    message: 'Your playlists, saved songs, downloads and imported files will be removed from this device. This cannot be undone.',
    confirmLabel: 'Reset everything',
    danger: true,
  });
  if (!ok) return;
  player.stop({ keepTrack: false });
  store.reset();
  try {
    await db.clearAll();
  } catch {
    /* ignore */
  }
  applySettings();
  renderSidebar();
  closeModal();
  go('/listen');
  toast({ message: 'Orange has been reset', icon: 'refresh', duration: 2400 });
}

/* ------------------------------------------------------------------ */
/* Equalizer                                                           */
/* ------------------------------------------------------------------ */

function formatEqFrequency(frequency) {
  return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
}

function equalizerMarkup() {
  const settings = store.getSettings();
  const enabled = Boolean(settings.eqEnabled);
  const eq = Array.isArray(settings.eq) ? settings.eq : EQ_PRESETS.Flat;
  const preset = settings.eqPreset || 'Flat';
  const presetNames = Object.keys(EQ_PRESETS);
  return `
    <div class="settings-group eq-group">
      <div class="eq-head">
        <div class="s-copy">
          <h3 class="settings-title">Equalizer</h3>
          <p class="settings-note">Shape the sound with ten bands from 32 Hz to 16 kHz. Applies to previews, local files and radio.</p>
        </div>
        <button class="switch ${enabled ? 'on' : ''}" role="switch" aria-checked="${enabled}" data-eq-toggle aria-label="Enable equalizer" title="${enabled ? 'Turn equalizer off' : 'Turn equalizer on'}"></button>
      </div>
      <div class="eq-presets" role="group" aria-label="Equalizer presets">
        ${presetNames.map((name) => `
          <button class="chip eq-chip ${preset === name ? 'active' : ''}" data-eq-preset="${esc(name)}">${esc(name)}</button>`).join('')}
      </div>
      <div class="eq-bands ${enabled ? '' : 'is-off'}">
        ${EQ_FREQUENCIES.map((frequency, index) => {
          const value = clamp(Number(eq[index]) || 0, -12, 12);
          return `
            <div class="eq-band">
              <span class="eq-value">${value > 0 ? '+' : ''}${value}</span>
              <input class="eq-slider" type="range" min="-12" max="12" step="1" value="${value}"
                data-eq-band="${index}" aria-label="${formatEqFrequency(frequency)} hertz"
                orient="vertical">
              <span class="eq-freq">${formatEqFrequency(frequency)}</span>
            </div>`;
        }).join('')}
      </div>
      <div class="eq-foot">
        <span class="settings-note">${enabled ? 'Equalizer is active.' : 'Equalizer is bypassed — the preset is saved.'}</span>
        <div class="action-row">
          <button class="pill-btn ghost" data-eq-reset>${icon('refresh', 14)}Reset to Flat</button>
        </div>
      </div>
    </div>`;
}

function bindEqControls(pane, rerender) {
  pane.querySelector('[data-eq-toggle]')?.addEventListener('click', () => {
    const enabled = Boolean(store.getSettings().eqEnabled);
    player.setEqEnabled(!enabled);
    if (typeof rerender === 'function') rerender();
  });

  pane.querySelectorAll('[data-eq-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.eqPreset;
      if (!name) return;
      player.setEqPreset(name);
      if (typeof rerender === 'function') rerender();
    });
  });

  pane.querySelectorAll('[data-eq-band]').forEach((input) => {
    const index = Number(input.dataset.eqBand);
    const output = input.closest('.eq-band')?.querySelector('.eq-value');
    const paint = () => {
      const value = clamp(Number(input.value) || 0, -12, 12);
      if (output) output.textContent = `${value > 0 ? '+' : ''}${value}`;
    };
    paint();
    input.addEventListener('input', () => {
      paint();
      player.setEqGain(index, Number(input.value));
    });
  });

  pane.querySelector('[data-eq-reset]')?.addEventListener('click', () => {
    player.setEqPreset('Flat');
    if (typeof rerender === 'function') rerender();
  });
}

function openEqualizer() {
  settingsTab = 'equalizer';
  openSettings('equalizer');
}

function openAbout() {
  settingsTab = 'about';
  openSettings('about');
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts                                                  */
/* ------------------------------------------------------------------ */

function openShortcuts() {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const mod = isMac ? '⌘' : 'Ctrl';
  const groups = [
    {
      title: 'Playback',
      rows: [
        [['Space'], 'Play or pause'],
        [['←', '→'], 'Seek back or forward 5 seconds'],
        [['Shift', '←/→'], 'Seek back or forward 5 seconds'],
        [[`${mod}`, '←/→'], 'Previous or next track'],
        [['↑', '↓'], 'Volume up or down'],
        [['M'], 'Mute or unmute'],
        [['S'], 'Toggle shuffle'],
        [['R'], 'Cycle repeat mode'],
        [['L'], 'Love the current song'],
      ],
    },
    {
      title: 'Navigation',
      rows: [
        [[`${mod}`, 'K'], 'Focus search'],
        [['/'], 'Focus search'],
        [[`${mod}`, 'F'], 'Search'],
        [['Q'], 'Open the queue'],
        [['Esc'], 'Close panel, menu or full player'],
        [['?'], 'Show this shortcut list'],
      ],
    },
    {
      title: 'Library',
      rows: [
        [[`${mod}`, 'N'], 'Create a playlist'],
        [[`${mod}`, 'R'], 'Refresh the current page'],
        [['Enter'], 'Play the focused song or open the focused item'],
      ],
    },
  ];

  const body = `
    <div class="shortcut-groups">
      ${groups.map((group) => `
        <section class="shortcut-group">
          <h3 class="settings-title">${esc(group.title)}</h3>
          <div class="shortcut-list">
            ${group.rows.map(([keys, description]) => `
              <div class="shortcut-row">
                <span class="shortcut-keys">${keys.map((key) => `<kbd>${esc(key)}</kbd>`).join('<span class="shortcut-plus">+</span>')}</span>
                <span class="shortcut-desc">${esc(description)}</span>
              </div>`).join('')}
          </div>
        </section>`).join('')}
    </div>
    <p class="settings-note" style="margin-top:18px">Shortcuts work anywhere except while typing in a text field.</p>`;

  openModal({
    title: 'Keyboard Shortcuts',
    eyebrow: 'Orange',
    wide: true,
    className: 'shortcuts-modal',
    body,
    footer: '<button class="pill-btn secondary" data-close-modal>Done</button>',
  });
}
