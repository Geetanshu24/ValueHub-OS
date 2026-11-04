-- Full-text search over text read from documents. 'simple' keeps Indian names
-- and numbers intact (no English stemming or stop words).
CREATE INDEX "Document_ocrText_fts" ON "Document" USING GIN (to_tsvector('simple', coalesce("ocrText", '')));
