from pathlib import Path
import json
import tomllib

ROOT = Path(__file__).resolve().parents[1]

def test_independent_manifest_identity():
    manifest = tomllib.loads((ROOT / 'plugin.toml').read_text())
    assert manifest['plugin']['id'] == 'neko_survivors_react'
    assert manifest['plugin']['entry'] == 'neko_survivors_react_entry:SurvivorsReactPlugin'
    assert manifest['plugin']['ui']['panel'][0]['mode'] == 'static'
    assert (ROOT / 'vendor/neko_survivors_react_entry/__init__.py').is_file()
    assert (ROOT / 'neko_survivors_react_entry.py').is_file()


def test_no_spoiler_in_listing():
    for name in ('plugin.toml', 'README.md'):
        text = (ROOT / name).read_text()
        assert '\u8299\u5170' not in text
        assert 'Flan' + 'dre' not in text
    # Runtime translations include unlocked challenges; only the public listing
    # fields must avoid revealing their names before the player discovers them.
    for name in ('i18n/zh-CN.json', 'i18n/en.json'):
        messages = json.loads((ROOT / name).read_text())
        for key in ('plugin.name', 'plugin.description'):
            text = messages.get(key, '')
            assert '\u8299\u5170' not in text
            assert 'Flan' + 'dre' not in text
