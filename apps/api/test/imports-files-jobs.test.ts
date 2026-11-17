import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentContext, runWithContext } from '../src/common/request-context.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { MailService } from '../src/mail/mail.service.js';
import { RedisService } from '../src/redis/redis.module.js';
import {
  type Agent,
  createTestApp,
  inviteAndJoin,
  ownerWithCompany,
  testConfig,
} from './helpers.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('엑셀 일괄 등록·파일·작업 큐', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@import.local', '가져오기상사'));
    employee = await inviteAndJoin(app, owner, 'emp@import.local', 'employee');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('엑셀 일괄 등록 (사업장)', () => {
    it('양식을 xlsx 로 내려받는다(필수 항목 * 표시, 작성 안내 시트)', async () => {
      const res = await owner
        .get('/api/imports/business-places/template')
        .responseType('blob')
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain(
        encodeURIComponent('사업장_일괄등록_양식.xlsx'),
      );
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['사업장', '작성 안내']);
      expect(wb.worksheets[0]!.getRow(1).values).toContain('사업장명 *');
    });

    const csv = [
      '사업장명,사업자등록번호,주소',
      '부산지점,220-81-12341,부산',
      '잘못된번호,123-45-67890,서울',
      '중복지점,2208112341,대구',
      ',124-81-00998,광주',
    ].join('\n');

    it('미리보기는 행별 오류(형식·중복·필수)를 알려주고 등록하지 않는다', async () => {
      const res = await owner
        .post('/api/imports/business-places/preview')
        .attach('file', Buffer.from(csv), '사업장.csv')
        .expect(200);
      expect(res.body).toMatchObject({ total: 4, valid: 1, invalid: 3, missingHeaders: [] });
      const errors = Object.fromEntries(
        res.body.rows.map((r: { rowNumber: number; errors: { message: string }[] }) => [
          r.rowNumber,
          r.errors.map((e) => e.message).join(','),
        ]),
      );
      expect(errors[2]).toBe('');
      expect(errors[3]).toContain('올바른 사업자등록번호가 아닙니다.');
      expect(errors[4]).toContain('2행과 중복됩니다.');
      expect(errors[5]).toBeTruthy();

      const places = await owner.get('/api/business-places').expect(200);
      expect(places.body).toHaveLength(1);
    });

    it('오류가 있으면 등록을 거부하고, 오류 행 건너뛰기를 선택하면 유효한 행만 등록한다', async () => {
      const rejected = await owner
        .post('/api/imports/business-places/commit')
        .attach('file', Buffer.from(csv), '사업장.csv')
        .expect(400);
      expect(rejected.body.code).toBe('IMPORT_INVALID');

      const res = await owner
        .post('/api/imports/business-places/commit?skipInvalid=true')
        .attach('file', Buffer.from(csv), '사업장.csv')
        .expect(200);
      expect(res.body).toEqual({ created: 1, updated: 0, skipped: 3 });
    });

    it('같은 사업자등록번호는 수정으로 처리하고, EUC-KR CSV 도 읽는다', async () => {
      const text = '사업자등록번호,사업장명,주소\n220-81-12341,부산지점,부산 해운대구\n';
      const utf8 = Buffer.from(text, 'utf8');
      const res = await owner
        .post('/api/imports/business-places/commit')
        .attach('file', utf8, 'update.csv')
        .expect(200);
      expect(res.body).toEqual({ created: 0, updated: 1, skipped: 0 });

      const iconvLike = Buffer.from(
        // "사업장명,사업자등록번호\n광주지점,110-81-23459" 를 EUC-KR 로 인코딩한 바이트
        'bbe7bef7c0e5b8ed2cbbe7bef7c0dab5eeb7cfb9f8c8a30ab1a4c1d6c1f6c1a12c3131302d38312d3233343539',
        'hex',
      );
      const euc = await owner
        .post('/api/imports/business-places/commit')
        .attach('file', iconvLike, 'euckr.csv')
        .expect(200);
      expect(euc.body).toEqual({ created: 1, updated: 0, skipped: 0 });

      const places = await owner.get('/api/business-places').expect(200);
      expect(places.body.map((p: { name: string }) => p.name).sort()).toEqual([
        '광주지점',
        '본점',
        '부산지점',
      ]);
    });

    it('현재 사업장 목록을 엑셀로 내보낸다', async () => {
      const res = await owner.get('/api/exports/business-places').responseType('blob').expect(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      const names: string[] = [];
      wb.worksheets[0]!.eachRow((row, i) => {
        if (i > 1) names.push(String(row.getCell(1).value));
      });
      expect(names).toContain('부산지점');
    });

    it('권한이 없거나 없는 대상이면 거부한다', async () => {
      await employee.get('/api/imports/business-places/template').expect(403);
      await owner.get('/api/imports/nope/template').expect(404);
      const noFile = await owner.post('/api/imports/business-places/preview').expect(400);
      expect(noFile.body.code).toBe('FILE_REQUIRED');
    });
  });

  describe('파일 저장', () => {
    let fileId: string;

    it('이미지를 올리고 같은 내용을 내려받는다(한글 파일명 유지)', async () => {
      const res = await employee
        .post('/api/files')
        .attach('file', PNG_1x1, '영수증.png')
        .expect(201);
      expect(res.body).toMatchObject({
        filename: '영수증.png',
        mimeType: 'image/png',
        sizeBytes: PNG_1x1.length,
      });
      fileId = res.body.id;

      const download = await employee
        .get(`/api/files/${fileId}/download`)
        .responseType('blob')
        .expect(200);
      expect(Buffer.compare(download.body, PNG_1x1)).toBe(0);
      expect(download.headers['content-disposition']).toContain(encodeURIComponent('영수증.png'));
      expect(download.headers['x-content-type-options']).toBe('nosniff');
    });

    it('확장자만 바꾼 실행 파일 등 허용하지 않는 형식은 거부한다', async () => {
      const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
      const res = await owner.post('/api/files').attach('file', exe, 'photo.png').expect(415);
      expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
      const csvFile = await owner
        .post('/api/files')
        .attach('file', Buffer.from('a,b\n1,2\n'), 'data.csv')
        .expect(201);
      expect(csvFile.body.mimeType).toBe('text/csv');
    });

    it('다른 회사는 파일을 볼 수 없고, 올린 사람·관리자만 삭제할 수 있다', async () => {
      const { agent: other } = await ownerWithCompany(app, 'other@import.local', '다른상사');
      await other.get(`/api/files/${fileId}`).expect(404);
      await other.get(`/api/files/${fileId}/download`).expect(404);

      const ownerFile = await owner.post('/api/files').attach('file', PNG_1x1, 'a.png').expect(201);
      const forbidden = await employee.delete(`/api/files/${ownerFile.body.id}`).expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN');
      await employee.delete(`/api/files/${fileId}`).expect(204);
      await owner.delete(`/api/files/${ownerFile.body.id}`).expect(204);
      await owner.get(`/api/files/${fileId}`).expect(404);
    });
  });

  describe('작업 큐 (BullMQ + Redis)', () => {
    it('워커가 작업을 처리하고, 작업을 넣은 요청의 회사 컨텍스트로 실행된다', async () => {
      const queueApp = await createTestApp(testConfig({ QUEUE_INLINE: 'false' }));
      try {
        await queueApp.get(RedisService).client.flushdb();
        const jobs = queueApp.get(JobsService);
        const received = new Promise<{ data: unknown; companyId: string | null | undefined }>(
          (resolve) => {
            jobs.register('system', 'echo', async (data) => {
              resolve({ data, companyId: currentContext()?.companyId });
              return data;
            });
          },
        );
        jobs.startWorkers(['system']);

        await runWithContext({ userId: null, companyId: 'company-123' }, () =>
          jobs.enqueue('system', 'echo', { hello: '큐' }),
        );
        await expect(received).resolves.toEqual({
          data: { hello: '큐' },
          companyId: 'company-123',
        });

        const counts = await jobs.queue('system').getJobCounts('completed', 'waiting');
        expect(counts.waiting).toBe(0);
      } finally {
        await queueApp.close();
      }
    });

    it('초대 메일은 메일 큐 작업으로 발송되고 HTML 본문을 가진다', async () => {
      await owner
        .post('/api/invitations')
        .send({ email: 'new@import.local', role: 'approver' })
        .expect(201);
      const sent = app.get(MailService).outbox.at(-1)!;
      expect(sent).toMatchObject({
        to: 'new@import.local',
        subject: expect.stringContaining('가져오기상사'),
      });
      expect(sent.html).toContain('초대 수락하기');
      expect(sent.html).not.toContain('<script');
      expect(sent.text).toMatch(/\/invite\/[\w-]+/);
    });
  });
});
