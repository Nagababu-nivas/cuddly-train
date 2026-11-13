/*
 * Free catalog access.
 * - iTunes Search / Lookup API: metadata, artwork and 30-second previews.
 * - iTunes RSS: public charts.
 * - LRCLIB: openly available lyrics.
 *
 * No Apple account, subscription, token or DRM is involved.
 */

import { art, uniqueBy, yearOf, storage } from './util.js?v=orange3';
import { searchTracks as searchAudiusTracks, clearAudiusCache } from './providers/audius.js?v=orange3';

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const RSS_BASE = 'https://itunes.apple.com/us/rss';
const LYRICS_URL = 'https://lrclib.net/api';

let country = 'us';
const cache = new Map();
const MAX_CACHE = 220;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function setCatalogCountry(value) {
  country = String(value || 'us').toLowerCase();
}

export function getCatalogCountry() {
  return country;
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(key, value);
}

/* v1 could contain plain-only lyrics that were cached before the /search
   fallback existed. Bump the key so those entries can never hide a synced
   version, and only retain a plain fallback after we actually searched for
   a synced version. */
const LYRICS_CACHE_KEY = 'orange.lyrics.v2';
const LEGACY_LYRICS_CACHE_KEY = 'orange.lyrics.v1';
const LYRICS_CACHE_VERSION = 2;
const LYRICS_CACHE_LIMIT = 180;
const LYRICS_NEGATIVE_TTL = 24 * 60 * 60 * 1000;

let legacyLyricsCacheCleared = false;

function clearLegacyLyricsCache() {
  if (legacyLyricsCacheCleared) return;
  legacyLyricsCacheCleared = true;
  storage.remove(LEGACY_LYRICS_CACHE_KEY);
}

function lyricsCacheId(track) {
  return [
    String(track.artist || '').toLowerCase().trim(),
    String(track.title || '').toLowerCase().trim(),
    String(track.album || '').toLowerCase().trim(),
  ].join('|');
}

function readLyricsCache() {
  clearLegacyLyricsCache();
  const value = storage.get(LYRICS_CACHE_KEY, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rememberLyrics(track, data) {
  try {
    const map = readLyricsCache();
    map[lyricsCacheId(track)] = { v: LYRICS_CACHE_VERSION, at: Date.now(), data };
    const entries = Object.entries(map).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
    storage.set(LYRICS_CACHE_KEY, Object.fromEntries(entries.slice(0, LYRICS_CACHE_LIMIT)));
  } catch {
    /* lyrics caching is best effort */
  }
}

function recallLyrics(track) {
  const entry = readLyricsCache()[lyricsCacheId(track)];
  if (!entry || entry.v !== LYRICS_CACHE_VERSION || !entry.data) return null;
  const data = entry.data;
  if (data.synced || data.instrumental) return data;
  // A plain fallback is only valid if the synced search was already tried,
  // and it expires so a later LRCLIB contribution can be picked up.
  if (!data.syncedUnavailable) return null;
  if (Date.now() - (Number(entry.at) || 0) > LYRICS_NEGATIVE_TTL) return null;
  return data;
}

/* LRCLIB occasionally answers 429/5xx or drops the connection. Retry those
   responses with a short backoff instead of failing the lyrics panel. */
async function fetchLyricsJson(url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status) || 0;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchJson(url, { timeout = 15_000, signal } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
    });
    if (!response.ok) throw new ApiError(`Catalog request failed (${response.status})`, response.status);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new ApiError('The catalog request timed out.', 408);
    if (error instanceof ApiError) throw error;
    throw new ApiError(error?.message || 'The catalog is unreachable.', 0);
  } finally {
    window.clearTimeout(timer);
  }
}

async function cached(key, loader) {
  if (cache.has(key)) return cache.get(key);
  const promise = loader().then((value) => {
    cacheSet(key, Promise.resolve(value));
    return value;
  }).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cacheSet(key, promise);
  return promise;
}

export function clearCatalogCache() {
  cache.clear();
  clearAudiusCache();
}

