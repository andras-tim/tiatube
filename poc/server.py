#!/usr/bin/env python3
"""tiaTube MSE PoC server: stores the fragments a bookmarklet captured on youtube.com, then builds an MP3 (and an MKV
when video came too) with ffmpeg. It never talks to YouTube.

usage: python3 -I server.py [port]   (data under ./data next to this file)
"""
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
MAX_FRAG = 16 * 1024 * 1024
MAX_JOB = 3 * 1024 * 1024 * 1024
JOB_TTL = 6 * 3600
RE_JOB = re.compile(r'^[a-f0-9]{16}$')
RE_KEY = re.compile(r'^[a-f0-9]{8}$')

jobs_lock = threading.Lock()
CTYPES = {'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'opus': 'audio/ogg', 'mp4': 'video/mp4', 'mkv': 'video/x-matroska'}


def install_page():
    from html import escape
    from urllib.parse import quote
    with open(os.path.join(HERE, 'bookmarklet.js')) as f:
        src = '\n'.join(l for l in f.read().split('\n') if not l.strip().startswith('//'))
    href = 'javascript:' + quote(src.replace('__TT_ORIGIN__', f'http://127.0.0.1:{PORT}'), safe='')
    return f'''<!doctype html><html lang="hu"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>tiaTube telepítés</title>
<style>body{{font:16px/1.5 sans-serif;max-width:640px;margin:40px auto;padding:0 16px}}
a.bm{{display:inline-block;padding:8px 16px;background:#c00;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold}}</style>
</head><body><h1>tiaTube</h1><ol>
<li>Húzd ezt a gombot a könyvjelzősávra: <a class="bm" href="{escape(href)}">tiaTube</a></li>
<li>Nyiss meg egy videót (YouTube, Facebook, vagy bármely más oldal) vagy egy Facebook-bejegyzést, és kattints a könyvjelzőre.</li>
<li>A megnyíló tiaTube ablakban válaszd ki, mit kérsz.</li></ol></body></html>'''


def job_dir(job):
    return os.path.join(DATA, job)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def set_status(job, **kw):
    path = os.path.join(job_dir(job), 'status.json')
    with jobs_lock:
        st = read_json(path, {})
        st.update(kw)
        st['updated'] = time.time()
        write_json(path, st)


def job_size(job):
    total = 0
    for root, _, files in os.walk(job_dir(job)):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total


def cleanup_old():
    if not os.path.isdir(DATA):
        return
    for j in os.listdir(DATA):
        d = job_dir(j)
        if RE_JOB.match(j) and time.time() - os.path.getmtime(d) > JOB_TTL:
            shutil.rmtree(d, ignore_errors=True)


def safe_name(s):
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', '_', s).strip()
    return s[:150] or 'tiatube'


# ---- build: pick the content fragments of each track, concatenate, run ffmpeg ----

def collect_track(job, track, content_ms):
    """Returns (path of the concatenated track, info) or (None, info)."""
    d = os.path.join(job_dir(job), track)
    if not os.path.isdir(d):
        return None, {'reason': 'nothing received'}
    meta = read_json(os.path.join(d, 'inits.json'), {})
    groups = {}
    for name in os.listdir(d):
        m = re.match(r'^ms(\d+)-([a-f0-9]{8})-(\d+)\.frag$', name)
        if not m or int(m.group(1)) not in content_ms:
            continue
        key, ts = m.group(2), int(m.group(3))
        g = groups.setdefault(key, {})
        g.setdefault(ts, os.path.join(d, name))
    if not groups:
        return None, {'reason': 'no content fragments'}
    # one init (format) per track: the one with the most bytes, fragments of other formats cannot be decoded with it
    key = max(groups, key=lambda k: sum(os.path.getsize(p) for p in groups[k].values()))
    frags = sorted(groups[key].items())
    scale = meta.get(key, {}).get('scale', 1000)
    secs = [ts / scale for ts, _ in frags]
    steps = sorted(b - a for a, b in zip(secs, secs[1:]))
    step = steps[len(steps) // 2] if steps else 0
    gaps = sum(1 for a, b in zip(secs, secs[1:]) if b - a > 2.5 * step + 1)
    ext = meta.get(key, {}).get('ext', 'bin')
    out = os.path.join(job_dir(job), f'{track}.{ext}')
    with open(out, 'wb') as o:
        with open(os.path.join(d, f'init-{key}.bin'), 'rb') as f:
            o.write(f.read())
        for _, p in frags:
            with open(p, 'rb') as f:
                o.write(f.read())
    info = {'format': meta.get(key, {}).get('mime'), 'formats': len(groups), 'frags': len(frags),
            'first': round(secs[0], 2), 'last': round(secs[-1], 2), 'step': round(step, 2), 'gaps': gaps}
    return out, info


def run_ffmpeg(job, args, duration, label):
    cmd = ['ffmpeg', '-nostdin', '-hide_banner', '-v', 'error', '-y', '-progress', 'pipe:1'] + args
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in proc.stdout:
        if line.startswith('out_time_us=') and duration:
            try:
                pct = min(100, int(line.split('=')[1]) / 1e6 / duration * 100)
                set_status(job, step=f'{label}: {pct:.0f}%')
            except ValueError:
                pass
    err = proc.stderr.read()
    if proc.wait() != 0:
        raise RuntimeError(f'{label}: ffmpeg failed: {err.strip()[-500:]}')


def fetch_cover(job, info):
    """The public preview image as cover.jpg, or None: a missing cover never fails the job."""
    url = info.get('thumb')
    if not url:
        return None
    import urllib.request
    src = os.path.join(job_dir(job), 'thumb.img')
    out = os.path.join(job_dir(job), 'cover.jpg')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            if not r.headers.get('Content-Type', '').startswith('image/'):
                return None
            data = r.read(5 * 1048576 + 1)
        if len(data) > 5 * 1048576:
            return None
        with open(src, 'wb') as f:
            f.write(data)
        # webp and friends: a plain JPEG every player shows, at most 1280 px
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', src, '-frames:v', '1',
                        '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', out], check=True, timeout=30)
        return out
    except Exception:  # noqa: BLE001
        return None
    finally:
        if os.path.exists(src):
            os.remove(src)


