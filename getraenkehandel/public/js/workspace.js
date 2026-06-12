frappe.provide('getraenkehandel');

const HIDE_WORKSPACES = [
	// ERPNext modules not relevant for Getränkehandel
	'Manufacturing', 'CRM', 'Projects', 'Quality', 'Support',
	'ERPNext Integrations', 'Integrations', 'Website', 'Assets',
	'Build', 'Welcome Workspace',
	// Admin / developer workspaces — operators should not see these
	'ERPNext Settings', 'Settings', 'Users', 'Tools',
	// Default home replaced by Getraenkehandel workspace
	'Home',
];

// ---------------------------------------------------------------------------
// Function definitions — must come before any event listeners that call them
// ---------------------------------------------------------------------------

getraenkehandel.redirect_to_default = function () {
	const path = window.location.pathname.replace(/\/$/, '');
	// Redirect bare /app and /app/home to the Getraenkehandel workspace
	if (path === '/app' || path === '/app/home') {
		frappe.set_route('Workspaces', 'Getraenkehandel');
	}
};

getraenkehandel.apply_ui_customizations = function () {
	setTimeout(getraenkehandel._hide_sidebar_items, 300);
};

getraenkehandel._hide_sidebar_items = function () {
	HIDE_WORKSPACES.forEach(function (ws) {
		// Frappe v15: sidebar items have data-label on the anchor
		$(`[data-label="${ws}"]`).closest('.standard-sidebar-item, li').hide();
		// Fallback: match by title attribute or text
		$(`.desk-sidebar a[title="${ws}"]`).closest('.standard-sidebar-item, li').hide();
	});
};

getraenkehandel.maybe_show_setup_wizard = function () {
	if (frappe._getraenkehandel_setup_checked) return;
	frappe._getraenkehandel_setup_checked = true;

	// Skip on login/setup pages
	const route = frappe.get_route();
	if (!route || !route[0]) return;
	if (['login', 'getraenkehandel-setup'].includes(route[0])) return;

	const company = frappe.defaults.get_default('company');
	if (!company) return;

	frappe.db.get_value('Company', company, 'custom_setup_complete', function (r) {
		if (r && !r.custom_setup_complete) {
			getraenkehandel.show_setup_wizard();
		}
	});
};

getraenkehandel.show_setup_wizard = function () {
	const company = frappe.defaults.get_default('company');

	const step1 = new frappe.ui.Dialog({
		title: __('Willkommen bei Getraenkehandel — Schritt 1 von 4'),
		fields: [
			{
				label: __('Firmenname'), fieldname: 'company_name',
				fieldtype: 'Data', read_only: 1,
			},
			{
				label: __('Steuernummer / USt-IdNr'), fieldname: 'tax_id',
				fieldtype: 'Data', reqd: 1,
				description: __('Pflichtangabe auf allen Ausgangsrechnungen (§14 UStG)'),
			},
			{ fieldtype: 'Column Break' },
			{
				label: __('Stadt'), fieldname: 'city',
				fieldtype: 'Data',
			},
			{
				label: __('PLZ'), fieldname: 'pincode',
				fieldtype: 'Data',
			},
		],
		primary_action_label: __('Weiter →'),
		primary_action(values) {
			step1.hide();
			frappe.db.set_value('Company', company, { tax_id: values.tax_id }).then(() => {
				getraenkehandel._show_setup_step2();
			});
		},
		secondary_action_label: __('Überspringen'),
		secondary_action() {
			step1.hide();
			getraenkehandel._complete_setup();
		},
	});

	frappe.db.get_value('Company', company, ['company_name', 'tax_id'], function (r) {
		if (r) {
			step1.set_value('company_name', r.company_name || '');
			step1.set_value('tax_id', r.tax_id || '');
		}
	});

	step1.show();
};

