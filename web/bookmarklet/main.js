// The tiaTube bookmarklet: the site's class finds the media on this page and opens the tiaTube window; any site
// without its own class is tiaWeb. The server puts its origin in place of __TT_ORIGIN__. A failure on the way (e.g. a
// changed site) shows the box with the way to a new bookmarklet.
import { siteOf } from '../shared/sites.js';
import { TiaWeb, trouble } from './core/tiaweb.js';
import { TiaTube } from './sites/youtube.js';
import { TiaFace } from './sites/facebook.js';
import { TiaVidea } from './sites/videa.js';

const CLASSES = { tube: TiaTube, face: TiaFace, videa: TiaVidea };
const site = siteOf(location.hostname);
try {
  new (CLASSES[site] || TiaWeb)('__TT_ORIGIN__', site).run();
} catch (err) {
  // one box on the page: an earlier run's, unless it still captures
  const prev = window.__tiatube;
  trouble('__TT_ORIGIN__', err, prev && !prev.capturing && prev.ui?.isConnected ? prev.ui : undefined);
}
