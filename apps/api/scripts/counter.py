"""Checks for the counter changes of 22 Nov 2026: cloth by the metre, collar and cuff styles,
new customers with measurements, measurement edits, plain order numbers, three home-visit
windows, no agents or service types, pickup reminders and staff alerts.

Same setup as regress.py (SEED_DEMO=true, OTP_MODE=preview, PAYMENT_MODE=mock,
RATE_LIMITS=off, QUIET_HOURS=off, HOUSEKEEPING_SECONDS=5, and psql with DATABASE_URL).

    API=http://localhost:4000 python3 apps/api/scripts/counter.py
"""
import os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
from regress_lib import call, check, failures, login, sql, staff  # noqa: E402

owner = staff()
run = str(int(time.time()))[-6:]
b1 = call("GET", "/admin/branches", token=owner)[1][0]["id"]
call("POST", "/admin/pos/register/open", {"branchId": b1, "openingCash": 0}, owner)
M = {"length_cm": 150, "shoulder_cm": 46, "chest_cm": 110, "waist_cm": 100, "sleeve_cm": 61, "neck_cm": 40, "cuff_cm": 24}

# ---- retired lists -------------------------------------------------------------------------
gone = [call("GET", f"/admin/lists/{k}", token=owner)[0] for k in ("agents", "service-types")]
check("agents and service types are gone", gone == [404, 404], gone)
s, r, _ = call("GET", "/admin/reports/agents", token=owner)
check("the agents report is gone", s == 404, s)
items = call("GET", "/admin/pos/items", token=owner)[1]
check("counter: no agents, service types or colours; cuffs and collars come with their pictures",
      "agents" not in items and "services" not in items and "colours" not in items and len(items["cuffs"]) == 2
      and all("image_url" in c for c in items["collars"] + items["cuffs"]), list(items.keys()))

# ---- new customer at the counter, with measurements ----------------------------------------
phone = f"55{run}"
s, cust, _ = call("POST", "/admin/customers", {"name": "New Counter", "phone": phone, "measurements": {**M, "remarks": "Loose chest"}}, owner)
detail = call("GET", f"/admin/customers/{cust.get('id')}", token=owner)[1]
latest = detail["family"][0]["latest"] if detail.get("family") else None
check("new customer: name, mobile and measurements saved together",
      s == 201 and latest and float(latest["chest_cm"]) == 110 and latest["remarks"] == "Loose chest", f"{s} {cust} {latest}")
s, r, _ = call("POST", "/admin/customers", {"name": "Half", "phone": f"56{run}", "measurements": {**M, "neck_cm": None}}, owner)
check("new customer: all seven measurements are needed", s == 400 and r.get("code") == "missing_field" and not sql(f"select 1 from customers where phone = '+97456{run}'"), r)

# ---- editing a measurement -----------------------------------------------------------------
mid = sql(f"select id from measurements where member_id = '{detail['family'][0]['id']}' order by taken_at desc limit 1")
s, r, _ = call("PATCH", f"/admin/measurements/{mid}", {**M, "sleeve_cm": 63.5, "remarks": "Corrected sleeve"}, owner)
after = call("GET", f"/admin/members/{detail['family'][0]['id']}/measurements", token=owner)[1]
check("measurements: a saved measurement can be corrected in place",
      s == 200 and len(after) == 1 and float(after[0]["sleeve_cm"]) == 63.5 and after[0]["remarks"] == "Corrected sleeve", f"{s} {r} {after}")
check("measurements: the correction is in the activity log", sql(f"select count(*) from audit_log where entity = 'measurement' and entity_id = '{mid}' and action = 'update'") == "1")

# ---- cloth by the metre --------------------------------------------------------------------
fab = next(f for f in call("GET", "/catalogue")[1]["fabrics"] if f["id"] == "japanese-cotton")
check("catalogue: cloth priced per metre, with a thobe at the usual length", fab["price_per_metre"] > 0 and abs(fab["price"] - round(fab["price_per_metre"] * fab["metres"], 2)) < 0.01, fab)
member = detail["family"][0]["id"]
line = {"kind": "thobe", "memberId": member, "collarId": "classic-qatari", "cuffId": "double", "fabricId": "japanese-cotton", "metres": 3.75, "qty": 2}
sale = {"branchId": b1, "customerId": cust["id"], "lines": [line]}
q = call("POST", "/admin/pos/quote", sale, owner)[1]
want = round(fab["price_per_metre"] * 3.75, 2)
check("counter: a thobe costs metres × price per metre", q["lines"][0]["unitPrice"] == want and q["total"] == round(want * 2, 2) and q["lines"][0]["thobe"]["metres"] == 3.75, q.get("lines"))
check("counter: the cuff is on the thobe, and there is no colour", q["lines"][0]["thobe"]["cuff"]["id"] == "double" and q["lines"][0]["thobe"].get("colour") is None)
bad = [call("POST", "/admin/pos/quote", {**sale, "lines": [{**line, "metres": m}]}, owner)[1].get("code") for m in (0.2, 25, "x")]
check("counter: lengths outside 0.5 to 20 m are refused", bad == ["invalid_metres"] * 3, bad)
s, r, _ = call("POST", "/admin/pos/quote", {**sale, "lines": [{**line, "collarId": None, "cuffId": None, "styleNotes": {"collar:classic-qatari": "Two buttons", "detail:pen": "Inside", "detail:pocket": "Left", "bogus": "x", "detail:pen2": ""}}]}, owner)
th = (r.get("lines") or [{}])[0].get("thobe") or {}
check("counter: nothing has to be chosen; remarks are kept against each option, with names", s == 200 and th.get("collar") is None and th.get("pocket") is True
      and th.get("style_notes") == {"collar:classic-qatari": "Two buttons", "detail:pen": "Inside", "detail:pocket": "Left"}
      and [x["id"] for x in th.get("style_remarks") or []] == ["classic-qatari", "pocket", "pen"], r)
