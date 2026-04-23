import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { MemoryService } from '../memory/memory.service.js';

@Module({
  controllers: [ChatController],
  providers: [ChatService, MemoryService],
  exports: [ChatService],
})
export class ChatModule {}