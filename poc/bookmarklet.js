// tiaTube bookmarklet (PoC): opens the tiaTube window, which asks what to save, then passes every complete media
// fragment to the window, which uploads it. The server builds the file; the video site is only talked to by this browser.
// - YouTube: hooks Media Source Extensions, reloads the video from 0, plays it fast and muted.
// - Facebook: fetches the complete DASH tracks the page lists, no playback.
// - Facebook post: fetches every photo and video of the post one by one; the window packs them into a ZIP.
// - Any other site (tiaWeb): lists the page's videos; a plain video file goes straight from the site into the window's file.
// - Nothing found: the window opens with a short description of what tiaTube can do.
(() => {
  'use strict';
  const TT = '__TT_ORIGIN__';
  const RATE = 16;
  const host = location.hostname;
  const site = /(^|\.)facebook\.com$/.test(host) ? 'fb' : /(^|\.)(youtube\.com|youtu\.be)$/.test(host) ? 'yt' : 'web';
  let p = null, fb = null, post = null, web = null;
  if (site === 'yt') {
    // the visible one: a Shorts page has its own shorts-player next to a hidden, idle movie_player
    p = [...document.querySelectorAll('.html5-video-player')]
      .find((x) => x.offsetParent && x.getVideoData && x.getVideoData().video_id);
  } else if (site === 'fb') {
    fb = fbFind();
    if (!fb) post = postFind();
  } else {
    web = webFind();
  }
  if (!p && !fb && !post && !(web && web.videos.length)) {
    if (!window.open(`${TT}/?s=info&host=${encodeURIComponent(host)}`, 'tiatube', 'width=520,height=440')) {
      alert('tiaTube: engedélyezd a felugró ablakot ezen az oldalon');
    }
    return;
  }
  // the site in the URL: the window shows the right logo before the first message
  const w = window.open(`${TT}/?s=${post ? 'post' : site}`, 'tiatube', 'width=520,height=440');
  if (!w) {
    alert('tiaTube: engedélyezd a felugró ablakot ezen az oldalon');
    return;
  }
  const old = window.__tiatube;
  if (old) {
    clearInterval(old.timer);
    if (old.ui) old.ui.remove();
    window.removeEventListener('message', old.onMessage);
  }

  const vd = p ? p.getVideoData() : fb || (post ? { video_id: post.id, title: post.title, author: post.author }
    : { video_id: host, title: web.title, author: '' });
  const st = window.__tiatube = {
    videoId: vd.video_id, title: vd.title || vd.video_id, dur: p ? p.getDuration() : fb ? fb.dur : 0, opts: null,
    capturing: false, bufs: [], msSeq: 0, block: [], sent: 0, done: false, inflight: 0, cancelled: false,
    url: p ? `https://www.youtube.com/watch?v=${vd.video_id}` : web ? location.href : (fb || post).url, author: vd.author || '',
    thumb: p ? `https://i.ytimg.com/vi/${vd.video_id}/maxresdefault.jpg` : fb ? fb.thumb : '',
    ts: p ? ytTs(vd.video_id) : web ? 0 : (fb || post).ts,
  };

  // ---- hooks, installed once per page; they act only while a capture runs ----
  if (site === 'yt' && !MediaSource.prototype.__ttHooked) {
    const isSupported = MediaSource.isTypeSupported.bind(MediaSource);
    // codec steering: the player picks another format when one is "not supported"
    MediaSource.isTypeSupported = (t) => {
      const s = window.__tiatube;
      return s && s.block.some((b) => t.includes(b)) ? false : isSupported(t);
    };
    const add = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mime) {
      const sb = add.call(this, mime);
      const s = window.__tiatube;
      if (s && s.capturing) {
        if (!this.__ttId) this.__ttId = ++s.msSeq;
        const track = mime.startsWith('audio/') ? 'audio' : 'video';
        sb.__tt = { sb, ms: this, msId: this.__ttId, msDur: NaN, mime, track, bytes: 0, key: null,
          split: splitter(mime.includes('mp4')), chain: Promise.resolve() };
        s.bufs.push(sb.__tt);
      }
      return sb;
    };
    const append = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (d) {
      const e = this.__tt;
      if (e) {
        const u8 = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))
          : new Uint8Array(d.slice(0));
        e.bytes += u8.byteLength;
        e.chain = e.chain.then(() => window.__tiatube.process(e, u8)).catch((err) => console.error('tiaTube', err));
      }
      return append.call(this, d);
    };
    if (SourceBuffer.prototype.changeType) {
      const change = SourceBuffer.prototype.changeType;
      SourceBuffer.prototype.changeType = function (t) {
        const e = this.__tt;
        if (e) e.chain = e.chain.then(() => { e.mime = t; e.key = null; e.split = window.__tiatube.splitter(t.includes('mp4')); });
        return change.call(this, t);
      };
    }
    MediaSource.prototype.__ttHooked = true;
  }

  // ---- streaming splitter: complete init segments and fragments out of the appended bytes ----
  const u32 = (b, i) => b[i] * 16777216 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const concat = (parts) => {
    let n = 0;
    for (const c of parts) n += c.length;
    const u = new Uint8Array(n);
    let o = 0;
    for (const c of parts) { u.set(c, o); o += c.length; }
    return u;
  };
  function* mp4Boxes(b, s, e) {
    let i = s;
    while (i + 8 <= e) {
      let sz = u32(b, i), h = 8;
      if (sz === 1) {
        if (i + 16 > e) return;
        sz = u32(b, i + 8) * 4294967296 + u32(b, i + 12); h = 16;
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
    for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) ones = false; }
    return { len, v, unknown: ones };
  };
  // a Segment of unknown size: the Cues and SeekHead of the original file are never appended
  const SEG_UNKNOWN = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);

  function splitter(isMp4) {
    let pend = new Uint8Array(0);
    let initParts = [], moof = null, head = null, info = null;
    return (u8) => {
      pend = pend.length ? concat([pend, u8]) : u8;
      const out = [];
      let i = 0;
      if (isMp4) {
        for (const x of mp4Boxes(pend, 0, pend.length)) {
          const bytes = pend.slice(x.i, x.i + x.sz);
          if (x.type === 'ftyp') initParts = [bytes];
          else if (x.type === 'moov') {
            const m = mp4Find(bytes, 8, bytes.length, ['trak', 'mdia', 'mdhd']);
            out.push({ kind: 'init', bytes: concat([...initParts, bytes]), scale: m ? u32(bytes, m.i + (bytes[m.i + 8] === 1 ? 28 : 20)) : 1000 });
          } else if (x.type === 'moof') {
            const t = mp4Find(bytes, 8, bytes.length, ['traf', 'tfdt']);
            moof = { bytes, ts: !t ? 0 : bytes[t.i + 8] === 1 ? u32(bytes, t.i + 12) * 4294967296 + u32(bytes, t.i + 16) : u32(bytes, t.i + 12) };
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
          if (id.v === 0x18538067) { i += h; continue; }  // Segment: walk its children
          if (sz.unknown) throw new Error('unknown-size element ' + id.v.toString(16));
          const end = i + h + sz.v;
          if (end > pend.length) break;
          const bytes = pend.slice(i, end);
          if (id.v === 0x1A45DFA3) { head = bytes; info = null; }
          else if (id.v === 0x1549A966) info = bytes;
          else if (id.v === 0x1654AE6B) out.push({ kind: 'init', bytes: concat([head, SEG_UNKNOWN, info, bytes].filter(Boolean)), scale: 1000 });
          else if (id.v === 0x1F43B675) {
            let ts = 0, j = h;
            while (j < bytes.length) {
              const cid = ebmlId(bytes, j), cs = cid && vint(bytes, j + cid.len);
              if (!cs) break;
              if (cid.v === 0xE7) { for (let k = 0; k < cs.v; k++) ts = ts * 256 + bytes[j + cid.len + cs.len + k]; break; }
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
  }

  st.splitter = splitter;

  const keyOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 4)
    .map((x) => x.toString(16).padStart(2, '0')).join('');

  st.process = async (e, u8) => {
    for (const u of e.split(u8)) {
      if (u.kind === 'init') e.key = await keyOf(u.bytes);
      if (!e.key || (e.track === 'video' && st.opts.what !== 'video')) continue;
      st.inflight += u.bytes.byteLength;
      w.postMessage({ type: 'tt-frag', track: e.track, kind: u.kind, key: e.key, mime: e.mime, scale: u.scale, ms: e.msId,
        ts: u.ts, buf: u.bytes.buffer }, TT, [u.bytes.buffer]);
      st.sent++;
    }
  };

  // ---- UI on the YouTube page ----
  const ui = st.ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#222;color:#fff;'
    + 'font:14px/1.4 sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px #0008';
  document.body.appendChild(ui);
  const show = (t) => { ui.textContent = 'tiaTube: ' + t; };  // no innerHTML: the sites enforce Trusted Types
  // pct: the capture's progress, 0..1, for the window's time estimate
  const say = (text, pct) => { show(text); try { w.postMessage({ type: 'tt-progress', text, pct }, TT); } catch (e) { /* closed */ } };

  // the content's MediaSources have the video's duration, an ad's MediaSource its own
  const content = (track) => st.bufs.filter((b) => b.track === track && Math.abs(b.msDur - st.dur) < 2);
  const bufferedToEnd = (track) => content(track).some((b) => {
    try {
      const r = b.sb.buffered;
      return r.length && r.end(r.length - 1) >= st.dur - 0.5;
    } catch (e) { return false; }
  });

  const finish = async () => {
    st.done = true;
    clearInterval(st.timer);
    const v = p.querySelector('video');
    if (v) v.pause();
    await Promise.all(st.bufs.map((b) => b.chain));
    const ms = {};
    for (const b of st.bufs) ms[b.msId] = b.msDur;
    w.postMessage({ type: 'tt-end', ms, duration: st.dur }, TT);
    show('kész, a többi a tiaTube ablakban');
  };

  // a level the video lacks (chosen before the player listed them): the best available one below it
  const ORDER = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const closest = (q) => {
    const have = (p.getAvailableQualityLevels() || []).filter((x) => ORDER.includes(x))
      .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    if (!have.length || have.includes(q)) return q;
    return have.find((x) => ORDER.indexOf(x) > ORDER.indexOf(q)) || have[have.length - 1];
  };

  const tick = () => {
    if (w.closed) { clearInterval(st.timer); st.capturing = false; show('az ablak bezárult, leállítva'); return; }
    const v = p.querySelector('video');
    if (!v || st.done) return;
    for (const b of st.bufs) if (b.ms.readyState !== 'closed' && b.ms.duration > 0) b.msDur = b.ms.duration;
    st.quality = closest(st.quality);
    if (st.quality && p.setPlaybackQualityRange) p.setPlaybackQualityRange(st.quality, st.quality);
    v.muted = true;
    if (v.playbackRate !== RATE) v.playbackRate = RATE;
    if ([-1, 5].includes(p.getPlayerState())) p.playVideo();
    if (v.paused && p.getPlayerState() !== 0) v.play().catch(() => {});
    if (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) {
      const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button');
      if (skip) skip.click();
      say('reklám...');
      return;
    }
    st.dur = p.getDuration() || st.dur;
    const pct = st.dur ? Math.min(100, (100 * v.currentTime) / st.dur) : 0;
    // the capture ends when the buffers reach the end, ahead of the playback
    const ahead = (track) => Math.max(0, ...content(track).map((b) => {
      try { const r = b.sb.buffered; return r.length ? r.end(r.length - 1) : 0; } catch (e) { return 0; }
    }));
    const done = st.dur ? Math.min(ahead('audio'), st.opts.what === 'video' ? ahead('video') : Infinity) / st.dur : 0;
    say(`rögzítés ${pct.toFixed(0)}%` + (st.opts.what === 'video' ? ` (${v.videoWidth}x${v.videoHeight})` : ''), Math.min(1, done));
    if ((bufferedToEnd('audio') && (st.opts.what !== 'video' || bufferedToEnd('video'))) || p.getPlayerState() === 0) finish();
  };

  const start = (opts) => {
    st.opts = opts;
    // MP4: H.264 + AAC, so it is copied, not re-encoded; audio only: the smallest video, the capture is faster
    st.block = opts.what === 'video' && opts.format === 'mp4' ? ['av01', 'vp09', 'vp9', 'opus'] : [];
    st.quality = opts.what === 'video' ? opts.quality : 'tiny';
    st.capturing = true;
    say('indítás...');
    const q = () => p.setPlaybackQualityRange && p.setPlaybackQualityRange(st.quality, st.quality);
    q();
    p.loadVideoById({ videoId: st.videoId, startSeconds: 0 });
    q();
    st.timer = setInterval(tick, 500);
  };

  // ---- Facebook: the complete tracks of the DASH representations the page lists ----
  const LEVELS = [[2160, 'hd2160'], [1440, 'hd1440'], [1080, 'hd1080'], [720, 'hd720'], [480, 'large'], [360, 'medium'],
    [240, 'small'], [0, 'tiny']];
  const levelOf = (r) => LEVELS.find(([h]) => Math.min(r.width, r.height) >= h)[1];
  const fbVideos = () => fb.reps.filter((r) => r.mime_type.startsWith('video/')).sort((a, b) => b.bandwidth - a.bandwidth);
  function fbLevels() { return [...new Set(fbVideos().map(levelOf))]; }
  // the best bandwidth of the chosen level, or of the best level below it
  const fbPick = (q) => {
    const order = LEVELS.map((l) => l[1]);
    return fbVideos().find((r) => order.indexOf(levelOf(r)) >= order.indexOf(q)) || fbVideos().at(-1);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const fbStart = async (opts) => {
    st.opts = opts;
    st.capturing = true;
    try {
      const tracks = [['audio', fb.reps.filter((r) => r.mime_type.startsWith('audio/'))
        .sort((a, b) => b.bandwidth - a.bandwidth)[0]]];
      if (opts.what === 'video') tracks.unshift(['video', fbPick(opts.quality)]);
      // the overall progress weighs the tracks by their bandwidth
      const bw = tracks.reduce((a, [, r]) => a + (r ? r.bandwidth : 0), 0) || 1;
      let doneBw = 0;
      for (const [track, rep] of tracks) {
        if (!rep) throw new Error(`nincs ${track === 'video' ? 'kép' : 'hang'}`);
        const e = { track, mime: `${rep.mime_type}; codecs="${rep.codecs}"`, msId: 1, key: null, split: splitter(true) };
        const res = await fetch(rep.base_url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = Number(res.headers.get('content-length')) || 0;
        const name = track === 'video' ? `kép (${rep.width}x${rep.height})` : 'hang';
        const rd = res.body.getReader();
        let got = 0, said = 0;
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          got += value.byteLength;
          await st.process(e, value);
          // the window uploads slower than this downloads: keep at most 64 MB on the way
          while (st.inflight > 64 * 1048576 && !w.closed) await sleep(100);
          if (w.closed) throw new Error('az ablak bezárult');
          if (Date.now() - said > 300) {
            said = Date.now();
            say(`${name} letöltése: ${len ? Math.round((100 * got) / len) + '%' : (got / 1048576).toFixed(0) + ' MB'}`,
              len ? (doneBw + (rep.bandwidth * got) / len) / bw : undefined);
          }
        }
        doneBw += rep.bandwidth;
      }
      w.postMessage({ type: 'tt-end', ms: { 1: st.dur }, duration: st.dur }, TT);
      show('kész, a többi a tiaTube ablakban');
    } catch (err) {
      say('hiba: ' + err.message);
    }
  };

  // ---- Facebook post: the page HTML, requested like a navigation, carries the data of the photo or video ----
  const HTML = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  const getDoc = async (url) => {
    const r = await fetch(url, { credentials: 'include', headers: HTML });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new DOMParser().parseFromString(await r.text(), 'text/html');
  };
  const jsonWalk = (doc, needle, fn) => {
    for (const s of doc.querySelectorAll('script[type="application/json"]')) {
      if (needle && !s.textContent.includes(needle)) continue;
      try { fn(JSON.parse(s.textContent)); } catch (e) { /* not JSON */ }
    }
  };
  function walkObj(o, d, fn) {
    if (!o || typeof o !== 'object' || d > 100) return;
    fn(o);
    for (const k in o) walkObj(o[k], d + 1, fn);
  }

  // the items in the post's order: the post's media set page, else the attachments on this page
  const postItems = async () => {
    const items = [], seen = new Set();
    const add = (o) => {
      if ((o.__typename === 'Photo' || o.__typename === 'Video') && o.id && !seen.has(o.id)) {
        seen.add(o.id);
        items.push({ id: String(o.id), kind: o.__typename === 'Photo' ? 'photo' : 'video' });
      }
    };
    try {
      const doc = await getDoc(`/media/set/?set=pcb.${post.id}&type=1`);
      jsonWalk(doc, '', (j) => walkObj(j, 0, add));
    } catch (e) { /* the fallback below */ }
    if (!items.length) jsonWalk(document, post.id, (j) => walkObj(j, 0, (o) => {
      if (o.post_id === post.id && o.attachments) walkObj(o.attachments, 0, add);
    }));
    return items;
  };

  // the full-size image, its upload time, alt text and owner from the photo's page
  const photoInfo = async (id) => {
    const doc = await getDoc(`/photo/?fbid=${id}&set=pcb.${post.id}`);
    const r = { url: '', w: 0, ts: 0, alt: '', author: '' };
    const inside = (o, d) => {
      if (!o || typeof o !== 'object' || d > 60) return;
      if (typeof o.uri === 'string' && o.width > r.w && /^https:/.test(o.uri)) { r.url = o.uri; r.w = o.width; }
      for (const k in o) inside(o[k], d + 1);
    };
    jsonWalk(doc, id, (j) => walkObj(j, 0, (o) => {
      if (String(o.id) !== id) return;
      if (!r.ts && o.created_time) r.ts = o.created_time;
      if (!r.alt && o.accessibility_caption) r.alt = o.accessibility_caption;
      if (!r.author && o.owner?.name) r.author = o.owner.name;
      inside(o, 0);
    }));
    if (!r.url) throw new Error('nincs kép');
    return r;
  };

  // the progressive MP4 (sound and picture in one file) of the video's page: HD is AV1, SD is H.264
  const videoInfo = async (id, q) => {
    const doc = await getDoc(`/watch/?v=${id}`);
    const r = { urls: {}, any: {}, ts: 0, author: '' };
    const take = (o, into) => {
      for (const x of o.progressive_urls) if (x?.progressive_url) into[x.metadata?.quality || 'SD'] = x.progressive_url;
    };
    jsonWalk(doc, '', (j) => walkObj(j, 0, (o) => {
      // the URLs inside the video's own object; the page's first ones only as a fallback
      if (Array.isArray(o.progressive_urls) && !Object.keys(r.any).length) take(o, r.any);
      if (String(o.id) !== id && String(o.video_id) !== id) return;
      if (!r.ts) r.ts = o.publish_time || o.created_time || o.creation_time || 0;
      if (!r.author && o.owner?.name) r.author = o.owner.name;
      if (!Object.keys(r.urls).length) walkObj(o, 0, (x) => { if (Array.isArray(x.progressive_urls)) take(x, r.urls); });
    }));
    if (!Object.keys(r.urls).length) r.urls = r.any;
    const url = q === 'hd' ? r.urls.HD || r.urls.SD : r.urls.SD || r.urls.HD;
    if (!url) throw new Error('nincs letölthető videó');
    return { url, ts: r.ts, author: r.author, quality: url === r.urls.HD ? 'HD' : 'SD' };
  };

  const fetchAll = async (url, onBytes) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length')) || 0;
    const rd = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      if (st.cancelled || w.closed) { rd.cancel(); throw new Error('megszakítva'); }
      parts.push(value);
      got += value.byteLength;
      onBytes(got, len);
    }
    return { bytes: concat(parts), type: res.headers.get('content-type') || '' };
  };

  const postStart = async (opts) => {
    st.opts = opts;
    st.capturing = true;
    const list = st.items.filter((x) => opts.what === 'all' || x.kind === opts.what);
    let failed = 0, said = 0;
    // the next item's page is read while the current one downloads
    const info = (x) => (x.kind === 'photo' ? photoInfo(x.id) : videoInfo(x.id, opts.vq)).catch((e) => ({ error: e }));
    let next = list.length ? info(list[0]) : null;
    for (let i = 0; i < list.length; i++) {
      const x = list[i], n = list.length, label = x.kind === 'photo' ? 'kép' : 'videó';
      const meta = await next;
      next = i + 1 < n ? info(list[i + 1]) : null;
      if (st.cancelled || w.closed) break;
      try {
        if (meta.error) throw meta.error;
        const { bytes, type } = await fetchAll(meta.url, (got, len) => {
          if (Date.now() - said < 300) return;
          said = Date.now();
          say(`${i + 1} / ${n}: ${label} letöltése` + (len ? ` ${Math.round((100 * got) / len)}%` : ''),
            (i + (len ? got / len : 0)) / n);
        });
        while (st.inflight > 64 * 1048576 && !w.closed && !st.cancelled) await sleep(100);
        st.inflight += bytes.byteLength;
        w.postMessage({ type: 'tt-item', index: st.items.indexOf(x) + 1, of: st.items.length, id: x.id, kind: x.kind, ts: meta.ts || post.ts,
          author: meta.author || post.author, alt: meta.alt || '', quality: meta.quality || '', mime: type,
          buf: bytes.buffer }, TT, [bytes.buffer]);
      } catch (err) {
        if (st.cancelled || w.closed) break;
        failed++;
        w.postMessage({ type: 'tt-item-failed', id: x.id, kind: x.kind, error: String(err.message || err) }, TT);
      }
      say(`${i + 1} / ${n} kész`, (i + 1) / n);
    }
    if (st.cancelled || w.closed) { show('megszakítva'); return; }
    w.postMessage({ type: 'tt-end', failed }, TT);
    show('kész, a többi a tiaTube ablakban');
  };

  if (post) {
    postItems().then((items) => { st.items = items; }, () => { st.items = []; });
  }
  // ---- tiaWeb: a plain video file, streamed from the site to the window, which writes it ----
  // type and size come from a request that is cancelled after its headers
  const probe = (v) => {
    if (v.kind !== 'file' || v.probed) return;
    v.probed = true;
    for (const o of v.options || [v]) {
      fetch(o.src).then((r) => {
        o.mime = (r.headers.get('content-type') || '').split(';')[0] || o.mime;
        o.size = Number(r.headers.get('content-length')) || 0;
        r.body.cancel();
      }).catch(() => { o.cors = false; });
    }
  };
  const rescan = () => {
    const fresh = webFind();
    // a video seen before keeps what its probe learned
    for (const v of fresh.videos) {
      const was = web.videos.find((x) => x.src === v.src);
      if (was) Object.assign(v, { probed: was.probed, mime: was.mime, size: was.size, cors: was.cors, options: was.options });
      probe(v);
    }
    web = fresh;
  };
  if (web) web.videos.forEach(probe);

  const webStart = async (opts) => {
    st.opts = opts;
    st.capturing = true;
    const v = web.videos.find((x) => x.src === opts.src);
    try {
      if (!v) throw new Error('a videó eltűnt az oldalról');
      // only an address this page offered
      const url = v.options ? v.options.find((o) => o.src === opts.url)?.src : v.src;
      if (!url) throw new Error('ez a méret nem érhető el');
      let res;
      try { res = await fetch(url); } catch (e) { throw new Error('a videó szervere nem engedi a böngészős letöltést'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length')) || 0;
      w.postMessage({ type: 'tt-head', len, mime: (res.headers.get('content-type') || '').split(';')[0] }, TT);
      const rd = res.body.getReader();
      let got = 0, said = 0, parts = [], partLen = 0;
      // about 2 MB per message: fewer messages, steady writes
      const flush = async () => {
        if (!partLen) return;
        const buf = concat(parts);
        parts = []; partLen = 0;
        while (st.inflight > 64 * 1048576 && !w.closed && !st.cancelled) await sleep(100);
        st.inflight += buf.byteLength;
        w.postMessage({ type: 'tt-chunk', buf: buf.buffer }, TT, [buf.buffer]);
      };
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        if (st.cancelled || w.closed) { rd.cancel(); show('megszakítva'); return; }
        parts.push(value);
        partLen += value.byteLength;
        got += value.byteLength;
        if (partLen >= 2 * 1048576) await flush();
        if (Date.now() - said > 300) {
          said = Date.now();
          say(`letöltés: ${len ? Math.round((100 * got) / len) + '%' : (got / 1048576).toFixed(0) + ' MB'}`, len ? got / len : undefined);
        }
      }
      await flush();
      w.postMessage({ type: 'tt-end', bytes: got }, TT);
      show('kész, a többi a tiaTube ablakban');
    } catch (err) {
      w.postMessage({ type: 'tt-error', error: String(err.message || err) }, TT);
      show('hiba: ' + (err.message || err));
    }
  };

  const hello = () => {
    const base = { videoId: st.videoId, title: st.title, url: st.url, author: st.author, ts: st.ts };
    if (web) {
      return { ...base, kind: 'web', host, videos: web.videos.map(({ id, kind, src, w: vw, h, dur, thumb, mime, size, cors,
        versions, options, author }) => ({ id, kind, src, w: vw, h, dur, thumb, mime, size, cors, versions, author,
        options: options && options.map(({ name, src: os, mime: om, w: ow, h: oh, size: osz, cors: oc }) => ({
          name, src: os, mime: om, w: ow, h: oh, size: osz, cors: oc })) })) };
    }
    if (post) {
      return { ...base, kind: 'post', multi: true, text: post.text, items: st.items ? {
        photo: st.items.filter((x) => x.kind === 'photo').length, video: st.items.filter((x) => x.kind === 'video').length,
      } : null };
    }
    return { ...base, duration: st.dur, thumb: st.thumb, levels: p ? p.getAvailableQualityLevels() : fbLevels() };
  };

  st.onMessage = (ev) => {
    if (ev.origin !== TT || ev.source !== w) return;
    const m = ev.data || {};
    if (m.type === 'tt-ready') {
      w.postMessage({ type: 'tt-hello', ...hello() }, TT);
    } else if (m.type === 'tt-ack') {
      st.inflight -= m.bytes;
    } else if (m.type === 'tt-cancel') {
      st.cancelled = true;
    } else if (m.type === 'tt-rescan' && web && !st.capturing) {
      rescan();
      w.postMessage({ type: 'tt-hello', ...hello() }, TT);
    } else if (m.type === 'tt-start' && !st.capturing) {
      (web ? webStart : post ? postStart : p ? start : fbStart)(m.opts);
    }
  };
  window.addEventListener('message', st.onMessage);
  show('válassz a tiaTube ablakban');

  // the videos of the page and of its same-origin frames, the streams the page loaded, the players of other sites
  function webFind() {
    const videos = [], seen = new Set(), wins = [];
    const meta = (n) => document.querySelector(`meta[property="og:${n}"]`)?.content || '';
    const add = (v) => { if (!seen.has(v.src)) { seen.add(v.src); videos.push({ id: `v${videos.length}`, ...v }); } };
    const walk = (win, depth) => {
      wins.push(win);
      for (const f of win.document.querySelectorAll('iframe')) {
        let doc = null;
        try { doc = f.contentDocument; } catch (e) { /* another site */ }
        if (doc && depth < 3) walk(f.contentWindow, depth + 1);
        else if (!doc && /^https?:/.test(f.src) && f.offsetWidth >= 200 && f.offsetHeight >= 120 && /player|embed|video/i.test(f.src)) {
          add({ kind: 'frame', src: f.src, w: f.offsetWidth, h: f.offsetHeight });
        }
      }
    };
    walk(window, 0);
    // a still of the playing video; a video of another site without CORS cannot be drawn
    const still = (v) => {
      try {
        if (!v.videoWidth || v.readyState < 2) return '';
        const c = document.createElement('canvas');
        c.width = 192;
        c.height = Math.round((192 * v.videoHeight) / v.videoWidth);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.7);
      } catch (e) { return ''; }
    };
    for (const win of wins) {
      // videa.hu: its player keeps the signed address of every size, so they are offered without switching the player
      let vx = null;
      try { vx = win.videaPlayerController?.contentController?.mainControllerContext?.xmlValues; } catch (e) { /* not videa */ }
      const sources = vx && Object.values(vx.video_sources || {}).filter((x) => x && typeof x.value === 'string');
      if (sources && sources.length) {
        const options = sources.map((x) => ({ name: x.name, src: x.normalized || new URL(x.value, 'https://videa.hu').href,
          mime: x.mimetype || '', w: Number(x.width) || 0, h: Number(x.height) || 0 })).sort((a, b) => a.h - b.h);
        const hls = options.some((o) => /mpegurl/i.test(o.mime) || /\.m3u8(\?|$)/i.test(o.src));
        add({ kind: hls ? 'hls' : 'file', src: `videa:${vx.video?.vcode || options[0].src}`, options,
          dur: Number(vx.video?.duration) || 0, author: vx.video?.uploader_name || '',
          thumb: vx.video?.poster_src ? new URL(vx.video.poster_src, 'https://videa.hu').href : '' });
        continue;
      }
      // another videa.hu player only lists its sizes
      let versions = null;
      try { versions = win.videaGetVersions?.().value?.map((x) => x.name) || null; } catch (e) { /* not videa */ }
      for (const v of win.document.querySelectorAll('video')) {
        const src = v.currentSrc || v.src || '';
        if (!/^(https?|blob):/.test(src)) continue;
        const kind = v.mediaKeys ? 'drm' : src.startsWith('blob:') ? 'stream' : /\.m3u8(\?|$)/i.test(src) ? 'hls' : 'file';
        add({ kind, src, w: v.videoWidth, h: v.videoHeight, dur: Number.isFinite(v.duration) ? v.duration : 0,
          thumb: v.poster || still(v), versions });
      }
      for (const e of win.performance.getEntriesByType('resource')) {
        if (/\.(m3u8|mpd)(\?|$)/i.test(e.name)) add({ kind: /\.mpd/i.test(e.name) ? 'dash' : 'hls', src: e.name });
      }
    }
    // the page's own picture for its main video
    const main = videos.find((v) => v.kind !== 'frame');
    if (main && !main.thumb) main.thumb = meta('image');
    const title = (meta('title') || document.title.replace(/\s*\|[^|]*$/, '')).replace(/\s+/g, ' ').trim() || host;
    return { title: title.slice(0, 150), videos };
  }

  // the post of the URL: its text, time, author and link from this page's JSON
  function postFind() {
    const m = location.href.match(/[?&]multi_permalinks=(\d+)|\/(?:posts|permalink)\/(\d+)|[?&]story_fbid=(\d+)|set=pcb\.(\d+)/);
    let id = m && (m[1] || m[2] || m[3] || m[4]);
    const r = { id, text: '', ts: 0, author: '', url: location.href };
    const hit = (o) => {
      if (!o.post_id || (id && o.post_id !== id)) return;
      if (!id && !o.attachments) return;
      id = r.id = o.post_id;
      if (!r.text && o.message?.text) r.text = o.message.text;
      if (!r.ts && o.creation_time) r.ts = o.creation_time;
      if (!r.author && o.actors?.[0]?.name) r.author = o.actors[0].name;
      if (o.permalink_url) r.url = o.permalink_url;
    };
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (id && !s.textContent.includes(id)) continue;
      try { walkObj(JSON.parse(s.textContent), 0, hit); } catch (e) { /* not JSON */ }
    }
    if (!r.id) return null;
    const first = r.text.split('\n').map((l) => l.replace(/#[\p{L}\p{N}_]+/gu, '').trim()).find(Boolean) || '';
    r.title = (first || `${r.author || 'Facebook'} bejegyzése`).replace(/\s+/g, ' ').slice(0, 80);
    return r;
  }

  // the video of the URL, from the page's JSON (a video reached by in-page navigation is not there: reload)
  function fbFind() {
    const m = location.href.match(/[?&]v=(\d+)/) || location.pathname.match(/\/(?:videos|reel|watch)\/(?:[^/]+\/)*?(\d{6,})/);
    if (!m) return null;
    const id = m[1];
    const r = { video_id: id, reps: null, dur: 0, title: '', caption: '', thumb: '', author: '', url: location.href, ts: 0,
      storyTs: 0 };
    const walk = (o, d) => {
      if (!o || typeof o !== 'object' || d > 80) return;
      if (o.video_id === id && Array.isArray(o.representations) && !r.reps) r.reps = o.representations;
      if (o.id === id) {
        if (o.playable_duration_in_ms) r.dur = o.playable_duration_in_ms / 1000;
        if (!r.thumb && o.preferred_thumbnail?.image?.uri) r.thumb = o.preferred_thumbnail.image.uri;
        if (!r.title) r.title = o.title?.text || o.savable_description?.text || '';
        if (o.permalink_url) r.url = o.permalink_url;
        if (!r.author && o.owner?.name) r.author = o.owner.name;
        if (!r.ts) r.ts = o.publish_time || o.created_time || o.creation_time || 0;
      }
      // a reel or post has no title, only the text of the story that carries the video
      if (o.attachments?.some?.((a) => a?.media?.id === id)) {
        if (!r.caption && o.message?.text) r.caption = o.message.text;
        if (!r.storyTs) r.storyTs = o.creation_time || 0;
      }
      for (const k in o) walk(o[k], d + 1);
    };
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (!s.textContent.includes(id)) continue;
      try { walk(JSON.parse(s.textContent), 0); } catch (e) { /* not JSON */ }
    }
    if (!r.reps || !r.dur) return null;
    const page = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*Facebook$/, '');
    const caption = r.caption.split('\n')[0].replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
    r.title = (r.title || caption || (page !== 'Facebook' && page) || `${r.author || 'Facebook'} videó`).split('\n')[0].slice(0, 150);
    r.ts = r.ts || r.storyTs;
    return r;
  }

  // the publish time in Unix seconds, 0 when unknown; the initial player response only while it is the current video
  function ytTs(id) {
    const ok = (r) => r?.videoDetails?.videoId === id && r.microformat?.playerMicroformatRenderer;
    const r = [p.getPlayerResponse?.(), window.ytInitialPlayerResponse].find(ok);
    const mf = r && r.microformat.playerMicroformatRenderer;
    const t = Date.parse((mf && (mf.publishDate || mf.uploadDate)) || '');
    return Number.isNaN(t) ? 0 : Math.round(t / 1000);
  }
})();
