// Runs in <head>: the site in the URL (?s=) gives the color and the logo of the first paint.
import { SITES } from '../shared/sites.js';

const s = new URLSearchParams(location.search).get('s');
const site = SITES[s] ? s : 'tube';
document.documentElement.dataset.site = site;
document.documentElement.style.setProperty('--c', SITES[site].color);
