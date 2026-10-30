#!/usr/bin/env python3
"""Rakit 3 workflow n8n Wanychat dari file code/*.js -> dist/<target>/*.json.

  TARGET=local python3 build.py   -> import ke docker lokal:  ./deploy.sh
  TARGET=cloud python3 build.py   -> kirim ke n8n cloud:      python3 deploy_cloud.py

ID Data Table, kredensial, dan interval scheduler per target ada di targets.json (tanpa rahasia).
"""
import json
import os
import uuid
from pathlib import Path

ROOT = Path(__file__).parent
CODE = ROOT / "code"
DIST = ROOT / "dist" / os.environ.get("TARGET", "local")

TARGET = os.environ.get("TARGET", "local")
CFG = json.loads((ROOT / "targets.json").read_text())[TARGET]
DT = CFG["tables"]
DEEPSEEK_CRED = CFG["deepseek"]  # None = belum dibuat; deploy_cloud.py menautkannya setelah dibuat di UI
FOLLOWUP_EVERY = CFG["followupEveryMin"]

EVENT_COLS = ["account_id", "type", "status", "rule_id", "rule_name", "ig_user_id", "username", "ref_id", "media_id",
              "text", "error"]
RULE_COLS = {
    "account_id": "string", "name": "string", "active": "boolean", "channel": "string", "post_ids": "string",
    "keywords": "string", "match_mode": "string", "comment_replies": "string", "dm_message": "string",
    "dm_button_title": "string", "dm_content": "string", "followup_enabled": "boolean",
    "followup_delay_min": "number", "followup_message": "string", "ai_fallback": "boolean", "ai_context": "string",
}
ACCOUNT_COLS = {
    "ig_user_id": "string", "username": "string", "name": "string", "avatar": "string", "access_token": "string",
    "token_expires_at": "dateTime", "token_refresh_error": "string", "ai_enabled": "boolean", "ai_persona": "string",
}
SESSION_COOKIE = "($('Webhook API').first().json.headers.cookie || '').match(/(?:^|;\\s*)wany_session=([^;]+)/)?.[1] || 'none'"


def nid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "igar/" + name))


def code(name):
    return (CODE / name).read_text()


def node(name, type_, version, pos, params, **extra):
    n = {"id": nid(name), "name": name, "type": type_, "typeVersion": version, "position": pos, "parameters": params}
    n.update(extra)
    return n


def table(key):
    return {"__rl": True, "mode": "id", "value": DT[key]}


def conditions(filters):
    return {"conditions": [{"keyName": k, "condition": c, "keyValue": v} for k, c, v in filters]}


def dt_get(name, pos, key, filters=None, order=None, limit=None, **extra):
    p = {"resource": "row", "operation": "get", "dataTableId": table(key), "returnAll": limit is None}
    if filters:
        p["matchType"] = "allConditions"
        p["filters"] = conditions(filters)
    if limit is not None:
        p["limit"] = limit
    if order:
        p.update({"orderBy": True, "orderByColumn": order[0], "orderByDirection": order[1]})
    return node(name, "n8n-nodes-base.dataTable", 1.1, pos, p, **extra)


def schema(cols):
    return [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True,
             "type": t, "canBeUsedToMatch": True} for c, t in cols.items()]


def dt_write(name, pos, key, op, values, types=None, filters=None, **extra):
    types = types or {}
    p = {
        "resource": "row", "operation": op, "dataTableId": table(key),
        "columns": {"mappingMode": "defineBelow", "value": values, "matchingColumns": [],
                    "schema": schema({c: types.get(c, "string") for c in values})},
        "options": {},
    }
    if filters:
        p["matchType"] = "allConditions"
        p["filters"] = conditions(filters)
    return node(name, "n8n-nodes-base.dataTable", 1.1, pos, p, **extra)


def dt_delete(name, pos, key, filters, **extra):
    return node(name, "n8n-nodes-base.dataTable", 1.1, pos, {
        "resource": "row", "operation": "deleteRows", "dataTableId": table(key), "matchType": "allConditions",
        "filters": conditions(filters), "options": {},
    }, alwaysOutputData=True, **extra)


def code_node(name, pos, file, mode="runOnceForAllItems"):
    return node(name, "n8n-nodes-base.code", 2, pos, {"mode": mode, "jsCode": code(file)})


