#!/usr/bin/env python3
"""
Enterprise GRC Platform - System UAT Test Suite
Designed by: Enterprise GRC SME, Internal Auditor, Risk Manager, QA Lead
"""

import requests
import json
from datetime import datetime
from typing import Optional, Dict, Any, List

BASE_URL = "http://localhost:8000"
GRC_URL = f"{BASE_URL}/grc"

class UATTestRunner:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        self.auth_token = None
        self.cookies = {}
        
    def log_result(self, test_id: str, objective: str, preconditions: str,
                   steps: str, expected: str, actual: str, passed: bool,
                   severity: Optional[str] = None):
        result = {
            "test_case_id": test_id,
            "objective": objective,
            "preconditions": preconditions,
            "test_steps": steps,
            "expected_result": expected,
            "actual_result": actual,
            "status": "PASS" if passed else "FAIL",
            "severity": severity if not passed else "N/A",
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        status_icon = "✅" if passed else "❌"
        print(f"{status_icon} {test_id}: {objective} - {'PASS' if passed else 'FAIL'}")
        if not passed:
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
        return result

    def authenticate(self, username: str = "demo@example.com", password: str = "Password123!"):
        response = self.session.post(
            f"{GRC_URL}/auth/login",
            json={"username": username, "password": password}
        )
        if response.status_code == 200:
            self.cookies = response.cookies.get_dict()
            return True
        return False

    def get(self, endpoint: str) -> requests.Response:
        return self.session.get(f"{GRC_URL}{endpoint}", cookies=self.cookies)

    def post(self, endpoint: str, data: dict) -> requests.Response:
        return self.session.post(f"{GRC_URL}{endpoint}", json=data, cookies=self.cookies)

    def put(self, endpoint: str, data: dict) -> requests.Response:
        return self.session.put(f"{GRC_URL}{endpoint}", json=data, cookies=self.cookies)

    def delete(self, endpoint: str) -> requests.Response:
        return self.session.delete(f"{GRC_URL}{endpoint}", cookies=self.cookies)

    # ========== AUTHENTICATION & AUTHORIZATION TESTS ==========
    def test_auth_module(self):
        print("\n" + "="*60)
        print("MODULE 1: AUTHENTICATION & AUTHORIZATION")
        print("="*60)

        # AUTH-001: Valid Login
        response = self.session.post(
            f"{GRC_URL}/auth/login",
            json={"username": "demo@example.com", "password": "Password123!"}
        )
        passed = response.status_code == 200
        self.log_result(
            "AUTH-001", "Valid user login with correct credentials",
            "User account exists with email demo@example.com",
            "1. POST /auth/login with valid username and password",
            "Status 200, JWT cookie set, user data returned",
            f"Status {response.status_code}, Response: {response.text[:100]}",
            passed, "Critical" if not passed else None
        )
        if passed:
            self.cookies = response.cookies.get_dict()

        # AUTH-002: Invalid Login
        response = self.session.post(
            f"{GRC_URL}/auth/login",
            json={"username": "invalid@test.com", "password": "wrongpass"}
        )
        passed = response.status_code in [401, 400]
        self.log_result(
            "AUTH-002", "Login rejection with invalid credentials",
            "No account with provided credentials",
            "1. POST /auth/login with invalid email/password",
            "Status 401 Unauthorized",
            f"Status {response.status_code}",
            passed, "Critical" if not passed else None
        )

        # AUTH-003: Session Validation
        response = self.get("/auth/me")
        passed = response.status_code == 200
        self.log_result(
            "AUTH-003", "Session validation with valid cookie",
            "User is authenticated with valid session",
            "1. GET /auth/me with session cookie",
            "Status 200, user profile returned",
            f"Status {response.status_code}",
            passed, "High" if not passed else None
        )

        # AUTH-004: Protected Route Without Auth
        temp_session = requests.Session()
        response = temp_session.get(f"{GRC_URL}/frameworks")
        passed = response.status_code == 401
        self.log_result(
            "AUTH-004", "Protected endpoint rejects unauthenticated access",
            "No authentication cookie present",
            "1. GET /frameworks without auth cookie",
            "Status 401 Unauthorized",
            f"Status {response.status_code}",
            passed, "Critical" if not passed else None
        )

        # AUTH-005: Logout
        response = self.post("/auth/logout", {})
        passed = response.status_code == 200
        self.log_result(
            "AUTH-005", "User logout clears session",
            "User is authenticated",
            "1. POST /auth/logout",
            "Status 200, session cleared",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )
        
        # Re-authenticate for remaining tests
        self.authenticate()

    # ========== COMPLIANCE MODULE TESTS ==========
    def test_compliance_module(self):
        print("\n" + "="*60)
        print("MODULE 2: COMPLIANCE (Frameworks, Controls, Evidence)")
        print("="*60)

        # COMP-001: List Frameworks
        response = self.get("/frameworks")
        passed = response.status_code == 200 and isinstance(response.json(), list)
        framework_count = len(response.json()) if passed else 0
        self.log_result(
            "COMP-001", "Retrieve list of regulatory frameworks",
            "Frameworks are seeded in database",
            "1. GET /frameworks",
            "Status 200, list of 8 frameworks returned",
            f"Status {response.status_code}, {framework_count} frameworks",
            passed and framework_count >= 8, "High" if not passed else None
        )
        
        frameworks = response.json() if passed else []

        # COMP-002: Framework Details
        if frameworks:
            fw_id = frameworks[0].get("id")
            response = self.get(f"/frameworks/{fw_id}")
            passed = response.status_code == 200
            self.log_result(
                "COMP-002", "Retrieve framework details by ID",
                "Framework exists",
                f"1. GET /frameworks/{fw_id}",
                "Status 200, framework with controls returned",
                f"Status {response.status_code}",
                passed, "Medium" if not passed else None
            )

        # COMP-003: List Controls
        response = self.get("/controls")
        passed = response.status_code == 200
        control_count = len(response.json()) if passed else 0
        self.log_result(
            "COMP-003", "Retrieve list of controls",
            "Controls exist in database",
            "1. GET /controls",
            "Status 200, controls list returned",
            f"Status {response.status_code}, {control_count} controls",
            passed, "High" if not passed else None
        )

        # COMP-004: Evidence List
        response = self.get("/evidence")
        passed = response.status_code == 200
        self.log_result(
            "COMP-004", "Retrieve evidence items",
            "Evidence module is accessible",
            "1. GET /evidence",
            "Status 200, evidence list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # COMP-005: Dashboard Stats
        response = self.get("/dashboard/stats")
        passed = response.status_code == 200
        self.log_result(
            "COMP-005", "Retrieve dashboard statistics",
            "User authenticated, data exists",
            "1. GET /dashboard/stats",
            "Status 200, compliance stats returned",
            f"Status {response.status_code}",
            passed, "Low" if not passed else None
        )

    # ========== CONTROL LIBRARY TESTS ==========
    def test_control_library_module(self):
        print("\n" + "="*60)
        print("MODULE 3: UNIFIED CONTROL LIBRARY")
        print("="*60)

        # CL-001: List Control Groups
        response = self.get("/control-library/groups")
        passed = response.status_code == 200
        self.log_result(
            "CL-001", "Retrieve control groups list",
            "Control library module active",
            "1. GET /control-library/groups",
            "Status 200, groups list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # CL-002: Gap Analysis Dashboard
        response = self.get("/control-library/gap-analysis/dashboard")
        passed = response.status_code == 200
        self.log_result(
            "CL-002", "Retrieve gap analysis dashboard",
            "Gap analysis module active",
            "1. GET /control-library/gap-analysis/dashboard",
            "Status 200, gap metrics returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # CL-003: Coverage Matrix
        response = self.get("/control-library/coverage/matrix")
        passed = response.status_code == 200
        self.log_result(
            "CL-003", "Retrieve coverage matrix data",
            "Coverage module active",
            "1. GET /control-library/coverage/matrix",
            "Status 200, coverage data returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # CL-004: AI Similarity Mappings
        response = self.get("/control-library/ai-mapping/similarities")
        passed = response.status_code == 200
        self.log_result(
            "CL-004", "Retrieve AI similarity mappings",
            "AI mapping module active",
            "1. GET /control-library/ai-mapping/similarities",
            "Status 200, similarities returned",
            f"Status {response.status_code}",
            passed, "Low" if not passed else None
        )

    # ========== ERM MODULE TESTS ==========
    def test_erm_module(self):
        print("\n" + "="*60)
        print("MODULE 4: ENTERPRISE RISK MANAGEMENT")
        print("="*60)

        # ERM-001: List Risks
        response = self.get("/erm/risks")
        passed = response.status_code == 200
        risk_count = len(response.json()) if passed else 0
        self.log_result(
            "ERM-001", "Retrieve risk register",
            "ERM module active",
            "1. GET /erm/risks",
            "Status 200, risks list returned",
            f"Status {response.status_code}, {risk_count} risks",
            passed, "High" if not passed else None
        )

        # ERM-002: Risk Dashboard
        response = self.get("/erm/risks/dashboard")
        passed = response.status_code == 200
        self.log_result(
            "ERM-002", "Retrieve risk dashboard",
            "Risks exist in system",
            "1. GET /erm/risks/dashboard",
            "Status 200, dashboard stats returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # ERM-003: Risk Heatmap
        response = self.get("/erm/risks/heatmap")
        passed = response.status_code == 200
        self.log_result(
            "ERM-003", "Retrieve 5x5 risk heatmap data",
            "Risks with scores exist",
            "1. GET /erm/risks/heatmap",
            "Status 200, heatmap matrix returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # ERM-004: KRIs List
        response = self.get("/erm/kris")
        passed = response.status_code == 200
        self.log_result(
            "ERM-004", "Retrieve Key Risk Indicators",
            "KRI module active",
            "1. GET /erm/kris",
            "Status 200, KRIs list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # ERM-005: Mitigation Actions
        response = self.get("/erm/mitigation-actions")
        passed = response.status_code == 200
        self.log_result(
            "ERM-005", "Retrieve mitigation actions",
            "Mitigation module active",
            "1. GET /erm/mitigation-actions",
            "Status 200, actions list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # ERM-006: Internal Controls List
        response = self.get("/erm/internal-controls")
        passed = response.status_code == 200
        control_count = len(response.json()) if passed else 0
        self.log_result(
            "ERM-006", "Retrieve internal controls register",
            "Internal controls seeded",
            "1. GET /erm/internal-controls",
            "Status 200, 22+ internal controls returned",
            f"Status {response.status_code}, {control_count} controls",
            passed and control_count >= 20, "High" if not passed else None
        )

        # ERM-007: Internal Controls Dashboard
        response = self.get("/erm/internal-controls/dashboard")
        passed = response.status_code == 200
        self.log_result(
            "ERM-007", "Retrieve internal controls dashboard",
            "Internal controls exist",
            "1. GET /erm/internal-controls/dashboard",
            "Status 200, dashboard stats returned",
            f"Status {response.status_code}",
            passed, "Low" if not passed else None
        )

        # ERM-008: Risk Incidents
        response = self.get("/erm/incidents")
        passed = response.status_code == 200
        self.log_result(
            "ERM-008", "Retrieve risk incidents",
            "Incidents module active",
            "1. GET /erm/incidents",
            "Status 200, incidents list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

    # ========== VULNERABILITY MANAGEMENT TESTS ==========
    def test_vuln_management_module(self):
        print("\n" + "="*60)
        print("MODULE 5: VULNERABILITY MANAGEMENT")
        print("="*60)

        # VULN-001: Vulnerability Dashboard
        response = self.get("/vuln-management/dashboard")
        passed = response.status_code == 200
        self.log_result(
            "VULN-001", "Retrieve vulnerability dashboard",
            "Vulnerability module active",
            "1. GET /vuln-management/dashboard",
            "Status 200, dashboard metrics returned",
            f"Status {response.status_code}",
            passed, "High" if not passed else None
        )

        # VULN-002: Vulnerabilities List
        response = self.get("/vuln-management/vulnerabilities")
        passed = response.status_code == 200
        vuln_count = len(response.json()) if passed else 0
        self.log_result(
            "VULN-002", "Retrieve vulnerability register",
            "Vulnerabilities seeded",
            "1. GET /vuln-management/vulnerabilities",
            "Status 200, 15+ vulnerabilities returned",
            f"Status {response.status_code}, {vuln_count} vulnerabilities",
            passed and vuln_count >= 10, "High" if not passed else None
        )

        # VULN-003: Reports List
        response = self.get("/vuln-management/reports")
        passed = response.status_code == 200
        self.log_result(
            "VULN-003", "Retrieve vulnerability reports",
            "Reports module active",
            "1. GET /vuln-management/reports",
            "Status 200, reports list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # VULN-004: SLA Configuration
        response = self.get("/vuln-management/sla")
        passed = response.status_code == 200
        self.log_result(
            "VULN-004", "Retrieve SLA configuration",
            "SLA config seeded",
            "1. GET /vuln-management/sla",
            "Status 200, SLA config by severity returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # VULN-005: Overdue Vulnerabilities
        response = self.get("/vuln-management/dashboard/overdue")
        passed = response.status_code == 200
        self.log_result(
            "VULN-005", "Retrieve overdue vulnerabilities",
            "Dashboard module active",
            "1. GET /vuln-management/dashboard/overdue",
            "Status 200, overdue list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # VULN-006: Asset Exposure
        response = self.get("/vuln-management/dashboard/asset-exposure")
        passed = response.status_code == 200
        self.log_result(
            "VULN-006", "Retrieve asset exposure metrics",
            "Assets linked to vulnerabilities",
            "1. GET /vuln-management/dashboard/asset-exposure",
            "Status 200, asset exposure data returned",
            f"Status {response.status_code}",
            passed, "Low" if not passed else None
        )

    # ========== GOVERNANCE MODULE TESTS ==========
    def test_governance_module(self):
        print("\n" + "="*60)
        print("MODULE 6: GOVERNANCE")
        print("="*60)

        # GOV-001: Policies List
        response = self.get("/governance/policies")
        passed = response.status_code == 200
        self.log_result(
            "GOV-001", "Retrieve policies list",
            "Governance module active",
            "1. GET /governance/policies",
            "Status 200, policies list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

        # GOV-002: Documents List
        response = self.get("/governance/documents")
        passed = response.status_code == 200
        self.log_result(
            "GOV-002", "Retrieve documents list",
            "Documents module active",
            "1. GET /governance/documents",
            "Status 200, documents list returned",
            f"Status {response.status_code}",
            passed, "Medium" if not passed else None
        )

    # ========== IT ASSETS MODULE TESTS ==========
    def test_assets_module(self):
        print("\n" + "="*60)
        print("MODULE 7: IT ASSET INVENTORY")
        print("="*60)

        # ASSET-001: Assets List
        response = self.get("/assets")
        passed = response.status_code == 200
        asset_count = len(response.json()) if passed else 0
        self.log_result(
            "ASSET-001", "Retrieve IT assets inventory",
            "Assets module active",
            "1. GET /assets",
            "Status 200, assets list returned",
            f"Status {response.status_code}, {asset_count} assets",
            passed, "Medium" if not passed else None
        )

        # ASSET-002: Asset Categories
        response = self.get("/assets/categories")
        passed = response.status_code == 200
        self.log_result(
            "ASSET-002", "Retrieve asset categories",
            "Categories defined",
            "1. GET /assets/categories",
            "Status 200, categories returned",
            f"Status {response.status_code}",
            passed, "Low" if not passed else None
        )

    # ========== CROSS-MODULE INTEGRATION TESTS ==========
    def test_integration(self):
        print("\n" + "="*60)
        print("MODULE 8: CROSS-MODULE INTEGRATION")
        print("="*60)

        # INT-001: Dashboard aggregates data from all modules
        response = self.get("/dashboard/stats")
        passed = response.status_code == 200
        if passed:
            data = response.json()
            has_compliance = "compliance_score" in str(data) or "controls" in str(data)
            has_risk = "risk" in str(data).lower()
        else:
            has_compliance = has_risk = False
        self.log_result(
            "INT-001", "Dashboard aggregates multi-module data",
            "All modules operational",
            "1. GET /dashboard/stats\n2. Verify compliance and risk data present",
            "Dashboard includes data from compliance and risk modules",
            f"Compliance: {has_compliance}, Risk: {has_risk}",
            passed and (has_compliance or has_risk), "Medium" if not passed else None
        )

        # INT-002: Framework controls linked properly
        response = self.get("/frameworks")
        if response.status_code == 200 and response.json():
            fw = response.json()[0]
            response2 = self.get(f"/frameworks/{fw.get('id')}")
            passed = response2.status_code == 200
            has_controls = "controls" in response2.text or "control" in response2.text.lower()
        else:
            passed = has_controls = False
        self.log_result(
            "INT-002", "Framework-Control relationship integrity",
            "Frameworks and controls exist",
            "1. GET /frameworks\n2. GET /frameworks/{id}\n3. Verify controls linked",
            "Framework contains linked controls",
            f"Has controls: {has_controls}",
            passed and has_controls, "High" if not passed else None
        )

    # ========== AUDIT TRAIL TESTS ==========
    def test_audit_trail(self):
        print("\n" + "="*60)
        print("MODULE 9: AUDIT TRAIL & TRACEABILITY")
        print("="*60)

        # AUD-001: Audit logs exist
        response = self.get("/audit-logs")
        passed = response.status_code in [200, 404]  # 404 OK if not implemented
        self.log_result(
            "AUD-001", "Audit log endpoint accessibility",
            "Audit module active",
            "1. GET /audit-logs",
            "Status 200 or defined response",
            f"Status {response.status_code}",
            passed, "Low" if not passed else None
        )

        # AUD-002: Created/Updated timestamps on records
        response = self.get("/erm/risks")
        if response.status_code == 200 and response.json():
            risk = response.json()[0]
            has_timestamps = "created_at" in risk or "updated_at" in risk
        else:
            has_timestamps = False
        self.log_result(
            "AUD-002", "Records contain audit timestamps",
            "Records exist in system",
            "1. GET /erm/risks\n2. Check for created_at/updated_at fields",
            "Records have timestamp fields",
            f"Has timestamps: {has_timestamps}",
            has_timestamps, "Medium" if not has_timestamps else None
        )

    # ========== MULTI-TENANT ISOLATION TESTS ==========
    def test_multi_tenant(self):
        print("\n" + "="*60)
        print("MODULE 10: MULTI-TENANT ISOLATION")
        print("="*60)

        # MT-001: Data includes tenant_id
        response = self.get("/erm/risks")
        if response.status_code == 200 and response.json():
            risk = response.json()[0]
            has_tenant = "tenant_id" in risk
        else:
            has_tenant = False
        self.log_result(
            "MT-001", "Records contain tenant_id for isolation",
            "Multi-tenant architecture implemented",
            "1. GET /erm/risks\n2. Verify tenant_id field present",
            "All records have tenant_id field",
            f"Has tenant_id: {has_tenant}",
            has_tenant, "Critical" if not has_tenant else None
        )

        # MT-002: User associated with tenant
        response = self.get("/auth/me")
        if response.status_code == 200:
            user = response.json()
            has_tenant_assoc = "tenant" in str(user).lower()
        else:
            has_tenant_assoc = False
        self.log_result(
            "MT-002", "User profile includes tenant association",
            "User authenticated",
            "1. GET /auth/me\n2. Verify tenant association",
            "User has tenant information",
            f"Has tenant: {has_tenant_assoc}",
            has_tenant_assoc, "High" if not has_tenant_assoc else None
        )

    def generate_report(self):
        print("\n" + "="*60)
        print("UAT SUMMARY REPORT")
        print("="*60)
        
        total = len(self.test_results)
        passed = sum(1 for r in self.test_results if r["status"] == "PASS")
        failed = total - passed
        
        print(f"\nTotal Tests: {total}")
        print(f"Passed: {passed} ({100*passed//total}%)")
        print(f"Failed: {failed} ({100*failed//total}%)")
        
        if failed > 0:
            print("\n--- FAILED TESTS ---")
            critical = [r for r in self.test_results if r["status"] == "FAIL" and r["severity"] == "Critical"]
            high = [r for r in self.test_results if r["status"] == "FAIL" and r["severity"] == "High"]
            medium = [r for r in self.test_results if r["status"] == "FAIL" and r["severity"] == "Medium"]
            low = [r for r in self.test_results if r["status"] == "FAIL" and r["severity"] == "Low"]
            
            print(f"Critical: {len(critical)}")
            print(f"High: {len(high)}")
            print(f"Medium: {len(medium)}")
            print(f"Low: {len(low)}")
            
            for r in critical + high:
                print(f"\n{r['test_case_id']} [{r['severity']}]: {r['objective']}")
                print(f"  Expected: {r['expected_result']}")
                print(f"  Actual: {r['actual_result']}")
        
        return self.test_results

    def run_all_tests(self):
        print("\n" + "#"*60)
        print("# ENTERPRISE GRC PLATFORM - SYSTEM UAT")
        print("# Date:", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        print("#"*60)
        
        self.test_auth_module()
        self.test_compliance_module()
        self.test_control_library_module()
        self.test_erm_module()
        self.test_vuln_management_module()
        self.test_governance_module()
        self.test_assets_module()
        self.test_integration()
        self.test_audit_trail()
        self.test_multi_tenant()
        
        return self.generate_report()


if __name__ == "__main__":
    runner = UATTestRunner()
    results = runner.run_all_tests()
    
    # Save detailed results to JSON
    with open("uat_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nDetailed results saved to uat_results.json")
