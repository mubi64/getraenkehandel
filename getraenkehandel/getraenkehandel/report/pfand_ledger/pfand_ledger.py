import frappe
from frappe import _


def execute(filters=None):
    filters = filters or {}
    return get_columns(), get_data(filters)


def get_columns():
    return [
        {
            "fieldname": "customer",
            "label": _("Customer"),
            "fieldtype": "Link",
            "options": "Customer",
            "width": 140,
        },
        {
            "fieldname": "customer_name",
            "label": _("Customer Name"),
            "fieldtype": "Data",
            "width": 200,
        },
        {
            "fieldname": "total_charged",
            "label": _("Pfand Charged (€)"),
            "fieldtype": "Currency",
            "width": 140,
        },
        {
            "fieldname": "total_returned",
            "label": _("Pfand Returned (€)"),
            "fieldtype": "Currency",
            "width": 140,
        },
        {
            "fieldname": "outstanding",
            "label": _("Outstanding (€)"),
            "fieldtype": "Currency",
            "width": 140,
        },
    ]


def get_data(filters):
    conditions = _build_conditions(filters)

    rows = frappe.db.sql(
        f"""
        SELECT
            si.customer,
            si.customer_name,
            SUM(CASE WHEN si.is_return = 0 THEN sii.qty * sii.rate ELSE 0 END)
                AS total_charged,
            SUM(CASE WHEN si.is_return = 1 THEN ABS(sii.qty * sii.rate) ELSE 0 END)
                AS total_returned,
            SUM(CASE WHEN si.is_return = 0
                          THEN sii.qty * sii.rate
                          ELSE -ABS(sii.qty * sii.rate) END)
                AS outstanding
        FROM `tabSales Invoice Item` sii
        INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
        INNER JOIN `tabItem` i ON i.item_code = sii.item_code
        WHERE
            si.docstatus = 1
            AND i.item_group = 'Pfand'
            {conditions}
        GROUP BY si.customer, si.customer_name
        {_having_clause(filters)}
        ORDER BY si.customer_name
        """,
        filters,
        as_dict=True,
    )
    return rows


def _build_conditions(filters):
    parts = []

    if filters.get("from_date"):
        parts.append("AND si.posting_date >= %(from_date)s")
    if filters.get("to_date"):
        parts.append("AND si.posting_date <= %(to_date)s")
    if filters.get("customer"):
        parts.append("AND si.customer = %(customer)s")

    return " ".join(parts)


def _having_clause(filters):
    if filters.get("outstanding_only"):
        return "HAVING outstanding > 0"
    return ""
