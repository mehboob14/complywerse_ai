# Khabar + Extension End-to-End Runbook (Windows)

This document gives you full command-level setup and testing for:

- Content Engine (FastAPI + scheduler + user profile vector DB)
- Optional PK crawler + journalist pipeline
- Chrome extension install in multiple Chrome profiles
- Per-user interest/profile testing and feed comparison

All commands below are PowerShell-friendly.

---

## 1) Repos and Paths

- Adblock/Content Engine repo:
  - `C:\Users\Admin\Videos\adblock-extension`
- PK crawler repo:
  - `C:\Users\Admin\Downloads\pk_news_crawler\crawler`

---

## 2) Architecture and How Things Link

### 2.1 Content Engine

- Entry: `content_engine/main.py`
- DBs used:
  - SQLite app data: users, content, trends (`content_engine/khabar.db` by default)
  - Chroma vector DB user context: (`content_engine/chroma_user_profiles` by default)
- API groups:
  - Content: `/content`, `/content/{id}`
  - Domains/Trends: `/domains`, `/trending`, `/trending/google`, `/domains/dynamic`
  - Users/feed/profile:
    - `/users`
    - `/users/{id}/feed`
    - `/users/{id}/profile/build`
    - `/users/{id}/profile/events`
    - `/users/{id}/profile`
    - `/users/{id}/profile/context/search`

### 2.2 Crawler + Journalist (optional side stack)

- Crawler gathers source articles into JSONL in `output/`.
- Classifier + same-story report process those outputs.
- Journalist pipeline creates long-form content from classified packets.
- This stack is currently separate from Content Engine storage unless you explicitly import/publish data.

### 2.3 Extension + Multi-profile testing

- Install extension as unpacked in separate Chrome profiles.
- Each profile should map to a different backend `device_id`/`user_id` to compare personalization.
- You can seed different interests/history per user via API to simulate different behavior quickly.

---

## 3) One-Time Setup (Adblock + Content Engine)

### 3.1 Open terminal at repo root

```powershell
cd C:\Users\Admin\Videos\adblock-extension
```

### 3.2 Create and use virtual environment (already created, safe to re-run)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3.3 Install dependencies

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --prefer-binary --default-timeout 300 --retries 10 -r content_engine\requirements.txt
```

### 3.4 Configure environment

```powershell
Copy-Item content_engine\.env.example content_engine\.env -Force
notepad content_engine\.env
```

Set at least:

- `OPENAI_API_KEY=...`
- `TAVILY_API_KEY=...`
- `ADMIN_API_KEY=...`
- Keep user profile settings enabled:
  - `USER_PROFILE_ENABLED=true`
  - `CHROMA_PERSIST_DIRECTORY=chroma_user_profiles`

### 3.5 Run API server

From repo root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn content_engine.main:app --host 0.0.0.0 --port 8000 --reload
```

Quick health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/
```

---

## 4) Full Content Engine Workflow Test (API)

### 4.1 Create two users with different interests

```powershell
$u1 = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/users" -ContentType "application/json" -Body (@{
  device_id = "chrome-profile-news-finance"
  city = "Karachi"
  region = "PK"
  interests = @(
    @{ domain = "news"; subdomain = "politics"; weight = 1.0 },
    @{ domain = "finance"; subdomain = "stocks"; weight = 0.9 }
  )
  reading_level = 4
  preferred_tone = "analytical"
} | ConvertTo-Json -Depth 8)

$u2 = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/users" -ContentType "application/json" -Body (@{
  device_id = "chrome-profile-cricket-ent"
  city = "Lahore"
  region = "PK"
  interests = @(
    @{ domain = "cricket"; subdomain = "psl"; weight = 1.0 },
    @{ domain = "entertainment"; subdomain = "dramas"; weight = 0.8 }
  )
  reading_level = 2
  preferred_tone = "mixed"
} | ConvertTo-Json -Depth 8)

