// ComplyVerse Compliance Agent — a single static binary that runs on a customer host,
// collects the up-front discovery inventory LOCALLY (OS, software, network,
// basic hardware) and sends it to the cloud. For machines we can't reach over
// the network or where the client won't share credentials.
//
// stdlib only, except golang.org/x/sys/windows/svc (Windows-only, so the binary
// can run as a real auto-restarting Windows service). Still cross-compiles for
// Windows, Linux and macOS and runs with zero runtime deps on the target.
//
// Config (baked in by the per-download installer, or passed as env):
//
//	COMPLYVERSE_URL     cloud base, e.g. https://app.example.com   (required)
//	COMPLYVERSE_ENROLL  one-time enrollment token               (first run only)
//	COMPLYVERSE_ONCE    "1" => collect+report once and exit (no service loop)
//
// State (the long-lived api_token, after enrollment) persists at:
//
//	linux:   /etc/complyverse-agent/agent.json
//	windows: %ProgramData%\ComplyVerseAgent\agent.json
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const agentVersion = "1.3.0"

type state struct {
	APIToken string `json:"api_token"`
}

func statePath() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "ComplyVerseAgent", "agent.json")
	}
	return "/etc/complyverse-agent/agent.json"
}

func loadState() state {
	var s state
	b, err := os.ReadFile(statePath())
	if err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func saveState(s state) error {
	p := statePath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(p, b, 0o600)
}

// loadConfig reads url/tenant/enroll the installer wrote next to the state file
// and puts them in the process env (only when not already set). A Windows SERVICE
// does NOT reliably inherit Machine env vars set just before it is started, so the
// config file — not the registry — is the dependable source. No-op when absent
// (Linux systemd / macOS launchd bake the env into the unit/plist).
func loadConfig() {
	b, err := os.ReadFile(filepath.Join(filepath.Dir(statePath()), "config.json"))
	if err != nil {
		return
	}
	var c struct{ URL, Tenant, Enroll string }
	if json.Unmarshal(b, &c) != nil {
		return
	}
	setenvIfEmpty("COMPLYVERSE_URL", c.URL)
	setenvIfEmpty("COMPLYVERSE_TENANT", c.Tenant)
	setenvIfEmpty("COMPLYVERSE_ENROLL", c.Enroll)
}

func setenvIfEmpty(k, v string) {
	if v != "" && os.Getenv(k) == "" {
		_ = os.Setenv(k, v)
	}
}

// The cloud is HTTPS: the default transport validates the server cert against the
// system roots (no InsecureSkipVerify anywhere). We pin an explicit TLS 1.2 floor
// so the agent never negotiates a weak protocol — a bank-grade requirement.
var httpc = &http.Client{
	Timeout:   180 * time.Second, // generous for multi-MB datastream downloads
	Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}},
}

func post(url, bearer string, payload any) ([]byte, int, error) {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	// Per-tenant DB routing: the backend resolves which tenant database to use
	// from this header (baked into the installer from the console's tenant).
	if t := os.Getenv("COMPLYVERSE_TENANT"); t != "" {
		req.Header.Set("X-Tenant-Slug", t)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return rb, resp.StatusCode, nil
}

func get(url, bearer string) ([]byte, int, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, 0, err
	}
	if t := os.Getenv("COMPLYVERSE_TENANT"); t != "" {
		req.Header.Set("X-Tenant-Slug", t)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return rb, resp.StatusCode, nil
}

// run executes a command best-effort; "" on any failure (never fatal).
func run(name string, args ...string) string {
	var out bytes.Buffer
	cmd := exec.Command(name, args...)
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return ""
	}
	return strings.TrimSpace(out.String())
}

func osName() string {
	if runtime.GOOS == "windows" {
		if v := run("powershell", "-NoProfile", "-Command",
			"(Get-CimInstance Win32_OperatingSystem).Caption"); v != "" {
			return v
		}
		return run("cmd", "/c", "ver")
	}
	if runtime.GOOS == "darwin" {
		name := run("sw_vers", "-productName")   // "macOS"
		ver := run("sw_vers", "-productVersion") // "14.5"
		if name != "" {
			return strings.TrimSpace(name + " " + ver)
		}
		return "macOS"
	}
	// Linux: PRETTY_NAME from /etc/os-release
	if f, err := os.Open("/etc/os-release"); err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
			}
		}
	}
	return runtime.GOOS
}

