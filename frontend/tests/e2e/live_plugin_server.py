"""Opt-in read-model-only QA: real private PluginHost and official UI/security routes.

Never starts the real plugin manager instance. No main-host mutation, game route,
dialogue, TTS or trusted SDK registration is permitted by this fixture.
"""
import argparse
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import secrets
import socket
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

PLUGIN = Path(__file__).resolve().parents[3]
REPO = PLUGIN.parents[2]
RESULTS = PLUGIN / 'frontend/test-results'
PID = 'neko_survivors_react'
READ_ACTIONS = frozenset({'avatar_state', 'sync_avatar'})
EXPECTED_ACTIONS = frozenset({'game_event', 'speak', 'open_session', 'close_session', 'heartbeat_session', 'avatar_state', 'sync_avatar'})


def require_fork_runtime(method=None):
    method = multiprocessing.get_start_method() if method is None else method
    if method != 'fork':
        raise RuntimeError('Read-model QA requires multiprocessing start method fork so the strict audit hook reaches the child; spawn/forkserver are unsupported')
    return method


async def shutdown_confirmed_dead(owned, release, timeout=5):
    """Retain ownership unless a completed shutdown actually left the child dead."""
    await owned.shutdown(timeout=timeout)
    if owned.is_alive():
        return False
    release()
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    start_method = require_fork_runtime()  # Before any directory or socket allocation.
    directory = Path(args.directory).resolve()
    if not directory.is_relative_to(RESULTS / 'browser-fixtures'):
        raise ValueError('QA output must stay under frontend/test-results/browser-fixtures/')
    directory.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix='session-', dir=directory))
    storage = run / 'storage'
    temporary = run / 'tmp'
    for path in [storage, temporary, run / 'pycache', run / 'xdg-data', run / 'xdg-config', run / 'xdg-cache', run / 'documents']:
        path.mkdir()
    # Set every writable platform root before importing any NEKO module.
    os.environ.update({
        'NEKO_STORAGE_SELECTED_ROOT': str(storage), 'NEKO_STORAGE_ANCHOR_ROOT': str(storage),
        'NEKO_STORAGE_CLOUDSAVE_ROOT': str(storage / 'cloudsave'), 'TMPDIR': str(temporary),
        'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONPYCACHEPREFIX': str(run / 'pycache'),
        # PluginHost refreshes its child environment from the normal storage
        # policy resolver. Its standard anchor must be private as well as the
        # selected root, otherwise it can re-read the real user's old policy.
        'XDG_DATA_HOME': str(run / 'xdg-data'), 'XDG_CONFIG_HOME': str(run / 'xdg-config'),
        'XDG_CACHE_HOME': str(run / 'xdg-cache'), 'XDG_DOCUMENTS_DIR': str(run / 'documents'),
        'NEKO_PLUGIN_PAGE_MUTATION_REQUIRE_TOKEN': '1', 'NEKO_AUTOSTART_CSRF_TOKEN': secrets.token_urlsafe(32),
    })
    sys.dont_write_bytecode = True
    sys.pycache_prefix = str(run / 'pycache')
    tempfile.tempdir = str(temporary)
    sys.path.insert(0, str(REPO))
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    os.environ['NEKO_USER_PLUGIN_SERVER_PORT'] = str(port)
    os.environ['NEKO_USER_PLUGIN_BASE'] = base
    nonce = secrets.token_urlsafe(32)
    request_log = directory / 'requests.jsonl'
    outbound_log = run / 'host-get-audit.jsonl'
    evidence_file = directory / 'evidence.json'
    denied_writes = run / 'blocked-file-mutations.jsonl'
    phase = 'BOOTSTRAP'

    def append(file: Path, record: dict) -> None:
        try:
            file.parent.mkdir(parents=True, exist_ok=True)
            with file.open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(record, ensure_ascii=True) + '\n')
        except OSError:
            # Logging cannot break a valid model/script response.
            pass

    def allowed_write(value) -> bool:
        if isinstance(value, int):
            return True
        try:
            resolved = Path(os.fsdecode(value)).resolve()
            return resolved.is_relative_to(directory) or resolved.is_relative_to(PLUGIN / 'static/vendor')
        except (TypeError, ValueError, OSError):
            return False

    def audit(event, values):
        def reject_write(value):
            try:
                resolved = Path(os.fsdecode(value)).resolve()
                location = str(resolved.relative_to(REPO)) if resolved.is_relative_to(REPO) else '[external path redacted]'
            except (TypeError, ValueError, OSError):
                location = '[non-path]'
            stack = []
            frame = sys._getframe(1)
            while frame is not None and len(stack) < 10:
                source = Path(frame.f_code.co_filename)
                if source.is_absolute() and source.is_relative_to(REPO):
                    stack.append({'file': str(source.relative_to(REPO)), 'line': frame.f_lineno, 'function': frame.f_code.co_name})
                frame = frame.f_back
            append(denied_writes, {'event': event, 'location': location, 'phase': phase, 'source_stack': stack})
            raise PermissionError('QA forbids file writes outside isolated results or plugin avatar cache')
        if event == 'urllib.Request':
            url, _data, _headers, method = values
            parsed = urllib.parse.urlsplit(url)
            permitted = method == 'GET' and parsed.hostname == '127.0.0.1' and parsed.port in {48911, 48916}
            kind = 'character' if parsed.path.endswith('/character') else 'route-state' if parsed.path.endswith('/route/state') else 'manager' if parsed.port == 48916 else 'model-or-engine-resource'
            append(outbound_log, {'method': method, 'port': parsed.port, 'kind': kind, 'permitted': permitted, 'pid': os.getpid()})
            if not permitted:
                raise PermissionError('QA permits only real loopback read-only host GET requests')
        elif event == 'open':
            path, mode, flags = values
            writing = isinstance(mode, str) and any(char in mode for char in 'wax+') or isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            if writing and not allowed_write(path):
                reject_write(path)
        elif event in {'os.remove', 'os.rmdir', 'os.mkdir', 'os.chmod', 'os.utime', 'os.truncate'}:
            if not allowed_write(values[0]):
                reject_write(values[0])
        elif event in {'os.rename', 'os.replace', 'os.link', 'os.symlink'}:
            if not all(allowed_write(value) for value in values[:2]):
                reject_write(next(value for value in values[:2] if not allowed_write(value)))
    sys.addaudithook(audit)

    from fastapi import Depends, FastAPI, HTTPException, Request
    from fastapi.responses import HTMLResponse, JSONResponse
    import uvicorn
    from utils.host_origin_guard import HostOriginGuardMiddleware
    from plugin.core import host as host_module, registry
    from plugin.core.state import state
    from plugin.logging_config import logger
    from plugin.server.application.plugins.metadata_scanner import scan_plugin_metadata_isolated, install_isolated_plugin_metadata
    from plugin.server.infrastructure.mutation_auth import require_plugin_mutation_access
    from plugin.server.infrastructure.error_mapping import raise_http_from_domain
    from plugin.server.domain.errors import ServerDomainError
    from plugin.server.routes.plugin_ui import router, mutation_router
    from plugin.server.routes.security import router as security_router

    if state.plugins or state.plugin_hosts:
        raise RuntimeError('QA must have a fresh private registry')
    config = PLUGIN / 'plugin.toml'
    context = registry._parse_single_plugin_config(config, set(), logger, apply_user_overlays=False)
    if not context or context.pid != PID:
        raise RuntimeError('Target identity mismatch')
    module_path, class_name = context.entry.split(':')
    host_module._prepare_child_plugin_vendor_path(config, logger)
    selected = host_module._import_plugin_module(module_path, config, logger)
    implementation = sys.modules[getattr(selected, class_name).__module__]
    if Path(implementation.__file__).resolve() != PLUGIN / 'neko_survivors_react_entry.py' or implementation.HOST_BASE != 'http://127.0.0.1:48911':
        raise RuntimeError('Wrong source or altered real host base')
    metadata = scan_plugin_metadata_isolated(plugin_id=PID, module_path=module_path, class_name=class_name,
        config_path=config, conf=context.conf, pdata=context.pdata, python_requirement_paths=context.python_requirement_paths)
    if {entry['id'] for entry in metadata.entries_preview} != EXPECTED_ACTIONS:
        raise RuntimeError('Actual plugin metadata does not expose the expected seven entries')
    plugin_meta = registry._build_plugin_meta(PID, context.pdata, plugin_ui=registry._extract_plugin_ui_config(context.conf, plugin_id=PID, logger=logger))
    registry.register_plugin(plugin_meta, logger, config_path=config, entry_point=context.entry)
    with state.acquire_plugins_write_lock():
        state.plugins[PID]['entries_preview'] = metadata.entries_preview
    install_isolated_plugin_metadata(PID, metadata)

    def read_json(url):
        try:
            with urllib.request.urlopen(url, timeout=6) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, {}
        except Exception as error:
            return 0, {'error_type': type(error).__name__}

    def main_snapshot():
        manager_http, data = read_json(f'http://127.0.0.1:48916/plugins/{PID}')
        item = data.get('plugin', {})
        role_http, role = read_json(f'http://127.0.0.1:48911/api/game/{PID}/character')
        route_http, route = read_json(f'http://127.0.0.1:48911/api/game/{PID}/route/state')
        identity = {key: role.get(key) for key in ['lanlan_name', 'model_type', 'live2d_path']}
        return {
            'manager': {'http': manager_http, 'id': item.get('id'), 'status': item.get('status'),
                        'config_matches_target': item.get('config_path') == str(config), 'entry_point': item.get('entry_point'),
                        'runtime_enabled': item.get('runtime_enabled'), 'runtime_auto_start': item.get('runtime_auto_start')},
            'character': {'http': role_http, 'has_character': bool(role.get('lanlan_name')), 'model_type': role.get('model_type'),
                          'identity_sha256': hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()},
            'route': {'http': route_http, 'game_route_active': bool((route.get('state') or {}).get('game_route_active'))},
        }

    baseline = main_snapshot()
    private_host = None
    phase = 'NOT_STARTED'
    lifecycle_lock = asyncio.Lock()
    evidence = {'kind': 'isolated-real-plugin-read-model-only', 'registered_plugins': [PID],
                'implementation': str(implementation.__file__), 'host_base_unmodified': implementation.HOST_BASE,
                'private_storage': str(storage), 'private_tmp': str(temporary), 'context_actions': [],
                'main_before': baseline, 'history': [],
                'runtime': {'python': sys.version.split()[0], 'start_method': start_method, 'parent_pid': os.getpid()}}

    def persist_evidence(snapshot=None):
        audit_records = []
        if outbound_log.exists():
            for line in outbound_log.read_text().splitlines():
                try: audit_records.append(json.loads(line))
                except ValueError: pass
        rejected_files = [json.loads(line) for line in denied_writes.read_text().splitlines()] if denied_writes.exists() else []
        evidence.update({'phase': phase, 'private_host_alive': bool(private_host and private_host.is_alive()),
                         'main_after': snapshot or evidence.get('main_after', baseline),
                         'main_host_non_GET_attempts': sum(record['method'] != 'GET' and record['port'] == 48911 for record in audit_records),
                         'outbound_request_count': len(audit_records), 'blocked_file_mutations': rejected_files,
                         'storage_roots_isolated': {key: bool(os.environ.get(key)) and Path(os.environ[key]).resolve().is_relative_to(directory)
                            for key in ['NEKO_STORAGE_SELECTED_ROOT', 'NEKO_STORAGE_ANCHOR_ROOT', 'NEKO_STORAGE_CLOUDSAVE_ROOT']},
                         'limitation': 'Read-model QA only; no session, LLM/TTS or trusted SDK acceptance. Strict file audit remains enabled, including platform helper calls.',
                         'recorded_at': datetime.now(timezone.utc).isoformat()})
        evidence['runtime']['outbound_pids'] = sorted({record['pid'] for record in audit_records})
        evidence['runtime']['outbound_pid_count'] = len(evidence['runtime']['outbound_pids'])
        evidence['runtime']['child_pids'] = sorted({item['child_pid'] for item in evidence['history'] if item.get('child_pid')})
        evidence['runtime']['child_pid_count'] = len(evidence['runtime']['child_pids'])
        evidence_file.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')

    async def stop_private():
        nonlocal private_host, phase
        owned = private_host
        if owned is None:
            return True
        def release():
            nonlocal private_host, phase
            with state.acquire_plugin_hosts_write_lock():
                if state.plugin_hosts.get(PID) is owned:
                    state.plugin_hosts.pop(PID)
            private_host = None
            phase = 'STOPPED'
        error_type = None
        try:
            stopped = await shutdown_confirmed_dead(owned, release)
        except Exception as error:
            stopped = False
            error_type = type(error).__name__
        if not stopped:
            phase = 'STOP_FAILED'
        snapshot = await asyncio.to_thread(main_snapshot)
        evidence['history'].append({'action': 'stop-private-child', 'alive_after': owned.is_alive(),
                                    'confirmed_stopped': stopped, 'error_type': error_type})
        persist_evidence(snapshot)
        return stopped

    @asynccontextmanager
    async def lifespan(_app):
        persist_evidence(baseline)
        info = {'kind': evidence['kind'], 'base': base, 'control': base + '/', 'page': base + f'/plugin/{PID}/ui/',
                'server_pid': os.getpid(),
                'status': base + '/qa/status', 'ready_file': str(directory / 'server.json'),
                'log_file': str(request_log), 'evidence_file': str(evidence_file), 'private_storage': str(storage),
                'boundary': 'Read-model-only. No SDK, game route, LLM or TTS. Real manager is never started/stopped.'}
        (directory / 'server.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n')
        print('LIVE_PLUGIN_QA_READY ' + json.dumps(info), flush=True)
        try:
            yield
        finally:
            await stop_private()
            persist_evidence(await asyncio.to_thread(main_snapshot))

    app = FastAPI(lifespan=lifespan)

    @app.exception_handler(ServerDomainError)
    async def domain_error(_request, error):
        try: raise_http_from_domain(error, logger=logger)
        except HTTPException as mapped:
            return JSONResponse({'detail': mapped.detail}, status_code=mapped.status_code, headers=mapped.headers)

    @app.middleware('http')
    async def readonly_boundary(request: Request, call_next):
        path = request.url.path
        if path.startswith(f'/plugin/{PID}/hosted-ui/action/'):
            action = path.rsplit('/', 1)[-1]
            if action not in READ_ACTIONS:
                append(request_log, {'path': path, 'status': 403, 'reason': 'qa_read_model_only'})
                return JSONResponse({'detail': 'QA is read-model-only: route/speech/gameplay actions are disabled'}, status_code=403)
        elif not (path in {'/', '/qa/start', '/qa/stop', '/qa/status', '/security/csrf-token'} or path.startswith(f'/plugin/{PID}/ui/') or path == f'/plugin/{PID}/surfaces' or path.startswith(f'/plugin/{PID}/hosted-ui/context')):
            return JSONResponse({'detail': 'QA path is not allowlisted'}, status_code=404)
        response = await call_next(request)
        append(request_log, {'path': path, 'method': request.method, 'status': response.status_code})
        return response

    app.include_router(router)
    app.include_router(mutation_router)
    app.include_router(security_router)
    app.add_middleware(HostOriginGuardMiddleware)

    def qa_guard(request: Request):
        if request.headers.get('origin') != base or not secrets.compare_digest(request.headers.get('x-qa-nonce', ''), nonce):
            raise HTTPException(403, 'QA control requires same-origin page and nonce')

    @app.get('/qa/status')
    async def qa_status():
        snapshot = await asyncio.to_thread(main_snapshot)
        persist_evidence(snapshot)
        return {'phase': phase, 'private_host_alive': bool(private_host and private_host.is_alive()),
                'context_actions': evidence['context_actions'], 'main': snapshot,
                'manager_unchanged': snapshot['manager'] == baseline['manager'], 'read_model_only': True}

    @app.post('/qa/start', dependencies=[Depends(require_plugin_mutation_access), Depends(qa_guard)])
    async def qa_start():
        nonlocal private_host, phase
        async with lifecycle_lock:
            if private_host and private_host.is_alive():
                return {'phase': phase, 'already_running': True}
            owned = host_module.PluginHost(PID, context.entry, config)
            private_host = owned
            phase = 'STARTING'
            with state.acquire_plugin_hosts_write_lock(): state.plugin_hosts[PID] = owned
            try:
                startup = await owned.start(startup_timeout=15, startup_failure='fail')
                ui = await owned.get_ui_context(PID, timeout=5)
                action_ids = sorted(action['id'] for action in ui['actions'])
                if set(action_ids) != EXPECTED_ACTIONS or ui['state']['plugin_id'] != PID:
                    raise RuntimeError('Wrong live child UI context')
                phase = 'RUNNING'
                evidence['context_actions'] = action_ids
                evidence['history'].append({'action': 'start-private-child', 'startup_status': startup.get('status'),
                                            'alive': owned.is_alive(), 'child_pid': owned.process.pid})
                persist_evidence(await asyncio.to_thread(main_snapshot))
                return {'phase': phase, 'private_host_alive': owned.is_alive(), 'context_actions': action_ids}
            except Exception:
                await stop_private()
                raise HTTPException(500, 'Private PluginHost start failed; inspect isolated process logs')

    @app.post('/qa/stop', dependencies=[Depends(require_plugin_mutation_access), Depends(qa_guard)])
    async def qa_stop():
        async with lifecycle_lock:
            stopped = await stop_private()
            result = {'phase': phase, 'private_host_alive': bool(private_host and private_host.is_alive()), 'confirmed_stopped': stopped}
            return result if stopped else JSONResponse(result, status_code=503)

    @app.get('/', response_class=HTMLResponse)
    async def control_page():
        return '''<!doctype html><meta charset="utf-8"><title>Read-model-only isolated NEKO QA</title>
<style>body{font:16px system-ui;background:#142331;color:#eef;padding:20px}button{padding:10px;margin:5px}iframe{width:100%;height:760px;border:1px solid #89a}pre{white-space:pre-wrap}</style>
<h1>Isolated real PluginHost · READ MODEL ONLY</h1>
<p>Private target instance only. Real manager remains untouched. No game session, speech, LLM/TTS or SDK registration. Start late, stop, and restart to verify the production title/avatar UI. Gameplay host actions are blocked.</p>
<button id="start">Start private child</button><button id="stop">Stop private child</button><button id="status">Refresh status</button>
<pre id="result"></pre><iframe title="Production plugin title — model read only" src="/plugin/neko_survivors_react/ui/"></iframe>
<script>
const nonce=NONCE;
async function status(){const r=await fetch('/qa/status');document.querySelector('#result').textContent=JSON.stringify(await r.json(),null,2);}
async function control(action){const token=await(await fetch('/security/csrf-token')).json();const r=await fetch('/qa/'+action,{method:'POST',headers:{'X-CSRF-Token':token.csrf_token,'X-QA-Nonce':nonce}});document.querySelector('#result').textContent=JSON.stringify({http:r.status,data:await r.json()},null,2);}
document.querySelector('#start').onclick=()=>control('start');document.querySelector('#stop').onclick=()=>control('stop');document.querySelector('#status').onclick=status;status();
</script>'''.replace('NONCE', json.dumps(nonce))

    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, access_log=False, log_level='warning'))
    try:
        asyncio.run(server.serve(sockets=[listener]))
    finally:
        listener.close()


if __name__ == '__main__':
    main()
