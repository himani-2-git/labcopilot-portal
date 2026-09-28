# LabCopilot Product Specification

Blueprint date: 2026-09-19; Phase 3 status update: 2026-09-23; lineage milestone **verified 2026-09-28**. The capability register preserves the complete product vision and distinguishes the implemented synthetic foundation, pre-analytical and analytical slices from planned, advanced, simulated and research work. LabCopilot is not a complete laboratory information system or clinical deployment.

## 1. Purpose, source and actual starting state

LabCopilot is an AI-assisted laboratory workflow platform for government hospital laboratories. It should connect patient registration, orders, specimen tracking, testing, review, reporting and follow-up in a coherent offline-capable application. It should preserve the original concepts for interoperability, quality management, resource planning, public-health research and privacy-preserving learning while clearly separating working product features from simulations and research.

The governing project instructions are [AGENTS.md](../AGENTS.md). The original specification actually present is [LabCopilot_Original_Buildathon_Spec.pdf.pdf](LabCopilot_Original_Buildathon_Spec.pdf.pdf), **10 pages, 72,042 bytes**. The single-extension path mentioned in the instructions does not exist; the original file has been preserved without renaming. Page references in this document refer to that PDF's physical pages.

All 10 pages were read, including the feature table, rollout plan, responsible-AI section, future scope and source list. Visual inspection confirmed that the workflow and architecture figure captions on pages 3 and 5 have no visible accompanying diagrams. The blueprint therefore supplies the missing operational detail instead of assuming that the captions define an architecture.

Before this documentation phase, the complete directory contained only:

```text
LabCopilot/
  AGENTS.md                                      5,878 bytes
  assets/                                        empty
  demo/                                          empty
  design/                                        empty
  docs/
    LabCopilot_Original_Buildathon_Spec.pdf.pdf    72,042 bytes
  screenshots/                                   empty
  source/                                        empty
```

There was no `.git` directory, application code, dependency manifest, lockfile, build configuration, database schema, migration, test suite, environment configuration, deployment configuration or implementation evidence. The three blueprint Markdown documents created in this phase are documentation, not application features. The original PDF's statements that the platform is "built," deployed, compliant or effective do not describe the repository's actual state.

The detailed intended technical design and dependencies are in [Architecture.md](Architecture.md). The one-week sequence, current implementation and verification status are tracked in [PROJECT_STATE.md](PROJECT_STATE.md). The original starting-state inventory above remains historical evidence; the current repository state is recorded in that project-state document.

## 2. Product principles and scope

1. Use **synthetic/demo patient data only** throughout development and demonstration. A realistic working feature can use synthetic data; synthetic data does not by itself make the feature a simulation.
2. Preserve the complete product vision. Delivery order changes do not remove capabilities from the roadmap.
3. Keep measured results, deterministic rules/calculations, AI explanations, human review and approved outputs distinct.
4. AI is an assistant. Every AI-generated clinical or patient narrative remains a draft until appropriate human approval. Model output never directly replaces an authoritative result or creates a clinical order.
5. Operate locally first for permitted work: UI -> local persistence -> offline queue -> synchronization -> backend. Make the limits of offline work visible.
6. Use server-enforced authorization, state transitions, audit and release rules. Client-side validation improves usability but does not confer authority.
7. Preserve original and superseded records. A correction is a versioned, reasoned amendment with an audit trail.
8. Make workflows, language, accessibility and exception handling part of the product, not optional screen decoration.
9. Treat accreditation, security, interoperability and outcome improvement as evidence-dependent claims. A design intention is not certification, clinical validation or deployment readiness.

### Capability classes

- **Core implementation:** foundational product behavior intended to become working software. The complete core is larger than a one-week build. Basic QC, inventory and instrument features form a later core tranche after the primary laboratory workflow.
- **Advanced implementation:** production-oriented extensions requiring more workflow depth, integrations, validation or operational maturity.
- **Demonstration/simulation:** an explicitly labelled substitute or scenario for unavailable external systems, hardware, training data or predictive evidence. It must expose its simulated status and must not be represented as real clinical functionality.
- **Future research:** an investigational capability requiring scientific validation, representative data, governance or privacy analysis before product deployment.

These classes describe intended delivery, not current readiness. Each register row has one class. Where an idea has both a simulator and a future real implementation, separate rows preserve that distinction. A later decision to change a class must record its rationale and affected architecture.

## 3. Complete capability register

Source labels distinguish the original PDF (`PDF pN`), project instructions (`AGENTS`) and product inferences required to make a source concept operational (`Inferred`). Acceptance descriptions are intended behavior, not evidence that it exists.

