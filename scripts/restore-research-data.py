"""Restore losslessly compressed research records for scripts expecting the original JSON paths."""
from pathlib import Path
import argparse,gzip,hashlib,json
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--only',default='',help='Restore only original paths with this prefix');args=p.parse_args()
manifest=json.loads((ROOT/'results/research-artifacts.json').read_text());count=0
for item in manifest['datasets']:
    if not item['path'].startswith(args.only):continue
    target=ROOT/item['path']
    if target.exists():continue # Never overwrite a newly rerun local experiment.
    data=gzip.decompress((ROOT/item['archive']).read_bytes())
    if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Archive hash mismatch: '+item['archive'])
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);count+=1
print(f'Restored {count} missing dataset files; existing local files were preserved.')
