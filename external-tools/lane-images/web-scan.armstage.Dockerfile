# ava-web-scan:armstage — DELTA on the built scan image. Adds the 5 scan binaries that were
# MISSING from ava-web-scan:latest (verified 2026-10-10): cewl, graphw00f, joomscan, kiterunner (kr), x8.
# ffuf + wpscan are ALREADY in :latest (wired without an image change). STAGING ONLY — never :latest.
# Build: flock -w 2400 /tmp/ava-docker-build.lock docker build -f web-scan.armstage.Dockerfile -t ava-web-scan:armstage .
FROM ava-web-scan:latest

ENV DEBIAN_FRONTEND=noninteractive

# 1) Kali apt tools (cewl = site->wordlist crawler; joomscan = Joomla scanner). Non-fatal per-pkg.
RUN apt-get update \
 && for p in cewl joomscan; do apt-get install -y --no-install-recommends "$p" || echo "skip apt:$p"; done \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# 2) graphw00f — GraphQL engine fingerprint. The pipx install in the base Dockerfile silently failed;
#    git-clone + system pip + a thin PATH wrapper (the humble/linkfinder pattern that DOES land). Non-fatal.
RUN ( git clone --depth 1 https://github.com/dolevf/graphw00f /opt/graphw00f \
      && pip install --break-system-packages -r /opt/graphw00f/requirements.txt 2>/dev/null || true \
      && printf '#!/bin/bash\nexec python3 /opt/graphw00f/main.py "$@"\n' > /usr/local/bin/graphw00f \
      && chmod +x /usr/local/bin/graphw00f ) || echo "skip git:graphw00f"

# 3) kiterunner (`kr`) — API route discovery. NOT a Kali apt pkg; prebuilt release binary (avoids go-compile
#    OOM on the shared box). API-driven asset pick so a version bump can't break the URL. Non-fatal.
RUN set +e; cd /tmp; \
    url="$(curl -fsSL https://api.github.com/repos/assetnote/kiterunner/releases/latest \
            | jq -r '.assets[].browser_download_url' | grep -iE 'linux_amd64\.tar\.gz$' | head -1)"; \
    [ -n "$url" ] && curl -sSL -o kr.tgz "$url" && tar -xzf kr.tgz -C /usr/local/bin kr \
      && chmod +x /usr/local/bin/kr && echo "kr ok" || echo "skip:kiterunner"; \
    rm -f /tmp/kr.tgz; true

# 4) x8 — hidden-parameter discovery (Rust). Prebuilt release binary; API-driven asset pick (linux, not musl).
#    The Sh1Yo/x8 linux asset is a PLAIN gzip of the binary (x86_64-linux-x8.gz), so handle .gz (gunzip),
#    .tar.gz/.tgz (tar), and a raw binary distinctly. Non-fatal.
RUN set +e; cd /tmp; \
    url="$(curl -fsSL https://api.github.com/repos/Sh1Yo/x8/releases/latest \
            | jq -r '.assets[].browser_download_url' | grep -iE 'linux' | grep -vi musl | grep -vi window | head -1)"; \
    if [ -n "$url" ]; then \
      curl -sSL -o x8.dl "$url"; \
      case "$url" in \
        *.tar.gz|*.tgz) tar -xzf x8.dl -C /tmp && bin="$(find /tmp -maxdepth 3 -type f -name 'x8*' ! -name '*.dl' | head -1)" \
                          && [ -n "$bin" ] && cp "$bin" /usr/local/bin/x8 ;; \
        *.gz) gunzip -c x8.dl > /usr/local/bin/x8 ;; \
        *) cp x8.dl /usr/local/bin/x8 ;; \
      esac; \
      chmod +x /usr/local/bin/x8 2>/dev/null && /usr/local/bin/x8 --help >/dev/null 2>&1 && echo "x8 ok" || echo "skip:x8"; \
    else echo "skip:x8 no-asset"; fi; \
    rm -f /tmp/x8.dl; true

# 5) WPScan vulnerability DB. wpscan is already in ava-web-scan:latest but ships WITHOUT its db, and the
#    runtime uses --no-update (no per-run fetch, which would blow the budget), so a scan ABORTS with
#    "database file is missing". Bake the free db at build; now --no-update runs against it. Non-fatal.
RUN wpscan --update --no-banner >/dev/null 2>&1 && echo "wpscan-db ok" || echo "skip:wpscan-db"

# verify what landed (printed at build end; the engine still honest-skips any that didn't)
RUN echo "=== armstage tool check ===" ; \
    for t in cewl joomscan graphw00f kr x8 ffuf wpscan; do printf '%s: ' "$t"; command -v "$t" || echo MISSING; done; \
    echo -n "x8-runs: "; x8 --help >/dev/null 2>&1 && echo yes || echo no; \
    echo -n "wpscan-db: "; ls -d ~/.cache/wpscan/db 2>/dev/null && echo present || echo missing; true
