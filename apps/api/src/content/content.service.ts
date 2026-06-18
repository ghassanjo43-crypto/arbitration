import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Public read access to published content; management endpoints are guarded. */
@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  listNews(page = 1, pageSize = 9) {
    return this.paginate(
      this.prisma.newsArticle.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.newsArticle.count({ where: { status: 'PUBLISHED' } }),
      page,
      pageSize,
    );
  }

  async getNews(slug: string) {
    const a = await this.prisma.newsArticle.findFirst({ where: { slug, status: 'PUBLISHED' } });
    if (!a) throw new NotFoundException('Article not found.');
    return a;
  }

  listHighlights(page = 1, pageSize = 9) {
    return this.paginate(
      this.prisma.courtHighlight.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { decisionDate: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.courtHighlight.count({ where: { status: 'PUBLISHED' } }),
      page,
      pageSize,
    );
  }

  async getHighlight(slug: string) {
    const h = await this.prisma.courtHighlight.findFirst({ where: { slug, status: 'PUBLISHED' } });
    if (!h) throw new NotFoundException('Court highlight not found.');
    return h;
  }

  listPublications(page = 1, pageSize = 12) {
    return this.paginate(
      this.prisma.publication.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.publication.count({ where: { status: 'PUBLISHED' } }),
      page,
      pageSize,
    );
  }

  private async paginate<T>(rowsP: Promise<T[]>, totalP: Promise<number>, page: number, pageSize: number) {
    const [data, total] = await Promise.all([rowsP, totalP]);
    return { data, total, page, pageSize };
  }
}
