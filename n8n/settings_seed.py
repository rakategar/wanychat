#!/usr/bin/env python3
"""Isi setting akun/TikTok/email yang belum ada di wany_settings sebuah target. Rahasia tidak pernah dicetak.

  python3 settings_seed.py local http://localhost:5180
  python3 settings_seed.py cloud

- tiktok_app_id / tiktok_secret dari ~/.config/wanychat/tiktok.json (chmod 600)
- google_client_id / google_client_secret dari ~/.config/wanychat/google.json (chmod 600), bila ada
- mail_secret dibuat acak (kunci HMAC link berhenti langganan email)
- public_url hanya ditulis bila argumen kedua diberikan
Baris baru ditambahkan (baris terakhir per key yang berlaku); key yang sudah ada dengan nilai sama dilewati.
"""
import json
import os
import secrets
import sys
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
target = sys.argv[1]
cfg = json.loads((ROOT / 'targets.json').read_text())[target]
client = Client(cfg.get('mcp', 'local'))
tid, pid = cfg['tables']['settings'], cfg['projectId']
rows = json.loads(client.call('get_data_table_rows', {'dataTableId': tid, 'projectId': pid}))['rows']
cur = {}
for r in sorted(rows, key=lambda r: r['id']):
    cur[r['key']] = r.get('value') or ''

tt = json.load(open(os.path.expanduser('~/.config/wanychat/tiktok.json')))
want = {
    'tiktok_app_id': tt['app_id'], 'tiktok_secret': tt['secret'],
    'mail_from': 'contact@remot.in', 'mail_from_name': 'Wanychat',
}
gpath = os.path.expanduser('~/.config/wanychat/google.json')
if os.path.exists(gpath):
    g = json.load(open(gpath))
    want.update({'google_client_id': g['client_id'], 'google_client_secret': g['client_secret']})
if len(sys.argv) > 2:
    want['public_url'] = sys.argv[2].rstrip('/')
add = [{'key': k, 'value': v} for k, v in want.items() if cur.get(k) != v and not (k.startswith('mail_from') and cur.get(k))]
if not cur.get('mail_secret'):
    add.append({'key': 'mail_secret', 'value': secrets.token_hex(32)})
if add:
    client.call('add_data_table_rows', {'dataTableId': tid, 'projectId': pid, 'rows': add})
print('ditulis:', ', '.join(r['key'] for r in add) or '(tidak ada)')
