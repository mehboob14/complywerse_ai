# PCI DSS Lifecycle Application

## Overview
A comprehensive PCI DSS (Payment Card Industry Data Security Standard) compliance lifecycle management application. This application helps organizations track, manage, and demonstrate compliance with PCI DSS requirements.

## Project Structure
```
├── backend/           # Python FastAPI backend
│   ├── main.py       # Application entry point
│   ├── models.py     # SQLAlchemy database models
│   ├── router.py     # All API endpoints (single router file)
│   └── seed_data.py  # Database seeding script
├── frontend/          # React + Vite frontend
│   └── src/
│       ├── pages/    # Page components
│       └── App.jsx   # Main app with routing
└── pci_compliance.db # SQLite database (auto-created)
```

## Tech Stack
- **Backend**: Python, FastAPI, SQLAlchemy, SQLite/PostgreSQL
- **Frontend**: React, Vite, React Router, Axios

## Architecture Decisions
- All API endpoints consolidated in single `router.py` file (as per user requirement)
- Database supports both SQLite (development) and PostgreSQL (production via DATABASE_URL)
- Frontend proxies API calls to backend via Vite config

## Current Modules

### Module 1: Controls & Evidence (Completed)
- 5 PCI DSS controls seeded
- 16 required evidence items across controls
- Table view with drill-down drawer
- Navigation to all planned sections

### Module 2: Gap Assessment (Completed)
- UploadedEvidence model with status tracking (Pending/Accepted/Rejected)
- 8 mock uploaded evidence items seeded
- Dynamic status calculation: Not Started / Partial / Complete
- Gap analysis comparing required vs uploaded evidence
- Evidence Checklist page with side-by-side comparison
- Missing items highlighted in red with upload buttons

## API Endpoints
- `GET /api/controls` - List all controls
- `GET /api/controls/{id}` - Get single control with evidence
- `GET /api/controls/with-evidence` - List all controls with their evidence
- `GET /api/controls/status` - List controls with compliance status
- `GET /api/controls/{id}/gap` - Gap analysis for a control
- `GET /api/evidence` - List all uploaded evidence
- `GET /api/required-evidence/{control_id}` - Get evidence items for a control

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (optional, defaults to SQLite)

## Running the Application
- Backend runs on port 8000
- Frontend runs on port 5000 (proxies /api to backend)

## User Preferences
- Backend in Python only
- All endpoints in single router file
- Separate backend and frontend folders
