#!/usr/bin/env python3
"""Setel login superadmin + setelan bawaan langganan di n8n cloud.

  SA_USER=nama SA_PASSWORD='...' python3 sa_setup.py      # atau tanpa env: ditanya di terminal

- Password hanya dikirim sebagai hash scrypt (format sama dengan sa_auth.js); tidak pernah ditulis ke repo atau dicetak.
- Setelan bawaan (engine_enabled, midtrans_env, biaya, ...) hanya ditambahkan kalau belum ada.
- Password lama bisa diganti dari dasbor superadmin (#/admin -> Keamanan).
"""
import base64
import getpass
import hashlib
import json
import os
import secrets
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
CLOUD = json.loads((ROOT / 'targets.json').read_text())['cloud']

DEFAULTS = {
    'engine_enabled': 'true', 'signup_open': 'true', 'announcement': '',
    'midtrans_env': 'sandbox', 'midtrans_payments': 'credit_card',
    'midtrans_fee_pct': '2.9', 'midtrans_fee_flat': '2000',
    'cost_server_idr': '450000', 'cost_other_idr': '0', 'cost_ai_per_1m_idr': '4500', 'usd_idr': '16500',
}


def scrypt_hash(pw):
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=16384, r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024)
    return '$'.join(['scrypt', '16384', '8', '1', base64.b64encode(salt).decode(), base64.b64encode(h).decode()])


def main():
    user = (os.environ.get('SA_USER') or input('Username superadmin: ')).strip().lower()
    pw = os.environ.get('SA_PASSWORD') or getpass.getpass('Password superadmin: ')
    if len(user) < 3 or len(pw) < 8:
        raise SystemExit('username min 3, password min 8 karakter')
    c = Client(CLOUD['mcp'])
    tid, pid = CLOUD['tables']['settings'], CLOUD['projectId']
    have = {r['key'] for r in json.loads(c.call('get_data_table_rows', {'dataTableId': tid, 'projectId': pid}))['rows']}
    rows = [{'key': 'sa_username', 'value': user}, {'key': 'sa_password_hash', 'value': scrypt_hash(pw)}]
    rows += [{'key': k, 'value': v} for k, v in DEFAULTS.items() if k not in have]
    c.call('add_data_table_rows', {'dataTableId': tid, 'projectId': pid, 'rows': rows})
    print('superadmin disetel untuk', user, '| setelan bawaan baru:', ', '.join(k for k in DEFAULTS if k not in have) or '-')


if __name__ == '__main__':
    main()
