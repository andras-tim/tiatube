// tiaTube: YouTube. Hooks Media Source Extensions, reloads the video from 0 and plays it fast and muted; every
// complete fragment the player appends goes to the window, the server builds the file.
import { MSG } from '../../shared/protocol.js';
import { TiaWeb, sleep } from '../core/tiaweb.js';
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
      thumbs: thumbsOf(id), playlist: playlistOf(p) };
  }

  found() { return !!this.media; }

  hello() {
    const m = this.media;
    return { videoId: m.videoId, title: m.title, url: m.url, author: m.author, ts: m.ts, duration: m.dur,
      thumbs: m.thumbs, levels: levelsOf(m.player), playlist: m.playlist };
  }

  prepare() {
    this.bufs = [];
    this.msSeq = 0;
    this.block = [];
    hook();
  }

  // one video: the page's, or another item of its playlist; the window starts the items one after the other
  start(opts) {
    const p = this.media.player;
    this.target = opts.videoId || this.media.videoId;
    this.dur = opts.duration || this.media.dur;
    this.bufs = [];
    this.done = false;
    // MP4: H.264 + AAC, so it is copied, not re-encoded; audio only: the smallest video, the capture is faster
    this.block = opts.what === 'video' && opts.format === 'mp4' ? ['av01', 'vp09', 'vp9', 'opus'] : [];
    this.quality = opts.what === 'video' ? opts.quality : 'tiny';
    this.say('indítás...');
    const v = p.querySelector('video');
    if (!this.was && v) this.was = { muted: v.muted, rate: v.playbackRate };
    const q = () => p.setPlaybackQualityRange && p.setPlaybackQualityRange(this.quality, this.quality);
    q();
    p.loadVideoById({ videoId: this.target, startSeconds: 0 });
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
    // until the player has switched to the video, its duration and buffers are the previous one's
    if (p.getVideoData().video_id !== this.target) return;
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
    // the buffered range reaches the end while the player may still append the rest of the last part (a part comes in
    // several appends when it is not cached): wait for the started parts while appends keep coming, at most 8 s
    const t0 = Date.now();
    for (;;) {
      await Promise.all(this.bufs.map((b) => b.chain));
      const open = this.bufs.some((b) => b.split.pending() && Date.now() - (b.lastAppend || 0) < 1500);
      if (!open || Date.now() - t0 > 8000) break;
      await sleep(100);
    }
    this.restore();
    const ms = {};
    for (const b of this.bufs) ms[b.msId] = b.msDur;
    this.capturing = false;
    this.post({ type: MSG.END, ms, duration: this.dur, videoId: this.target,
      formats: formatsOf(this.media.player, this.block) });
    this.show('kész, a többi a tiaTube ablakban');
  }
}

// old videos have no maxres picture
const thumbsOf = (id) => ['maxresdefault', 'hqdefault'].map((q) => `https://i.ytimg.com/vi/${id}/${q}.jpg`);

const seconds = (t) => (t || '').split(':').reduce((a, x) => a * 60 + (Number(x) || 0), 0);

// the open playlist: its items in order, with title and duration from the side panel; null without one
function playlistOf(p) {
  const ids = p.getPlaylist?.() || [];
  if (ids.length < 2) return null;
  const panel = new Map();
  for (const x of document.querySelectorAll('ytd-playlist-panel-video-renderer')) {
    let id = null;
    try { id = new URL(x.querySelector('a')?.href).searchParams.get('v'); } catch (e) { /* no link */ }
    if (id) {
      panel.set(id, { title: x.querySelector('#video-title')?.textContent.trim() || id,
        dur: seconds(x.querySelector('badge-shape, #time-status #text')?.textContent.trim()) });
    }
  }
  let title = '';
  try { title = window.ytInitialData.contents.twoColumnWatchNextResults.playlist.playlist.title; } catch (e) { /* none */ }
  return { id: p.getPlaylistId?.() || '', title: title || 'Lejátszási lista',
    items: ids.map((id) => ({ id, thumbs: thumbsOf(id), ...(panel.get(id) || { title: id, dur: 0 }) })) };
}

// the levels the video is offered in: the player lists only what the page's codec answers allow (under h264ify at
// most 1080p), the capture asks the browser itself, so the offered formats count
const LEVEL = { 4320: 'highres', 2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720', 480: 'large',
  360: 'medium', 240: 'small', 144: 'tiny' };
function levelsOf(p) {
  const offered = (p.getPlayerResponse?.()?.streamingData?.adaptiveFormats || [])
    .map((f) => LEVEL[parseInt(f.qualityLabel, 10)]).filter(Boolean);
  return [...new Set([...(p.getAvailableQualityLevels() || []), ...offered])];
}

