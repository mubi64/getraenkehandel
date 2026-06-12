import json
import os

import frappe
from frappe import _


def before_install():
    """Seed ERPNext root master data before our fixture JSONs are imported.

    Our fixtures (Customer Group, Item Group, etc.) reference parent nodes like
    "All Customer Groups" which are created by ERPNext's install_fixtures.
    Those roots must exist before sync_fixtures() tries to insert our records.
    """
    try:
        from erpnext.setup.setup_wizard.operations import install_fixtures

        # update_global_search_doctypes requires Redis which may not be running;
        # patch it out so the rest of install_fixtures succeeds.
        import frappe.utils.global_search as _gs
        _real = _gs.update_global_search_doctypes
        _gs.update_global_search_doctypes = lambda: None
        try:
            install_fixtures.install(country="Germany")
        finally:
            _gs.update_global_search_doctypes = _real

        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Getraenkehandel before_install")


def after_install():
    """Create custom fields on Item, Sales Invoice Item, Company, and delivery doctypes.

    Runs before sync_fixtures in Frappe's install order.
    """
    _create_delivery_leergut_doctype()
    _create_custom_fields()
    _hide_sales_invoice_fields()
    _setup_item_groups()   # must exist before sync_fixtures imports items
    frappe.db.set_default("desktop:home_page", "Getraenkehandel")
    frappe.db.commit()


def after_setup_wizard(args=None):
    """Called by Frappe after the setup wizard completes.

    At this point the company exists (created by the wizard) and args contains
    the wizard form data including company_name.
    """
    _setup_item_groups()
    _setup_customer_groups()
    _setup_chart_of_accounts()
    _setup_tax_templates()
    _setup_warehouses()
    _setup_pfand_item_defaults()
    _setup_item_prices()
    _setup_stock_settings()
    _setup_fahrerkassen_group()
    _hide_unwanted_workspaces()
    frappe.db.set_default("desktop:home_page", "Getraenkehandel")
    frappe.db.commit()
    frappe.clear_cache()


# ---------------------------------------------------------------------------
# Delivery Note Leergut — custom child doctype for empty bottle returns
# ---------------------------------------------------------------------------

def _create_delivery_leergut_doctype():
    if frappe.db.exists("DocType", "Delivery Note Leergut"):
        return
    frappe.get_doc({
        "doctype": "DocType",
        "name": "Delivery Note Leergut",
        "module": "Getraenkehandel",
        "custom": 1,
        "istable": 1,
        "editable_grid": 1,
        "track_changes": 0,
        "fields": [
            {
                "fieldname": "item_code",
                "label": "Artikel",
                "fieldtype": "Link",
                "options": "Item",
                "in_list_view": 1,
                "reqd": 1,
                "columns": 5,
                "get_query": "() => ({ filters: { is_sales_item: 1 } })",
            },
            {
                "fieldname": "qty",
                "label": "Menge",
                "fieldtype": "Float",
                "in_list_view": 1,
                "reqd": 1,
                "default": "1",
                "columns": 2,
            },
            {
                "fieldname": "pfand_item",
                "label": "Pfand Artikel",
                "fieldtype": "Link",
                "options": "Item",
                "in_list_view": 1,
                "read_only": 1,
                "fetch_from": "item_code.custom_pfand_item",
                "columns": 5,
            },
        ],
    }).insert(ignore_permissions=True)
    frappe.db.commit()


# ---------------------------------------------------------------------------
# Custom Fields
# ---------------------------------------------------------------------------

