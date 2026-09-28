import { z } from 'zod';

export const RoleSchema = z.enum(['registration_clerk', 'technician', 'qualified_approver', 'administrator']);
export type Role = z.infer<typeof RoleSchema>;
export type Permission = 'patient:read' | 'patient:write' | 'catalog:read' | 'order:read' | 'order:write' | 'specimen:read' | 'specimen:write' | 'result:read' | 'result:write' | 'review:read' | 'admin:read' | 'audit:read';
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  registration_clerk: ['patient:read', 'patient:write', 'catalog:read', 'order:read', 'order:write', 'specimen:read', 'specimen:write', 'audit:read'],
  technician: ['patient:read', 'catalog:read', 'order:read', 'specimen:read', 'specimen:write', 'result:read', 'result:write', 'audit:read'],
  qualified_approver: ['patient:read', 'catalog:read', 'order:read', 'specimen:read', 'result:read', 'audit:read', 'review:read'],
  administrator: ['admin:read'],
};
export const ROLE_LABELS: Record<Role, string> = {
  registration_clerk: 'Registration Clerk', technician: 'Technician',
  qualified_approver: 'Qualified Approver', administrator: 'Administrator',
};
export interface SessionUser {
  id: string; username: string; displayName: string; role: Role;
  facilityId: string; facilityName: string; permissions: Permission[];
}
export interface AuthSession {
  user: SessionUser; csrfToken: string; expiresAt: string; authMode: 'development';
}
const validBirthDate = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10);
};
export const PatientDemographicsSchema = z.object({
  displayName: z.string().trim().min(6).max(100).regex(/^Demo\s+\S/, 'Use a synthetic name beginning with Demo '),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validBirthDate, 'Enter a valid date from 1900 through today'),
  sex: z.enum(['female', 'male', 'other', 'unknown']),
  preferredLanguage: z.enum(['en', 'hi']),
  synthetic: z.literal(true),
}).strict();
export type PatientDemographics = z.infer<typeof PatientDemographicsSchema>;
export interface Patient {
  id: string; facilityId: string; version: number; demographics: PatientDemographics;
  createdAt: string; updatedAt: string;
}
export const PatientCommandSchema = z.object({
  protocolVersion: z.literal(1), operationId: z.string().uuid(), entityId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(), kind: z.enum(['patient.create', 'patient.update']),
  payload: PatientDemographicsSchema,
}).strict().superRefine((command, context) => {
  if (command.kind === 'patient.create' && command.expectedVersion !== 0)
    context.addIssue({code: 'custom', path: ['expectedVersion'], message: 'Creation requires expectedVersion 0'});
  if (command.kind === 'patient.update' && command.expectedVersion < 1)
    context.addIssue({code: 'custom', path: ['expectedVersion'], message: 'Updates require an accepted or preceding local version'});
});
export type PatientCommand = z.infer<typeof PatientCommandSchema>;
export interface CommandResult { operationId: string; patient: Patient; replayed: boolean }
export interface PatientRevision {
  version: number; demographics: PatientDemographics; actorName: string; createdAt: string;
}
export interface AuditRecord {
  id: string; actorId: string; actorName: string; action: string; entityId: string;
  version: number; correlationId: string; occurredAt: string;
}
export interface PatientHistory { revisions: PatientRevision[]; audit: AuditRecord[] }
export const LoginSchema = z.object({username: z.string().min(1).max(80), password: z.string().min(1).max(200)}).strict();

