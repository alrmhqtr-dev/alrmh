"""Regression checks for the November 2026 audit fixes.

Runs against a live API with SEED_DEMO=true, OTP_MODE=preview, PAYMENT_MODE=mock
RATE_LIMITS=off (the checks fire many requests from one address) and
CORS_ORIGINS set to the app's address (the return-address check needs it). It needs
`psql` and DATABASE_URL to set up states the API cannot reach on its own, such
as a hold that is 31 minutes old.

    API=http://localhost:4000 python3 apps/api/scripts/regress.py
"""
import base64, json, os, ssl, subprocess, sys, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
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

# ---- customers edit their own details ----------------------------------------------
te = login("55570010", "Edit Tester")
fam = call("GET", "/family", token=te)[1]
me_member = fam[0]["id"]
s, r, _ = call("PATCH", f"/family/{me_member}", {"name": "Someone else"}, te)
check("self-service: your own entry is edited through your details", s == 400 and r.get("code") == "cannot_edit_self", f"{s} {r}")
son = call("POST", "/family", {"name": "Saad", "relation": "son", "size": "child"}, te)[1]["id"]
s, r, _ = call("PATCH", f"/family/{son}", {"name": "Saad Ali", "relation": "brother", "size": "adult"}, te)
check("self-service: a family member can be renamed and changed", r.get("name") == "Saad Ali" and r.get("relation") == "brother" and r.get("size") == "adult", str(r))
addr = call("POST", "/addresses", {"label": "Home", "line1": "Villa 1", "area": "Al Sadd"}, te)[1]["id"]
addr2 = call("POST", "/addresses", {"label": "Office", "line1": "Tower 2", "area": "West Bay"}, te)[1]["id"]
call("PATCH", f"/addresses/{addr}", {"line1": "Villa 11, Street 4", "notes": "Blue gate"}, te)
a = next(x for x in call("GET", "/addresses", token=te)[1] if x["id"] == addr)
check("self-service: an address can be edited", a["line1"] == "Villa 11, Street 4" and a["notes"] == "Blue gate" and a["area"] == "Al Sadd", str(a))
slot = free_home_slots(te)[0]
visit = call("POST", "/appointments", {"kind": "home", "addressId": addr, "memberId": son, "startsAt": slot, "standalone": True}, te)[1]
refused = {"remove booked person": call("DELETE", f"/family/{son}", token=te)[1].get("code"), "remove booked address": call("DELETE", f"/addresses/{addr}", token=te)[1].get("code")}
check("self-service: a person or address with a booked visit cannot be removed", refused == {"remove booked person": "member_has_booking", "remove booked address": "address_has_booking"}, str(refused))
call("DELETE", f"/appointments/{visit['id']}", token=te)
s1 = call("DELETE", f"/family/{son}", token=te)[0]
s2 = call("DELETE", f"/addresses/{addr}", token=te)[0]
left = call("GET", "/addresses", token=te)[1]
check("self-service: removed once the visit is cancelled; the other address becomes the default", s1 == 200 and s2 == 200 and len(left) == 1 and left[0]["id"] == addr2 and left[0]["is_default"], f"{s1} {s2} {left}")

# ---- home-visit fee for a visit booked on its own ----------------------------------
mem = call("GET", "/family", token=te)[1][0]["id"]
visit = call("POST", "/appointments", {"kind": "home", "addressId": addr2, "memberId": mem, "startsAt": free_home_slots(te)[1], "standalone": True}, te)[1]
fee_due = float(visit.get("fee") or 0)
first = call("POST", f"/admin/appointments/{visit['id']}/fee-paid", {}, owner)[0]
again = call("POST", f"/admin/appointments/{visit['id']}/fee-paid", {}, owner)[1].get("code")
check("fee: a home visit booked on its own is charged at the visit, and collected once", fee_due == 50 and first == 201 and again == "no_fee_due", f"{fee_due} {first} {again}")

# ---- a cancelled visit only comes back if its time still has room --------------------
tr1, tr2 = login("55570011"), login("55570012")
m1, a1 = home_setup(tr1)
m2, a2 = home_setup(tr2)
t0 = free_home_slots(tr1)[5]
v1 = call("POST", "/appointments", {"kind": "home", "addressId": a1, "memberId": m1, "startsAt": t0, "standalone": True}, tr1)[1]
call("POST", f"/admin/appointments/{v1['id']}/status", {"status": "cancelled"}, owner)
call("POST", "/appointments", {"kind": "home", "addressId": a2, "memberId": m2, "startsAt": t0, "standalone": True}, tr2)
s, r, _ = call("POST", f"/admin/appointments/{v1['id']}/status", {"status": "confirmed"}, owner)
check("staff: re-confirming a cancelled visit checks the time is still free", s == 400 and r.get("code") == "slot_taken", f"{s} {r}")

