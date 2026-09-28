# LabCopilot Phase 1 API

NestJS REST API for synthetic patient drafts, PostgreSQL persistence, development sessions, facility-scoped authorization and atomic versioned commands. Production authentication and clinical laboratory workflows are not implemented.

## Run locally

Run workspace setup from `source/` first. It creates a private, ignored `.env` with generated database and demo credentials. Do not replace generated values with credentials from another system.

```powershell
pnpm setup:local
pnpm db:start
pnpm --filter @labcopilot/contracts build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm --filter @labcopilot/api dev
```

The API listens on loopback at `http://127.0.0.1:3001`. `PORT` changes the port. The web application's exact origin must match `WEB_ORIGIN`, normally `http://localhost:5173`. Development auth requires both `NODE_ENV=development` and `AUTH_MODE=development`; any production configuration is rejected during startup. `COOKIE_SECURE=true` requires HTTPS and is intentionally not enabled for the local HTTP demo.

Swagger/OpenAPI is at `/api/docs`. API routes use `/api/v1`. The Vite app proxies `/api` to this process so browsers can use one origin.

## Authentication and authorization

The injected `AUTH_PROVIDER` interface isolates the credential adapter from session and authorization services. The only implemented adapter validates locally seeded usernames against salted scrypt hashes. Keycloak issuer, callback, PKCE and token validation must be added before OIDC is available; no password grant or counterfeit OIDC endpoint is provided.

The five seeded identities are `clerk`, `technician`, `approver`, `admin`, and `other-clerk`. Their password is the private generated `DEMO_PASSWORD` in `source/.env`. The first four belong to one demo facility; `other-clerk` belongs to a second facility for isolation checks. Re-seeding rotates stored password hashes and revokes their sessions.

Sessions use random opaque bearer values in HttpOnly, SameSite=Strict cookies. Only a SHA-256 hash of the bearer is persisted. Sessions expire after eight hours. Server reads current active status, role and facility for each authorized request. Mutations require the exact origin and a session-bound CSRF token. Patient queries and commands additionally require the active workspace user/facility headers, preventing an old browser tab from synchronizing under a replacement cookie.

| Role | Phase 1 permission |
| --- | --- |
| Registration Clerk | Create/read/edit synthetic patient demographics and read their history within own facility |
| Technician | Read patients and history within own facility |
| Qualified Approver | Read patients/history and access the clearly labelled unimplemented review queue |
| Administrator | Read administrative configuration; no patient or clinical approval authority |

The local login rate limiter permits 20 attempts per IP per minute per API process. It is a development safeguard, not a production identity or edge policy.

## Endpoints

| Method and route | Behavior |
| --- | --- |
| `GET /health` | Database readiness and explicit phase/auth mode |
| `POST /auth/login` | Development credential exchange; sets cookie and returns user, expiry and CSRF token |
| `GET /auth/session` | Current authenticated session |
| `POST /auth/logout` | Invalidates the session and clears cookie; origin and CSRF protected |
| `GET /patients` | Latest 500 patients within current facility |
| `GET /patients/:id` | One scoped patient |
| `GET /patients/:id/history` | Immutable revisions and audit entries for a scoped patient |
| `POST /patients/commands` | Accept a versioned patient create/update command |
| `GET /admin/config` | Administrative configuration summary |
| `GET /review/queue` | Honest future-work placeholder; returns `implemented: false` and no approval actions |

Patient requests require `X-Workspace-User-ID` and `X-Workspace-Facility-ID` matching the authenticated session. Mutation requests also require `X-CSRF-Token`. `X-Correlation-ID` accepts a UUID; the server generates one when absent or invalid.

The shared `PatientCommandSchema` is authoritative for transport validation. Commands contain protocol version 1, operation UUID, entity UUID, kind (`patient.create` or `patient.update`), expected version and a complete demographic payload. Creation expects version 0; updates expect an accepted version of at least 1. Inputs must declare `synthetic: true` and a name beginning with `Demo` plus whitespace. Patient fields remain escaped text in the frontend.

## Transaction and evidence

An accepted command atomically writes the patient, one immutable patient revision, an audit event and its idempotency receipt. Receipts are scoped by actor and operation ID. A transaction-scoped PostgreSQL advisory lock serializes identical operations; optimistic `UPDATE ... WHERE version = expectedVersion` prevents concurrent edits from overwriting one another. An identical retry returns its stored result with `replayed: true`. Changed content under the same operation ID returns a conflict. Authorization is rechecked before replay.

Validation errors return 400, unavailable authentication 401, denied permissions/origin/workspace/CSRF 403, absent or out-of-facility patients 404, and version/idempotency conflicts 409. This is the implemented Phase 1 error subset; the blueprint's full problem-details protocol is deferred. Unexpected internal details are not returned to clients.

The migration includes positive-version and synthetic-only constraints, indexes, foreign keys, and database triggers rejecting update/delete on revisions and audit events. A database owner can bypass those triggers. Least-privilege deployment roles and tamper-evident retention are later hardening work. The local runtime uses the generated development database role.

## Tests

```powershell
pnpm --filter @labcopilot/api build
pnpm --filter @labcopilot/api typecheck
pnpm --filter @labcopilot/api test
```

Integration tests require `TEST_DATABASE_URL` to reference a dedicated database whose name ends in `_test`. They refuse to run without it, deploy migrations there, seed synthetic test users with a random test-only password and append uniquely identified fixtures. They do not reset/drop the development database. Test data remains in the isolated test database between runs. API tests target compiled NestJS output, avoiding decorators/metadata changes in the Vitest transform.

Coverage includes real database readiness, cookie/session expiry and logout, CSRF/origin protection, role and facility isolation, same-facility cookie swaps, current-permission checks before receipt replay, durable patient changes, audit/correlation, immutable history, concurrent duplicate operations, stale edits, validation and database evidence/synthetic constraints. The command output and project state record the actual test result; this README does not assert an unrun check passed.

## Deliberate boundaries

Only authoritative patient writes generate audit events in this phase. Login, failed access, reads and exports do not yet produce a security event trail. Session cleanup/rotation policy, shared rate limiting, device registration, scoped grants, full paginated working-set synchronization, retention and production RBAC qualifiers are future work. Patient list results are capped at 500 and are not a full synchronization feed. Clinical review, result entry, AI, reports, FHIR/HL7, and Keycloak production integration remain unimplemented.
