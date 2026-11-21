// The end of a run, the same for every flow: a failure (or the user's cancel), and where a file made here went.
import { MSG } from '../shared/protocol.js';
import { TEST, page, st } from './state.js';
import { $, download, downloaded, el, render, result, step } from './ui.js';
import { advice } from './advice.js';

const LOST = { post: 'A ZIP nem készült el.', web: 'A videó nem mentődött el.' };

// byUser: the user's cancel, no advice
export const fail = (err, byUser = false) => {
  if (st.cancelled) return;
  st.cancelled = true;
  page.send({ type: MSG.CANCEL });
  dropJob();
  (st.zip?.sink || st.web?.sink)?.abort();
  $('run-actions').hidden = true;
  const cur = st.steps.find((x) => x.state === 'now') || st.steps.find((x) => x.state === 'todo');
  if (cur) step(cur.key, 'err', { err: String(err.message || err) });
  st.done = true;
  render();
  result([el('span', 'bad', LOST[st.mode] || 'A fájl nem készült el.'), ...(byUser ? [] : [' ', ...advice()])]);
};

// the server drops an unfinished job and stops its ffmpeg
export const dropJob = () => {
  if (st.job && !st.done) navigator.sendBeacon(`api/cancel?job=${st.job}`);
};

// where a file made in this window went: the picked file, or the Blob that downloads now (test mode: to the server)
export const saved = async (sink, blob) => {
  if (sink.kind === 'file') return [el('span', '', `Elmentve: ${sink.name}`)];
  const href = URL.createObjectURL(blob), out = downloaded(sink.name, href);
  if (TEST) {
    const r = await fetch('api/debug-zip', { method: 'POST', body: blob });
    out.push(el('span', '', `teszt: ${(await r.json()).bytes} bájt a szerveren`));
  } else {
    download(href, sink.name);
  }
  return out;
};
