import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  hello() {
    return 'OK';
  }

  @Get('db')
  async dbTest() {
    const rows = await this.prisma.playingWithNeon.findMany({
      take: 5,
      orderBy: { id: 'desc' },
    });

    return { ok: true, rows };
  }
}
