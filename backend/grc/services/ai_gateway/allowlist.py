"""What the data-protection guard must not mask, even when a tenant's own data happens to contain it.

* ``PUBLIC_NAMES`` — frameworks, regulators, standards, widely used products/vendors and role titles. Masking them
  would destroy what the model is asked to reason about ("Microsoft Windows Server 2019 ...", "NCA ECC ...").
* ``GENERIC_WORDS`` — ordinary words (department names, IT nouns) that a tenant may have used as a unit, team or
  asset name ("Finance", "Server") and that must not be hunted down in every sentence.

Both are casefolded and platform-maintained: no tenant setting loosens them.
"""
from __future__ import annotations

import re

PUBLIC_NAMES = frozenset("""
nca ecc ccc dcc tcc osmacc sama sbp ndmo pdpl gdpr hipaa ccpa pdpa fatf imf basel swift cbuae dfsa difc adgm
nist csf cobit itil togaf cis scf sox soc2 soc iso owasp mitre atlas capec attack nvd cve cwe cpe cvss epss kev
pci pcidss dss iso27001 iso27002 iso22301 iso27701 iso31000 iso42001 asvs masvs samm bsimm fedramp cmmc stig
pci-dss soc-2 iso-27001 nist-csf nist-800-53 nist800-53 nist-800-171 gdpr-eu
microsoft windows linux ubuntu debian centos rhel redhat fedora suse macos ios android chrome firefox edge safari
oracle java mysql postgresql postgres mongodb redis elasticsearch kibana splunk grafana prometheus kubernetes docker
vmware esxi vcenter cisco juniper fortinet fortigate paloalto checkpoint sophos crowdstrike sentinelone trendmicro
symantec mcafee kaspersky okta duo cloudflare akamai aws amazon azure gcp google apple adobe sap ibm dell hp hpe
lenovo apache nginx tomcat iis openssl openssh powershell python nodejs php wordpress drupal jenkins gitlab github
atlassian jira confluence servicenow salesforce slack zoom teams office365 o365 sharepoint exchange outlook
tenable nessus qualys rapid7 nmap metasploit wireshark burp zap openvas
ciso cio cto ceo cfo coo cro dpo cpo cdo ciso-office
""".split())

# a phrase of more than one word, as people write it
PUBLIC_PHRASES = frozenset([
    "pci dss", "soc 2", "iso 27001", "iso 27002", "iso 22301", "iso 27701", "iso 31000", "iso 42001", "iso/iec 27001",
    "nist csf", "nist 800-53", "nist sp 800-53", "nist 800-171", "mitre att&ck", "red hat", "palo alto", "check point",
    "trend micro", "windows server", "microsoft 365", "office 365", "active directory", "azure ad", "entra id",
    "google cloud", "amazon web services", "world bank", "central bank", "state bank of pakistan",
    "saudi arabian monetary authority", "national cybersecurity authority", "information security officer",
    "chief information security officer", "chief executive officer", "data protection officer",
])

GENERIC_WORDS = frozenset("""
admin administrator administrators root user users guest system systems test testing tester dev development prod
production staging uat qa demo default support service services server servers host hosts database databases
network networks firewall router routers switch switches laptop laptops desktop desktops workstation workstations
application applications app apps portal email mail web website cloud backup storage security compliance audit
auditor risk legal finance financial accounting operations technology information management manager managers
team teams department departments division unit units group groups committee board policy policies procedure
procedures standard standards control controls governance human resources hr it ict procurement marketing sales
engineering infrastructure business corporate internal external general global regional local central main head
office branch branches customer customers client clients vendor vendors supplier suppliers partner partners
project projects program programme programs task tasks incident incidents change changes release releases
data privacy quality safety strategy planning delivery helpdesk desk training learning
retail wholesale treasury credit lending payments payment cards card digital online mobile channels channel
reporting analytics intelligence architecture platform platforms
of and the for in on at to with by from or a an as is are was be this that these those it its
directors director executive executives senior steering council panel oversight chair chairman secretary member
members mancom exco
title name names description descriptions status statuses category categories subcategory severity priority owner
owners assignee assignees date dates type types summary summaries detail details reason reasons note notes comment
comments item items list lists value values result results score scores level levels impact impacts likelihood
rating ratings action actions finding findings evidence requirement requirements objective objectives scope
framework frameworks regulation regulations regulator regulators statement statements section sections clause
clauses document documents record records report reports review reviews assessment assessments mitigation
mitigations treatment treatments cause causes consequence consequences recommendation recommendations plan plans
phase phases milestone milestones deadline deadlines metric metrics indicator indicators threshold thresholds
target targets baseline baselines critical high medium low none open closed pending approved rejected draft
published active inactive completed overdue yes no true false
""".split())

_WORDS = re.compile(r"[^\W_]+", re.UNICODE)
_PARENS = re.compile(r"\s*[(\[][^)\]]*[)\]]")


def _words(term: str) -> list:
    return _WORDS.findall(term.casefold())


def is_public(term: str) -> bool:
    """A name everybody knows (framework, regulator, product, role title): never masked."""
    t = " ".join(_words(term))
    compact = "".join(_words(term))
    if t in PUBLIC_PHRASES or t in PUBLIC_NAMES or compact in PUBLIC_NAMES:
        return True
    first = term.casefold().split(".", 1)[0]          # microsoft.com -> microsoft
    return "." in term and first in PUBLIC_NAMES


def is_generic(term: str) -> bool:
    """An ordinary word or words ("Finance", "IT Department", "Board Audit Committee (BAC)"), not a name: never hunted
    down in text. A trailing abbreviation in brackets does not make it a name."""
    term = _PARENS.sub("", term)
    if any(c.isdigit() or c in "-_." for c in term):
        return False
    words = _words(term)
    return bool(words) and all(w in GENERIC_WORDS or w in PUBLIC_NAMES for w in words)