items_ = call("GET", "/admin/pos/items", token=owner)[1]
check("counter: the details (chest pocket, pen and two more) come with their pictures", [d["id"] for d in items_.get("details", [])] == ["pocket", "pen", "placket", "yoke"] and all(d["image_url"] for d in items_["details"]), items_.get("details"))
s, r, _ = call("POST", "/admin/pos/quote", {**sale, "notes": "x" * 1500, "lines": [{**line, "remarks": "y" * 900}]}, owner)
check("counter: long notes are kept", s == 200, r)
s, sold, _ = call("POST", "/admin/pos/sales", {"sale": {**sale, "notes": "Long notes " * 50}, "payments": [{"method": "card", "amount": q["total"]}]}, owner)
check("orders: numbers are plain numbers (no AR-)", s == 201 and sold["number"].isdigit(), sold)
check("orders: notes keep their length", len(sql(f"select notes from orders where id = '{sold['orderId']}'")) >= 500)
found = call("GET", f"/admin/orders?q=AR-{sold['number']}", token=owner)[1]
check("orders: an old-style AR- number still finds the order", any(o["id"] == sold["orderId"] for o in found), len(found))
snap = sql(f"select snapshot->'thobe'->>'metres' || ':' || (snapshot->'thobe'->'cuff'->>'id') from order_items where order_id = '{sold['orderId']}'")
check("orders: metres and cuff kept on the order", snap == "3.75:double", snap)
s, r, _ = call("POST", f"/admin/customers/{cust['id']}/orders", {"memberId": member, "paidByCard": True, "lines": [{"collarId": "wide-collar", "cuffId": "single", "fabricId": "swiss-voile", "metres": 4, "qty": 1, "remarks": "Pocket on the left"}]}, owner)
sw = next(f for f in call("GET", "/catalogue")[1]["fabrics"] if f["id"] == "swiss-voile")
check("staff order at a visit: priced by the metre, with cuff and notes",
      s == 201 and r["total"] == round(sw["price_per_metre"] * 4, 2) and sql(f"select snapshot->>'remarks' from order_items where order_id = '{r['orderId']}'") == "Pocket on the left", r)

# ---- the shop's collar and cuff styles, and the pocket ---------------------------------------
items = call("GET", "/admin/pos/items", token=owner)[1]
check("styles: three collars and two cuffs, each with its picture",
      sorted(c["id"] for c in items["collars"]) == ["classic-qatari", "mandarin-band", "wide-collar"] and sorted(c["id"] for c in items["cuffs"]) == ["double", "single"]
      and all(c["image_url"] for c in items["collars"] + items["cuffs"]), [(c["id"], c["image_url"]) for c in items["collars"] + items["cuffs"]])
s_, r_, _ = call("POST", "/admin/pos/quote", {**sale, "lines": [{**line, "pocket": True}]}, owner)
check("pocket: a chest pocket is kept on the thobe and doesn't change the price", r_["lines"][0]["thobe"]["pocket"] is True and r_["total"] == q["total"], r_.get("lines"))
s_, r_, _ = call("POST", "/admin/pos/quote", {**sale, "lines": [{**line, "cuffId": "round"}]}, owner)
check("styles: a hidden cuff can't be sold", r_.get("code") == "invalid_thobe_options", r_)

