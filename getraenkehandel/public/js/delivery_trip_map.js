// Delivery Trip — OSRM open-source routing + Leaflet interactive map
// Overrides "Calculate Estimated Arrival Times" and "Optimize Route" buttons.
// Uses OSRM public API (no key required). Leaflet loaded from CDN.

const GK_DT_OSRM        = 'https://router.project-osrm.org';
const GK_DT_LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const GK_DT_LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

// ── Leaflet CDN loader ────────────────────────────────────────────────────────
function gk_dt_load_leaflet(cb) {
	if (window.L && window.L.map) { cb(); return; }
	if (!document.querySelector(`link[href="${GK_DT_LEAFLET_CSS}"]`)) {
		const link = document.createElement('link');
		link.rel = 'stylesheet'; link.href = GK_DT_LEAFLET_CSS;
		document.head.appendChild(link);
	}
	if (!document.querySelector(`script[src="${GK_DT_LEAFLET_JS}"]`)) {
		const s = document.createElement('script');
		s.src = GK_DT_LEAFLET_JS; s.onload = cb;
		document.head.appendChild(s);
	} else {
		const poll = setInterval(() => { if (window.L && window.L.map) { clearInterval(poll); cb(); } }, 50);
	}
}

// ── Form events ───────────────────────────────────────────────────────────────
frappe.ui.form.on('Delivery Trip', {
	refresh(frm) {
		setTimeout(() => gk_dt_setup(frm), 200);
	},
});

