import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  ENFORCEMENT_WORDING,
  NO_ENFORCEMENT_GUARANTEE,
  ADMINISTRATION_VS_DECISION,
} from '@gaap/shared';

const INSTITUTION = 'Global Ad Hoc Arbitration Panel';

export interface AwardPdfData {
  caseReference: string;
  caseTitle: string;
  awardType: string;
  seat?: string | null;
  issueDate?: Date | null;
  parties: Array<{ side: string; legalName: string }>;
  tribunal: Array<{ name: string; role: string }>;
  /** Optional body/operative text supplied by the tribunal. */
  body?: string | null;
}

export interface CertificatePdfData {
  certificateNumber: string;
  caseReference: string;
  noticeType: string;
  subject: string;
  issuedAt?: Date | null;
  generatedAt: Date;
  payloadHash: string;
  recipients: Array<{
    label: string;
    email?: string | null;
    status: string;
    portalAvailableAt?: Date | null;
    firstAccessedAt?: Date | null;
    acknowledgedAt?: Date | null;
  }>;
  documents: Array<{ filename: string; contentHash?: string | null }>;
}

/**
 * Renders formal, paginated PDFs (awards and certificates of service) using the
 * standard PDF fonts — no external font assets required. The platform never
 * decides the merits, so award PDFs carry the administration/enforcement
 * boilerplate and a signature block the tribunal completes; the bytes are hashed
 * by the caller for tamper-evidence.
 *
 * Note: text is rendered left-to-right with the bundled Helvetica fonts. Arabic
 * (RTL) award rendering needs an embedded shaping font and is a future addition.
 */
@Injectable()
export class PdfService {
  async renderAward(data: AwardPdfData): Promise<Buffer> {
    const doc = this.newDoc(`Arbitral Award — ${data.caseReference}`);
    const done = this.collect(doc);

    this.heading(doc, INSTITUTION, 'ARBITRAL AWARD');
    doc.moveDown(0.5);

    this.kv(doc, 'Case reference', data.caseReference);
    this.kv(doc, 'Case', data.caseTitle);
    this.kv(doc, 'Award type', this.titleCase(data.awardType));
    if (data.seat) this.kv(doc, 'Seat of arbitration', data.seat);
    this.kv(doc, 'Date of issue', data.issueDate ? this.fmtDate(data.issueDate) : 'Not yet issued (draft)');

    this.sectionTitle(doc, 'Parties');
    for (const p of data.parties) {
      doc.font('Helvetica').fontSize(11).text(`${this.titleCase(p.side)}: ${p.legalName}`);
    }

    this.sectionTitle(doc, 'Arbitral Tribunal');
    if (data.tribunal.length === 0) {
      doc.font('Helvetica').fontSize(11).text('Tribunal not yet constituted.');
    }
    for (const t of data.tribunal) {
      doc.font('Helvetica').fontSize(11).text(`${t.name} — ${this.titleCase(t.role)}`);
    }

    this.sectionTitle(doc, 'Award');
    doc.font('Helvetica').fontSize(11).text(
      data.body && data.body.trim().length > 0
        ? data.body
        : '[The operative text of the award is determined and inserted by the tribunal. The operating company does not decide the merits.]',
      { align: 'left' },
    );

    // Enforcement / administration boilerplate.
    this.sectionTitle(doc, 'Status and Enforcement');
    doc.font('Helvetica').fontSize(9.5).fillColor('#333')
      .text(ENFORCEMENT_WORDING).moveDown(0.4)
      .text(NO_ENFORCEMENT_GUARANTEE).moveDown(0.4)
      .text(ADMINISTRATION_VS_DECISION).fillColor('black');

    // Signature blocks — one per tribunal member.
    this.sectionTitle(doc, 'Signatures');
    const members = data.tribunal.length > 0 ? data.tribunal : [{ name: '________________________', role: 'arbitrator' }];
    for (const t of members) {
      doc.moveDown(1.2);
      doc.font('Helvetica').fontSize(11).text('________________________________________');
      doc.font('Helvetica-Bold').fontSize(11).text(t.name);
      doc.font('Helvetica').fontSize(10).fillColor('#333').text(`${this.titleCase(t.role)}    Date: ____________________`).fillColor('black');
    }

    this.finish(doc);
    return done;
  }

