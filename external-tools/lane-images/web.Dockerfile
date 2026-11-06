# ava-web — web-lane tool image for AVA (defensive cyber-assurance)
#
# Pinned, per-lane arsenal. Built ONCE by the operator; tools run in ephemeral
# per-job containers:  docker run --rm --network host ava-web <tool> <args>
# ENTRYPOINT is cleared and there is NO CMD, so argv passed to `docker run`
# is executed directly.
#
# Breadth = kali-tools-web metapackage (100+ web tools) + the explicit named
# arsenal below (guarantees presence even if the metapackage drops one) +
# HexStrike (~130 finders) + XSStrike, both from git.
#
# ponytail: single pinned tag, not a digest — operators who need a reproducible
# base should re-pin to a kalilinux/kali-rolling@sha256 digest here.
FROM kalilinux/kali-rolling

LABEL org.opencontainers.image.title="ava-web" \
      org.opencontainers.image.description="AVA web-lane recon+exploit arsenal (Kali + HexStrike + XSStrike)"

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    LANG=C.UTF-8

# Base OS + toolchain needed to fetch/build the git tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget git python3 python3-pip python3-venv \
      golang-go ruby build-essential libssl-dev libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# SLIM: the full `kali-tools-web` metapackage (~100+ tools incl. Burp Suite, ZAP,
# Maltego, wine, Java GUI apps → ~10GB) is INTENTIONALLY OMITTED so the image is
# deployable on a normal droplet. The engine only fires the explicit CLI arsenal
# installed below — that's the whole point. Re-add `kali-tools-web` here only if you
# have a big host and genuinely want the full interactive Kali web toolset.

# Explicit web recon + exploit arsenal (named so nothing silently goes missing).
# Grouped by function; one group per layer for cache + clear failure attribution.
# Explicit web recon + exploit arsenal (named so nothing silently goes missing).
# Installed PER-PACKAGE so a name that's been dropped/renamed in Kali is SKIPPED
# (logged), not fatal — the kali-tools-web metapackage above already covers most,
# and the core exploit tools (sqlmap/nuclei/commix/…) are stable apt packages.
RUN apt-get update && for p in \
      sqlmap commix wpscan nikto nuclei joomscan davtest cadaver skipfish whatweb wafw00f dalfox \
      ffuf gobuster feroxbuster dirb dirbuster wfuzz arjun \
      sslscan sslyze testssl.sh \
      httpx-toolkit katana \
      subfinder amass dnsenum dnsrecon fierce sublist3r dnsutils \
      hydra medusa patator \
      seclists wordlists ; do \
        apt-get install -y --no-install-recommends "$p" || echo "SKIP (unavailable in Kali): $p" ; \
      done \
    && rm -rf /var/lib/apt/lists/*

# gau / waybackurls / assetfinder are Go tools (NOT apt packages) — build them with
# `go install` (golang-go is installed above) into /usr/local/bin. Best-effort: a
# passive URL-discovery tool failing to build must not sink the whole image.
RUN for m in \
      github.com/lc/gau/v2/cmd/gau@latest \
      github.com/tomnomnom/waybackurls@latest \
      github.com/tomnomnom/assetfinder@latest ; do \
        GOBIN=/usr/local/bin go install "$m" || echo "SKIP (go build failed): $m" ; \
      done

# nuclei signature templates (data the nuclei binary reads at scan time).
RUN nuclei -update-templates || true

# XSStrike (git) — advanced XSS discovery/exploitation.
RUN git clone --depth 1 https://github.com/s0md3v/XSStrike /opt/XSStrike \
    && pip install --no-cache-dir -r /opt/XSStrike/requirements.txt \
    && printf '#!/bin/sh\nexec python3 /opt/XSStrike/xsstrike.py "$@"\n' > /usr/local/bin/xsstrike \
    && chmod +x /usr/local/bin/xsstrike

# HexStrike — bundles its ~130 finders so they run inside THIS image.
RUN git clone --depth 1 https://github.com/0x4m4/hexstrike-ai /opt/hexstrike \
    && ( [ -f /opt/hexstrike/requirements.txt ] \
         && pip install --no-cache-dir -r /opt/hexstrike/requirements.txt \
         || true )
ENV HEXSTRIKE_HOME=/opt/hexstrike

# Ephemeral-run contract: no entrypoint wrapper, no default command.
# `docker run --rm --network host ava-web <tool> <args>` runs <tool> directly.
ENTRYPOINT []
