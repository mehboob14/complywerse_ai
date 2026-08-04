"""Synthesise a runner check_definition JSON from CIS audit text.

This is best-effort — we recognise a small but high-yield set of patterns:

  • `aws <service> <op> ...`  → aws_readonly check (service+operation)
  • `grep '^Foo' /etc/bar`    → linux_ssh shell check (cmd, expect.kind=stdout_contains)
  • `cat /etc/foo`            → linux_ssh shell check
  • `stat /etc/foo`           → linux_ssh shell check
  • `net accounts`            → windows_winrm shell check

For CIS Windows benchmarks specifically, four authoritative tables are
embedded below (User Rights Assignment, Security Options, well-known 18.x
machine-policy registry mappings, and Principal→SID lookups). Those tables
let the synthesizer emit concrete checks for the ~130 rules whose CIS PDF
audit text reads "Navigate to UI Path…" and gives nothing executable.

Anything we still don't recognise gets a placeholder check_definition with
the raw audit text in `notes`. Those rules are flagged
`review_status='pending_review'` and `auto_generated_check=True` so they
never silently execute.
"""
from __future__ import annotations

import re
from typing import Any

# =============================================================================
# CIS Windows authoritative reference tables.
# =============================================================================

# Section 2.2 — User Rights Assignment.
# Maps the (lower-cased) policy phrase from the CIS title to the underlying
# Local Security Policy privilege constant.
CIS_USER_RIGHTS_BY_TITLE = {
    "access credential manager as a trusted caller": "SeTrustedCredManAccessPrivilege",
    "access this computer from the network": "SeNetworkLogonRight",
    "act as part of the operating system": "SeTcbPrivilege",
    "add workstations to domain": "SeMachineAccountPrivilege",
    "adjust memory quotas for a process": "SeIncreaseQuotaPrivilege",
    "allow log on locally": "SeInteractiveLogonRight",
    "allow log on through remote desktop services": "SeRemoteInteractiveLogonRight",
    "back up files and directories": "SeBackupPrivilege",
    "change the system time": "SeSystemtimePrivilege",
    "change the time zone": "SeTimeZonePrivilege",
    "create a pagefile": "SeCreatePagefilePrivilege",
    "create a token object": "SeCreateTokenPrivilege",
    "create global objects": "SeCreateGlobalPrivilege",
    "create permanent shared objects": "SeCreatePermanentPrivilege",
    "create symbolic links": "SeCreateSymbolicLinkPrivilege",
    "debug programs": "SeDebugPrivilege",
    "deny access to this computer from the network": "SeDenyNetworkLogonRight",
    "deny log on as a batch job": "SeDenyBatchLogonRight",
    "deny log on as a service": "SeDenyServiceLogonRight",
    "deny log on locally": "SeDenyInteractiveLogonRight",
    "deny log on through remote desktop services": "SeDenyRemoteInteractiveLogonRight",
    "enable computer and user accounts to be trusted for delegation": "SeEnableDelegationPrivilege",
    "force shutdown from a remote system": "SeRemoteShutdownPrivilege",
    "generate security audits": "SeAuditPrivilege",
    "impersonate a client after authentication": "SeImpersonatePrivilege",
    "increase scheduling priority": "SeIncreaseBasePriorityPrivilege",
    "load and unload device drivers": "SeLoadDriverPrivilege",
    "lock pages in memory": "SeLockMemoryPrivilege",
    "log on as a batch job": "SeBatchLogonRight",
    "log on as a service": "SeServiceLogonRight",
    "manage auditing and security log": "SeSecurityPrivilege",
    "modify an object label": "SeRelabelPrivilege",
    "modify firmware environment values": "SeSystemEnvironmentPrivilege",
    "perform volume maintenance tasks": "SeManageVolumePrivilege",
    "profile single process": "SeProfileSingleProcessPrivilege",
    "profile system performance": "SeSystemProfilePrivilege",
    "replace a process level token": "SeAssignPrimaryTokenPrivilege",
    "restore files and directories": "SeRestorePrivilege",
    "shut down the system": "SeShutdownPrivilege",
    "synchronize directory service data": "SeSyncAgentPrivilege",
    "take ownership of files or other objects": "SeTakeOwnershipPrivilege",
    "increase a process working set": "SeIncreaseWorkingSetPrivilege",
}

# Canonical principal label → SID. The strings on the left are the exact
# phrases CIS uses in titles (after we lower-case + strip). Multiple SIDs
# for a single phrase are stored as a list; the user-rights handler will
# expand them into the expected_sids set.
PRINCIPAL_TO_SID = {
    "administrators": ["S-1-5-32-544"],
    "users": ["S-1-5-32-545"],
    "guests": ["S-1-5-32-546"],
    "power users": ["S-1-5-32-547"],
    "account operators": ["S-1-5-32-548"],
    "server operators": ["S-1-5-32-549"],
    "print operators": ["S-1-5-32-550"],
    "backup operators": ["S-1-5-32-551"],
    "replicator": ["S-1-5-32-552"],
    "remote desktop users": ["S-1-5-32-555"],
    "remote management users": ["S-1-5-32-580"],
    "network configuration operators": ["S-1-5-32-556"],
    "performance log users": ["S-1-5-32-559"],
    "performance monitor users": ["S-1-5-32-558"],
    "authenticated users": ["S-1-5-11"],
    "everyone": ["S-1-1-0"],
    "anonymous logon": ["S-1-5-7"],
    "local service": ["S-1-5-19"],
    "network service": ["S-1-5-20"],
    "service": ["S-1-5-6"],
    "system": ["S-1-5-18"],
    "local account": ["S-1-5-113"],
    "local account and member of administrators group": ["S-1-5-114"],
    "window manager": ["S-1-5-90"],
    "window manager\\window manager group": ["S-1-5-90-0"],
    "nt service\\wdiservicehost": ["S-1-5-80-3139157870-2983391045-3678747466-658725712-1809340420"],
    "wdiservicehost": ["S-1-5-80-3139157870-2983391045-3678747466-658725712-1809340420"],
    "iis_iusrs": ["S-1-5-32-568"],
    "nt virtual machine\\virtual machines": ["S-1-5-83-0"],
    "virtual machines": ["S-1-5-83-0"],
    "no one": [],
}


