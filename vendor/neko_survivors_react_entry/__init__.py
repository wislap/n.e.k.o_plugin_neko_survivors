"""Plugin-local import bridge for the source directory's dotted name.

NEKO inserts this vendor directory before importing the manifest entry.
Only the explicitly selected sibling source is loaded; no global import hooks.
"""
import importlib.util
from pathlib import Path
import sys

_source = Path(__file__).resolve().parents[2] / "neko_survivors_react_entry.py"
_spec = importlib.util.spec_from_file_location("_neko_survivors_react_source", _source)
if _spec is None or _spec.loader is None:
    raise ImportError(f"Cannot load plugin source: {_source}")
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)
SurvivorsReactPlugin = _module.SurvivorsReactPlugin
