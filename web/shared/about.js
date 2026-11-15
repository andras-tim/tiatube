// What tiaTube is, for the window's info view and the install page.
import { SITES, SITE_TEXT } from './sites.js';

const svgNS = 'http://www.w3.org/2000/svg';
const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  return e;
};

// the supported sites with their logos, for a <ul class="sites">
export const siteItems = () => Object.keys(SITES).map((k) => {
  const li = el('li'), svg = document.createElementNS(svgNS, 'svg'), use = document.createElementNS(svgNS, 'use');
  svg.setAttribute('viewBox', '0 0 100 100');
  use.setAttribute('href', `#logo-tia${k}`);
  svg.append(use);
  const txt = el('div');
  txt.append(el('b', SITE_TEXT[k].name), el('br'), el('span', SITE_TEXT[k].what));
  li.append(svg, txt);
  return li;
});

// the main idea
export const gist = () => {
  const p = el('p');
  p.append(el('b', 'A lényeg:'), ' a letöltést a te böngésződ végzi. A szerver csak ott segít, ahol muszáj (összefűzés,'
    + ' MP3); a bejegyzések ZIP-je és a más oldalakról mentett videó teljesen nálad készül.');
  return p;
};
