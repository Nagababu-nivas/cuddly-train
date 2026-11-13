/*
 * Local audio import and tag extraction.
 * Supports ID3v2 (MP3), MP4/M4A atoms, FLAC Vorbis comments, WAV INFO and
 * Ogg Vorbis/Opus comments. Everything runs in the browser; files never leave
 * the machine.
 */

import { fileExt, hashString, stripExt } from './util.js?v=orange3';

export const SUPPORTED_EXTENSIONS = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'];

const AUDIO_TYPES = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
};

export function isSupportedAudio(file) {
  if (!file) return false;
  const ext = fileExt(file.name);
  return SUPPORTED_EXTENSIONS.includes(ext) || (file.type || '').startsWith('audio/');
}

function clean(value) {
  return String(value || '').replace(/\0/g, '').replace(/\uFEFF/g, '').trim();
}

function decodeLatin1(bytes) {
  try {
    return new TextDecoder('iso-8859-1').decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function decodeTextBytes(bytes, encoding = 3) {
  if (!bytes || !bytes.length) return '';
  let decoder;
  switch (encoding) {
    case 0:
      return decodeLatin1(bytes);
    case 1: {
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) decoder = new TextDecoder('utf-16le');
      else if (bytes[0] === 0xFE && bytes[1] === 0xFF) decoder = new TextDecoder('utf-16be');
      else decoder = new TextDecoder('utf-16le');
      break;
    }
    case 2:
      decoder = new TextDecoder('utf-16be');
      break;
    case 3:
    default:
      decoder = new TextDecoder('utf-8');
      break;
  }
  try {
    return decoder.decode(bytes);
  } catch {
    return '';
  }
}

function findNull(bytes, start, encoding = 3, end = bytes.length) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < end; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    }
    return end;
  }
  for (let i = start; i < end; i += 1) {
    if (bytes[i] === 0) return i;
  }
  return end;
}

function syncsafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f);
}

function uint24(bytes, offset) {
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function parseId3v2(bytes) {
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const version = bytes[3];
  const flags = bytes[4];
  const size = syncsafe(bytes, 6);
  const end = Math.min(bytes.length, 10 + size);
  let offset = 10;
  if (flags & 0x40) {
    if (version >= 4) offset += syncsafe(bytes, offset);
    else offset += 4 + ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
  }
  const tags = {};
  let picture = null;
  const map = {
    TIT2: 'title', TT2: 'title',
    TPE1: 'artist', TP1: 'artist',
    TPE2: 'albumArtist', TP2: 'albumArtist',
    TALB: 'album', TAL: 'album',
    TDRC: 'year', TYER: 'year', TYE: 'year',
    TRCK: 'trackNumber', TRK: 'trackNumber',
    TPOS: 'discNumber', TPA: 'discNumber',
    TCON: 'genre', TCO: 'genre',
    TCOM: 'composer', TCM: 'composer',
  };
  while (offset + 10 <= end) {
    let id;
    let frameSize;
    let headerSize;
    if (version === 2) {
      if (offset + 6 > end) break;
      id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      frameSize = uint24(bytes, offset + 3);
      headerSize = 6;
    } else {
      id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      frameSize = version >= 4 ? syncsafe(bytes, offset + 4) : ((bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7]);
      headerSize = 10;
    }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || frameSize <= 0) break;
    const dataStart = offset + headerSize;
    const dataEnd = Math.min(dataStart + frameSize, end);
    if (dataEnd <= dataStart) break;
    const payload = bytes.subarray(dataStart, dataEnd);
    if (map[id]) {
      const encoding = payload[0];
      const text = clean(decodeTextBytes(payload.subarray(1), encoding));
      if (text) tags[map[id]] = tags[map[id]] || text;
    } else if (id === 'APIC' || id === 'PIC') {
      if (!picture) {
        try {
          const encoding = payload[0];
          let pos = 1;
          let mime = 'image/jpeg';
          if (id === 'APIC') {
            const mimeEnd = findNull(payload, pos, 0);
            mime = decodeLatin1(payload.subarray(pos, mimeEnd)) || 'image/jpeg';
            pos = mimeEnd + 1;
          } else {
            const format = decodeLatin1(payload.subarray(pos, pos + 3)).toUpperCase();
            mime = format === 'PNG' ? 'image/png' : 'image/jpeg';
            pos += 3;
          }
          pos += 1; // picture type
          const descEnd = findNull(payload, pos, encoding);
          pos = descEnd + ((encoding === 1 || encoding === 2) ? 2 : 1);
          const data = payload.slice(pos);
          if (data.length > 100) picture = { blob: new Blob([data], { type: mime }), mime };
        } catch {
          /* ignore malformed artwork */
        }
      }
    } else if (id === 'USLT' || id === 'ULT') {
      if (!tags.lyrics) {
        try {
          const encoding = payload[0];
          const pos = 4 + findNull(payload, 4, encoding) + ((encoding === 1 || encoding === 2) ? 2 : 1);
          tags.lyrics = clean(decodeTextBytes(payload.subarray(pos), encoding)).replace(/\r/g, '');
        } catch {
          /* ignore */
        }
      }
    }
    offset = dataEnd;
  }
  if (bytes.length >= 128) {
    const start = bytes.length - 128;
    if (bytes[start] === 0x54 && bytes[start + 1] === 0x41 && bytes[start + 2] === 0x47) {
      const field = (from, length) => clean(decodeLatin1(bytes.subarray(start + from, start + from + length)));
      if (!tags.title) tags.title = field(3, 30);
      if (!tags.artist) tags.artist = field(33, 30);
      if (!tags.album) tags.album = field(63, 30);
      if (!tags.year) tags.year = field(93, 4);
    }
  }
  return { ...tags, picture };
}

