"""Accessibility check: axe-core on 26 screens of the customer app, in English and Arabic.

Signs in as the demo customer (SEED_DEMO=true, OTP_MODE=preview). Fails on any issue
axe finds. Automated checks catch roughly a third of real problems; try the app with
VoiceOver or TalkBack as well.

    AXE=/path/to/axe.min.js API=http://localhost:4000 APP=http://localhost:8081 python3 tests/e2e/a11y.py
"""
import collections, json, os, sys, urllib.request
from playwright.sync_api import sync_playwright

API = os.environ.get("API", "http://localhost:4000") + "/v1"
APP = os.environ.get("APP", "http://localhost:8081")
AXE = open(os.environ["AXE"]).read()
CHROME = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")


def post(path, body):
    req = urllib.request.Request(API + path, method="POST", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())


post("/auth/otp", {"phone": "55551234"})
tok = post("/auth/verify", {"phone": "55551234", "code": "123456"})["token"]
orders = json.loads(urllib.request.urlopen(urllib.request.Request(API + "/orders", headers={"Authorization": "Bearer " + tok})).read())
family = json.loads(urllib.request.urlopen(urllib.request.Request(API + "/family", headers={"Authorization": "Bearer " + tok})).read())
order = (orders["active"] + orders["past"])[0]["id"]

SIGNED_OUT = ["/onboarding/language", "/onboarding/welcome", "/auth/phone", "/install"]
SIGNED_IN = ["/home", "/shop", "/product/white-ghutra", "/design/collar", "/design/fabric", "/design/colour", "/design/for-whom", "/design/measure",
             "/book?mode=standalone&kind=branch", "/basket", "/checkout", "/orders", f"/orders/{order}", "/rewards", "/rewards/redeem", "/account",
             "/account/notifications", "/account/help", "/account/profile", "/account/addresses", "/account/family", f"/account/member/{family[0]['id']}"]

by_rule = collections.defaultdict(lambda: {"count": 0, "screens": set(), "examples": [], "impact": None, "help": None})
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    for lang in ("en", "ar"):
        for signed, paths in ((False, SIGNED_OUT), (True, SIGNED_IN)):
            ctx = browser.new_context(viewport={"width": 420, "height": 900})
            ctx.add_init_script(f"localStorage.setItem('alrmh.lang','{lang}');" + (f"localStorage.setItem('alrmh.token','{tok}');" if signed else ""))
            page = ctx.new_page()
            for path in paths:
                page.goto(APP + path); page.wait_for_timeout(2200)
                page.add_script_tag(content=AXE)
                res = page.evaluate("""async () => { const r = await axe.run(document, { resultTypes: ['violations'] });
                  return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => (n.target.join(' ') + ' :: ' + (n.html || '').slice(0, 140))) })) }""")
                for v in res:
                    r = by_rule[v["id"]]
                    r["count"] += len(v["nodes"]); r["screens"].add(path.split("?")[0]); r["impact"] = v["impact"]; r["help"] = v["help"]
                    if len(r["examples"]) < 4: r["examples"] += v["nodes"][: 4 - len(r["examples"])]
            ctx.close()
    browser.close()

total = sum(r["count"] for r in by_rule.values())
print(f"{total} issues across {len(by_rule)} rules")
for rid, r in sorted(by_rule.items(), key=lambda x: -x[1]["count"]):
    print(f"\n[{r['impact']}] {rid}: {r['count']} on {len(r['screens'])} screens — {r['help']}")
    for e in r["examples"]:
        print("    ", e)
sys.exit(1 if total else 0)
