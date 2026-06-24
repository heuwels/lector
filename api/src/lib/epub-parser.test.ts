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
