"""
Debug script to verify permission configuration in the database
"""
import sys
sys.path.insert(0, 'backend')

from grc.models import SessionLocal, TenantPermission, TenantRole, TenantRolePermission, TenantSchemaUser, TenantUserRole
import json

db = SessionLocal()

print("=" * 80)
print("VULNERABILITY MANAGEMENT PERMISSIONS VERIFICATION")
print("=" * 80)

try:
    # Get all vulnerability-related permissions
    vuln_perms = db.query(TenantPermission).filter(
        TenantPermission.name.like('%vulnerabi%')
    ).all()
    
    print(f"\nVulnerability Permissions in Database: {len(vuln_perms)}")
    for perm in vuln_perms[:10]:
        print(f"  • {perm.name}")
    
    # Get admin role
    admin_roles = db.query(TenantRole).filter(
        TenantRole.name == 'Administrator'
    ).all()
    
    print(f"\nAdministrator Roles Found: {len(admin_roles)}")
    
    if admin_roles:
        admin_role = admin_roles[0]
        print(f"  Admin Role ID: {admin_role.id}")
        print(f"  Admin Role Name: {admin_role.name}")
        
        # Get all permissions for admin role
        admin_perms = db.query(TenantRolePermission).filter(
            TenantRolePermission.role_id == admin_role.id
        ).all()
        
        print(f"  Total permissions for admin role: {len(admin_perms)}")
        
        # Count vulnerability permissions
        vuln_admin_perms = [
            rp for rp in admin_perms 
            if rp.permission and 'vulnerabili' in rp.permission.name.lower()
        ]
        print(f"  Vulnerability-related permissions: {len(vuln_admin_perms)}")
        for rp in vuln_admin_perms[:5]:
            if rp.permission:
                print(f"    • {rp.permission.name}")
    
    # Get first admin user
    print(f"\nSearching for admin users...")
    admin_users = db.query(TenantSchemaUser).filter(
        TenantSchemaUser.is_superuser == True
    ).limit(3).all()
    
    print(f"Superusers found: {len(admin_users)}")
    for user in admin_users:
        print(f"  • Username: {user.username}")
        print(f"    Email: {user.email}")
        print(f"    ID: {user.id}")
        
        # Get user's roles
        user_roles = db.query(TenantUserRole).filter(
            TenantUserRole.user_id == user.id
        ).all()
        print(f"    Roles: {len(user_roles)}")
        for ur in user_roles[:3]:
            print(f"      - Role ID: {ur.role_id}")

    print("\n✓ Permission verification complete")
    
except Exception as e:
    print(f"\n✗ Error: {e}")
    import traceback
    traceback.print_exc()

finally:
    db.close()