// ── Setup: override buttons + render map ─────────────────────────────────────
function gk_dt_setup(frm) {
	// Override button field click handlers — intercept before Frappe triggers the
	// form event so the original ERPNext Google Maps handler never runs.
	const $calcBtn = $(frm.fields_dict.calculate_arrival_time.wrapper).find('button');
	const $optBtn  = $(frm.fields_dict.optimize_route.wrapper).find('button');

	$calcBtn.off('click').on('click', (e) => { e.stopImmediatePropagation(); gk_dt_calculate_eta(frm); });
	$optBtn.off('click').on('click',  (e) => { e.stopImmediatePropagation(); gk_dt_optimize(frm); });

	// Destroy existing Leaflet instance before removing its container div
	if (frm._gk_dt_map) {
		frm._gk_dt_map.remove();
		frm._gk_dt_map = null;
	}

	// Build / rebuild the map container below the buttons section
	$(frm.wrapper).find('.gk-dt-map-section').remove();
	const startLabel = frm.doc.driver_address || '';
	const $wrap = $(`
		<div class="gk-dt-map-section" style="margin:16px 0 8px">

			<!-- Startpunkt row -->
			<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;
			            padding:10px 14px;background:#f8fafb;border:1px solid #e2e8f0;
			            border-radius:6px;font-size:12px">
				<span style="font-weight:600;color:#374151;white-space:nowrap">🚚 Startpunkt:</span>
				<span class="gk-dt-start-label" style="flex:1;color:${startLabel ? '#16a34a' : '#9ca3af'}">
					${startLabel
						? frappe.utils.escape_html(startLabel)
						: 'Nicht gesetzt — Route startet beim 1. Stopp'}
				</span>
				<button class="btn btn-xs btn-default gk-dt-start-btn" style="white-space:nowrap">
					${startLabel ? '✏️ Ändern' : '+ Startpunkt setzen'}
				</button>
				${startLabel ? `<button class="btn btn-xs btn-danger gk-dt-start-clear" style="white-space:nowrap">✕ Entfernen</button>` : ''}
			</div>

			<div class="gk-dt-map-stats" style="
				display:none;padding:10px 14px;margin-bottom:8px;
				background:#f8fafb;border:1px solid #e2e8f0;border-radius:6px;
				font-size:12px;color:#555;display:flex;gap:24px;align-items:center">
			</div>
			<div class="gk-dt-map" style="
				height:460px;border-radius:8px;border:1px solid #d1d8dd;
				overflow:hidden;background:#f0f0f0">
				<div style="display:flex;align-items:center;justify-content:center;
				            height:100%;color:#aaa;font-size:13px">
					Stopps laden …
				</div>
			</div>
			<div style="margin-top:4px;display:flex;justify-content:flex-end">
				<a href="https://www.openstreetmap.org/copyright" target="_blank"
				   style="font-size:11px;color:#aaa">© OpenStreetMap / OSRM</a>
			</div>
		</div>
	`);

	$(frm.fields_dict.optimize_route.wrapper).after($wrap);

	// Startpunkt setzen / ändern
	$wrap.find('.gk-dt-start-btn').on('click', () => {
		frappe.prompt(
			[{
				fieldname: 'address',
				fieldtype: 'Link',
				label: 'Startadresse (Depot / Lager / Fahrer)',
				options: 'Address',
				reqd: 1,
				default: frm.doc.driver_address || '',
				description: 'Diese Adresse muss Koordinaten haben (über die Adresskarte setzen).',
			}],
			async ({ address }) => {
				await frm.set_value('driver_address', address);
				frm.dirty();
				gk_dt_setup(frm);   // re-render section with new start
			},
			'Startpunkt setzen',
			'Übernehmen'
		);
	});

	// Startpunkt entfernen
	$wrap.find('.gk-dt-start-clear').on('click', async () => {
		await frm.set_value('driver_address', '');
		frm.dirty();
		gk_dt_setup(frm);
	});

	if (frm.doc.delivery_stops && frm.doc.delivery_stops.length) {
		gk_dt_load_leaflet(() => {
			// Restore saved route on load — no OSRM call needed
			let savedPolyline = null, savedStats = null;
			try { if (frm.doc.custom_route_polyline) savedPolyline = JSON.parse(frm.doc.custom_route_polyline); } catch (_) {}
			try { if (frm.doc.custom_route_stats)    savedStats    = JSON.parse(frm.doc.custom_route_stats);    } catch (_) {}

			if (savedPolyline && savedPolyline.geometry) {
				gk_dt_render_map(frm, savedPolyline.geometry, savedPolyline.firstLegGeo || null, savedStats);
			} else {
				gk_dt_render_map(frm);
			}
		});
	} else {
		$wrap.find('.gk-dt-map').html(
			'<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:13px">Noch keine Stopps hinzugefügt</div>'
		);
	}
}

// ── Collect coordinates for all stops + optional driver start ─────────────────
// Treats 0,0 as "not set" — it's the DB default, not a real German address coord.
function _valid_coord(v) { return v && Math.abs(parseFloat(v)) > 0.0001; }

