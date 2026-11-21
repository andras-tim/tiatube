// What to do when something does not work. Only the window knows the bookmarklet's age (a dragged one never changes,
// the window comes fresh from the server): an outdated one is asked for the new one, a current one to try again.
import { st } from './state.js';
import { el } from './ui.js';

export const installLink = (text) => {
  const a = el('a', null, text);
  a.href = './';
  a.target = '_blank';
  return a;
};

// the advice after a failure, as the parts of a warning or a result
export const advice = () => (st.age
  ? ['Lehet, hogy az elavult könyvjelző miatt: ', installLink('hozd létre újra a tiaTube oldalán'), '.']
  : ['Töltsd újra a videó oldalát, és kattints újra a könyvjelzőre.']);
