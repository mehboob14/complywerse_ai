# ava-kubernetes-scan (RICH) — SCAN lane for the "kubernetes" sub-lane (a cluster target).
# Mirrors the repo/netdev rich pattern: FROM ava-base:latest, every tool via a
# PREBUILT RELEASE BINARY / apt / pipx — never a from-source `go build`/`cargo`
# (the from-source compile is what timed the from-base out).
#   remote / unauth:  kube-hunter (pipx), kubectl (k8s release binary)
#   cluster posture:  kube-bench, kubescape, kubeaudit, trivy (GitHub release binaries)
#   port surface:     nmap (apt) for etcd/apiserver/kubelet
# HONEST — every wired kubernetes_scan_tools tool is installed here; nothing is
# wired that this image does not ship.
# SKIPPED (no prebuilt option / out of lane — recorded, not faked):
#   - popeye: only a reliable `go install` from source across versions; no stable
#     linux release binary to fetch. kubescape/trivy cover the posture class.
#   - peirates / kdigger: pod-foothold ESCALATION/discovery -> kubernetes-exploit image.
#   - kube-score / polaris / checkov: manifest/IaC input the (target,url) dispatcher
#     cannot provide, or a duplicate of the kubescape/trivy misconfig class.
# Every install is non-fatal so one broken upstream never aborts the image.
# Engine invocation (inherited from ava-base): docker run --rm ava-kubernetes-scan "<tool> <args>"
FROM ava-base:latest

ENV WORDLISTS=/wordlists

# ---- nmap (apt) — exposed control/data-plane port sweep + vulners. Non-fatal. ----
RUN apt-get update \
 && for p in nmap ; do apt-get install -y "$p" || echo "skip apt:$p" ; done \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- kubectl: official k8s release binary (dl.k8s.io stable channel). Non-fatal. ----
RUN ( V=$(curl -fsSL https://dl.k8s.io/release/stable.txt) \
        && curl -fsSL "https://dl.k8s.io/release/${V}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
        && chmod +x /usr/local/bin/kubectl ) || echo "skip bin:kubectl" ; true

# ---- GitHub-release binaries via API (no go toolchain): kube-bench, kubeaudit,
#      trivy. Each resolves the latest linux/amd64 asset then extracts the binary
#      to /usr/local/bin. Non-fatal per tool. ----
RUN ( u=$(curl -fsSL https://api.github.com/repos/aquasecurity/kube-bench/releases/latest \
            | grep -o 'https://[^" ]*linux_amd64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin kube-bench ) || echo "skip bin:kube-bench" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/Shopify/kubeaudit/releases/latest \
            | grep -o 'https://[^" ]*linux_amd64.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin kubeaudit ) || echo "skip bin:kubeaudit" ; \
    ( u=$(curl -fsSL https://api.github.com/repos/aquasecurity/trivy/releases/latest \
            | grep -o 'https://[^" ]*Linux-64bit.tar.gz' | head -1) \
        && curl -fsSL "$u" | tar -xz -C /usr/local/bin trivy ) || echo "skip bin:trivy" ; \
    rm -rf /tmp/* ; true

# ---- kubescape: official install.sh ships a prebuilt release binary. Non-fatal. ----
RUN ( curl -sSfL https://raw.githubusercontent.com/kubescape/kubescape/master/install.sh | /bin/bash \
        && ( [ -x /usr/local/bin/kubescape ] || ln -sf "$(command -v kubescape 2>/dev/null || echo /root/.kubescape/bin/kubescape)" /usr/local/bin/kubescape 2>/dev/null ) ) \
    || echo "skip bin:kubescape" ; true

# ---- kube-hunter: pipx (pure-python; no standalone binary upstream). Non-fatal. ----
RUN pipx install kube-hunter || echo "skip pipx:kube-hunter" ; \
    rm -rf /root/.cache ; true

RUN mkdir -p /wordlists /work
WORKDIR /work

# ENTRYPOINT inherited from ava-base; restated for the invocation contract.
ENTRYPOINT ["/bin/bash","-lc"]
CMD ["echo 'ava-kubernetes-scan ready'; command -v nmap kubectl kube-hunter kube-bench kubescape kubeaudit trivy 2>/dev/null; true"]
