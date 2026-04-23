import { Injectable } from '@nestjs/common';

export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  role: Role;
  content: string;
}

export interface SessionState {
  history: Message[];
  lastEntity?: string;
}

const WINDOW_SIZE = 10;

@Injectable()
export class MemoryService {
  private sessions: Map<string, SessionState> = new Map();

  private getOrCreateSession(sessionId: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const created: SessionState = { history: [] };
    this.sessions.set(sessionId, created);
    return created;
  }

  getHistory(sessionId: string): Message[] {
    return this.sessions.get(sessionId)?.history ?? [];
  }

  addMessage(sessionId: string, message: Message): void {
    const session = this.getOrCreateSession(sessionId);
    const history = session.history;

    history.push(message);

    session.history =
      history.length > WINDOW_SIZE ? history.slice(-WINDOW_SIZE) : history;
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getTextHistory(sessionId: string): string[] {
    return this.getHistory(sessionId).map(
      (m) => `${m.role}: ${m.content}`,
    );
  }

  getLastEntity(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.lastEntity;
  }

  setLastEntity(sessionId: string, entity?: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.lastEntity = entity?.trim() || undefined;
  }
}
