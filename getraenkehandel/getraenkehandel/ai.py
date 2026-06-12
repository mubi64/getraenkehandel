import json
import re

import frappe
from frappe import _
from frappe.utils import today, flt

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_TABLES = [
    "tabSales Invoice",
    "tabSales Invoice Item",
    "tabCustomer",
    "tabItem",
    "tabBin",
    "tabDelivery Note",
    "tabDelivery Note Item",
    "tabDelivery Trip",
    "tabDelivery Stop",
    "tabPurchase Invoice",
    "tabPurchase Invoice Item",
    "tabPayment Entry",
    "tabGL Entry",
    "tabAddress",
]

_WRITE_RE = re.compile(
    r"\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|REPLACE|RENAME|GRANT|REVOKE)\b",
    re.IGNORECASE,
)

SCHEMA_CACHE_KEY = "getraenkehandel:ai_schema"
SCHEMA_CACHE_TTL = 3600  # seconds

RATE_LIMITS = {"starter": 20, "professional": 100, "business": 500}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@frappe.whitelist()
def ask(question):
    """Main entry point called from ai_sidebar.js.

    Returns {"answer": <German string>, "sql": <generated SQL>}.
    Throws a user-facing frappe.throw() on error so the sidebar can display it.
    """
    _check_rate_limit()

    schema = get_cached_schema()
    sql = _generate_sql(question, schema)
    results = _execute_safe(sql, original_question=question)
    answer = _answer_question(question, results)

    return {"answer": answer, "sql": sql}


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def _check_rate_limit():
    plan = frappe.conf.get("tenant_plan", "starter")
    limit = int(frappe.conf.get("ai_daily_limit") or RATE_LIMITS.get(plan, 20))

    cache_key = f"getraenkehandel:ai_rate:{frappe.session.user}:{today()}"
    count = int(frappe.cache().get_value(cache_key) or 0)

    if count >= limit:
        frappe.throw(
            _(
                "Tageslimit für KI-Anfragen erreicht ({0} Anfragen/Tag). "
                "Bitte versuchen Sie es morgen wieder."
            ).format(limit)
        )

    frappe.cache().set_value(cache_key, count + 1, expires_in_sec=86400)


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------


def get_cached_schema():
    cached = frappe.cache().get_value(SCHEMA_CACHE_KEY)
    if cached:
        return cached
    schema = _build_schema()
    frappe.cache().set_value(SCHEMA_CACHE_KEY, schema, expires_in_sec=SCHEMA_CACHE_TTL)
    return schema


def _build_schema():
    lines = []
    for table in ALLOWED_TABLES:
        try:
            cols = frappe.db.sql(f"DESCRIBE `{table}`", as_dict=True)
            names = [c["Field"] for c in cols if not c["Field"].startswith("_")][:35]
            lines.append(f"{table}: {', '.join(names)}")
        except Exception:
            pass
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# SQL generation (Claude Haiku)
# ---------------------------------------------------------------------------


def _generate_sql(question, schema, error_feedback=None):
    client = _get_client()
    model = frappe.conf.get("ai_model_sql", "claude-haiku-4-5-20251001")
    company = (
        frappe.defaults.get_user_default("Company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
        or "unbekannt"
    )

    system = f"""Du bist ein SQL-Experte für eine ERPNext-MariaDB-Datenbank eines deutschen Getränkehändlers.
Firmenname: {company}

Verfügbare Tabellen (Spalten):
{schema}

Regeln:
- Schreibe NUR die SQL-Abfrage, ohne Erklärungen, ohne Markdown-Codeblöcke
- Nur SELECT-Abfragen erlaubt
- Schließe stornierte Dokumente aus: WHERE docstatus != 2
- Für Umsatz/Rechnungen: SUM(grand_total) aus tabSales Invoice
- Preise immer in EUR
- Maximal 100 Zeilen (LIMIT 100)
- Verwende nur Tabellen aus der obigen Liste"""

    user_content = f"Frage: {question}"
    if error_feedback:
        user_content += f"\n\nFehler bei vorheriger Abfrage: {error_feedback}\nBitte korrigiere die SQL."

    resp = client.messages.create(
        model=model,
        max_tokens=512,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )

    sql = resp.content[0].text.strip()
    # Strip any markdown fences Claude might add
    sql = re.sub(r"^```(?:sql)?\s*", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*```$", "", sql)
    return sql.strip()


# ---------------------------------------------------------------------------
# Safe execution with retry
# ---------------------------------------------------------------------------


def _execute_safe(sql, original_question=None, max_retries=2):
    if _WRITE_RE.search(sql):
        frappe.throw(_("Nur Leseanfragen (SELECT) sind erlaubt."))

    schema = None
    last_error = None

    for attempt in range(max_retries + 1):
        try:
            return frappe.db.sql(sql, as_dict=True)
        except Exception as exc:
            last_error = str(exc)
            if attempt < max_retries:
                if schema is None:
                    schema = get_cached_schema()
                sql = _generate_sql(
                    original_question or "Vorherige Abfrage",
                    schema,
                    error_feedback=last_error,
                )
                if _WRITE_RE.search(sql):
                    break
            else:
                frappe.log_error(
                    f"AI SQL failed (question={original_question!r}):\n{sql}\nError: {last_error}",
                    "Getraenkehandel AI",
                )
                frappe.throw(
                    _(
                        "Die KI konnte keine gültige Datenbankabfrage erstellen. "
                        "Bitte versuchen Sie eine andere Formulierung."
                    )
                )


# ---------------------------------------------------------------------------
# Answer generation (Claude Sonnet)
# ---------------------------------------------------------------------------


def _answer_question(question, results):
    client = _get_client()
    model = frappe.conf.get("ai_model_answer", "claude-sonnet-4-6")

    results_str = json.dumps(results[:50], ensure_ascii=False, default=str)
    if len(results_str) > 4000:
        results_str = results_str[:4000] + " … [Ergebnisse gekürzt]"

    system = """Du bist ein hilfreicher Assistent für einen deutschen Getränkehändler.
Beantworte Fragen präzise auf Deutsch, basierend auf den Datenbankabfrageergebnissen.

Regeln:
- Antworte immer auf Deutsch
- Formatiere Geldbeträge im deutschen Format: 1.234,56 €
- Erwähne niemals SQL, Datenbank oder technische Details
- Wenn keine Daten vorhanden sind, sage das freundlich
- Fasse Ergebnisse zusammen und interpretiere sie verständlich
- Nutze kurze Aufzählungen wenn es mehrere Datenpunkte gibt"""

    resp = client.messages.create(
        model=model,
        max_tokens=1024,
        system=system,
        messages=[
            {
                "role": "user",
                "content": f"Frage: {question}\n\nDaten:\n{results_str}",
            }
        ],
    )

    return resp.content[0].text.strip()


# ---------------------------------------------------------------------------
# Client helper
# ---------------------------------------------------------------------------


def _get_client():
    api_key = frappe.conf.get("anthropic_api_key")
    if not api_key:
        frappe.throw(
            _("KI-Assistent nicht konfiguriert. Bitte Anthropic API-Schlüssel in der Site-Konfiguration hinterlegen.")
        )
    try:
        import anthropic
        return anthropic.Anthropic(api_key=api_key)
    except ImportError:
        frappe.throw(_("Das 'anthropic' Python-Paket ist nicht installiert."))
