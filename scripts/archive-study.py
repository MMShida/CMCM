"""Archive completed experiment records losslessly; retain runnable configs and protocols.

Pass a study directory. Local originals are preserved and ignored by Git. Never run
against a study whose output files are still being written.
"""
from pathlib import Path
import argparse, gzip, hashlib, json

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('study', choices=['route-study', 'plus-study'])
parser.add_argument('--available',action='store_true',help='Archive completed records at an explicit finalization cutoff; absent records remain unrun.')
args = parser.parse_args()
folder = ROOT / 'results' / args.study
manifest_path = ROOT / 'results/research-artifacts.json'
manifest = json.loads(manifest_path.read_text())
datasets = {x['path']: x for x in manifest['datasets']}
sources = {x['oldPath']: x for x in manifest['sourceSnapshots']}
ignore = ROOT / '.gitignore'
ignored = set(ignore.read_text().splitlines())
add_ignore = set()
names = {
    'route-study': ['questions', 'resolution', 'robustness', 'convergence',
                    'overall-confirmation', 'screen', 'validation', 'confirmation', 'opt-Lite'],
    'plus-study': ['screen', 'validation', 'staff-validation', 'confirmation',
                   'ablations', 'devices', 'obstructions', 'questions', 'uncertainty',
                   'numerics', 'opt-Plus', 'speed-sensitivity', 'speed-confirmation',
                   'staff-expansion-screen', 'staff-expansion-validation',
                   'staff-expansion-confirmation', 'staff-expansion-robustness', 'final-resolution',
                   'guidance-refinement-search', 'guidance-refinement-validation',
                   'guidance-refinement-confirmation', 'guidance-refinement-fine',
                   'guidance-refinement-robustness', 'resolution-diagnostic'],
}[args.study]
records = [folder / (name + '.json') for name in names]
records += list(folder.glob('opt-*-trials.jsonl'))
for path in records:
    if not path.exists():
        if args.available:
            print('Unrun; no archive: '+path.name);continue
        raise FileNotFoundError('Required completed record missing: ' + str(path))
    raw = path.read_bytes()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    assert gzip.decompress(compressed) == raw
    archive = Path(str(path) + '.gz')
    archive.write_bytes(compressed)
    rel = path.relative_to(ROOT).as_posix()
    datasets[rel] = dict(path=rel, archive=archive.relative_to(ROOT).as_posix(),
                         bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                         compressedBytes=len(compressed))
    add_ignore.add('/' + rel)
    print(f'{rel}: {len(raw):,} -> {len(compressed):,} bytes')
for path in folder.glob('*-source.json'):
    if path.name.startswith('development-'):
        continue
    obj = json.loads(path.read_text())
    archive = ROOT / 'results/source-snapshots' / (obj['sourceHash'] + '.json.gz')
    archive.parent.mkdir(exist_ok=True)
    if not archive.exists():
        archive.write_bytes(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))
    assert json.loads(gzip.decompress(archive.read_bytes()))['files'] == obj['files']
    rel = path.relative_to(ROOT).as_posix()
    sources[rel] = dict(oldPath=rel, sourceHash=obj['sourceHash'])
manifest['datasets'] = sorted(datasets.values(), key=lambda x: x['path'])
manifest['sourceSnapshots'] = sorted(sources.values(), key=lambda x: x['oldPath'])
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
new = sorted(add_ignore - ignored)
if new:
    with ignore.open('a') as out:
        out.write('\n# ' + args.study + ': lossless archives are tracked; local raw copies are not.\n')
        out.write('\n'.join(new) + '\n')
