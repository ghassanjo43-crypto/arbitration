import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfidentialityLevel, DocumentAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../providers/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { UploadDocumentDto, UploadedFileLike } from './dto';

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.js', '.msi', '.scr', '.com'];

@Injectable()
export class DocumentsService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    config: ConfigService,
  ) {
    this.maxBytes = (config.get<number>('storage.maxUploadMb') ?? 100) * 1024 * 1024;
  }

  async upload(user: AuthUser, caseId: string, dto: UploadDocumentDto, file: UploadedFileLike) {
    if (!file) throw new BadRequestException('A file is required.');
    if (file.size > this.maxBytes) throw new BadRequestException('File exceeds the maximum allowed size.');
    const lower = file.originalname.toLowerCase();
    if (BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      throw new BadRequestException('This file type is not permitted.');
    }
    const membership = await this.access.assertCanAccessCase(user, caseId);

    // A party may only upload as their own side's PARTY_PRIVATE; tribunal/staff broader.
    const confidentiality = (dto.confidentiality as ConfidentialityLevel) ?? ConfidentialityLevel.CASE_PARTIES;
    if (confidentiality === ConfidentialityLevel.TRIBUNAL_ONLY && !membership.isTribunal) {
      throw new ForbiddenException('Only the tribunal may file tribunal-only documents.');
    }
    const visibleToSide =
      confidentiality === ConfidentialityLevel.PARTY_PRIVATE
        ? dto.visibleToSide ?? membership.sides[0] ?? null
        : null;

    const stored = await this.storage.put(file.buffer, file.originalname);
    const count = await this.prisma.document.count({ where: { caseId } });
    const caseDocumentNumber = `D-${String(count + 1).padStart(4, '0')}`;

    const doc = await this.prisma.document.create({
      data: {
        caseId,
        caseDocumentNumber,
        exhibitNumber: dto.exhibitNumber,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        confidentiality,
        visibleToSide,
        uploadedById: user.id,
        currentVersion: 1,
        versions: {
          create: {
            version: 1,
            storageKey: stored.storageKey,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: stored.fileSize,
            fileHash: stored.fileHash,
            virusScan: 'PENDING',
            uploadedById: user.id,
          },
        },
        activity: { create: { userId: user.id, action: DocumentAction.UPLOAD } },
      },
      include: { versions: true },
    });

    await this.audit.record({
      userId: user.id,
      action: 'DOCUMENT_UPLOAD',
      entityType: 'Document',
      entityId: doc.id,
      caseId,
      metadata: { caseDocumentNumber, confidentiality, hash: stored.fileHash },
    });
    return this.toMeta(doc);
  }

  /** Lists only the documents the user is permitted to see. */
  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    const docs = await this.prisma.document.findMany({
      where: { caseId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { caseDocumentNumber: 'asc' },
    });
    const visible = [];
    for (const d of docs) {
      if (await this.access.canViewDocument(user, d)) visible.push(this.toMeta(d));
    }
    return visible;
  }

  private async loadViewable(user: AuthUser, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    const canView = await this.access.canViewDocument(user, doc);
    if (!canView) throw new ForbiddenException('You are not authorised to access this document.');
    return doc;
  }

  async getMeta(user: AuthUser, documentId: string) {
    const doc = await this.loadViewable(user, documentId);
    await this.prisma.documentActivity.create({ data: { documentId, userId: user.id, action: DocumentAction.VIEW } });
    await this.audit.record({ userId: user.id, action: 'DOCUMENT_VIEW', entityType: 'Document', entityId: documentId, caseId: doc.caseId });
    return this.toMeta(doc);
  }

  /** Returns the bytes for a permitted download and records the download. */
  async download(user: AuthUser, documentId: string, ip?: string) {
    const doc = await this.loadViewable(user, documentId);
    const version = doc.versions[0];
    if (!version) throw new NotFoundException('No file content available.');
    if (version.virusScan === 'INFECTED') throw new ForbiddenException('This file failed malware scanning.');
    const buffer = await this.storage.get(version.storageKey);
    await this.prisma.documentActivity.create({
      data: { documentId, userId: user.id, action: DocumentAction.DOWNLOAD, ipAddress: ip },
    });
    await this.audit.record({ userId: user.id, action: 'DOCUMENT_DOWNLOAD', entityType: 'Document', entityId: documentId, caseId: doc.caseId, ipAddress: ip });
    return { buffer, fileName: version.fileName, mimeType: version.mimeType };
  }

  async activity(user: AuthUser, documentId: string) {
    const doc = await this.loadViewable(user, documentId);
    return this.prisma.documentActivity.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } } },
    });
  }

  private toMeta(doc: {
    id: string; caseId: string; caseDocumentNumber: string; exhibitNumber: string | null;
    category: string; title: string; description: string | null; confidentiality: string;
    visibleToSide: string | null; privileged: boolean; currentVersion: number; createdAt: Date;
    versions: { fileName: string; mimeType: string; fileSize: number; fileHash: string; virusScan: string }[];
  }) {
    const v = doc.versions[0];
    return {
      id: doc.id,
      caseId: doc.caseId,
      caseDocumentNumber: doc.caseDocumentNumber,
      exhibitNumber: doc.exhibitNumber,
      category: doc.category,
      title: doc.title,
      description: doc.description,
      confidentiality: doc.confidentiality,
      visibleToSide: doc.visibleToSide,
      privileged: doc.privileged,
      version: doc.currentVersion,
      fileName: v?.fileName,
      mimeType: v?.mimeType,
      fileSize: v?.fileSize,
      fileHash: v?.fileHash,
      virusScan: v?.virusScan,
      createdAt: doc.createdAt,
    };
  }
}
