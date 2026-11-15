---
name: commit-messages
description: How the repo owner likes git commit messages - read this before writing OR amending any commit in this repo. Format is `<area>: <Capitalized subject>` where area is the component path (e.g. server, web/bookmarklet, web/page, tools/logo, AGENTS.md). Bodies are brief bullet lists (`- ...`), not prose paragraphs, because short lists scan faster. A commit that fixes a mistake from an earlier patch MUST reference that patch (short SHA + its subject). Line length: subject up to 220 chars, every other line up to 120. Never add Co-Authored-By or any attribution/sign-off trailer. Use this skill whenever you are about to commit, write a commit message, amend, reword, squash, or fix up history. Trigger on: git commit, commit message, "make a commit", "commit this", amend, reword, fixup, squash, regression fix.
---

# commit-messages - how the owner likes commits

Read this before writing or amending any commit message in this repo.

## Subject line

`<area>: <Capitalized subject>`

- **area** = the component being changed, as a path. Examples: `server`, `web/bookmarklet`, `web/page`,
  `web/install`, `tools/logo`, `sites.json`, `AGENTS.md`, `.claude/plans`.
- One area / one concern per commit. Split unrelated changes.
- Subject may be long (up to 220 chars) - descriptive is fine.

Examples:

```
web/bookmarklet: Moved the videa source list into the tiaVidea class
server: Added the transcode queue with its position in the job status
.claude/plans: Added the plan of tiaTube 3, client-side capture
```

## Body - brief bullet lists, not prose

Short bullet lists are easier to read and understand than paragraphs. When a commit needs a body, write one point per
line:

```
- what changed, and the why if it isn't obvious
- second point
- third point
```

A subject alone (no body) is fine for trivial changes. Reach for a body when there's a reason worth recording - and
when you do, prefer bullets over a wall of prose.

## Reference the patch a fix regresses

If the commit fixes a mistake an earlier patch introduced, name that patch so history is self-documenting. Lead the
body with it:

```
Fixup of <short-sha> (<that commit's subject>):

- what was wrong
- how this fixes it
```

Find the offending commit with `git log -S<symbol>` / `git blame` / `git log --oneline | grep ...` before writing the
message - guessing the SHA is worse than omitting it.

## Line length

- **Subject (first line):** up to **220** chars.
- **Every other line:** up to **120** chars - wrap longer bullets onto a continuation line rather than overflowing.

## Never add trailers

No `Co-Authored-By`, no `Signed-off-by`, no tool attribution. Just the message.

## Writing multi-line messages non-interactively

`git rebase -i` / editors don't work in the agent harness. Pipe the message in:

```bash
git commit -F - <<'EOF'
server: Streamed the finished file instead of reading it into memory

Fixup of <short-sha> (server: Added the file endpoint):

- a 6 GiB job was read whole into memory before sending
- http.ServeContent streams it and handles range requests too
EOF
```

To reword a non-HEAD commit without `-i`: tag a backup, `git reset --hard <target>`, `git commit --amend -F -`, then
`git cherry-pick` the later commits back on top. Verify with `git diff <backup> HEAD` (empty = content unchanged).

## Rewriting history safely (folds, amends, reorders)

The reset+cherry-pick recipe is powerful and easy to get subtly wrong. Hard-won rules:

- **Check the branch tip before you reset.** `git log --oneline -3` first. If the branch was rebased or moved while
  you were working, the old SHA you were about to `reset --hard` onto is stale, and the reset silently drops the newer
  work. Back up the *current* tip first - `git branch bak-tip HEAD` - so any mistake is one `git reset --hard bak-tip`
  away.
- **`git cherry-pick` has no `-q`.** Passing it prints the usage text and, under `set -e`, aborts the script
  mid-rewrite. Just `git cherry-pick <sha> <sha> ...`.
- **Folding NEW changes into a non-HEAD commit** (not just rewording): back up tip -> stash *only the files you're
  folding* -> reset to target -> pop -> stage -> `--amend` -> cherry-pick the rest:
  ```bash
  git branch bak-tip HEAD
  git stash push -u -- path/to/a path/to/b       # explicit inline paths (see below)
  git reset --hard <target-commit>
  git stash pop
  git add -A path/to/a path/to/b
  git commit --amend -F msg.txt                   # or --no-edit to keep the message
  git cherry-pick <c1> <c2> <c3>                  # the commits that were above <target>
  ```
- **Stash the specific paths, not the whole tree.** `git stash -u` also sweeps unrelated untracked files (build
  output, scratch files). `git stash push -u -- <paths>` moves only what you mean to.
- **Don't build a multi-path pathspec from a multi-line shell variable** - embedded newlines/spaces break
  word-splitting and git sees one bogus pathspec. List the paths inline.
- **Verify by content, not vibes.** After the rewrite, `git diff bak-tip HEAD` should show *exactly* the files you
  meant to touch (a fold: only those; a pure reword: empty). Anything else means you reset onto the wrong base -
  recover from `bak-tip`.

## Validation - always run after git operations

**After every new commit** - show the patch to confirm content and message:
```bash
git show HEAD
```

**After every rebase / history rewrite** - confirm the graph looks right:
```bash
git log --oneline --graph -30
```
Show both outputs to the user so they can validate before moving on.