| ID | Capability and intended acceptance boundary | Class | Status | Source |
|---|---|---|---|---|
| C01 | Responsive accessible PWA with coherent navigation, installable shell, desktop/tablet layouts, loading/empty/error/offline states. | Core implementation | Partially implemented: installable shell and patient, catalog, order, specimen, analytical result and sync navigation; later modules remain planned | PDF pp1,5; AGENTS |
| C02 | Operational dashboard and work queues showing orders, specimens, pending results/review, urgent alerts, follow-up and synchronization status. Counts drill into scoped records. | Core implementation | Partially implemented: patient/sync overview, searchable order/specimen queues and analytical worklist with lifecycle, critical and readiness filters; clinical review/follow-up queues remain planned | PDF pp3,6; AGENTS |
| C03 | Patient registry with synthetic demographics, local identifiers, preferred language, relevant history and possible-duplicate warnings. Identity changes are audited. | Core implementation | Partially implemented: synthetic demographic registry, history and facility scope; duplicate workflow remains planned | PDF pp2–3,5; Inferred identity controls |
| C04 | Laboratory orders/panels with requester, priority, encounter context, requested tests, cancellation reasons and visible lifecycle. | Core implementation | Partially implemented: patient-linked versioned order creation, requester, priority, test/panel selections, history and frozen expanded order-test manifest verified 2026-09-28; encounter/cancellation and governed catalog versions remain planned | PDF p3; AGENTS; Inferred lifecycle |
| C05 | Specimen collection, accession, receipt, acceptance/rejection, recollection and custody events linked to an order and patient. | Core implementation | Implemented for synthetic scope: distinct physical collection attempts and retained rejected-attempt history verified 2026-09-28; complete custody/aliquot workflow remains planned | PDF pp1,3; Inferred exceptions |
| C06 | Unique accession/barcode or QR label generation, printable label layout, scan/typed lookup and audited reprint. Physical identity verification remains required. | Core implementation | Partially implemented: persisted identifiers, illustrative QR artwork, copy and exact historical accession/attempt lookup verified 2026-09-28; scannable labels, printing, hardware scanning and audited reprint remain planned | PDF pp1,3; AGENTS |
| C07 | Versioned test/panel catalog, specimen/method/unit metadata and approved reference/critical-range configuration. Missing or incompatible definitions block unsafe validation. | Core implementation | Partially implemented: stable synthetic catalog, typed per-test policies and immutable result policy snapshots; approved catalog versions, methods and clinical ranges remain planned | PDF pp3,5; AGENTS; Inferred configuration |
| C08 | Manual result entry and controlled import staging with result versions, supported numeric/coded/text values, provenance, units and deterministic calculations for supported tests. | Core implementation | Partially implemented: numeric/text/coded manual entry, exact decimal storage, immutable result revisions and provenance; controlled imports and calculations remain planned | PDF pp3,5–6; AGENTS |
| C09 | Deterministic range, abnormality, plausibility and configured critical-value checks; retain rule version and evaluated context separately from AI text. | Core implementation | Implemented for Phase 3 synthetic scope: deterministic required/type/unit/decimal checks, reference flags and inclusive critical thresholds with policy/evaluation snapshots; clinical validation and plausibility rules remain planned | PDF pp2–5; AGENTS |
| C10 | Critical-alert work queue with immediate local display, durable server alerts after sync, acknowledgment, contact attempts, escalation and closure. Alert state is distinct from report approval. | Core implementation | Partially implemented: durable critical state, audit evidence, prominent UI and critical filter; acknowledgment, contact, escalation and closure are not implemented | PDF pp2–3; Inferred closed-loop safety |
| C11 | Staff-owned follow-up/retest tasks with due date, assignee, reminder status and documented outcome. Suggestions do not automatically create tests or treatment. | Core implementation | Planned / not implemented | PDF pp2–3 |
| C12 | Backend AI provider adapter generates structured draft explanations from an explicit validated result snapshot and allowed context. Failure never blocks manual laboratory work. | Core implementation | Planned / not implemented | PDF pp2–3,5; AGENTS |
| C13 | AI evidence/provenance view links statements to supplied values, rule results and approved reference identifiers; records model, prompt/version and uncertainty. No fabricated citations or asserted hidden reasoning. | Core implementation | Planned / not implemented | PDF pp7–9; corrected explainability approach |
| C14 | Human technical verification, clinical review, AI-text approval, rejection/rework and final authorized release tied to exact versions. Stale approval is invalidated by material edits. | Core implementation | Partially implemented: separate analytical validation and readiness gate; qualified clinical review, AI-text approval and final release remain planned | PDF pp2–3,7–9; AGENTS |
| C15 | Released clinician report with results, units, reference ranges, flags, provenance, approved interpretation and reviewer identity; immutable snapshot and PDF generation. | Core implementation | Planned / not implemented | PDF pp2–3 |
| C16 | Patient-friendly approved report with clear explanations, language preference and human-approved follow-up wording. It derives from the same released result snapshot. | Core implementation | Planned / not implemented | PDF pp2–3 |
| C17 | English/Hindi UI foundations and clinically reviewed demo report templates/fixtures, locale-aware formatting and explicit fallback when a translation is unavailable. | Core implementation | Planned / not implemented | PDF pp3,8; Inferred initial language scope |
| C18 | Corrected results/reports, amendment reason, supersession links and prior-recipient notification task; retain original released documents. | Core implementation | Partially implemented: reasoned result corrections preserve immutable prior values, policy and critical evidence; released-report amendments and recipient notification remain planned | PDF pp3,7 audit/archival; Inferred correction safety |
| C19 | Searchable clinical history, released-report archive and controlled export with defined retention and access rules. | Core implementation | Partially implemented: patient revision/history endpoint and detail view; report archive/export remains planned | PDF pp3,7 |
| C20 | IndexedDB local working set and transactional draft/outbox persistence for preregistered staff in a previously authenticated, unlocked session within a bounded offline authorization window. A persisted queue does not grant offline reauthentication after restart. | Core implementation | Partially implemented: scoped Dexie patient drafts, catalog/analytical caches and shared workflow outbox for result create/revise drafts; full projections and offline reauthentication remain planned | PDF pp2,5–6; AGENTS |
| C21 | Synchronization with idempotency, dependency ordering, retries/backoff, push/pull cursors, per-operation outcomes, network recovery and visible queue state. | Core implementation | Partially implemented: manual push, durable operation IDs, matching acknowledgment checks and visible conflicts; automatic sync, pull cursors and dependency graph remain planned | PDF pp5–6; AGENTS |
| C22 | Optimistic concurrency and conflict inbox, explicit manual resolution for clinical/identity conflicts, version preservation and server-authoritative release. No silent last-write-wins for results. | Core implementation | Partially implemented: patient/specimen/result expected versions and serialized result transactions; stale local commands remain conflicts; resolution workbench remains planned | AGENTS; Inferred from PDF two-way sync |
| C23 | Authentication and least-privilege action/facility-scoped roles with separate entry, technical verification, clinical release, administration and integration permissions. | Core implementation | Partially implemented: development session adapter, four roles, permission checks and facility isolation; Keycloak/OIDC and complete clinical grants remain planned | PDF pp5,7; AGENTS |
| C24 | Audit events for clinical changes, review/release, sensitive access/export, authorization changes and integration/sync outcomes; no ordinary-user log modification. | Core implementation | Partially implemented: append-only patient/order/specimen mutation audit events, specimen event history and correlation IDs; read/access/auth/integration coverage remains planned | PDF pp3,5,7; AGENTS |
| C25 | Privacy/security controls including transport/server-storage protection, bounded local retention, secret management, input validation, export controls and AI-context minimization. | Core implementation | Partially implemented: synthetic-only constraints, secret-free repo, validation, HttpOnly sessions, CSRF/origin checks and server RBAC; production hardening remains planned | PDF pp5,7–9; AGENTS |
| C26 | FHIR R4 export/validation for the declared supported `Patient`, `Observation` and `DiagnosticReport` subset, with internal workflow models kept separate. | Core implementation | Planned / not implemented | PDF pp2,5,7; AGENTS |
| C27 | Reviewed LOINC/UCUM mappings for the supported test catalog; preserve local codes, mapping version and explicit unmapped/needs-review status. Never guess a code. | Core implementation | Planned / not implemented | PDF pp2,5,7; AGENTS |
| C28 | Basic QC lot/run/result records, manual disposition and configured analytical/release gates. This is a later core tranche after the primary laboratory workflow. | Core implementation | Partially implemented: separate manual synthetic QC attestation and deterministic readiness block; QC lots/runs/measurements/statistics remain planned | PDF pp3–4,7 |
| C29 | Basic reagent/inventory lot, expiry and stock-movement ledger with actor/reason and shortage/expiry visibility. Later core tranche. | Core implementation | Planned / not implemented | PDF pp1,3,9; AGENTS |
| C30 | Instrument register, status, maintenance records and readiness checks. Later core tranche; a register is not a live instrument interface. | Core implementation | Planned / not implemented | PDF pp3–4,6 |
| C31 | Deterministic operational analytics: timestamps, TAT, backlog, throughput, rejection/rework and critical/follow-up closure; show metric definitions and synthetic-data labels. | Core implementation | Planned / not implemented | PDF pp6,8–9 |
| C32 | Initial AI governance: intended-use statement, synthetic evaluation cases, language consistency checks, correction feedback, model/prompt release record and manual fallback. | Core implementation | Planned / not implemented | PDF pp7–9 |
| C33 | Reproducible local/demo deployment, seed data, essential automated checks, observability and documentation that distinguishes planned, simulated, implemented and tested work. | Core implementation | Partially implemented: pnpm workspace, embedded PostgreSQL setup, migrations, seed users, build/tests and phase-state documentation; deployment/observability hardening remains planned | PDF pp5,8; AGENTS |
| C34 | Longitudinal patient trends and annotated report visuals derived from verified values, with accessible nonvisual equivalents. | Advanced implementation | Planned / not implemented | PDF p2 |
| C35 | Evidence-constrained differential, reflex/follow-up test and action suggestions for qualified clinician review; no autonomous diagnosis, prescription or order creation. | Advanced implementation | Planned / not implemented | PDF pp2–3,6 |
| C36 | Separately validated deterministic auto-verification policy for narrowly eligible routine results, with exclusions, monitoring and rollback; disabled initially and never grants LLM release authority. | Advanced implementation | Planned / not implemented | PDF p3; resolves pp2–3,7–9 contradiction |
| C37 | Additional regional-language UI/report coverage with reviewed clinical terminology, subgroup/language evaluation and maintained translation versions. | Advanced implementation | Planned / not implemented | PDF pp3,7–8 |
| C38 | Verified patient access to own released reports, notification preferences and follow-up status. No draft/other-patient access. | Advanced implementation | Planned / not implemented | PDF pp2–3 patient/mobile delivery; Inferred portal |
| C39 | Real consented SMS/email/app notification channels with delivery receipts, retry/escalation, protected content and auditable recipient identity. | Advanced implementation | Planned / not implemented | PDF pp2–3,8 |
| C40 | Multi-facility administration, scoped deployment, cross-site workflows and operational resilience with explicit authorized patient-sharing rules. | Advanced implementation | Planned / not implemented | PDF pp6,8–9 |
| C41 | Authenticated bidirectional FHIR/HIS/EHR/national-network integration against a named partner/profile, identity reconciliation, versioning and conformance checks. | Advanced implementation | Planned / not implemented | PDF pp2–3,7–8 |
| C42 | Legacy HL7 v2 adapters with declared message profiles, acknowledgments, duplicate quarantine and protected transport; distinct from FHIR REST. | Advanced implementation | Planned / not implemented | PDF p3 HL7 instrument/API interface; AGENTS |
| C43 | Terminology import/version management and reviewed LOINC mapping workflows for an expanding local catalog. | Advanced implementation | Planned / not implemented | PDF p5 |
| C44 | Statistical QC charts/rules, scheduled QC, lot/method-specific targets and deviation investigation. Clinical reference intervals remain a separate concept. | Advanced implementation | Planned / not implemented | PDF pp4,7 |
| C45 | Proficiency-testing schedule, records, assessment and follow-up. | Advanced implementation | Planned / not implemented | PDF p7 |
| C46 | Versioned SOP templates, staff acknowledgment, configurable compliance checklists, deviation/CAPA and inspection evidence. Supports accreditation work without asserting accreditation. | Advanced implementation | Planned / not implemented | PDF pp4,7; Inferred CAPA depth |
| C47 | Inventory consumption links, reorder planning, purchasing/receipt workflows and supplier management with approvals and stock reconciliation. | Advanced implementation | Planned / not implemented | PDF pp1,3,9; Inferred purchasing depth |
| C48 | Validated physical analyzer interfaces and instrument middleware including order/result correlation, quarantine and optional bidirectional worklists. | Advanced implementation | Planned / not implemented | PDF pp3,8 |
| C49 | Interactive managerial analytics for common abnormalities, reagent use, capacity, staffing and trends, with explicit denominators and access scope. | Advanced implementation | Planned / not implemented | PDF pp6,9 |
| C50 | Ongoing AI quality/drift monitoring, demographic/language evaluation, feedback triage, governance review and controlled model/prompt updates. | Advanced implementation | Planned / not implemented | PDF pp7–9 |
| C51 | Approved on-premises/open-source model deployment through the same provider contract, with hardware, quality, security and support validation. | Advanced implementation | Planned / not implemented | PDF pp5,7 |
| C52 | Verified remote-testing/telemedicine integration with identity, provenance, review and follow-up; patient-reported observations remain distinct from laboratory measurements. | Advanced implementation | Planned / not implemented | PDF p9 |
| C53 | Pilot staff training, user feedback, helpdesk/on-call operation and phased rollout across sites. | Advanced implementation | Planned / not implemented | PDF p8 |
| C54 | Prospective operational/outcome evaluation and ROI measurement using defined baselines, appropriate comparators and governance; no borrowed outcome claims. | Advanced implementation | Planned / not implemented | PDF pp1,6–8 |
| C55 | Instrument/API message fixtures and fake analyzer status/telemetry with import rejection, duplicate and mapping-error scenarios. | Demonstration/simulation | Planned / not implemented | PDF p3; AGENTS realistic mocks |
| C56 | Local FHIR/EHR receiver and legacy-message fixtures demonstrating declared mapping/exchange behavior without claiming a real hospital connection. | Demonstration/simulation | Planned / not implemented | PDF pp2–3,5; AGENTS |
| C57 | In-app simulated notification delivery, acknowledgment and failure/retry log; no real SMS/email messages. | Demonstration/simulation | Planned / not implemented | PDF pp2–3,8; AGENTS |
| C58 | Clearly labelled deterministic explanation fixtures when no AI provider is configured; expose fixture origin rather than calling them model-generated. | Demonstration/simulation | Planned / not implemented | PDF pp2,5; AGENTS |
| C59 | Synthetic patient-risk scenario dashboard with visible invented inputs/outputs; no validated sepsis/readmission prediction claim. | Demonstration/simulation | Planned / not implemented | PDF p9 |
| C60 | Synthetic aggregate outbreak/trend scenario dashboard with privacy-threshold examples; no real surveillance or alert delivery. | Demonstration/simulation | Planned / not implemented | PDF pp6,9 |
| C61 | Patient-reported home-test intake/review scenario with provenance and verification status, separate from authoritative laboratory records. | Demonstration/simulation | Planned / not implemented | PDF p9 |
| C62 | Resource scheduling/optimization scenario using explicit synthetic constraints and comparison metrics. | Demonstration/simulation | Planned / not implemented | PDF p6 |
| C63 | Synthetic instrument-deviation/maintenance scenario; any forecast is visibly simulated. | Demonstration/simulation | Planned / not implemented | PDF pp4,6 |
| C64 | Barcode scanner/printer hardware demonstration or emulator when devices are unavailable; distinguish rendered labels from physical printing verification. | Demonstration/simulation | Planned / not implemented | PDF pp3,8; AGENTS |
| C65 | Validated patient-risk forecasting from longitudinal data, including sepsis/readmission concepts, with subgroup evaluation and clinical intended-use review. | Future research | Planned / not implemented | PDF p9 |
| C66 | Public-health outbreak detection combining authorized lab aggregates with external signals, including the source's social-media/hospital-visit concept. | Future research | Planned / not implemented | PDF pp6,9 |
| C67 | Federated learning/evaluation across hospitals with threat modelling, governance, privacy leakage assessment and scientific validation. | Future research | Planned / not implemented | PDF p9 |
| C68 | On-device inference meeting model-quality, browser/device hardware, update and data-protection constraints. | Future research | Planned / not implemented | PDF p9 |
| C69 | Learned predictive maintenance using representative instrument data and prospective evidence. | Future research | Planned / not implemented | PDF pp4,6 |
| C70 | Validated learned scheduling/resource optimization using operational data and measured effects. | Future research | Planned / not implemented | PDF p6 |
| C71 | Institution-governed fine-tuning/model adaptation from approved data and reviewed feedback, with consent/legal basis, holdouts and regression evaluation. | Future research | Planned / not implemented | PDF pp8–9 |
| C72 | Explainability research for a separately specified numeric/image model, where SHAP or image attribution is technically appropriate; no generic claim to explain LLM reasoning. | Future research | Planned / not implemented | PDF pp3–5,7–8 |

