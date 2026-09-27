"""What an internet-facing host runs, read from what it sends any visitor.

The signatures are our own and deliberately few: the servers, platforms,
frameworks and services that matter when one vulnerability or one outage hits
many organisations at once. Each match keeps its evidence and, where the host
says so, a version. A header or page can be stripped or faked, so absence is
never evidence, and a version is only as good as the host's word.

Mail and DNS providers are read from MX and NS records the same way.

Pure functions, no network: the probes pass in what they already fetched.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Dict, Iterable, List, Optional, Tuple

# (name, category, where, pattern). `where` is a response header (lower case),
# "html" for the start of the page, "cookie", or "url" for where the page ended up.
# A first capture group, when present and matched, is the version.
SIGNATURES: List[Tuple[str, str, str, str]] = [
    ("nginx", "Web server", "server", r"\bnginx(?:/([\d.]+))?"),
    ("Apache HTTP Server", "Web server", "server", r"\bapache(?:/([\d.]+))?"),
    ("Microsoft IIS", "Web server", "server", r"microsoft-iis(?:/([\d.]+))?"),
    ("LiteSpeed", "Web server", "server", r"litespeed"),
    ("OpenResty", "Web server", "server", r"openresty(?:/([\d.]+))?"),
    ("Caddy", "Web server", "server", r"\bcaddy\b"),
    ("Envoy", "Web server", "server", r"\benvoy\b"),
    ("Kestrel", "Web server", "server", r"\bkestrel\b"),
    ("PHP", "Language", "x-powered-by", r"\bphp(?:/([\d.]+))?"),
    ("ASP.NET", "Framework", "x-powered-by", r"asp\.net"),
    ("ASP.NET", "Framework", "x-aspnet-version", r"([\d.]+)"),
    ("Express", "Framework", "x-powered-by", r"\bexpress\b"),
    ("Next.js", "Framework", "x-powered-by", r"next\.js(?:\s+([\d.]+))?"),
    ("Drupal", "CMS", "x-generator", r"drupal\s*(\d+)?"),
    ("Cloudflare", "CDN", "cf-ray", r"."),
    ("Amazon CloudFront", "CDN", "x-amz-cf-id", r"."),
    ("Fastly", "CDN", "x-served-by", r"cache-"),
    ("Akamai", "CDN", "server", r"akamaighost"),
    ("Azure Front Door", "CDN", "x-azure-ref", r"."),
    ("Imperva", "WAF", "x-iinfo", r"."),
    ("Sucuri", "WAF", "x-sucuri-id", r"."),
    ("Amazon S3", "Hosting", "server", r"amazons3"),
    ("GitHub Pages", "Hosting", "server", r"github\.com"),
    ("Vercel", "Hosting", "x-vercel-id", r"."),
    ("Netlify", "Hosting", "x-nf-request-id", r"."),
    ("Heroku", "Hosting", "via", r"vegur"),
    ("Google Cloud", "Hosting", "server", r"^(?:gws|gse|google frontend)\b"),
    ("AWS Elastic Load Balancing", "Hosting", "cookie", r"\bawsalb(?:cors)?="),
    ("Azure App Service", "Hosting", "cookie", r"\barraffinity="),
    ("Shopify", "E-commerce", "x-shopid", r"."),
    ("Shopify", "E-commerce", "html", r"cdn\.shopify\.com"),
    ("Wix", "Website builder", "x-wix-request-id", r"."),
    ("Squarespace", "Website builder", "html", r"static1\.squarespace\.com"),
    ("Webflow", "Website builder", "html", r"data-wf-page="),
    ("WordPress", "CMS", "html", r"<meta[^>]+generator[^>]+wordpress\s*([\d.]+)?"),
    ("WordPress", "CMS", "html", r"/wp-(?:content|includes)/"),
    ("Joomla", "CMS", "html", r"<meta[^>]+generator[^>]+joomla"),
    ("Drupal", "CMS", "html", r"drupal-settings-json|/sites/default/files/"),
    ("Ghost", "CMS", "html", r"<meta[^>]+generator[^>]+ghost\s*([\d.]+)?"),
    ("Magento", "E-commerce", "html", r"mage/cookies|/static/version\d+/frontend/"),
    ("HubSpot", "Marketing", "html", r"js\.hs-scripts\.com|js\.hsforms\.net"),
    ("jQuery", "JavaScript library", "html", r"jquery[.-](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js"),
    ("jQuery", "JavaScript library", "html", r"/jquery(?:\.min)?\.js"),
    ("React", "JavaScript framework", "html", r"data-reactroot|react-dom(?:\.production)?(?:\.min)?\.js"),
    ("Angular", "JavaScript framework", "html", r"ng-version=\"([\d.]+)\""),
    ("Vue.js", "JavaScript framework", "html", r"data-v-app|/vue(?:\.min)?\.js"),
    ("Next.js", "Framework", "html", r"/_next/static/"),
    ("Nuxt", "Framework", "html", r"/_nuxt/"),
    ("Bootstrap", "UI framework", "html", r"bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)"),
    ("Google Tag Manager", "Analytics", "html", r"googletagmanager\.com/(?:gtm|gtag)"),
    ("Google Analytics", "Analytics", "html", r"google-analytics\.com/(?:analytics|ga)\.js"),
    ("Hotjar", "Analytics", "html", r"static\.hotjar\.com"),
    ("Segment", "Analytics", "html", r"cdn\.segment\.com"),
    ("Intercom", "Customer messaging", "html", r"widget\.intercom\.io"),
    ("Zendesk", "Customer messaging", "html", r"static\.zdassets\.com"),
    ("Stripe", "Payments", "html", r"js\.stripe\.com"),
    ("reCAPTCHA", "Security", "html", r"google\.com/recaptcha"),
    ("Okta", "Identity", "url", r"\.okta(?:preview)?\.com/"),
    ("Microsoft Entra ID", "Identity", "url", r"login\.microsoftonline\.com/"),
    ("Auth0", "Identity", "url", r"\.auth0\.com/"),
]

MAIL: List[Tuple[str, str]] = [
    ("Microsoft 365", r"\.mail\.protection\.outlook\.com$"), ("Google Workspace", r"(?:^|\.)(?:aspmx\.l\.google\.com|googlemail\.com)$"),
    ("Proofpoint", r"\.pphosted\.com$"), ("Mimecast", r"\.mimecast\.com$"), ("Cisco Secure Email", r"\.iphmx\.com$"),
    ("Barracuda", r"\.barracudanetworks\.com$"), ("Zoho Mail", r"\.zoho\.(?:com|eu|in)$"), ("Amazon SES", r"\.amazonses\.com$"),
    ("Mailgun", r"\.mailgun\.org$"),
]
DNS: List[Tuple[str, str]] = [
    ("Cloudflare", r"\.ns\.cloudflare\.com$"), ("Amazon Route 53", r"\.awsdns-"), ("Azure DNS", r"\.azure-dns\."),
    ("Google Cloud DNS", r"\.googledomains\.com$"), ("GoDaddy", r"\.domaincontrol\.com$"), ("NS1", r"\.nsone\.net$"),
    ("Akamai", r"\.akam\.net$"), ("UltraDNS", r"\.ultradns\."), ("DNS Made Easy", r"\.dnsmadeeasy\.com$"),
]

# When support ended, per release line. Our own table of public vendor dates; a
# line missing here is simply not judged.
END_OF_LIFE: Dict[str, List[Tuple[str, date]]] = {
    "PHP": [("5", date(2018, 12, 31)), ("7.0", date(2019, 1, 10)), ("7.1", date(2019, 12, 1)),
            ("7.2", date(2020, 11, 30)), ("7.3", date(2021, 12, 6)), ("7.4", date(2022, 11, 28)),
            ("8.0", date(2023, 11, 26)), ("8.1", date(2025, 12, 31)), ("8.2", date(2026, 12, 31))],
    "Apache HTTP Server": [("2.0", date(2013, 7, 10)), ("2.2", date(2017, 7, 1))],
    "Microsoft IIS": [("6", date(2015, 7, 14)), ("7.0", date(2020, 1, 14)), ("7.5", date(2020, 1, 14)),
                      ("8.0", date(2023, 10, 10)), ("8.5", date(2023, 10, 10))],
}
# Versions below which a library has publicly known, easily reached flaws.
KNOWN_FLAWED_BELOW: Dict[str, Tuple[str, str]] = {
    "jQuery": ("3.5.0", "cross-site scripting through its HTML handling"),
    "Angular": ("2.0.0", "the AngularJS line, unsupported since 2022"),
}

_HTML_LIMIT = 200_000


def _version(value: str) -> Tuple[int, ...]:
    return tuple(int(p) for p in re.findall(r"\d+", value)[:4])


def detect(headers, cookies: Iterable[str] = (), html: str = "", url: str = "") -> List[dict]:
    """Technologies a web response shows. `headers` is any mapping of response headers."""
    found: Dict[str, dict] = {}
    blob = {"html": (html or "")[:_HTML_LIMIT], "cookie": " ".join(cookies or []), "url": url or ""}
    sent = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    for name, category, where, pattern in SIGNATURES:
        text = blob[where] if where in blob else sent.get(where, "")
        if not text:
            continue
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        version = match.group(1) if match.re.groups and match.group(1) else None
        entry = found.setdefault(name, {"name": name, "category": category, "version": None, "evidence": where})
        if version and not entry["version"]:
            entry["version"], entry["evidence"] = version.strip("."), where
    return sorted(found.values(), key=lambda t: (t["category"], t["name"]))


def providers(mx: Iterable[str] = (), ns: Iterable[str] = ()) -> List[dict]:
    """Mail and DNS providers named by a domain's MX and NS records."""
    out = []
    for records, table, category in ((mx, MAIL, "Email"), (ns, DNS, "DNS")):
        hosts = [str(r).split()[-1].rstrip(".").lower() for r in records or [] if str(r).strip()]
        for name, pattern in table:
            if any(re.search(pattern, h) for h in hosts):
                out.append({"name": name, "category": category, "version": None,
                            "evidence": "MX records" if category == "Email" else "NS records"})
    return out


