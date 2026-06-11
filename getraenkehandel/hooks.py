app_name = "getraenkehandel"
app_title = "Getraenkehandel"
app_publisher = "Kistly"
app_description = "AI-powered ERP for German beverage distributors"
app_email = "info@kistly.de"
app_license = "mit"

# Installation
before_install = "getraenkehandel.setup.install.before_install"
after_install = "getraenkehandel.setup.install.after_install"

# Runs after the ERPNext setup wizard completes — company name is known at this point
setup_wizard_complete = "getraenkehandel.setup.install.after_setup_wizard"

# Fixtures — global (non-company-specific) records exported/imported via bench
fixtures = [
    {
        "dt": "Item Group",
        "filters": [["item_group_name", "in", [
            "Getränke", "Bier", "Wasser", "Softdrinks", "Säfte", "Spirituosen", "Pfand", "Leergut"
        ]]],
    },
    {
        "dt": "Customer Group",
        "filters": [["customer_group_name", "in", [
            "Gastronomie", "Kiosk/Späti", "Einzelhandel", "Privatkunde"
        ]]],
    },
    {
        "dt": "Price List",
        "filters": [["price_list_name", "in", [
            "Gastro Preisliste", "Kiosk Preisliste", "Handel Preisliste"
        ]]],
    },
    {
        "dt": "Payment Terms Template",
        "filters": [["template_name", "in", [
            "Sofort fällig", "14 Tage netto", "30 Tage netto"
        ]]],
    },
    {
        "dt": "Role Profile",
        "filters": [["role_profile", "=", "Getraenkehandel Operator"]],
    },
    {
        "dt": "Item",
        "filters": [["item_code", "in", [
            "PFAND-025", "PFAND-033", "PFAND-050", "PFAND-KISTE",
            "COLA-050", "FANTA-050", "SPRITE-050",
            "BIER-033", "BIER-050", "WEIZEN-050", "BIER-KISTE-20",
            "WASSER-050", "WASSER-100", "WASSER-KISTE-12",
            "APFELSAFT-100", "ORANGENSAFT-100"
        ]]],
    },
    {
        "dt": "Customer",
        "filters": [["customer_name", "in", [
            "Gaststätte Zum Biergarten",
            "Kiosk Am Bahnhof",
            "Edeka Frisch & Gut"
        ]]],
    },
    {
        "dt": "Custom HTML Block",
        "filters": [["name", "in", ["gk-dashboard-hero", "gk-dashboard-kpi"]]],
    },
]

# Inject Getraenkehandel as default landing workspace for all users on login
boot_session = "getraenkehandel.getraenkehandel.dashboard.set_default_workspace"

# Auto-Pfand client script — runs on both Sales Order and Sales Invoice
# Address map — Nominatim autocomplete + OpenStreetMap/Leaflet
doctype_js = {
    "Sales Invoice":  "public/js/pfand_script.js",
    "Sales Order":    "public/js/pfand_script.js",
    "Address":        "public/js/address_map.js",
    "Delivery Trip":  ["public/js/delivery_trip_map.js", "public/js/delivery_trip_handover.js"],
    "Driver":         "public/js/driver_account.js",
}

# Driver: auto-create Fahrerkasse account on save when checkbox is ticked
doc_events = {
    "Driver": {
        "after_insert": "getraenkehandel.getraenkehandel.driver_account.on_driver_update",
        "on_update":    "getraenkehandel.getraenkehandel.driver_account.on_driver_update",
    },
}

# Global desk JS — module hiding + setup wizard
app_include_js = "/assets/getraenkehandel/js/workspace.js"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "getraenkehandel",
# 		"logo": "/assets/getraenkehandel/logo.png",
# 		"title": "Getraenkehandel",
# 		"route": "/getraenkehandel",
# 		"has_permission": "getraenkehandel.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/getraenkehandel/css/getraenkehandel.css"
# app_include_js = "/assets/getraenkehandel/js/getraenkehandel.js"

# include js, css files in header of web template
# web_include_css = "/assets/getraenkehandel/css/getraenkehandel.css"
# web_include_js = "/assets/getraenkehandel/js/getraenkehandel.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "getraenkehandel/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "getraenkehandel/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "getraenkehandel.utils.jinja_methods",
# 	"filters": "getraenkehandel.utils.jinja_filters"
# }

# Uninstallation
# ------------

# before_uninstall = "getraenkehandel.uninstall.before_uninstall"
# after_uninstall = "getraenkehandel.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "getraenkehandel.utils.before_app_install"
# after_app_install = "getraenkehandel.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "getraenkehandel.utils.before_app_uninstall"
# after_app_uninstall = "getraenkehandel.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "getraenkehandel.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"getraenkehandel.tasks.all"
# 	],
# 	"daily": [
# 		"getraenkehandel.tasks.daily"
# 	],
# 	"hourly": [
# 		"getraenkehandel.tasks.hourly"
# 	],
# 	"weekly": [
# 		"getraenkehandel.tasks.weekly"
# 	],
# 	"monthly": [
# 		"getraenkehandel.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "getraenkehandel.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "getraenkehandel.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "getraenkehandel.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["getraenkehandel.utils.before_request"]
# after_request = ["getraenkehandel.utils.after_request"]

# Job Events
# ----------
# before_job = ["getraenkehandel.utils.before_job"]
# after_job = ["getraenkehandel.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"getraenkehandel.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

