'use client';

import {
  EVIDENCE_TYPE_LABELS,
  EVIDENCE_TYPES,
  type EvidenceType,
  VAT_TYPE_LABELS,
  VAT_TYPES,
  type VatType,
} from '@wellbuddy/accounting-core';
import { Combobox } from '@/components/combobox';
import { WonInput } from '@/components/won-input';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { formatWon } from '@/lib/format';
import type { MasterData } from './use-master-data';
import {
  DEFAULT_EVIDENCE,
  initialVatState,
  SETTLEMENTS,
  type VatKind,
  vatAmounts,
  type VatState,
} from './vat-calc';

/** 매입매출전표의 부가세 입력부. 값을 바꾸면 분개를 다시 만든다. */
export function VatPanel({
  state,
  onChange,
  data,
  disabled,
}: {
  state: VatState;
  onChange: (next: VatState) => void;
  data: MasterData;
  disabled?: boolean;
}) {
  const set = (patch: Partial<VatState>) => onChange({ ...state, ...patch });
  const { supply, vat } = vatAmounts(state);
  const partnerRequired = state.evidenceType === 'tax_invoice' || state.evidenceType === 'invoice';

  return (
    <div className="grid gap-4 rounded-md border bg-surface-muted/40 p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="vat-kind" label="구분">
          <Select
            id="vat-kind"
            value={state.kind}
            disabled={disabled}
            onChange={(e) => {
              const kind = e.target.value as VatKind;
              const fresh = initialVatState(kind, data);
              set({
                kind,
                mainAccountId: fresh.mainAccountId,
                settlementCode: fresh.settlementCode,
                deductible: true,
              });
            }}
          >
            <option value="sales">매출</option>
            <option value="purchase">매입</option>
          </Select>
        </FormField>
        <FormField id="vat-type" label="과세유형">
          <Select
            id="vat-type"
            value={state.vatType}
            disabled={disabled}
            onChange={(e) => {
              const vatType = e.target.value as VatType;
              set({ vatType, evidenceType: DEFAULT_EVIDENCE[vatType], vatEdited: false });
            }}
          >
            {VAT_TYPES.map((t) => (
              <option key={t} value={t}>
                {VAT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="vat-evidence" label="증빙">
          <Select
            id="vat-evidence"
            value={state.evidenceType}
            disabled={disabled}
            onChange={(e) => set({ evidenceType: e.target.value as EvidenceType })}
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVIDENCE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="vat-partner" label={partnerRequired ? '거래처 (필수)' : '거래처'}>
          <Combobox
            aria-label="거래처"
            items={data.partnerItems}
            value={state.partnerId}
            disabled={disabled}
            invalid={partnerRequired && !state.partnerId && state.amount > 0}
            onChange={(id) => set({ partnerId: id })}
          />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="vat-amount" label="금액">
          <div className="flex gap-2">
            <Select
              aria-label="금액 기준"
              className="w-28 shrink-0"
              value={state.inputMode}
              disabled={disabled}
              onChange={(e) =>
                set({ inputMode: e.target.value as VatState['inputMode'], vatEdited: false })
              }
            >
              <option value="supply">공급가액</option>
              <option value="total">합계금액</option>
            </Select>
            <WonInput
              id="vat-amount"
              aria-label={state.inputMode === 'supply' ? '공급가액' : '합계금액'}
              value={state.amount}
              disabled={disabled}
              onValueChange={(amount) => set({ amount, vatEdited: false })}
            />
          </div>
        </FormField>
        <FormField
          id="vat-vat"
          label="부가세"
          hint={
            state.amount > 0
              ? `공급가액 ${formatWon(supply)} · 합계 ${formatWon(supply + vat)}`
              : '과세는 공급가액의 10%(원 미만 절사)'
          }
        >
          <WonInput
            id="vat-vat"
            aria-label="부가세"
            value={vat}
            disabled={disabled || state.vatType !== 'taxable'}
            onValueChange={(v) => set({ vat: v, vatEdited: true })}
          />
        </FormField>
        <FormField
          id="vat-main"
          label={state.kind === 'sales' ? '매출 계정' : '매입 계정(비용·자산)'}
        >
          <Combobox
            aria-label={state.kind === 'sales' ? '매출 계정' : '매입 계정'}
            items={data.accountItems}
            value={state.mainAccountId}
            disabled={disabled}
            onChange={(id) => set({ mainAccountId: id })}
          />
        </FormField>
        <FormField id="vat-settlement" label="결제">
          <Select
            id="vat-settlement"
            value={state.settlementCode}
            disabled={disabled}
            onChange={(e) => set({ settlementCode: e.target.value })}
          >
            {SETTLEMENTS[state.kind].map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <FormField id="vat-memo" label="적요" className="min-w-64 flex-1">
          <input
            id="vat-memo"
            className="flex h-10 w-full rounded-md border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={200}
            value={state.memo}
            disabled={disabled}
            onChange={(e) => set({ memo: e.target.value })}
          />
        </FormField>
        {state.kind === 'purchase' && state.vatType === 'taxable' ? (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={!state.deductible}
              disabled={disabled}
              onChange={(e) => set({ deductible: !e.target.checked })}
            />
            매입세액 불공제
            <span className="text-xs text-muted-foreground">
              (기업업무추진비·비영업용 승용차 등, 부가세를 비용에 포함)
            </span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
