// What differs between the sites in the window; everything else is common.
export const PARTS = {
  tube: {
    connect: 'Kapcsolódás a videó füléhez',
    capture: (what) => `${what === 'video' ? 'Rögzítés' : 'Hang rögzítése'} (16x gyorsítással)`,
    // MP4 copies H.264, which YouTube has up to 1080p only
    mp4Max: ['hd2160', 'hd1440'],
  },
  face: {
    connect: 'Kapcsolódás a Facebook-fülhöz',
    capture: () => 'Letöltés a Facebookról',
    mp4Max: [],
  },
};
