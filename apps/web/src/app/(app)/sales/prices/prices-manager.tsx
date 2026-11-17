'use client';

import { formatWon } from '@wellbuddy/accounting-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WonInput } from '@/components/won-input';
import { ApiError, apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';
import type { Item } from '../items/items-manager';

interface Partner {
  id: string;
  code: string;
  name: string;
}

interface PartnerPrice {
  id: string;
  partnerId: string;
  itemId: string;
  salesPrice: number | null;
  purchasePrice: number | null;
}

const KEY = ['partner-prices'];

/** 거래처를 고르면 품목마다 그 거래처에만 쓰는 판매·구매 단가를 정한다. */
export function PricesManager() {
  const { data: session } = useSession();
  const writable = can(session, 'sales', 'write');
  const [partnerId, setPartnerId] = useState<string | null>(null);

  const partners = useQuery({
    queryKey: ['partners', 'active'],
    queryFn: () => apiFetch<Partner[]>('/partners'),
  });
  const items = useQuery({
    queryKey: ['items', 'active'],
    queryFn: () => apiFetch<Item[]>('/items'),
  });
  const prices = useQuery({
    queryKey: [...KEY, partnerId],
    queryFn: () => apiFetch<PartnerPrice[]>(`/partner-prices?partnerId=${partnerId}`),
    enabled: !!partnerId,
  });
  const byItem = new Map(prices.data?.map((p) => [p.itemId, p]));

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <Combobox
          aria-label="거래처"
          className="w-72"
          placeholder="거래처를 고르세요"
          items={partners.data ?? []}
          value={partnerId}
          onChange={(id) => setPartnerId(id)}
        />
        <p className="text-sm text-muted-foreground">
          거래처별 단가가 있으면 견적·주문·판매·구매 입력 때 품목 기본 단가 대신 씁니다. 비워 두면
          기본 단가를 씁니다.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-2">
        {partnerId ? (
          <Table aria-label="거래처별 단가">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 pl-5">코드</TableHead>
                <TableHead className="min-w-40">품목명</TableHead>
                <TableHead className="w-16">단위</TableHead>
                <TableHead className="w-28 text-right">기본 판매단가</TableHead>
                <TableHead className="w-36">거래처 판매단가</TableHead>
                <TableHead className="w-28 text-right">기본 구매단가</TableHead>
                <TableHead className="w-36">거래처 구매단가</TableHead>
                <TableHead className="w-28 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.data?.map((item) => (
                <PriceRow
                  key={`${item.id}:${byItem.get(item.id)?.salesPrice}:${byItem.get(item.id)?.purchasePrice}`}
                  item={item}
                  partnerId={partnerId}
                  price={byItem.get(item.id)}
                  writable={writable}
                />
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 pb-4 text-sm text-muted-foreground">거래처를 먼저 골라 주세요.</p>
        )}
        {partnerId && items.data?.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            품목이 없습니다. 품목 탭에서 먼저 등록해 주세요.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PriceRow({
  item,
  partnerId,
  price,
  writable,
}: {
  item: Item;
  partnerId: string;
  price: PartnerPrice | undefined;
  writable: boolean;
}) {
  const queryClient = useQueryClient();
  const [sales, setSales] = useState(price?.salesPrice ?? 0);
  const [purchase, setPurchase] = useState(price?.purchasePrice ?? 0);
  const changed = sales !== (price?.salesPrice ?? 0) || purchase !== (price?.purchasePrice ?? 0);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/partner-prices', {
        method: 'PUT',
        json: {
          partnerId,
          itemId: item.id,
          salesPrice: sales || null,
          purchasePrice: purchase || null,
        },
      }),
    onSuccess: () => {
      refresh();
      toast.success(`${item.name} 단가를 저장했습니다.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/partner-prices/${price!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success(`${item.name} 거래처 단가를 지웠습니다.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '지우지 못했습니다.'),
  });

  const base = (v: number | null) => (v == null ? '—' : formatWon(v));
  return (
    <TableRow>
      <TableCell className="pl-5 tabular-nums">{item.code}</TableCell>
      <TableCell className="font-medium">
        {item.name}
        {price ? <Badge className="ml-2">거래처 단가</Badge> : null}
      </TableCell>
      <TableCell>{item.unit}</TableCell>
      <TableCell className="text-right tabular-nums">{base(item.salesPrice)}</TableCell>
      <TableCell>
        <WonInput
          aria-label={`${item.name} 거래처 판매단가`}
          value={sales}
          onValueChange={setSales}
          disabled={!writable}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">{base(item.purchasePrice)}</TableCell>
      <TableCell>
        <WonInput
          aria-label={`${item.name} 거래처 구매단가`}
          value={purchase}
          onValueChange={setPurchase}
          disabled={!writable}
        />
      </TableCell>
      <TableCell className="pr-5">
        {writable ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              aria-label={`${item.name} 단가 저장`}
              disabled={!changed || (!sales && !purchase) || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save />
            </Button>
            {price ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${item.name} 거래처 단가 지우기`}
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