// detectDomain reports the machine's AD/DNS domain and whether it is actually
// domain-joined. The backend uses this to refuse enrollment of a PC that isn't
// on the required domain (a leaked install command run on a WORKGROUP/home PC).
func detectDomain() (string, bool) {
	switch runtime.GOOS {
	case "windows":
		// Win32_ComputerSystem.Domain is the AD DNS domain when joined, else the
		// workgroup name; PartOfDomain is the authoritative join flag.
		out := run("powershell", "-NoProfile", "-Command",
			"$cs=Get-CimInstance Win32_ComputerSystem; Write-Output ($cs.Domain + '|' + $cs.PartOfDomain)")
		p := strings.SplitN(out, "|", 2)
		joined := len(p) == 2 && strings.EqualFold(strings.TrimSpace(p[1]), "True")
		return strings.TrimSpace(p[0]), joined
	case "linux":
		// Only an actual realm/AD join counts as part-of-domain.
		if r := run("realm", "list", "--name-only"); r != "" {
			return strings.TrimSpace(strings.Split(r, "\n")[0]), true
		}
		return "", false
	case "darwin":
		// dsconfigad prints the bound AD domain when the Mac is AD-joined.
		for _, line := range strings.Split(run("dsconfigad", "-show"), "\n") {
			if i := strings.Index(line, "="); i >= 0 && strings.Contains(strings.ToLower(line), "domain") {
				if v := strings.TrimSpace(line[i+1:]); v != "" {
					return v, true
				}
			}
		}
		return "", false
	}
	return "", false
}

type sw struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

func software() []sw {
	var list []sw
	if runtime.GOOS == "windows" {
		// Installed programs from the uninstall registry keys.
		out := run("powershell", "-NoProfile", "-Command",
			`Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*,`+
				`HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\* `+
				`| Where-Object {$_.DisplayName} | Select-Object DisplayName,DisplayVersion `+
				`| ForEach-Object {"$($_.DisplayName)|$($_.DisplayVersion)"}`)
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			p := strings.SplitN(line, "|", 2)
			s := sw{Name: p[0]}
			if len(p) == 2 {
				s.Version = p[1]
			}
			list = append(list, s)
		}
		return list
	}
	if runtime.GOOS == "darwin" {
		// Best-effort: Homebrew formulae+casks. No brew → empty list (inventory
		// still reports OS/hardware/network); macOS app enumeration is heavier
		// and left for later.
		if out := run("brew", "list", "--versions"); out != "" {
			for _, line := range strings.Split(out, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				p := strings.SplitN(line, " ", 2)
				s := sw{Name: p[0]}
				if len(p) == 2 {
					s.Version = strings.TrimSpace(p[1])
				}
				list = append(list, s)
			}
		}
		return list
	}
	// Linux: dpkg then rpm.
	if out := run("dpkg-query", "-W", "-f=${Package}\t${Version}\n"); out != "" {
		for _, line := range strings.Split(out, "\n") {
			p := strings.SplitN(line, "\t", 2)
			if p[0] == "" {
				continue
			}
			s := sw{Name: p[0]}
			if len(p) == 2 {
				s.Version = p[1]
			}
			list = append(list, s)
		}
		return list
	}
	if out := run("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}\n"); out != "" {
		for _, line := range strings.Split(out, "\n") {
			p := strings.SplitN(line, "\t", 2)
			if p[0] == "" {
				continue
			}
			s := sw{Name: p[0]}
			if len(p) == 2 {
				s.Version = p[1]
			}
			list = append(list, s)
		}
	}
	return list
}

// primaryIP returns the first non-loopback IPv4, plus all MACs seen.
func netInfo() (string, []string) {
	ip := ""
	var macs []string
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		if i.Flags&net.FlagLoopback != 0 || i.HardwareAddr.String() == "" {
			continue
		}
		macs = append(macs, i.HardwareAddr.String())
		if ip == "" {
			addrs, _ := i.Addrs()
			for _, a := range addrs {
				if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLoopback() {
					ip = ipn.IP.String()
					break
				}
			}
		}
	}
	return ip, macs
}

func collectInventory() (map[string]any, string, string) {
	host, _ := os.Hostname()
	ip, macs := netInfo()
	inv := map[string]any{
		"os": map[string]any{"family": runtime.GOOS, "name": osName(), "arch": runtime.GOARCH},
		"hardware": map[string]any{
			"cpu_count": runtime.NumCPU(),
			"memory":    memInfo(),
		},
		"network": map[string]any{"primary_ip": ip, "macs": macs},
	}
	return inv, host, ip
}