export function normalizeTrack(item) {
  if (!item || !item.trackId) return null;
  const artwork = art(item.artworkUrl100 || item.artworkUrl60 || item.artworkUrl30, 600);
  return {
    id: `it-${item.trackId}`,
    trackId: item.trackId,
    title: item.trackName || item.collectionName || 'Unknown Title',
    artist: item.artistName || 'Unknown Artist',
    artistId: item.artistId ? `it-artist-${item.artistId}` : null,
    album: item.collectionName || '',
    albumId: item.collectionId ? `it-album-${item.collectionId}` : null,
    collectionId: item.collectionId || null,
    artwork,
    artworkSmall: art(item.artworkUrl100 || item.artworkUrl60, 100),
    preview: item.previewUrl || null,
    duration: item.trackTimeMillis ? item.trackTimeMillis / 1000 : Number(item.trackTime) || 0,
    genre: item.primaryGenreName || '',
    releaseDate: item.releaseDate || '',
    year: yearOf(item.releaseDate),
    trackNumber: item.trackNumber || 1,
    discNumber: item.discNumber || 1,
    trackCount: item.trackCount || 0,
    explicit: item.trackExplicitness === 'explicit' || item.collectionExplicitness === 'explicit',
    isStream: Boolean(item.isStream),
    source: 'catalog',
    preview: item.previewUrl || null,
  };
}

export function normalizeAlbum(item) {
  if (!item || !item.collectionId) return null;
  return {
    id: `it-album-${item.collectionId}`,
    collectionId: item.collectionId,
    title: item.collectionName || 'Unknown Album',
    artist: item.artistName || 'Unknown Artist',
    artistId: item.artistId ? `it-artist-${item.artistId}` : null,
    artwork: art(item.artworkUrl100 || item.artworkUrl60, 600),
    artworkSmall: art(item.artworkUrl100 || item.artworkUrl60, 100),
    genre: item.primaryGenreName || '',
    releaseDate: item.releaseDate || '',
    year: yearOf(item.releaseDate),
    trackCount: item.trackCount || 0,
    copyright: item.copyright || '',
    url: item.collectionViewUrl || '',
    explicit: item.collectionExplicitness === 'explicit',
    source: 'catalog',
  };
}

export function normalizeArtist(item) {
  if (!item || !item.artistId) return null;
  return {
    id: `it-artist-${item.artistId}`,
    artistId: item.artistId,
    name: item.artistName || 'Unknown Artist',
    genre: item.primaryGenreName || '',
    url: item.artistLinkUrl || '',
    artwork: item.artworkUrl100 ? art(item.artworkUrl100, 600) : '',
    source: 'catalog',
  };
}

function buildUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return url.toString();
}

export async function search(term, { entity = 'song', limit = 50, attribute = '', country: overrideCountry } = {}) {
  const query = String(term || '').trim();
  if (!query) return [];
  const cc = overrideCountry || country;
  const key = `search:${cc}:${entity}:${attribute}:${limit}:${query.toLowerCase()}`;
  return cached(key, async () => {
    const url = buildUrl(SEARCH_URL, {
      term: query,
      media: 'music',
      entity,
      attribute,
      limit,
      country: cc,
      explicit: 'Yes',
    });
    const json = await fetchJson(url);
    return (json.results || []).map((item) => {
      if (entity === 'album') return normalizeAlbum(item);
      if (entity === 'musicArtist') return normalizeArtist(item);
      return normalizeTrack(item);
    }).filter(Boolean);
  });
}

export function searchSongs(term, options = {}) {
  return search(term, { ...options, entity: 'song' });
}

export function searchAlbums(term, options = {}) {
  return search(term, { ...options, entity: 'album' });
}

export function searchArtists(term, options = {}) {
  return search(term, { ...options, entity: 'musicArtist' });
}

export async function searchAll(term, options = {}) {
  const [songs, albums, artists, audius] = await Promise.allSettled([
    searchSongs(term, { limit: 50, ...options }),
    searchAlbums(term, { limit: 30, ...options }),
    searchArtists(term, { limit: 12, ...options }),
    searchAudiusTracks(term, { limit: 50 }),
  ]);
  return {
    songs: songs.status === 'fulfilled' ? songs.value : [],
    albums: albums.status === 'fulfilled' ? albums.value : [],
    artists: artists.status === 'fulfilled' ? artists.value : [],
    audius: audius.status === 'fulfilled' ? audius.value : [],
    errors: [songs, albums, artists, audius]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message),
  };
}

