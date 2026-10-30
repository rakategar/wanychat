#!/usr/bin/env python3
"""Tautkan kredensial DeepSeek (dibuat manual di UI n8n cloud) ke node "DeepSeek Model", lalu publish Engine.

  python3 link_deepseek.py
"""
import json
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
TARGETS = json.loads((ROOT / 'targets.json').read_text())
CLOUD = TARGETS['cloud']

client = Client(CLOUD['mcp'])
creds = [c for c in json.loads(client.call('list_credentials', {}))['data'] if c['type'] == 'deepSeekApi']
if not creds:
    raise SystemExit('Belum ada kredensial DeepSeek di n8n cloud. Buat dulu: Credentials -> Add -> DeepSeek.')
cred = creds[0]
CLOUD['deepseek'] = {'id': cred['id'], 'name': cred['name']}
(ROOT / 'targets.json').write_text(json.dumps(TARGETS, indent=2) + '\n')
wid = CLOUD['workflows']['IgarEngine000001']
client.call('update_workflow', {'workflowId': wid, 'operations': [{
    'type': 'setNodeCredential', 'nodeName': 'DeepSeek Model', 'credentialKey': 'deepSeekApi',
    'credentialId': cred['id'], 'credentialName': cred['name']}]})
res = json.loads(client.call('publish_workflow', {'workflowId': wid}))
print('ditautkan', cred['name'], '->', 'Engine dipublish' if res.get('success') else 'GAGAL publish: ' + str(res.get('error')))