def _create_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields({
        "Item": [
            {
                "fieldname": "custom_pfand_section",
                "label": "Pfand",
                "fieldtype": "Tab Break",
                # Placed after the Tax tab so it appears as its own clean tab
                "insert_after": "item_tax_section_break",
            },
            {
                "fieldname": "custom_pfand_item",
                "label": "Pfand Item",
                "fieldtype": "Link",
                "options": "Item",
                "insert_after": "custom_pfand_section",
                "description": "Deposit item appended automatically on Sales Invoices",
            },
            {
                "fieldname": "custom_pfand_qty_per_unit",
                "label": "Pfand Qty per Unit",
                "fieldtype": "Int",
                "insert_after": "custom_pfand_item",
                "default": "1",
                "description": "Multiplier: e.g. 20 for a crate of 20 bottles",
            },
            {
                "fieldname": "custom_pfand_col_break",
                "fieldtype": "Column Break",
                "insert_after": "custom_pfand_qty_per_unit",
            },
            {
                "fieldname": "custom_pfand_crate_item",
                "label": "Crate Deposit Item",
                "fieldtype": "Link",
                "options": "Item",
                "insert_after": "custom_pfand_col_break",
            },
            {
                "fieldname": "custom_is_leergut",
                "label": "Is Leergut (Return)",
                "fieldtype": "Check",
                "insert_after": "custom_pfand_crate_item",
            },
        ],
        "Sales Invoice Item": [
            {
                "fieldname": "custom_pfand_parent_row",
                "label": "Pfand Parent Row",
                "fieldtype": "Data",
                "insert_after": "item_code",
                "hidden": 1,
                "read_only": 1,
                "print_hide": 1,
                "report_hide": 1,
            },
        ],
        "Sales Order Item": [
            {
                "fieldname": "custom_pfand_parent_row",
                "label": "Pfand Parent Row",
                "fieldtype": "Data",
                "insert_after": "item_code",
                "hidden": 1,
                "read_only": 1,
                "print_hide": 1,
                "report_hide": 1,
            },
        ],
        "Address": [
            {
                "fieldname": "custom_geo_section",
                "label": "Koordinaten",
                "fieldtype": "Section Break",
                "insert_after": "county",
                "collapsible": 1,
            },
            {
                "fieldname": "custom_latitude",
                "label": "Breitengrad (Latitude)",
                "fieldtype": "Float",
                "insert_after": "custom_geo_section",
                "precision": "8",
                "read_only": 1,
                "print_hide": 1,
            },
            {
                "fieldname": "custom_longitude",
                "label": "Längengrad (Longitude)",
                "fieldtype": "Float",
                "insert_after": "custom_latitude",
                "precision": "8",
                "read_only": 1,
                "print_hide": 1,
            },
        ],
        "Delivery Trip": [
            {
                "fieldname": "custom_route_section",
                "label": "Route",
                "fieldtype": "Section Break",
                "insert_after": "status",
            },
            {
                "fieldname": "custom_route_name",
                "label": "Routenname",
                "fieldtype": "Data",
                "insert_after": "custom_route_section",
            },
            {
                "fieldname": "custom_route_day",
                "label": "Routentag",
                "fieldtype": "Select",
                "options": "\nMontag\nDienstag\nMittwoch\nDonnerstag\nFreitag\nSamstag",
                "insert_after": "custom_route_name",
            },
            {
                "fieldname": "custom_route_col_break",
                "fieldtype": "Column Break",
                "insert_after": "custom_route_day",
            },
            {
                "fieldname": "custom_total_stops",
                "label": "Anzahl Stopps",
                "fieldtype": "Int",
                "insert_after": "custom_route_col_break",
                "read_only": 1,
            },
            {
                "fieldname": "custom_route_polyline",
                "label": "Route Polyline",
                "fieldtype": "Long Text",
                "insert_after": "custom_total_stops",
                "hidden": 1,
                "print_hide": 1,
                "report_hide": 1,
                "no_copy": 1,
            },
            {
                "fieldname": "custom_route_stats",
                "label": "Route Stats",
                "fieldtype": "Small Text",
                "insert_after": "custom_route_polyline",
                "hidden": 1,
                "print_hide": 1,
                "report_hide": 1,
                "no_copy": 1,
            },
        ],
        # Delivery Stop (child of Delivery Trip) — driver fills these in the app
        "Delivery Stop": [
            {
                "fieldname": "custom_driver_section",
                "label": "Fahrer",
                "fieldtype": "Section Break",
                "insert_after": "details",
            },
            {
                "fieldname": "custom_cash_collected",
                "label": "Barzahlung erhalten (€)",
                "fieldtype": "Currency",
                "insert_after": "custom_driver_section",
            },
            {
                "fieldname": "custom_driver_notes",
                "label": "Fahrer Notiz",
                "fieldtype": "Small Text",
                "insert_after": "custom_cash_collected",
            },
        ],
        "Driver": [
            {
                "fieldname": "custom_user",
                "label": "ERPNext Benutzer (App-Login)",
                "fieldtype": "Link",
                "options": "User",
                "insert_after": "cell_number",
                "description": "Welcher ERPNext-Benutzer ist dieser Fahrer? Wird für die Fahrer-App benötigt.",
            },
            {
                "fieldname": "custom_fahrerkasse_section",
                "label": "Fahrerkasse",
                "fieldtype": "Section Break",
                "insert_after": "driving_license_category",
            },
            {
                "fieldname": "custom_auto_create_cash_account",
                "label": "Fahrerkasse automatisch anlegen",
                "fieldtype": "Check",
                "insert_after": "custom_fahrerkasse_section",
                "description": "Beim Speichern wird automatisch ein Kassenkonto unter 1009 angelegt.",
            },
            {
                "fieldname": "custom_cash_account",
                "label": "Fahrerkasse (Konto)",
                "fieldtype": "Link",
                "options": "Account",
                "insert_after": "custom_auto_create_cash_account",
                "read_only": 1,
                "description": "Automatisch befüllt — hier werden Barzahlungen des Fahrers gebucht.",
            },
        ],
        "Company": [
            {
                "fieldname": "custom_setup_complete",
                "label": "Getraenkehandel Setup Complete",
                "fieldtype": "Check",
                "insert_after": "abbr",
                "hidden": 1,
                "no_copy": 1,
            },
            {
                "fieldname": "custom_kleinunternehmer",
                "label": "Kleinunternehmer (§19 UStG)",
                "fieldtype": "Check",
                "insert_after": "custom_setup_complete",
                "description": "Kein MwSt-Ausweis — Jahresumsatz unter 22.000 €",
            },
        ],
    })


