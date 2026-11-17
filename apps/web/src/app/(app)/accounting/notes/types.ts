import type { NoteKind, NoteStatus } from '@wellbuddy/accounting-core';

export interface Note {
  id: string;
  kind: NoteKind;
  noteNo: string;
  partnerId: string;
  partnerName: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  bank: string | null;
  status: NoteStatus;
  statusDate: string | null;
  endorsedToPartnerId: string | null;
  endorsedToName: string | null;
  memo: string | null;
}

export type NoteAction = 'register' | 'settle' | 'discount' | 'endorse' | 'dishonor';

export interface NoteDetail extends Note {
  events: {
    id: string;
    action: NoteAction;
    eventDate: string;
    entryId: string | null;
    entryNumber: string | null;
    detail: Record<string, unknown>;
  }[];
}

export const NOTES_KEY = ['notes'];

export const ACTION_LABELS: Record<NoteAction, string> = {
  register: '등록',
  settle: '만기 결제',
  discount: '할인',
  endorse: '배서양도',
  dishonor: '부도',
};

export const KIND_TEXT = {
  receivable: { label: '받을어음', register: '수취', partner: '받은 곳', counter: '외상매출금' },
  payable: { label: '지급어음', register: '발행', partner: '준 곳', counter: '외상매입금' },
} as const;