def crypto_random(name, pos, field, length=48):
    return node(name, "n8n-nodes-base.crypto", 1, pos, {
        "action": "generate", "dataPropertyName": field, "encodingType": "hex", "stringLength": length,
    })


def switch(name, pos, field, keys):
    rules = [{
        "outputKey": k, "renameOutput": True,
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
            "conditions": [{"id": nid(name + k), "leftValue": "={{ $json." + field + " }}", "rightValue": k,
                            "operator": {"type": "string", "operation": "equals"}}],
            "combinator": "and",
        },
    } for k in keys]
    return node(name, "n8n-nodes-base.switch", 3.2, pos, {"rules": {"values": rules}, "options": {}})


def respond(name, pos, body, code_expr="200", headers=None, **extra):
    opts = {"responseCode": "=" + code_expr if code_expr.startswith("{{") else int(code_expr)}
    if headers:
        opts["responseHeaders"] = {"entries": [{"name": k, "value": v} for k, v in headers.items()]}
    return node(name, "n8n-nodes-base.respondToWebhook", 1.4, pos,
                {"respondWith": "json", "responseBody": body, "options": opts}, **extra)


def redirect(name, pos, url, cookie=None):
    opts = {}
    if cookie:
        opts["responseHeaders"] = {"entries": [{"name": "Set-Cookie", "value": cookie}]}
    return node(name, "n8n-nodes-base.respondToWebhook", 1.4, pos,
                {"respondWith": "redirect", "redirectURL": url, "options": opts}, executeOnce=True)


def webhook(name, pos, method, path, mode, **opts):
    return node(name, "n8n-nodes-base.webhook", 2.1, pos,
                {"httpMethod": method, "path": path, "responseMode": mode, "options": opts}, webhookId=nid("wh/" + name))


def connect(conns, src, dst, out=0, kind="main"):
    lst = conns.setdefault(src, {}).setdefault(kind, [])
    while len(lst) <= out:
        lst.append([])
    lst[out].append({"node": dst, "type": kind, "index": 0})


def chain(conns, *names):
    for a, b in zip(names, names[1:]):
        connect(conns, a, b)


def workflow(wid, name, nodes, conns):
    return {"id": wid, "name": name, "nodes": nodes, "connections": conns, "active": False,
            "settings": {"executionOrder": "v1", "timezone": "Asia/Jakarta", "availableInMCP": True}, "pinData": {}}


LOG_VALUES = {c: "={{ $json." + c + " }}" for c in EVENT_COLS}


