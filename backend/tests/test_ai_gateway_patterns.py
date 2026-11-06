"""What the pattern detectors find, and what they must leave alone."""
import pytest

from grc.services.ai_gateway import patterns


def found(text, kind=None):
    ents = patterns.resolve(patterns.detect(text), len(text))
    return [(e.type, e.value) for e in ents if kind is None or e.type == kind]


def values(text, kind):
    return [v for _, v in found(text, kind)]


# ── secrets ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text, secret", [
    ("aws key AKIAIOSFODNN7EXAMPLE in the config", "AKIAIOSFODNN7EXAMPLE"),
    ("OPENAI_KEY sk-proj-abcdefghijklmnopqrstuvwxyz123456 end", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"),
    ("token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"),
    ("jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c end",
     "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"),
    ("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789", "abcdefghijklmnopqrstuvwxyz0123456789"),
    ("db_password=hunter2xyz;", "hunter2xyz"),
    ('{"client_secret": "Zx9!kLm2Qw"}', "Zx9!kLm2Qw"),
    ("Password: Winter2024!", "Winter2024!"),
    ("postgresql://app:S3cretPass@db.example.com:5432/app", "S3cretPass"),
    ("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz\n-----END RSA PRIVATE KEY-----",
     "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz\n-----END RSA PRIVATE KEY-----"),
    ("random Xk9fLq2ZpV7mTn4RwB8sYd3HcJ6aGe5UoIz1 token", "Xk9fLq2ZpV7mTn4RwB8sYd3HcJ6aGe5UoIz1"),
])
def test_a_secret_is_found(text, secret):
    assert secret in values(text, "SECRET")


@pytest.mark.parametrize("text", [
    "Password: required for every account",
    "Password policy: minimum 12 characters",
    "the token: 5 minutes",
    "secret: true",
    "sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "id 123e4567-e89b-12d3-a456-426614174000",
    "file this-is-a-very-long-policy-document-name-2024-v2-final-approved",
    "/usr/local/share/some-long-directory-name/with-many-parts-and-words-in-it",
])
def test_ordinary_text_is_not_taken_for_a_secret(text):
    assert values(text, "SECRET") == []


# ── cards, accounts, identity numbers ───────────────────────────────────────
def test_card_numbers_are_found_only_when_they_pass_luhn():
    assert values("pay with 4111 1111 1111 1111 now", "PAN") == ["4111 1111 1111 1111"]
    assert values("amex 378282246310005", "PAN") == ["378282246310005"]
    assert values("not a card 4111 1111 1111 1112", "PAN") == []
    assert values("epoch 1700000000000 ms", "PAN") == []


def test_iban_needs_the_check_digits_and_the_country_length_to_agree():
    assert values("account PK36SCBL0000001123456702 here", "IBAN") == ["PK36SCBL0000001123456702"]
    assert values("GB82 WEST 1234 5698 7654 32", "IBAN") == ["GB82 WEST 1234 5698 7654 32"]
    assert values("account PK37SCBL0000001123456702 here", "IBAN") == []        # one digit changed
    assert values("reference AB12CDEF3456 ok", "IBAN") == []


@pytest.mark.parametrize("text, value", [
    ("CNIC 42101-1234567-1 on file", "42101-1234567-1"),
    ("cnic: 4210112345671", "4210112345671"),
    ("Emirates ID 784-1985-1234567-1", "784-1985-1234567-1"),
    ("Iqama: 2123456789", "2123456789"),
    ("SSN 123-45-6789", "123-45-6789"),
])
def test_national_ids_are_found(text, value):
    assert value in values(text, "NATIONAL_ID")


def test_a_bare_ten_digit_number_is_not_an_identity_number():
    assert values("order 2123456789 shipped", "NATIONAL_ID") == []
    assert values("2024-10-13 12:30:45", "NATIONAL_ID") == []


def test_mac_addresses_are_found():
    assert values("nic 00:1A:2B:3C:4D:5E up", "MAC") == ["00:1A:2B:3C:4D:5E"]
    assert values("nic 00-1A-2B-3C-4D-5E up", "MAC") == ["00-1A-2B-3C-4D-5E"]


# ── e-mail, phone, IP, cloud, hosts ─────────────────────────────────────────
def test_email_addresses():
    assert values("mail ali.raza+grc@sub.acme-bank.co.uk, then", "EMAIL") == ["ali.raza+grc@sub.acme-bank.co.uk"]
    assert values("no address @mention or user@ here", "EMAIL") == []


