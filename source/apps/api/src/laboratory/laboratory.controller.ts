import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { OrderCommandSchema, SpecimenCommandSchema } from '@labcopilot/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { LaboratoryService } from './laboratory.service';

const Uuid = z.string().uuid();
function uuid(value: string) { if (!Uuid.safeParse(value).success) throw new BadRequestException('A valid UUID is required.'); return value; }
function correlation(request: Request) { const header = request.headers['x-correlation-id']; return typeof header === 'string' && Uuid.safeParse(header).success ? header : randomUUID(); }

@ApiTags('Laboratory catalog') @ApiCookieAuth()
@Controller('catalog')
export class CatalogController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(LaboratoryService) private readonly laboratory: LaboratoryService) {}
  @Get('tests') async tests(@Req() request: Request) { await this.auth.authorize(request, 'catalog:read', false, true); return this.laboratory.listTests(); }
  @Get('panels') async panels(@Req() request: Request) { await this.auth.authorize(request, 'catalog:read', false, true); return this.laboratory.listPanels(); }
}

@ApiTags('Laboratory workflow') @ApiCookieAuth()
@Controller()
export class LaboratoryController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(LaboratoryService) private readonly laboratory: LaboratoryService) {}
  @Get('orders') async orders(@Req() request: Request) { const { user } = await this.auth.authorize(request, 'order:read', false, true); return this.laboratory.listOrders(user); }
  @Get('orders/:id') async order(@Req() request: Request, @Param('id') id: string) { const { user } = await this.auth.authorize(request, 'order:read', false, true); return this.laboratory.getOrder(user, uuid(id)); }
  @Get('orders/:id/history') async orderHistory(@Req() request: Request, @Param('id') id: string) { const { user } = await this.auth.authorize(request, 'order:read', false, true); return this.laboratory.orderHistory(user, uuid(id)); }
  @Post('orders/commands') @HttpCode(200) async orderCommand(@Req() request: Request, @Body() body: unknown) { const { user } = await this.auth.authorize(request, 'order:write', true, true); const parsed = OrderCommandSchema.safeParse(body); if (!parsed.success) throw new BadRequestException({ message: 'Invalid laboratory order command.', issues: parsed.error.issues }); return this.laboratory.orderCommand(user, parsed.data, correlation(request)); }
  @Get('specimens') async specimens(@Req() request: Request) { const { user } = await this.auth.authorize(request, 'specimen:read', false, true); return this.laboratory.listSpecimens(user); }
  @Get('specimens/:id') async specimen(@Req() request: Request, @Param('id') id: string) { const { user } = await this.auth.authorize(request, 'specimen:read', false, true); return this.laboratory.getSpecimen(user, uuid(id)); }
  @Get('specimens/:id/history') async specimenHistory(@Req() request: Request, @Param('id') id: string) { const { user } = await this.auth.authorize(request, 'specimen:read', false, true); return this.laboratory.specimenHistory(user, uuid(id)); }
  @Post('specimens/commands') @HttpCode(200) async specimenCommand(@Req() request: Request, @Body() body: unknown) { const { user } = await this.auth.authorize(request, 'specimen:write', true, true); const parsed = SpecimenCommandSchema.safeParse(body); if (!parsed.success) throw new BadRequestException({ message: 'Invalid specimen workflow command.', issues: parsed.error.issues }); return this.laboratory.specimenCommand(user, parsed.data, correlation(request)); }
  @Get('accessions/:identifier') async accession(@Req() request: Request, @Param('identifier') identifier: string) { const { user } = await this.auth.authorize(request, 'specimen:read', false, true); return this.laboratory.lookupAccession(user, identifier.trim()); }
}