function atomType(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function eachAtom(bytes, start, end, callback) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const type = atomType(bytes, offset + 4);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      const hi = (bytes[offset + 8] << 24) | (bytes[offset + 9] << 16) | (bytes[offset + 10] << 8) | bytes[offset + 11];
      const lo = (bytes[offset + 12] << 24) | (bytes[offset + 13] << 16) | (bytes[offset + 14] << 8) | bytes[offset + 15];
      size = hi * 4294967296 + (lo >>> 0);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < header || offset + size > end) break;
    const shouldStop = callback(type, offset + header, offset + size);
    if (shouldStop === false) break;
    offset += size;
  }
}

function findAtom(bytes, type, start, end) {
  let found = null;
  eachAtom(bytes, start, end, (name, bodyStart, bodyEnd) => {
    if (name === type) {
      found = { start: bodyStart, end: bodyEnd };
      return false;
    }
    return true;
  });
  return found;
}

function parseMp4(bytes) {
  const moov = findAtom(bytes, 'moov', 0, bytes.length);
  if (!moov) return null;
  const tags = {};
  let duration = 0;
  const mvhd = findAtom(bytes, 'mvhd', moov.start, moov.end);
  if (mvhd) {
    const version = bytes[mvhd.start];
    let offset = mvhd.start + 4;
    if (version === 1) {
      offset += 16;
      const timescale = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const hi = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
      const lo = (bytes[offset + 8] << 24) | (bytes[offset + 9] << 16) | (bytes[offset + 10] << 8) | bytes[offset + 11];
      const units = hi * 4294967296 + (lo >>> 0);
      if (timescale) duration = units / timescale;
    } else {
      offset += 8;
      const timescale = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const units = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
      if (timescale) duration = units / timescale;
    }
  }
  const udta = findAtom(bytes, 'udta', moov.start, moov.end);
  if (!udta) return { ...tags, duration };
  const meta = findAtom(bytes, 'meta', udta.start, udta.end);
  if (!meta) return { ...tags, duration };
  const ilst = findAtom(bytes, 'ilst', meta.start + 4, meta.end);
  if (!ilst) return { ...tags, duration };

  const keyMap = {
    '\u00A9nam': 'title',
    '\u00A9ART': 'artist',
    'aART': 'albumArtist',
    '\u00A9alb': 'album',
    '\u00A9day': 'year',
    '\u00A9gen': 'genre',
    '\u00A9wrt': 'composer',
    'desc': 'description',
    'ldes': 'description',
  };
  let picture = null;
  eachAtom(bytes, ilst.start, ilst.end, (type, itemStart, itemEnd) => {
    let dataAtom = null;
    eachAtom(bytes, itemStart, itemEnd, (childType, bodyStart, bodyEnd) => {
      if (childType === 'data') {
        dataAtom = { start: bodyStart, end: bodyEnd };
        return false;
      }
      return true;
    });
    if (!dataAtom) return true;
    const typeIndicator = (bytes[dataAtom.start] << 24) | (bytes[dataAtom.start + 1] << 16) | (bytes[dataAtom.start + 2] << 8) | bytes[dataAtom.start + 3];
    const payloadStart = dataAtom.start + 8;
    const payload = bytes.subarray(payloadStart, dataAtom.end);
    if (keyMap[type]) {
      const value = clean(decodeTextBytes(payload, 3));
      if (value) tags[keyMap[type]] = tags[keyMap[type]] || value;
    } else if (type === 'trkn' && payload.length >= 4) {
      tags.trackNumber = (payload[2] << 8) | payload[3];
    } else if (type === 'disk' && payload.length >= 4) {
      tags.discNumber = (payload[2] << 8) | payload[3];
    } else if (type === 'gnre' && payload.length >= 2) {
      tags.genre = String((payload[0] << 8) | payload[1]);
    } else if (type === 'tmpo' && payload.length >= 2) {
      tags.bpm = (payload[0] << 8) | payload[1];
    } else if (type === 'covr' && !picture && payload.length > 100) {
      let mime = 'image/jpeg';
      if (typeIndicator === 14) mime = 'image/png';
      else if (typeIndicator === 27) mime = 'image/bmp';
      picture = { blob: new Blob([payload], { type: mime }), mime };
    }
    return true;
  });
  return { ...tags, picture, duration };
}

function readUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function parseVorbisComments(bytes, start, end) {
  const tags = {};
  let picture = null;
  let offset = start;
  if (offset + 4 > end) return { tags, picture };
  const vendorLength = readUint32LE(bytes, offset);
  offset += 4 + vendorLength;
  if (offset + 4 > end) return { tags, picture };
  const count = readUint32LE(bytes, offset);
  offset += 4;
  for (let i = 0; i < count && offset + 4 <= end; i += 1) {
    const length = readUint32LE(bytes, offset);
    offset += 4;
    if (offset + length > end) break;
    const text = decodeTextBytes(bytes.subarray(offset, offset + length), 3);
    offset += length;
    const eq = text.indexOf('=');
    if (eq < 0) continue;
    const key = text.slice(0, eq).toUpperCase();
    const value = text.slice(eq + 1);
    if (key === 'METADATA_BLOCK_PICTURE') {
      try {
        const binary = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
        const parsed = parseFlacPicture(binary, 0, binary.length);
        if (parsed && !picture) picture = parsed;
      } catch {
        /* ignore */
      }
    } else if (key === 'TITLE') tags.title = tags.title || value;
    else if (key === 'ARTIST') tags.artist = tags.artist || value;
    else if (key === 'ALBUMARTIST') tags.albumArtist = tags.albumArtist || value;
    else if (key === 'ALBUM') tags.album = tags.album || value;
    else if (key === 'DATE' || key === 'YEAR') tags.year = tags.year || value;
    else if (key === 'GENRE') tags.genre = tags.genre || value;
    else if (key === 'TRACKNUMBER') tags.trackNumber = tags.trackNumber || value;
    else if (key === 'DISCNUMBER') tags.discNumber = tags.discNumber || value;
    else if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS') tags.lyrics = tags.lyrics || value;
  }
  return { tags, picture };
}

function parseFlacPicture(bytes, start, end) {
  let offset = start;
  if (offset + 8 > end) return null;
  offset += 4; // picture type
  const mimeLength = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  offset += 4;
  const mime = decodeLatin1(bytes.subarray(offset, offset + mimeLength));
  offset += mimeLength;
  if (offset + 4 > end) return null;
  const descLength = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  offset += 4 + descLength;
  if (offset + 20 > end) return null;
  offset += 16; // width, height, depth, colors
  const dataLength = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  offset += 4;
  const data = bytes.subarray(offset, Math.min(offset + dataLength, end));
  if (data.length < 100) return null;
  return { blob: new Blob([data], { type: mime || 'image/jpeg' }), mime: mime || 'image/jpeg' };
}

