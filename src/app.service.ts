import { Injectable } from '@nestjs/common';
//src/app.service.ts
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
