import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/auth.guard';

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout session' })
  async logout() {
    return { success: true };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get currently authenticated user details' })
  async getMe(@Req() req: any) {
    return this.authService.getMe(req.user.userId);
  }
}
