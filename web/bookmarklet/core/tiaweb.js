// tiaWeb: the base of every site. It opens the tiaTube window, talks to it, shows a small status on the page, and
// saves the HTML5 videos of any page: a plain video file streams from the site straight into the window's file.
// A site class overrides find(), found(), hello() and start(), and the hooks below, nothing else.
import { BOOKMARKLET, CHUNK_SIZE, INFLIGHT_MAX, MSG, PROTOCOL, WINDOW } from '../../shared/protocol.js';
import { concat } from '../../shared/bytes.js';

// for the window's check: this bookmarklet's number and protocol
const VERSION = `n=${BOOKMARKLET}&p=${PROTOCOL}`;
// the window has this long to get its first answer, or the page's box tells that it does not work
const ANSWER_MS = 10000;
const BOX = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#222;color:#fff;'
  + 'font:14px/1.4 sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px #0008;max-width:420px';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's box when the bookmarklet does not work: the error and the way to a new bookmarklet. A dragged bookmarklet
// never changes, a new one may already handle what broke this one. A click outside the link closes the box.
export function trouble(origin, err, box) {
  console.error('tiaTube', err);
  const ui = box || document.createElement('div');
  ui.style.cssText = BOX;
  const a = document.createElement('a');
  a.href = `${origin}/`;
  a.target = '_blank';
  a.textContent = 'hozz létre újat a tiaTube oldalán';
  a.style.cssText = 'color:#8cf;text-decoration:underline';
  ui.replaceChildren(`tiaTube: nem működik (${err?.message || err}). Lehet, hogy elavult a könyvjelződ: `, a, '.');
  ui.onclick = (ev) => { if (ev.target !== a) ui.remove(); };
  if (!ui.isConnected) document.body.appendChild(ui);
}
const ALERT = 'tiaTube: engedélyezd a felugró ablakot ezen az oldalon';

export class TiaWeb {
  constructor(origin, site) {
    this.TT = origin;
    this.site = site;
    this.host = location.hostname;
    this.opts = null;
    this.capturing = false;
    this.cancelled = false;
    this.inflight = 0;
  }

  // ---- what the page has ----

