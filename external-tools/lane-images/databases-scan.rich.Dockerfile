# ava-databases-scan (on ava-base) — SCAN lane for asset_type == "database".
# Bounded, READ-ONLY DB service discovery: version/enum/exposure. Every tool is
# installed via apt / pipx / PREBUILT RELEASE BINARY (never slow from-source).
# Engine invocation:  docker run --rm ava-databases-scan "<tool> <args>"
FROM ava-base:latest

ENV WORDLISTS=/wordlists

# ---- apt scan tools (ONE layer, non-fatal per-pkg + cleanup). ----
#   nmap               : DB-NSE info scripts + ssl-cert (port/version discovery)
#   default-mysql-client, postgresql-client, redis-tools : banner + no-auth probes
#   sslscan            : DB-port TLS audit
#   tnscmd10g          : Oracle TNS listener version probe
#   curl (base)        : Elasticsearch http probe (no extra tool needed)
RUN apt-get update \
 && for p in \
      nmap default-mysql-client postgresql-client redis-tools sslscan \
      tnscmd10g freetds-bin ; do \
      apt-get install -y "$p" || echo "skip apt:$p" ; \
    done \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- pipx scan tools (-> /usr/local/bin). Non-fatal (prebuilt wheels). ----
#   impacket : mssqlclient.py (MSSQL blank-sa banner probe)
#   cqlsh    : Cassandra CQL release_version probe
RUN pipx install impacket || echo "skip pipx:impacket" ; \
    pipx install cqlsh || echo "skip pipx:cqlsh" ; \
    true

# ---- PREBUILT release binaries (no compile). Non-fatal per tool. ----
#   odat    : Oracle SID enumeration — quentinhardy/odat ships a standalone linux tar.gz
#   mongosh : MongoDB shell — MongoDB ships a linux x64 tgz
RUN set +e ; \
    ourl=$(curl -fsSL https://api.github.com/repos/quentinhardy/odat/releases/latest \
           | jq -r '.assets[].browser_download_url' | grep -iE 'linux.*\.tar\.gz$' | head -1) ; \
    [ -n "$ourl" ] && curl -fsSL "$ourl" -o /tmp/odat.tgz \
      && mkdir -p /opt/odat && tar -xzf /tmp/odat.tgz -C /opt/odat --strip-components=1 \
      && ln -sf "$(find /opt/odat -name 'odat*' -type f -perm -u+x | head -1)" /usr/local/bin/odat \
      && rm -f /tmp/odat.tgz && echo "ok prebuilt:odat" || echo "skip prebuilt:odat" ; \
    murl=$(curl -fsSL https://www.mongodb.com/try/download/shell 2>/dev/null \
           | grep -oiE 'https://[^"]*mongosh-[0-9.]+-linux-x64\.tgz' | head -1) ; \
    [ -z "$murl" ] && murl="https://downloads.mongodb.com/compass/mongosh-2.3.1-linux-x64.tgz" ; \
    curl -fsSL "$murl" -o /tmp/mongosh.tgz \
      && tar -xzf /tmp/mongosh.tgz -C /opt \
      && ln -sf "$(find /opt -name mongosh -type f -perm -u+x | head -1)" /usr/local/bin/mongosh \
      && rm -f /tmp/mongosh.tgz && echo "ok prebuilt:mongosh" || echo "skip prebuilt:mongosh" ; \
    true

RUN mkdir -p /wordlists /work && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache
WORKDIR /work

ENTRYPOINT ["/bin/bash","-lc"]
CMD ["echo 'ava-databases-scan ready'; command -v nmap mysql psql redis-cli sslscan mssqlclient.py mongosh tnscmd10g odat cqlsh 2>/dev/null; true"]
