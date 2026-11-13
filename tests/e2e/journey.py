"""One complete journey per language, driven through the screens only.

Needs the API (SEED_DEMO=true, OTP_MODE=preview, PAYMENT_MODE=mock, RATE_LIMITS=off),
the built customer app and admin, `psql`, and Chrome. On a fresh database:

    API=http://localhost:4000 APP=http://localhost:8081 ADMIN=http://localhost:5174 python3 tests/e2e/journey.py


Customer: language -> phone sign-up -> design a thobe -> book a measurement ->
add an accessory -> checkout with a coupon -> pay on the test page -> track.
Staff (admin, another browser): find the order, record measurements, move it
through every stage, top up points. Customer: sees each stage live, gets the
points, redeems a voucher and spends it on a second order.
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


def journey(browser, lang, method, phone, name, redeem):
    tag = f"{lang}/{method}"
    cat = read("/catalogue")
    s = cat["settings"]
    fabric = next(f for f in cat["fabrics"] if f["id"] == "japanese-cotton")
    ghutra = next(p for p in cat["products"] if p["id"] == "white-ghutra")
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

    if method == "home":
        page.goto(APP + "/account/add-address")
        fill(page, '[data-testid="address-line1"]', "Villa 21, Street 830"); fill(page, '[data-testid="address-area"]', "Al Waab")
        tap(page, '[data-testid="address-save"]'); page.wait_for_timeout(1200)

    # ---- design a thobe ----
    page.goto(APP + "/shop"); tap(page, '[data-testid="shop-design"]')
    tap(page, '[data-testid="collar-classic-qatari"]'); tap(page, '[data-testid="design-next"]')
    tap(page, '[data-testid="fabric-japanese-cotton"]'); tap(page, '[data-testid="design-next"]')
    tap(page, '[data-testid="colour-ivory"]'); tap(page, '[data-testid="design-next"]')
    vis(page, '[data-testid="member-self"]').wait_for(timeout=20000); tap(page, '[data-testid="design-next"]')
    tap(page, f'[data-testid="measure-{method}"]')
    vis(page, '[data-testid^="date-"]').wait_for(timeout=20000); page.wait_for_timeout(800)
    page.locator('[data-testid^="time-"]:not([aria-disabled="true"]) >> visible=true').first.click()
    tap(page, '[data-testid="book-confirm"]')
    vis(page, '[data-testid="measure-next"]').wait_for(timeout=20000); page.wait_for_timeout(500)
    tap(page, '[data-testid="measure-next"]')
    tap(page, '[data-testid="review-add"]'); page.wait_for_url("**/basket", timeout=20000)
    vis(page, '[data-testid="line-thobe"]').wait_for(timeout=20000)
    check(f"{tag}: thobe designed, measurement booked, added to the basket", sql(f"select count(*) from basket_items b join customers c on c.id = b.customer_id where c.phone = '+974{phone}' and b.kind = 'thobe' and b.appointment_id is not null") == "1")

    # ---- an accessory ----
    page.goto(APP + "/product/white-ghutra"); tap(page, '[data-testid="size-56"]'); tap(page, '[data-testid="product-add"]'); page.wait_for_timeout(1200)
    page.goto(APP + "/basket"); tap(page, '[data-testid="basket-checkout"]')

    # ---- checkout ----
    vis(page, '[data-testid="checkout-total"]').wait_for(timeout=20000)
    if method == "branch":
        tap(page, '[data-testid="add-address"]')
        fill(page, '[data-testid="address-line1"]', "Tower 4, West Bay"); fill(page, '[data-testid="address-area"]', "West Bay")
        tap(page, '[data-testid="address-save"]'); vis(page, '[data-testid="checkout-pay"]').wait_for(timeout=20000); page.wait_for_timeout(1000)
    fill(page, '[data-testid="coupon-input"]', "EID20"); tap(page, '[data-testid="coupon-apply"]'); page.wait_for_timeout(1500)
    subtotal = fabric["price"] + ghutra["price"]
    expected = round(subtotal + s["delivery_fee"] + (s["home_visit_fee"] if method == "home" else 0) - min(round(subtotal * 0.2, 2), 100), 2)
    shown = vis(page, '[data-testid="checkout-total"]').inner_text().replace(",", "")
    check(f"{tag}: checkout total is right (QAR {expected:.2f} with EID20{', home visit' if method == 'home' else ''})", f"{expected:.2f}" in shown, shown)
    page.screenshot(path=f"{SHOTS}/full-checkout-{lang}.png", full_page=True)
    tap(page, '[data-testid="checkout-pay"]')
    page.locator("button.pay").wait_for(timeout=20000); page.locator("button.pay").click()
    page.wait_for_url("**/order-placed/**", timeout=20000)
    order_id = page.url.rstrip("/").split("/")[-1]
    number = sql(f"select number from orders where id = '{order_id}'")
    check(f"{tag}: payment on the test page places the order", sql(f"select stage from orders where id = '{order_id}'") == "confirmed")
    tap(page, '[data-testid="placed-track"]'); vis(page, '[data-testid="track-stage"]').wait_for(timeout=20000)

    # ---- staff, in the admin ----
    actx = browser.new_context(viewport={"width": 1280, "height": 900})
    admin = actx.new_page()
    admin.on("pageerror", lambda e: errors.append(f"{tag} admin: {e}"))
    admin.goto(ADMIN + "/")
    admin.fill('[data-testid="login-email"]', ADMIN_EMAIL); admin.fill('[data-testid="login-password"]', ADMIN_PASSWORD); admin.click('[data-testid="login-submit"]')
    admin.click('[data-testid="nav-orders"]'); admin.wait_for_selector(f'[data-testid="ticket-{number}"]', timeout=15000)
    check(f"{tag}: staff see the order on the board", name in admin.locator(f'[data-testid="ticket-{number}"]').inner_text())
    admin.goto(f"{ADMIN}/orders/{order_id}"); admin.wait_for_selector(f'[data-testid="measure-{name}"]', timeout=15000)
    admin.click(f'[data-testid="measure-{name}"]')
    for k, v in {"length_cm": 149, "shoulder_cm": 47, "chest_cm": 111, "waist_cm": 102, "sleeve_cm": 62, "neck_cm": 41, "cuff_cm": 24}.items():
        admin.fill(f'[data-testid="m-{k}"]', str(v))
    admin.click('[data-testid="measure-save"]'); admin.wait_for_timeout(1500)
    check(f"{tag}: recording measurements moves the order to Measured", sql(f"select stage from orders where id = '{order_id}'") == "measured")
    page.wait_for_timeout(12000)
    check(f"{tag}: the open tracking screen shows Measured by itself", vis(page, '[data-testid="track-stage"]').inner_text().strip() in ("Measured", "أخذ المقاسات"), vis(page, '[data-testid="track-stage"]').inner_text())
    moved = []
    for _ in range(6):
        btn = admin.locator('[data-testid="detail-advance"]')
        if not btn.count():
            break
        btn.click(); admin.wait_for_timeout(1300)
        moved.append(sql(f"select stage from orders where id = '{order_id}'"))
    check(f"{tag}: staff move it through every stage to Delivered", moved == ["cutting", "stitching", "ready", "out_for_delivery", "delivered"], str(moved))
    page.wait_for_timeout(12000)
    final = vis(page, '[data-testid="track-stage"]').inner_text().strip()
    check(f"{tag}: the customer's tracking screen reaches Delivered without a refresh", final in ("Delivered", "تم التوصيل"), final)
    page.screenshot(path=f"{SHOTS}/full-tracking-{lang}.png", full_page=True)

    page.goto(APP + "/account/notifications"); page.wait_for_timeout(2000)
    n = sql(f"select count(*) from notifications n join customers c on c.id = n.customer_id where c.phone = '+974{phone}'")
    check(f"{tag}: every step reached the customer's notifications ({n})", int(n) >= 8 and ("Order delivered" in text(page) or "تم التوصيل" in text(page)))

    pts = s["points"]["thobe_fixed"] + round(ghutra["price"] * s["points"]["product_per_qar"])
    page.goto(APP + "/rewards"); vis(page, '[data-testid="rewards-balance"]').wait_for(timeout=20000); page.wait_for_timeout(800)
    bal = vis(page, '[data-testid="rewards-balance"]').inner_text().strip()
    check(f"{tag}: points arrive on delivery ({pts})", bal.replace(",", "").replace("٬", "") in (str(pts),) or str(pts) in bal, bal)

    if redeem:
        # staff top the customer up so a reward is in reach
        admin.click('[data-testid="nav-customers"]'); admin.fill('[data-testid="customer-search"]', phone); admin.wait_for_timeout(1200)
        admin.locator('tr[data-testid^="customer-"]').first.click(); admin.wait_for_selector('[data-testid="adjust-points"]')
        admin.click('[data-testid="adjust-points"]'); admin.fill('[data-testid="adjust-points-input"]', "500"); admin.fill('[data-testid="adjust-reason"]', "Welcome gift")
        admin.click('[data-testid="adjust-save"]'); admin.wait_for_timeout(1200)
        check(f"{tag}: staff add points from the customer page", admin.locator('[data-testid="points-balance"]').inner_text().strip().replace(",", "") == str(pts + 500))
        page.goto(APP + "/rewards"); page.wait_for_timeout(1500); tap(page, '[data-testid="rewards-redeem"]')
        tap(page, '[data-testid="redeem-discount-5"]'); tap(page, '[data-testid="confirm-redeem"]')
        vis(page, '[data-testid="voucher-code"]').wait_for(timeout=20000)
        code = vis(page, '[data-testid="voucher-code"]').inner_text().strip()
        check(f"{tag}: the customer redeems 500 points for a 5% voucher", code.startswith("AR5-"), code)
        tap(page, '[data-testid="voucher-shop"]')
        page.goto(APP + "/product/oud-50"); tap(page, '[data-testid="product-add"]'); page.wait_for_timeout(1200)
        page.goto(APP + "/checkout"); vis(page, '[data-testid="checkout-total"]').wait_for(timeout=20000); page.wait_for_timeout(1500)
        oud = next(p for p in cat["products"] if p["id"] == "oud-50")["price"]
        exp2 = round(oud + s["delivery_fee"] - round(oud * 0.05, 2), 2)
        t2 = vis(page, '[data-testid="checkout-total"]').inner_text().replace(",", "")
        check(f"{tag}: the voucher is applied by itself at the next checkout (QAR {exp2:.2f})", f"{exp2:.2f}" in t2, t2)
        tap(page, '[data-testid="checkout-pay"]'); page.locator("button.pay").wait_for(timeout=20000); page.locator("button.pay").click()
        page.wait_for_url("**/order-placed/**", timeout=20000)
        check(f"{tag}: second order paid; the voucher is used up", sql(f"select status from vouchers where code = '{code}'") == "used")
    actx.close()
    ctx.close()


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
    journey(browser, "en", "branch", "55594001", "Nasser Al-Hajri", redeem=True)
    journey(browser, "ar", "home", "55594002", "فيصل الكواري", redeem=False)
    crash_screens(browser)
    browser.close()

print("page errors:", errors or "none")
print(f"{sum(1 for _, ok in results if ok)} of {len(results)} checks passed")
sys.exit(0 if all(ok for _, ok in results) and not errors else 1)