# ---- refunds -------------------------------------------------------------------------
tf = login("55570013")
call("POST", "/addresses", {"label": "Home", "line1": "Villa 2", "area": "Lusail"}, tf)
call("POST", "/basket/items", {"kind": "product", "productId": "white-ghutra", "size": "56"}, tf)
unpaid = call("POST", "/orders", {}, tf)[1]
s, r, _ = call("POST", f"/admin/orders/{unpaid['orderId']}/refunds", {"amount": 10}, owner)
check("refund: refused on an order that was never paid", r.get("code") == "not_paid", str(r))
call("POST", "/basket/items", {"kind": "product", "productId": "white-ghutra", "size": "56"}, tf)
paid = call("POST", "/orders", {}, tf)[1]
pay(paid)
call("POST", f"/admin/orders/{paid['orderId']}/cancel", {"reason": "regress"}, owner)
total = call("GET", f"/orders/{paid['orderId']}", token=tf)[1]["total"]
due = [x for x in call("GET", "/admin/overview", token=owner)[1]["refunds"] if x["id"] == paid["orderId"]]
part = call("POST", f"/admin/orders/{paid['orderId']}/refunds", {"amount": 50, "reference": "SADAD-1"}, owner)[1]
over = call("POST", f"/admin/orders/{paid['orderId']}/refunds", {"amount": total - 50 + 1}, owner)[1].get("code")
rest = call("POST", f"/admin/orders/{paid['orderId']}/refunds", {"amount": total - 50}, owner)[1]
detail = call("GET", f"/orders/{paid['orderId']}", token=tf)[1]
still_due = [x for x in call("GET", "/admin/overview", token=owner)[1]["refunds"] if x["id"] == paid["orderId"]]
told = any("Refund" in n["title_en"] for n in call("GET", "/notifications", token=tf)[1])
check("refund: listed as due, recorded in parts, never more than was paid, shown to the customer",
      len(due) == 1 and due[0]["due"] == total and part.get("left") == total - 50 and over == "refund_too_large" and rest.get("left") == 0 and detail["refunded"] == total and not still_due and told,
      f"{due} {part} {over} {rest} {detail.get('refunded')} {still_due} {told}")

# ---- unpaid checkouts close after 30 minutes -----------------------------------------
call("POST", "/basket/items", {"kind": "product", "productId": "cufflinks"}, tf)
late = call("POST", "/orders", {}, tf)[1]
sql(f"update payments set created_at = now() - interval '31 minutes' where id = '{late['paymentId']}'")
loc = pay(late)[1].get("location", "")
check("checkout: a payment page left open over 30 minutes cannot be paid", "checkout?payment=cancelled" in loc and sql(f"select stage from orders where id = '{late['orderId']}'") == "payment_failed", loc)

# ---- exports -------------------------------------------------------------------------
call("PATCH", "/me", {"name": "=HYPERLINK(\"http://x\")"}, tf)
req = urllib.request.Request(B + "/admin/export/customers.csv", headers={"Authorization": "Bearer " + owner})
with urllib.request.urlopen(req) as r:
    body, ctype = r.read().decode("utf-8"), r.headers.get("Content-Type", "")
check("export: customers CSV opens safely in Excel (BOM, formulas shown as text)", ctype.startswith("text/csv") and body.startswith("\ufeffName,Mobile") and "'=HYPERLINK" in body and "\n=HYPERLINK" not in body, body[:120])
req = urllib.request.Request(B + "/admin/export/orders.csv?from=2020-01-01&to=2099-12-31", headers={"Authorization": "Bearer " + owner})
with urllib.request.urlopen(req) as r:
    rows = r.read().decode("utf-8").strip().split("\r\n")
number = call("GET", f"/orders/{paid['orderId']}", token=tf)[1]["number"]
line = next((r.split(",") for r in rows if r.startswith(number + ",")), [])
check("export: orders CSV lists paid orders with their refunds", rows[0].startswith("\ufeffOrder,") and len(line) == 17 and float(line[11]) == total and float(line[12]) == total, f"{rows[0][:60]} {line}")
sql("insert into staff_users (email, name, role, password_hash) select 'support-x@alrmh.qa', 'Support X', 'support', password_hash from staff_users where email = 'lock-test@alrmh.qa' on conflict (email) do nothing")
support = staff("support-x@alrmh.qa", "correct-horse-battery")
check("export: support staff cannot export", call("GET", "/admin/export/customers.csv", token=support)[0] == 403)

