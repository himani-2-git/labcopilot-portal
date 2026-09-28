import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { ResultCommandSchema } from '@labcopilot/contracts';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { ResultsService } from './results.service';

const Uuid = z.string().uuid();
function uuid(value: string) { if (!Uuid.safeParse(value).success) throw new BadRequestException('A valid UUID is required.'); return value; }
@ApiTags('Analytical results') @ApiCookieAuth() @Controller('results')
export class ResultsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(ResultsService) private readonly results: ResultsService) {}
  @Get('worklist') async worklist(@Req() request: Request) { const { user } = await this.auth.authorize(request, 'result:read', false, true); return this.results.worklist(user); }
  @Get() async list(@Req() request: Request) { const { user } = await this.auth.authorize(request, 'result:read', false, true); return this.results.list(user); }
  @Get(':id') async get(@Req() request: Request, @Param('id') id: string) { const { user } = await this.auth.authorize(request, 'result:read', false, true); return this.results.get(user, uuid(id)); }
  @Get(':id/history') async history(@Req() request: Request, @Param('id') id: string) { const { user } = await this.auth.authorize(request, 'result:read', false, true); return this.results.history(user, uuid(id)); }
  @Post('commands') @HttpCode(200) async command(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.auth.authorize(request, 'result:write', true, true);
    const parsed = ResultCommandSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid analytical result command.', issues: parsed.error.issues });
    const correlationId = request.headers['x-correlation-id'];
    return this.results.command(user, parsed.data, typeof correlationId === 'string' && Uuid.safeParse(correlationId).success ? correlationId : randomUUID());
  }
}
