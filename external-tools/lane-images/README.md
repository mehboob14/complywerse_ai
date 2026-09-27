# AVA lane tool images

Pinned, per-lane tool images for AVA's exploit/recon engine. Each image is a
frozen arsenal the operator builds **once**; the engine then runs tools in
**ephemeral per-job containers** — one container per invocation, destroyed on
exit:

```
docker run --rm --network host ava-<lane> <tool> <args>
```

`--rm` destroys the container on exit; `--network host` lets tools reach the
LAN/targets. Same command shape works locally today and maps to ephemeral K8s
jobs / collector-side runners later — the engine code doesn't change.

Images have `ENTRYPOINT []` and **no CMD**, so the argv you pass to `docker run`
is the command that executes.

## Lanes

| Lane       | Image         | Dockerfile        | Arsenal                          |
|------------|---------------|-------------------|----------------------------------|
| Web        | `ava-web`     | `web.Dockerfile`  | web recon + exploit (this file)  |

## Build

```sh
cd external-tools/lane-images
docker build -t ava-web -f web.Dockerfile .
```

## Run (examples)

```sh
docker run --rm --network host ava-web sqlmap --version
docker run --rm --network host ava-web nuclei -u https://target.example
docker run --rm --network host ava-web httpx -u https://target.example
docker run --rm --network host ava-web xsstrike -u "https://target.example/?q=1"
docker run --rm --network host ava-web python3 /opt/hexstrike/hexstrike.py --help
```

## `ava-web` contents

Goal: **100+ web tools in one image.** Breadth comes from the Kali
`kali-tools-web` metapackage (100+ tools on its own); on top of that the
Dockerfile explicitly installs the named arsenal below so nothing silently goes
missing, plus HexStrike (~130 finders) and XSStrike from git.

- **Scanners / exploit:** sqlmap, commix, wpscan, nikto, nuclei (+ templates),
  joomscan, davtest, cadaver, skipfish, whatweb, wafw00f, dalfox, xsstrike
- **Content / directory discovery:** ffuf, gobuster, feroxbuster, dirb,
  dirbuster, wfuzz, arjun
- **TLS/SSL:** sslscan, sslyze, testssl.sh
- **Crawl / URL harvest:** httpx, katana, gau, waybackurls
- **Subdomain / DNS:** subfinder, amass, assetfinder, dnsenum, dnsrecon, fierce,
  sublist3r, dnsutils
- **Brute force:** hydra, medusa, patator
- **Wordlists:** seclists, wordlists
- **Finder suites:** HexStrike (~130 finders, `/opt/hexstrike`)

Explicitly named tools: **38 apt + XSStrike + HexStrike = 40**, on top of the
full `kali-tools-web` metapackage — comfortably past the 100-tool goal.