No capability is removed because it is difficult. The primary one-week slice targets a small supported test catalog and one complete synthetic laboratory journey; it does not promise all 33 Core implementation rows, all languages, all instrument types or a deployable hospital system.

## 4. Unified UI and module structure

Routes below are the intended complete module map. Phase 3 implements login/session, dashboard, patients, catalog tests/panels, orders, specimens/accession lookup, analytical worklist/result entry/detail, sync and configuration routes. Clinical review remains a labeled placeholder. Remaining routes are planned. The sidebar exposes only authorized modules, and a route alone is not evidence of a working capability.

The shared shell should provide facility/workspace identity, current role, global patient/accession lookup, language preference, connectivity and pending-sync indicator, urgent alert access and user/session controls. Clinical pages share patient/order/specimen context, status vocabulary, timestamps, ownership and activity history. Color is supplemented by text/icons; priority is never communicated by color alone.

| Intended route | Module and principal content | Capability IDs |
|---|---|---|
| `/login`, `/session` | Sign-in, session/lock state, offline eligibility and reauthentication. | C20,C23,C25 |
| `/dashboard` | Role-specific workload, overdue/critical items and current operational status. | C02,C31 |
| `/patients`, `/patients/:id` | Patient search/register, identity, language, order/result history and duplicate review. | C03,C19,C34 |
| `/orders`, `/orders/new`, `/orders/:id` | Order creation, tests/panels, priority, specimen requirements and lifecycle. | C04,C07 |
| `/specimens`, `/specimens/:id`, `/scan` | Collection/accession worklists, labels, receipt, rejection/recollection and custody. | C05,C06,C64 |
| `/results`, `/results/:id` | Draft entry/import staging, context/ranges, deterministic flags and technical verification. | C07–C09,C14,C55 |
| `/review`, `/review/:id` | Exact result snapshot, AI drafts/evidence, QC state, prior changes, rework and qualified approval. | C12–C14,C28,C35–C36 |
| `/reports`, `/reports/:id` | Clinician/patient previews, language, release history, PDF and amendments. | C15–C19,C34,C37 |
| `/alerts`, `/alerts/:id` | Critical alert queue, contact/acknowledgment, escalation and closure evidence. | C10 |
| `/follow-ups` | Owned retest/appointment tasks, due dates and outcome. | C11,C39 |
| `/quality`, `/quality/runs`, `/quality/deviations`, `/quality/proficiency` | Basic QC first; statistical charts, deviations/CAPA and proficiency later. | C28,C44–C46 |
| `/inventory`, `/inventory/lots/:id`, `/inventory/movements` | Stock/expiry/lot ledger; consumption and purchasing later. | C29,C47 |
| `/instruments`, `/instruments/:id` | Register, readiness, maintenance and labelled adapter/telemetry state. | C30,C48,C55,C63,C69 |
| `/analytics` | Defined operational metrics and later interactive management views. | C31,C49,C54 |
| `/sync`, `/sync/conflicts/:id` | Pending/failed operations, last successful sync, conflict comparison and resolution. | C20–C22 |
| `/integrations`, `/integrations/messages/:id` | FHIR exports, delivery status, validation/quarantine and adapter simulation labels. | C26,C41–C42,C48,C56 |
| `/catalog/tests`, `/catalog/panels`, `/catalog/ranges`, `/catalog/mappings` | Versioned local catalog, clinical rules and reviewed terminology mapping. | C07,C27,C43 |
| `/governance/ai`, `/governance/ai/evaluations`, `/governance/ai/feedback` | Intended use, versions, synthetic evaluations, corrections and review decisions. | C13,C32,C50,C71–C72 |
| `/governance/sops`, `/governance/checklists` | SOP versions/acknowledgments, checklist and accreditation-support evidence. | C46 |
| `/audit` | Scoped event search and controlled evidence export. | C24,C25 |
| `/admin/users`, `/admin/roles`, `/admin/facilities`, `/admin/settings` | Account/permission/facility policy and nonclinical settings; clinical rules require separate authority. | C23,C25,C40 |
| `/patient/reports`, `/patient/follow-ups` | Future verified patient access restricted to own released information. | C38–C39 |
| `/remote-testing` | Separately marked patient-reported intake and review. | C52,C61 |
| `/research/risk`, `/research/public-health`, `/research/scheduling`, `/research/federated` | Explicit simulated or research spaces; never ordinary clinical work queues. | C59–C60,C62,C65–C67,C70 |

