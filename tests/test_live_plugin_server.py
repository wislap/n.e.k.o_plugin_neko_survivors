"""Explicit opt-in HTTP verification of the read-model-only private QA server.

Normal pytest runs skip this: a live main host is never contacted implicitly.
Run against the ready file printed by frontend/tests/e2e/live_plugin_server.py.
"""
import json
import asyncio
import os
from pathlib import Path
import re
import runpy
import urllib.error
import urllib.request

import pytest

READY = os.environ.get('NEKO_LIVE_PLUGIN_QA_READY')
PLUGIN = Path(__file__).resolve().parents[1]
PID = 'neko_survivors_react'


@pytest.mark.skipif(not READY, reason='Requires explicitly running isolated read-model QA server')
def test_actual_private_host_and_public_security_routes():
    ready = Path(READY).resolve()
    assert ready.is_relative_to(PLUGIN / 'frontend/test-results/browser-fixtures')
    info = json.loads(ready.read_text())
    base = info['base']
    assert re.fullmatch(r'http://127\.0\.0\.1:\d+', base)
    checks = []
    def request(path, *, method='GET', payload=None, headers=None, expected=200):
        body = json.dumps(payload).encode() if payload is not None else None
        combined = {'Origin': base, **(headers or {})}
        if body is not None: combined['Content-Type'] = 'application/json'
        try:
            with urllib.request.urlopen(urllib.request.Request(base + path, data=body, headers=combined, method=method), timeout=90) as response:
                status, content = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, content = error.code, error.read()
        checks.append({'path': path, 'method': method, 'http': status, 'expected': expected})
        assert status == expected, f'{method} {path}: HTTP {status}, expected {expected}'
        return content
    before = json.loads(request('/qa/status'))
    assert not before['private_host_alive']
    assert before['main']['manager']['status'] == 'stopped'
    html = request('/').decode()
    nonce = json.loads(re.search(r'const nonce=("[^"]+");', html).group(1))
    token = json.loads(request('/security/csrf-token'))['csrf_token']
    trusted = {'X-CSRF-Token': token, 'X-QA-Nonce': nonce}
    for headers in [{}, {'X-CSRF-Token': token}, {**trusted, 'Origin': 'https://untrusted.example'}]:
        request('/qa/start', method='POST', headers=headers, expected=403)
    action_root = f'/plugin/{PID}/hosted-ui/action/'
    for name in ['game_event', 'speak', 'open_session', 'close_session', 'heartbeat_session']:
        request(action_root + name, method='POST', payload={'args': {}, 'kind': 'panel', 'surface_id': 'main'}, headers=trusted, expected=403)
    request(action_root + 'avatar_state', method='POST', payload={'args': {}}, expected=403)
    page = request(f'/plugin/{PID}/ui/').decode()
    assert 'id="root"' in page
    for relative in re.findall(r'src="\./([^"?]+)', page):
        request(f'/plugin/{PID}/ui/' + relative)
    request('/plugin/neko_survivors/ui/', expected=404)
    started = False
    try:
        result = json.loads(request('/qa/start', method='POST', headers=trusted))
        started = True
        expected = {'game_event', 'speak', 'open_session', 'close_session', 'heartbeat_session', 'avatar_state', 'sync_avatar'}
        assert result['private_host_alive'] and set(result['context_actions']) == expected
        payload = {'args': {}, 'kind': 'panel', 'surface_id': 'main'}
        avatar = json.loads(request(action_root + 'avatar_state', method='POST', payload=payload, headers=trusted))['result']
        assert avatar['status'] == 'completed'
        assert isinstance(avatar.get('identity'), str) and avatar['identity']
        request(action_root + 'avatar_state', method='POST', payload=payload, expected=403)
        request(action_root + 'avatar_state', method='POST', payload=payload, headers={**trusted, 'Origin': 'https://untrusted.example'}, expected=403)
        synced = json.loads(request(action_root + 'sync_avatar', method='POST', payload=payload, headers=trusted))['result']
        assert synced.get('synced') is True
        assert isinstance(synced.get('modelUrl'), str) and synced['modelUrl']
        assert isinstance(synced.get('scripts'), list) and synced['scripts']
        assert 'resources' not in synced
        running = json.loads(request('/qa/status'))
        assert running['private_host_alive'] and running['manager_unchanged']
        assert running['main']['manager']['status'] == 'stopped'
        assert running['main']['route']['game_route_active'] == before['main']['route']['game_route_active']
    finally:
        if started: request('/qa/stop', method='POST', headers=trusted)
    after = json.loads(request('/qa/status'))
    assert not after['private_host_alive'] and after['manager_unchanged']
    evidence = json.loads(Path(info['evidence_file']).read_text())
    assert evidence['registered_plugins'] == [PID]
    assert evidence['main_host_non_GET_attempts'] == 0
    assert all(evidence['storage_roots_isolated'].values())
    assert set(evidence['context_actions']) == expected
    (ready.parent / 'guard-smoke.json').write_text(json.dumps({'kind': 'opt-in-private-live-host-probe', 'checks': checks,
        'private_child_stopped': True, 'real_manager_unchanged': after['manager_unchanged'], 'main_host_non_GET_attempts': 0}, indent=2) + '\n')


def qa_helpers():
    # Importing the fixture only defines helpers; it does not import NEKO,
    # change storage settings, bind a socket or contact the real main host.
    return runpy.run_path(str(PLUGIN / 'frontend/tests/e2e/live_plugin_server.py'))


@pytest.mark.parametrize('alive_after', [True, False])
def test_shutdown_retains_owner_and_registry_until_child_is_confirmed_dead(alive_after):
    shutdown = qa_helpers()['shutdown_confirmed_dead']
    calls = []
    class FakeChild:
        async def shutdown(self, timeout): calls.append(timeout)
        def is_alive(self): return alive_after
    child = FakeChild()
    owner = {'current': child}
    registry = {PID: child}
    def release():
        owner['current'] = None
        registry.pop(PID)
    stopped = asyncio.run(shutdown(child, release))
    assert stopped is (not alive_after)
    assert calls == [5]
    if alive_after:
        assert owner['current'] is child
        assert registry[PID] is child
    else:
        assert owner['current'] is None
        assert registry == {}


@pytest.mark.parametrize('method', ['spawn', 'forkserver'])
def test_nonfork_runtime_is_explicitly_rejected_before_main_allocates_resources(method):
    with pytest.raises(RuntimeError, match='requires multiprocessing start method fork'):
        qa_helpers()['require_fork_runtime'](method)


def test_fork_runtime_is_accepted_without_changing_the_process_start_method():
    assert qa_helpers()['require_fork_runtime']('fork') == 'fork'