function parseFlac(bytes) {
  if (bytes[0] !== 0x66 || bytes[1] !== 0x4C || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null;
  const tags = {};
  let picture = null;
  let duration = 0;
  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const last = Boolean(header & 0x80);
    const type = header & 0x7f;
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const bodyStart = offset + 4;
    const bodyEnd = Math.min(bodyStart + length, bytes.length);
    if (type === 0 && length >= 18) {
      const b = bytes;
      const sampleRate = (b[bodyStart + 10] << 12) | (b[bodyStart + 11] << 4) | (b[bodyStart + 12] >> 4);
      const totalSamples = ((b[bodyStart + 13] & 0x0f) * 4294967296)
        + ((b[bodyStart + 14] << 24) >>> 0)
        + (b[bodyStart + 15] << 16)
        + (b[bodyStart + 16] << 8)
        + b[bodyStart + 17];
      if (sampleRate) duration = totalSamples / sampleRate;
    } else if (type === 4) {
      const parsed = parseVorbisComments(bytes, bodyStart, bodyEnd);
      Object.entries(parsed.tags).forEach(([key, value]) => {
        if (!tags[key]) tags[key] = value;
      });
      if (parsed.picture && !picture) picture = parsed.picture;
    } else if (type === 6) {
      const parsed = parseFlacPicture(bytes, bodyStart, bodyEnd);
      if (parsed && !picture) picture = parsed;
    }
    offset = bodyEnd;
    if (last) break;
  }
  return { ...tags, picture, duration };
}

function parseWav(bytes) {
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return null;
  const tags = {};
  let duration = 0;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = atomType(bytes, pos);
    const size = readUint32LE(bytes, pos + 4);
    const start = pos + 8;
    const end = Math.min(start + size, bytes.length);
    if (id === 'fmt ' && size >= 16) {
      const byteRate = readUint32LE(bytes, start + 8);
      tags._byteRate = byteRate;
    } else if (id === 'data' && tags._byteRate) {
      duration = size / tags._byteRate;
    } else if (id === 'LIST' && size > 4 && atomType(bytes, start) === 'INFO') {
      let infoPos = start + 4;
      while (infoPos + 8 <= end) {
        const infoId = atomType(bytes, infoPos);
        const infoSize = readUint32LE(bytes, infoPos + 4);
        const value = clean(decodeLatin1(bytes.subarray(infoPos + 8, Math.min(infoPos + 8 + infoSize, end))));
        if (infoId === 'INAM') tags.title = value;
        else if (infoId === 'IART') tags.artist = value;
        else if (infoId === 'IPRD') tags.album = value;
        else if (infoId === 'ICRD') tags.year = value;
        else if (infoId === 'IGNR') tags.genre = value;
        else if (infoId === 'ITRK') tags.trackNumber = value;
        infoPos += 8 + infoSize + (infoSize % 2);
      }
    }
    pos = start + size + (size % 2);
  }
  delete tags._byteRate;
  return { ...tags, duration };
}

