# ava-win-scan (on ava-base) — LEAN Windows/AD SCAN lane (discovery / enum / recon only).
# FROM ava-base (shared runtime/build foundation: python3+pipx, golang-go, ruby, jdk,
# git/curl/wget, GOBIN & PIPX_BIN_DIR -> /usr/local/bin).
# Scope: ONLY the ~18 tools the scan sweep actually runs — WIN_SCAN_TOOLS (nmap/nbtscan/
# smbmap/smbclient/rpcclient/nmblookup/ldapsearch/snmp-check/snmpwalk/braa/onesixtyone/
# sslscan/rdp-sec-check/enum4linux-ng/polenum + impacket lookupsid/samrdump/rpcdump + the
# nxc null-session & nxc-creds specs), the lane's nmap/nuclei host sweep, and the credentialed
# wesng missing-patch -> CVE suggester (the lightweight Nessus alternative, baked with its CVE
# definitions). AD-attack / exploit / collector tools live in ava-win-exploit, NOT here.
# Engine invocation: docker run --rm ava-win-scan "<tool> <args>"
FROM ava-base:latest

LABEL org.opencontainers.image.title="ava-win-scan" \
      org.opencontainers.image.description="AVA Windows/AD lean scan+discovery arsenal (+ wesng)"

# 1) apt tools (Kali packages). Rock-solid core is fatal; the rest install one-per-package
#    (non-fatal) so a single renamed pkg can't abort the build. Build deps (krb5/ssl/ffi/sasl/
#    ldap headers + rust) are FATAL: netexec links libgssapi (needs krb5-config from libkrb5-dev)
#    and builds rust wheels — without these the whole creds arsenal silently skips. The Perl deps
#    (cpanminus + IO::Socket::SSL + Net::SSLeay + Encoding::BER via cpanm) back rdp-sec-check.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      nmap nbtscan smbmap smbclient samba-common-bin ldap-utils \
      libkrb5-dev libssl-dev libffi-dev libsasl2-dev libldap2-dev rustc cargo; \
    for p in onesixtyone polenum snmp snmp-mibs-downloader snmpcheck braa sslscan \
             cpanminus libio-socket-ssl-perl libnet-ssleay-perl; do \
      apt-get install -y "$p" || echo "skip apt:$p"; \
    done; \
    (command -v cpanm >/dev/null && cpanm --notest Encoding::BER) || echo "skip cpan:Encoding::BER"; \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 2) pipx tools (PEP668 — drop binaries into /usr/local/bin). All non-fatal.
#    netexec (nxc, host info + creds enum), enum4linux-ng (flagship null-session enumerator, git),
#    impacket (lookupsid.py / samrdump.py / rpcdump.py used by the null-session sweep; nxc -x).
RUN set +e; for p in \
      impacket \
      "git+https://github.com/cddmp/enum4linux-ng" \
      "git+https://github.com/Pennyw0rth/NetExec" ; do \
      pipx install "$p" || echo "skip pipx:$p"; \
    done; true

# 3) Go-native tools (go install -> GOBIN=/usr/local/bin). Non-fatal w/ retry.
#    Only nuclei — the lane's host vuln sweep. (kerbrute/naabu/dnsx/etc. moved to win-exploit.)
RUN set +e; for m in \
      github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest ; do \
      n=0; until go install -v "$m"; do n=$((n+1)); [ "$n" -ge 3 ] && { echo "skip go:$m"; break; }; echo "retry $n go:$m"; sleep 5; done; \
    done; \
    (command -v nuclei >/dev/null && nuclei -update-templates) || echo "skip nuclei-templates"; \
    rm -rf /root/go/pkg /root/.cache/go-build; true

# 4) git-clone script tools into /opt + thin PATH wrappers. Clone/update non-fatal; wrappers always created.
#    - rdp-sec-check: unauthenticated RDP (3389) posture (the only wired RDP source).
#    - wesng: credentialed systeminfo -> missing MS patch -> CVE. `wes.py --update` bakes the ~30MB CVE
#      definitions (definitions.zip) at build time; it lands in the CWD, so update + the wrapper both
#      cd /opt/wesng (the default --definitions is the CWD-relative 'definitions.zip').
RUN set +e; \
    ( git clone --depth 1 https://github.com/portcullislabs/rdp-sec-check /opt/rdp-sec-check \
      && printf '#!/bin/bash\nexec perl /opt/rdp-sec-check/rdp-sec-check.pl "$@"\n' > /usr/local/bin/rdp-sec-check \
      && chmod +x /usr/local/bin/rdp-sec-check ) || echo "skip git:rdp-sec-check"; \
    ( git clone --depth 1 https://github.com/bitsadmin/wesng /opt/wesng \
      && ( cd /opt/wesng && python3 /opt/wesng/wes.py --update ) ) || echo "skip git:wesng"; \
    printf '#!/bin/bash\ncd /opt/wesng && exec python3 /opt/wesng/wes.py "$@"\n' > /usr/local/bin/wes \
      && chmod +x /usr/local/bin/wes; \
    true

# ENTRYPOINT ["/bin/bash","-lc"] inherited from ava-base (single-command contract).
ENTRYPOINT ["/bin/bash","-lc"]
CMD ["echo 'ava-win-scan ready'; command -v nmap netexec enum4linux-ng ldapsearch smbclient rpcclient snmp-check sslscan rdp-sec-check nuclei wes 2>/dev/null; true"]
