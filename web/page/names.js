// File names: the one place of the naming rule (the server only refuses an unsafe name).
import { pad, val } from './ui.js';

// the publish time as a file name prefix, in the viewer's time zone
export const stamp = (sec, f) => {
  if (!sec || f === 'none') return '';
  const d = new Date(sec * 1000);
  const day = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())];
  return f === 'date' ? day.join('-') : `${day.join('')}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};
export const PREFIX = { none: 'dátum nélkül', date: 'Dátum előtag', stamp: 'Dátum-idő előtag', today: 'Mai nap előtag' };

export const safeName = (t) => t.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim();

// the chosen prefix: another site gives no date, there it can only be today
export const prefixOf = (i) => (i.kind === 'web' ? (val('dfmt') === 'today' ? stamp(Date.now() / 1000, 'date') : '')
  : stamp(i.ts, val('dfmt')));

// "<prefix> <title> [<id>]", without the extension
export const baseName = (prefix, title, id) => safeName(`${prefix} ${title} [${id}]`);
