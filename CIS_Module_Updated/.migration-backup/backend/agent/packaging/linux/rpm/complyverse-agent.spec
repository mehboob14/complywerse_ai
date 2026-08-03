Name:           complyverse-agent
Version:        1.0.0
Release:        1%{?dist}
Summary:        Compliverse Compliance Agent
License:        Proprietary
URL:            https://compliverse.app
Source0:        %{name}-%{version}.tar.gz
BuildArch:      noarch

Requires:       python3 >= 3.9
Requires:       python3-cryptography
Requires:       python3-paramiko

%description
Pulls CIS benchmark check jobs from Compliverse cloud and executes them
locally (RHEL/Alma/Rocky endpoint mode) or against remote network devices
via SSH (collector mode).

%prep
%setup -q

%install
# Lay down agent package
install -d %{buildroot}/opt/complyverse-agent/lib
cp -r complyverse_agent %{buildroot}/opt/complyverse-agent/lib/

# Wrapper script
install -d %{buildroot}/opt/complyverse-agent/bin
cat > %{buildroot}/opt/complyverse-agent/bin/complyverse-agent <<'EOF'
#!/bin/sh
exec /usr/bin/python3 -m complyverse_agent "$@"
EOF
chmod 755 %{buildroot}/opt/complyverse-agent/bin/complyverse-agent

# Systemd unit
install -d %{buildroot}/usr/lib/systemd/system
install -m 0644 complyverse-agent.service \
    %{buildroot}/usr/lib/systemd/system/complyverse-agent.service

%files
/opt/complyverse-agent
/usr/lib/systemd/system/complyverse-agent.service

%pre
getent passwd complyverse >/dev/null 2>&1 || \
    useradd --system --no-create-home --shell /sbin/nologin \
            --comment "Compliverse Agent" complyverse

%post
install -d -o complyverse -g complyverse -m 0750 /var/lib/complyverse-agent
install -d -o complyverse -g complyverse -m 0750 /var/log/complyverse-agent
systemctl daemon-reload || true

cat <<MSG

================================================================
Compliverse Compliance Agent installed.

Next:
  1. Enroll:
     sudo -u complyverse /opt/complyverse-agent/bin/complyverse-agent \\
          enroll --backend https://YOUR-TENANT.compliverse.app \\
                 --token <enrollment-token>

  2. Enable + start:
     sudo systemctl enable --now complyverse-agent
================================================================

MSG

%preun
if [ $1 -eq 0 ] ; then
    # uninstall, not upgrade
    systemctl stop complyverse-agent >/dev/null 2>&1 || true
    systemctl disable complyverse-agent >/dev/null 2>&1 || true
fi

%postun
if [ $1 -ge 1 ] ; then
    # upgrade — restart service to pick up new code
    systemctl try-restart complyverse-agent >/dev/null 2>&1 || true
fi

%changelog
* Wed May 21 2026 Compliverse <support@compliverse.app> - 1.0.0-1
- Initial release: endpoint + collector modes, encrypted vault.
