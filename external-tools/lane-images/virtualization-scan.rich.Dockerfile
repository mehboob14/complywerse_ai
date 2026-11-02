# ava-virtualization-scan (on ava-base) — SCAN lane for asset_type == "virtualization".
# RICH variant: hypervisor fingerprinting is deliberately nmap NSE + HTTP/XML version
# probes + TLS cert reads — very few DEDICATED OSS hypervisor pentest tools exist, so
# we wire what is real and prebuilt (apt + pipx + ProjectDiscovery release binaries),
# never a from-source compile. Engine invocation:
#   docker run --rm ava-virtualization-scan "<tool> <args>"
FROM ava-base:latest

ENV WORDLISTS=/wordlists

# ---- apt scan tools (ONE layer, non-fatal per-pkg + cleanup). nmap ships the
#      vmware-version + http-vmware-path-vuln NSE scripts + ssl-cert; curl/openssl
#      drive the ESXi/vCenter/Proxmox HTTP+SDK probes; sslscan the cipher posture. ----
RUN apt-get update \
 && for p in \
      nmap sslscan curl openssl ca-certificates jq \
      snmp snmp-mibs-downloader onesixtyone \
      ldap-utils smbclient netcat-openbsd dnsutils \
      python3-requests ; do \
      apt-get install -y "$p" || echo "skip apt:$p" ; \
    done \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- pipx scan tools (-> /usr/local/bin). Non-fatal (prebuilt wheels). sslyze for a
#      second TLS opinion on the mgmt endpoint; govc is the vSphere CLI (credentialed,
#      armed/deferred in the module) but shipped so the creds pass can use it. ----
RUN pipx install sslyze || echo "skip pipx:sslyze" ; \
    pipx install testssl.sh-adapter || echo "skip pipx:testssl-adapter" ; \
    true

# ---- PREBUILT release binaries (no compile). nuclei carries the ESXi/vCenter CVE
#      templates (CVE-2021-21972, log4shell on vCenter) for the host sweep; govc ships
#      a linux_amd64 tar.gz. Non-fatal per tool. ----
RUN set +e ; \
    nurl=$(curl -fsSL https://api.github.com/repos/projectdiscovery/nuclei/releases/latest \
           | jq -r '.assets[].browser_download_url' | grep -iE 'linux_amd64\.zip$' | head -1) ; \
    [ -n "$nurl" ] && curl -fsSL "$nurl" -o /tmp/nuclei.zip \
      && unzip -o /tmp/nuclei.zip nuclei -d /usr/local/bin/ && chmod +x /usr/local/bin/nuclei \
      && rm -f /tmp/nuclei.zip && echo "ok prebuilt:nuclei" || echo "skip prebuilt:nuclei" ; \
    gurl=$(curl -fsSL https://api.github.com/repos/vmware/govmomi/releases/latest \
           | jq -r '.assets[].browser_download_url' | grep -iE 'govc_Linux_x86_64\.tar\.gz$' | head -1) ; \
    [ -n "$gurl" ] && curl -fsSL "$gurl" -o /tmp/govc.tgz \
      && tar -xzf /tmp/govc.tgz -C /usr/local/bin/ govc && chmod +x /usr/local/bin/govc \
      && rm -f /tmp/govc.tgz && echo "ok prebuilt:govc" || echo "skip prebuilt:govc" ; \
    ( command -v nuclei && nuclei -update-templates ) || echo "skip nuclei-templates" ; \
    true

# ---- git-clone scan tool into /opt (shallow clone, not a compile). testssl.sh for a
#      third TLS opinion on the hypervisor mgmt endpoint. ----
RUN ( git clone --depth 1 https://github.com/drwetter/testssl.sh /opt/testssl \
      && ln -sf /opt/testssl/testssl.sh /usr/local/bin/testssl.sh ) || echo "skip git:testssl" ; \
    true

RUN mkdir -p /wordlists /work && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache
WORKDIR /work

ENTRYPOINT ["/bin/bash","-lc"]
CMD ["echo 'ava-virtualization-scan ready'; command -v nmap sslscan curl openssl jq nuclei govc 2>/dev/null; true"]
