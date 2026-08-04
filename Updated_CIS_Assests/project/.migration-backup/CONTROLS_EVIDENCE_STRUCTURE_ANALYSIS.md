# GRC-Tenant: Controls, Evidence & Sub-Controls Display Architecture

## Summary Overview

This document analyzes the current implementation of control display, evidence handling, and sub-control hierarchy in the GRC-Tenant platform, particularly for ETGRMF framework evidence and sub-control display fixes.

---

## 1. CONTROL DATA STRUCTURE & MODELS

### 1.1 Backend Database Models

#### **FrameworkControl** (`backend/grc/models.py` - line 296)

```python
class FrameworkControl(Base):
    __tablename__ = "grc_framework_controls"

    id = Column(Integer, primary_key=True, index=True)
    objective_id = Column(Integer, FK "grc_control_objectives.id")
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    statement = Column(Text)
    control_objective = Column(Text)
    is_mandatory = Column(Boolean, default=True)
    risk_category = Column(String(50), default="security")
    evidence_type = Column(String(50), default="policy")
    implementation_guidance = Column(Text)
    testing_guidance = Column(Text)
    order = Column(Integer, default=0)

    # Relationships
    sub_controls = relationship("FrameworkSubControl", cascade="all, delete-orphan")
    control_mappings = relationship("ControlMapping")
    evidence_mappings = relationship("EvidenceControlMapping")
    curated_evidence_items = relationship("CuratedEvidenceItem")
```

#### **FrameworkSubControl** (`backend/grc/models.py` - line 324)

```python
class FrameworkSubControl(Base):
    __tablename__ = "grc_framework_sub_controls"

    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, FK "grc_framework_controls.id")
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    statement = Column(Text)
    description = Column(Text)
    order = Column(Integer, default=0)
    evidence_recommendations = Column(JSON, default=[])
    ai_matching_keywords = Column(JSON, default=[])

    # Relationships
    control = relationship("FrameworkControl", back_populates="sub_controls")
    curated_evidence_items = relationship("CuratedEvidenceItem", cascade="all, delete-orphan")
```

**Key Issue**: Sub-controls support **nested hierarchy** via `evidence_recommendations` (JSON) and `ai_matching_keywords` (JSON), but the schema allows for recursive sub_controls.

#### **CuratedEvidenceItem** (`backend/grc/models.py` - line 2325)

```python
class CuratedEvidenceItem(Base):
    __tablename__ = "grc_curated_evidence_items"

    id = Column(Integer, primary_key=True, index=True)
    sub_control_id = Column(Integer, FK "grc_framework_sub_controls.id", nullable=True)
    framework_control_id = Column(Integer, FK "grc_framework_controls.id", nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    artifact_type = Column(String(50))  # policy, config, log, screenshot, etc.
    format_guidance = Column(Text)
    frequency = Column(String(50), default="annual")
    is_required = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Can be linked to EITHER control or sub-control
    sub_control = relationship("FrameworkSubControl", back_populates="curated_evidence_items")
    framework_control = relationship("FrameworkControl", back_populates="curated_evidence_items")
```

#### **EvidenceControlMapping** (Links uploaded evidence to controls)

```python
class EvidenceControlMapping(Base):
    """Links uploaded evidence files to framework/normalized controls"""
    __tablename__ = "grc_evidence_control_mappings"

    evidence_id = Column(Integer, FK "grc_evidence.id")
    normalized_control_id = Column(Integer, FK "grc_normalized_controls.id", nullable=True)
    framework_control_id = Column(Integer, FK "grc_framework_controls.id", nullable=True)
    parsed_control_id = Column(Integer, FK "grc_parsed_framework_controls.id", nullable=True)
    sub_control_id = Column(Integer, FK "grc_framework_sub_controls.id", nullable=True)

    # Relationships
    evidence = relationship("Evidence")
    normalized_control = relationship("NormalizedControl")
    framework_control = relationship("FrameworkControl")
    sub_control = relationship("FrameworkSubControl")  # NEW: Links evidence to sub-controls
```

---

## 2. FRONTEND DATA TYPES

### 2.1 TypeScript Interfaces (`grc-frontend/src/types/index.ts`)

#### **SubControlWithEvidence** (line 474)

```typescript
export interface SubControlWithEvidence {
  id: number;
  code: string;
  name: string;
  description: string;
  parent_section?: string;
  evidence_recommendations: string[];
  evidence_requirements?: EvidenceRequirement[];
  ai_matching_keywords?: string[];
  sub_controls?: SubControlWithEvidence[]; // RECURSIVE - allows nested hierarchy
}
```

#### **CertificationControl** (line 497)

