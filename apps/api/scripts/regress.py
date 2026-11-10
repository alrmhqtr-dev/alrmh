"""Regression checks for the November 2026 audit fixes.

Runs against a live API with SEED_DEMO=true, OTP_MODE=preview, PAYMENT_MODE=mock
RATE_LIMITS=off (the checks fire many requests from one address) and
CORS_ORIGINS set to the app's address (the return-address check needs it). It needs
`psql` and DATABASE_URL to set up states the API cannot reach on its own, such
as a hold that is 31 minutes old.

    API=http://localhost:4000 python3 apps/api/scripts/regress.py
"""
import base64, json, os, subprocess, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

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


def pay(order, result="paid", ret=None):
    ret = urllib.request.quote(ret or APP, safe="")
    return call("POST", f"/pay/mock/{order['paymentId']}?return={ret}", form=f"result={result}")


def home_setup(tok):
    fam = call("GET", "/family", token=tok)[1]
    addr = call("POST", "/addresses", {"label": "Home", "line1": "Villa 1", "area": "Al Waab"}, tok)[1]
    return fam[0]["id"], addr["id"]


def free_home_slots(tok, days=10):
    return [x["startsAt"] for d in call("GET", f"/slots?kind=home&days={days}", token=tok)[1]["days"] for x in d["times"] if x["available"]]


owner = staff()

# ---- login codes -------------------------------------------------------------
phone = "55570001"
sql(f"delete from otp_codes where phone = '+974{phone}'")
call("POST", "/auth/otp", {"phone": phone})
with ThreadPoolExecutor(60) as ex:
    res = list(ex.map(lambda i: call("POST", "/auth/verify", {"phone": phone, "code": f"{i:06d}"})[1].get("code"), range(300)))
check("login code: at most 5 guesses per code, even in parallel", res.count("wrong_code") == 5 and res.count("too_many_attempts") == 295, str({k: res.count(k) for k in set(res)}))

phone = "55570002"
sql(f"delete from otp_codes where phone = '+974{phone}'")
codes = []
for _ in range(6):
    codes.append(call("POST", "/auth/otp", {"phone": phone})[0])
    sql(f"update otp_codes set sent_at = now() - interval '1 minute' where phone = '+974{phone}'")
check("login code: 5 codes per number per hour", codes == [200] * 5 + [429], str(codes))

# ---- one voucher, one order ---------------------------------------------------
t = login("55551234")
for it in call("GET", "/basket", token=t)[1]["items"]:
    call("DELETE", f"/basket/items/{it['id']}", token=t)
call("POST", "/basket/items", {"kind": "product", "productId": "leather-sandals", "size": "42"}, t)
o1 = call("POST", "/orders", {}, t)[1]
o2 = call("POST", "/orders", {}, t)[1]
p1, p2 = pay(o1), pay(o2)
paid = int(sql("select count(*) from orders o join vouchers v on v.id = o.voucher_id where v.code = 'AR10-7KQ2' and o.paid_at is not null"))
check("voucher: the earlier unpaid checkout is closed", "checkout?payment=cancelled" in p1[1].get("location", ""), str(p1[1]))
check("voucher: only one order is paid with it", paid == 1 and "order-placed" in p2[1].get("location", ""), f"paid={paid}")

# ---- bookings ------------------------------------------------------------------
ta, tb = login("55570003"), login("55570004")
ma, aa = home_setup(ta)
mb, ab = home_setup(tb)
slot = free_home_slots(ta)[3]
hold = call("POST", "/appointments", {"kind": "home", "addressId": aa, "memberId": ma, "startsAt": slot}, ta)[1]
s, r, _ = call("POST", "/appointments", {"kind": "home", "addressId": ab, "memberId": mb, "startsAt": slot, "standalone": True}, tb)
check("booking: a fresh hold blocks the slot", r.get("code") == "slot_taken", str(r))
sql(f"update appointments set created_at = now() - interval '31 minutes' where id = '{hold['id']}'")
s, booked, _ = call("POST", "/appointments", {"kind": "home", "addressId": ab, "memberId": mb, "startsAt": slot, "standalone": True}, tb)
check("booking: a lapsed hold frees the slot", booked.get("status") == "confirmed", str(booked))
call("POST", "/basket/items", {"kind": "thobe", "collarId": "classic-qatari", "fabricId": "swiss-voile", "colourId": "ivory", "memberId": ma, "measureMethod": "home", "appointmentId": hold["id"]}, ta)
s, r, _ = call("POST", "/orders", {}, ta)
confirmed = int(sql(f"select count(*) from appointments where kind = 'home' and starts_at = '{slot}' and status = 'confirmed'"))
check("booking: checkout with a lapsed hold on a taken slot is refused", s == 400 and r.get("code") == "appointment_expired" and confirmed == 1, f"{s} {r} confirmed={confirmed}")

