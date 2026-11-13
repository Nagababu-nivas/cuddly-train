/* Shared view state and HTML building blocks. */

import {
  $, esc, art, formatTime, gradientFor, hashString, initials, plural, yearOf,
} from './util.js?v=orange3';
import { icon } from './icons.js?v=orange3';
import { store } from './store.js?v=orange3';
import { player } from './player.js?v=orange3';

export const viewState = {
  route: '/listen',
  trackLists: {},
  contexts: {},
  localAlbums: {},
  localArtists: {},
  lists: {},
};

let navigator = (path) => {
  window.location.hash = path;
};

export function setNavigator(fn) {
  if (typeof fn === 'function') navigator = fn;
}

export function go(path) {
  navigator(path);
}

export function goAlbum(id) {
  go(`/album/${encodeURIComponent(id)}`);
}

export function goArtist(id) {
  go(`/artist/${encodeURIComponent(id)}`);
}

export function goSearch(term) {
  const value = String(term || '').trim();
  go(value ? `/search?q=${encodeURIComponent(value)}` : '/search');
}

export function resetView(route) {
  viewState.route = route;
  viewState.trackLists = {};
  viewState.contexts = {};
  viewState.localAlbums = {};
  viewState.localArtists = {};
  viewState.lists = {};
}

export function registerTrackList(key, tracks, context = null) {
  viewState.trackLists[key] = tracks;
  if (context) viewState.contexts[key] = context;
  return key;
}

export function registerList(key, items) {
  viewState.lists[key] = items;
  return key;
}

export function getTrackList(key) {
  return viewState.trackLists[key] || [];
}

export function getTrackContext(key) {
  return viewState.contexts[key] || null;
}

export function setHeader(eyebrow, title) {
  const eyebrowNode = $('#topbar-eyebrow');
  const titleNode = $('#topbar-title');
  if (eyebrowNode) eyebrowNode.textContent = eyebrow || '';
  if (titleNode) titleNode.textContent = title || '';
  document.title = `${title || 'Orange'} · Orange`;
}

export function setMain(html) {
  const main = $('#main');
  if (!main) return;
  main.innerHTML = `<div class="view">${html}</div>`;
}

export function scrollMainTop() {
  const main = $('#main');
  if (main) main.scrollTop = 0;
}

export function artworkOf(item) {
  return item?.artwork || item?.artworkUrl || item?.artworkSmall || '';
}

export function displayName(item) {
  return item?.title || item?.name || 'Untitled';
}

export function displaySubtitle(item, kind = 'track') {
  if (!item) return '';
  if (kind === 'track') return item.artist || 'Unknown Artist';
  if (kind === 'album') return [item.artist, yearOf(item.releaseDate || item.year)].filter(Boolean).join(' · ');
  if (kind === 'artist') return item.genre || 'Artist';
  if (kind === 'playlist') return `${plural(item.trackIds?.length || item.tracks?.length || 0, 'song')}`;
  if (kind === 'mix') return item.subtitle || '';
  if (kind === 'genre') return item.subtitle || 'Explore';
  if (kind === 'station') return item.subtitle || 'Live radio';
  return item.artist || item.subtitle || '';
}

export function fallbackStyle(item, hue = null) {
  const seed = `${displayName(item)} ${item?.artist || ''}`;
  const h = hue ?? (item?.hue ?? null);
  if (h !== null && Number.isFinite(Number(h))) {
    return `background: linear-gradient(145deg, hsl(${h} 58% 36%), hsl(${(Number(h) + 46) % 360} 58% 20%));`;
  }
  return `background: ${gradientFor(seed)};`;
}

export function artMedia(item, { alt = '', size = 600, className = '' } = {}) {
  const source = artworkOf(item);
  const label = initials(displayName(item));
  const safeAlt = esc(alt || displayName(item));
  return `
    <span class="art-fallback" aria-hidden="true">${esc(label)}</span>
    ${source ? `<img class="${className}" data-art src="${esc(art(source, size))}" alt="${safeAlt}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}`;
}

export function likeButton(track, { className = '' } = {}) {
  const liked = store.isLiked(track.id);
  return `<button class="icon-btn like-btn ${liked ? 'liked' : ''} ${className}" data-act="like" data-id="${esc(track.id)}" title="${liked ? 'Remove from Loved' : 'Love'}" aria-label="${liked ? 'Remove from Loved' : 'Love'}" aria-pressed="${liked}">${icon('heart', 17)}</button>`;
}

