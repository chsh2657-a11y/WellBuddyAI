import { type NormalBalance, STATEMENT_GROUPS, type StatementGroup } from './chart-of-accounts.js';

/** 계정별 차변·대변 합계(전기된 분개를 계정별로 모은 값) */
export interface AccountTotals {
  accountId: string;
  code: string;
  name: string;
  group: StatementGroup;
  normalBalance: NormalBalance;
  debit: number;
  credit: number;
}

/** 정상 잔액 방향 기준 잔액(자산·비용은 차변-대변, 부채·자본·수익은 대변-차변) */
export function normalAmount(a: Pick<AccountTotals, 'debit' | 'credit' | 'normalBalance'>): number {
  return a.normalBalance === 'debit' ? a.debit - a.credit : a.credit - a.debit;
}

// ── 합계잔액시산표 ──────────────────────────────────────

export interface TrialBalanceRow extends AccountTotals {
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { debitBalance: number; debit: number; credit: number; creditBalance: number };
  balanced: boolean;
}

export function trialBalance(accounts: readonly AccountTotals[]): TrialBalance {
  const rows = accounts
    .filter((a) => a.debit !== 0 || a.credit !== 0)
    .map((a) => {
      const net = a.debit - a.credit;
      return { ...a, debitBalance: Math.max(net, 0), creditBalance: Math.max(-net, 0) };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
  const totals = rows.reduce(
    (t, r) => ({
      debitBalance: t.debitBalance + r.debitBalance,
      debit: t.debit + r.debit,
      credit: t.credit + r.credit,
      creditBalance: t.creditBalance + r.creditBalance,
    }),
    { debitBalance: 0, debit: 0, credit: 0, creditBalance: 0 },
  );
  return {
    rows,
    totals,
    balanced: totals.debit === totals.credit && totals.debitBalance === totals.creditBalance,
  };
}

// ── 손익계산서 ───────────────────────────────────────────

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface StatementSection {
  group: StatementGroup;
  label: string;
  lines: StatementLine[];
  total: number;
}

export interface IncomeStatement {
  sections: StatementSection[];
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  sga: number;
  operatingIncome: number;
  nonOperatingIncome: number;
  nonOperatingExpense: number;
  incomeBeforeTax: number;
  incomeTax: number;
  netIncome: number;
}

function sections(accounts: readonly AccountTotals[], statement: 'BS' | 'IS'): StatementSection[] {
  const byGroup = new Map<StatementGroup, StatementLine[]>();
  for (const a of accounts) {
    const def = STATEMENT_GROUPS[a.group];
    if (def.statement !== statement) continue;
    const amount = normalAmount(a);
    if (amount === 0 && a.debit === 0 && a.credit === 0) continue;
    const list = byGroup.get(a.group) ?? [];
    // 차감 계정(대손충당금 등)은 같은 구분 안에서 빼는 금액으로 표시한다
    const sign = def.category === 'asset' || def.category === 'expense' ? 1 : -1;
    const signed = (a.normalBalance === 'debit' ? 1 : -1) * sign * amount;
    list.push({ accountId: a.accountId, code: a.code, name: a.name, amount: signed });
    byGroup.set(a.group, list);
  }
  return [...byGroup.entries()]
    .sort(([x], [y]) => STATEMENT_GROUPS[x].order - STATEMENT_GROUPS[y].order)
    .map(([group, lines]) => ({
      group,
      label: STATEMENT_GROUPS[group].label,
      lines: lines.sort((x, y) => x.code.localeCompare(y.code)),
      total: lines.reduce((s, l) => s + l.amount, 0),
    }));
}

function totalOf(list: StatementSection[], ...groups: StatementGroup[]) {
  return list.filter((s) => groups.includes(s.group)).reduce((sum, s) => sum + s.total, 0);
}

/** 기간 손익(수익·비용 계정의 기간 합계)으로 손익계산서를 만든다. */
export function incomeStatement(accounts: readonly AccountTotals[]): IncomeStatement {
  const list = sections(accounts, 'IS');
  const revenue = totalOf(list, 'revenue');
  const costOfSales = totalOf(list, 'cost_of_sales', 'manufacturing_cost');
  const sga = totalOf(list, 'sga');
  const nonOperatingIncome = totalOf(list, 'non_operating_income');
  const nonOperatingExpense = totalOf(list, 'non_operating_expense');
  const incomeTax = totalOf(list, 'income_tax');
  const grossProfit = revenue - costOfSales;
  const operatingIncome = grossProfit - sga;
  const incomeBeforeTax = operatingIncome + nonOperatingIncome - nonOperatingExpense;
  return {
    sections: list,
    revenue,
    costOfSales,
    grossProfit,
    sga,
    operatingIncome,
    nonOperatingIncome,
    nonOperatingExpense,
    incomeBeforeTax,
    incomeTax,
    netIncome: incomeBeforeTax - incomeTax,
  };
}

// ── 재무상태표 ───────────────────────────────────────────

export interface BalanceSheet {
  assets: StatementSection[];
  liabilities: StatementSection[];
  equity: StatementSection[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** 아직 이익잉여금으로 옮기지 않은 손익(전기 미마감분 + 당기순이익) */
  undistributedIncome: { priorPeriods: number; currentPeriod: number };
  balanced: boolean;
}

/**
 * 재무상태표.
 * @param cumulative 기준일까지 누적된 모든 계정의 합계
 * @param currentPeriodIncome 당기(회계연도 시작~기준일) 순이익
 *
 * 마감(손익 대체)하지 않은 수익·비용 잔액은 이익잉여금에 포함해 자산 = 부채 + 자본이 성립하게 한다.
 */
export function balanceSheet(
  cumulative: readonly AccountTotals[],
  currentPeriodIncome: number,
): BalanceSheet {
  const list = sections(cumulative, 'BS');
  const assets = list.filter((s) => STATEMENT_GROUPS[s.group].category === 'asset');
  const liabilities = list.filter((s) => STATEMENT_GROUPS[s.group].category === 'liability');
  const equity = list.filter((s) => STATEMENT_GROUPS[s.group].category === 'equity');

  const allUnclosedIncome = incomeStatement(cumulative).netIncome;
  const priorPeriods = allUnclosedIncome - currentPeriodIncome;

  const retained = equity.find((s) => s.group === 'retained_earnings');
  const extra: StatementLine[] = [];
  if (priorPeriods !== 0) {
    extra.push({
      accountId: 'unclosed-prior',
      code: '',
      name: '전기이월 미처분이익',
      amount: priorPeriods,
    });
  }
  if (currentPeriodIncome !== 0) {
    extra.push({
      accountId: 'current-income',
      code: '',
      name: '당기순이익',
      amount: currentPeriodIncome,
    });
  }
  if (extra.length > 0) {
    if (retained) {
      retained.lines.push(...extra);
      retained.total += priorPeriods + currentPeriodIncome;
    } else {
      equity.push({
        group: 'retained_earnings',
        label: STATEMENT_GROUPS.retained_earnings.label,
        lines: extra,
        total: priorPeriods + currentPeriodIncome,
      });
    }
  }

  const sum = (s: StatementSection[]) => s.reduce((t, x) => t + x.total, 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity);
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    undistributedIncome: { priorPeriods, currentPeriod: currentPeriodIncome },
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}