## 5. Roles and permissions

The PDF explicitly names laboratory technicians, doctors/clinicians, pathologists and administrators (pp2–3,5,7). It also names patients, lab managers/staff and public-health users as stakeholders, but does not define their complete permission sets. The roles below distinguish these source references from inferred operational specialization. Assignment of an approver role requires the relevant organizational qualification; a role label does not create clinical competence.

Permission checks combine **action + facility + record/work assignment + record state + user authorization**. Generic administration does not grant clinical sign-off. A user may hold multiple approved roles; the system should preserve actor identity and allow separation-of-duty policy for entry and release.

| Role | Source basis | Main allowed actions | Boundaries |
|---|---|---|---|
| Registration/order clerk | Inferred specialization of PDF p3 registration | Create/update permitted demographics, detect duplicates, prepare delegated orders and worklists. | No result entry, AI approval or clinical release; clinical requests need authorized requester context. |
| Collection/accession staff | Inferred specialization of PDF p3 collection | Collect/label/receive/reject specimens, record custody and recollection; view minimum necessary patient/order context. | No analytical result approval or unrestricted history access. |
| Laboratory technician | Explicit PDF pp2–3,5 | Process accepted specimens, enter/import draft results, perform technical verification when permitted, record QC and instrument/reagent context, review proposed text. | No final clinical release unless separately granted qualified approver authority; no untracked change to released results. |
| Pathologist/authorized lab approver | Explicit pathologist/doctor PDF pp2–3,7 | Review exact results/AI text, request rework, approve language outputs, release reports, authorize amendments and critical escalation. | Material changes invalidate prior approval; offline release prohibited in initial architecture. |
| Treating clinician | Explicit PDF pp2–3,5,7 | Create/request orders where authorized, view assigned-patient released reports/history, acknowledge critical communication, decide follow-up/reflex requests. | No direct overwrite of lab measurements; no access to unrelated patients through role alone. |
| Lab manager/QC officer | Manager stakeholder PDF pp6,9; specialization inferred | Manage operational worklists, QC deviations, readiness, SOPs and approved analytics; authorized catalog/range change workflow. | Management does not imply clinical release or unrestricted account administration. |
| Inventory custodian | Inferred from reagents/inventory PDF pp1,3,9 | Receive/issue/adjust stock, record lots/expiry and reasons, review shortages. | No broad clinical data or report approval. |
| System administrator | Explicit PDF pp5,7 | Manage accounts, scoped role grants, facilities, integrations and nonclinical policy; support recovery. | No automatic clinical approval rights; audit cannot be edited through normal application actions. |
| Auditor/AI governance reviewer | Inferred from PDF pp7–9 inspections/ethics review | Read authorized audit/evaluation evidence, review AI feedback, assess releases and controlled exports. | Read-only clinical records; minimum necessary context; governance access is not unrestricted patient access. |
| Patient | Explicit stakeholder PDF pp2–3,9; authenticated role inferred | Advanced: view own released patient report, preferences/follow-up and clearly marked remote submissions. | No draft/other-patient access, lab-result editing or self-release. |
| Integration service account | Inferred from PDF pp3,5,8 | Narrow adapter-specific ingest/export operations and delivery acknowledgment. | No interactive session or broad user role; authenticate and authorize each integration. |
| Public-health analyst | Stakeholder PDF pp6,9; role inferred | Future/advanced: authorized thresholded aggregates and research views. | No identifiable patient-level export by default; no clinical write authority. |

