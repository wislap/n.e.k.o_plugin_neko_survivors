"""Copy a standalone source checkout into the pinned host for release checks."""
import shutil
import sys
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
shutil.copytree(source, destination, ignore=shutil.ignore_patterns(
    '.git', 'node_modules', '.venv', '__pycache__', 'dist', 'test-results',
))
