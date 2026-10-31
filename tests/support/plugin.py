"""Construct the real plugin with a replaceable, in-memory HTTP port."""
import importlib.util
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from weakref import WeakKeyDictionary

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('survivors_react_test_source', ROOT / 'neko_survivors_react_entry.py')
MOD = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MOD
SPEC.loader.exec_module(MOD)
_PORTS = WeakKeyDictionary()

class HttpPort:
    def __init__(self):
        self.handler = lambda *args, **kwargs: (0, b'')
    def __call__(self, *args, **kwargs):
        return self.handler(*args, **kwargs)

def set_http(plugin, handler):
    _PORTS[plugin].handler = handler

def current_http(plugin):
    return _PORTS[plugin].handler

def make(receipt=None):
    port = HttpPort()
    context = SimpleNamespace(plugin_id=MOD.PLUGIN_ID, logger=logging.getLogger('survivors-test'),
                              metadata={}, config_path=ROOT / 'plugin.toml')
    plugin = MOD.SurvivorsReactPlugin(context, http_request=port)
    _PORTS[plugin] = port
    calls = []
    def push(**kwargs):
        calls.append(kwargs)
        return receipt if receipt is not None else {'submitted': True}
    plugin.push_message = push
    return plugin, calls

def install_dialogue(plugin, response=None):
    requests = []
    plugin._sessions['test-session'] = {'active': True, 'lanlan_name': 'YUI', 'payload': {'lanlan_name':'YUI','session_id':'neko_survivors_react_test-session','sdk_route_instance_id':'route-123'}}
    def request(method, path, body=None, timeout=15):
        requests.append((path, json.loads(body) if body else None))
        if path == '/api/characters': return 200, b'{"current":"unused", "\xe5\xbd\x93\xe5\x89\x8d\xe7\x8c\xab\xe5\xa8\x98":"YUI"}'
        if path.endswith('/chat'): return 200, json.dumps(response if response is not None else {'line':'A commentary line','control':{}}).encode()
        return 200, b'{"ok":true,"method":"project_tts"}'
    set_http(plugin, request)
    return requests