function normalizeLookupResults(json) {
  const tracks = [];
  const albums = [];
  const artists = [];
  (json.results || []).forEach((item) => {
    if (item.wrapperType === 'track' && item.kind === 'song') {
      const track = normalizeTrack(item);
      if (track) tracks.push(track);
    } else if (item.wrapperType === 'collection') {
      const album = normalizeAlbum(item);
      if (album) albums.push(album);
    } else if (item.wrapperType === 'artist') {
      const artist = normalizeArtist(item);
      if (artist) artists.push(artist);
    }
  });
  return { tracks, albums, artists };
}

export async function lookup(ids, { entity = '', limit = 200, country: overrideCountry } = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return { tracks: [], albums: [], artists: [] };
  const cc = overrideCountry || country;
  const chunks = [];
  for (let i = 0; i < list.length; i += 35) chunks.push(list.slice(i, i + 35));
  const results = await Promise.all(chunks.map((chunk) => {
    const key = `lookup:${cc}:${entity}:${limit}:${chunk.join(',')}`;
    return cached(key, () => fetchJson(buildUrl(LOOKUP_URL, {
      id: chunk.join(','),
      entity,
      limit,
      country: cc,
    })));
  }));
  const merged = { tracks: [], albums: [], artists: [] };
  results.forEach((json) => {
    const normalized = normalizeLookupResults(json);
    merged.tracks.push(...normalized.tracks);
    merged.albums.push(...normalized.albums);
    merged.artists.push(...normalized.artists);
  });
  merged.tracks = uniqueBy(merged.tracks, (track) => track.id);
  merged.albums = uniqueBy(merged.albums, (album) => album.id);
  merged.artists = uniqueBy(merged.artists, (artist) => artist.id);
  return merged;
}

function chartEntryArtwork(entry) {
  const images = entry['im:image'] || [];
  const best = images[images.length - 1]?.label || images[0]?.label || '';
  return art(best, 600);
}

function chartEntryTrack(entry, rank) {
  const trackId = Number(entry.id?.attributes?.['im:id']);
  if (!trackId) return null;
  const image = chartEntryArtwork(entry);
  const duration = Number(entry['im:duration']?.label) || 0;
  return {
    id: `it-${trackId}`,
    trackId,
    title: entry['im:name']?.label || 'Unknown Title',
    artist: entry['im:artist']?.label || 'Unknown Artist',
    artistId: null,
    album: entry['im:collection']?.['im:name']?.label || '',
    albumId: null,
    artwork: image,
    artworkSmall: image,
    preview: null,
    duration,
    genre: entry.category?.attributes?.label || '',
    releaseDate: entry['im:releaseDate']?.label || '',
    year: yearOf(entry['im:releaseDate']?.label),
    rank,
    source: 'catalog',
  };
}

function chartEntryAlbum(entry, rank) {
  const collectionId = Number(entry.id?.attributes?.['im:id']);
  if (!collectionId) return null;
  const image = chartEntryArtwork(entry);
  return {
    id: `it-album-${collectionId}`,
    collectionId,
    title: entry['im:name']?.label || 'Unknown Album',
    artist: entry['im:artist']?.label || 'Unknown Artist',
    artistId: null,
    artwork: image,
    artworkSmall: image,
    genre: entry.category?.attributes?.label || '',
    releaseDate: entry['im:releaseDate']?.label || '',
    year: yearOf(entry['im:releaseDate']?.label),
    trackCount: 0,
    rank,
    source: 'catalog',
  };
}

async function rssEntries(path) {
  const json = await fetchJson(`${RSS_BASE}/${path}`, { timeout: 12_000 });
  return json?.feed?.entry || [];
}