### Action matrix

`Yes` means within authorized facility/work scope. `Limited` means the explicit restriction in the role table applies. `Separate grant` means the base role is insufficient. `Future` means the access itself is advanced/research scope. `No` is the default.

| Action | Clerk | Collection | Technician | Approver | Clinician | Manager/QC | Inventory | Admin | Auditor | Patient | Service | Public health |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Register/edit identity | Yes | Limited | Limited | Limited | Limited | No | No | Separate grant | No | Future limited | Limited | No |
| Create/request order | Limited | No | Limited | Yes | Yes | Separate grant | No | No | No | No | Limited | No |
| Collect/receive/reject sample | No | Yes | Yes | Separate grant | No | Separate grant | No | No | No | No | Limited | No |
| Enter/import draft result | No | No | Yes | Yes | No | Separate grant | No | No | No | Future self-report only | Limited | No |
| Technical verification | No | No | Separate grant | Yes | No | Separate grant | No | No | No | No | No | No |
| Approve AI text/release report | No | No | Separate grant | Yes | Separate grant | Separate grant | No | No | No | No | No | No |
| Acknowledge assigned critical communication | No | Limited | Yes | Yes | Yes | Limited | No | No | No | No | Delivery receipt only | No |
| View released clinical report | Limited | Limited | Yes | Yes | Yes | Limited | No | Separate grant | Limited | Future own only | Limited | No |
| Manage QC/instrument readiness | No | No | Limited | Limited | No | Yes | No | Separate grant | Read only | No | Limited | No |
| Move inventory stock | No | No | Limited | No | No | Limited | Yes | Separate grant | Read only | No | Limited | No |
| Change accounts/role grants | No | No | No | No | No | Separate grant | No | Yes | Read only | No | No | No |
| View audit/evaluation evidence | No | No | Own/work scope | Work scope | Work scope | Limited | Own/work scope | Limited | Yes | No | Own delivery scope | No |
| View cross-patient aggregate analytics | No | No | Limited | Limited | Limited | Yes | Stock only | Separate grant | Limited | No | Limited | Future thresholded |

