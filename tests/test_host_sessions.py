"""No paid service is called: exercise the plugin-to-host lifecycle contract."""
import asyncio
import json

import pytest

from support.plugin import MOD, make, set_http, current_http, install_dialogue


def install_host(plugin):
    requests = []
    character = ['YUI']
    def request(method, path, body=None, timeout=15):
        payload = json.loads(body) if body else None
        requests.append((path, payload))
        if path == '/api/characters': return 200, json.dumps({'当前猫娘': character[0]}).encode()
        if path.endswith('/route/start'): return 200, b'{"ok":true,"state":{"game_route_active":true}}'
        if path.endswith('/route/heartbeat'): return 200, b'{"ok":true,"active":true}'
        return 200, b'{"ok":true,"method":"project_tts"}'
    set_http(plugin, request)
    return requests, character


def test_route_start_speech_and_end_share_exact_generation():
    plugin, _ = make()
    requests, _ = install_host(plugin)
    async def exercise():
        assert (await plugin.open_session('session-123', 'route-123')).value['status'] == 'completed'
        assert (await plugin.speak('hello', 'session-123', 'utterance-123')).value['status'] == 'queued'
        assert (await plugin.close_session('session-123')).value['status'] == 'completed'
        assert (await plugin.speak('stale', 'session-123')).value['status'] == 'cancelled'
        assert (await plugin.open_session('session-123', 'route-456')).value['status'] == 'cancelled'
    asyncio.run(exercise())
    route_requests = [payload for path,payload in requests if '/route/' in path or path.endswith('/speak')]
    assert all(payload['session_id'] == 'neko_survivors_react_session-123' for payload in route_requests)
    assert all(payload['sdk_route_instance_id'] == 'route-123' for payload in route_requests)
    speech = next(payload for path,payload in requests if path.endswith('/speak'))
    assert speech['source'] == 'game_route'
    assert speech['sdk_speech_correlation_id'] == 'utterance-123'
    close = next(payload for path,payload in requests if path.endswith('/route/end'))
    assert close['postgameProactive'] == {'enabled': False}


@pytest.mark.parametrize('body', [b'not-json', b'[]', b'null', b'false', b'{}', b'{"ok":false}'])
def test_malformed_upstream_speech_receipts_never_claim_queue_acceptance(body):
    plugin, _ = make(); requests, _ = install_host(plugin)
    async def exercise():
        await plugin.open_session('session-123', 'route-123')
        original = current_http(plugin)
        set_http(plugin, lambda method,path,*args,**kwargs: (200,body) if path.endswith('/speak') else original(method,path,*args,**kwargs))
        assert (await plugin.speak('line', 'session-123')).value['status'] == 'rejected'
    asyncio.run(exercise())


def test_skipped_ok_speech_is_cancelled_not_queued():
    plugin,_ = make(); install_host(plugin)
    async def exercise():
        await plugin.open_session('session-123','route-123')
        original = current_http(plugin)
        set_http(plugin, lambda method,path,*args,**kwargs: (200,b'{"ok":true,"skipped":"stale_session","handled":false}') if path.endswith('/speak') else original(method,path,*args,**kwargs))
        assert (await plugin.speak('line','session-123')).value['status'] == 'cancelled'
    asyncio.run(exercise())


def test_character_switch_is_detected_without_name_cache_and_closes_old_route():
    plugin,_ = make(); requests, character = install_host(plugin)
    async def exercise():
        assert await plugin._current_lanlan() == 'YUI'
        await plugin.open_session('session-123','route-123')
        character[0] = 'Kuro'
        assert await plugin._current_lanlan() == 'Kuro'
        assert (await plugin.speak('line','session-123')).value['reason'] == 'character_changed'
        assert (await plugin.heartbeat_session('session-123')).value['reason'] == 'character_changed'
    asyncio.run(exercise())
    close = next(payload for path,payload in requests if path.endswith('/route/end'))
    assert close['lanlan_name'] == 'YUI', 'Close the old owner, never the newly selected character'


def test_close_during_inflight_start_retires_the_route_before_accepting_speech():
    plugin,_ = make(); requests, _ = install_host(plugin)
    async def exercise():
        entered, release = asyncio.Event(), asyncio.Event()
        original = plugin._route_request
        async def request(action,payload):
            if action == 'start':
                entered.set(); await release.wait()
            return await original(action,payload)
        plugin._route_request = request
        opening = asyncio.create_task(plugin.open_session('session-123','route-123'))
        await entered.wait()
        closing = asyncio.create_task(plugin.close_session('session-123'))
        await asyncio.sleep(0)
        release.set()
        assert (await opening).value['status'] == 'cancelled'
        assert (await closing).value['status'] == 'completed'
        assert (await plugin.speak('late','session-123')).value['status'] == 'cancelled'
    asyncio.run(exercise())
    assert any(path.endswith('/route/end') for path,_ in requests)


