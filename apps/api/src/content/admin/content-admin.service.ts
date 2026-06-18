import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthUser } from '../../auth/types';
import { UpsertCourtHighlightDto, UpsertNewsDto, UpsertPublicationDto } from './dto';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

@Injectable()
export class ContentAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
    const root = slugify(base) || 'item';
    let slug = root;
    let n = 1;
    while (await exists(slug)) slug = `${root}-${++n}`;
    return slug;
  }

  // ---- News ----
  listNews() {
    return this.prisma.newsArticle.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async createNews(user: AuthUser, dto: UpsertNewsDto) {
    const slug = await this.uniqueSlug(dto.title, async (s) => !!(await this.prisma.newsArticle.findUnique({ where: { slug: s } })));
    const article = await this.prisma.newsArticle.create({ data: { ...dto, slug, tags: dto.tags ?? [], status: ContentStatus.DRAFT } });
    await this.audit.record({ userId: user.id, action: 'NEWS_CREATED', entityType: 'NewsArticle', entityId: article.id });
    return article;
  }

  async updateNews(user: AuthUser, id: string, dto: UpsertNewsDto) {
    await this.assertExists('newsArticle', id);
    const article = await this.prisma.newsArticle.update({ where: { id }, data: { ...dto, tags: dto.tags ?? undefined } });
    await this.audit.record({ userId: user.id, action: 'NEWS_UPDATED', entityType: 'NewsArticle', entityId: id });
    return article;
  }

  // ---- Court highlights ----
  listHighlights() {
    return this.prisma.courtHighlight.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async createHighlight(user: AuthUser, dto: UpsertCourtHighlightDto) {
    const slug = await this.uniqueSlug(dto.caseName, async (s) => !!(await this.prisma.courtHighlight.findUnique({ where: { slug: s } })));
    const row = await this.prisma.courtHighlight.create({
      data: { ...dto, slug, tags: dto.tags ?? [], decisionDate: dto.decisionDate ? new Date(dto.decisionDate) : undefined, status: ContentStatus.DRAFT },
    });
    await this.audit.record({ userId: user.id, action: 'COURT_HIGHLIGHT_CREATED', entityType: 'CourtHighlight', entityId: row.id });
    return row;
  }

  // ---- Publications ----
  listPublications() {
    return this.prisma.publication.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async createPublication(user: AuthUser, dto: UpsertPublicationDto) {
    const slug = await this.uniqueSlug(dto.title, async (s) => !!(await this.prisma.publication.findUnique({ where: { slug: s } })));
    const row = await this.prisma.publication.create({ data: { ...dto, slug, tags: dto.tags ?? [], status: ContentStatus.DRAFT } });
    await this.audit.record({ userId: user.id, action: 'PUBLICATION_CREATED', entityType: 'Publication', entityId: row.id });
    return row;
  }

  // ---- Shared publish / archive across content types ----
  async setStatus(user: AuthUser, type: 'news' | 'highlight' | 'publication', id: string, status: ContentStatus) {
    const publishedAt = status === ContentStatus.PUBLISHED ? new Date() : null;
    const data = { status, publishedAt };
    let result;
    if (type === 'news') result = await this.prisma.newsArticle.update({ where: { id }, data });
    else if (type === 'highlight') result = await this.prisma.courtHighlight.update({ where: { id }, data });
    else result = await this.prisma.publication.update({ where: { id }, data });
    await this.audit.record({ userId: user.id, action: `CONTENT_${status}`, entityType: type, entityId: id });
    return result;
  }

  private async assertExists(model: 'newsArticle' | 'courtHighlight' | 'publication', id: string) {
    // Narrow runtime guard for clearer 404s before update.
    const found =
      model === 'newsArticle'
        ? await this.prisma.newsArticle.findUnique({ where: { id }, select: { id: true } })
        : model === 'courtHighlight'
          ? await this.prisma.courtHighlight.findUnique({ where: { id }, select: { id: true } })
          : await this.prisma.publication.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Content item not found.');
  }
}