func memInfo() string {
	if runtime.GOOS == "windows" {
		return run("powershell", "-NoProfile", "-Command",
			"[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1).ToString()+' GB'")
	}
	if runtime.GOOS == "darwin" {
		if b := run("sysctl", "-n", "hw.memsize"); b != "" {
			if n, err := strconv.ParseInt(strings.TrimSpace(b), 10, 64); err == nil && n > 0 {
				return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
			}
		}
		return ""
	}
	if f, err := os.Open("/proc/meminfo"); err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			if strings.HasPrefix(sc.Text(), "MemTotal:") {
				return strings.TrimSpace(strings.TrimPrefix(sc.Text(), "MemTotal:"))
			}
		}
	}
	return ""
}

// ─────────────────────────── local recon (ground truth) ─────────────────────
// recon does lightweight LOCAL reconnaissance on the host itself: the listening
// ports with their owning service, plus the installed-package list. The backend
// folds this into platform_properties['recon'] and emits one 'agent:recon'
// register finding per open port. The pentest engine deliberately will NOT
// remote-scan an agent host (it is behind NAT/VPN), so the agent reports ground
// truth and the engine arms from it; the heavy arsenal (nmap/nuclei/…) stays
// server-side — the agent never runs it. Best-effort: a probe that fails just
// contributes nothing and never blocks the report.
func recon(pkgs []sw) map[string]any {
	r := map[string]any{
		"os_family":    runtime.GOOS, // pentest lane routes on this ("windows" -> Windows lane)
		"open_ports":   listeningPorts(),
		"packages":     pkgs,
		"collected_at": time.Now().UTC().Format(time.RFC3339),
	}
	if runtime.GOOS == "windows" {
		if w := windowsSurface(); w != nil {
			r["windows"] = w
		}
	}
	return r
}

// asList coerces ConvertTo-Json's lone-element collapse (PS 5.1 renders a
// one-item array as a scalar) back into a list, so hotfixes/local_admins are
// always arrays for the consumer.
func asList(v any) []any {
	switch t := v.(type) {
	case []any:
		return t
	case nil:
		return nil
	default:
		return []any{t}
	}
}

// windowsSurface collects the Windows attack surface the pentest Windows lane
// arms from: installed hotfixes/KBs (missing patch -> CVE -> exploit module),
// SMB1 + signing, RDP/WinRM exposure, OS build/edition, UAC, and local admins.
// ONE PowerShell call emits a compact JSON object we hand back verbatim under
// platform_properties['recon']['windows']. Collection only — the agent never
// runs the exploit arsenal. Best-effort: "" / parse failure -> nil.
func windowsSurface() map[string]any {
	ps := `$ErrorActionPreference='SilentlyContinue';` +
		`$smb=Get-SmbServerConfiguration;` +
		`$ts=Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server';` +
		`$nla=(Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp').UserAuthentication;` +
		`$uac=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA;` +
		`$cv=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion';` +
		`$kb=@(Get-HotFix | Select-Object -ExpandProperty HotFixID);` +
		`$ad=@(Get-LocalGroupMember -Group Administrators | Select-Object -ExpandProperty Name);` +
		`[pscustomobject]@{os_build="$($cv.CurrentBuildNumber).$($cv.UBR)";os_edition=$cv.ProductName;` +
		`hotfixes=$kb;smb=@{v1_enabled=[bool]$smb.EnableSMB1Protocol;signing_required=[bool]$smb.RequireSecuritySignature};` +
		`rdp=@{enabled=($ts.fDenyTSConnections -eq 0);nla=($nla -eq 1)};winrm=@{running=((Get-Service WinRM).Status -eq 'Running')};` +
		`uac=@{enabled=($uac -eq 1)};local_admins=$ad} | ConvertTo-Json -Compress -Depth 4`
	out := run("powershell", "-NoProfile", "-Command", ps)
	if out == "" {
		return nil
	}
	var m map[string]any
	if json.Unmarshal([]byte(out), &m) != nil {
		return nil
	}
	m["hotfixes"] = asList(m["hotfixes"])
	m["local_admins"] = asList(m["local_admins"])
	return m
}

func listeningPorts() []map[string]any {
	switch runtime.GOOS {
	case "linux":
		return linuxPorts()
	case "darwin":
		return macPorts()
	case "windows":
		return windowsPorts()
	}
	return nil
}

