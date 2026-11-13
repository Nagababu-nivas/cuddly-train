/*
 * Full track provider.
 * Resolves commercial and catalog tracks to high-bitrate full streams
 * via local /api/stream endpoint, Netlify proxy, or Audius fallback.
 */

import { decryptDesEcb } from './des.js?v=orange4';
import { findAudiusMatch } from './audius.js?v=orange4';

const cache = new Map();

export async function findFullTrackStream(track, { timeout = 3500 } = {}) {
  if (!track) return null;
  const rawTitle = String(track.title || '').trim();
  if (!rawTitle) return null;
  const query = `${rawTitle} ${track.artist || ''}`.trim();
  const cacheKey = query.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // 1. Try local server /api/stream
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`/api/stream?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timer));
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) {
        const result = {
          streamUrl: data.url,
          streamFallbackUrl: data.fallbackUrl,
          duration: data.duration,
          isFullTrack: true,
          source: 'fulltrack',
          provider: 'saavn',
        };
        cache.set(cacheKey, result);
        return result;
      }
    }
  } catch {
    /* fallback to Netlify proxy or Audius */
  }

  // 2. Try Netlify proxy /api/saavn
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    const saavnUrl = `/api/saavn?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&q=${encodeURIComponent(query)}`;
    const res = await fetch(saavnUrl, { signal: controller.signal }).finally(() => window.clearTimeout(timer));
    if (res.ok) {
      const data = await res.json();
      const item = data?.results?.[0];
      const encrypted = item?.more_info?.encrypted_media_url;
      if (encrypted) {
        const decrypted = decryptDesEcb(encrypted);
        const highQuality = decrypted.replace(/_[0-9]+\.mp4$/, '_320.mp4');
        const result = {
          streamUrl: highQuality,
          streamFallbackUrl: decrypted,
          duration: Number(item?.more_info?.duration) || 0,
          isFullTrack: true,
          source: 'fulltrack',
          provider: 'saavn',
        };
        cache.set(cacheKey, result);
        return result;
      }
    }
  } catch {
    /* fallback to Audius */
  }

  // 3. Fallback to Audius
  try {
    const audiusMatch = await findAudiusMatch(track, { timeout: 2500 });
    if (audiusMatch?.streamUrl) {
      const result = {
        streamUrl: audiusMatch.streamUrl,
        streamFallbackUrl: audiusMatch.streamFallbackUrl,
        duration: audiusMatch.duration,
        isFullTrack: true,
        source: 'audius',
        provider: 'audius',
      };
      cache.set(cacheKey, result);
      return result;
    }
  } catch {
    /* fallback to null */
  }

  return null;
}