def outdated(tech: dict, today: date) -> Optional[str]:
    """Why this technology's version is out of date, or None."""
    version = tech.get("version")
    if not version:
        return None
    for line, ended in END_OF_LIFE.get(tech["name"], []):
        if (version == line or version.startswith(line + ".")) and ended < today:
            return f"{tech['name']} {version} has been out of support since {ended:%d %b %Y}"
    floor = KNOWN_FLAWED_BELOW.get(tech["name"])
    if floor and _version(version) < _version(floor[0]):
        return f"{tech['name']} {version} is older than {floor[0]}, with known flaws: {floor[1]}"
    return None


if __name__ == "__main__":  # self-check: python web_tech.py
    seen = detect({"server": "Apache/2.2.34 (Unix)", "x-powered-by": "PHP/7.4.33", "cf-ray": "8a1"},
                  ["AWSALB=abc; Path=/"], '<script src="/js/jquery-3.4.1.min.js"></script><link href="/wp-content/x.css">')
    names = {t["name"]: t["version"] for t in seen}
    assert names == {"Apache HTTP Server": "2.2.34", "PHP": "7.4.33", "Cloudflare": None,
                     "AWS Elastic Load Balancing": None, "jQuery": "3.4.1", "WordPress": None}, names
    assert providers(["10 acme-com.mail.protection.outlook.com."], ["ns1.awsdns-01.org."]) == [
        {"name": "Microsoft 365", "category": "Email", "version": None, "evidence": "MX records"},
        {"name": "Amazon Route 53", "category": "DNS", "version": None, "evidence": "NS records"}]
    today = date(2026, 9, 27)
    assert "out of support" in outdated({"name": "PHP", "version": "7.4.33"}, today)
    assert outdated({"name": "PHP", "version": "8.3.1"}, today) is None
    assert outdated({"name": "PHP", "version": "8.10.0"}, today) is None      # not the 8.1 line
    assert "known flaws" in outdated({"name": "jQuery", "version": "3.4.1"}, today)
    print("web_tech self-check passed")
