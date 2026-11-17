'use client';

import { formatWon } from '@wellbuddy/accounting-core';
import { formatBizRegNo, PURCHASE_DOC_KINDS, type TradeDocKind } from '@wellbuddy/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { wonInWords } from '@/lib/korean-number';
import { formatQty, TRADE_DOCS_KEY, type TradeDoc } from '../../../_lib/trade';

interface Company {
  name: string;
  bizRegNo: string;
  representative: string | null;
  businessType: string | null;
  businessItem: string | null;
  address: string | null;
  phone: string | null;
}

interface PartnerInfo {
  name: string;
  bizRegNo: string | null;
  representative: string | null;
  businessType: string | null;
  businessItem: string | null;
  address: string | null;
  phone: string | null;
}

/** 인쇄할 때의 서식 이름 */
const TITLES: Partial<Record<TradeDocKind, string>> = {
  quote: '견 적 서',
  sales_order: '주 문 서',
  shipment: '거 래 명 세 서',
  sale: '거 래 명 세 서',
  sales_return: '반 품 명 세 서',
  purchase_order: '발 주 서',
  receipt: '입 고 명 세 서',
  purchase: '매 입 명 세 서',
  purchase_return: '반 품 명 세 서',
};

/** 거래 문서 인쇄(견적서·주문서·거래명세서·발주서). 화면 메뉴는 인쇄되지 않는다. */
export function DocPrint({ id }: { id: string }) {
  const doc = useQuery({
    queryKey: [...TRADE_DOCS_KEY, 'detail', id],
    queryFn: () => apiFetch<TradeDoc>(`/trade-docs/${id}`),
  });
  const company = useQuery({
    queryKey: ['company', 'current'],
    queryFn: () => apiFetch<Company>('/companies/current'),
    retry: false,
  });
  const partner = useQuery({
    queryKey: ['partners', doc.data?.partnerId],
    queryFn: () => apiFetch<PartnerInfo>(`/partners/${doc.data!.partnerId}`),
    enabled: !!doc.data?.partnerId,
    retry: false,
  });

  const d = doc.data;
  if (!d) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  // 발주·입고·구매는 거래처가 공급자, 판매 쪽은 우리 회사가 공급자
  const purchaseSide = (PURCHASE_DOC_KINDS as readonly string[]).includes(d.kind);
  const us: PartnerInfo | undefined = company.data;
  const them: PartnerInfo = partner.data ?? {
    name: d.partnerName ?? '',
    bizRegNo: d.partnerBizRegNo,
    representative: null,
    businessType: null,
    businessItem: null,
    address: null,
    phone: null,
  };
  const supplier = purchaseSide ? them : us;
  const buyer = purchaseSide ? us : them;
  const title = TITLES[d.kind] ?? d.kindLabel;

  return (
    <div className="grid gap-4">
      <div className="flex gap-2 print:hidden">
        <Button asChild variant="outline" size="sm">
          <Link href={`/sales/docs/${d.id}`}>
            <ArrowLeft />
            문서로
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer />
          인쇄
        </Button>
      </div>

      <article
        aria-label={title.replaceAll(' ', '')}
        className="mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] text-black shadow-sm print:max-w-none print:p-0 print:shadow-none"
      >
        <h1 className="mb-1 text-center text-2xl font-bold tracking-widest">{title}</h1>
        <p className="mb-4 text-center text-xs">
          {d.docNo} · {d.docDate}
          {d.dueDate ? ` · ${d.kind === 'quote' ? '유효기한' : '납기'} ${d.dueDate}` : ''}
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <PartyBox label="공급자" party={supplier} />
          <PartyBox label="공급받는자" party={buyer} />
        </div>

        <p className="mb-2 border-y border-black py-2 text-base font-semibold">
          합계금액 {wonInWords(d.total)} (₩{formatWon(d.total)})
          <span className="ml-2 text-xs font-normal">부가세 포함</span>
        </p>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-y border-black">
              <th className="w-8 py-1">No</th>
              <th className="py-1 text-left">품목</th>
              <th className="py-1 text-left">규격</th>
              <th className="py-1 text-right">수량</th>
              <th className="py-1">단위</th>
              <th className="py-1 text-right">단가</th>
              <th className="py-1 text-right">공급가액</th>
              <th className="py-1 text-right">세액</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-300">
                <td className="py-1 text-center">{l.lineNo}</td>
                <td className="py-1">{l.itemName}</td>
                <td className="py-1">{l.spec ?? ''}</td>
                <td className="py-1 text-right tabular-nums">{formatQty(l.qty)}</td>
                <td className="py-1 text-center">{l.unit}</td>
                <td className="py-1 text-right tabular-nums">{formatWon(l.unitPrice)}</td>
                <td className="py-1 text-right tabular-nums">{formatWon(l.supply)}</td>
                <td className="py-1 text-right tabular-nums">{formatWon(l.vat)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-y border-black font-semibold">
              <td colSpan={6} className="py-1 text-right">
                합계
              </td>
              <td className="py-1 text-right tabular-nums">{formatWon(d.supplyTotal)}</td>
              <td className="py-1 text-right tabular-nums">{formatWon(d.vatTotal)}</td>
            </tr>
          </tfoot>
        </table>

        {d.memo ? <p className="mt-3 text-xs">비고: {d.memo}</p> : null}
        {d.kind === 'shipment' || d.kind === 'sale' ? (
          <p className="mt-8 text-right">인수자 ______________________ (인)</p>
        ) : null}
      </article>
    </div>
  );
}

function PartyBox({ label, party }: { label: string; party: PartnerInfo | undefined }) {
  return (
    <table className="w-full border-collapse border border-black text-[12px]">
      <tbody>
        <tr>
          <th rowSpan={5} className="w-6 border border-black px-1 [writing-mode:vertical-rl]">
            {label}
          </th>
          <th className="w-20 border border-black px-1 text-left font-normal">등록번호</th>
          <td className="border border-black px-1 font-semibold">
            {party?.bizRegNo ? formatBizRegNo(party.bizRegNo) : ''}
          </td>
        </tr>
        <tr>
          <th className="border border-black px-1 text-left font-normal">상호</th>
          <td className="border border-black px-1">
            {party?.name ?? ''}
            {party?.representative ? ` (대표 ${party.representative})` : ''}
          </td>
        </tr>
        <tr>
          <th className="border border-black px-1 text-left font-normal">주소</th>
          <td className="border border-black px-1">{party?.address ?? ''}</td>
        </tr>
        <tr>
          <th className="border border-black px-1 text-left font-normal">업태·종목</th>
          <td className="border border-black px-1">
            {[party?.businessType, party?.businessItem].filter(Boolean).join(' · ')}
          </td>
        </tr>
        <tr>
          <th className="border border-black px-1 text-left font-normal">전화</th>
          <td className="border border-black px-1">{party?.phone ?? ''}</td>
        </tr>
      </tbody>
    </table>
  );
}

