#!/usr/bin/env python3
"""Setel kredensial DOKU Checkout (produksi) di n8n target cloud.

  python3 doku_setup.py        # Client ID & Secret Key ditanya di terminal, tidak pernah dicetak / ditulis ke repo

Ambil dari dasbor DOKU -> Integration -> API Keys (Client ID + Active Secret Key).
"""
import getpass
import json
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
CLOUD = json.loads((ROOT / 'targets.json').read_text())['cloud']


def main():
    cid = input('DOKU Client ID: ').strip()
    key = getpass.getpass('DOKU Secret Key: ').strip()
    if not cid or len(key) < 20:
        raise SystemExit('Client ID kosong atau Secret Key terlalu pendek')
    c = Client(CLOUD['mcp'])
    c.call('add_data_table_rows', {'dataTableId': CLOUD['tables']['settings'], 'projectId': CLOUD['projectId'], 'rows': [
        {'key': 'doku_client_id', 'value': cid}, {'key': 'doku_secret_key', 'value': key}]})
    print('kredensial DOKU disimpan (client id ' + cid[:8] + '…)')


if __name__ == '__main__':
    main()
