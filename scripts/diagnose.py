"""Check the exact backend interpreter; optionally run real Person 2 inference."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', action='store_true', help='Download/load weights and run Person 2 on the included tiny scene')
    args = parser.parse_args()
    lines = [f'Python: {sys.version}', f'Interpreter: {sys.executable}']
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / 'depthwizard_person5' / '.env', override=False)
    except ImportError:
        lines.append('python-dotenv is missing. Run setup.cmd or install backend requirements.')
    probe = '''import importlib, importlib.metadata as m
for name in ['numpy', 'PIL', 'rasterio', 'pyproj', 'scipy', 'sklearn', 'fastapi', 'multipart', 'dotenv', 'torch', 'torchvision', 'transformers']:
    importlib.import_module(name)
    print('OK import: ' + name, flush=True)
from transformers import AutoImageProcessor, AutoModelForDepthEstimation
import torch
print('torch=' + torch.__version__ + ' torchvision=' + m.version('torchvision') + ' transformers=' + m.version('transformers'))
print('CUDA available: ' + str(torch.cuda.is_available()))
'''
    check = subprocess.run([sys.executable, '-c', probe], capture_output=True, text=True, errors='replace')
    lines.extend([check.stdout, check.stderr])
    code = check.returncode
    if code:
        lines.append('Import check failed. Install the pipeline requirements in THIS interpreter; do not copy .venv between computers.')
    elif args.model:
        model = os.getenv('DEPTH_MODEL', 'depth_anything_v2_small')
        lines.append(f"Testing model={model}; DEPTH_DEVICE={os.getenv('DEPTH_DEVICE', 'auto')}")
        print('\n'.join(lines), flush=True)
        print('Running real Person 2; the first download may take several minutes...', flush=True)
        test = subprocess.run([
            sys.executable, str(ROOT / 'depthwizard_person2' / 'main.py'),
            '--input', str(ROOT / 'depthwizard_person3' / 'examples' / 'demo_scene.tif'),
            '--model', model, '--output', str(ROOT / '.local-archive' / 'diagnostics' / 'person2'),
        ], capture_output=True, text=True, errors='replace')
        lines.extend([test.stdout, test.stderr])
        code = test.returncode
    lines.append('PASS' if code == 0 else 'FAIL — share the final error lines from this log.')
    destination = ROOT / '.local-archive' / 'diagnostics' / 'person2-check.log'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))
    print(f'Log saved to: {destination}')
    return 0 if code == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