# Section 2.3 — Security Options.
# Each entry maps a (lowercased) keyword from the CIS title to a check
# spec. Mechanism is one of:
#   {"mechanism": "secedit_systemaccess", "field": "EnableGuestAccount"}
#   {"mechanism": "registry",
#    "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
#    "value_name": "RestrictAnonymous"}
#
# Compiled from CIS Microsoft Windows 11 Enterprise Benchmark v5.0.1
# Section 2.3 ("Security Options").
CIS_SECURITY_OPTIONS = [
    ("accounts: guest account status",
     {"mechanism": "secedit_systemaccess", "field": "EnableGuestAccount"}),
    ("accounts: limit local account use of blank passwords",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
      "value_name": "LimitBlankPasswordUse"}),
    ("accounts: rename administrator account",
     {"mechanism": "secedit_systemaccess", "field": "NewAdministratorName"}),
    ("accounts: rename guest account",
     {"mechanism": "secedit_systemaccess", "field": "NewGuestName"}),
    ("accounts: block microsoft accounts",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "NoConnectedUser"}),
    ("audit: force audit policy subcategory settings",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
      "value_name": "SCENoApplyLegacyAuditPolicy"}),
    ("audit: shut down system immediately if unable to log security audits",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
      "value_name": "CrashOnAuditFail"}),
    ("devices: allowed to format and eject removable media",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon",
      "value_name": "AllocateDASD"}),
    ("devices: prevent users from installing printer drivers",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Print\\Providers\\LanMan Print Services\\Servers",
      "value_name": "AddPrinterDrivers"}),
    ("domain member: digitally encrypt or sign secure channel data (always)",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "RequireSignOrSeal"}),
    ("domain member: digitally encrypt secure channel data (when possible)",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "SealSecureChannel"}),
    ("domain member: digitally sign secure channel data (when possible)",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "SignSecureChannel"}),
    ("domain member: disable machine account password changes",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "DisablePasswordChange"}),
    ("domain member: maximum machine account password age",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "MaximumPasswordAge"}),
    ("domain member: require strong (windows 2000 or later) session key",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "RequireStrongKey"}),
    ("interactive logon: do not require ctrl+alt+del",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "DisableCAD"}),
    ("interactive logon: don't display last signed-in",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "DontDisplayLastUserName"}),
    ("interactive logon: machine inactivity limit",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "InactivityTimeoutSecs"}),
    ("interactive logon: message text for users attempting to log on",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "LegalNoticeText"}),
    ("interactive logon: message title for users attempting to log on",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "LegalNoticeCaption"}),
    ("interactive logon: number of previous logons to cache",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon",
      "value_name": "CachedLogonsCount"}),
    ("interactive logon: prompt user to change password before expiration",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon",
      "value_name": "PasswordExpiryWarning"}),
    ("interactive logon: smart card removal behavior",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon",
      "value_name": "ScRemoveOption"}),
    ("microsoft network client: digitally sign communications (always)",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters",
      "value_name": "RequireSecuritySignature"}),
    ("microsoft network client: digitally sign communications (if server agrees)",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters",
      "value_name": "EnableSecuritySignature"}),
    ("microsoft network client: send unencrypted password to third-party smb servers",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters",
      "value_name": "EnablePlainTextPassword"}),
    ("microsoft network server: amount of idle time required before suspending",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "AutoDisconnect"}),
    ("microsoft network server: digitally sign communications (always)",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "RequireSecuritySignature"}),
    ("microsoft network server: digitally sign communications (if client agrees)",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "EnableSecuritySignature"}),
    ("microsoft network server: disconnect clients when logon hours expire",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "EnableForcedLogOff"}),
    ("microsoft network server: server spn target name validation",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "SMBServerNameHardeningLevel"}),
    ("network access: allow anonymous sid/name translation",
     {"mechanism": "secedit_systemaccess", "field": "LSAAnonymousNameLookup"}),
    ("network access: do not allow anonymous enumeration of sam accounts",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "RestrictAnonymousSAM"}),
    ("network access: do not allow anonymous enumeration of sam accounts and shares",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "RestrictAnonymous"}),
    ("network access: do not allow storage of passwords and credentials",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "DisableDomainCreds"}),
    ("network access: let everyone permissions apply to anonymous users",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "EveryoneIncludesAnonymous"}),
    ("network access: restrict anonymous access to named pipes and shares",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "RestrictNullSessAccess"}),
    ("network access: named pipes that can be accessed anonymously",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "NullSessionPipes",
      "reg_multi_sz_expected_blank": True}),
    ("network access: remotely accessible registry paths and sub-paths",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurePipeServers\\Winreg\\AllowedPaths",
      "value_name": "Machine",
      "reg_multi_sz_expected_blank": False}),
    ("network access: remotely accessible registry paths",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurePipeServers\\Winreg\\AllowedExactPaths",
      "value_name": "Machine",
      "reg_multi_sz_expected_blank": False}),
    ("domain controller: ldap server signing requirements",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters",
      "value_name": "LDAPServerIntegrity"}),
    ("domain controller: refuse machine account password changes",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "RefusePasswordChange"}),
    ("domain controller: allow vulnerable netlogon secure channel connections",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Netlogon\\Parameters",
      "value_name": "VulnerableChannelAllowList",
      "reg_multi_sz_expected_blank": True}),
    ("network access: restrict clients allowed to make remote calls to sam",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa",
      "value_name": "RestrictRemoteSAM"}),
    ("network access: shares that can be accessed anonymously",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LanManServer\\Parameters",
      "value_name": "NullSessionShares"}),
    ("network access: sharing and security model for local accounts",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "ForceGuest"}),
    ("network security: allow local system to use computer identity for ntlm",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "UseMachineId"}),
    ("network security: allow localsystem null session fallback",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa\\MSV1_0",
      "value_name": "AllowNullSessionFallback"}),
    ("network security: allow pku2u authentication requests to this computer to use online identities",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa\\pku2u",
      "value_name": "AllowOnlineID"}),
    ("network security: configure encryption types allowed for kerberos",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\Kerberos\\Parameters",
      "value_name": "SupportedEncryptionTypes"}),
    ("network security: do not store lan manager hash value on next password change",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "NoLMHash"}),
    ("network security: force logoff when logon hours expire",
     {"mechanism": "secedit_systemaccess", "field": "ForceLogoffWhenHourExpire"}),
    ("network security: lan manager authentication level",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa",
      "value_name": "LmCompatibilityLevel"}),
    ("network security: ldap client signing requirements",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Services\\LDAP",
      "value_name": "LDAPClientIntegrity"}),
    ("network security: minimum session security for ntlm ssp based",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Lsa\\MSV1_0",
      "value_name": "NTLMMinClientSec"}),
    ("network security: restrict ntlm: audit incoming ntlm traffic",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa\\MSV1_0",
      "value_name": "AuditReceivingNTLMTraffic"}),
    ("network security: restrict ntlm: outgoing ntlm traffic to remote servers",
     {"mechanism": "registry",
      "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa\\MSV1_0",
      "value_name": "RestrictSendingNTLMTraffic"}),
    ("shutdown: allow system to be shut down without having to log on",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "ShutdownWithoutLogon"}),
    ("system objects: require case insensitivity for non-windows subsystems",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Session Manager\\Kernel",
      "value_name": "ObCaseInsensitive"}),
    ("system objects: strengthen default permissions of internal system objects",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Session Manager",
      "value_name": "ProtectionMode"}),
    ("system settings: optional subsystems",
     {"mechanism": "registry",
      "path": "HKLM:\\System\\CurrentControlSet\\Control\\Session Manager\\SubSystems",
      "value_name": "optional"}),
    ("user account control: admin approval mode for the built-in administrator",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "FilterAdministratorToken"}),
    ("user account control: allow uiaccess applications to prompt for elevation",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "EnableUIADesktopToggle"}),
    ("user account control: behavior of the elevation prompt for administrators",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "ConsentPromptBehaviorAdmin"}),
    ("user account control: behavior of the elevation prompt for standard users",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "ConsentPromptBehaviorUser"}),
    ("user account control: detect application installations and prompt for elevation",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "EnableInstallerDetection"}),
    ("user account control: only elevate uiaccess applications that are installed in secure locations",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "EnableSecureUIAPaths"}),
    ("user account control: run all administrators in admin approval mode",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "EnableLUA"}),
    ("user account control: switch to the secure desktop when prompting for elevation",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "PromptOnSecureDesktop"}),
    ("user account control: virtualize file and registry write failures",
     {"mechanism": "registry",
      "path": "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
      "value_name": "EnableVirtualization"}),
]


# Section 18.x — well-known HKLM machine policy rules whose audit text the
# PDF extractor failed to capture. These map the policy quoted-name from
# the title to the canonical registry path + value name.
CIS_18X_KNOWN_REGISTRY = {
    "allow access to bitlocker-protected fixed data drives from earlier versions of windows":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\FVE",
         "FDVDiscoveryVolumeType"),
    "allow access to bitlocker-protected removable data drives from earlier versions of windows":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\FVE",
         "RDVDiscoveryVolumeType"),
    "service enabled":  # 18.10.77.1.5 — RPC EpMapper
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Rpc",
         "EnableAuthEpResolution"),
    "allow remote shell access":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WinRM\\Service\\WinRS",
         "AllowRemoteShellAccess"),
    "configure smb v1 server":
        ("HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters",
         "SMB1"),
    "wdigest authentication":
        ("HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest",
         "UseLogonCredential"),
    "enable insecure guest logons":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\LanmanWorkstation",
         "AllowInsecureGuestAuth"),

    # Section 18.9 — Group Policy / Power / Device-Install / PerfTrack
    "configure security policy processing: do not apply during periodic":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Group Policy\\{827D319E-6EAC-11D2-A4EA-00C04F79F83A}",
         "NoBackgroundPolicy"),
    "configure security policy processing: process even if the group policy objects":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Group Policy\\{827D319E-6EAC-11D2-A4EA-00C04F79F83A}",
         "NoGPOListChanges"),
    "turn off background refresh of group policy":
        ("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
         "DisableBkGndGroupPolicy"),
    "allow network connectivity during connected- standby (on battery)":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Power\\PowerSettings\\f15576e8-98b7-4186-b944-eafa664402d9",
         "DCSettingIndex"),
    "allow network connectivity during connected- standby (plugged in)":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Power\\PowerSettings\\f15576e8-98b7-4186-b944-eafa664402d9",
         "ACSettingIndex"),
    "allow standby states (s1-s3) when sleeping (on battery)":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Power\\PowerSettings\\abfc2519-3608-4c2a-94ea-171b0ed546ab",
         "DCSettingIndex"),
    "allow standby states (s1-s3) when sleeping (plugged in)":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Power\\PowerSettings\\abfc2519-3608-4c2a-94ea-171b0ed546ab",
         "ACSettingIndex"),
    "require a password when a computer wakes (on battery)":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Power\\PowerSettings\\0e796bdb-100d-47d6-a2d5-f7d2daa51f51",
         "DCSettingIndex"),
    "require a password when a computer wakes (plugged in)":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Power\\PowerSettings\\0e796bdb-100d-47d6-a2d5-f7d2daa51f51",
         "ACSettingIndex"),
    "enable/disable perftrack":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WDI\\{9c5a40da-b965-4fc3-8781-88dd50a6299d}",
         "ScenarioExecutionEnabled"),
    "prevent installation of devices using drivers that match these device":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceInstall\\Restrictions",
         "DenyDeviceClasses"),

    # Section 18.10 — Delivery Optimization / RDP / WinRM
    "download mode":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization",
         "DODownloadMode"),
    "session time limits":  # 18.10.57.3.10 — RDS idle session limit
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services",
         "MaxIdleTime"),

    # Section 9.x — Windows Firewall logging name (REG_SZ path)
    "windows firewall: domain: logging: name":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\DomainProfile\\Logging",
         "LogFilePath"),
    "windows firewall: private: logging: name":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\PrivateProfile\\Logging",
         "LogFilePath"),
    "windows firewall: public: logging: name":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\PublicProfile\\Logging",
         "LogFilePath"),
    "windows firewall: domain: logging: size limit":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\DomainProfile\\Logging",
         "LogFileSize"),
    "windows firewall: private: logging: size limit":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\PrivateProfile\\Logging",
         "LogFileSize"),
    "windows firewall: public: logging: size limit":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\PublicProfile\\Logging",
         "LogFileSize"),

    # Section 18.6.14.1 — Hardened UNC Paths (REG_SZ value name = the UNC pattern;
    # we check at least one paranoid value is present)
    "hardened unc paths":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\NetworkProvider\\HardenedPaths",
         "*"),  # special: any value name — verified differently below

    # Section 8.3 — Exploit Guard ASR (covered by parent key existence check)
    "enable operating system anti-exploitation features":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Windows Defender Exploit Guard\\ASR\\Rules",
         "*"),

    # Stand-alone benchmark v2.0.0 extras whose CIS PDF body left the
    # registry hint empty (audit just says "Navigate to UI Path...").
    "toggle user control over insider builds":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsStore",
         "DisableOSUpgrade"),
    "enable app installer":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\AppInstaller",
         "EnableAppInstaller"),
    "select when preview builds and feature updates are received":
        ("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate",
         "DeferFeatureUpdates"),
    "disable ipv6":
        ("HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters",
         "DisabledComponents"),
    "include command line in process creation events":
        ("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\Audit",
         "ProcessCreationIncludeCmdLine_Enabled"),
}


