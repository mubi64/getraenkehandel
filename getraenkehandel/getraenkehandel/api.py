import frappe


@frappe.whitelist()
def get_pfand_info(item_code, company):
    """Return pfand_item, qty_per_unit and income_account for a beverage item.

    Called by pfand_script.js when an item is added to a Sales Invoice / Order.
    Runs server-side so users don't need direct read access to Item Default.
    """
    values = frappe.db.get_value(
        "Item", item_code,
        ["custom_pfand_item", "custom_pfand_qty_per_unit"],
        as_dict=True,
    )
    if not values or not values.get("custom_pfand_item"):
        return None

    income_account = frappe.db.get_value(
        "Item Default",
        {"parent": values["custom_pfand_item"], "company": company},
        "income_account",
    )

    return {
        "pfand_item": values["custom_pfand_item"],
        "qty_per_unit": values.get("custom_pfand_qty_per_unit") or 1,
        "income_account": income_account,
    }