other = [x for x in free_home_slots(tb) if x != slot]
s, r, _ = call("POST", "/appointments", {"kind": "home", "addressId": ab, "memberId": mb, "startsAt": other[0], "standalone": True}, tb)
check("booking: one free-standing visit per person at a time", r.get("code") == "already_booked", str(r))
s, r, _ = call("DELETE", f"/appointments/{booked['id']}", token=tb)
check("booking: the customer can cancel a free-standing visit", s == 200, f"{s} {r}")
s, r, _ = call("POST", "/appointments", {"kind": "home", "addressId": ab, "memberId": mb, "startsAt": other[0], "standalone": True}, tb)
check("booking: and book again afterwards", r.get("status") == "confirmed", str(r))

tc = login("55570005")
mc, ac = home_setup(tc)
free = [x for x in free_home_slots(tc)]
h1 = call("POST", "/appointments", {"kind": "home", "addressId": ac, "memberId": mc, "startsAt": free[0]}, tc)[1]
h2 = call("POST", "/appointments", {"kind": "home", "addressId": ac, "memberId": mc, "startsAt": free[1]}, tc)[1]
check("booking: picking a new time releases the earlier hold", sql(f"select status from appointments where id = '{h1['id']}'") == "cancelled" and h2.get("status") == "held")

# ---- points --------------------------------------------------------------------
doubled = 0
for i in range(12):
    tg = login(f"5558{i:04d}")
    cid = call("GET", "/me", token=tg)[1]["id"]
    sql(f"insert into points_ledger (customer_id, kind, points, remaining, expires_at, label) values ('{cid}','earn',100,100, now() - interval '1 minute','Regress')")
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(lambda p: call("GET", p, token=tg), ["/me", "/rewards", "/rewards/options"] * 2))
    doubled += sql(f"select count(*) || ':' || coalesce(sum(points),0) from points_ledger where customer_id = '{cid}' and kind = 'expire'") != "1:-100"
check("points: an expired award is deducted exactly once", doubled == 0, f"{doubled} of 12 rounds wrong")

oid = o2["orderId"]
for stage in ["ready", "out_for_delivery"]:
    call("POST", f"/admin/orders/{oid}/stage", {"stage": stage}, owner)
with ThreadPoolExecutor(8) as ex:
    statuses = list(ex.map(lambda i: call("POST", f"/admin/orders/{oid}/stage", {"stage": "delivered"}, owner)[0], range(8)))
awards = sql(f"select count(*) from points_ledger where order_id = '{oid}' and kind = 'earn'")
check("points: delivered twice at once awards points once", awards == "1" and statuses.count(201) == 1, f"awards={awards} {statuses}")

# ---- coupons -------------------------------------------------------------------
tp = login("55570006")
call("POST", "/addresses", {"label": "Home", "line1": "Villa 9", "area": "Al Sadd"}, tp)
call("POST", "/basket/items", {"kind": "product", "productId": "oud-50"}, tp)
first = call("POST", "/orders", {"couponCode": "EID20"}, tp)[1]
pay(first)
call("POST", "/basket/items", {"kind": "product", "productId": "oud-50"}, tp)
q = call("POST", "/checkout/quote", {"couponCode": "EID20"}, tp)[1]
s, r, _ = call("POST", "/orders", {"couponCode": "EID20"}, tp)
check("coupon: one use per customer by default", q["coupon"].get("error") == "coupon_used" and q["discount"] == 0 and r.get("code") == "coupon_used", f"{q['coupon']} {r}")
s, r, _ = call("POST", "/admin/coupons", {"code": "REGMIN", "percent": 10, "min_subtotal": 500, "per_customer_limit": ""}, owner)
q = call("POST", "/checkout/quote", {"couponCode": "REGMIN"}, tp)[1]
check("coupon: minimum spend is enforced", q["coupon"].get("error") == "coupon_min" and q["coupon"].get("min") == 500, str(q["coupon"]))