// portOf returns the port from the first "host:port" field (0 if none). Handles
// ss/netstat "0.0.0.0:22" / "[::]:22" and lsof "*:22" / "127.0.0.1:631".
func portOf(fields []string) int {
	for _, f := range fields {
		c := strings.LastIndex(f, ":")
		if c < 0 || c+1 >= len(f) {
			continue
		}
		s := f[c+1:]
		if i := strings.IndexAny(s, " \t("); i >= 0 {
			s = s[:i]
		}
		if p, err := strconv.Atoi(s); err == nil && p > 0 && p < 65536 {
			return p
		}
	}
	return 0
}

// firstQuoted returns the text inside the first pair of double quotes, else "".
func firstQuoted(s string) string {
	i := strings.IndexByte(s, '"')
	if i < 0 {
		return ""
	}
	j := strings.IndexByte(s[i+1:], '"')
	if j < 0 {
		return ""
	}
	return s[i+1 : i+1+j]
}

func normProto(p string) string {
	p = strings.ToLower(p)
	switch {
	case strings.HasPrefix(p, "tcp"):
		return "tcp"
	case strings.HasPrefix(p, "udp"):
		return "udp"
	}
	return ""
}

// dedupPorts collapses the same (port, proto, service) seen on several addresses
// (0.0.0.0 and ::) and caps the list so a chatty host can't bloat the report.
func dedupPorts(rows []map[string]any) []map[string]any {
	seen := map[string]bool{}
	out := []map[string]any{}
	for _, r := range rows {
		k := fmt.Sprintf("%v/%v/%v", r["port"], r["proto"], r["service"])
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, r)
		if len(out) >= 500 {
			break
		}
	}
	return out
}

func linuxPorts() []map[string]any {
	out := run("ss", "-tulnpH") // TCP+UDP listening, numeric, with process, no header
	if out == "" {
		out = run("ss", "-tulnp") // older ss without -H (the header line auto-skips)
	}
	if out == "" {
		out = run("netstat", "-tulnp")
	}
	var rows []map[string]any
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		proto := normProto(f[0])
		if proto == "" { // header line ("Netid"/"State"/"Proto") or junk
			continue
		}
		port := portOf(f)
		if port == 0 {
			continue
		}
		service := firstQuoted(line) // ss: users:(("sshd",pid=...))
		if service == "" {           // netstat: trailing "pid/sshd"
			last := f[len(f)-1]
			if i := strings.LastIndex(last, "/"); i >= 0 && i+1 < len(last) {
				service = last[i+1:]
			}
		}
		rows = append(rows, map[string]any{
			"port": port, "proto": proto, "service": service, "version": "",
			"evidence": strings.TrimSpace(line),
		})
	}
	return dedupPorts(rows)
}

func macPorts() []map[string]any {
	var rows []map[string]any
	add := func(out, proto string) {
		for _, line := range strings.Split(out, "\n") {
			f := strings.Fields(line)
			if len(f) < 2 || f[0] == "COMMAND" { // skip the header; portOf filters the rest
				continue
			}
			port := portOf(f)
			if port == 0 {
				continue
			}
			rows = append(rows, map[string]any{
				"port": port, "proto": proto, "service": f[0], "version": "",
				"evidence": strings.TrimSpace(line),
			})
		}
	}
	add(run("lsof", "-nP", "-iTCP", "-sTCP:LISTEN"), "tcp")
	add(run("lsof", "-nP", "-iUDP"), "udp")
	return dedupPorts(rows)
}

func windowsPorts() []map[string]any {
	ps := `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $n=''; try { $n=(Get-Process -Id $_.OwningProcess -ErrorAction Stop).ProcessName } catch {}; "$($_.LocalPort)|tcp|$n" }; Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object { $n=''; try { $n=(Get-Process -Id $_.OwningProcess -ErrorAction Stop).ProcessName } catch {}; "$($_.LocalPort)|udp|$n" }`
	out := run("powershell", "-NoProfile", "-Command", ps)
	var rows []map[string]any
	for _, line := range strings.Split(out, "\n") {
		p := strings.Split(strings.TrimSpace(line), "|")
		if len(p) < 2 {
			continue
		}
		port, err := strconv.Atoi(strings.TrimSpace(p[0]))
		if err != nil || port <= 0 {
			continue
		}
		service := ""
		if len(p) >= 3 {
			service = strings.TrimSpace(p[2])
		}
		rows = append(rows, map[string]any{
			"port": port, "proto": strings.TrimSpace(p[1]), "service": service,
			"version": "", "evidence": strings.TrimSpace(line),
		})
	}
	return dedupPorts(rows)
}

