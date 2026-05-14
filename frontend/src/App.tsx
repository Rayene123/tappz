import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

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

type Conversation = {
  id: string;
  title: string;
  sessionId: string;
  messages: ChatMessage[];
};

type ChatResponse = {
  answer: string;
  citations: Citation[];
  intent?: string;
  usedContext?: boolean;
  rewrittenQuery?: string;
};

type StreamedChatMeta = {
  __citations?: Citation[];
  intent?: string;
  usedContext?: boolean;
  rewrittenQuery?: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

const DEFAULT_ASSISTANT_PROMPT =
  'Hello! I am your country expert. Ask me about capitals, geography, languages, populations, or comparisons, and I will answer clearly with citations when sources are available.';

function createSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    sessionId: createSessionId(),
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: DEFAULT_ASSISTANT_PROMPT,
      },
    ],
  };
}

async function streamChatMessage(
  message: string,
  sessionId: string,
  onDelta: (chunk: string, fullText: string) => void,
): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!response.ok) {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string; answer?: string };
      throw new Error(parsed.error ?? parsed.message ?? parsed.answer ?? 'Chat request failed');
    } catch {
      throw new Error(text || 'Chat request failed');
    }
  }

  if (!response.body) {
    const text = await response.text();
    return parseStreamedChatResponse(text);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const delimiter = '\n\n__CITATIONS__\n';
  let buffer = '';
  let answer = '';
  let metaBuffer = '';
  let foundDelimiter = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    if (!foundDelimiter) {
      const delimiterIndex = buffer.indexOf(delimiter);

      if (delimiterIndex === -1) {
        const safeLength = Math.max(0, buffer.length - (delimiter.length - 1));
        if (safeLength > 0) {
          const chunk = buffer.slice(0, safeLength);
          answer += chunk;
          onDelta(chunk, answer);
          buffer = buffer.slice(safeLength);
        }
      } else {
        const chunk = buffer.slice(0, delimiterIndex);
        if (chunk) {
          answer += chunk;
          onDelta(chunk, answer);
        }
        buffer = buffer.slice(delimiterIndex + delimiter.length);
        foundDelimiter = true;
        metaBuffer += buffer;
        buffer = '';
      }
    } else {
      metaBuffer += buffer;
      buffer = '';
    }
  }

  buffer += decoder.decode();

  if (!foundDelimiter) {
    if (buffer) {
      answer += buffer;
      onDelta(buffer, answer);
    }
    return {
      answer: answer.trim(),
      citations: [],
    };
  }

  metaBuffer += buffer;
  const metaText = metaBuffer.trim();
  try {
    const meta = JSON.parse(metaText) as StreamedChatMeta;
    return {
      answer: answer.trim(),
      citations: meta.__citations ?? [],
      intent: meta.intent,
      usedContext: meta.usedContext,
      rewrittenQuery: meta.rewrittenQuery,
    };
  } catch {
    return {
      answer: answer.trim(),
      citations: [],
    };
  }
}

function parseStreamedChatResponse(payload: string): ChatResponse {
  const trimmed = payload.trim();
  const delimiter = '\n\n__CITATIONS__\n';
  const delimiterIndex = trimmed.lastIndexOf(delimiter);

  if (delimiterIndex !== -1) {
    const answer = trimmed.slice(0, delimiterIndex).trim();
    const metaText = trimmed.slice(delimiterIndex + delimiter.length).trim();

    try {
      const meta = JSON.parse(metaText) as StreamedChatMeta;
      return {
        answer,
        citations: meta.__citations ?? [],
        intent: meta.intent,
        usedContext: meta.usedContext,
        rewrittenQuery: meta.rewrittenQuery,
      };
    } catch {
      return {
        answer: trimmed,
        citations: [],
      };
    }
  }

  return {
    answer: trimmed,
    citations: [],
  };
}

