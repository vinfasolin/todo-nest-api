import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt.guard';

@Controller()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me
   * Header: Authorization: Bearer <JWT da sua API>
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const user = req.user as AuthUser;

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.uid },
      select: {
        id: true,
        googleSub: true,
        email: true,
        name: true,
        picture: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ok: true,
      user: dbUser,
    };
  }
}
