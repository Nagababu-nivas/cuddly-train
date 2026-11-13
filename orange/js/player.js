/*
 * Audio engine: queue, previews, local files, live radio, EQ, media keys.
 * Catalog tracks use Apple's free 30-second previews; local files and public
 * radio streams never require an account or subscription.
 */

import { bus, clamp, formatTime, shuffleArray, sleep } from './util.js?v=orange3';
import { store } from './store.js?v=orange3';
import { db } from './db.js?v=orange3';
import { lookup } from './api.js?v=orange3';

const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Acoustic: [3, 2, 1, 1, 0, 1, 2, 2, 3, 2],
  'Bass Boost': [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  Classical: [3, 2, 1, 0, 0, 0, -1, -2, -2, -3],
  Electronic: [5, 4, 2, 0, -1, 1, 2, 3, 4, 5],
  'Hip-Hop': [6, 5, 3, 1, 0, 0, 1, 2, 3, 2],
  Jazz: [4, 3, 2, 1, 0, 0, 0, 1, 2, 3],
  Pop: [-1, 0, 1, 2, 3, 3, 2, 1, 0, -1],
  Rock: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

function audiusDebugEnabled() {
  try {
    return Boolean(window.ORANGE_AUDIUS_DEBUG)
      || new URLSearchParams(window.location.search).has('audiusDebug');
  } catch {
    return false;
  }
}

class AudioEngine {
  constructor() {
    this.audio = null;
    this.radioAudio = null;
    this.graph = null;
    this.queue = [];
    this.index = -1;
    this.current = null;
    this.live = false;
    this.liveStation = null;
    this.shuffle = false;
    this.repeat = 'off';
    this.volume = 0.8;
    this.muted = false;
    this.context = null;
    this.loadToken = 0;
    this.playRecorded = false;
    this.failed = new Set();
    this.preShuffleQueue = null;
    this.crossfadeArmed = false;
    this.sleepTimer = 0;
    this.sleepAt = 0;
    this.objectUrls = new Map();
    this.lastUiTime = 0;
    this.transitioning = false;
    this.usingLocalMatch = false;
    this.localMatchTrack = null;
    this.audiusFallbackTried = false;
    this.audiusPreviewWarned = false;
    this.lastAudiusDebugTime = 0;
  }

  init() {
    if (this.audio) return this;
    this.audio = document.getElementById('audio-local');
    this.radioAudio = new Audio();
    this.radioAudio.preload = 'none';
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    const settings = store.getSettings();
    this.volume = clamp(Number(settings.volume ?? 0.8), 0, 1);
    this.muted = Boolean(settings.muted);
    this.repeat = store.getQueueState().repeat || 'off';
    this.shuffle = Boolean(store.getQueueState().shuffle);
    this.applyVolume();
    this.bindAudio();
    this.bindMediaSession();
    this.restoreQueue(settings);
    this.applyEq(true);
    bus.emit('player:ready', this.getState());
    return this;
  }

  bindAudio() {
    const audio = this.audio;
    audio.addEventListener('play', () => {
      this.emitState();
      this.updateMediaSessionState();
    });
    audio.addEventListener('pause', () => {
      this.emitState();
      this.updateMediaSessionState();
      this.setPositionState();
    });
    audio.addEventListener('loadedmetadata', () => {
      this.debugAudius('loadedmetadata');
      this.checkAudiusDuration();
      bus.emit('player:time', this.getTimeState());
      this.setPositionState();
    });
    audio.addEventListener('durationchange', () => {
      this.debugAudius('durationchange');
      this.checkAudiusDuration();
      bus.emit('player:time', this.getTimeState());
    });
    audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    audio.addEventListener('progress', () => {
      bus.emit('player:buffered', this.getTimeState());
    });
    audio.addEventListener('ended', () => {
      this.debugAudius('ended');
      this.onEnded();
    });
    audio.addEventListener('waiting', () => {
      this.debugAudius('waiting');
      bus.emit('player:buffering', true);
    });
    audio.addEventListener('playing', () => {
      this.debugAudius('playing');
      bus.emit('player:buffering', false);
    });
    audio.addEventListener('canplay', () => bus.emit('player:buffering', false));
    audio.addEventListener('error', () => this.onError());
    this.radioAudio.addEventListener('playing', () => {
      this.emitState();
      bus.emit('player:buffering', false);
    });
    this.radioAudio.addEventListener('pause', () => this.emitState());
    this.radioAudio.addEventListener('error', () => {
      if (!this.live) return;
      bus.emit('toast', { message: 'This live station is unavailable right now.', icon: 'wifi-off' });
      this.live = false;
      this.emitState();
    });
    this.radioAudio.addEventListener('waiting', () => bus.emit('player:buffering', true));
    this.radioAudio.addEventListener('canplay', () => bus.emit('player:buffering', false));
  }

  debugAudius(event, extra = {}) {
    if (!audiusDebugEnabled()) return;
    const track = this.current;
    if (!track || track.source !== 'audius') return;
    if (event === 'timeupdate') {
      const now = performance.now();
      if (now - this.lastAudiusDebugTime < 5_000) return;
      this.lastAudiusDebugTime = now;
    }
    const audio = this.audio;
    const error = audio?.error;
    console.info('[orange:audius]', event, {
      title: track.title,
      artist: track.artist,
      id: track.id,
      source: track.source,
      provider: track.provider,
      streamUrl: track.streamUrl,
      fallbackUrl: track.streamFallbackUrl,
      currentSrc: audio?.currentSrc || '',
      duration: audio?.duration,
      apiDuration: track.duration,
      currentTime: audio?.currentTime,
      error: error ? { code: error.code, message: error.message } : null,
      networkState: audio?.networkState,
      readyState: audio?.readyState,
      paused: audio?.paused,
      queueIndex: this.index,
      queueLength: this.queue.length,
      ...extra,
    });
  }

  /* Detect the case where Audius reports a full-length track but the stream
     endpoint hands back a 30-second preview. Try the other discovery host
     once, then tell the listener instead of pretending it is a full track. */
  checkAudiusDuration() {
    const audio = this.audio;
    const track = this.current;
    if (!audio || !track || track.source !== 'audius') return;
    const apiDuration = Number(track.duration) || 0;
    const mediaDuration = Number(audio.duration) || 0;
    if (apiDuration <= 60 || mediaDuration <= 0 || mediaDuration > 35) return;
    this.debugAudius('duration-mismatch', { apiDuration, mediaDuration });
    if (!this.audiusFallbackTried && track.streamFallbackUrl) {
      this.audiusFallbackTried = true;
      this.audio.src = track.streamFallbackUrl;
      this.audio.load();
      this.audio.play().catch(() => {});
      return;
    }
    if (!this.audiusPreviewWarned) {
      this.audiusPreviewWarned = true;
      bus.emit('toast', {
        message: 'Audius returned only a 30-second preview for this track.',
        icon: 'alert',
        tone: 'error',
        duration: 4_000,
      });
    }
  }

  restoreQueue(settings) {
    const saved = store.getQueueState();
    const tracks = saved.ids.map((id) => store.trackById(id)).filter(Boolean);
    this.queue = tracks;
    this.index = tracks.length ? clamp(saved.index, 0, tracks.length - 1) : -1;
    this.current = this.index >= 0 ? tracks[this.index] : null;
    this.context = saved.context || null;
    if (this.current) {
      bus.emit('player:track', this.current);
      bus.emit('player:time', this.getTimeState());
    }
  }

  bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const safe = (action, handler) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    safe('play', () => this.toggle());
    safe('pause', () => this.toggle());
    safe('previoustrack', () => this.previous());
    safe('nexttrack', () => this.next());
    safe('seekbackward', () => this.seekBy(-10));
    safe('seekforward', () => this.seekBy(10));
    safe('seekto', (details) => {
      if (Number.isFinite(details.seekTime)) this.seek(details.seekTime);
    });
  }

  updateMediaSessionState() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = this.isPlaying() ? 'playing' : 'paused';
  }

  setMediaMetadata() {
    if (!('mediaSession' in navigator) || !this.current) return;
    try {
      const artwork = this.current.artwork || this.current.artworkUrl;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.current.title || (this.live ? 'Live Radio' : 'Unknown Title'),
        artist: this.current.artist || 'Orange',
        album: this.current.album || '',
        artwork: artwork ? [
          { src: artwork, sizes: '300x300', type: 'image/jpeg' },
          { src: artwork, sizes: '600x600', type: 'image/jpeg' },
        ] : [],
      });
    } catch {
      /* ignore */
    }
  }

  setPositionState() {
    if (!('mediaSession' in navigator) || this.live) return;
    const audio = this.audio;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration),
      });
    } catch {
      /* ignore */
    }
  }

  onTimeUpdate() {
    const now = performance.now();
    if (now - this.lastUiTime > 140) {
      this.lastUiTime = now;
      this.setPositionState();
      bus.emit('player:time', this.getTimeState());
    }
    this.debugAudius('timeupdate');
    if (!this.live && this.audio && Number.isFinite(this.audio.duration)) {
      const settings = store.getSettings();
      const crossfade = settings.crossfadeOn ? clamp(Number(settings.crossfade) || 0, 0, 12) : 0;
      const remaining = this.audio.duration - this.audio.currentTime;
      if (crossfade > 0.5 && !this.crossfadeArmed && this.audio.duration > crossfade
        && remaining <= crossfade && remaining > 0.15 && this.hasNext()) {
        this.crossfadeArmed = true;
        this.next({ auto: true, crossfade: true });
      }
    }
  }

  hasNext() {
    if (!this.queue.length) return false;
    if (this.repeat === 'all') return true;
    return this.index + 1 < this.queue.length;
  }

  async playTracks(tracks, startIndex = 0, context = null) {
    const list = (tracks || []).filter((track) => track && (
      track.preview
      || track.source === 'local'
      || track.source === 'audius'
      || track.streamUrl
      || track.audioKey
      || track.offline
      || track.trackId
    ));
    if (!list.length) {
      bus.emit('toast', { message: 'There is nothing playable in this list.', icon: 'music' });
      return;
    }
    let ordered = list.slice();
    let start = clamp(Number(startIndex) || 0, 0, ordered.length - 1);
    if (this.shuffle) {
      const selected = ordered[start];
      ordered = [selected, ...shuffleArray(ordered.filter((track, index) => index !== start))];
      start = 0;
    }
    this.queue = ordered;
    this.index = start;
    this.context = context;
    this.live = false;
    this.liveStation = null;
    this.crossfadeArmed = false;
    this.failed.clear();
    this.saveQueue();
    bus.emit('player:queue', { queue: this.queue, index: this.index });
    await this.playIndex(start);
  }

  async playIndex(indexInt, { auto = false, crossfade = false } = {}) {
    if (!this.audio) this.init();
    if (indexInt < 0 || indexInt >= this.queue.length) {
      this.stop();
      return;
    }
    const token = ++this.loadToken;
    this.index = indexInt;
    this.current = this.queue[indexInt];
    this.saveQueue();
    bus.emit('player:queue', { queue: this.queue, index: this.index });
    this.playRecorded = false;
    this.crossfadeArmed = false;
    this.audiusFallbackTried = false;
    this.audiusPreviewWarned = false;
    this.lastAudiusDebugTime = 0;
    this.live = false;
    this.liveStation = null;
    this.transitioning = Boolean(crossfade);
    this.radioAudio.pause();
    this.emitTrack();
    bus.emit('player:state', this.getState());
    const settings = store.getSettings();
    const fadeMs = settings.crossfadeOn ? clamp((Number(settings.crossfade) || 0) * 1000, 300, 9_000) : 120;
    if (crossfade && settings.crossfadeOn) {
      this.fadeTo(0, Math.max(180, fadeMs / 2));
      await sleep(Math.max(160, fadeMs / 3));
      if (token !== this.loadToken) return;
    }
    let source;
    try {
      source = await this.resolveSource(this.current);
    } catch (error) {
      if (token !== this.loadToken) return;
      this.handleTrackError(this.current, error);
      return;
    }
    if (token !== this.loadToken) return;
    if (!source) {
      this.handleTrackError(this.current, new Error('No playable source was found.'));
      return;
    }
    this.ensureGraph();
    if (this.graph?.ctx.state === 'suspended') {
      try {
        await this.graph.ctx.resume();
      } catch {
        /* browser will retry on the next gesture */
      }
    }
    this.audio.pause();
    this.audio.src = source;
    this.audio.load();
    this.debugAudius('start', { requestedSource: source });
    this.applyVolume();
    if (this.graph) {
      this.graph.gain.gain.cancelScheduledValues(this.graph.ctx.currentTime);
      this.graph.gain.gain.setValueAtTime(0, this.graph.ctx.currentTime);
    }
    try {
      await this.audio.play();
      if (token !== this.loadToken) return;
      this.transitioning = false;
      this.fadeTo(this.effectiveVolume(), settings.crossfadeOn ? fadeMs : 160);
      this.setMediaMetadata();
      this.setPositionState();
      if (!this.playRecorded) {
        this.playRecorded = true;
        store.recordPlay(this.current);
      }
      this.emitTrack();
      this.emitState();
      bus.emit('player:time', this.getTimeState());
      this.debugAudius('play-resolved');
    } catch (error) {
      this.transitioning = false;
      if (token !== this.loadToken) return;
      if (error?.name === 'NotAllowedError') {
        bus.emit('toast', { message: 'Press play to start audio in this browser.', icon: 'play' });
      } else {
        this.handleTrackError(this.current, error);
      }
      this.emitState();
    }
  }

  async resolveSource(track) {
    if (!track) throw new Error('No track selected.');
    this.usingLocalMatch = false;
    this.localMatchTrack = null;
    if (track.audioKey && (track.source === 'local' || track.offline)) {
      const key = track.audioKey;
      if (this.objectUrls.has(key)) return this.objectUrls.get(key);
      const blob = await db.getAudio(key);
      if (!blob) throw new Error('The downloaded audio is no longer available.');
      const url = URL.createObjectURL(blob);
      this.objectUrls.set(key, url);
      return url;
    }
    if (track.source !== 'local' && store.getSettings().preferLocal !== false) {
      const match = store.localMatch(track);
      if (match?.audioKey) {
        const key = match.audioKey;
        let url = this.objectUrls.get(key);
        if (!url) {
          const blob = await db.getAudio(key);
          if (blob) {
            url = URL.createObjectURL(blob);
            this.objectUrls.set(key, url);
          }
        }
        if (url) {
          this.usingLocalMatch = true;
          this.localMatchTrack = match;
          return url;
        }
      }
    }
    if (track.source === 'audius') {
      if (track.streamUrl) return track.streamUrl;
      throw new Error('This Audius track does not expose a playable stream.');
    }
    if (track.preview) return track.preview;
    if (track.source === 'local') {
      const key = `audio-${track.id}`;
      if (this.objectUrls.has(key)) return this.objectUrls.get(key);
      const blob = await db.getAudio(key);
      if (!blob) throw new Error('The local audio file is no longer available.');
      const url = URL.createObjectURL(blob);
      this.objectUrls.set(key, url);
      return url;
    }
    if (track.trackId) {
      try {
        const result = await lookup(String(track.trackId), { limit: 5 });
        const full = result.tracks[0];
        if (full?.preview) {
          Object.assign(track, full);
          store.rememberTrack({ ...track, preview: full.preview });
          return full.preview;
        }
      } catch {
        /* fall through */
      }
    }
    throw new Error('This track does not have a free preview.');
  }

  onEnded() {
    if (this.live || this.transitioning || this.crossfadeArmed) return;
    this.next({ auto: true });
  }

  onError() {
    if (this.live || !this.audio?.src) return;
    const error = this.audio.error;
    if (!error || error.code === 1) return;
    this.debugAudius('error', { errorCode: error.code, errorMessage: error.message });
    // A transient network failure on the primary discovery host should not
    // skip the listener to the next song: retry the other host once.
    if (this.current?.source === 'audius' && !this.audiusFallbackTried
      && (error.code === 2 || error.code === 3) && this.current.streamFallbackUrl) {
      this.audiusFallbackTried = true;
      this.audio.src = this.current.streamFallbackUrl;
      this.audio.load();
      this.audio.play().catch((retryError) => {
        this.handleTrackError(this.current, retryError);
      });
      return;
    }
    const messages = {
      2: 'The audio source could not be reached.',
      3: 'The audio could not be decoded by this browser.',
      4: 'The audio format is not supported by this browser.',
    };
    this.handleTrackError(this.current, new Error(messages[error.code] || 'Playback failed.'));
  }

  handleTrackError(track, error) {
    const name = track?.title || 'This track';
    this.failed.add(track?.id);
    this.debugAudius('track-error', { message: error?.message || '' });
    bus.emit('toast', {
      message: `${name} could not be played. ${error?.message || ''}`.trim(),
      icon: 'alert',
      tone: 'error',
    });
    if (this.failed.size < this.queue.length && this.queue.length > 1) {
      window.setTimeout(() => {
        if (this.current?.id === track?.id) this.next({ auto: true });
      }, 700);
    } else {
      this.stop();
    }
  }

  stop({ keepTrack = true } = {}) {
    this.loadToken += 1;
    this.audio?.pause();
    this.radioAudio?.pause();
    this.live = false;
    this.liveStation = null;
    if (!keepTrack) {
      this.current = null;
      this.index = -1;
      this.queue = [];
      bus.emit('player:track', null);
      bus.emit('player:queue', { queue: [], index: -1 });
      this.saveQueue();
    }
    this.emitState();
  }

  toggle() {
    if (!this.audio) this.init();
    if (this.live) {
      if (this.radioAudio.paused) {
        this.radioAudio.volume = this.effectiveVolume();
        this.radioAudio.play().catch(() => {
          bus.emit('toast', { message: 'The live stream could not start.', icon: 'wifi-off' });
        });
      } else {
        this.radioAudio.pause();
      }
      return;
    }
    if (!this.current && this.queue.length) {
      this.playIndex(this.index >= 0 ? this.index : 0);
      return;
    }
    if (!this.current) {
      const fallback = store.recentTracks(1)[0] || store.allLibraryTracks()[0];
      if (fallback) this.playTracks([fallback], 0, { type: 'library' });
      else bus.emit('toast', { message: 'Choose a song, album or station to begin.', icon: 'music' });
      return;
    }
    if (this.audio.paused) {
      if (!this.audio.src) {
        this.playIndex(this.index);
      } else {
        this.fadeTo(this.effectiveVolume(), 180);
        this.audio.play().catch((error) => {
          if (error?.name === 'NotAllowedError') {
            bus.emit('toast', { message: 'Press play to start audio in this browser.', icon: 'play' });
          }
        });
      }
    } else {
      this.audio.pause();
      this.fadeTo(0, 120);
    }
  }

  next({ auto = false, crossfade = false } = {}) {
    if (this.live) {
      bus.emit('toast', { message: 'Live radio has no next track.', icon: 'radio' });
      return;
    }
    if (!this.queue.length) {
      this.stop();
      return;
    }
    if (auto && this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    if (this.index + 1 < this.queue.length) {
      this.playIndex(this.index + 1, { auto, crossfade });
      return;
    }
    if (this.repeat === 'all') {
      this.playIndex(0, { auto, crossfade });
      return;
    }
    if (!auto) {
      this.audio.currentTime = 0;
      this.audio.pause();
      this.emitState();
    } else {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.emitState();
      bus.emit('player:queue-end', { context: this.context, queue: this.queue });
    }
  }

  previous() {
    if (this.live) {
      bus.emit('toast', { message: 'Live radio has no previous track.', icon: 'radio' });
      return;
    }
    if (this.audio && this.audio.currentTime > 4) {
      this.audio.currentTime = 0;
      this.emitTime();
      return;
    }
    if (this.index > 0) this.playIndex(this.index - 1);
    else if (this.repeat === 'all' && this.queue.length) this.playIndex(this.queue.length - 1);
    else if (this.audio) {
      this.audio.currentTime = 0;
      this.emitTime();
    }
  }

  seek(seconds) {
    if (!this.audio || this.live || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = clamp(seconds, 0, this.audio.duration);
    this.emitTime();
  }

  seekFraction(fraction) {
    if (!this.audio || this.live || !Number.isFinite(this.audio.duration)) return;
    this.seek(Number(fraction) * this.audio.duration);
  }

  seekBy(delta) {
    if (!this.audio || this.live) return;
    this.seek(this.audio.currentTime + delta);
  }

  jumpTo(index) {
    if (index >= 0 && index < this.queue.length) this.playIndex(index);
  }

  async playStream(station) {
    if (!station?.stream) return;
    this.loadToken += 1;
    this.audio?.pause();
    this.ensureGraph();
    this.live = true;
    this.liveStation = station;
    this.queue = [];
    this.index = -1;
    this.current = {
      id: station.id,
      title: station.name,
      artist: station.live ? 'Live radio' : 'Preview station',
      album: station.subtitle || '',
      artwork: '',
      source: 'radio',
      isLive: true,
      stream: station.stream,
      live: station.live,
      subtitle: station.subtitle,
    };
    this.playRecorded = true;
    this.radioAudio.src = station.stream;
    this.radioAudio.volume = this.effectiveVolume();
    this.radioAudio.load();
    this.emitTrack();
    bus.emit('player:queue', { queue: [], index: -1 });
    this.setMediaMetadata();
    try {
      await this.radioAudio.play();
      bus.emit('player:state', this.getState());
    } catch (error) {
      this.live = false;
      bus.emit('toast', {
        message: error?.name === 'NotAllowedError' ? 'Press play to start the live stream.' : 'The live stream could not start.',
        icon: 'radio',
      });
      this.emitState();
    }
  }

  addToQueue(tracks, { next = false } = {}) {
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((track) => track?.id);
    if (!list.length) return;
    if (this.live) {
      bus.emit('toast', { message: 'Stop live radio before building a queue.', icon: 'radio' });
      return;
    }
    if (!this.queue.length) {
      this.playTracks(list, 0, this.context);
      return;
    }
    if (next) {
      this.queue.splice(this.index + 1, 0, ...list);
      bus.emit('toast', { message: list.length === 1 ? 'Playing next' : `${list.length} tracks queued next`, icon: 'queue' });
    } else {
      this.queue.push(...list);
      bus.emit('toast', { message: list.length === 1 ? 'Added to queue' : `${list.length} tracks added to queue`, icon: 'queue' });
    }
    this.saveQueue();
    bus.emit('player:queue', { queue: this.queue, index: this.index });
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length || this.live) return;
    const removingCurrent = index === this.index;
    this.queue.splice(index, 1);
    if (index < this.index) this.index -= 1;
    if (removingCurrent) {
      if (!this.queue.length) {
        this.stop({ keepTrack: false });
      } else {
        this.index = clamp(this.index, 0, this.queue.length - 1);
        this.playIndex(this.index);
      }
    }
    this.saveQueue();
    bus.emit('player:queue', { queue: this.queue, index: this.index });
  }

  clearQueue({ keepCurrent = true } = {}) {
    if (this.live) return;
    if (keepCurrent && this.current) {
      this.queue = [this.current];
      this.index = 0;
    } else {
      this.queue = [];
      this.index = -1;
      this.stop();
    }
    this.saveQueue();
    bus.emit('player:queue', { queue: this.queue, index: this.index });
  }

  appendTracks(tracks) {
    if (this.live || !Array.isArray(tracks) || !tracks.length) return;
    this.queue.push(...tracks);
    this.saveQueue();
    bus.emit('player:queue', { queue: this.queue, index: this.index });
  }

  toggleShuffle(force) {
    const next = typeof force === 'boolean' ? force : !this.shuffle;
    if (next === this.shuffle) return this.shuffle;
    if (next) {
      this.preShuffleQueue = this.queue.slice();
      if (this.queue.length > 1) {
        const current = this.current;
        const rest = this.queue.filter((track) => track.id !== current?.id);
        this.queue = current ? [current, ...shuffleArray(rest)] : shuffleArray(this.queue);
        this.index = current ? 0 : 0;
        if (current) this.current = this.queue[0];
      }
    } else if (this.preShuffleQueue?.length) {
      const currentId = this.current?.id;
      this.queue = this.preShuffleQueue.slice();
      const index = this.queue.findIndex((track) => track.id === currentId);
      this.index = index >= 0 ? index : 0;
      this.preShuffleQueue = null;
    }
    this.shuffle = next;
    this.crossfadeArmed = false;
    this.saveQueue();
    bus.emit('player:queue', { queue: this.queue, index: this.index });
    bus.emit('player:mode', { shuffle: this.shuffle, repeat: this.repeat });
    return this.shuffle;
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.saveQueue();
    bus.emit('player:mode', { shuffle: this.shuffle, repeat: this.repeat });
    bus.emit('toast', {
      message: this.repeat === 'off' ? 'Repeat off' : this.repeat === 'all' ? 'Repeat all' : 'Repeat one',
      icon: 'repeat',
      duration: 1400,
    });
    return this.repeat;
  }

  setRepeat(mode) {
    if (!['off', 'all', 'one'].includes(mode)) return;
    this.repeat = mode;
    this.saveQueue();
    bus.emit('player:mode', { shuffle: this.shuffle, repeat: this.repeat });
  }

  setVolume(value, { persist = true } = {}) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.volume > 0) this.muted = false;
    this.applyVolume();
    if (persist) store.updateSettings({ volume: this.volume, muted: this.muted });
    bus.emit('player:volume', { volume: this.volume, muted: this.muted });
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
    store.updateSettings({ muted: this.muted, volume: this.volume });
    bus.emit('player:volume', { volume: this.volume, muted: this.muted });
    return this.muted;
  }

  effectiveVolume() {
    return this.muted ? 0 : this.volume;
  }

  applyVolume() {
    if (this.audio) this.audio.volume = this.graph ? 1 : this.effectiveVolume();
    if (this.radioAudio) this.radioAudio.volume = this.effectiveVolume();
    if (this.graph?.gain) {
      const now = this.graph.ctx.currentTime;
      this.graph.gain.gain.cancelScheduledValues(now);
      this.graph.gain.gain.setValueAtTime(this.effectiveVolume(), now);
    }
  }

  ensureGraph() {
    if (this.graph) return this.graph;
    if (!this.audio) return null;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    try {
      const ctx = new Context();
      const source = ctx.createMediaElementSource(this.audio);
      const gain = ctx.createGain();
      const filters = EQ_FREQUENCIES.map((frequency) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1.1;
        filter.gain.value = 0;
        return filter;
      });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(gain);
      let node = gain;
      filters.forEach((filter) => {
        node.connect(filter);
        node = filter;
      });
      node.connect(analyser);
      analyser.connect(ctx.destination);
      gain.gain.value = this.effectiveVolume();
      this.graph = { ctx, source, gain, filters, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
      this.applyEq(true);
      return this.graph;
    } catch (error) {
      console.warn('[orange] WebAudio unavailable', error);
      return null;
    }
  }

  fadeTo(value, ms = 160) {
    if (!this.graph) {
      if (this.audio) this.audio.volume = clamp(value, 0, 1);
      return;
    }
    const now = this.graph.ctx.currentTime;
    const gain = this.graph.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(clamp(value, 0, 1), now + Math.max(0.02, ms / 1000));
  }

  applyEq(force = false) {
    const settings = store.getSettings();
    if (!this.graph) return;
    const values = settings.eqEnabled ? settings.eq : EQ_PRESETS.Flat;
    this.graph.filters.forEach((filter, index) => {
      filter.gain.value = Number(values[index]) || 0;
    });
    if (force) bus.emit('player:eq', { eq: values, enabled: settings.eqEnabled });
  }

  setEqEnabled(enabled) {
    store.updateSettings({ eqEnabled: Boolean(enabled) });
    this.applyEq(true);
  }

  setEqGain(index, value) {
    const settings = store.getSettings();
    const eq = settings.eq.slice();
    eq[index] = clamp(Number(value) || 0, -12, 12);
    store.updateSettings({ eq, eqPreset: 'Custom', eqEnabled: true });
    this.applyEq(true);
  }

  setEqPreset(name) {
    const preset = EQ_PRESETS[name] || EQ_PRESETS.Flat;
    store.updateSettings({ eq: preset.slice(), eqPreset: name, eqEnabled: name !== 'Flat' });
    this.applyEq(true);
    bus.emit('toast', { message: `Equalizer: ${name}`, icon: 'sliders', duration: 1500 });
  }

  getAnalyserData() {
    if (!this.graph) return null;
    this.graph.analyser.getByteFrequencyData(this.graph.data);
    return this.graph.data;
  }

  getAudioContext() {
    return this.graph?.ctx || null;
  }

  setSleepTimer(minutes) {
    window.clearTimeout(this.sleepTimer);
    if (!minutes) {
      this.sleepAt = 0;
      bus.emit('player:sleep', { at: 0 });
      return;
    }
    this.sleepAt = Date.now() + minutes * 60_000;
    this.sleepTimer = window.setTimeout(() => {
      this.audio?.pause();
      this.radioAudio?.pause();
      this.sleepAt = 0;
      bus.emit('player:sleep', { at: 0, finished: true });
      bus.emit('toast', { message: 'Sleep timer finished. Playback paused.', icon: 'moon', duration: 3500 });
    }, minutes * 60_000);
    bus.emit('player:sleep', { at: this.sleepAt });
  }

  saveQueue() {
    if (this.live) return;
    // Queue state persists only IDs, so keep the full track snapshots in the
    // track cache. Without this, Audius results (which are not saved to the
    // library) disappear from the queue after a reload.
    if (this.queue.length) store.rememberTracks(this.queue);
    store.saveQueue({
      ids: this.queue.map((track) => track.id),
      index: this.index,
      shuffle: this.shuffle,
      repeat: this.repeat,
      context: this.context,
    });
  }

  emitTrack() {
    bus.emit('player:track', this.current);
    bus.emit('player:sleep', { at: this.sleepAt });
    this.emitState();
  }

  emitState() {
    bus.emit('player:state', this.getState());
  }

  emitTime() {
    bus.emit('player:time', this.getTimeState());
  }

  getTimeState() {
    const audio = this.audio;
    const duration = !this.live && audio && Number.isFinite(audio.duration) ? audio.duration : 0;
    const currentTime = !this.live && audio ? audio.currentTime || 0 : 0;
    return {
      currentTime,
      duration,
      progress: duration > 0 ? currentTime / duration : 0,
      buffered: audio?.buffered?.length ? audio.buffered.end(audio.buffered.length - 1) : 0,
      live: this.live,
      playing: this.isPlaying(),
    };
  }

  isPlaying() {
    return this.live ? Boolean(this.radioAudio && !this.radioAudio.paused) : Boolean(this.audio && !this.audio.paused);
  }

  getState() {
    const time = this.getTimeState();
    return {
      current: this.current,
      queue: this.queue,
      index: this.index,
      shuffle: this.shuffle,
      repeat: this.repeat,
      live: this.live,
      liveStation: this.liveStation,
      playing: time.playing,
      currentTime: time.currentTime,
      duration: time.duration,
      progress: time.progress,
      volume: this.volume,
      muted: this.muted,
      context: this.context,
      sleepAt: this.sleepAt,
    };
  }

  getQueue() {
    return this.queue;
  }

  getCurrent() {
    return this.current;
  }

  destroyObjectUrls() {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
  }
}

export const player = new AudioEngine();
export { EQ_FREQUENCIES, EQ_PRESETS, formatTime };