// What the player played (from its stats: "av01... (394) / opus (251)") and the best audio track the user's session
// offers for this run's codecs (dubbed tracks left out), so the window can tell whether the best one came. Best: the
// site's quality class, then the codec (Opus before AAC at a similar bitrate, as yt-dlp sorts), then the bitrate.
function formatsOf(p, block) {
  const out = {};
  try {
    const [video, audio] = (p.getStatsForNerds().codecs || '').split(' / ');
    out.video = Number((video || '').match(/\((\d+)\)/)?.[1]) || 0;
    out.audio = Number((audio || '').match(/\((\d+)\)/)?.[1]) || 0;
  } catch (e) { /* no stats */ }
  const rank = { AUDIO_QUALITY_HIGH: 3, AUDIO_QUALITY_MEDIUM: 2, AUDIO_QUALITY_LOW: 1 };
  const codec = (f) => (f.mimeType.includes('opus') ? 2 : f.mimeType.includes('mp4a') ? 1 : 0);
  const all = p.getPlayerResponse?.()?.streamingData?.adaptiveFormats || [];
  const label = (f) => f && { itag: f.itag, codec: (f.mimeType.match(/codecs="([^".]+)/) || [])[1] || '',
    kbps: Math.round(f.bitrate / 1000), label: f.qualityLabel || '' };
  const audio = all.filter((f) => f.mimeType.startsWith('audio/') && !block.some((b) => f.mimeType.includes(b))
    && !/dubbed/.test(decodeTags(f.xtags)));
  audio.sort((a, b) => (rank[b.audioQuality] || 0) - (rank[a.audioQuality] || 0) || codec(b) - codec(a)
    || b.bitrate - a.bitrate);
  out.best = label(audio[0]);
  const of = (itag) => label(all.find((f) => f.itag === itag));
  out.got = { audio: of(out.audio), video: of(out.video) };
  return out;
}

// the xtags of a format are a base64url protobuf; its text is enough to find "dubbed"
const decodeTags = (x) => {
  try { return x ? atob(x.replace(/-/g, '+').replace(/_/g, '/')) : ''; } catch (e) { return ''; }
};

// the browser's own answer: an extension may hide codecs from the page's function (h264ify answers '' for VP9, AV1
// and Opus), so the capture asks the function of a fresh frame, which no content script has wrapped yet
function nativeSupport() {
  const f = document.createElement('iframe');
  f.style.display = 'none';
  document.documentElement.appendChild(f);
  const ms = f.contentWindow.MediaSource;
  return ms.isTypeSupported.bind(ms);
}

// The hooks act only while the current run captures. Every run installs them again over the browser's own functions,
// kept on the first run: each click evaluates the bookmarklet anew, so a hook of an earlier run knows only its own
// TiaTube class and would never see this run (a second click on a page, or the next video of the same page).
function hook() {
  const o = MediaSource.__ttOrig || (MediaSource.__ttOrig = { isSupported: MediaSource.isTypeSupported,
    add: MediaSource.prototype.addSourceBuffer, append: SourceBuffer.prototype.appendBuffer,
    change: SourceBuffer.prototype.changeType });
  if (!o.native) o.native = nativeSupport();
  const cur = () => (window.__tiatube instanceof TiaTube && window.__tiatube.capturing ? window.__tiatube : null);
  const isSupported = o.isSupported.bind(MediaSource);
  // while capturing: the browser's own answer, so the player takes its best format, except the codecs the run blocks
  // (the player then picks another one); otherwise the page's function, as it was
  MediaSource.isTypeSupported = (t) => {
    const s = cur();
    if (!s) return isSupported(t);
    return s.block.some((b) => t.includes(b)) ? false : o.native(t);
  };
  const add = o.add;
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
  const append = o.append;
  SourceBuffer.prototype.appendBuffer = function (d) {
    const e = this.__tt;
    if (e && e.owner === cur()) {
      e.lastAppend = Date.now();
      const u8 = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))
        : new Uint8Array(d.slice(0));
      e.chain = e.chain.then(() => feed(e.owner, e, u8)).catch((err) => console.error('tiaTube', err));
    }
    return append.call(this, d);
  };
  if (o.change) {
    const change = o.change;
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
}

// the publish time in Unix seconds, 0 when unknown; the initial player response only while it is the current video
function publishTime(p, id) {
  const ok = (r) => r?.videoDetails?.videoId === id && r.microformat?.playerMicroformatRenderer;
  const r = [p.getPlayerResponse?.(), window.ytInitialPlayerResponse].find(ok);
  const mf = r && r.microformat.playerMicroformatRenderer;
  const t = Date.parse((mf && (mf.publishDate || mf.uploadDate)) || '');
  return Number.isNaN(t) ? 0 : Math.round(t / 1000);
}
