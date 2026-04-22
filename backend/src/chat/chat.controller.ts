import { Controller, Post, Body, Res, HttpCode } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ChatService } from './chat.service';
import { z } from 'zod';

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().min(1).max(128),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat')
  @HttpCode(200)
  async chat(@Body() body: unknown, @Res() reply: FastifyReply) {
    // Validate request body
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parsed.error.flatten(),
      });
    }

    const { message, sessionId } = parsed.data;

    try {
      await this.chatService.streamChat({ message, sessionId, reply });
    } catch (err) {
      // If headers not sent yet, send error response
      if (!reply.sent) {
        return reply.status(500).send({
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  @Post('chat/clear')
  @HttpCode(200)
  clearSession(@Body() body: { sessionId: string }) {
    this.chatService.clearSession(body.sessionId);
    return { success: true };
  }
}