def _normalize_audit(txt: str) -> str:
    """Rejoin identifier fragments split by PDF line wrap.

    The CIS PDFs frequently split long identifiers (registry value names,
    policy paths, GUIDs) across line boundaries. e.g.:
        HKU\\[USER
        SID]\\Software\\Policies\\…:NoT
        oastApplicationNotificationOnLockScreen
    and:
        HKLM\\SOFTWARE\\Policies\\Microsoft\\Power\\f15576e8-98b7-4186-b944-
        eafa664402d9:DCSetting
    We rejoin any newline that sits between alphanumeric / dash / dot
    characters (i.e. wraps inside a single identifier or GUID) so the
    registry regex can match.
    """
    if not txt:
        return ""
    # Drop newlines inside identifiers, GUIDs, paths — any of [A-Za-z0-9_.-]
    # on both sides of the newline ⇒ rejoin without inserting a space.
    s = re.sub(r"([A-Za-z0-9_.\-])[\r\n]+([A-Za-z0-9_])", r"\1\2", txt)
    # Collapse `[USER\nSID]` (with optional space) — drops to single token
    s = re.sub(r"\[\s*USER\s+SID\s*\]", "[USER SID]", s)
    # Drop newlines after backslashes inside paths
    s = re.sub(r"\\[\r\n]+", "\\\\", s)
    # Drop newlines after colons (sometimes the value name wraps to the
    # next line: `…\\System:` + newline + `LegalNoticeText`)
    s = re.sub(r":[\r\n]+(\w)", r":\1", s)
    return s


def _get_expected(text: str) -> tuple[str | None, str]:
    """Extract the CIS-expected value from audit/title text.

    Returns (expected_value, mode) where mode is one of:
      * "equals"     — registry value must equal expected_value
      * "not_equals" — registry value must NOT equal expected_value
      * "blank"      — registry value must be empty / not present
      * "unknown"    — couldn't determine (expected_value is None)

    Recognised patterns:
      * "REG_DWORD value of N"                     → ("N", "equals")
      * "REG_DWORD value of N or less|more|fewer"  → ("N", "equals")  [conservative]
      * "value of `N"  (backtick literal)          → ("N", "equals")
      * "value of anything other than N"           → ("N", "not_equals")
      * "is set to 'Disabled'"                     → ("0", "equals")
      * "is set to 'Enabled'"                      → ("1", "equals")
      * "is NOT set to 'Enabled'"                  → ("1", "not_equals")
      * "is blank" / "no value in key" / "<blank>" → ("", "blank")
    """
    if not text:
        return (None, "unknown")
    # "is NOT set to" — negation
    m = re.search(r"is\s+NOT\s+set\s+to\s*['\"]?(Enabled|Disabled|On|Off|\d+)", text, re.IGNORECASE)
    if m:
        v = m.group(1).lower()
        if v in ("enabled", "on"):
            return ("1", "not_equals")
        if v in ("disabled", "off"):
            return ("0", "not_equals")
        return (v, "not_equals")
    # "anything other than N"
    m = re.search(r"anything other than\s+(\d+)", text, re.IGNORECASE)
    if m:
        return (m.group(1), "not_equals")
    # blank / not present
    if re.search(r"\b(is blank|no value (in key|set)|value (that is |of )?(<blank>|blank|empty|does not exist))", text, re.IGNORECASE):
        return ("", "blank")
    # REG_DWORD value of N
    m = re.search(r"REG_DWORD value of\s*`?(\d+)", text, re.IGNORECASE)
    if m:
        return (m.group(1), "equals")
    # "value of N" (with optional backtick prefix)
    m = re.search(r"value of\s*`?(\d+)\b", text, re.IGNORECASE)
    if m:
        return (m.group(1), "equals")
    # "REG_DWORD value between A and B" — pick the higher end (CIS recommends max)
    m = re.search(r"between\s+(\d+)\s+and\s+(\d+)", text, re.IGNORECASE)
    if m:
        return (m.group(2), "equals")
    # "is set to 'Enabled' / 'Disabled' / 'N'"
    m = re.search(r"is set to\s*['\"]?(Enabled|Disabled|On|Off|None)['\"]?", text, re.IGNORECASE)
    if m:
        v = m.group(1).lower()
        if v in ("enabled", "on"):
            return ("1", "equals")
        if v in ("disabled", "off"):
            return ("0", "equals")
        if v == "none":
            return ("", "blank")
    # "is set to 'N' or higher"
    m = re.search(r"is set to\s*['\"]?(\d+)['\"]?(?:\s+(?:or|to)\b|\s*$|')", text, re.IGNORECASE)
    if m:
        return (m.group(1), "equals")
    return (None, "unknown")


