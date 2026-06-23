-- AlterTable
ALTER TABLE "Award" ADD COLUMN     "generatedDocumentKey" TEXT,
ADD COLUMN     "documentHash" TEXT;

-- AlterTable
ALTER TABLE "ServiceCertificate" ADD COLUMN     "documentKey" TEXT,
ADD COLUMN     "documentHash" TEXT;
