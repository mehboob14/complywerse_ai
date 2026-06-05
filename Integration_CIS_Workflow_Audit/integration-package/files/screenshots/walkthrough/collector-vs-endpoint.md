# Collector vs Endpoint — Screen Demo

Yeh dono mode kya hain, screen-by-screen.

---

## SCREEN 1 — "Install a new agent" modal (jab tu + button dabata hai)

```
┌────────────────────────────────────────────────────────────────────┐
│  Install a new agent                                       [X]     │
│                                                                    │
│  Give the agent a friendly name and pick a mode. You'll get        │
│  a one-time install command in the next step.                      │
│                                                                    │
│  Agent name                                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  e.g. DC-01-collector                                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Mode                                                              │
│  ┌──────────────────────────────┬──────────────────────────────┐   │
│  │  Collector (1 agent / LAN)   │  Endpoint (1 agent / host)   │   │
│  │                              │                              │   │
│  │  Installed on one LAN box.   │  One agent per machine.      │   │
│  │  Scans neighbors using       │  Pushed via GPO / SCCM /     │   │
│  │  stored credentials.         │  Intune / Ansible.           │   │
│  └──────────────────────────────┴──────────────────────────────┘   │
│      ↑ choose this for                ↑ choose this for            │
│      Cisco / Oracle / AWS /           Windows servers / Linux      │
│      switches / non-Windows           servers / desktops that      │
│      / Network gear                   already host the agent       │
│                                                                    │
│  Target OS                                                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Windows  ▾                                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│      ↑ this is the OS where AGENT INSTALLS (not what it scans)    │
│      Windows / Linux / macOS — only 3 because agent is a program  │
│      that needs to run on a real OS                                │
│                                                                    │
│                                           [ Cancel ]  [ Generate ] │
└────────────────────────────────────────────────────────────────────┘
```

**Bus 3 fields:** name, mode (2 cards), OS (3 options). That's it.

---

## SCREEN 2 — Confusion clear karne ke liye

```
                    ┌─────────────────────────┐
                    │   Agent runs on WHAT?   │
                    │   (Target OS dropdown)  │
                    └────────────┬────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
            Windows           Linux           macOS
        (program ka host — agent ek service hai jo run karta hai)


                    ┌─────────────────────────┐
                    │  Agent scans WHAT?      │
                    │  (depends on MODE)      │
                    └────────────┬────────────┘
                                 │
                  ┌──────────────┴──────────────┐
                  ▼                             ▼
          ENDPOINT mode                  COLLECTOR mode
          (scans ITSELF)                 (scans NEIGHBORS over network)
                  │                             │
                  ▼                             ▼
          - Windows host                  - Cisco router (SSH)
          - Linux host                    - Oracle DB (SQL*Net)
          (same box where                 - AWS account (API)
          agent installed)                - Linux server (SSH)
                                          - Other Windows (WinRM)
```

**Key insight:** "Sirf 3 OS" sirf yeh batata hai ke **agent ka ghar** kya hai.  
Cisco/Oracle/AWS scan target hain — woh dropdown me nahi aate kyunki agent unpe **install nahi hota**, woh sirf unhe **dur se scan karta hai**.

---

## SCREEN 3 — Collector mode example (Cisco router scan karna hai)

**Form fill:**
- Agent name: `cisco-collector-vm`
- Mode: **Collector** ← selected
- Target OS: **Linux** (Cisco ko scan karne wala agent ek Linux VM pe baithta hai)

**Click "Generate install command"** → next screen:

```
┌────────────────────────────────────────────────────────────────────┐
│  Install command for agent #28                                     │
│                                                                    │
│  ⚠ This install command contains a one-time enrollment token.     │
│    It's shown ONCE — copy it now. If lost, revoke + re-enroll.    │
│                                                                    │
│  Linux (bash, run as root):                              [Copy]    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  curl -sSL 'https://compliverse.app/agent/install.sh?        │  │
│  │  token=enroll_a8f3c2...' | sudo bash                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  [Done]                                                            │
└────────────────────────────────────────────────────────────────────┘
```

**Iske baad operator karta hai:**
1. Linux VM khol kar woh ek command paste karta hai → agent install + enroll
2. Agent dashboard mein `ACTIVE` ho jata hai
3. **Phir** dashboard mein operator Cisco router ke credentials add karta hai (host, username, password)
4. Cloud agent ko bolega "yeh saari Cisco IPs scan kar" → agent SSH karke har router pe `show running-config` chalata hai → results cloud pe bhejta hai

**1 agent → 50 Cisco routers scan kar sakta hai.**

---

## SCREEN 4 — Endpoint mode example (Hassan ke laptop ki CIS scan)

**Form fill:**
- Agent name: `hassan-laptop`
- Mode: **Endpoint** ← selected
- Target OS: **Windows**

**Click "Generate install command"** → next screen:

```
┌────────────────────────────────────────────────────────────────────┐
│  Install command for agent #29                                     │
│                                                                    │
│  ⚠ This install command contains a one-time enrollment token.     │
│                                                                    │
│  Windows (PowerShell, run as Administrator):             [Copy]    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  iex (irm 'https://compliverse.app/agent/install.ps1?        │  │
│  │  token=enroll_b9e7d1...')                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  [Done]                                                            │
└────────────────────────────────────────────────────────────────────┘
```

**Iske baad operator karta hai:**
1. Hassan ka laptop khol kar Admin PowerShell mein paste karta hai
2. NSIS installer download + silent install + service register
3. Agent `ACTIVE` ho jata hai dashboard mein
4. Yeh agent **sirf is laptop ki** CIS settings scan karega — secedit, registry, user rights, etc.
5. **Koi creds add karne ki zaroorat nahi** — agent local hai, local files padh sakta hai

**1 agent → 1 host (woh same laptop).**

For mass deploy: same install command GPO/SCCM se 500 PCs pe push kar do → har PC apna apna agent install karega.

---

## SCREEN 5 — Side-by-side comparison

| Field                | Collector                        | Endpoint                        |
|----------------------|----------------------------------|---------------------------------|
| Install kahan        | 1 jump VM (Linux ya Windows)     | Har target host pe              |
| Scan kya             | Network devices over SSH/SQL/API | Local OS (apni host)            |
| Cred lagti hai?      | Haan — Cisco/Oracle ki cred chahiye | Nahi — local file access enough |
| Best for             | Cisco / Oracle / AWS / switches  | Windows servers / Linux servers / desktops |
| Senior's quote       | "Agent on Windows scans network devices via SSH" — **this is Collector mode** | "Multi-user PCs me agent install" — **this is Endpoint mode** |

---

## SCREEN 6 — Senior ki 11 instructions me yeh kahan baithta hai

| Senior bola                                          | Mode       |
|------------------------------------------------------|------------|
| #2 "Windows agent + SSH for network devices"         | Collector  |
| #6 "Mehboob ke git repo se multi-user PCs me install" | Endpoint   |
| #11 "Windows + Linux + Oracle SQL + Cisco + AWS"     | Both — Collector for Oracle/Cisco/AWS, Endpoint for Windows/Linux hosts |

**Tujhe yeh dono build karne the. Ho gaye hain.** Same install.ps1 / install.sh script use karta hai, sirf mode database me different store hota hai.

---

Annotated diagram ho gaya. Ab live stack bring up karta hun real browser screenshots ke liye.
