"""Helpers shared by the API check scripts (see pos.py)."""
import json, os, subprocess, sys, urllib.request, urllib.error

B = os.environ.get("API", "http://localhost:4000") + "/v1"
DB = os.environ.get("DATABASE_URL", "postgres://alrmh:alrmh@localhost:5432/alrmh")
APP = os.environ.get("APP_URL", "http://localhost:8081")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "owner@alrmh.qa")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "owner-pass-2026")
failures = []


def sql(q):
    r = subprocess.run(["psql", DB, "-v", "ON_ERROR_STOP=1", "-Atc", q], capture_output=True, text=True)
    if r.returncode:
        print("psql failed:", r.stderr.strip())
        sys.exit(2)
    return r.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def call(method, path, body=None, token=None, form=None, raw=None):
    """Returns (status, json or {'location': ...}, headers). raw=(bytes, content type) sends a file as the body."""
    req = urllib.request.Request(B + path, method=method)
    data = None
    if raw is not None:
        data = raw[0]
        req.add_header("Content-Type", raw[1])
    elif form is not None:
        data = form.encode()
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    elif body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, data=data) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw[:1] in (b"{", b"[") else {}), r.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            out = json.loads(raw) if raw[:1] in (b"{", b"[") else {}
        except ValueError:
            out = {}
        if e.headers.get("Location"):
            out["location"] = e.headers["Location"]
        return e.code, out, e.headers


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def login(phone, name=None):
    sql(f"delete from otp_codes where phone = '+974{phone}'")
    call("POST", "/auth/otp", {"phone": phone})
    s, v, _ = call("POST", "/auth/verify", {"phone": phone, "code": "123456"})
    assert s == 200, (phone, v)
    if v["isNew"]:
        call("PATCH", "/me", {"name": name or ("Regress " + phone)}, v["token"])
    return v["token"]


def staff(email=ADMIN_EMAIL, password=ADMIN_PASSWORD):
    return call("POST", "/admin/auth/login", {"email": email, "password": password})[1]["token"]