# ---- staff change their own password ---------------------------------------------------
t_a = staff("lock-test@alrmh.qa", "correct-horse-battery")
t_b = staff("lock-test@alrmh.qa", "correct-horse-battery")
wrong = call("POST", "/admin/me/password", {"current": "nope", "next": "a-new-password-1"}, t_a)[1].get("code")
ok = call("POST", "/admin/me/password", {"current": "correct-horse-battery", "next": "a-new-password-1"}, t_a)[0]
check("staff password: needs the current one; other sessions end, this one stays",
      wrong == "wrong_password" and ok == 200 and call("GET", "/admin/me", token=t_b)[0] == 401 and call("GET", "/admin/me", token=t_a)[0] == 200
      and call("POST", "/admin/auth/login", {"email": "lock-test@alrmh.qa", "password": "a-new-password-1"})[0] == 200, f"{wrong} {ok}")

# ---- push notifications ------------------------------------------------------------------
# Push services are HTTPS. The checks run a local HTTPS receiver; the API must
# trust its certificate (NODE_EXTRA_CA_CERTS) and list 127.0.0.1 in PUSH_HOSTS.
key = call("GET", "/push/key")[1].get("key")
cert, cert_key = os.environ.get("PUSH_TEST_CERT"), os.environ.get("PUSH_TEST_KEY")
if not key or not cert:
    print("skip push checks: VAPID keys or PUSH_TEST_CERT not set")
else:
    received = []

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            received.append((self.path, dict(self.headers), body))
            self.send_response(410 if self.path.endswith("/gone") else 201)
            self.end_headers()

        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", 0), Receiver)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, cert_key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    # A test phone key (public half only). Real phones create their own.
    keys = {"p256dh": "BMNh2OhSlnIrysQcvv4HANyB8fnv9khOYNfPFlUJTK8CNBtFlSugA4eTyjV5FUrQ7S0lKaefCkdUI72hz1gn8yA", "auth": "oSEGoPH_hv4DQKBxNkfrnA"}
    tq = login("55570014", "Push Tester")
    bad = [call("POST", "/push/subscriptions", {"endpoint": e, "keys": keys}, tq)[1].get("code") for e in ("https://evil.example/push/1", f"http://127.0.0.1:{port}/push/plain")]
    check("push: subscriptions to an unknown service, or without HTTPS, are refused", bad == ["invalid_subscription"] * 2, str(bad))
    ok1 = call("POST", "/push/subscriptions", {"endpoint": f"https://127.0.0.1:{port}/push/phone", "keys": keys}, tq)[0]
    ok2 = call("POST", "/push/subscriptions", {"endpoint": f"https://127.0.0.1:{port}/push/gone", "keys": keys}, tq)[0]
    member = call("GET", "/family", token=tq)[1][0]["id"]
    call("POST", f"/admin/members/{member}/measurements", {"length_cm": 150, "shoulder_cm": 46, "chest_cm": 110, "waist_cm": 100, "sleeve_cm": 61, "neck_cm": 40, "cuff_cm": 24}, owner)
    for _ in range(40):
        if len(received) >= 2:
            break
        time.sleep(0.25)
    phone_hit = next((h for p, h, b in received if p.endswith("/phone")), {})
    check("push: a new notification is delivered, encrypted and signed, within seconds",
          ok1 == ok2 == 200 and phone_hit.get("Content-Encoding") == "aes128gcm" and phone_hit.get("Authorization", "").startswith("vapid t=") and phone_hit.get("TTL") == "3600",
          f"{ok1} {ok2} {[(p, h.get('Content-Encoding')) for p, h, b in received]}")
    time.sleep(0.5)
    check("push: a phone that left (410) is forgotten", sql(f"select count(*) from push_subscriptions where endpoint like '%/push/gone'") == "0")
    sent_once = len([1 for p, h, b in received if p.endswith('/phone')])
    time.sleep(3.5)
    check("push: each notification is sent once", sent_once == 1 and len([1 for p, h, b in received if p.endswith('/phone')]) == 1, str(sent_once))
    server.shutdown()

# ---- response headers -----------------------------------------------------------
h = call("GET", "/catalogue")[2]
check("headers: hardened and not advertising the framework", h.get("X-Powered-By") is None and h.get("X-Content-Type-Options") == "nosniff" and h.get("X-Frame-Options") == "DENY")

print()
if failures:
    print(f"{len(failures)} check(s) failed:", *failures, sep="\n  ")
    sys.exit(1)
print("all checks passed")
