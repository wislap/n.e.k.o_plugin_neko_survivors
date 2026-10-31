"""Build with the host's isolated metadata scanner and verify the generated artifact."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import tomllib
from pathlib import Path
from zipfile import ZipFile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host-root', type=Path)
    parser.add_argument('--out-dir', type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    host_root = args.host_root or next((path for path in (Path.cwd(), *source.parents)
        if (path / 'plugin/neko_plugin_cli/core/build.py').is_file()), None)
    if host_root is None:
        parser.error('Run in the NEKO host checkout or provide --host-root.')
    host_root = host_root.resolve()
    if not (host_root / 'plugin/neko_plugin_cli/core/build.py').is_file():
        parser.error('--host-root must contain the NEKO plugin build tools.')
    sys.path.insert(0, str(host_root))

    from plugin.neko_plugin_cli.core.build import PluginBuilder
    from plugin.server.infrastructure.packaged_metadata import read_packaged_metadata

    configuration = tomllib.loads((source / 'plugin.toml').read_text())
    manifest = configuration['plugin']
    plugin_id = manifest['id']
    expected = {entry if isinstance(entry, str) else entry['id'] for entry in configuration['entries']}
    output = (args.out_dir or source / 'dist').resolve()
    output.mkdir(parents=True, exist_ok=True)
    package = output / f'{plugin_id}.neko-plugin'
    # The plugin-local vendor shim is a normal import entry, not a source-only namespace.
    # PluginBuilder's ordinary mode still scans in an isolated subprocess; it never starts the plugin.
    builder = PluginBuilder()
    result = builder.build_plugin(source, out_file=package)
    with tempfile.TemporaryDirectory(prefix='neko_survivors_metadata_') as temporary:
        extracted = Path(temporary)
        with ZipFile(package) as archive:
            archive.extractall(extracted)
        payload = extracted / 'payload'
        runtime = payload / 'plugins' / plugin_id
        metadata = read_packaged_metadata(runtime)
        if metadata is None or {entry['id'] for entry in metadata.entries} != expected:
            raise RuntimeError('Package metadata is missing, stale, or has a different entry table.')
        if builder.compute_payload_hash(payload) != result.payload_hash:
            raise RuntimeError('Exported package payload hash does not match the build.')
        metadata_path = output / 'plugin.meta.json'
        shutil.copy2(runtime / 'plugin.meta.json', metadata_path)
    print(json.dumps({'package': str(package), 'metadata': str(metadata_path),
        'entries': sorted(expected), 'payload_hash_verified': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
