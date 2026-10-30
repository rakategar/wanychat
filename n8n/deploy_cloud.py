#!/usr/bin/env python3
"""Kirim workflow dist/cloud/*.json ke n8n cloud lewat MCP, lalu publish.

  TARGET=cloud python3 build.py && python3 deploy_cloud.py

- Belum ada di cloud -> dibuat (SDK kode berisi trigger pertama) lalu node & koneksi lain ditambah via update_workflow.
- Sudah ada (ID di targets.json) -> parameter tiap node diganti (cukup untuk perubahan kode/isi node).
  Kalau struktur node/koneksi berubah, arsipkan workflow-nya di n8n, hapus ID-nya dari targets.json, lalu jalankan lagi.
"""
import json
import sys
from pathlib import Path

from mcp import Client

ROOT = Path(__file__).parent
TARGETS = json.loads((ROOT / 'targets.json').read_text())
CLOUD = TARGETS['cloud']
SETTING_KEYS = ('executeOnce', 'alwaysOutputData', 'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries')


def batches(ops, n=90):
    for i in range(0, len(ops), n):
        yield ops[i:i + n]


def node_op(n):
    out = {k: n[k] for k in ('name', 'type', 'typeVersion', 'parameters', 'position', 'credentials') if k in n}
    return {'type': 'addNode', 'node': out}


def create(client, wf):
    first = next(n for n in wf['nodes'] if 'trigger' in n['type'].lower() or n['type'].endswith('.webhook'))
    cfg = {'name': first['name'], 'parameters': first['parameters'], 'position': first['position']}
    code = (f"const t = trigger({{ type: {json.dumps(first['type'])}, version: {first['typeVersion']}, "
            f"config: {json.dumps(cfg, ensure_ascii=False)} }});\n"
            f"export default workflow('wany', {json.dumps(wf['name'])}).add(t);\n")
    res = client.call('create_workflow_from_code', {
        'code': code, 'name': wf['name'], 'projectId': CLOUD['projectId'],
        'versionName': 'Migrasi dari n8n lokal', 'description': 'Wanychat: ' + wf['name'].split('·')[-1].strip()})
    wid = json.loads(res).get('workflowId') or json.loads(res)['id']

    ops = [node_op(n) for n in wf['nodes'] if n['name'] != first['name']]
    for n in wf['nodes']:
        st = {k: n[k] for k in SETTING_KEYS if k in n}
        if st:
            ops.append({'type': 'setNodeSettings', 'nodeName': n['name'], 'settings': st})
    for src, kinds in wf['connections'].items():
        for kind, outputs in kinds.items():
            for idx, targets in enumerate(outputs):
                for t in targets or []:
                    op = {'type': 'addConnection', 'source': src, 'target': t['node'], 'sourceIndex': idx,
                          'targetIndex': t.get('index', 0)}
                    if kind != 'main':
                        op['connectionType'] = kind
                    ops.append(op)
    ops.append({'type': 'setWorkflowSettings', 'settings': {
        'timezone': wf['settings'].get('timezone', 'Asia/Jakarta'), 'executionOrder': 'v1'}})
    # urutan: semua addNode dulu, baru settings & koneksi
    for b in batches(ops):
        client.call('update_workflow', {'workflowId': wid, 'operations': b})
    return wid


def update(client, wid, wf):
    ops = [{'type': 'updateNodeParameters', 'nodeName': n['name'], 'parameters': n['parameters'], 'replace': True}
           for n in wf['nodes']]
    for b in batches(ops):
        client.call('update_workflow', {'workflowId': wid, 'operations': b})


def main():
    client = Client(CLOUD['mcp'])
    only = sys.argv[1:]
    for f in sorted((ROOT / 'dist' / 'cloud').glob('*.json')):
        wf = json.loads(f.read_text())
        key = f.stem
        if only and key not in only:
            continue
        wid = CLOUD['workflows'].get(key)
        if wid:
            update(client, wid, wf)
            print('diperbarui', wf['name'], wid)
        else:
            wid = create(client, wf)
            CLOUD['workflows'][key] = wid
            (ROOT / 'targets.json').write_text(json.dumps(TARGETS, indent=2) + '\n')
            print('dibuat    ', wf['name'], wid)
        try:
            res = json.loads(client.call('publish_workflow', {'workflowId': wid}))
            print('  dipublish' if res.get('success') else '  BELUM dipublish: ' + str(res.get('error'))[:400])
        except RuntimeError as e:
            print('  BELUM dipublish:', str(e)[:400])


if __name__ == '__main__':
    main()
