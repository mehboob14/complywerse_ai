# PCI DSS Lifecycle Application

## Overview
A comprehensive PCI DSS (Payment Card Industry Data Security Standard) compliance lifecycle management application. This application helps organizations track, manage, and demonstrate compliance with PCI DSS v4.0 requirements through a 7-phase workflow.

## Project Structure
```
├── backend/           # Python FastAPI backend
│   ├── main.py       # Application entry point
│   ├── models.py     # SQLAlchemy database models
│   ├── router.py     # All API endpoints (single router file)
│   └── seed_data.py  # Database seeding script
├── frontend/          # React + Vite frontend
│   └── src/
│       ├── pages/    # Page components (Dashboard, Requirements, Findings, RiskRegister)
│       ├── App.jsx   # Main app with routing
│       └── App.css   # Dark theme styling
└── pci_compliance.db # SQLite database (auto-created)
```

## Tech Stack
- **Backend**: Python, FastAPI, SQLAlchemy, SQLite/PostgreSQL
- **Frontend**: React, Vite, React Router, Axios

## Architecture Decisions
- All API endpoints consolidated in single `router.py` file (as per user requirement)
- Database supports both SQLite (development) and PostgreSQL (production via DATABASE_URL)
- Frontend proxies API calls to backend via Vite config
- Dark theme UI with GitHub-inspired color scheme (#0d1117 background, #161b22 cards)

## 7-Phase Compliance Lifecycle

1. **PCI Scope Definition** - Define CDE and connected systems
2. **Gap Assessment** (Current) - Assess against PCI DSS v4.x requirements
3. **Control Implementation** - Implement required controls
4. **Evidence Collection** - Collect and organize compliance evidence
5. **Vulnerability & Penetration Testing** - Conduct security testing
6. **Compliance Validation** - QSA assessment and attestation
7. **Continuous Compliance** - Maintain ongoing compliance

## 12 PCI DSS v4.0 Requirements

All 12 core requirements with 63 sub-requirements tracked:
1. Install and maintain network security controls
2. Apply secure configurations to all system components
3. Protect stored account data
4. Protect cardholder data with strong cryptography
5. Protect all systems from malicious software
6. Develop and maintain secure systems and software
7. Restrict access to cardholder data by business need
8. Identify users and authenticate access
9. Restrict physical access to cardholder data
10. Log and monitor all access
11. Test security of systems regularly
12. Support information security with policies

## API Endpoints

### Phases
- `GET /api/phases` - List all phases with tasks/deliverables
- `GET /api/phases/current` - Get current active phase
- `GET /api/phases/{id}` - Get single phase details
- `PATCH /api/phases/{id}/set-current` - Set phase as current

### Requirements
- `GET /api/requirements` - List all requirements with sub-requirements and compliance stats
- `GET /api/requirements/{id}` - Get single requirement with details
- `PATCH /api/sub-requirements/{id}/status` - Update sub-requirement status

### Dashboard
- `GET /api/dashboard/stats` - Overall compliance statistics

### Findings & Risks
- `GET /api/findings` - List all findings
- `GET /api/risks` - List all risks

## Compliance Calculation

Dynamic calculation based on sub-requirement status:
- **Compliant**: 37 sub-requirements
- **Partial**: 22 sub-requirements  
- **Not Started**: 4 sub-requirements
- **Overall Compliance**: 58.7%

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (optional, defaults to SQLite)

## Running the Application
- Backend runs on port 8000
- Frontend runs on port 5000 (proxies /api to backend)

## User Preferences
- Backend in Python only
- All endpoints in single router file
- Separate backend and frontend folders
- Dark theme UI matching provided mockups

## Recent Changes (Dec 30, 2025)
- Redesigned database models for 7-phase lifecycle
- Added 12 PCI DSS v4.0 requirements with 63 sub-requirements
- Implemented dark theme UI with GitHub-style design
- Created Dashboard with compliance stats and phase timeline
- Built Requirements page with expandable sub-requirements
- Added Findings and Risk Register pages with empty state handling
