import { Body, Controller, Delete, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AuthUser } from '../auth/jwt.guard';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const user = req.user as AuthUser;
    const dbUser = await this.users.getMe(user.uid);
    return { ok: true, user: dbUser };
  }

  // ✅ PATCH /me -> name/picture (Google e Local)
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@Req() req: any, @Body() body: { name?: any; picture?: any }) {
    const user = req.user as AuthUser;
    const updated = await this.users.updateProfile(user.uid, body);
    return { ok: true, user: updated };
  }

  // ✅ PATCH /me/email -> somente Local + token novo
  @UseGuards(JwtAuthGuard)
  @Patch('me/email')
  async changeEmail(@Req() req: any, @Body() body: { newEmail?: any; password?: any }) {
    const user = req.user as AuthUser;
    const { user: updated, token } = await this.users.changeEmail(user.uid, body);
    return { ok: true, token, user: updated };
  }

  // ✅ PATCH /me/password -> somente Local
  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  async changePassword(@Req() req: any, @Body() body: { currentPassword?: any; newPassword?: any }) {
    const user = req.user as AuthUser;
    await this.users.changePassword(user.uid, body);
    return { ok: true };
  }

  // ✅ DELETE /me -> excluir usuário
  @UseGuards(JwtAuthGuard)
  @Delete('me')
  async deleteMe(@Req() req: any, @Body() body: { password?: any }) {
    const user = req.user as AuthUser;
    return await this.users.deleteMe(user.uid, body);
  }
}