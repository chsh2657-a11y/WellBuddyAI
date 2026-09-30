import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { STATEMENT_GROUPS } from '@wellbuddy/accounting-core';
import {
  accounts,
  bankAccounts,
  bankTransactions,
  cardTransactions,
  corporateCards,
  type Transaction,
} from '@wellbuddy/db';
import {
  type BankAccountInput,
  type BankAccountUpdateInput,
  bankName,
  cardCompanyName,
  type CorporateCardInput,
  type CorporateCardUpdateInput,
} from '@wellbuddy/shared';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { FieldCrypto } from '../common/crypto/field-crypto.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext, requireCompanyId } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';

const last4 = (no: string) => `****${no.slice(-4)}`;

/**
 * 수집 대상 은행 계좌·법인카드 등록. 계좌·카드번호는 암호화해 저장하고 끝 4자리만 보여 준다.
 * 같은 번호는 블라인드 인덱스로 중복 등록을 막는다.
 */
@Injectable()
export class SourcesService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {}

  private purpose(kind: 'bank' | 'card', companyId: string) {
    return `evidence:${kind}:${companyId}`;
  }

  /** 장부 계정이 있어야 하고, 계좌는 자산·카드는 부채 계정이어야 한다 */
  private async assertLedger(tx: Transaction, accountId: string, want: 'asset' | 'liability') {
    const [row] = await tx
      .select({ group: accounts.group, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!row) throw new AppException('ACCOUNT_NOT_FOUND', '없는 계정과목입니다.');
    if (STATEMENT_GROUPS[row.group].category !== want) {
      throw new AppException(
        'LEDGER_ACCOUNT_INVALID',
        want === 'asset'
          ? `'${row.name}'은(는) 자산 계정이 아닙니다(예: 103 보통예금).`
          : `'${row.name}'은(는) 부채 계정이 아닙니다(예: 253 미지급금).`,
      );
    }
  }

  // ── 은행 계좌 ────────────────────────────────────────

  private bankView(
    r: typeof bankAccounts.$inferSelect & { ledgerCode: string; ledgerName: string },
  ) {
    return {
      id: r.id,
      bankCode: r.bankCode,
      bankName: bankName(r.bankCode),
      alias: r.alias,
      accountNoMasked: r.accountNoMasked,
      ledgerAccountId: r.ledgerAccountId,
      ledgerAccount: `${r.ledgerCode} ${r.ledgerName}`,
      isActive: r.isActive,
    };
  }

  private async bankRows(tx: Transaction, id?: string) {
    const rows = await tx
      .select({ b: bankAccounts, ledgerCode: accounts.code, ledgerName: accounts.name })
      .from(bankAccounts)
      .innerJoin(accounts, eq(accounts.id, bankAccounts.ledgerAccountId))
      .where(id ? eq(bankAccounts.id, id) : undefined)
      .orderBy(asc(bankAccounts.createdAt));
    return rows.map((r) =>
      this.bankView({ ...r.b, ledgerCode: r.ledgerCode, ledgerName: r.ledgerName }),
    );
  }

  listBankAccounts() {
    return this.db.tenant((tx) => this.bankRows(tx));
  }

  async createBankAccount(input: BankAccountInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        await this.assertLedger(tx, input.ledgerAccountId, 'asset');
        const purpose = this.purpose('bank', companyId);
        const [row] = await tx
          .insert(bankAccounts)
          .values({
            companyId,
            bankCode: input.bankCode,
            alias: input.alias,
            accountNoEnc: this.crypto.encrypt(input.accountNo, purpose),
            accountNoMasked: last4(input.accountNo),
            accountNoIndex: this.crypto.blindIndex(input.accountNo, purpose),
            ledgerAccountId: input.ledgerAccountId,
          })
          .returning({ id: bankAccounts.id });
        await this.audit.record(
          {
            action: 'bank_account.create',
            entity: 'bank_account',
            entityId: row!.id,
            after: { ...input, accountNo: last4(input.accountNo) },
          },
          tx,
        );
        return (await this.bankRows(tx, row!.id))[0]!;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppException(
          'DUPLICATE_BANK_ACCOUNT',
          '이미 등록한 계좌입니다.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  async updateBankAccount(id: string, input: BankAccountUpdateInput) {
    return this.db.tenant(async (tx) => {
      if (input.ledgerAccountId) await this.assertLedger(tx, input.ledgerAccountId, 'asset');
      const [row] = await tx
        .update(bankAccounts)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(bankAccounts.id, id))
        .returning({ id: bankAccounts.id });
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'bank_account.update', entity: 'bank_account', entityId: id, after: input },
        tx,
      );
      return (await this.bankRows(tx, id))[0]!;
    });
  }

  async removeBankAccount(id: string) {
    await this.db.tenant(async (tx) => {
      const [used] = await tx
        .select({ id: bankTransactions.id })
        .from(bankTransactions)
        .where(eq(bankTransactions.bankAccountId, id))
        .limit(1);
      if (used) {
        throw new AppException(
          'SOURCE_IN_USE',
          '거래내역이 있는 계좌는 지울 수 없습니다. 사용 중지로 바꿔 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      const [row] = await tx.delete(bankAccounts).where(eq(bankAccounts.id, id)).returning();
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'bank_account.delete', entity: 'bank_account', entityId: id },
        tx,
      );
    });
  }

  /** 수집 대상: 사용 중인 계좌(계좌번호 복호화) */
  async activeBankRefs(tx: Transaction) {
    const { companyId } = requireCompanyId();
    const rows = await tx
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.isActive, true))
      .orderBy(asc(bankAccounts.createdAt));
    return rows.map((r) => ({
      id: r.id,
      alias: r.alias,
      bankCode: r.bankCode,
      accountNo: this.crypto.decrypt(r.accountNoEnc, this.purpose('bank', companyId)),
    }));
  }

  // ── 법인카드 ─────────────────────────────────────────

  private async cardRows(tx: Transaction, id?: string) {
    const rows = await tx
      .select({ c: corporateCards, ledgerCode: accounts.code, ledgerName: accounts.name })
      .from(corporateCards)
      .innerJoin(accounts, eq(accounts.id, corporateCards.ledgerAccountId))
      .where(id ? eq(corporateCards.id, id) : undefined)
      .orderBy(asc(corporateCards.createdAt));
    return rows.map(({ c, ledgerCode, ledgerName }) => ({
      id: c.id,
      cardCompany: c.cardCompany,
      cardCompanyName: cardCompanyName(c.cardCompany),
      alias: c.alias,
      cardNoMasked: c.cardNoMasked,
      holderName: c.holderName,
      ledgerAccountId: c.ledgerAccountId,
      ledgerAccount: `${ledgerCode} ${ledgerName}`,
      isActive: c.isActive,
    }));
  }

  listCards() {
    return this.db.tenant((tx) => this.cardRows(tx));
  }

  async createCard(input: CorporateCardInput) {
    const { companyId } = requireCompanyContext();
    try {
      return await this.db.tenant(async (tx) => {
        await this.assertLedger(tx, input.ledgerAccountId, 'liability');
        const purpose = this.purpose('card', companyId);
        const [row] = await tx
          .insert(corporateCards)
          .values({
            companyId,
            cardCompany: input.cardCompany,
            alias: input.alias,
            cardNoEnc: this.crypto.encrypt(input.cardNo, purpose),
            cardNoMasked: last4(input.cardNo),
            cardNoIndex: this.crypto.blindIndex(input.cardNo, purpose),
            holderName: input.holderName ?? null,
            ledgerAccountId: input.ledgerAccountId,
          })
          .returning({ id: corporateCards.id });
        await this.audit.record(
          {
            action: 'corporate_card.create',
            entity: 'corporate_card',
            entityId: row!.id,
            after: { ...input, cardNo: last4(input.cardNo) },
          },
          tx,
        );
        return (await this.cardRows(tx, row!.id))[0]!;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppException('DUPLICATE_CARD', '이미 등록한 카드입니다.', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  async updateCard(id: string, input: CorporateCardUpdateInput) {
    return this.db.tenant(async (tx) => {
      if (input.ledgerAccountId) await this.assertLedger(tx, input.ledgerAccountId, 'liability');
      const [row] = await tx
        .update(corporateCards)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(corporateCards.id, id))
        .returning({ id: corporateCards.id });
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'corporate_card.update', entity: 'corporate_card', entityId: id, after: input },
        tx,
      );
      return (await this.cardRows(tx, id))[0]!;
    });
  }

  async removeCard(id: string) {
    await this.db.tenant(async (tx) => {
      const [used] = await tx
        .select({ id: cardTransactions.id })
        .from(cardTransactions)
        .where(eq(cardTransactions.cardId, id))
        .limit(1);
      if (used) {
        throw new AppException(
          'SOURCE_IN_USE',
          '승인내역이 있는 카드는 지울 수 없습니다. 사용 중지로 바꿔 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      const [row] = await tx.delete(corporateCards).where(eq(corporateCards.id, id)).returning();
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'corporate_card.delete', entity: 'corporate_card', entityId: id },
        tx,
      );
    });
  }

  /** 수집 대상: 사용 중인 카드(카드번호 복호화) */
  async activeCardRefs(tx: Transaction) {
    const { companyId } = requireCompanyId();
    const rows = await tx
      .select()
      .from(corporateCards)
      .where(eq(corporateCards.isActive, true))
      .orderBy(asc(corporateCards.createdAt));
    return rows.map((r) => ({
      id: r.id,
      alias: r.alias,
      cardCompany: r.cardCompany,
      cardNo: this.crypto.decrypt(r.cardNoEnc, this.purpose('card', companyId)),
    }));
  }
}
