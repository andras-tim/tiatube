// tiaTube: YouTube. Hooks Media Source Extensions, reloads the video from 0 and plays it fast and muted; every
// complete fragment the player appends goes to the window, the server builds the file.
import { MSG } from '../../shared/protocol.js';
import { TiaWeb } from '../core/tiaweb.js';
import { feed, splitter, track } from '../core/capture.js';

const RATE = 16;
// a level the video lacks (chosen before the player listed them): the best available one below it
const ORDER = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

export class TiaTube extends TiaWeb {
  find() {
    // the visible one: a Shorts page has its own shorts-player next to a hidden, idle movie_player
    const p = [...document.querySelectorAll('.html5-video-player')]
      .find((x) => x.offsetParent && x.getVideoData && x.getVideoData().video_id);
    if (!p) return null;
    const vd = p.getVideoData(), id = vd.video_id;
    return { player: p, videoId: id, title: vd.title || id, author: vd.author || '', dur: p.getDuration(),
      url: `https://www.youtube.com/watch?v=${id}`, ts: publishTime(p, id),
      // old videos have no maxres picture
      thumbs: ['maxresdefault', 'hqdefault'].map((q) => `https://i.ytimg.com/vi/${id}/${q}.jpg`) };
  }

  found() { return !!this.media; }

  hello() {
    const m = this.media;
    return { videoId: m.videoId, title: m.title, url: m.url, author: m.author, ts: m.ts, duration: m.dur,
      thumbs: m.thumbs, levels: m.player.getAvailableQualityLevels() };
  }

  prepare() {
    this.bufs = [];
    this.msSeq = 0;
    this.block = [];
    hookOnce();
  }

  start(opts) {
    const p = this.media.player;
    this.dur = this.media.dur;
    // MP4: H.264 + AAC, so it is copied, not re-encoded; audio only: the smallest video, the capture is faster
    this.block = opts.what === 'video' && opts.format === 'mp4' ? ['av01', 'vp09', 'vp9', 'opus'] : [];
    this.quality = opts.what === 'video' ? opts.quality : 'tiny';
    this.say('indítás...');
    const v = p.querySelector('video');
    this.was = v ? { muted: v.muted, rate: v.playbackRate } : null;
    const q = () => p.setPlaybackQualityRange && p.setPlaybackQualityRange(this.quality, this.quality);
    q();
    p.loadVideoById({ videoId: this.media.videoId, startSeconds: 0 });
    q();
    this.timer = setInterval(() => this.tick(), 500);
  }

  // the content's MediaSources have the video's duration, an ad's MediaSource its own
  content(name) { return this.bufs.filter((b) => b.track === name && Math.abs(b.msDur - this.dur) < 2); }

  ahead(name) {
    return Math.max(0, ...this.content(name).map((b) => {
      try {
        const r = b.sb.buffered;
        return r.length ? r.end(r.length - 1) : 0;
      } catch (e) { return 0; }
    }));
  }

  closest(q) {
    const have = (this.media.player.getAvailableQualityLevels() || []).filter((x) => ORDER.includes(x))
      .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    if (!have.length || have.includes(q)) return q;
    return have.find((x) => ORDER.indexOf(x) > ORDER.indexOf(q)) || have[have.length - 1];
  }