def _try_catalog_dispatch(rule_id: str | None, title: str | None, txt: str) -> dict | None:
    """Try Section 2.2 / 2.3 / 18 / 19 catalog tables.

    Returns a complete check_definition dict on hit, or None if no catalog
    matches. Called BEFORE the generic regex-based handlers in the windows
    synthesiser.
    """
    if not rule_id or not title:
        return None

    # ── Section 2.2 — User Rights Assignment ─────────────────────────
    if rule_id.startswith("2.2."):
        tlow = title.lower()
        privilege = None
        for keyword, priv in CIS_USER_RIGHTS_BY_TITLE.items():
            if keyword in tlow:
                privilege = priv
                break
        if privilege:
            principals, raw_phrase = _principals_from_title(title)
            expected_sids: list[str] = []
            unknown: list[str] = []
            for p in principals:
                sids = PRINCIPAL_TO_SID.get(p)
                if sids is None and p.endswith(" group"):
                    sids = PRINCIPAL_TO_SID.get(p[:-6])
                if sids is None and "\\" in p:
                    sids = PRINCIPAL_TO_SID.get(p.split("\\", 1)[1])
                if sids is None:
                    unknown.append(p)
                else:
                    expected_sids.extend(sids)
            friendly = privilege
            _mn = re.search(r"'([^']{4,120})'", title)
            if _mn:
                friendly = _mn.group(1).strip()
            expected_phrase = raw_phrase or ("No One" if not principals else "")
            return {
                "shell": "cmd",
                "command": (
                    'secedit /export /cfg "%TEMP%\\grc_ur.inf" /areas '
                    'USER_RIGHTS /quiet && type "%TEMP%\\grc_ur.inf"'
                ),
                "expect": {
                    "kind": "user_rights_check",
                    "privilege": privilege,
                    "expected_sids": expected_sids,
                },
                "pass_message": f"'{friendly}' is correctly granted to {expected_phrase or 'no principals'}.",
                "fail_message": f"'{friendly}' is NOT set to {expected_phrase or 'No One'} (CIS requirement).",
                "_auto_generated": True,
                "_audit_excerpt": txt[:400],
                "_extracted": {
                    "category": "user_rights_assignment",
                    "privilege": privilege,
                    "expected_principals": principals,
                    "expected_sids": expected_sids,
                    "unknown_principals": unknown,
                    "friendly_label": friendly,
                },
                "_note": (
                    "Auto-generated User Rights Assignment check. "
                    + (f"UNKNOWN principals: {unknown}" if unknown else "Reviewer should confirm.")
                ),
            }

    # ── Section 2.3 — Security Options ───────────────────────────────
    if rule_id.startswith("2.3."):
        tlow = title.lower()
        spec = None
        matched_key = None
        for key, candidate in CIS_SECURITY_OPTIONS:
            if key in tlow:
                spec = candidate
                matched_key = key
                break
        if spec:
            friendly = matched_key
            _mn = re.search(r"'([^']{4,160})'", title)
            if _mn:
                friendly = _mn.group(1).strip()
            expected_val, mode = _get_expected(title or "")
            if expected_val is None:
                expected_val, mode = _get_expected(txt)
            if spec["mechanism"] == "secedit_systemaccess":
                # For string-valued fields (NewAdministratorName, NewGuestName)
                # there's no canonical CIS value — only "must NOT be 'Administrator'/'Guest'".
                if spec["field"] in ("NewAdministratorName", "NewGuestName"):
                    bad_name = "Administrator" if "admin" in spec["field"].lower() else "Guest"
                    return {
                        "shell": "cmd",
                        "command": (
                            'secedit /export /cfg "%TEMP%\\grc_secpol.inf" /areas '
                            'SECURITYPOLICY /quiet && type "%TEMP%\\grc_secpol.inf"'
                        ),
                        "expect": {
                            "kind": "stdout_not_regex",
                            "value": rf"^\s*{spec['field']}\s*=\s*\"?{bad_name}\"?\s*$",
                        },
                        "pass_message": f"'{friendly}' has been renamed away from the default '{bad_name}'.",
                        "fail_message": f"'{friendly}' is still the default '{bad_name}' (CIS requires rename).",
                        "_auto_generated": True,
                        "_audit_excerpt": txt[:400],
                        "_extracted": {
                            "category": "security_options",
                            "mechanism": "secedit_systemaccess",
                            "field": spec["field"],
                            "expected": f"NOT '{bad_name}'",
                            "friendly_label": friendly,
                        },
                        "_note": f"Auto-generated rename check (must differ from default '{bad_name}').",
                    }
                expected_str = expected_val if expected_val is not None else "1"
                return {
                    "shell": "cmd",
                    "command": (
                        'secedit /export /cfg "%TEMP%\\grc_secpol.inf" /areas '
                        'SECURITYPOLICY /quiet && type "%TEMP%\\grc_secpol.inf"'
                    ),
                    "expect": {
                        "kind": "secedit_field_equals",
                        "field": spec["field"],
                        "expected": expected_str,
                    },
                    "pass_message": f"'{friendly}' is correctly set to {expected_str}.",
                    "fail_message": f"'{friendly}' does not match CIS (expected {expected_str}).",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_extracted": {
                        "category": "security_options",
                        "mechanism": "secedit_systemaccess",
                        "field": spec["field"],
                        "expected": expected_str,
                        "friendly_label": friendly,
                    },
                    "_note": "Auto-generated Security Options check (secedit System Access).",
                }
            else:  # registry
                ps_path = spec["path"]
                value_name = spec["value_name"]
                # REG_MULTI_SZ list values: expected is either blank/empty
                # or non-empty (organisation-defined). We don't know the
                # exact contents, just that they're set or not.
                if "reg_multi_sz_expected_blank" in spec:
                    must_be_blank = bool(spec["reg_multi_sz_expected_blank"])
                    if must_be_blank:
                        return {
                            "shell": "powershell",
                            "command": (
                                f"$v = (Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                                f"-ErrorAction SilentlyContinue).'{value_name}'; "
                                f"if ($null -eq $v) {{ Write-Output 'EMPTY' }} "
                                f"elseif ($v -is [array] -and $v.Count -eq 0) {{ Write-Output 'EMPTY' }} "
                                f"elseif ([string]::IsNullOrEmpty(($v -join ''))) {{ Write-Output 'EMPTY' }} "
                                f"else {{ Write-Output ($v -join '|') }}"
                            ),
                            "expect": {"kind": "stdout_regex", "value": r"^\s*EMPTY\s*$"},
                            "pass_message": f"'{friendly}' is correctly empty (no entries).",
                            "fail_message": f"'{friendly}' has entries (CIS requires it empty).",
                            "_auto_generated": True,
                            "_audit_excerpt": txt[:400],
                            "_extracted": {
                                "category": "security_options",
                                "mechanism": "registry_multi_sz",
                                "registry_path": ps_path,
                                "value_name": value_name,
                                "expected": "<blank>",
                                "friendly_label": friendly,
                            },
                            "_note": "Auto-generated REG_MULTI_SZ blank check.",
                        }
                    else:
                        return {
                            "shell": "powershell",
                            "command": (
                                f"$v = (Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                                f"-ErrorAction SilentlyContinue).'{value_name}'; "
                                f"if ($null -eq $v) {{ Write-Output 'EMPTY' }} "
                                f"else {{ Write-Output ($v -join '|') }}"
                            ),
                            "expect": {"kind": "stdout_not_regex", "value": r"^\s*EMPTY\s*$"},
                            "pass_message": f"'{friendly}' is configured (organisation-defined list).",
                            "fail_message": f"'{friendly}' is missing or empty (CIS requires configured list).",
                            "_auto_generated": True,
                            "_audit_excerpt": txt[:400],
                            "_extracted": {
                                "category": "security_options",
                                "mechanism": "registry_multi_sz",
                                "registry_path": ps_path,
                                "value_name": value_name,
                                "expected": "<non-empty list>",
                                "friendly_label": friendly,
                            },
                            "_note": "Auto-generated REG_MULTI_SZ presence check (org-defined).",
                        }
                if mode == "blank":
                    return {
                        "shell": "powershell",
                        "command": (
                            f"Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                            f"-ErrorAction SilentlyContinue | Select-Object -ExpandProperty '{value_name}'"
                        ),
                        "expect": {"kind": "stdout_regex", "value": r"^\s*$"},
                        "pass_message": f"'{friendly}' is correctly empty / unset.",
                        "fail_message": f"'{friendly}' is set (CIS requires empty).",
                        "_auto_generated": True,
                        "_audit_excerpt": txt[:400],
                        "_extracted": {
                            "category": "security_options",
                            "mechanism": "registry",
                            "registry_path": ps_path,
                            "value_name": value_name,
                            "expected": "<blank>",
                            "friendly_label": friendly,
                        },
                        "_note": "Auto-generated Security Options check (blank/empty value).",
                    }
                expected_str = expected_val if expected_val is not None else "1"
                kind = "stdout_not_regex" if mode == "not_equals" else "stdout_regex"
                verb = ("Enabled" if expected_str == "1" else "Disabled" if expected_str == "0" else f"set to '{expected_str}'")
                if mode == "not_equals":
                    verb = f"NOT {verb}"
                return {
                    "shell": "powershell",
                    "command": (
                        f"Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                        f"-ErrorAction SilentlyContinue | Select-Object -ExpandProperty '{value_name}'"
                    ),
                    "expect": {"kind": kind, "value": rf"^\s*{re.escape(expected_str)}\s*$"},
                    "pass_message": f"'{friendly}' is correctly {verb}.",
                    "fail_message": f"'{friendly}' is NOT {verb} (CIS requirement).",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_extracted": {
                        "category": "security_options",
                        "mechanism": "registry",
                        "registry_path": ps_path,
                        "value_name": value_name,
                        "expected": expected_str,
                        "mode": mode,
                        "friendly_label": friendly,
                    },
                    "_note": "Auto-generated Security Options check (registry).",
                }

    # ── Section 19.x — HKCU per-user policy ─────────────────────────
    if rule_id.startswith("19."):
        # CIS PDFs write the placeholder hive as either `HKU\[USER SID]`
        # or `HKEY_USERS\[USER SID]` interchangeably. The line-wrap in
        # the PDF also frequently splits the bracket pair as
        # `[USER\nSID]`, which _normalize_audit already collapses to
        # `[USERSID]`. Accept all three shapes.
        hku_re = re.compile(
            r"(?:HKU|HKEY_USERS)\\\[USER\s*SID\]\\([\w\\\.\- ]+?)\s*:\s*([A-Za-z][A-Za-z0-9_]+)",
            re.IGNORECASE,
        )
        m = hku_re.search(txt)
        if m:
            sub_path = m.group(1).strip().rstrip("\\")
            value_name = m.group(2).strip()
            expected_val, mode = _get_expected(txt)
            if expected_val is None:
                expected_val, mode = _get_expected(title or "")
            if expected_val is None:
                expected_val = "1"
                mode = "equals"
            friendly = value_name
            _mn = re.search(r"'([^']{4,150})'", title or "")
            if _mn:
                friendly = _mn.group(1).strip()
            cmd = (
                "$root = 'Registry::HKEY_USERS'; "
                "$users = Get-ChildItem $root -ErrorAction SilentlyContinue | "
                "Where-Object { $_.PSChildName -match '^S-1-5-21-[0-9-]+$' }; "
                "if (-not $users) { Write-Output 'NO_INTERACTIVE_USERS' } "
                "else { "
                "foreach ($u in $users) { "
                f"$p = \"$root\\$($u.PSChildName)\\{sub_path}\"; "
                "try { "
                f"$v = (Get-ItemProperty -Path $p -Name '{value_name}' -ErrorAction Stop)."
                f"{value_name}; "
                "Write-Output \"$($u.PSChildName):$v\" } "
                "catch { Write-Output \"$($u.PSChildName):MISSING\" } "
                "} }"
            )
            line_pat = rf":\s*{re.escape(expected_val)}\s*$"
            return {
                "shell": "powershell",
                "command": cmd,
                "expect": {"kind": "all_lines_match", "value": line_pat},
                "pass_message": f"'{friendly}' is correctly set to {expected_val} for every interactive user.",
                "fail_message": f"'{friendly}' is NOT set to {expected_val} for one or more interactive users.",
                "_auto_generated": True,
                "_audit_excerpt": txt[:400],
                "_extracted": {
                    "category": "hkcu_user_policy",
                    "sub_path": sub_path,
                    "value_name": value_name,
                    "expected": expected_val,
                    "mode": mode,
                    "friendly_label": friendly,
                },
                "_note": "Auto-generated HKCU per-user policy check (iterates HKEY_USERS\\<sid>).",
            }

    # ── Section 8.x / 9.x / 18.x — known machine-policy registry catalog
    # ───────────────────────────────────────────────────────────────
    if rule_id.startswith(("8.", "9.", "18.", "16.")):
        tlow = title.lower()
        spec = None
        matched_key = None
        for key, val in CIS_18X_KNOWN_REGISTRY.items():
            if key in tlow:
                spec = val
                matched_key = key
                break
        if spec:
            ps_path, value_name = spec
            friendly = matched_key
            _mn = re.search(r"'([^']{4,160})'", title)
            if _mn:
                friendly = _mn.group(1).strip()

            # Special case: value_name == "*" ⇒ check that the registry key
            # exists with at least one sub-value (used for ASR rules and the
            # Hardened UNC Paths collection — the value-names are themselves
            # organisation-defined).
            if value_name == "*":
                cmd = (
                    f"if (Test-Path '{ps_path}') {{ "
                    f"$p = Get-ItemProperty -Path '{ps_path}' -ErrorAction SilentlyContinue; "
                    f"$p.PSObject.Properties | Where-Object {{ $_.Name -notmatch '^PS' }} | "
                    f"Select-Object -ExpandProperty Name "
                    f"}} else {{ Write-Output 'KEY_MISSING' }}"
                )
                return {
                    "shell": "powershell",
                    "command": cmd,
                    "expect": {"kind": "stdout_not_regex", "value": r"^(KEY_MISSING|\s*)$"},
                    "pass_message": f"'{friendly}' policy key exists and has configured values.",
                    "fail_message": f"'{friendly}' policy key is missing or empty (CIS requires it configured).",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_extracted": {
                        "category": "machine_policy_known",
                        "registry_path": ps_path,
                        "value_name": "<any subvalue>",
                        "friendly_label": friendly,
                    },
                    "_note": "Auto-generated existence-check (values are org-defined).",
                }

            expected_val, mode = _get_expected(title)
            if expected_val is None:
                expected_val, mode = _get_expected(txt)

            # REG_SZ "value of text" — value is org-defined; check non-empty.
            audit_lower = (txt or "").lower()
            if re.search(r"reg_sz value of\s*(text|<path>|<filename>)", audit_lower):
                return {
                    "shell": "powershell",
                    "command": (
                        f"Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                        f"-ErrorAction SilentlyContinue | Select-Object -ExpandProperty '{value_name}'"
                    ),
                    "expect": {"kind": "stdout_regex", "value": r"\S"},
                    "pass_message": f"'{friendly}' is configured (non-empty value).",
                    "fail_message": f"'{friendly}' is missing or empty (CIS requires it configured).",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_extracted": {
                        "category": "machine_policy_known",
                        "registry_path": ps_path,
                        "value_name": value_name,
                        "expected": "<non-empty text>",
                        "friendly_label": friendly,
                    },
                    "_note": "Auto-generated non-empty REG_SZ check (org-defined value).",
                }

            if expected_val is None:
                expected_val = "1"
                mode = "equals"
            kind = "stdout_not_regex" if mode == "not_equals" else "stdout_regex"
            value_pat = r"^\s*$" if mode == "blank" else rf"^\s*{re.escape(expected_val)}\s*$"
            pass_msg, fail_msg = _cis_messages_from_title(title, friendly)
            return {
                "shell": "powershell",
                "command": (
                    f"Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                    f"-ErrorAction SilentlyContinue | Select-Object -ExpandProperty '{value_name}'"
                ),
                "expect": {"kind": kind, "value": value_pat},
                "pass_message": pass_msg,
                "fail_message": fail_msg,
                "_auto_generated": True,
                "_audit_excerpt": txt[:400],
                "_extracted": {
                    "category": "machine_policy_known",
                    "registry_path": ps_path,
                    "value_name": value_name,
                    "expected": expected_val,
                    "mode": mode,
                    "friendly_label": friendly,
                },
                "_note": "Auto-generated from CIS_18X_KNOWN_REGISTRY catalog.",
            }

    return None


