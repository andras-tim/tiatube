// tiaFace: Facebook.
// - A video or reel: the complete DASH tracks the page lists, downloaded without playback; the server builds the file.
// - A post: every photo and video of it, one by one; the window packs them into a ZIP.
import { concat } from '../../shared/bytes.js';
import { MSG } from '../../shared/protocol.js';
import { TiaWeb } from '../core/tiaweb.js';
import { feed, track } from '../core/capture.js';

const LEVELS = [[2160, 'hd2160'], [1440, 'hd1440'], [1080, 'hd1080'], [720, 'hd720'], [480, 'large'], [360, 'medium'],
  [240, 'small'], [0, 'tiny']];
const levelOf = (r) => LEVELS.find(([h]) => Math.min(r.width, r.height) >= h)[1];
// the page HTML, requested like a navigation, carries the data of a photo or video
const HTML = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

export class TiaFace extends TiaWeb {
  find() {
    const video = findVideo();
    if (video) return { video };
    const post = findPost();
    return post ? { post } : null;
  }

  found() { return !!this.media; }

  windowUrl() { return `${super.windowUrl()}${this.media.post ? '&k=post' : ''}`; }

  prepare() {
    const post = this.media.post;
    if (post) postItems(post).then((items) => { this.items = items; }, () => { this.items = []; });
  }

  hello() {
    const { video, post } = this.media;
    if (post) {
      const it = this.items;
      return { kind: 'post', multi: true, videoId: post.id, title: post.title, url: post.url, author: post.author, ts: post.ts,
        text: post.text, items: it ? { photo: it.filter((x) => x.kind === 'photo').length,
          video: it.filter((x) => x.kind === 'video').length } : null };
    }
    return { videoId: video.id, title: video.title, url: video.url, author: video.author, ts: video.ts,
      duration: video.dur, thumbs: video.thumb ? [video.thumb] : [], levels: [...new Set(this.videoReps().map(levelOf))] };
  }

  start(opts) { return this.media.post ? this.startPost(opts) : this.startVideo(opts); }

  // ---- a video: the best audio track and the chosen video level ----

  videoReps() {
    return this.media.video.reps.filter((r) => r.mime_type.startsWith('video/')).sort((a, b) => b.bandwidth - a.bandwidth);
  }

  // the best bandwidth of the chosen level, or of the best level below it
  pick(q) {
    const order = LEVELS.map((l) => l[1]);
    return this.videoReps().find((r) => order.indexOf(levelOf(r)) >= order.indexOf(q)) || this.videoReps().at(-1);
  }

  async startVideo(opts) {
    const video = this.media.video;
    try {
      const tracks = [['audio', video.reps.filter((r) => r.mime_type.startsWith('audio/'))
        .sort((a, b) => b.bandwidth - a.bandwidth)[0]]];
      if (opts.what === 'video') tracks.unshift(['video', this.pick(opts.quality)]);
      // the overall progress weighs the tracks by their bandwidth
      const bw = tracks.reduce((a, [, r]) => a + (r ? r.bandwidth : 0), 0) || 1;
      let doneBw = 0;
      for (const [name, rep] of tracks) {
        if (!rep) throw new Error(`nincs ${name === 'video' ? 'kép' : 'hang'}`);
        const e = track(name, `${rep.mime_type}; codecs="${rep.codecs}"`, 1);
        const label = name === 'video' ? `kép (${rep.width}x${rep.height})` : 'hang';
        await this.download(rep.base_url, async (value) => feed(this, e, value), (got, len) => this.say(
          `${label} letöltése: ${len ? `${Math.round((100 * got) / len)}%` : `${(got / 1048576).toFixed(0)} MB`}`,
          len ? (doneBw + (rep.bandwidth * got) / len) / bw : undefined));
        doneBw += rep.bandwidth;
      }
      this.post({ type: MSG.END, ms: { 1: video.dur }, duration: video.dur });
      this.show('kész, a többi a tiaTube ablakban');
    } catch (err) {
      this.say(`hiba: ${err.message}`);
    }
  }

