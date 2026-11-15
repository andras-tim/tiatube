// A ZIP, stored (photos and videos are compressed already): plain concatenation, no wait for compression. Names are
// UTF-8; the exact time is in the 'UT' extra field. No ZIP64: the limit is 4 GB.
const enc = (t) => new TextEncoder().encode(t);
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (u8) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
// MS-DOS time, local; the extra field 'UT' carries the exact time in UTC
const dosTime = (sec) => {
  const t = new Date(sec * 1000), y = Math.max(1980, t.getFullYear());
  return { time: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate() };
};
const utExtra = (sec) => {
  const v = new DataView(new ArrayBuffer(9));
  v.setUint16(0, 0x5455, true); v.setUint16(2, 5, true); v.setUint8(4, 1); v.setUint32(5, sec, true);
  return new Uint8Array(v.buffer);
};
export class Zip {
  constructor(sink) { this.sink = sink; this.off = 0; this.cd = []; }
  async put(u8) { await this.sink.write(u8); this.off += u8.length; }
  async add(name, data, mtime) {
    const fn = enc(name), sec = Math.round(mtime || Date.now() / 1000), d = dosTime(sec), ut = utExtra(sec);
    if (this.off + 30 + fn.length + ut.length + data.length > 0xFFFFFFFF) throw new Error('a ZIP 4 GB-nál nagyobb lenne');
    const crc = crc32(data), at = this.off, h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);  // bit 11: UTF-8 names
    h.setUint16(10, d.time, true); h.setUint16(12, d.date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, fn.length, true); h.setUint16(28, ut.length, true);
    await this.put(new Uint8Array(h.buffer)); await this.put(fn); await this.put(ut); await this.put(data);
    this.cd.push({ fn, ut, crc, size: data.length, d, at });
  }
  async close() {
    const start = this.off;
    for (const e of this.cd) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true); h.setUint16(4, (3 << 8) | 20, true); h.setUint16(6, 20, true);
      h.setUint16(8, 0x0800, true); h.setUint16(12, e.d.time, true); h.setUint16(14, e.d.date, true);
      h.setUint32(16, e.crc, true); h.setUint32(20, e.size, true); h.setUint32(24, e.size, true);
      h.setUint16(28, e.fn.length, true); h.setUint16(30, e.ut.length, true);
      h.setUint32(38, 0o100644 * 65536, true);  // a regular file, rw-r--r--
      h.setUint32(42, e.at, true);
      await this.put(new Uint8Array(h.buffer)); await this.put(e.fn); await this.put(e.ut);
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.cd.length, true); end.setUint16(10, this.cd.length, true);
    end.setUint32(12, this.off - start, true); end.setUint32(16, start, true);
    await this.put(new Uint8Array(end.buffer));
    return this.sink.close();
  }
}
