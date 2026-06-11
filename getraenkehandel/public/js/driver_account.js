frappe.ui.form.on('Driver', {
	refresh(frm) {
		if (frm.doc.custom_cash_account) {
			frm.set_intro(
				__('Fahrerkasse: <b>{0}</b>', [frm.doc.custom_cash_account]),
				'blue'
			);
			if (!frm.is_new()) {
				frm.add_custom_button(__('Kontoauszug'), () => {
					frappe.set_route('query-report', 'General Ledger', {
						account: frm.doc.custom_cash_account,
					});
				}, __('Fahrerkasse'));
			}
		}

		if (!frm.is_new() && frm.doc.custom_cash_account) {
			frm.add_custom_button(__('Kassenabrechnung'), () => {
				_show_handover_dialog(frm);
			}, __('Fahrerkasse'));
		}
	},

	custom_auto_create_cash_account(frm) {
		if (frm.doc.custom_auto_create_cash_account && !frm.doc.custom_cash_account) {
			frappe.show_alert({
				message: __('Beim Speichern wird automatisch ein Fahrerkasse-Konto unter 1009 angelegt.'),
				indicator: 'blue',
			}, 4);
		}
	},
});

function _show_handover_dialog(frm) {
	frappe.call({
		method: 'getraenkehandel.getraenkehandel.delivery.get_driver_cash_balance',
		args: { driver: frm.doc.name },
		callback(r) {
			const balance = flt(r.message);

			const d = new frappe.ui.Dialog({
				title: __('Kassenabrechnung — {0}', [frm.doc.full_name || frm.doc.name]),
				fields: [
					{
						fieldname: 'info',
						fieldtype: 'HTML',
						options: `<div class="alert alert-info">
							${__('Aktuelles Guthaben Fahrerkasse')}: <b>€ ${balance.toFixed(2)}</b>
						</div>`,
					},
					{
						fieldname: 'amount',
						fieldtype: 'Currency',
						label: __('Übergabebetrag (€)'),
						default: balance > 0 ? balance : 0,
						reqd: 1,
					},
					{
						fieldname: 'date',
						fieldtype: 'Date',
						label: __('Datum'),
						default: frappe.datetime.get_today(),
						reqd: 1,
					},
				],
				primary_action_label: __('Jetzt buchen'),
				primary_action(values) {
					frappe.call({
						method: 'getraenkehandel.getraenkehandel.delivery.handover_driver_cash',
						args: {
							driver: frm.doc.name,
							amount: values.amount,
							date: values.date,
						},
						freeze: true,
						freeze_message: __('Buchung wird erstellt...'),
						callback(r) {
							if (r.message) {
								d.hide();
								frappe.show_alert({
									message: __('Kassenabrechnung gebucht: {0}', [r.message]),
									indicator: 'green',
								}, 5);
								frappe.set_route('Form', 'Journal Entry', r.message);
							}
						},
					});
				},
			});
			d.show();
		},
	});
}
