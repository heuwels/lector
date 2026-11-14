import { describe, test, expect } from 'bun:test';
import AdmZip from 'adm-zip';
import { parseEpub } from './epub-parser';

describe('parseEpub DoS guards', () => {
  test('rejects an archive with too many entries (zip-bomb guard)', () => {
    const zip = new AdmZip();
    for (let i = 0; i < 5001; i++) zip.addFile(`f${i}.txt`, Buffer.from('x'));
    expect(() => parseEpub(zip.toBuffer())).toThrow('too many entries');
  });
});

/** A one-chapter EPUB whose chapter body is `body`. */
function epubWithBody(body: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    ),
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(
      '<package><metadata><dc:title>Ruby</dc:title></metadata>' +
        '<manifest><item id="ch1" href="ch1.xhtml"/></manifest>' +
        '<spine><itemref idref="ch1"/></spine></package>',
    ),
  );
  zip.addFile('OEBPS/ch1.xhtml', Buffer.from(`<html><body>${body}</body></html>`));
  return zip.toBuffer();
}

// parseEpub drops a chapter under 10 characters, so text lost from a short
// chapter would drop the whole chapter and hide the loss. Each body ends with this.
const PAD = '<p>これは十文字以上ある段落です。</p>';
const PAD_TEXT = '\n\nこれは十文字以上ある段落です。';
const chapterMarkdown = (body: string) =>
  parseEpub(epubWithBody(body + PAD)).chapters.map((chapter) => chapter.markdown);

describe('parseEpub ruby', () => {
  test('keeps the base text and drops the furigana', () => {
    const { chapters } = parseEpub(
      epubWithBody(
        '<p><ruby>試験<rt>しけん</rt></ruby>の<ruby>文章<rt>ぶんしょう</rt></ruby>を' +
          '<ruby>毎日<rp>(</rp><rt>まいにち</rt><rp>)</rp></ruby>' +
          '<ruby>読<rt>よ</rt></ruby>む。</p>',
      ),
    );
    expect(chapters.map((chapter) => chapter.markdown)).toEqual(['試験の文章を毎日読む。']);
  });

  test('keeps the text after an omitted </rt>', () => {
    const markdown = chapterMarkdown(
      '<p><ruby>漢<rt>かん</ruby><ruby>字<rt>じ</ruby>を読む。</p>' +
        '<p>本文本文。<ruby>本<rt>ほん</rt></ruby>です。</p>',
    );
    expect(markdown).toEqual(['漢字を読む。\n\n本文本文。本です。' + PAD_TEXT]);
  });

  test('keeps the text after a self-closing <rp/>', () => {
    const markdown = chapterMarkdown(
      '<p><ruby>漢<rp/><rt>かん</rt><rp/></ruby>字を読む。</p>' +
        '<p><ruby>本<rp>(</rp><rt>ほん</rt><rp>)</rp></ruby>です。</p>',
    );
    expect(markdown).toEqual(['漢字を読む。\n\n本です。' + PAD_TEXT]);
  });

  test('drops an <rtc> reading', () => {
    const markdown = chapterMarkdown('<p><ruby>漢字<rtc>かんじ</rtc></ruby>を読む。</p>');
    expect(markdown).toEqual(['漢字を読む。' + PAD_TEXT]);
  });
});