  tick() {
    const p = this.media.player;
    if (this.gone) {
      clearInterval(this.timer);
      this.capturing = false;
      this.restore();
      this.show(this.cancelled ? 'megszakítva' : 'az ablak bezárult, leállítva');
      return;
    }
    const v = p.querySelector('video');
    if (!v || this.done) return;
    for (const b of this.bufs) if (b.ms.readyState !== 'closed' && b.ms.duration > 0) b.msDur = b.ms.duration;
    this.quality = this.closest(this.quality);
    if (this.quality && p.setPlaybackQualityRange) p.setPlaybackQualityRange(this.quality, this.quality);
    v.muted = true;
    if (v.playbackRate !== RATE) v.playbackRate = RATE;
    if ([-1, 5].includes(p.getPlayerState())) p.playVideo();
    if (v.paused && p.getPlayerState() !== 0) v.play().catch(() => {});
    if (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) {
      document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button')?.click();
      this.say('reklám...');
      return;
    }
    this.dur = p.getDuration() || this.dur;
    const video = this.opts.what === 'video';
    const pct = this.dur ? Math.min(100, (100 * v.currentTime) / this.dur) : 0;
    // the capture ends when the buffers reach the end, ahead of the playback
    const reached = this.dur ? Math.min(this.ahead('audio'), video ? this.ahead('video') : Infinity) / this.dur : 0;
    this.say(`rögzítés ${pct.toFixed(0)}%${video ? ` (${v.videoWidth}x${v.videoHeight})` : ''}`, Math.min(1, reached));
    if ((this.dur && reached >= 1 - 0.5 / this.dur) || p.getPlayerState() === 0) this.finish();
  }

  // the player as it was before the capture, paused
  restore() {
    const v = this.media.player.querySelector('video');
    if (!v) return;
    v.pause();
    if (this.was) {
      v.playbackRate = this.was.rate;
      v.muted = this.was.muted;
    }
  }

  async finish() {
    this.done = true;
    clearInterval(this.timer);
    this.restore();
    await Promise.all(this.bufs.map((b) => b.chain));
    const ms = {};
    for (const b of this.bufs) ms[b.msId] = b.msDur;
    this.post({ type: MSG.END, ms, duration: this.dur });
    this.show('kész, a többi a tiaTube ablakban');
  }
}

// the hooks are installed once per page; they act only while the current run captures
function hookOnce() {
  if (MediaSource.prototype.__ttHooked) return;
  const cur = () => (window.__tiatube instanceof TiaTube && window.__tiatube.capturing ? window.__tiatube : null);
  const isSupported = MediaSource.isTypeSupported.bind(MediaSource);
  // codec steering: the player picks another format when one is "not supported"
  MediaSource.isTypeSupported = (t) => {
    const s = cur();
    return s && s.block.some((b) => t.includes(b)) ? false : isSupported(t);
  };
  const add = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime) {
    const sb = add.call(this, mime);
    const s = cur();
    if (s) {
      if (!this.__ttId) this.__ttId = ++s.msSeq;
      sb.__tt = { ...track(mime.startsWith('audio/') ? 'audio' : 'video', mime, this.__ttId), sb, ms: this, msDur: NaN,
        chain: Promise.resolve(), owner: s };
      s.bufs.push(sb.__tt);
    }
    return sb;
  };
  const append = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (d) {
    const e = this.__tt;
    if (e && e.owner === cur()) {
      const u8 = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))
        : new Uint8Array(d.slice(0));
      e.chain = e.chain.then(() => feed(e.owner, e, u8)).catch((err) => console.error('tiaTube', err));
    }
    return append.call(this, d);
  };
  if (SourceBuffer.prototype.changeType) {
    const change = SourceBuffer.prototype.changeType;
    SourceBuffer.prototype.changeType = function (t) {
      const e = this.__tt;
      if (e) {
        e.chain = e.chain.then(() => {
          e.mime = t;
          e.key = null;
          e.split = splitter(t.includes('mp4'));
        });
      }
      return change.call(this, t);
    };
  }
  MediaSource.prototype.__ttHooked = true;
}

// the publish time in Unix seconds, 0 when unknown; the initial player response only while it is the current video
function publishTime(p, id) {
  const ok = (r) => r?.videoDetails?.videoId === id && r.microformat?.playerMicroformatRenderer;
  const r = [p.getPlayerResponse?.(), window.ytInitialPlayerResponse].find(ok);
  const mf = r && r.microformat.playerMicroformatRenderer;
  const t = Date.parse((mf && (mf.publishDate || mf.uploadDate)) || '');
  return Number.isNaN(t) ? 0 : Math.round(t / 1000);
}
