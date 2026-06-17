"use client";

import { useRef, useState } from "react";

interface Source {
  id: string;
  text: string;
  position: number;
  source: string;
  score: number;
}

interface Turn {
  question: string;
  answer: string;
  sources: Source[];
}

interface DocInfo {
  source: string;
  chunks: number;
  pages: number;
}

const styles = `
.shell { max-width: 880px; margin: 0 auto; padding: 0 20px 80px; }

.masthead { padding: 56px 0 32px; border-bottom: 1px solid var(--border); }
.kicker { font-family: var(--mono); font-size: 12px; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--amber); }
.title { font-size: 38px; font-weight: 700; letter-spacing: -0.02em; margin: 14px 0 10px; }
.title .dim { color: var(--text-dim); font-weight: 400; }
.lede { color: var(--text-dim); max-width: 560px; font-size: 15.5px; }
.stack { font-family: var(--mono); font-size: 12px; color: var(--text-faint);
  margin-top: 18px; display: flex; gap: 8px; flex-wrap: wrap; }
.stack span { border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; }

.panel { background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; margin-top: 24px; overflow: hidden; }
.panel-head { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--text-faint); padding: 12px 18px;
  border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; }

.dropzone { padding: 28px 18px; display: flex; align-items: center; gap: 16px;
  flex-wrap: wrap; }
.btn { background: var(--amber); color: #161b22; font-weight: 600; font-size: 14px;
  border: none; border-radius: 7px; padding: 11px 18px; transition: filter 0.15s; }
.btn:hover:not(:disabled) { filter: brightness(1.08); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border-bright); }
.hint { color: var(--text-faint); font-size: 13px; }

.docs { padding: 0 18px 18px; display: flex; flex-wrap: wrap; gap: 8px; }
.doc-pill { font-family: var(--mono); font-size: 12px; color: var(--text-dim);
  background: var(--panel-raised); border: 1px solid var(--border); border-radius: 5px;
  padding: 5px 10px; display: flex; gap: 8px; align-items: center; }
.doc-pill b { color: var(--green); }

.thread { margin-top: 8px; }
.turn { margin-top: 24px; }
.q { font-size: 16px; font-weight: 600; display: flex; gap: 10px; }
.q::before { content: "?"; font-family: var(--mono); color: var(--amber);
  border: 1px solid var(--amber-dim); border-radius: 5px; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center; flex: 0 0 auto; font-size: 14px; }
.a { margin: 12px 0 0 34px; color: var(--text); font-size: 15px; white-space: pre-wrap; }

.evidence-label { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--text-faint); margin: 18px 0 10px 34px; }
.evidence { margin-left: 34px; display: grid; gap: 10px; }
.card { background: var(--panel); border: 1px solid var(--border); border-left: 2px solid var(--amber);
  border-radius: 8px; padding: 14px 16px; }
.card-head { font-family: var(--mono); font-size: 11px; color: var(--text-faint);
  display: flex; justify-content: space-between; margin-bottom: 8px; }
.card-head .src { color: var(--text-dim); }
.score-bar { display: inline-flex; align-items: center; gap: 6px; }
.score-track { width: 56px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.score-fill { height: 100%; background: var(--amber); }
.card-text { font-size: 13.5px; color: var(--text-dim); line-height: 1.6; }

.composer { position: sticky; bottom: 0; background: linear-gradient(transparent, var(--bg) 24px);
  padding-top: 28px; margin-top: 32px; }
.composer-inner { display: flex; gap: 10px; background: var(--panel); border: 1px solid var(--border-bright);
  border-radius: 10px; padding: 8px 8px 8px 16px; }
.composer input { flex: 1; background: transparent; border: none; outline: none;
  color: var(--text); font-size: 15px; font-family: var(--sans); }
.composer input::placeholder { color: var(--text-faint); }

.empty { margin-top: 40px; text-align: center; color: var(--text-faint); font-size: 14px;
  border: 1px dashed var(--border); border-radius: 10px; padding: 40px 20px; }
.err { color: #f0786e; font-size: 13px; margin-top: 10px; font-family: var(--mono); }
.spin { display: inline-block; width: 13px; height: 13px; border: 2px solid var(--amber-dim);
  border-top-color: var(--amber); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
`;

export default function Home() {
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [thread, setThread] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setDocs((d) => [
        ...d.filter((x) => x.source !== data.source),
        { source: data.source, chunks: data.chunks, pages: data.pages },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleAsk() {
    const q = question.trim();
    if (!q || asking) return;
    setError("");
    setAsking(true);
    setQuestion("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setThread((t) => [
        ...t,
        { question: q, answer: data.answer, sources: data.sources || [] },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setAsking(false);
    }
  }

  const hasDocs = docs.length > 0;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="shell">
        <header className="masthead">
          <div className="kicker">Retrieval-Augmented Generation</div>
          <h1 className="title">
            DocuChat <span className="dim">/ answers from your documents</span>
          </h1>
          <p className="lede">
            Upload a PDF and ask questions about it. Every answer is grounded in
            retrieved passages from your document — and the exact source
            evidence is shown alongside it, so you can see it isn&apos;t guessing.
          </p>
          <div className="stack">
            <span>Next.js</span>
            <span>TypeScript</span>
            <span>OpenAI Embeddings</span>
            <span>Cosine Retrieval</span>
            <span>Cited Sources</span>
          </div>
        </header>

        <section className="panel">
          <div className="panel-head">
            <span>Source documents</span>
            <span>{hasDocs ? `${docs.length} loaded` : "none yet"}</span>
          </div>
          <div className="dropzone">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              onChange={handleUpload}
              style={{ display: "none" }}
            />
            <button
              className="btn"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <>
                  <span className="spin" /> &nbsp;Indexing…
                </>
              ) : (
                "Upload a PDF"
              )}
            </button>
            <span className="hint">
              The file is chunked, embedded, and indexed in memory. Nothing is
              stored after the session.
            </span>
          </div>
          {hasDocs && (
            <div className="docs">
              {docs.map((d) => (
                <div className="doc-pill" key={d.source}>
                  {d.source} <b>{d.chunks} chunks</b> · {d.pages}p
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="thread">
          {thread.length === 0 && (
            <div className="empty">
              {hasDocs
                ? "Ask a question below to see grounded answers with their source evidence."
                : "Upload a PDF to get started — or load the sample doc from the repo."}
            </div>
          )}

          {thread.map((turn, i) => (
            <div className="turn" key={i}>
              <div className="q">{turn.question}</div>
              <div className="a">{turn.answer}</div>
              {turn.sources.length > 0 && (
                <>
                  <div className="evidence-label">
                    Retrieved evidence · {turn.sources.length} passages
                  </div>
                  <div className="evidence">
                    {turn.sources.map((s, j) => (
                      <div className="card" key={s.id}>
                        <div className="card-head">
                          <span className="src">
                            Source {j + 1} — {s.source}, passage {s.position}
                          </span>
                          <span className="score-bar">
                            {(s.score * 100).toFixed(0)}%
                            <span className="score-track">
                              <span
                                className="score-fill"
                                style={{ width: `${Math.round(s.score * 100)}%` }}
                              />
                            </span>
                          </span>
                        </div>
                        <div className="card-text">{s.text}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {error && <div className="err">⚠ {error}</div>}

        <div className="composer">
          <div className="composer-inner">
            <input
              value={question}
              placeholder={
                hasDocs ? "Ask anything about your document…" : "Upload a PDF first…"
              }
              disabled={!hasDocs || asking}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            />
            <button className="btn" onClick={handleAsk} disabled={!hasDocs || asking}>
              {asking ? <span className="spin" /> : "Ask"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
