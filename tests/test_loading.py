"""Exercise the actual host loader with this dotted source directory."""
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_actual_host_loader_selects_this_plugin():
    host = pytest.importorskip('plugin.core.host')
    logger = SimpleNamespace(debug=lambda *args: None, info=lambda *args: None)
    path_before = list(sys.path)
    try:
        host._prepare_child_plugin_vendor_path(ROOT / 'plugin.toml', logger)
        module = host._import_plugin_module('neko_survivors_react_entry', ROOT / 'plugin.toml', logger)
        cls = module.SurvivorsReactPlugin
        implementation = sys.modules[cls.__module__]
        assert Path(implementation.__file__).resolve() == ROOT / 'neko_survivors_react_entry.py'
        assert implementation.PLUGIN_ID == 'neko_survivors_react'
        from support.plugin import make
        instance, _ = make()
        assert instance._vendor_dir() == ROOT / 'static/vendor'
    finally:
        sys.path[:] = path_before


def test_source_only_snapshot_limit_is_explicit():
    host = pytest.importorskip('plugin.core.host')
    logger = SimpleNamespace(debug=lambda *args: None, info=lambda *args: None)
    with pytest.raises(ValueError, match='must match its source directory'):
        host._import_plugin_module('neko_survivors_react_entry', ROOT / 'plugin.toml', logger, source_only=True)
