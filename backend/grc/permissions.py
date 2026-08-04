PERMISSION_MATRIX = [
    {
        "module": "dashboard",
        "display_name": "Dashboard",
        "submodules": [
            {
                "name": "overview",
                "display_name": "Dashboard Overview",
                "actions": ["view"]
            },
            {
                "name": "ai_insights",
                "display_name": "ComplyChat",
                "actions": ["view"]
            }
        ]
    },
    {
        "module": "bcm",
        "display_name": "Business Continuity Management",
        "submodules": [
            {"name": "plans", "display_name": "BCM Plans", "actions": ["view", "create", "edit", "delete", "approve"]},
            {"name": "bia", "display_name": "Business Impact Analysis", "actions": ["view", "create", "edit", "delete"]},
            {"name": "drills", "display_name": "Drills & Tests", "actions": ["view", "create", "edit", "delete"]},
            {"name": "findings", "display_name": "Drill Findings", "actions": ["view", "create", "edit", "delete"]},
            {"name": "dashboard", "display_name": "BCM Dashboard", "actions": ["view"]},
        ]
    },
    {
        "module": "risks",
        "display_name": "Risk Management",
        "submodules": [
            {
                "name": "risk_register",
                "display_name": "Risk Register",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "risk_assessment",
                "display_name": "Risk Assessment",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "risk_treatment",
                "display_name": "Risk Treatment",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "risk_appetite",
                "display_name": "Risk Appetite",
                "actions": ["view", "create", "edit", "delete"]
            }
        ]
    },
    {
        "module": "erm",
        "display_name": "Enterprise Risk Management",
        "submodules": [
            {
                "name": "risks",
                "display_name": "ERM Risks",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "incidents",
                "display_name": "Incidents",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "internal_controls",
                "display_name": "Internal Controls",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "rcsa",
                "display_name": "RCSA",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "kris",
                "display_name": "Key Risk Indicators",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "mitigation_actions",
                "display_name": "Mitigation Actions",
                "actions": ["view", "create", "edit", "delete"]
            }
        ]
    },
    {
        "module": "controls",
        "display_name": "Control Library",
        "submodules": [
            {
                "name": "control_library",
                "display_name": "Control Library",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "control_testing",
                "display_name": "Control Testing",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "control_mapping",
                "display_name": "Control Mapping",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "gap_analysis",
                "display_name": "Gap Analysis",
                "actions": ["view", "create", "edit"]
            }
        ]
    },
    {
        "module": "compliance",
        "display_name": "Compliance",
        "submodules": [
            {
                "name": "assessments",
                "display_name": "Compliance Assessments",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "statements",
                "display_name": "Compliance Statements",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "frameworks",
                "display_name": "Frameworks",
                "actions": ["view", "create", "edit", "delete"]
            },
            # CIS integration: three scanning permissions gated by the
            # `Scanning Admin` preset role. Administrators auto-bypass; any
            # other role needs the explicit grant. Names match exactly what
            # the new module routers check via require_tenant_permission(...).
            {
                "name": "scan",
                "display_name": "Compliance Scans (CIS)",
                "actions": ["execute"]
            },
            {
                "name": "agents",
                "display_name": "Compliance Agents",
                "actions": ["manage"]
            },
            {
                "name": "discover",
                "display_name": "Bulk Host Discovery",
                "actions": ["execute"]
            }
        ]
    },
    {
        "module": "evidence",
        "display_name": "Evidence Management",
        "submodules": [
            {
                "name": "evidence_library",
                "display_name": "Evidence Library",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "evidence_upload",
                "display_name": "Evidence Upload",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "audit_packages",
                "display_name": "Audit Packages",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "evidence_requirements",
                "display_name": "Evidence Requirements",
                "actions": ["view", "create", "edit", "delete"]
            }
        ]
    },
    {
        "module": "governance",
        "display_name": "Governance",
        "submodules": [
            {
                "name": "policies",
                "display_name": "Policies & Documents",
                "actions": ["view", "create", "edit", "delete", "approve", "publish"]
            },
            {
                "name": "policy_exceptions",
                "display_name": "Policy Exceptions",
                "actions": ["view", "create", "edit", "delete", "approve"]
            },
            {
                "name": "committees",
                "display_name": "Committees",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "meetings",
                "display_name": "Meetings",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "attestations",
                "display_name": "Attestations",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "workflows",
                "display_name": "Workflows",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "regulatory_changes",
                "display_name": "Regulatory Changes",
                "actions": ["view", "create", "edit", "delete"]
            }
        ]
    },
    {
        "module": "vulnerabilities",
        "display_name": "Vulnerability Management",
        "submodules": [
            {
                "name": "vulnerability_register",
                "display_name": "Vulnerability Register",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "remediation",
                "display_name": "Remediation",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "sla_management",
                "display_name": "SLA Management",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "reports",
                "display_name": "Reports",
                "actions": ["view", "create"]
            }
        ]
    },
    {
        "module": "assets",
        "display_name": "Asset Management",
        "submodules": [
            {
                "name": "asset_inventory",
                "display_name": "Asset Inventory",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "asset_classification",
                "display_name": "Asset Classification",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                # Criticality Assessments (ISCA + IACA per the bank
                # templates). `approve_ciso` is the dedicated tier-3
                # sign-off permission — keep it distinct from `edit` so
                # business owners can act at tier 2 without doubling as
                # the CISO.
                "name": "criticality_assessments",
                "display_name": "Criticality Assessments",
                "actions": ["view", "create", "edit", "delete", "approve_ciso"]
            }
        ]
    },
    {
        "module": "frameworks",
        "display_name": "Framework Management",
        "submodules": [
            {
                "name": "framework_library",
                "display_name": "Framework Library",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "framework_upload",
                "display_name": "Framework Upload",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "framework_mapping",
                "display_name": "Framework Mapping",
                "actions": ["view", "create", "edit"]
            }
        ]
    },
    {
        "module": "workflow_engine",
        "display_name": "Workflow Automation Engine",
        "submodules": [
            {
                "name": "definitions",
                "display_name": "Workflow Definitions",
                "actions": ["view", "create", "edit", "delete", "publish"]
            },
            {
                "name": "templates",
                "display_name": "Workflow Templates",
                "actions": ["view", "create", "edit", "delete", "publish"]
            },
            {
                "name": "executions",
                "display_name": "Workflow Executions",
                "actions": ["view", "create", "edit", "approve", "cancel"]
            },
            {
                "name": "integrations",
                "display_name": "Workflow Integrations",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "analytics",
                "display_name": "Workflow Analytics",
                "actions": ["view", "export"]
            },
            {
                "name": "ai",
                "display_name": "Workflow AI",
                "actions": ["view", "create", "edit"]
            }
        ]
    },
    {
        "module": "reports",
        "display_name": "Reports & Analytics",
        "submodules": [
            {
                "name": "dashboards",
                "display_name": "Dashboards",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "reports",
                "display_name": "Reports",
                "actions": ["view", "create", "edit", "delete", "export"]
            },
            {
                "name": "analytics",
                "display_name": "Analytics",
                "actions": ["view"]
            }
        ]
    },
    {
        "module": "admin",
        "display_name": "Administration",
        "submodules": [
            {
                "name": "organization",
                "display_name": "Organization Profile",
                "actions": ["view", "edit"]
            },
            {
                "name": "users",
                "display_name": "User Management",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "roles",
                "display_name": "Role Management",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "permissions",
                "display_name": "Permission Management",
                "actions": ["view", "assign"]
            },
            {
                "name": "audit_logs",
                "display_name": "Audit Logs",
                "actions": ["view"]
            },
            {
                "name": "settings",
                "display_name": "Settings",
                "actions": ["view", "edit"]
            },
            {
                "name": "integrations_sso",
                "display_name": "Identity Providers (SSO)",
                "actions": ["view", "manage"]
            }
        ]
    },
    {
        "module": "integrations",
        "display_name": "Integrations",
        "submodules": [
            {
                "name": "connections",
                "display_name": "Scanner Connections",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "exceptions",
                "display_name": "Vulnerability Exceptions",
                "actions": ["view", "create", "edit", "delete", "approve", "reject"]
            },
            {
                "name": "sync",
                "display_name": "Sync Management",
                "actions": ["view", "trigger"]
            },
            {
                "name": "analytics",
                "display_name": "Integration Analytics",
                "actions": ["view"]
            }
        ]
    },
    {
        "module": "is_projects",
        "display_name": "IS Projects",
        "submodules": [
            {
                "name": "projects",
                "display_name": "Projects",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "dashboard",
                "display_name": "Portfolio Dashboard",
                "actions": ["view"]
            }
        ]
    },
    {
        "module": "critical_tasks",
        "display_name": "Critical Tasks",
        "submodules": [
            {
                "name": "tasks",
                "display_name": "Task Board",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "reports",
                "display_name": "Task Reports",
                "actions": ["view"]
            },
            {
                "name": "templates",
                "display_name": "Task Templates",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "approvals",
                "display_name": "Task Approvals",
                "actions": ["view", "approve", "reject"]
            },
            {
                "name": "ai",
                "display_name": "Task AI",
                "actions": ["view", "create"]
            }
        ]
    },
    {
        # Issue Management — gates set on every endpoint in
        # backend/grc/modules/issue_management/routers/* (CRUD on Issues,
        # CAPA actions, comments, links, dashboard, matrices, automation
        # flags, and the activity / audit-log feed at /issues/{id}/activity).
        # Admin role and primary-contact bypass remain intact; non-admin
        # custom roles need at least the `view` action to use the module.
        "module": "issue_management",
        "display_name": "Issue Management",
        "submodules": [
            {
                "name": "issues",
                "display_name": "Issues, CAPA, Links & Audit Log",
                "actions": ["view", "create", "edit", "delete"]
            }
        ]
    },
    {
        "module": "vendor_risk",
        "display_name": "Vendor / Third-Party Risk (TPRA)",
        "submodules": [
            {
                "name": "vendors",
                "display_name": "Vendors",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "assessments",
                "display_name": "TPRA Assessments",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "lifecycle",
                "display_name": "Lifecycle (advance / send-back / skip)",
                "actions": ["view", "advance", "send_back", "skip"]
            },
            {
                "name": "findings",
                "display_name": "Findings & Remediation",
                "actions": ["view", "create", "edit", "delete", "accept_risk"]
            },
            {
                "name": "contracts",
                "display_name": "Contracts & Control Obligations",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "approvals",
                "display_name": "Approval Decisions",
                "actions": ["view", "approve"]
            },
            {
                "name": "monitoring",
                "display_name": "Continuous Monitoring",
                "actions": ["view", "create", "edit", "delete"]
            },
            {
                "name": "templates",
                "display_name": "Questionnaire Templates",
                "actions": ["view", "create", "edit", "delete"]
            }
        ]
    }
]


def get_all_permissions() -> list:
    permissions = []
    for module_data in PERMISSION_MATRIX:
        module = module_data["module"]
        module_display = module_data["display_name"]
        for submodule_data in module_data.get("submodules", []):
            submodule = submodule_data["name"]
            submodule_display = submodule_data["display_name"]
            for action in submodule_data.get("actions", []):
                perm_name = f"{module}:{submodule}:{action}"
                permissions.append({
                    "name": perm_name,
                    "module": module,
                    "module_display": module_display,
                    "submodule": submodule,
                    "submodule_display": submodule_display,
                    "action": action,
                    "description": f"{action.replace('_', ' ').title()} {submodule_display}"
                })
    return permissions


def get_permission_matrix_for_ui() -> list:
    result = []
    for module_data in PERMISSION_MATRIX:
        module_item = {
            "module": module_data["module"],
            "display_name": module_data["display_name"],
            "submodules": []
        }
        for submodule_data in module_data.get("submodules", []):
            submodule_item = {
                "name": submodule_data["name"],
                "display_name": submodule_data["display_name"],
                "actions": submodule_data.get("actions", [])
            }
            module_item["submodules"].append(submodule_item)
        result.append(module_item)
    return result