@pytest.mark.parametrize('retire', ['close', 'shutdown'])
def test_retired_session_never_starts_a_route_after_character_lookup(retire):
    plugin, _ = make()
    requests, _ = install_host(plugin)
    async def exercise():
        entered, release = asyncio.Event(), asyncio.Event()
        async def character():
            entered.set()
            await release.wait()
            return 'YUI'
        plugin._current_lanlan = character
        opening = asyncio.create_task(plugin.open_session('session-123', 'route-123'))
        await entered.wait()
        if retire == 'close':
            closing = asyncio.create_task(plugin.close_session('session-123'))
            await asyncio.sleep(0)  # close invalidates before waiting for the lock.
        else:
            await plugin.shutdown()
            closing = None
        release.set()
        assert (await opening).value == {'status': 'cancelled', 'reason': 'session_closed'}
        if closing:
            assert (await closing).value['status'] == 'completed'
        assert plugin._sessions == {}
    asyncio.run(exercise())
    assert requests == [], 'An already-retired generation must never take over the host route'


def test_cancelling_start_sends_the_formal_end_before_start_tombstone():
    plugin,_=make(); requests,_=install_host(plugin)
    async def exercise():
        entered=asyncio.Event()
        original=plugin._route_request
        async def request(action,payload):
            if action=='start':
                entered.set(); await asyncio.Event().wait()
            return await original(action,payload)
        plugin._route_request=request
        opening=asyncio.create_task(plugin.open_session('session-123','route-123'))
        await entered.wait(); opening.cancel()
        with pytest.raises(asyncio.CancelledError): await opening
    asyncio.run(exercise())
    end=next(payload for path,payload in requests if path.endswith('/route/end'))
    assert end['session_id']=='neko_survivors_react_session-123'
    assert end['sdk_route_instance_id']=='route-123'


def test_official_host_cancels_owned_worker_and_browser_correlations():
    """Execute the actual host helper without importing/starting the host app."""
    import ast
    from pathlib import Path
    from typing import Any
    source = Path(__file__).resolve().parents[1].parents[2] / 'main_routers/game_router/postgame.py'
    tree = ast.parse(source.read_text())
    function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == '_cancel_route_game_speech')
    cancelled = []
    async def notify(_manager, **payload): cancelled.append(payload)
    namespace = {'asyncio': asyncio, 'Any': Any, '_GAME_SPEECH_CANCEL_SETTLE_SECONDS': 0.2, '_push_game_speech_cancel': notify}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
    async def exercise():
        worker = asyncio.create_task(asyncio.Event().wait())
        state = {'lanlan_name':'YUI','game_type':'neko_survivors_react','session_id':'old-session','_sdk_route_instance_id':'old-route',
                 '_sdk_active_speech_task':worker,'_sdk_active_speech_correlation_ids':['utterance-1','utterance-2']}
        await namespace['_cancel_route_game_speech'](state, object())
        assert worker.cancelled()
        assert [item['speech_correlation_id'] for item in cancelled] == ['utterance-2','utterance-1']
        assert all(item['session_id']=='old-session' and item['route_instance_id']=='old-route' for item in cancelled)
    asyncio.run(exercise())


def test_plugin_commentary_matches_the_official_author_managed_prompt_contract():
    import ast
    from pathlib import Path
    from typing import Any, Dict
    plugin,_=make();requests=install_dialogue(plugin)
    asyncio.run(plugin.game_event('boss_spawn','Boss arrives','test-session'))
    payload=next(payload for path,payload in requests if path.endswith('/chat'))
    source=Path(__file__).resolve().parents[1].parents[2]/'main_routers/game_router/author_prompt.py'
    tree=ast.parse(source.read_text())
    nodes=[node for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id.startswith('_AUTHOR_PROMPT_') for target in node.targets)]
    nodes.append(next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='_normalize_author_managed_prompt'))
    scope={'Any':Any,'Dict':Dict}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),scope)
    assert scope['_normalize_author_managed_prompt'](payload['prompt'])==payload['prompt']
    assert sum(path.endswith('/chat') for path,_ in requests)==1
    assert sum(path.endswith('/speak') for path,_ in requests)==1
    speech=next(payload for path,payload in requests if path.endswith('/speak'))
    assert speech['sdk_speech_correlation_id'], 'Even a manual action gets a cancellable speech identity'


def test_closing_a_session_while_commentary_generates_never_speaks_its_late_result():
    import threading
    plugin,_=make();requests=install_dialogue(plugin)
    entered,release=threading.Event(),threading.Event()
    original=current_http(plugin)
    def request(method,path,*args,**kwargs):
        if path.endswith('/chat'):
            entered.set();release.wait(2)
        return original(method,path,*args,**kwargs)
    set_http(plugin, request)
    async def exercise():
        report=asyncio.create_task(plugin.game_event('boss_spawn','Boss','test-session'))
        assert await asyncio.to_thread(entered.wait,1)
        await plugin.close_session('test-session')
        release.set()
        assert (await report).value['status']=='cancelled'
    try:asyncio.run(exercise())
    finally:release.set()
    assert not any(path.endswith('/speak') for path,_ in requests)


def test_concurrent_reports_cannot_launch_two_paid_generations():
    plugin,_=make();requests=install_dialogue(plugin)
    async def exercise():
        results=await asyncio.gather(plugin.game_event('boss_spawn','Boss','test-session'),plugin.game_event('wave_start','Wave','test-session'))
        assert sorted(result.value['status'] for result in results)==['queued','throttled']
    asyncio.run(exercise())
    assert sum(path.endswith('/chat') for path,_ in requests)==1
