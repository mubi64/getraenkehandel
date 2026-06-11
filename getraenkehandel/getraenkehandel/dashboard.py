import frappe
from frappe.utils import today, flt


def set_default_workspace(bootinfo):
    """boot_session hook — redirect every user to Getraenkehandel workspace on login
    unless they have already set a personal default workspace."""
    if not (bootinfo.user or {}).get("default_workspace"):
        bootinfo.user.default_workspace = {
            "name": "Getraenkehandel",
            "public": 1,
            "title": "Getraenkehandel",
        }


@frappe.whitelist()
def get_kpi_stats():
    """Return live KPI numbers for the Getraenkehandel workspace dashboard."""
    frappe.flags.ignore_permissions = True

    company = (
        frappe.defaults.get_user_default("Company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
    )

    # Today's revenue (submitted invoices, today's posting date)
    umsatz_row = frappe.db.sql(
        """SELECT COALESCE(SUM(grand_total), 0) AS total
           FROM `tabSales Invoice`
           WHERE docstatus = 1 AND posting_date = %s AND company = %s""",
        (today(), company),
        as_dict=True,
    )
    umsatz = flt(umsatz_row[0].total) if umsatz_row else 0.0

    # Open / overdue invoices
    offen_row = frappe.db.sql(
        """SELECT COUNT(*) AS cnt, COALESCE(SUM(outstanding_amount), 0) AS total
           FROM `tabSales Invoice`
           WHERE docstatus = 1
             AND status IN ('Unpaid', 'Overdue')
             AND company = %s""",
        (company,),
        as_dict=True,
    )
    offen_count = int(offen_row[0].cnt) if offen_row else 0
    offen_summe = flt(offen_row[0].total) if offen_row else 0.0

    # Pfand outstanding — credit balance on account 1590
    pfand_account = frappe.db.get_value(
        "Account", {"account_number": "1590", "company": company}, "name"
    )
    pfand = 0.0
    if pfand_account:
        pfand_row = frappe.db.sql(
            """SELECT COALESCE(SUM(credit_in_account_currency), 0) -
                      COALESCE(SUM(debit_in_account_currency), 0) AS balance
               FROM `tabGL Entry`
               WHERE account = %s AND company = %s AND is_cancelled = 0""",
            (pfand_account, company),
            as_dict=True,
        )
        pfand = flt(pfand_row[0].balance) if pfand_row else 0.0

    # Delivery notes submitted today
    dn_row = frappe.db.sql(
        """SELECT COUNT(*) AS cnt
           FROM `tabDelivery Note`
           WHERE docstatus = 1 AND posting_date = %s AND company = %s""",
        (today(), company),
        as_dict=True,
    )
    lieferungen = int(dn_row[0].cnt) if dn_row else 0

    return {
        "umsatz_heute":    umsatz,
        "offene_count":    offen_count,
        "offene_summe":    offen_summe,
        "pfand_ausstehend": pfand,
        "lieferungen_heute": lieferungen,
    }