export function downloadButton(track) {
  if (!track) return '';
  const stored = track.source === 'local' || Boolean(track.offline);
  const audius = track.source === 'audius';
  const available = !audius && (Boolean(track.preview) || stored);
  const label = audius
    ? 'Audius streams play online and are not saved here'
    : stored
      ? 'Stored in your library'
      : available
        ? 'Download for offline listening'
        : 'Download unavailable';
  return `<button class="icon-btn download-btn ${stored ? 'downloaded' : ''}" data-act="download-track" data-id="${esc(track.id)}" title="${label}" aria-label="${label}" ${available ? '' : 'disabled'}>${icon(stored ? 'check' : 'download', 16)}</button>`;
}

export function moreButton(track, listKey, index) {
  return `<button class="icon-btn" data-act="track-menu" data-id="${esc(track.id)}" data-list="${esc(listKey)}" data-index="${index}" title="More" aria-label="More options">${icon('more', 17)}</button>`;
}

export function previewNote(track) {
  if (!track || track.source === 'local' || track.offline) return '';
  if (!track.preview) return '';
  return '<span class="badge preview">Preview</span>';
}

export function card(item, kind, {
  listKey = '', index = -1, round = false, subtitle = null, badge = '', query = '', extra = '',
} = {}) {
  const name = displayName(item);
  const sub = subtitle ?? displaySubtitle(item, kind);
  const id = item.id || item.name || '';
  const openAttrs = `data-act="open" data-kind="${esc(kind)}" data-id="${esc(id)}"${query ? ` data-query="${esc(query)}"` : ''}`;
  const playAttrs = `data-act="card-play" data-kind="${esc(kind)}" data-id="${esc(id)}"${listKey ? ` data-list="${esc(listKey)}" data-index="${index}"` : ''}${query ? ` data-query="${esc(query)}"` : ''}`;
  return `
    <article class="card ${round ? 'round' : ''}" data-card-id="${esc(id)}">
      <div class="card-art-holder">
        <button class="card-art" ${openAttrs} aria-label="Open ${esc(name)}" style="${fallbackStyle(item)}">
          ${artMedia(item, { alt: name })}
          ${badge ? `<span class="preview-badge">${esc(badge)}</span>` : ''}
        </button>
        <button class="card-play" ${playAttrs} title="Play ${esc(name)}" aria-label="Play ${esc(name)}">${icon('play', 18)}</button>
      </div>
      <button class="card-label" ${openAttrs}>
        <span class="card-title">${esc(name)}</span>
        <span class="card-sub">${esc(sub)}</span>
      </button>
    </article>`;
}

export function shelf(title, items, kind, {
  listKey = '', context = null, round = false, subtitle = null, link = '', badgeFor = null,
  empty = '', className = '',
} = {}) {
  if (!items || !items.length) return empty;
  if (listKey) registerTrackList(listKey, items, context);
  return `
    <section class="section ${className}">
      <div class="section-head">
        <h3 class="section-title">${esc(title)}${items.length ? ` <span class="count">${items.length}</span>` : ''}</h3>
        ${link || ''}
      </div>
      <div class="shelf">
        ${items.map((item, index) => card(item, kind, {
          listKey,
          index,
          round,
          subtitle: typeof subtitle === 'function' ? subtitle(item) : subtitle,
          badge: badgeFor ? badgeFor(item) : '',
        })).join('')}
      </div>
    </section>`;
}