func base() string { return strings.TrimRight(os.Getenv("COMPLYVERSE_URL"), "/") }

func enroll() (string, error) {
	tok := os.Getenv("COMPLYVERSE_ENROLL")
	if tok == "" {
		return "", fmt.Errorf("no COMPLYVERSE_ENROLL token and no saved api_token — nothing to authenticate with")
	}
	host, _ := os.Hostname()
	ip, _ := netInfo()
	dom, joined := detectDomain()
	rb, code, err := post(base()+"/api/endpoint-agents/enroll", "", map[string]any{
		"enrollment_token": tok, "hostname": host, "os_family": runtime.GOOS,
		"agent_version": agentVersion, "ip_address": ip,
		"domain": dom, "part_of_domain": joined,
	})
	if err != nil {
		return "", err
	}
	if code != 200 {
		return "", fmt.Errorf("enroll failed (%d): %s", code, string(rb))
	}
	var r struct {
		APIToken string `json:"api_token"`
	}
	if err := json.Unmarshal(rb, &r); err != nil || r.APIToken == "" {
		return "", fmt.Errorf("enroll: bad response: %s", string(rb))
	}
	return r.APIToken, nil
}

func report(apiToken string) error {
	inv, host, ip := collectInventory()
	pkgs := software() // collected once: reported as "software" AND fed to recon
	rb, code, err := post(base()+"/api/endpoint-agents/report", apiToken, map[string]any{
		"hostname": host, "os_name": osName(), "os_family": runtime.GOOS,
		"ip_address": ip, "agent_version": agentVersion,
		"software": pkgs, "inventory": inv,
		"deep":  deepCollect(apiToken),
		"recon": recon(pkgs),
	})
	if err != nil {
		return err
	}
	if code != 200 {
		return fmt.Errorf("report failed (%d): %s", code, string(rb))
	}
	return nil
}

// deepCollect runs the server's deep inventory probe LOCALLY and returns its raw
// stdout (JSON on Windows, sectioned text on Linux). It is the SAME script the
// agentless credentialed path uses, but here it runs as LocalSystem/root, so no
// credentials are needed for the hardware/security telemetry. Best-effort: any
// failure returns "" and the report still carries the basic inventory.
func deepCollect(apiToken string) string {
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		return "" // no deep probe for darwin yet
	}
	body, code, err := get(base()+"/api/endpoint-agents/collect-script/"+runtime.GOOS, apiToken)
	if err != nil || code != 200 || len(body) == 0 {
		return ""
	}
	ext := ".sh"
	if runtime.GOOS == "windows" {
		ext = ".ps1"
	}
	f, err := os.CreateTemp("", "ava-deep-*"+ext)
	if err != nil {
		return ""
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err := f.Write(body); err != nil {
		f.Close()
		return ""
	}
	f.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp)
	} else {
		cmd = exec.CommandContext(ctx, "sh", tmp)
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	_ = cmd.Run() // partial output is fine — the server-side parser degrades gracefully
	return strings.TrimSpace(out.String())
}

func heartbeat(apiToken string) {
	rb, _, _ := post(base()+"/api/endpoint-agents/heartbeat", apiToken, map[string]any{})
	var r struct {
		AgentVersion string `json:"agent_version"`
	}
	// Self-update when the server advertises a different version — unless we ALREADY
	// tried to reach exactly that version (a prior swap that didn't take, e.g. the
	// server version was bumped without a rebuilt binary), which would otherwise loop.
	if json.Unmarshal(rb, &r) == nil && r.AgentVersion != "" && r.AgentVersion != agentVersion &&
		lastUpdateTarget() != r.AgentVersion {
		selfUpdate(r.AgentVersion)
	}
}

func updateMarkerPath() string { return filepath.Join(filepath.Dir(statePath()), "update-target") }

func lastUpdateTarget() string {
	b, _ := os.ReadFile(updateMarkerPath())
	return strings.TrimSpace(string(b))
}