```typescript
export interface CertificationControl {
  id: number;
  journey_id: number;
  framework_control_id: number;
  parsed_control_id?: number;
  control_code: string;
  control_name: string;
  control_statement: string;
  domain_id: number;
  domain_code: string;
  domain_name: string;
  status: string;
  is_applicable: boolean;
  priority: number;
  sub_controls: SubControlWithEvidence[]; // ← Displays ALL sub-controls
  evidence_requirements: EvidenceRequirement[];
  evidence: ControlEvidence[]; // ← Uploaded evidence files
  evidence_count: number;
  required_evidence_count: number;
}

export interface ControlEvidence {
  id: number;
  file_name?: string;
  file_size?: number;
  uploaded_at: string;
  ai_confidence_score?: number;
  review_status: "pending" | "approved" | "rejected";
  ai_assessment_status?: "completed" | "processing" | "pending_assessment";
  ai_assessment_summary?: string;
}
```

---

## 3. BACKEND API ENDPOINTS

### 3.1 Control Data Retrieval APIs

#### **GET /controls/framework-controls** (`backend/grc/routers/controls_router.py` - line 330)

**Purpose**: List all framework controls from uploaded frameworks

**Returns**:

```json
{
  "controls": [
    {
      "id": int,
      "control_id": string,
      "title": string,
      "description": string,
      "full_text": string,
      "domain": string,
      "category": string,
      "framework_id": int,
      "framework_name": string,
      "framework_version": string,
      "evidence_count": int,  // Links to EvidenceControlMapping
      "created_at": string
    }
  ],
  "total": int,
  "skip": int,
  "limit": int
}
```

**Issues**:

- ⚠️ Does NOT include `sub_controls` in the response
- ⚠️ Evidence count does NOT track sub-control evidence
- ⚠️ No eager loading of sub-control relationships

#### **GET /controls/{control_id}** (`backend/grc/routers/controls_router.py` - line 423)

**Purpose**: Get single NormalizedControl with mappings and evidence

**Returns**:

```json
{
  "id": int,
  "code": string,
  "name": string,
  "statement": string,
  "mappings": [
    {
      "id": int,
      "framework_control_id": int,
      "framework_control_code": string,
      "framework_control_name": string
    }
  ],
  "required_evidence": [
    {
      "id": int,
      "name": string,
      "evidence_type": string
    }
  ]
}
```

**Issues**:

- ⚠️ NormalizedControl - not FrameworkControl, so no sub-control info available at this level

#### **GET /certifications/{id}/controls** (`backend/grc/routers/certification_router.py`)

**Purpose**: Get all controls for a certification journey WITH sub-controls and evidence

**Returns**: Array of `CertificationControl` objects with:

- ✅ Full control hierarchy including `sub_controls` (recursive)
- ✅ Evidence lists for each control
- ✅ Status, applicability, and priority

**Implementation**: Uses `joinedload()` to eagerly fetch relationships

---

### 3.2 Evidence-Related APIs

#### **POST /evidence-mgmt/items** (Evidence Upload)

Uploads evidence file and links to controls via `EvidenceControlMapping`

#### **POST /controls/ai-recommendations** (`controls_router.py` - line 98)

**Purpose**: Generate AI-powered audit test procedures and evidence requirements

**Request**:

```json
{
  "control_id": int,
  "control_title": string,
  "control_description": string,
  "framework_name": string
}
```

**Returns**:

```json
{
  "test_procedures": [
    {
      "procedure_type": "walkthrough|inquiry|observation|inspection|reperformance",
      "description": string,
      "frequency": string,
      "sample_size": string
    }
  ],
  "evidence_requirements": [
    {
      "evidence_type": "policy|procedure|report|screenshot|log|config|certificate|attestation|training|other",
      "title": string,
      "description": string,
      "mandatory": boolean
    }
  ],
  "key_risks_addressed": [string],
  "audit_focus_areas": [string]
}
```

#### **GET /control-library/evidence-recs/for-group/{group_id}** (`control_library/routers/evidence_recs.py`)

**Purpose**: Get evidence recommendations for a control group

**Returns**:

```json
{
  "recommendations": [
    {
      "id": int,
      "group_id": int,
      "normalized_control_id": int,
      "framework_control_id": int,
      "evidence_type": string,
      "evidence_description": string,
      "priority": "critical|high|medium|low",
      "ai_confidence": float (0-1),
      "ai_reasoning": string,
      "sample_evidence_names": [string],
      "control_name": string,
      "control_code": string,
      "framework_name": string
    }
  ]
}
```

