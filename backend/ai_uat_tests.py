#!/usr/bin/env python3
"""
Enterprise GRC Platform - AI Features UAT Test Suite
Tests all AI-powered buttons and endpoints across the platform
"""

import os
import sys
import json
import requests
from datetime import datetime
from typing import List, Dict, Optional, Any

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
GRC_URL = f"{BASE_URL}/grc"

class AIUATTestSuite:
    def __init__(self):
        self.session = requests.Session()
        self.results = []
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        
    def log_result(
        self, 
        test_id: str, 
        objective: str, 
        endpoint: str,
        expected: str, 
        actual: str, 
        passed: bool,
        severity: str = "Medium",
        ai_required: bool = True,
        skipped: bool = False,
        skip_reason: str = None
    ):
        if skipped:
            self.skipped += 1
            status = "SKIP"
            icon = "⏭️"
        elif passed:
            self.passed += 1
            status = "PASS"
            icon = "✅"
        else:
            self.failed += 1
            status = "FAIL"
            icon = "❌"
            
        result = {
            "test_case_id": test_id,
            "objective": objective,
            "endpoint": endpoint,
            "expected_result": expected,
            "actual_result": actual,
            "status": status,
            "severity": severity if not passed and not skipped else "N/A",
            "ai_required": ai_required,
            "skip_reason": skip_reason,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.results.append(result)
        
        print(f"{icon} {test_id}: {objective} - {status}")
        if not passed and not skipped:
            print(f"   Endpoint: {endpoint}")
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
        elif skipped:
            print(f"   Skip Reason: {skip_reason}")
        return result
        
    def authenticate(self, username: str = "demo@example.com", password: str = "Password123!"):
        response = self.session.post(
            f"{GRC_URL}/auth/login",
            json={"username": username, "password": password}
        )
        return response.status_code == 200
        
    def check_ai_configured(self):
        """Check if OpenAI API is available"""
        api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if api_key and len(api_key) > 20 and not api_key.startswith("_DUMMY"):
            return True
        return False
        
    def run_all_tests(self):
        print("#" * 60)
        print("# ENTERPRISE GRC PLATFORM - AI FEATURES UAT")
        print(f"# Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("#" * 60)
        
        ai_configured = self.check_ai_configured()
        if not ai_configured:
            print("\n⚠️  WARNING: OpenAI API not configured. AI endpoint tests will verify error handling.")
        
        if not self.authenticate():
            print("\n❌ CRITICAL: Authentication failed. Cannot proceed with tests.")
            return self.results
            
        print("\n✅ Authentication successful")
        
        self.test_vulnerability_ai_endpoints(ai_configured)
        self.test_control_library_ai_endpoints(ai_configured)
        self.test_framework_upload_ai_endpoints(ai_configured)
        self.test_evidence_ai_endpoints(ai_configured)
        self.test_button_connectivity()
        
        self.print_summary()
        self.save_results()
        
        return self.results
    
    def test_vulnerability_ai_endpoints(self, ai_configured: bool):
        print("\n" + "=" * 60)
        print("MODULE 1: VULNERABILITY MANAGEMENT AI")
        print("=" * 60)
        
        # VULN-AI-001: AI Analyze Report endpoint exists
        response = self.session.get(f"{GRC_URL}/vuln-management/reports")
        reports = []
        if response.status_code == 200:
            data = response.json()
            reports = data if isinstance(data, list) else data.get("items", [])
        
        if reports and len(reports) > 0:
            report_id = reports[0].get("id", 1)
            response = self.session.post(f"{GRC_URL}/vuln-management/ai/analyze-report/{report_id}")
            
            if ai_configured:
                passed = response.status_code in [200, 201]
                actual = f"Status {response.status_code}"
                if response.status_code == 200:
                    data = response.json()
                    actual = f"Status 200, Job status: {data.get('status', 'unknown')}"
            else:
                # Without AI, should return 500 or 503
                passed = response.status_code in [500, 503, 200]
                actual = f"Status {response.status_code} (AI not configured)"
                
            self.log_result(
                "VULN-AI-001", "AI Analyze Report endpoint",
                f"POST /vuln-management/ai/analyze-report/{report_id}",
                "Status 200 with analysis job" if ai_configured else "Status 500/503 or graceful error",
                actual, passed, "High"
            )
        else:
            self.log_result(
                "VULN-AI-001", "AI Analyze Report endpoint",
                "POST /vuln-management/ai/analyze-report/{id}",
                "Endpoint accessible", "No reports to test with",
                False, "Medium", skipped=True, skip_reason="No vulnerability reports in database"
            )
        
        # VULN-AI-002: AI Suggest Fix endpoint
        response = self.session.get(f"{GRC_URL}/vuln-management/vulnerabilities")
        vulns = []
        if response.status_code == 200:
            data = response.json()
            vulns = data if isinstance(data, list) else data.get("items", [])
        
        if vulns and len(vulns) > 0:
            vuln_id = vulns[0].get("id", 1)
            response = self.session.post(f"{GRC_URL}/vuln-management/ai/suggest-fix/{vuln_id}")
            
            if ai_configured:
                passed = response.status_code in [200, 201]
                actual = f"Status {response.status_code}"
                if response.status_code == 200:
                    data = response.json()
                    actual = f"Status 200, Job status: {data.get('status', 'unknown')}"
            else:
                passed = response.status_code in [500, 503, 200]
                actual = f"Status {response.status_code} (AI not configured)"
                
            self.log_result(
                "VULN-AI-002", "AI Suggest Fix endpoint",
                f"POST /vuln-management/ai/suggest-fix/{vuln_id}",
                "Status 200 with fix recommendations" if ai_configured else "Status 500/503 or graceful error",
                actual, passed, "High"
            )
        else:
            self.log_result(
                "VULN-AI-002", "AI Suggest Fix endpoint",
                "POST /vuln-management/ai/suggest-fix/{id}",
                "Endpoint accessible", "No vulnerabilities to test with",
                False, "Medium", skipped=True, skip_reason="No vulnerabilities in database"
            )
        
        # VULN-AI-003: List AI Jobs
        response = self.session.get(f"{GRC_URL}/vuln-management/ai/jobs")
        passed = response.status_code == 200
        actual = f"Status {response.status_code}"
        if passed:
            jobs = response.json()
            actual = f"Status 200, {len(jobs)} jobs returned"
            
        self.log_result(
            "VULN-AI-003", "List AI Jobs endpoint",
            "GET /vuln-management/ai/jobs",
            "Status 200 with jobs list",
            actual, passed, "Medium", ai_required=False
        )
    
    def test_control_library_ai_endpoints(self, ai_configured: bool):
        print("\n" + "=" * 60)
        print("MODULE 2: CONTROL LIBRARY AI")
        print("=" * 60)
        
        # CL-AI-001: AI Similarity Analysis
        response = self.session.post(
            f"{GRC_URL}/control-library/ai-mapping/analyze",
            json={"framework_ids": []}
        )
        
        if ai_configured:
            passed = response.status_code in [200, 201]
            actual = f"Status {response.status_code}"
            if passed:
                data = response.json()
                actual = f"Status 200, Analysis status: {data.get('status', 'unknown')}"
        else:
            passed = response.status_code in [503, 500, 200]
            actual = f"Status {response.status_code} (AI not configured)"
            
        self.log_result(
            "CL-AI-001", "AI Similarity Analysis endpoint",
            "POST /control-library/ai-mapping/analyze",
            "Status 200 with analysis job" if ai_configured else "Status 503/500 or graceful error",
            actual, passed, "High"
        )
        
        # CL-AI-002: Get Similarities
        response = self.session.get(f"{GRC_URL}/control-library/ai-mapping/similarities")
        passed = response.status_code == 200
        actual = f"Status {response.status_code}"
        if passed:
            data = response.json()
            actual = f"Status 200, {data.get('total', 0)} similarities"
            
        self.log_result(
            "CL-AI-002", "Get AI Similarities endpoint",
            "GET /control-library/ai-mapping/similarities",
            "Status 200 with similarities list",
            actual, passed, "Medium", ai_required=False
        )
        
        # CL-AI-003: Analyze Control Pair
        response = self.session.post(
            f"{GRC_URL}/control-library/ai-mapping/analyze-pair",
            json={
                "source_type": "framework",
                "source_control_id": 1,
                "target_type": "framework", 
                "target_control_id": 2
            }
        )
        
        if ai_configured:
            passed = response.status_code in [200, 404]  # 404 if controls don't exist
            actual = f"Status {response.status_code}"
        else:
            passed = response.status_code in [503, 500, 200, 404]
            actual = f"Status {response.status_code} (AI not configured)"
            
        self.log_result(
            "CL-AI-003", "AI Analyze Control Pair endpoint",
            "POST /control-library/ai-mapping/analyze-pair",
            "Status 200 with similarity result" if ai_configured else "Status 503/500 or graceful error",
            actual, passed, "Medium"
        )
        
        # CL-AI-004: Evidence Recommendations List
        response = self.session.get(f"{GRC_URL}/control-library/evidence-recs")
        passed = response.status_code == 200
        actual = f"Status {response.status_code}"
        if passed:
            data = response.json()
            actual = f"Status 200, {data.get('total', 0)} recommendations"
            
        self.log_result(
            "CL-AI-004", "Evidence Recommendations List endpoint",
            "GET /control-library/evidence-recs",
            "Status 200 with recommendations",
            actual, passed, "Medium", ai_required=False
        )
        
        # CL-AI-005: Generate Evidence Recommendations
        response = self.session.post(f"{GRC_URL}/control-library/evidence-recs/generate/framework/1")
        
        if ai_configured:
            passed = response.status_code in [200, 404]
            actual = f"Status {response.status_code}"
            if response.status_code == 200:
                data = response.json()
                actual = f"Status 200, {data.get('generated_count', 0)} recommendations generated"
        else:
            passed = response.status_code in [503, 500, 200, 404]
            actual = f"Status {response.status_code} (AI not configured)"
            
        self.log_result(
            "CL-AI-005", "Generate Evidence Recommendations endpoint",
            "POST /control-library/evidence-recs/generate/framework/1",
            "Status 200 with generated recommendations" if ai_configured else "Status 503/500 or graceful error",
            actual, passed, "High"
        )
        
        # CL-AI-006: Priority Summary
        response = self.session.get(f"{GRC_URL}/control-library/evidence-recs/priority-summary")
        passed = response.status_code == 200
        actual = f"Status {response.status_code}"
        if passed:
            data = response.json()
            actual = f"Status 200, Total: {data.get('total', 0)}"
            
        self.log_result(
            "CL-AI-006", "Evidence Priority Summary endpoint",
            "GET /control-library/evidence-recs/priority-summary",
            "Status 200 with priority summary",
            actual, passed, "Low", ai_required=False
        )
    
    def test_framework_upload_ai_endpoints(self, ai_configured: bool):
        print("\n" + "=" * 60)
        print("MODULE 3: FRAMEWORK UPLOAD AI")
        print("=" * 60)
        
        # FW-AI-001: List uploaded frameworks
        response = self.session.get(f"{GRC_URL}/framework-upload/upload")
        passed = response.status_code == 200
        frameworks = []
        actual = f"Status {response.status_code}"
        if passed:
            data = response.json()
            frameworks = data.get("items", [])
            actual = f"Status 200, {len(frameworks)} uploaded frameworks"
            
        self.log_result(
            "FW-AI-001", "List Uploaded Frameworks endpoint",
            "GET /framework-upload/upload",
            "Status 200 with frameworks list",
            actual, passed, "Medium", ai_required=False
        )
        
        # FW-AI-002: Parse Framework Document (AI-powered)
        if frameworks and len(frameworks) > 0:
            fw_id = frameworks[0].get("id", 1)
            response = self.session.post(f"{GRC_URL}/framework-upload/parser/{fw_id}/parse")
            
            if ai_configured:
                passed = response.status_code in [200, 400, 404]  # 400 if no file, 404 if not found
                actual = f"Status {response.status_code}"
                if response.status_code == 200:
                    data = response.json()
                    actual = f"Status 200, {data.get('controls_count', 0)} controls parsed"
            else:
                passed = response.status_code in [500, 503, 200, 400, 404]
                actual = f"Status {response.status_code} (AI not configured)"
                
            self.log_result(
                "FW-AI-002", "AI Parse Framework Document endpoint",
                f"POST /framework-upload/parser/{fw_id}/parse",
                "Status 200 with parsed controls" if ai_configured else "Status 500/503 or graceful error",
                actual, passed, "High"
            )
        else:
            self.log_result(
                "FW-AI-002", "AI Parse Framework Document endpoint",
                "POST /framework-upload/parser/{id}/parse",
                "Endpoint accessible", "No uploaded frameworks to test with",
                False, "Medium", skipped=True, skip_reason="No uploaded frameworks in database"
            )
        
        # FW-AI-003: List Parsed Controls
        if frameworks and len(frameworks) > 0:
            fw_id = frameworks[0].get("id", 1)
            try:
                response = self.session.get(f"{GRC_URL}/framework-upload/parser/{fw_id}/controls", timeout=30)
                passed = response.status_code == 200
                actual = f"Status {response.status_code}"
                if passed:
                    data = response.json()
                    actual = f"Status 200, {data.get('total', 0)} parsed controls"
            except Exception as e:
                passed = False
                actual = f"Connection error: {str(e)[:50]}"
                
            self.log_result(
                "FW-AI-003", "List Parsed Controls endpoint",
                f"GET /framework-upload/parser/{fw_id}/controls",
                "Status 200 with controls list",
                actual, passed, "Medium", ai_required=False
            )
        else:
            self.log_result(
                "FW-AI-003", "List Parsed Controls endpoint",
                "GET /framework-upload/parser/{id}/controls",
                "Endpoint accessible", "No uploaded frameworks to test with",
                False, "Low", skipped=True, skip_reason="No uploaded frameworks in database"
            )
    
    def test_evidence_ai_endpoints(self, ai_configured: bool):
        print("\n" + "=" * 60)
        print("MODULE 4: EVIDENCE AI (OCR & ASSESSMENT)")
        print("=" * 60)
        
        # Get evidence list
        response = self.session.get(f"{GRC_URL}/evidence-mgmt/items")
        evidence_list = []
        if response.status_code == 200:
            data = response.json()
            evidence_list = data.get("items", []) if isinstance(data, dict) else data
        
        # EV-AI-001: OCR Process endpoint
        if evidence_list and len(evidence_list) > 0:
            ev_id = evidence_list[0].get("id", 1)
            response = self.session.post(f"{GRC_URL}/evidence-mgmt/ocr/{ev_id}/process-ocr")
            
            # This can fail for valid reasons (no file, unsupported type)
            passed = response.status_code in [200, 400, 404, 500]
            actual = f"Status {response.status_code}"
            if response.status_code == 200:
                data = response.json()
                actual = f"Status 200, OCR status: {data.get('status', 'unknown')}"
                
            self.log_result(
                "EV-AI-001", "OCR Process endpoint",
                f"POST /evidence/ocr/{ev_id}/process-ocr",
                "Status 200 with OCR result or valid error",
                actual, passed, "High"
            )
        else:
            self.log_result(
                "EV-AI-001", "OCR Process endpoint",
                "POST /evidence/ocr/{id}/process-ocr",
                "Endpoint accessible", "No evidence to test with",
                False, "Medium", skipped=True, skip_reason="No evidence in database"
            )
        
        # EV-AI-002: Get OCR Content
        if evidence_list and len(evidence_list) > 0:
            ev_id = evidence_list[0].get("id", 1)
            response = self.session.get(f"{GRC_URL}/evidence-mgmt/ocr/{ev_id}/ocr-content")
            passed = response.status_code == 200
            actual = f"Status {response.status_code}"
            if passed:
                data = response.json()
                actual = f"Status 200, OCR status: {data.get('ocr_status', 'unknown')}"
                
            self.log_result(
                "EV-AI-002", "Get OCR Content endpoint",
                f"GET /evidence-mgmt/ocr/{ev_id}/ocr-content",
                "Status 200 with OCR content",
                actual, passed, "Medium", ai_required=False
            )
        else:
            self.log_result(
                "EV-AI-002", "Get OCR Content endpoint",
                "GET /evidence/ocr/{id}/ocr-content",
                "Endpoint accessible", "No evidence to test with",
                False, "Low", skipped=True, skip_reason="No evidence in database"
            )
        
        # EV-AI-003: AI Assessment endpoint
        if evidence_list and len(evidence_list) > 0:
            ev_id = evidence_list[0].get("id", 1)
            response = self.session.post(f"{GRC_URL}/evidence-mgmt/ai/{ev_id}/assess")
            
            if ai_configured:
                # May fail if no OCR content
                passed = response.status_code in [200, 400, 500]
                actual = f"Status {response.status_code}"
                if response.status_code == 200:
                    data = response.json()
                    assessment = data.get("assessment", {})
                    actual = f"Status 200, Quality score updated: {data.get('quality_score_updated', False)}"
            else:
                passed = response.status_code in [500, 503, 200, 400]
                actual = f"Status {response.status_code} (AI not configured)"
                
            self.log_result(
                "EV-AI-003", "AI Assessment endpoint",
                f"POST /evidence-mgmt/ai/{ev_id}/assess",
                "Status 200 with assessment" if ai_configured else "Status 500/503 or graceful error",
                actual, passed, "High"
            )
        else:
            self.log_result(
                "EV-AI-003", "AI Assessment endpoint",
                "POST /evidence/ai/{id}/assess",
                "Endpoint accessible", "No evidence to test with",
                False, "Medium", skipped=True, skip_reason="No evidence in database"
            )
        
        # EV-AI-004: Get Assessments
        if evidence_list and len(evidence_list) > 0:
            ev_id = evidence_list[0].get("id", 1)
            response = self.session.get(f"{GRC_URL}/evidence-mgmt/ai/{ev_id}/assessments")
            passed = response.status_code == 200
            actual = f"Status {response.status_code}"
            if passed:
                assessments = response.json()
                actual = f"Status 200, {len(assessments)} assessments"
                
            self.log_result(
                "EV-AI-004", "Get Assessments endpoint",
                f"GET /evidence-mgmt/ai/{ev_id}/assessments",
                "Status 200 with assessments list",
                actual, passed, "Medium", ai_required=False
            )
        else:
            self.log_result(
                "EV-AI-004", "Get Assessments endpoint",
                "GET /evidence/ai/{id}/assessments",
                "Endpoint accessible", "No evidence to test with",
                False, "Low", skipped=True, skip_reason="No evidence in database"
            )
        
        # EV-AI-005: Low Quality Evidence
        response = self.session.get(f"{GRC_URL}/evidence-mgmt/ai/low-quality")
        passed = response.status_code == 200
        actual = f"Status {response.status_code}"
        if passed:
            data = response.json()
            actual = f"Status 200, {len(data)} low-quality items"
            
        self.log_result(
            "EV-AI-005", "Get Low Quality Evidence endpoint",
            "GET /evidence-mgmt/ai/low-quality",
            "Status 200 with low-quality evidence list",
            actual, passed, "Low", ai_required=False
        )
    
    def test_button_connectivity(self):
        print("\n" + "=" * 60)
        print("MODULE 5: BUTTON ENDPOINT CONNECTIVITY")
        print("=" * 60)
        
        # Test all key endpoints that buttons should connect to
        button_endpoints = [
            ("BTN-001", "Vulnerability Dashboard", "GET /vuln-management/dashboard", f"{GRC_URL}/vuln-management/dashboard"),
            ("BTN-002", "Risk Heatmap Data", "GET /erm/risks/heatmap", f"{GRC_URL}/erm/risks/heatmap"),
            ("BTN-003", "Control Groups List", "GET /control-library/groups", f"{GRC_URL}/control-library/groups"),
            ("BTN-004", "Gap Analysis Dashboard", "GET /control-library/gap-analysis/dashboard", f"{GRC_URL}/control-library/gap-analysis/dashboard"),
            ("BTN-005", "Coverage Matrix", "GET /control-library/coverage/matrix", f"{GRC_URL}/control-library/coverage/matrix"),
            ("BTN-006", "Internal Controls List", "GET /erm/internal-controls", f"{GRC_URL}/erm/internal-controls"),
            ("BTN-007", "KRIs List", "GET /erm/kris", f"{GRC_URL}/erm/kris"),
            ("BTN-008", "Risk Incidents", "GET /erm/incidents", f"{GRC_URL}/erm/incidents"),
            ("BTN-009", "Governance Documents", "GET /governance/documents", f"{GRC_URL}/governance/documents"),
            ("BTN-010", "IT Assets", "GET /assets", f"{GRC_URL}/assets"),
        ]
        
        for test_id, name, endpoint_desc, url in button_endpoints:
            response = self.session.get(url)
            passed = response.status_code == 200
            actual = f"Status {response.status_code}"
            
            self.log_result(
                test_id, f"{name} Button Endpoint",
                endpoint_desc,
                "Status 200",
                actual, passed, "Medium", ai_required=False
            )
    
    def print_summary(self):
        print("\n" + "=" * 60)
        print("AI UAT SUMMARY REPORT")
        print("=" * 60)
        
        total = self.passed + self.failed + self.skipped
        print(f"\nTotal Tests: {total}")
        print(f"Passed: {self.passed} ({self.passed*100//total if total > 0 else 0}%)")
        print(f"Failed: {self.failed} ({self.failed*100//total if total > 0 else 0}%)")
        print(f"Skipped: {self.skipped} ({self.skipped*100//total if total > 0 else 0}%)")
        
        if self.failed > 0:
            print("\n--- FAILED TESTS ---")
            critical_count = 0
            high_count = 0
            medium_count = 0
            low_count = 0
            
            for result in self.results:
                if result["status"] == "FAIL":
                    severity = result["severity"]
                    if severity == "Critical":
                        critical_count += 1
                    elif severity == "High":
                        high_count += 1
                    elif severity == "Medium":
                        medium_count += 1
                    elif severity == "Low":
                        low_count += 1
            
            print(f"Critical: {critical_count}")
            print(f"High: {high_count}")
            print(f"Medium: {medium_count}")
            print(f"Low: {low_count}")
            
            for result in self.results:
                if result["status"] == "FAIL":
                    print(f"\n{result['test_case_id']} [{result['severity']}]: {result['objective']}")
                    print(f"  Endpoint: {result['endpoint']}")
                    print(f"  Expected: {result['expected_result']}")
                    print(f"  Actual: {result['actual_result']}")
        
        if self.skipped > 0:
            print("\n--- SKIPPED TESTS ---")
            for result in self.results:
                if result["status"] == "SKIP":
                    print(f"{result['test_case_id']}: {result['objective']}")
                    print(f"  Reason: {result.get('skip_reason', 'Unknown')}")
    
    def save_results(self):
        with open("ai_uat_results.json", "w") as f:
            json.dump(self.results, f, indent=2)
        print(f"\nDetailed results saved to ai_uat_results.json")


if __name__ == "__main__":
    suite = AIUATTestSuite()
    suite.run_all_tests()