$u1.id
$u2.id
```

### 4.2 Build profile from past history

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/users/$($u1.id)/profile/build" -ContentType "application/json" -Body (@{
  past_history = @(
    @{ action="page_view"; site_url="https://www.dawn.com"; dwell_seconds=110; topic="budget" },
    @{ action="search"; site_url="https://www.google.com"; search_query="pakistan stock market today"; dwell_seconds=15 },
    @{ action="click"; site_url="https://www.geo.tv"; clicked_url="https://propakistani.pk"; topic="inflation"; dwell_seconds=40 }
  )
  interests_seed = @("economy", "psx", "budget")
  searches = @("dollar to pkr", "karachi business news")
  youtube_preferences = @("PakWheels", "Geo News")
} | ConvertTo-Json -Depth 10)

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/users/$($u2.id)/profile/build" -ContentType "application/json" -Body (@{
  past_history = @(
    @{ action="page_view"; site_url="https://www.cricbuzz.com"; dwell_seconds=160; topic="psl" },
    @{ action="video_watch"; site_url="https://youtube.com"; youtube_channel="Tapmad"; dwell_seconds=420; topic="drama" },
    @{ action="search"; site_url="https://www.google.com"; search_query="psl points table"; dwell_seconds=20 }
  )
  interests_seed = @("psl", "drama reviews", "celebrities")
  searches = @("today psl match", "pakistani drama ratings")
  youtube_preferences = @("Har Pal Geo", "ARY Digital")
} | ConvertTo-Json -Depth 10)
```

### 4.3 Incremental profile updates (simulate live browsing)

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/users/$($u1.id)/profile/events" -ContentType "application/json" -Body (@{
  events = @(
    @{ action="page_view"; site_url="https://tribune.com.pk"; topic="policy"; dwell_seconds=90 },
    @{ action="search"; site_url="https://www.google.com"; search_query="state bank policy rate"; dwell_seconds=12 }
  )
} | ConvertTo-Json -Depth 10)
```

### 4.4 Read profile and semantic context

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/users/$($u1.id)/profile"
Invoke-RestMethod "http://127.0.0.1:8000/users/$($u1.id)/profile/context/search?query=inflation%20and%20budget&limit=5"
```

### 4.5 Compare personalized feeds

```powershell
$feed1 = Invoke-RestMethod "http://127.0.0.1:8000/users/$($u1.id)/feed?limit=10"
$feed2 = Invoke-RestMethod "http://127.0.0.1:8000/users/$($u2.id)/feed?limit=10"

$feed1.items | Select-Object -First 5 | ForEach-Object { $_.content.domain + " | " + $_.content.title }
$feed2.items | Select-Object -First 5 | ForEach-Object { $_.content.domain + " | " + $_.content.title }
```

Note: feed quality depends on content available in `content_items`. If DB is empty, trigger generation first.

---

## 5) Trigger Content Creation / Refresh

Use admin endpoints with `X-Admin-Key` from `.env`.

```powershell
$adminKey = "your-admin-key-from-env"
$headers = @{ "X-Admin-Key" = $adminKey }

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/admin/trigger-google-trends" -Headers $headers
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/admin/trigger-refresh" -Headers $headers -ContentType "application/json" -Body '{"domains":["news","cricket","finance"],"force":true}'
Invoke-RestMethod -Uri "http://127.0.0.1:8000/admin/pipeline-runs" -Headers $headers
Invoke-RestMethod -Uri "http://127.0.0.1:8000/admin/stats" -Headers $headers
```

---

## 6) Chrome Multi-Profile Testing (Different User Interests)

## 6.1 Create separate Chrome user data dirs

```powershell
New-Item -ItemType Directory -Force -Path C:\chrome-profiles\profile-news | Out-Null
New-Item -ItemType Directory -Force -Path C:\chrome-profiles\profile-cricket | Out-Null
```

## 6.2 Launch Chrome per profile

