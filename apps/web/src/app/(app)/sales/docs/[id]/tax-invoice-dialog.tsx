'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { formatWon } from '@wellbuddy/accounting-core';
import { type TradeTaxInvoiceIssueInput, TradeTaxInvoiceIssueSchema } from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';
import { TRADE_DOCS_KEY, type TradeDoc } from '../../_lib/trade';

interface PartnerContact {
  representative: string | null;
  email: string | null;
}

interface IssuedInvoice {
  approvalNo: string | null;
  mgtKey: string;
}

type FormValues = z.input<typeof TradeTaxInvoiceIssueSchema>;

/** 판매 → 전자세금계산서 발행(P3-08). 공급받는자 대표자·이메일은 거래처 정보로 미리 채운다 */
export function TaxInvoiceDialog({ doc, onClose }: { doc: TradeDoc; onClose: () => void }) {
  const partner = useQuery({
    queryKey: ['partners', doc.partnerId],
    queryFn: () => apiFetch<PartnerContact>(`/partners/${doc.partnerId}`),
    enabled: !!doc.partnerId,
    retry: false,
  });
  if (doc.partnerId && partner.isPending) return null;
  return <IssueForm doc={doc} contact={partner.data ?? null} onClose={onClose} />;
}

function IssueForm({
  doc,
  contact,
  onClose,
}: {
  doc: TradeDoc;
  contact: PartnerContact | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues, unknown, TradeTaxInvoiceIssueInput>({
    resolver: zodResolver(TradeTaxInvoiceIssueSchema),
    defaultValues: {
      issueDate: doc.docDate,
      buyerCeoName: contact?.representative ?? '',
      buyerEmail: contact?.email ?? '',
    },
  });
  const { errors } = form.formState;
  const issue = useMutation({
    mutationFn: (values: TradeTaxInvoiceIssueInput) =>
      apiFetch<IssuedInvoice>(`/trade-docs/${doc.id}/tax-invoice`, {
        method: 'POST',
        json: values,
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: TRADE_DOCS_KEY });
      toast.success(
        r.approvalNo
          ? `전자세금계산서를 발행했습니다(승인번호 ${r.approvalNo}).`
          : `전자세금계산서를 발행했습니다(관리번호 ${r.mgtKey}). 승인번호는 국세청 전송 뒤 받습니다.`,
      );
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '발행하지 못했습니다.'),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>전자세금계산서 발행</DialogTitle>
          <DialogDescription>
            {doc.partnerName} · 공급가액 {formatWon(doc.supplyTotal)} · 세액 {formatWon(doc.vatTotal)}{' '}
            · 품목 {doc.lines.length}줄. 외상 판매이므로 청구로 발행하고, 발행되면 매출 세금계산서를
            이 판매 전표에 이어 다시 분개하지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => issue.mutate(v))} noValidate>
          <FormField id="tax-issue-date" label="작성일자" error={errors.issueDate?.message}>
            <Input id="tax-issue-date" type="date" {...form.register('issueDate')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="tax-ceo" label="공급받는자 대표자" error={errors.buyerCeoName?.message}>
              <Input id="tax-ceo" {...form.register('buyerCeoName')} />
            </FormField>
            <FormField
              id="tax-email"
              label="공급받는자 이메일"
              error={errors.buyerEmail?.message}
              hint="계산서를 이 주소로 보냅니다."
            >
              <Input id="tax-email" type="email" {...form.register('buyerEmail')} />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button type="submit" disabled={issue.isPending}>
              {issue.isPending ? '발행 중…' : '발행'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
