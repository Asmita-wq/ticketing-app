CREATE TABLE "kb_attachments" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_attachments_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "kb_attachments" ADD CONSTRAINT "kb_attachments_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "knowledge_base_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
