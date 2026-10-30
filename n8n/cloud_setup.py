#!/usr/bin/env python3
"""Sekali jalan: buat Data Table wany_* di n8n cloud dan salin data dari n8n lokal.

  python3 cloud_setup.py https://wanychat.remot.in

- ID tabel baru ditulis ke targets.json (bukan rahasia).
- Nilai rahasia (app_secret, token akun) disalin langsung antar-server dan TIDAK pernah dicetak.
- verify_token webhook Meta dibuat baru dan dicetak sekali (dibutuhkan untuk konfigurasi Meta).
"""
import json
import secrets
import sys
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
TARGETS = json.loads((ROOT / 'targets.json').read_text())
LOCAL, CLOUD = TARGETS['local'], TARGETS['cloud']

COLUMNS = {
    'settings': {'key': 'string', 'value': 'string'},
    'rules': {'account_id': 'string', 'name': 'string', 'active': 'boolean', 'channel': 'string',
              'post_ids': 'string', 'keywords': 'string', 'match_mode': 'string', 'comment_replies': 'string',
              'dm_message': 'string', 'dm_button_title': 'string', 'dm_content': 'string',
              'followup_enabled': 'boolean', 'followup_delay_min': 'number', 'followup_message': 'string',
              'ai_fallback': 'boolean', 'ai_context': 'string'},
    'contacts': {'account_id': 'string', 'ig_user_id': 'string', 'username': 'string', 'last_user_msg_at': 'date'},
    'events': {'account_id': 'string', 'type': 'string', 'status': 'string', 'rule_id': 'string',
               'rule_name': 'string', 'ig_user_id': 'string', 'username': 'string', 'ref_id': 'string',
               'media_id': 'string', 'text': 'string', 'error': 'string'},
    'followups': {'account_id': 'string', 'ig_user_id': 'string', 'username': 'string', 'rule_id': 'string',
                  'due_at': 'date', 'message': 'string', 'status': 'string', 'sent_at': 'date', 'error': 'string'},
    'accounts': {'ig_user_id': 'string', 'username': 'string', 'name': 'string', 'avatar': 'string',
                 'access_token': 'string', 'token_expires_at': 'date', 'token_refresh_error': 'string',
                 'ai_enabled': 'boolean', 'ai_persona': 'string', 'connected_at': 'date'},
    'sessions': {'token': 'string', 'ig_user_id': 'string', 'expires_at': 'date'},
}
# Kunci settings yang masih dipakai kode; sisanya warisan versi Telegram
KEEP_SETTINGS = ['graph_version', 'gemini_enabled', 'gemini_persona', 'app_secret', 'ig_app_id']


def rows(client, project, table_id):
    out = json.loads(client.call('get_data_table_rows', {'dataTableId': table_id, 'projectId': project}))
    return out['rows']


def strip(row, cols):
    return {k: row[k] for k in cols if k in row and row[k] is not None}


def main():
    public_url = sys.argv[1].rstrip('/')
    local, cloud = Client('local'), Client(CLOUD['mcp'])
    pid = CLOUD['projectId']

    existing = {t['name']: t['id'] for t in json.loads(cloud.call('search_data_tables', {})).get('data', [])}
    for key, cols in COLUMNS.items():
        name = 'wany_' + key
        if name not in existing:
            res = json.loads(cloud.call('create_data_table', {
                'projectId': pid, 'name': name, 'columns': [{'name': c, 'type': t} for c, t in cols.items()]}))
            existing[name] = res.get('id') or res['dataTable']['id']
            print('dibuat  ', name, existing[name])
        else:
            print('sudah ada', name, existing[name])
        CLOUD['tables'][key] = existing[name]
    (ROOT / 'targets.json').write_text(json.dumps(TARGETS, indent=2) + '\n')

    def copy(key, data):
        if not data:
            return
        for i in range(0, len(data), 50):
            cloud.call('add_data_table_rows', {'dataTableId': CLOUD['tables'][key], 'projectId': pid,
                                               'rows': data[i:i + 50]})
        print('disalin ', key, len(data), 'baris')

    if rows(cloud, pid, CLOUD['tables']['settings']):
        print('settings cloud sudah terisi, lewati salin data')
        return

    src = {}
    for r in rows(local, LOCAL['projectId'], LOCAL['tables']['settings']):
        if r.get('key') in KEEP_SETTINGS and r.get('value'):
            src[r['key']] = r['value']  # baris terakhir menang
    verify = secrets.token_urlsafe(18)
    settings = [{'key': k, 'value': v} for k, v in src.items()]
    settings += [{'key': 'verify_token', 'value': verify}, {'key': 'public_url', 'value': public_url}]
    copy('settings', settings)
    for key in ('rules', 'accounts', 'contacts'):
        copy(key, [strip(r, COLUMNS[key]) for r in rows(local, LOCAL['projectId'], LOCAL['tables'][key])])

    print('\nverify_token webhook Meta:', verify)
    print('settings yang disalin:', ', '.join(src))


if __name__ == '__main__':
    main()
