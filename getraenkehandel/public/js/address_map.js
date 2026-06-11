// Address autocomplete (Nominatim / OpenStreetMap) + Leaflet map
// Attached to the Address doctype via hooks.py doctype_js

const GK_LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const GK_LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const GK_NOMINATIM         = 'https://nominatim.openstreetmap.org/search';
const GK_NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';


function gk_load_leaflet(cb) {
	if (window.L && window.L.map) { cb(); return; }
	if (!document.querySelector(`link[href="${GK_LEAFLET_CSS}"]`)) {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = GK_LEAFLET_CSS;
		document.head.appendChild(link);
	}
	if (!document.querySelector(`script[src="${GK_LEAFLET_JS}"]`)) {
		const s = document.createElement('script');
		s.src = GK_LEAFLET_JS;
		s.onload = cb;
		document.head.appendChild(s);
	} else {
		const poll = setInterval(() => {
			if (window.L && window.L.map) { clearInterval(poll); cb(); }
		}, 50);
	}
}

frappe.ui.form.on('Address', {
	refresh(frm) {
		setTimeout(() => gk_render_address_search(frm), 0);
	},

	// Safety net: re-apply pending coordinates just before the save payload
	// is serialized.  Direct frm.doc assignments on *new* documents are
	// sometimes dropped by Frappe's dirty-tracking; model.set_value handles
	// this, but the before_save hook is a second layer of insurance.
	before_save(frm) {
		if (frm._gk_pending_lat !== undefined && frm._gk_pending_lat !== null) {
			frappe.model.set_value(frm.doctype, frm.docname, 'custom_latitude',  frm._gk_pending_lat);
			frappe.model.set_value(frm.doctype, frm.docname, 'custom_longitude', frm._gk_pending_lng);
		}
	},
});

