import { Controller, Get, Inject, Module, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DatabaseService } from './database';
import { AUTH_PROVIDER } from './auth/auth-provider';
import { AuthService, DevelopmentAuthProvider } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { PatientsController } from './patients/patients.controller';
import { PatientsService } from './patients/patients.service';
import { CatalogController, LaboratoryController } from './laboratory/laboratory.controller';
import { LaboratoryService } from './laboratory/laboratory.service';
import { ResultsController } from './results/results.controller';
import { ResultsService } from './results/results.service';

@ApiTags('Foundation')
@Controller()
export class FoundationController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(AuthService) private readonly auth: AuthService) {}
  @Get('health')
  async health() {
    try { await this.db.$queryRaw`SELECT 1`; } catch { throw new ServiceUnavailableException('Database unavailable.'); }
    return { status: 'ok', database: 'connected', phase: 3, syntheticOnly: true, authMode: 'development' };
  }
  @Get('admin/config') @ApiCookieAuth()
  async config(@Req() request: Request) {
    const { user } = await this.auth.authorize(request, 'admin:read');
    return { facilityId: user.facilityId, facilityName: user.facilityName, authMode: 'development', syntheticOnly: true, phase: 3, clinicalApprovalGranted: false };
  }
  @Get('review/queue') @ApiCookieAuth()
  async review(@Req() request: Request) {
    await this.auth.authorize(request, 'review:read');
    return { items: [], implemented: false, message: 'Clinical review is planned. Analytical results are available for read-only inspection; no clinical approval or report-release actions exist.' };
  }
}

@Module({ controllers: [FoundationController, AuthController, PatientsController, CatalogController, LaboratoryController, ResultsController], providers: [DatabaseService, AuthService, DevelopmentAuthProvider, { provide: AUTH_PROVIDER, useExisting: DevelopmentAuthProvider }, PatientsService, LaboratoryService, ResultsService] })
export class AppModule {}
