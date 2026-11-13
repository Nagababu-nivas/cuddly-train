/*
 * Orange state: settings, library, playlists, likes, history and caches.
 * Binary audio/artwork lives in IndexedDB; this module only stores metadata.
 */

import { bus, storage, uid, uniqueBy, shuffleArray } from './util.js?v=orange3';
import { db } from './db.js?v=orange3';

const KEY = 'orange.state.v1';
const LEGACY_KEY = 'cadence.state.v1';

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: '#fa2d48',
  country: 'us',
  explicit: true,
  animatedArt: true,
  autoplay: true,
  crossfadeOn: false,
  crossfade: 3,
  eqEnabled: false,
  eqPreset: 'Flat',
  eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  volume: 0.8,
  muted: false,
  showLyrics: true,
  compactRows: false,
  reduceMotion: false,
  quality: 'preview',
  showVisualizer: true,
  radioFade: true,
  preferLocal: true,
};

function makeDefaultState() {
  return {
    version: 2,
    settings: { ...DEFAULT_SETTINGS },
    likes: [],
    playlists: [],
    recent: [],
    savedTracks: {},
    savedAlbums: {},
    savedArtists: {},
    trackCache: {},
    albumCache: {},
    artistCache: {},
    playCounts: {},
    localTracks: [],
    queue: { ids: [], index: 0, shuffle: false, repeat: 'off', context: null },
    searchHistory: [],
  };
}

function mergeState(raw) {
  const base = makeDefaultState();
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  merged.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  merged.settings.eq = Array.isArray(raw.settings?.eq) && raw.settings.eq.length === 10
    ? raw.settings.eq.map((n) => Number(n) || 0)
    : [...DEFAULT_SETTINGS.eq];
  merged.likes = Array.isArray(raw.likes) ? [...new Set(raw.likes.filter(Boolean))] : [];
  merged.playlists = Array.isArray(raw.playlists)
    ? raw.playlists.filter((p) => p && p.id).map((p) => ({
      id: p.id,
      name: String(p.name || 'Untitled Playlist'),
      description: String(p.description || ''),
      trackIds: Array.isArray(p.trackIds) ? [...new Set(p.trackIds.filter(Boolean))] : [],
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || p.createdAt || Date.now(),
      accent: p.accent || null,
    }))
    : [];
  merged.recent = Array.isArray(raw.recent)
    ? raw.recent.filter((r) => r && r.id).slice(0, 100)
    : [];
  ['savedTracks', 'savedAlbums', 'savedArtists', 'trackCache', 'albumCache', 'artistCache', 'playCounts'].forEach((field) => {
    if (!raw[field] || typeof raw[field] !== 'object' || Array.isArray(raw[field])) merged[field] = {};
  });
  merged.localTracks = Array.isArray(raw.localTracks)
    ? raw.localTracks.filter((t) => t && t.id && t.audioKey).map((t) => ({ ...t, source: 'local', downloaded: true }))
    : [];
  merged.searchHistory = Array.isArray(raw.searchHistory) ? raw.searchHistory.slice(0, 15) : [];
  if (!merged.queue || typeof merged.queue !== 'object') merged.queue = base.queue;
  merged.queue.ids = Array.isArray(merged.queue.ids) ? merged.queue.ids.filter(Boolean) : [];
  merged.queue.index = Number.isFinite(merged.queue.index) ? merged.queue.index : 0;
  merged.queue.repeat = ['off', 'all', 'one'].includes(merged.queue.repeat) ? merged.queue.repeat : 'off';
  merged.queue.shuffle = Boolean(merged.queue.shuffle);
  return merged;
}

let state = mergeState(storage.get(KEY, null) || storage.get(LEGACY_KEY, null));
if (!storage.get(KEY, null) && storage.get(LEGACY_KEY, null)) storage.set(KEY, state);

function persist() {
  const ok = storage.set(KEY, state);
  if (!ok) {
    bus.emit('store:error', { message: 'The library could not be saved. Local storage may be full.' });
  }
}

function changed(kind = 'state', detail = {}) {
  persist();
  bus.emit('store:change', { kind, ...detail });
}

