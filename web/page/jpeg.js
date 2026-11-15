// JPEG metadata: EXIF (ASCII only: dates, author, description without accents) and XMP (UTF-8, all of it). Both go in
// as APP1 segments after the JFIF header; the image data stays byte for byte.
import { concat } from '../shared/bytes.js';
import { pad } from './ui.js';

const enc = (t) => new TextEncoder().encode(t);
const segment = (marker, payload) => {
  if (payload.length + 2 > 65535) throw new Error('segment too large');
  return concat([new Uint8Array([0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
};
const asciiOnly = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e\n]/g, '?');
const exifDate = (sec) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const tzOf = (sec) => {
  const o = -new Date(sec * 1000).getTimezoneOffset();
  return `${o < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`;
};
const isoDate = (sec) => exifDate(sec).replace(/^(\d+):(\d+):(\d+) /, '$1-$2-$3T') + tzOf(sec);
// one TIFF IFD, big endian; 'at' is its offset from the TIFF header, longer values follow the entries
const ifdSize = (es) => 2 + 12 * es.length + 4 + es.reduce((a, e) => a + (e[3].length > 4 ? e[3].length + (e[3].length % 2) : 0), 0);
const ifd = (es, at) => {
  es.sort((a, b) => a[0] - b[0]);
  const head = 2 + 12 * es.length + 4, v = new DataView(new ArrayBuffer(head)), extra = [];
  let data = at + head;
  v.setUint16(0, es.length);
  es.forEach(([tag, type, count, bytes], k) => {
    const o = 2 + 12 * k;
    v.setUint16(o, tag); v.setUint16(o + 2, type); v.setUint32(o + 4, count);
    if (bytes.length <= 4) { new Uint8Array(v.buffer).set(bytes, o + 8); return; }
    v.setUint32(o + 8, data);
    const b = bytes.length % 2 ? concat([bytes, new Uint8Array(1)]) : bytes;
    extra.push(b);
    data += b.length;
  });
  return concat([new Uint8Array(v.buffer), ...extra]);
};
// the frame size from the first SOF marker
const jpegSize = (u8) => {
  let i = 2;
  while (i + 9 < u8.length && u8[i] === 0xFF) {
    const mk = u8[i + 1];
    if (mk >= 0xC0 && mk <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(mk)) {
      return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
    }
    if (mk === 0xDA) break;
    i += 2 + ((u8[i + 2] << 8) | u8[i + 3]);
  }
  return null;
};
const exifSegment = (m) => {
  const A = (t) => enc(asciiOnly(t) + '\0');
  const short = (v) => new Uint8Array([v >> 8, v & 255]);
  const long = (v) => new Uint8Array([v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const date = A(exifDate(m.ts)), tz = A(tzOf(m.ts)), ptr = new Uint8Array(4);
  // the tags the EXIF standard requires: YCbCr, sRGB, the pixel size
  const ifd0 = [[0x0132, 2, date.length, date], [0x8769, 4, 1, ptr], [0x0213, 3, 1, short(1)]];
  if (m.desc) { const b = A(m.desc.slice(0, 2000)); ifd0.push([0x010E, 2, b.length, b]); }
  if (m.author) { const b = A(m.author); ifd0.push([0x013B, 2, b.length, b]); }
  const exif = [[0x9000, 7, 4, enc('0232')], [0x9003, 2, date.length, date], [0x9011, 2, tz.length, tz],
    [0x9101, 7, 4, new Uint8Array([1, 2, 3, 0])], [0xA001, 3, 1, short(1)]];
  if (m.size) exif.push([0xA002, 4, 1, long(m.size.w)], [0xA003, 4, 1, long(m.size.h)]);
  const exifAt = 8 + ifdSize(ifd0);
  new DataView(ptr.buffer).setUint32(0, exifAt);
  return segment(0xE1, concat([enc('Exif\0\0'), new Uint8Array([0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8]), ifd(ifd0, 8),
    ifd(exif, exifAt)]));
};
const xmlEsc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const langAlt = (tag, t) => (t ? `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(t)}</rdf:li></rdf:Alt></${tag}>` : '');
const xmpSegment = (m) => {
  const d = isoDate(m.ts);
  const xml = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"'
    + ' xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"'
    + ' xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"'
    + ` xmp:CreateDate="${d}" photoshop:DateCreated="${d}" exif:DateTimeOriginal="${d}" dc:source="${xmlEsc(m.url)}">`
    + langAlt('dc:title', m.title) + langAlt('dc:description', m.desc && m.desc.slice(0, 20000))
    + langAlt('Iptc4xmpCore:AltTextAccessibility', m.alt)
    + (m.author ? `<dc:creator><rdf:Seq><rdf:li>${xmlEsc(m.author)}</rdf:li></rdf:Seq></dc:creator>` : '')
    + (m.post ? `<dc:relation><rdf:Bag><rdf:li>${xmlEsc(m.post)}</rdf:li></rdf:Bag></dc:relation>` : '')
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  return segment(0xE1, concat([enc('http://ns.adobe.com/xap/1.0/\0'), enc(xml)]));
};
const startsWith = (u8, at, t) => [...t].every((c, k) => u8[at + k] === c.charCodeAt(0));
export const tagJpeg = (u8, m) => {
  if (u8[0] !== 0xFF || u8[1] !== 0xD8) return u8;
  let i = 2, app0 = null;
  const keep = [];
  // the leading APPn / COM segments: an old EXIF or XMP is replaced, the rest (e.g. an ICC profile) kept
  while (i + 4 <= u8.length && u8[i] === 0xFF) {
    const mk = u8[i + 1];
    if (!((mk >= 0xE0 && mk <= 0xEF) || mk === 0xFE)) break;
    const end = i + 2 + ((u8[i + 2] << 8) | u8[i + 3]), seg = u8.subarray(i, end);
    const old = mk === 0xE1 && (startsWith(u8, i + 4, 'Exif\0') || startsWith(u8, i + 4, 'http://ns.adobe.com/xap/1.0/'));
    if (mk === 0xE0 && i === 2) app0 = seg;
    else if (!old) keep.push(seg);
    i = end;
  }
  m = { ...m, size: jpegSize(u8) };
  return concat([u8.subarray(0, 2), app0, exifSegment(m), xmpSegment(m), ...keep, u8.subarray(i)].filter(Boolean));
};
