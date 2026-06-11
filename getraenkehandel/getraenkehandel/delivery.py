import frappe
from frappe import _


@frappe.whitelist()
def get_todays_route(driver=None):
    """Return Delivery Trips for the driver: past 30 days + next 7 days.

    If `driver` is not supplied, auto-detect from the logged-in user's Driver record.
    Dispatchers/admins not linked to a Driver record see all trips.
    """
    from frappe.utils import today, add_days

    frappe.flags.ignore_permissions = True

    # Auto-detect driver from session user when not explicitly provided
    if not driver:
        driver = frappe.db.get_value("Driver", {"custom_user": frappe.session.user}, "name")

    date_from = add_days(today(), -30)
    date_to   = add_days(today(),   8)   # today + 7 inclusive

    filters = [
        ["docstatus", "=", 1],
        ["departure_time", ">=", f"{date_from} 00:00:00"],
        ["departure_time", "<",  f"{date_to} 00:00:00"],
    ]
    if driver:
        filters.append(["driver", "=", driver])

    trips = frappe.get_all(
        "Delivery Trip",
        filters=filters,
        fields=[
            "name", "driver", "driver_name", "status",
            "custom_route_name", "custom_route_day", "departure_time",
            "custom_route_polyline",
        ],
        order_by="departure_time asc",
    )

    for trip in trips:
        stops = frappe.get_all(
            "Delivery Stop",
            filters={"parent": trip["name"]},
            fields=[
                "name", "customer", "customer_address", "address",
                "delivery_note", "estimated_arrival", "visited",
                "grand_total", "custom_cash_collected", "custom_driver_notes",
                "lat", "lng",
            ],
            order_by="idx asc",
        )

        # Overwrite grand_total with the Delivery Note's actual grand_total (incl. tax).
        # Delivery Stop.grand_total is fetched from net_total (excl. tax) in ERPNext.
        dn_names = list({s["delivery_note"] for s in stops if s.get("delivery_note")})
        if dn_names:
            dn_rows = frappe.db.get_all(
                "Delivery Note",
                filters={"name": ["in", dn_names]},
                fields=["name", "grand_total"],
            )
            dn_map = {d["name"]: d["grand_total"] for d in dn_rows}
            for s in stops:
                dn = s.get("delivery_note")
                if dn and dn in dn_map:
                    s["grand_total"] = dn_map[dn]

        # Enrich stops that have no lat/lng with coordinates from the Address record
        missing = [s for s in stops if not (s.get("lat") and s.get("lng")) and s.get("address")]
        if missing:
            addr_names = list({s["address"] for s in missing})
            coords = frappe.db.get_all(
                "Address",
                filters={"name": ["in", addr_names]},
                fields=["name", "custom_latitude", "custom_longitude"],
            )
            coord_map = {c["name"]: c for c in coords}
            for s in missing:
                c = coord_map.get(s["address"] or "")
                if c:
                    s["lat"] = c.get("custom_latitude") or 0
                    s["lng"] = c.get("custom_longitude") or 0

        trip["stops"] = stops

    return trips


