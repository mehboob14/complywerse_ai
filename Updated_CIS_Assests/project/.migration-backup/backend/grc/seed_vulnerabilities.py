"""Seed sample vulnerability data for demo purposes"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from .models import (
    VulnerabilityReport, Vulnerability, VulnerabilityMitigation,
    VulnerabilitySLAConfig, Tenant, GRCUser, SessionLocal
)


def seed_sla_config():
    """Seed default SLA configuration"""
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
        if not tenant:
            print("Default tenant not found, skipping SLA seed...")
            return
        
        existing = db.query(VulnerabilitySLAConfig).filter(
            VulnerabilitySLAConfig.tenant_id == tenant.id
        ).first()
        
        if existing:
            print(f"SLA config already exists for tenant {tenant.name}, skipping...")
            return
        
        sla_defaults = [
            {"severity": "critical", "remediation_days": 7},
            {"severity": "high", "remediation_days": 30},
            {"severity": "medium", "remediation_days": 90},
            {"severity": "low", "remediation_days": 180},
            {"severity": "info", "remediation_days": 365},
        ]
        
        for sla in sla_defaults:
            config = VulnerabilitySLAConfig(
                tenant_id=tenant.id,
                severity=sla["severity"],
                remediation_days=sla["remediation_days"],
                is_active=True
            )
            db.add(config)
        
        db.commit()
        print(f"Seeded SLA config for tenant {tenant.name}")
    finally:
        db.close()


def seed_vulnerabilities():
    """Seed sample vulnerabilities for demo"""
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
        if not tenant:
            print("Default tenant not found, skipping vulnerability seed...")
            return
        
        existing = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant.id
        ).first()
        
        if existing:
            print(f"Vulnerabilities already exist for tenant {tenant.name}, skipping...")
            return
        
        user = db.query(GRCUser).first()
        user_id = user.id if user else None
        
        report = VulnerabilityReport(
            tenant_id=tenant.id,
            name="Q4 2025 Penetration Test Report",
            description="Annual penetration test conducted by external security firm",
            report_type="penetration_test",
            scan_tool="manual",
            scan_date=datetime.utcnow() - timedelta(days=7),
            scan_scope="External and internal network infrastructure, web applications",
            status="analyzed",
            uploaded_by=user_id,
            total_vulnerabilities=15,
            critical_count=2,
            high_count=4,
            medium_count=6,
            low_count=2,
            info_count=1
        )
        db.add(report)
        db.flush()
        
        sample_vulns = [
            {
                "vuln_id": "VULN-001",
                "title": "SQL Injection in User Login Form",
                "description": "The login form is vulnerable to SQL injection attacks through the username parameter. An attacker can bypass authentication or extract sensitive data.",
                "severity": "critical",
                "cvss_score": 9.8,
                "cve_id": "CVE-2024-1234",
                "cwe_id": "CWE-89",
                "affected_component": "Authentication Module",
                "affected_url": "/api/auth/login",
                "recommendation": "Use parameterized queries or prepared statements. Implement input validation.",
                "status": "in_progress"
            },
            {
                "vuln_id": "VULN-002",
                "title": "Remote Code Execution via File Upload",
                "description": "The file upload functionality allows uploading of executable files which can be triggered by accessing the uploaded file URL.",
                "severity": "critical",
                "cvss_score": 10.0,
                "cve_id": "CVE-2024-5678",
                "cwe_id": "CWE-434",
                "affected_component": "Document Upload Module",
                "affected_url": "/api/documents/upload",
                "recommendation": "Implement strict file type validation, rename uploaded files, store outside web root.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-003",
                "title": "Cross-Site Scripting (XSS) in Comments",
                "description": "User-supplied input in comments is not properly sanitized, allowing stored XSS attacks.",
                "severity": "high",
                "cvss_score": 7.2,
                "cwe_id": "CWE-79",
                "affected_component": "Comments Feature",
                "affected_url": "/api/comments",
                "recommendation": "Implement proper output encoding. Use Content Security Policy headers.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-004",
                "title": "Insecure Direct Object Reference (IDOR)",
                "description": "API endpoints expose sequential IDs allowing unauthorized access to other users' data.",
                "severity": "high",
                "cvss_score": 7.5,
                "cwe_id": "CWE-639",
                "affected_component": "User Profile API",
                "affected_url": "/api/users/{id}",
                "recommendation": "Implement proper authorization checks. Use UUIDs instead of sequential IDs.",
                "status": "in_progress"
            },
            {
                "vuln_id": "VULN-005",
                "title": "Weak Password Policy",
                "description": "The application allows passwords with less than 8 characters and doesn't require complexity.",
                "severity": "high",
                "cvss_score": 6.5,
                "cwe_id": "CWE-521",
                "affected_component": "Password Management",
                "recommendation": "Enforce minimum 12 characters, complexity requirements, and password history.",
                "status": "resolved"
            },
            {
                "vuln_id": "VULN-006",
                "title": "Missing Rate Limiting on Login",
                "description": "The login endpoint has no rate limiting, enabling brute force attacks.",
                "severity": "high",
                "cvss_score": 7.0,
                "cwe_id": "CWE-307",
                "affected_component": "Authentication Module",
                "affected_url": "/api/auth/login",
                "recommendation": "Implement rate limiting, account lockout, and CAPTCHA after failed attempts.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-007",
                "title": "Sensitive Data Exposure in API Response",
                "description": "API responses include sensitive fields like password hashes and internal IDs.",
                "severity": "medium",
                "cvss_score": 5.3,
                "cwe_id": "CWE-200",
                "affected_component": "User API",
                "recommendation": "Implement proper response filtering. Use DTOs to control exposed fields.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-008",
                "title": "Missing HTTPS Enforcement",
                "description": "The application accepts connections over HTTP, exposing data to interception.",
                "severity": "medium",
                "cvss_score": 5.9,
                "cwe_id": "CWE-319",
                "affected_component": "Web Server",
                "recommendation": "Enforce HTTPS with HSTS headers. Redirect all HTTP to HTTPS.",
                "status": "resolved"
            },
            {
                "vuln_id": "VULN-009",
                "title": "Session Token in URL",
                "description": "Session tokens are passed in URL parameters, exposing them in logs and referrer headers.",
                "severity": "medium",
                "cvss_score": 4.3,
                "cwe_id": "CWE-598",
                "affected_component": "Session Management",
                "recommendation": "Use HttpOnly cookies for session management. Never pass tokens in URLs.",
                "status": "in_progress"
            },
            {
                "vuln_id": "VULN-010",
                "title": "Outdated TLS Configuration",
                "description": "Server supports TLS 1.0 and 1.1 which have known vulnerabilities.",
                "severity": "medium",
                "cvss_score": 5.0,
                "affected_component": "Web Server",
                "recommendation": "Disable TLS 1.0 and 1.1. Only allow TLS 1.2 and 1.3.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-011",
                "title": "Missing Security Headers",
                "description": "Response headers missing X-Content-Type-Options, X-Frame-Options, and CSP.",
                "severity": "medium",
                "cvss_score": 4.0,
                "cwe_id": "CWE-693",
                "affected_component": "Web Server",
                "recommendation": "Add security headers: X-Content-Type-Options, X-Frame-Options, CSP, etc.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-012",
                "title": "Verbose Error Messages",
                "description": "Application returns detailed error messages including stack traces to users.",
                "severity": "medium",
                "cvss_score": 4.5,
                "cwe_id": "CWE-209",
                "affected_component": "Error Handling",
                "recommendation": "Implement generic error messages for users. Log detailed errors server-side.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-013",
                "title": "Insecure Cookie Configuration",
                "description": "Session cookies missing Secure and SameSite attributes.",
                "severity": "low",
                "cvss_score": 3.1,
                "cwe_id": "CWE-614",
                "affected_component": "Session Management",
                "recommendation": "Set Secure, HttpOnly, and SameSite=Strict on all sensitive cookies.",
                "status": "resolved"
            },
            {
                "vuln_id": "VULN-014",
                "title": "Information Disclosure in Headers",
                "description": "Server headers reveal technology stack and version numbers.",
                "severity": "low",
                "cvss_score": 2.0,
                "affected_component": "Web Server",
                "recommendation": "Remove or obfuscate Server, X-Powered-By, and similar headers.",
                "status": "open"
            },
            {
                "vuln_id": "VULN-015",
                "title": "Missing robots.txt",
                "description": "No robots.txt file to prevent indexing of sensitive paths.",
                "severity": "info",
                "cvss_score": 0.0,
                "affected_component": "Web Server",
                "recommendation": "Add robots.txt to prevent search engine indexing of admin and API paths.",
                "status": "open"
            },
        ]
        
        sla_days = {"critical": 7, "high": 30, "medium": 90, "low": 180, "info": 365}
        
        for vuln_data in sample_vulns:
            due_date = datetime.utcnow() + timedelta(days=sla_days.get(vuln_data["severity"], 90))
            resolved_at = None
            if vuln_data["status"] == "resolved":
                resolved_at = datetime.utcnow() - timedelta(days=2)
            
            vuln = Vulnerability(
                tenant_id=tenant.id,
                report_id=report.id,
                vuln_id=vuln_data["vuln_id"],
                title=vuln_data["title"],
                description=vuln_data["description"],
                severity=vuln_data["severity"],
                cvss_score=vuln_data.get("cvss_score"),
                cve_id=vuln_data.get("cve_id"),
                cwe_id=vuln_data.get("cwe_id"),
                affected_component=vuln_data.get("affected_component"),
                affected_url=vuln_data.get("affected_url"),
                recommendation=vuln_data.get("recommendation"),
                status=vuln_data["status"],
                discovered_at=datetime.utcnow() - timedelta(days=7),
                due_date=due_date,
                resolved_at=resolved_at,
                assigned_to=user_id if vuln_data["status"] == "in_progress" else None
            )
            db.add(vuln)
        
        db.commit()
        print(f"Seeded {len(sample_vulns)} vulnerabilities for tenant {tenant.name}")
        
    finally:
        db.close()


def seed_vulnerability_data():
    """Main function to seed all vulnerability demo data"""
    seed_sla_config()
    seed_vulnerabilities()
    print("Vulnerability seeding completed!")


if __name__ == "__main__":
    seed_vulnerability_data()