// selfUpdate downloads the server's current agent binary, swaps it in, and exits
// non-zero so the supervisor relaunches us on it: Windows SCM failure action,
// Linux systemd Restart=always, macOS launchd KeepAlive. Best-effort — any failure
// leaves the running binary untouched and we retry on the next heartbeat.
func selfUpdate(target string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	body, code, err := get(base()+"/api/endpoint-agents/installer/"+binOS()+"/bin", "")
	if err != nil || code != 200 || len(body) < 1_000_000 { // a real binary is multi-MB
		return
	}
	newp := exe + ".new"
	if os.WriteFile(newp, body, 0o755) != nil {
		return
	}
	if runtime.GOOS == "windows" {
		// A running .exe can't be overwritten but CAN be renamed aside.
		_ = os.Remove(exe + ".old")
		if os.Rename(exe, exe+".old") != nil {
			_ = os.Remove(newp)
			return
		}
	}
	if os.Rename(newp, exe) != nil {
		return
	}
	// Record the target so we don't re-attempt the same version if it didn't take.
	_ = os.WriteFile(updateMarkerPath(), []byte(target), 0o600)
	fmt.Println("self-update: swapped in new binary, restarting")
	os.Exit(1)
}

// binOS maps the running platform to the server's binary key (_BIN).
func binOS() string {
	if runtime.GOOS == "darwin" {
		if runtime.GOARCH == "arm64" {
			return "darwin-arm64"
		}
		return "darwin-amd64"
	}
	return runtime.GOOS // "windows" | "linux"
}

// ─────────────────────────── CIS / compliance (local) ───────────────────────
type cisOscap struct {
	RuleID     string `json:"rule_id"`
	Datastream string `json:"datastream"`
	Profile    string `json:"profile"`
}
type cisWin struct {
	Shell   string `json:"shell"`
	Command string `json:"command"`
	Timeout int    `json:"timeout"`
}
type cisJob struct {
	RunID      int       `json:"run_id"`
	RuleID     string    `json:"rule_id"`
	RunnerType string    `json:"runner_type"`
	Oscap      *cisOscap `json:"oscap"`
	Win        *cisWin   `json:"win"` // windows: run the check locally, ship raw stdout
}
type cisResult struct {
	RunID     int            `json:"run_id"`
	Status    string         `json:"status,omitempty"`
	Summary   string         `json:"summary,omitempty"`
	RawOutput map[string]any `json:"raw_output,omitempty"`
	// Windows: raw command output — the server scores it (no local verdict).
	Stdout     string `json:"stdout,omitempty"`
	ExitStatus *int   `json:"exit_status,omitempty"`
	Stderr     string `json:"stderr,omitempty"`
}

// mapOscap mirrors oscap_runner._STATUS_MAP exactly so agent verdicts score
// identically to the agentless path.
func mapOscap(r string) string {
	switch r {
	case "pass", "fixed":
		return "passed"
	case "fail":
		return "failed"
	case "notapplicable", "notchecked", "notselected", "informational":
		return "skipped"
	default: // error, unknown, notreported, ""
		return "error"
	}
}

// fetchDatastream downloads the server's SCAP datastream to a temp file so the
// agent runs oscap against the exact same content the cloud uses (rule IDs
// align). Streams straight to disk — datastreams are multi-MB.
func fetchDatastream(apiToken, dsPath string) (string, bool) {
	req, err := http.NewRequest("GET", base()+"/api/endpoint-agents/datastream?p="+url.QueryEscape(dsPath), nil)
	if err != nil {
		return "", false
	}
	if t := os.Getenv("COMPLYVERSE_TENANT"); t != "" {
		req.Header.Set("X-Tenant-Slug", t)
	}
	req.Header.Set("Authorization", "Bearer "+apiToken)
	resp, err := httpc.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", false
	}
	tmp, err := os.CreateTemp("", "ds-*.xml")
	if err != nil {
		return "", false
	}
	n, err := io.Copy(tmp, io.LimitReader(resp.Body, 128<<20))
	tmp.Close()
	if err != nil || n < 1000 {
		os.Remove(tmp.Name())
		return "", false
	}
	return tmp.Name(), true
}

