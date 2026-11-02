import json, urllib.request, sys
import os
B = os.environ.get("API", "http://localhost:4000") + "/v1"
def call(method, path, body=None, token=None, admin=False, ok=True):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    if admin: req.add_header("X-Admin-Token", os.environ.get("ADMIN_TOKEN", "dev-admin-token"))
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        data = json.loads(e.read() or b"null")
        if ok: print("FAIL", method, path, e.code, data); sys.exit(1)
        return {"_status": e.code, **(data or {})}

phone = sys.argv[1] if len(sys.argv) > 1 else "55559876"
r = call("POST", "/auth/otp", {"phone": phone}); print("otp", r)
print("wrong", call("POST", "/auth/verify", {"phone": phone, "code": "000000"}, ok=False))
v = call("POST", "/auth/verify", {"phone": phone, "code": r["preview"]["code"]}); t = v["token"]; print("isNew", v["isNew"])
call("PATCH", "/me", {"name": "Test Customer", "language": "ar"}, t)
fam = call("GET", "/family", token=t); print("family", [(f["name"], f["relation"]) for f in fam])
me_id = fam[0]["id"]
addr = call("POST", "/addresses", {"label": "Home", "line1": "Villa 1, Street 2", "area": "Al Waab"}, t)
slots = call("GET", "/slots?kind=home&days=3", token=t)
slot = next(tt for d in slots["days"] for tt in d["times"] if tt["available"]); print("slot", slot)
appt = call("POST", "/appointments", {"kind": "home", "addressId": addr["id"], "memberId": me_id, "startsAt": slot["startsAt"]}, t)
cat = call("GET", "/catalogue")
b = call("POST", "/basket/items", {"kind": "thobe", "collarId": "classic-qatari", "fabricId": "swiss-voile", "colourId": "ivory", "memberId": me_id, "measureMethod": "home", "appointmentId": appt["id"], "qty": 2, "remarks": "Looser fit"}, t)
b = call("POST", "/basket/items", {"kind": "product", "productId": "white-ghutra", "size": "56"}, t)
print("basket", b["count"], b["subtotal"], b["pointsToEarn"])
q = call("POST", "/checkout/quote", {"couponCode": "SUMMER24"}, t); print("expired coupon", q["coupon"])
q = call("POST", "/checkout/quote", {"couponCode": "EID20"}, t); print("EID20", q["discount"], q["total"], q["homeVisitFee"])
o = call("POST", "/orders", {"returnUrl": "http://localhost:8081"}, t); print("order", o["number"], o["total"])
pid = o["paymentId"]
req = urllib.request.Request(f"{B}/pay/mock/{pid}?return=http%3A%2F%2Flocalhost%3A8081", method="POST", data=b"result=paid")
req.add_header("Content-Type", "application/x-www-form-urlencoded")
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
try: urllib.request.build_opener(NoRedirect).open(req)
except urllib.error.HTTPError as e: print("redirect", e.code, e.headers["Location"])
d = call("GET", f"/orders/{o['orderId']}", token=t); print("stage", d["stage"], [e["stage"] for e in d["events"]], d["expected_delivery"])
print("basket after", call("GET", "/basket", token=t)["count"])
call("POST", f"/admin/members/{me_id}/measurements", {"tailorName": "Yousef", "length_cm": 150, "shoulder_cm": 46, "chest_cm": 110, "waist_cm": 100, "sleeve_cm": 61, "neck_cm": 40, "cuff_cm": 24}, admin=True)
print("after measure", call("GET", f"/orders/{o['orderId']}", token=t)["stage"])
for s in ["cutting", "stitching", "ready", "out_for_delivery", "delivered"]:
    call("POST", f"/admin/orders/{o['orderId']}/stage", {"stage": s}, admin=True)
rw = call("GET", "/rewards", token=t); print("rewards", rw["balance"], rw["expiring"])
print("redeem 1000", call("POST", "/rewards/redeem", {"optionId": "discount-10"}, t, ok=False).get("code"))
print("redeem 5", call("POST", "/rewards/redeem", {"optionId": "discount-5"}, t, ok=False))
print("notifications", [n["title_ar"] for n in call("GET", "/notifications", token=t)][:4])
print("orders", {k: [x["number"] for x in v] for k, v in call("GET", "/orders", token=t).items()})
