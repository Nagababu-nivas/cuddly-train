/*
 * Audius provider.
 *
 * Audius is a free, artist-uploaded music network. Its public API needs no
 * account, OAuth token or developer key; requests only identify the client
 * with an `app_name` string. Tracks are offered by the artists themselves and
 * many are streamable in full length.
 *
 * This module owns all Audius-specific knowledge: endpoints, normalisation,
 * caching and stream URL construction. The player only sees a normal Orange
 * track with a `streamUrl`, exactly like a preview or a local file.
 */

const API_HOSTS = [
  'https://api.audius.co',
  'https://discoveryprovider.audius.co',
];
const APP_NAME = 'OrangeWeb';
const SEARCH_TTL = 5 * 60_000;
const MAX_CACHE = 80;

const cache = new Map();

function remember(key, value) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

function recall(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > SEARCH_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function clearAudiusCache() {
  cache.clear();
}

function audiusError(message, status = 0) {
  const error = new Error(message);
  error.name = 'AudiusError';
  error.status = status;
  return error;
}

async function requestJson(path, { timeout = 12_000, signal } = {}) {
  let lastError = null;

  for (const host of API_HOSTS) {
    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    const controller = new AbortController();

    const abortRequest = () => controller.abort();

    signal?.addEventListener('abort', abortRequest, { once: true });

    const timer = window.setTimeout(
      () => controller.abort(),
      timeout
    );

    try {
      const response = await fetch(`${host}${path}`, {
        headers: {
          Accept: 'application/json',
        },
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw audiusError(
          `Audius request failed (${response.status})`,
          response.status
        );
      }

      return await response.json();

    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? audiusError('The Audius request timed out.', 408)
        : error;

      const status = Number(lastError?.status) || 0;

      // Invalid requests and permission errors should not be retried.
      if ([400, 401, 403].includes(status)) {
        break;
      }

      // Try the alternative host for temporary failures,
      // missing resources, rate limits and network errors.

    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abortRequest);
    }
  }

  throw lastError || audiusError('Audius is unreachable.');
}

export function audiusStreamUrl(providerId, host = API_HOSTS[0]) {
  if (!providerId) return '';
  return `${host}/v1/tracks/${encodeURIComponent(providerId)}/stream?app_name=${encodeURIComponent(APP_NAME)}`;
}

function artworkUrl(item) {
  const art = item?.artwork || {};
  return art['1000x1000'] || art['480x480'] || art['150x150'] || item?.cover_art || '';
}

function artworkSmall(item) {
  const art = item?.artwork || {};
  return art['150x150'] || art['480x480'] || art['1000x1000'] || '';
}

export function normalizeAudiusTrack(item) {
  if (!item?.id || item.is_delete || item.is_unlisted) return null;
  if (item.is_streamable === false) return null;
  // Audius can list stream-gated tracks as "streamable" while the public
  // /stream endpoint only serves a 30-second preview or a 403. They cannot
  // be played in full without the listener's purchase/follow/token, so keep
  // them out of the queue instead of silently skipping them mid-playback.
  if (item.is_stream_gated || item.is_premium || item.is_gated) return null;
  if (item.premium_conditions || item.stream_conditions) return null;
  if (item.is_available === false) return null;
  if (item.allowed_api_stream === false) return null;
  if (item.access && item.access.stream === false) return null;
  if (item.preview_duration && (item.is_stream_gated || item.is_premium || item.stream_conditions)) return null;
  const duration = Number(item.duration) || 0;
  if (item.preview_duration && duration <= 35) return null;
  const artist = item.user?.name || 'Audius artist';
  const playlist = item.album_backlink;
  return {
    id: `audius-${item.id}`,
    provider: 'audius',
    providerId: item.id,
    title: item.title || 'Untitled',
    artist,
    artistId: item.user?.id ? `audius-artist-${item.user.id}` : null,
    album: item.album_backlink?.playlist_name || '',
    albumId: playlist?.playlist_id ? `audius-album-${playlist.playlist_id}` : null,
    artwork: artworkUrl(item),
    artworkSmall: artworkSmall(item),
    duration,
    genre: item.genre || '',
    releaseDate: item.release_date || item.created_at || '',
    year: Number(String(item.release_date || '').slice(0, 4)) || null,
    explicit: Boolean(item.is_explicit),
    source: 'audius',
    isStream: true,
    isFullTrack: true,
    downloadAllowed: Boolean(item.is_downloadable),
    streamUrl: audiusStreamUrl(item.id),
    streamFallbackUrl: audiusStreamUrl(item.id, API_HOSTS[1]),
    permalink: item.permalink ? `https://audius.co${item.permalink}` : '',
    license: item.license || '',
  };
}

function normalizeList(payload) {
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return list.map(normalizeAudiusTrack).filter(Boolean);
}

export async function searchTracks(term, { limit = 20, signal } = {}) {
  const query = String(term || '').trim();
  if (!query) return [];
  const key = `search:${query.toLowerCase()}:${limit}`;
  const hit = recall(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    query,
    app_name: APP_NAME,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });
  const payload = await requestJson(`/v1/tracks/search?${params.toString()}`, { signal });
  const tracks = normalizeList(payload);
  remember(key, tracks);
  return tracks;
}