export async function chartSongs(limit = 25) {
  const key = `chart:songs:${country}:${limit}`;
  return cached(key, async () => {
    const entries = await rssEntries(`topsongs/limit=${limit}/json`);
    const partial = entries.map((entry, index) => chartEntryTrack(entry, index + 1)).filter(Boolean);
    if (!partial.length) return [];
    try {
      const hydrated = await lookup(partial.map((track) => track.trackId).join(','), { limit: 200 });
      const byId = new Map(hydrated.tracks.map((track) => [track.trackId, track]));
      return partial.map((track) => {
        const full = byId.get(track.trackId);
        return full ? { ...full, rank: track.rank } : track;
      });
    } catch {
      return partial;
    }
  });
}

export async function chartAlbums(limit = 25) {
  const key = `chart:albums:${country}:${limit}`;
  return cached(key, async () => {
    const entries = await rssEntries(`topalbums/limit=${limit}/json`);
    return entries.map((entry, index) => chartEntryAlbum(entry, index + 1)).filter(Boolean);
  });
}

export async function newAlbums(limit = 16) {
  const key = `fresh:albums:${country}:${limit}`;
  return cached(key, async () => {
    const albums = await chartAlbums(50);
    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 460;
    const fresh = albums.filter((album) => {
      const time = new Date(album.releaseDate).getTime();
      return Number.isFinite(time) && time >= cutoff;
    });
    return (fresh.length >= 6 ? fresh : albums).slice(0, limit);
  });
}

export async function albumDetails(id) {
  const collectionId = String(id).replace(/^it-album-/, '').replace(/^it-/, '');
  const key = `album:${country}:${collectionId}`;
  return cached(key, async () => {
    const result = await lookup(collectionId, { entity: 'song', limit: 200 });
    const album = result.albums.find((item) => String(item.collectionId) === collectionId);
    const tracks = result.tracks
      .filter((track) => String(track.collectionId) === collectionId)
      .sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber));
    return { album: album || null, tracks };
  });
}

export async function artistDetails(id) {
  const artistId = String(id).replace(/^it-artist-/, '').replace(/^it-/, '');
  const key = `artist:${country}:${artistId}`;
  return cached(key, async () => {
    const [songResult, albumResult] = await Promise.all([
      lookup(artistId, { entity: 'song', limit: 100 }),
      lookup(artistId, { entity: 'album', limit: 100 }),
    ]);
    const tracks = songResult.tracks.slice().sort((a, b) => {
      const aDate = new Date(a.releaseDate).getTime() || 0;
      const bDate = new Date(b.releaseDate).getTime() || 0;
      return bDate - aDate;
    });
    const albums = albumResult.albums.slice().sort((a, b) => {
      const aDate = new Date(a.releaseDate).getTime() || 0;
      const bDate = new Date(b.releaseDate).getTime() || 0;
      return bDate - aDate;
    });
    const first = albums[0] || tracks[0];
    const artist = {
      id: `it-artist-${artistId}`,
      artistId: Number(artistId),
      name: first?.artist || 'Unknown Artist',
      genre: first?.genre || '',
      artwork: albums[0]?.artwork || tracks[0]?.artwork || '',
      source: 'catalog',
    };
    return { artist, tracks: uniqueBy(tracks, (track) => track.id), albums: uniqueBy(albums, (album) => album.id) };
  });
}

export async function genreCatalog(genre, limit = 40) {
  const key = `genre:${country}:${genre}:${limit}`;
  return cached(key, async () => {
    const [songs, albums] = await Promise.all([
      searchSongs(genre, { limit }),
      searchAlbums(genre, { limit: Math.min(30, limit) }),
    ]);
    return { songs, albums, genre };
  });
}

