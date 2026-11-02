# ava-repo-scan (CANONICAL, on ava-base) — SCAN lane for asset_type == "repos".
# This is THE repo-scan image. It REPLACES the old kitchen-sink from-base (a huge
# `go install`/cargo/dotnet-from-source build that timed the image build out) and
# the repo-scan.rich/.trimmed variants (fold them in — delete those files).
#
# Every wired tool in repo_scan_tools.REPO_SCAN_TOOLS ships here via a PREBUILT
# RELEASE BINARY or a wheel (fast, no from-source compile). Open-source only; NO
# API key needed for core depth (snyk is the one commercial tool, dormant until a
# SNYK_TOKEN is injected). Nessus-equivalent coverage, offline at scan time:
#   secrets:  gitleaks, trufflehog, detect-secrets, noseyparker
#   SAST:     semgrep, bandit, gosec
#   mobile:   mobsfscan (OWASP, Android Java/Kotlin + iOS Swift/Obj-C) + jadx (.apk decompile)
#   SCA/SBOM: trivy, grype, syft, osv-scanner, pip-audit
#   IaC/CI:   checkov, kics (pinned last-binary release), actionlint
#   container:hadolint (Dockerfile lint)
#   commercial SCA (gated): snyk
#
# OFFLINE CONTRACT (the droplet has no scan-time network — downloads fail on
# storage): the three network-hungry engines get their data BAKED at build time:
#   - Trivy vuln DB -> /opt/trivy-cache  (scan uses --cache-dir + --skip-db-update)
#   - Semgrep rules -> /opt/semgrep-rules (scan uses --config /opt/semgrep-rules)
#   - Grype vuln DB -> /opt/grype-cache  (ENV GRYPE_DB_AUTO_UPDATE=false)
# osv-scanner queries osv.dev over HTTP (no offline DB in this build) so it
# honest-skips air-gapped — trivy+grype carry the SCA class offline.
#
# SKIPPED (prebuilt exists but cannot run usefully in this flow — recorded, not faked):
#   - dependency-check: needs an NVD_API_KEY (NVD retired the free bulk feed; a
#     keyless first run rate-limits for hours). grype/trivy/osv already give SCA.
#   - spotbugs: operates on COMPILED bytecode (.class/.jar); this lane clones
#     SOURCE with no build step, so it can never produce a finding on our inputs.
# Every install is non-fatal so one broken upstream never aborts the image.
# Engine invocation (inherited from ava-base): docker run --rm ava-repo-scan "<tool> <args>"
FROM ava-base:latest

ENV WORDLISTS=/wordlists

