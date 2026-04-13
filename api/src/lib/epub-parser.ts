import AdmZip from 'adm-zip';
import path from 'path';
import { htmlToMarkdown, countWords } from './html-to-markdown';

export interface EpubChapter {
  title: string;
  markdown: string;
  wordCount: number;
}

export interface ParsedEpub {
  title: string;
  author: string;
  chapters: EpubChapter[];
}

export function parseEpub(buffer: Buffer): ParsedEpub {
  const zip = new AdmZip(buffer);

  const containerXml = zip.readAsText('META-INF/container.xml');
  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfPathMatch) {
    throw new Error('Could not find OPF file path in container.xml');
  }
  const opfPath = opfPathMatch[1];
  const opfDir = path.dirname(opfPath);

  const opfXml = zip.readAsText(opfPath);

  const title = extractTag(opfXml, 'dc:title') || extractTag(opfXml, 'title') || 'Untitled';
  const author = extractTag(opfXml, 'dc:creator') || extractTag(opfXml, 'creator') || 'Unknown';

  const manifest = new Map<string, string>();
  const manifestRegex = /<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*(?:media-type="([^"]+)")?[^>]*\/?>/g;
  let match;
  while ((match = manifestRegex.exec(opfXml)) !== null) {
    manifest.set(match[1], match[2]);
  }

  const manifestRegex2 = /<item\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*\/?>/g;
  while ((match = manifestRegex2.exec(opfXml)) !== null) {
    if (!manifest.has(match[2])) {
      manifest.set(match[2], match[1]);
    }
  }

  const spineItemRefs: string[] = [];
  const spineRegex = /<itemref\s+[^>]*idref="([^"]+)"[^>]*\/?>/g;
  while ((match = spineRegex.exec(opfXml)) !== null) {
    spineItemRefs.push(match[1]);
  }

  const chapters: EpubChapter[] = [];
  const tocTitles = parseToc(zip, opfXml, manifest, opfDir);

  for (const itemRef of spineItemRefs) {
    const href = manifest.get(itemRef);
    if (!href) continue;

    const filePath = opfDir !== '.' ? `${opfDir}/${href}` : href;
    const entry = zip.getEntry(filePath) || zip.getEntry(href);
    if (!entry) continue;

    const xhtml = entry.getData().toString('utf-8');

    const bodyMatch = xhtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : xhtml;

    const markdown = htmlToMarkdown(bodyHtml).trim();
    if (!markdown || markdown.length < 10) continue;

    const headingMatch = markdown.match(/^#+\s+(.+)$/m);
    const tocTitle = tocTitles.get(href);
    const chapterTitle = tocTitle || headingMatch?.[1] || `Chapter ${chapters.length + 1}`;

    chapters.push({ title: chapterTitle, markdown, wordCount: countWords(markdown) });
  }

  return { title, author, chapters };
}

function extractTag(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseToc(
  zip: AdmZip, opfXml: string, manifest: Map<string, string>, opfDir: string
): Map<string, string> {
  const titles = new Map<string, string>();

  const ncxMatch = opfXml.match(/<item[^>]*id="ncx"[^>]*href="([^"]+)"[^>]*\/?>/i)
    || opfXml.match(/<item[^>]*href="([^"]+)"[^>]*id="ncx"[^>]*\/?>/i)
    || opfXml.match(/<item[^>]*media-type="application\/x-dtbncx\+xml"[^>]*href="([^"]+)"[^>]*\/?>/i)
    || opfXml.match(/<item[^>]*href="([^"]+)"[^>]*media-type="application\/x-dtbncx\+xml"[^>]*\/?>/i);

  if (ncxMatch) {
    const ncxPath = opfDir !== '.' ? `${opfDir}/${ncxMatch[1]}` : ncxMatch[1];
    const ncxEntry = zip.getEntry(ncxPath) || zip.getEntry(ncxMatch[1]);
    if (ncxEntry) {
      const ncxXml = ncxEntry.getData().toString('utf-8');
      const navPointRegex = /<navPoint[^>]*>[\s\S]*?<text>([^<]+)<\/text>[\s\S]*?<content\s+src="([^"]+)"[\s\S]*?<\/navPoint>/g;
      let match;
      while ((match = navPointRegex.exec(ncxXml)) !== null) {
        const src = match[2].split('#')[0];
        titles.set(src, match[1].trim());
      }
    }
  }

  if (titles.size === 0) {
    const navMatch = opfXml.match(/<item[^>]*properties="nav"[^>]*href="([^"]+)"[^>]*\/?>/i)
      || opfXml.match(/<item[^>]*href="([^"]+)"[^>]*properties="nav"[^>]*\/?>/i);

    if (navMatch) {
      const navPath = opfDir !== '.' ? `${opfDir}/${navMatch[1]}` : navMatch[1];
      const navEntry = zip.getEntry(navPath) || zip.getEntry(navMatch[1]);
      if (navEntry) {
        const navHtml = navEntry.getData().toString('utf-8');
        const linkRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
        let match;
        while ((match = linkRegex.exec(navHtml)) !== null) {
          const src = match[1].split('#')[0];
          titles.set(src, match[2].trim());
        }
      }
    }
  }

  return titles;
}
