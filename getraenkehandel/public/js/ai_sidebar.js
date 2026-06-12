/* Getraenkehandel AI Chat Widget
 * Floating chat button injected on every desk page.
 * Calls getraenkehandel.getraenkehandel.ai.ask() on the server.
 */

frappe.provide('getraenkehandel.ai');

const GK_AI_QUICK = [
	__('Wie viel haben wir heute verkauft?'),
	__('Welche Rechnungen sind noch offen?'),
	__('Wie viel Pfand ist ausstehend?'),
];

// ── Boot ──────────────────────────────────────────────────────────────────────

function _gkAiMaybeInit() {
	if (frappe.session && frappe.session.user && frappe.session.user !== 'Guest') {
		getraenkehandel.ai.init();
	}
}

// page-change fires on every desk route change — primary trigger
$(document).on('page-change', _gkAiMaybeInit);

// after_ajax fires after XHR responses — catches initial boot
frappe.after_ajax(_gkAiMaybeInit);

// ── Init ─────────────────────────────────────────────────────────────────────

getraenkehandel.ai.init = function () {
	if (document.getElementById('gk-ai-fab')) return;
	getraenkehandel.ai._history = [];
	getraenkehandel.ai._busy = false;
	getraenkehandel.ai._inject();
};

// ── DOM injection ─────────────────────────────────────────────────────────────

getraenkehandel.ai._inject = function () {
	const quickBtns = GK_AI_QUICK.map(q =>
		`<button class="gk-ai-quick-btn" data-q="${q}">${q}</button>`
	).join('');

	const html = `
<div id="gk-ai-fab">
  <div id="gk-ai-panel" class="gk-hidden">
    <div id="gk-ai-header">
      <div id="gk-ai-header-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none"
             viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813
               a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813
               a4.5 4.5 0 00-3.09 3.091z"/>
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259
               a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6
               l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/>
        </svg>
        KI-Assistent
      </div>
      <button id="gk-ai-close-btn" title="Schließen">✕</button>
    </div>

    <div id="gk-ai-messages">
      <div class="gk-ai-msg assistant">
        Hallo! Ich bin Ihr KI-Assistent. Stellen Sie mir Fragen zu Ihren Verkäufen,
        Lagerbeständen, offenen Rechnungen oder Pfand.
      </div>
    </div>

    <div id="gk-ai-quick">${quickBtns}</div>

    <div id="gk-ai-input-row">
      <input id="gk-ai-input" type="text" placeholder="Frage stellen…" autocomplete="off"/>
      <button id="gk-ai-send" title="Senden">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none"
             viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0
            0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
        </svg>
      </button>
    </div>
  </div>

  <button id="gk-ai-toggle" title="KI-Assistent öffnen">
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none"
         viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813
           a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813
           a4.5 4.5 0 00-3.09 3.091z"/>
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259
           a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6
           l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/>
    </svg>
  </button>
</div>`;

	document.body.insertAdjacentHTML('beforeend', html);
	getraenkehandel.ai._bind();
};

// ── Event binding ─────────────────────────────────────────────────────────────

getraenkehandel.ai._bind = function () {
	const toggle  = document.getElementById('gk-ai-toggle');
	const closeBtn = document.getElementById('gk-ai-close-btn');
	const input   = document.getElementById('gk-ai-input');
	const send    = document.getElementById('gk-ai-send');
	const quick   = document.getElementById('gk-ai-quick');

	toggle.addEventListener('click', getraenkehandel.ai._toggle);
	closeBtn.addEventListener('click', getraenkehandel.ai._close);

	send.addEventListener('click', function () {
		const q = input.value.trim();
		if (q) getraenkehandel.ai._ask(q);
	});

	input.addEventListener('keydown', function (e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const q = input.value.trim();
			if (q) getraenkehandel.ai._ask(q);
		}
	});

	quick.addEventListener('click', function (e) {
		const btn = e.target.closest('.gk-ai-quick-btn');
		if (btn) getraenkehandel.ai._ask(btn.dataset.q);
	});
};

// ── Toggle / close ────────────────────────────────────────────────────────────

getraenkehandel.ai._toggle = function () {
	const panel = document.getElementById('gk-ai-panel');
	if (panel.classList.contains('gk-hidden')) {
		panel.classList.remove('gk-hidden');
		document.getElementById('gk-ai-input').focus();
	} else {
		panel.classList.add('gk-hidden');
	}
};

getraenkehandel.ai._close = function () {
	document.getElementById('gk-ai-panel').classList.add('gk-hidden');
};

// ── Ask ───────────────────────────────────────────────────────────────────────

getraenkehandel.ai._ask = function (question) {
	if (getraenkehandel.ai._busy) return;

	const input = document.getElementById('gk-ai-input');
	input.value = '';

	getraenkehandel.ai._addMsg(question, 'user');
	const typing = getraenkehandel.ai._showTyping();
	getraenkehandel.ai._setBusy(true);

	frappe.call({
		method: 'getraenkehandel.getraenkehandel.ai.ask',
		args: { question },
		callback: function (r) {
			getraenkehandel.ai._removeTyping(typing);
			getraenkehandel.ai._setBusy(false);
			if (r && r.message && r.message.answer) {
				getraenkehandel.ai._addMsg(r.message.answer, 'assistant');
			}
		},
		error: function (r) {
			getraenkehandel.ai._removeTyping(typing);
			getraenkehandel.ai._setBusy(false);
			const msg = (r && r.message) || 'Ein Fehler ist aufgetreten.';
			getraenkehandel.ai._addMsg(msg, 'error');
		},
	});
};

// ── Helpers ───────────────────────────────────────────────────────────────────

getraenkehandel.ai._addMsg = function (text, role) {
	const msgs = document.getElementById('gk-ai-messages');
	const div = document.createElement('div');
	div.className = 'gk-ai-msg ' + role;
	// Preserve line breaks in assistant responses
	div.innerHTML = role === 'assistant'
		? text.replace(/\n/g, '<br>')
		: frappe.utils.escape_html(text);
	msgs.appendChild(div);
	msgs.scrollTop = msgs.scrollHeight;

	getraenkehandel.ai._history.push({ role, text });
};

getraenkehandel.ai._showTyping = function () {
	const msgs = document.getElementById('gk-ai-messages');
	const div = document.createElement('div');
	div.className = 'gk-ai-typing';
	div.innerHTML = '<span></span><span></span><span></span>';
	msgs.appendChild(div);
	msgs.scrollTop = msgs.scrollHeight;
	return div;
};

getraenkehandel.ai._removeTyping = function (el) {
	if (el && el.parentNode) el.parentNode.removeChild(el);
};

getraenkehandel.ai._setBusy = function (busy) {
	getraenkehandel.ai._busy = busy;
	const send  = document.getElementById('gk-ai-send');
	const input = document.getElementById('gk-ai-input');
	if (send)  send.disabled  = busy;
	if (input) input.disabled = busy;
};