  // streams a URL; onBytes gets each piece, onProgress (got, length) at most every 300 ms
  async download(url, onBytes, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length')) || 0;
    const rd = res.body.getReader();
    let got = 0, said = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      if (this.gone) {
        rd.cancel();
        throw new Error('megszakítva');
      }
      got += value.byteLength;
      await onBytes(value);
      if (Date.now() - said > 300) {
        said = Date.now();
        onProgress(got, len);
      }
    }
    return res.headers.get('content-type') || '';
  }

  // ---- a post: its photos and videos, in the post's order ----

  async startPost(opts) {
    const post = this.media.post, all = this.items;
    const list = all.filter((x) => opts.what === 'all' || x.kind === opts.what);
    let failed = 0;
    // the next item's page is read while the current one downloads
    const info = (x) => (x.kind === 'photo' ? photoInfo(post, x.id) : videoInfo(x.id, opts.vq)).catch((e) => ({ error: e }));
    let next = list.length ? info(list[0]) : null;
    for (let i = 0; i < list.length; i++) {
      const x = list[i], n = list.length, label = x.kind === 'photo' ? 'kép' : 'videó';
      const meta = await next;
      next = i + 1 < n ? info(list[i + 1]) : null;
      if (this.gone) break;
      try {
        if (meta.error) throw meta.error;
        const parts = [];
        const type = await this.download(meta.url, async (v) => { parts.push(v); }, (got, len) => this.say(
          `${i + 1} / ${n}: ${label} letöltése${len ? ` ${Math.round((100 * got) / len)}%` : ''}`,
          (i + (len ? got / len : 0)) / n));
        await this.send({ type: MSG.ITEM, index: all.indexOf(x) + 1, of: all.length, id: x.id, kind: x.kind,
          ts: meta.ts || post.ts, author: meta.author || post.author, alt: meta.alt || '', quality: meta.quality || '',
          mime: type }, concat(parts));
      } catch (err) {
        if (this.gone) break;
        failed++;
        this.post({ type: MSG.ITEM_FAILED, id: x.id, kind: x.kind, error: String(err.message || err) });
      }
      this.say(`${i + 1} / ${n} kész`, (i + 1) / n);
    }
    if (this.gone) {
      this.show('megszakítva');
      return;
    }
    this.post({ type: MSG.END, failed });
    this.show('kész, a többi a tiaTube ablakban');
  }
}

// ---- reading Facebook's pages ----

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

const noTags = (t) => t.replace(/#[\p{L}\p{N}_]+/gu, '');

// the video of the URL, from the page's JSON (a video reached by in-page navigation is not there: reload)
function findVideo() {
  const m = location.href.match(/[?&]v=(\d+)/) || location.pathname.match(/\/(?:videos|reel|watch)\/(?:[^/]+\/)*?(\d{6,})/);
  if (!m) return null;
  const id = m[1];
  const r = { id, reps: null, dur: 0, title: '', caption: '', thumb: '', author: '', url: location.href, ts: 0, storyTs: 0 };
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
  const caption = noTags(r.caption.split('\n')[0]).replace(/\s+/g, ' ').trim();
  r.title = (r.title || caption || (page !== 'Facebook' && page) || `${r.author || 'Facebook'} videó`).split('\n')[0]
    .slice(0, 150);
  r.ts = r.ts || r.storyTs;
  return r;
}

// the post of the URL: its text, time, author and link from this page's JSON
function findPost() {
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
  const first = r.text.split('\n').map((l) => noTags(l).trim()).find(Boolean) || '';
  r.title = (first || `${r.author || 'Facebook'} bejegyzése`).replace(/\s+/g, ' ').slice(0, 80);
  return r;
}

// the items in the post's order: the post's media set page, else the attachments on this page
async function postItems(post) {
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
  if (!items.length) {
    jsonWalk(document, post.id, (j) => walkObj(j, 0, (o) => {
      if (o.post_id === post.id && o.attachments) walkObj(o.attachments, 0, add);
    }));
  }
  return items;
}

// the full-size image, its upload time, alt text and owner from the photo's page
async function photoInfo(post, id) {
  const doc = await getDoc(`/photo/?fbid=${id}&set=pcb.${post.id}`);
  const r = { url: '', w: 0, ts: 0, alt: '', author: '' };
  const inside = (o, d) => {
    if (!o || typeof o !== 'object' || d > 60) return;
    if (typeof o.uri === 'string' && o.width > r.w && /^https:/.test(o.uri)) {
      r.url = o.uri;
      r.w = o.width;
    }
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
}

// the progressive MP4 (sound and picture in one file) of the video's page: HD is AV1, SD is H.264
async function videoInfo(id, q) {
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
}

