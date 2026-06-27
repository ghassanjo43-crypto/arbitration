import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/types';

/** Permissions that authorise viewing arbitrator ACCESS (login) emails. */
const INTERNAL_VIEW_PERMISSIONS: Permission[] = [
  Permission.USER_MANAGE, // Super Admin / Admin
  Permission.APPOINTMENT_MANAGE, // Registrar
  Permission.ARBITRATOR_APPROVE, // Council / Appointing Authority
  Permission.CONFLICT_REVIEW, // Registrar / Council
];

export interface ArbitratorSearchQuery {
  q?: string;
  legalField?: string;
  industry?: string;
  language?: string;
  nationality?: string;
  country?: string;
  availability?: string;
  feeBand?: string;
  minYears?: number;
  minSole?: number;
  minChair?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Public arbitrator directory. Only APPROVED, non-deleted profiles are exposed.
 * Returns a curated public projection — no internal review fields.
 */
@Injectable()
export class ArbitratorsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: ArbitratorSearchQuery) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 12, 50);

    const where: Prisma.ArbitratorProfileWhereInput = {
      deletedAt: null,
      approvalStatus: 'APPROVED',
      ...(query.availability ? { availability: query.availability as never } : {}),
      ...(query.feeBand ? { feeBand: query.feeBand as never } : {}),
      ...(query.nationality ? { nationality: { contains: query.nationality, mode: 'insensitive' } } : {}),
      ...(query.country ? { countryOfResidence: { contains: query.country, mode: 'insensitive' } } : {}),
      ...(query.minYears ? { yearsExperience: { gte: query.minYears } } : {}),
      ...(query.minSole ? { casesAsSole: { gte: query.minSole } } : {}),
      ...(query.minChair ? { casesAsChair: { gte: query.minChair } } : {}),
    };

    const and: Prisma.ArbitratorProfileWhereInput[] = [];
    if (query.q) {
      and.push({
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { biography: { contains: query.q, mode: 'insensitive' } },
          { professionalTitle: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.legalField) {
      and.push({ legalFields: { some: { kind: 'LEGAL_FIELD', field: query.legalField } } });
    }
    if (query.industry) {
      and.push({ legalFields: { some: { kind: 'INDUSTRY', field: query.industry } } });
    }
    if (query.language) {
      and.push({ languages: { some: { language: { equals: query.language, mode: 'insensitive' } } } });
    }
    if (and.length) where.AND = and;

    const [rows, total] = await Promise.all([
      this.prisma.arbitratorProfile.findMany({
        where,
        include: { legalFields: true, languages: true },
        orderBy: [{ casesAsChair: 'desc' }, { yearsExperience: 'desc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.arbitratorProfile.count({ where }),
    ]);

    return { data: rows.map((r) => this.toPublic(r)), total, page, pageSize };
  }

  async findOne(id: string) {
    const r = await this.prisma.arbitratorProfile.findFirst({
      where: { id, deletedAt: null, approvalStatus: 'APPROVED' },
      include: { legalFields: true, languages: true, references: true },
    });
    return r ? this.toPublic(r, true) : null;
  }

  /**
   * Internal administrative listing. Surfaces each arbitrator's ACCESS (login)
   * email by joining the user account, for authorised internal users only
   * (Super Admin/Admin, Registrar, Council). Never exposed on the public
   * directory and never includes passwords or case/deliberation data.
   */
  async listInternal(user: AuthUser, query: { q?: string; page?: number; pageSize?: number }) {
    if (!user.permissions.some((p) => INTERNAL_VIEW_PERMISSIONS.includes(p as Permission))) {
      throw new ForbiddenException('You are not authorised to view arbitrator access details.');
    }
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const where: Prisma.ArbitratorProfileWhereInput = { deletedAt: null };
    if (query.q) {
      // Search by arbitrator name OR access (login) email.
      where.OR = [
        { fullName: { contains: query.q, mode: 'insensitive' } },
        { user: { email: { contains: query.q, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.arbitratorProfile.findMany({
        where,
        include: { user: { select: { email: true, status: true } }, legalFields: true },
        orderBy: { fullName: 'asc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.arbitratorProfile.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        accessEmail: r.user.email, // the login email — the point of this view
        // There is no separate public/profile email in the model; expose null so
        // the UI can show "same as access" rather than inventing one.
        profileEmail: null as string | null,
        accountStatus: r.user.status,
        availability: r.availability,
        approvalStatus: r.approvalStatus,
        verificationStatus: r.verificationStatus,
        professionalTitle: r.professionalTitle,
        specializations: r.legalFields.filter((f) => f.kind === 'LEGAL_FIELD').map((f) => f.field),
      })),
      total,
      page,
      pageSize,
    };
  }

  private toPublic(r: Prisma.ArbitratorProfileGetPayload<{ include: { legalFields: true; languages: true } }>, full = false) {
    return {
      id: r.id,
      fullName: r.fullName,
      professionalTitle: r.professionalTitle,
      photoUrl: r.photoUrl,
      nationality: r.nationality,
      countryOfResidence: r.countryOfResidence,
      biography: full ? r.biography : r.biography?.slice(0, 280),
      qualifications: full ? r.qualifications : undefined,
      yearsExperience: r.yearsExperience,
      casesAsSole: r.casesAsSole,
      casesAsChair: r.casesAsChair,
      casesAsCoArbitrator: r.casesAsCoArbitrator,
      familiarRules: r.familiarRules,
      jurisdictions: r.jurisdictions,
      feeBand: r.feeBand,
      availability: r.availability,
      memberships: full ? r.memberships : undefined,
      publications: full ? r.publications : undefined,
      verificationStatus: r.verificationStatus,
      legalFields: r.legalFields.filter((f) => f.kind === 'LEGAL_FIELD').map((f) => f.field),
      industries: r.legalFields.filter((f) => f.kind === 'INDUSTRY').map((f) => f.field),
      languages: r.languages.map((l) => l.language),
    };
  }
}
