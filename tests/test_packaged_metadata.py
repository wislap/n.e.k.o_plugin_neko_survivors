"""Entry discovery must work before Python startup as well as after it."""
import tomllib
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {'game_event', 'speak', 'sync_avatar', 'open_session', 'close_session', 'heartbeat_session', 'avatar_state'}


def test_static_discovery_exposes_the_same_seven_entries_as_runtime():
    registry = pytest.importorskip('plugin.core.registry')
    service = pytest.importorskip('plugin.server.application.plugins.registry_service')
    logger = SimpleNamespace(debug=lambda *args: None, info=lambda *args: None,
                             warning=lambda *args: None, error=lambda *args: None)
    context = registry._parse_single_plugin_config(ROOT / 'plugin.toml', set(), logger, apply_user_overlays=False)
    metadata = service._build_discovery_payload(context, plugin_id=context.pid)
    assert {entry['id'] for entry in metadata['entries_preview']} == EXPECTED


def test_build_rules_exclude_development_directories_themselves():
    rules = pytest.importorskip('plugin.neko_plugin_cli.core.build_rules')
    config = tomllib.loads((ROOT / 'pyproject.toml').read_text())
    build = rules.load_build_rules(config)
    for relative in ['frontend', 'scripts', 'tests', 'node_modules', 'test-results', 'static/vendor']:
        assert rules.should_skip_path(Path(relative), is_dir=True, rules=build), relative


def test_official_builder_writes_metadata_that_the_host_accepts(tmp_path):
    import json
    import subprocess
    import sys
    from zipfile import ZipFile

    metadata_reader = pytest.importorskip('plugin.server.infrastructure.packaged_metadata')
    output = tmp_path / 'dist'
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/build-package.py'), '--out-dir', str(output)],
                            cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    generated = json.loads((output / 'plugin.meta.json').read_text())
    assert {entry['id'] for entry in generated['entries']} == EXPECTED
    assert set(generated['entry_methods']) == EXPECTED
    with ZipFile(output / 'neko_survivors_react.neko-plugin') as archive:
        assert 'payload/plugins/neko_survivors_react/plugin.meta.json' in archive.namelist()
        assert not any('/frontend/' in name or '/static/vendor/' in name for name in archive.namelist())
        archive.extractall(tmp_path / 'installed')
    installed = tmp_path / 'installed/payload/plugins/neko_survivors_react'
    accepted = metadata_reader.read_packaged_metadata(installed)
    assert accepted is not None
    assert {entry['id'] for entry in accepted.entries} == EXPECTED