// runOscap fetches the (server-side) datastream, runs one `oscap xccdf eval` for
// a (datastream, profile), and returns {rule-idref: xccdf-result}. oscap exits
// non-zero when any rule fails — normal, so the exit code is ignored; only the
// results XML matters.
func runOscap(apiToken, datastream, profile string) map[string]string {
	out := map[string]string{}
	localDS, ok := fetchDatastream(apiToken, datastream)
	if !ok {
		return out // no content → caller marks these rules "error"
	}
	defer os.Remove(localDS)
	tmp, err := os.CreateTemp("", "oscap-*.xml")
	if err != nil {
		return out
	}
	tmp.Close()
	defer os.Remove(tmp.Name())
	args := []string{"xccdf", "eval", "--profile", profile, "--results", tmp.Name(), localDS}
	_ = exec.Command("oscap", args...).Run()
	data, err := os.ReadFile(tmp.Name())
	if err != nil || len(data) == 0 {
		return out
	}
	type ruleResult struct {
		Idref  string `xml:"idref,attr"`
		Result string `xml:"result"`
	}
	dec := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "rule-result" {
			var rr ruleResult
			if dec.DecodeElement(&rr, &se) == nil && rr.Idref != "" {
				out[rr.Idref] = strings.TrimSpace(rr.Result)
			}
		}
	}
	return out
}

// cisRun pulls this agent's pending CIS rules, runs the benchmark locally with
// oscap, and posts verdicts back. Linux only for now (Windows CIS is WinRM-based).
func cisRun(apiToken string) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		return
	}
	rb, code, err := get(base()+"/api/endpoint-agents/jobs", apiToken)
	if err != nil || code != 200 {
		return
	}
	var jr struct {
		Jobs []cisJob `json:"jobs"`
	}
	if json.Unmarshal(rb, &jr) != nil || len(jr.Jobs) == 0 {
		return
	}
	if runtime.GOOS == "windows" {
		runWindowsChecks(apiToken, jr.Jobs) // posts in batches as it goes
	} else {
		postResults(apiToken, runLinuxOscap(apiToken, jr.Jobs)) // oscap is one shot
	}
}

// postResults ships a batch of verdicts; the server scores + finalizes them.
func postResults(apiToken string, results []cisResult) {
	if len(results) == 0 {
		return
	}
	if _, c, _ := post(base()+"/api/endpoint-agents/jobs/results", apiToken,
		map[string]any{"results": results}); c == 200 {
		fmt.Printf("CIS: reported %d rule result(s)\n", len(results))
	}
}

// runWindowsChecks runs each job's CIS check locally (the command was already
// read-only-safety-gated server-side) and ships RAW output in BATCHES as it goes.
// Batching means a big benchmark shows live progress, the agent heartbeats between
// batches so it never goes STALE mid-grind, results already sent survive a crash,
// and the next poll resumes ONLY the still-pending rules (the server's /jobs returns
// pending only). The server scores each batch, so the agent never duplicates verdicts.
func runWindowsChecks(apiToken string, jobs []cisJob) {
	cut := func(s string, n int) string {
		if len(s) > n {
			return s[:n]
		}
		return s
	}
	const batchN = 25
	var batch []cisResult
	flush := func() {
		if len(batch) == 0 {
			return
		}
		postResults(apiToken, batch)
		batch = batch[:0]
		heartbeat(apiToken) // stay alive + advance liveness during a long grind
	}
	for _, j := range jobs {
		if j.Win == nil || j.Win.Command == "" {
			continue
		}
		to := j.Win.Timeout
		if to <= 0 {
			to = 60
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(to)*time.Second)
		var cmd *exec.Cmd
		if strings.EqualFold(j.Win.Shell, "cmd") {
			cmd = exec.CommandContext(ctx, "cmd", "/c", j.Win.Command)
		} else {
			cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", j.Win.Command)
		}
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		err := cmd.Run()
		cancel()
		rc := 0
		if err != nil {
			if ee, ok := err.(*exec.ExitError); ok {
				rc = ee.ExitCode()
			} else {
				rc = -1 // couldn't start / timed out — server treats as no-evidence
			}
		}
		rcCopy := rc
		batch = append(batch, cisResult{
			RunID: j.RunID, ExitStatus: &rcCopy,
			Stdout: cut(stdout.String(), 65536), Stderr: cut(stderr.String(), 8192),
		})
		if len(batch) >= batchN {
			flush()
		}
	}
	flush() // remainder
}