#### **GET /evidence-mgmt/links/{evidence_id}/controls** (`modules/evidence/routers/control_links.py` - line 101)

**Purpose**: Get all controls linked to a piece of evidence with framework breakdown

**Returns**:

```json
{
  "evidence_id": int,
  "evidence_name": string,
  "total_mappings": int,
  "by_framework": {
    "framework_id": {
      "framework_id": int,
      "framework_name": string,
      "framework_code": string,
      "controls": [
        {
          "id": int,
          "framework_control_id": int,
          "framework_control": {
            "id": int,
            "code": string,
            "name": string,
            "statement": string
          }
        }
      ]
    }
  },
  "normalized_controls": [...]
}
```

---

## 4. FRONTEND DISPLAY COMPONENTS

### 4.1 Control Library Pages

#### **[grc-frontend/src/app/(dashboard)/control-library/page.tsx](<grc-frontend/src/app/(dashboard)/control-library/page.tsx>)**

**Purpose**: List all control groups

**Displays**:

- Control groups (CommonControlGroup)
- Framework breakdown per group
- Mapping counts (normalized, framework, parsed controls)
- No sub-control visualization

**Key Query**:

```typescript
const { data: group } = useQuery<ControlGroupDetail>({
  queryKey: ["control-group-detail", groupId],
  queryFn: () => apiClient.get(`/control-library/groups/${groupId}`),
});
```

#### **[grc-frontend/src/app/(dashboard)/control-library/[id]/page.tsx](<grc-frontend/src/app/(dashboard)/control-library/[id]/page.tsx>)**

**Purpose**: Show control group details with tabs

**Tabs**:

1. **Controls Tab**: Shows normalized_controls, framework_controls, parsed_controls
   - Lists all controls in the group
   - Shows framework source and mapping confidence
   - ⚠️ No rendering of sub-control hierarchy

2. **Evidence Tab**: Shows evidence recommendations for the group

   ```typescript
   const { data: evidenceRecs } = useQuery({
     queryFn: () =>
       apiClient.get(`/control-library/evidence-recs/for-group/${groupId}`),
   });
   ```

3. **Similarity Tab**: Shows similar controls across frameworks

4. **Inheritance Tab**: Shows control inheritance relationships

---

### 4.2 Certification Journey Pages

#### **[grc-frontend/src/app/(dashboard)/frameworks/[id]/page.tsx](<grc-frontend/src/app/(dashboard)/frameworks/[id]/page.tsx#L1099>)**

**Purpose**: Display certification journey with controls and evidence

**Key Components**:

**renderSubControlsRecursive()** (line 1099):

```typescript
const renderSubControlsRecursive = (
  subControls: SubControlWithEvidence[],
  depth: number
): JSX.Element => {
  return (
    <>
      {subControls.map((sub, idx) => (
        <div key={idx} className="...">
          <div className="font-medium">{sub.code} - {sub.name}</div>
          <p className="text-sm text-gray-600">{sub.description}</p>

          {/* Evidence for this sub-control */}
          {sub.evidence_requirements?.map(req => (
            <EvidenceRow key={req.id} evidence={req} />
          ))}

          {/* Recursive rendering of nested sub-controls */}
          {sub.sub_controls && sub.sub_controls.length > 0 && (
            <div className="ml-4">
              <p className="text-xs text-gray-600 mb-2">
                Sub-controls ({sub.sub_controls.length})
              </p>
              {renderSubControlsRecursive(sub.sub_controls, depth + 1)}
            </div>
          )}
        </div>
      ))}
    </>
  );
};
```

**Control Display** (line 1193):

```typescript
{control.sub_controls && control.sub_controls.length > 0 && (
  <div>
    <p>Control Hierarchy ({control.sub_controls.length} sub-controls)</p>
    {renderSubControlsRecursive(control.sub_controls, 0)}
  </div>
)}
```

**Evidence Display**:

```typescript
const EVIDENCE_TYPE_MAP = {
  policy: { label: "Policy", color: "bg-blue-50 text-blue-700" },
  procedure: { label: "Procedure", color: "bg-purple-50 text-purple-700" },
  screenshot: { label: "Screenshot", color: "bg-cyan-50 text-cyan-700" },
  audit: { label: "Audit Log", color: "bg-orange-50 text-orange-700" },
  // ... 15+ types total
};
```

---

## 5. CURRENT IMPLEMENTATION STATUS

### 5.1 Evidence Display ✅ IMPLEMENTED

- Evidence requirements are shown for each control
- Evidence artifacts are listed with upload timestamps
- AI assessment status is displayed (completed, processing, pending)
- Evidence review status is tracked (pending, approved, rejected)
- AI confidence scores are shown for evidence-control matches

