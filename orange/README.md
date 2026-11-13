# Orange

Orange is a local-first desktop-style music app inspired by modern music players.
It is a static web app: no account, no subscription, and no server-side storage.

## Run Orange

### Windows

Double-click `Orange.cmd`, then open <http://127.0.0.1:5173/> if your browser does
not open automatically.

### Any platform with Python 3

```bash
python serve.py
```

Then visit <http://127.0.0.1:5173/>.

Any static file server works. `serve.py` only disables browser caching so edits
show up on the next reload; it does not proxy or store anything.

## Deploy on Netlify

Orange is a build-free static site. There is no npm install, no build command and
no server component. Netlify should publish the folder that contains
`index.html`:

- If the Git repository root contains this `orange` folder, use the included
  root `netlify.toml` (`publish = "orange"`).
- If this `orange` folder is the repository root, use `orange/netlify.toml`
  (`publish = "."`).
- For a drag-and-drop deploy, drop the `orange` folder on
  <https://app.netlify.com/drop>.

The site uses hash routes (`#/listen`, `#/album/...`), so no SPA fallback or
server rewrite is required and refreshing any page works. Security and CSP
headers are defined in `orange/_headers`; they allow only the public APIs Orange
already uses (iTunes, LRCLIB and Audius) while keeping scripts local.

After the first import, every push to the connected Git branch triggers a new
Netlify deploy. Use a custom domain in Netlify if you do not want the generated
`*.netlify.app` URL.

Hosting is still local-first: imported files stay in the browser's IndexedDB on
that device and metadata/settings stay in that browser's `localStorage`. Data
does not sync between devices or browsers, and clearing site data removes the
local library. HTTPS is provided by Netlify and is required for clipboard,
Media Session and file-picker features on some browsers.

## What works

- **Listen, Browse, Radio, Search, Genres, Albums, Artists, Playlists, Library**
- **Catalog playback** through Apple's public iTunes Search API and licensed
  30-second preview clips.
- **Audius full tracks** through Audius's public API. Search results appear in a
  dedicated **Audius** tab and as an “Audius · Full tracks” section. Tracks are
  streamed in full when the artist has made them streamable; queue, shuffle,
  repeat, seek, pause, resume and next/previous all work normally.
- **Full-length local playback** for files you own. Import MP3, M4A, AAC, FLAC,
  WAV, Ogg or Opus from `Add Music`. Tags and embedded artwork are read locally.
- **Prefer local files**: when an imported file matches a catalog song by title
  and artist, Orange plays your full-length copy instead of the preview. Toggle
  this under Settings → Playback.
- **Synchronized lyrics** from LRCLIB when a time-synced version exists. The
  current line is highlighted using the audio element's own playback time, and
  clicking a line seeks to it. This works for local files, Audius streams and
  previews. Tracks without synced lyrics show plain lyrics with a clear note.
- **Downloads**: use the download button in the player, a track row, or a track
  menu. Progress, completion and failure are shown in a toast. Downloaded
  previews appear under Library → Downloaded and can be removed again.
- **Public live radio** (Radio Paradise) plus continuous catalog preview
  stations.
- Queue, shuffle, repeat, seek, volume, 10-band equalizer, sleep timer,
  crossfade, media keys, light/dark themes and keyboard shortcuts.

## Playback and legal limits

Orange deliberately does **not** bypass DRM, account checks, subscriptions or
paid streaming:

- Downloads apply to Apple previews and imported files. Audius tracks are
  streamed from Audius and are **not** saved offline; their download buttons say
  so. This keeps Orange within each artist's Audius streaming permissions.
- Catalog tracks are **30-second previews** supplied by Apple's public API.
  They may begin at a different point than the original song. That limitation
  is inherent to the preview service and cannot be changed by Orange. Synced
  lyrics for a preview can therefore be out of step; the lyrics panel shows a
  note when this applies.
- Audius full tracks are supplied by the artist and streamed directly from
  Audius. If an artist makes a track private, deletes it or disables streaming,
  Orange filters it out or shows a clear playback error.
- Full-length playback is available for **files you own and import** and for
  **Audius tracks that permit streaming**. Orange copies imported audio into the
  browser's local IndexedDB; the original file is never modified or uploaded.
- Full-length streaming of subscription catalog tracks requires the service
  that hosts them (for example Apple Music) and is not implemented here.
- Live radio is streamed directly from Radio Paradise's public streams.
- Lyrics come from LRCLIB and may be unavailable for some tracks.

## Audius configuration

Audius needs **no account, OAuth token or developer key**. Orange calls the
public API at `https://api.audius.co/v1` (falling back to
`https://discoveryprovider.audius.co/v1`) and identifies itself with
`app_name=OrangeWeb`. Stream URLs are built as
`/v1/tracks/<id>/stream?app_name=OrangeWeb` and redirect to Audius's CDN.

Nothing is proxied through a server. If Audius changes its public API or an
artist removes a track, search or playback for that track may fail; Orange
degrades to the other sources.

## Data and privacy

Metadata and settings live in `localStorage`; audio blobs and artwork live in
IndexedDB. Nothing is uploaded. Clearing site data or using Settings → Reset
Orange removes the local library. An older `cadence.state.v1` library is
migrated automatically the first time Orange starts.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | App shell |
| `css/styles.css` | All styling, responsive layout and themes |
| `js/app.js` | Bootstrap and routing |
| `js/views.js` | Shell, navigation, player chrome, lyrics and dialogs |
| `js/pages.js` | Listen, Browse, Radio, Search, genre and Library pages |
| `js/player.js` | Queue, preview/local/Audius/radio playback, EQ and media session |
| `js/api.js` | iTunes catalog, Audius search, radio stations and LRCLIB lyrics |
| `js/providers/audius.js` | Audius public API, normalisation, caching and stream URLs |
| `js/store.js` | Persistent settings, playlists, likes and downloads |
| `js/db.js` | IndexedDB audio/artwork storage |
| `js/metadata.js` | Local tag and artwork extraction |
| `js/viewkit.js` | Shared cards, track tables and buttons |
| `js/ui.js` | Toasts, modals, menus and theme helpers |
| `js/util.js` | Shared helpers |
| `serve.py` | Small local static server with caching disabled |

## Keyboard shortcuts

`Space` play/pause · `←`/`→` seek · `Ctrl+←`/`Ctrl+→` previous/next ·
`↑`/`↓` volume · `M` mute · `L` love · `S` shuffle · `R` repeat ·
`Q` queue · `/` search · `?` shortcut list.
