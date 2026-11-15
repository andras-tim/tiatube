// The sites of sites.json, and what the window and the install page say about them.
import SITES from '../../sites.json';

export { SITES };

// the site of a host name; any other host is tiaWeb
export const siteOf = (hostname) => Object.keys(SITES).find((k) => SITES[k].hosts
  .some((h) => hostname === h || hostname.endsWith(`.${h}`))) || 'web';

export const SITE_TEXT = {
  tube: { name: 'YouTube', what: 'csak hang (MP3) vagy kép és hang, akár 4K' },
  face: { name: 'Facebook', what: 'videó, reel, és egy bejegyzés összes képe és videója egy ZIP-ben' },
  videa: { name: 'videa.hu', what: 'a lejátszó minden minősége' },
  web: { name: 'Más oldalak', what: 'a HTML5 videók egybefüggő fájlként' },
};