def build(job):
    try:
        info = read_json(os.path.join(job_dir(job), 'job.json'), {})
        fin = read_json(os.path.join(job_dir(job), 'finish.json'), {})
        dur = float(info.get('duration') or 0)
        content_ms = {int(k) for k, v in fin.get('ms', {}).items() if v and abs(float(v) - dur) < 2}
        set_status(job, state='building', step='fragmentek összerakása')
        audio, ainfo = collect_track(job, 'audio', content_ms)
        video, vinfo = collect_track(job, 'video', content_ms)
        set_status(job, audio=ainfo, video=vinfo)
        if not audio:
            raise RuntimeError('nincs hang')
        base = safe_name(f"{info.get('prefix', '')} {info.get('title', '')} [{info.get('videoId', '')}]")
        meta = ['-metadata', f"title={info.get('title', '')}", '-metadata', f"artist={info.get('author') or 'tiaTube'}",
                '-metadata', f"comment={info.get('url', '')}"] + (['-metadata', f"date={info['date']}"] if info.get('date') else [])
        set_status(job, step='borítókép')
        cover = fetch_cover(job, info)
        fmt, a_is_mp4 = info.get('format'), audio.endswith('.mp4')
        if info.get('what') == 'video':
            if not video:
                raise RuntimeError('nincs kép')
            if fmt == 'mp4':
                ext = 'mp4'
                acodec = ['-c:a', 'copy'] if a_is_mp4 else ['-c:a', 'aac', '-b:a', '192k']
                args = ['-i', video, '-i', audio] + (['-i', cover] if cover else []) + ['-map', '0:v:0', '-map', '1:a:0']
                args += (['-map', '2:v:0', '-c:v:1', 'copy', '-disposition:v:1', 'attached_pic'] if cover else [])
                args += ['-c:v:0', 'copy'] + acodec + ['-movflags', '+faststart']
            else:
                ext = 'mkv'
                args = ['-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy']
                args += ['-attach', cover, '-metadata:s:t:0', 'mimetype=image/jpeg', '-metadata:s:t:0', 'filename=cover.jpg'] if cover else []
        elif fmt == 'orig':
            ext = 'm4a' if a_is_mp4 else 'opus'
            # the ogg muxer takes no picture: opus goes without a cover
            pic = bool(cover and a_is_mp4)
            args = ['-i', audio] + (['-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic'] if pic else ['-vn'])
            args += ['-c:a', 'copy'] + (['-movflags', '+faststart'] if a_is_mp4 else [])
        else:
            ext = 'mp3'
            args = ['-i', audio] + (['-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic',
                                     '-metadata:s:v', 'comment=Cover (front)'] if cover else ['-vn'])
            args += ['-c:a', 'libmp3lame', '-q:a', '0', '-id3v2_version', '3']
        run_ffmpeg(job, args + meta + [os.path.join(job_dir(job), f'out.{ext}')], dur, ext.upper())
        files = {ext: f'{base}.{ext}'}
        # the last fragment starts at 'last' and is about 'step' long
        complete = all(i and i.get('gaps') == 0 and i.get('first', 99) < 1 and i.get('last', 0) + i.get('step', 0) * 1.5 >= dur - 1
                       for i in [ainfo] + ([vinfo] if info.get('what') == 'video' else []))
        set_status(job, state='done', step='kész', files=files, complete=complete)
    except Exception as e:  # noqa: BLE001 - the page shows it
        set_status(job, state='error', step=str(e))


# ---- HTTP ----

