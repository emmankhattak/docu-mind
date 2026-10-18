import os

import fitz
from celery import Celery
from sentence_transformers import SentenceTransformer
from sqlalchemy import delete

from .db import Session, Document, Chunk

celery_app = Celery(
    "documind",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
)
_model = None


def embed(texts):
    global _model
    if not texts:
        return []
    if _model is None:
        _model = SentenceTransformer("BAAI/bge-small-en-v1.5")
    return _model.encode(
        texts,
        normalize_embeddings=True,
        batch_size=32,
        show_progress_bar=False,
    ).tolist()


def split_text(text, max_chars=1100, overlap=180):
    text = " ".join(text.split())
    if not text:
        return []
    out = []
    pos = 0
    while pos < len(text):
        end = min(pos + max_chars, len(text))
        if end < len(text):
            boundary = text.rfind(" ", pos + max_chars // 2, end)
            if boundary > pos:
                end = boundary
        out.append(text[pos:end])
        if end == len(text):
            break
        pos = max(pos + 1, end - overlap)
    return out


@celery_app.task(name="ingest_pdf")
def ingest_pdf(doc_id):
    with Session() as db:
        doc = db.get(Document, doc_id)
        if not doc:
            return

        doc.status = "processing"
        doc.error = None
        db.commit()

        try:
            with fitz.open(doc.filepath) as pdf:
                page_count = len(pdf)
                items = [
                    (page_index + 1, chunk)
                    for page_index, page in enumerate(pdf)
                    for chunk in split_text(page.get_text())
                ]

            if not items:
                raise ValueError("No extractable text; scanned PDFs require OCR")

            # Generate vectors in batches to avoid a large one-shot inference.
            vectors = []
            for start in range(0, len(items), 32):
                vectors.extend(
                    embed([content for _, content in items[start:start + 32]])
                )

            # Re-running ingestion replaces old chunks instead of duplicating them.
            db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
            for (page_number, content), vector in zip(items, vectors):
                db.add(
                    Chunk(
                        document_id=doc.id,
                        page_number=page_number,
                        content=content,
                        embedding=vector,
                    )
                )

            doc.page_count = page_count
            doc.status = "ready"
            db.commit()

        except Exception as exc:
            db.rollback()
            doc = db.get(Document, doc_id)
            if doc:
                doc.status = "failed"
                doc.error = str(exc)[:1000]
                db.commit()