function gk_render_address_search(frm) {
	// Clean up previous instance
	$(frm.wrapper).find('.gk-address-search').remove();
	if (frm._gk_list) { frm._gk_list.remove(); frm._gk_list = null; }
	frm._gk_map    = null;
	frm._gk_marker = null;

	// When the Address form is opened inside a Quick Entry dialog / modal,
	// showing a full Leaflet map overwhelms the popup.  Keep the search widget
	// (field auto-fill is still useful) but skip the map entirely.
	const inDialog = $(frm.wrapper).closest('.modal, .frappe-dialog').length > 0;

	// ── Build widget (input + map only, no dropdown here) ─────────────────────
	const $ui = $(`
		<div class="gk-address-search" style="margin-bottom:12px">

			<div class="control-label" style="font-size:11px;font-weight:600;color:#8D99A6;margin-bottom:4px">
				ADRESSE SUCHEN
			</div>

			<div class="control-input-wrapper" style="position:relative">
				<input type="text" class="form-control gk-addr-input"
					placeholder="Straße, Hausnummer, PLZ, Ort …"
					autocomplete="off"
					style="padding-right:36px">
				<button class="gk-addr-clear"
					style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
					       background:none;border:none;color:#aaa;font-size:20px;
					       line-height:1;padding:0;cursor:pointer;display:none"
					title="Löschen">×</button>
			</div>

			<div class="gk-addr-map-wrap" style="display:none;margin-top:8px;position:relative;z-index:0;isolation:isolate">
				<div class="gk-addr-map" style="
					height:300px;border-radius:6px;
					border:1px solid #d1d8dd;overflow:hidden;cursor:crosshair">
				</div>
				<div style="margin-top:4px;display:flex;justify-content:space-between;align-items:center">
					<span style="font-size:11px;color:#8D99A6">
						Auf die Karte klicken oder Marker verschieben um Adresse zu setzen
					</span>
					<a href="https://www.openstreetmap.org/copyright" target="_blank"
					   style="font-size:11px;color:#aaa">© OpenStreetMap</a>
				</div>
				<div class="gk-addr-reverse-status" style="
					display:none;margin-top:6px;padding:6px 10px;border-radius:4px;
					background:#f0f7ff;border:1px solid #c8e0ff;
					font-size:12px;color:#1a5fa8;
					white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
				</div>
			</div>

		</div>
	`);

	// Insert before address_title — top of left column, inherits column width
	const anchor = frm.fields_dict.address_title;
	if (anchor && anchor.wrapper) {
		$(anchor.wrapper).before($ui);
	} else {
		$(frm.wrapper).find('.frappe-control').first().before($ui);
	}

	// ── Dropdown list mounted on <body> to escape any overflow/z-index clipping ─
	const $list = $(`
		<ul class="gk-addr-body-list" style="
			display:none;position:fixed;z-index:99999;
			background:#fff;border:1px solid #d1d8dd;border-top:none;
			border-radius:0 0 6px 6px;list-style:none;margin:0;padding:0;
			max-height:260px;overflow-y:auto;
			box-shadow:0 6px 16px rgba(0,0,0,.12)">
		</ul>
	`).appendTo('body');
	frm._gk_list = $list;

	const $input     = $ui.find('.gk-addr-input');
	const $clear     = $ui.find('.gk-addr-clear');
	const $mapWrap   = $ui.find('.gk-addr-map-wrap');
	const $revStatus = $ui.find('.gk-addr-reverse-status');
	const mapEl      = $ui.find('.gk-addr-map')[0];

	let _debounce = null;

	// Position the body-level list directly below the input field
	function _position_list() {
		const r = $input[0].getBoundingClientRect();
		$list.css({ top: r.bottom + 'px', left: r.left + 'px', width: r.width + 'px' });
	}

	function _show_list() {
		_position_list();
		$list.show();
		// Collapse the map while the suggestions dropdown is open so the two
		// overlapping elements don't look like the map is "inside" the popup.
		$mapWrap.hide();
	}

	function _hide_list() {
		$list.hide();
		// Restore the map if coordinates are set (user dismissed without selecting)
		if (!inDialog) {
			const hasCoords = frm._gk_pending_lat
				|| (frm.doc.custom_latitude && Math.abs(parseFloat(frm.doc.custom_latitude)) > 0.0001);
			if (hasCoords) $mapWrap.show();
		}
	}

	// ── show existing coordinates on load ──────────────────────────────────────
	if (!inDialog) {
		const lat0 = frm.doc.custom_latitude;
		const lon0 = frm.doc.custom_longitude;
		if (lat0 && lon0) {
			$mapWrap.show();
			gk_load_leaflet(() => setTimeout(() => _init_or_move_map(lat0, lon0), 120));
		}
	}

	// ── input handler ──────────────────────────────────────────────────────────
	$input.on('input', function () {
		const q = this.value.trim();
		$clear.toggle(q.length > 0);
		clearTimeout(_debounce);
		if (q.length < 3) { _hide_list(); return; }
		$list.html('<li style="padding:10px 14px;color:#aaa;font-size:13px">Suche …</li>');
		_show_list();
		_debounce = setTimeout(() => _search(q), 380);
	});

	$input.on('keydown', function (e) {
		if (e.key === 'Escape') { _hide_list(); }
	});

	$clear.on('click', function () {
		$input.val('').trigger('input');
		_hide_list();
	});

	// Dismiss list when clicking anywhere outside the input or list
	$(document).on('mousedown.gk_addr_' + frm.docname, function (e) {
		const inInput = $(e.target).closest('.gk-address-search').length > 0;
		const inList  = $(e.target).closest('.gk-addr-body-list').length > 0;
		if (!inInput && !inList) _hide_list();
	});

	// Cleanup on page navigation
	frm.on('after_save', _cleanup);
	$(frm.wrapper).on('remove', _cleanup);
	function _cleanup() {
		$(document).off('mousedown.gk_addr_' + frm.docname);
		$list.remove();
	}

	// ── Nominatim search ────────────────────────────────────────────────────────
	async function _search(q) {
		try {
			const url = GK_NOMINATIM + '?' + new URLSearchParams({
				q, format: 'json', addressdetails: 1, limit: 6,
			});
			// Accept-Language: en so Nominatim returns English country names that
			// match ERPNext's Country table ("Germany" not "Deutschland").
			const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
			_render_list(await res.json());
		} catch (_) {
			$list.html('<li style="padding:10px 14px;color:#c00;font-size:13px">Verbindung fehlgeschlagen</li>');
			_show_list();
		}
	}

	function _render_list(results) {
		$list.empty();
		if (!results.length) {
			$list.html('<li style="padding:10px 14px;color:#aaa;font-size:13px">Keine Ergebnisse gefunden</li>');
			_show_list();
			return;
		}
		results.forEach(r => {
			const label = _format_label(r);
			const $li = $(`
				<li style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f4f7">
					<div style="font-size:13px;font-weight:500;color:#333">${frappe.utils.escape_html(label)}</div>
					<div style="font-size:11px;color:#8D99A6;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
						${frappe.utils.escape_html(r.display_name)}
					</div>
				</li>
			`);
			$li.on('mouseenter', () => $li.css('background', '#f7fbff'));
			$li.on('mouseleave', () => $li.css('background', ''));
			$li.on('mousedown', function (e) {
				// mousedown fires before blur — prevent input from losing focus
				e.preventDefault();
				_select(r, label);
			});
			$list.append($li);
		});
		_show_list();
	}

	function _format_label(r) {
		const a = r.address || {};
		return [
			[a.road, a.house_number].filter(Boolean).join(' '),
			a.postcode,
			a.city || a.town || a.village || a.municipality || a.suburb,
		].filter(Boolean).join(', ') || r.display_name.split(',').slice(0, 3).join(',').trim();
	}

	// ── select a search result ──────────────────────────────────────────────────
	function _select(r, label) {
		_hide_list();
		$input.val(label);
		$clear.show();

		_fill_fields(r, parseFloat(r.lat), parseFloat(r.lon), label);

		if (!inDialog) {
			$mapWrap.show();
			gk_load_leaflet(() => setTimeout(() => _init_or_move_map(parseFloat(r.lat), parseFloat(r.lon)), 80));
		}
	}

	// ── shared field filler ──────────────────────────────────────────────────────
	function _fill_fields(r, lat, lon, label) {
		const a    = r.address || {};
		const city = a.city || a.town || a.village || a.municipality || a.suburb || '';

		// Stash on frm so the before_save hook can re-apply if needed
		frm._gk_pending_lat = lat;
		frm._gk_pending_lng = lon;

		// Use frappe.model.set_value for all fields — this properly registers each
		// change in Frappe's dirty-tracking for both new and existing documents.
		const vals = {
			address_line1: [a.road, a.house_number].filter(Boolean).join(' '),
			city:          city,
			state:         a.state    || '',
			pincode:       a.postcode || '',
			country:       a.country || 'Germany',
			address_title: label || city || frm.doc.address_line1 || 'Adresse',
		};
		Object.entries(vals).forEach(([f, v]) =>
			frappe.model.set_value(frm.doctype, frm.docname, f, v)
		);

		// Coordinates: model.set_value works even when the field has never been
		// touched — no guard needed.  Falls back silently if field doesn't exist.
		frappe.model.set_value(frm.doctype, frm.docname, 'custom_latitude',  lat);
		frappe.model.set_value(frm.doctype, frm.docname, 'custom_longitude', lon);

		frm.dirty();
		['address_title', 'address_line1', 'city', 'state', 'pincode', 'country',
		 'custom_latitude', 'custom_longitude'].forEach(f => frm.refresh_field(f));
	}

	// ── Nominatim reverse geocode ────────────────────────────────────────────────
	async function _reverse_geocode(lat, lon) {
		$revStatus.text('Adresse wird ermittelt …').show();
		try {
			const url = GK_NOMINATIM_REVERSE + '?' + new URLSearchParams({
				lat, lon, format: 'json', addressdetails: 1,
			});
			const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
			const data = await res.json();
			if (data.error) {
				$revStatus.text('Keine Adresse an dieser Position gefunden.')
					.css({ background: '#fff4f0', 'border-color': '#ffc0b0', color: '#c00' });
				return;
			}
			const label = _format_label(data);
			_fill_fields(data, lat, lon, label);
			$input.val(label);
			$clear.show();
			$revStatus.text('✓ ' + (data.display_name || label))
				.css({ background: '#f0fff4', 'border-color': '#a8e6b8', color: '#1a6b34' })
				.show();
		} catch (_) {
			$revStatus.text('Verbindung zu Nominatim fehlgeschlagen.')
				.css({ background: '#fff4f0', 'border-color': '#ffc0b0', color: '#c00' })
				.show();
		}
	}

	// ── Leaflet map ─────────────────────────────────────────────────────────────
	function _init_or_move_map(lat, lon) {
		if (inDialog) return;
		if (!frm._gk_map) {
			frm._gk_map = L.map(mapEl, { scrollWheelZoom: false }).setView([lat, lon], 16);
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '© OpenStreetMap contributors',
				maxZoom: 19,
			}).addTo(frm._gk_map);

			frm._gk_marker = L.marker([lat, lon], { draggable: true }).addTo(frm._gk_map);

			frm._gk_marker.on('dragend', function () {
				const pos = frm._gk_marker.getLatLng();
				_update_coords_and_reverse(pos.lat, pos.lng);
			});
			frm._gk_map.on('click', function (e) {
				const { lat: clat, lng: clon } = e.latlng;
				frm._gk_marker.setLatLng([clat, clon]);
				_update_coords_and_reverse(clat, clon);
			});
		} else {
			frm._gk_map.setView([lat, lon], 16);
			frm._gk_marker.setLatLng([lat, lon]);
		}
		setTimeout(() => frm._gk_map && frm._gk_map.invalidateSize(), 150);
	}

	function _update_coords_and_reverse(lat, lon) {
		if (inDialog) return;
		frm._gk_pending_lat = lat;
		frm._gk_pending_lng = lon;
		frappe.model.set_value(frm.doctype, frm.docname, 'custom_latitude',  lat);
		frappe.model.set_value(frm.doctype, frm.docname, 'custom_longitude', lon);
		frm.refresh_field('custom_latitude');
		frm.refresh_field('custom_longitude');
		frm.dirty();
		_reverse_geocode(lat, lon);
	}
}
