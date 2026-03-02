'use client';

import { useState, useEffect } from 'react';

export function usePermissions() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          setPermissions(data.user?.permissions || []);
        }
      } catch (error) {
        console.error('Failed to fetch permissions:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPermissions();
  }, []);

  const hasPermission = (permission: string): boolean => {
    if (permissions.includes('*:*:*')) return true; // Admin has all permissions
    
    // Check for exact match
    if (permissions.includes(permission)) return true;
    
    // Check for wildcard match (e.g., "risks:risk_register:*" matches "risks:risk_register:edit")
    const parts = permission.split(':');
    if (parts.length === 3) {
      const wildcardPerm = `${parts[0]}:${parts[1]}:*`;
      if (permissions.includes(wildcardPerm)) return true;
      
      // Check module-level wildcard (e.g., "risks:*:*")
      const moduleWildcard = `${parts[0]}:*:*`;
      if (permissions.includes(moduleWildcard)) return true;
    }
    
    return false;
  };

  const hasAnyPermission = (perms: string[]): boolean => {
    return perms.some(perm => hasPermission(perm));
  };

  return {
    permissions,
    hasPermission,
    hasAnyPermission,
    isLoading,
  };
}