getraenkehandel._show_setup_step2 = function () {
	const company = frappe.defaults.get_default('company');

	const step2 = new frappe.ui.Dialog({
		title: __('Kontenrahmen — Schritt 2 von 4'),
		fields: [
			{
				label: __('Kontenrahmen'),
				fieldname: 'coa_label',
				fieldtype: 'HTML',
				options: `<div class="alert alert-info">
					<b>SKR03</b> ist in der Getränkebranche üblich und bereits eingerichtet.
					Sprechen Sie mit Ihrem Steuerberater falls Sie SKR04 benötigen.
				</div>`,
			},
			{
				label: __('Kleinunternehmer (§19 UStG)'),
				fieldname: 'kleinunternehmer',
				fieldtype: 'Check',
				description: __('Ankreuzen wenn Ihr Jahresumsatz unter 22.000 € liegt und Sie keine MwSt ausweisen'),
			},
		],
		primary_action_label: __('Weiter →'),
		primary_action(values) {
			step2.hide();
			frappe.db.set_value('Company', company, {
				custom_kleinunternehmer: values.kleinunternehmer,
			}).then(() => {
				getraenkehandel._show_setup_step3();
			});
		},
		secondary_action_label: __('← Zurück'),
		secondary_action() {
			step2.hide();
			getraenkehandel.show_setup_wizard();
		},
	});

	frappe.db.get_value('Company', company, 'custom_kleinunternehmer', function (r) {
		if (r) step2.set_value('kleinunternehmer', r.custom_kleinunternehmer || 0);
	});

	step2.show();
};

getraenkehandel._show_setup_step3 = function () {
	const step3 = new frappe.ui.Dialog({
		title: __('Sortiment — Schritt 3 von 4'),
		fields: [
			{
				fieldtype: 'HTML',
				options: `<p class="text-muted">
					Wählen Sie Ihre Sortimentsbereiche. Alle Standardartikel sind bereits angelegt —
					Sie können jederzeit eigene Artikel hinzufügen.
				</p>`,
			},
			{ label: __('Bier'), fieldname: 'cat_bier', fieldtype: 'Check', default: 1 },
			{ label: __('Wasser'), fieldname: 'cat_wasser', fieldtype: 'Check', default: 1 },
			{ label: __('Softdrinks'), fieldname: 'cat_softdrinks', fieldtype: 'Check', default: 1 },
			{ fieldtype: 'Column Break' },
			{ label: __('Säfte'), fieldname: 'cat_saefte', fieldtype: 'Check', default: 1 },
			{ label: __('Spirituosen'), fieldname: 'cat_spirituosen', fieldtype: 'Check', default: 0 },
		],
		primary_action_label: __('Weiter →'),
		primary_action() {
			step3.hide();
			getraenkehandel._show_setup_step4();
		},
		secondary_action_label: __('← Zurück'),
		secondary_action() {
			step3.hide();
			getraenkehandel._show_setup_step2();
		},
	});

	step3.show();
};

getraenkehandel._show_setup_step4 = function () {
	const step4 = new frappe.ui.Dialog({
		title: __('Einrichtung abgeschlossen — Schritt 4 von 4'),
		fields: [
			{
				fieldtype: 'HTML',
				options: `<div style="text-align:center; padding: 16px 0;">
					<div style="font-size: 3rem; margin-bottom: 16px;">✅</div>
					<h3>Ihr Getraenkehandel ist eingerichtet!</h3>
					<p class="text-muted" style="margin-bottom: 16px;">Sie können jetzt Ihre ersten Rechnungen erstellen.</p>
					<ul style="text-align:left; max-width: 380px; margin: 0 auto; line-height: 2;">
						<li>Pfand wird automatisch auf jeder Rechnung berechnet</li>
						<li>Rechnungen werden GoBD-konform archiviert</li>
						<li>DATEV-Export für Ihren Steuerberater verfügbar</li>
					</ul>
				</div>`,
			},
		],
		primary_action_label: __('🚀 Erste Rechnung erstellen'),
		primary_action() {
			step4.hide();
			getraenkehandel._complete_setup();
			frappe.new_doc('Sales Invoice');
		},
		secondary_action_label: __('Zum Dashboard'),
		secondary_action() {
			step4.hide();
			getraenkehandel._complete_setup();
		},
	});

	step4.show();
};

getraenkehandel._complete_setup = function () {
	const company = frappe.defaults.get_default('company');
	frappe.db.set_value('Company', company, 'custom_setup_complete', 1);
};

// ---------------------------------------------------------------------------
// Event listeners — registered after all functions are defined
// ---------------------------------------------------------------------------

$(document).on('page-change', function () {
	getraenkehandel.redirect_to_default();
	getraenkehandel.apply_ui_customizations();
});

frappe.after_ajax(function () {
	getraenkehandel.redirect_to_default();
	getraenkehandel.apply_ui_customizations();
	getraenkehandel.maybe_show_setup_wizard();
});
