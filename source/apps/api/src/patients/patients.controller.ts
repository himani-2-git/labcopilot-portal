import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientCommandSchema } from '@labcopilot/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { PatientsService } from './patients.service';
import { randomUUID } from 'node:crypto';
const Uuid = z.string().uuid();
function id(value: string) { if (!Uuid.safeParse(value).success) throw new BadRequestException('A valid UUID is required.'); return value; }

@ApiTags('Patient drafts') @ApiCookieAuth()
@Controller('patients')
export class PatientsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(PatientsService) private readonly patients: PatientsService) {}
  @Get()
  async list(@Req() request: Request) { const { user } = await this.auth.authorize(request, 'patient:read', false, true); return this.patients.list(user); }
  @Get(':id')
  async get(@Req() request: Request, @Param('id') patientId: string) { const { user } = await this.auth.authorize(request, 'patient:read', false, true); return this.patients.get(user, id(patientId)); }
  @Get(':id/history')
  async history(@Req() request: Request, @Param('id') patientId: string) { const { user } = await this.auth.authorize(request, 'patient:read', false, true); return this.patients.history(user, id(patientId)); }
  @Post('commands') @HttpCode(200)
  @ApiOperation({ summary: 'Atomically create/update a synthetic patient, immutable revision, audit and idempotency receipt' })
  @ApiBody({ schema: { type: 'object', required: ['protocolVersion', 'operationId', 'entityId', 'expectedVersion', 'kind', 'payload'], properties: { protocolVersion: { type: 'integer', enum: [1] }, operationId: { type: 'string', format: 'uuid' }, entityId: { type: 'string', format: 'uuid' }, expectedVersion: { type: 'integer', minimum: 0 }, kind: { type: 'string', enum: ['patient.create', 'patient.update'] }, payload: { type: 'object', required: ['displayName', 'dateOfBirth', 'sex', 'preferredLanguage', 'synthetic'], properties: { displayName: { type: 'string', pattern: '^Demo ' }, dateOfBirth: { type: 'string', format: 'date' }, sex: { type: 'string', enum: ['female', 'male', 'other', 'unknown'] }, preferredLanguage: { type: 'string', enum: ['en', 'hi'] }, synthetic: { type: 'boolean', enum: [true] } } } } } })
  async command(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.auth.authorize(request, 'patient:write', true, true);
    const parsed = PatientCommandSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid synthetic patient command.', issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) });
    const header = request.headers['x-correlation-id'];
    const correlationId = typeof header === 'string' && Uuid.safeParse(header).success ? header : randomUUID();
    return this.patients.command(user, parsed.data, correlationId);
  }
}