export async function trendingTracks({ genre = '', limit = 20, signal } = {}) {
  const key = `trending:${genre.toLowerCase()}:${limit}`;
  const hit = recall(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    app_name: APP_NAME,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });
  if (genre) params.set('genre', genre);
  const payload = await requestJson(`/v1/tracks/trending?${params.toString()}`, { signal });
  const tracks = normalizeList(payload);
  remember(key, tracks);
  return tracks;
}

export const AUDIUS_APP_NAME = APP_NAME;

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(feat|featuring|ft)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleMatches(original, candidate) {
  const a = normalizeMatchText(original);
  const b = normalizeMatchText(candidate);

  if (!a || !b) return false;
  if (a === b) return true;

  // Permit a small amount of extra title information,
  // but reject broad substring matches.
  const aWords = a.split(' ');
  const bWords = b.split(' ');

  const common = aWords.filter(word => bWords.includes(word));

  return common.length >= Math.min(aWords.length, bWords.length) &&
    Math.abs(aWords.length - bWords.length) <= 2;
}

function artistMatches(original, candidate) {
  const a = normalizeMatchText(original);
  const b = normalizeMatchText(candidate);

  if (!a || !b) return false;
  if (a === b) return true;

  const aWords = new Set(a.split(' '));
  const bWords = new Set(b.split(' '));

  const common = [...aWords].filter(word => bWords.has(word));

  return common.length >= Math.min(2, aWords.size);
}

function durationMatches(original, candidate) {
  const a = Number(original) || 0;
  const b = Number(candidate) || 0;

  // If either duration is unavailable, don't reject on duration alone.
  if (!a || !b) return true;

  // Allow up to 8 seconds difference for normal recording variations.
  return Math.abs(a - b) <= 8;
}

export async function findAudiusMatch(track, { timeout = 3500 } = {}) {
  if (!track || track.source === 'audius' || track.source === 'local') {
    return null;
  }

  const title = String(track.title || '').trim();
  const artist = String(track.artist || '').trim();

  if (!title || !artist) return null;

  try {
    const query = `${title} ${artist}`;

    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      timeout
    );

    let results;

    try {
      results = await searchTracks(query, {
        limit: 20,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }

    if (!Array.isArray(results) || !results.length) {
      return null;
    }

    const matches = results.filter(item => {
      if (!item?.streamUrl || !item.isFullTrack) return false;

      if (!titleMatches(title, item.title)) return false;
      if (!artistMatches(artist, item.artist)) return false;
      if (!durationMatches(track.duration, item.duration)) return false;

      return true;
    });

    if (!matches.length) return null;

    // Prefer the closest duration match.
    matches.sort((a, b) => {
      const originalDuration = Number(track.duration) || 0;

      if (!originalDuration) return 0;

      const aDiff = Math.abs(originalDuration - (Number(a.duration) || 0));
      const bDiff = Math.abs(originalDuration - (Number(b.duration) || 0));

      return aDiff - bDiff;
    });

    return matches[0];

  } catch (error) {
    console.warn('[Orange] Audius matching failed:', error);
    return null;
  }
}