@frappe.whitelist()
def complete_delivery_stop(trip, stop, empties, cash_collected=0, driver_notes=""):
    """Called by the driver app when a delivery stop is completed.

    - Marks the stop as visited and saves cash / notes.
    - Creates a Pfand credit note for any returned empties.
    - empties: JSON list of {item_code, qty}  (item_code = the beverage article)
    """
    import json

    if isinstance(empties, str):
        empties = json.loads(empties)

    # This endpoint is called by authenticated drivers only (@frappe.whitelist).
    # Bypass doctype-level permission checks so drivers can update child rows
    # and create credit notes / payment entries without needing those roles.
    frappe.flags.ignore_permissions = True

    # Read trip and stop via direct DB queries
    trip_data = frappe.db.get_value(
        "Delivery Trip", trip, ["company", "driver", "docstatus"], as_dict=True
    )
    if not trip_data:
        frappe.throw(_("Tour {0} nicht gefunden.").format(trip))

    stop_data = frappe.db.get_value(
        "Delivery Stop", stop,
        ["visited", "customer", "delivery_note", "parent"],
        as_dict=True,
    )
    if not stop_data:
        frappe.throw(_("Lieferstopp {0} nicht gefunden.").format(stop))
    if stop_data.parent != trip:
        frappe.throw(_("Stopp gehört nicht zu dieser Tour."))
    if stop_data.visited:
        frappe.throw(_("Dieser Stopp wurde bereits abgeschlossen."))

    # 1. Mark stop done — raw SQL avoids UpdateAfterSubmit and permission checks
    frappe.db.sql(
        """UPDATE `tabDelivery Stop`
           SET visited = 1,
               custom_cash_collected = %s,
               custom_driver_notes   = %s,
               modified              = NOW(),
               modified_by           = %s
           WHERE name = %s""",
        (float(cash_collected or 0), driver_notes or "", frappe.session.user, stop),
    )
    frappe.db.commit()

    # 2. Create Pfand credit note — non-fatal: log and continue if it fails
    credit_note_name = None
    if empties:
        pfand_lines = _aggregate_pfand_lines(empties)
        if pfand_lines:
            try:
                credit_note = _create_pfand_credit_note(
                    customer=stop_data.customer,
                    company=trip_data.company,
                    pfand_lines=pfand_lines,
                    reference=f"Tour {trip} / Stop {stop_data.customer or stop}"
                    + (f" / {stop_data.delivery_note}" if stop_data.delivery_note else ""),
                )
                credit_note_name = credit_note.name
            except Exception:
                frappe.log_error(frappe.get_traceback(), "Getraenkehandel: Pfand Gutschrift fehlgeschlagen")

    # 3. Create Payment Entry — non-fatal: log and continue if it fails
    payment_name = None
    cash_amount = float(cash_collected or 0)
    if cash_amount > 0 and trip_data.driver:
        try:
            payment_name = _create_cash_payment(
                customer=stop_data.customer,
                company=trip_data.company,
                amount=cash_amount,
                driver=trip_data.driver,
                reference=f"Barzahlung — Tour {trip} / {stop_data.customer or stop}",
            )
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Getraenkehandel: Barzahlung fehlgeschlagen")

    return {
        "status": "ok",
        "stop": stop,
        "credit_note": credit_note_name,
        "payment_entry": payment_name,
    }


@frappe.whitelist()
def get_driver_cash_balance(driver, company=None):
    """Return the current GL balance of the driver's Fahrerkasse account.

    Balance = sum(debit) - sum(credit) on the account — i.e. cash still
    in the driver's hand that has not yet been handed over.
    """
    from frappe.utils import flt

    frappe.flags.ignore_permissions = True

    account = frappe.db.get_value("Driver", driver, "custom_cash_account")
    if not account:
        return 0.0

    if not company:
        company = frappe.db.get_single_value("Global Defaults", "default_company")

    result = frappe.db.sql(
        """
        SELECT
            COALESCE(SUM(debit_in_account_currency),  0) -
            COALESCE(SUM(credit_in_account_currency), 0) AS balance
        FROM `tabGL Entry`
        WHERE account     = %s
          AND company     = %s
          AND is_cancelled = 0
        """,
        (account, company),
        as_dict=True,
    )
    return flt(result[0].balance) if result else 0.0


