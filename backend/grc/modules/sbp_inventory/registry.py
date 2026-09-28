"""State Bank of Pakistan (SBP) — Offsite IT Asset Inventory template.

The 52 columns SBP requires every bank to submit, in order, mapped to how Ava
supplies each one:

  src = "asset:<col>"  → read straight from an ITAsset column (source of truth)
        "derived"      → computed at read-time from data Ava already collects
        "stored"       → a value Ava doesn't collect; kept in grc_sbp_asset_inventory
        "reason"       → free-text justification (also stored)

A "stored" value always overrides a derived/asset default (so an analyst can
correct anything). This list IS the field spec — keep it in template order.
"""
from __future__ import annotations
from typing import Dict, List

# (key, column-letter, label, group, src)
FIELDS: List[tuple] = [
    ("asset_name",              "A",  "Asset/ Application Name",                    "Identity",          "asset:name"),
    ("application_description", "B",  "Application Description",                    "Identity",          "asset:description"),
    ("server_description",      "C",  "Server Description",                         "Identity",          "derived"),
    ("classification",          "D",  "Application/Asset Classification",           "Identity",          "derived"),
    ("ip_address",              "E",  "IP Address",                                "Identity",          "asset:ip_address"),
    ("subnet",                  "F",  "Subnet [A, B, C,..]",                       "Identity",          "derived"),
    ("primary_dr",              "G",  "Primary/DR",                                "Identity",          "derived"),
    ("public_facing_dmz",       "H",  "Public Facing /DMZ",                        "Identity",          "derived"),
    ("environment",             "I",  "Environment (Production, Dev, UAT)",        "Identity",          "asset:environment"),
    ("web_app_server",          "J",  "Web/App Servers",                           "Identity",          "derived"),
    ("database_server",         "K",  "Database Server",                           "Identity",          "derived"),
    ("virtual_patching",        "L",  "Virtual Patching Implemented (Yes/No/NA)",  "OS & Patching",     "derived"),
    ("os_with_version",         "M",  "OS with version",                           "OS & Patching",     "derived"),
    ("last_os_patch",           "N",  "Last OS patch",                             "OS & Patching",     "derived"),
    ("last_os_patch_date",      "O",  "Last OS Patch Release Date",                "OS & Patching",     "derived"),
    ("latest_os_patch",         "P",  "Latest OS Patch",                           "OS & Patching",     "derived"),
    ("latest_os_patch_date",    "Q",  "Latest OS Patch Release Date",              "OS & Patching",     "stored"),
    ("dbms_version",            "R",  "DBMS version (if database)",                "Database",          "derived"),
    ("last_db_patch",           "S",  "Last DB patch (if database)",               "Database",          "derived"),
    ("last_db_patch_date",      "T",  "Last DB patch release date (if database)",  "Database",          "stored"),
    ("latest_db_patch",         "U",  "Latest DB patch (if database)",             "Database",          "derived"),
    ("latest_db_patch_date",    "V",  "Latest DB patch release date (if database)","Database",          "stored"),
    ("dlp",                     "W",  "DLP (Yes/No)",                              "Security Controls", "derived"),
    ("xdr_edr",                 "X",  "XDR / EDR (Yes/No)",                        "Security Controls", "derived"),
    ("db_monitoring",           "Y",  "Database Monitoring - If Database (Yes/No)","Security Controls", "derived"),
    ("siem_coverage",           "Z",  "SIEM Coverage (Yes/No)",                    "Security Controls", "derived"),
    ("obsolescence_status",     "AA", "Status of Obsolescence (Y/N)",              "Obsolescence",      "derived"),
    ("obsolete_since_days",     "AB", "Obsolete since (no. of days)",              "Obsolescence",      "derived"),
    ("obsolescence_timeline",   "AC", "Obsolence Timeline",                        "Obsolescence",      "derived"),
    ("integrated_bmc",          "AD", "Integrated with BMC (Yes/No/NA)",           "Integration",       "derived"),
    ("last_va_date",            "AE", "Date of Last VA Performed",                 "Vulnerability Assessment", "derived"),
    ("va_open_critical",        "AF", "No. of open Critical vulnerabilities",      "Vulnerability Assessment", "derived"),
    ("va_days_critical_open",   "AG", "No. of days since critical vulnerability is open", "Vulnerability Assessment", "derived"),
    ("va_open_high",            "AH", "No. of open High level vulnerabilities",    "Vulnerability Assessment", "derived"),
    ("va_days_high_open",       "AI", "No. of days since High vulnerability is open", "Vulnerability Assessment", "derived"),
    ("last_pt_date",            "AJ", "Date of Last PT performed",                 "Penetration Testing", "derived"),
    ("pt_open_critical",        "AK", "No. of open Critical vulnerabilities (PT)", "Penetration Testing", "derived"),
    ("pt_days_critical_open",   "AL", "No. of days since critical vulnerability is open (PT)", "Penetration Testing", "derived"),
    ("pt_open_high",            "AM", "No. of open High level vulnerabilities (PT)","Penetration Testing", "derived"),
    ("pt_days_high_open",       "AN", "No. of days since High vulnerability is open (PT)", "Penetration Testing", "derived"),
    ("reason_obsolete_os",      "AO", "Reason Obsolence OS Category",              "Justifications",    "derived"),
    ("reason_not_bmc",          "AP", "Reason for Not Integrated with BMC",        "Justifications",    "derived"),
    ("reason_no_virtual_patching","AQ","Reason for Virtual Patching Not Implemented","Justifications",  "derived"),
    ("reason_no_xdr_edr",       "AR", "Reason for XDR / EDR Not Installed",        "Justifications",    "derived"),
    ("reason_dlp",              "AS", "Reason for DLP",                            "Justifications",    "derived"),
    ("reason_public_dmz",       "AT", "Reason for Public Facing / DMZ",           "Justifications",    "derived"),
    ("reason_web_app",          "AU", "Reason for Web/App Servers",               "Justifications",    "derived"),
    ("reason_db_server",        "AV", "Reason for Database Server",               "Justifications",    "derived"),
    ("reason_db_monitoring",    "AW", "Reason for Database Monitoring",           "Justifications",    "derived"),
    ("reason_db_patch",         "AX", "DB patch Reason",                          "Justifications",    "derived"),
    ("reason_siem",             "AY", "SIEM Coverage Reason",                     "Justifications",    "derived"),
    ("reason_os_patch",         "AZ", "Reason for OS Patch",                      "Justifications",    "derived"),
]

