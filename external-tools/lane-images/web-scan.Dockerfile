# ava-web-scan — SCAN lane image (Find / discovery / DAST) for AVA
# Base image already pulled on host. Single stage by design; nothing pinned beyond the base tag.
# Engine invocation: docker run --rm ava-web-scan "<tool> <args>"
FROM kalilinux/kali-rolling:latest

ENV DEBIAN_FRONTEND=noninteractive \
    GOBIN=/usr/local/bin \
    GOPATH=/root/go \
    GOFLAGS=-buildvcs=false \
    PIPX_HOME=/opt/pipx \
    PIPX_BIN_DIR=/usr/local/bin \
    PATH=/usr/local/bin:/root/go/bin:/usr/local/go/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    WORDLISTS=/wordlists

# 1) Base runtimes / build deps (FATAL — everything below needs these).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv pipx \
      golang-go ruby ruby-dev default-jdk-headless \
      git curl wget unzip build-essential libpcap-dev \
      chromium jq ca-certificates \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# 2) Scan tools Kali ships in apt (preferred — most reliable install).
#    Rock-solid core set is fatal; the rest install one-per-package so a
#    single missing/renamed package can never abort the whole build.
#    nmap + sqlmap are PRIMARY web finders the engine calls directly (_lane_find_container
#    nmap sweep, sqlmap on injectable params) — they MUST be present, so they are core/fatal.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nmap sqlmap zaproxy nikto whatweb wfuzz dirb sslscan \
 && for p in wapiti feroxbuster gobuster dirsearch amass wpscan \
             wafw00f sslyze arjun gitleaks testssl.sh cewl joomscan ; do \
      apt-get install -y --no-install-recommends "$p" || echo "skip apt:$p" ; \
    done \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
# ARM-WEB-BINARIES: cewl (site->wordlist crawler, feeds content-discovery) + joomscan (Joomla scanner) are
# Kali apt pkgs added to the loop above. x8/kiterunner are NOT apt pkgs (they silently skipped before) — see
# the prebuilt-binary step below. wpscan ships WITHOUT its vuln db and the engine runs --no-update, so bake
# the free db now (-> ~/.cache/wpscan/db); vulnerable-plugin enum still needs a WPSCAN_API_TOKEN at runtime.
RUN wpscan --update --no-banner >/dev/null 2>&1 && echo "wpscan-db ok" || echo "skip:wpscan-db"

# 2b) Prebuilt Go-tool binaries the engine calls as PRIMARY finders (nuclei = CVE/misconfig sweep,
#     dalfox = XSS, ffuf = content discovery). Prebuilt releases avoid go-compile OOM on a 2GB box.
#     Each non-fatal so one bad release URL can't zero the image. nuclei TEMPLATES are NOT baked here —
#     the engine mounts the host's shared /opt/nuclei-templates read-only and passes `-t` at run time.
RUN set +e; cd /tmp; \
  curl -sSL -o nuclei.zip https://github.com/projectdiscovery/nuclei/releases/download/v3.11.1/nuclei_3.11.1_linux_amd64.zip \
    && unzip -o nuclei.zip nuclei -d /usr/local/bin && echo "nuclei ok" || echo "skip:nuclei"; \
  curl -sSL -o ffuf.tgz https://github.com/ffuf/ffuf/releases/download/v2.1.0/ffuf_2.1.0_linux_amd64.tar.gz \
    && tar -xzf ffuf.tgz -C /usr/local/bin ffuf && echo "ffuf ok" || echo "skip:ffuf"; \
  curl -sSL -o dalfox.tgz https://github.com/hahwul/dalfox/releases/download/v2.9.2/dalfox_2.9.2_linux_amd64.tar.gz \
    && tar -xzf dalfox.tgz -C /usr/local/bin dalfox && echo "dalfox ok" || echo "skip:dalfox"; \
  chmod +x /usr/local/bin/nuclei /usr/local/bin/ffuf /usr/local/bin/dalfox 2>/dev/null; \
  rm -f /tmp/nuclei.zip /tmp/ffuf.tgz /tmp/dalfox.tgz; true

# 2c) ARM-WEB-BINARIES prebuilt binaries: kiterunner (`kr`, API-route discovery — assetnote, NOT a Kali apt
#     pkg) + x8 (hidden-parameter discovery, Rust). API-driven asset pick so a version bump can't break the
#     URL; x8's linux asset is a PLAIN gzip of the binary. Each non-fatal.
RUN set +e; cd /tmp; \
  url="$(curl -fsSL https://api.github.com/repos/assetnote/kiterunner/releases/latest \
          | jq -r '.assets[].browser_download_url' | grep -iE 'linux_amd64\.tar\.gz$' | head -1)"; \
  [ -n "$url" ] && curl -sSL -o kr.tgz "$url" && tar -xzf kr.tgz -C /usr/local/bin kr \
    && chmod +x /usr/local/bin/kr && echo "kr ok" || echo "skip:kiterunner"; \
  url="$(curl -fsSL https://api.github.com/repos/Sh1Yo/x8/releases/latest \
          | jq -r '.assets[].browser_download_url' | grep -iE 'linux' | grep -vi musl | grep -vi window | head -1)"; \
  if [ -n "$url" ]; then curl -sSL -o x8.dl "$url"; \
    case "$url" in \
      *.tar.gz|*.tgz) tar -xzf x8.dl -C /tmp && b="$(find /tmp -maxdepth 3 -type f -name 'x8*' ! -name '*.dl' | head -1)" && [ -n "$b" ] && cp "$b" /usr/local/bin/x8 ;; \
      *.gz) gunzip -c x8.dl > /usr/local/bin/x8 ;; \
      *) cp x8.dl /usr/local/bin/x8 ;; \
    esac; \
    chmod +x /usr/local/bin/x8 2>/dev/null && echo "x8 ok" || echo "skip:x8"; fi; \
  rm -f /tmp/kr.tgz /tmp/x8.dl; true

