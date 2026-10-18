"use client";



import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";



const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";



type Doc = { id: number; filename: string; status: string; page_count: number; error?: string };

type Source = { document_id: number; filename: string; page: number; chunk_id: number; text: string; marker: string };

type Msg = { role: string; content: string; citations?: Source[] };

type Conversation = { id: number; title: string };



export default function Home() {

  const [token, setToken] = useState("");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [signup, setSignup] = useState(false);

  const [docs, setDocs] = useState<Doc[]>([]);

  const [selected, setSelected] = useState<number[]>([]);

  const [messages, setMessages] = useState<Msg[]>([]);

  const [question, setQuestion] = useState("");

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [conversation, setConversation] = useState<number | null>(null);

  const [history, setHistory] = useState<Conversation[]>([]);

  const [passage, setPassage] = useState<Source | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);



  useEffect(() => {

    setToken(localStorage.getItem("documind_token") || "");

  }, []);



  async function request(path: string, opts: RequestInit = {}) {

    const response = await fetch(API + path, {

      ...opts,

      headers: { Authorization: "Bearer " + token, ...opts.headers },

    });

    if (!response.ok) throw new Error((await response.text()).slice(0, 250));

    return response.json();

  }



  async function refresh() {

    try {

      const documents: Doc[] = await request("/documents");

      setDocs(documents);

      setHistory(await request("/conversations"));

    } catch (err) {

      setError(String(err));

    }

  }



  useEffect(() => {

    if (token) void refresh();

  }, [token]);



  useEffect(() => {

    if (!token || !docs.some(d => d.status === "queued" || d.status === "processing")) return;

    const timer = setInterval(() => { void refresh(); }, 3500);

    return () => clearInterval(timer);

  }, [token, docs]);



  async function auth() {

    setError("");

    try {

      const response = await fetch(API + (signup ? "/auth/signup" : "/auth/login"), {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ email, password }),

      });

      if (!response.ok) throw new Error(await response.text());

      const data = await response.json();

      localStorage.setItem("documind_token", data.access_token);

      setToken(data.access_token);

    } catch (err) {

      setError(String(err));

    }

  }



  async function upload(file: File) {

    setError("");

    const body = new FormData();

    body.append("file", file);

    try {

      await request("/documents/upload", { method: "POST", body });

      await refresh();

    } catch (err) {

      setError(String(err));

    }

  }



  async function ask() {
    if (!question.trim() || !selected.length || busy) return;
    const q = question.trim();
    const assistantIndex = messages.length + 1;
    setQuestion("");
    setBusy(true);
    setError("");
    setMessages(prev => [...prev, { role: "user", content: q }, { role: "assistant", content: "", citations: [] }]);

    // Update the specific answer being streamed, not whichever message is last.
    const updateAnswer = (update: (message: Msg) => Msg) => {
      setMessages(prev => prev.map((message, index) =>
        index === assistantIndex ? update(message) : message
      ));
    };

    try {
      const response = await fetch(API + "/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ question: q, document_ids: selected, conversation_id: conversation }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error((await response.text()).slice(0, 300));
      if (!response.body) throw new Error("Streaming response unavailable");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failed = false;
      let finished = false;
      let receivedText = "";
      let streamedConversationId: number | null = null;

      function processFrame(frame: string) {
        let event = "";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) return;
        const item = JSON.parse(dataLines.join("\n"));

        if (event === "sources") {
          streamedConversationId = Number(item.conversation_id);
          setConversation(streamedConversationId);
          updateAnswer(message => ({ ...message, citations: item.sources || [] }));
        } else if (event === "token") {
          const text = String(item.text || "");
          receivedText += text;
          updateAnswer(message => ({ ...message, content: receivedText }));
        } else if (event === "done") {
          finished = true;
        } else if (event === "error") {
          failed = true;
          setError(item.message || "Generation failed");
          updateAnswer(message => ({
            ...message,
            content: receivedText || "Generation failed. Please try again.",
          }));
        }
      }

      function processBuffer(flush = false) {
        buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.trim()) processFrame(frame);
          boundary = buffer.indexOf("\n\n");
        }
        if (flush && buffer.trim()) {
          processFrame(buffer);
          buffer = "";
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }
      buffer += decoder.decode();
      processBuffer(true);

      if (!failed && !receivedText) {
        setError("No answer text was received. Please try again.");
        updateAnswer(message => ({ ...message, content: "No answer received." }));
      }
      // Authoritative fallback: reload the saved assistant message after streaming.
      // This also repairs the display when browser SSE updates were missed.
      if (!failed && streamedConversationId !== null) {
        let restored = false;
        for (let attempt = 0; attempt < 4 && !restored; attempt++) {
          try {
            const savedResponse = await fetch(
              `${API}/conversations/${streamedConversationId}`,
              { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
            );
            if (!savedResponse.ok) throw new Error(`Conversation reload failed (${savedResponse.status})`);
            const saved: { messages: Msg[] } = await savedResponse.json();
            const last = saved.messages[saved.messages.length - 1];
            if (last?.role === "assistant" && last.content?.trim()) {
              setMessages(saved.messages);
              restored = true;
              setError("");
            }
          } catch (reloadError) {
            if (attempt === 3 && !receivedText) setError(String(reloadError));
          }
          if (!restored && attempt < 3) {
            await new Promise<void>(resolve => setTimeout(resolve, 600));
          }
        }
        if (!restored && !receivedText) {
          setError("Answer finished, but could not be loaded. Open the conversation in the sidebar.");
        }
      }
      if (!failed) {
        try {
          const conversations: Conversation[] = await request("/conversations");
          setHistory(conversations);
        } catch {
          // Keep the answer visible if sidebar refresh fails.
        }
      }
      if (!finished && !failed && receivedText) {
        // A network interruption may prevent the final done event.
        setError("The response connection closed before completion; the text received is shown.");
      }
    } catch (err) {
      setError(String(err));
      updateAnswer(message => ({
        ...message,
        content: message.content || "Unable to generate an answer.",
      }));
    } finally {
      setBusy(false);
    }
  }

  async function openPdfAtPage(documentId: number, page: number) {

    // Open the tab synchronously to avoid popup blockers.

    const tab = window.open("about:blank", "_blank");

    if (!tab) {

      setError("Allow pop-ups for localhost:3000 to open PDFs.");

      return;

    }

    try {

      tab.document.title = "Loading PDF...";

      const response = await fetch(`${API}/documents/${documentId}/pdf`, {

        headers: { Authorization: `Bearer ${token}` },

      });

      if (!response.ok) throw new Error(`PDF request failed (${response.status})`);

      const blob = await response.blob();

      const url = URL.createObjectURL(blob);

      tab.location.replace(`${url}#page=${page}`);

      // Keep the blob alive for the browser PDF viewer.

      setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);

    } catch (err) {

      tab.close();

      setError(`Could not open PDF: ${String(err)}`);

    }

  }



  function renderAnswer(content: string, citations: Source[] = []) {
    // Convert [n] text markers into safe internal links before Markdown rendering.
    // The renderer only handles links that resolve to an actual source.
    function citationPlugin() {
      return (tree: any) => {
        function visit(node: any) {
          if (!node || !Array.isArray(node.children)) return;
          if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode") return;
          const children: any[] = [];
          for (const child of node.children) {
            if (child.type !== "text") {
              visit(child);
              children.push(child);
              continue;
            }
            const text = String(child.value);
            const pattern = /\[(\d+)\]/g;
            let offset = 0;
            for (const match of text.matchAll(pattern)) {
              const start = match.index ?? 0;
              if (start > offset) children.push({ type: "text", value: text.slice(offset, start) });
              const number = Number(match[1]);
              const source = citations[number - 1];
              if (source?.marker === match[0]) {
                children.push({
                  type: "link",
                  url: `#documind-citation-${number}`,
                  children: [{ type: "text", value: match[0] }],
                });
              } else {
                children.push({ type: "text", value: match[0] });
              }
              offset = start + match[0].length;
            }
            if (offset < text.length) children.push({ type: "text", value: text.slice(offset) });
          }
          node.children = children;
        }
        visit(tree);
      };
    }

    return (
      <div className="research-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, citationPlugin]}
          rehypePlugins={[rehypeSanitize]}
          components={{
            a: ({ href, children }) => {
              const match = href?.match(/^#documind-citation-(\d+)$/);
              if (match) {
                const source = citations[Number(match[1]) - 1];
                if (source) return (
                  <button type="button" className="citation-link"
                    title={`Open ${source.filename}, page ${source.page}`}
                    onClick={() => void openPdfAtPage(source.document_id, source.page)}>
                    {children}
                  </button>
                );
              }
              return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  function exportAnswer(message: Msg, format: "word" | "markdown") {
    const citations = message.citations || [];
    const references = citations.map(s => `${s.marker} ${s.filename}, page ${s.page}`).join("\n");
    const text = `${message.content}\n\nSources\n${references}`;
    if (format === "markdown") {
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      downloadBlob(blob, "documind-research.md");
      return;
    }
    // HTML .doc format is readable by Microsoft Word (not a .docx file).
    const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<html><head><meta charset="utf-8"></head><body><h1>DocuMind Research Report</h1><pre style="white-space:pre-wrap;font-family:Calibri,sans-serif">${escapeHtml(message.content)}</pre><h2>Sources</h2><pre>${escapeHtml(references)}</pre></body></html>`;
    downloadBlob(new Blob([html], { type: "application/msword" }), "documind-research.doc");
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function printAnswer(message: Msg) {
    const tab = window.open("", "_blank");
    if (!tab) { setError("Allow pop-ups to export a PDF."); return; }
    const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const sources = (message.citations || []).map(s => `${s.marker} ${s.filename} — page ${s.page}`).join("\n");
    tab.document.write(`<html><head><title>DocuMind Research Report</title><style>body{font:15px/1.6 Arial,sans-serif;margin:40px;white-space:pre-wrap}h1{font-size:24px}h2{font-size:18px}</style></head><body><h1>DocuMind Research Report</h1>${escapeHtml(message.content)}<h2>Sources</h2>${escapeHtml(sources)}</body></html>`);
    tab.document.close();
    tab.focus();
    tab.print();
  }

  async function openConversation(id: number) {

    setError("");

    setPassage(null);

    try {

      const data = await request("/conversations/" + id);

      setConversation(id);

      setMessages(data.messages);

    } catch (err) {

      setError(String(err));

    }

  }



  if (!token) {

    return (

      <div className="card auth">

        <h1>✦ DocuMind</h1>

        <p className="muted">Upload research papers, compare findings, and ask questions across PDFs with evidence-backed answers and clickable source citations.</p>

        <h2>{signup ? "Create account" : "Welcome back"}</h2>

        <form onSubmit={event => { event.preventDefault(); void auth(); }}>

          <input type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} required />

          <input type="password" placeholder="Password (8+ characters)" value={password} onChange={event => setPassword(event.target.value)} required />

          <button type="submit" style={{ width: "100%" }}>{signup ? "Sign up" : "Log in"}</button>

        </form>

        <p className="error">{error}</p>

        <button type="button" onClick={() => setSignup(!signup)} style={{ background: "transparent" }}>

          {signup ? "Already registered? Log in" : "New here? Create an account"}

        </button>
        <div className="auth-credit">Created by <strong>Emman Khattak</strong> · <a href="https://github.com/emmankhattak" target="_blank" rel="noopener noreferrer">GitHub ↗</a></div>

      </div>

    );

  }



  return (

    <div className="app">

      <aside className="sidebar">

        <h1>✦ DocuMind</h1>

        <p className="muted">Your research workspace</p>



        <div className="card">

          <h3>Documents</h3>

          <input

            aria-label="Upload PDF"

            type="file"

            accept=".pdf,application/pdf"

            onChange={event => {

              const file = event.target.files?.[0];

              if (file) void upload(file);

              event.target.value = "";

            }}

          />

          <p className="muted">PDFs up to 25 MB</p>

          {docs.map(doc => (

            <label className="doc" key={doc.id}>

              <input

                style={{ width: 18 }}

                type="checkbox"

                disabled={doc.status !== "ready"}

                checked={selected.includes(doc.id)}

                onChange={event => setSelected(prev => event.target.checked ? [...prev, doc.id] : prev.filter(id => id !== doc.id))}

              />

              <span>

                {doc.filename}

                <div className="pill">{doc.status} {doc.page_count ? `· ${doc.page_count} pages` : ""}</div>

                {doc.error && <small className="error">{doc.error}</small>}

              </span>

            </label>

          ))}

        </div>



        <h3>Conversations</h3>

        <button type="button" onClick={() => { setConversation(null); setMessages([]); setPassage(null); setError(""); }}>+ New research</button>

        {history.map(item => (

          <button type="button" className="source" key={item.id} onClick={() => void openConversation(item.id)}>{item.title}</button>

        ))}

        <button

          type="button"

          style={{ marginTop: 20, background: "#303955" }}

          onClick={() => {

            localStorage.removeItem("documind_token");

            setToken("");

            setMessages([]);

            setDocs([]);

            setSelected([]);

          }}

        >

          Log out

        </button>

      </aside>



      <main className="main">

      <section className="brand-intro" aria-label="About DocuMind">
        <span className="brand-eyebrow">AI-POWERED RESEARCH WORKSPACE</span>
        <h1>Research smarter with <span>DocuMind.</span></h1>
        <p>Turn your research papers into answers you can trust. Upload PDFs, ask questions across multiple documents, compare findings, and explore evidence-backed insights with clickable citations to the original pages.</p>
      </section>

        <p className="muted">Select ready documents, then ask for a synthesis, comparison, or evidence-backed answer.</p>



        <div className="card messages">

          {messages.length === 0 && (

            <div>

              <h2>What would you like to discover?</h2>

              <p className="muted">Try: “Compare the main findings of these papers and cite the relevant pages.”</p>

            </div>

          )}

          {messages.map((message, index) => (

            <div className={"bubble " + (message.role === "user" ? "user" : "")} key={index}>

              <strong>{message.role === "user" ? "You" : "DocuMind"}</strong>

              <div style={{ marginTop: 10, lineHeight: 1.7 }}>

                {message.content

                  ? message.role === "assistant"

                    ? renderAnswer(message.content, message.citations || [])

                    : message.content

                  : "Thinking..."}

              </div>

              {message.role === "assistant" && message.content.trim() && (
                <div className="export-actions">
                  <button type="button" onClick={() => printAnswer(message)}>Print / Save PDF</button>
                  <button type="button" onClick={() => exportAnswer(message, "word")}>Word (.doc)</button>
                  <button type="button" onClick={() => exportAnswer(message, "markdown")}>Markdown</button>
                </div>
              )}

              {message.citations && message.citations.length > 0 && (

                <details>

                  <summary>Sources ({message.citations.length})</summary>

                  {message.citations.map((source, sourceIndex) => (

                    <div key={`${source.chunk_id}-${sourceIndex}`} style={{ marginBottom: 8 }}>

                      <button type="button" className="source" onClick={() => setPassage(source)}>

                        {source.marker} {source.filename} · Page {source.page} (View excerpt)

                      </button>

                      <button type="button" className="source" onClick={() => void openPdfAtPage(source.document_id, source.page)} style={{ color: "#8ca6ff" }}>

                        Open original PDF · Page {source.page} ↗

                      </button>

                    </div>

                  ))}

                </details>

              )}

            </div>

          ))}

          <div ref={messagesEndRef} />
        </div>



        <div className="composer">

          <input

            value={question}

            onChange={event => setQuestion(event.target.value)}

            onKeyDown={event => { if (event.key === "Enter") void ask(); }}

            placeholder={selected.length ? "Ask across selected documents..." : "Select documents to begin"}

          />

          <button type="button" disabled={busy || !selected.length} onClick={() => void ask()}>

            {busy ? "Generating..." : "Ask →"}

          </button>

        </div>

        <p className="error">{error}</p>



        {passage && (

          <div className="card">

            <button type="button" style={{ float: "right" }} onClick={() => setPassage(null)}>Close</button>

            <h3>{passage.filename} · Page {passage.page}</h3>

            <button type="button" onClick={() => void openPdfAtPage(passage.document_id, passage.page)}>

              Open original PDF ↗

            </button>

            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{passage.text}</p>

          </div>

        )}

      <footer className="developer-footer">
        <div className="developer-portrait" aria-label="Portrait of Emman Khattak">
          <img src="/emman-khattak.png" alt="Emman Khattak" />
        </div>
        <div className="developer-details">
          <span className="brand-eyebrow">MEET THE CREATOR</span>
          <h2>Built by Emman Khattak</h2>
          <p>Designed and developed with curiosity, care, and a love for making research easier.</p>
          <nav className="developer-links" aria-label="Developer social links">
            <a href="https://www.linkedin.com/in/emman-khattak" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
            <a href="https://github.com/emmankhattak" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            <a href="https://portfolio-ten-blond-72.vercel.app" target="_blank" rel="noopener noreferrer">Portfolio ↗</a>
          </nav>
        </div>
      </footer>
      </main>

    </div>

  );

}