# keys whose value the user can save (everything not read straight off the asset)
STORED_KEYS = {f[0] for f in FIELDS if f[4] in ("stored", "reason")}
# derived fields the user may still override (best-effort auto-fills — an analyst
# confirms/corrects these before the bank submission; the hard-fact derived
# fields like VA counts, subnet, OS and DMZ stay read-only).
OVERRIDABLE_DERIVED = {"web_app_server", "database_server", "xdr_edr",
                       "server_description", "classification", "dlp",
                       "db_monitoring", "siem_coverage", "obsolescence_timeline",
                       # heuristic / scan-derived best-efforts an analyst confirms:
                       "primary_dr", "virtual_patching", "integrated_bmc",
                       "last_os_patch", "last_os_patch_date", "last_db_patch",
                       # deterministic gap-tied justification drafts:
                       "reason_obsolete_os", "reason_not_bmc",
                       "reason_no_virtual_patching", "reason_no_xdr_edr",
                       "reason_dlp", "reason_public_dmz", "reason_db_monitoring",
                       "reason_siem",
                       # wired to auto-populate the moment their source data exists
                       # (credentialed-scan patch KBs / a pen-test run); blank until then:
                       "latest_os_patch", "latest_db_patch",
                       "last_pt_date", "pt_open_critical", "pt_days_critical_open",
                       "pt_open_high", "pt_days_high_open",
                       "reason_web_app", "reason_db_server",
                       "reason_db_patch", "reason_os_patch"}
STORABLE_KEYS = STORED_KEYS | OVERRIDABLE_DERIVED
HEADERS = [f[2] for f in FIELDS]  # exact template header row, in order


def field_meta() -> List[Dict]:
    return [{"key": k, "letter": ltr, "label": lbl, "group": grp,
             "src": src, "editable": (src in ("stored", "reason") or k in OVERRIDABLE_DERIVED)}
            for (k, ltr, lbl, grp, src) in FIELDS]
