"""Isolated static-server contracts; no NEKO import, backend or browser."""
from contextlib import contextmanager
import hashlib
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import runpy
import tempfile
import threading

import pytest

PLUGIN = Path(__file__).resolve().parents[1]
QA = runpy.run_path(str(PLUGIN / 'frontend/tests/e2e/standalone-visual-server.py'))


@contextmanager
def isolated_server():
    output = QA['OUTPUT'] / 'unit-tests'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as temporary:
        directory = Path(temporary)
        reference, production = directory / 'legacy', directory / 'react'
        for root in [reference, production]:
            (root / 'assets').mkdir(parents=True)
            (root / 'assets/test.png').write_bytes(b'\x89PNG\r\n\x1a\nfixture')
            (root / 'assets/private.json').write_text('{"private":true}')
            (root / 'index.html').write_bytes(b'<!doctype html><script type="module" src="./app/hash.js"></script>')
        (reference / 'src').mkdir()
        (reference / 'src/main.js').write_bytes(b'// unchanged original main\n')
        (reference / 'styles.css').write_bytes(b'body {color:red}\n')
        (production / 'app').mkdir()
        (production / 'app/hash.js').write_bytes(b'// unchanged production module\n')
        (production / 'app/hash.css').write_bytes(b'body {color:blue}\n')
        outside = directory / 'not-static.js'
        outside.write_text('not served')
        (reference / 'src/escape.js').symlink_to(outside)
        (reference / 'src/hidden.js').symlink_to(reference / 'assets/private.json')
        audit = QA['Audit'](directory, {'kind': 'isolated-static-test'})
        server = ThreadingHTTPServer(('127.0.0.1', 0), QA['build_handler'](audit, reference, production))
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        thread.start()
        try:
            yield server, audit, reference, production, directory
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
            assert not thread.is_alive()


def request(server, path, method='GET', headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
    try:
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def test_original_bytes_headers_head_and_audit():
    with isolated_server() as (server, audit, reference, production, directory):
        for path, file in [('/legacy/index.html', reference / 'index.html'),
                           ('/legacy/src/main.js?v=0.4.18', reference / 'src/main.js'),
                           ('/legacy/styles.css', reference / 'styles.css'),
                           ('/react/index.html', production / 'index.html'),
                           ('/react/app/hash.js', production / 'app/hash.js'),
                           ('/react/app/hash.css', production / 'app/hash.css'),
                           ('/react/assets/test.png', production / 'assets/test.png')]:
            status, headers, body = request(server, path)
            assert status == 200 and body == file.read_bytes()
            assert headers['Content-Security-Policy'] == QA['CSP']
            assert "connect-src 'self'" in headers['Content-Security-Policy']
            assert "frame-src 'none'" in headers['Content-Security-Policy']
            assert "script-src 'self' 'unsafe-eval'" in headers['Content-Security-Policy']
            assert "worker-src 'self' blob:" in headers['Content-Security-Policy']
            assert headers['Cross-Origin-Opener-Policy'] == 'same-origin'
            assert headers['X-Frame-Options'] == 'DENY'
            assert 'Access-Control-Allow-Origin' not in headers
        status, headers, body = request(server, '/react/index.html', method='HEAD')
        assert status == 200 and body == b''
        assert int(headers['Content-Length']) == len((production / 'index.html').read_bytes())
        evidence = json.loads((directory / 'evidence.json').read_text())
        assert evidence['counts'] == {'GET': 7, 'HEAD': 1, 'accepted': 8, 'rejected': 0, 'non_read_methods': 0}
        assert audit.counts == evidence['counts']
        events = [json.loads(line) for line in (directory / 'requests.jsonl').read_text().splitlines()]
        assert events[1]['path'] == '/legacy/src/main.js'
        assert events[1]['served_sha256'] == hashlib.sha256((reference / 'src/main.js').read_bytes()).hexdigest()


@pytest.mark.parametrize('path', ['/api/characters', '/security/csrf-token', '/plugin/neko_survivors/ui-info',
    '/legacy/vendor/model/current.json', '/react/vendor/sdk.js', '/react/src/main.js',
    '/legacy/assets/private.json', '/react/app/hash.js.map', '/react/app/file.html',
    '/legacy/src/escape.js', '/legacy/src/hidden.js', '/legacy/%2e%2e/index.html', '/react/assets/%2e%2e/app/hash.js',
    '/legacy/src/..%5cmain.js', '/legacy/%252e%252e/index.html', '/legacy/%00index.html',
    'http://127.0.0.1:48911/api/characters', '//127.0.0.1:48916/health'])
def test_strict_whitelist_never_proxies_or_escapes(path):
    with isolated_server() as (server, audit, *_rest):
        status, headers, _body = request(server, path)
        assert status in {403, 404}
        assert headers['Content-Security-Policy'] == QA['CSP']
        assert audit.counts['rejected'] == 1 and audit.counts['accepted'] == 0


@pytest.mark.parametrize('method', ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE', 'BREW'])
def test_all_non_read_methods_close_without_reading_a_body(method):
    with isolated_server() as (server, audit, *_rest):
        # A large declared body is never sent; reading it would make this time out.
        status, headers, _body = request(server, '/react/index.html', method,
                                         {'Content-Length': '1000000'})
        assert status == 405 and headers['Allow'] == 'GET, HEAD'
        assert headers['Connection'] == 'close'
        assert headers['Content-Security-Policy'] == QA['CSP']
        assert audit.counts['non_read_methods'] == 1 and audit.counts['rejected'] == 1


def test_bad_host_and_output_escape_are_rejected():
    with isolated_server() as (server, _audit, _reference, production, directory):
        assert request(server, '/react/index.html', headers={'Host': 'untrusted.example'})[0] == 403
        with pytest.raises(ValueError, match='Outputs must stay'):
            QA['output_directory'](production.parent.parent.parent.parent.parent)
        metadata = QA['source_metadata'](directory / 'legacy', production)
        assert metadata['production_bundles'][0]['path'] == '/react/app/hash.js'
        assert set(metadata['reference_sha256']) == {'index.html', 'src/main.js', 'styles.css'}


def test_real_source_metadata_reads_untouched_static_files_only():
    metadata = QA['source_metadata']()
    assert all(len(value) == 64 for value in metadata['reference_sha256'].values())
    assert metadata['production_bundles'] and all(entry['path'].startswith('/react/app/')
                                                 for entry in metadata['production_bundles'])
