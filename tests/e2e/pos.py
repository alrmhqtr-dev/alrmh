"""The point of sale, driven through the admin screens, in Arabic (as a cashier) and English (as the owner).

Needs the API (SEED_DEMO=true, OTP_MODE=preview, PAYMENT_MODE=mock, RATE_LIMITS=off),
the built admin, `psql`, and Chrome. Runs after journey.py or on its own:

    API=http://localhost:4000 ADMIN=http://localhost:5174 python3 tests/e2e/pos.py

Counter: open the register -> scan a product -> pay cash, change shown -> the
receipt opens to print. A customer added at the counter: measure, two thobes,
a deposit; later the balance is taken on the order. Every POS page opens without
an error in both languages (screenshots in SHOTS), axe finds no issues on them,
and the register closes with the cash counted.
"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

API = os.environ.get("API", "http://localhost:4000") + "/v1"
ADMIN = os.environ.get("ADMIN", "http://localhost:5174")
DB = os.environ.get("DATABASE_URL", "postgres://alrmh:alrmh@localhost:5432/alrmh")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "owner@alrmh.qa")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ci-owner-password")
CHROME = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
SHOTS = os.environ.get("SHOTS", "/tmp/e2e-shots")
AXE = open(os.environ["AXE"]).read() if os.environ.get("AXE") else None
os.makedirs(SHOTS, exist_ok=True)
results, errors = [], []


def sql(q):
    return subprocess.run(["psql", DB, "-Atc", q], capture_output=True, text=True).stdout.strip()


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
    try:
        return json.loads(urllib.request.urlopen(req).read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"error": e.code, **json.loads(e.read() or b"{}")}


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("ok   " if ok else "FAIL ") + name + (f"   [{detail}]" if detail and not ok else ""), flush=True)
    return ok


owner = call("POST", "/admin/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})["token"]
branch = call("GET", "/admin/branches", token=owner)[0]["id"]
run = str(int(time.time()))[-5:]
# A tracked product with 10 on the shelf, and a cashier.
SKU = f"OUD-{run}"
prod = call("POST", "/admin/products", {"category": "fragrance", "name_en": f"Oud oil {run}", "name_ar": f"دهن عود {run}", "price": 120, "cost": 50, "sku": SKU, "track_stock": True, "in_app": False}, owner)["id"]
call("POST", "/admin/stock/adjustments", {"branchId": branch, "reason": "e2e", "lines": [{"kind": "product", "id": prod, "qty": 10}]}, owner)
CASHIER = f"cashier{run}@alrmh.qa"
call("POST", "/admin/staff", {"email": CASHIER, "name": "أمين الكاشير", "role": "cashier", "password": "cashier-pass-2026", "branchId": branch, "language": "ar"}, owner)
level = lambda: float(sql(f"select coalesce(sum(qty),0) from stock_moves where item_kind = 'product' and item_id = '{prod}' and branch_id = '{branch}'"))

PAGES = ["/", "/pos", "/sales", "/sales?payment=due", "/drafts", "/quotations", "/returns", "/shipments", "/registers", "/discounts", "/products", "/labels", "/stock", "/stock/adjustments",
         "/stock/transfers", "/suggestions", "/catalogue", "/brands", "/units", "/variations", "/warranties", "/purchases", "/purchases/new", "/suppliers", "/customers", "/customer-groups",
         "/expenses", "/expense-categories", "/tailor", "/tailor/measurements", "/factory", "/factory/photos", "/orders", "/appointments", "/import", "/m/products", "/m/sales",
         "/settings/company", "/settings/invoice", "/settings/barcode", "/settings/pos", "/printing", "/whatsapp", "/tax-rates", "/service-types", "/agents"]
OWNER_ONLY = ["/reports", "/reports?r=products", "/roles", "/staff", "/audit"]


def login(page, email, password):
    page.goto(ADMIN + "/")
    page.fill('[data-testid="login-email"]', email); page.fill('[data-testid="login-password"]', password); page.click('[data-testid="login-submit"]')
    page.wait_for_selector('[data-testid="nav-overview"]', timeout=15000)


def counter(browser, lang, email, password):
    tag = f"[{lang}]"
    sql(f"update staff_users set language = '{lang}' where email = '{email}'")
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{tag} {e}"))
    login(page, email, password)
    check(f"{tag} the admin opens in {'Arabic, right to left' if lang == 'ar' else 'English'}", page.evaluate("document.documentElement.dir") == ("rtl" if lang == "ar" else "ltr"))

    # ---- open the register ----
    page.click('[data-testid="top-pos"]')
    page.wait_for_selector('[data-testid="register-gate"]', timeout=15000)
    page.fill('[data-testid="register-opening"]', "300")
    page.click('[data-testid="register-open"]')
    page.wait_for_selector('[data-testid="pos-search"]', timeout=15000)
    check(f"{tag} a closed register is opened with the cash in the drawer before selling", sql(f"select opening_cash::int from cash_registers r join staff_users u on u.id = r.staff_id where u.email = '{email}' and r.closed_at is null") == "300")
    page.screenshot(path=f"{SHOTS}/pos-empty-{lang}.png")

    # ---- walk-in: scan, pay cash, change, receipt ----
    before = level()
    page.fill('[data-testid="pos-search"]', SKU); page.press('[data-testid="pos-search"]', "Enter")
    page.wait_for_function("document.querySelector('[data-testid=cart-total]')?.textContent?.includes('120')", timeout=15000)
    page.click('[data-testid="pay"]')
    page.fill('[data-testid="pay-cash"]', "200")
    change = page.locator('[data-testid="pay-change"]').inner_text()
    with page.expect_popup(timeout=15000) as pop:
        page.click('[data-testid="pay-confirm"]')
        page.wait_for_selector('[data-testid="sale-done"]', timeout=15000)
    receipt = pop.value
    receipt.wait_for_load_state(); receipt.wait_for_timeout(1800)
    number = page.locator('[data-testid="sale-number"]').inner_text().strip().lstrip("#")
    rtext = receipt.locator("body").inner_text()
    order = sql(f"select id from orders where number = '{number}'")
    check(f"{tag} scan, pay QAR 200 cash for QAR 120: change 80 shown, stock down by one", "80" in change and level() == before - 1 and sql(f"select stage || ':' || string_agg(provider || '=' || amount::int, ',') from orders o join payments p on p.order_id = o.id where o.id = '{order}' group by o.stage") == "delivered:cash=120", f"{change} {level()} {before}")
    check(f"{tag} the receipt opens to print, with the number, total and a QR code to the online copy", number in rtext and "120.00" in rtext and receipt.locator("svg path").count() >= 1, rtext[:200])
    receipt.screenshot(path=f"{SHOTS}/pos-receipt-{lang}.png", full_page=True)
    receipt.close()
    page.screenshot(path=f"{SHOTS}/pos-done-{lang}.png")
    page.click('[data-testid="new-sale"]')

    # ---- a customer added at the counter: measure, thobes, deposit ----
    phone = f"6{run[-4:]}{'1' if lang == 'ar' else '2'}00"[:8]
    page.click('[data-testid="pos-add-customer"]')
    page.fill('[data-testid="pos-new-name"]', "سالم المري" if lang == "ar" else "Salem Al-Marri")
    page.fill('[data-testid="pos-new-phone"]', phone)
    page.click('[data-testid="pos-new-save"]')
    page.wait_for_selector('[data-testid="pos-customer"]', timeout=15000)
    page.click('[data-testid="pos-tab-thobes"]')
    page.click('[data-testid="thobe-measure"]')
    for k, v in {"length_cm": 148, "shoulder_cm": 46, "chest_cm": 108, "waist_cm": 98, "sleeve_cm": 60, "neck_cm": 40, "cuff_cm": 24}.items():
        page.fill(f'[data-testid="m-{k}"]', str(v))
    page.click('[data-testid="measure-save"]'); page.wait_for_timeout(1500)
    page.select_option('[data-testid="thobe-collar"]', index=1)
    page.select_option('[data-testid="thobe-fabric"]', index=1)
    page.fill('[data-testid="thobe-qty"]', "2")
    page.click('[data-testid="thobe-add"]')
    page.wait_for_timeout(1200)
    total = float("".join(ch for ch in page.locator('[data-testid="cart-total"]').inner_text() if ch.isdigit() or ch == "."))
    page.click('[data-testid="pay"]')
    page.fill('[data-testid="pay-cash"]', "100")
    page.screenshot(path=f"{SHOTS}/pos-deposit-{lang}.png")
    with page.expect_popup(timeout=15000) as pop:
        page.click('[data-testid="pay-confirm"]')
        page.wait_for_selector('[data-testid="sale-done"]', timeout=15000)
    pop.value.close()
    number = page.locator('[data-testid="sale-number"]').inner_text().strip().lstrip("#")
    order = sql(f"select id from orders where number = '{number}'")
    cust = sql(f"select customer_id from orders where id = '{order}'")
    check(f"{tag} a new customer, measured at the counter; 2 thobes with a QAR 100 deposit start at Taking measurements",
          sql(f"select stage from orders where id = '{order}'") == "measured" and sql(f"select phone from customers where id = '{cust}'") == f"+974{phone}"
          and sql(f"select count(*) from measurements m join family_members f on f.id = m.member_id where f.customer_id = '{cust}'") == "1"
          and sql(f"select sum(amount)::int from payments where order_id = '{order}'") == "100", sql(f"select stage, total from orders where id = '{order}'"))

    # ---- the balance, taken later on the order ----
    page.goto(f"{ADMIN}/orders/{order}")
    page.wait_for_selector('[data-testid="balance-due"]', timeout=15000)
    page.screenshot(path=f"{SHOTS}/pos-order-balance-{lang}.png", full_page=True)
    page.click('[data-testid="take-payment"]')
    page.click('[data-testid="payment-save"]')
    page.wait_for_timeout(1500)
    check(f"{tag} the balance (QAR {total - 100:.2f}) is taken on the order; nothing left to pay",
          page.locator('[data-testid="balance-due"]').count() == 0 and sql(f"select sum(amount)::numeric(10,2) from payments where order_id = '{order}'") == f"{total:.2f}", sql(f"select sum(amount) from payments where order_id = '{order}'"))

    # ---- every page opens ----
    bad = []
    pages = PAGES + (OWNER_ONLY if email == ADMIN_EMAIL else [])
    axe_found = {}
    for path in pages:
        page.goto(ADMIN + path); page.wait_for_timeout(900)
        if page.locator('[data-testid="page-error"]').count():
            bad.append(path)
        name = path.strip("/").replace("/", "-").replace("?", "-").replace("=", "-") or "home"
        page.screenshot(path=f"{SHOTS}/admin-{name}-{lang}.png", full_page=True)
        if AXE:
            page.add_script_tag(content=AXE)
            res = page.evaluate("""async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, n: v.nodes.length, ex: v.nodes[0]?.target.join(' ') }))""")
            for v in res:
                axe_found.setdefault(v["id"], []).append(f"{path} ({v['n']}) {v['ex']}")
    check(f"{tag} {len(pages)} admin and POS pages open without an error", not bad, bad)
    if AXE:
        check(f"{tag} axe finds no accessibility issues on those pages", not axe_found, json.dumps({k: v[:3] for k, v in axe_found.items()}, ensure_ascii=False)[:1500])

    # ---- close the register ----
    page.goto(ADMIN + "/")
    page.click('[data-testid="register-pill"]')
    page.click('[data-testid="register-close"]')
    expected = sql(f"select r.id from cash_registers r join staff_users u on u.id = r.staff_id where u.email = '{email}' and r.closed_at is null")
    exp = call("GET", "/admin/pos/register", token=call("POST", "/admin/auth/login", {"email": email, "password": password})["token"])["totals"]["expected_cash"]
    page.fill('[data-testid="register-counted"]', str(exp))
    page.click('[data-testid="register-close-confirm"]')
    page.wait_for_selector('[data-testid="register-closed"]', timeout=15000)
    check(f"{tag} the register closes with the cash counted (QAR {exp}) and no difference", sql(f"select (counted_cash - expected_cash)::int from cash_registers where id = '{expected}'") == "0")
    ctx.close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    counter(browser, "ar", CASHIER, "cashier-pass-2026")
    counter(browser, "en", ADMIN_EMAIL, ADMIN_PASSWORD)
    browser.close()

print("page errors:", errors or "none")
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed or errors else 0)