### 5.2 Sub-Control Handling ✅ PARTIALLY IMPLEMENTED

- ✅ Sub-controls ARE fetched and displayed in certification journey page
- ✅ Recursive rendering supports nested hierarchy
- ✅ Evidence requirements shown per sub-control
- ❌ Sub-controls NOT displayed in control library pages
- ❌ Sub-control evidence NOT counted in group statistics
- ❌ No clickable navigation between controls and sub-controls
- ❌ Sub-control evidence gaps NOT highlighted

### 5.3 Control Response Structure

#### Framework Control (Uploaded Frameworks)

```
FrameworkControl
├── id, code, name, statement
├── sub_controls: FrameworkSubControl[]
│   ├── id, code, name, description
│   ├── evidence_recommendations: string[]
│   └── curated_evidence_items: CuratedEvidenceItem[]
├── curated_evidence_items: CuratedEvidenceItem[]
├── objective (ControlObjective)
│   └── domain (FrameworkDomain)
│       └── framework (Framework)
└── evidence_mappings: EvidenceControlMapping[]
    └── evidence: Evidence
```

#### Certification Control (Journey)

```
CertificationControl
├── id, code, name, statement
├── framework_control_id, parsed_control_id
├── status, is_applicable, priority
├── sub_controls: SubControlWithEvidence[]
│   ├── code, name, description
│   ├── evidence_requirements: EvidenceRequirement[]
│   └── sub_controls?: SubControlWithEvidence[] (recursive)
├── evidence_requirements: EvidenceRequirement[]
└── evidence: ControlEvidence[]
    ├── file_name, file_size, uploaded_at
    ├── ai_confidence_score, ai_assessment_status
    └── review_status
```

---

## 6. API METHODS IN FRONTEND

### 6.1 Control APIs (`grc-frontend/src/lib/api.ts` - line 120)

```typescript
export const controlsApi = {
  getAll: () => apiClient.get<Control[]>("/controls"),
  getById: (id: string) => apiClient.get<Control>(`/controls/${id}`),
  getNormalized: () =>
    apiClient.get<NormalizedControl[]>("/controls/normalized"),
  getMappings: () => apiClient.get<ControlMapping[]>("/controls/mappings"),
  getAIRecommendations: (data: {
    control_id: number;
    control_title: string;
    control_description?: string;
    framework_name?: string;
  }) => apiClient.post("/controls/ai-recommendations", data),
};
```

### 6.2 Certification APIs (`grc-frontend/src/lib/api.ts` - line 1070+)

```typescript
export const certificationsApi = {
  getAll: (params?: { status?: string; framework_id?: number }) =>
    apiClient.get("/certifications", { params }),
  getById: (id: number) => apiClient.get(`/certifications/${id}`),
  getControls: (id: number, params?: { status?: string; domain_id?: number }) =>
    apiClient.get(`/certifications/${id}/controls`, { params }),

  uploadEvidence: (journeyId: number, controlId: number, formData: FormData) =>
    apiClient.post(
      `/certifications/${journeyId}/controls/${controlId}/evidence`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    ),

  assessEvidence: (journeyId: number, controlId: number, evidenceId: number) =>
    apiClient.post(
      `/certifications/${journeyId}/controls/${controlId}/evidence/${evidenceId}/assess`,
    ),

  reviewEvidence: (
    journeyId: number,
    controlId: number,
    evidenceId: number,
    data: { action: string; notes?: string },
  ) =>
    apiClient.post(
      `/certifications/${journeyId}/controls/${controlId}/evidence/${evidenceId}/review`,
      data,
    ),

  getProgress: (id: number) => apiClient.get(`/certifications/${id}/progress`),
};
```

---

## 7. FILE PATHS SUMMARY

### Backend

