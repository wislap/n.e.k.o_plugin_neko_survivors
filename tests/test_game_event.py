"""Public plugin contracts: independent identity, submission receipts and asset sync."""
from __future__ import annotations

import asyncio
import json

import pytest

from support.plugin import MOD, make, set_http, install_dialogue


def test_event_generates_one_line_then_speaks_once_with_independent_identity():
    plugin, pushes = make()
    requests = install_dialogue(plugin)
    result = asyncio.run(plugin.game_event(event='boss_spawn', text='Boss 登场', session_id='test-session', correlation_id='report-123'))
    assert result.value['status'] == 'queued'
    assert result.value['line'] == 'A commentary line'
    chat = next(payload for path,payload in requests if path.endswith('/chat'))
    assert chat['session_id'] == 'neko_survivors_react_test-session'
    assert chat['prompt']['mode'] == 'author-managed'
    assert 'Boss 登场' in chat['prompt']['messages'][0]['content']
    speech = next(payload for path,payload in requests if path.endswith('/speak'))
    assert speech['line'] == 'A commentary line'
    assert speech['sdk_speech_correlation_id'] == 'report-123'
    assert pushes == [], 'No second main-chat push_message chain'
    assert asyncio.run(plugin.game_event(event='boss_spawn', text='再来', session_id='test-session')).value['status'] == 'throttled'
    assert sum(path.endswith('/chat') for path,_ in requests) == 1


def test_event_identity_is_normalized_before_cooldown_and_wire_output(monkeypatch):
    plugin, _ = make()
    requests = install_dialogue(plugin)
    now = [100.0]
    monkeypatch.setattr(MOD.time, 'monotonic', lambda: now[0])
    prefix = 'x' * MOD.COMMENTARY['maxEventLength']
    assert asyncio.run(plugin.game_event(event=' ' + prefix + 'first ', text='first', session_id='test-session')).value['status'] == 'queued'
    chat = next(payload for path,payload in requests if path.endswith('/chat'))
    assert chat['event']['kind'] == prefix
    now[0] += 14  # Past the global gap, still inside this canonical event's gap.
    assert asyncio.run(plugin.game_event(event=prefix + 'second', text='second', session_id='test-session')).value['status'] == 'throttled'
    assert sum(path.endswith('/chat') for path,_ in requests) == 1


def test_failed_generation_is_not_automatically_retried_or_spoken():
    plugin, _ = make()
    requests = install_dialogue(plugin, {'error':'provider_unavailable','line':''})
    assert asyncio.run(plugin.game_event(event='boss_spawn',text='Boss',session_id='test-session')).value['status'] == 'rejected'
    assert asyncio.run(plugin.game_event(event='boss_spawn',text='Boss',session_id='test-session')).value['status'] == 'throttled'
    assert not any(path.endswith('/speak') for path,_ in requests)


def test_empty_event_does_not_consume_throttle():
    plugin, calls = make()
    assert not hasattr(asyncio.run(plugin.game_event(event='win', text=' ')), 'value')
    assert plugin._last_event_at == {}
    assert calls == []


def test_tts_reports_queue_acceptance():
    plugin, _ = make()
    calls = []
    def request(method, path, body=None, timeout=15.0):
        calls.append((method, path, body))
        if path == '/api/characters': return 200, '{"当前猫娘":"YUI"}'.encode()
        if path.endswith('/route/start'): return 200, b'{"ok":true,"state":{"game_route_active":true}}'
        return 200, b'{"ok":true,"method":"project_tts"}'
    set_http(plugin, request)
    assert asyncio.run(plugin.open_session('test-session', 'route-generation')).value['status'] == 'completed'
    for line in ['第一句', '第二句']:
        assert asyncio.run(plugin.speak(text=line, session_id='test-session')).value['status'] == 'queued'
    assert calls[-1][1] == '/api/game/neko_survivors_react/speak'
    assert json.loads(calls[-1][2])['session_id'] == 'neko_survivors_react_test-session'


def test_unicode_paths_preserved_and_traversal_rejected():
    assert MOD._safe_rel('动作/挥手.motion3.json') == '动作/挥手.motion3.json'
    assert MOD._safe_rel('./动作/./挥手.motion3.json') == '动作/挥手.motion3.json'
    assert MOD._safe_rel('动作/挥手%20test.motion3.json') == '动作/挥手 test.motion3.json'
    assert MOD._safe_rel('动作/%252e.motion3.json') == '动作/%2e.motion3.json', 'Decode exactly once'
    for path in ['../bad', 'a/../b', '/absolute', 'https://bad', 'a?b', 'a//b', '.', './',
                 '%2e%2e/bad', 'a/%2E%2e/b', '%2fabsolute', 'a/%5c../bad', 'a/%00bad']:
        with pytest.raises(ValueError): MOD._safe_rel(path)


