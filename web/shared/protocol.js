// The messages between the bookmarklet (on the video page) and the tiaTube window, and the limits they share.
export const MSG = {
  READY: 'tt-ready', // window: asks for the hello until it comes; carries nothing
  HELLO: 'tt-hello', // page: what it has
  RESCAN: 'tt-rescan', // window: list the page's videos again
  START: 'tt-start', // window: the user's choice
  CANCEL: 'tt-cancel', // window: stop
  ACK: 'tt-ack', // window: these bytes are done with (flow control)
  PROGRESS: 'tt-progress', // page: text and 0..1 of the work on the page
  FRAG: 'tt-frag', // page: a captured init segment or fragment, for the server
  ITEM: 'tt-item', // page: one photo or video of a post
  ITEM_FAILED: 'tt-item-failed',
  HEAD: 'tt-head', // page: type and length of a file that streams to the window
  CHUNK: 'tt-chunk', // page: the next bytes of that file
  END: 'tt-end', // page: all sent
  ERROR: 'tt-error',
};

export const WINDOW = { name: 'tiatube', features: 'width=520,height=440' };
// bytes on the way from the page to the window, not acknowledged yet
export const INFLIGHT_MAX = 64 * 1048576;
// one message of a file that streams to the window
export const CHUNK_SIZE = 2 * 1048576;