@frappe.whitelist()
def handover_driver_cash(driver, amount, company=None, date=None):
    """Transfer collected cash from Fahrerkasse to main Kasse (1000).
    Called by dispatcher when driver hands in cash at end of route.
    """
    from frappe.utils import today as frappe_today, flt

    frappe.flags.ignore_permissions = True
    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Betrag muss größer als 0 sein."))

    if not company:
        company = frappe.db.get_single_value("Global Defaults", "default_company")

    driver_cash_account = frappe.db.get_value("Driver", driver, "custom_cash_account")
    if not driver_cash_account:
        frappe.throw(_("Fahrer {0} hat kein Fahrerkasse-Konto.").format(driver))

    main_cash = frappe.db.get_value(
        "Account", {"account_number": "1000", "company": company}, "name"
    )
    if not main_cash:
        frappe.throw(_("Hauptkasse (Konto 1000) nicht gefunden."))

    driver_display = frappe.db.get_value("Driver", driver, "full_name") or driver

    je = frappe.get_doc({
        "doctype": "Journal Entry",
        "voucher_type": "Cash Entry",
        "posting_date": date or frappe_today(),
        "company": company,
        "user_remark": _("Kassenabrechnung Fahrer {0}").format(driver_display),
        "accounts": [
            {
                "account": main_cash,
                "debit_in_account_currency": amount,
                "credit_in_account_currency": 0,
            },
            {
                "account": driver_cash_account,
                "debit_in_account_currency": 0,
                "credit_in_account_currency": amount,
            },
        ],
    })
    _original_user = frappe.session.user
    frappe.set_user("Administrator")
    try:
        je.insert()
        je.submit()
        frappe.db.commit()
        return je.name
    finally:
        frappe.set_user(_original_user)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _create_cash_payment(customer, company, amount, driver, reference=""):
    """Submit a Payment Entry: Fahrerkasse (driver) ← Customer AR."""
    cash_account = frappe.db.get_value("Driver", driver, "custom_cash_account")
    if not cash_account:
        frappe.log_error(
            f"Driver {driver} has no Fahrerkasse account — cash payment skipped",
            "Getraenkehandel Delivery",
        )
        return None

    receivable_account = frappe.db.get_value(
        "Company", company, "default_receivable_account"
    )
    if not receivable_account:
        frappe.log_error(
            f"No default_receivable_account on company {company} — cash payment skipped",
            "Getraenkehandel Delivery",
        )
        return None

    _original_user = frappe.session.user
    frappe.set_user("Administrator")
    try:
        pe = frappe.get_doc({
            "doctype": "Payment Entry",
            "payment_type": "Receive",
            "party_type": "Customer",
            "party": customer,
            "company": company,
            "paid_from": receivable_account,
            "paid_to": cash_account,
            "paid_amount": amount,
            "received_amount": amount,
            "remarks": reference or f"Barzahlung bei Lieferung — Fahrer {driver}",
        })
        pe.insert()
        pe.submit()
        frappe.db.commit()
        return pe.name
    finally:
        frappe.set_user(_original_user)

def _aggregate_pfand_lines(empties):
    """
    empties = [{item_code: "COLA-050", qty: 3}, ...]
    Returns {pfand_item_code: total_qty}
    """
    pfand_lines = {}
    for row in empties:
        item_code = row.get("item_code")
        qty = float(row.get("qty") or 0)
        if not item_code or qty <= 0:
            continue

        pfand_item = frappe.db.get_value("Item", item_code, "custom_pfand_item")
        if not pfand_item:
            frappe.log_error(
                f"No custom_pfand_item on {item_code} — skipped in empties return",
                "Getraenkehandel Delivery",
            )
            continue

        pfand_lines[pfand_item] = pfand_lines.get(pfand_item, 0.0) + qty

    return pfand_lines


def _create_pfand_credit_note(customer, company, pfand_lines, reference=""):
    """Build, insert and submit a Sales Invoice credit note for Pfand returns."""
    warehouse = (
        frappe.db.get_value(
            "Warehouse",
            {"warehouse_name": "Hauptlager", "company": company},
            "name",
        )
        or frappe.db.get_value(
            "Warehouse",
            {"company": company, "is_group": 0},
            "name",
        )
    )

    items = [
        {"item_code": pfand_item, "qty": -qty, "warehouse": warehouse}
        for pfand_item, qty in pfand_lines.items()
    ]

    _original_user = frappe.session.user
    frappe.set_user("Administrator")
    try:
        credit_note = frappe.get_doc({
            "doctype": "Sales Invoice",
            "is_return": 1,
            "customer": customer,
            "company": company,
            "items": items,
            "remarks": _("Pfand-Rücknahme: {0}").format(reference),
        })
        credit_note.insert()
        credit_note.submit()
        frappe.db.commit()
        return credit_note
    finally:
        frappe.set_user(_original_user)
