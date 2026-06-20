-- CreateTable
CREATE TABLE "NoticeDocument" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "documentId" TEXT,
    "filename" TEXT NOT NULL,
    "contentHash" TEXT,
    "byteSize" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeAcknowledgement" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "acknowledgedById" TEXT,
    "method" TEXT NOT NULL DEFAULT 'portal',
    "statementText" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signatureMetadata" TEXT,
    "receiptHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeFailure" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "substituteOrderId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeDocument_noticeId_idx" ON "NoticeDocument"("noticeId");

-- CreateIndex
CREATE INDEX "NoticeAcknowledgement_recipientId_idx" ON "NoticeAcknowledgement"("recipientId");

-- CreateIndex
CREATE INDEX "NoticeFailure_recipientId_idx" ON "NoticeFailure"("recipientId");

-- AddForeignKey
ALTER TABLE "NoticeDocument" ADD CONSTRAINT "NoticeDocument_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "FormalNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeAcknowledgement" ADD CONSTRAINT "NoticeAcknowledgement_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NoticeRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeFailure" ADD CONSTRAINT "NoticeFailure_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NoticeRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
