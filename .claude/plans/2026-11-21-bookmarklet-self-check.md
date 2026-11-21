# Bookmarklet self-check and numbered bookmarklets

## Goal

A dragged bookmarklet is frozen: a bug in it, or a change of a site, is never fixed in it. When it does not work, the
user must learn that, and that a new one may help, instead of a window that waits forever (3.0.0 behind a path: the
bookmarklet dropped the window's messages). The user must also know which bookmarklet is the latest one.

## Why not a loader bookmarklet

Decided in [the v3 plan](2026-11-15-client-side-revamp.md) (2026-11-16): YouTube's Trusted Types and Facebook's CSP
block a script loaded from another origin, and `eval`. A hybrid (fresh code through the window, run with the page's
nonce and a Trusted Types policy, the embedded code as fallback) is untested; a browser extension would always be
fresh. Both stay open; this plan makes a frozen bookmarklet tell when it is broken.

## Design

### Where a check lives

The window comes fresh from the server on every click, so a check there covers every bookmarklet dragged before. The
bookmarklet gets only what the window cannot see: a failure before the window opens, and a window it cannot hear.

| failure | seen by | reaction |
|---|---|---|
| the window opens, no video comes | window: no hello in 10 s | the title says the video page does not answer, with the advice below |
| a run fails | window: `fail()` | the result gets the advice below |
| a run stalls | window: no message from the page and no server status for 60 s | a warning with the advice below |
| an error in the window's own code | window: `error`, `unhandledrejection` | during a run: `fail()`; before: a warning |
| the bookmarklet fails before the window opens (e.g. a site changed) | bookmarklet: `try`/`catch` around the run | the page's tiaTube box: the error and a link to the install page |
| the bookmarklet hears nothing from the window | bookmarklet: no message from the window in 10 s, origin not checked | the same box and link |
| a blocked popup | bookmarklet | the alert it has today |

The advice depends on the bookmarklet's age, which only the window knows: an outdated one is asked to get the new one
(a link to the install page); a current one is asked to reload the video page and try again. The bookmarklet cannot
know its age, so its box always offers the install page.

The box uses a link, not a `confirm()`: a click on a link opens the page for sure, a `window.open` after a dialog may
be blocked as a popup.

### Numbered bookmarklets

- `BOOKMARKLET` in `web/shared/protocol.js`: an integer, raised with every change of the bookmarklet's build. The
  bookmarklet sends it to the window (`n=`); the window compares it with its own copy. A bookmarklet without `n`
  (3.0.x) is number 0.
- The install page names the button `tiaTube v<n>`: the browser names the bookmark after it, so the bookmarks bar
  shows which one is which. One short line asks to delete the older tiaTube bookmarks.
- The window always shows the number of the bookmarklet that opened it: current, or outdated with the link.
- The build hash (`__TT_VERSION__`, filled by the server) goes: the number replaces it.
- A forgotten raise is caught by `make check-bookmarklet` (part of `make ci`): `web/bookmarklet/builds.txt` holds one
  `<number> <hash of the built bookmarklet.js>` line per number, the last one is the current number, and the current
  build's hash must be on it.

`PROTOCOL` stays: it still refuses a bookmarklet the window can no longer work with; the number only tells new from
old.

## Steps

1. The window's checks and the number display.
2. The bookmarklet's `try`/`catch`, watchdog and box; `BOOKMARKLET = 1`, `builds.txt`, `check-bookmarklet`.
3. The install page: button name, the line about the older bookmarks.
4. Test in a desktop Chrome: a current and a 3.0.1 bookmarklet on YouTube; a bookmarklet with a forced failure
   (before the window, no answer); `make ci`.
5. Release 3.1.0, then the deployment.

## State

- 2026-11-21: designed with the owner, not started.
