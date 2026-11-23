#!/usr/bin/env python3
"""Buat Data Table wany_* yang belum ada dan tambahkan kolom yang kurang, untuk target mana pun.

  python3 tables.py local
  python3 tables.py cloud

Skema ada di cloud_setup.COLUMNS. ID tabel ditulis ke targets.json (bukan rahasia). Tidak menyalin data.
"""
import json
import sys
from pathlib import Path

from cloud_setup import COLUMNS
from mcp import Client

ROOT = Path(__file__).parent
TYPES = {'dateTime': 'date'}


def main():
    target = sys.argv[1]
    targets = json.loads((ROOT / 'targets.json').read_text())
    cfg = targets[target]
    client = Client(cfg.get('mcp', 'local'))
    pid = cfg['projectId']
    existing = {t['name']: t for t in json.loads(client.call('search_data_tables', {})).get('data', [])
                if t.get('projectId') == pid}
    for key, cols in COLUMNS.items():
        name = 'wany_' + key
        t = existing.get(name)
        if not t:
            res = json.loads(client.call('create_data_table', {
                'projectId': pid, 'name': name, 'columns': [{'name': c, 'type': TYPES.get(v, v)} for c, v in cols.items()]}))
            tid = res.get('id') or res['dataTable']['id']
            print('dibuat   ', name, tid)
        else:
            tid = t['id']
            have = {c['name'] for c in t.get('columns', [])}
            for c, v in cols.items():
                if c not in have:
                    client.call('add_data_table_column', {'dataTableId': tid, 'projectId': pid, 'name': c,
                                                          'type': TYPES.get(v, v)})
                    print('kolom +  ', name, c)
        cfg['tables'][key] = tid
    (ROOT / 'targets.json').write_text(json.dumps(targets, indent=2) + '\n')
    print('targets.json diperbarui untuk', target)


if __name__ == '__main__':
    main()
