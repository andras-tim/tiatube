// Media for the server: complete init segments and fragments split out of a byte stream (MP4 or WebM), sent to the
// window, which uploads them. tiaTube feeds it the bytes the player appends, tiaFace the tracks it downloads.
import { MSG } from '../../shared/protocol.js';
import { concat } from '../../shared/bytes.js';

const u32 = (b, i) => b[i] * 16777216 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

function* mp4Boxes(b, s, e) {
  let i = s;
  while (i + 8 <= e) {
    let sz = u32(b, i), h = 8;
    if (sz === 1) {
      if (i + 16 > e) return;
      sz = u32(b, i + 8) * 4294967296 + u32(b, i + 12);
      h = 16;
    }
    if (sz < h || i + sz > e) return;
    yield { type: String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]), i, sz, h };
    i += sz;
  }
}

const mp4Find = (b, s, e, path) => {
  for (const x of mp4Boxes(b, s, e)) {
    if (x.type === path[0]) return path.length === 1 ? x : mp4Find(b, x.i + x.h, x.i + x.sz, path.slice(1));
  }
  return null;
};

const ebmlId = (b, i) => {
  if (i >= b.length) return null;
  let len = 1, m = 0x80;
  while (len <= 4 && !(b[i] & m)) { m >>= 1; len++; }
  if (len > 4 || i + len > b.length) return null;
  let v = 0;
  for (let k = 0; k < len; k++) v = v * 256 + b[i + k];
  return { len, v };
};

const vint = (b, i) => {
  if (i >= b.length) return null;
  let len = 1, m = 0x80;
  while (len <= 8 && !(b[i] & m)) { m >>= 1; len++; }
  if (len > 8 || i + len > b.length) return null;
  let v = b[i] & (m - 1), ones = v === m - 1;
  for (let k = 1; k < len; k++) {
    v = v * 256 + b[i + k];
    if (b[i + k] !== 0xff) ones = false;
  }
  return { len, v, unknown: ones };
};

// a Segment of unknown size: the Cues and SeekHead of the original file are never appended
const SEG_UNKNOWN = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);

// a streaming splitter: feed it bytes, it returns the complete units found so far
export function splitter(isMp4) {
  let pend = new Uint8Array(0);
  let initParts = [], moof = null, head = null, info = null;
  const split = (u8) => {
    pend = pend.length ? concat([pend, u8]) : u8;
    const out = [];
    let i = 0;
    if (isMp4) {
      for (const x of mp4Boxes(pend, 0, pend.length)) {
        const bytes = pend.slice(x.i, x.i + x.sz);
        if (x.type === 'ftyp') initParts = [bytes];
        else if (x.type === 'moov') {
          const m = mp4Find(bytes, 8, bytes.length, ['trak', 'mdia', 'mdhd']);
          out.push({ kind: 'init', bytes: concat([...initParts, bytes]),
            scale: m ? u32(bytes, m.i + (bytes[m.i + 8] === 1 ? 28 : 20)) : 1000 });
        } else if (x.type === 'moof') {
          const t = mp4Find(bytes, 8, bytes.length, ['traf', 'tfdt']);
          moof = { bytes, ts: !t ? 0 : bytes[t.i + 8] === 1 ? u32(bytes, t.i + 12) * 4294967296 + u32(bytes, t.i + 16)
            : u32(bytes, t.i + 12) };
        } else if (x.type === 'mdat' && moof) {
          out.push({ kind: 'frag', ts: moof.ts, bytes: concat([moof.bytes, bytes]) });
          moof = null;
        }
        i = x.i + x.sz;
      }
    } else {
      while (i < pend.length) {
        const id = ebmlId(pend, i);
        const sz = id && vint(pend, i + id.len);
        if (!sz) break;
        const h = id.len + sz.len;
        if (id.v === 0x18538067) { i += h; continue; } // Segment: walk its children
        if (sz.unknown) throw new Error(`unknown-size element ${id.v.toString(16)}`);
        const end = i + h + sz.v;
        if (end > pend.length) break;
        const bytes = pend.slice(i, end);
        if (id.v === 0x1A45DFA3) { head = bytes; info = null; }
        else if (id.v === 0x1549A966) info = bytes;
        else if (id.v === 0x1654AE6B) {
          out.push({ kind: 'init', bytes: concat([head, SEG_UNKNOWN, info, bytes].filter(Boolean)), scale: 1000 });
        } else if (id.v === 0x1F43B675) {
          let ts = 0, j = h;
          while (j < bytes.length) {
            const cid = ebmlId(bytes, j), cs = cid && vint(bytes, j + cid.len);
            if (!cs) break;
            if (cid.v === 0xE7) {
              for (let k = 0; k < cs.v; k++) ts = ts * 256 + bytes[j + cid.len + cs.len + k];
              break;
            }
            j += cid.len + cs.len + cs.v;
          }
          out.push({ kind: 'frag', ts, bytes });
        }
        i = end;
      }
    }
    pend = pend.slice(i);
    return out;
  };
  // the bytes of a unit that is not complete yet
  split.pending = () => pend.length;
  return split;
}

// the key of a format: the start of its init segment's hash, the server checks it
const keyOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 4)
  .map((x) => x.toString(16).padStart(2, '0')).join('');

// a track being captured: its splitter and the format key of its last init segment
export const track = (name, mime, msId) => ({ track: name, mime, msId, key: null, split: splitter(mime.includes('mp4')) });

// splits the bytes of a track and sends its units to the window; video units only when video was asked for
export async function feed(tt, e, u8) {
  for (const u of e.split(u8)) {
    if (u.kind === 'init') e.key = await keyOf(u.bytes);
    if (!e.key || (e.track === 'video' && tt.opts.what !== 'video')) continue;
    await tt.send({ type: MSG.FRAG, track: e.track, kind: u.kind, key: e.key, mime: e.mime, scale: u.scale, ms: e.msId,
      ts: u.ts }, u.bytes);
  }
}
