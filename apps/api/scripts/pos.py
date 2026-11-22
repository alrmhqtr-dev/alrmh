"""Checks for the point of sale (the Mada POS replacement).

Same setup as regress.py: a live API with SEED_DEMO=true, OTP_MODE=preview,
PAYMENT_MODE=mock, RATE_LIMITS=off, and psql with DATABASE_URL.

    API=http://localhost:4000 python3 apps/api/scripts/pos.py
"""
import os, sys, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from regress_lib import call, check, failures, login, sql, staff  # noqa: E402

owner = staff()
run = str(int(time.time()))[-6:]
branches = call("GET", "/admin/branches", token=owner)[1]
b1 = branches[0]["id"]
# A second branch for transfers.
b2 = call("POST", "/admin/branches", {"name_en": f"Lusail {run}", "name_ar": "لوسيل", "address_en": "Lusail", "address_ar": "لوسيل", "phone": "44440001", "hours_en": "9-9", "hours_ar": "9-9"}, owner)[1]["id"]

# ---- roles and permissions -------------------------------------------------------------
roles = {r["id"]: r for r in call("GET", "/admin/roles", token=owner)[1]}
check("roles: built-in roles include cashier with counter permissions", "cashier" in roles and set(roles["cashier"]["permissions"]) == {"pos", "contacts", "expenses"})
s, r, _ = call("PATCH", "/admin/roles/owner", {"permissions": []}, owner)
check("roles: the owner role keeps every permission", s == 400 and r.get("code") == "owner_role_fixed", r)
s, custom, _ = call("POST", "/admin/roles", {"name_en": f"Stock keeper {run}", "name_ar": "أمين مخزن", "permissions": ["products", "nonsense"]}, owner)
check("roles: custom roles keep only known permissions", s == 201 and call("GET", "/admin/roles", token=owner)[1][-1]["permissions"] == ["products"], custom)
pw = "cashier-pass-2026"
call("POST", "/admin/staff", {"email": f"cashier{run}@alrmh.qa", "name": "Cashier One", "role": "cashier", "password": pw, "branchId": b1}, owner)
call("POST", "/admin/staff", {"email": f"keeper{run}@alrmh.qa", "name": "Keeper", "role": custom["id"], "password": pw, "branchId": b1}, owner)
cashier = staff(f"cashier{run}@alrmh.qa", pw)
keeper = staff(f"keeper{run}@alrmh.qa", pw)
me = call("GET", "/admin/me", token=cashier)[1]
check("roles: sign-in returns permissions and language", me["permissions"] == ["pos", "contacts", "expenses"] and me["language"] == "ar", me)
s1, bad, _ = call("POST", "/admin/me/profile", {"name": " "}, cashier)
s2, ok, _ = call("POST", "/admin/me/profile", {"name": "  Amin   Al-Kashir "}, cashier)
check("account: staff set their own name (tidied); a blank name is refused", s1 == 400 and bad.get("code") == "invalid_name" and s2 == 200 and call("GET", "/admin/me", token=cashier)[1]["name"] == "Amin Al-Kashir", (bad, ok))
s, _, _ = call("PATCH", "/admin/products/white-ghutra", {"price": 1}, cashier)
check("roles: a cashier can't change product prices", s == 403)
s, r, _ = call("POST", "/admin/roles/cashier/delete", {}, owner)
check("roles: built-in roles can't be deleted", s == 400 and r.get("code") == "role_builtin", r)

# ---- products with stock ---------------------------------------------------------------
sku = f"OUD-{run}"
s, p, _ = call("POST", "/admin/products", {"category": "fragrance", "name_en": f"Oud test {run}", "name_ar": "عود", "price": 100, "cost": 40, "sku": sku, "track_stock": True, "alert_qty": 2}, keeper)
check("products: a stock keeper adds a tracked product with code and cost", s == 201, p)
pid = p["id"]
s, r, _ = call("POST", "/admin/products", {"category": "fragrance", "name_en": "Dup", "name_ar": "د", "price": 5, "sku": sku.lower()}, owner)
check("products: product codes are unique (any case)", s == 400 and r.get("code") == "sku_taken", r)
call("POST", "/admin/stock/adjustments", {"branchId": b1, "reason": "count", "lines": [{"kind": "product", "id": pid, "qty": 5}]}, keeper)
level = lambda b=b1, i=pid, k="product", size="": float(sql(f"select coalesce(sum(qty),0) from stock_moves where item_kind='{k}' and item_id='{i}' and branch_id='{b}' and size='{size}'"))
check("stock: an adjustment adds to the branch", level() == 5)
fab = call("GET", "/admin/catalogue", token=owner)[1]["fabrics"][0]
call("PATCH", f"/admin/fabrics/{fab['id']}", {"track_stock": True, "metres_per_thobe": 3.5, "cost": 20}, owner)
call("POST", "/admin/stock/adjustments", {"branchId": b1, "lines": [{"kind": "fabric", "id": fab["id"], "qty": 20}]}, owner)