# ---------------------------------------------------------------------------
# Sales Invoice + Sales Order UI — hide irrelevant fields via Property Setters
# ---------------------------------------------------------------------------

_HIDDEN_SELLING_FIELDS = [
    "project",
    "cost_center",
    "commission_rate",
    "campaign",
    "source",
]

def _hide_sales_invoice_fields():
    for doctype in ("Sales Invoice", "Sales Order"):
        for fieldname in _HIDDEN_SELLING_FIELDS:
            ps_name = f"{doctype}-{fieldname}-hidden"
            if frappe.db.exists("Property Setter", ps_name):
                continue
            frappe.make_property_setter(
                {"doctype": doctype, "fieldname": fieldname,
                 "property": "hidden", "value": "1", "property_type": "Check"},
                ignore_validate=True,
            )


# ---------------------------------------------------------------------------
# Workspace visibility — hide modules not relevant for Getränkehandel
# ---------------------------------------------------------------------------

_HIDE_WORKSPACES = [
    # ERPNext modules not relevant for Getränkehandel
    "Manufacturing", "CRM", "Projects", "Quality", "Support",
    "ERPNext Integrations", "Integrations", "Website", "Assets",
    "Build", "Welcome Workspace",
    # Admin / developer workspaces
    "ERPNext Settings", "Settings", "Users", "Tools",
    # Default home replaced by Getraenkehandel workspace
    "Home",
]

def _hide_unwanted_workspaces():
    for ws_name in _HIDE_WORKSPACES:
        if frappe.db.exists("Workspace", ws_name):
            frappe.db.set_value("Workspace", ws_name, "is_hidden", 1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_company():
    company = frappe.db.get_single_value("Global Defaults", "default_company")
    if not company:
        company = frappe.db.get_value("Company", {}, "name")
    return company


# ---------------------------------------------------------------------------
# Item Groups — nested set, must run after setup wizard initialises tree roots
# ---------------------------------------------------------------------------

ITEM_GROUPS = [
    {"item_group_name": "Getränke",    "parent_item_group": "All Item Groups", "is_group": 1},
    {"item_group_name": "Bier",        "parent_item_group": "Getränke",        "is_group": 0},
    {"item_group_name": "Wasser",      "parent_item_group": "Getränke",        "is_group": 0},
    {"item_group_name": "Softdrinks",  "parent_item_group": "Getränke",        "is_group": 0},
    {"item_group_name": "Säfte",       "parent_item_group": "Getränke",        "is_group": 0},
    {"item_group_name": "Spirituosen", "parent_item_group": "Getränke",        "is_group": 0},
    {"item_group_name": "Pfand",       "parent_item_group": "All Item Groups", "is_group": 0},
    {"item_group_name": "Leergut",     "parent_item_group": "All Item Groups", "is_group": 0},
]

def _setup_item_groups():
    # Ensure root node exists before adding children
    if not frappe.db.exists("Item Group", "All Item Groups"):
        frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": "All Item Groups",
            "is_group": 1,
        }).insert(ignore_permissions=True)

    for g in ITEM_GROUPS:
        if frappe.db.exists("Item Group", g["item_group_name"]):
            continue
        try:
            frappe.get_doc({"doctype": "Item Group", **g}).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "getraenkehandel: _setup_item_groups")


# ---------------------------------------------------------------------------
# Customer Groups — nested set, same constraint as Item Groups
# ---------------------------------------------------------------------------

