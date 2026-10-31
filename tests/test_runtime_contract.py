"""Run one actual NEKO plugin process and actual static/UI action routes."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

ROOT=Path(__file__).resolve().parents[1]

def test_real_plugin_runtime_and_surface_contract():
    base=ROOT/'test-results/tmp';base.mkdir(parents=True,exist_ok=True)
    run=Path(tempfile.mkdtemp(prefix='plugin-contract-',dir=base))
    environment=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',TMPDIR=str(run),NEKO_STORAGE_SELECTED_ROOT=str(run/'runtime-data'),NEKO_STORAGE_ANCHOR_ROOT=str(run/'runtime-data'))
    result=subprocess.run([sys.executable,str(ROOT/'tests/runtime_contract_probe.py'),str(run)],cwd=ROOT.parents[2],env=environment,capture_output=True,text=True,timeout=45)
    (run/'probe.log').write_text(result.stdout+'\n'+result.stderr)
    if 'NEKO_CONTRACT_SKIP:' in result.stdout: pytest.skip('Actual PluginHost HTTP fixture injection requires the Linux fork runtime')
    assert result.returncode==0, result.stdout[-8000:]+'\n'+result.stderr[-12000:]
    assert 'NEKO_CONTRACT_OK:' in result.stdout