# ---- cash register ----------------------------------------------------------------------
sale = {"branchId": b1, "lines": [{"kind": "product", "productId": pid, "qty": 2}]}
s, r, _ = call("POST", "/admin/pos/sales", {"sale": sale, "payments": [{"method": "cash", "amount": 200}]}, cashier)
check("register: no selling until the register is open", s == 400 and r.get("code") == "register_closed", r)
s, reg, _ = call("POST", "/admin/pos/register/open", {"branchId": b1, "openingCash": 500}, cashier)
check("register: opens with the cash in the drawer", s == 201 and float(reg["opening_cash"]) == 500, reg)
s, r, _ = call("POST", "/admin/pos/register/open", {"branchId": b1, "openingCash": 0}, cashier)
check("register: one open register per person", s == 400 and r.get("code") == "register_already_open")

# ---- walk-in sale --------------------------------------------------------------------------
s, r, _ = call("POST", "/admin/pos/sales", {"sale": sale, "payments": [{"method": "cash", "amount": 150}]}, cashier)
check("walk-in: must pay in full", s == 400 and r.get("code") == "payment_short", r)
s, w, _ = call("POST", "/admin/pos/sales", {"sale": {**sale, "walkInName": "Visitor"}, "payments": [{"method": "card", "amount": 50}, {"method": "cash", "amount": 200}]}, cashier)
check("walk-in: card + cash, change given from cash", s == 201 and w["total"] == 200 and w["change"] == 50 and w["balance"] == 0, w)
check("walk-in: tracked stock goes down", level() == 3)
pays = sql(f"select string_agg(provider || ':' || amount::int, ',' order by provider) from payments where order_id = '{w['orderId']}'")
check("walk-in: payments stored per method, change taken off the cash", pays == "card_machine:50,cash:150", pays)
check("walk-in: handed over at the counter", sql(f"select stage from orders where id = '{w['orderId']}'") == "delivered")
s, r, _ = call("POST", "/admin/pos/sales", {"sale": {**sale, "lines": [{"kind": "product", "productId": pid, "qty": 4}]}, "payments": [{"method": "cash", "amount": 400}]}, cashier)
check("stock: can't sell more than is on the shelf", s == 400 and r.get("code") == "out_of_stock" and r.get("available") == 3, r)
s, r, _ = call("POST", "/admin/pos/sales", {"sale": {**sale, "lines": [{"kind": "product", "productId": pid, "qty": 1, "price": 1}]}, "payments": [{"method": "cash", "amount": 1}]}, cashier)
check("discounts: a cashier can't change a price", s == 400 and r.get("code") == "forbidden_discount", r)
s, r, _ = call("GET", f"/receipts/{w['receiptToken']}")
check("receipt: opens from its link without signing in", s == 200)
s, _, _ = call("GET", "/receipts/" + "0" * 32)
check("receipt: an unknown link shows nothing", s == 404)