def fixture_http(missing=None):
    model = {'FileReferences': {'Moc': '模型.moc3', 'Motions': {'Idle': [{'File': '动作/挥手.motion3.json'}]}}}
    def request(method, path, body=None, timeout=15.0):
        if path.endswith('/character'):
            return 200, json.dumps({'model_type': 'live2d', 'live2d_path': '/static/models/猫/角色.model3.json', 'lanlan_name': '猫'}).encode()
        if missing and missing in path: return 404, b''
        if path.endswith('model3.json'): return 200, json.dumps(model, ensure_ascii=False).encode()
        return 200, b'fixture-content'
    return request


def test_avatar_sync_requires_script_and_preserves_chinese_refs(tmp_path):
    plugin, _ = make()
    plugin._vendor_dir = lambda: tmp_path
    set_http(plugin, fixture_http())
    result = asyncio.run(plugin._sync_avatar_payload())
    assert result['synced']
    prefix = f'/plugin/{MOD.PLUGIN_ID}/ui/vendor/{result["generation"]}/'
    assert result['modelUrl'].startswith(prefix + 'model/')
    assert result['scripts'] == [prefix + name for name in ['neko-minigame-avatar-host.js', *("engine/" + remote.rsplit("/", 1)[-1] for remote in MOD.ENGINE_SCRIPTS)]]
    assert 'resources' not in result and 'model' not in result
    generation = tmp_path / result['generation']
    assert (generation / 'model/static/models/猫/动作/挥手.motion3.json').exists()
    assert (generation / 'neko-minigame-avatar-host.js').exists()


@pytest.mark.parametrize('reference,filename', [
    ('./动作/挥手.motion3.json', '动作/挥手.motion3.json'),
    ('动作/挥手%20test.motion3.json', '动作/挥手 test.motion3.json'),
    ('%E5%8A%A8%E4%BD%9C/%E6%8C%A5%E6%89%8B.motion3.json', '动作/挥手.motion3.json'),
    ('动作/百分号%25.motion3.json', '动作/百分号%.motion3.json'),
    ('动作/%252e.motion3.json', '动作/%2e.motion3.json'),
])
def test_avatar_sync_relative_uris_resolve_to_decoded_files(tmp_path, reference, filename):
    from urllib.parse import unquote, urljoin
    plugin, _ = make()
    plugin._vendor_dir = lambda: tmp_path
    model = {'FileReferences': {'Moc': '模型.moc3', 'Motions': {'Idle': [{'File': reference}]}}}
    blob = json.dumps(model, ensure_ascii=False).encode()
    source = fixture_http()
    requested = []
    def request(method, path, *args, **kwargs):
        requested.append(path)
        return (200, blob) if path.endswith('model3.json') else source(method, path, *args, **kwargs)
    set_http(plugin, request)
    result = asyncio.run(plugin._sync_avatar_payload())
    assert result['synced']
    generation = tmp_path / result['generation']
    local = f'model/static/models/猫/{filename}'
    assert (generation / local).read_bytes() == b'fixture-content'
    assert (generation / 'model/static/models/猫/角色.model3.json').read_bytes() == blob, 'Keep original model JSON URI semantics'
    assert f'/static/models/猫/{reference}' in requested, 'Do not unquote the source HTTP URI'
    model_url = result['modelUrl']
    # Same one-time URL decoding as the HTTP static surface: every URI resolves
    # to the actual downloaded filename, including a literal percent character.
    browser_path = unquote(urljoin(model_url, reference))
    expected = f'/plugin/{MOD.PLUGIN_ID}/ui/vendor/{result["generation"]}/{local}'
    assert browser_path == expected


@pytest.mark.parametrize('reference', ['../outside.moc3', './%2e%2e/outside.moc3', '%2foutside.moc3', 'a/%5c../outside.moc3'])
def test_avatar_sync_rejects_decoded_traversal_before_any_resource_fetch(tmp_path, reference):
    plugin, _ = make()
    plugin._vendor_dir = lambda: tmp_path
    source = fixture_http()
    requested = []
    def request(method, path, *args, **kwargs):
        requested.append(path)
        if path.endswith('model3.json'):
            return 200, json.dumps({'FileReferences': {'Moc': reference}}).encode()
        return source(method, path, *args, **kwargs)
    set_http(plugin, request)
    result = asyncio.run(plugin._sync_avatar_payload())
    assert result == {'synced': False, 'reason': 'model_json_invalid'}
    assert len(requested) == 2, 'Only character metadata and model JSON may be fetched'
    assert list(tmp_path.iterdir()) == []


def test_missing_avatar_resource_never_reports_success(tmp_path):
    plugin, _ = make()
    plugin._vendor_dir = lambda: tmp_path
    set_http(plugin, fixture_http('neko-minigame-avatar-host.js'))
    result = asyncio.run(plugin._sync_avatar_payload())
    assert result['synced'] is False
    assert result['reason'] == 'resource_missing'
    assert list(tmp_path.iterdir()) == []


def test_shutdown_cancels_sync():
    plugin, _ = make()
    async def exercise():
        plugin._sync_task = asyncio.create_task(asyncio.sleep(60))
        await plugin.shutdown()
        assert plugin._sync_task.cancelled()
        assert plugin._stopping.is_set()
    asyncio.run(exercise())
