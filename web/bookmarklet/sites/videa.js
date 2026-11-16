// tiaVidea: videa.hu. Its player keeps the signed address of every size, so all of them are offered without
// switching the player; the rest is tiaWeb's.
import { TiaWeb } from '../core/tiaweb.js';

const abs = (u) => new URL(u, 'https://videa.hu').href;

export class TiaVidea extends TiaWeb {
  playerVideo(win) {
    let vx = null;
    try { vx = win.videaPlayerController?.contentController?.mainControllerContext?.xmlValues; } catch (e) { /* none */ }
    const sources = vx && Object.values(vx.video_sources || {}).filter((x) => x && typeof x.value === 'string');
    if (!sources?.length) return null;
    const options = sources.map((x) => ({ name: x.name, src: x.normalized || abs(x.value), mime: x.mimetype || '',
      w: Number(x.width) || 0, h: Number(x.height) || 0 })).sort((a, b) => a.h - b.h);
    const hls = options.some((o) => /mpegurl/i.test(o.mime) || /\.m3u8(\?|$)/i.test(o.src));
    return { kind: hls ? 'hls' : 'file', src: `videa:${vx.video?.vcode || options[0].src}`, options,
      dur: Number(vx.video?.duration) || 0, author: vx.video?.uploader_name || '',
      thumb: vx.video?.poster_src ? abs(vx.video.poster_src) : '' };
  }

  // a videa player without the source list only names its sizes
  playerVersions(win) {
    try { return win.videaGetVersions?.().value?.map((x) => x.name) || null; } catch (e) { return null; }
  }
}
