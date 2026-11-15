// The tiaTube bookmarklet: the site's class finds the media on this page and opens the tiaTube window; any site
// without its own class is tiaWeb. The build puts the server's origin in place of __TT_ORIGIN__.
import { siteOf } from '../shared/sites.js';
import { TiaWeb } from './core/tiaweb.js';
import { TiaTube } from './sites/youtube.js';
import { TiaFace } from './sites/facebook.js';
import { TiaVidea } from './sites/videa.js';

const CLASSES = { tube: TiaTube, face: TiaFace, videa: TiaVidea };
const site = siteOf(location.hostname);
new (CLASSES[site] || TiaWeb)('__TT_ORIGIN__', site).run();