# ---------------------------------------------------------------- Engine
def engine():
    n = [
        webhook("Webhook IG Verify", [0, 0], "GET", "wany-ig", "responseNode"),
        dt_get("Baca Settings Verify", [220, 0], "settings", alwaysOutputData=True),
        code_node("Cek Verify Token", [440, 0], "engine_verify.js"),
        node("Balas Verify", "n8n-nodes-base.respondToWebhook", 1.4, [660, 0], {
            "respondWith": "text", "responseBody": "={{ $json.body }}",
            "options": {"responseCode": "={{ $json.ok ? 200 : 403 }}"},
        }),
        webhook("Webhook IG Event", [0, 300], "POST", "wany-ig", "onReceived"),
        dt_get("Baca Settings", [220, 300], "settings", alwaysOutputData=True, executeOnce=True),
        dt_get("Baca Akun", [440, 300], "accounts", alwaysOutputData=True, executeOnce=True),
        dt_get("Baca Rules", [660, 300], "rules", alwaysOutputData=True, executeOnce=True),
        code_node("Proses Event", [880, 300], "engine_process.js"),
        switch("Rute Aksi", [1100, 300], "kind", ["log", "contact", "followup", "ai"]),
        dt_write("Simpan Log", [1620, 120], "events", "insert", LOG_VALUES),
        dt_write("Simpan Kontak", [1360, 300], "contacts", "upsert",
                 {c: "={{ $json." + c + " }}" for c in ["account_id", "ig_user_id", "username", "last_user_msg_at"]},
                 types={"last_user_msg_at": "dateTime"},
                 filters=[("account_id", "eq", "={{ $json.account_id }}"), ("ig_user_id", "eq", "={{ $json.ig_user_id }}")]),
        dt_write("Jadwalkan Follow Up", [1360, 460], "followups", "insert",
                 {c: "={{ $json." + c + " }}" for c in ["account_id", "ig_user_id", "username", "rule_id", "due_at", "message", "status"]},
                 types={"due_at": "dateTime"}),
        node("AI Jawab Komentar", "@n8n/n8n-nodes-langchain.chainLlm", 1.7, [1360, 640], {
            "promptType": "define",
            "text": "={{ $json.persona }}\n\nKonteks produk / postingan:\n{{ ($json.ai_context || '-').replace(/\\{nama\\}/gi, '@' + $json.username).replace(/\\{komentar\\}/gi, $json.comment_text) }}\n\n"
                    "Komentar dari @{{ $json.username }}: \"{{ $json.comment_text }}\"\n\n"
                    "Tulis SATU balasan komentar saja dalam bahasa yang sama dengan komentar, tanpa tanda kutip "
                    "dan tanpa penjelasan. Jika komentar spam, kasar, atau tidak perlu dibalas, tulis persis: SKIP",
        }, onError="continueRegularOutput"),
        node("DeepSeek Model", "@n8n/n8n-nodes-langchain.lmChatDeepSeek", 1, [1360, 840],
             {"model": "deepseek-flash", "options": {"temperature": 0.6, "maxTokens": 500, "timeout": 60000}},
             **({"credentials": {"deepSeekApi": DEEPSEEK_CRED}} if DEEPSEEK_CRED else {})),
        code_node("Kirim Balasan AI", [1620, 640], "engine_ai_send.js"),
    ]
    c = {}
    chain(c, "Webhook IG Verify", "Baca Settings Verify", "Cek Verify Token", "Balas Verify")
    chain(c, "Webhook IG Event", "Baca Settings", "Baca Akun", "Baca Rules", "Proses Event", "Rute Aksi")
    connect(c, "Rute Aksi", "Simpan Log", 0)
    connect(c, "Rute Aksi", "Simpan Kontak", 1)
    connect(c, "Rute Aksi", "Jadwalkan Follow Up", 2)
    connect(c, "Rute Aksi", "AI Jawab Komentar", 3)
    chain(c, "AI Jawab Komentar", "Kirim Balasan AI", "Simpan Log")
    connect(c, "DeepSeek Model", "AI Jawab Komentar", kind="ai_languageModel")
    return workflow("IgarEngine000001", "Wanychat · Engine", n, c)


# ---------------------------------------------------------------- Scheduler
def scheduler():
    n = [
        node("Cek Follow Up", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0],
             {"rule": {"interval": [{"field": "minutes", "minutesInterval": FOLLOWUP_EVERY}]}}),
        dt_get("Baca Settings", [220, 0], "settings", alwaysOutputData=True, executeOnce=True),
        dt_get("Baca Akun", [440, 0], "accounts", alwaysOutputData=True, executeOnce=True),
        dt_get("Baca Kontak", [660, 0], "contacts", alwaysOutputData=True, executeOnce=True),
        dt_get("Baca Follow Up Pending", [880, 0], "followups", filters=[("status", "eq", "pending")], executeOnce=True),
        code_node("Kirim Follow Up", [1100, 0], "sched_followup.js"),
        switch("Rute Hasil", [1320, 0], "kind", ["update", "log"]),
        dt_write("Update Follow Up", [1560, -100], "followups", "update",
                 {"status": "={{ $json.status }}", "sent_at": "={{ $json.sent_at }}", "error": "={{ $json.error }}"},
                 types={"sent_at": "dateTime"}, filters=[("id", "eq", "={{ $json.id }}")]),
        dt_write("Simpan Log", [1560, 100], "events", "insert", LOG_VALUES),
        node("Setiap Hari 03.00", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 300],
             {"rule": {"interval": [{"field": "days", "triggerAtHour": 3}]}}),
        dt_get("Baca Akun Token", [220, 300], "accounts"),
        code_node("Perpanjang Token", [440, 300], "sched_refresh.js"),
        dt_write("Simpan Token", [660, 300], "accounts", "update",
                 {c: "={{ $json." + c + " }}" for c in ["access_token", "token_expires_at", "token_refresh_error"]},
                 types={"token_expires_at": "dateTime"}, filters=[("ig_user_id", "eq", "={{ $json.ig_user_id }}")]),
    ]
    c = {}
    chain(c, "Cek Follow Up", "Baca Settings", "Baca Akun", "Baca Kontak", "Baca Follow Up Pending",
          "Kirim Follow Up", "Rute Hasil")
    connect(c, "Rute Hasil", "Update Follow Up", 0)
    connect(c, "Rute Hasil", "Simpan Log", 1)
    chain(c, "Setiap Hari 03.00", "Baca Akun Token", "Perpanjang Token", "Simpan Token")
    return workflow("IgarSchedule0001", "Wanychat · Scheduler", n, c)


