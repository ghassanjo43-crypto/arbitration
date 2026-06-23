import { PdfService } from './pdf.service';

const isPdf = (buf: Buffer) => buf.length > 500 && buf.subarray(0, 5).toString() === '%PDF-' && buf.subarray(-6).toString().includes('%%EOF');

describe('PdfService', () => {
  const pdf = new PdfService();

  it('renders a structurally valid award PDF', async () => {
    const buf = await pdf.renderAward({
      caseReference: 'GAAP-2026-000123',
      caseTitle: 'Acme v. Globex',
      awardType: 'FINAL',
      seat: 'Singapore',
      issueDate: new Date('2026-06-01T00:00:00Z'),
      parties: [
        { side: 'CLAIMANT', legalName: 'Acme Trading Ltd' },
        { side: 'RESPONDENT', legalName: 'Globex Corp' },
      ],
      tribunal: [{ name: 'Dr Jane Smith', role: 'TRIBUNAL_CHAIR' }],
      body: 'The Tribunal awards the Claimant USD 1,000,000.',
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders an award PDF even with no tribunal and no body (draft)', async () => {
    const buf = await pdf.renderAward({
      caseReference: 'GAAP-2026-000999', caseTitle: 'Draft', awardType: 'PARTIAL',
      seat: null, issueDate: null, parties: [], tribunal: [], body: null,
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders a structurally valid certificate of service PDF', async () => {
    const buf = await pdf.renderServiceCertificate({
      certificateNumber: 'COS-2026-ABCD1234',
      caseReference: 'GAAP-2026-000123',
      noticeType: 'NOTICE_OF_ARBITRATION',
      subject: 'Notice of Arbitration',
      issuedAt: new Date('2026-05-01T10:00:00Z'),
      generatedAt: new Date('2026-05-02T10:00:00Z'),
      payloadHash: 'a'.repeat(64),
      recipients: [{ label: 'Respondent Ltd', email: 'r@x.com', status: 'ACKNOWLEDGED', portalAvailableAt: new Date(), firstAccessedAt: new Date(), acknowledgedAt: new Date() }],
      documents: [{ filename: 'notice.pdf', contentHash: 'b'.repeat(64) }],
    });
    expect(isPdf(buf)).toBe(true);
  });
});