  // the page's videos: of the page and of its same-origin frames, the streams it loaded, the players of other sites
  find() {
    const videos = [], seen = new Set(), wins = [];
    const meta = (n) => document.querySelector(`meta[property="og:${n}"]`)?.content || '';
    const add = (v) => {
      if (!seen.has(v.src)) {
        seen.add(v.src);
        videos.push({ id: `v${videos.length}`, ...v });
      }
    };
    const walk = (win, depth) => {
      wins.push(win);
      for (const f of win.document.querySelectorAll('iframe')) {
        let doc = null;
        try { doc = f.contentDocument; } catch (e) { /* another site */ }
        if (doc && depth < 3) walk(f.contentWindow, depth + 1);
        else if (!doc && /^https?:/.test(f.src) && f.offsetWidth >= 200 && f.offsetHeight >= 120
          && /player|embed|video/i.test(f.src)) {
          add({ kind: 'frame', src: f.src, w: f.offsetWidth, h: f.offsetHeight });
        }
      }
    };
    walk(window, 0);
    for (const win of wins) {
      const own = this.playerVideo(win);
      if (own) {
        add(own);
        continue;
      }
      const versions = this.playerVersions(win);
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
    const title = (meta('title') || document.title.replace(/\s*\|[^|]*$/, '')).replace(/\s+/g, ' ').trim() || this.host;
    return { title: title.slice(0, 150), videos };
  }

  // hook: a player of the site that knows its video better than the <video> element (its sizes, author), or null
  playerVideo() { return null; }

  // hook: the names of the sizes a player offers, when it does not give their addresses
  playerVersions() { return null; }

  found() { return !!this.media?.videos.length; }

  // the window's URL: the site in it gives the right logo before the first message
  windowUrl() { return `${this.TT}/window?s=${this.site}&${VERSION}`; }

  hello() {
    const m = this.media;
    return { kind: 'web', videoId: this.host, title: m.title, url: location.href, author: '', ts: 0, host: this.host,
      videos: m.videos.map(({ id, kind, src, w, h, dur, thumb, mime, size, cors, versions, options, author }) => ({
        id, kind, src, w, h, dur, thumb, mime, size, cors, versions, author,
        options: options && options.map(({ name, src: os, mime: om, w: ow, h: oh, size: osz, cors: oc }) => ({
          name, src: os, mime: om, w: ow, h: oh, size: osz, cors: oc })) })) };
  }

  // ---- the run ----

  run() {
    this.media = this.find();
    if (!this.found()) {
      // the site's own class found nothing: tiaWeb looks for any video on the page; nothing there either ends here
      if (this.site !== 'web') {
        new TiaWeb(this.TT, 'web').run();
        return;
      }
      if (!window.open(`${this.TT}/window?s=web&k=info&host=${encodeURIComponent(this.host)}&${VERSION}`, WINDOW.name,
        WINDOW.features)) {
        alert(ALERT);
      }
      return;
    }
    this.w = window.open(this.windowUrl(), WINDOW.name, WINDOW.features);
    if (!this.w) {
      alert(ALERT);
      return;
    }
    // a second click on the bookmarklet replaces the first one's run
    window.__tiatube?.stop();
    window.__tiatube = this;
    this.ui = document.createElement('div');
    this.ui.style.cssText = BOX;
    document.body.appendChild(this.ui);
    this.onMessage = (ev) => this.message(ev);
    window.addEventListener('message', this.onMessage);
    // no answer to the window in time: this bookmarklet cannot talk to it (a closed window is the user's choice)
    this.answered = false;
    this.watch = setTimeout(() => {
      if (!this.answered && !this.w.closed) this.trouble(new Error('nem tud szólni a tiaTube ablakkal'));
    }, ANSWER_MS);
    this.prepare();
    this.show('válassz a tiaTube ablakban');
  }

  // after the window opened: the work that may run while the user chooses
  prepare() { this.media.videos.forEach((v) => this.probe(v)); }

  trouble(err) { trouble(this.TT, err, this.ui); }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.watch);
    this.ui?.remove();
    window.removeEventListener('message', this.onMessage);
    this.cancelled = true;
  }

  message(ev) {
    if (ev.origin !== new URL(this.TT).origin || ev.source !== this.w) return;
    try {
      this.handle(ev.data || {});
    } catch (err) {
      this.post({ type: MSG.ERROR, error: String(err.message || err) });
      this.trouble(err);
    }
  }

  handle(m) {
    if (m.type === MSG.READY) {
      this.post({ type: MSG.HELLO, ...this.hello() });
      this.answered = true;
    } else if (m.type === MSG.ACK) {
      this.inflight -= m.bytes;
    } else if (m.type === MSG.CANCEL) {
      this.cancelled = true;
    } else if (m.type === MSG.RESCAN && !this.capturing) {
      this.rescan();
      this.post({ type: MSG.HELLO, ...this.hello() });
    } else if (m.type === MSG.START && !this.capturing) {
      this.opts = m.opts;
      this.capturing = true;
      this.start(m.opts);
    }
  }

  // ---- talking to the window ----

  post(m, transfer) {
    try { this.w.postMessage(m, this.TT, transfer); } catch (e) { /* closed */ }
  }

  get gone() { return this.cancelled || this.w.closed; }

  show(t) { this.ui.textContent = `tiaTube: ${t}`; } // no innerHTML: the sites enforce Trusted Types

  // pct: the work's progress on this page, 0..1, for the window's time estimate
  say(text, pct) {
    this.show(text);
    this.post({ type: MSG.PROGRESS, text, pct });
  }

  // sends bytes the window acknowledges; waits while too many are on the way
  async send(m, u8) {
    while (this.inflight > INFLIGHT_MAX && !this.gone) await sleep(100);
    this.inflight += u8.byteLength;
    this.post({ ...m, buf: u8.buffer }, [u8.buffer]);
  }

  // ---- tiaWeb's own saving: a plain video file ----

  // type and size come from a request that is cancelled after its headers
  probe(v) {
    if (v.kind !== 'file' || v.probed) return;
    v.probed = true;
    for (const o of v.options || [v]) {
      fetch(o.src).then((r) => {
        o.mime = (r.headers.get('content-type') || '').split(';')[0] || o.mime;
        o.size = Number(r.headers.get('content-length')) || 0;
        r.body.cancel();
      }).catch(() => { o.cors = false; });
    }
  }

  rescan() {
    const fresh = this.find();
    // a video seen before keeps what its probe learned
    for (const v of fresh.videos) {
      const was = this.media.videos.find((x) => x.src === v.src);
      if (was) Object.assign(v, { probed: was.probed, mime: was.mime, size: was.size, cors: was.cors, options: was.options });
      this.probe(v);
    }
    this.media = fresh;
  }

  async start(opts) {
    const v = this.media.videos.find((x) => x.src === opts.src);
    try {
      if (!v) throw new Error('a videó eltűnt az oldalról');
      // only an address this page offered
      const url = v.options ? v.options.find((o) => o.src === opts.url)?.src : v.src;
      if (!url) throw new Error('ez a méret nem érhető el');
      let res;
      try { res = await fetch(url); } catch (e) { throw new Error('a videó szervere nem engedi a böngészős letöltést'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length')) || 0;
      this.post({ type: MSG.HEAD, len, mime: (res.headers.get('content-type') || '').split(';')[0] });
      const rd = res.body.getReader();
      let got = 0, said = 0, parts = [], partLen = 0;
      const flush = async () => {
        if (!partLen) return;
        const buf = concat(parts);
        parts = [];
        partLen = 0;
        await this.send({ type: MSG.CHUNK }, buf);
      };
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        if (this.gone) {
          rd.cancel();
          this.show('megszakítva');
          return;
        }
        parts.push(value);
        partLen += value.byteLength;
        got += value.byteLength;
        if (partLen >= CHUNK_SIZE) await flush();
        if (Date.now() - said > 300) {
          said = Date.now();
          this.say(`letöltés: ${len ? `${Math.round((100 * got) / len)}%` : `${(got / 1048576).toFixed(0)} MB`}`,
            len ? got / len : undefined);
        }
      }
      await flush();
      this.post({ type: MSG.END, bytes: got });
      this.show('kész, a többi a tiaTube ablakban');
    } catch (err) {
      this.post({ type: MSG.ERROR, error: String(err.message || err) });
      this.show(`hiba: ${err.message || err}`);
    }
  }
}

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