export function pageHead(title, subtitle = '', actions = '') {
  return `
    <div class="view-head">
      <div>
        <h2>${esc(title)}</h2>
        ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="view-head-actions">${actions}</div>` : ''}
    </div>`;
}

export function sectionHead(title, count = null, action = '') {
  return `
    <div class="section-head">
      <h3 class="section-title">${esc(title)}${count !== null ? ` <span class="count">${esc(count)}</span>` : ''}</h3>
      ${action}
    </div>`;
}

export function hero({
  kicker = '', title = '', description = '', actions = '', artwork = '', hue = null, className = '',
}) {
  return `
    <section class="hero ${className}" ${hue !== null ? `style="--hero-hue:${Number(hue)}"` : ''}>
      ${artwork ? `<div class="hero-art" style="background-image:url('${esc(art(artwork, 1000))}')"></div>` : ''}
      <div class="hero-content">
        ${kicker ? `<div class="hero-kicker">${icon('sparkles', 13)}${esc(kicker)}</div>` : ''}
        <h2>${esc(title)}</h2>
        ${description ? `<p>${esc(description)}</p>` : ''}
        ${actions ? `<div class="hero-actions">${actions}</div>` : ''}
      </div>
    </section>`;
}

export function emptyState({
  iconName = 'music', title = 'Nothing here yet', description = '', actions = '', small = false,
} = {}) {
  return `
    <div class="empty ${small ? 'small' : ''}">
      <div class="empty-icon">${icon(iconName, 24)}</div>
      <h3>${esc(title)}</h3>
      ${description ? `<p>${esc(description)}</p>` : ''}
      ${actions ? `<div class="action-row">${actions}</div>` : ''}
    </div>`;
}

export function errorState(message = 'Something went wrong.', { retry = true } = {}) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon('wifi-off', 24)}</div>
      <h3>The catalog is out of reach</h3>
      <p>${esc(message)}</p>
      <div class="action-row">
        ${retry ? `<button class="pill-btn" data-act="retry">${icon('refresh', 15)}Try again</button>` : ''}
        <button class="pill-btn secondary" data-act="open-add-music">${icon('upload', 15)}Play local files</button>
      </div>
    </div>`;
}

export function skeletonShelf(count = 6) {
  return `
    <section class="section">
      <div class="section-head"><div class="skeleton sk-line" style="width:150px;height:18px"></div></div>
      <div class="shelf">
        ${Array.from({ length: count }).map(() => `
          <div class="sk-card">
            <div class="skeleton sk-art"></div>
            <div class="skeleton sk-line"></div>
            <div class="skeleton sk-line short"></div>
          </div>`).join('')}
      </div>
    </section>`;
}

export function skeletonHero() {
  return `
    <div class="hero skeleton-hero">
      <div class="hero-content">
        <div class="skeleton sk-line" style="width:110px"></div>
        <div class="skeleton sk-line" style="width:min(420px,70vw);height:38px;margin-top:12px"></div>
        <div class="skeleton sk-line" style="width:min(520px,60vw);margin-top:14px"></div>
        <div class="skeleton sk-line" style="width:190px;height:38px;border-radius:99px;margin-top:20px"></div>
      </div>
    </div>`;
}