// runLinuxOscap groups jobs by (datastream, profile) — oscap evaluates the whole
// profile once and returns every rule's verdict, so we never run it per-rule.
func runLinuxOscap(apiToken string, jobs []cisJob) []cisResult {
	type key struct{ ds, prof string }
	groups := map[key][]cisJob{}
	for _, j := range jobs {
		if j.Oscap == nil || j.Oscap.Datastream == "" {
			continue
		}
		k := key{j.Oscap.Datastream, j.Oscap.Profile}
		groups[k] = append(groups[k], j)
	}
	var results []cisResult
	for k, js := range groups {
		verdicts := runOscap(apiToken, k.ds, k.prof)
		for _, j := range js {
			v, ok := verdicts[j.Oscap.RuleID]
			st := mapOscap(v)
			if !ok {
				st, v = "error", "rule not present in oscap results"
			}
			results = append(results, cisResult{
				RunID: j.RunID, Status: st, Summary: "oscap: " + v,
				RawOutput: map[string]any{"engine": "agent-oscap", "rule_id": j.Oscap.RuleID,
					"xccdf_result": v, "profile": k.prof},
			})
		}
	}
	return results
}

// reEnroll swaps a revoked/invalid api_token for a fresh one using COMPLYVERSE_ENROLL
// (set by the installer, so it's present after a re-install) — lets a revoked
// agent recover when it's re-installed with a new token. Returns true on success.
func reEnroll(st *state) bool {
	if os.Getenv("COMPLYVERSE_ENROLL") == "" {
		return false
	}
	tok, err := enroll()
	if err != nil {
		return false
	}
	st.APIToken = tok
	_ = saveState(*st)
	fmt.Println("re-enrolled OK")
	return true
}

func main() {
	loadConfig()
	if exe, err := os.Executable(); err == nil {
		_ = os.Remove(exe + ".old") // remove a prior self-update's old binary (Windows)
	}
	// On Windows, when the SCM launches us as a service, run under its control so
	// Stop/Shutdown are handled and the SCM's failure action can restart us on a
	// crash. Interactively (first install), or on Linux/macOS, run the loop direct.
	if runtime.GOOS == "windows" && isWindowsService() {
		runService()
		return
	}
	runAgent(nil)
}

// runAgent enrolls (first run), reports once, then loops: heartbeat + pending CIS
// every 5 min and a full inventory re-report hourly. It returns when `stop` is
// closed (a Windows service Stop); a nil `stop` runs forever (interactive /
// systemd / launchd, where the supervisor owns the lifecycle).
func runAgent(stop <-chan struct{}) {
	if base() == "" {
		fmt.Fprintln(os.Stderr, "COMPLYVERSE_URL is required")
		return
	}
	st := loadState()
	if st.APIToken == "" {
		tok, err := enroll()
		if err != nil {
			fmt.Fprintln(os.Stderr, "enroll error:", err)
			return
		}
		st.APIToken = tok
		if err := saveState(st); err != nil {
			fmt.Fprintln(os.Stderr, "warning: could not persist token:", err)
		}
		fmt.Println("enrolled OK")
	}
	if err := report(st.APIToken); err != nil {
		if strings.Contains(err.Error(), "(401)") && reEnroll(&st) {
			_ = report(st.APIToken)
			fmt.Println("reported inventory OK")
		} else {
			fmt.Fprintln(os.Stderr, "report error:", err)
		}
	} else {
		fmt.Println("reported inventory OK")
	}
	cisRun(st.APIToken) // run any pending CIS rules now
	if os.Getenv("COMPLYVERSE_ONCE") == "1" {
		return
	}
	// Two cadences: a tight scan-pickup poll so a "Rescan" click starts within
	// ~15s (agents are behind NAT — often a link-local IP — so the server can't
	// push; the agent must pull), and a 5-min heartbeat for liveness + the hourly
	// inventory re-report. cisRun is a cheap GET when nothing is pending, and it
	// runs to completion before the next tick is received, so polls never overlap.
	scanTick := time.NewTicker(15 * time.Second)
	hbTick := time.NewTicker(5 * time.Minute)
	defer scanTick.Stop()
	defer hbTick.Stop()
	elapsed := 0
	for {
		select {
		case <-stop:
			return
		case <-scanTick.C:
			cisRun(st.APIToken)
		case <-hbTick.C:
			heartbeat(st.APIToken)
			elapsed += 5
			if elapsed >= 60 {
				elapsed = 0
				if err := report(st.APIToken); err != nil {
					if strings.Contains(err.Error(), "(401)") && reEnroll(&st) {
						_ = report(st.APIToken)
					} else {
						fmt.Fprintln(os.Stderr, "periodic report error:", err)
					}
				}
			}
		}
	}
}
