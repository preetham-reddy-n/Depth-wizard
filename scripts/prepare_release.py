"""Package current source for sharing; never include venvs, models or local jobs."""
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'.git', '.venv', 'node_modules', 'dist', '__pycache__', '.pytest_cache',
            '.pnpm-store', '.local-archive', '.cache'}


def main():
    result = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                            cwd=ROOT, check=True, capture_output=True)
    files = []
    for name in sorted(set(result.stdout.decode('utf-8').split('\0')) - {''}):
        relative = Path(name)
        if any(part in EXCLUDED or part.startswith(('runtime', '_tmp')) for part in relative.parts):
            continue
        if relative.name.startswith('.env') and relative.name != '.env.example':
            continue
        if relative.suffix in {'.log', '.pyc', '.pt', '.pth', '.safetensors', '.local'}:
            continue
        source = (ROOT / relative).resolve()
        if not source.is_relative_to(ROOT) or not source.is_file():
            continue
        if source.stat().st_size > 50 * 1024 * 1024:
            raise ValueError(f'Review oversized release file: {relative}')
        files.append((source, relative.as_posix()))
    destination = ROOT / '.local-archive' / 'release' / 'DepthWizard-source.zip'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for source, name in files:
            archive.write(source, f'DepthWizard/{name}')
    print(f'Packaged {len(files)} files, {destination.stat().st_size:,} bytes: {destination}')


if __name__ == '__main__':
    main()