export function trackTable(tracks, {
  listKey, context = null, showAlbum = true, showHeader = true, playlistId = null,
  emptyText = 'No tracks yet.',
} = {}) {
  const list = (tracks || []).filter((track) => track?.id);
  if (listKey) registerTrackList(listKey, list, context);
  if (!list.length) return `<p class="muted small table-empty">${esc(emptyText)}</p>`;
  const currentId = player.getCurrent()?.id;
  return `
    <div class="table-wrap" data-table-key="${esc(listKey || '')}">
      <table class="track-table ${showAlbum ? '' : 'no-album'}">
        ${showHeader ? `<thead><tr>
          <th class="num">#</th>
          <th>Title</th>
          ${showAlbum ? '<th class="album-head">Album</th>' : ''}
          <th class="dur">Time</th>
          <th class="dl"></th>
          <th class="like"></th>
          <th class="more"></th>
        </tr></thead>` : ''}
        <tbody>
          ${list.map((track, index) => {
            const playing = track.id === currentId;
            return `
              <tr class="track-row ${playing ? 'playing' : ''}" data-act="play-row" data-list="${esc(listKey || '')}" data-index="${index}" data-track-id="${esc(track.id)}" data-search="${esc(`${track.title} ${track.artist} ${track.album}`.toLowerCase())}">
                <td class="num">${playing ? icon('wave', 15) : index + 1}</td>
                <td>
                  <div class="track-cell">
                    <span class="mini-art" style="${fallbackStyle(track)}">
                      ${artMedia(track, { alt: track.title })}
                    </span>
                    <span class="titles">
                      <span class="t-title">${esc(track.title)}${track.explicit ? '<span class="explicit">E</span>' : ''}</span>
                      <span class="t-sub">${esc(track.artist)}${track.source === 'local' ? ' · Local' : track.source === 'audius' ? ' · Audius' : ''}</span>
                    </span>
                  </div>
                </td>
                ${showAlbum ? `<td class="album-col"><button class="text-link" data-act="open-album-link" data-id="${esc(track.albumId || '')}" data-name="${esc(track.album || '')}" ${!track.albumId ? 'disabled' : ''}>${esc(track.album || '—')}</button></td>` : ''}
                <td class="dur">${track.duration ? formatTime(track.duration) : '—'}</td>
                <td class="dl">${downloadButton(track)}</td>
                <td class="like">${likeButton(track)}</td>
                <td class="more">${moreButton(track, listKey, index)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

export function groupLibraryAlbums() {
  const tracks = store.allLibraryTracks();
  const map = new Map();
  tracks.forEach((track) => {
    if (!track.album) return;
    const id = track.albumId || `local-album-${hashString(`${track.artist}|${track.album}`)}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        title: track.album,
        artist: track.artist,
        artistId: track.artistId || null,
        artwork: artworkOf(track),
        year: track.year,
        releaseDate: track.releaseDate,
        source: track.source,
        trackCount: 0,
        tracks: [],
      });
    }
    const group = map.get(id);
    if (!group.artwork) group.artwork = artworkOf(track);
    group.tracks.push(track);
    group.trackCount += 1;
  });
  Object.values(store.getState().savedAlbums).forEach((album) => {
    if (!map.has(album.id)) {
      map.set(album.id, {
        ...album,
        tracks: (album.trackIds || []).map((id) => store.trackById(id)).filter(Boolean),
        trackCount: album.trackCount || album.trackIds?.length || 0,
        source: 'catalog',
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => {
    const aDate = a.tracks[0]?.addedAt || a.addedAt || 0;
    const bDate = b.tracks[0]?.addedAt || b.addedAt || 0;
    return bDate - aDate;
  });
}

export function groupLibraryArtists() {
  const tracks = store.allLibraryTracks();
  const map = new Map();
  tracks.forEach((track) => {
    if (!track.artist) return;
    const id = track.artistId || `local-artist-${hashString(track.artist)}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: track.artist,
        artist: track.artist,
        genre: track.genre || 'Artist',
        artwork: artworkOf(track),
        tracks: [],
        albums: new Set(),
        source: track.source,
      });
    }
    const group = map.get(id);
    if (!group.artwork) group.artwork = artworkOf(track);
    group.tracks.push(track);
    if (track.album) group.albums.add(track.album);
  });
  Object.values(store.getState().savedArtists).forEach((artist) => {
    if (!map.has(artist.id)) {
      map.set(artist.id, { ...artist, tracks: [], albums: new Set(), source: 'catalog' });
    }
  });
  return Array.from(map.values()).map((group) => ({ ...group, albumCount: group.albums.size }))
    .sort((a, b) => b.tracks.length - a.tracks.length);
}

export function totalDuration(tracks) {
  const seconds = tracks.reduce((sum, track) => sum + (Number(track.duration) || 0), 0);
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
}

export async function downloadPreview(track, onProgress = null) {
  if (!track?.preview) throw new Error('This track has no preview to save.');
  const response = await fetch(track.preview, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  const type = response.headers.get('content-type') || 'audio/mpeg';
  let blob;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        if (typeof onProgress === 'function') onProgress(total ? Math.min(99, Math.round((loaded / total) * 100)) : null);
      }
    }
    blob = new Blob(chunks, { type });
  } else {
    blob = await response.blob();
  }
  if (typeof onProgress === 'function') onProgress(100);
  await store.saveOfflineTrack(track, blob);
  return true;
}

export function routeLink(path, label, iconName = '') {
  return `<button class="pill-btn ghost" data-nav="${esc(path)}">${iconName ? icon(iconName, 15) : ''}${esc(label)}</button>`;
}

export function pill(label, { act = '', iconName = '', className = '', data = '' } = {}) {
  return `<button class="pill-btn ${className}" ${act ? `data-act="${esc(act)}"` : ''} ${data}>${iconName ? icon(iconName, 15) : ''}${esc(label)}</button>`;
}