CUSTOMER_GROUPS = [
    "Gastronomie", "Kiosk/Späti", "Einzelhandel", "Privatkunde",
]

def _setup_customer_groups():
    for name in CUSTOMER_GROUPS:
        if frappe.db.exists("Customer Group", name):
            continue
        try:
            frappe.get_doc({
                "doctype": "Customer Group",
                "customer_group_name": name,
                "parent_customer_group": "All Customer Groups",
                "is_group": 0,
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "getraenkehandel: _setup_customer_groups")


# ---------------------------------------------------------------------------
# Chart of Accounts — custom additions on top of SKR03/SKR04
# ---------------------------------------------------------------------------

def _setup_chart_of_accounts():
    company = _get_company()
    if not company:
        frappe.log_error("No company found — skipping CoA setup", "Getraenkehandel Install")
        return

    coa_name = frappe.db.get_value("Company", company, "chart_of_accounts") or ""
    data_file = "chart_of_accounts_skr04.json" if "04" in coa_name else "chart_of_accounts_skr03.json"

    for acc in _load_data(data_file):
        _ensure_account(company, acc)


def _ensure_account(company, spec):
    """Create the custom account; delete-and-recreate if it landed in the wrong root_type."""
    number = spec["account_number"]
    parent_name_like = spec.get("parent_account_name_like")

    existing = frappe.db.get_value(
        "Account",
        {"account_number": number, "company": company},
        ["name", "root_type", "account_name"],
        as_dict=True,
    )

    if existing:
        already_correct = (
            existing.root_type == spec["root_type"]
            and existing.account_name == spec["account_name"]
        )
        if already_correct:
            return

        # Wrong root_type or name — safe to fix only when no GL entries exist yet.
        if frappe.db.exists("GL Entry", {"account": existing.name}):
            frappe.log_error(
                f"Account {number} exists with wrong root_type and has GL entries — skipping",
                "Getraenkehandel CoA",
            )
            return
        frappe.delete_doc("Account", existing.name, ignore_permissions=True, force=True)

    parent = _find_parent(
        company,
        spec["root_type"],
        number_prefix=spec.get("parent_number_prefix"),
        name_like=parent_name_like,
    )
    if not parent:
        frappe.log_error(
            f"No parent found for account {number} ({spec['account_name']})",
            "Getraenkehandel CoA",
        )
        return

    frappe.get_doc({
        "doctype": "Account",
        "account_name": spec["account_name"],
        "account_number": number,
        "parent_account": parent,
        "account_type": spec.get("account_type", ""),
        "root_type": spec["root_type"],
        "is_group": spec.get("is_group", 0),
        "company": company,
    }).insert(ignore_permissions=True)


def _find_parent(company, root_type, number_prefix=None, name_like=None):
    """Return the name of the best group account to parent a new account under."""
    # 1. Match by account_name substring (SKR03 groups have no numbers)
    if name_like:
        rows = frappe.db.get_all(
            "Account",
            filters={"company": company, "is_group": 1, "account_name": ["like", f"%{name_like}%"]},
            fields=["name"],
            limit=1,
        )
        if rows:
            return rows[0].name

    # 2. Match by account_number prefix (SKR04 numbered groups)
    if number_prefix:
        rows = frappe.db.get_all(
            "Account",
            filters={
                "company": company,
                "is_group": 1,
                "root_type": root_type,
                "account_number": ["like", f"{number_prefix}%"],
            },
            fields=["name"],
            limit=1,
        )
        if rows:
            return rows[0].name

    # 3. Root group for this root_type
    rows = frappe.db.get_all(
        "Account",
        filters={
            "company": company,
            "is_group": 1,
            "root_type": root_type,
            "parent_account": ("is", "not set"),
        },
        fields=["name"],
        limit=1,
    )
    return rows[0].name if rows else None


# ---------------------------------------------------------------------------
# Sales Tax Templates
# ---------------------------------------------------------------------------

def _setup_tax_templates():
    company = _get_company()
    if not company:
        return

    for tmpl in _load_data("tax_templates.json"):
        if frappe.db.exists(
            "Sales Taxes and Charges Template", {"title": tmpl["title"], "company": company}
        ):
            continue

        tax_rows = []
        for row in tmpl.get("taxes", []):
            # Support both a single account_number and a list of fallbacks (SKR03/SKR04)
            candidates = row.get("account_numbers") or [row["account_number"]]
            account_head = None
            for num in candidates:
                account_head = frappe.db.get_value(
                    "Account",
                    {"account_number": num, "company": company},
                    "name",
                )
                if account_head:
                    break
            if not account_head:
                frappe.log_error(
                    f"None of accounts {candidates} found for tax template {tmpl['title']}",
                    "Getraenkehandel Install",
                )
                continue
            tax_rows.append({
                "doctype": "Sales Taxes and Charges",
                "charge_type": row["charge_type"],
                "account_head": account_head,
                "description": row["description"],
                "rate": row["rate"],
            })

        frappe.get_doc({
            "doctype": "Sales Taxes and Charges Template",
            "title": tmpl["title"],
            "company": company,
            "is_default": tmpl.get("is_default", 0),
            "taxes": tax_rows,
        }).insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Warehouses
# ---------------------------------------------------------------------------

def _setup_warehouses():
    company = _get_company()
    if not company:
        return

    for wh in _load_data("warehouses.json"):
        if frappe.db.exists("Warehouse", {"warehouse_name": wh["warehouse_name"], "company": company}):
            continue

        frappe.get_doc({
            "doctype": "Warehouse",
            "warehouse_name": wh["warehouse_name"],
            "company": company,
            "is_group": wh.get("is_group", 0),
        }).insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Pfand Item Defaults — set income_account = 1590 on all Pfand group items
# ---------------------------------------------------------------------------

def _setup_pfand_item_defaults():
    company = _get_company()
    if not company:
        return

    coa_name = frappe.db.get_value("Company", company, "chart_of_accounts") or ""
    pfand_account_number = "3590" if "04" in coa_name else "1590"

    pfand_account = frappe.db.get_value(
        "Account",
        {"account_number": pfand_account_number, "company": company},
        "name",
    )
    if not pfand_account:
        frappe.log_error(
            f"Pfand account {pfand_account_number} not found — skipping item defaults",
            "Getraenkehandel Install",
        )
        return

    pfand_items = frappe.db.get_all("Item", filters={"item_group": "Pfand"}, fields=["name"])
    for item_rec in pfand_items:
        existing_row = frappe.db.get_value(
            "Item Default",
            {"parent": item_rec.name, "company": company},
            "name",
        )
        if existing_row:
            # Direct DB update — bypasses Item.save() validation hooks that can
            # silently overwrite income_account with the company default.
            frappe.db.set_value("Item Default", existing_row, "income_account", pfand_account)
        else:
            frappe.get_doc({
                "doctype": "Item Default",
                "parent": item_rec.name,
                "parentfield": "item_defaults",
                "parenttype": "Item",
                "company": company,
                "income_account": pfand_account,
            }).insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Fahrerkassen group account — 1009 parent for per-driver cash accounts
# ---------------------------------------------------------------------------

def _setup_fahrerkassen_group():
    company = _get_company()
    if not company:
        return
    from getraenkehandel.getraenkehandel.driver_account import ensure_fahrerkassen_group
    ensure_fahrerkassen_group(company)


# ---------------------------------------------------------------------------
# Item Prices — one entry per item × price list
# ---------------------------------------------------------------------------

def _setup_item_prices():
    for entry in _load_data("item_prices.json"):
        item_code = entry["item_code"]
        for price_list, rate in entry["prices"].items():
            existing_name = frappe.db.get_value("Item Price", {
                "item_code": item_code,
                "price_list": price_list,
            }, "name")
            if existing_name:
                frappe.db.set_value("Item Price", existing_name, "price_list_rate", rate)
            else:
                frappe.get_doc({
                    "doctype": "Item Price",
                    "item_code": item_code,
                    "price_list": price_list,
                    "price_list_rate": rate,
                    "currency": "EUR",
                }).insert(ignore_permissions=True)


# ---------------------------------------------------------------------------
# Stock settings
# ---------------------------------------------------------------------------

def _setup_stock_settings():
    """Allow negative stock (needed until opening stock is entered) and set
    Hauptlager as default warehouse so new documents don't default to Stores."""
    company = _get_company()

    frappe.db.set_single_value("Stock Settings", "allow_negative_stock", 1)

    if company:
        hauptlager = frappe.db.get_value(
            "Warehouse",
            {"warehouse_name": "Hauptlager", "company": company},
            "name",
        )
        if hauptlager:
            frappe.db.set_single_value("Stock Settings", "default_warehouse", hauptlager)

    frappe.db.commit()


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _load_data(filename):
    path = os.path.join(os.path.dirname(__file__), "..", "data", filename)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