async function gk_dt_get_waypoints(frm) {
	const waypoints = [];

	// Driver address as start point (optional)
	if (frm.doc.driver_address) {
		try {
			const dr = await frappe.db.get_value(
				'Address', frm.doc.driver_address,
				['custom_latitude', 'custom_longitude', 'address_line1', 'city', 'pincode', 'country']
			);
			const { custom_latitude, custom_longitude, address_line1, city, pincode, country } = dr.message || {};

			let startLat = _valid_coord(custom_latitude) ? parseFloat(custom_latitude) : null;
			let startLng = _valid_coord(custom_longitude) ? parseFloat(custom_longitude) : null;

			// If the address has no stored coordinates, geocode it on-the-fly with Nominatim
			if (!startLat || !startLng) {
				const q = [address_line1, pincode, city, country].filter(Boolean).join(', ');
				if (q) {
					try {
						const gRes  = await fetch(
							'https://nominatim.openstreetmap.org/search?' +
							new URLSearchParams({ q, format: 'json', limit: 1, countrycodes: 'de,at,ch' }),
							{ headers: { 'Accept-Language': 'de' } }
						);
						const gData = await gRes.json();
						if (gData.length) {
							startLat = parseFloat(gData[0].lat);
							startLng = parseFloat(gData[0].lon);
						}
					} catch (_) { /* geocoding failed — proceed without start pin */ }
				}
			}

			if (startLat && startLng) {
				waypoints.push({ type: 'start', lat: startLat, lng: startLng,
				                 label: `Start: ${address_line1 || ''} ${city || ''}`.trim() });
			}
		} catch (_) { /* no driver address record — proceed without start pin */ }
	}

	// Delivery stops
	for (const stop of (frm.doc.delivery_stops || [])) {
		let lat = _valid_coord(stop.lat) ? parseFloat(stop.lat) : null;
		let lng = _valid_coord(stop.lng) ? parseFloat(stop.lng) : null;

		// Fall back to Address custom fields when stop coords are blank/zero
		if ((!lat || !lng) && stop.address) {
			try {
				const ar = await frappe.db.get_value(
					'Address', stop.address,
					['custom_latitude', 'custom_longitude']
				);
				const { custom_latitude, custom_longitude } = ar.message || {};
				if (_valid_coord(custom_latitude)) lat = parseFloat(custom_latitude);
				if (_valid_coord(custom_longitude)) lng = parseFloat(custom_longitude);
			} catch (_) { /* skip */ }
		}

		waypoints.push({
			type: 'stop',
			stop,
			lat,
			lng,
			label: stop.customer || 'Stop',
			address: stop.customer_address || '',
			addressLink: stop.address || null,
		});
	}

	return waypoints;
}

// ── Render Leaflet map ────────────────────────────────────────────────────────
async function gk_dt_render_map(frm, routeGeoJSON, firstLegGeoJSON, savedStats) {
	const waypoints = await gk_dt_get_waypoints(frm);
	const valid     = waypoints.filter(w => w.lat && w.lng);

	const $mapEl = $(frm.wrapper).find('.gk-dt-map');

	if (!valid.length) {
		const missing = waypoints.filter(w => w.type === 'stop');
		$mapEl.html(_missing_coords_html(missing));
		return;
	}

	// Warn about stops that have no coords but still render the rest
	const noCoords = waypoints.filter(w => w.type === 'stop' && (!w.lat || !w.lng));
	if (noCoords.length) {
		const $warn = $(frm.wrapper).find('.gk-dt-coord-warn');
		if (!$warn.length) {
			$('<div class="gk-dt-coord-warn"></div>').insertBefore($(frm.wrapper).find('.gk-dt-map'));
		}
		$(frm.wrapper).find('.gk-dt-coord-warn').html(_missing_coords_html(noCoords, true));
	} else {
		$(frm.wrapper).find('.gk-dt-coord-warn').remove();
	}

	// Create or reuse map instance
	if (!frm._gk_dt_map) {
		$mapEl.html(''); // clear placeholder
		frm._gk_dt_map = L.map($mapEl[0], { scrollWheelZoom: true });
		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '© OpenStreetMap contributors', maxZoom: 19,
		}).addTo(frm._gk_dt_map);
	} else {
		// Clear previous layers except tile layer
		frm._gk_dt_map.eachLayer(layer => {
			if (!(layer instanceof L.TileLayer)) frm._gk_dt_map.removeLayer(layer);
		});
	}

	const map   = frm._gk_dt_map;
	const bounds = [];
	let stopNum = 0;

	// Draw stop-to-stop route (solid blue)
	if (routeGeoJSON) {
		const coords = routeGeoJSON.coordinates.map(([lng, lat]) => [lat, lng]);
		L.polyline(coords, { color: '#3b82f6', weight: 4, opacity: 0.85 }).addTo(map);
	}

	// First leg (depot / driver → stop 1): dashed amber, drawn on top of blue line
	if (firstLegGeoJSON) {
		const coords = firstLegGeoJSON.coordinates.map(([lng, lat]) => [lat, lng]);
		L.polyline(coords, {
			color: '#f59e0b', weight: 4, opacity: 0.95,
			dashArray: '12 8',
		}).addTo(map);
	}

	// Add markers
	waypoints.forEach(wp => {
		if (!wp.lat || !wp.lng) return;
		bounds.push([wp.lat, wp.lng]);

		let marker;
		if (wp.type === 'start') {
			marker = L.marker([wp.lat, wp.lng], { icon: _start_icon() });
			marker.bindPopup(`<b>🚚 Startpunkt</b><br>${wp.label}`);
		} else {
			stopNum++;
			marker = L.marker([wp.lat, wp.lng], { icon: _stop_icon(stopNum) });
			const eta = wp.stop.estimated_arrival
				? `<br><span style="color:#555">ETA: ${frappe.datetime.str_to_user(wp.stop.estimated_arrival)}</span>`
				: '';
			const dist = wp.stop.distance ? `<br><span style="color:#888">${wp.stop.distance.toFixed(1)} km</span>` : '';
			marker.bindPopup(
				`<b>${stopNum}. ${frappe.utils.escape_html(wp.label)}</b>${eta}${dist}` +
				(wp.address ? `<br><small style="color:#999">${frappe.utils.escape_html(wp.address)}</small>` : '')
			);
		}
		marker.addTo(map);
	});

	if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
	setTimeout(() => map.invalidateSize(), 150);

	// Restore stats bar if loading from saved data
	if (savedStats) {
		_update_stats(frm, savedStats.stops, savedStats.km, savedStats.mins);
	}
}