Authoritative clinical permissions are narrower than technical CRUD access. Existing local access can become stale while disconnected; it is bounded and revalidated before queued work is accepted. Revocation is not instantly knowable on an offline device.

## 6. End-to-end role journeys

### Registration/order clerk

Search existing synthetic patient -> verify identifiers and possible matches -> register/update demographics and language -> record the authorized requester and tests/panel -> check specimen requirements -> create order -> hand off to collection. Handle cancellation, incomplete identifiers and suspected duplicates with a visible hold/review outcome; never silently merge patients.

### Collection/accession staff

Open collection worklist -> verify patient and requested tests -> allocate/print label -> record collection/container/site/time -> receive/scan specimen -> accept with custody event or reject with reason -> request recollection against the existing order. Reprint retains the accession and records the reason; a scan identifies a record but does not prove correct collection.

### Laboratory technician

Open accepted-specimen worklist -> inspect instrument/reagent/QC readiness when that tranche is available -> enter or stage imported draft values -> review units, method, reference/critical rules and duplicates -> resolve invalid entries -> perform permitted technical verification -> request optional AI drafts or proceed manually -> submit for clinical review. A rejected review returns a reasoned work item; failed QC blocks the configured transition.

### Pathologist/authorized laboratory approver

Open review queue -> inspect patient/specimen context, source values, rule flags, QC and history -> review each AI narrative and language output against the same version -> edit/reject/request rerun as needed -> approve exact result/narrative versions -> release online -> inspect finalized clinician/patient report and delivery work items. A later correction starts an amendment; changing a result, clinically material context or narrative cannot retain stale approval.

### Treating clinician

Request appropriate tests -> follow specimen/order status -> receive critical communication and record acknowledgment/contact outcome -> read released clinician report and relevant trends -> use professional judgment on AI-supported suggestions -> order any follow-up through a new authorized request -> close or continue the follow-up task. Report viewing, alert acknowledgment and clinical action are distinct events.

### Lab manager/QC officer

Review backlog/TAT/readiness -> assign operational work -> review QC failures/deviations and affected runs -> authorize documented resolution within role -> review lots/instrument maintenance -> maintain approved SOP/checklist/catalog change workflows -> inspect performance metrics and training needs. Proficiency testing and statistical QC are later advanced workflows; an initial basic QC screen must not imply they exist.

### Inventory custodian

Receive stock -> record lot/expiry/location and quantity -> issue to authorized use -> record consumption/returns/adjustments with reason -> investigate shortage/expiry -> reconcile count -> propose procurement in the advanced workflow. Preserve movement history; avoid editing balances without a ledger event.

### System administrator

Configure facility and identity-provider access -> grant least-privilege roles -> onboard permitted devices/users -> configure server-side integration/provider credentials -> inspect health, job and sync failures -> perform approved backup/recovery/support work -> revoke access and review audit evidence. Clinical override requires a separate qualified role, and offline devices revalidate when they reconnect.

### Auditor/AI governance reviewer

Select authorized scope/time period -> trace a result from entry through rule evaluation, AI draft, edits, sign-off, release and delivery -> inspect actor/version evidence and reasons -> examine language/subgroup evaluation and correction trends -> record governance findings -> approve or reject a proposed model/prompt change through the defined process. Review feedback does not automatically retrain a model.

### Patient (advanced)

Verify identity -> access only own released patient-facing report -> choose supported language -> review approved explanation and follow-up instructions -> manage notification preferences -> acknowledge or arrange follow-up through supported workflow. Any self-test submission is labelled patient-reported and enters a separate review queue.

### Integration service account (advanced real connection; simulated first)

Authenticate scoped connection -> receive/send declared message type -> validate profile, identity, local test mapping and provenance -> deduplicate -> stage accepted content for appropriate review or quarantine invalid content -> acknowledge delivery -> retry transient failure safely -> expose unresolved messages to authorized staff. A transport acknowledgment is not clinical verification or release.

### Public-health analyst (advanced/research)

Access approved aggregate dataset -> apply time/site/test grouping with privacy thresholds -> inspect synthetic demo trends or separately validated research outputs -> document investigation -> escalate through authorized public-health procedures. The demonstration must not send real outbreak alerts or expose patient identities.

## 7. Workflow states, offline boundaries and exceptions

The backend architecture defines the definitive state machines. The product requires visibly separate states for ordered/collected/received/rejected specimens, draft/technically verified/reviewed/released/amended results, pending/failed/conflicted sync operations, draft/approved AI narratives, and open/acknowledged/escalated/closed alerts. A single generic "complete" badge cannot substitute for these distinctions.

### Offline action boundary

