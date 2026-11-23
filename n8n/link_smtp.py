#!/usr/bin/env python3
"""Catat kredensial SMTP "Wanychat SMTP" (dibuat manual di UI n8n) ke targets.json, supaya build.py menautkannya
ke semua node "Kirim ..." (email OTP, invoice, promosi). Setelah ini: TARGET=cloud python3 build.py && python3 deploy_cloud.py

  python3 link_smtp.py            # target cloud
  python3 link_smtp.py local
"""
import json
import sys
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
target = sys.argv[1] if len(sys.argv) > 1 else 'cloud'
targets = json.loads((ROOT / 'targets.json').read_text())
cfg = targets[target]
creds = [c for c in json.loads(Client(cfg.get('mcp', 'local')).call('list_credentials', {}))['data'] if c['type'] == 'smtp']
if not creds:
    raise SystemExit('Belum ada kredensial SMTP. Buat dulu di n8n: Credentials -> Add -> SMTP, beri nama "Wanychat SMTP".')
cred = next((c for c in creds if c['name'] == 'Wanychat SMTP'), creds[0])
cfg['smtp'] = {'id': cred['id'], 'name': cred['name']}
(ROOT / 'targets.json').write_text(json.dumps(targets, indent=2) + '\n')
print('ditautkan', cred['name'], cred['id'], '->', target)