# ---- app: re-order keeps the earlier length ------------------------------------------------
ctok = login(phone)
s, b, _ = call("POST", "/basket/items", {"kind": "thobe", "collarId": "classic-qatari", "cuffId": "double", "fabricId": "japanese-cotton", "metres": 3.75, "memberId": member, "measureMethod": "saved", "qty": 1}, ctok)
it = next((i for i in b.get("items", []) if i["kind"] == "thobe"), {})
check("app: a re-order is priced at the earlier order's length", s == 201 and it.get("unitPrice") == want and it["thobe"]["metres"] == 3.75, it)
s, b, _ = call("POST", "/basket/items", {"kind": "thobe", "collarId": "classic-qatari", "cuffId": "double", "fabricId": "japanese-cotton", "metres": 3.75, "pocket": True, "memberId": member, "measureMethod": "saved", "qty": 1}, ctok)
check("app: a re-order keeps the pocket", s == 201 and [i for i in b["items"] if i["kind"] == "thobe"][-1]["thobe"]["pocket"] is True)
s, b, _ = call("POST", "/basket/items", {"kind": "thobe", "collarId": "classic-qatari", "fabricId": "japanese-cotton", "memberId": member, "measureMethod": "saved", "qty": 1}, ctok)
it = [i for i in b.get("items", []) if i["kind"] == "thobe"][-1]
check("app: without a length, the cloth's usual length", s == 201 and it["unitPrice"] == fab["price"] and it["thobe"]["metres"] == fab["metres"], it)
for i in b["items"]:
    call("DELETE", f"/basket/items/{i['id']}", token=ctok)

# ---- home visits: three windows ------------------------------------------------------------
slots = call("GET", "/slots?kind=home&days=7", token=ctok)[1]
day = next(d for d in slots["days"] if all(t["available"] for t in d["times"]) or d is slots["days"][-1])
check("home visits: three windows a day, 9-1, 4-7 and 7-10",
      [(t["minute"], t["endMinute"]) for t in day["times"]] == [(540, 780), (960, 1140), (1140, 1320)], day["times"])
s, r, _ = call("PATCH", "/admin/settings", {"home_visit": {"windows": [{"start": 540, "end": 780}, {"start": 700, "end": 900}]}}, owner)
check("home visits: windows can't overlap", r.get("code") == "windows_overlap", r)
off_grid = slots["days"][-1]["times"][0]["startsAt"].replace(":00:00", ":30:00")
s, r, _ = call("POST", "/appointments", {"kind": "home", "addressId": None, "memberId": member, "startsAt": off_grid}, ctok)
check("home visits: only a window's start can be booked", r.get("code") in ("slot_invalid", "missing_field"), r)

# ---- reminders and staff alerts ------------------------------------------------------------
tomorrow = sql("select ((now() at time zone 'Asia/Qatar')::date + 1)::text")
oid = sold["orderId"]
sql(f"update orders set expected_delivery = '{tomorrow}' where id = '{oid}'")
alerts = call("GET", "/admin/alerts", token=owner)[1]
check("alerts: thobes due tomorrow that are not ready yet", any(o["id"] == oid for o in alerts["dueTomorrow"]), alerts.get("dueTomorrow"))
for st in ["cutting", "stitching", "quality"]:
    call("POST", f"/admin/orders/{oid}/stage", {"stage": st}, owner)
time.sleep(7)
n = [x for x in call("GET", "/notifications", token=ctok)[1] if x["title_en"] == "Pickup tomorrow"]
check("reminders: the customer is told the day before pickup", len(n) == 1 and sold["number"] in n[0]["body_en"], n)
call("POST", f"/admin/orders/{oid}/stage", {"stage": "ready"}, owner)
sql(f"update order_events set at = now() - interval '4 days' where order_id = '{oid}' and stage = 'ready'")
alerts = call("GET", "/admin/alerts", token=owner)[1]
check("alerts: thobes waiting to be collected", any(o["id"] == oid for o in alerts["waiting"]) and alerts["count"] >= 1, alerts.get("waiting"))
time.sleep(7)
n = [x for x in call("GET", "/notifications", token=ctok)[1] if x["title_en"] == "Your thobes are waiting for you"]
check("reminders: one nudge when thobes wait more than 3 days", len(n) == 1, n)
time.sleep(6)
n = [x for x in call("GET", "/notifications", token=ctok)[1] if x["title_en"] in ("Your thobes are waiting for you", "Pickup tomorrow")]
check("reminders: each is sent once", len(n) == 2, [x["title_en"] for x in n])

# ---- the board: oldest first, recently done kept ---------------------------------------------
board = call("GET", "/admin/orders?board=1", token=owner)[1]
open_ = [o for o in board if o["stage"] not in ("delivered", "cancelled")]
check("board: open orders oldest first", [o["created_at"] for o in open_] == sorted(o["created_at"] for o in open_))
call("POST", f"/admin/orders/{oid}/stage", {"stage": "delivered"}, owner)
board = call("GET", "/admin/orders?board=1", token=owner)[1]
done = next((o for o in board if o["id"] == oid), None)
check("board: a finished order stays on the board as done", done and done["stage"] == "delivered" and done["done_at"], done)

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall counter checks passed")