# ---- customer at the counter: thobes with a deposit ---------------------------------------
phone = f"5{run[-7:].rjust(7, '1')}"
s, cust, _ = call("POST", "/admin/customers", {"name": "Counter Customer", "phone": phone}, cashier)
check("customers: added at the counter by mobile", s == 201 and not cust["existing"], cust)
s, again, _ = call("POST", "/admin/customers", {"name": "Someone else", "phone": phone}, cashier)
check("customers: the same mobile finds the same customer", again["id"] == cust["id"] and again["existing"])
detail = call("GET", f"/admin/customers/{cust['id']}", token=owner)[1]
member = detail["family"][0]["id"]
call("POST", f"/admin/members/{member}/measurements", {"tailorName": "Yousef", "length_cm": 150, "shoulder_cm": 46, "chest_cm": 110, "waist_cm": 100, "sleeve_cm": 61, "neck_cm": 40, "cuff_cm": 24}, owner)
collar = call("GET", "/admin/catalogue", token=owner)[1]["collars"][0]["id"]
thobe = {"branchId": b1, "customerId": cust["id"], "lines": [{"kind": "thobe", "memberId": member, "collarId": collar, "cuffId": "single", "fabricId": fab["id"], "metres": 3.25, "qty": 2}]}
q = call("POST", "/admin/pos/quote", thobe, cashier)[1]
cloth0 = level(k="fabric", i=fab["id"])
s, t, _ = call("POST", "/admin/pos/sales", {"sale": thobe, "payments": [{"method": "cash", "amount": 100}]}, cashier)
check("deposit: a customer can pay part now", s == 201 and t["paid"] == 100 and t["balance"] == round(q["total"] - 100, 2), t)
check("deposit: cloth taken from stock by the metres chosen (3.25 m a thobe)", level(k="fabric", i=fab["id"]) == cloth0 - 6.5)
check("deposit: thobes start at Taking measurements", sql(f"select stage from orders where id = '{t['orderId']}'") == "measured")
for st in ["cutting", "stitching", "quality", "ready"]:
    call("POST", f"/admin/orders/{t['orderId']}/stage", {"stage": st}, owner)
s, r, _ = call("POST", f"/admin/orders/{t['orderId']}/stage", {"stage": "delivered"}, owner)
check("deposit: can't hand over until the balance is paid", s == 400 and r.get("code") == "balance_due", r)
s, r, _ = call("POST", f"/admin/orders/{t['orderId']}/payments", {"method": "card", "amount": t["balance"] + 1}, cashier)
check("deposit: can't take more than is due", s == 400 and r.get("code") == "more_than_due", r)
s, r, _ = call("POST", f"/admin/orders/{t['orderId']}/payments", {"method": "card", "amount": t["balance"]}, cashier)
check("deposit: balance paid at pickup", s == 201 and r["balance"] == 0, r)
s, _, _ = call("POST", f"/admin/orders/{t['orderId']}/stage", {"stage": "delivered"}, owner)
pts = int(sql(f"select coalesce(sum(points),0) from points_ledger where customer_id = '{cust['id']}'"))
check("deposit: collected, points earned", s == 201 and pts == q["pointsToEarn"] and pts > 0, pts)
ctok = login(phone)
app_order = call("GET", f"/orders/{t['orderId']}", token=ctok)[1]
check("app: the customer sees the counter order, paid in full", app_order["number"] == t["number"] and app_order["balance"] == 0 and app_order["paid"] == q["total"], app_order.get("balance"))

# ---- points, groups and automatic discounts -----------------------------------------------
s, r, _ = call("POST", "/admin/pos/sales", {"sale": {**sale, "lines": [{"kind": "product", "productId": pid, "qty": 1}], "customerId": cust["id"], "points": pts}, "payments": [{"method": "cash", "amount": 100 - pts}]}, cashier)
check("points: spent at the counter, 1 point = QAR 1", s == 201 and r["total"] == 100 - pts and int(sql(f"select coalesce(sum(points),0) from points_ledger where customer_id = '{cust['id']}'")) == 10, r)
g = call("POST", "/admin/lists/customer-groups", {"name_en": f"VIP {run}", "name_ar": "كبار", "discount_percent": 10}, owner)[1]
call("PATCH", f"/admin/customers/{cust['id']}", {"groupId": g["id"]}, owner)
q2 = call("POST", "/admin/pos/quote", {**sale, "customerId": cust["id"], "lines": [{"kind": "product", "productId": pid, "qty": 1}]}, cashier)[1]
check("groups: the group's discount applies", q2["total"] == 90 and q2["lines"][0]["discountLabel"] == "group", q2.get("total"))
d = call("POST", "/admin/lists/discounts", {"name": f"Fragrance week {run}", "applies_to": "category", "target_ids": ["fragrance"], "kind": "percent", "amount": 25, "channel": "all"}, owner)[1]
q3 = call("POST", "/admin/pos/quote", {**sale, "customerId": cust["id"], "lines": [{"kind": "product", "productId": pid, "qty": 1}]}, cashier)[1]
check("discounts: the bigger of the rule and the group wins (no stacking)", q3["total"] == 75, q3.get("total"))
call("PATCH", f"/admin/products/{pid}", {"in_app": True}, owner)
shop = {p_["id"]: p_ for p_ in call("GET", "/catalogue")[1]["products"]}
check("app: shows the same sale price", shop[pid]["sale_price"] == 75, shop.get(pid))
call("POST", f"/admin/lists/discounts/{d['id']}/delete", {}, owner)
call("PATCH", f"/admin/products/{pid}", {"in_app": False}, owner)
check("app: counter-only products are hidden", pid not in {p_["id"] for p_ in call("GET", "/catalogue")[1]["products"]})
s, r, _ = call("POST", "/admin/lists/discounts", {"name": "x", "applies_to": "all", "kind": "percent", "amount": 150}, owner)
check("discounts: a percentage can't be over 100", s == 400, r)

