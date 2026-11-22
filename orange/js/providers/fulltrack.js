/*
 * Full track provider.
 * Resolves commercial and catalog tracks to high-bitrate full streams
 * via local /api/stream endpoint, Netlify proxy, or Audius fallback.
 */

import { decryptDesEcb } from './des.js?v=orange4';
import { findAudiusMatch } from './audius.js?v=orange4';

const cache = new Map();
const FULLTRACK_CACHE_TTL = 5 * 60_000;

export async function findFullTrackStream(track, { timeout = 3500 } = {}) {
  if (!track) return null;
  const rawTitle = String(track.title || '').trim();
  if (!rawTitle) return null;
  const query = `${rawTitle} ${track.artist || ''}`.trim();
  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);

  if (cached) {
    if (Date.now() - cached.at < FULLTRACK_CACHE_TTL) {
      return cached.value;
    }
    cache.delete(cacheKey);
  }

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
        cache.set(cacheKey, {
          at: Date.now(),
          value: result,
        });
        return result;
      }
    }
  } catch {
    /* fallback to Netlify proxy or Audius */
  }

  // 2. Try Netlify proxy /api/saavn
  // 2. Try Netlify proxy /api/saavn
  try {
    const controller = new AbortController();

    const timer = window.setTimeout(
      () => controller.abort(),
      timeout
    );

    const saavnUrl =
      `/api/saavn?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&q=${encodeURIComponent(query)}`;

    const res = await fetch(saavnUrl, {
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timer));

    if (res.ok) {
      const data = await res.json();

      const results = Array.isArray(data?.results)
        ? data.results
        : [];

      const normalize = value =>
        String(value || '')
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\b(feat|featuring|ft)\b/g, '')
          .replace(/[^a-z0-9]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const expectedTitle = normalize(track.title);
      const expectedArtist = normalize(track.artist);

      const matches = results.filter(item => {
        const title = normalize(
          item?.song ||
          item?.title ||
          item?.name ||
          ''
        );

        const artist = normalize(
          item?.more_info?.singers ||
          item?.singers ||
          item?.primary_artists ||
          item?.subtitle ||
          ''
        );

        if (!title || !artist) return false;

        // Require a reasonably close title.
        if (title !== expectedTitle) return false;

        // Require a matching artist.
        if (
          !artist.includes(expectedArtist) &&
          !expectedArtist.includes(artist)
        ) {
          return false;
        }

        return Boolean(item?.more_info?.encrypted_media_url);
      });

      // Only accept a validated result.
      const item = matches[0];

      if (item) {
        const encrypted = item.more_info.encrypted_media_url;
        const decrypted = decryptDesEcb(encrypted);

        const highQuality = decrypted.replace(
          /_[0-9]+\.mp4$/,
          '_320.mp4'
        );

        const result = {
          streamUrl: highQuality,
          streamFallbackUrl: decrypted,
          duration: Number(item?.more_info?.duration) || 0,
          isFullTrack: true,
          source: 'fulltrack',
          provider: 'saavn',
        };

        cache.set(cacheKey, {
          at: Date.now(),
          value: result,
        });
        return result;
      }
    }

  } catch (error) {
    console.warn('[Orange] Saavn resolution failed:', error);
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
      cache.set(cacheKey, {
        at: Date.now(),
        value: result,
      });
      return result;
    }
  } catch {
    /* fallback to null */
  }

  return null;
}
