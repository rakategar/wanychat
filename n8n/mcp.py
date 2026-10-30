#!/usr/bin/env python3
"""Minimal MCP client for an n8n instance (no secrets in this file).

Target config: ~/.config/wanychat/<target>.json  ->  {"url": "...", "token": "..."}
  local:  reads the n8n-mcp entry from ~/.claude.json instead.

Usage:
  mcp.py <target> tools                         # list tool names
  mcp.py <target> schema <tool>                 # print a tool's input schema
  mcp.py <target> call <tool> '<json args>'     # call a tool, print result text
  mcp.py <target> call <tool> @args.json
"""
import json, os, sys, urllib.request

HOME = os.path.expanduser('~')


def load_target(name):
    if name == 'local':
        cfg = json.load(open(f'{HOME}/.claude.json'))
        srv = cfg['mcpServers']['n8n-mcp']
        return srv['url'], srv['headers']['Authorization'].split(' ', 1)[1]
    d = json.load(open(f'{HOME}/.config/wanychat/{name}.json'))
    return d['url'], d['token']


class Client:
    def __init__(self, target):
        self.url, self.token = load_target(target)
        self.session = None
        self.n = 0
        self._rpc('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {},
                                 'clientInfo': {'name': 'wanychat-cli', 'version': '1'}})
        self._rpc('notifications/initialized', None, notify=True)

    def _rpc(self, method, params, notify=False):
        body = {'jsonrpc': '2.0', 'method': method}
        if params is not None:
            body['params'] = params
        if not notify:
            self.n += 1
            body['id'] = self.n
        h = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
             'Authorization': 'Bearer ' + self.token}
        if self.session:
            h['Mcp-Session-Id'] = self.session
        req = urllib.request.Request(self.url, json.dumps(body).encode(), h, method='POST')
        with urllib.request.urlopen(req, timeout=300) as r:
            self.session = r.headers.get('Mcp-Session-Id') or self.session
            raw = r.read().decode()
        if notify or not raw.strip():
            return None
        if raw.lstrip().startswith('{'):
            msg = json.loads(raw)
        else:  # SSE
            msg = None
            for line in raw.splitlines():
                if line.startswith('data:'):
                    m = json.loads(line[5:])
                    if m.get('id') == body.get('id'):
                        msg = m
        if 'error' in msg:
            raise RuntimeError(json.dumps(msg['error']))
        return msg['result']

    def tools(self):
        return self._rpc('tools/list', {})['tools']

    def call(self, tool, args):
        res = self._rpc('tools/call', {'name': tool, 'arguments': args})
        out = '\n'.join(c.get('text', '') for c in res.get('content', []) if c.get('type') == 'text')
        if res.get('isError'):
            raise RuntimeError(out)
        return out


def main():
    target, cmd = sys.argv[1], sys.argv[2]
    c = Client(target)
    if cmd == 'tools':
        for t in c.tools():
            print(t['name'])
    elif cmd == 'schema':
        t = next(t for t in c.tools() if t['name'] == sys.argv[3])
        print(t.get('description', '')[:3000])
        print(json.dumps(t['inputSchema'], indent=1))
    elif cmd == 'call':
        a = sys.argv[4] if len(sys.argv) > 4 else '{}'
        args = json.load(open(a[1:])) if a.startswith('@') else json.loads(a)
        print(c.call(sys.argv[3], args))


if __name__ == '__main__':
    main()