| Action | Intended offline behavior | Online requirement |
|---|---|---|
| App access | Preregistered staff may continue permitted draft work in a previously authenticated, unlocked session within its bounded offline authorization window. | First login, new identity enrollment, renewed authorization and role changes require server contact. The initial demo may require online reauthentication to unlock after restart/reload; queue persistence does not imply offline password/token caching or offline re-unlock. |
| Patients/orders/specimens | Persist permitted draft registration/order/collection/accession events locally with stable identifiers and provenance. | Server accepts/rejects after permission, identity, version and state validation. |
| Result entry | Save draft values and apply available versioned deterministic rules; mark stale/missing catalog context. | Authoritative validation and accepted workflow transitions require current server checks. |
| Critical flag | Show immediate local alert and require local staff response according to operational policy. | Remote users cannot be notified while disconnected; server alerts/delivery start after connection. |
| AI explanation | Existing permitted cached drafts may be viewed with origin/version; manual notes may be drafted. | Cloud AI generation requires connectivity. On-device AI is research, not an initial promise. |
| Review | Prepare review notes locally; keep them pending. | Authoritative technical sign-off, AI approval and final report release occur online after current-version checks. |
| Reports | View cached released reports where local policy permits; draft previews are clearly watermarked. | New authoritative release, export/delivery and amendment acceptance require online validation. |
| Follow-up | Record local task notes and pending changes. | Remote reminders, delivery receipts and clinician acknowledgment require communication. |
| Synchronization | Queue operations transactionally and show pending/error counts. | Revalidate session, push in dependency order, process conflicts and pull server changes on recovery. |

An offline device cannot guarantee notification to another device, instant revocation awareness, recovery after browser data deletion or unconditional conflict-free operation. Persistent-storage requests and export/recovery controls reduce risks but do not justify a "no data loss" guarantee.

### Exception workflows

| Exception | Required product outcome |
|---|---|
| Duplicate/uncertain patient identity | Hold linkage; compare evidence; authorized resolution with audit. No automatic merge based only on name. |
| Wrong/missing/damaged label | Stop unsafe handling, verify physical identity, record incident/reprint/recollection as appropriate. |
| Rejected, insufficient or lost specimen | Record reason and disposition, preserve original accession, create linked recollection work. |
| Unsupported test/unit/method or missing range | Allow safe draft capture where appropriate, block affected verification and route to catalog review; never invent a clinical threshold. |
| Invalid/duplicate analyzer message | Quarantine or acknowledge verified duplicate, retain provenance, expose reason and safe replay. |
| Failed QC, expired reagent or unavailable instrument | Mark affected readiness and block configured transitions; document authorized resolution. |
| Critical result during outage | Display local alert and explicit remote-delivery limitation; record local contact action; synchronize durable events when possible. |
| AI unavailable, malformed, unsupported or unsafe | Keep authoritative measurements intact; reject/retry generation or proceed with manual narrative and normal review. |
| Translation unavailable or uncertain | Do not silently publish unreviewed clinical wording; use an approved fallback and visible language status. |
| Result/context changes after AI generation or review | Mark dependent drafts/approvals stale; regenerate or manually revise and repeat required review. |
| Concurrent clinical edits | Preserve local/server versions, show conflict, require authorized resolution; never silently select the latest timestamp. |
| Session expires or access is revoked | Lock prohibited work, require reauthentication on recovery, quarantine unaccepted queued actions and preserve recoverable evidence under policy. |
| Browser storage pressure/device loss | Show storage health where available, use scoped retention and documented recovery; do not claim unsynced drafts are server-backed. |
| Notification failure/no acknowledgment | Retain failed delivery/contact attempt, retry/escalate according to policy, assign responsibility and record closure. |
| Corrected released report | Create versioned amendment, retain the original and approval history, issue recipient follow-up/delivery events. |
| Duplicate/offline stock issue | Server checks ledger consistency; surface insufficient stock/conflict instead of creating silent negative or overwritten balances. |

## 8. Feature dependencies and delivery order

```text
Identity + facility scope + catalog + audit
  -> patients -> orders -> specimens/accession
  -> draft results + deterministic validation/critical alerts
  -> technical verification -> clinical review -> online release
  -> immutable clinician/patient reports -> follow-up + exchange/delivery

Validated result snapshot + allowed history/context
  -> optional AI draft + evidence -> human review -> approved narrative

Local identifiers + entity versions + local transactions/outbox
  -> ordered idempotent sync -> conflict resolution -> accepted server state

QC runs + instrument readiness + reagent lot validity
  -> configured analytical/release gates (later core tranche)

Released/versioned records + event timestamps + metric definitions
  -> operational analytics -> advanced planning/research datasets

Local catalog + reviewed LOINC/units + identity reconciliation
  -> scoped FHIR projection -> simulated receiver -> real partner integration
```

Security, audit, domain validation and the local-first data path must be designed into the foundation even where a user-facing security/analytics module is delivered later. Barcode workflows depend on stable accession identity, not AI. Critical alerts depend on deterministic rules, not report generation. AI depends on validated inputs and governance, not the other way around. External delivery consumes approved snapshots; it cannot become an alternate path around release.

The one-week build sequence is defined in [PROJECT_STATE.md](PROJECT_STATE.md). It is a synthetic-data demonstration milestone and a set of verifiable increments, not the original specification's 0–12-month hospital rollout. Later core and advanced work remain explicitly tracked in this register.

## 9. Source contradictions, risks and preservation decisions

