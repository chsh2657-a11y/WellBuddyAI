import { describe, expect, it } from 'vitest';
import {
  buildWorkbook,
  decodeText,
  mapRows,
  missingHeaders,
  parseCsv,
  parseTabular,
} from './tabular.js';

describe('CSV·엑셀 읽기', () => {
  it('따옴표 안의 쉼표·줄바꿈·이스케이프를 처리한다', () => {
    expect(parseCsv('a,b,c\n"1,000","줄\n바꿈","say ""hi"""\r\n\n')).toEqual([
      ['a', 'b', 'c'],
      ['1,000', '줄\n바꿈', 'say "hi"'],
    ]);
  });

  it('EUC-KR 로 저장된 CSV 를 한글로 읽는다', () => {
    const eucKr = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x41]); // "한글,A"
    expect(decodeText(eucKr)).toBe('한글,A');
    expect(decodeText(Buffer.from('﻿한글', 'utf8'))).toBe('한글');
  });

  it('헤더 이름으로 열을 찾아 행을 객체로 바꾼다(열 순서·공백·* 무관)', () => {
    const rows = mapRows(
      [
        ['주소', '사업장명 *', '사업자 등록번호'],
        ['서울', '본점', '124-81-00998'],
      ],
      [
        { key: 'name', header: '사업장명' },
        { key: 'bizRegNo', header: '사업자등록번호' },
        { key: 'phone', header: '전화' },
      ],
    );
    expect(rows).toEqual([
      { rowNumber: 2, values: { name: '본점', bizRegNo: '124-81-00998', phone: '' } },
    ]);
    expect(
      missingHeaders(
        [['주소']],
        [
          { header: '사업장명', required: true },
          { header: '주소', required: false },
        ],
      ),
    ).toEqual(['사업장명']);
  });

  it('만든 엑셀 파일을 다시 읽을 수 있다', async () => {
    const buffer = await buildWorkbook([
      { name: '목록', columns: [{ header: '이름' }, { header: '금액' }], rows: [['홍길동', 1000]] },
    ]);
    expect(await parseTabular(buffer, 'test.xlsx')).toEqual([
      ['이름', '금액'],
      ['홍길동', '1000'],
    ]);
  });

  it('지원하지 않는 형식은 안내 메시지로 거부한다', async () => {
    await expect(parseTabular(Buffer.from(''), 'a.xls')).rejects.toThrow(/xlsx/);
    await expect(parseTabular(Buffer.from(''), 'a.pdf')).rejects.toThrow(/CSV/);
    await expect(parseTabular(Buffer.from('not zip'), 'a.xlsx')).rejects.toThrow(
      /읽을 수 없습니다/,
    );
  });
});
