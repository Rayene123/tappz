import { Module } from '@nestjs/common';
import { ChatModule } from './chat/chat.module.js';

@Module({
  imports: [ChatModule],
  controllers: [],
  providers: [],
})
export class AppModule {}