export const CatalogStatusSchema = z.enum(['active', 'inactive']);
export type CatalogStatus = z.infer<typeof CatalogStatusSchema>;
export const TestSpecimenTypeSchema = z.enum(['whole_blood', 'serum', 'plasma', 'urine', 'swab']);
export type TestSpecimenType = z.infer<typeof TestSpecimenTypeSchema>;
export interface LaboratoryTest {
  id: string; code: string; name: string; specimenType: TestSpecimenType; unit?: string;
  referenceMetadata?: string; loincCode?: string; status: CatalogStatus;
}
export interface LaboratoryPanelItem { id: string; testId: string; testCode: string; testName: string; sortOrder: number }
export interface LaboratoryPanel {
  id: string; code: string; name: string; description?: string; status: CatalogStatus;
  items: LaboratoryPanelItem[];
}
export const OrderPrioritySchema = z.enum(['routine', 'urgent']);
export type OrderPriority = z.infer<typeof OrderPrioritySchema>;
export const OrderStatusSchema = z.enum(['ordered', 'cancelled']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export const OrderItemSchema = z.object({
  testId: z.string().uuid().optional(), panelId: z.string().uuid().optional(),
}).strict().superRefine((item, context) => {
  if ((item.testId ? 1 : 0) + (item.panelId ? 1 : 0) !== 1) context.addIssue({ code: 'custom', path: [], message: 'Choose exactly one test or panel.' });
});
export type OrderItemInput = z.infer<typeof OrderItemSchema>;
export const OrderCreatePayloadSchema = z.object({
  patientId: z.string().uuid(), priority: OrderPrioritySchema, note: z.string().trim().max(500).optional(), items: z.array(OrderItemSchema).min(1).max(20),
}).strict();
export type OrderCreatePayload = z.infer<typeof OrderCreatePayloadSchema>;
export const OrderCommandSchema = z.object({
  protocolVersion: z.literal(1), operationId: z.string().uuid(), entityId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(),
  kind: z.literal('order.create'), payload: OrderCreatePayloadSchema,
}).strict().superRefine((command, context) => {
  if (command.expectedVersion !== 0) context.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'Order creation requires expectedVersion 0' });
});
export type OrderCommand = z.infer<typeof OrderCommandSchema>;
export interface LaboratoryOrderItem { id: string; itemType: 'test' | 'panel'; test?: LaboratoryTest; panel?: LaboratoryPanel }
export interface OrderSpecimenAttempt {
  id: string; attemptNumber: number; status: SpecimenStatus; barcodeValue: string;
  accessionIdentifier?: string; createdAt: string; collectedAt?: string; receivedAt?: string;
}
export interface LaboratoryOrder {
  id: string; facilityId: string; patientId: string; patientName: string; version: number; status: OrderStatus;
  priority: OrderPriority; note?: string; orderedBy: string; orderedAt: string; updatedAt: string; items: LaboratoryOrderItem[];
  specimen?: OrderSpecimenAttempt;
  specimens: OrderSpecimenAttempt[];
}
export const SpecimenStatusSchema = z.enum(['ordered', 'collection_pending', 'collected', 'received_accession_pending', 'accepted', 'rejected', 'recollection_required']);
export type SpecimenStatus = z.infer<typeof SpecimenStatusSchema>;
export const SpecimenTransitionSchema = z.enum(['specimen.create', 'specimen.collect', 'specimen.receive', 'specimen.accept', 'specimen.reject', 'specimen.recollect']);
export type SpecimenTransition = z.infer<typeof SpecimenTransitionSchema>;
export const SpecimenCommandPayloadSchema = z.object({
  orderId: z.string().uuid().optional(), specimenType: TestSpecimenTypeSchema.optional(), notes: z.string().trim().max(500).optional(), reason: z.string().trim().min(2).max(500).optional(),
}).strict();
export const SpecimenCommandSchema = z.object({
  protocolVersion: z.literal(1), operationId: z.string().uuid(), entityId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(),
  kind: SpecimenTransitionSchema, payload: SpecimenCommandPayloadSchema,
}).strict().superRefine((command, context) => {
  if (command.kind === 'specimen.create' && command.expectedVersion !== 0) {
    context.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'Specimen creation requires expectedVersion 0' });
  }
  if (command.kind === 'specimen.create' && !command.payload.orderId) {
    context.addIssue({ code: 'custom', path: ['payload', 'orderId'], message: 'Specimen creation requires an order' });
  }
  if ((command.kind === 'specimen.reject' || command.kind === 'specimen.recollect') && !command.payload.reason) {
    context.addIssue({ code: 'custom', path: ['payload', 'reason'], message: 'This transition requires a reason' });
  }
  if (!['specimen.reject', 'specimen.recollect'].includes(command.kind) && command.payload.reason) {
    context.addIssue({ code: 'custom', path: ['payload', 'reason'], message: 'A reason is only valid for reject or recollect transitions' });
  }
});
export type SpecimenCommand = z.infer<typeof SpecimenCommandSchema>;
export interface Accession {
  id: string; identifier: string; barcodeValue: string; specimenId: string; orderId: string; patientId: string;
  receivedAt?: string; receivedBy?: string; decision?: 'accepted' | 'rejected'; rejectionReason?: string;
}
export interface SpecimenEvent { id: string; specimenId?: string; attemptNumber?: number; fromStatus?: SpecimenStatus; toStatus: SpecimenStatus; action: string; actorName: string; reason?: string; occurredAt: string; correlationId: string }
export interface Specimen {
  id: string; facilityId: string; patientId: string; patientName: string; orderId: string; attemptNumber: number; version: number;
  specimenType: TestSpecimenType; status: SpecimenStatus; barcodeValue: string; collectedAt?: string; collectedBy?: string;
  receivedAt?: string; receivedBy?: string; notes?: string; rejectionReason?: string; recollectionReason?: string;
  accession?: Accession; lookupMatchedAccessionId?: string; lookupIsHistorical?: boolean; createdAt: string; updatedAt: string;
}
export interface WorkflowCommandResult { operationId: string; order?: LaboratoryOrder; specimen?: Specimen; result?: AnalyticalResult; replayed: boolean }
export interface OrderHistory { events: SpecimenEvent[]; audit: AuditRecord[] }