class Handler(BaseHTTPRequestHandler):
    server_version = 'tiatube-poc'

    def log_message(self, fmt, *args):
        if '/api/frag' not in (args[0] if args else ''):
            sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))

    def send(self, code, body=b'', ctype='application/json', headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def body(self, limit):
        n = int(self.headers.get('Content-Length') or 0)
        if n > limit:
            raise ValueError('too large')
        return self.rfile.read(n)

    def q(self):
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/index.html'):
            with open(os.path.join(HERE, 'page.html'), 'rb') as f:
                return self.send(200, f.read(), 'text/html; charset=utf-8')
        if path == '/install':
            return self.send(200, install_page(), 'text/html; charset=utf-8')
        q = self.q()
        job = q.get('job', '')
        if not RE_JOB.match(job) or not os.path.isdir(job_dir(job)):
            return self.send(404, {'error': 'no such job'})
        if path == '/api/status':
            return self.send(200, read_json(os.path.join(job_dir(job), 'status.json'), {}))
        if path == '/api/file':
            kind = q.get('f')
            st = read_json(os.path.join(job_dir(job), 'status.json'), {})
            p = os.path.join(job_dir(job), f'out.{kind}')
            if kind not in CTYPES or not os.path.isfile(p):
                return self.send(404, {'error': 'no file'})
            name = st.get('files', {}).get(kind, f'tiatube.{kind}')
            with open(p, 'rb') as f:
                data = f.read()
            ascii_name = name.encode('ascii', 'replace').decode().replace('"', '_')
            from urllib.parse import quote
            return self.send(200, data, CTYPES[kind], {
                'Content-Disposition': f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"})
        return self.send(404, {'error': 'not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        q = self.q()
        try:
            if path == '/api/job':
                cleanup_old()
                info = json.loads(self.body(64 * 1024))
                job = secrets.token_hex(8)
                os.makedirs(job_dir(job))
                write_json(os.path.join(job_dir(job), 'job.json'), {
                    'videoId': str(info.get('videoId', ''))[:32], 'title': str(info.get('title', ''))[:300],
                    'author': str(info.get('author', ''))[:200],
                    'date': str(info.get('date', '')) if re.match(r'^\d{4}-\d{2}-\d{2}$', str(info.get('date', ''))) else '',
                    'prefix': str(info.get('prefix', '')) if re.match(r'^(\d{4}-\d{2}-\d{2}|\d{8}-\d{6})$', str(info.get('prefix', ''))) else '',
                    'url': str(info.get('url', ''))[:1000] if str(info.get('url', '')).startswith('https://') else '',
                    'thumb': str(info.get('thumb', ''))[:2000] if str(info.get('thumb', '')).startswith('https://') else '',
                    'duration': float(info.get('duration') or 0),
                    'what': 'video' if info.get('what') == 'video' else 'audio',
                    'format': info.get('format') if info.get('format') in ('mp3', 'orig', 'mp4', 'mkv') else 'mp3'})
                set_status(job, state='receiving', step='adatok fogadása', created=time.time())
                return self.send(200, {'job': job})

            if path == '/api/debug-zip':
                # PoC test only: the ZIP a test run built in the browser, kept for checking
                data = self.body(2 << 30)
                with open(os.path.join(DATA, 'debug.zip'), 'wb') as f:
                    f.write(data)
                return self.send(200, {'bytes': len(data)})

            job = q.get('job', '')
            if not RE_JOB.match(job) or not os.path.isdir(job_dir(job)):
                return self.send(404, {'error': 'no such job'})

            if path == '/api/frag':
                track, kind, key = q.get('track'), q.get('kind'), q.get('key', '')
                if track not in ('audio', 'video') or kind not in ('init', 'frag') or not RE_KEY.match(key):
                    return self.send(400, {'error': 'bad params'})
                data = self.body(MAX_FRAG)
                if job_size(job) + len(data) > MAX_JOB:
                    return self.send(413, {'error': 'job too large'})
                d = os.path.join(job_dir(job), track)
                os.makedirs(d, exist_ok=True)
                if kind == 'init':
                    if hashlib.sha256(data).hexdigest()[:8] != key:
                        return self.send(400, {'error': 'init key mismatch'})
                    with open(os.path.join(d, f'init-{key}.bin'), 'wb') as f:
                        f.write(data)
                    with jobs_lock:
                        meta_p = os.path.join(d, 'inits.json')
                        meta = read_json(meta_p, {})
                        mime = q.get('mime', '')[:100]
                        meta[key] = {'mime': mime, 'scale': int(q.get('scale') or 1000),
                                     'ext': 'mp4' if 'mp4' in mime else 'webm'}
                        write_json(meta_p, meta)
                else:
                    ms, ts = int(q.get('ms', '-1')), int(q.get('ts', '-1'))
                    if ms < 0 or ts < 0:
                        return self.send(400, {'error': 'bad params'})
                    with open(os.path.join(d, f'ms{ms}-{key}-{ts:015d}.frag'), 'wb') as f:
                        f.write(data)
                return self.send(200, {'ok': True})

            if path == '/api/finish':
                fin = json.loads(self.body(64 * 1024))
                write_json(os.path.join(job_dir(job), 'finish.json'), fin)
                threading.Thread(target=build, args=(job,), daemon=True).start()
                return self.send(200, {'ok': True})
        except (ValueError, OSError) as e:
            return self.send(400, {'error': str(e)})
        return self.send(404, {'error': 'not found'})


if __name__ == '__main__':
    os.makedirs(DATA, exist_ok=True)
    print(f'tiatube PoC on http://127.0.0.1:{PORT}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