Update the Chrome path if needed.

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
Start-Process $chrome "--user-data-dir=C:\chrome-profiles\profile-news"
Start-Process $chrome "--user-data-dir=C:\chrome-profiles\profile-cricket"
```

## 6.3 Load unpacked extension in each profile

In each Chrome window:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select folder: `C:\Users\Admin\Videos\adblock-extension`

## 6.4 Map each Chrome profile to backend user

Use one `device_id` per profile and keep it stable:

- Profile News: `chrome-profile-news-finance`
- Profile Cricket: `chrome-profile-cricket-ent`

If extension has a settings/storage value for backend user ID/device ID, set those to match created users.

## 6.5 Simulate behavior difference

- In profile 1, browse economy/politics/news pages.
- In profile 2, browse cricket/drama/youtube pages.
- Send periodic event batches to `/users/{id}/profile/events`.
- Compare `/users/{id}/profile` and `/users/{id}/feed` outputs.

---

## 7) Individual Component Runs

### 7.1 Only API (no scheduler refresh automation)

Set in `.env`:

- `SCHEDULER_ENABLED=false`

Then run:

```powershell
.\.venv\Scripts\python.exe -m uvicorn content_engine.main:app --host 0.0.0.0 --port 8000 --reload
```

### 7.2 Only trends + taxonomy manually

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/admin/trigger-google-trends" -Headers @{ "X-Admin-Key" = "your-admin-key" }
Invoke-RestMethod "http://127.0.0.1:8000/trending/google"
Invoke-RestMethod "http://127.0.0.1:8000/domains/dynamic"
```

### 7.3 Only user profile service test

- Create user
- Build profile
- Ingest events
- Query profile/context
- No content generation required for this service test

---

## 8) Optional: PK Crawler + Journalist Pipeline Commands

Use separate terminal and repo.

### 8.1 Setup

```powershell
cd C:\Users\Admin\Downloads\pk_news_crawler\crawler
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 8.2 Crawl

```powershell
python main.py --extended --max-per-source 10 --delay 0.4
python test_all_sources.py
```

### 8.3 Classifier + same story

```powershell
cd C:\Users\Admin\Downloads\pk_news_crawler\crawler\classifier
python run.py --input ..\output\news_2026-03-16.jsonl --print-stats
python same_story_report.py --output-dir ..\output --date 2026-03-16 --threshold 0.62
```

### 8.4 Journalist API

```powershell
cd C:\Users\Admin\Downloads\pk_news_crawler\crawler
$env:GROQ_API_KEY = "your-key"
$env:GROQ_API_BASE = "https://api.groq.com/openai/v1"
$env:MODEL = "llama-3.3-70b-versatile"
python -m uvicorn journalist_pipeline.app:app --host 0.0.0.0 --port 8081 --reload
```

---

## 9) Full Daily Orchestration (Recommended Order)

1. Start `content_engine` API (`:8000`).
2. Trigger trends and refresh, or let scheduler run.
3. Create/update users and build profile baselines.
4. Run extension in multiple Chrome profiles and send events.
5. Compare feed outcomes by user.
6. Optionally run crawler/journalist stack for additional editorial pipeline testing.

---

## 10) Quick Troubleshooting

### pip timeout while installing

Use:

```powershell
.\.venv\Scripts\python.exe -m pip install --prefer-binary --default-timeout 300 --retries 10 -r content_engine\requirements.txt
```

### Wrong Python interpreter

Always run with explicit venv Python:

```powershell
C:\Users\Admin\Videos\adblock-extension\.venv\Scripts\python.exe
```

### Empty feeds

- Check content exists:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/content?limit=5"
```

- Trigger refresh via admin endpoint.

### Profile not found

- Build first:

```powershell
POST /users/{id}/profile/build
```

### Disable profile vector service (if needed)

Set in `.env`:

- `USER_PROFILE_ENABLED=false`

---

## 11) Minimal Smoke Test Checklist

- [ ] API health returns `ok`
- [ ] Admin stats endpoint works with key
- [ ] At least one pipeline refresh completes
- [ ] Two users created with distinct interests
- [ ] Both user profiles built and queryable
- [ ] Context search returns per-user matches
- [ ] Feed output differs for the two users
- [ ] Extension loaded in two Chrome profiles

---

## 12) Useful Endpoints Summary

- `GET /`
- `GET /content`
- `GET /domains`
- `GET /trending`
- `GET /trending/google`
- `GET /domains/dynamic`
- `POST /users`
- `PUT /users/{user_id}/interests`
- `GET /users/{user_id}/feed`
- `POST /users/{user_id}/profile/build`
- `POST /users/{user_id}/profile/events`
- `GET /users/{user_id}/profile`
- `GET /users/{user_id}/profile/context/search`
- `POST /admin/trigger-google-trends`
- `POST /admin/trigger-refresh`
- `GET /admin/pipeline-runs`
- `GET /admin/stats`