# ---- app shop stock -----------------------------------------------------------------------
call("PATCH", "/admin/products/cufflinks", {"track_stock": True}, owner)
s, r, _ = call("POST", "/basket/items", {"kind": "product", "productId": "cufflinks"}, ctok)
check("app: an out-of-stock product can't be added", s == 400 and r.get("code") == "out_of_stock", r)
online = call("GET", "/admin/business", token=owner)[1]["pos"]["online_branch_id"] or b1
call("POST", "/admin/stock/adjustments", {"branchId": online, "lines": [{"kind": "product", "id": "cufflinks", "qty": 1}]}, owner)
s, _, _ = call("POST", "/basket/items", {"kind": "product", "productId": "cufflinks"}, ctok)
addr = call("POST", "/addresses", {"label": "Home", "line1": "Villa 2", "area": "Al Waab"}, ctok)[1]
o = call("POST", "/orders", {"returnUrl": "http://localhost:8081", "addressId": addr["id"]}, ctok)[1]
call("POST", f"/pay/mock/{o['paymentId']}?return=http%3A%2F%2Flocalhost%3A8081", form="result=paid")
check("app: a paid app order takes its items from the online branch", s == 201 and level(b=online, i="cufflinks") == 0)
call("PATCH", "/admin/products/cufflinks", {"track_stock": False}, owner)

# ---- shipments ------------------------------------------------------------------------------
ships = call("GET", "/admin/shipments?status=open", token=owner)[1]
check("shipments: app delivery orders are listed", any(x["id"] == o["orderId"] for x in ships))
s, _, _ = call("PATCH", f"/admin/orders/{o['orderId']}/shipping", {"courier": "Snoonu", "tracking": "SN-1"}, cashier)
check("shipments: courier and tracking saved", s == 200 and sql(f"select shipping->>'courier' from orders where id = '{o['orderId']}'") == "Snoonu")

# ---- drafts and quotations ------------------------------------------------------------------
s, qt, _ = call("POST", "/admin/drafts", {"kind": "quotation", "sale": {**sale, "lines": [{"kind": "product", "productId": pid, "qty": 1}], "walkInName": "Quote Person"}, "validUntil": "2099-01-01"}, cashier)
check("quotations: saved with a QT number", s == 201 and qt["number"].startswith("QT-"), qt)
dd = call("GET", f"/admin/drafts/{qt['id']}", token=cashier)[1]
s, conv, _ = call("POST", "/admin/pos/sales", {"sale": dd["cart"], "payments": [{"method": "cash", "amount": 100}], "draftId": qt["id"]}, cashier)
check("quotations: turned into a sale", s == 201 and sql(f"select converted_order_id from pos_drafts where id = '{qt['id']}'") == conv["orderId"])
s, _, _ = call("POST", f"/admin/drafts/{qt['id']}/delete", {}, cashier)
check("quotations: a converted one can't be deleted", s == 400)

# ---- returns ----------------------------------------------------------------------------------
before = level()
item = call("GET", f"/admin/orders/{w['orderId']}", token=owner)[1]["items"][0]
s, r, _ = call("POST", f"/admin/orders/{w['orderId']}/returns", {"lines": [{"itemId": item["id"], "qty": 1}], "method": "cash"}, cashier)
check("returns: a cashier can't take returns", s == 403)
mgr_pw = "manager-pass-2026"
call("POST", "/admin/staff", {"email": f"mgr{run}@alrmh.qa", "name": "Manager", "role": "manager", "password": mgr_pw, "branchId": b1}, owner)
mgr = staff(f"mgr{run}@alrmh.qa", mgr_pw)
call("POST", "/admin/pos/register/open", {"branchId": b1, "openingCash": 100}, mgr)
s, r, _ = call("POST", f"/admin/orders/{w['orderId']}/returns", {"lines": [{"itemId": item["id"], "qty": 1}], "method": "cash", "restock": True}, mgr)
check("returns: refund for one of two and back on the shelf", s == 201 and r["amount"] == 100 and level() == before + 1, r)
s, r, _ = call("POST", f"/admin/orders/{w['orderId']}/returns", {"lines": [{"itemId": item["id"], "qty": 2}], "method": "cash"}, mgr)
check("returns: can't return more than was bought", s == 400 and r.get("code") == "invalid_return_qty", r)