def _cis_messages_from_title(title: str | None, friendly: str) -> tuple[str, str]:
    """Build operator-friendly pass/fail messages from a CIS title.

    Why: the previous template (`verb = "Enabled" if expected == "1" else
    "Disabled" if expected == "0"`) gave WRONG verbs for inverse-named
    registry values like `DisableBehaviorMonitoring` — CIS expects value=0
    so the verb came out "Disabled" but the rule actually wants behavior
    monitoring ENABLED. The cleanest fix is to extract the prescribed state
    directly from the CIS title's second quoted phrase rather than trying
    to translate registry semantics back into English ourselves.

    Examples:
      Title: "Ensure 'Turn on behavior monitoring' is set to 'Enabled'"
        → pass = "'Turn on behavior monitoring' is set to 'Enabled' as CIS recommends."
        → fail = "'Turn on behavior monitoring' is NOT set to 'Enabled' (CIS recommendation)."

      Title: "Ensure 'Download Mode' is NOT set to 'Enabled: Internet'"
        → pass = "'Download Mode' is correctly NOT set to 'Enabled: Internet'."
        → fail = "'Download Mode' is set to 'Enabled: Internet' which CIS forbids."

      Title: "Configure 'Accounts: Rename administrator account'"
        → pass = "'Accounts: Rename administrator account' is configured as CIS recommends."
        → fail = "'Accounts: Rename administrator account' is NOT configured per CIS."
    """
    t = title or ""
    # "is NOT set to 'X'" — negated form
    m_neg = re.search(r"is\s+NOT\s+set\s+to\s*'([^']+)'", t, re.IGNORECASE)
    if m_neg:
        prescribed = m_neg.group(1).strip()
        return (
            f"'{friendly}' is correctly NOT set to '{prescribed}'.",
            f"'{friendly}' is set to '{prescribed}' — CIS recommends it must NOT be.",
        )
    # "is set to 'X'" — prescribed value
    m_pos = re.search(r"is\s+set\s+to\s*(?:include\s+)?'([^']+)'", t, re.IGNORECASE)
    if m_pos:
        prescribed = m_pos.group(1).strip()
        return (
            f"'{friendly}' is set to '{prescribed}' as CIS recommends.",
            f"'{friendly}' is NOT set to '{prescribed}' (CIS recommendation).",
        )
    # No prescribed phrase — generic
    return (
        f"'{friendly}' is configured as CIS recommends.",
        f"'{friendly}' does not match the CIS recommendation.",
    )


def _principals_from_title(title: str) -> tuple[list[str], str | None]:
    """Extract canonical principal names from a CIS Section 2.2 title.

    Returns (principal_list, raw_expected_phrase). Empty list ⇒ "No One".
    """
    if not title:
        return ([], None)
    # Capture phrase inside the *second* set of single quotes (the value).
    m = re.search(r"is set to\s*'([^']+)'", title, re.IGNORECASE)
    if not m:
        m = re.search(r"to include\s*'([^']+)'", title, re.IGNORECASE)
    if not m:
        return ([], None)
    raw = m.group(1)
    if raw.strip().lower() == "no one":
        return ([], raw)
    parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
    return (parts, raw)


# Capture the first AWS CLI invocation: aws <service> <operation>
_AWS_RE = re.compile(r"\baws\s+([a-z0-9-]+)\s+([a-z0-9-]+)", re.IGNORECASE)
# Common shell verbs followed by an argument
_GREP_RE = re.compile(r"\bgrep\s+(?:-[A-Za-z]+\s+)*['\"]([^'\"]+)['\"]\s+(\S+)")
_CAT_RE = re.compile(r"\bcat\s+(/\S+)")
_STAT_RE = re.compile(r"\bstat\s+(/\S+)")