function prune() {
  const cacheIds = Object.keys(state.trackCache);
  if (cacheIds.length > 1800) {
    cacheIds.slice(0, cacheIds.length - 1800).forEach((id) => {
      if (!state.savedTracks[id] && !state.likes.includes(id)) delete state.trackCache[id];
    });
  }
  if (state.recent.length > 100) state.recent = state.recent.slice(0, 100);
  if (state.searchHistory.length > 15) state.searchHistory = state.searchHistory.slice(0, 15);
  const albumIds = Object.keys(state.albumCache);
  if (albumIds.length > 500) albumIds.slice(0, albumIds.length - 500).forEach((id) => delete state.albumCache[id]);
  const artistIds = Object.keys(state.artistCache);
  if (artistIds.length > 300) artistIds.slice(0, artistIds.length - 300).forEach((id) => delete state.artistCache[id]);
}

function defineRuntime(object, key, value) {
  if (!object) return;
  try {
    Object.defineProperty(object, key, { value, writable: true, configurable: true, enumerable: false });
  } catch {
    object[key] = value;
  }
}

function normalizeTrack(track) {
  if (!track || !track.id) return null;
  const normalized = { ...track };
  delete normalized._audioUrl;
  delete normalized._artworkUrl;
  delete normalized._offlineUrl;
  normalized.title = normalized.title || 'Unknown Title';
  normalized.artist = normalized.artist || 'Unknown Artist';
  normalized.album = normalized.album || '';
  normalized.source = normalized.source || 'catalog';
  return normalized;
}

function rememberTrack(track, silent = true) {
  const normalized = normalizeTrack(track);
  if (!normalized) return null;
  if (normalized.source === 'local') {
    const existing = state.localTracks.find((t) => t.id === normalized.id);
    if (existing) return existing;
  }
  state.trackCache[normalized.id] = normalized;
  if (!silent) changed('track-cache');
  return normalized;
}

function rememberTracks(tracks, silent = true) {
  tracks.forEach((track) => rememberTrack(track, true));
  if (!silent) changed('track-cache');
}

function trackById(id) {
  if (!id) return null;
  const local = state.localTracks.find((track) => track.id === id);
  if (local) return hydrateLocalTrack(local);
  if (state.savedTracks[id]) return state.savedTracks[id];
  if (state.trackCache[id]) return state.trackCache[id];
  return null;
}

function localTrackById(id) {
  return state.localTracks.find((track) => track.id === id) || null;
}

function matchKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:feat|ft|with)[^)]*\)/g, ' ')
    .replace(/\[(?:feat|ft|with)[^\]]*\]/g, ' ')
    .replace(/\b(feat|ft|featuring|remaster(?:ed)?|deluxe|version|edit|live|radio edit)\b.*$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function localMatch(track) {
  if (!track || track.source === 'local' || track.offline || !state.localTracks.length) return null;
  const title = matchKey(track.title);
  if (!title) return null;
  const artist = matchKey(track.artist);
  const candidates = state.localTracks.filter((item) => matchKey(item.title) === title);
  if (!candidates.length) return null;
  if (artist) {
    const artistMatch = candidates.find((item) => {
      const candidate = matchKey(item.artist);
      return candidate === artist || candidate.includes(artist) || artist.includes(candidate);
    });
    if (artistMatch) return hydrateLocalTrack(artistMatch);
  }
  return candidates.length === 1 ? hydrateLocalTrack(candidates[0]) : null;
}

function hydrateLocalTrack(meta) {
  if (!meta) return null;
  const hydrated = { ...meta, source: 'local', downloaded: true };
  Object.defineProperty(hydrated, 'src', {
    get: () => meta._audioUrl || '',
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(hydrated, 'artworkUrl', {
    get: () => meta._artworkUrl || meta.artworkUrl || '',
    enumerable: false,
    configurable: true,
  });
  return hydrated;
}

async function loadLocalMedia() {
  for (const meta of state.localTracks) {
    if (!meta._audioUrl && meta.audioKey) {
      const blob = await db.getAudio(meta.audioKey);
      if (blob) defineRuntime(meta, '_audioUrl', URL.createObjectURL(blob));
    }
    if (!meta._artworkUrl && meta.artworkKey) {
      const blob = await db.getArtwork(meta.artworkKey);
      if (blob) defineRuntime(meta, '_artworkUrl', URL.createObjectURL(blob));
    }
  }
  bus.emit('store:local-media');
}

function addLocalTrack(meta) {
  const normalized = normalizeTrack({ ...meta, source: 'local', downloaded: true, addedAt: meta.addedAt || Date.now() });
  const existingIndex = state.localTracks.findIndex((t) => t.id === normalized.id);
  if (existingIndex >= 0) {
    const current = state.localTracks[existingIndex];
    state.localTracks[existingIndex] = { ...current, ...normalized };
    rememberTrack(state.localTracks[existingIndex]);
    changed('local-add', { track: state.localTracks[existingIndex] });
    return state.localTracks[existingIndex];
  }
  state.localTracks.unshift(normalized);
  rememberTrack(normalized);
  changed('local-add', { track: normalized });
  return normalized;
}

function updateLocalTrack(id, patch) {
  const index = state.localTracks.findIndex((track) => track.id === id);
  if (index < 0) return null;
  state.localTracks[index] = { ...state.localTracks[index], ...patch };
  rememberTrack(state.localTracks[index]);
  changed('local-update', { track: state.localTracks[index] });
  return state.localTracks[index];
}

async function removeLocalTrack(id) {
  const index = state.localTracks.findIndex((track) => track.id === id);
  if (index < 0) return false;
  const [track] = state.localTracks.splice(index, 1);
  if (track._audioUrl) URL.revokeObjectURL(track._audioUrl);
  if (track._artworkUrl) URL.revokeObjectURL(track._artworkUrl);
  if (track.audioKey) await db.deleteAudio(track.audioKey);
  if (track.artworkKey) await db.deleteArtwork(track.artworkKey);
  state.likes = state.likes.filter((likeId) => likeId !== id);
  state.playlists.forEach((playlist) => {
    playlist.trackIds = playlist.trackIds.filter((trackId) => trackId !== id);
  });
  state.recent = state.recent.filter((entry) => entry.id !== id);
  delete state.trackCache[id];
  changed('local-remove', { id });
  return true;
}

function allLibraryTracks() {
  const local = state.localTracks.map(hydrateLocalTrack);
  const saved = Object.values(state.savedTracks);
  return uniqueBy([...local, ...saved], (track) => track.id)
    .filter((track) => track && track.id)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function downloadedTracks() {
  return state.localTracks.map(hydrateLocalTrack);
}

function likesTracks() {
  return state.likes
    .map((id) => trackById(id))
    .filter(Boolean)
    .map((track) => (track.source === 'local' ? hydrateLocalTrack(track) : track));
}

function isLiked(id) {
  return state.likes.includes(id);
}

function toggleLike(trackOrId) {
  const track = typeof trackOrId === 'string' ? trackById(trackOrId) : trackOrId;
  if (!track?.id) return false;
  rememberTrack(track);
  const liked = state.likes.includes(track.id);
  if (liked) state.likes = state.likes.filter((id) => id !== track.id);
  else state.likes = [track.id, ...state.likes];
  changed('likes', { id: track.id, liked: !liked });
  return !liked;
}

function recordPlay(track) {
  if (!track?.id || track.source === 'radio') return;
  rememberTrack(track);
  state.playCounts[track.id] = (state.playCounts[track.id] || 0) + 1;
  state.recent = [{ id: track.id, at: Date.now() }, ...state.recent.filter((entry) => entry.id !== track.id)].slice(0, 100);
  changed('recent', { id: track.id });
}

function recentTracks(limit = 12) {
  return state.recent
    .map((entry) => {
      const track = trackById(entry.id);
      return track ? { ...track, _recentAt: entry.at } : null;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function isSaved(id) {
  return Boolean(state.savedTracks[id]) || Boolean(localTrackById(id));
}

function saveTrack(track) {
  if (!track?.id) return;
  if (localTrackById(track.id)) return;
  rememberTrack(track);
  state.savedTracks[track.id] = { ...normalizeTrack(track), addedAt: track.addedAt || Date.now() };
  changed('saved-track', { id: track.id });
}

function removeSavedTrack(id) {
  if (!state.savedTracks[id]) return;
  delete state.savedTracks[id];
  changed('saved-track', { id });
}

function toggleSaved(track) {
  if (isSaved(track.id)) {
    if (localTrackById(track.id)) return true;
    removeSavedTrack(track.id);
    return false;
  }
  saveTrack(track);
  return true;
}

function isAlbumSaved(id) {
  return Boolean(state.savedAlbums[id]);
}

function saveAlbum(album, tracks = []) {
  if (!album?.id) return;
  state.albumCache[album.id] = { ...album };
  state.savedAlbums[album.id] = {
    ...album,
    addedAt: album.addedAt || Date.now(),
    trackIds: tracks.map((track) => track.id),
  };
  rememberTracks(tracks);
  tracks.forEach((track) => {
    if (!localTrackById(track.id) && !state.savedTracks[track.id]) {
      state.savedTracks[track.id] = {
        ...normalizeTrack({ ...track, albumId: album.id, album: track.album || album.title }),
        addedAt: Date.now(),
      };
    }
  });
  changed('saved-album', { id: album.id });
}

function removeSavedAlbum(id) {
  const album = state.savedAlbums[id];
  if (!album) return;
  delete state.savedAlbums[id];
  const idsToRemove = (album.trackIds || []).filter((trackId) => !state.localTracks.some((t) => t.id === trackId));
  idsToRemove.forEach((trackId) => {
    if (state.savedTracks[trackId]) delete state.savedTracks[trackId];
  });
  changed('saved-album', { id });
}

function toggleSavedAlbum(album, tracks = []) {
  if (isAlbumSaved(album.id)) {
    removeSavedAlbum(album.id);
    return false;
  }
  saveAlbum(album, tracks);
  return true;
}

function isArtistSaved(id) {
  return Boolean(state.savedArtists[id]);
}

function saveArtist(artist) {
  if (!artist?.id) return;
  state.artistCache[artist.id] = { ...artist };
  state.savedArtists[artist.id] = { ...artist, addedAt: artist.addedAt || Date.now() };
  changed('saved-artist', { id: artist.id });
}

function removeSavedArtist(id) {
  if (!state.savedArtists[id]) return;
  delete state.savedArtists[id];
  changed('saved-artist', { id });
}

function toggleSavedArtist(artist) {
  if (isArtistSaved(artist.id)) {
    removeSavedArtist(artist.id);
    return false;
  }
  saveArtist(artist);
  return true;
}

function playlists() {
  return state.playlists;
}

function playlistById(id) {
  return state.playlists.find((playlist) => playlist.id === id) || null;
}

function createPlaylist(name = 'New Playlist', description = '') {
  const playlist = {
    id: uid('pl'),
    name: name.trim() || 'New Playlist',
    description: description.trim(),
    trackIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.playlists.unshift(playlist);
  changed('playlists', { id: playlist.id });
  return playlist;
}

function updatePlaylist(id, patch) {
  const playlist = playlistById(id);
  if (!playlist) return null;
  if (patch.name !== undefined) playlist.name = String(patch.name).trim() || playlist.name;
  if (patch.description !== undefined) playlist.description = String(patch.description);
  if (Array.isArray(patch.trackIds)) playlist.trackIds = [...new Set(patch.trackIds.filter(Boolean))];
  playlist.updatedAt = Date.now();
  changed('playlists', { id });
  return playlist;
}

function deletePlaylist(id) {
  const before = state.playlists.length;
  state.playlists = state.playlists.filter((playlist) => playlist.id !== id);
  if (state.playlists.length !== before) changed('playlists', { id, deleted: true });
}

function addToPlaylist(id, tracks) {
  const playlist = playlistById(id);
  if (!playlist) return null;
  const list = Array.isArray(tracks) ? tracks : [tracks];
  const valid = list.filter((track) => track?.id);
  valid.forEach((track) => rememberTrack(track));
  playlist.trackIds = [...new Set([...playlist.trackIds, ...valid.map((track) => track.id)])];
  playlist.updatedAt = Date.now();
  changed('playlists', { id, added: valid.length });
  return playlist;
}

function removeFromPlaylist(playlistId, trackId) {
  const playlist = playlistById(playlistId);
  if (!playlist) return;
  playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
  playlist.updatedAt = Date.now();
  changed('playlists', { id: playlistId });
}

function movePlaylistTrack(playlistId, from, to) {
  const playlist = playlistById(playlistId);
  if (!playlist) return;
  const ids = playlist.trackIds;
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return;
  const [item] = ids.splice(from, 1);
  ids.splice(to, 0, item);
  playlist.updatedAt = Date.now();
  changed('playlists', { id: playlistId });
}

function playlistTracks(id) {
  const playlist = playlistById(id);
  if (!playlist) return [];
  return playlist.trackIds
    .map((trackId) => trackById(trackId))
    .filter(Boolean)
    .map((track) => (track.source === 'local' ? hydrateLocalTrack(track) : track));
}

function rememberAlbum(album) {
  if (!album?.id) return null;
  state.albumCache[album.id] = { ...album };
  return album;
}

function albumById(id) {
  return state.albumCache[id] || state.savedAlbums[id] || null;
}

function rememberArtist(artist) {
  if (!artist?.id) return null;
  state.artistCache[artist.id] = { ...artist };
  return artist;
}

function artistById(id) {
  return state.artistCache[id] || state.savedArtists[id] || null;
}

function getSettings() {
  return state.settings;
}

function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if (Array.isArray(patch.eq)) state.settings.eq = patch.eq.map((n) => Number(n) || 0).slice(0, 10);
  changed('settings', { settings: state.settings });
  return state.settings;
}

function saveQueue(queue) {
  state.queue = {
    ids: Array.isArray(queue?.ids) ? queue.ids.filter(Boolean) : [],
    index: Number.isFinite(queue?.index) ? queue.index : 0,
    shuffle: Boolean(queue?.shuffle),
    repeat: ['off', 'all', 'one'].includes(queue?.repeat) ? queue.repeat : 'off',
    context: queue?.context || null,
  };
  changed('queue', { queue: state.queue });
}

function getQueueState() {
  return state.queue;
}

function addSearchHistory(term) {
  const value = String(term || '').trim();
  if (!value) return;
  state.searchHistory = [value, ...state.searchHistory.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 15);
  changed('search-history');
}

function clearSearchHistory() {
  state.searchHistory = [];
  changed('search-history');
}

function saveOfflineTrack(track, blob) {
  if (!track?.id) return;
  const audioKey = `offline-${track.id}`;
  defineRuntime(track, '_offlineKey', audioKey);
  const snapshot = {
    ...normalizeTrack(track),
    offline: true,
    downloaded: true,
    audioKey,
    addedAt: track.addedAt || Date.now(),
  };
  state.savedTracks[track.id] = snapshot;
  rememberTrack(snapshot);
  return blob ? db.putAudio(audioKey, blob).then(() => {
    defineRuntime(snapshot, '_offlineUrl', URL.createObjectURL(blob));
    changed('offline', { id: track.id });
    return snapshot;
  }) : snapshot;
}

async function removeOfflineTrack(id) {
  const track = state.savedTracks[id];
  if (!track?.offline) return;
  if (track.audioKey) await db.deleteAudio(track.audioKey);
  if (track._offlineUrl) URL.revokeObjectURL(track._offlineUrl);
  delete state.savedTracks[id];
  const cached = state.trackCache[id];
  if (cached) {
    delete cached.offline;
    delete cached.downloaded;
    delete cached.audioKey;
  }
  changed('offline', { id, removed: true });
}

function localCount() {
  return state.localTracks.length;
}

function libraryStats() {
  const tracks = allLibraryTracks();
  const albums = new Set();
  const artists = new Set();
  tracks.forEach((track) => {
    if (track.album) albums.add(track.albumId || `${track.artist}::${track.album}`);
    if (track.artist) artists.add(track.artistId || track.artist);
  });
  return {
    tracks: tracks.length,
    albums: albums.size,
    artists: artists.size,
    playlists: state.playlists.length,
    local: state.localTracks.length,
    liked: state.likes.length,
  };
}

function getState() {
  return state;
}

function exportLibrary() {
  return {
    app: 'Orange',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    likes: state.likes,
    playlists: state.playlists,
    savedTracks: state.savedTracks,
    savedAlbums: state.savedAlbums,
    savedArtists: state.savedArtists,
    localTracks: state.localTracks.map((track) => {
      const clean = { ...track };
      delete clean._audioUrl;
      delete clean._artworkUrl;
      return clean;
    }),
    playCounts: state.playCounts,
    searchHistory: state.searchHistory,
  };
}

function importLibrary(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('This is not an Orange library file.');
  if (payload.app && !['Orange', 'Cadence'].includes(payload.app)) throw new Error('Unsupported library file.');
  const incoming = mergeState(payload);
  if (payload.settings) state.settings = { ...state.settings, ...payload.settings };
  state.likes = [...new Set([...payload.likes || [], ...state.likes])];
  state.searchHistory = [...new Set([...(payload.searchHistory || []), ...state.searchHistory])].slice(0, 15);
  Object.entries(payload.savedTracks || {}).forEach(([id, track]) => {
    if (track?.id) state.savedTracks[id] = { ...track };
  });
  Object.entries(payload.savedAlbums || {}).forEach(([id, album]) => {
    if (album?.id) state.savedAlbums[id] = { ...album };
  });
  Object.entries(payload.savedArtists || {}).forEach(([id, artist]) => {
    if (artist?.id) state.savedArtists[id] = { ...artist };
  });
  Object.entries(payload.trackCache || {}).forEach(([id, track]) => {
    if (track?.id) state.trackCache[id] = { ...track };
  });
  Object.entries(payload.playCounts || {}).forEach(([id, count]) => {
    state.playCounts[id] = Math.max(state.playCounts[id] || 0, Number(count) || 0);
  });
  const existingPlaylistIds = new Set(state.playlists.map((playlist) => playlist.id));
  (payload.playlists || []).forEach((playlist) => {
    if (!playlist?.id) return;
    if (existingPlaylistIds.has(playlist.id)) {
      const current = playlistById(playlist.id);
      current.trackIds = [...new Set([...current.trackIds, ...(playlist.trackIds || [])])];
    } else {
      state.playlists.push({ ...incoming.playlists.find((item) => item.id === playlist.id) || playlist });
    }
  });
  // Local tracks are merged as metadata only; their blobs are device-specific.
  (payload.localTracks || []).forEach((track) => {
    if (track?.id && !state.localTracks.some((item) => item.id === track.id)) {
      state.localTracks.push({ ...track, source: 'local', downloaded: true });
    }
  });
  prune();
  changed('import');
}

function reset({ keepSettings = false } = {}) {
  const settings = keepSettings ? state.settings : { ...DEFAULT_SETTINGS };
  state.localTracks.forEach((track) => {
    if (track._audioUrl) URL.revokeObjectURL(track._audioUrl);
    if (track._artworkUrl) URL.revokeObjectURL(track._artworkUrl);
  });
  state = makeDefaultState();
  state.settings = settings;
  persist();
  bus.emit('store:change', { kind: 'reset' });
}

function randomQueueFrom(tracks, count = 40) {
  return shuffleArray(tracks).slice(0, count);
}

export const store = {
  init() {
    // Guarantee at least one starter playlist is never required; an empty library is valid.
    prune();
    persist();
    return state;
  },
  getState,
  getSettings,
  updateSettings,
  save: persist,
  changed,
  subscribe(handler) {
    return bus.on('store:change', handler);
  },
  trackById,
  localTrackById,
  localMatch,
  hydrateLocalTrack,
  loadLocalMedia,
  rememberTrack,
  rememberTracks,
  addLocalTrack,
  updateLocalTrack,
  removeLocalTrack,
  allLibraryTracks,
  downloadedTracks,
  likesTracks,
  isLiked,
  toggleLike,
  recordPlay,
  recentTracks,
  isSaved,
  saveTrack,
  removeSavedTrack,
  toggleSaved,
  isAlbumSaved,
  saveAlbum,
  removeSavedAlbum,
  toggleSavedAlbum,
  isArtistSaved,
  saveArtist,
  removeSavedArtist,
  toggleSavedArtist,
  playlists,
  playlistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addToPlaylist,
  removeFromPlaylist,
  movePlaylistTrack,
  playlistTracks,
  rememberAlbum,
  albumById,
  rememberArtist,
  artistById,
  saveQueue,
  getQueueState,
  addSearchHistory,
  clearSearchHistory,
  saveOfflineTrack,
  removeOfflineTrack,
  localCount,
  libraryStats,
  exportLibrary,
  importLibrary,
  reset,
  randomQueueFrom,
  DEFAULT_SETTINGS,
};