# 3) Go-native probe / crawl / discovery tools (vetted `go install`, GOBIN=/usr/local/bin).
#    Each non-fatal so one module-fetch hiccup can't zero the image.
RUN set +e ; for m in \
      github.com/projectdiscovery/httpx/cmd/httpx@latest \
      github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest \
      github.com/projectdiscovery/dnsx/cmd/dnsx@latest \
      github.com/projectdiscovery/naabu/v2/cmd/naabu@latest \
      github.com/projectdiscovery/katana/cmd/katana@latest \
      github.com/projectdiscovery/urlfinder/cmd/urlfinder@latest \
      github.com/lc/gau/v2/cmd/gau@latest \
      github.com/tomnomnom/waybackurls@latest \
      github.com/jaeles-project/gospider@latest \
      github.com/hakluke/hakrawler@latest \
      github.com/edoardottt/cariddi/cmd/cariddi@latest \
      github.com/rverton/webanalyze/cmd/webanalyze@latest \
      github.com/sensepost/gowitness@latest \
      github.com/jaeles-project/jaeles@latest ; do \
      go install -v "$m" || echo "skip go:$m" ; \
    done ; \
    rm -rf /root/go/pkg /root/.cache/go-build ; true

# 4) pipx tools (PEP668 — pipx drops binaries into /usr/local/bin). Non-fatal.
RUN pipx install waymore || echo "skip pipx:waymore" ; \
    pipx install "git+https://github.com/devanshbatham/ParamSpider" || echo "skip pipx:ParamSpider" ; \
    true
# ARM-WEB-BINARIES: graphw00f (GraphQL engine fingerprint). The pipx git install silently failed; git-clone +
# system pip + a thin PATH wrapper (the humble/linkfinder pattern that DOES land). Non-fatal.
RUN ( git clone --depth 1 https://github.com/dolevf/graphw00f /opt/graphw00f \
      && pip install --break-system-packages -r /opt/graphw00f/requirements.txt 2>/dev/null || true \
      && printf '#!/bin/bash\nexec python3 /opt/graphw00f/main.py "$@"\n' > /usr/local/bin/graphw00f \
      && chmod +x /usr/local/bin/graphw00f ) || echo "skip git:graphw00f"

# 5) git-clone script tools + thin PATH wrappers. All non-fatal.
RUN ( git clone --depth 1 https://github.com/m4ll0k/SecretFinder /opt/SecretFinder \
      && pip install --break-system-packages jsbeautifier requests lxml \
      && printf '#!/bin/bash\nexec python3 /opt/SecretFinder/SecretFinder.py "$@"\n' > /usr/local/bin/secretfinder \
      && chmod +x /usr/local/bin/secretfinder ) || echo "skip git:SecretFinder" ; \
    ( git clone --depth 1 https://github.com/GerbenJavado/LinkFinder /opt/LinkFinder \
      && pip install --break-system-packages -r /opt/LinkFinder/requirements.txt \
      && printf '#!/bin/bash\nexec python3 /opt/LinkFinder/linkfinder.py "$@"\n' > /usr/local/bin/linkfinder \
      && chmod +x /usr/local/bin/linkfinder ) || echo "skip git:LinkFinder" ; \
    ( git clone --depth 1 https://github.com/rfc-st/humble /opt/humble \
      && pip install --break-system-packages -r /opt/humble/requirements.txt \
      && printf '#!/bin/bash\nexec python3 /opt/humble/humble.py "$@"\n' > /usr/local/bin/humble \
      && chmod +x /usr/local/bin/humble ) || echo "skip git:humble" ; \
    true

# 6) trufflehog (core secrets scanner; vetted install script → /usr/local/bin). Non-fatal.
RUN curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh \
      | sh -s -- -b /usr/local/bin || echo "skip trufflehog" ; true

# Wordlists (SecLists / rockyou) are mounted READ-ONLY at runtime — never baked in.
VOLUME ["/wordlists"]

ENTRYPOINT ["/bin/bash","-lc"]
CMD ["echo 'ava-web-scan ready'; command -v httpx subfinder katana nikto zaproxy wapiti 2>/dev/null; true"]