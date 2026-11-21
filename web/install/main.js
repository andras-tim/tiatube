// The install page: a greeting, the main idea and the arrow to the bookmarks bar.
import { gist } from '../shared/about.js';
import { BOOKMARKLET } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);

// the old page greeted with one of these, picked at random
const HELLOS = ['Ahoy!', 'Üdvözlet!', 'Hali!', 'Szia!', 'Szeva!'];
$('hello').textContent = HELLOS[Math.floor(Math.random() * HELLOS.length)];

if (/Mac|iPhone|iPad/.test(navigator.platform)) $('bar-keys').textContent = 'Cmd+Shift+B';

document.querySelector('.how').after(gist());

// the bookmark gets the button's name: its number tells the latest one in the bookmarks bar
document.querySelector('.bm').textContent = `tiaTube v${BOOKMARKLET}`;

// a click instead of a drag: the bookmarklet only works from the bookmarks bar
document.querySelector('.bm').addEventListener('click', (ev) => {
  ev.preventDefault();
  alert('Ne kattints rá: húzd a gombot a könyvjelzősávra.');
});

// from the button's left side out of the card, then up to the top of the page; no room beside the card, no arrow
const arrow = $('arrow');
const drawArrow = () => {
  const card = document.querySelector('.card').getBoundingClientRect();
  const btn = document.querySelector('.bm').getBoundingClientRect();
  const left = card.left + scrollX;
  arrow.hidden = left < 90;
  if (arrow.hidden) return;
  const sx = btn.left + scrollX - 8, sy = btn.top + scrollY + btn.height / 2, ex = left - 46;
  arrow.setAttribute('width', sx + 8);
  arrow.setAttribute('height', sy + 8);
  $('arrow-path').setAttribute('d', `M${sx} ${sy}C${left - 70} ${sy} ${ex - 14} ${sy * 0.45} ${ex} 12`);
};
drawArrow();
addEventListener('resize', drawArrow);
document.fonts?.ready.then(drawArrow);