# ---- vendor install scripts: grype+syft (Anchore), trufflehog (v3), gosec.
#      All ship prebuilt release binaries; fast; each guarded non-fatal. ----
RUN ( curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin ) || echo "skip bin:grype" ; \
    ( curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh  | sh -s -- -b /usr/local/bin ) || echo "skip bin:syft" ; \
    ( curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin ) || echo "skip bin:trufflehog" ; \
    ( curl -sSfL https://raw.githubusercontent.com/securego/gosec/master/install.sh | sh -s -- -b /usr/local/bin ) || echo "skip bin:gosec" ; \
    true

# ---- GitHub-release binaries via API (no go toolchain): gitleaks, trivy,
#      osv-scanner, actionlint. Each resolves the latest linux/amd64 asset then
#      extracts the binary to /usr/local/bin. Non-fatal per tool. ----
RUN ( u=$(curl -fsSL https://api.github.com/repos/gitleaks/gitleaks/releases/latest | grep -o 'https://[^" ]*linux_x64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin gitleaks ) || echo "skip bin:gitleaks" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/aquasecurity/trivy/releases/latest | grep -o 'https://[^" ]*Linux-64bit.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin trivy ) || echo "skip bin:trivy" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/google/osv-scanner/releases/latest | grep -o 'https://[^" ]*linux_amd64' | sort -u | head -1) \
        && curl -fsSL "$u" -o /usr/local/bin/osv-scanner && chmod +x /usr/local/bin/osv-scanner ) || echo "skip bin:osv-scanner" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/rhysd/actionlint/releases/latest | grep -o 'https://[^" ]*linux_amd64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin actionlint ) || echo "skip bin:actionlint" ; \
    rm -rf /tmp/* ; true

# ---- kics: pin v2.1.20 — the LAST release that ships a linux binary (Checkmarx
#      stopped attaching them after; asset is `linux_amd64`). The release tarball
#      ships ONLY the binary — its query library lives in the repo, so we fetch
#      assets/queries from the SOURCE TAG tarball too. kics scan needs -q <queries>,
#      so a scan-aware wrapper injects it (leaving e.g. `version` untouched).
#      Verified live: scan -> valid JSON with the `queries` schema the parser
#      consumes. Non-fatal. ----
RUN ( mkdir -p /opt/kics-dist \
      && curl -fsSL "https://github.com/Checkmarx/kics/releases/download/v2.1.20/kics_2.1.20_linux_amd64.tar.gz" \
        | tar -xz -C /opt/kics-dist \
      && curl -fsSL "https://github.com/Checkmarx/kics/archive/refs/tags/v2.1.20.tar.gz" \
        | tar -xz -C /opt kics-2.1.20/assets/queries \
      && KB=$(find /opt/kics-dist -name kics -type f | head -1) \
      && KQD=/opt/kics-2.1.20/assets/queries \
      && printf '#!/bin/sh\nif [ "$1" = "scan" ]; then exec %s "$@" -q %s; fi\nexec %s "$@"\n' "$KB" "$KQD" "$KB" > /usr/local/bin/kics \
      && chmod +x /usr/local/bin/kics ) || echo "skip bin:kics" ; true

# ---- noseyparker: Praetorian secret scanner, prebuilt release binary. It is
#      datastore-based (scan -> report); the parser drives the two-step argv, so
#      the binary is all that is needed here. Non-fatal. ----
RUN ( u=$(curl -fsSL https://api.github.com/repos/praetorian-inc/noseyparker/releases/latest \
            | grep -o 'https://[^" ]*x86_64-unknown-linux-gnu[^" ]*tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /tmp \
        && f=$(find /tmp -name noseyparker -type f | head -1) && install -m755 "$f" /usr/local/bin/noseyparker ) \
    || echo "skip bin:noseyparker" ; \
    rm -rf /tmp/* ; true

# ---- hadolint: single static Dockerfile-security linter binary. ----
RUN ( curl -fsSL "https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64" \
        -o /usr/local/bin/hadolint && chmod +x /usr/local/bin/hadolint ) || echo "skip bin:hadolint" ; true

# ---- snyk: static standalone CLI binary (no nodejs). Dormant until SNYK_TOKEN. ----
RUN ( curl -fsSL https://static.snyk.io/cli/latest/snyk-linux -o /usr/local/bin/snyk \
        && chmod +x /usr/local/bin/snyk ) || echo "skip bin:snyk" ; true

# ---- pipx python tools (PEP668 -> /usr/local/bin via base ENV). semgrep is core;
#      mobsfscan is the MOBILE SAST (OWASP MobSF's lightweight CLI — NOT the heavy
#      MobSF Django server; semgrep-based, rules bundled in the wheel so it runs
#      offline with no server/key). PINNED for reproducible offline builds. All
#      ship wheels so no compiler needed. Non-fatal per tool. ----
RUN for t in semgrep detect-secrets bandit pip-audit checkov ; do \
      pipx install "$t" || echo "skip pipx:$t" ; \
    done ; \
    rm -rf /root/.cache ; true

# ---- mobsfscan (MOBILE SAST): its pydantic-core wheel cannot build on the base image's
#      Python 3.14 (PyO3 maxes at 3.13), so install it under a uv-managed Python 3.12 and
#      symlink the shim onto PATH. OWASP MobSF lightweight CLI; rules bundled; offline. ----
RUN ( curl -LsSf https://astral.sh/uv/install.sh | sh \
        && export PATH="/root/.local/bin:$PATH" \
        && uv venv --python 3.12 /opt/mobsf \
        && uv pip install --python /opt/mobsf/bin/python mobsfscan==0.4.5 \
        && ln -sf /opt/mobsf/bin/mobsfscan /usr/local/bin/mobsfscan \
        && /usr/local/bin/mobsfscan --version && echo MOBSF_OK ) || echo "MOBSF_FAILED" ; true

# ---- jadx (MOBILE): Android APK/DEX -> Java decompiler. The mobsfscan scan spec
#      uses it to recover source from a committed .apk before scanning (mobsfscan
#      is source-only). Prebuilt release zip (JDK is already in ava-base); unzipped
#      with python3 stdlib (no apt). Pinned; lean (~90MB); non-fatal. ----
RUN ( curl -fsSL -o /tmp/jadx.zip https://github.com/skylot/jadx/releases/download/v1.5.0/jadx-1.5.0.zip \
        && mkdir -p /opt/jadx && python3 -m zipfile -e /tmp/jadx.zip /opt/jadx \
        && chmod +x /opt/jadx/bin/jadx \
        && ln -sf /opt/jadx/bin/jadx /usr/local/bin/jadx \
        && rm -f /tmp/jadx.zip ) || echo "skip bin:jadx" ; true

# ---- CI/CD + k8s/IaC prebuilt release binaries (arm-repo: CI/CD + mobile priority).
#      All OFFLINE static analyzers (no scan-time network): poutine (GH/GitLab pipeline
#      SAST), zizmor (GitHub Actions auditor, run with --offline), kube-linter / kubesec
#      / polaris (k8s manifest security), conftest (OPA/Rego — baked policy bundle below).
#      GitHub-release binaries resolved via the API; non-fatal per tool. ----
RUN ( u=$(curl -fsSL https://api.github.com/repos/boostsecurityio/poutine/releases/latest | grep -o 'https://[^" ]*Linux_x86_64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin poutine ) || echo "skip bin:poutine" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/woodruffw/zizmor/releases/latest | grep -o 'https://[^" ]*x86_64-unknown-linux-gnu.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /tmp && f=$(find /tmp -name zizmor -type f | head -1) && install -m755 "$f" /usr/local/bin/zizmor ) || echo "skip bin:zizmor" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/stackrox/kube-linter/releases/latest | grep -o 'https://[^" ]*kube-linter-linux.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin kube-linter ) || echo "skip bin:kube-linter" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/controlplaneio/kubesec/releases/latest | grep -o 'https://[^" ]*linux_amd64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin kubesec ) || echo "skip bin:kubesec" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/FairwindsOps/polaris/releases/latest | grep -o 'https://[^" ]*linux_amd64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin polaris ) || echo "skip bin:polaris" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/open-policy-agent/conftest/releases/latest | grep -o 'https://[^" ]*Linux_x86_64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin conftest ) || echo "skip bin:conftest" ; \
    rm -rf /tmp/* ; true

# ---- conftest default OPA/Rego policy bundle. conftest ships NO policies (with none it
#      finds nothing); this small generic k8s/container baseline makes it produce real
#      findings out of the box. The scan points conftest at the whole dir, so an owner
#      can drop house-rule .rego beside it. ----
COPY lane-images/conftest-policies /opt/conftest-policies

# ---- pipx python tools: gato-x (CI/CD self-hosted-runner/injection abuse — GH_TOKEN-gated,
#      honest-skips without a token), apkleaks + apkid (MOBILE — secrets/endpoints and
#      packer/obfuscator ID inside a built .apk; complement mobsfscan's source scan),
#      (octoscan is a Go project — built from source below, NOT pipx; `go install`
#      fails on its go.mod replace directives, and it is not a Python package.)
#      Non-fatal per tool. ----
RUN for t in gato-x apkleaks apkid ; do pipx install "$t" || echo "skip pipx:$t" ; done ; \
    rm -rf /root/.cache ; true
# ---- octoscan — GitHub Actions OFFLINE scanner, built from a clone (no release binary;
#      go.mod replace directives break `go install`, so clone + `go build`). Non-fatal. ----
RUN ( git clone --depth 1 https://github.com/synacktiv/octoscan /tmp/octoscan \
        && cd /tmp/octoscan \
        && ( go build -o /usr/local/bin/octoscan . || go build -o /usr/local/bin/octoscan ./cmd/octoscan ) \
        && chmod +x /usr/local/bin/octoscan ) || echo "skip gobuild:octoscan" ; \
    rm -rf /tmp/octoscan /root/go/pkg ; true

# ---- OFFLINE DATA BAKE (so the air-gapped droplet never fetches at scan time).
#      These ENV vars make trivy/grype read the baked caches and refuse to
#      network-update (GRYPE_DB_VALIDATE_AGE=false so a weeks-old baked DB still
#      scans instead of erroring "database is too old"). ----
ENV TRIVY_CACHE_DIR=/opt/trivy-cache \
    GRYPE_DB_CACHE_DIR=/opt/grype-cache \
    GRYPE_DB_AUTO_UPDATE=false \
    GRYPE_DB_VALIDATE_AGE=false
RUN mkdir -p /opt/trivy-cache /opt/grype-cache ; \
    # Trivy vuln DB -> /opt/trivy-cache (download-only; no scan). Main DB only — the
    # Java DB is ~1GB and source repos rarely ship jars (scan passes --skip-java-db-update).
    ( trivy --cache-dir /opt/trivy-cache image --download-db-only ) || echo "skip bake:trivy-db" ; \
    # Grype vuln DB -> /opt/grype-cache.
    ( grype db update ) || echo "skip bake:grype-db" ; \
    # Semgrep community rules -> /opt/semgrep-rules (scan runs --config /opt/semgrep-rules offline). The
    # full clone INCLUDES the mobile language dirs (kotlin/ swift/ java/ android), so semgrep also covers
    # Kotlin/Swift/Android source — complementary to mobsfscan's mobile-specific rules.
    ( git clone --depth 1 https://github.com/semgrep/semgrep-rules /opt/semgrep-rules \
        && rm -rf /opt/semgrep-rules/.git ) || echo "skip bake:semgrep-rules" ; \
    rm -rf /tmp/* ; true

RUN mkdir -p /wordlists /work
WORKDIR /work

# ENTRYPOINT inherited from ava-base; restated for the invocation contract.
ENTRYPOINT ["/bin/bash","-lc"]
CMD ["echo 'ava-repo-scan ready'; command -v gitleaks trufflehog semgrep trivy grype syft osv-scanner detect-secrets bandit gosec pip-audit checkov kics actionlint snyk noseyparker hadolint mobsfscan jadx poutine zizmor octoscan gato-x apkleaks apkid kube-linter kubesec polaris conftest 2>/dev/null; echo '--- offline data:'; ls -d /opt/semgrep-rules /opt/trivy-cache /opt/grype-cache /opt/conftest-policies 2>/dev/null; true"]