@pytest.mark.parametrize("text, phone", [
    ("call +92 300 1234567 today", "+92 300 1234567"),
    ("call +971 50 123 4567 today", "+971 50 123 4567"),
    ("call 0300-1234567 today", "0300-1234567"),
    ("call 021 35123456 today", "021 35123456"),
    ("call (415) 555-2671 today", "(415) 555-2671"),
])
def test_phone_numbers(text, phone):
    assert values(text, "PHONE") == [phone]


def test_dates_and_short_numbers_are_not_phone_numbers():
    assert values("on 2024-10-13 at 12:30, ref 1234567 and 100 200 300", "PHONE") == []


def test_ip_addresses_are_classed_private_or_public():
    assert found("hosts 10.1.2.3 and 192.168.0.1 and 127.0.0.1 and 100.64.0.1") == [
        ("IP_PRIV", "10.1.2.3"), ("IP_PRIV", "192.168.0.1"), ("IP_PRIV", "127.0.0.1"), ("IP_PRIV", "100.64.0.1")]
    assert found("dns 8.8.8.8 ok") == [("IP_PUB", "8.8.8.8")]
    assert found("v6 2606:4700:4700::1111 and fe80::1") == [("IP_PUB", "2606:4700:4700::1111"), ("IP_PRIV", "fe80::1")]


def test_versions_and_times_are_not_ip_addresses():
    for text in ("Version 1.2.3.4 released", "build 10.0.19045.3693", "v1.2.3.4", "at 12:30:45", "std::string", "999.1.1.1",
                 "01.02.03.04"):
        assert [t for t, _ in found(text) if t.startswith("IP")] == [], text


def test_clause_numbers_and_numbered_headings_are_not_ip_addresses():
    for text in ("See clause 5.1.1.2 for details", "per section 8.2.1.4.", "Article 4.3.2.1 applies", "§ 6.1.2.3 states",
                 "5.1.1.2 Access control policy\nmore text", "  8.2.1.4 Review of the policy", "- 7.1.2.3 (a) scope"):
        assert [t for t, _ in found(text) if t.startswith("IP")] == [], text
    # a line that starts with a real-looking address is still an address
    assert found("10.1.2.3 Windows Server 2019") == [("IP_PRIV", "10.1.2.3")]
    assert found("192.168.1.5 is vulnerable") == [("IP_PRIV", "192.168.1.5")]
    assert found("93.184.216.34 open ports: 22") == [("IP_PUB", "93.184.216.34")]


def test_cloud_ids_and_internal_hosts():
    assert values("role arn:aws:iam::123456789012:role/Admin ok", "CLOUD_ID") == ["arn:aws:iam::123456789012:role/Admin"]
    assert values("AWS account id: 123456789012.", "CLOUD_ID") == ["123456789012"]
    assert values("server db01.corp.local and fs.hq.internal reachable", "HOST") == ["db01.corp.local", "fs.hq.internal"]
    assert values(r"share \\fileserver\finance\q3 mounted", "HOST") == [r"\\fileserver\finance\q3"]
    assert values("see www.example.com", "HOST") == []                  # a public name is nobody's secret


# ── choosing between overlaps ───────────────────────────────────────────────
def test_a_secret_next_to_an_email_keeps_both():
    assert [t for t, _ in found("password=Winter2024! for ali@acme.com")] == ["SECRET", "EMAIL"]


def test_resolve_picks_by_priority_then_length():
    low_long = patterns.Entity("L", 0, 10, "x" * 10, priority=10)
    high_short = patterns.Entity("H", 4, 6, "yy", priority=90)
    assert [e.type for e in patterns.resolve([low_long, high_short], 10)] == ["H"]
    same_a, same_b = patterns.Entity("S", 0, 3, "abc", priority=50), patterns.Entity("T", 0, 8, "abcdefgh", priority=50)
    assert [e.type for e in patterns.resolve([same_a, same_b], 8)] == ["T"]


def test_only_what_must_never_leave_is_in_the_residual_set():
    text = "ali@acme.com 10.0.0.1 password=Winter2024! 4111 1111 1111 1111"
    assert {e.type for e in patterns.detect_dropped(text)} == {"SECRET", "PAN"}
