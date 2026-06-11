// Auto-Pfand on Sales Invoice and Sales Order
// When a beverage item is added, a Pfand (deposit) line is appended automatically.

['Sales Invoice Item', 'Sales Order Item'].forEach(childDt => {
	frappe.ui.form.on(childDt, {
		item_code(frm, cdt, cdn) {
			const row = locals[cdt][cdn];

			// This row IS a Pfand row — skip to avoid infinite recursion
			if (row.custom_pfand_parent_row) return;

			// Clear any previously linked Pfand row (e.g. item changed on same row)
			_remove_pfand_rows(frm, cdn);

			if (!row.item_code) return;

			// Single server call — avoids direct Item Default access which
			// regular Sales users do not have permission for.
			frappe.call({
				method: 'getraenkehandel.getraenkehandel.api.get_pfand_info',
				args: { item_code: row.item_code, company: frm.doc.company },
				callback(r) {
					const info = r.message;
					if (!info || !info.pfand_item) return;

					const pfand_qty = (row.qty || 1) * (info.qty_per_unit || 1);
					const pfand_row = frm.add_child('items');

					// Set parent reference BEFORE triggering item_code so the guard works
					pfand_row.custom_pfand_parent_row = cdn;

					frappe.model.set_value(
						pfand_row.doctype, pfand_row.name,
						'item_code', info.pfand_item
					);
					frappe.model.set_value(
						pfand_row.doctype, pfand_row.name,
						'qty', pfand_qty
					);

					// After ERPNext's item fetch sets default accounts, override
					// income_account with the Pfand liability account (1590).
					if (info.income_account) {
						frappe.after_ajax(() => {
							frappe.model.set_value(
								pfand_row.doctype, pfand_row.name,
								'income_account', info.income_account
							);
							frm.refresh_field('items');
						});
					}

					frm.refresh_field('items');
				},
			});
		},

		qty(frm, cdt, cdn) {
			const row = locals[cdt][cdn];

			// Pfand rows manage their own qty via this handler on the parent — skip self
			if (row.custom_pfand_parent_row) return;

			if (!row.item_code) return;

			frappe.call({
				method: 'getraenkehandel.getraenkehandel.api.get_pfand_info',
				args: { item_code: row.item_code, company: frm.doc.company },
				callback(r) {
					const info = r.message;
					if (!info) return;
					const multiplier = info.qty_per_unit || 1;
					(frm.doc.items || []).forEach(item => {
						if (item.custom_pfand_parent_row === cdn) {
							frappe.model.set_value(
								item.doctype, item.name,
								'qty', (row.qty || 0) * multiplier
							);
						}
					});
					frm.refresh_field('items');
				},
			});
		},

		before_items_remove(frm, cdt, cdn) {
			_remove_pfand_rows(frm, cdn);
		},
	});
});

function _remove_pfand_rows(frm, parent_cdn) {
	const to_remove = (frm.doc.items || []).filter(
		item => item.custom_pfand_parent_row === parent_cdn
	);
	to_remove.forEach(item => {
		const grid_row = frm.fields_dict.items.grid.grid_rows_by_docname[item.name];
		if (grid_row) grid_row.remove();
	});
	if (to_remove.length) frm.refresh_field('items');
}