# ---------------------------------------------------------------- Admin API + login Instagram
def admin_api():
    acc = "={{ $json.account_id }}"
    routes = ["deny", "direct", "account_update", "logout", "rules_list", "rules_save", "rules_delete",
              "events_list", "followups_list", "logs_clear"]
    list_body = "={{ { ok: true, %s: $input.all().map(i => i.json).filter(r => r.id) } }}"
    rule_values = {c: "={{ $json." + c + " }}" for c in RULE_COLS}
    session_cookie = "wany_session={{ $('Buat Sesi').item.json.session }}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000"
    n = [
        # --- API panel
        webhook("Webhook API", [0, 300], "POST", "wany-api", "responseNode"),
        dt_get("Baca Settings", [220, 300], "settings", alwaysOutputData=True, executeOnce=True),
        dt_get("Cari Sesi", [440, 300], "sessions", filters=[("token", "eq", "={{ " + SESSION_COOKIE + " }}")],
               alwaysOutputData=True, executeOnce=True),
        dt_get("Baca Akun", [660, 300], "accounts", alwaysOutputData=True, executeOnce=True),
        code_node("Proses Permintaan", [880, 300], "api_route.js"),
        switch("Rute API", [1100, 300], "route", routes),
        respond("Tolak", [1380, -260], "={{ $json.response }}", "401"),
        respond("Balas", [1380, -100], "={{ $json.response }}", "{{ $json.status || 200 }}"),
        dt_write("Update Akun", [1380, 60], "accounts", "update",
                 {c: "={{ $json.fields." + c + " }}" for c in ACCOUNT_COLS}, types=ACCOUNT_COLS,
                 filters=[("ig_user_id", "eq", "={{ $json.account_id }}")], executeOnce=True),
        respond("Balas Update Akun", [1620, 60], "={{ $('Proses Permintaan').first().json.response }}", executeOnce=True),
        dt_delete("Hapus Sesi", [1380, 220], "sessions", [("token", "eq", "={{ $json.token }}")], executeOnce=True),
        respond("Balas Logout", [1620, 220], "={{ { ok: true } }}", executeOnce=True,
                headers={"Set-Cookie": "wany_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),
        dt_get("Baca Semua Rules", [1380, 380], "rules", filters=[("account_id", "eq", acc)],
               alwaysOutputData=True, executeOnce=True),
        respond("Balas Rules", [1620, 380], list_body % "rules", executeOnce=True),
        dt_write("Simpan Rule", [1380, 540], "rules", "upsert", rule_values, types=RULE_COLS,
                 filters=[("id", "eq", "={{ $json.row_id }}"), ("account_id", "eq", acc)]),
        respond("Balas Rule Tersimpan", [1620, 540], "={{ { ok: true, rule: $json } }}", executeOnce=True),
        dt_delete("Hapus Rule", [1380, 700], "rules", [("id", "eq", "={{ $json.row_id }}"), ("account_id", "eq", acc)]),
        respond("Balas Hapus", [1620, 700], "={{ { ok: true } }}", executeOnce=True),
        dt_get("Baca Events", [1380, 860], "events", filters=[("account_id", "eq", acc)],
               order=("createdAt", "DESC"), limit="={{ $json.limit }}", alwaysOutputData=True),
        respond("Balas Events", [1620, 860], list_body % "events", executeOnce=True),
        dt_get("Baca Follow Up", [1380, 1020], "followups", filters=[("account_id", "eq", acc)],
               order=("createdAt", "DESC"), limit=200, alwaysOutputData=True),
        respond("Balas Follow Up", [1620, 1020], list_body % "followups", executeOnce=True),
        dt_delete("Hapus Semua Log", [1380, 1180], "events", [("account_id", "eq", acc)], executeOnce=True),
        dt_delete("Hapus Semua Follow Up", [1620, 1180], "followups",
                  [("account_id", "eq", "={{ $('Proses Permintaan').first().json.account_id }}")], executeOnce=True),
        respond("Balas Log Dihapus", [1860, 1180], "={{ { ok: true } }}", executeOnce=True),

        # --- Login dengan Instagram: /webhook/wany-login -> instagram.com -> /webhook/wany-oauth
        webhook("Webhook Login", [0, 1500], "GET", "wany-login", "responseNode"),
        dt_get("Baca Settings Login", [220, 1500], "settings", alwaysOutputData=True, executeOnce=True),
        crypto_random("Buat State", [440, 1500], "state", 32),
        code_node("Susun URL Login", [660, 1500], "oauth_start.js"),
        redirect("Ke Instagram", [880, 1500], "={{ $json.location }}", "={{ $json.cookie }}"),

        webhook("Webhook Login Callback", [0, 1760], "GET", "wany-oauth", "responseNode"),
        dt_get("Baca Settings Callback", [220, 1760], "settings", alwaysOutputData=True, executeOnce=True),
        dt_get("Baca Akun Callback", [440, 1760], "accounts", alwaysOutputData=True, executeOnce=True),
        code_node("Tukar Kode Login", [660, 1760], "oauth_callback.js"),
        node("Login Berhasil?", "n8n-nodes-base.if", 2.2, [880, 1760], {"conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
            "conditions": [{"id": nid("login-ok"), "leftValue": "={{ $json.ok }}", "rightValue": "",
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and"}, "options": {}}),
        dt_write("Simpan Akun", [1120, 1680], "accounts", "upsert",
                 {c: "={{ $json.account." + c + " }}" for c in list(ACCOUNT_COLS) + ["connected_at"]},
                 types=dict(ACCOUNT_COLS, connected_at="dateTime"),
                 filters=[("ig_user_id", "eq", "={{ $json.account.ig_user_id }}")]),
        crypto_random("Buat Sesi", [1340, 1680], "session", 48),
        dt_write("Simpan Sesi", [1560, 1680], "sessions", "insert", {
            "token": "={{ $json.session }}",
            "ig_user_id": "={{ $('Tukar Kode Login').item.json.account.ig_user_id }}",
            "expires_at": "={{ $now.plus(30, 'days').toISO() }}",
        }, types={"expires_at": "dateTime"}),
        redirect("Masuk ke Panel", [1780, 1680], "={{ $('Tukar Kode Login').item.json.location }}", "=" + session_cookie),
        redirect("Login Gagal", [1120, 1860], "={{ $json.location }}"),
    ]
    c = {}
    chain(c, "Webhook API", "Baca Settings", "Cari Sesi", "Baca Akun", "Proses Permintaan", "Rute API")
    targets = ["Tolak", "Balas", "Update Akun", "Hapus Sesi", "Baca Semua Rules", "Simpan Rule", "Hapus Rule",
               "Baca Events", "Baca Follow Up", "Hapus Semua Log"]
    for i, t in enumerate(targets):
        connect(c, "Rute API", t, i)
    chain(c, "Update Akun", "Balas Update Akun")
    chain(c, "Hapus Sesi", "Balas Logout")
    chain(c, "Baca Semua Rules", "Balas Rules")
    chain(c, "Simpan Rule", "Balas Rule Tersimpan")
    chain(c, "Hapus Rule", "Balas Hapus")
    chain(c, "Baca Events", "Balas Events")
    chain(c, "Baca Follow Up", "Balas Follow Up")
    chain(c, "Hapus Semua Log", "Hapus Semua Follow Up", "Balas Log Dihapus")
    chain(c, "Webhook Login", "Baca Settings Login", "Buat State", "Susun URL Login", "Ke Instagram")
    chain(c, "Webhook Login Callback", "Baca Settings Callback", "Baca Akun Callback", "Tukar Kode Login", "Login Berhasil?")
    connect(c, "Login Berhasil?", "Simpan Akun", 0)
    connect(c, "Login Berhasil?", "Login Gagal", 1)
    chain(c, "Simpan Akun", "Buat Sesi", "Simpan Sesi", "Masuk ke Panel")
    return workflow("IgarAdminApi0001", "Wanychat · Admin API", n, c)


if __name__ == "__main__":
    DIST.mkdir(parents=True, exist_ok=True)
    for wf in (engine(), scheduler(), admin_api()):
        path = DIST / (wf["id"] + ".json")
        path.write_text(json.dumps(wf, indent=2, ensure_ascii=False))
        print("ditulis", path.relative_to(ROOT), "-", len(wf["nodes"]), "node")