function findSequence(bytes, sequence) {
  outer: for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
    for (let j = 0; j < sequence.length; j += 1) {
      if (bytes[i + j] !== sequence[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function parseOgg(bytes) {
  if (bytes[0] !== 0x4F || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) return null;
  const tags = {};
  let picture = null;
  let duration = 0;
  let sampleRate = 0;
  let lastGranule = 0;
  let pos = 0;
  while (pos + 27 <= bytes.length) {
    if (bytes[pos] !== 0x4F || bytes[pos + 1] !== 0x67 || bytes[pos + 2] !== 0x67 || bytes[pos + 3] !== 0x53) break;
    const segmentCount = bytes[pos + 26];
    if (pos + 27 + segmentCount > bytes.length) break;
    let pageSize = 27 + segmentCount;
    for (let i = 0; i < segmentCount; i += 1) pageSize += bytes[pos + 27 + i];
    if (pos + pageSize > bytes.length) break;
    const lo = readUint32LE(bytes, pos + 6);
    const hi = readUint32LE(bytes, pos + 10);
    lastGranule = hi * 4294967296 + (lo >>> 0);
    pos += pageSize;
  }
  const vorbis = findSequence(bytes, [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
  if (vorbis >= 0 && vorbis + 16 <= bytes.length) {
    sampleRate = readUint32LE(bytes, vorbis + 12);
  }
  const comment = findSequence(bytes, [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
  if (comment >= 0) {
    const parsed = parseVorbisComments(bytes, comment + 7, bytes.length);
    Object.assign(tags, parsed.tags);
    if (parsed.picture) picture = parsed.picture;
  }
  const opus = findSequence(bytes, [0x4F, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]);
  if (opus >= 0) {
    const parsed = parseVorbisComments(bytes, opus + 8, bytes.length);
    Object.entries(parsed.tags).forEach(([key, value]) => {
      if (!tags[key]) tags[key] = value;
    });
    if (parsed.picture && !picture) picture = parsed.picture;
    sampleRate = 48000;
  }
  if (sampleRate && lastGranule) duration = lastGranule / sampleRate;
  return { ...tags, picture, duration };
}

function fromFilename(file) {
  const base = stripExt(file.name).replace(/^\s*\d{1,3}[\s._-]+/, '');
  const pieces = base.split(/\s+-\s+/);
  let artist = '';
  let title = base;
  if (pieces.length >= 2) {
    artist = pieces[0].trim();
    title = pieces.slice(1).join(' - ').trim();
  }
  title = title.replace(/[_]+/g, ' ').trim();
  const folder = (file.webkitRelativePath || '').split('/').slice(-2, -1)[0] || '';
  return {
    title: clean(title) || clean(stripExt(file.name)) || 'Untitled Track',
    artist: clean(artist) || 'Unknown Artist',
    album: clean(folder),
  };
}

export function parseTags(bytes, fileName = '') {
  let tags = null;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) tags = parseId3v2(bytes);
  else if (bytes[0] === 0x66 && bytes[1] === 0x74 && bytes[2] === 0x79 && bytes[3] === 0x70) tags = parseMp4(bytes);
  else if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) tags = parseFlac(bytes);
  else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) tags = parseWav(bytes);
  else if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) tags = parseOgg(bytes);
  else if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) tags = parseId3v2(bytes);
  const fallback = fromFilename({ name: fileName, webkitRelativePath: '' });
  const merged = {
    title: clean(tags?.title) || fallback.title,
    artist: clean(tags?.artist) || fallback.artist,
    albumArtist: clean(tags?.albumArtist) || '',
    album: clean(tags?.album) || fallback.album,
    year: clean(tags?.year).slice(0, 4),
    genre: clean(tags?.genre),
    trackNumber: Number.parseInt(tags?.trackNumber, 10) || 0,
    discNumber: Number.parseInt(tags?.discNumber, 10) || 0,
    duration: Number(tags?.duration) || 0,
    lyrics: tags?.lyrics || '',
    picture: tags?.picture || null,
  };
  return merged;
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    const timer = window.setTimeout(() => finish(0), 12_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

export async function compressArtwork(blob, max = 640) {
  if (!blob) return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && blob.size < 240_000) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#111114';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    return compressed || blob;
  } catch {
    return blob;
  }
}

export async function importAudioFile(file, { onProgress = () => {} } = {}) {
  if (!isSupportedAudio(file)) throw new Error(`Unsupported file type: ${file.name}`);
  onProgress(0.08);
  const buffer = await file.arrayBuffer();
  onProgress(0.42);
  const bytes = new Uint8Array(buffer);
  const tags = parseTags(bytes, file.name);
  let duration = tags.duration;
  if (!duration || !Number.isFinite(duration)) {
    onProgress(0.58);
    duration = await probeDuration(file);
  }
  onProgress(0.76);
  const id = `local-${hashString(`${file.name}|${file.size}|${file.lastModified}`)}`;
  const artworkBlob = tags.picture ? await compressArtwork(tags.picture.blob) : null;
  const folder = (file.webkitRelativePath || '').split('/').slice(-2, -1)[0] || '';
  const track = {
    id,
    title: tags.title,
    artist: tags.artist,
    albumArtist: tags.albumArtist,
    artistId: null,
    album: tags.album || folder || 'Imported Music',
    albumId: `local-album-${hashString(`${tags.artist}|${tags.album || folder || 'Imported Music'}`)}`,
    artwork: '',
    artworkSmall: '',
    duration,
    genre: tags.genre,
    year: tags.year,
    trackNumber: tags.trackNumber || 1,
    discNumber: tags.discNumber || 1,
    trackCount: 0,
    explicit: false,
    preview: null,
    source: 'local',
    downloaded: true,
    addedAt: Date.now(),
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || AUDIO_TYPES[fileExt(file.name)] || '',
    audioKey: `audio-${id}`,
    artworkKey: artworkBlob ? `cover-${id}` : null,
    hasArtwork: Boolean(artworkBlob),
    lyrics: tags.lyrics || '',
  };
  onProgress(0.9);
  return { track, artworkBlob, file };
}

export async function importFiles(files, { onFile, onProgress } = {}) {
  const list = Array.from(files).filter(isSupportedAudio);
  const results = [];
  const errors = [];
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    try {
      const result = await importAudioFile(file, {
        onProgress: (progress) => onProgress?.(index, list.length, file, progress),
      });
      results.push(result);
      await onFile?.(result, index, list.length);
    } catch (error) {
      errors.push({ file: file.name, message: error.message });
    }
  }
  return { results, errors, total: list.length };
}
