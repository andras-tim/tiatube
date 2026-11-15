// The install page: the supported sites and the main idea, made from the shared texts.
import { gist, siteItems } from '../shared/about.js';

const ul = document.getElementById('sites');
ul.replaceChildren(...siteItems());
ul.after(gist());
// a click instead of a drag: the bookmarklet only works from the bookmarks bar
document.querySelector('.bm').addEventListener('click', (ev) => {
  ev.preventDefault();
  alert('Ne kattints rá: húzd a gombot a könyvjelzősávra.');
});
