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


def prev_box(page):
    return page.locator('[data-testid="thobe-preview"]').bounding_box()


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
         "/settings/company", "/settings/invoice", "/settings/barcode", "/settings/pos", "/printing", "/whatsapp", "/tax-rates"]
OWNER_ONLY = ["/reports", "/reports/sales", "/reports?r=products", "/roles", "/staff", "/audit"]


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
    page.wait_for_selector('[data-testid="pos-start"]', timeout=15000)
    check(f"{tag} a closed register is opened with the cash in the drawer before selling", sql(f"select opening_cash::int from cash_registers r join staff_users u on u.id = r.staff_id where u.email = '{email}' and r.closed_at is null") == "300")
    page.screenshot(path=f"{SHOTS}/pos-empty-{lang}.png")
    check(f"{tag} the POS opens on two cards, new customer or existing customer, and there's no sale without a customer",
          page.locator('[data-testid="pos-start"] .choice-card').count() == 2 and page.locator('[data-testid="pos-search"]').count() == 0
          and page.locator('[data-testid="pos-tab-thobes"]').count() == 0 and page.locator('[data-testid="start-walk-in"]').count() == 0)
    page.click('[data-testid="start-new"]')
    page.fill('[data-testid="start-phone"]', f"5{run[-4:]}{'1' if lang == 'ar' else '2'}00"[:8]); page.fill('[data-testid="start-name"]', f"Counter {lang}")
    page.click('[data-testid="start-continue"]'); page.wait_for_selector('[data-testid="pos-search"]', timeout=15000)

    # ---- walk-in: scan, pay cash, change, receipt ----
    before = level()
    page.fill('[data-testid="pos-search"]', SKU); page.press('[data-testid="pos-search"]', "Enter")
    page.wait_for_function("document.querySelector('[data-testid=cart-total]')?.textContent?.includes('120')", timeout=15000)
    if page.locator('[data-testid="line-discount-0"]').count():
        page.fill('[data-testid="line-discount-0"]', "20")
        page.wait_for_function("document.querySelector('[data-testid=cart-total]')?.textContent?.includes('100')", timeout=15000)
        shown = [page.locator(f'[data-testid="{x}"]').inner_text() for x in ("line-original-0", "line-total-0", "cart-original", "cart-discount", "cart-total")]
        page.screenshot(path=f"{SHOTS}/pos-discount-{lang}.png")
        digits = lambda x: "".join(ch for ch in x if ch.isdigit() or ch == ".")
        check(f"{tag} a discount shows the original price, the discount and then the total; there's no field to change the price",
              [digits(x).split(".")[0] for x in shown] == ["120", "100", "120", "20", "100"]
              and page.locator('input[aria-label="Unit price"], input[aria-label="سعر الوحدة"]').count() == 0, shown)
        page.fill('[data-testid="line-discount-0"]', "")
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
    rtitle = receipt.title()
    order = sql(f"select id from orders where number = '{number}'")
    check(f"{tag} scan, pay QAR 200 cash for QAR 120: change 80 shown, stock down by one", "80" in change and level() == before - 1 and sql(f"select stage || ':' || string_agg(provider || '=' || amount::int, ',') from orders o join payments p on p.order_id = o.id where o.id = '{order}' group by o.stage") == "delivered:cash=120", f"{change} {level()} {before}")
    check(f"{tag} the receipt page is titled with the order number and customer, so a saved PDF is named after them",
          rtitle == f"{'إيصال' if lang == 'ar' else 'Receipt'} {number} - Counter {lang}", rtitle)
    check(f"{tag} the receipt opens to print, with the number, total and a QR code to the online copy", number in rtext and "120.00" in rtext and receipt.locator("svg path").count() >= 1, rtext[:200])
    receipt.screenshot(path=f"{SHOTS}/pos-receipt-{lang}.png", full_page=True)
    receipt.close()
    page.screenshot(path=f"{SHOTS}/pos-done-{lang}.png")
    page.click('[data-testid="new-sale"]')

    # ---- a new customer at the counter: name, mobile and measurements together; thobes; deposit ----
    phone = f"6{run[-4:]}{'1' if lang == 'ar' else '2'}00"[:8]
    # A new customer: the mobile first, then the name; then the sale, and thobes go straight to measurements and styles.
    page.wait_for_selector('[data-testid="pos-start"]', timeout=15000)
    page.click('[data-testid="start-new"]')
    first = page.locator('[data-testid="start-new-form"] input').first.get_attribute("data-testid")
    page.fill('[data-testid="start-phone"]', phone)
    page.fill('[data-testid="start-name"]', "سالم المري" if lang == "ar" else "Salem Al-Marri")
    page.screenshot(path=f"{SHOTS}/pos-start-new-{lang}.png")
    page.click('[data-testid="start-continue"]')
    page.wait_for_selector('[data-testid="pos-customer"]', timeout=15000)
    check(f"{tag} a new customer is mobile first, then name, and the sale opens for them", first == "start-phone" and sql(f"select count(*) from customers where phone = '+974{phone}'") == "1")
    # A new customer who already exists is refused, not picked.
    page.click('[data-testid="pos-change-customer"]'); page.click('[data-testid="start-new"]')
    page.fill('[data-testid="start-phone"]', phone); page.fill('[data-testid="start-name"]', "Someone else")
    page.click('[data-testid="start-continue"]'); page.wait_for_selector('[data-testid="start-taken"]', timeout=15000)
    check(f"{tag} New customer with a mobile already on file shows an error and doesn't pick that customer",
          page.locator('[data-testid="pos-customer"]').count() == 0 and page.locator('[data-testid="start-continue"]').is_disabled())
    page.click('text=' + ("رجوع" if lang == "ar" else "Back")); page.click('[data-testid="start-existing"]')
    page.fill('[data-testid="start-search"]', phone); page.click(f'[data-testid="start-pick-+974{phone}"]')
    page.wait_for_selector('[data-testid="pos-customer"]', timeout=15000)

    # The thobe page: a Measurements button under the customer; every collar, cuff and detail with a remarks box.
    page.click('[data-testid="pos-tab-thobes"]')
    page.wait_for_selector('[data-testid="thobe-desk"]', timeout=15000); page.wait_for_timeout(600)
    n_opts = page.locator('[data-testid="thobe-styles"] textarea').count()
    check(f"{tag} the thobe page has no measurement fields, a Measurements button under the customer, and every style option with its own remarks box",
          page.locator('[data-testid="thobe-m-chest_cm"]').count() == 0 and page.locator('[data-testid="thobe-measurements"]').count() == 1
          and n_opts == 9 and page.locator('.style-tile').count() == 0 and not page.locator('[data-testid="pay"]').is_visible(), n_opts)
    page.select_option('[data-testid="thobe-fabric"]', index=1)
    add_off = page.locator('[data-testid="thobe-add"]').is_disabled()
    page.fill('[data-testid="style-note-collar-wide-collar"]', "Collar a little higher")
    page.fill('[data-testid="style-note-cuff-double"]', "Cufflinks provided")
    page.fill('[data-testid="style-note-detail-pocket"]', "Left side")
    page.fill('[data-testid="style-note-detail-pen"]', "Pen slot inside")
    # Measurements on their own screen.
    page.click('[data-testid="thobe-measurements"]'); page.wait_for_selector('[data-testid="thobe-measure"]', timeout=15000)
    for k, v in {"length_cm": 148, "shoulder_cm": 46, "chest_cm": 108, "waist_cm": 97, "sleeve_cm": 60, "neck_cm": 40, "cuff_cm": 24}.items():
        page.fill(f'[data-testid="thobe-m-{k}"]', str(v))
    prev = page.locator('[data-testid="thobe-preview"]')
    live = prev.locator('[data-testid="preview-waist_cm"]').text_content()
    page.fill('[data-testid="thobe-m-waist_cm"]', "98")
    page.screenshot(path=f"{SHOTS}/pos-thobe-measure-{lang}.png", full_page=True)
    check(f"{tag} the measurements screen has the preview: marked as they're typed, with the collar, cuff and pocket written up",
          live == "97" and prev.locator('[data-testid="preview-waist_cm"]').text_content() == "98" and prev.locator('[data-testid="preview-chest_cm"]').text_content() == "108"
          and all(prev.locator(f'[data-testid="preview-{x}"]').count() == 1 for x in ("collar", "cuff", "pocket")))
    page.click('[data-testid="thobe-m-save"]'); page.wait_for_selector('[data-testid="thobe-desk"]', timeout=15000); page.wait_for_timeout(800)
    saved = sql(f"select count(*) || ':' || max(waist_cm)::float from measurements m join family_members f on f.id = m.member_id join customers c on c.id = f.customer_id where c.phone = '+974{phone}'")
    metres = page.input_value('[data-testid="thobe-metres"]')
    page.click('[data-testid="thobe-metres-more"]')
    page.fill('[data-testid="thobe-qty"]', "2")
    page.fill('[data-testid="thobe-remarks"]', "Pocket on the left\nLooser sleeves")
    page.screenshot(path=f"{SHOTS}/pos-thobe-{lang}.png", full_page=True)
    check(f"{tag} saving measurements returns to the thobe page; thobes couldn't be added before",
          saved == "1:98" and add_off and not page.locator('[data-testid="thobe-add"]').is_disabled()
          and "Not taken" not in page.locator('[data-testid="thobe-measured-on"]').inner_text(), saved)
    check(f"{tag} the thobe page has no preview (it's with the measurements); the cloth length + adds 0.5 m",
          page.locator('[data-testid="thobe-preview"]').count() == 0 and float(page.input_value('[data-testid="thobe-metres"]')) == float(metres) + 0.5, metres)
    page.click('[data-testid="thobe-add"]')
    page.wait_for_selector('[data-testid="print-cart-thobe"]', timeout=15000)
    page.wait_for_timeout(1200)
    total = float("".join(ch for ch in page.locator('[data-testid="cart-total"]').inner_text() if ch.isdigit() or ch == "."))
    # Printing from the sale screen, before payment: the thobe with its measurements, and the receipt.
    with page.expect_popup(timeout=15000) as pop:
        page.click('[data-testid="print-cart-thobe"]')
    sheet = pop.value; sheet.wait_for_selector('[data-testid="order-sheet"]', timeout=15000); sheet.wait_for_timeout(800)
    stext = sheet.locator('[data-testid="order-sheet"]').inner_text()
    stitle = sheet.title()
    sheet.screenshot(path=f"{SHOTS}/print-cart-thobe-{lang}.png", full_page=True)
    ok_sheet = (stitle.startswith(("Thobe sheet - Salem", "ورقة الثوب - سالم")) and sheet.locator('[data-testid="preview-chest_cm"]').first.text_content() == "108" and "QAR" not in stext
                and sheet.locator('[data-testid="sheet-options"] .sheet-option').count() == 9
                and "Collar a little higher" in sheet.locator('[data-testid="sheet-collar-wide-collar"]').inner_text() and "Cufflinks provided" in sheet.locator('[data-testid="sheet-cuff-double"]').inner_text()
                and "Pen slot inside" in sheet.locator('[data-testid="sheet-detail-pen"]').inner_text() and sheet.locator('[data-testid="sheet-collar-classic-qatari"] .sheet-option-note').inner_text().strip() == ""
                and sheet.locator('[data-testid="sheet-detail-pen"] img').evaluate("e => e.naturalWidth > 0"))
    sheet.close()
    with page.expect_popup(timeout=15000) as pop:
        page.click('[data-testid="print-cart-receipt"]')
    rec = pop.value; rec.wait_for_load_state(); rec.wait_for_timeout(1500)
    rtext2 = rec.locator("body").inner_text()
    rec.close()
    check(f"{tag} the sale screen prints the thobe (drawn with its measurements, the collar, cuff and pocket pictures with their remarks) and the receipt before payment",
          ok_sheet and ("not paid yet" in rtext2 or "لم تُدفع بعد" in rtext2) and f"{total:.2f}" in rtext2, stext[:120] + " | " + rtext2[:160])
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
    line = sql(f"select (snapshot->'thobe'->>'metres') || ':' || (snapshot->'thobe'->'cuff' is not null) || ':' || (snapshot->'thobe'->>'pocket') || ':' || (snapshot->>'remarks') from order_items where order_id = '{order}'")
    m_, cuff_, pocket_, notes_ = line.split(":", 3)
    check(f"{tag} the remarks against each option are kept on the thobes, with their names",
          sql(f"select (snapshot->'thobe'->'style_notes'->>'collar:wide-collar') || '|' || (snapshot->'thobe'->'style_notes'->>'detail:pen') || '|' || jsonb_array_length(snapshot->'thobe'->'style_remarks') from order_items where order_id = '{order}'") == "Collar a little higher|Pen slot inside|4")
    check(f"{tag} the thobes keep their metres, cuff, pocket and the long notes", float(m_) == float(metres) + 0.5 and cuff_ == "true" and pocket_ == "true" and notes_ == "Pocket on the left\nLooser sleeves", line)
    # The sale page (from Sales, the invoice view) and the Sales list both offer the thobe print.
    tnum = sql(f"select number from orders where id = '{order}'")
    page.goto(ADMIN + f"/orders/{order}?view=invoice"); page.wait_for_timeout(1500)
    on_sale = page.locator('[data-testid="print-thobe-sheet"]').count()
    page.goto(ADMIN + "/sales"); page.wait_for_selector('[data-testid="sales-search"]', timeout=15000)
    page.fill('[data-testid="sales-search"]', tnum); page.wait_for_timeout(1800)
    check(f"{tag} a sale with thobes has the thobe print on its sale page and in the Sales list",
          on_sale == 1 and page.locator(f'[data-testid="print-thobe-{tnum}"]').count() == 1, f"{on_sale} {tnum}")
    sheet = page.context.new_page()
    sheet.add_init_script("window.print = () => {}")
    sheet.goto(ADMIN + f"/print/order/{order}"); sheet.wait_for_selector('[data-testid="order-sheet"]', timeout=15000); sheet.wait_for_timeout(1500)
    sheet.screenshot(path=f"{SHOTS}/print-order-{lang}.png", full_page=True)
    th = sheet.locator('[data-testid="order-thobe-0"]')
    text = sheet.locator('[data-testid="order-sheet"]').inner_text()
    check(f"{tag} the A4 thobe sheet draws the thobe with its collar, cuff, pocket and measurements marked, with the style remarks and no prices",
          th.locator('[data-testid="preview-chest_cm"]').text_content() == "108" and th.locator('[data-testid="preview-sleeve_cm"]').text_content() == "60"
          and all(th.locator(f'[data-testid="preview-{x}"]').count() == 1 for x in ("collar", "cuff", "pocket"))
          and "Collar a little higher" in text and "Cufflinks provided" in text and "QAR" not in text and "ر.ق" not in text, text[:200])
    sheet.close()

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

    # ---- the owner names the account; the admin can be installed ----
    if email == ADMIN_EMAIL:
        page.goto(ADMIN + "/")
        page.wait_for_selector('[data-testid="add-your-name"]', timeout=15000)
        shown = page.locator('[data-testid="top-account"]').inner_text().strip()
        page.click('[data-testid="add-your-name"]')
        page.fill('[data-testid="account-name"]', "Hamad Al-Thani")
        page.click('[data-testid="account-name-save"]')
        page.wait_for_function("document.querySelector('[data-testid=top-account]')?.textContent === 'Hamad Al-Thani'", timeout=15000)
        page.keyboard.press("Escape")
        page.goto(ADMIN + "/")
        page.wait_for_selector("h1")
        check(f"{tag} the owner shows as the account's email until named; once named, the name is used everywhere", shown == ADMIN_EMAIL and "Hamad" in page.locator("h1").inner_text() and page.locator('[data-testid="add-your-name"]').count() == 0)
        man = page.request.get(ADMIN + "/manifest.webmanifest").json()
        icon = page.request.get(ADMIN + "/icons/apple-touch-icon.png")
        check(f"{tag} the admin can be added to an iPad home screen: manifest, home-screen icon, full-screen mode",
              man["display"] == "standalone" and icon.ok and icon.headers.get("content-type") == "image/png"
              and page.locator('link[rel="manifest"]').count() == 1 and page.locator('meta[name="apple-mobile-web-app-capable"]').get_attribute("content") == "yes")
        sql(f"update staff_users set name = 'Owner' where email = '{ADMIN_EMAIL}'")
        ipad = browser.new_context(viewport={"width": 1180, "height": 820}, has_touch=True, user_agent="Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
        ip = ipad.new_page()
        ip.on("pageerror", lambda e: errors.append(f"{tag} ipad {e}"))
        login(ip, email, password)
        ip.click('[data-testid="install-app"]')
        ip.wait_for_selector(".steps")
        ip.screenshot(path=f"{SHOTS}/install-ipad-{lang}.png")
        check(f"{tag} on an iPad, Install app shows how to add the admin to the home screen", "Add to Home Screen" in ip.locator(".steps").inner_text())
        ipad.close()

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


def workshop(browser, lang):
    """The workshop board, done orders, alerts, asking before edits, measurements, stock and invoices."""
    tag = f"[{lang} workshop]"
    sql(f"update staff_users set language = '{lang}' where email = '{ADMIN_EMAIL}'")
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{tag} {e}"))
    login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    # Two thobe orders made at the counter, the older one first; the newer one is due tomorrow.
    cust = call("POST", "/admin/customers", {"name": f"Board {lang}", "phone": f"7{run}{'1' if lang == 'ar' else '2'}0"[:8],
                                             "measurements": {"length_cm": 150, "shoulder_cm": 46, "chest_cm": 110, "waist_cm": 100, "sleeve_cm": 61, "neck_cm": 40, "cuff_cm": 24}}, owner)
    member = call("GET", f"/admin/customers/{cust['id']}", token=owner)["family"][0]["id"]
    call("POST", "/admin/pos/register/open", {"branchId": branch, "openingCash": 0}, owner)
    sale2 = lambda total: call("POST", "/admin/pos/sales", {"sale": {"branchId": branch, "customerId": cust["id"], "lines": [{"kind": "thobe", "memberId": member, "collarId": "classic-qatari", "cuffId": "single", "fabricId": "japanese-cotton", "qty": 1}]},
                                                           "payments": [{"method": "card", "amount": total}]}, owner)
    q = call("POST", "/admin/pos/quote", {"branchId": branch, "customerId": cust["id"], "lines": [{"kind": "thobe", "memberId": member, "collarId": "classic-qatari", "cuffId": "single", "fabricId": "japanese-cotton", "qty": 1}]}, owner)
    a, b = sale2(q["total"]), sale2(q["total"])
    sql(f"update orders set created_at = now() - interval '3 days' where id = '{a['orderId']}'")
    tomorrow = sql("select ((now() at time zone 'Asia/Qatar')::date + 1)::text")
    sql(f"update orders set expected_delivery = '{tomorrow}' where id = '{b['orderId']}'")

    # The stage list (the default view): every stage as a pill, done ones ticked green, oldest first.
    page.goto(ADMIN + "/orders"); page.wait_for_selector('[data-testid="stage-list"]', timeout=15000); page.wait_for_timeout(800)
    rows = [x.get_attribute("data-testid").replace("row-", "") for x in page.locator('[data-testid="stage-list"] tr[data-testid^="row-"]').all()]
    states = [page.locator(f'[data-testid="stage-{a["number"]}-{x}"]').get_attribute("data-state") for x in ("measured", "cutting", "delivered")]
    page.screenshot(path=f"{SHOTS}/stages-{lang}.png", full_page=True)
    check(f"{tag} workshop orders are a list of all stages from Measurements to Done, oldest first, with no price",
          rows.index(a["number"]) < rows.index(b["number"]) and states == ["now", "todo", "todo"]
          and page.locator(f'[data-testid="row-{a["number"]}"] .stage-pill').count() == 6
          and "QAR" not in page.locator(f'[data-testid="row-{a["number"]}"]').inner_text(), f"{rows} {states}")
    page.click(f'[data-testid="advance-{a["number"]}"]')
    asked = page.locator('[data-testid="confirm-dialog"]').inner_text()
    page.click('[data-testid="confirm-cancel"]'); page.wait_for_timeout(600)
    kept = sql(f"select stage from orders where id = '{a['orderId']}'") == "measured"
    page.click(f'[data-testid="advance-{a["number"]}"]'); page.click('[data-testid="confirm-ok"]'); page.wait_for_timeout(1500)
    pill = page.locator(f'[data-testid="stage-{a["number"]}-measured"]')
    green = pill.evaluate("e => getComputedStyle(e).backgroundColor")
    check(f"{tag} moving asks first (Cancel keeps the stage); then Measurements is ticked green and Cutting is the current stage",
          f"#{a['number']}" in asked and kept and sql(f"select stage from orders where id = '{a['orderId']}'") == "cutting"
          and pill.get_attribute("data-state") == "done" and pill.locator("svg").count() == 1 and green == "rgb(227, 244, 232)"
          and page.locator(f'[data-testid="stage-{a["number"]}-cutting"]').get_attribute("data-state") == "now", f"{asked} {green}")
    page.screenshot(path=f"{SHOTS}/stages-moved-{lang}.png", full_page=True)

    check(f"{tag} there's no board any more: Stages and All orders only",
          page.locator('[role="tab"]').count() == 2 and page.locator('[data-testid^="col-"]').count() == 0)
    for st in ["stitching", "quality", "ready"]:
        call("POST", f"/admin/orders/{a['orderId']}/stage", {"stage": st}, owner)
    page.goto(ADMIN + "/orders"); page.wait_for_selector(f'[data-testid="advance-{a["number"]}"]', timeout=15000)
    label = page.locator(f'[data-testid="advance-{a["number"]}"]').get_attribute("aria-label")
    page.click(f'[data-testid="advance-{a["number"]}"]'); page.click('[data-testid="confirm-ok"]'); page.wait_for_timeout(1200)
    page.wait_for_selector(f'[data-testid="done-{a["number"]}"]', timeout=15000)
    page.screenshot(path=f"{SHOTS}/stages-done-{lang}.png", full_page=True)
    check(f"{tag} the last stage is Done (تم الاستلام); done orders move to the Completed section",
          ("Done" in label or "تم الاستلام" in label) and sql(f"select stage from orders where id = '{a['orderId']}'") == "delivered"
          and page.locator(f'[data-testid="row-{a["number"]}"]').count() == 0 and page.locator(f'[data-testid="done-{a["number"]}"]').count() == 1
          and page.locator(f'[data-testid="done-section"] [data-testid="stage-{a["number"]}-ready"]').get_attribute("data-state") == "done", label)
    page.screenshot(path=f"{SHOTS}/board-done-{lang}.png", full_page=True)

    # Alerts
    page.goto(ADMIN + "/"); page.wait_for_selector('[data-testid="alerts-bell"]', timeout=15000); page.wait_for_timeout(800)
    count = page.locator('[data-testid="alerts-count"]').inner_text()
    page.click('[data-testid="alerts-bell"]')
    panel = page.locator(".alerts-panel").inner_text()
    page.screenshot(path=f"{SHOTS}/alerts-{lang}.png")
    check(f"{tag} the bell shows alerts, including thobes due tomorrow that are not ready", int(count) >= 1 and f"#{b['number']}" in panel, panel[:300])
    page.keyboard.press("Escape"); page.mouse.click(5, 880)

    # An existing customer: found by mobile, last measurements filled in, a change saved as new measurements
    page.goto(ADMIN + "/pos"); page.wait_for_selector('[data-testid="pos-start"]', timeout=15000)
    page.click('[data-testid="start-existing"]')
    mob = sql(f"select substr(phone, 5) from customers where id = '{cust['id']}'")
    page.fill('[data-testid="start-search"]', mob); page.click(f'[data-testid="start-pick-+974{mob}"]')
    page.wait_for_selector('[data-testid="pos-tab-thobes"]', timeout=15000); page.click('[data-testid="pos-tab-thobes"]')
    page.wait_for_selector('[data-testid="thobe-desk"]', timeout=15000); page.wait_for_timeout(600)
    on_desk = page.locator('[data-testid="thobe-m-chest_cm"]').count() + page.locator('[data-testid="thobe-m-view"]').count()
    page.click('[data-testid="thobe-measurements"]'); page.wait_for_selector('[data-testid="thobe-measure"]', timeout=15000)
    viewed = page.locator('[data-testid="thobe-m-view-chest_cm"]').inner_text()
    inputs = page.locator('[data-testid="thobe-m-chest_cm"]').count()
    page.screenshot(path=f"{SHOTS}/pos-thobe-existing-view-{lang}.png", full_page=True)
    check(f"{tag} an existing customer's measurements open from the Measurements button, as a table, not a form",
          on_desk == 0 and viewed == "110" and inputs == 0 and page.locator('[data-testid="preview-chest_cm"]').text_content() == "110", f"{on_desk} {viewed} {inputs}")
    page.click('[data-testid="thobe-m-edit"]')
    filled = page.input_value('[data-testid="thobe-m-chest_cm"]')
    page.fill('[data-testid="thobe-m-sleeve_cm"]', "62")
    page.click('[data-testid="thobe-m-save"]'); page.wait_for_selector('[data-testid="thobe-desk"]', timeout=15000); page.wait_for_timeout(600)
    page.select_option('[data-testid="thobe-fabric"]', index=1)
    page.screenshot(path=f"{SHOTS}/pos-thobe-existing-{lang}.png", full_page=True)
    page.click('[data-testid="thobe-add"]'); page.wait_for_selector('.cart-line', timeout=15000); page.wait_for_timeout(800)
    check(f"{tag} Edit opens their measurements for changing; Save keeps them as new measurements; then just cloth and add",
          float(filled) == 110 and sql(f"select count(*) || ':' || max(sleeve_cm)::float from measurements where member_id = '{member}'") == "2:62"
          and page.locator('.cart-line').count() >= 1, f"{filled}")

    # Asking before saving an edit
    page.goto(ADMIN + "/products"); page.wait_for_selector('table tbody tr', timeout=15000)
    page.locator('table tbody tr.click').first.click()
    page.wait_for_selector('[data-testid="product-save"]')
    page.click('[data-testid="product-save"]')
    asked = page.locator('[data-testid="confirm-dialog"]').count() == 1
    page.screenshot(path=f"{SHOTS}/confirm-{lang}.png")
    page.click('[data-testid="confirm-cancel"]')
    still_open = page.locator('[data-testid="product-save"]').count() == 1
    check(f"{tag} editing asks before saving; Cancel keeps the form open", asked and still_open)
    page.keyboard.press("Escape")

    # Editing measurements from the customer measurements page
    page.goto(ADMIN + f"/tailor/measurements"); page.wait_for_selector(f'[data-testid="edit-measure-Board {lang}"]', timeout=15000)
    page.click(f'[data-testid="edit-measure-Board {lang}"]')
    page.fill('[data-testid="m-sleeve_cm"]', "63.5")
    page.click('[data-testid="measure-save"]'); page.click('[data-testid="confirm-ok"]'); page.wait_for_timeout(1200)
    check(f"{tag} measurements are edited from the customer measurements page (after asking)",
          sql(f"select sleeve_cm::float || ':' || count(*) over () from measurements where member_id = '{member}' order by taken_at desc limit 1") == "63.5:2")

    # Stock: cloth in metres, products by quantity, and new stock received
    page.goto(ADMIN + "/stock"); page.wait_for_selector('[data-testid="receive-new"]', timeout=15000)
    page.click('[data-testid="receive-new"]')
    page.fill('[data-testid="receive-picker"]', "F-JAPANESE-COTTON"); page.wait_for_timeout(400)
    page.press('[data-testid="receive-picker"]', "Enter")
    page.wait_for_selector('[data-testid="receive-qty"]', timeout=5000)
    page.fill('[data-testid="receive-qty"]', "25.5"); page.click('[data-testid="receive-save"]'); page.wait_for_timeout(1200)
    got = sql(f"select coalesce(sum(qty),0)::float from stock_moves where item_kind = 'fabric' and item_id = 'japanese-cotton' and reason = 'received'")
    page.screenshot(path=f"{SHOTS}/stock-cloth-{lang}.png", full_page=True)
    check(f"{tag} cloth stock is received in metres on the stock page", float(got) >= 25.5, got)

    # Adding stock straight from the products list and the cloth list
    page.goto(ADMIN + "/products"); page.wait_for_selector('[data-testid^="add-stock-"]', timeout=15000)
    btn = page.locator('[data-testid^="add-stock-"]').first
    sku = btn.get_attribute("data-testid").replace("add-stock-", "")
    pid = sql(f"select id from products where sku = '{sku}'")
    before = float(sql(f"select coalesce(sum(qty),0) from stock_moves where item_kind = 'product' and item_id = '{pid}'"))
    btn.click(); page.fill('[data-testid="receive-qty"]', "5"); page.click('[data-testid="receive-save"]'); page.wait_for_timeout(1200)
    after = float(sql(f"select coalesce(sum(qty),0) from stock_moves where item_kind = 'product' and item_id = '{pid}'"))
    check(f"{tag} products: the + beside the stock adds new stock", after == before + 5, f"{sku} {before} -> {after}")
    page.goto(ADMIN + "/catalogue"); page.wait_for_selector('[role="tab"]', timeout=15000)
    page.locator('[role="tab"]').nth(1).click(); page.wait_for_selector('[data-testid="add-stock-F-SWISS-VOILE"]', timeout=15000)
    before = float(sql("select coalesce(sum(qty),0) from stock_moves where item_kind = 'fabric' and item_id = 'swiss-voile'"))
    page.click('[data-testid="add-stock-F-SWISS-VOILE"]'); page.fill('[data-testid="receive-qty"]', "10.25"); page.click('[data-testid="receive-save"]'); page.wait_for_timeout(1200)
    after = float(sql("select coalesce(sum(qty),0) from stock_moves where item_kind = 'fabric' and item_id = 'swiss-voile'"))
    page.screenshot(path=f"{SHOTS}/cloth-stock-{lang}.png", full_page=True)
    check(f"{tag} cloth: the + beside the metres adds new stock", abs(after - before - 10.25) < 0.001, f"{before} -> {after}")

    # The invoice page: payments, no measurements
    page.goto(ADMIN + "/sales"); page.wait_for_selector(f'[data-testid="sale-{b["number"]}"]', timeout=15000)
    page.click(f'[data-testid="sale-{b["number"]}"]'); page.wait_for_selector('[data-testid="payment-row"]', timeout=15000)
    body = page.locator("main").inner_text()
    check(f"{tag} an invoice shows the payments, not the measurements",
          page.locator(".mgrid").count() == 0 and page.locator('[data-testid^="measure-"]').count() == 0 and page.locator('[data-testid="payment-row"]').count() >= 1, body[:200])
    page.goto(ADMIN + f"/orders/{b['orderId']}"); page.wait_for_selector(".mgrid", timeout=15000)
    check(f"{tag} the same order from the workshop still shows the measurements", page.locator(".mgrid").count() == 1)
    page.screenshot(path=f"{SHOTS}/invoice-{lang}.png", full_page=True)

    # Mobiles read left to right in Arabic
    page.goto(ADMIN + "/tailor/measurements"); page.wait_for_timeout(1500)
    if lang == "ar":
        el = page.locator(".num", has_text="+974").first
        # The digits must be laid out left to right: "+974" ends up left of the last four digits.
        order = el.evaluate("""e => {
          const t = e.firstChild; const s = t.textContent; const r = document.createRange();
          const at = (i) => { r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect().left; };
          return at(s.indexOf('+')) < at(s.length - 2);
        }""")
        check(f"{tag} a mobile in Arabic reads +974 then the number, left to right", order, el.inner_text())
    ctx.close()


def sales_report(browser, lang):
    """The sales report: this month by default, and its totals match what was sold."""
    tag = f"[{lang} sales report]"
    sql(f"update staff_users set language = '{lang}' where email = '{ADMIN_EMAIL}'")
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{tag} {e}"))
    login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    page.goto(ADMIN + "/reports/sales"); page.wait_for_selector('[data-testid="sales-totals"]', timeout=20000); page.wait_for_timeout(800)
    month = sql("select to_char(date_trunc('month', now() at time zone 'Asia/Qatar'), 'YYYY-MM-DD') || '|' || to_char(date_trunc('month', now() at time zone 'Asia/Qatar') + interval '1 month - 1 day', 'YYYY-MM-DD')")
    shown = f"{page.input_value('[data-testid=sales-from]')}|{page.input_value('[data-testid=sales-to]')}"
    W = "o.stage not in ('pending_payment','payment_failed','cancelled') and date_trunc('month', o.created_at at time zone 'Asia/Qatar') = date_trunc('month', now() at time zone 'Asia/Qatar')"
    disc = float(sql(f"select coalesce(sum(o.discount),0) + coalesce((select sum(i.discount) from order_items i join orders o on o.id = i.order_id where {W}),0) from orders o where {W}"))
    metres = float(sql(f"select coalesce(sum((i.snapshot->'thobe'->>'metres')::numeric * i.qty),0) from order_items i join orders o on o.id = i.order_id where {W} and i.kind = 'thobe'"))
    prods = int(sql(f"select coalesce(sum(i.qty),0) from order_items i join orders o on o.id = i.order_id where {W} and i.kind = 'product'"))
    digits = lambda x: float("".join(ch for ch in x if ch.isdigit() or ch == ".") or 0)
    page.screenshot(path=f"{SHOTS}/sales-report-{lang}.png", full_page=True)
    got = (digits(page.locator('[data-testid="sales-discount"]').inner_text()), digits(page.locator('[data-testid="sales-metres"]').inner_text()), int(digits(page.locator('[data-testid="sales-products"]').inner_text())))
    check(f"{tag} opens on this month, from the 1st to the last day", shown == month, f"{shown} {month}")
    check(f"{tag} the discounts given, cloth sold and products sold match the sales", got == (round(disc, 2), round(metres, 2), prods) and prods > 0 and metres > 0, f"{got} {(disc, metres, prods)}")
    page.select_option('[data-testid="sales-channel"]', "app"); page.wait_for_timeout(1500)
    app_prods = int(sql(f"select coalesce(sum(i.qty),0) from order_items i join orders o on o.id = i.order_id where {W} and o.channel = 'app' and i.kind = 'product'"))
    check(f"{tag} the channel filter narrows the figures", int(digits(page.locator('[data-testid="sales-products"]').inner_text())) == app_prods, app_prods)
    check(f"{tag} the cloth, products and discounts tables are there",
          all(page.locator(f'[data-testid="{x}"]').count() == 1 for x in ("sales-cloth", "sales-products-table", "sales-discounts", "sales-channels")))
    ctx.close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    counter(browser, "ar", CASHIER, "cashier-pass-2026")
    counter(browser, "en", ADMIN_EMAIL, ADMIN_PASSWORD)
    workshop(browser, "en")
    workshop(browser, "ar")
    sales_report(browser, "en")
    sales_report(browser, "ar")
    browser.close()

print("page errors:", errors or "none")
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed or errors else 0)