function renderAssistantContent(content: string) {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  return lines.map((line, index) => {
    const cleaned = line.replace(/\*\*(.+?)\*\*/g, '$1').trim();
    const subtitleMatch = cleaned.match(/^[-*]?\s*([^:]+):\s*(.*)$/);

    if (subtitleMatch) {
      const [, title, rest] = subtitleMatch;
      return (
        <p key={`${title}-${index}`} className="message-content">
          <strong>{title.trim()}</strong>
          {rest ? `: ${rest.trim()}` : ''}
        </p>
      );
    }

    return (
      <p key={`${index}-${cleaned}`} className="message-content">
        {cleaned}
      </p>
    );
  });
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    createConversation(),
  ]);
  const [activeConversationId, setActiveConversationId] = useState<string>(() =>
    conversations[0] ? conversations[0].id : '',
  );
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) ??
      conversations[0],
    [conversations, activeConversationId],
  );

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeConversation?.messages, isSending]);

  function updateConversation(
    conversationId: string,
    updater: (conversation: Conversation) => Conversation,
  ) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? updater(conversation) : conversation,
      ),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };

    const assistantId = crypto.randomUUID();

    if (!activeConversation) return;

    updateConversation(activeConversation.id, (conversation) => {
      const nextTitle =
        conversation.title === 'New chat' ? trimmed.slice(0, 48) : conversation.title;
      return {
        ...conversation,
        title: nextTitle,
        messages: [
          ...conversation.messages,
          userMessage,
          {
            id: assistantId,
            role: 'assistant',
            content: '',
            citations: [],
          },
        ],
      };
    });
    setMessage('');
    setError(null);
    setIsSending(true);

    try {
      const result = await streamChatMessage(
        trimmed,
        activeConversation.sessionId,
        (_chunk, fullText) => {
          updateConversation(activeConversation.id, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((entry) =>
              entry.id === assistantId ? { ...entry, content: fullText } : entry,
            ),
          }));
        },
      );

      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((entry) =>
          entry.id === assistantId
            ? {
                ...entry,
                content: result.answer,
                citations: result.citations,
                meta: {
                  intent: result.intent,
                  usedContext: result.usedContext,
                  rewrittenQuery: result.rewrittenQuery,
                },
              }
            : entry,
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSending(false);
    }
  }

  function handleReset() {
    setError(null);
    const nextConversation = createConversation();
    setConversations((current) => [nextConversation, ...current]);
    setActiveConversationId(nextConversation.id);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Tappz</p>
          <h1>Chat</h1>
          <p className="sidebar-copy">Ask questions and follow-ups.</p>
        </div>

        <button type="button" className="reset-button" onClick={handleReset}>
          New chat
        </button>

        <div className="history-panel">
          <div className="label">Conversation history</div>
          {conversations.length === 0 ? (
            <p className="history-empty">No messages yet.</p>
          ) : (
            <div className="history-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`history-item${
                    conversation.id === activeConversationId ? ' active' : ''
                  }`}
                  onClick={() => setActiveConversationId(conversation.id)}
                >
                  <span className="history-text">{conversation.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-meta">
          <div>
            <span className="label">Backend</span>
            <div className="sidebar-value">{API_BASE_URL}</div>
          </div>
          <div>
            <span className="label">Session</span>
            <div className="sidebar-value">
              {activeConversation?.sessionId ?? '-'}
            </div>
          </div>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">RAG</p>
            <h2>Chat</h2>
          </div>
        </header>

        <div className="chat-log" ref={scrollerRef}>
          {!activeConversation || activeConversation.messages.length === 0 ? (
            <section className="empty-state">
              <h3>Start a conversation</h3>
              <p>
                Ask a general question, a RAG-backed question, or try a follow-up.
              </p>
            </section>
          ) : (
            activeConversation.messages.map((entry) => (
              <article
                key={entry.id}
                className={`message message-${entry.role}`}
                data-message-id={entry.id}
              >
                <div className="message-inner">
                  <div className="message-header">
                    <span className="message-role">
                      {entry.role === 'user' ? 'You' : 'Assistant'}
                    </span>
                  </div>
                  {entry.role === 'assistant'
                    ? renderAssistantContent(entry.content)
                    : <p className="message-content">{entry.content}</p>}

                  {entry.role === 'assistant' && entry.meta ? (
                    <div className="meta-row">
                      {entry.meta.intent ? <span>{entry.meta.intent}</span> : null}
                      {typeof entry.meta.usedContext === 'boolean' ? (
                        <span>
                          {entry.meta.usedContext ? 'grounded' : 'general knowledge'}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {entry.citations && entry.citations.length > 0 ? (
                    <div className="citations">
                      <div className="citation-title">Sources</div>
                      <div className="citation-list">
                        {entry.citations.map((citation) => (
                          <div
                            key={`${entry.id}-${citation.id}`}
                            className="citation-item"
                          >
                            <div className="citation-icon" aria-hidden="true">
                              <svg
                                viewBox="0 0 24 24"
                                focusable="false"
                                role="img"
                                aria-label="Wikipedia"
                              >
                                <circle cx="12" cy="12" r="10" />
                                <text x="12" y="16" textAnchor="middle">
                                  W
                                </text>
                              </svg>
                            </div>
                            <div className="citation-body">
                              <div className="citation-source">{citation.sourceTitle}</div>
                              <div className="citation-meta">Wikipedia</div>
                              <p className="citation-excerpt">{citation.excerpt}</p>
                            </div>
                            <div className="citation-badge">[{citation.id}]</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          )}

          {isSending ? <div className="thinking">Typing...</div> : null}
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
              placeholder="Ask about a country, try a follow-up, or compare entities..."
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