// Phase 3 transports decimals as strings. Values may be incomplete in drafts;
// only the server evaluates them against a versioned synthetic policy.
export const ResultValueSchema = z.object({
  kind: z.enum(['numeric', 'text', 'coded']), value: z.string().max(2000), unit: z.string().max(40).optional(),
}).strict();
export type ResultValue = z.infer<typeof ResultValueSchema>;
export interface ResultPolicy {
  version: string; label: string; synthetic: true; valueKind: ResultValue['kind'];
  expectedUnit?: string; lower?: string; upper?: string; criticalLower?: string; criticalUpper?: string;
  allowedValues?: string[]; expectedValue?: string;
}
export type ResultStatus = 'draft' | 'entered' | 'validated' | 'analytically_ready';
export type ResultFlag = 'not_evaluated' | 'normal' | 'low' | 'high' | 'abnormal' | 'not_applicable';
export type CriticalState = 'not_evaluated' | 'none' | 'low' | 'high';
export interface ResultValidation {
  outcome: 'not_run' | 'passed' | 'failed'; issues: Array<{ code: string; message: string }>;
  flag: ResultFlag; critical: CriticalState; evaluatedAt?: string;
}
export interface ResultQc {
  status: 'missing' | 'pass' | 'fail'; reason?: string; checkedBy?: string; checkedAt?: string;
}
export interface AnalyticalResult {
  id: string; facilityId: string; patientId: string; patientName: string; orderId: string; orderItemId: string;
  testId: string; testCode: string; testName: string; specimenId: string; accessionId: string; accessionIdentifier: string;
  version: number; status: ResultStatus; value: ResultValue; policy: ResultPolicy;
  validation: ResultValidation; qc: ResultQc; readiness: 'pending' | 'blocked' | 'ready';
  criticalReviewRequired: boolean; enteredBy?: string; enteredAt?: string; createdAt: string; updatedAt: string;
}
export interface ResultRevision {
  id: string; resultId: string; version: number; previousVersion?: number;
  action: string; actorId: string; actorName: string; reason?: string; createdAt: string;
  snapshot: AnalyticalResult;
}
export interface ResultHistory { revisions: ResultRevision[]; audit: AuditRecord[] }
export interface AnalyticalWorkItem {
  specimenId: string; specimenBarcode: string; accessionId: string; accessionIdentifier: string;
  patientId: string; patientName: string; orderId: string; orderItemId: string;
  testId: string; testCode: string; testName: string; policy: ResultPolicy; result?: AnalyticalResult;
}
const resultCommandBase = {
  protocolVersion: z.literal(1), operationId: z.string().uuid(), entityId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
};
export const ResultCommandSchema = z.discriminatedUnion('kind', [
  z.object({ ...resultCommandBase, kind: z.literal('result.create'), expectedVersion: z.literal(0), payload: z.object({
    specimenId: z.string().uuid(), accessionId: z.string().uuid(), orderItemId: z.string().uuid(),
    testId: z.string().uuid(), value: ResultValueSchema,
  }).strict() }).strict(),
  z.object({ ...resultCommandBase, kind: z.literal('result.revise'), expectedVersion: z.number().int().positive(), payload: z.object({
    value: ResultValueSchema, reason: z.string().trim().min(3).max(500),
  }).strict() }).strict(),
  z.object({ ...resultCommandBase, kind: z.literal('result.enter'), expectedVersion: z.number().int().positive(), payload: z.object({}).strict() }).strict(),
  z.object({ ...resultCommandBase, kind: z.literal('result.validate'), expectedVersion: z.number().int().positive(), payload: z.object({}).strict() }).strict(),
  z.object({ ...resultCommandBase, kind: z.literal('result.qc'), expectedVersion: z.number().int().positive(), payload: z.object({
    status: z.enum(['pass', 'fail']), reason: z.string().trim().min(3).max(500),
  }).strict() }).strict(),
  z.object({ ...resultCommandBase, kind: z.literal('result.readiness'), expectedVersion: z.number().int().positive(), payload: z.object({}).strict() }).strict(),
]);
export type ResultCommand = z.infer<typeof ResultCommandSchema>;
export type ResultDraftCommand = Extract<ResultCommand, { kind: 'result.create' | 'result.revise' }>;
