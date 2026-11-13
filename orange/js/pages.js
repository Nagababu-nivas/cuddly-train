/* Catalog, discovery and library page renderers. */

import {
  esc, formatTime, formatCount, plural, shuffleArray, yearOf, art, uniqueBy, hashString,
} from './util.js?v=orange4';
import { icon } from './icons.js?v=orange4';
import * as api from './api.js?v=orange4';
import { store } from './store.js?v=orange4';
import { player } from './player.js?v=orange4';
import {
  viewState, setHeader, setMain, pageHead, shelf, card, hero, emptyState, errorState,
  skeletonShelf, skeletonHero, trackTable, registerTrackList, groupLibraryAlbums,
  groupLibraryArtists, totalDuration, artworkOf, displayName, fallbackStyle, artMedia,
  likeButton, sectionHead, registerList,
} from './viewkit.js?v=orange4';

function aliveCheck(alive) {
  return typeof alive === 'function' ? alive() : true;
}

function genreSlug(name) {
  return String(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function findGenre(slug) {
  return api.genres.find((genre) => genreSlug(genre.name) === slug || genreSlug(genre.query) === slug);
}

function detailHero({
  artwork, kicker = '', title, subtitle = '', description = '', actions = '', round = false,
  hue = null, glyph = '', meta = '',
}) {
  return `
    <section class="detail-hero">
      <div class="detail-art ${round ? 'round' : ''}" style="${hue !== null ? `background: linear-gradient(145deg, hsl(${hue} 58% 36%), hsl(${(hue + 46) % 360} 58% 20%));` : 'background: linear-gradient(145deg,#2a2a31,#17171b);'}">
        ${artwork ? artMedia({ artwork, title }, { alt: title }) : `<span class="detail-glyph">${glyph || icon('music', 54)}</span>`}
      </div>
      <div class="detail-meta">
        <div class="detail-kicker">${esc(kicker)}</div>
        <h1 class="detail-title">${esc(title)}</h1>
        ${subtitle ? `<div class="detail-sub">${subtitle}</div>` : ''}
        ${description ? `<p class="detail-desc">${esc(description)}</p>` : ''}
        ${meta ? `<div class="detail-meta-line">${esc(meta)}</div>` : ''}
        <div class="detail-actions">${actions}</div>
      </div>
    </section>`;
}

function playListButtons(listKey, { playLabel = 'Play', shuffle = true } = {}) {
  return `
    <button class="play-large" data-act="play-list" data-list="${esc(listKey)}">${icon('play', 16)}${esc(playLabel)}</button>
    ${shuffle ? `<button class="play-large secondary" data-act="play-list" data-list="${esc(listKey)}" data-shuffle="1">${icon('shuffle', 15)}Shuffle</button>` : ''}`;
}

function artistLink(artist, id) {
  if (!artist) return '';
  return id
    ? `<button class="text-link" data-act="open-artist" data-id="${esc(id)}">${esc(artist)}</button>`
    : `<span>${esc(artist)}</span>`;
}

function albumGrid(albums, { listKey = '' } = {}) {
  if (!albums.length) return '';
  return `<div class="result-grid">
    ${albums.map((album, index) => card(album, album.id?.startsWith('it-album-') ? 'album' : 'local-album', {
      listKey,
      index,
      badge: album.source === 'local' ? 'Local' : '',
    })).join('')}
  </div>`;
}

function artistGrid(artists) {
  if (!artists.length) return '';
  return `<div class="result-grid artist-grid">
    ${artists.map((artist) => card(artist, artist.id?.startsWith('it-artist-') ? 'artist' : 'local-artist', {
      round: true,
      subtitle: artist.albumCount !== undefined ? `${plural(artist.albumCount, 'album')}` : artist.genre,
    })).join('')}
  </div>`;
}

function searchTabs(type, counts, query) {
  const tabs = [
    ['all', 'All'],
    ['songs', 'Songs'],
    ['audius', 'Audius'],
    ['albums', 'Albums'],
    ['artists', 'Artists'],
  ];
  return `<div class="search-tabs">
    ${tabs.map(([key, label]) => `
      <button class="${type === key ? 'active' : ''}" data-act="search-tab" data-type="${key}" data-query="${esc(query)}">
        ${label}${counts[key] ? ` <span class="tab-count">${counts[key]}</span>` : ''}
      </button>`).join('')}
  </div>`;
}

export async function renderListen(alive) {
  setHeader('Listen Now', 'Made for you');
  setMain(`${skeletonHero()}${skeletonShelf(7)}${skeletonShelf(7)}`);
  let chart = [];
  let fresh = [];
  let albums = [];
  let failed = false;
  try {
    const results = await Promise.all([
      api.chartSongs(24),
      api.newAlbums(18),
      api.chartAlbums(18),
    ]);
    [chart, fresh, albums] = results;
  } catch (error) {
    failed = true;
  }
  if (!aliveCheck(alive)) return;

  const recents = store.recentTracks(12);
  const liked = store.likesTracks().slice(0, 12);
  const library = store.allLibraryTracks().slice(0, 16);
  const feature = chart[0] || recents[0] || library[0] || null;
  const localOnly = !chart.length && !fresh.length && !albums.length;

  const heroActions = feature
    ? `${chart.length ? playListButtons('chart-songs') : `<button class="play-large" data-act="play-list" data-list="${recents.length ? 'recent-shelf' : 'library-shelf'}">${icon('play', 16)}Play</button>`}
       <button class="pill-btn secondary" data-nav="/browse">${icon('browse', 15)}Browse</button>`
    : `<button class="pill-btn" data-act="open-add-music">${icon('upload', 15)}Add local music</button>
       <button class="pill-btn secondary" data-nav="/browse">${icon('browse', 15)}Browse</button>`;

  let html = hero({
    kicker: feature ? 'Made for you' : 'Welcome to Orange',
    title: feature ? feature.title : 'Your music, without the subscription',
    description: feature
      ? `${feature.artist}${feature.album ? ` · ${feature.album}` : ''}`
      : 'Stream free previews, tune in to public radio, add your own files, and build a library that stays on this device.',
    actions: heroActions,
    artwork: feature ? artworkOf(feature) : '',
    hue: feature ? null : 342,
  });

  if (failed && localOnly) {
    html += `<div class="inline-banner">${icon('wifi-off', 16)}<span>The online catalog could not be reached. Local files and saved items still work.</span><button data-act="retry">Retry</button></div>`;
  }

  if (chart.length) {
    html += shelf('Top Picks', chart, 'track', {
      listKey: 'chart-songs',
      context: { type: 'chart', title: 'Top Picks' },
      subtitle: (track) => track.artist,
    });
  }
  if (fresh.length) {
    html += shelf('New Releases', fresh, 'album', { subtitle: (album) => `${album.artist}${album.year ? ` · ${album.year}` : ''}` });
  }
  if (recents.length) {
    html += shelf('Recently Played', recents, 'track', {
      listKey: 'recent-shelf',
      context: { type: 'recent', title: 'Recently Played' },
    });
  }
  if (liked.length) {
    html += shelf('Loved', liked, 'track', {
      listKey: 'liked-shelf',
      context: { type: 'liked', title: 'Loved' },
    });
  }
  if (library.length) {
    html += shelf('Your Library', library, 'track', {
      listKey: 'library-shelf',
      context: { type: 'library', title: 'Your Library' },
    });
  }
  if (albums.length) {
    html += `<section class="section">
      <div class="section-head">
        <h3 class="section-title">Chart-Topping Albums <span class="count">${albums.length}</span></h3>
        <button class="section-link" data-nav="/browse">Browse all</button>
      </div>
      ${albumGrid(albums.slice(0, 12))}
    </section>`;
  }
  html += `<section class="section">
    <div class="section-head"><h3 class="section-title">Made for You</h3><button class="section-link" data-nav="/library/made">See all</button></div>
    <div class="result-grid mix-grid">
      ${api.mixes.map((mix) => card(mix, 'mix', { subtitle: mix.subtitle })).join('')}
    </div>
  </section>`;

  if (!chart.length && !recents.length && !library.length && !albums.length) {
    html += emptyState({
      iconName: 'headphones',
      title: 'Start your library',
      description: 'Add music from your computer, search the free catalog, or tune in to public radio.',
      actions: `<button class="pill-btn" data-act="open-add-music">${icon('upload', 15)}Add local music</button>
                <button class="pill-btn secondary" data-nav="/search">${icon('search', 15)}Search catalog</button>
                <button class="pill-btn ghost" data-nav="/radio">${icon('radio', 15)}Radio</button>`,
    });
  }
  setMain(html);
  setHeader('Listen Now', feature ? 'Made for you' : 'Welcome');
}

export async function renderBrowse(alive) {
  setHeader('Browse', 'Find your next favorite');
  setMain(`
    <div class="view-head"><div><h2>Browse</h2><p>Genres, charts and new sounds.</p></div></div>
    <div class="genre-grid">
      ${api.genres.map((genre) => `
        <button class="genre-tile" data-act="open" data-kind="genre" data-id="${genreSlug(genre.name)}" data-query="${esc(genre.query)}" style="background: linear-gradient(135deg, hsl(${genre.hue} 58% 32%), hsl(${(genre.hue + 46) % 360} 58% 18%));">
          <span class="g-name">${esc(genre.name)}</span>
          <span class="g-count">Explore</span>
          <span class="g-icon">${icon(genre.icon, 72)}</span>
        </button>`).join('')}
    </div>
    ${skeletonShelf(7)}
    ${skeletonShelf(7)}`);

  let songs = [];
  let albums = [];
  let fresh = [];
  let failed = false;
  try {
    [songs, albums, fresh] = await Promise.all([
      api.chartSongs(20),
      api.chartAlbums(20),
      api.newAlbums(12),
    ]);
  } catch {
    failed = true;
  }
  if (!aliveCheck(alive)) return;
  let html = `<div class="view-head"><div><h2>Browse</h2><p>Genres, charts and new sounds.</p></div></div>
    <div class="genre-grid">
      ${api.genres.map((genre) => `
        <button class="genre-tile" data-act="open" data-kind="genre" data-id="${genreSlug(genre.name)}" data-query="${esc(genre.query)}" style="background: linear-gradient(135deg, hsl(${genre.hue} 58% 32%), hsl(${(genre.hue + 46) % 360} 58% 18%));">
          <span class="g-name">${esc(genre.name)}</span>
          <span class="g-count">Explore</span>
          <span class="g-icon">${icon(genre.icon, 72)}</span>
        </button>`).join('')}
    </div>`;
  if (failed) html += `<div class="inline-banner">${icon('wifi-off', 16)}<span>Charts are offline. Browse genres once the catalog reconnects.</span><button data-act="retry">Retry</button></div>`;
  if (songs.length) {
    html += shelf('Top Songs', songs, 'track', {
      listKey: 'browse-songs',
      context: { type: 'chart', title: 'Top Songs' },
    });
  }
  if (albums.length) {
    html += `<section class="section"><div class="section-head"><h3 class="section-title">Top Albums <span class="count">${albums.length}</span></h3></div>${albumGrid(albums)}</section>`;
  }
  if (fresh.length) {
    html += `<section class="section"><div class="section-head"><h3 class="section-title">Fresh Releases <span class="count">${fresh.length}</span></h3></div>${albumGrid(fresh)}</section>`;
  }
  setMain(html);
}

export async function renderRadio(alive) {
  setHeader('Radio', 'Live and continuous');
  const live = api.radioStations;
  const previews = api.previewStations;
  setMain(`
    <div class="view-head"><div><h2>Radio</h2><p>Public live streams and continuous preview stations.</p></div></div>
    <div class="radio-grid">
      ${live.map((station) => `
        <article class="station-card live" style="--hue:${station.hue}">
          <div class="station-glow"></div>
          <span class="badge live">Live</span>
          <div class="station-body">
            <div class="station-icon">${icon('radio', 28)}</div>
            <h3>${esc(station.name)}</h3>
            <p>${esc(station.subtitle)}</p>
          </div>
          <button class="station-play" data-act="play-station" data-id="${esc(station.id)}" aria-label="Play ${esc(station.name)}">${icon('play', 18)}</button>
        </article>`).join('')}
    </div>
    <section class="section">
      ${sectionHead('Preview Stations', previews.length)}
      <div class="radio-grid previews">
        ${previews.map((station) => `
          <article class="station-card" style="--hue:${station.hue}">
            <span class="badge preview">30 sec previews</span>
            <div class="station-body">
              <div class="station-icon">${icon('wave', 26)}</div>
              <h3>${esc(station.name)}</h3>
              <p>${esc(station.subtitle)}</p>
            </div>
            <button class="station-play" data-act="play-station" data-id="${esc(station.id)}" aria-label="Play ${esc(station.name)}">${icon('play', 18)}</button>
          </article>`).join('')}
      </div>
    </section>
    <p class="radio-note">${icon('info', 14)} Live stations are public, independently operated streams. Preview stations play free 30-second catalog previews continuously.</p>`);
}

export async function renderSearch(alive, query, type = 'all') {
  viewState.search = { query, type };
  if (!query) {
    const history = store.getState().searchHistory;
    setHeader('Search', 'Search');
    setMain(`
      <div class="search-hero"><h2>Search</h2><p class="muted">Artists, songs, albums, free previews and Audius full tracks.</p></div>
      ${history.length ? `<section class="section">
        <div class="section-head"><h3 class="section-title">Recent Searches</h3><button class="section-link" data-act="clear-history">Clear</button></div>
        <div class="search-chips">${history.map((term) => `<button class="chip" data-act="search-term" data-term="${esc(term)}">${icon('clock', 13)}${esc(term)}</button>`).join('')}</div>
      </section>` : ''}
      <section class="section">
        <div class="section-head"><h3 class="section-title">Browse by Genre</h3></div>
        <div class="search-chips">
          ${api.genres.map((genre) => `<button class="chip" data-act="open" data-kind="genre" data-id="${genreSlug(genre.name)}" data-query="${esc(genre.query)}">${esc(genre.name)}</button>`).join('')}
        </div>
      </section>
      <div class="search-cards">
        ${['Top songs', 'New albums', 'Artists to know'].map((title, index) => `<div class="search-prompt"><span class="prompt-index">0${index + 1}</span><h3>${title}</h3><p>Type a name in the search field above.</p></div>`).join('')}
      </div>`);
    return;
  }

  setHeader('Search', `“${query}”`);
  setMain(`${skeletonHero()}${skeletonShelf(6)}${skeletonShelf(6)}`);
  let results;
  try {
    results = await api.searchAll(query);
  } catch (error) {
    if (!aliveCheck(alive)) return;
    setMain(errorState(error.message));
    return;
  }
  if (!aliveCheck(alive)) return;

  const { songs, albums, artists, audius = [] } = results;
  const counts = {
    all: songs.length + albums.length + artists.length + audius.length,
    songs: songs.length,
    audius: audius.length,
    albums: albums.length,
    artists: artists.length,
  };
  const top = audius[0] || songs[0] || albums[0] || artists[0] || null;
  registerTrackList('search-songs', songs, { type: 'search', query, title: `Search: ${query}` });
  registerTrackList('search-audius', audius, { type: 'search', query, title: `Audius: ${query}` });

  let html = `<div class="search-hero"><h2>Results for “${esc(query)}”</h2><p class="muted">${counts.all} matches from the free catalog${audius.length ? ' and Audius' : ''}</p></div>
    ${searchTabs(type, counts, query)}`;

  if (!counts.all) {
    html += emptyState({
      iconName: 'search',
      title: 'No matches found',
      description: `Nothing matched “${query}”. Try an artist, album or a shorter phrase.`,
      actions: `<button class="pill-btn secondary" data-act="retry">${icon('refresh', 15)}Try again</button>`,
    });
    setMain(html);
    return;
  }

  if (type === 'all' && top) {
    const isAudius = top.source === 'audius';
    const isSong = Boolean(top.trackId || isAudius);
    const isAlbum = Boolean(top.collectionId);
    const topKind = isSong ? (isAudius ? 'full track' : 'track preview') : isAlbum ? 'album' : 'artist';
    const topList = isAudius ? 'search-audius' : 'search-songs';
    const playAttr = isSong
      ? `data-act="play-row" data-list="${topList}" data-index="0"`
      : isAlbum
        ? `data-act="open" data-kind="album" data-id="${esc(top.id)}"`
        : `data-act="open" data-kind="artist" data-id="${esc(top.id)}"`;
    const topSubtitle = isSong
      ? `${top.artist}${isAudius ? ' · Audius · Full track' : ` · ${top.album || ''} · 30s Preview`}`
      : isAlbum
        ? top.artist
        : top.genre || 'Artist';
    html += `<section class="section top-result-section">
      <div class="section-head"><h3 class="section-title">Top Result</h3></div>
      <button class="top-result" ${playAttr}>
        <span class="top-result-art" style="${fallbackStyle(top)}">${artMedia(top, { alt: displayName(top) })}</span>
        <span class="top-result-body">
          <span class="top-result-kind">${topKind}</span>
          <strong>${esc(displayName(top))}</strong>
          <span>${esc(topSubtitle)}</span>
        </span>
        <span class="top-result-play">${icon(isSong ? 'play' : 'chevron-right', 18)}</span>
      </button>
    </section>`;
  }

  if ((type === 'all' || type === 'audius') && audius.length) {
    html += `<section class="section">
      ${sectionHead('Audius · Full tracks', audius.length, type === 'all' ? `<button class="section-link" data-act="search-tab" data-type="audius" data-query="${esc(query)}">See all</button>` : '')}
      <p class="section-note muted small">Free full-length streams uploaded by Audius artists.</p>
      ${trackTable(type === 'all' ? audius.slice(0, 10) : audius, {
        listKey: 'search-audius',
        context: { type: 'search', query, title: `Audius: ${query}` },
        showAlbum: false,
      })}
    </section>`;
  } else if (type === 'audius' && !audius.length) {
    html += emptyState({
      iconName: 'search',
      title: 'No Audius matches',
      description: `Audius has no full-length tracks for “${query}” right now.`,
      small: true,
    });
  }

  if ((type === 'all' || type === 'songs') && songs.length) {
    html += `<section class="section">
      ${sectionHead('Songs · 30s Previews', songs.length, type === 'all' ? `<button class="section-link" data-act="search-tab" data-type="songs" data-query="${esc(query)}">See all</button>` : '')}
      <p class="section-note muted small">Catalog previews from Apple iTunes (plays 30-second clip).</p>
      ${trackTable(type === 'all' ? songs.slice(0, 10) : songs, {
        listKey: 'search-songs',
        context: { type: 'search', query, title: `Search: ${query}` },
        showAlbum: true,
      })}
    </section>`;
  }
  if ((type === 'all' || type === 'albums') && albums.length) {
    html += `<section class="section">
      ${sectionHead('Albums', albums.length, type === 'all' ? `<button class="section-link" data-act="search-tab" data-type="albums" data-query="${esc(query)}">See all</button>` : '')}
      ${albumGrid(type === 'all' ? albums.slice(0, 8) : albums)}
    </section>`;
  }
  if ((type === 'all' || type === 'artists') && artists.length) {
    html += `<section class="section">
      ${sectionHead('Artists', artists.length, type === 'all' ? `<button class="section-link" data-act="search-tab" data-type="artists" data-query="${esc(query)}">See all</button>` : '')}
      ${artistGrid(artists)}
    </section>`;
  }
  if (results.errors?.length) {
    html += `<div class="inline-banner">${icon('wifi-off', 16)}<span>Some search categories could not be reached.</span></div>`;
  }
  setMain(html);
}

export async function renderGenre(alive, slug) {
  const genre = findGenre(slug) || { name: slug.replace(/-/g, ' '), query: slug.replace(/-/g, ' '), hue: 342 };
  setHeader('Browse', genre.name);
  setMain(`${skeletonHero()}${skeletonShelf(6)}${skeletonShelf(6)}`);
  let data;
  try {
    data = await api.genreCatalog(genre.query, 50);
  } catch (error) {
    if (!aliveCheck(alive)) return;
    setMain(errorState(error.message));
    return;
  }
  if (!aliveCheck(alive)) return;
  const context = { type: 'genre', id: slug, title: genre.name };
  registerTrackList('genre-songs', data.songs, context);
  let html = detailHero({
    title: genre.name,
    kicker: 'Genre',
    subtitle: `${plural(data.songs.length, 'song')} · Free previews`,
    description: `A fresh cross-section of ${genre.name.toLowerCase()} from the free catalog.`,
    actions: playListButtons('genre-songs'),
    hue: genre.hue,
    glyph: icon(genre.icon || 'music', 56),
  });
  if (data.songs.length) {
    html += `<section class="section">
      ${sectionHead('Songs', data.songs.length)}
      ${trackTable(data.songs.slice(0, 25), { listKey: 'genre-songs', context })}
    </section>`;
  }
  if (data.albums.length) {
    html += `<section class="section">${sectionHead('Albums', data.albums.length)}${albumGrid(data.albums)}</section>`;
  }
  if (!data.songs.length && !data.albums.length) {
    html += emptyState({ iconName: 'search', title: 'No genre results', description: 'Try another genre from Browse.' });
  }
  setMain(html);
}

export async function renderMix(alive, id) {
  const mix = api.mixes.find((item) => item.id === id);
  if (!mix) {
    renderNotFound();
    return;
  }
  setHeader('Made for You', mix.title);
  setMain(`${skeletonHero()}${skeletonShelf(6)}`);
  let tracks;
  try {
    tracks = await api.searchSongs(mix.query, { limit: 50 });
  } catch (error) {
    if (!aliveCheck(alive)) return;
    setMain(errorState(error.message));
    return;
  }
  if (!aliveCheck(alive)) return;
  const context = { type: 'mix', id, title: mix.title };
  registerTrackList('mix-tracks', tracks, context);
  let html = detailHero({
    title: mix.title,
    kicker: 'Made for you',
    subtitle: `${plural(tracks.length, 'song')} · ${mix.subtitle}`,
    description: `A continuous mix drawn from the free catalog. ${mix.subtitle}.`,
    actions: playListButtons('mix-tracks'),
    hue: mix.hue,
    glyph: icon(mix.icon || 'sparkles', 56),
  });
  if (tracks.length) {
    html += `<section class="section">${sectionHead('Track List', tracks.length)}${trackTable(tracks, { listKey: 'mix-tracks', context })}</section>`;
  } else {
    html += emptyState({ iconName: 'sparkles', title: 'Mix is empty', description: 'The catalog did not return anything for this mix. Try again later.' });
  }
  setMain(html);
}

export function renderNotFound() {
  setHeader('Orange', 'Not found');
  setMain(emptyState({
    iconName: 'x-circle',
    title: 'This page is not here',
    description: 'It may have moved, or the link may be incomplete.',
    actions: `<button class="pill-btn" data-nav="/listen">${icon('listen', 15)}Go to Listen Now</button>`,
  }));
}

export { genreSlug, findGenre, detailHero, playListButtons, albumGrid, artistGrid };

function libraryActions() {
  return `<button class="pill-btn secondary" data-act="open-add-music">${icon('upload', 15)}Import Music</button>`;
}

export async function renderAlbum(alive, id) {
  setHeader('Album', 'Loading album…');
  setMain(`${skeletonHero()}${skeletonShelf(6)}`);
  let data;
  try {
    data = await api.albumDetails(id);
  } catch (error) {
    if (!aliveCheck(alive)) return;
    setMain(errorState(error.message));
    return;
  }
  if (!aliveCheck(alive)) return;
  const { album, tracks } = data;
  if (!album && !tracks.length) {
    setMain(errorState('This album could not be found in the free catalog.'));
    return;
  }
  const albumObject = album || {
    id: `it-album-${String(id).replace(/^it-album-/, '')}`,
    title: tracks[0]?.album || 'Unknown Album',
    artist: tracks[0]?.artist || 'Unknown Artist',
    artistId: tracks[0]?.artistId || null,
    artwork: tracks[0]?.artwork || '',
    releaseDate: tracks[0]?.releaseDate || '',
    year: tracks[0]?.year || '',
    genre: tracks[0]?.genre || '',
    trackCount: tracks.length,
    source: 'catalog',
  };
  store.rememberAlbum(albumObject);
  store.rememberTracks(tracks);
  const saved = store.isAlbumSaved(albumObject.id);
  const context = { type: 'album', id: albumObject.id, title: albumObject.title };
  registerTrackList('album-tracks', tracks, context);
  setHeader('Album', albumObject.title);
  const metaLine = [
    albumObject.year || yearOf(albumObject.releaseDate),
    albumObject.genre,
    plural(tracks.length, 'song'),
    'Free previews',
  ].filter(Boolean).join(' • ');
  let html = detailHero({
    artwork: artworkOf(albumObject),
    kicker: 'Album',
    title: albumObject.title,
    subtitle: `${artistLink(albumObject.artist, albumObject.artistId)}<span class="dot"></span><span>${esc(albumObject.year || yearOf(albumObject.releaseDate) || '')}</span>`,
    description: '',
    meta: metaLine,
    actions: `
      <button class="play-large" data-act="play-list" data-list="album-tracks">${icon('play', 16)}Play</button>
      <button class="play-large secondary" data-act="play-list" data-list="album-tracks" data-shuffle="1">${icon('shuffle', 15)}Shuffle</button>
      <button class="play-large secondary ${saved ? 'saved' : ''}" data-act="toggle-album" data-id="${esc(albumObject.id)}" data-list="album-tracks">${icon(saved ? 'check' : 'plus', 15)}${saved ? 'In Library' : 'Add to Library'}</button>
      <button class="icon-btn" data-act="album-menu" data-id="${esc(albumObject.id)}" title="More" aria-label="More album options">${icon('more', 18)}</button>`,
  });
  if (tracks.length) {
    html += `<section class="section">${sectionHead(`Track List`, tracks.length)}${trackTable(tracks, { listKey: 'album-tracks', context })}</section>`;
  } else {
    html += emptyState({ iconName: 'music', title: 'No preview tracks', description: 'This release has no free previews available right now.' });
  }
  if (albumObject.copyright) {
    html += `<p class="copyright-note">${esc(albumObject.copyright)}</p>`;
  }
  setMain(html);
}

export async function renderArtist(alive, id) {
  setHeader('Artist', 'Loading artist…');
  setMain(`${skeletonHero()}${skeletonShelf(6)}`);
  let data;
  try {
    data = await api.artistDetails(id);
  } catch (error) {
    if (!aliveCheck(alive)) return;
    setMain(errorState(error.message));
    return;
  }
  if (!aliveCheck(alive)) return;
  const { artist, tracks, albums } = data;
  if (!artist || (!tracks.length && !albums.length)) {
    setMain(errorState('This artist could not be found in the free catalog.'));
    return;
  }
  store.rememberArtist(artist);
  store.rememberTracks(tracks);
  const saved = store.isArtistSaved(artist.id);
  const context = { type: 'artist', id: artist.id, title: artist.name };
  registerTrackList('artist-tracks', tracks, context);
  setHeader('Artist', artist.name);
  let html = detailHero({
    artwork: artworkOf(artist) || artworkOf(albums[0]) || artworkOf(tracks[0]),
    kicker: 'Artist',
    title: artist.name,
    subtitle: `<span>${esc(artist.genre || 'Music')}</span><span class="dot"></span><span>${plural(albums.length, 'album')}</span>`,
    meta: `${plural(tracks.length, 'song')} available as free previews`,
    round: true,
    actions: `
      <button class="play-large" data-act="play-list" data-list="artist-tracks">${icon('play', 16)}Play</button>
      <button class="play-large secondary" data-act="play-list" data-list="artist-tracks" data-shuffle="1">${icon('shuffle', 15)}Shuffle</button>
      <button class="play-large secondary ${saved ? 'saved' : ''}" data-act="toggle-artist" data-id="${esc(artist.id)}">${icon(saved ? 'check' : 'plus', 15)}${saved ? 'Following' : 'Follow'}</button>`,
  });
  if (tracks.length) {
    html += `<section class="section">${sectionHead('Top Songs', tracks.length)}${trackTable(tracks.slice(0, 24), { listKey: 'artist-tracks', context })}</section>`;
  }
  if (albums.length) {
    html += `<section class="section">${sectionHead('Albums', albums.length)}${albumGrid(albums)}</section>`;
  }
  setMain(html);
}

export async function renderPlaylist(alive, id) {
  const playlist = store.playlistById(id);
  if (!playlist) {
    setHeader('Playlist', 'Not found');
    setMain(emptyState({
      iconName: 'playlist',
      title: 'Playlist not found',
      description: 'This playlist may have been deleted or moved.',
      actions: `<button class="pill-btn" data-nav="/library/recent">${icon('library', 15)}Go to Library</button>
                <button class="pill-btn secondary" data-act="new-playlist">${icon('plus', 15)}New Playlist</button>`,
    }));
    return;
  }
  const tracks = store.playlistTracks(id);
  const context = { type: 'playlist', id, title: playlist.name };
  registerTrackList('playlist-tracks', tracks, context);
  const hue = (playlist.name.length * 47 + 12) % 360;
  setHeader('Playlist', playlist.name);
  let html = detailHero({
    title: playlist.name,
    kicker: 'Playlist',
    subtitle: `${plural(tracks.length, 'song')}${tracks.length ? ` · ${totalDuration(tracks)}` : ''}`,
    description: playlist.description || 'A playlist made by you.',
    hue,
    glyph: icon('playlist', 58),
    actions: `
      <button class="play-large" data-act="play-list" data-list="playlist-tracks">${icon('play', 16)}Play</button>
      <button class="play-large secondary" data-act="play-list" data-list="playlist-tracks" data-shuffle="1">${icon('shuffle', 15)}Shuffle</button>
      <button class="play-large secondary" data-act="edit-playlist" data-id="${esc(id)}">${icon('edit', 15)}Edit</button>
      <button class="icon-btn" data-act="playlist-menu" data-id="${esc(id)}" title="More" aria-label="More playlist options">${icon('more', 18)}</button>`,
  });
  if (tracks.length) {
    html += `<section class="section">${sectionHead('Tracks', tracks.length, `<button class="section-link" data-act="edit-playlist" data-id="${esc(id)}">Edit playlist</button>`)}${trackTable(tracks, { listKey: 'playlist-tracks', context, playlistId: id })}</section>`;
  } else {
    html += emptyState({
      iconName: 'playlist',
      title: 'This playlist is empty',
      description: 'Find songs in the catalog or your library, then use the ••• menu to add them.',
      actions: `<button class="pill-btn" data-nav="/search">${icon('search', 15)}Find music</button>
                <button class="pill-btn secondary" data-nav="/library/songs">${icon('library', 15)}Your library</button>`,
    });
  }
  setMain(html);
}

export async function renderLibraryRecent(alive) {
  const tracks = store.allLibraryTracks();
  const albums = groupLibraryAlbums();
  setHeader('Library', 'Recently Added');
  if (!tracks.length && !albums.length) {
    setMain(pageHead('Recently Added', 'Your saved and imported music.', libraryActions()) + emptyState({
      iconName: 'library',
      title: 'Your library is empty',
      description: 'Import audio files from this computer or add releases from the free catalog.',
      actions: `<button class="pill-btn" data-act="open-add-music">${icon('upload', 15)}Import Music</button>
                <button class="pill-btn secondary" data-nav="/search">${icon('search', 15)}Search Catalog</button>
                <button class="pill-btn ghost" data-nav="/browse">${icon('browse', 15)}Browse</button>`,
    }));
    return;
  }
  let html = pageHead('Recently Added', `${plural(tracks.length, 'track')} in your library.`, libraryActions());
  if (tracks.length) {
    html += shelf('Recently Added', tracks.slice(0, 30), 'track', {
      listKey: 'recent-library',
      context: { type: 'library', title: 'Recently Added' },
    });
  }
  if (albums.length) {
    html += `<section class="section">${sectionHead('Albums', albums.length)}${albumGrid(albums.slice(0, 12))}</section>`;
  }
  setMain(html);
}

export async function renderLibrarySongs(alive, sort = 'recent') {
  const all = store.allLibraryTracks();
  const tracks = all.slice();
  if (sort === 'title') tracks.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  else if (sort === 'artist') tracks.sort((a, b) => String(a.artist).localeCompare(String(b.artist)) || String(a.title).localeCompare(String(b.title)));
  else tracks.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  setHeader('Library', 'Songs');
  if (!all.length) {
    setMain(pageHead('Songs', 'Everything you have saved or imported.', libraryActions()) + emptyState({
      iconName: 'music',
      title: 'No songs yet',
      description: 'Songs you add from the catalog or import from disk will appear here.',
      actions: `<button class="pill-btn" data-act="open-add-music">${icon('upload', 15)}Import Music</button>
                <button class="pill-btn secondary" data-nav="/search">${icon('search', 15)}Search Catalog</button>`,
    }));
    return;
  }
  const context = { type: 'library', title: 'Songs' };
  registerTrackList('library-songs', tracks, context);
  let html = pageHead('Songs', `${plural(tracks.length, 'track')} · ${totalDuration(tracks)}`, libraryActions());
  html += `<div class="library-toolbar">
    <label class="library-filter-wrap">${icon('search', 15)}<input type="search" data-library-filter placeholder="Filter songs" autocomplete="off"></label>
    <label class="library-sort-wrap">${icon('sort', 14)}<select data-library-sort>
      <option value="recent" ${sort === 'recent' ? 'selected' : ''}>Recently Added</option>
      <option value="title" ${sort === 'title' ? 'selected' : ''}>Title</option>
      <option value="artist" ${sort === 'artist' ? 'selected' : ''}>Artist</option>
    </select></label>
    <div class="spacer"></div>
    <button class="pill-btn" data-act="play-list" data-list="library-songs">${icon('play', 15)}Play</button>
    <button class="pill-btn secondary" data-act="play-list" data-list="library-songs" data-shuffle="1">${icon('shuffle', 15)}Shuffle</button>
  </div>`;
  html += trackTable(tracks, { listKey: 'library-songs', context });
  setMain(html);
}

export async function renderLibraryAlbums(alive) {
  const albums = groupLibraryAlbums();
  setHeader('Library', 'Albums');
  if (!albums.length) {
    setMain(pageHead('Albums', 'Albums from your library.', libraryActions()) + emptyState({
      iconName: 'albums',
      title: 'No albums yet',
      description: 'Save an album from the catalog or import a folder of music.',
      actions: `<button class="pill-btn" data-act="open-add-music">${icon('upload', 15)}Import Music</button>
                <button class="pill-btn secondary" data-nav="/search">${icon('search', 15)}Find Albums</button>`,
    }));
    return;
  }
  albums.forEach((album) => {
    viewState.localAlbums[album.id] = album.tracks;
  });
  const html = pageHead('Albums', `${plural(albums.length, 'album')} in your library.`, libraryActions())
    + `<div class="result-grid">
      ${albums.map((album) => card(album, album.id.startsWith('it-album-') ? 'album' : 'local-album', {
        subtitle: `${album.artist}${album.trackCount ? ` · ${plural(album.trackCount, 'song')}` : ''}`,
        badge: album.source === 'local' ? 'Local' : '',
      })).join('')}
    </div>`;
  setMain(html);
}

export async function renderLibraryArtists(alive) {
  const artists = groupLibraryArtists();
  setHeader('Library', 'Artists');
  if (!artists.length) {
    setMain(pageHead('Artists', 'Artists in your library.', libraryActions()) + emptyState({
      iconName: 'artists',
      title: 'No artists yet',
      description: 'Save music and the artists behind it will show up here.',
      actions: `<button class="pill-btn" data-nav="/search">${icon('search', 15)}Search Catalog</button>
                <button class="pill-btn secondary" data-act="open-add-music">${icon('upload', 15)}Import Music</button>`,
    }));
    return;
  }
  artists.forEach((artist) => {
    viewState.localArtists[artist.id] = artist;
  });
  const html = pageHead('Artists', `${plural(artists.length, 'artist')} in your library.`, libraryActions())
    + `<div class="result-grid artist-grid">
      ${artists.map((artist) => card(artist, artist.id.startsWith('it-artist-') ? 'artist' : 'local-artist', {
        round: true,
        subtitle: artist.genre || `${plural(artist.tracks.length, 'song')}`,
      })).join('')}
    </div>`;
  setMain(html);
}

export async function renderLibraryDownloaded(alive) {
  const tracks = store.allLibraryTracks().filter((track) => track.source === 'local' || track.offline);
  setHeader('Library', 'Downloaded');
  if (!tracks.length) {
    setMain(pageHead('Downloaded', 'Local files and saved previews.', libraryActions()) + emptyState({
      iconName: 'download',
      title: 'Nothing downloaded',
      description: 'Import files from this computer, or save a free preview for offline listening from any track menu.',
      actions: `<button class="pill-btn" data-act="open-add-music">${icon('upload', 15)}Import Music</button>
                <button class="pill-btn secondary" data-nav="/search">${icon('search', 15)}Search Catalog</button>`,
    }));
    return;
  }
  const context = { type: 'downloaded', title: 'Downloaded' };
  const html = pageHead('Downloaded', `${plural(tracks.length, 'track')} available offline.`, libraryActions())
    + trackTable(tracks, { listKey: 'downloaded-tracks', context });
  setMain(html);
}

export async function renderLibraryLiked(alive) {
  const tracks = store.likesTracks();
  setHeader('Library', 'Loved');
  if (!tracks.length) {
    setMain(pageHead('Loved', 'Songs you have loved.') + emptyState({
      iconName: 'heart',
      title: 'No loved songs yet',
      description: 'Tap the heart on any song to keep it here.',
      actions: `<button class="pill-btn" data-nav="/listen">${icon('listen', 15)}Listen Now</button>
                <button class="pill-btn secondary" data-nav="/search">${icon('search', 15)}Find Music</button>`,
    }));
    return;
  }
  const html = pageHead('Loved', `${plural(tracks.length, 'song')} · ${totalDuration(tracks)}`, `<button class="pill-btn" data-act="play-list" data-list="liked-library">${icon('play', 15)}Play</button>`)
    + trackTable(tracks, { listKey: 'liked-library', context: { type: 'liked', title: 'Loved' } });
  setMain(html);
}

export async function renderLibraryMade(alive) {
  setHeader('Library', 'Made for You');
  const recent = store.recentTracks(30);
  const liked = store.likesTracks();
  const stats = store.libraryStats();
  let html = pageHead('Made for You', 'Mixes based on the free catalog and your listening.');
  html += `<div class="result-grid mix-grid">
    ${api.mixes.map((mix) => card(mix, 'mix', { subtitle: mix.subtitle })).join('')}
  </div>`;
  if (recent.length) {
    html += shelf('Heavy Rotation', recent, 'track', {
      listKey: 'made-recent',
      context: { type: 'recent', title: 'Heavy Rotation' },
    });
  }
  if (liked.length) {
    html += shelf('Because You Loved', liked.slice(0, 12), 'track', {
      listKey: 'made-liked',
      context: { type: 'liked', title: 'Because You Loved' },
    });
  }
  html += `<div class="library-summary">
    <div><strong>${stats.tracks}</strong><span>Tracks</span></div>
    <div><strong>${stats.albums}</strong><span>Albums</span></div>
    <div><strong>${stats.artists}</strong><span>Artists</span></div>
    <div><strong>${stats.liked}</strong><span>Loved</span></div>
    <div><strong>${stats.playlists}</strong><span>Playlists</span></div>
  </div>`;
  setMain(html);
}

