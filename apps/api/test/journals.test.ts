import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createDb,
  type Database,
  journalEntries,
  journalLines,
  type Transaction,
  withTenant,
} from '@wellbuddy/db';
import { TEST_DATABASE_URL, TEST_DATABASE_URL_OWNER, truncateAll } from '@wellbuddy/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface Entry {
  id: string;
  number: string;
  entryNo: number;
  entryDate: string;
  status: string;
  totalAmount: number;
  reversedById: string | null;
  reversalOfId: string | null;
  rejectionReason: string | null;
  lines: { accountCode: string; debit: number; credit: number; partnerName: string | null }[];
  attachments: { id: string }[];
}

/** 드리즐이 감싼 PG 오류의 원래 메시지 */
function pgMessage(e: unknown): string {
  const err = e as { message?: string; cause?: { message?: string } };
  return err.cause?.message ?? err.message ?? '';
}

describe('전표·회계기간', () => {
  let app: NestExpressApplication;
  let ownerDb: Database;
  let appDb: Database;
  let owner: Agent;
  let accountant: Agent;
  let approver: Agent;
  let employee: Agent;
  let companyId: string;
  let ownerUserId: string;
  const acc: Record<string, string> = {};
  let customer: string;
  let supplier: string;

  const line = (code: string, debit: number, credit: number, partnerId?: string) => ({
    accountId: acc[code]!,
    debit,
    credit,
    ...(partnerId ? { partnerId } : {}),
  });

  /** 현금 매출(대체전표) 하나를 만든다 */
  const cashSale = (agent: Agent, entryDate: string, amount: number, status = 'draft') =>
    agent.post('/api/journals').send({
      entry: {
        entryDate,
        description: '현금 매출',
        lines: [line('101', amount, 0), line('401', 0, amount)],
      },
      status,
    });

  const tenant = <T>(fn: (tx: Transaction) => Promise<T>) =>
    withTenant(appDb, { userId: ownerUserId, companyId }, fn);

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ownerDb = createDb(TEST_DATABASE_URL_OWNER, { max: 1 });
    appDb = createDb(TEST_DATABASE_URL, { max: 1 });
    ({ agent: owner, companyId } = await ownerWithCompany(app, 'owner@journal.local', '전표상사'));
    ownerUserId = (await owner.get('/api/auth/me').expect(200)).body.user.id;
    accountant = await inviteAndJoin(app, owner, 'acct@journal.local', 'accountant');
    approver = await inviteAndJoin(app, owner, 'approver@journal.local', 'approver');
    employee = await inviteAndJoin(app, owner, 'emp@journal.local', 'employee');

    const accounts = (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[];
    for (const a of accounts) acc[a.code] = a.id;
    customer = (
      await owner.post('/api/partners').send({ name: '한빛상사', kind: 'customer' }).expect(201)
    ).body.id;
    supplier = (
      await owner.post('/api/partners').send({ name: '누리유통', kind: 'supplier' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ownerDb.$client.end();
    await appDb.$client.end();
    await app.close();
  });

  describe('작성·채번·수정·삭제', () => {
    it('저장하면 날짜별로 1번부터 번호를 매기고, 회계연도와 월별 기간이 자동으로 생긴다', async () => {
      const first = (await cashSale(owner, '2026-03-02', 100_000).expect(201)).body as Entry;
      const second = (await cashSale(owner, '2026-03-02', 50_000).expect(201)).body as Entry;
      const other = (await cashSale(owner, '2026-03-03', 70_000).expect(201)).body as Entry;
      expect([first.entryNo, second.entryNo, other.entryNo]).toEqual([1, 2, 1]);
      expect(first).toMatchObject({
        number: '2026-03-02-1',
        status: 'draft',
        totalAmount: 100_000,
      });
      expect(first.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
        ['101', 100_000, 0],
        ['401', 0, 100_000],
      ]);

      const years = (await owner.get('/api/fiscal-years').expect(200)).body;
      const fy2026 = years.find((y: { label: string }) => y.label === '2026');
      expect(fy2026).toMatchObject({ startDate: '2026-01-01', endDate: '2026-12-31' });
      expect(fy2026.periods).toHaveLength(12);
      expect(fy2026.periods[2]).toMatchObject({
        periodNo: 3,
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        counts: { draft: 3, pending: 0, posted: 0 },
      });
    });

    it('동시에 저장해도 전표번호가 겹치지 않는다', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => cashSale(owner, '2026-03-10', 1_000)),
      );
      const numbers = results.map((r) => (r.body as Entry).entryNo).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('차대가 맞지 않거나 규칙을 어기면 저장하지 않는다', async () => {
      const unbalanced = await owner
        .post('/api/journals')
        .send({
          entry: { entryDate: '2026-03-02', lines: [line('101', 1000, 0), line('401', 0, 900)] },
        })
        .expect(400);
      expect(unbalanced.body).toMatchObject({ code: 'JOURNAL_INVALID' });
      expect(unbalanced.body.message).toContain('100원');

      const bothSides = await owner
        .post('/api/journals')
        .send({
          entry: {
            entryDate: '2026-03-02',
            lines: [{ accountId: acc['101'], debit: 1000, credit: 1000 }, line('401', 0, 1000)],
          },
        })
        .expect(400);
      expect(bothSides.body.code).toBe('JOURNAL_INVALID');

      const noPartner = await owner
        .post('/api/journals')
        .send({
          entry: { entryDate: '2026-03-02', lines: [line('108', 5000, 0), line('401', 0, 5000)] },
        })
        .expect(400);
      expect(noPartner.body).toMatchObject({ code: 'PARTNER_REQUIRED' });
      expect(noPartner.body.message).toContain('외상매출금');

      const fraction = await owner
        .post('/api/journals')
        .send({
          entry: { entryDate: '2026-03-02', lines: [line('101', 10.5, 0), line('401', 0, 10.5)] },
        })
        .expect(400);
      expect(fraction.body.code).toBe('VALIDATION_ERROR');

      const opening = await owner
        .post('/api/journals')
        .send({
          entry: {
            entryDate: '2026-03-02',
            type: 'opening',
            lines: [line('101', 1, 0), line('331', 0, 1)],
          },
        })
        .expect(400);
      expect(opening.body.code).toBe('VALIDATION_ERROR');
    });

    it('작성중 전표는 고치고 지울 수 있고, 날짜를 바꾸면 번호를 새로 받는다', async () => {
      const created = (await cashSale(owner, '2026-04-01', 30_000).expect(201)).body as Entry;
      const updated = (
        await owner
          .put(`/api/journals/${created.id}`)
          .send({
            entryDate: '2026-04-02',
            description: '수정한 매출',
            lines: [line('103', 33_000, 0), line('401', 0, 33_000)],
          })
          .expect(200)
      ).body as Entry;
      expect(updated).toMatchObject({ entryDate: '2026-04-02', entryNo: 1, totalAmount: 33_000 });
      expect(updated.lines[0]!.accountCode).toBe('103');

      await owner.delete(`/api/journals/${created.id}`).expect(204);
      await owner.get(`/api/journals/${created.id}`).expect(404);
    });

    it('목록은 기간·상태·계정·검색어로 거른다', async () => {
      const march = (
        await owner
          .get('/api/journals')
          .query({ from: '2026-03-01', to: '2026-03-31', status: 'draft', limit: 5 })
          .expect(200)
      ).body;
      expect(march.total).toBe(9);
      expect(march.items).toHaveLength(5);
      expect(march.items[0].number).toBe('2026-03-02-1');

      const byAccount = (
        await owner.get('/api/journals').query({ accountId: acc['103'] }).expect(200)
      ).body;
      expect(byAccount.total).toBe(0);
      const byText = (await owner.get('/api/journals').query({ q: '현금' }).expect(200)).body;
      expect(byText.total).toBeGreaterThan(0);
    });
  });

  describe('매입매출전표 부가세', () => {
    it('부가세예수금 분개가 부가세 금액과 맞아야 저장된다', async () => {
      const sale = {
        entryDate: '2026-05-10',
        type: 'sales',
        description: '상품 외상 매출',
        vat: {
          vatType: 'taxable',
          evidenceType: 'tax_invoice',
          supplyAmount: 1_000_000,
          vatAmount: 100_000,
          partnerId: customer,
        },
        lines: [
          line('108', 1_100_000, 0, customer),
          line('401', 0, 1_000_000),
          line('255', 0, 100_000),
        ],
      };
      const ok = (await owner.post('/api/journals').send({ entry: sale }).expect(201)).body;
      expect(ok.vat).toMatchObject({ vatAmount: 100_000, partnerName: '한빛상사' });

      const wrong = await owner
        .post('/api/journals')
        .send({ entry: { ...sale, vat: { ...sale.vat, vatAmount: 90_000 } } })
        .expect(400);
      expect(wrong.body.code).toBe('VAT_MISMATCH');

      const noPartner = await owner
        .post('/api/journals')
        .send({ entry: { ...sale, vat: { ...sale.vat, partnerId: null } } })
        .expect(400);
      expect(noPartner.body.code).toBe('VAT_PARTNER_REQUIRED');

      const vatOnGeneral = await owner
        .post('/api/journals')
        .send({ entry: { ...sale, type: 'general' } })
        .expect(400);
      expect(vatOnGeneral.body.code).toBe('VALIDATION_ERROR');
    });

    it('불공제 매입은 부가세대급금 없이 비용에 포함한다', async () => {
      const purchase = {
        entryDate: '2026-05-11',
        type: 'purchase',
        vat: {
          vatType: 'taxable',
          evidenceType: 'tax_invoice',
          supplyAmount: 200_000,
          vatAmount: 20_000,
          deductible: false,
          partnerId: supplier,
        },
        lines: [line('813', 220_000, 0), line('253', 0, 220_000, supplier)],
      };
      await owner.post('/api/journals').send({ entry: purchase }).expect(201);
      const withVat = await owner
        .post('/api/journals')
        .send({
          entry: {
            ...purchase,
            lines: [
              line('813', 200_000, 0),
              line('135', 20_000, 0),
              line('253', 0, 220_000, supplier),
            ],
          },
        })
        .expect(400);
      expect(withVat.body.code).toBe('VAT_MISMATCH');
    });
  });

  describe('상태 흐름', () => {
    it('승인 절차가 꺼져 있으면 경리가 바로 전기하고, 전기한 전표는 고치거나 지울 수 없다', async () => {
      const posted = (await cashSale(accountant, '2026-06-01', 10_000, 'posted').expect(201))
        .body as Entry;
      expect(posted.status).toBe('posted');

      const edit = await accountant
        .put(`/api/journals/${posted.id}`)
        .send({ entryDate: '2026-06-01', lines: [line('101', 1, 0), line('401', 0, 1)] })
        .expect(409);
      expect(edit.body).toMatchObject({ code: 'JOURNAL_STATUS' });
      expect(edit.body.message).toBe('전기 전표는 수정할 수 없습니다.');
      await accountant.delete(`/api/journals/${posted.id}`).expect(409);
      await accountant.post(`/api/journals/${posted.id}/post`).expect(409);
    });

    it('승인요청 → 반려 → 재요청 → 승인', async () => {
      const draft = (await cashSale(accountant, '2026-06-02', 20_000).expect(201)).body as Entry;
      await accountant.post(`/api/journals/${draft.id}/submit`).expect(200);
      await accountant.put(`/api/journals/${draft.id}`).send({}).expect(400);

      // 직원은 회계 권한이 없고, 경리는 승인할 수 없다
      await employee.post(`/api/journals/${draft.id}/approve`).expect(403);
      const notApprover = await accountant.post(`/api/journals/${draft.id}/approve`).expect(403);
      expect(notApprover.body.code).toBe('APPROVER_ONLY');

      const rejected = (
        await approver
          .post(`/api/journals/${draft.id}/reject`)
          .send({ reason: '증빙 첨부 필요' })
          .expect(200)
      ).body as Entry;
      expect(rejected).toMatchObject({ status: 'draft', rejectionReason: '증빙 첨부 필요' });

      await accountant.post(`/api/journals/${draft.id}/submit`).expect(200);
      const approved = (await approver.post(`/api/journals/${draft.id}/approve`).expect(200))
        .body as Entry & { postedByName: string; submittedByName: string };
      expect(approved).toMatchObject({
        status: 'posted',
        rejectionReason: null,
        postedByName: 'approver',
        submittedByName: 'accountant',
      });
    });

    it('승인요청은 요청한 사람이 회수할 수 있다', async () => {
      const draft = (await cashSale(accountant, '2026-06-03', 5_000, 'pending').expect(201))
        .body as Entry;
      expect(draft.status).toBe('pending');
      const back = (await accountant.post(`/api/journals/${draft.id}/withdraw`).expect(200))
        .body as Entry;
      expect(back.status).toBe('draft');
    });

    it('승인 절차를 켜면 경리는 바로 전기할 수 없고, 결재권자는 자기 요청을 승인할 수 없다', async () => {
      await owner
        .patch('/api/companies/current')
        .send({ journalApprovalRequired: true })
        .expect(200);
      try {
        const direct = await cashSale(accountant, '2026-06-04', 1_000, 'posted').expect(403);
        expect(direct.body.code).toBe('APPROVAL_REQUIRED');
        // 거부되면 전표도 남지 않는다
        const left = (
          await owner.get('/api/journals').query({ from: '2026-06-04', to: '2026-06-04' })
        ).body;
        expect(left.total).toBe(0);

        // 대표는 바로 전기할 수 있다
        await cashSale(owner, '2026-06-04', 1_000, 'posted').expect(201);

        const mine = (await cashSale(owner, '2026-06-04', 2_000).expect(201)).body as Entry;
        await owner.post(`/api/journals/${mine.id}/submit`).expect(200);
        await owner.post(`/api/journals/${mine.id}/approve`).expect(200);
      } finally {
        await owner
          .patch('/api/companies/current')
          .send({ journalApprovalRequired: false })
          .expect(200);
      }
    });

    it('역분개하면 차대가 반대인 전표가 전기되고 원래 전표는 역분개됨이 된다', async () => {
      const original = (
        await owner
          .post('/api/journals')
          .send({
            entry: {
              entryDate: '2026-06-10',
              type: 'sales',
              description: '잘못 입력한 매출',
              vat: {
                vatType: 'taxable',
                evidenceType: 'tax_invoice',
                supplyAmount: 300_000,
                vatAmount: 30_000,
                partnerId: customer,
              },
              lines: [
                line('108', 330_000, 0, customer),
                line('401', 0, 300_000),
                line('255', 0, 30_000),
              ],
            },
            status: 'posted',
          })
          .expect(201)
      ).body as Entry;

      const early = await owner
        .post(`/api/journals/${original.id}/reverse`)
        .send({ entryDate: '2026-06-09' })
        .expect(400);
      expect(early.body.code).toBe('REVERSAL_DATE_INVALID');

      const reversal = (
        await owner
          .post(`/api/journals/${original.id}/reverse`)
          .send({ entryDate: '2026-06-15' })
          .expect(201)
      ).body as Entry & { vat: { supplyAmount: number; vatAmount: number }; description: string };
      expect(reversal).toMatchObject({
        status: 'posted',
        reversalOfId: original.id,
        entryDate: '2026-06-15',
        totalAmount: 330_000,
      });
      expect(reversal.description).toContain('[역분개] 2026-06-10-1');
      expect(reversal.vat).toMatchObject({ supplyAmount: -300_000, vatAmount: -30_000 });
      expect(reversal.lines.map((l) => [l.accountCode, l.debit, l.credit, l.partnerName])).toEqual([
        ['108', 0, 330_000, '한빛상사'],
        ['401', 300_000, 0, null],
        ['255', 30_000, 0, null],
      ]);

      const after = (await owner.get(`/api/journals/${original.id}`).expect(200)).body as Entry;
      expect(after).toMatchObject({ status: 'reversed', reversedById: reversal.id });
      const again = await owner.post(`/api/journals/${original.id}/reverse`).send({}).expect(409);
      expect(again.body.message).toBe('역분개된 전표는 역분개할 수 없습니다.');
    });
  });

  describe('증빙 첨부', () => {
    it('파일을 붙이고, 전기한 전표의 증빙은 떼거나 파일을 지울 수 없다', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const file = (await owner.post('/api/files').attach('file', png, 'receipt.png').expect(201))
        .body;
      const draft = (
        await owner
          .post('/api/journals')
          .send({
            entry: {
              entryDate: '2026-07-01',
              lines: [line('830', 8_000, 0), line('101', 0, 8_000)],
              attachmentIds: [file.id],
            },
          })
          .expect(201)
      ).body as Entry;
      expect(draft.attachments.map((a) => a.id)).toEqual([file.id]);

      await owner.post(`/api/journals/${draft.id}/post`).expect(200);
      await owner.delete(`/api/journals/${draft.id}/attachments/${file.id}`).expect(409);
      const del = await owner.delete(`/api/files/${file.id}`).expect(409);
      expect(del.body.code).toBe('FILE_IN_USE');

      // 전기 후에도 증빙을 더 붙일 수 있다
      const file2 = (await owner.post('/api/files').attach('file', png, 'more.png').expect(201))
        .body;
      const withTwo = (
        await owner
          .post(`/api/journals/${draft.id}/attachments`)
          .send({ fileIds: [file2.id] })
          .expect(200)
      ).body as Entry;
      expect(withTwo.attachments).toHaveLength(2);
    });
  });

  describe('기간 마감', () => {
    it('작성중 전표가 남아 있으면 마감하지 않는다', async () => {
      const years = (await owner.get('/api/fiscal-years').expect(200)).body;
      const march = years.find((y: { label: string }) => y.label === '2026').periods[2];
      const res = await accountant.post(`/api/accounting-periods/${march.id}/lock`).expect(409);
      expect(res.body.code).toBe('DRAFTS_IN_PERIOD');
    });

    it('마감하면 그 달까지 모두 잠기고, 해제는 대표·관리자만 한다', async () => {
      // 1~2월만 있는 상태로 2월까지 마감
      const years = (await owner.get('/api/fiscal-years').expect(200)).body;
      const periods = years.find((y: { label: string }) => y.label === '2026').periods;
      await cashSale(owner, '2026-02-10', 40_000, 'posted').expect(201);

      const locked = (
        await accountant.post(`/api/accounting-periods/${periods[1].id}/lock`).expect(200)
      ).body;
      expect(locked).toEqual({ locked: 2 });

      const inLocked = await cashSale(owner, '2026-01-15', 1_000).expect(409);
      expect(inLocked.body.code).toBe('PERIOD_LOCKED');
      const posted = (
        await owner.get('/api/journals').query({ from: '2026-02-10', to: '2026-02-10' })
      ).body.items[0] as Entry;
      const reverseInLocked = await owner
        .post(`/api/journals/${posted.id}/reverse`)
        .send({ entryDate: '2026-02-11' })
        .expect(409);
      expect(reverseInLocked.body.code).toBe('PERIOD_LOCKED');
      // 마감된 달의 전표도 열린 달 날짜로는 역분개할 수 있다
      await owner
        .post(`/api/journals/${posted.id}/reverse`)
        .send({ entryDate: '2026-07-01' })
        .expect(201);

      const denied = await accountant
        .post(`/api/accounting-periods/${periods[1].id}/unlock`)
        .expect(403);
      expect(denied.body.code).toBe('UNLOCK_FORBIDDEN');
      expect(
        (await owner.post(`/api/accounting-periods/${periods[0].id}/unlock`).expect(200)).body,
      ).toEqual({ unlocked: 2 });
      await cashSale(owner, '2026-01-15', 1_000).expect(201);
    });
  });

  describe('기초잔액·전기이월', () => {
    let fy2025: string;

    it('기초잔액은 재무상태표 계정만, 차대가 맞아야 저장한다', async () => {
      fy2025 = (await owner.post('/api/fiscal-years').send({ date: '2025-06-30' }).expect(201)).body
        .id;
      const incomeAccount = await owner
        .put(`/api/fiscal-years/${fy2025}/opening-balances`)
        .send({ lines: [line('101', 1000, 0), line('401', 0, 1000)] })
        .expect(400);
      expect(incomeAccount.body.code).toBe('OPENING_BS_ONLY');

      const opening = (
        await owner
          .put(`/api/fiscal-years/${fy2025}/opening-balances`)
          .send({
            lines: [
              line('101', 5_000_000, 0),
              line('108', 2_000_000, 0, customer),
              line('251', 0, 1_000_000, supplier),
              line('331', 0, 6_000_000),
            ],
          })
          .expect(200)
      ).body;
      expect(opening).toMatchObject({ source: 'manual', locked: false });
      expect(opening.lines).toHaveLength(4);

      // 기초잔액 전표는 일반 전표 API 로 고칠 수 없다
      const blocked = await owner.post(`/api/journals/${opening.entryId}/reverse`).send({});
      expect(blocked.status).toBe(400);
      expect(blocked.body.code).toBe('OPENING_ENTRY');
    });

    it('전기이월하면 연말 잔액이 다음 연도 기초잔액이 되고 당기순이익은 이월이익잉여금에 더해진다', async () => {
      // 2025년: 외상 매출 110만(부가세 포함), 소모품비 현금 30만
      await owner
        .post('/api/journals')
        .send({
          entry: {
            entryDate: '2025-08-01',
            type: 'sales',
            vat: {
              vatType: 'taxable',
              evidenceType: 'tax_invoice',
              supplyAmount: 1_000_000,
              vatAmount: 100_000,
              partnerId: customer,
            },
            lines: [
              line('108', 1_100_000, 0, customer),
              line('401', 0, 1_000_000),
              line('255', 0, 100_000),
            ],
          },
          status: 'posted',
        })
        .expect(201);
      await owner
        .post('/api/journals')
        .send({
          entry: {
            entryDate: '2025-09-01',
            lines: [line('830', 300_000, 0), line('101', 0, 300_000)],
          },
          status: 'posted',
        })
        .expect(201);
      // 작성중 전표는 이월 금액에 들어가지 않는다
      await cashSale(owner, '2025-10-01', 999_000).expect(201);

      const result = (await owner.post(`/api/fiscal-years/${fy2025}/carry-forward`).expect(200))
        .body;
      expect(result.netIncome).toBe(700_000);

      const opening2026 = (
        await owner.get(`/api/fiscal-years/${result.nextFiscalYearId}/opening-balances`).expect(200)
      ).body;
      expect(opening2026.source).toBe('carry_forward');
      const balances = Object.fromEntries(
        opening2026.lines.map((l: { accountCode: string; debit: number; credit: number }) => [
          l.accountCode,
          l.debit - l.credit,
        ]),
      );
      expect(balances).toEqual({
        '101': 4_700_000,
        '108': 3_100_000,
        '251': -1_000_000,
        '255': -100_000,
        '331': -6_000_000,
        '375': -700_000,
      });

      const years = (await owner.get('/api/fiscal-years').expect(200)).body;
      expect(years.map((y: { label: string }) => y.label)).toEqual(['2026', '2025']);
      expect(years[1].carriedForwardAt).not.toBeNull();
      expect(years[0].opening.totalAmount).toBe(7_800_000);

      // 회계연도가 있으면 시작 월을 바꿀 수 없다
      const month = await owner
        .patch('/api/companies/current')
        .send({ fiscalYearStartMonth: 4 })
        .expect(409);
      expect(month.body.code).toBe('FISCAL_YEAR_IN_USE');
    });
  });

  describe('DB 트리거(서비스를 거치지 않은 직접 쓰기)', () => {
    let postedId: string;

    beforeAll(async () => {
      postedId = ((await cashSale(owner, '2026-08-01', 12_345, 'posted').expect(201)).body as Entry)
        .id;
    });

    it('전기한 전표는 앱 롤로 직접 고치거나 지울 수 없다', async () => {
      await expect(
        tenant((tx) =>
          tx
            .update(journalEntries)
            .set({ description: '몰래 수정' })
            .where(eq(journalEntries.id, postedId)),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_POSTED_IMMUTABLE'));
      await expect(
        tenant((tx) =>
          tx.update(journalLines).set({ debit: 1 }).where(eq(journalLines.entryId, postedId)),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_POSTED_IMMUTABLE'));
      await expect(
        tenant((tx) => tx.delete(journalEntries).where(eq(journalEntries.id, postedId))),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_POSTED_IMMUTABLE'));
      // 소유자 롤(RLS 우회)이라도 트리거는 막는다
      await expect(
        ownerDb
          .update(journalEntries)
          .set({ totalAmount: 1 })
          .where(eq(journalEntries.id, postedId)),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_POSTED_IMMUTABLE'));
    });

    it('차대가 맞지 않는 줄은 커밋할 때 거부된다', async () => {
      const draft = (await cashSale(owner, '2026-08-02', 1_000).expect(201)).body as Entry;
      await expect(
        tenant((tx) =>
          tx
            .update(journalLines)
            .set({ debit: 999 })
            .where(sql`${journalLines.entryId} = ${draft.id} and ${journalLines.debit} > 0`),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_UNBALANCED'));
      // 줄 합계와 전표 합계도 같아야 한다
      await expect(
        tenant((tx) =>
          tx.update(journalEntries).set({ totalAmount: 5 }).where(eq(journalEntries.id, draft.id)),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_UNBALANCED'));
      // 한 줄짜리 전표도 안 된다
      await expect(
        tenant((tx) =>
          tx
            .delete(journalLines)
            .where(sql`${journalLines.entryId} = ${draft.id} and ${journalLines.lineNo} = 2`),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_UNBALANCED'));
    });

    it('마감된 기간에는 직접 넣을 수 없다', async () => {
      const years = (await owner.get('/api/fiscal-years').expect(200)).body;
      const fy2026 = years.find((y: { label: string }) => y.label === '2026');
      // 2026년 1월까지 마감하면 그 전의 열린 기간(2025년 12개월)도 함께 마감된다.
      // 그 기간의 작성중 전표를 먼저 정리한다.
      const drafts = (
        await owner
          .get('/api/journals')
          .query({ from: '2025-01-01', to: '2026-01-31', status: 'draft' })
      ).body.items as Entry[];
      expect(drafts.map((d) => d.entryDate)).toEqual(['2025-10-01', '2026-01-15']);
      for (const d of drafts) await owner.delete(`/api/journals/${d.id}`).expect(204);
      expect(
        (await owner.post(`/api/accounting-periods/${fy2026.periods[0].id}/lock`).expect(200)).body,
      ).toEqual({ locked: 13 });

      await expect(
        tenant((tx) =>
          tx.insert(journalEntries).values({
            companyId,
            fiscalYearId: fy2026.id,
            entryDate: '2026-01-21',
            entryNo: 99,
            type: 'general',
          }),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('PERIOD_LOCKED'));
      await owner.post(`/api/accounting-periods/${fy2026.periods[0].id}/unlock`).expect(200);
    });

    it('다른 회사 전표에 줄을 붙일 수 없다', async () => {
      const { agent: other, companyId: otherCompany } = await ownerWithCompany(
        app,
        'other@journal.local',
        '다른회사',
      );
      const otherAccounts = (await other.get('/api/accounts').expect(200)).body as {
        id: string;
        code: string;
      }[];
      const otherCash = otherAccounts.find((a) => a.code === '101')!.id;
      const draft = (await cashSale(owner, '2026-08-03', 1_000).expect(201)).body as Entry;
      // 우리 회사 전표에 다른 회사 계정을 쓸 수 없다
      await expect(
        tenant((tx) =>
          tx
            .update(journalLines)
            .set({ accountId: otherCash })
            .where(sql`${journalLines.entryId} = ${draft.id} and ${journalLines.lineNo} = 1`),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_ACCOUNT_NOT_FOUND'));
      // 다른 회사 컨텍스트에서 우리 전표에 줄을 붙일 수 없다
      const otherUser = (await other.get('/api/auth/me').expect(200)).body.user.id;
      await expect(
        withTenant(appDb, { userId: otherUser, companyId: otherCompany }, (tx) =>
          tx.insert(journalLines).values({
            companyId: otherCompany,
            entryId: draft.id,
            lineNo: 3,
            accountId: otherCash,
            debit: 1,
          }),
        ),
      ).rejects.toSatisfy((e) => pgMessage(e).includes('JOURNAL_ENTRY_NOT_FOUND'));
      // 다른 회사에서는 우리 전표가 보이지 않는다
      await other.get(`/api/journals/${draft.id}`).expect(404);
    });
  });
});
