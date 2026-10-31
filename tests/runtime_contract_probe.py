"""Executable NEKO integration probe: real isolated PluginHost + public UI routes.

Only the selected plugin is registered. The game host is a local protocol fixture;
no provider, LLM or TTS service is contacted. Linux fork inherits the selected
module's loopback HOST_BASE override, while NEKO owns the child and all IPC.
"""
from __future__ import annotations

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import multiprocessing
import os
from pathlib import Path
import re
import sys
import threading
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
HOST_ROOT = ROOT.parents[2]
PID = 'neko_survivors_react'


def main() -> None:
    directory = Path(sys.argv[1]).resolve()
    assert directory.is_relative_to(ROOT / 'test-results' / 'tmp')
    directory.mkdir(parents=True, exist_ok=True)
    runtime_root = directory / 'runtime-data'
    runtime_root.mkdir()
    os.environ['NEKO_STORAGE_SELECTED_ROOT'] = str(runtime_root)
    os.environ['NEKO_STORAGE_ANCHOR_ROOT'] = str(runtime_root)
    os.environ['NEKO_STORAGE_CLOUDSAVE_ROOT'] = str(runtime_root / 'cloudsave')
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    os.environ['TMPDIR'] = str(directory)
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(HOST_ROOT))
    if multiprocessing.get_start_method() != 'fork':
        print('NEKO_CONTRACT_SKIP: requires Linux fork for the narrow HTTP fixture override')
        return

    from fastapi import FastAPI
    import httpx
    from plugin.core import host as host_module, registry
    from plugin.core.state import state
    from plugin.logging_config import logger
    from plugin.server.application.plugins.metadata_scanner import scan_plugin_metadata_isolated, install_isolated_plugin_metadata
    from plugin.server.routes.plugin_ui import router

    assert state.plugins == {}, 'Probe must start in an empty private registry'
    config = ROOT / 'plugin.toml'
    context = registry._parse_single_plugin_config(config, set(), logger, apply_user_overlays=False)
    assert context and context.pid == PID
    module_path, class_name = context.entry.split(':')
    host_module._prepare_child_plugin_vendor_path(config, logger)
    selected = host_module._import_plugin_module(module_path, config, logger)
    entry = getattr(selected, class_name)
    implementation = sys.modules[entry.__module__]
    assert Path(implementation.__file__).resolve() == ROOT / 'neko_survivors_react_entry.py'
    assert implementation.PLUGIN_ID == PID

    requests: list[dict] = []
    routes: set[tuple[str, str]] = set()
    class GameFixture(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def reply(self, payload, code=200):
            blob = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(blob))); self.end_headers(); self.wfile.write(blob)
        def do_GET(self):
            requests.append({'path': self.path, 'method': 'GET'})
            if self.path == '/api/characters': self.reply({'当前猫娘': 'Fixture Cat'})
            elif self.path == f'/api/game/{PID}/character': self.reply({'lanlan_name': 'Fixture Cat', 'model_type':'vrm'})
            else: self.reply({'ok':False,'reason':'fixture_rejects_unknown_path'},404)
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
            requests.append({'path':self.path,'method':'POST','payload':payload})
            identity=(payload.get('session_id'),payload.get('sdk_route_instance_id'))
            if self.path == f'/api/game/{PID}/route/start':
                routes.add(identity);self.reply({'ok':True,'state':{'game_route_active':True}})
            elif self.path == f'/api/game/{PID}/route/end':
                routes.discard(identity);self.reply({'ok':True,'route_closed':True})
            elif identity not in routes: self.reply({'ok':False,'reason':'stale_route_instance'})
            elif self.path == f'/api/game/{PID}/route/heartbeat': self.reply({'ok':True,'active':True})
            elif self.path == f'/api/game/{PID}/chat': self.reply({'line':'Fixture commentary','control':{}})
            elif self.path == f'/api/game/{PID}/speak': self.reply({'ok':True,'audio_sent':True,'method':'fixture_no_audio'})
            else: self.reply({'ok':False,'reason':'fixture_rejects_unknown_path'},404)
    server = ThreadingHTTPServer(('127.0.0.1',0), GameFixture)
    thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
    implementation.HOST_BASE = f'http://127.0.0.1:{server.server_port}'

    metadata = scan_plugin_metadata_isolated(plugin_id=PID,module_path=module_path,class_name=class_name,
        config_path=config,conf=context.conf,pdata=context.pdata,python_requirement_paths=context.python_requirement_paths)
    expected = {'game_event','speak','sync_avatar','open_session','close_session','heartbeat_session','avatar_state'}
    assert {entry['id'] for entry in metadata.entries_preview} == expected
    plugin_meta=registry._build_plugin_meta(PID,context.pdata,plugin_ui=registry._extract_plugin_ui_config(context.conf,plugin_id=PID,logger=logger))
    assert registry.register_plugin(plugin_meta,logger,config_path=config,entry_point=context.entry)==PID
    with state.acquire_plugins_write_lock(): state.plugins[PID]['entries_preview']=metadata.entries_preview
    install_isolated_plugin_metadata(PID,metadata)
    evidence={'id':PID,'config_path':str(config),'implementation':str(implementation.__file__),'entries':sorted(expected),'game_fixture_port':server.server_port}

    async def exercise():
        host=host_module.PluginHost(PID,context.entry,config)
        with state.acquire_plugin_hosts_write_lock(): state.plugin_hosts[PID]=host
        app=FastAPI();app.include_router(router)
        try:
            startup=await host.start(startup_timeout=10,startup_failure='fail')
            assert startup['status']=='ready'
            assert host.is_alive()
            assert all(endpoint.startswith('tcp://127.0.0.1:') for endpoint in [host.transport.downlink_endpoint,host.transport.uplink_endpoint])
            ui=await host.get_ui_context(PID,timeout=5)
            assert ui['state']['plugin_id']==PID
            assert {action['id'] for action in ui['actions']}==expected
            assert not ui.get('context_error')
            assert await host.trigger('avatar_state',{},timeout=5)=={'status':'completed','identity':__import__('hashlib').sha256(json.dumps({'lanlan_name':'Fixture Cat','model_type':'vrm','live2d_path':None},sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'name':'Fixture Cat','modelType':'vrm'}
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1:54999') as client:
                page=await client.get(f'/plugin/{PID}/ui/')
                assert page.status_code==200,page.text
                assert 'id="root"' in page.text
                scripts=re.findall(r'src="\./([^"?]+)',page.text)
                assert any(script.startswith('app/') for script in scripts),scripts
                for script in scripts:
                    response=await client.get(f'/plugin/{PID}/ui/{script}')
                    assert response.status_code==200,script
                async def action(name,args):
                    response=await client.post(f'/plugin/{PID}/hosted-ui/action/{name}',json={'kind':'panel','surface_id':'main','args':args})
                    assert response.status_code==200,(name,response.text)
                    return response.json()['result']
                opened=await action('open_session',{'session_id':'probe-session','route_id':'probe-route'})
                assert opened['status']=='completed',opened
                speech=await action('game_event',{'session_id':'probe-session','event':'boss_spawn','text':'Fixture Boss arrives','correlation_id':'probe-utterance'})
                assert speech['status']=='queued' and speech['line']=='Fixture commentary',speech
                assert (await action('heartbeat_session',{'session_id':'probe-session'}))['status']=='completed'
                assert (await action('sync_avatar',{}))['reason']=='no_live2d_model'
                forbidden=await client.post(f'/plugin/{PID}/hosted-ui/action/startup',json={'args':{},'kind':'panel','surface_id':'main'})
                assert forbidden.status_code in {403,404},forbidden.text
                assert (await action('close_session',{'session_id':'probe-session'}))['status']=='completed'
                assert (await action('speak',{'session_id':'probe-session','text':'must not leave the plugin'}))['status']=='cancelled'
                missing=await client.get('/plugin/neko_survivors/ui/')
                assert missing.status_code==404,missing.text
                evidence['ui_scripts']=scripts
                evidence['forbidden_unexposed_status']=forbidden.status_code
            evidence.update({'startup':startup['status'],'context_plugin_id':ui['state']['plugin_id'],'registered_plugins':list(state.plugins),'target_alive':host.is_alive()})
        finally:
            await host.shutdown(timeout=3)
            evidence['child_stopped']=not host.is_alive()
            with state.acquire_plugin_hosts_write_lock(): state.plugin_hosts.pop(PID,None)
    try:
        asyncio.run(exercise())
        assert list(state.plugins)==[PID]
        posted=[request for request in requests if request['method']=='POST']
        assert sum(request['path'].endswith('/chat') for request in posted)==1
        assert sum(request['path'].endswith('/speak') for request in posted)==1
        assert not routes
        evidence['http_requests']=requests
        (directory/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
        print('NEKO_CONTRACT_OK:'+json.dumps(evidence,ensure_ascii=False))
    finally:
        server.shutdown();server.server_close();thread.join(timeout=3)


if __name__=='__main__': main()
