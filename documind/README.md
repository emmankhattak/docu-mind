# DocuMind
### AI-Powered Research Assistant | Full-Stack RAG Application

**DocuMind** is a full-stack AI research assistant that transforms PDF documents into an interactive, evidence-backed knowledge base.

Built using **Next.js, FastAPI, PostgreSQL with pgvector, Redis, Celery, SentenceTransformers, and Groq**, DocuMind allows users to upload research papers, ask natural-language questions, compare multiple documents, and receive AI-generated answers with clickable source citations.

Unlike a general-purpose chatbot, DocuMind uses **Retrieval-Augmented Generation (RAG)** to ground its responses in the user's uploaded documents.

**Developed by Emman Khattak**

[LinkedIn](https://www.linkedin.com/in/emman-khattak) | [GitHub](https://github.com/emmankhattak) | [Portfolio](https://portfolio-ten-blond-72.vercel.app)

---

## Key Features

- **PDF Upload & Processing** — Upload research papers and automatically extract, chunk, and index their contents.
- **AI-Powered Question Answering** — Ask questions in natural language and receive document-grounded responses.
- **Multi-Document Research** — Compare findings, methodologies, and limitations across multiple PDFs.
- **Semantic Search** — Retrieve relevant passages using vector embeddings and cosine similarity.
- **Clickable Source Citations** — Trace AI-generated answers back to the original document and page.
- **Real-Time Response Streaming** — Display AI-generated responses progressively using Server-Sent Events (SSE).
- **Secure Authentication** — User registration and login using JWT-based authentication.
- **Conversation History** — Continue previous research discussions.
- **Research Report Exports** — Export answers as PDF, Word-compatible documents, or Markdown.
- **Background PDF Processing** — Process document ingestion asynchronously with Celery and Redis.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js 15, React, TypeScript |
| Backend | Python, FastAPI |
| Database | PostgreSQL, pgvector |
| AI Inference | Groq API, GPT-OSS 20B |
| Embeddings | SentenceTransformers, BAAI/bge-small-en-v1.5 |
| Background Jobs | Celery, Redis |
| Authentication | JWT |
| Communication | REST API, Server-Sent Events |
| Containerization | Docker, Docker Compose |

---

## How DocuMind Works

DocuMind implements a Retrieval-Augmented Generation pipeline:

1. **Document ingestion:** Users upload PDFs through the web interface.
2. **Text extraction:** The backend extracts text from each PDF, preserving page references.
3. **Chunking:** Extracted text is divided into overlapping passages.
4. **Embedding generation:** SentenceTransformers converts each passage into a semantic vector.
5. **Vector storage:** Embeddings and document metadata are stored in PostgreSQL with pgvector.
6. **Semantic retrieval:** A user's question is embedded and compared against indexed passages using cosine similarity.
7. **Multi-document retrieval:** Relevant passages are collected across selected documents to support comparative questions.
8. **Grounded generation:** Retrieved passages are supplied to the language model as supporting context.
9. **Streaming and citations:** The answer streams to the frontend, alongside source references that link back to PDF pages.

### System Architecture

```text
                   +---------------------+
                   |    Next.js Client   |
                   |  Upload / Chat UI   |
                   +----------+----------+
                              |
                              v
                   +---------------------+
                   |     FastAPI API     |
                   |   Auth / Querying   |
                   +----------+----------+
                              |
              +---------------+----------------+
              |                                |
              v                                v
    +------------------+             +------------------+
    |   Redis + Celery |             | PostgreSQL       |
    | Background Jobs  |             | + pgvector       |
    +---------+--------+             +------------------+
              |                                ^
              v                                |
    +------------------+                       |
    | PDF Extraction   |-----------------------+
    | Chunking +       |
    | Embeddings       |
    +------------------+

    Query -> Semantic Retrieval -> Groq LLM
          -> SSE Streaming -> Cited Answer
```

---

## Engineering Challenges & Solutions

### 1. Balanced Retrieval Across Multiple Documents

**Challenge:** A global top-k similarity search could return passages predominantly from one document, even when users selected multiple research papers.

**Solution:** Implemented per-document retrieval quotas, followed by a global retrieval pass to fill remaining context slots.

**Result:** Improved representation of selected documents during comparative research queries.

### 2. Real-Time AI Response Streaming

**Challenge:** Delivering progressively generated answers while maintaining conversation state and source references.

**Solution:** Implemented Server-Sent Events between FastAPI and Next.js, separating source metadata, response tokens, and completion events.

### 3. Asynchronous Document Ingestion

**Challenge:** PDF extraction and embedding generation can be computationally expensive and should not block HTTP requests.

**Solution:** Used Celery workers with Redis to process documents in the background and track ingestion status.

### 4. Traceable AI Responses

**Challenge:** AI-generated research answers need to be verifiable against their original sources.

**Solution:** Stored document IDs, chunk IDs, and page numbers alongside retrieved passages, enabling clickable source references in the frontend.

---

## Getting Started

### Prerequisites

- Docker
- Docker Compose
- A Groq API key

### Local Setup

**1. Clone the repository**

```bash
git clone https://github.com/emmankhattak/documind.git
cd documind
```

**2. Configure environment variables**

Create the required `.env` configuration using the environment variables documented in the project.

Never commit real API keys, JWT secrets, or database credentials.

**3. Start the application**

```bash
docker compose up --build -d
```

**4. Open DocuMind**

Visit:

```text
http://localhost:3000
```

Upload a PDF, wait for processing to complete, and start asking research questions.

---

## Screenshots

Add screenshots showing:

1. DocuMind dashboard and developer branding
2. PDF upload and document selection
3. Multi-document comparison with formatted Markdown
4. Clickable citations and research export controls

---

## Future Improvements

- Hybrid keyword and semantic retrieval
- Reranking for higher-precision document search
- Automated citation-grounding evaluation
- Support for scanned PDFs through OCR
- Expanded document format support
- Cloud deployment and scalable document storage

---

## About the Developer

I'm **Emman Khattak**, the developer behind DocuMind.

I built this project to explore how modern full-stack development, semantic search, asynchronous processing, and large language models can work together to solve a practical research problem.

DocuMind reflects my interest in building AI applications that go beyond simple model integration, with an emphasis on backend architecture, data retrieval, usability, and verifiable outputs.

**Connect with me:**

- [LinkedIn](https://www.linkedin.com/in/emman-khattak)
- [GitHub](https://github.com/emmankhattak)
- [Portfolio](https://portfolio-ten-blond-72.vercel.app)