# ---- cancelling a thobe order puts the cloth back ---------------------------------------------
s, t2, _ = call("POST", "/admin/pos/sales", {"sale": thobe, "payments": [{"method": "cash", "amount": 50}]}, cashier)
cloth = level(k="fabric", i=fab["id"])
call("POST", f"/admin/orders/{t2['orderId']}/cancel", {"reason": "changed mind"}, mgr)
check("cancel: cloth goes back to stock", level(k="fabric", i=fab["id"]) == cloth + 6.5)
s, r, _ = call("POST", f"/admin/orders/{t2['orderId']}/refunds", {"amount": 50, "method": "cash"}, mgr)
check("cancel: deposit refunded in cash from the register", s == 201 and r["left"] == 0, r)

# ---- purchases ----------------------------------------------------------------------------------
sup = call("POST", "/admin/lists/suppliers", {"name": f"Perfume Co {run}", "phone": "44441111"}, owner)[1]
s, po, _ = call("POST", "/admin/purchases", {"supplierId": sup["id"], "branchId": b1, "lines": [{"kind": "product", "id": pid, "qty": 10, "unitCost": 45}], "shipping": 10, "payment": {"amount": 100, "method": "bank_transfer"}}, owner)
check("purchases: received goods go into stock", s == 201 and po["total"] == 460 and level() == before + 11, po)
check("purchases: the item's cost becomes the last price paid", float(sql(f"select cost from products where id = '{pid}'")) == 45)
s, po2, _ = call("POST", "/admin/purchases", {"supplierId": sup["id"], "branchId": b1, "status": "ordered", "lines": [{"kind": "fabric", "id": fab["id"], "qty": 30, "unitCost": 18}]}, owner)
cloth = level(k="fabric", i=fab["id"])
check("purchases: an order placed isn't in stock yet", s == 201 and level(k="fabric", i=fab["id"]) == cloth)
call("POST", f"/admin/purchases/{po2['id']}/receive", {}, owner)
check("purchases: received later", level(k="fabric", i=fab["id"]) == cloth + 30)
line = call("GET", f"/admin/purchases/{po['id']}", token=owner)[1]["lines"][0]
s, pr, _ = call("POST", f"/admin/purchases/{po['id']}/return", {"lines": [{"lineId": line["id"], "qty": 2}]}, owner)
check("purchases: returned goods leave stock", s == 201 and pr["total"] == 90 and level() == before + 9, pr)
call("POST", "/admin/supplier-payments", {"supplierId": sup["id"], "amount": 200, "method": "cash"}, owner)
bal = call("GET", f"/admin/suppliers/{sup['id']}", token=owner)[1]["totals"]["balance"]
check("purchases: supplier balance = bought - returned - paid", bal == round(460 + 540 - 90 - 100 - 200, 2), bal)
s, r, _ = call("POST", f"/admin/lists/suppliers/{sup['id']}/delete", {}, owner)
check("lists: a supplier with purchases can't be deleted", s == 400 and r.get("code") == "in_use", r)

# ---- transfers ------------------------------------------------------------------------------------
s, tr, _ = call("POST", "/admin/stock/transfers", {"fromBranchId": b1, "toBranchId": b2, "lines": [{"kind": "product", "id": pid, "qty": 3}]}, keeper)
check("transfers: stock moves between branches", s == 201 and level() == before + 6 and level(b=b2) == 3, tr)
s, r, _ = call("POST", "/admin/stock/transfers", {"fromBranchId": b2, "toBranchId": b1, "lines": [{"kind": "product", "id": pid, "qty": 4}]}, keeper)
check("transfers: can't send more than the branch has", s == 400 and r.get("code") == "out_of_stock", r)

