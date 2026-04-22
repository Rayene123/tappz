import { Injectable } from '@nestjs/common';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const WINDOW_SIZE = 10;

@Injectable()
export class MemoryService {
  private sessions: Map<string, Message[]> = new Map();

  getHistory(sessionId: string): Message[] {
    return this.sessions.get(sessionId) ?? [];
  }

  addMessage(sessionId: string, message: Message): void {
    const history = this.sessions.get(sessionId) ?? [];
    history.push(message);
    // Keep only last WINDOW_SIZE messages
    const windowed = history.length > WINDOW_SIZE ? history.slice(-WINDOW_SIZE) : history;
    this.sessions.set(sessionId, windowed);
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getTextHistory(sessionId: string): string[] {
    return this.getHistory(sessionId).map((m) => `${m.role}: ${m.content}`);
  }
}