def synthesise(audit_text: str, runner_type: str, *, rule_id: str | None = None, title: str | None = None) -> tuple[dict[str, Any], bool]:
    """Return (check_definition, auto_generated_flag).

    auto_generated_flag is True when the result is a placeholder/templated
    value rather than a hand-curated definition. Callers persist it onto
    the plugin row so reviewers can spot what needs human approval.

    rule_id is used to dispatch to category-specific handlers:
      * 1.1.x / 1.2.x → Account Policy (secedit /export + INI field check)
      * 17.x         → Audit Policy (auditpol /get)
      * 5.x          → System Services (Get-Service)
    """
    txt = _normalize_audit(audit_text or "")
    if runner_type == "aws_readonly":
        m = _AWS_RE.search(txt)
        if m:
            service = m.group(1).lower()
            op = m.group(2).lower().replace("-", "_")
            return (
                {
                    "service": service,
                    "operation": op,
                    "expect": {"kind": "any"},  # reviewer must tighten
                    "pass_message": f"{service}.{op} executed; manual verification required.",
                    "fail_message": f"{service}.{op} call failed.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                },
                True,
            )

    if runner_type == "linux_ssh":
        m = _GREP_RE.search(txt)
        if m:
            pattern, path = m.group(1), m.group(2)
            return (
                {
                    "command": f"grep -E {pattern!r} {path}",
                    "expect": {"kind": "stdout_contains", "value": pattern},
                    "pass_message": f"Pattern present in {path}.",
                    "fail_message": f"Pattern not found in {path}.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                },
                True,
            )
        m = _CAT_RE.search(txt) or _STAT_RE.search(txt)
        if m:
            path = m.group(1)
            return (
                {
                    "command": f"stat -c '%a %U %G' {path}",
                    "expect": {"kind": "any"},
                    "pass_message": f"Inspected {path}.",
                    "fail_message": f"Could not inspect {path}.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                },
                True,
            )

    if runner_type == "windows_winrm":
        # ──────────────────────────────────────────────────────────────
        # Rule-id-based handlers FIRST. CIS organises Windows benchmarks
        # by section number: 1.1.x = Password Policy, 1.2.x = Lockout,
        # 17.x = Audit Policy, 5.x = System Services. These all use
        # specific PowerShell/CMD commands rather than registry reads,
        # and the audit text typically says "Navigate to UI path …"
        # without the registry hint.
        # ──────────────────────────────────────────────────────────────
        if rule_id:
            # Account Policy (Password + Lockout) — use secedit INI export
            if rule_id.startswith("1.1.") or rule_id.startswith("1.2."):
                # Map common rule names to secedit INI field names so the
                # reviewer can skip the manual TODO step in the common case.
                # secedit /export emits an INI like:
                #   PasswordHistorySize = 24
                #   MaximumPasswordAge = 60
                #   MinimumPasswordLength = 14
                #   LockoutBadCount = 5
                # IMPORTANT: order longest/most-specific patterns first so
                # "relax minimum password length" matches RelaxMinimumPasswordLengthLimits
                # BEFORE the shorter "minimum password length" alias.
                title_to_field = [
                    ("relax minimum password length", "RelaxMinimumPasswordLengthLimits"),
                    ("store passwords using reversible", "ClearTextPassword"),
                    ("administrator account lockout", "AllowAdministratorLockout"),
                    ("reset account lockout counter", "ResetLockoutCount"),
                    ("account lockout duration", "LockoutDuration"),
                    ("account lockout threshold", "LockoutBadCount"),
                    ("maximum password age", "MaximumPasswordAge"),
                    ("minimum password age", "MinimumPasswordAge"),
                    ("minimum password length", "MinimumPasswordLength"),
                    # Title says "Password must meet complexity requirements" —
                    # the words "password" and "complexity" don't appear adjacent,
                    # so we match on "complexity requirement" or just "complexity"
                    # under the 1.1.x section.
                    ("must meet complexity", "PasswordComplexity"),
                    ("complexity requirement", "PasswordComplexity"),
                    ("password complexity", "PasswordComplexity"),
                    ("complexity", "PasswordComplexity"),
                    ("password history", "PasswordHistorySize"),
                ]
                field = "TODO_field_name"
                # Use title (if available) for matching — it's cleaner than the
                # full audit/remediation text which can mention other field names
                # in passing.
                lower = (title or txt).lower()
                for keyword, name in title_to_field:
                    if keyword in lower:
                        field = name
                        break
                # Inline expected-value extraction. Search BOTH title and the
                # combined audit/remediation text, in that order — CIS titles
                # like "is set to '14 or more character(s)'" carry the number
                # most cleanly.
                search_corpora = [s for s in (title, txt) if s]
                expected = "TODO_expected"
                for corpus in search_corpora:
                    _m = re.search(r"REG_DWORD value of (\d+)", corpus, re.IGNORECASE)
                    if not _m:
                        _m = re.search(r"value of\s+(\d+)\b", corpus, re.IGNORECASE)
                    if not _m:
                        _m = re.search(
                            r"is set to\s*['\"]?(\d{1,4})\b",
                            corpus, re.IGNORECASE,
                        )
                    if not _m:
                        _m = re.search(
                            r"\b(\d{1,4})\s*(?:or more|or fewer|or less)?\s*(?:character|day|minute|second|password|attempt)",
                            corpus, re.IGNORECASE,
                        )
                    if not _m:
                        # "is set to 'Enabled'" → 1 ; "is set to 'Disabled'" → 0
                        _mEn = re.search(r"is set to\s*['\"]?(Enabled|Disabled)\b", corpus, re.IGNORECASE)
                        if _mEn:
                            expected = "1" if _mEn.group(1).lower() == "enabled" else "0"
                            break
                    if _m:
                        expected = _m.group(1)
                        break
                # Friendly label from title (e.g. "Minimum password length", "Account lockout duration")
                friendly = None
                if title:
                    mnice = re.search(r"'([^']{6,80})'", title)
                    if mnice:
                        friendly = mnice.group(1).strip()
                label = friendly or field
                expected_human = expected if expected != "TODO_expected" else "the configured value"
                # COMPARATOR SEMANTICS from the title's range phrasing.
                # CIS numeric titles come in three shapes:
                #   "14 or more"               actual >= N
                #   "365 or fewer, but not 0"  1 <= actual <= N
                #   "5 or fewer"               actual <= N
                # Plain equality graded "42" FAIL against "365 or fewer"
                # (caught live against `net accounts`) a false positive on
                # every range rule where the machine isn't at the exact
                # boundary value.
                title_l = (title or "").lower()
                if re.search(r"\bor more\b", title_l):
                    expect_kind = "secedit_field_gte"
                    expected_human = f"{expected} or more"
                elif re.search(r"\b(?:or fewer|or less)\b.*\bnot 0\b", title_l):
                    expect_kind = "secedit_field_lte_nonzero"
                    expected_human = f"1..{expected}"
                elif re.search(r"\b(?:or fewer|or less)\b", title_l):
                    expect_kind = "secedit_field_lte"
                    expected_human = f"{expected} or fewer"
                else:
                    expect_kind = "secedit_field_equals"
                return (
                    {
                        "shell": "cmd",
                        "command": (
                            'secedit /export /cfg "%TEMP%\\grc_secpol.inf" /areas '
                            'SECURITYPOLICY /quiet && type "%TEMP%\\grc_secpol.inf"'
                        ),
                        "expect": {
                            "kind": expect_kind,
                            "field": field,
                            "expected": expected,
                        },
                        "pass_message": f"'{label}' is compliant ({expected_human}).",
                        "fail_message": f"'{label}' does not match CIS requirement (expected {expected_human}).",
                        "_auto_generated": True,
                        "_audit_excerpt": txt[:400],
                        "_extracted": {"category": "account_policy", "field": field, "expected": expected, "friendly_label": label},
                        "_note": "Auto-generated Account Policy check. Reviewer should confirm field + expected.",
                    },
                    True,
                )

            # Audit Policy — use auditpol /get
            if rule_id.startswith("17."):
                # Extract subcategory from title:
                #   "Ensure 'Audit Credential Validation' is set to 'Success and Failure'"
                # gives subcategory='Credential Validation', expected='Success and Failure'.
                # The subcategory is the part after "Audit " inside the first
                # quoted phrase; the expected is the second quoted phrase.
                subcategory = None
                expected = None
                if title:
                    # Variant 1: "is set to 'Success and Failure'"
                    m_sub = re.search(
                        r"'\s*Audit\s+(.+?)\s*'\s*is set to\s*'\s*(.+?)\s*'",
                        title,
                        re.IGNORECASE,
                    )
                    if not m_sub:
                        # Variant 2: "is set to include 'Success'"
                        m_sub = re.search(
                            r"'\s*Audit\s+(.+?)\s*'\s*is set to include\s*'\s*(.+?)\s*'",
                            title,
                            re.IGNORECASE,
                        )
                    if not m_sub:
                        # Variant 3: bare "Audit X" subcategory after a verb but
                        # without the leading single-quote
                        m_sub = re.search(
                            r"Audit\s+([A-Z][A-Za-z /]+?)(?:'|\s+is set to)",
                            title,
                        )
                    if m_sub:
                        subcategory = m_sub.group(1).strip()
                        # Expected may come from group 2 if present, else heuristic
                        if m_sub.lastindex and m_sub.lastindex >= 2:
                            expected = m_sub.group(2).strip()
                if not subcategory:
                    subcategory = "TODO_subcategory"
                if not expected:
                    # Heuristic from title wording
                    if title and "include 'failure'" in title.lower():
                        expected = "Failure"
                    elif title and "include 'success'" in title.lower():
                        expected = "Success"
                    else:
                        expected = "Success and Failure"
                # auditpol CSV row format:
                #   DESKTOP,System,Credential Validation,{guid},Success and Failure,
                # We anchor on the subcategory then match either Success, Failure,
                # or Success and Failure in the inclusion column.
                pattern = rf",{re.escape(subcategory)},[^,]*,{re.escape(expected)},"
                return (
                    {
                        "shell": "powershell",
                        "command": "auditpol /get /category:* /r",
                        "expect": {
                            "kind": "stdout_regex",
                            "value": pattern,
                        },
                        "pass_message": f"Audit logging for '{subcategory}' is set to '{expected}' (correct).",
                        "fail_message": f"Audit logging for '{subcategory}' is NOT set to '{expected}' (CIS requires it).",
                        "_auto_generated": True,
                        "_audit_excerpt": txt[:400],
                        "_extracted": {
                            "category": "audit_policy",
                            "subcategory": subcategory,
                            "expected": expected,
                        },
                        "_note": "Auto-generated Audit Policy check. Reviewer should confirm subcategory + expected.",
                    },
                    True,
                )

            # System Services — use Get-Service (rule_id 5.x)
            if rule_id.startswith("5."):
                # Service short-name pattern in CIS title:
                #   "Ensure 'Bluetooth Audio Gateway Service (BTAGService)' is set to 'Disabled'"
                # We want BTAGService (the last paren-token before the closing
                # quote). Match (Word) directly before `'\s*is set to`.
                svc = None
                if title:
                    m_svc = re.search(
                        r"\(([A-Za-z][A-Za-z0-9_\-\.]+)\)\s*'\s*is set to",
                        title,
                    )
                    if m_svc:
                        svc = m_svc.group(1)
                if not svc:
                    # Fall back to any (token) in the title — last one wins.
                    candidates = re.findall(r"\(([A-Za-z][A-Za-z0-9_\-\.]+)\)", title or txt)
                    svc = candidates[-1] if candidates else None
                if svc:
                    expected_state = "Disabled" if "disabled" in (title or txt).lower() else "Manual"
                    # Extract a friendly service name from the title if possible.
                    nice_name = svc
                    if title:
                        mname = re.search(r"'([^'(]+?)\s*\(", title)
                        if mname:
                            nice_name = mname.group(1).strip()
                    return (
                        {
                            "shell": "powershell",
                            "command": f"Get-Service -Name '{svc}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty StartType",
                            "expect": {
                                "kind": "stdout_regex",
                                "value": rf"^\s*{expected_state}\s*$",
                            },
                            "pass_message": f"{nice_name} service is correctly set to {expected_state}.",
                            "fail_message": f"{nice_name} service is NOT {expected_state} (CIS requires {expected_state}).",
                            "_auto_generated": True,
                            "_audit_excerpt": txt[:400],
                            "_extracted": {"category": "service", "service": svc, "service_display_name": nice_name, "expected_start_type": expected_state},
                            "_note": "Auto-generated System Services check.",
                        },
                        True,
                    )

        # ═════════════════════════════════════════════════════════════════
        # EARLY CATALOG DISPATCH — sections 2.2, 2.3, 18.x, 19.x.
        #
        # These four sections must be tried BEFORE the generic registry
        # regex below, because the audit text for many of them mentions
        # a registry path that the generic handler would match but fail
        # to fill expected_value for. The catalog tables here let us
        # produce a concrete, validated check_definition.
        # ═════════════════════════════════════════════════════════════════
        early_cd = _try_catalog_dispatch(rule_id, title, txt)
        if early_cd is not None:
            return (early_cd, True)

        # Enterprise-grade PowerShell synthesis. We recognise CIS audit
        # patterns and emit Get-* cmdlets with extracted value name +
        # expected value where possible. Even when expect.field /
        # expected are filled, auto_generated stays True so a reviewer
        # confirms before the rule executes.
        secedit_re = re.compile(r"\bsecedit\b", re.IGNORECASE)
        auditpol_re = re.compile(r"\bauditpol\b", re.IGNORECASE)
        # Registry path with value name after colon:
        #   HKLM\SOFTWARE\Policies\Microsoft\WindowsFirewall\DomainProfile:EnableFirewall
        # The captured value name (group 3) is what `Get-ItemProperty -Name`
        # will dereference. We allow embedded spaces in the path (e.g.
        # "Windows Defender") and tolerate line-wrapped audit text.
        registry_value_re = re.compile(
            r"\b(HKLM|HKCU|HKU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS)"
            r"[\\:]\\?"
            r"([A-Za-z0-9_\\\-\. ]+?)"
            r"\s*:\s*"
            r"([A-Za-z][A-Za-z0-9_]+)",
            re.IGNORECASE,
        )
        registry_path_only_re = re.compile(
            r"\b(HKLM|HKCU|HKU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS)[\\:]\\?([\w\\\-\. ]+)",
            re.IGNORECASE,
        )
        # Expected-value patterns inside audit text
        expected_dword_re = re.compile(
            r"REG_DWORD value of (\d+)(?:\s+or\s+(\d+))?", re.IGNORECASE
        )
        expected_value_of_re = re.compile(r"value of\s+(\d+)\b", re.IGNORECASE)
        # Firewall: e.g. "Windows Firewall: Domain: Firewall state' is set to 'On'"
        firewall_state_re = re.compile(
            r"Windows Firewall:?\s*(Domain|Private|Public)\s*:?\s*Firewall state",
            re.IGNORECASE,
        )
        # Service state: "Ensure 'Bluetooth Support Service (bthserv)' is set to 'Disabled'"
        service_state_re = re.compile(
            r"'?([A-Za-z][A-Za-z0-9_\-\. ]+?)\s*\(([a-zA-Z0-9_\-\.]+)\)'?\s*is set to\s*'?(Disabled|Manual|Automatic|Automatic \(Delayed Start\))",
            re.IGNORECASE,
        )
        mppref_re = re.compile(r"\bGet-MpPreference\b", re.IGNORECASE)
        netacct_re = re.compile(r"\bnet\s+accounts\b", re.IGNORECASE)

        def _extract_expected(text: str) -> str | None:
            m = expected_dword_re.search(text)
            if m:
                # If "1 or 2", prefer the first value (reviewer can broaden later)
                return m.group(1)
            m = expected_value_of_re.search(text)
            if m:
                return m.group(1)
            # "set to 'Enabled'" / "set to 'Disabled'"
            m = re.search(r"set to\s*['\"]?(Enabled|Disabled|On|Off|None)['\"]?", text, re.IGNORECASE)
            if m:
                v = m.group(1).lower()
                # Group Policy "Enabled" usually maps to registry DWORD 1
                if v in ("enabled", "on"):
                    return "1"
                if v in ("disabled", "off"):
                    return "0"
            return None

        if secedit_re.search(txt):
            # secedit /export inherently writes a temp file; we read it back
            # with Get-Content. The safety filter rejects Remove-Item / Out-Null,
            # so we deliberately leave the temp file in place and let Windows
            # clean it up. Path uses ${env:TEMP} which is a read of an env var,
            # not a redirection target.
            return (
                {
                    "shell": "cmd",
                    "command": (
                        'secedit /export /cfg "%TEMP%\\grc_secpol.inf" /areas '
                        'SECURITYPOLICY /quiet && type "%TEMP%\\grc_secpol.inf"'
                    ),
                    "expect": {"kind": "secedit_field_equals", "field": "TODO", "expected": "TODO"},
                    "pass_message": "Local security policy field matches expected value.",
                    "fail_message": "Local security policy field does not match.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_note": (
                        "Reviewer must set expect.field (e.g. "
                        "MinimumPasswordLength) and expect.expected from the "
                        "CIS audit text before approving this plugin."
                    ),
                },
                True,
            )
        if auditpol_re.search(txt):
            return (
                {
                    "shell": "powershell",
                    "command": "auditpol /get /category:* /r",
                    "expect": {
                        "kind": "stdout_regex",
                        "value": r"TODO,(Success|Failure|Success and Failure)",
                    },
                    "pass_message": "Audit category configured as expected.",
                    "fail_message": "Audit category not configured as expected.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_note": (
                        "Reviewer must replace TODO in expect.value with the "
                        "audit subcategory name (e.g. 'Logon')."
                    ),
                },
                True,
            )
        if mppref_re.search(txt):
            return (
                {
                    "shell": "powershell",
                    "command": "Get-MpPreference | Format-List",
                    "expect": {
                        "kind": "line_kv_equals",
                        "field": "DisableRealtimeMonitoring",
                        "expected": "False",
                    },
                    "pass_message": "Defender preference matches expected value.",
                    "fail_message": "Defender preference does not match.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_note": (
                        "Reviewer must adjust expect.field to the actual "
                        "MpPreference setting checked by this CIS rule."
                    ),
                },
                True,
            )
        # Firewall state — recognise before generic registry so we get the
        # cleaner Get-NetFirewallProfile command.
        fwm = firewall_state_re.search(txt)
        if fwm:
            profile = fwm.group(1).capitalize()
            expected = _extract_expected(txt) or "1"
            wants_on = expected in ("1", "True", "true")
            want_word = "ON" if wants_on else "OFF"
            return (
                {
                    "shell": "powershell",
                    "command": f"Get-NetFirewallProfile -Profile {profile} | Select-Object -ExpandProperty Enabled",
                    "expect": {
                        "kind": "stdout_contains",
                        "value": "True" if wants_on else "False",
                    },
                    "pass_message": f"Windows Firewall ({profile} profile) is correctly {want_word}.",
                    "fail_message": f"Windows Firewall ({profile} profile) is NOT {want_word} (CIS requires {want_word}).",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_extracted": {"profile": profile, "expected_enabled": wants_on},
                    "_note": "Auto-generated from CIS audit — reviewer should confirm before approval.",
                },
                True,
            )

        # Service state — "Ensure 'Foo Service (foosvc)' is set to 'Disabled'"
        sm = service_state_re.search(txt)
        if sm and "service" in txt.lower():
            svc_name = sm.group(2)
            state = sm.group(3).split()[0].lower()  # "Automatic (Delayed Start)" → "automatic"
            return (
                {
                    "shell": "powershell",
                    "command": f"Get-Service -Name '{svc_name}' | Select-Object -ExpandProperty StartType",
                    "expect": {
                        "kind": "stdout_contains",
                        "value": state.capitalize(),
                    },
                    "pass_message": f"Service {svc_name} start type matches expected.",
                    "fail_message": f"Service {svc_name} start type does not match expected.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_extracted": {"service": svc_name, "expected_start_type": state},
                    "_note": "Auto-generated from CIS audit — reviewer should confirm before approval.",
                },
                True,
            )

        # Registry with explicit value name extracted
        m = registry_value_re.search(txt)
        if m:
            hive_raw, path, value_name = m.group(1).upper(), m.group(2).strip(), m.group(3)
            hive = hive_raw.replace("HKEY_LOCAL_MACHINE", "HKLM").replace(
                "HKEY_CURRENT_USER", "HKCU"
            ).replace("HKEY_USERS", "HKU")
            ps_path = f"{hive}:\\{path}"
            expected = _extract_expected(txt)
            ready = expected is not None
            # Friendly setting name from title: extracts "Allow access to BitLocker..."
            # from "Ensure 'Allow access to BitLocker-protected fixed data drives ...' is set to 'Disabled'"
            friendly = None
            if title:
                mnice = re.search(r"'([^']{8,150})'", title)
                if mnice:
                    friendly = mnice.group(1).strip()
            label = friendly or value_name
            _pass_msg, _fail_msg = _cis_messages_from_title(title, label)
            return (
                {
                    "shell": "powershell",
                    "command": (
                        f"Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                        f"-ErrorAction SilentlyContinue | Select-Object -ExpandProperty '{value_name}'"
                    ),
                    "expect": {
                        "kind": "stdout_regex" if ready else "stdout_contains",
                        "value": (rf"^\s*{re.escape(expected)}\s*$") if ready else "TODO_expected_value",
                    },
                    "pass_message": (
                        _pass_msg if ready
                        else f"'{label}' setting present (reviewer must validate value)."
                    ),
                    "fail_message": (
                        _fail_msg if ready
                        else f"'{label}' setting missing or mismatched."
                    ),
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_extracted": {
                        "registry_path": ps_path,
                        "value_name": value_name,
                        "expected": expected,
                        "friendly_label": label,
                    },
                    "_note": (
                        "Reviewer should confirm extracted value_name + expected before approval."
                        if ready
                        else "Reviewer must fill expect.value from the CIS audit text."
                    ),
                },
                True,
            )

        # Fallback: registry path without value name (rare — audit was vague)
        m = registry_path_only_re.search(txt)
        if m:
            hive, path = m.group(1).upper(), m.group(2).strip()
            ps_path = f"{hive.replace('HKEY_LOCAL_MACHINE','HKLM').replace('HKEY_CURRENT_USER','HKCU')}:\\{path}"
            return (
                {
                    "shell": "powershell",
                    "command": f"Get-ItemProperty -Path '{ps_path}' | Format-List",
                    "expect": {
                        "kind": "line_kv_equals",
                        "field": "TODO_value_name",
                        "expected": "TODO",
                    },
                    "pass_message": f"Registry value at {ps_path} matches expected.",
                    "fail_message": f"Registry value at {ps_path} does not match expected.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_note": (
                        "Audit text named a registry path but no value name. "
                        "Reviewer must fill expect.field and expect.expected."
                    ),
                },
                True,
            )
        if netacct_re.search(txt):
            return (
                {
                    "shell": "cmd",
                    "command": "net accounts",
                    "expect": {
                        "kind": "line_kv_equals",
                        "field": "Minimum password length",
                        "expected": "14",
                    },
                    "pass_message": "Account policy setting matches expected.",
                    "fail_message": "Account policy setting does not match.",
                    "_auto_generated": True,
                    "_audit_excerpt": txt[:400],
                    "_note": (
                        "Reviewer must adjust expect.field/expected to the "
                        "specific net accounts row checked by this CIS rule."
                    ),
                },
                True,
            )
        # ──────────────────────────────────────────────────────────────
        # Section 2.2 — User Rights Assignment.
        # CIS PDF audit text says "Navigate to UI Path…" so the regex
        # handlers above won't fire. Use the embedded CIS_USER_RIGHTS_BY_TITLE
        # mapping to look up the privilege constant, parse the principal
        # list from the title, and emit a secedit USER_RIGHTS export +
        # user_rights_check expect.
        # ──────────────────────────────────────────────────────────────
        if rule_id and rule_id.startswith("2.2.") and title:
            tlow = title.lower()
            privilege = None
            for keyword, priv in CIS_USER_RIGHTS_BY_TITLE.items():
                if keyword in tlow:
                    privilege = priv
                    break
            if privilege:
                principals, raw_phrase = _principals_from_title(title)
                expected_sids: list[str] = []
                unknown: list[str] = []
                for p in principals:
                    sids = PRINCIPAL_TO_SID.get(p)
                    if sids is None:
                        # Try a couple of common aliases / suffixes
                        if p.endswith(" group"):
                            sids = PRINCIPAL_TO_SID.get(p[:-6])
                        if sids is None and p.startswith("nt service\\"):
                            sids = PRINCIPAL_TO_SID.get(p.split("\\", 1)[1])
                    if sids is None:
                        unknown.append(p)
                    else:
                        expected_sids.extend(sids)
                # Friendly label from the title's first quoted phrase
                friendly = privilege
                _mn = re.search(r"'([^']{4,120})'", title)
                if _mn:
                    friendly = _mn.group(1).strip()
                expected_phrase = raw_phrase or ("No One" if not principals else "")
                return (
                    {
                        "shell": "cmd",
                        "command": (
                            'secedit /export /cfg "%TEMP%\\grc_ur.inf" /areas '
                            'USER_RIGHTS /quiet && type "%TEMP%\\grc_ur.inf"'
                        ),
                        "expect": {
                            "kind": "user_rights_check",
                            "privilege": privilege,
                            "expected_sids": expected_sids,
                        },
                        "pass_message": (
                            f"'{friendly}' is correctly granted to {expected_phrase or 'no principals'}."
                        ),
                        "fail_message": (
                            f"'{friendly}' is NOT set to {expected_phrase or 'No One'} (CIS requirement)."
                        ),
                        "_auto_generated": True,
                        "_audit_excerpt": txt[:400],
                        "_extracted": {
                            "category": "user_rights_assignment",
                            "privilege": privilege,
                            "expected_principals": principals,
                            "expected_sids": expected_sids,
                            "unknown_principals": unknown,
                            "friendly_label": friendly,
                        },
                        "_note": (
                            "Auto-generated User Rights Assignment check. "
                            "Reviewer should confirm privilege + SID list."
                            + (f" UNKNOWN principals: {unknown}" if unknown else "")
                        ),
                    },
                    True,
                )

        # ──────────────────────────────────────────────────────────────
        # Section 2.3 — Security Options.
        # Title-based lookup against CIS_SECURITY_OPTIONS. Some land in
        # secedit's [System Access] block, others in specific registry
        # values under HKLM. We pick the right mechanism per entry.
        # ──────────────────────────────────────────────────────────────
        if rule_id and rule_id.startswith("2.3.") and title:
            tlow = title.lower()
            spec = None
            matched_key = None
            for key, candidate in CIS_SECURITY_OPTIONS:
                if key in tlow:
                    spec = candidate
                    matched_key = key
                    break
            if spec:
                friendly = matched_key
                _mn = re.search(r"'([^']{4,160})'", title)
                if _mn:
                    friendly = _mn.group(1).strip()
                expected = _extract_expected(title or "") or _extract_expected(txt) or "TODO_expected"
                if spec["mechanism"] == "secedit_systemaccess":
                    return (
                        {
                            "shell": "cmd",
                            "command": (
                                'secedit /export /cfg "%TEMP%\\grc_secpol.inf" /areas '
                                'SECURITYPOLICY /quiet && type "%TEMP%\\grc_secpol.inf"'
                            ),
                            "expect": {
                                "kind": "secedit_field_equals",
                                "field": spec["field"],
                                "expected": expected,
                            },
                            "pass_message": f"'{friendly}' is correctly set to {expected}.",
                            "fail_message": f"'{friendly}' does not match CIS (expected {expected}).",
                            "_auto_generated": True,
                            "_audit_excerpt": txt[:400],
                            "_extracted": {
                                "category": "security_options",
                                "mechanism": "secedit_systemaccess",
                                "field": spec["field"],
                                "expected": expected,
                                "friendly_label": friendly,
                            },
                            "_note": "Auto-generated Security Options check (secedit System Access).",
                        },
                        True,
                    )
                else:  # registry
                    ps_path = spec["path"]
                    value_name = spec["value_name"]
                    _pm, _fm = _cis_messages_from_title(title, friendly)
                    return (
                        {
                            "shell": "powershell",
                            "command": (
                                f"Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                                f"-ErrorAction SilentlyContinue | Select-Object -ExpandProperty '{value_name}'"
                            ),
                            "expect": {
                                "kind": "stdout_regex",
                                "value": rf"^\s*{re.escape(expected)}\s*$",
                            },
                            "pass_message": _pm,
                            "fail_message": _fm,
                            "_auto_generated": True,
                            "_audit_excerpt": txt[:400],
                            "_extracted": {
                                "category": "security_options",
                                "mechanism": "registry",
                                "registry_path": ps_path,
                                "value_name": value_name,
                                "expected": expected,
                                "friendly_label": friendly,
                            },
                            "_note": "Auto-generated Security Options check (registry).",
                        },
                        True,
                    )

        # ──────────────────────────────────────────────────────────────
        # Section 19.x — HKCU per-user policy.
        # Audit text DOES contain the registry path, but it's typically
        # HKU\[USER SID]\… with PDF line wrap fragmenting the value name.
        # _normalize_audit (called at the top) already rejoined wrapped
        # words. Here we detect any HKU\[USER SID] reference and emit a
        # PowerShell loop that checks every interactive user hive under
        # HKEY_USERS, reporting "<sid>:<value>" per line. all_lines_match
        # then asserts every line shows the expected value.
        # ──────────────────────────────────────────────────────────────
        if rule_id and rule_id.startswith("19."):
            # Re-scan normalized text for an HKU path now that line wrap
            # is gone. Pattern allows the [USER SID] placeholder mid-path.
            hku_re = re.compile(
                r"HKU\\\[USER\s*SID\]\\([\w\\\.\- ]+?)\s*:\s*([A-Za-z][A-Za-z0-9_]+)",
                re.IGNORECASE,
            )
            m = hku_re.search(txt)
            if m:
                sub_path = m.group(1).strip().rstrip("\\")
                value_name = m.group(2).strip()
                expected = _extract_expected(txt) or _extract_expected(title or "") or "1"
                friendly = value_name
                _mn = re.search(r"'([^']{4,150})'", title or "")
                if _mn:
                    friendly = _mn.group(1).strip()
                # Build a PowerShell snippet (no Set-/New-/Out-File, no
                # redirection ⇒ passes the safety filter).
                cmd = (
                    "$root = 'Registry::HKEY_USERS'; "
                    "$users = Get-ChildItem $root -ErrorAction SilentlyContinue | "
                    "Where-Object { $_.PSChildName -match '^S-1-5-21-[0-9-]+$' }; "
                    "if (-not $users) { Write-Output 'NO_INTERACTIVE_USERS' } "
                    "else { "
                    "foreach ($u in $users) { "
                    f"$p = \"$root\\$($u.PSChildName)\\{sub_path}\"; "
                    "try { "
                    f"$v = (Get-ItemProperty -Path $p -Name '{value_name}' -ErrorAction Stop)."
                    f"{value_name}; "
                    "Write-Output \"$($u.PSChildName):$v\" } "
                    "catch { Write-Output \"$($u.PSChildName):MISSING\" } "
                    "} }"
                )
                return (
                    {
                        "shell": "powershell",
                        "command": cmd,
                        "expect": {
                            "kind": "all_lines_match",
                            "value": rf":\s*{re.escape(expected)}\s*$",
                        },
                        "pass_message": f"'{friendly}' is correctly set to {expected} for every interactive user.",
                        "fail_message": f"'{friendly}' is NOT set to {expected} for one or more interactive users.",
                        "_auto_generated": True,
                        "_audit_excerpt": txt[:400],
                        "_extracted": {
                            "category": "hkcu_user_policy",
                            "sub_path": sub_path,
                            "value_name": value_name,
                            "expected": expected,
                            "friendly_label": friendly,
                        },
                        "_note": "Auto-generated HKCU per-user policy check (iterates HKEY_USERS\\<sid>).",
                    },
                    True,
                )

        # ──────────────────────────────────────────────────────────────
        # Section 18.x — well-known machine policies whose PDF audit text
        # is empty (the extractor failed on those pages). Fall back to a
        # curated registry catalog keyed by the lower-cased title phrase.
        # ──────────────────────────────────────────────────────────────
        if rule_id and rule_id.startswith("18.") and title:
            tlow = title.lower()
            spec = None
            matched_key = None
            for key, val in CIS_18X_KNOWN_REGISTRY.items():
                if key in tlow:
                    spec = val
                    matched_key = key
                    break
            if spec:
                ps_path, value_name = spec
                expected = _extract_expected(title) or _extract_expected(txt) or "1"
                friendly = matched_key
                _mn = re.search(r"'([^']{4,160})'", title)
                if _mn:
                    friendly = _mn.group(1).strip()
                _pm, _fm = _cis_messages_from_title(title, friendly)
                return (
                    {
                        "shell": "powershell",
                        "command": (
                            f"Get-ItemProperty -Path '{ps_path}' -Name '{value_name}' "
                            f"-ErrorAction SilentlyContinue | Select-Object -ExpandProperty '{value_name}'"
                        ),
                        "expect": {
                            "kind": "stdout_regex",
                            "value": rf"^\s*{re.escape(expected)}\s*$",
                        },
                        "pass_message": _pm,
                        "fail_message": _fm,
                        "_auto_generated": True,
                        "_audit_excerpt": txt[:400],
                        "_extracted": {
                            "category": "machine_policy_known",
                            "registry_path": ps_path,
                            "value_name": value_name,
                            "expected": expected,
                            "friendly_label": friendly,
                        },
                        "_note": "Auto-generated from CIS_18X_KNOWN_REGISTRY catalog (PDF audit text was empty).",
                    },
                    True,
                )

        # Unrecognised — placeholder that the runner's safety filter
        # rejects (the literal `Set-` cmdlet matches the verb deny list)
        # so an accidentally-approved plugin still produces an `error`
        # status, never a false-positive `passed`.
        return (
            {
                "shell": "powershell",
                "command": "Set-StrictMode -Version Latest # REPLACE-ME",
                "expect": {"kind": "exit_zero"},
                "_auto_generated": True,
                "_audit_excerpt": txt[:400],
                "_note": (
                    "Parser could not synthesise PowerShell automatically. "
                    "Reviewer MUST hand-author a Get-* cmdlet plus expect "
                    "before approving — this placeholder is intentionally "
                    "blocked by the read-only safety filter."
                ),
            },
            True,
        )

    # Fallback — opaque placeholder.
    return (
        {
            "expect": {"kind": "any"},
            "_auto_generated": True,
            "_audit_excerpt": txt[:400],
            "_note": "Parser could not synthesise an executable check; reviewer must hand-author.",
        },
        True,
    )
