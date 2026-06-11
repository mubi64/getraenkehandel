frappe.ui.form.on('Delivery Trip', {
	refresh(frm) {
		if (frm.doc.docstatus === 1 && frm.doc.driver) {
			frm.add_custom_button(__('Kassenabrechnung'), () => {
				_show_handover_dialog(frm);
			}, __('Fahrer'));
		}
	},
});

function _show_handover_dialog(frm) {
	// Fetch actual GL balance of the driver's Fahrerkasse — not the raw stop totals,
	// which would double-count cash already handed over on previous trips.
	frappe.call({
		method: 'getraenkehandel.getraenkehandel.delivery.get_driver_cash_balance',
		args: { driver: frm.doc.driver, company: frm.doc.company },
		callback(r) {
			const balance = flt(r.message);

			// Show stop total as reference alongside the real balance
			const stops = frm.doc.delivery_stops || [];
			const stopTotal = stops.reduce((sum, s) => sum + flt(s.custom_cash_collected), 0);

			const d = new frappe.ui.Dialog({
				title: __('Kassenabrechnung — {0}', [frm.doc.driver_name || frm.doc.driver]),
				fields: [
					{
						fieldname: 'info',
						fieldtype: 'HTML',
						options: `<div class="alert alert-info" style="font-size:13px">
							<div style="display:flex;gap:24px;flex-wrap:wrap">
								<span>${__('Guthaben Fahrerkasse (aktuell)')}: <b>€ ${balance.toFixed(2)}</b></span>
								<span style="color:#888">${__('Barzahlungen laut Tour')}: € ${stopTotal.toFixed(2)}</span>
							</div>
						</div>`,
					},
					{
						fieldname: 'amount',
						fieldtype: 'Currency',
						label: __('Übergabebetrag (€)'),
						default: balance > 0 ? balance : 0,
						description: __('Kann vom Kontoguthaben abweichen (z.B. Wechselgeld).'),
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
				primary_action_label: __('Kassenabrechnung buchen'),
				primary_action(values) {
					frappe.call({
						method: 'getraenkehandel.getraenkehandel.delivery.handover_driver_cash',
						args: {
							driver: frm.doc.driver,
							amount: values.amount,
							company: frm.doc.company,
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
