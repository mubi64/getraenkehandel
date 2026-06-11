import frappe
from frappe import _


def on_driver_update(doc, method):
    """Auto-create Fahrerkasse account when checkbox is ticked on save."""
    if not doc.custom_auto_create_cash_account:
        return
    if doc.custom_cash_account:
        return

    company = _get_company()
    if not company:
        frappe.log_error("No company found — skipping Fahrerkasse creation", "Getraenkehandel Driver")
        return

    group = ensure_fahrerkassen_group(company)
    driver_name = doc.full_name or doc.driver_name or doc.name
    account_name = f"Fahrerkasse {driver_name}"

    existing = frappe.db.get_value(
        "Account", {"account_name": account_name, "company": company}, "name"
    )
    if existing:
        frappe.db.set_value("Driver", doc.name, "custom_cash_account", existing)
        doc.custom_cash_account = existing
        return

    acc = frappe.get_doc({
        "doctype": "Account",
        "account_name": account_name,
        "parent_account": group,
        "account_type": "Cash",
        "is_group": 0,
        "company": company,
    }).insert(ignore_permissions=True)

    frappe.db.set_value("Driver", doc.name, "custom_cash_account", acc.name)
    doc.custom_cash_account = acc.name
    frappe.msgprint(
        _("Fahrerkasse-Konto angelegt: {0}").format(acc.name),
        alert=True, indicator="green"
    )


def ensure_fahrerkassen_group(company):
    """Return name of 1009 - Fahrerkassen group, creating it if needed."""
    existing = frappe.db.get_value(
        "Account", {"account_number": "1009", "company": company}, "name"
    )
    if existing:
        return existing

    # Parent: same as 1000 - Kasse so it sits in the same cash section
    parent = frappe.db.get_value(
        "Account", {"account_number": "1000", "company": company}, "parent_account"
    )
    if not parent:
        # Fallback: any Cash group account for the company
        parent = frappe.db.get_value(
            "Account",
            {"account_type": "Cash", "is_group": 1, "company": company},
            "name",
        )
    if not parent:
        frappe.throw(_("Kassengruppe nicht gefunden — bitte Chart of Accounts prüfen."))

    return frappe.get_doc({
        "doctype": "Account",
        "account_name": "Fahrerkassen",
        "account_number": "1009",
        "parent_account": parent,
        "account_type": "Cash",
        "is_group": 1,
        "company": company,
    }).insert(ignore_permissions=True).name


def _get_company():
    company = frappe.db.get_single_value("Global Defaults", "default_company")
    return company or frappe.db.get_value("Company", {}, "name")