# ---- payment return address ----------------------------------------------------
call("POST", "/basket/items", {"kind": "product", "productId": "cufflinks"}, tp)
o = call("POST", "/orders", {}, tp)[1]
lookalike = APP.replace("://", "://evil.example.", 1) if "localhost" in APP else APP + ".evil.example"
loc = pay(o, ret=lookalike)[1].get("location", "")
check("payment: a look-alike return address is ignored", loc.startswith(APP + "/order-placed/"), loc)
call("POST", "/basket/items", {"kind": "product", "productId": "cufflinks"}, tp)
o = call("POST", "/orders", {}, tp)[1]
loc = pay(o, ret="alrmh://")[1].get("location", "")
check("payment: the native app's link returns to the native app", loc.startswith("alrmh://order-placed/"), loc)

# ---- bad input is a 400, not a 500 ----------------------------------------------
bad = {
    "slots days=abc": call("GET", "/slots?kind=home&days=abc", token=tp)[0],
    "basket qty=abc": call("POST", "/basket/items", {"kind": "product", "productId": "oud-50", "qty": "abc"}, tp)[0],
    "reschedule bad date": call("PATCH", f"/appointments/{h2['id']}", {"startsAt": "nonsense"}, tc)[0],
    "coupon bad date": call("POST", "/admin/coupons", {"code": "REGBAD", "percent": 10, "expires_at": "nonsense"}, owner)[0],
    "order id not an id": call("GET", "/orders/not-an-id", token=tp)[0],
    "malformed JSON": call("POST", "/auth/otp", form="{not json")[0],
}
check("bad input: answered with 200/400, never 500", bad["slots days=abc"] == 200 and all(v == 400 for k, v in bad.items() if k != "slots days=abc"), str(bad))

# ---- staff ---------------------------------------------------------------------
sql("delete from staff_users where email = 'lock-test@alrmh.qa'")
call("POST", "/admin/staff", {"email": "lock-test@alrmh.qa", "name": "Lock Test", "role": "support", "password": "correct-horse-battery"}, owner)
tries = [call("POST", "/admin/auth/login", {"email": "lock-test@alrmh.qa", "password": f"wrong-{i}"})[0] for i in range(10)]
s, r, _ = call("POST", "/admin/auth/login", {"email": "lock-test@alrmh.qa", "password": "correct-horse-battery"})
check("staff sign-in: locked for 15 minutes after 10 wrong passwords", tries == [400] * 10 and s == 429 and r.get("code") == "account_locked", f"{tries} {s} {r}")
sql("update staff_users set locked_until = now() - interval '1 second' where email = 'lock-test@alrmh.qa'")
check("staff sign-in: works again once the lock ends", call("POST", "/admin/auth/login", {"email": "lock-test@alrmh.qa", "password": "correct-horse-battery"})[0] == 200)
found = len(call("GET", "/admin/customers?q=Hamad%20Al", token=owner)[1])
check("admin search: a name with a space is found", found == 1, f"found {found}")

# ---- account deletion -----------------------------------------------------------
s, r, _ = call("DELETE", "/me", token=tp)
check("delete account: refused while an order is in progress", s == 400 and r.get("code") == "active_orders", f"{s} {r}")
tn = login("55570007")
cid = call("GET", "/me", token=tn)[1]["id"]
fid = call("POST", "/family", {"name": "Child", "relation": "son", "size": "child"}, tn)[1]["id"]
call("POST", f"/admin/members/{fid}/measurements", {"length_cm": 100, "shoulder_cm": 30, "chest_cm": 60, "waist_cm": 55, "sleeve_cm": 40, "neck_cm": 28, "cuff_cm": 16}, owner)
s, r, _ = call("DELETE", "/me", token=tn)
left = sql(
    f"select (select count(*) from family_members where customer_id = '{cid}') + (select count(*) from notifications where customer_id = '{cid}')"
    f" + (select count(*) from addresses where customer_id = '{cid}') + (select count(*) from points_ledger where customer_id = '{cid}')"
)
check("delete account: family, measurements, notifications and points are removed", s == 200 and left == "0", f"{s} left={left}")

