import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { MemoryService } from '../memory/memory.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, MemoryService],
  exports: [ChatService],
})
export class ChatModule {}