# ---- expenses and closing the register -----------------------------------------------------------
cat = call("GET", "/admin/lists/expense-categories", token=owner)[1][0]["id"]
s, ex, _ = call("POST", "/admin/expenses", {"branchId": b1, "categoryId": cat, "amount": 30, "method": "cash", "note": "tea"}, cashier)
check("expenses: recorded by a cashier", s == 201 and ex["number"].startswith("EX-"))
reg = call("GET", "/admin/pos/register", token=cashier)[1]
tt = reg["totals"]
expected = 500 + tt["cash_sales"] - 30
check("register: expected cash = opening + cash sales - cash out", tt["expected_cash"] == round(expected, 2), tt)
s, closed, _ = call("POST", "/admin/pos/register/close", {"countedCash": tt["expected_cash"] - 5}, cashier)
check("register: closing shows the difference", s == 200 and closed["difference"] == -5, closed)

# ---- reports ---------------------------------------------------------------------------------------
names = call("GET", "/admin/reports", token=owner)[1]
bad = [n for n in names if call("GET", f"/admin/reports/{n}", token=owner)[0] != 200]
check("reports: every report runs", not bad, bad)
pl = {r_["key"]: r_["value"] for r_ in call("GET", "/admin/reports/profit-loss", token=owner)[1]["rows"]}
check("reports: profit = net sales + fees - returns - cost - expenses", round(pl["net"] + pl["fees"] + pl["returns"] + pl["cogs"] + pl["expenses"], 2) == pl["net_profit"], pl)
s, _, _ = call("GET", "/admin/reports/profit-loss", token=cashier)
check("reports: need the reports permission", s == 403)
req = urllib.request.Request(os.environ.get("API", "http://localhost:4000") + "/v1/admin/reports/sales-daily?format=csv&lang=ar", headers={"Authorization": "Bearer " + owner})
with urllib.request.urlopen(req) as resp:
    csv = resp.read().decode("utf-8")
check("reports: CSV in Arabic", csv.startswith("﻿التاريخ") and "الإجمالي" in csv, csv[:60])
dash = call("GET", "/admin/dashboard", token=cashier)[1]
check("dashboard: today's sales and the 30-day series", dash["today"]["count"] >= 4 and len(dash["series"]["rows"]) >= 1, dash["today"])

# ---- imports ----------------------------------------------------------------------------------------
s, r, _ = call("POST", "/admin/import/customers", {"csv": f"name,mobile\nImported One,6{run[-6:]}1\nBad,123\n"}, owner)
check("imports: customers, bad mobiles reported", s == 200 and r["added"] == 1 and r["errorCount"] == 1, r)
s, r, _ = call("POST", "/admin/import/products", {"csv": f"sku,name_en,name_ar,category,price,cost,brand\nIMP-{run},Imported pen,قلم,Accessories,25,10,Montblanc\n"}, owner)
check("imports: products with brand", s == 200 and r["added"] == 1, r)
s, r, _ = call("POST", "/admin/import/opening-stock", {"csv": f"sku,qty,unit_cost\nIMP-{run},12,9\nNOPE,1,1\n", "branchId": b1}, owner)
check("imports: opening stock, unknown codes reported", s == 200 and r["added"] == 1 and r["errorCount"] == 1, r)
s, r, _ = call("POST", "/admin/import/sales", {"csv": f"invoice,date,customer,total,paid,method\n{run}1,2026-10-01,Old Customer,300,300,cash\n{run}1,2026-10-01,Old Customer,300,300,cash\n"}, owner)
check("imports: past Mada sales, duplicates skipped", s == 200 and r["added"] == 1 and r["skipped"] == 1, r)

# ---- business settings --------------------------------------------------------------------------------
s, r, _ = call("PATCH", "/admin/business", {"printing": {"receipt_paper": "a3"}}, owner)
check("settings: paper sizes are checked", s == 400, r)
s, r, _ = call("PATCH", "/admin/business", {"company": {"name_en": "AlRmh Tailoring", "tax_number": "123"}}, owner)
check("settings: company details saved", s == 200 and r["company"]["name_en"] == "AlRmh Tailoring" and r["company"]["name_ar"] == "الرمح", r.get("company"))

print()
if failures:
    print(f"{len(failures)} check(s) failed:")
    for f in failures:
        print("  " + f)
    sys.exit(1)
print("all POS checks passed")
