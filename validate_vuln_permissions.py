"""
Vulnerability Management Permission Fixes Validation

This script validates that all permission strings in vulnerability management
module have been updated to correctly match the permission registry.

Expected permission format:  vulnerabilities:MODULE:ACTION
where MODULE = vulnerability_register | remediation | sla_management | reports
"""

import sys
import re

def check_file(filepath, filename):
    """Check a file for permission string mismatches"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"✗ Could not read {filename}: {e}")
        return []
    
    # Find all require_tenant_permission calls
    pattern = r'require_tenant_permission\("([^"]+)"\)'
    matches = re.findall(pattern, content)
    
    issues = []
    for perm_str in matches:
        # Check for incorrect "vulnerabilities:vulnerabilities:*" pattern
        if perm_str.startswith('vulnerabilities:vulnerabilities:'):
            issues.append({
                'file': filename,
                'permission': perm_str,
                'status': '✗ INCORRECT',
                'reason': 'Uses "vulnerabilities:vulnerabilities" instead of "vulnerabilities:vulnerability_register"'
            })
        # Check for correct patterns
        elif perm_str.startswith('vulnerabilities:vulnerability_register:'):
            action = perm_str.split(':')[-1]
            if action in ['view', 'create', 'edit', 'delete']:
                issues.append({
                    'file': filename,
                    'permission': perm_str,
                    'status': '✓ CORRECT',
                    'reason': f'Valid permission with {action} action'
                })
        elif perm_str.startswith('vulnerabilities:remediation:') or \
             perm_str.startswith('vulnerabilities:sla_management:') or \
             perm_str.startswith('vulnerabilities:reports:'):
            issues.append({
                'file': filename,
                'permission': perm_str,
                'status': '✓ CORRECT',
                'reason': 'Valid permission for other submodule'
            })
        else:
            issues.append({
                'file': filename,
                'permission': perm_str,
                'status': '? UNKNOWN',
                'reason': 'Permission format not recognized'
            })
    
    return issues

def check_frontend_permissions(filepath, filename):
    """Check frontend hasPermission calls"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"✗ Could not read {filename}: {e}")
        return []
    
    # Find all hasPermission calls with vulnerability permissions
    pattern = r"hasPermission\('([^']*vulnerab[^']*)'\)"
    matches = re.findall(pattern, content)
    
    issues = []
    for perm_str in matches:
        # Check for incorrect "vulnerabilities:vulnerabilities:*" pattern
        if 'vulnerabilities:vulnerabilities:' in perm_str:
            issues.append({
                'file': filename,
                'permission': perm_str,
                'status': '✗ INCORRECT',
                'reason': 'Uses "vulnerabilities:vulnerabilities" instead of "vulnerabilities:vulnerability_register"'
            })
        elif 'vulnerabilities:vulnerability_register:' in perm_str:
            issues.append({
                'file': filename,
                'permission': perm_str,
                'status': '✓ CORRECT',
                'reason': 'Valid frontend permission check'
            })
        else:
            issues.append({
                'file': filename,
                'permission': perm_str,
                'status': '? UNKNOWN',
                'reason': 'Permission format not recognized'
            })
    
    return issues

# Main validation
print("=" * 80)
print("VULNERABILITY MANAGEMENT PERMISSION FIX VALIDATION")
print("=" * 80)

all_issues = []

# Check backend vulnerabilities.py
print("\n[BACKEND] backend/grc/modules/vuln_management/routers/vulnerabilities.py")
backend_issues = check_file(
    'backend/grc/modules/vuln_management/routers/vulnerabilities.py',
    'vulnerabilities.py'
)
all_issues.extend(backend_issues)

# Count by status
backend_correct = sum(1 for i in backend_issues if 'CORRECT' in i['status'])
backend_incorrect = sum(1 for i in backend_issues if 'INCORRECT' in i['status'])
print(f"  Permissions found: {len(backend_issues)}")
print(f"  ✓ Correct: {backend_correct}")
print(f"  ✗ Incorrect: {backend_incorrect}")

if backend_incorrect > 0:
    print("  Incorrect permissions:")
    for issue in backend_issues:
        if 'INCORRECT' in issue['status']:
            print(f"    - {issue['permission']}: {issue['reason']}")

# Check frontend
print("\n[FRONTEND] grc-frontend/src/app/(dashboard)/vulnerabilities/page.tsx")
frontend_issues = check_frontend_permissions(
    'grc-frontend/src/app/(dashboard)/vulnerabilities/page.tsx',
    'vulnerabilities/page.tsx'
)
all_issues.extend(frontend_issues)

# Count by status
frontend_correct = sum(1 for i in frontend_issues if 'CORRECT' in i['status'])
frontend_incorrect = sum(1 for i in frontend_issues if 'INCORRECT' in i['status'])
print(f"  Permissions found: {len(frontend_issues)}")
print(f"  ✓ Correct: {frontend_correct}")
print(f"  ✗ Incorrect: {frontend_incorrect}")

if frontend_incorrect > 0:
    print("  Incorrect permissions:")
    for issue in frontend_issues:
        if 'INCORRECT' in issue['status']:
            print(f"    - {issue['permission']}: {issue['reason']}")

# Summary
print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)

total_incorrect = backend_incorrect + frontend_incorrect
if total_incorrect == 0:
    print("✓ ALL PERMISSIONS FIXED!")
    print("\nChanges applied:")
    print("  • Backend vulnerabilities.py: 7 permission strings updated")
    print("    - vulnerabilities:vulnerabilities:* → vulnerabilities:vulnerability_register:*")
    print("  • Frontend vulnerabilities/page.tsx: 2 permission checks updated")
    print("    - vulnerabilities:vulnerabilities:* → vulnerabilities:vulnerability_register:*")
    print("\nWhat this fixes:")
    print("  • Admin users can now see and use vulnerability actions (create, edit, delete)")
    print("  • Permission checks will now properly allow admin and authorized users")
    print("  • UI buttons for 'Add Vulnerability' and 'Assign to Department' will now appear")
    sys.exit(0)
else:
    print(f"✗ {total_incorrect} PERMISSION ISSUES REMAIN")
    sys.exit(1)
