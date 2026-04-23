import { FormEvent, useEffect, useRef, useState } from 'react';

type Citation = {
  id: number;
  sourceTitle: string;
  excerpt: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  meta?: {
    intent?: string;
    usedContext?: boolean;
    rewrittenQuery?: string;
  };
};

type ChatResponse = {
  answer: string;
  citations: Citation[];
  intent?: string;
  usedContext?: boolean;
  rewrittenQuery?: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

const STARTER_PROMPTS = [
  'Tell me about Egypt.',
  'What about its economy?',
  'Compare the economies of Tunisia and Morocco.',
  'What is the capital of France?',
];

function createSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

async function sendChatMessage(message: string, sessionId: string): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Chat request failed');
  }

  return (await response.json()) as ChatResponse;
}

async function clearSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat/clear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error('Failed to clear session');
  }
}

export default function App() {
  const [sessionId, setSessionId] = useState<string>(createSessionId);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, isSending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setMessage('');
    setError(null);
    setIsSending(true);

    try {
      const result = await sendChatMessage(trimmed, sessionId);

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        meta: {
          intent: result.intent,
          usedContext: result.usedContext,
          rewrittenQuery: result.rewrittenQuery,
        },
      };

      setMessages((current) => [...current, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSending(false);
    }
  }

  async function handleReset() {
    setError(null);
    try {
      await clearSession(sessionId);
    } catch {
      // Ignore backend reset failures and still rotate the session locally.
    }

    setMessages([]);
    setSessionId(createSessionId());
  }

  function handlePromptClick(prompt: string) {
    setMessage(prompt);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Tappz</p>
          <h1>RAG Chat Console</h1>
          <p className="sidebar-copy">
            Talk to the backend QA system with session memory, follow-up handling,
            and citations when grounding is used.
          </p>
        </div>

        <div className="config-card">
          <span className="label">Backend</span>
          <code>{API_BASE_URL}</code>
        </div>

        <div className="config-card">
          <span className="label">Session</span>
          <code>{sessionId}</code>
        </div>

        <div className="prompt-card">
          <span className="label">Starter Prompts</span>
          <div className="prompt-list">
            {STARTER_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="prompt-chip"
                onClick={() => handlePromptClick(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="reset-button" onClick={handleReset}>
          New Chat Session
        </button>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Hybrid QA</p>
            <h2>Document-grounded when useful, model-native when appropriate</h2>
          </div>
        </header>

        <div className="chat-log" ref={scrollerRef}>
          {messages.length === 0 ? (
            <section className="empty-state">
              <h3>Start a conversation</h3>
              <p>
                Ask a general question, a RAG-backed question, or try a follow-up in
                the same session.
              </p>
            </section>
          ) : (
            messages.map((entry) => (
              <article key={entry.id} className={`bubble bubble-${entry.role}`}>
                <div className="bubble-role">
                  {entry.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <p className="bubble-content">{entry.content}</p>

                {entry.role === 'assistant' && entry.meta ? (
                  <div className="meta-row">
                    {entry.meta.intent ? <span>{entry.meta.intent}</span> : null}
                    {typeof entry.meta.usedContext === 'boolean' ? (
                      <span>{entry.meta.usedContext ? 'grounded' : 'general knowledge'}</span>
                    ) : null}
                    {entry.meta.rewrittenQuery &&
                    entry.meta.rewrittenQuery !== entry.content ? (
                      <span>query: {entry.meta.rewrittenQuery}</span>
                    ) : null}
                  </div>
                ) : null}

                {entry.citations && entry.citations.length > 0 ? (
                  <div className="citations">
                    <div className="citation-title">Citations</div>
                    {entry.citations.map((citation) => (
                      <div key={`${entry.id}-${citation.id}`} className="citation-card">
                        <div className="citation-source">
                          [{citation.id}] {citation.sourceTitle}
                        </div>
                        <p>{citation.excerpt}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          )}

          {isSending ? <div className="thinking">Thinking…</div> : null}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="composer-label" htmlFor="message">
            Message
          </label>
          <div className="composer-row">
            <textarea
              id="message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask about a country, try a follow-up, or compare entities…"
              rows={3}
              disabled={isSending}
            />
            <button type="submit" disabled={isSending || message.trim().length === 0}>
              Send
            </button>
          </div>
          {error ? <p className="error-banner">{error}</p> : null}
        </form>
      </main>
    </div>
  );
}
