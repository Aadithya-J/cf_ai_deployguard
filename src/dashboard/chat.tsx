import { useState, useEffect, useRef, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { Streamdown } from "streamdown";
import type { ChatAgent } from "../server";

export default function DeploymentChat({ runId }: { runId?: string }) {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const agent = useAgent<ChatAgent>({
    agent: "ChatAgent",
    name: "deployguard-inspector",
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), [])
  });
  const { messages, sendMessage, status, stop } = useAgentChat({
    agent,
    onError: (error) => setError(error.message)
  });
  const busy = status === "streaming" || status === "submitted";
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  const send = (text: string) => {
    if (!text.trim() || !connected || busy) return;
    setError("");
    setInput("");
    void sendMessage({ text });
  };
  return (
    <section className="chat-panel" aria-label="Deployment questions">
      <div className="section-heading">
        <h2>Ask DeployGuard</h2>
        <span className="muted">{connected ? "Connected" : "Connecting…"}</span>
      </div>
      <p className="muted">
        Answers from stored runs. Advice only; deployment controls stay on the
        dashboard.
      </p>
      <div
        className="chat-messages"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!messages.length && (
          <div className="chat-empty">
            <h3>Understand what happened.</h3>
            <p>
              Ask about a deployment, the evidence behind a rollback, or a
              previous PR analysis.
            </p>
            <button
              className="button secondary"
              disabled={!connected || !runId}
              onClick={() =>
                send(
                  `Explain the outcome and evidence for deployment ${runId}.`
                )
              }
            >
              Explain the selected run
            </button>
          </div>
        )}
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <strong>{message.role === "user" ? "You" : "DeployGuard"}</strong>
            {message.parts.map((part, i) =>
              part.type === "text" ? (
                <Streamdown key={i}>{part.text}</Streamdown>
              ) : part.type.startsWith("tool-") ? (
                <small key={i} className="muted">
                  Read deployment records
                </small>
              ) : null
            )}
          </article>
        ))}
        {busy && (
          <p className="muted" aria-live="polite">
            Reading records and preparing an answer…
          </p>
        )}
        <div ref={end} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label className="sr-only" htmlFor="question">
          Question about deployments
        </label>
        <textarea
          id="question"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Why did the last deployment roll back?"
          maxLength={2000}
          disabled={busy}
        />
        {busy ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => void stop()}
            aria-label="Stop answer"
          >
            <StopIcon size={18} />
          </button>
        ) : (
          <button
            className="button primary"
            disabled={!connected || !input.trim()}
            aria-label="Send question"
          >
            <ArrowUpIcon size={18} />
          </button>
        )}
      </form>
    </section>
  );
}