// ── Numbered stop icon ────────────────────────────────────────────────────────
function _stop_icon(n) {
	return L.divIcon({
		html: `<div style="background:#3b82f6;color:#fff;width:30px;height:30px;border-radius:50%;
		             display:flex;align-items:center;justify-content:center;font-size:13px;
		             font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff;
		             box-sizing:border-box">${n}</div>`,
		className: '', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16],
	});
}

function _start_icon() {
	return L.divIcon({
		html: `<div style="background:#16a34a;color:#fff;width:34px;height:34px;border-radius:50%;
		             display:flex;align-items:center;justify-content:center;font-size:18px;
		             box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff;box-sizing:border-box">🚚</div>`,
		className: '', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18],
	});
}

// ── Calculate ETA via OSRM route ──────────────────────────────────────────────
async function gk_dt_calculate_eta(frm) {
	frappe.show_alert({ message: 'Berechne Ankunftszeiten …', indicator: 'orange' });

	const waypoints = await gk_dt_get_waypoints(frm);
	const valid = waypoints.filter(w => w.lat && w.lng);

	if (valid.length < 2) {
		const stops = waypoints.filter(w => w.type === 'stop');
		frappe.msgprint({
			title: 'Koordinaten fehlen',
			message: _missing_coords_html(stops),
			indicator: 'orange',
		});
		return;
	}

	const coords = valid.map(w => `${w.lng},${w.lat}`).join(';');
	const url = `${GK_DT_OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;

	let data;
	try {
		const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
		data = await res.json();
	} catch (_) {
		frappe.msgprint({ message: 'OSRM nicht erreichbar. Internetverbindung prüfen.', indicator: 'red' });
		return;
	}

	if (data.code !== 'Ok' || !data.routes.length) {
		frappe.msgprint({ message: 'OSRM konnte keine Route berechnen.', indicator: 'red' });
		return;
	}

	const route    = data.routes[0];
	const legs     = route.legs;
	const geometry = route.geometry;

	// Parse departure time (use now if not set)
	let cursor = frm.doc.departure_time
		? moment(frm.doc.departure_time)
		: moment();

	const stopWaypoints = valid.filter(w => w.type === 'stop');
	let totalDist = 0;

	legs.forEach((leg, i) => {
		const durationMin = leg.duration / 60;
		const distKm      = leg.distance / 1000;
		cursor = cursor.clone().add(durationMin, 'minutes');

		const target = valid[i + 1];
		if (target && target.type === 'stop') {
			const stopDoc = target.stop;
			stopDoc.estimated_arrival = cursor.format('YYYY-MM-DD HH:mm:ss');
			stopDoc.distance = parseFloat(distKm.toFixed(3));

			const row = frm.fields_dict.delivery_stops.grid.get_row(stopDoc.name);
			if (row) { row.refresh_field('estimated_arrival'); row.refresh_field('distance'); }

			totalDist += distKm;
		}
	});

	frm.doc.total_distance = parseFloat(totalDist.toFixed(3));
	frm.refresh_field('total_distance');
	frm.dirty();

	const totalMins = Math.round(route.duration / 60);
	const totalKm   = (route.distance / 1000).toFixed(1);

	_update_stats(frm, stopWaypoints.length, totalKm, totalMins);
	frappe.show_alert({ message: `Route berechnet: ${totalKm} km, ${_fmt_mins(totalMins)}`, indicator: 'green' });

	// Fetch separate geometry for the first leg so it can be drawn differently
	let firstLegGeo = null;
	const hasStart  = valid[0] && valid[0].type === 'start';
	const firstStop = valid.find(w => w.type === 'stop');
	if (hasStart && firstStop) {
		try {
			const firstUrl = `${GK_DT_OSRM}/route/v1/driving/` +
				`${valid[0].lng},${valid[0].lat};${firstStop.lng},${firstStop.lat}` +
				`?overview=full&geometries=geojson&steps=false`;
			const firstRes  = await fetch(firstUrl, { headers: { 'Accept': 'application/json' } });
			const firstData = await firstRes.json();
			if (firstData.code === 'Ok' && firstData.routes.length) {
				firstLegGeo = firstData.routes[0].geometry;
			}
		} catch (_) { /* non-critical */ }
	}

	gk_dt_render_map(frm, geometry, firstLegGeo);

	// Persist route so it is restored on next page load without re-calling OSRM
	frm.set_value('custom_route_polyline', JSON.stringify({
		geometry:    geometry,
		firstLegGeo: firstLegGeo,
	}));
	frm.set_value('custom_route_stats', JSON.stringify({
		stops: stopWaypoints.length,
		km:    totalKm,
		mins:  totalMins,
	}));
}

// ── Optimize route via OSRM table + nearest-neighbour TSP ────────────────────
async function gk_dt_optimize(frm) {
	frappe.show_alert({ message: 'Route wird optimiert …', indicator: 'orange' });

	const waypoints = await gk_dt_get_waypoints(frm);
	const valid = waypoints.filter(w => w.lat && w.lng);

	if (valid.length < 2) {
		const stops = waypoints.filter(w => w.type === 'stop');
		frappe.msgprint({
			title: 'Koordinaten fehlen',
			message: _missing_coords_html(stops),
			indicator: 'orange',
		});
		return;
	}

	// ── Fetch duration matrix ────────────────────────────────────────────────
	const coords   = valid.map(w => `${w.lng},${w.lat}`).join(';');
	const tableUrl = `${GK_DT_OSRM}/table/v1/driving/${coords}`;

	let matrix;
	try {
		const res  = await fetch(tableUrl, { headers: { 'Accept': 'application/json' } });
		const data = await res.json();
		if (data.code !== 'Ok' || !data.durations) {
			frappe.msgprint({ message: 'OSRM Entfernungsmatrix konnte nicht abgerufen werden.', indicator: 'red' });
			return;
		}
		matrix = data.durations;
	} catch (_) {
		frappe.msgprint({ message: 'OSRM nicht erreichbar. Internetverbindung prüfen.', indicator: 'red' });
		return;
	}

	// ── Nearest-neighbour TSP ────────────────────────────────────────────────
	const stopIdxs    = valid.map((w, i) => w.type === 'stop' ? i : null).filter(i => i !== null);
	const orderedIdxs = _nearest_neighbour(matrix, 0, stopIdxs);
	const newStops    = orderedIdxs.map(i => valid[i].stop);

	// ── Reorder child table ──────────────────────────────────────────────────
	frm.doc.delivery_stops = newStops.map((s, i) => ({ ...s, idx: i + 1 }));
	frm.fields_dict.delivery_stops.grid.refresh();
	frm.dirty();

	frappe.show_alert({ message: 'Reihenfolge optimiert — ETA wird berechnet …', indicator: 'blue' });
	await gk_dt_calculate_eta(frm);
}

// Nearest-neighbour heuristic — O(n²), good enough for ≤ 30 stops.
function _nearest_neighbour(matrix, startIdx, stopIdxs) {
	const unvisited = new Set(stopIdxs);
	const order     = [];
	let   current   = startIdx;

	while (unvisited.size > 0) {
		let nearest = null, minDur = Infinity;
		for (const idx of unvisited) {
			const dur = matrix[current][idx] ?? Infinity;
			if (dur < minDur) { minDur = dur; nearest = idx; }
		}
		if (nearest === null) break;
		order.push(nearest);
		unvisited.delete(nearest);
		current = nearest;
	}

	return order;
}

// ── Update stats bar ──────────────────────────────────────────────────────────
function _update_stats(frm, stops, km, mins) {
	const $stats = $(frm.wrapper).find('.gk-dt-map-stats');
	$stats.html(`
		<span>🚏 <b>${stops}</b> Stopp${stops !== 1 ? 's' : ''}</span>
		<span>📏 <b>${km} km</b> Gesamtstrecke</span>
		<span>⏱ <b>${_fmt_mins(mins)}</b> Fahrzeit</span>
	`).show();
}

function _fmt_mins(mins) {
	const h = Math.floor(mins / 60), m = mins % 60;
	return h ? `${h} Std. ${m} Min.` : `${m} Min.`;
}

// ── Missing-coordinates helper ────────────────────────────────────────────────
function _missing_coords_html(stops, compact) {
	const rows = stops.map(w => {
		const hasCoord = w.lat && w.lng;
		const icon  = hasCoord ? '✅' : '❌';
		const label = frappe.utils.escape_html(w.label);
		const link  = w.addressLink
			? `<a href="/app/address/${encodeURIComponent(w.addressLink)}" target="_blank"
			      style="color:#3b82f6;text-decoration:none">Adresse öffnen →</a>`
			: '<span style="color:#aaa">Kein Adress-Link</span>';
		return `<tr>
			<td style="padding:4px 8px">${icon}</td>
			<td style="padding:4px 8px;font-weight:500">${label}</td>
			<td style="padding:4px 8px;color:#888;font-size:11px">${frappe.utils.escape_html(w.address || '')}</td>
			<td style="padding:4px 8px">${hasCoord ? '' : link}</td>
		</tr>`;
	}).join('');

	const header = compact
		? '<p style="margin:0 0 8px;font-size:12px;color:#b45309">⚠️ Folgende Stopps haben keine Koordinaten und werden übersprungen:</p>'
		: '<p style="margin:0 0 8px">Bitte Koordinaten in der jeweiligen Adresse setzen (Adresse öffnen → Adresse suchen → Speichern):</p>';

	return `${header}
		<table style="border-collapse:collapse;width:100%;font-size:12px">
			<thead><tr style="border-bottom:1px solid #e5e7eb">
				<th style="padding:4px 8px;text-align:left"></th>
				<th style="padding:4px 8px;text-align:left">Kunde</th>
				<th style="padding:4px 8px;text-align:left">Adresse</th>
				<th style="padding:4px 8px;text-align:left">Aktion</th>
			</tr></thead>
			<tbody>${rows}</tbody>
		</table>`;
}