function parseLrc(text) {
  const lines = [];
  const rawLines = String(text).split(/\r?\n/);
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  // [offset:±ms] may appear anywhere in the file, so read it up front.
  const offsetMatch = String(text).match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  rawLines.forEach((raw) => {
    if (/^\s*\[offset:\s*[+-]?\d+\s*\]\s*$/i.test(raw)) return;
    const stamps = [];
    let match;
    while ((match = timeRegex.exec(raw))) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0')}`) : 0;
      stamps.push(minutes * 60 + seconds + fraction);
    }
    // Enhanced LRC uses <mm:ss.xx> for per-word timing. Keep the line text.
    const content = raw
      .replace(timeRegex, '')
      .replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, '')
      .trim();
    timeRegex.lastIndex = 0;
    // Drop ID tags such as [ar:...], [ti:...], [by:...], [length:...].
    if (!content || /^\[[a-z]+:.*\]$/i.test(content)) return;
    if (stamps.length) {
      stamps.forEach((time) => lines.push({ time: Math.max(0, time + offset), text: content }));
    } else {
      lines.push({ time: null, text: content });
    }
  });
  return lines
    .filter((line, index, list) => line.time === null || index === 0
      || list[index - 1].time !== line.time || list[index - 1].text !== line.text)
    .sort((a, b) => {
      if (a.time === null && b.time === null) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time - b.time;
    });
}

function plainToLines(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => ({ time: null, text: line }));
}

/* LRCLIB can return several recordings for one song: radio edits, live
   versions, remixes and covers. A synchronized result is only useful if it
   belongs to the same performance, so match title and artist first and use
   duration (when known) as the deciding tie-breaker. */
function lyricKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/\((?:feat|ft|with)[^)]*\)/g, ' ')
    .replace(/\[(?:feat|ft|with)[^\]]*\]/g, ' ')
    .replace(/\s+(?:feat|ft|featuring)\.?\s+.+$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function lyricArtistParts(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+(?:feat|ft|featuring)\.?\s+.+$/g, ' ')
    .replace(/\s*,\s*/g, ' & ')
    .replace(/\s+and\s+/g, ' & ')
    .split(/\s*&\s*/)
    .map((part) => part.replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(Boolean);
}

function lyricTitlesMatch(requested, candidate) {
  const title = lyricKey(requested);
  const other = lyricKey(candidate);
  if (!title || !other) return false;
  if (title === other) return true;
  // Accept neutral edition suffixes, but never live/remix/cover versions.
  if (other.startsWith(`${title} `)) {
    const suffix = other.slice(title.length).trim();
    return /^(?:\d{4}\s+)?(?:remaster(?:ed)?|official (?:video|audio|music video)|lyrics?|visualizer|explicit|clean|single|album version)$/.test(suffix);
  }
  return false;
}

function lyricArtistsMatch(requested, candidate) {
  const wanted = new Set(lyricArtistParts(requested));
  const found = new Set(lyricArtistParts(candidate));
  if (!wanted.size || !found.size) return false;
  for (const part of wanted) if (found.has(part)) return true;
  for (const part of found) if (wanted.has(part)) return true;
  return lyricKey(requested) === lyricKey(candidate);
}

function lyricAlbumsMatch(requested, candidate) {
  const album = lyricKey(requested);
  const other = lyricKey(candidate);
  return Boolean(album && other && album === other);
}

function lyricResultScore(item, track, fallbackDuration) {
  if (!item) return null;
  if (!lyricTitlesMatch(track.title, item.trackName)) return null;
  if (!lyricArtistsMatch(track.artist, item.artistName)) return null;
  const wanted = Number(track.duration) || Number(fallbackDuration) || 0;
  const actual = Number(item.duration) || 0;
  const diff = wanted && actual ? Math.abs(actual - wanted) : null;
  // A different duration normally means a different edit (live, extended,
  // remix). Reject it instead of syncing lyrics to the wrong performance.
  if (diff !== null && diff > 10) return null;
  return {
    item,
    diff: diff === null ? Number.POSITIVE_INFINITY : diff,
    album: lyricAlbumsMatch(track.album, item.albumName),
  };
}

function pickLyricsResult(list, track, fallbackDuration, { syncedOnly = false } = {}) {
  const matches = (Array.isArray(list) ? list : [])
    .map((item) => lyricResultScore(item, track, fallbackDuration))
    .filter((match) => match && (!syncedOnly || Boolean(match.item.syncedLyrics)));
  matches.sort((a, b) => {
    if (syncedOnly) {
      const aSynced = a.item.syncedLyrics ? 1 : 0;
      const bSynced = b.item.syncedLyrics ? 1 : 0;
      if (aSynced !== bSynced) return bSynced - aSynced;
    }
    if (a.album !== b.album) return a.album ? -1 : 1;
    if (a.diff !== b.diff) return a.diff - b.diff;
    return (Number(a.item.id) || 0) - (Number(b.item.id) || 0);
  });
  return matches[0]?.item || null;
}

export async function lyricsFor(track) {
  if (!track?.title || !track?.artist) return null;
  const cachedLyrics = recallLyrics(track);
  if (cachedLyrics) return cachedLyrics;
  const key = `lyrics:v2:${track.artist.toLowerCase()}:${track.title.toLowerCase()}`;
  return cached(key, async () => {
    const params = new URLSearchParams({
      artist_name: track.artist,
      track_name: track.title,
    });
    if (track.album) params.set('album_name', track.album);
    if (track.duration && track.duration > 60) params.set('duration', String(Math.round(track.duration)));

    let json = null;
    let getError = null;
    try {
      json = await fetchLyricsJson(`${LYRICS_URL}/get?${params.toString()}`, { timeout: 12_000 });
    } catch (error) {
      if (error.status !== 404) getError = error;
    }

    // `/get` may succeed with plain lyrics even when a sibling record has
    // timestamps. Always look for a matching synced version in that case.
    let syncedMatch = null;
    let bestMatch = null;
    let searchCompleted = false;
    let searchError = null;
    if (!json?.instrumental) {
      const searchParams = new URLSearchParams({
        track_name: track.title,
        artist_name: track.artist,
      });
      try {
        const results = await fetchLyricsJson(`${LYRICS_URL}/search?${searchParams.toString()}`, { timeout: 12_000 });
        const list = Array.isArray(results) ? results : [];
        searchCompleted = true;
        syncedMatch = pickLyricsResult(list, track, json?.duration, { syncedOnly: true });
        if (!json) bestMatch = pickLyricsResult(list, track, json?.duration);
      } catch (error) {
        searchError = error;
      }
    }

    if (!json && !syncedMatch && !bestMatch && (getError || searchError)) {
      throw getError || searchError;
    }

    const resolved = syncedMatch || json || bestMatch;
    if (!resolved) return null;
    if (resolved.instrumental) {
      const data = { instrumental: true, lines: [], synced: false, plain: '', source: 'LRCLIB', id: resolved.id };
      rememberLyrics(track, data);
      return data;
    }

    const synced = Boolean(resolved.syncedLyrics);
    const plain = resolved.plainLyrics || json?.plainLyrics || '';
    const lines = synced ? parseLrc(resolved.syncedLyrics) : plainToLines(plain);
    if (!lines.length && !plain) return null;
    const data = {
      instrumental: false,
      synced,
      // Only a completed search is allowed to suppress future attempts.
      syncedUnavailable: !synced && Boolean(plain) && searchCompleted,
      searchFailed: !synced && Boolean(plain) && !searchCompleted && Boolean(searchError),
      lines,
      plain,
      source: 'LRCLIB',
      id: resolved.id ?? json?.id ?? null,
    };
    // Do not persist a plain fallback after a network failure; the next
    // session should try /search again.
    if (synced || !data.searchFailed) rememberLyrics(track, data);
    return data;
  });
}

export async function warmLyrics(track) {
  try {
    return await lyricsFor(track);
  } catch {
    return null;
  }
}

export const genres = [
  { name: 'Pop', query: 'pop hits', icon: 'sparkles', hue: 342 },
  { name: 'Hip-Hop', query: 'hip hop', icon: 'mic', hue: 26 },
  { name: 'R&B / Soul', query: 'r&b soul', icon: 'heart', hue: 292 },
  { name: 'Rock', query: 'rock', icon: 'wave', hue: 12 },
  { name: 'Electronic', query: 'electronic dance', icon: 'sliders', hue: 196 },
  { name: 'Indie', query: 'indie alternative', icon: 'star', hue: 158 },
  { name: 'Latin', query: 'latin', icon: 'globe', hue: 42 },
  { name: 'Country', query: 'country', icon: 'pin', hue: 34 },
  { name: 'Jazz', query: 'jazz', icon: 'disc', hue: 46 },
  { name: 'Classical', query: 'classical', icon: 'music', hue: 262 },
  { name: 'K-Pop', query: 'k-pop', icon: 'sparkles', hue: 322 },
  { name: 'Metal', query: 'metal', icon: 'alert', hue: 0 },
  { name: 'Folk', query: 'folk acoustic', icon: 'star', hue: 88 },
  { name: 'Reggae', query: 'reggae', icon: 'globe', hue: 128 },
  { name: 'Film & TV', query: 'soundtrack', icon: 'monitor', hue: 216 },
  { name: 'Kids', query: 'kids family', icon: 'sparkles', hue: 58 },
  { name: 'Fitness', query: 'workout', icon: 'wave', hue: 14 },
  { name: 'Focus', query: 'ambient instrumental', icon: 'headphones', hue: 174 },
];

export const mixes = [
  { id: 'mix-chill', title: 'Chill Mix', subtitle: 'Soft focus, slow tempo', query: 'chill acoustic', icon: 'moon', hue: 210 },
  { id: 'mix-energy', title: 'Energy Mix', subtitle: 'Big hooks, faster pace', query: 'dance pop hits', icon: 'wave', hue: 340 },
  { id: 'mix-discovery', title: 'Discovery Mix', subtitle: 'Fresh finds for you', query: 'new indie pop', icon: 'sparkles', hue: 276 },
  { id: 'mix-focus', title: 'Focus Mix', subtitle: 'Instrumental flow', query: 'ambient instrumental', icon: 'headphones', hue: 168 },
  { id: 'mix-late', title: 'Late Night Mix', subtitle: 'After-hours atmosphere', query: 'late night r&b', icon: 'moon', hue: 248 },
  { id: 'mix-classics', title: 'Essentials Mix', subtitle: 'Songs that endure', query: 'classic hits', icon: 'star', hue: 44 },
];

export const radioStations = [
  {
    id: 'rp-main',
    name: 'Radio Paradise',
    subtitle: 'Main Mix • hand-picked rock, world, electronic',
    stream: 'https://stream.radioparadise.com/aac-128',
    hue: 12,
    live: true,
  },
  {
    id: 'rp-mellow',
    name: 'Radio Paradise Mellow',
    subtitle: 'Mellow Mix • calm, warm and spacious',
    stream: 'https://stream.radioparadise.com/mellow-128',
    hue: 206,
    live: true,
  },
  {
    id: 'rp-rock',
    name: 'Radio Paradise Rock',
    subtitle: 'Rock Mix • guitars, old and new',
    stream: 'https://stream.radioparadise.com/rock-128',
    hue: 0,
    live: true,
  },
  {
    id: 'rp-global',
    name: 'Radio Paradise Global',
    subtitle: 'Global Mix • music without borders',
    stream: 'https://stream.radioparadise.com/global-128',
    hue: 154,
    live: true,
  },
  {
    id: 'rp-eclectic',
    name: 'Radio Paradise Eclectic',
    subtitle: 'Eclectic Mix • unexpected connections',
    stream: 'https://stream.radioparadise.com/eclectic-128',
    hue: 280,
    live: true,
  },
];

export const previewStations = [
  { id: 'station-pop', name: 'Orange Pop', subtitle: 'Continuous pop previews', query: 'pop hits', hue: 342, live: false },
  { id: 'station-chill', name: 'Orange Chill', subtitle: 'Continuous chill previews', query: 'chill acoustic', hue: 204, live: false },
  { id: 'station-rock', name: 'Orange Rock', subtitle: 'Continuous rock previews', query: 'rock anthems', hue: 8, live: false },
  { id: 'station-hiphop', name: 'Orange Hip-Hop', subtitle: 'Continuous hip-hop previews', query: 'hip hop', hue: 30, live: false },
  { id: 'station-electronic', name: 'Orange Electronic', subtitle: 'Continuous electronic previews', query: 'electronic dance', hue: 190, live: false },
  { id: 'station-jazz', name: 'Orange Jazz', subtitle: 'Continuous jazz previews', query: 'jazz', hue: 46, live: false },
];
