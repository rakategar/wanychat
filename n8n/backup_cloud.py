#!/usr/bin/env python3
"""Simpan salinan workflow yang sedang aktif di n8n cloud ke folder lokal (tidak di-commit).

  python3 backup_cloud.py          -> n8n/backup/<YYYY-MM-DD_HHMM>/<key>.json

Isinya graf workflow (node, kode, koneksi). Rahasia ada di Data Table & kredensial n8n, bukan di sini.
"""
import json
from datetime import datetime
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
CLOUD = json.loads((ROOT / 'targets.json').read_text())['cloud']


def main():
    client = Client(CLOUD['mcp'])
    out = ROOT / 'backup' / datetime.now().strftime('%Y-%m-%d_%H%M')
    out.mkdir(parents=True, exist_ok=True)
    for key, wid in CLOUD['workflows'].items():
        wf = json.loads(client.call('get_workflow_details', {'workflowId': wid}))['workflow']
        wf.pop('pinData', None)  # data eksekusi contoh bisa berisi data pengguna
        (out / (key + '.json')).write_text(json.dumps(wf, indent=2, ensure_ascii=False))
        print('disimpan', key, wf.get('name'), len(wf.get('nodes', [])), 'node')
    print('folder:', out.relative_to(ROOT))


if __name__ == '__main__':
    main()