# ---- catalogue managed from the admin ---------------------------------------------
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
s, up, _ = call("POST", "/admin/media", raw=(PNG, "image/png"), token=owner)
with urllib.request.urlopen(B.replace("/v1", "") + up.get("url", "/missing")) as r:
    served = (r.status, r.headers.get("Content-Type"), r.read() == PNG, "immutable" in (r.headers.get("Cache-Control") or ""))
check("photo: uploaded from the admin and served back unchanged", s == 201 and served == (200, "image/png", True, True), f"{s} {up} {served}")
rejected = {
    "not an image": call("POST", "/admin/media", raw=(b"<script>alert(1)</script>", "image/png"), token=owner)[0],
    "over 2 MB": call("POST", "/admin/media", raw=(PNG + b"0" * 2_300_000, "image/png"), token=owner)[0],
    "not signed in": call("POST", "/admin/media", raw=(PNG, "image/png"))[0],
}
check("photo: wrong files, oversized files and strangers are refused", rejected == {"not an image": 400, "over 2 MB": 413, "not signed in": 401}, str(rejected))

cid = call("POST", "/admin/categories", {"name_en": "Bisht", "name_ar": "بشت"}, owner)[1].get("id")
pid = call("POST", "/admin/products", {"category": cid, "name_en": "Black bisht", "name_ar": "بشت أسود", "price": 900, "image_url": up.get("url")}, owner)[1].get("id")
shape = call("POST", "/admin/collars", {"name_en": "Regress band", "name_ar": "ياقة", "shape": "mandarin-band"}, owner)[1].get("id")
bid = call("POST", "/admin/branches", {"name_en": "The Pearl", "name_ar": "اللؤلؤة", "address_en": "Porto Arabia", "address_ar": "بورتو أرابيا", "phone": "+97444441111",
                                       "hours_en": "Sat-Thu 10-10", "hours_ar": "السبت-الخميس", "lat": 25.3712, "lng": 51.5510, "closed_weekdays": [5]}, owner)[1].get("id")
cat = call("GET", "/catalogue")[1]
prod = next((p for p in cat["products"] if p["id"] == pid), {})
check("catalogue: a new category and its product (with photo) reach the app", any(c["id"] == cid and c["name_ar"] == "بشت" for c in cat["categories"]) and prod.get("image_url") == up.get("url") and prod.get("category") == cid, str(prod))
check("catalogue: a new collar carries its drawing", any(c["id"] == shape and c.get("shape") == "mandarin-band" for c in cat["collars"]))
br = next((b for b in cat["branches"] if b["id"] == bid), {})
slots2 = call("GET", f"/slots?kind=branch&branchId={bid}&days=3", token=tp)
check("catalogue: a second branch reaches the app with its map position and bookable times", br.get("lat") == 25.3712 and slots2[0] == 200 and len(slots2[1].get("days", [])) == 3, f"{br} {slots2[0]}")
refused = {
    "unknown category": call("POST", "/admin/products", {"category": "nope", "name_en": "X", "name_ar": "X", "price": 1}, owner)[0],
    "insecure photo address": call("PATCH", f"/admin/products/{pid}", {"image_url": "http://example.com/a.jpg"}, owner)[0],
    "unknown collar drawing": call("PATCH", f"/admin/collars/{shape}", {"shape": "v-neck"}, owner)[0],
    "closing before opening": call("PATCH", f"/admin/branches/{bid}", {"close_minute": 600}, owner)[0],
    "latitude out of range": call("PATCH", f"/admin/branches/{bid}", {"lat": 125}, owner)[0],
}
check("catalogue: invalid values are refused", all(v == 400 for v in refused.values()), str(refused))
call("PATCH", f"/admin/branches/{bid}", {"active": False}, owner)
call("PATCH", f"/admin/products/{pid}", {"active": False}, owner)
call("PATCH", f"/admin/categories/{cid}", {"active": False}, owner)
call("PATCH", f"/admin/collars/{shape}", {"active": False}, owner)

# ---- response headers -----------------------------------------------------------
h = call("GET", "/catalogue")[2]
check("headers: hardened and not advertising the framework", h.get("X-Powered-By") is None and h.get("X-Content-Type-Options") == "nosniff" and h.get("X-Frame-Options") == "DENY")

print()
if failures:
    print(f"{len(failures)} check(s) failed:", *failures, sep="\n  ")
    sys.exit(1)
print("all checks passed")