| Source issue | Risk or ambiguity | Blueprint resolution preserving the idea |
|---|---|---|
| AI routine-result auto-release, PDF p3, versus draft/human sign-off, pp2–3,7–9 | Unrestricted model behavior could bypass qualified review. | C14 mandatory human review first; C36 future validated deterministic policy disabled initially. AI text always requires review. |
| Full offline functionality and no loss/inconsistency, pp2,4–6 | Cloud AI, delivery, server permissions, concurrent edits and browser persistence contradict the guarantee. | C20–C22 and explicit action matrix; bounded draft work, online authority and honest failure states. |
| Service Worker described as local database owner, pp2,5 | Worker suspension and platform support make worker-only persistence/sync unreliable. | Local application transactions own data/outbox; worker assists caching/background opportunities. See architecture. |
| Central FHIR server treated as master workflow store, pp5–6 | FHIR alone does not express local queue, permissions, review and every operational state. | Canonical domain model plus FHIR boundary; preserve standard exchange without forcing every internal record into FHIR. |
| Server "only stores synced data," pp5–6 | Conflicts with required business logic, audit, AI jobs and safe release. | Server-authoritative domain validation, authorization, state transitions and durable jobs. |
| SHAP/Score-CAM/attention promised as universal explanation, pp3–5,7–8 | These do not establish trustworthy explanations of arbitrary LLM conclusions. | C13 traceable evidence; C72 preserves appropriate model-specific explainability research. |
| Range validation called QC, pp3–4 | Patient reference intervals cannot prove analytical control validity. | Separate C09 result rules from C28/C44/C45 laboratory QC and proficiency. |
| LOINC for every new/custom test, pp2,5,7 | Correct mapping depends on test meaning, specimen, method and units; a suitable code may be unresolved. | Reviewed supported subset, versioned local codes and explicit unmapped status. |
| HL7 and FHIR treated interchangeably, pp3–5 | Message/transport/profile and acknowledgment expectations are unspecified. | Distinct FHIR R4 resources/REST and legacy HL7 v2/instrument adapters. |
| Full standards compliance/national integration/accreditation, pp4–5,7–9 | Design intentions do not establish conformance, accreditation or applicable legal compliance. | Name supported scope and validation; retain C41/C46 rollout work without certified/compliant claims. |
| Cloud de-identification/on-device privacy assurances, pp5,7,9 | Clinical context/free text can re-identify; on-device quality/hardware/security are unproven. | Minimize/allowlist context, evaluate providers, use synthetic data, retain C51/C68 options. |
| Technician or doctor review authority, pp2–3,5,7 | No clear distinction among entry, technical verification and clinical release. | Explicit qualified grants, role/action matrix, version-bound sign-off and separation-of-duty policy. |
| Differential diagnoses/reflex tests/action suggestions, pp2–3 | Could be mistaken for autonomous diagnosis, treatment or ordering. | C35 qualified-reviewed decision support; source results and authoritative orders remain separate. |
| Crowdsourced translations and assured multilingual quality, p8 | Fluent wording can still misstate clinical meaning. | Reviewed clinical terminology/output, synthetic language evaluations and explicit fallback; regional expansion remains C37. |
| User feedback followed by retraining, pp8–9 | Corrections are not automatically authorized, representative or safe training data. | C32/C50 feedback triage and evaluations first; governed training retained as C71 research. |
| Predicted TAT, error, follow-up and ROI improvements, pp1,6–8 | External examples are not results measured for LabCopilot. | C31 metric definitions and C54 evaluation plan; all numerical benefits are hypotheses until measured. |
| Solo build plus 0–12-month rollout, p8 | One week cannot establish an operating clinical deployment. | One complete synthetic demo slice; keep later core, advanced and research scope. |
| Referenced workflow/architecture figures, pp3,5 | Captions have no visible diagrams, leaving key design decisions undefined. | Explicit workflow/dependency and architecture diagrams in blueprint documents. |
| Remote/home test interpretation, p9 | Patient-reported data might be mistaken for laboratory-verified data. | C61/C52 separate provenance and review; never overwrite authoritative lab measurements. |
| Federated learning privacy, p9 | Keeping raw data local does not by itself prevent model-update leakage or establish safe training. | C67 explicit privacy/security research and governance prerequisites. |
| Public-health/social-media and maintenance/prediction claims, pp4,6,9 | No dataset, validated model, external feed or deployment authorization exists. | Label C59–C63 scenarios and retain C65–C70 research; no real clinical/public-health claims. |
| Missing error/retention/identity/correction details throughout | A happy-path mockup would hide clinically meaningful failures. | Add the inferred exception workflows and architectural policies; record decisions rather than silently claiming the PDF specified them. |

Page 10 lists **nine distinct source entries**, although the PDF uses citation numbers through 31. Many of those numbers map to a single Fullscript commercial blog. The report also cites other industry pages alongside studies/guides. These references preserve the original motivation; their presence does not verify every technical, clinical, regulatory or predictive claim. The reported 16% to under 3% delay improvement, 49% to 71% follow-up example, error-rate improvement and 50% TAT target are not LabCopilot measurements. This phase does not independently validate those external clinical claims.

## 10. Acceptance and readiness language

The next implementation phase should demonstrate a reproducible synthetic patient -> order -> specimen -> result -> deterministic flag/alert -> optional AI draft -> qualified review -> released clinician/patient report journey. It should also demonstrate draft/queue persistence across reload, disconnected draft entry within a previously authenticated and unlocked bounded session, safe reconnection, duplicate prevention and an explicit concurrent-edit conflict. Persistence does not imply offline re-unlock: the initial demo may require online reauthentication after restart/reload and must not cache passwords or persistent bearer tokens for that purpose. Test scope and implemented breadth must be documented per increment.

Report each capability as planned, partially implemented, simulated, implemented or tested only when corresponding repository evidence exists. "Tested" requires stating which behavior and environment were checked; it does not imply clinical validation. "Implemented" for a screen requires its underlying workflow to function, not merely its navigation link or mock data to render.

The recommended architecture uses React/Vite/TypeScript, Dexie/Workbox with custom synchronization, a NestJS modular backend on Node.js 24, PostgreSQL 18/Prisma, durable pg-boss jobs and outbox, Keycloak OIDC with server-managed session cookies, a backend AI provider adapter using the OpenAI Responses API, and a FHIR boundary distinct from the canonical database. The Phase 1–3 foundation, pre-analytical and synthetic analytical subsets installed and exercised are recorded in [PROJECT_STATE.md](PROJECT_STATE.md); the remaining recommendations are still planned. [Architecture.md](Architecture.md) defines the technical decisions and constraints.

This document preserves the product blueprint and source-risk analysis. Phase 3 now contains the synthetic patient → order → accepted specimen/accession → typed result → deterministic validation → QC/readiness slice described in [PROJECT_STATE.md](PROJECT_STATE.md). All thresholds are demonstration fixtures. AI interpretation, clinical approval/release, reports, interoperability, instrument integration, clinical validation and production identity/deployment remain later phases.

The subsequent lineage milestone is described in [Architecture.md](Architecture.md#20-order-and-collection-attempt-lineage-verified-2026-09-28) and [PROJECT_STATE.md](PROJECT_STATE.md#lineage-hardening-verified-2026-09-28). It freezes expanded order-test membership and synthetic policy for new orders, separates recollections into physical specimen attempts, and resolves manual accession lookup to the exact matched attempt. Migration, seed, automated and browser checks passed by 2026-09-28. Scannable labels, a clinically approved catalog and released reports remain planned.
