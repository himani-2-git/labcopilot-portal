import { BadRequestException, Controller, Get, HttpCode, Inject, Post, Req, Res, Body } from '@nestjs/common';
import { ApiTags, ApiCookieAuth, ApiBody, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
const LoginSchema = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) }).strict();

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post('login') @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with a seeded development identity (development/test only)' })
  @ApiBody({ schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string', format: 'password' } } } })
  login(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Username and password are required.');
    return this.auth.login(request, response, parsed.data.username, parsed.data.password);
  }
  @Get('session') @ApiCookieAuth()
  session(@Req() request: Request) { return this.auth.session(request); }
  @Post('logout') @HttpCode(200) @ApiCookieAuth()
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { return this.auth.logout(request, response); }
}