| File                                                                                                                            | Purpose                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [backend/grc/models.py](backend/grc/models.py#L296)                                                                             | FrameworkControl (line 296), FrameworkSubControl (line 324), CuratedEvidenceItem (line 2325)                     |
| [backend/grc/routers/controls_router.py](backend/grc/routers/controls_router.py#L330)                                           | GET /controls/framework-controls (line 330), GET /controls/{control_id} (line 423), AI recommendations (line 98) |
| [backend/grc/routers/certification_router.py](backend/grc/routers/certification_router.py#L1)                                   | GET /certifications/{id}/controls (with sub-controls)                                                            |
| [backend/grc/modules/control_library/routers/evidence_recs.py](backend/grc/modules/control_library/routers/evidence_recs.py#L1) | Evidence recommendations API                                                                                     |
| [backend/grc/modules/evidence/routers/control_links.py](backend/grc/modules/evidence/routers/control_links.py#L101)             | Control-evidence linking                                                                                         |

### Frontend

| File                                                                                                                                 | Purpose                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [grc-frontend/src/types/index.ts](grc-frontend/src/types/index.ts#L474)                                                              | SubControlWithEvidence (line 474), CertificationControl (line 497)      |
| [grc-frontend/src/lib/api.ts](grc-frontend/src/lib/api.ts#L120)                                                                      | API client methods for controls (line 120), certifications (line 1070+) |
| [grc-frontend/src/app/(dashboard)/control-library/page.tsx](<grc-frontend/src/app/(dashboard)/control-library/page.tsx>)             | Control library listing (no sub-controls)                               |
| [grc-frontend/src/app/(dashboard)/control-library/[id]/page.tsx](<grc-frontend/src/app/(dashboard)/control-library/[id]/page.tsx>)   | Control group detail with evidence recommendations                      |
| [grc-frontend/src/app/(dashboard)/frameworks/[id]/page.tsx](<grc-frontend/src/app/(dashboard)/frameworks/[id]/page.tsx#L1099>)       | Certification journey with sub-controls rendering (line 1099+)          |
| [grc-frontend/src/app/(dashboard)/evidence-requirements/page.tsx](<grc-frontend/src/app/(dashboard)/evidence-requirements/page.tsx>) | Evidence requirements listing by framework                              |

---

## 8. ETGRMF FRAMEWORK-SPECIFIC ISSUES

### Current Gaps

1. **Sub-Control Display in Control Library**: ETGRMF has a deep sub-control hierarchy, but the control-library pages don't render sub-controls at all
2. **Evidence Aggregation**: Evidence counts don't include sub-control evidence
3. **Sub-Control Clickability**: No navigation between parent and sub-control views
4. **Sub-Control Grouping**: Control groups don't show sub-control distribution across frameworks
5. **Sub-Control Evidence Requirements**: CuratedEvidenceItem can link to sub-controls, but no UI exposes this

### Recommendations for ETGRMF Fix

1. Extend `/control-library/groups/{id}` API response to include sub-control hierarchy
2. Update `[id]/page.tsx` to render sub-controls with expandable sections
3. Add sub-control evidence requirements to the Evidence tab
4. Create breadcrumb navigation (Framework → Control → Sub-control)
5. Add "Show Sub-controls" toggle to control library listing
6. Update evidence aggregation to count sub-control evidence

---

## 9. EVIDENCE REQUIREMENT TYPES

Currently supported evidence artifact types:

- `policy` - Policy documents
- `procedure` - Procedure documentation
- `screenshot` - System screenshots
- `audit` - Audit logs
- `log` - Log files/exports
- `training` - Training records
- `risk` - Risk assessments
- `access` - Access reviews
- `config` - Configuration exports
- `report` - Reports
- `certificate` - Certificates
- `contract` - Contracts
- `register` - Registers
- `inventory` - Inventory lists
- `plan` - Plans
- `matrix` - Matrices
- `list` - Lists

---

## 10. IMPLEMENTATION ARCHITECTURE

### Control Data Flow

```
Framework Upload (PDF/document)
    ↓
ParsedFrameworkControl (parsed by AI)
    ↓
FrameworkControl (normalized)
    ├── FrameworkSubControl (1..N)
    │   └── CuratedEvidenceItem (evidence requirements)
    └── CuratedEvidenceItem (evidence requirements)

CertificationJourney
    ↓
CertificationControl (maps to FrameworkControl)
    ├── ControlEvidence (uploaded evidence files)
    └── SubControlWithEvidence (from FrameworkSubControl)
        └── ControlEvidence (per sub-control)
```

### Evidence Linking Flow

```
Evidence File Upload
    ↓
EvidenceControlMapping
    ├── normalized_control_id (optional)
    ├── framework_control_id (optional)
    ├── parsed_control_id (optional)
    └── sub_control_id (optional) ← NEW for ETGRMF
```

---

## Conclusion

The platform has solid foundations for control and evidence display:

- ✅ Multi-level control hierarchies are supported in the data model
- ✅ Sub-controls render correctly in certification journeys
- ✅ Evidence requirements are generated via AI
- ✅ Evidence-control mapping is flexible

However, ETGRMF-specific enhancements needed:

- ⚠️ Sub-controls not visible in control library UI (main gap)
- ⚠️ No evidence aggregation across control hierarchy
- ⚠️ Limited sub-control navigation and clickability

The fix requires minimal backend changes (mostly API response enhancement) and moderate frontend changes (adding sub-control rendering in control library pages).
