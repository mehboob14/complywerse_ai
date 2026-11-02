# ava-storage-scan (on ava-base) — SCAN lane for asset_type == "storage" (NAS / SAN / object storage).
# All tools installed via apt / pip (prebuilt wheels) — never slow from-source. Engine invocation:
#   docker run --rm ava-storage-scan "<tool> <args>"
# Wired by storage_scan_tools.STORAGE_SCAN_TOOLS: showmount + nmap nfs/smb/iscsi scripts, rpcinfo, smbmap,
# smbclient, anonymous rsync, anonymous ftp (curl), and anonymous S3-style bucket listing (curl + awscli).
FROM ava-base:latest

ENV WORDLISTS=/wordlists

# ---- apt scan tools (ONE layer, non-fatal per-pkg + cleanup). nmap ships the nfs-*/smb-*/iscsi-info NSE
#      scripts; nfs-common=showmount, rpcbind=rpcinfo, smbclient+smbmap-deps, rsync, ftp client via curl
#      (already in base), cifs-utils for the exploit-side mount checks' shared dep. ----
RUN apt-get update \
 && for p in \
      nmap nfs-common rpcbind smbclient smbmap rsync ftp cifs-utils ldap-utils \
      snmp curl ; do \
      apt-get install -y "$p" || echo "skip apt:$p" ; \
    done \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- pip tools (prebuilt wheels). smbmap sometimes ships only via pip; awscli for the no-sign-request S3
#      bucket listing. Non-fatal per tool. ----
RUN pip install --break-system-packages awscli || echo "skip pip:awscli" ; \
    pip install --break-system-packages smbmap || echo "skip pip:smbmap" ; \
    true

RUN mkdir -p /wordlists /work && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache
WORKDIR /work

ENTRYPOINT ["/bin/bash","-lc"]
CMD ["echo 'ava-storage-scan ready'; command -v nmap showmount rpcinfo smbclient smbmap rsync curl aws 2>/dev/null; true"]
