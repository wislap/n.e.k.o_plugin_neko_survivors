"""Optional loopback benchmark launcher for production assets and natural saves.

No platform routes, SDK bootstrap, private config, user model or network proxy.
Each random-port origin receives only the explicitly selected benchmark save.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit

FRONTEND = Path(__file__).resolve().parents[2]
PLUGIN = FRONTEND.parent
STATIC = PLUGIN / 'static'
RESULTS = FRONTEND / 'test-results'
FIXTURES = RESULTS / 'performance-fixtures'
BROWSER = RESULTS / 'browser-fixtures'


def contained_file(value: str, directory: Path) -> Path:
    file = Path(value).resolve()
    if not file.is_relative_to(directory.resolve()) or file == directory.resolve():
        raise ValueError(f'Path must stay under {directory}')
    return file


def load_fixture(file: Path) -> dict:
    # Read the entire explicit file. Never discover or import an arbitrary save.
    fixture = json.loads(file.read_text(encoding='utf-8'))
    if not isinstance(fixture, dict) or fixture.get('kind') != 'neko-survivors-react-natural-profile' or fixture.get('version') != 1:
        raise ValueError('Not a generated natural benchmark fixture')
    metadata, save, meta = fixture.get('metadata'), fixture.get('save'), fixture.get('meta')
    if not isinstance(metadata, dict) or not isinstance(save, dict) or not isinstance(meta, dict):
        raise ValueError('Fixture must contain metadata, save and meta objects')
    if save.get('format') != 'neko-survivors-react' or save.get('version') != 2 or not isinstance(save.get('run'), dict):
        raise ValueError('Fixture must contain a production exportSave envelope')
    if metadata.get('seed') != 69 or metadata.get('phase') != 'shop' or metadata.get('partySize') not in [1, 2, 3, 4] or metadata.get('difficulty') not in ['normal', 'nightmare']:
        raise ValueError('Unsupported benchmark metadata')
    if not isinstance(metadata.get('naturalSteps'), int) or metadata['naturalSteps'] <= 0:
        raise ValueError('Fixture requires natural progression steps')
    wave = metadata.get('targetWave')
    run = save['run']
    if not isinstance(wave, int) or not 1 <= wave <= 19 or run.get('phase') != 'shop' or run.get('waveIndex') != wave - 1:
        raise ValueError('Fixture is not the declared shop checkpoint')
    if run.get('seed') != metadata['seed'] or run.get('difficulty') != metadata['difficulty']:
        raise ValueError('Fixture identity does not match the exported run')
    mates = run.get('mates', [])
    if not isinstance(mates, list) or len(mates) + 1 != metadata['partySize']:
        raise ValueError('Fixture party size does not match the exported run')
    return fixture


def json_script(value: object) -> str:
    # Prevent a filename/description/save string terminating an inline script.
    return json.dumps(value, ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


def launch_html(index: str, fixture: dict) -> bytes:
    metadata = fixture['metadata']
    label = f"PERFORMANCE FIXTURE · {metadata['difficulty']} · {metadata['partySize']}P · shop {metadata.get('targetWave')} · seed 69 · standalone / no SDK"
    bootstrap = '''<script>
(() => {
  const benchmark = %s;
  localStorage.setItem('neko_survivors_react:run:v2', JSON.stringify(benchmark.save));
  localStorage.setItem('neko_survivors_react:meta:v2', JSON.stringify(benchmark.meta));
  const url = new URL(location.href);
  url.searchParams.set('diagnostics', '1');
  history.replaceState(null, '', url);
  window.addEventListener('DOMContentLoaded', () => {
    const mark = document.createElement('aside');
    mark.id = 'performance-fixture-marker';
    mark.textContent = %s;
    mark.style.cssText = 'position:fixed;top:2px;right:2px;max-width:330px;padding:5px;background:#4b173bdd;color:#fff;font:11px monospace;z-index:2147483647;pointer-events:none';
    document.body.appendChild(mark);
  }, { once: true });
})();
</script>''' % (json_script({'save': fixture['save'], 'meta': fixture['meta']}), json_script(label))
    if '<head>' not in index:
        raise ValueError('Production index has no head insertion point')
    return index.replace('<head>', '<head>\n' + bootstrap, 1).encode('utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--ready-file', required=True)
    parser.add_argument('--log-file', required=True)
    parser.add_argument('--allow-page-cache', action='store_true',
                        help='Standalone page-lifecycle QA only; permit native BFCache eligibility instead of benchmark no-store')
    args = parser.parse_args()
    fixture_file = contained_file(args.fixture, FIXTURES)
    ready = contained_file(args.ready_file, BROWSER)
    log = contained_file(args.log_file, BROWSER)
    if len({fixture_file, ready, log}) != 3:
        raise ValueError('Fixture, ready and log paths must differ')
    fixture = load_fixture(fixture_file)
    page = launch_html((STATIC / 'index.html').read_text(encoding='utf-8'), fixture)
    for output in [ready, log]:
        output.parent.mkdir(parents=True, exist_ok=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *values):
            try:
                log.parent.mkdir(parents=True, exist_ok=True)
                with log.open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps({'request': self.path, 'message': fmt % values}) + '\n')
            except OSError as error:
                print(f'PROFILE_FIXTURE_LOG_WARNING {error}', flush=True)

        def response(self, data: bytes, media='text/plain; charset=utf-8', status=200):
            self.send_response(status)
            self.send_header('Content-Type', media)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'private, max-age=60' if args.allow_page_cache else 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            requested = unquote(urlsplit(self.path).path)
            if requested in ['/', '/index.html']:
                return self.response(page, 'text/html; charset=utf-8')
            if requested == '/health':
                return self.response(b'{"ok":true,"fixture":"natural-game-profile-only"}', 'application/json')
            segments = requested.split('/')
            if '\\' in requested or '\x00' in requested or any(part in ['.', '..'] for part in segments):
                return self.response(b'forbidden', status=403)
            if len(segments) < 3 or segments[0] != '' or segments[1] not in ['app', 'assets']:
                return self.response(b'not found', status=404)
            file = (STATIC / requested.lstrip('/')).resolve()
            if not file.is_relative_to(STATIC.resolve() / segments[1]) or not file.is_relative_to(STATIC.resolve()):
                return self.response(b'forbidden', status=403)
            if not file.is_file():
                return self.response(b'not found', status=404)
            try:
                content = file.read_bytes()
            except OSError:
                return self.response(b'unavailable', status=404)
            media = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
            return self.response(content, media)

        def do_POST(self):
            self.response(b'no game host or paid endpoints in this fixture', status=405)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    base = f'http://127.0.0.1:{server.server_port}'
    info = {'fixture': 'natural-production-game-profile', 'base': base, 'page': base + '/?diagnostics=1',
            'page_cache': 'standalone-lifecycle-private-60s' if args.allow_page_cache else 'benchmark-no-store',
            'health': base + '/health', 'fixture_file': str(fixture_file), 'metadata': fixture['metadata'],
            'log_file': str(log), 'asset_roots': ['static/app', 'static/assets'],
            'instructions': 'This new origin contains an explicit benchmark save. Choose Continue on the production title screen; pilot naturally leaves the shop.'}
    ready.write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('PROFILE_FIXTURE_READY ' + json.dumps(info, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
