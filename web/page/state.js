// The window's state, and the line to the video page that opened it.
// age: the bookmarklet's, null when current (see main.js); alive: the last message of the page or the server
export const st = { info: null, site: 'tube', job: null, mode: null, opts: null, queue: [], active: 0, sent: 0,
  sentBytes: 0, got: 0, gotBytes: 0, end: null, finished: false, done: false, cancelled: false, steps: [], post: null,
  zip: null, web: null, age: null, alive: 0 };

// test mode: no save dialog, a file built here goes to the server for checking; the server's test loader sets it for
// the window it opens in
const testFlag = () => { try { return !!sessionStorage.getItem('tt-test'); } catch (e) { return false; } };
export const TEST = new URLSearchParams(location.search).has('test') || testFlag();

// the opener's origin, learned from its first answer; until then only the content-free 'tt-ready' goes out
let origin = '*';
export const page = {
  get origin() { return origin; },
  set origin(v) { origin = v; },
  send(m) {
    try { window.opener.postMessage(m, origin); } catch (e) { /* closed */ }
  },
};
