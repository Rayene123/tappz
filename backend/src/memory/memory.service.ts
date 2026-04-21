export class MemoryService {
  private sessions: Record<string, string[]> = {};

  get(sessionId: string): string[] {
    return this.sessions[sessionId] || [];
  }

  add(sessionId: string, message: string) {
    if (!this.sessions[sessionId]) this.sessions[sessionId] = [];
    this.sessions[sessionId].push(message);
    if (this.sessions[sessionId].length > 10) {
      this.sessions[sessionId] = this.sessions[sessionId].slice(-10);
    }
  }
}