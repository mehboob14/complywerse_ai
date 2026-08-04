"""
Comprehensive framework seed data for PCI DSS, ISO 27001, ISO 20000, and SWIFT CSF.
"""

PCI_DSS_V4_DATA = {
    "name": "PCI DSS v4.0",
    "short_code": "PCI_DSS",
    "regulator": "PCI Security Standards Council",
    "jurisdiction": "Global",
    "version": "4.0",
    "description": "Payment Card Industry Data Security Standard",
    "is_mandatory": True,
    "enforcement_type": "Contractual",
    "domains": [
        {
            "code": "REQ-1",
            "name": "Requirement 1: Install and Maintain Network Security Controls",
            "description": "Network security controls (NSCs) such as firewalls and other technologies that control network traffic protect the CDE.",
            "order": 1,
            "objectives": [
                {
                    "code": "1.1",
                    "name": "Processes and mechanisms for network security controls are defined and understood",
                    "controls": [
                        {"code": "1.1.1", "name": "Security policies and procedures defined", "statement": "All security policies and operational procedures identified in Requirement 1 are documented, kept up to date, in use, and known to all affected parties.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Network Security Policy", "description": "Current approved network security policy document"}]},
                        {"code": "1.1.2", "name": "Roles and responsibilities assigned", "statement": "Roles and responsibilities for performing activities in Requirement 1 are documented, assigned, and understood.", "is_mandatory": True, "evidence": [{"type": "document", "name": "RACI Matrix", "description": "Roles and responsibilities matrix for network security"}]},
                    ]
                },
                {
                    "code": "1.2",
                    "name": "Network security controls (NSCs) are configured and maintained",
                    "controls": [
                        {"code": "1.2.1", "name": "Configuration standards defined", "statement": "Configuration standards for NSC rulesets are defined, implemented, and maintained.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Firewall Configuration Standards", "description": "Documented firewall configuration standards"}, {"type": "screenshot", "name": "Firewall Rule Export", "description": "Current firewall rules export"}]},
                        {"code": "1.2.2", "name": "Changes to network connections reviewed", "statement": "All changes to network connections and NSC configurations are approved and managed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Change Tickets", "description": "Sample change management tickets for network changes"}]},
                        {"code": "1.2.3", "name": "Network diagram maintained", "statement": "An accurate network diagram is maintained that shows all connections between the CDE and other networks.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Network Diagram", "description": "Current network architecture diagram showing CDE boundaries"}]},
                        {"code": "1.2.4", "name": "Data-flow diagram maintained", "statement": "An accurate data-flow diagram is maintained that shows all account data flows.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Data Flow Diagram", "description": "Current cardholder data flow diagram"}]},
                        {"code": "1.2.5", "name": "Services and ports documented", "statement": "All services, protocols, and ports allowed are identified, approved, and have a defined business need.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Port Justification Matrix", "description": "Documentation of all allowed ports with business justification"}]},
                        {"code": "1.2.6", "name": "Security features documented", "statement": "Security features are defined and implemented for all services, protocols, and ports in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Service Security Documentation", "description": "Security configuration for each allowed service"}]},
                        {"code": "1.2.7", "name": "NSC configurations reviewed", "statement": "Configurations of NSCs are reviewed at least once every six months.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Firewall Review Report", "description": "Most recent semi-annual firewall rule review"}]},
                        {"code": "1.2.8", "name": "Configuration files secured", "statement": "Configuration files for NSCs are secured from unauthorized access and synchronized.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Config File Permissions", "description": "Screenshot showing firewall config file access controls"}]},
                    ]
                },
                {
                    "code": "1.3",
                    "name": "Network access to and from the CDE is restricted",
                    "controls": [
                        {"code": "1.3.1", "name": "Inbound traffic restricted", "statement": "Inbound traffic to the CDE is restricted to only necessary traffic.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Inbound Rules", "description": "Firewall inbound rules for CDE"}]},
                        {"code": "1.3.2", "name": "Outbound traffic restricted", "statement": "Outbound traffic from the CDE is restricted to only necessary traffic.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Outbound Rules", "description": "Firewall outbound rules from CDE"}]},
                        {"code": "1.3.3", "name": "NSCs between wireless and CDE", "statement": "NSCs are installed between all wireless networks and the CDE.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Wireless Segmentation", "description": "Documentation of wireless network segmentation from CDE"}]},
                    ]
                },
                {
                    "code": "1.4",
                    "name": "Network connections between trusted and untrusted networks are controlled",
                    "controls": [
                        {"code": "1.4.1", "name": "NSCs between trusted and untrusted", "statement": "NSCs are implemented between trusted and untrusted networks.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Network Segmentation Design", "description": "Network segmentation architecture documentation"}]},
                        {"code": "1.4.2", "name": "Inbound traffic filtered", "statement": "Inbound traffic from untrusted networks is restricted to system components providing authorized services.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "DMZ Firewall Rules", "description": "Firewall rules for DMZ/perimeter"}]},
                        {"code": "1.4.3", "name": "Anti-spoofing measures", "statement": "Anti-spoofing measures are implemented to detect and block forged source IP addresses.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Anti-spoofing Config", "description": "Anti-spoofing configuration on perimeter devices"}]},
                        {"code": "1.4.4", "name": "System components isolated", "statement": "System components that store cardholder data are not directly accessible from untrusted networks.", "is_mandatory": True, "evidence": [{"type": "document", "name": "CDE Isolation Verification", "description": "Verification that CDE is not directly accessible from internet"}]},
                        {"code": "1.4.5", "name": "Internal IP addresses protected", "statement": "Disclosure of internal IP addresses and routing information is limited.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "NAT Configuration", "description": "NAT/PAT configuration hiding internal IPs"}]},
                    ]
                },
                {
                    "code": "1.5",
                    "name": "Risks to the CDE from computing devices that connect are mitigated",
                    "controls": [
                        {"code": "1.5.1", "name": "Personal firewall on portable devices", "statement": "Personal firewall/equivalent functionality is installed on all portable computing devices connecting to the CDE.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Endpoint Firewall Policy", "description": "Endpoint protection firewall configuration"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-2",
            "name": "Requirement 2: Apply Secure Configurations to All System Components",
            "description": "Malicious individuals use default passwords and other vendor default settings to compromise systems.",
            "order": 2,
            "objectives": [
                {
                    "code": "2.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "2.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 2 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "System Hardening Policy", "description": "System hardening and configuration policy"}]},
                        {"code": "2.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 2 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Configuration Management Roles", "description": "Roles for configuration management"}]},
                    ]
                },
                {
                    "code": "2.2",
                    "name": "System components are configured and managed securely",
                    "controls": [
                        {"code": "2.2.1", "name": "Configuration standards developed", "statement": "Configuration standards are developed, implemented, and maintained for all system component types.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Hardening Standards", "description": "Server/device hardening standards (CIS benchmarks or equivalent)"}]},
                        {"code": "2.2.2", "name": "Vendor default accounts managed", "statement": "Vendor default accounts are managed appropriately.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Default Account Inventory", "description": "Inventory of vendor default accounts and their status"}]},
                        {"code": "2.2.3", "name": "Primary functions separated", "statement": "Primary functions requiring different security levels are managed separately.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Function Separation Matrix", "description": "Documentation of function separation by server/VM"}]},
                        {"code": "2.2.4", "name": "Only necessary services enabled", "statement": "Only necessary services, protocols, daemons, and functions are enabled.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Running Services List", "description": "List of running services on sample CDE systems"}]},
                        {"code": "2.2.5", "name": "Insecure services secured", "statement": "If insecure services are present, additional security features are implemented.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Insecure Service Mitigation", "description": "Security controls for any insecure services"}]},
                        {"code": "2.2.6", "name": "System security parameters configured", "statement": "System security parameters are configured to prevent misuse.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Security Parameters", "description": "Security parameter configuration screenshots"}]},
                        {"code": "2.2.7", "name": "Non-console admin access encrypted", "statement": "All non-console administrative access is encrypted using strong cryptography.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Admin Access Encryption", "description": "Evidence of encrypted admin access (SSH, HTTPS)"}]},
                    ]
                },
                {
                    "code": "2.3",
                    "name": "Wireless environments are configured and managed securely",
                    "controls": [
                        {"code": "2.3.1", "name": "Wireless vendor defaults changed", "statement": "For wireless environments connected to the CDE, all wireless vendor defaults are changed.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Wireless Config", "description": "Wireless access point configuration showing non-default settings"}]},
                        {"code": "2.3.2", "name": "Wireless encryption keys changed", "statement": "For wireless environments, wireless encryption keys are changed when personnel with knowledge leave.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Key Rotation Procedure", "description": "Wireless key rotation procedure and evidence of execution"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-3",
            "name": "Requirement 3: Protect Stored Account Data",
            "description": "Protection methods such as encryption, truncation, masking, and hashing are critical to protect stored account data.",
            "order": 3,
            "objectives": [
                {
                    "code": "3.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "3.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 3 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Data Protection Policy", "description": "Data protection and encryption policy"}]},
                        {"code": "3.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 3 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Data Protection Roles", "description": "Roles for data protection activities"}]},
                    ]
                },
                {
                    "code": "3.2",
                    "name": "Storage of account data is kept to a minimum",
                    "controls": [
                        {"code": "3.2.1", "name": "Data retention policy implemented", "statement": "Account data storage amount and retention time is limited to what is required.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Data Retention Policy", "description": "Data retention policy with defined periods"}, {"type": "document", "name": "Data Inventory", "description": "Inventory of stored cardholder data"}]},
                        {"code": "3.2.2", "name": "SAD not stored after authorization", "statement": "Sensitive authentication data (SAD) is not stored after authorization.", "is_mandatory": True, "evidence": [{"type": "document", "name": "SAD Non-Storage Verification", "description": "Technical verification that SAD is not stored"}]},
                    ]
                },
                {
                    "code": "3.3",
                    "name": "SAD is not stored after authorization",
                    "controls": [
                        {"code": "3.3.1", "name": "Full track data not retained", "statement": "Full track data from the magnetic stripe is not retained after authorization.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Track Data Verification", "description": "Verification that track data is not stored"}]},
                        {"code": "3.3.2", "name": "CVV not retained", "statement": "The card verification code is not retained after authorization.", "is_mandatory": True, "evidence": [{"type": "document", "name": "CVV Non-Storage", "description": "Verification that CVV is not stored"}]},
                        {"code": "3.3.3", "name": "PIN not retained", "statement": "The PIN and PIN block are not retained after authorization.", "is_mandatory": True, "evidence": [{"type": "document", "name": "PIN Non-Storage", "description": "Verification that PIN/PIN blocks are not stored"}]},
                    ]
                },
                {
                    "code": "3.4",
                    "name": "Access to displays of full PAN is restricted",
                    "controls": [
                        {"code": "3.4.1", "name": "PAN masked when displayed", "statement": "PAN is masked when displayed so that only personnel with business need can see full PAN.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "PAN Masking", "description": "Screenshots showing PAN masking in applications"}]},
                        {"code": "3.4.2", "name": "Technical controls for masking", "statement": "Technical controls are in place to ensure PAN is masked unless business need.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Masking Configuration", "description": "Technical configuration of PAN masking"}]},
                    ]
                },
                {
                    "code": "3.5",
                    "name": "PAN is secured wherever it is stored",
                    "controls": [
                        {"code": "3.5.1", "name": "PAN rendered unreadable", "statement": "PAN is rendered unreadable anywhere it is stored using strong cryptography.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Encryption Implementation", "description": "Documentation of PAN encryption methods"}, {"type": "screenshot", "name": "Encrypted Data Sample", "description": "Evidence of encrypted stored data"}]},
                        {"code": "3.5.2", "name": "Disk-level encryption usage", "statement": "If disk-level or partition-level encryption is used, it is implemented appropriately.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Disk Encryption Config", "description": "Disk encryption configuration and status"}]},
                    ]
                },
                {
                    "code": "3.6",
                    "name": "Cryptographic keys are protected",
                    "controls": [
                        {"code": "3.6.1", "name": "Key management procedures", "statement": "Key management processes and procedures are defined and implemented.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Key Management Policy", "description": "Cryptographic key management policy and procedures"}]},
                        {"code": "3.6.2", "name": "Secret keys protected", "statement": "Secret and private keys used for encryption/decryption are protected.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Key Protection Evidence", "description": "Evidence of key protection (HSM, split knowledge, etc.)"}]},
                    ]
                },
                {
                    "code": "3.7",
                    "name": "Account data retention and disposal are managed",
                    "controls": [
                        {"code": "3.7.1", "name": "Retention schedules defined", "statement": "Data retention and disposal schedules are defined and implemented.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Retention Schedule", "description": "Data retention and disposal schedule"}]},
                        {"code": "3.7.2", "name": "Secure deletion implemented", "statement": "Cardholder data is securely deleted when no longer needed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Secure Deletion Evidence", "description": "Evidence of secure data deletion processes"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-4",
            "name": "Requirement 4: Protect Cardholder Data with Strong Cryptography During Transmission",
            "description": "Sensitive information must be encrypted during transmission over networks that are easily accessed by malicious individuals.",
            "order": 4,
            "objectives": [
                {
                    "code": "4.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "4.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 4 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Transmission Security Policy", "description": "Policy for secure data transmission"}]},
                        {"code": "4.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 4 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Transmission Security Roles", "description": "Roles for transmission security"}]},
                    ]
                },
                {
                    "code": "4.2",
                    "name": "PAN is protected with strong cryptography during transmission",
                    "controls": [
                        {"code": "4.2.1", "name": "Strong cryptography used", "statement": "Strong cryptography and security protocols are implemented to safeguard PAN during transmission.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "TLS Configuration", "description": "TLS/SSL configuration showing strong ciphers"}, {"type": "document", "name": "Certificate Inventory", "description": "SSL/TLS certificate inventory"}]},
                        {"code": "4.2.2", "name": "PAN secured via end-user messaging", "statement": "PAN is secured with strong cryptography if sent via end-user messaging technologies.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Messaging Security Policy", "description": "Policy prohibiting or securing PAN in messages"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-5",
            "name": "Requirement 5: Protect All Systems and Networks from Malicious Software",
            "description": "Malicious software (malware) such as viruses, worms, and Trojans enter the network during many business-approved activities.",
            "order": 5,
            "objectives": [
                {
                    "code": "5.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "5.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 5 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Anti-Malware Policy", "description": "Anti-malware and endpoint protection policy"}]},
                        {"code": "5.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 5 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Anti-Malware Roles", "description": "Roles for malware protection"}]},
                    ]
                },
                {
                    "code": "5.2",
                    "name": "Malware is prevented or detected and addressed",
                    "controls": [
                        {"code": "5.2.1", "name": "Anti-malware deployed", "statement": "An anti-malware solution is deployed on all systems commonly affected by malware.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "AV Deployment Status", "description": "Anti-malware deployment status dashboard"}]},
                        {"code": "5.2.2", "name": "Anti-malware performs scans", "statement": "The anti-malware solution performs periodic scans and active/real-time scans.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Scan Configuration", "description": "Anti-malware scan schedule configuration"}]},
                        {"code": "5.2.3", "name": "Systems not commonly affected evaluated", "statement": "Systems not commonly affected by malware are evaluated to identify and address evolving malware threats.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Malware Risk Assessment", "description": "Risk assessment for systems without traditional AV"}]},
                    ]
                },
                {
                    "code": "5.3",
                    "name": "Anti-malware mechanisms and processes are active, maintained, and monitored",
                    "controls": [
                        {"code": "5.3.1", "name": "Anti-malware kept current", "statement": "The anti-malware solution is kept current via automatic updates.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "AV Update Status", "description": "Anti-malware signature update status"}]},
                        {"code": "5.3.2", "name": "Anti-malware generates logs", "statement": "The anti-malware solution generates audit logs.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "AV Logs", "description": "Sample anti-malware logs"}]},
                        {"code": "5.3.3", "name": "Anti-malware cannot be disabled", "statement": "The anti-malware solution cannot be disabled or altered by users unless specifically authorized.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "AV Tamper Protection", "description": "Tamper protection configuration"}]},
                    ]
                },
                {
                    "code": "5.4",
                    "name": "Anti-phishing mechanisms protect users against phishing attacks",
                    "controls": [
                        {"code": "5.4.1", "name": "Anti-phishing mechanisms deployed", "statement": "Processes and automated mechanisms are in place to detect and protect personnel against phishing attacks.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Anti-Phishing Controls", "description": "Anti-phishing controls documentation"}, {"type": "screenshot", "name": "Email Security Config", "description": "Email security gateway configuration"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-6",
            "name": "Requirement 6: Develop and Maintain Secure Systems and Software",
            "description": "Security vulnerabilities in systems and software may allow criminals to access the system and steal cardholder data.",
            "order": 6,
            "objectives": [
                {
                    "code": "6.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "6.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 6 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Secure Development Policy", "description": "Secure software development policy"}]},
                        {"code": "6.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 6 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Development Security Roles", "description": "Roles for secure development"}]},
                    ]
                },
                {
                    "code": "6.2",
                    "name": "Bespoke and custom software is developed securely",
                    "controls": [
                        {"code": "6.2.1", "name": "Secure development defined", "statement": "Bespoke and custom software is developed securely based on industry standards.", "is_mandatory": True, "evidence": [{"type": "document", "name": "SDLC Documentation", "description": "Secure development lifecycle documentation"}]},
                        {"code": "6.2.2", "name": "Developers trained", "statement": "Software development personnel working on bespoke software are trained.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Developer Training Records", "description": "Secure coding training records"}]},
                        {"code": "6.2.3", "name": "Code reviewed", "statement": "Bespoke and custom software is reviewed prior to release to identify and correct potential coding vulnerabilities.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Code Review Records", "description": "Code review documentation"}]},
                        {"code": "6.2.4", "name": "Injection attacks prevented", "statement": "Software engineering techniques prevent common software attacks and vulnerabilities.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Secure Coding Standards", "description": "Secure coding standards documentation"}]},
                    ]
                },
                {
                    "code": "6.3",
                    "name": "Security vulnerabilities are identified and addressed",
                    "controls": [
                        {"code": "6.3.1", "name": "Security vulnerabilities identified", "statement": "Security vulnerabilities are identified and managed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Vulnerability Management Process", "description": "Vulnerability identification and management process"}]},
                        {"code": "6.3.2", "name": "Inventory of software maintained", "statement": "An inventory of bespoke and custom software and third-party components is maintained.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Software Inventory", "description": "Inventory of applications and components"}]},
                        {"code": "6.3.3", "name": "Vulnerabilities addressed", "statement": "All system components are protected from known vulnerabilities by installing applicable patches/updates.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Patch Status Report", "description": "System patch compliance report"}]},
                    ]
                },
                {
                    "code": "6.4",
                    "name": "Public-facing web applications are protected against attacks",
                    "controls": [
                        {"code": "6.4.1", "name": "Public-facing apps protected", "statement": "Public-facing web applications are protected against attacks.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "WAF Configuration", "description": "Web application firewall configuration"}]},
                        {"code": "6.4.2", "name": "Automated technical solution deployed", "statement": "For public-facing web applications, an automated technical solution is deployed to detect and prevent web-based attacks.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "WAF Dashboard", "description": "WAF dashboard showing protection status"}]},
                        {"code": "6.4.3", "name": "Payment page scripts managed", "statement": "All payment page scripts are managed to ensure integrity.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Script Inventory", "description": "Inventory and authorization of payment page scripts"}]},
                    ]
                },
                {
                    "code": "6.5",
                    "name": "Changes to all system components are managed securely",
                    "controls": [
                        {"code": "6.5.1", "name": "Changes controlled", "statement": "Changes to all system components are managed per defined procedures.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Change Management Records", "description": "Sample change management tickets"}]},
                        {"code": "6.5.2", "name": "Significant changes tested", "statement": "Upon completion of a significant change, all relevant PCI DSS requirements are tested.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Change Test Results", "description": "Test results after significant changes"}]},
                        {"code": "6.5.3", "name": "Pre-production testing", "statement": "Pre-production environments are separated from production and access controls enforced.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Environment Separation", "description": "Documentation of environment separation"}]},
                        {"code": "6.5.4", "name": "Separation of duties", "statement": "Roles and functions are separated between production and pre-production environments.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Role Separation Evidence", "description": "Evidence of role separation"}]},
                        {"code": "6.5.5", "name": "Live PANs not used in testing", "statement": "Live PANs are not used in pre-production environments.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Test Data Policy", "description": "Policy prohibiting live PANs in testing"}]},
                        {"code": "6.5.6", "name": "Test data removed", "statement": "Test data and accounts are removed before production systems go live.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Pre-Go-Live Checklist", "description": "Checklist verifying test data removal"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-7",
            "name": "Requirement 7: Restrict Access to System Components and Cardholder Data by Business Need to Know",
            "description": "To ensure critical data can only be accessed by authorized personnel, systems and processes must be in place to limit access.",
            "order": 7,
            "objectives": [
                {
                    "code": "7.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "7.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 7 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Access Control Policy", "description": "Access control policy document"}]},
                        {"code": "7.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 7 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Access Control Roles", "description": "Roles for access control management"}]},
                    ]
                },
                {
                    "code": "7.2",
                    "name": "Access to system components and data is appropriately defined and assigned",
                    "controls": [
                        {"code": "7.2.1", "name": "Access control model defined", "statement": "An access control model is defined and includes granting access based on business need.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Access Control Model", "description": "RBAC or equivalent access model documentation"}]},
                        {"code": "7.2.2", "name": "Access assigned based on job function", "statement": "Access is assigned to users based on job classification and function.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Role Definitions", "description": "Job role to access rights mapping"}]},
                        {"code": "7.2.3", "name": "Privileges assigned by authorized personnel", "statement": "Approval is required to assign privileges to users.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Access Approval Records", "description": "Sample access request approvals"}]},
                        {"code": "7.2.4", "name": "User access reviews performed", "statement": "User accounts and related access privileges are reviewed periodically.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Access Review Report", "description": "Most recent access review documentation"}]},
                        {"code": "7.2.5", "name": "Access assigned based on least privilege", "statement": "All application and system accounts and related access privileges are assigned based on least privilege.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Least Privilege Evidence", "description": "Evidence of least privilege implementation"}]},
                    ]
                },
                {
                    "code": "7.3",
                    "name": "Access to system components and data is managed via an access control system",
                    "controls": [
                        {"code": "7.3.1", "name": "Access control system in place", "statement": "An access control system is in place that restricts access based on business need.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Access Control System", "description": "Access control system configuration"}]},
                        {"code": "7.3.2", "name": "System configured to enforce access", "statement": "The access control system is configured to enforce restrictions based on roles.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Role-Based Access Config", "description": "RBAC configuration screenshots"}]},
                        {"code": "7.3.3", "name": "Default deny all", "statement": "The access control system is set to deny all by default.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Default Deny Config", "description": "Evidence of default deny configuration"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-8",
            "name": "Requirement 8: Identify Users and Authenticate Access to System Components",
            "description": "Two fundamental principles of identifying and authenticating users are to establish identity and verify that identity.",
            "order": 8,
            "objectives": [
                {
                    "code": "8.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "8.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 8 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Authentication Policy", "description": "User authentication policy"}]},
                        {"code": "8.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 8 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Authentication Roles", "description": "Roles for authentication management"}]},
                    ]
                },
                {
                    "code": "8.2",
                    "name": "User identification and related accounts are strictly managed",
                    "controls": [
                        {"code": "8.2.1", "name": "Unique IDs assigned", "statement": "All users are assigned a unique ID before access is granted.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "User ID List", "description": "List of user accounts showing unique IDs"}]},
                        {"code": "8.2.2", "name": "Shared accounts managed", "statement": "Group, shared, or generic accounts are not used except when necessary.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Shared Account Justification", "description": "Documentation of any shared accounts with justification"}]},
                        {"code": "8.2.3", "name": "Service accounts managed", "statement": "Service accounts used by systems are managed securely.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Service Account Inventory", "description": "Inventory of service accounts"}]},
                        {"code": "8.2.4", "name": "User lifecycle managed", "statement": "User accounts are managed through their lifecycle.", "is_mandatory": True, "evidence": [{"type": "document", "name": "User Lifecycle Process", "description": "User provisioning and deprovisioning process"}]},
                        {"code": "8.2.5", "name": "Terminated access revoked", "statement": "Access for terminated users is immediately revoked.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Termination Evidence", "description": "Sample termination access removal evidence"}]},
                        {"code": "8.2.6", "name": "Inactive accounts removed", "statement": "Inactive user accounts are removed or disabled within 90 days.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Inactive Account Report", "description": "Report of inactive accounts"}]},
                        {"code": "8.2.7", "name": "Third-party access managed", "statement": "Accounts used by third parties are managed properly.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Third Party Access", "description": "Third party account management documentation"}]},
                        {"code": "8.2.8", "name": "Inactive session timeout", "statement": "User sessions are timed out after period of inactivity.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Session Timeout Config", "description": "Session timeout configuration"}]},
                    ]
                },
                {
                    "code": "8.3",
                    "name": "Strong authentication is established and managed",
                    "controls": [
                        {"code": "8.3.1", "name": "User authentication implemented", "statement": "User identity is verified before modifying credentials.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Identity Verification Process", "description": "Process for verifying identity before credential changes"}]},
                        {"code": "8.3.2", "name": "Strong cryptography for credentials", "statement": "Authentication factors are rendered unreadable during transmission and storage.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Password Encryption", "description": "Evidence of credential encryption"}]},
                        {"code": "8.3.4", "name": "Invalid authentication attempts limited", "statement": "Invalid authentication attempts are limited by locking out the user.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Lockout Policy", "description": "Account lockout configuration"}]},
                        {"code": "8.3.5", "name": "Password complexity enforced", "statement": "Passwords/passphrases meet minimum length and complexity requirements.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Password Policy Config", "description": "Password policy configuration"}]},
                        {"code": "8.3.6", "name": "Password history maintained", "statement": "Passwords cannot be reused for at least the last four uses.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Password History Config", "description": "Password history policy configuration"}]},
                        {"code": "8.3.7", "name": "New users verified", "statement": "When setting new passwords, users are authenticated before completing.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Password Reset Process", "description": "Secure password reset process"}]},
                        {"code": "8.3.9", "name": "Passwords changed regularly", "statement": "Passwords are changed at least every 90 days if not using MFA.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Password Expiry Config", "description": "Password expiration configuration"}]},
                        {"code": "8.3.10", "name": "First-time passwords changed", "statement": "First-time passwords are changed immediately after first use.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "First Login Policy", "description": "First login password change policy"}]},
                    ]
                },
                {
                    "code": "8.4",
                    "name": "Multi-factor authentication is implemented",
                    "controls": [
                        {"code": "8.4.1", "name": "MFA for non-console access", "statement": "MFA is implemented for all non-console access into the CDE.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "MFA Configuration", "description": "MFA configuration for CDE access"}]},
                        {"code": "8.4.2", "name": "MFA for remote network access", "statement": "MFA is implemented for all remote network access.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "VPN MFA Config", "description": "VPN MFA configuration"}]},
                        {"code": "8.4.3", "name": "MFA for remote CDE access", "statement": "MFA is implemented for all remote access to the CDE from outside the network.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Remote CDE MFA", "description": "MFA for remote CDE access"}]},
                    ]
                },
                {
                    "code": "8.5",
                    "name": "Multi-factor authentication systems are configured properly",
                    "controls": [
                        {"code": "8.5.1", "name": "MFA systems properly configured", "statement": "MFA systems are implemented to prevent misuse.", "is_mandatory": True, "evidence": [{"type": "document", "name": "MFA Implementation", "description": "MFA implementation documentation"}]},
                    ]
                },
                {
                    "code": "8.6",
                    "name": "Use of application and system accounts is strictly managed",
                    "controls": [
                        {"code": "8.6.1", "name": "Interactive login restricted", "statement": "System accounts used for interactive logins are managed strictly.", "is_mandatory": True, "evidence": [{"type": "document", "name": "System Account Controls", "description": "Controls for system/application accounts"}]},
                        {"code": "8.6.2", "name": "Application passwords managed", "statement": "Passwords for application and system accounts are protected.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Service Account Passwords", "description": "Service account password management"}]},
                        {"code": "8.6.3", "name": "Hardcoded passwords prevented", "statement": "Passwords for application and system accounts are not hard-coded.", "is_mandatory": True, "evidence": [{"type": "document", "name": "No Hardcoded Credentials", "description": "Evidence that credentials are not hardcoded"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-9",
            "name": "Requirement 9: Restrict Physical Access to Cardholder Data",
            "description": "Physical access to cardholder data or systems that store, process, or transmit cardholder data should be restricted.",
            "order": 9,
            "objectives": [
                {
                    "code": "9.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "9.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 9 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Physical Security Policy", "description": "Physical security policy document"}]},
                        {"code": "9.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 9 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Physical Security Roles", "description": "Roles for physical security"}]},
                    ]
                },
                {
                    "code": "9.2",
                    "name": "Physical access controls manage entry into facilities",
                    "controls": [
                        {"code": "9.2.1", "name": "Entry controls in place", "statement": "Appropriate physical entry controls are in place to restrict access to CDE.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Physical Access Controls", "description": "Physical access control documentation"}]},
                        {"code": "9.2.2", "name": "Visitors managed", "statement": "Procedures are implemented for managing visitors.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Visitor Procedures", "description": "Visitor management procedures"}]},
                        {"code": "9.2.3", "name": "Visitor badges used", "statement": "Visitor badges are used to identify visitors.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Visitor Badge Process", "description": "Visitor badge issuance process"}]},
                        {"code": "9.2.4", "name": "Visitor log maintained", "statement": "A visitor log is used to maintain a physical audit trail of visitor activity.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Visitor Log Sample", "description": "Sample visitor log entries"}]},
                    ]
                },
                {
                    "code": "9.3",
                    "name": "Physical access for personnel is authorized and managed",
                    "controls": [
                        {"code": "9.3.1", "name": "Physical access to CDE controlled", "statement": "Physical access to CDE is controlled via appropriate mechanisms.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Badge Reader Logs", "description": "Physical access logs for CDE areas"}]},
                        {"code": "9.3.2", "name": "Identification for personnel", "statement": "Personnel are identified via badge or other mechanism.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Badge Policy", "description": "Employee badge/ID policy"}]},
                        {"code": "9.3.3", "name": "Physical access controlled for personnel", "statement": "Physical access for onsite personnel is controlled before access is granted.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Access Authorization", "description": "Physical access authorization records"}]},
                        {"code": "9.3.4", "name": "Physical access revoked", "statement": "Physical access is immediately revoked for terminated personnel.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Termination Physical Access", "description": "Physical access removal on termination"}]},
                    ]
                },
                {
                    "code": "9.4",
                    "name": "Media with cardholder data is securely stored, accessed, distributed, and destroyed",
                    "controls": [
                        {"code": "9.4.1", "name": "Media physically secured", "statement": "All media with cardholder data is physically secured.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Media Security Controls", "description": "Media storage security controls"}]},
                        {"code": "9.4.2", "name": "Media classified", "statement": "All media with cardholder data is classified as confidential.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Media Classification", "description": "Media classification policy"}]},
                        {"code": "9.4.3", "name": "Media sent via secured courier", "statement": "Media sent outside the facility is sent via secured courier.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Media Transport Log", "description": "Media transportation records"}]},
                        {"code": "9.4.4", "name": "Media requiring destruction tracked", "statement": "Media is tracked until it is destroyed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Media Tracking Log", "description": "Media inventory and tracking"}]},
                        {"code": "9.4.5", "name": "Electronic media destroyed", "statement": "Electronic media with cardholder data is destroyed when no longer needed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Media Destruction Log", "description": "Media destruction certificates and logs"}]},
                        {"code": "9.4.6", "name": "Hardcopy media destroyed", "statement": "Hardcopy materials with cardholder data are destroyed when no longer needed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Hardcopy Destruction", "description": "Hardcopy destruction records"}]},
                    ]
                },
                {
                    "code": "9.5",
                    "name": "POI devices are protected from tampering and unauthorized substitution",
                    "controls": [
                        {"code": "9.5.1", "name": "POI devices inventoried", "statement": "POI devices are protected from tampering by maintaining a list of devices.", "is_mandatory": True, "evidence": [{"type": "document", "name": "POI Device Inventory", "description": "Inventory of POI devices"}]},
                        {"code": "9.5.2", "name": "POI devices inspected", "statement": "POI devices are periodically inspected to detect tampering.", "is_mandatory": True, "evidence": [{"type": "document", "name": "POI Inspection Log", "description": "POI device inspection records"}]},
                        {"code": "9.5.3", "name": "Training on POI tampering", "statement": "Personnel are trained to be aware of attempted tampering of POI devices.", "is_mandatory": True, "evidence": [{"type": "document", "name": "POI Training Records", "description": "POI awareness training records"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-10",
            "name": "Requirement 10: Log and Monitor All Access to System Components and Cardholder Data",
            "description": "Logging mechanisms and the ability to track user activities are critical for preventing, detecting, or minimizing data breaches.",
            "order": 10,
            "objectives": [
                {
                    "code": "10.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "10.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 10 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Logging Policy", "description": "Logging and monitoring policy"}]},
                        {"code": "10.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 10 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Logging Roles", "description": "Roles for logging management"}]},
                    ]
                },
                {
                    "code": "10.2",
                    "name": "Audit logs are implemented to support the detection of anomalies and suspicious activity",
                    "controls": [
                        {"code": "10.2.1", "name": "Audit logs enabled", "statement": "Audit logs are enabled and active for all system components.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Logging Configuration", "description": "Audit log configuration"}]},
                        {"code": "10.2.2", "name": "Audit logs capture all events", "statement": "Audit logs record all required events.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Log Event Types", "description": "Log configuration showing captured events"}]},
                    ]
                },
                {
                    "code": "10.3",
                    "name": "Audit logs are protected from destruction and unauthorized modifications",
                    "controls": [
                        {"code": "10.3.1", "name": "Logs access restricted", "statement": "Access to audit logs is restricted to those with job-related need.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Log Access Controls", "description": "Log file access permissions"}]},
                        {"code": "10.3.2", "name": "Logs protected from modification", "statement": "Audit logs are protected from modification.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Log Integrity", "description": "Log integrity protection configuration"}]},
                        {"code": "10.3.3", "name": "Logs backed up", "statement": "Audit logs are backed up promptly to a secure centralized location.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Log Backup Config", "description": "Log backup/forwarding configuration"}]},
                        {"code": "10.3.4", "name": "Logs reviewed for anomalies", "statement": "File integrity monitoring or change-detection mechanisms is used on audit logs.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Log FIM", "description": "File integrity monitoring on logs"}]},
                    ]
                },
                {
                    "code": "10.4",
                    "name": "Audit logs are reviewed to identify anomalies or suspicious activity",
                    "controls": [
                        {"code": "10.4.1", "name": "Daily log review", "statement": "Security events and logs are reviewed at least daily.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Log Review Records", "description": "Daily log review documentation"}]},
                        {"code": "10.4.2", "name": "Periodic log review", "statement": "Logs of other system components are reviewed periodically.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Periodic Review Schedule", "description": "Log review schedule and records"}]},
                        {"code": "10.4.3", "name": "Exceptions followed up", "statement": "Exceptions and anomalies identified during review are addressed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Exception Follow-up", "description": "Records of log exception follow-up"}]},
                    ]
                },
                {
                    "code": "10.5",
                    "name": "Audit log history is retained and available for analysis",
                    "controls": [
                        {"code": "10.5.1", "name": "Logs retained 12 months", "statement": "Audit logs are retained for at least 12 months, with at least 3 months immediately available.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Log Retention Config", "description": "Log retention configuration"}]},
                    ]
                },
                {
                    "code": "10.6",
                    "name": "Time-synchronization mechanisms support consistent time across all systems",
                    "controls": [
                        {"code": "10.6.1", "name": "System clocks synchronized", "statement": "System clocks are synchronized using time-synchronization technology.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "NTP Configuration", "description": "NTP/time synchronization configuration"}]},
                        {"code": "10.6.2", "name": "Time data protected", "statement": "Systems are configured to receive time data only from designated sources.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Time Source Config", "description": "Authorized time source configuration"}]},
                        {"code": "10.6.3", "name": "Time settings protected", "statement": "Time settings are received from industry-accepted sources and protected from unauthorized access.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Time Sync Documentation", "description": "Time synchronization documentation"}]},
                    ]
                },
                {
                    "code": "10.7",
                    "name": "Failures of critical security control systems are detected, reported, and responded to promptly",
                    "controls": [
                        {"code": "10.7.1", "name": "Failures detected", "statement": "Failures of critical security controls are detected, alerted, and addressed promptly.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Security Monitoring", "description": "Security control failure alerting"}]},
                        {"code": "10.7.2", "name": "Security control failures addressed", "statement": "Failures of security controls are responded to and resolved timely.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Failure Response Records", "description": "Security control failure response records"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-11",
            "name": "Requirement 11: Test Security of Systems and Networks Regularly",
            "description": "Vulnerabilities are being discovered continually by malicious individuals and researchers, and being introduced by new software.",
            "order": 11,
            "objectives": [
                {
                    "code": "11.1",
                    "name": "Processes and mechanisms are defined and understood",
                    "controls": [
                        {"code": "11.1.1", "name": "Security policies defined", "statement": "All security policies and operational procedures for Requirement 11 are documented and in use.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Security Testing Policy", "description": "Security testing policy"}]},
                        {"code": "11.1.2", "name": "Roles assigned", "statement": "Roles and responsibilities for Requirement 11 activities are documented and assigned.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Security Testing Roles", "description": "Roles for security testing"}]},
                    ]
                },
                {
                    "code": "11.2",
                    "name": "Wireless access points are identified and monitored, and unauthorized wireless access points are addressed",
                    "controls": [
                        {"code": "11.2.1", "name": "Authorized wireless APs identified", "statement": "Authorized and unauthorized wireless access points are managed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Wireless AP Inventory", "description": "Wireless access point inventory"}]},
                        {"code": "11.2.2", "name": "Wireless scanning performed", "statement": "An inventory of authorized wireless access points is maintained and quarterly scans performed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Wireless Scan Report", "description": "Most recent wireless scan results"}]},
                    ]
                },
                {
                    "code": "11.3",
                    "name": "External and internal vulnerabilities are regularly identified, prioritized, and addressed",
                    "controls": [
                        {"code": "11.3.1", "name": "Internal vulnerability scans", "statement": "Internal vulnerability scans are performed at least quarterly.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Internal Scan Report", "description": "Most recent internal vulnerability scan report"}]},
                        {"code": "11.3.2", "name": "External vulnerability scans", "statement": "External vulnerability scans are performed at least quarterly by an ASV.", "is_mandatory": True, "evidence": [{"type": "document", "name": "ASV Scan Report", "description": "Most recent ASV scan attestation of compliance"}]},
                        {"code": "11.3.3", "name": "Scans after significant changes", "statement": "Internal and external scans are performed after any significant change.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Post-Change Scan", "description": "Scan results after significant changes"}]},
                    ]
                },
                {
                    "code": "11.4",
                    "name": "External and internal penetration testing is regularly performed",
                    "controls": [
                        {"code": "11.4.1", "name": "Penetration testing performed", "statement": "Penetration testing is performed at least annually and after significant changes.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Penetration Test Report", "description": "Most recent penetration test report"}]},
                        {"code": "11.4.2", "name": "Internal penetration testing", "statement": "Internal penetration testing is performed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Internal Pen Test", "description": "Internal penetration test results"}]},
                        {"code": "11.4.3", "name": "External penetration testing", "statement": "External penetration testing is performed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "External Pen Test", "description": "External penetration test results"}]},
                        {"code": "11.4.4", "name": "Segmentation testing performed", "statement": "Segmentation controls are tested at least annually.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Segmentation Test", "description": "Network segmentation test results"}]},
                        {"code": "11.4.5", "name": "Penetration findings remediated", "statement": "Exploitable vulnerabilities found during penetration testing are corrected.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Pen Test Remediation", "description": "Penetration test finding remediation evidence"}]},
                    ]
                },
                {
                    "code": "11.5",
                    "name": "Network intrusions and unexpected file changes are detected and responded to",
                    "controls": [
                        {"code": "11.5.1", "name": "IDS/IPS deployed", "statement": "IDS/IPS is used to detect and/or prevent intrusions into the network.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "IDS/IPS Dashboard", "description": "IDS/IPS deployment status"}]},
                        {"code": "11.5.2", "name": "Change-detection mechanism deployed", "statement": "A change-detection mechanism is deployed to detect unauthorized modification of critical files.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "FIM Configuration", "description": "File integrity monitoring configuration"}]},
                    ]
                },
                {
                    "code": "11.6",
                    "name": "Unauthorized changes on payment pages are detected and responded to",
                    "controls": [
                        {"code": "11.6.1", "name": "Payment page monitoring", "statement": "A change and tamper-detection mechanism is deployed to detect unauthorized changes to payment pages.", "is_mandatory": True, "evidence": [{"type": "screenshot", "name": "Payment Page Monitoring", "description": "Payment page integrity monitoring"}]},
                    ]
                }
            ]
        },
        {
            "code": "REQ-12",
            "name": "Requirement 12: Support Information Security with Organizational Policies and Programs",
            "description": "A strong security policy sets the security tone for the whole entity and informs personnel what is expected of them.",
            "order": 12,
            "objectives": [
                {
                    "code": "12.1",
                    "name": "A comprehensive information security policy is known and maintained",
                    "controls": [
                        {"code": "12.1.1", "name": "Information security policy established", "statement": "An overall information security policy is established, published, maintained, and disseminated.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Information Security Policy", "description": "Overall information security policy"}]},
                        {"code": "12.1.2", "name": "Policy reviewed annually", "statement": "The information security policy is reviewed at least annually.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Policy Review Record", "description": "Evidence of annual policy review"}]},
                        {"code": "12.1.3", "name": "Security roles defined", "statement": "The security policy clearly defines information security roles and responsibilities.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Security Org Chart", "description": "Security organization structure"}]},
                        {"code": "12.1.4", "name": "CISO designated", "statement": "Responsibility for information security is formally assigned to a CISO or equivalent.", "is_mandatory": True, "evidence": [{"type": "document", "name": "CISO Appointment", "description": "CISO appointment documentation"}]},
                    ]
                },
                {
                    "code": "12.2",
                    "name": "Acceptable use policies for end-user technologies are defined and implemented",
                    "controls": [
                        {"code": "12.2.1", "name": "Acceptable use policies documented", "statement": "Acceptable use policies for end-user technologies are documented and implemented.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Acceptable Use Policy", "description": "Acceptable use policy for end-user technologies"}]},
                    ]
                },
                {
                    "code": "12.3",
                    "name": "Risks to the CDE are formally identified, evaluated, and managed",
                    "controls": [
                        {"code": "12.3.1", "name": "Risk assessment performed", "statement": "A formal risk assessment is performed at least annually.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Risk Assessment Report", "description": "Annual risk assessment report"}]},
                        {"code": "12.3.2", "name": "Targeted risk analysis performed", "statement": "Targeted risk analyses are performed for each PCI DSS requirement that provides flexibility.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Targeted Risk Analysis", "description": "Targeted risk analysis documentation"}]},
                        {"code": "12.3.3", "name": "Cryptographic suites reviewed", "statement": "Cryptographic cipher suites and protocols in use are documented and reviewed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Cryptography Inventory", "description": "Cryptographic cipher suites documentation"}]},
                        {"code": "12.3.4", "name": "Hardware/software technologies reviewed", "statement": "Hardware and software technologies in use are reviewed.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Technology Review", "description": "Technology review documentation"}]},
                    ]
                },
                {
                    "code": "12.4",
                    "name": "PCI DSS compliance is managed",
                    "controls": [
                        {"code": "12.4.1", "name": "Responsibility for compliance assigned", "statement": "Responsibility is assigned for maintaining PCI DSS compliance.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Compliance Responsibility", "description": "PCI DSS compliance responsibility assignment"}]},
                        {"code": "12.4.2", "name": "Compliance reviews performed", "statement": "Reviews are performed to confirm PCI DSS requirements are met.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Compliance Review Records", "description": "PCI DSS compliance review records"}]},
                    ]
                },
                {
                    "code": "12.5",
                    "name": "PCI DSS scope is documented and validated",
                    "controls": [
                        {"code": "12.5.1", "name": "PCI DSS scope documented", "statement": "An inventory of system components in scope for PCI DSS is maintained.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Scope Inventory", "description": "PCI DSS scope inventory"}]},
                        {"code": "12.5.2", "name": "Scope validated annually", "statement": "PCI DSS scope is validated at least annually.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Scope Validation", "description": "Annual scope validation documentation"}]},
                        {"code": "12.5.3", "name": "Scope validated after significant change", "statement": "PCI DSS scope is confirmed following significant changes.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Post-Change Scope Review", "description": "Scope review after significant changes"}]},
                    ]
                },
                {
                    "code": "12.6",
                    "name": "Security awareness education is an ongoing activity",
                    "controls": [
                        {"code": "12.6.1", "name": "Security awareness program implemented", "statement": "A formal security awareness program is implemented.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Security Awareness Program", "description": "Security awareness program documentation"}]},
                        {"code": "12.6.2", "name": "Awareness training provided", "statement": "Personnel are provided security awareness training upon hire and annually.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Training Records", "description": "Security awareness training completion records"}]},
                        {"code": "12.6.3", "name": "Personnel acknowledge policies", "statement": "Personnel acknowledge they have read and understand security policies.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Policy Acknowledgments", "description": "Signed policy acknowledgment forms"}]},
                    ]
                },
                {
                    "code": "12.7",
                    "name": "Personnel are screened to reduce risks from insider threats",
                    "controls": [
                        {"code": "12.7.1", "name": "Background checks performed", "statement": "Background checks are performed on potential personnel before hire.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Background Check Policy", "description": "Background screening policy and sample records"}]},
                    ]
                },
                {
                    "code": "12.8",
                    "name": "Risk to information assets from third party service providers is managed",
                    "controls": [
                        {"code": "12.8.1", "name": "TPSP list maintained", "statement": "A list of third-party service providers (TPSPs) is maintained.", "is_mandatory": True, "evidence": [{"type": "document", "name": "TPSP Inventory", "description": "Third-party service provider inventory"}]},
                        {"code": "12.8.2", "name": "TPSP agreements maintained", "statement": "Written agreements with TPSPs include acknowledgments of responsibility.", "is_mandatory": True, "evidence": [{"type": "document", "name": "TPSP Agreements", "description": "TPSP contract samples with responsibility clauses"}]},
                        {"code": "12.8.3", "name": "TPSP engagement process established", "statement": "An established process is followed for engaging TPSPs including due diligence.", "is_mandatory": True, "evidence": [{"type": "document", "name": "TPSP Due Diligence", "description": "TPSP engagement and due diligence process"}]},
                        {"code": "12.8.4", "name": "TPSP compliance monitored", "statement": "A program is implemented to monitor TPSPs PCI DSS compliance status.", "is_mandatory": True, "evidence": [{"type": "document", "name": "TPSP Monitoring", "description": "TPSP compliance monitoring records"}]},
                        {"code": "12.8.5", "name": "TPSP responsibility documented", "statement": "Information about which PCI DSS requirements are managed by each TPSP is maintained.", "is_mandatory": True, "evidence": [{"type": "document", "name": "TPSP Responsibility Matrix", "description": "TPSP responsibility matrix"}]},
                    ]
                },
                {
                    "code": "12.9",
                    "name": "Third-party service providers support their customers PCI DSS compliance",
                    "controls": [
                        {"code": "12.9.1", "name": "TPSP provides AOC information", "statement": "TPSPs acknowledge their responsibilities and provide compliance status.", "is_mandatory": True, "evidence": [{"type": "document", "name": "TPSP AOC", "description": "TPSP Attestation of Compliance"}]},
                        {"code": "12.9.2", "name": "TPSP responsibility matrix provided", "statement": "TPSPs provide customers with responsibility matrix information.", "is_mandatory": True, "evidence": [{"type": "document", "name": "TPSP Responsibility Info", "description": "TPSP responsibility information provided to customer"}]},
                    ]
                },
                {
                    "code": "12.10",
                    "name": "Suspected and confirmed security incidents are responded to immediately",
                    "controls": [
                        {"code": "12.10.1", "name": "Incident response plan established", "statement": "An incident response plan exists and is ready to be activated.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Incident Response Plan", "description": "Incident response plan document"}]},
                        {"code": "12.10.2", "name": "IR plan reviewed annually", "statement": "The incident response plan is reviewed and updated at least annually.", "is_mandatory": True, "evidence": [{"type": "document", "name": "IR Plan Review", "description": "Annual incident response plan review record"}]},
                        {"code": "12.10.3", "name": "Personnel trained on IR", "statement": "Specific personnel are designated to be available 24/7 to respond to incidents.", "is_mandatory": True, "evidence": [{"type": "document", "name": "IR Team Roster", "description": "Incident response team roster with contact info"}]},
                        {"code": "12.10.4", "name": "IR personnel trained", "statement": "Personnel responsible for responding to security incidents are appropriately trained.", "is_mandatory": True, "evidence": [{"type": "document", "name": "IR Training Records", "description": "Incident response training records"}]},
                        {"code": "12.10.5", "name": "Alerts from security systems included", "statement": "The incident response plan includes alerts from security monitoring systems.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Alert Integration", "description": "Evidence of alert integration in IR plan"}]},
                        {"code": "12.10.6", "name": "IR plan tested", "statement": "The incident response plan is tested at least annually.", "is_mandatory": True, "evidence": [{"type": "document", "name": "IR Exercise Report", "description": "Incident response exercise/tabletop report"}]},
                        {"code": "12.10.7", "name": "IR procedures exist for unexpected PAN", "statement": "Incident response procedures exist for responding to detection of unexpected PAN.", "is_mandatory": True, "evidence": [{"type": "document", "name": "Unexpected PAN Procedure", "description": "Procedure for handling unexpected PAN discovery"}]},
                    ]
                }
            ]
        }
    ]
}
