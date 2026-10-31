"""Serve untouched legacy and production entries for isolated standalone smoke.

This is not a canonical-state or same-seed visual comparison. The original
programs execute normally against a fresh loopback origin, with browser network
access restricted to this static server. No backend, proxy or model is served.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import unquote, urlsplit

PLUGIN = Path(__file__).resolve().parents[3]
REFERENCE = (PLUGIN.parent / 'neko_survivors/static/game').resolve()
PRODUCTION = (PLUGIN / 'static').resolve()
OUTPUT = PLUGIN / 'frontend/test-results/standalone-visual'
CSP = "; ".join([
    "default-src 'none'", "connect-src 'self'", "frame-src 'none'",
    "frame-ancestors 'none'", "object-src 'none'", "form-action 'none'",
    "base-uri 'self'", "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "media-src 'self' data: blob:", "font-src 'self' data: blob:",
    "worker-src 'self' blob:",
])
ASSET_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
                  '.ogg', '.wav', '.mp3', '.m4a', '.woff', '.woff2', '.ttf', '.otf'}


def output_directory(value):
    directory = Path(value).resolve()
    if not directory.is_relative_to(OUTPUT.resolve()):
        raise ValueError('Outputs must stay under this plugin frontend/test-results/standalone-visual/')
    return directory


def static_target(request_path, reference=REFERENCE, production=PRODUCTION):
    """Resolve only explicit static namespaces; never act as an HTTP proxy."""
    parsed = urlsplit(request_path)
    if parsed.scheme or parsed.netloc or parsed.fragment:
        raise ValueError('Only origin-form static paths are accepted')
    if re.search(r'%(?![a-fA-F0-9]{2})', parsed.path):
        raise ValueError('Malformed path escape')
    path = unquote(parsed.path, errors='strict')
    parts = path.split('/')
    if (not path.startswith('/') or any(part in {'.', '..', 'vendor'} for part in parts)
            or any(character in path for character in ['\\', '\x00', '%'])
            or any(ord(character) < 32 for character in path)):
        raise ValueError('Invalid static path')
    side, separator, relative = path.removeprefix('/').partition('/')
    if not separator or side not in {'legacy', 'react'}:
        return None
    relative = relative or 'index.html'
    suffix = Path(relative).suffix.lower()
    allowed = (relative == 'index.html'
               or side == 'legacy' and relative == 'styles.css'
               or side == 'legacy' and relative.startswith('src/') and suffix == '.js'
               or side == 'react' and relative.startswith('app/') and suffix in {'.js', '.css'}
               or relative.startswith('assets/') and suffix in ASSET_SUFFIXES)
    if not allowed:
        return None
    root = (reference if side == 'legacy' else production).resolve()
    segments = Path(relative).parts
    if any(root.joinpath(*segments[:index]).is_symlink() for index in range(1, len(segments) + 1)):
        return None
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        return None
    return target


def source_metadata(reference=REFERENCE, production=PRODUCTION):
    reference_hashes = {name: hashlib.sha256((reference / name).read_bytes()).hexdigest()
                        for name in ['index.html', 'src/main.js', 'styles.css']}
    index = (production / 'index.html').read_bytes()
    bundles = re.findall(rb'src=["\']\./(app/[^"\'?]+\.js)["\']', index)
    if not bundles:
        raise ValueError('Production index has no built app module')
    production_bundles = []
    for relative_bytes in bundles:
        relative = relative_bytes.decode('utf-8')
        target = static_target('/react/' + relative, reference, production)
        if target is None:
            raise FileNotFoundError('Production app module is missing')
        production_bundles.append({'path': '/react/' + relative,
                                   'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    return {'reference_sha256': reference_hashes,
            'production_index_sha256': hashlib.sha256(index).hexdigest(),
            'production_bundles': production_bundles}


class Audit:
    def __init__(self, directory, metadata):
        self.directory = output_directory(directory)
        self.lock = threading.Lock()
        self.metadata = metadata
        self.counts = {'GET': 0, 'HEAD': 0, 'accepted': 0, 'rejected': 0, 'non_read_methods': 0}

    def record(self, method, path, status, body):
        # Never read/log request bodies, query arguments, cookies or headers.
        event = {'time': time.time(), 'method': method, 'path': path.split('?', 1)[0][:2048],
                 'status': status, 'served_sha256': hashlib.sha256(body).hexdigest() if status == 200 else None}
        with self.lock:
            if method in {'GET', 'HEAD'}:
                self.counts[method] += 1
            else:
                self.counts['non_read_methods'] += 1
            self.counts['accepted' if status == 200 else 'rejected'] += 1
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
                with (self.directory / 'requests.jsonl').open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(event, ensure_ascii=False) + '\n')
                evidence = {**self.metadata, 'pid': os.getpid(), 'counts': dict(self.counts)}
                temporary = self.directory / 'evidence.json.tmp'
                temporary.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                temporary.replace(self.directory / 'evidence.json')
            except OSError:
                # CLI basetemp cleanup or a full log disk must not break assets.
                pass


def build_handler(audit, reference=REFERENCE, production=PRODUCTION):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.0'

        def log_message(self, *_args):
            pass

        def respond(self, status, body, content_type='text/plain; charset=utf-8'):
            self.close_connection = True
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Security-Policy', CSP)
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            if status == 405:
                self.send_header('Allow', 'GET, HEAD')
            audit.record(self.command, self.path, status, body)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_GET(self):
            if self.headers.get('Host') not in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}:
                return self.respond(403, b'Loopback origin required')
            try:
                target = static_target(self.path, reference, production)
            except (ValueError, UnicodeError, OSError):
                return self.respond(403, b'Invalid static path')
            if target is None:
                return self.respond(404, b'Static path not allowed or missing')
            try:
                body = target.read_bytes()
            except OSError:
                return self.respond(404, b'Static file unavailable')
            content_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
            if target.suffix in {'.js', '.css', '.html'}:
                content_type += '; charset=utf-8'
            return self.respond(200, body, content_type)

        def do_HEAD(self):
            self.do_GET()

        def method_not_allowed(self):
            # Close without consuming a body, including unknown/custom methods.
            self.respond(405, b'Read-only standalone static server')

        def __getattr__(self, name):
            if name.startswith('do_'):
                return self.method_not_allowed
            raise AttributeError(name)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default=str(OUTPUT))
    args = parser.parse_args()
    directory = output_directory(args.directory)
    metadata = {'kind': 'untouched-standalone-runtime-smoke', **source_metadata(),
                'scope': 'Normal programs on a new origin; not canonical-state/same-seed parity. No host, SDK, model or proxy.',
                'csp': CSP}
    audit = Audit(directory, metadata)
    server = ThreadingHTTPServer(('127.0.0.1', 0), build_handler(audit))
    server.daemon_threads = True
    base = f'http://127.0.0.1:{server.server_port}'
    info = {**metadata, 'pid': os.getpid(), 'base': base,
            'legacy': base + '/legacy/index.html', 'react': base + '/react/index.html',
            'ready_file': str(directory / 'server.json'), 'log_file': str(directory / 'requests.jsonl'),
            'evidence_file': str(directory / 'evidence.json')}
    try:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'server.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('STANDALONE_VISUAL_READY ' + json.dumps(info, ensure_ascii=False), flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
