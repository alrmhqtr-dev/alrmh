"""One complete journey per language, driven through the screens only.

Needs the API (SEED_DEMO=true, OTP_MODE=preview, PAYMENT_MODE=mock, RATE_LIMITS=off),
the built customer app and admin, `psql`, and Chrome. On a fresh database:

    API=http://localhost:4000 APP=http://localhost:8081 ADMIN=http://localhost:5174 python3 tests/e2e/journey.py


Customer: language -> phone sign-up -> New order -> book a home visit in one of
the three windows and pay the QAR 70 booking fee on the test page -> confirmed.
Staff (admin, another browser): at the visit, record measurements and place the
order (type and cuff by picture, cloth and its metres, how many; paid on the
card machine), move it through every stage. Customer: sees the order and each stage live, earns points for their
tier (Silver). In English, staff top up points so the customer reaches Gold;
the customer re-orders a past thobe with a different type and cloth and pays
part of it with points.
The API is only read, to confirm what the screens showed.
"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

API = os.environ.get("API", "http://localhost:4000") + "/v1"
APP = os.environ.get("APP", "http://localhost:8081")
ADMIN = os.environ.get("ADMIN", "http://localhost:5174")
DB = os.environ.get("DATABASE_URL", "postgres://alrmh:alrmh@localhost:5432/alrmh")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "owner@alrmh.qa")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ci-owner-password")
CHROME = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
SHOTS = os.environ.get("SHOTS", "/tmp/e2e-shots")
os.makedirs(SHOTS, exist_ok=True)
results, errors = [], []


def read(path):
    return json.loads(urllib.request.urlopen(API + path).read())


def sql(q):
    return subprocess.run(["psql", DB, "-Atc", q], capture_output=True, text=True).stdout.strip()


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("ok   " if ok else "FAIL ") + name + (f"   [{detail}]" if detail and not ok else ""), flush=True)
    return ok


def vis(page, sel):
    return page.locator(sel + " >> visible=true").last


def tap(page, sel, timeout=20000):
    vis(page, sel).wait_for(timeout=timeout)
    vis(page, sel).click()


def fill(page, sel, value):
    vis(page, sel).wait_for(timeout=20000)
    vis(page, sel).fill(value)


def text(page):
    return " | ".join(t.strip() for t in page.locator("body").inner_text().split("\n") if t.strip())


def journey(browser, lang, method, phone, name, reorder):
    tag = f"{lang}/{method}"
    cat = read("/catalogue")
    s = cat["settings"]
    fabric = next(f for f in cat["fabrics"] if f["id"] == "japanese-cotton")
    silver, gold = cat["tiers"][0], cat["tiers"][1]
    ctx = browser.new_context(viewport={"width": 420, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{tag} app: {e}"))

    # ---- sign up ----
    page.goto(APP + "/")
    tap(page, f'[data-testid="lang-{lang}"]'); tap(page, '[data-testid="lang-continue"]')
    tap(page, '[data-testid="welcome-phone"]')
    fill(page, '[data-testid="phone-input"]', phone); tap(page, '[data-testid="phone-send"]')
    page.locator('[data-testid="otp-input"]').last.wait_for(state="attached", timeout=20000)
    page.locator('[data-testid="otp-input"]').last.fill("123456", force=True)
    fill(page, '[data-testid="details-name"]', name); tap(page, '[data-testid="details-save"]')
    page.wait_for_url("**/home", timeout=20000)
    check(f"{tag}: new customer signs up with a mobile number and code", sql(f"select name from customers where phone = '+974{phone}'") == name)
    cid = sql(f"select id from customers where phone = '+974{phone}'")

    page.goto(APP + "/account/add-address")
    fill(page, '[data-testid="address-line1"]', "Villa 21, Street 830"); fill(page, '[data-testid="address-area"]', "Al Waab")
    tap(page, '[data-testid="address-save"]'); page.wait_for_timeout(1200)

    # ---- New order = book a visit and pay the booking fee ----
    page.goto(APP + "/home"); tap(page, '[data-testid="home-design"]')
    page.wait_for_url("**/book**", timeout=20000)
    vis(page, '[data-testid^="date-"]').wait_for(timeout=20000); page.wait_for_timeout(800)
    check(f"{tag}: home visits only, in the 9-1, 4-7 and 7-10 windows",
          page.locator('[data-testid="kind-branch"]').count() == 0
          and sorted(set(x.get_attribute("data-testid") for x in page.locator('[data-testid^="time-"] >> visible=true').all())) == ["time-1140", "time-540", "time-960"])
    page.locator('[data-testid^="time-"]:not([aria-disabled="true"]) >> visible=true').first.click()
    vis(page, '[data-testid="book-summary"]').wait_for(timeout=20000)
    label = vis(page, '[data-testid="book-confirm"]').inner_text()
    check(f"{tag}: New order books a visit and asks for the QAR {s['appointment_fee']} booking fee", str(s["appointment_fee"]) in label.replace("٧٠", "70"), label)
    page.screenshot(path=f"{SHOTS}/full-book-{lang}.png", full_page=True)
    tap(page, '[data-testid="book-confirm"]')
    page.locator("button.pay").wait_for(timeout=20000)
    fee_page = page.locator("body").inner_text()
    page.locator("button.pay").click()
    page.wait_for_url("**/booked/**", timeout=20000)
    appt = page.url.rstrip("/").split("/")[-1].split("?")[0]
    vis(page, '[data-testid="booked-title"]').wait_for(timeout=20000)
    check(f"{tag}: the fee is paid on the test page and the visit is confirmed",
          "Booking fee" in fee_page and sql(f"select a.status || ':' || p.status || ':' || p.amount::int from appointments a join payments p on p.appointment_id = a.id where a.id = '{appt}'") == f"confirmed:paid:{s['appointment_fee']}",
          sql(f"select a.status || ':' || coalesce(p.status,'-') from appointments a left join payments p on p.appointment_id = a.id where a.id = '{appt}'"))
    page.screenshot(path=f"{SHOTS}/full-booked-{lang}.png", full_page=True)

    # ---- staff, at the visit ----
    actx = browser.new_context(viewport={"width": 1280, "height": 900})
    admin = actx.new_page()
    admin.on("pageerror", lambda e: errors.append(f"{tag} admin: {e}"))
    # Staff use the admin in the same language as this run.
    sql(f"update staff_users set language = '{lang}' where email = '{ADMIN_EMAIL}'")
    admin.goto(ADMIN + "/")
    admin.fill('[data-testid="login-email"]', ADMIN_EMAIL); admin.fill('[data-testid="login-password"]', ADMIN_PASSWORD); admin.click('[data-testid="login-submit"]')
    admin.click('[data-testid="nav-appointments"]'); admin.wait_for_selector(f'[data-testid="appt-order-{name}"]', timeout=15000)
    admin.click(f'[data-testid="appt-measure-{name}"]')
    for k, v in {"length_cm": 149, "shoulder_cm": 47, "chest_cm": 111, "waist_cm": 102, "sleeve_cm": 62, "neck_cm": 41, "cuff_cm": 24}.items():
        admin.fill(f'[data-testid="m-{k}"]', str(v))
    admin.click('[data-testid="measure-save"]'); admin.wait_for_timeout(1500)
    admin.click(f'[data-testid="appt-order-{name}"]'); admin.wait_for_selector('[data-testid="po-type-0-classic-qatari"]', timeout=15000)
    admin.click('[data-testid="po-type-0-classic-qatari"]')
    admin.click('[data-testid="po-cuff-0-double"]')
    admin.select_option('[data-testid="po-cloth-0"]', "japanese-cotton")
    start = admin.input_value('[data-testid="po-metres-0"]')
    admin.click('[data-testid="po-metres-0-more"]'); admin.click('[data-testid="po-metres-0-less"]'); admin.click('[data-testid="po-metres-0-less"]')
    stepped = admin.input_value('[data-testid="po-metres-0"]')
    admin.fill('[data-testid="po-metres-0"]', "3.75")
    check(f"{tag}: the cloth length starts at the usual {fabric['metres']} m and the buttons move 0.5 m",
          float(start) == fabric["metres"] and float(stepped) == fabric["metres"] - 0.5, f"{start} {stepped}")
    admin.fill('[data-testid="po-qty-0"]', "2")
    admin.fill('[data-testid="po-type-0-note"]', "Stiffer collar")
    admin.click('[data-testid="po-pocket-0-yes"]'); admin.fill('[data-testid="po-pocket-0-note"]', "Pen slot inside")
    total = round(fabric["price_per_metre"] * 3.75, 2) * 2
    po_total = admin.locator('[data-testid="po-total"]').inner_text().replace(",", "")
    admin.check('[data-testid="po-paid"]'); admin.click('[data-testid="place-order"]')
    admin.wait_for_url("**/orders/**", timeout=15000)
    order_id = admin.url.rstrip("/").split("/")[-1]
    number = sql(f"select number from orders where id = '{order_id}'")
    check(f"{tag}: staff place the order at the visit (2 thobes of 3.75 m, QAR {total:.2f}, card machine, to collect from the branch); it starts at Taking measurements",
          float("".join(ch for ch in po_total if ch.isdigit() or ch == ".")) == total and sql(f"select stage || ':' || total::numeric(10,2) from orders where id = '{order_id}'") == f"measured:{total:.2f}"
          and sql(f"select provider from payments where order_id = '{order_id}'") == "card_machine"
          and sql(f"select (snapshot->'thobe'->'style_notes'->>'collar') || '|' || (snapshot->'thobe'->'style_notes'->>'pocket') from order_items where order_id = '{order_id}'") == "Stiffer collar|Pen slot inside", f"{po_total} {sql(f'select stage, total from orders where id = {chr(39)}{order_id}{chr(39)}')}")

    page.goto(APP + "/orders"); page.wait_for_timeout(2500)
    check(f"{tag}: the order shows in the customer's app", number in text(page), text(page)[:300])
    page.goto(APP + f"/orders/{order_id}"); vis(page, '[data-testid="track-stage"]').wait_for(timeout=20000)
    check(f"{tag}: it says it was paid on the card machine", vis(page, '[data-testid="paid-in-store"]').count() == 1)
    moved = []
    for _ in range(6):
        btn = admin.locator('[data-testid="detail-advance"]')
        if not btn.count():
            break
        btn.click(); admin.click('[data-testid="confirm-ok"]'); admin.wait_for_timeout(1300)
        moved.append(sql(f"select stage from orders where id = '{order_id}'"))
    want = ["cutting", "stitching", "quality", "ready", "delivered"]
    check(f"{tag}: staff move it through every stage to Collected", moved == want, str(moved))
    page.wait_for_timeout(12000)
    final = vis(page, '[data-testid="track-stage"]').inner_text().strip()
    steps = [x.strip() for x in page.locator('[data-testid="track-steps"]').inner_text().split("\n") if x.strip()]
    names = {"en": ["Taking measurements", "Cutting", "Sewing", "Quality inspection", "Ready for pickup", "Collected"],
             "ar": ["أخذ المقاسات", "القص", "الخياطة", "قسم التدقيق ومراجعة الجودة", "الملابس جاهزة", "تم الاستلام"]}[lang]
    check(f"{tag}: the customer's tracking reaches {names[-1]} without a refresh, through the six stages", final == names[-1] and [x for x in steps if x in names] == names, f"{final} {steps}")
    page.screenshot(path=f"{SHOTS}/full-tracking-{lang}.png", full_page=True)

    page.goto(APP + "/account/notifications"); page.wait_for_timeout(2000)
    n = sql(f"select count(*) from notifications where customer_id = '{cid}'")
    check(f"{tag}: every step reached the customer's notifications ({n})", int(n) >= 7, n)

    pts = silver["points_per_thobe"] * 2
    page.goto(APP + "/rewards"); vis(page, '[data-testid="rewards-balance"]').wait_for(timeout=20000); page.wait_for_timeout(800)
    bal = vis(page, '[data-testid="rewards-balance"]').inner_text().strip()
    tier = vis(page, '[data-testid="tier-name"]').inner_text().strip()
    nxt = vis(page, '[data-testid="tier-next"]').inner_text()
    check(f"{tag}: Silver earns {silver['points_per_thobe']} points a thobe ({pts}); the card shows the way to Gold",
          bal.replace(",", "") == str(pts) and tier == silver[f"name_{lang}"] and gold[f"name_{lang}"] in nxt, f"{bal} {tier} {nxt}")
    page.screenshot(path=f"{SHOTS}/full-rewards-{lang}.png", full_page=True)

    if reorder:
        # staff top the customer up past the Gold threshold
        admin.goto(f"{ADMIN}/customers/{cid}"); admin.wait_for_selector('[data-testid="adjust-points"]', timeout=15000)
        admin.click('[data-testid="adjust-points"]'); admin.fill('[data-testid="adjust-points-input"]', str(gold["min_points"])); admin.fill('[data-testid="adjust-reason"]', "Welcome gift")
        admin.click('[data-testid="adjust-save"]'); admin.wait_for_timeout(1500)
        bal = pts + gold["min_points"]
        check(f"{tag}: staff add points from the customer page; the customer is now Gold",
              admin.locator('[data-testid="points-balance"]').inner_text().strip().replace(",", "") == str(bal) and gold[f"name_{lang}"].lower() in admin.locator('[data-testid="customer-tier"]').inner_text().lower(),
              admin.locator('[data-testid="customer-tier"]').inner_text())
        page.goto(APP + "/rewards"); page.wait_for_timeout(2000)
        check(f"{tag}: the rewards card shows Gold", vis(page, '[data-testid="tier-name"]').inner_text().strip() == gold["name_en"])

        # re-order: the list, then the order, change type and cloth, place it
        page.goto(APP + "/home"); tap(page, '[data-testid="home-again"]')
        tap(page, f'[data-testid="reorder-{number}"]')
        tap(page, '[data-testid="reorder-edit-0"]')
        tap(page, '[data-testid="retype-0-mandarin-band"]'); tap(page, '[data-testid="refabric-0-swiss-voile"]')
        page.screenshot(path=f"{SHOTS}/full-reorder-{lang}.png", full_page=True)
        tap(page, '[data-testid="reorder-place"]'); page.wait_for_url("**/checkout**", timeout=20000)
        vis(page, '[data-testid="checkout-total"]').wait_for(timeout=20000); page.wait_for_timeout(1500)
        # The same 3.75 m a thobe as the first order, in the new cloth.
        voile = round(next(f for f in cat["fabrics"] if f["id"] == "swiss-voile")["price_per_metre"] * 3.75, 2)
        due = voile * 2
        branch_card = vis(page, '[data-testid="pickup-branch"]').inner_text()
        check(f"{tag}: checkout says to collect from the branch, with no delivery fee", cat["branches"][0]["name_en"] in branch_card and "Delivery" not in vis(page, '[data-testid="checkout-total"]').locator("xpath=../..").inner_text(), branch_card)
        used = min(bal, int(due))
        tap(page, '[data-testid="use-points"]'); page.wait_for_timeout(1500)
        shown = vis(page, '[data-testid="checkout-total"]').inner_text().replace(",", "")
        check(f"{tag}: re-order of 2 thobes (new type and cloth); {used} points pay QAR {used} (QAR {due - used:.2f} left)", f"{due - used:.2f}" in shown, shown)
        page.screenshot(path=f"{SHOTS}/full-checkout-points-{lang}.png", full_page=True)
        tap(page, '[data-testid="checkout-pay"]'); page.locator("button.pay").wait_for(timeout=20000); page.locator("button.pay").click()
        page.wait_for_url("**/order-placed/**", timeout=20000)
        o2 = page.url.rstrip("/").split("/")[-1]
        line = sql(f"select (snapshot->'thobe'->'collar'->>'id') || ':' || (snapshot->'thobe'->'cuff'->>'id') || ':' || (snapshot->'thobe'->'fabric'->>'id') || ':' || (snapshot->'thobe'->>'metres') || ':' || coalesce(snapshot->'thobe'->>'colour', 'none') || ':' || (snapshot->>'measureMethod') || ':' || qty from order_items where order_id = '{o2}' and kind = 'thobe'")
        check(f"{tag}: the re-order keeps the saved measurements, the cuff and the 3.75 m, with the new type and cloth and no colour",
              line == "mandarin-band:double:swiss-voile:3.75:none:saved:2" and sql(f"select points_used from orders where id = '{o2}'") == str(used), line)
        check(f"{tag}: the points are spent; the tier stays Gold",
              read_rewards(cid) == (bal - used, "gold"), str(read_rewards(cid)))
    actx.close()
    ctx.close()


def read_rewards(cid):
    bal = sql(f"select coalesce(sum(points),0) from points_ledger where customer_id = '{cid}'")
    life = int(sql(f"select coalesce(sum(points),0) from points_ledger where customer_id = '{cid}' and kind in ('earn','adjust')") or 0)
    tier = sql(f"select id from tiers where min_points <= {life} order by min_points desc limit 1")
    return int(bal), tier


def crash_screens(browser):
    """A screen that fails to draw shows a way out instead of a blank page."""
    ctx = browser.new_context(viewport={"width": 420, "height": 900})
    page = ctx.new_page()
    broken = {"on": True}

    def catalogue(route):
        if broken["on"]:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"products": 5, "categories": 5}))
        route.continue_()

    page.route("**/v1/catalogue", catalogue)
    page.goto(APP + "/")
    page.evaluate("localStorage.setItem('alrmh.lang','en'); localStorage.setItem('alrmh.guest','1')")
    page.goto(APP + "/shop"); page.wait_for_timeout(2500)
    shown = page.locator('[data-testid="crash-screen"]').count() == 1
    broken["on"] = False
    page.locator('[data-testid="crash-retry"]').click(); page.wait_for_timeout(2500)
    check("crash: a screen that fails shows the recovery screen, and Try again recovers", shown and page.locator('[data-testid="shop-design"] >> visible=true').count() == 1)
    ctx.close()

    actx = browser.new_context(viewport={"width": 1280, "height": 900})
    admin = actx.new_page()
    admin.route("**/v1/admin/overview", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    admin.goto(ADMIN + "/")
    admin.fill('[data-testid="login-email"]', ADMIN_EMAIL); admin.fill('[data-testid="login-password"]', ADMIN_PASSWORD); admin.click('[data-testid="login-submit"]')
    admin.wait_for_selector('[data-testid="page-error"]', timeout=15000)
    admin.click('[data-testid="nav-orders"]'); admin.wait_for_timeout(1500)
    check("crash: an admin page that fails keeps the menu working", admin.locator('[data-testid="page-error"]').count() == 0 and admin.locator('[data-testid="export-orders"]').count() == 1)
    actx.close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    journey(browser, "en", "home", "55594001", "Nasser Al-Hajri", reorder=True)
    journey(browser, "ar", "home", "55594002", "فيصل الكواري", reorder=False)
    crash_screens(browser)
    browser.close()

print("page errors:", errors or "none")
print(f"{sum(1 for _, ok in results if ok)} of {len(results)} checks passed")
sys.exit(0 if all(ok for _, ok in results) and not errors else 1)
