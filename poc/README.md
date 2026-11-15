# Proof of concept

The working prototype that version 3 grows from: a bookmarklet, the tiaTube window and a Python test server. It is
split into the final components step by step (see `.claude/plans/`); this directory goes away when that is done.

Run it on a local machine only (the server has no limits and a test-only upload endpoint):

```sh
python3 -I poc/server.py 8765   # then open http://127.0.0.1:8765/install
```