  async renderServiceCertificate(data: CertificatePdfData): Promise<Buffer> {
    const doc = this.newDoc(`Certificate of Electronic Service — ${data.certificateNumber}`);
    const done = this.collect(doc);

    this.heading(doc, INSTITUTION, 'CERTIFICATE OF ELECTRONIC SERVICE');
    doc.moveDown(0.5);

    this.kv(doc, 'Certificate number', data.certificateNumber);
    this.kv(doc, 'Case reference', data.caseReference);
    this.kv(doc, 'Notice type', this.titleCase(data.noticeType));
    this.kv(doc, 'Subject', data.subject);
    if (data.issuedAt) this.kv(doc, 'Issued at', this.fmtDateTime(data.issuedAt));
    this.kv(doc, 'Generated at', this.fmtDateTime(data.generatedAt));

    this.sectionTitle(doc, 'Documents served');
    if (data.documents.length === 0) doc.font('Helvetica').fontSize(11).text('None recorded.');
    for (const d of data.documents) {
      doc.font('Helvetica').fontSize(10).text(`• ${d.filename}${d.contentHash ? `  (SHA-256: ${d.contentHash.slice(0, 16)}…)` : ''}`);
    }

    this.sectionTitle(doc, 'Recipients and delivery');
    for (const r of data.recipients) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(11).text(`${r.label}${r.email ? ` <${r.email}>` : ''}`);
      doc.font('Helvetica').fontSize(10).fillColor('#333')
        .text(`Status: ${this.titleCase(r.status)}`)
        .text(`Made available: ${r.portalAvailableAt ? this.fmtDateTime(r.portalAvailableAt) : '—'}`)
        .text(`First accessed: ${r.firstAccessedAt ? this.fmtDateTime(r.firstAccessedAt) : '—'}`)
        .text(`Acknowledged: ${r.acknowledgedAt ? this.fmtDateTime(r.acknowledgedAt) : '—'}`)
        .fillColor('black');
    }

    this.sectionTitle(doc, 'Integrity');
    doc.font('Helvetica').fontSize(9.5).fillColor('#333')
      .text('Email dispatch is recorded as dispatch only and is never treated as conclusive proof of receipt. Receipt is evidenced by portal access or an explicit acknowledgement, as recorded above.')
      .moveDown(0.4)
      .text(`This certificate is generated from a sealed snapshot. Snapshot SHA-256: ${data.payloadHash}`)
      .fillColor('black');

    this.finish(doc);
    return done;
  }

  // --- pdfkit helpers ------------------------------------------------------

  private newDoc(title: string): PDFKit.PDFDocument {
    // bufferPages lets us stamp footers in a final pass without recursive page adds.
    return new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: title, Author: INSTITUTION } });
  }

  private collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }

  /** Stamps a numbered footer on every buffered page, then ends the document. */
  private finish(doc: PDFKit.PDFDocument) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.height - 48;
      doc.font('Helvetica').fontSize(8).fillColor('#999')
        .text(`${INSTITUTION} — generated document. Not legal advice. Page ${i + 1} of ${range.count}`, 64, bottom, {
          align: 'center', width: doc.page.width - 128, lineBreak: false,
        })
        .fillColor('black');
    }
    doc.flushPages();
    doc.end();
  }

  private heading(doc: PDFKit.PDFDocument, institution: string, title: string) {
    doc.font('Helvetica-Bold').fontSize(13).text(institution, { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('Administered ad hoc arbitration — the tribunal alone decides the merits', { align: 'center' }).fillColor('black');
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' });
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string) {
    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(12).text(title.toUpperCase());
    doc.moveDown(0.3);
  }

  private kv(doc: PDFKit.PDFDocument, key: string, value: string) {
    doc.font('Helvetica-Bold').fontSize(11).text(`${key}: `, { continued: true }).font('Helvetica').text(value);
  }

  private titleCase(s: string): string {
    return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private fmtDate(d: Date): string {
    return new Date(d).toISOString().slice(0, 10);
  }

  private fmtDateTime(d: Date): string {
    return new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}
