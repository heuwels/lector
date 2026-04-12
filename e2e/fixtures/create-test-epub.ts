/**
 * Creates a minimal test EPUB file for E2E testing.
 * Run: npx tsx e2e/fixtures/create-test-epub.ts
 */
import AdmZip from 'adm-zip';
import path from 'path';

const zip = new AdmZip();

// mimetype must be first, uncompressed
zip.addFile('mimetype', Buffer.from('application/epub+zip'));

// container.xml
zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`));

// content.opf
zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Toets Boek</dc:title>
    <dc:creator>Toets Outeur</dc:creator>
    <dc:language>af</dc:language>
    <dc:identifier id="uid">test-epub-001</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`));

// Chapter 1
zip.addFile('OEBPS/chapter1.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Hoofstuk 1</title></head>
<body>
<h1>Hoofstuk 1: Die Begin</h1>
<p>Dit is die eerste hoofstuk van die toetsboek. Ons leer Afrikaans met hierdie kort storie.</p>
<p>Die man stap deur die straat. Hy sien 'n mooi huis met 'n groot tuin.</p>
</body>
</html>`));

// Chapter 2
zip.addFile('OEBPS/chapter2.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Hoofstuk 2</title></head>
<body>
<h1>Hoofstuk 2: Die Middel</h1>
<p>In die tweede hoofstuk gaan die man na die winkel. Hy koop brood en melk.</p>
<p>Die kat sit op die mat en kyk na die voëls buite.</p>
</body>
</html>`));

// Chapter 3
zip.addFile('OEBPS/chapter3.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Hoofstuk 3</title></head>
<body>
<h1>Hoofstuk 3: Die Einde</h1>
<p>Die laaste hoofstuk vertel hoe die storie eindig. Almal is gelukkig.</p>
<p>Die son sak en die sterre begin skyn. Dit was 'n goeie dag.</p>
</body>
</html>`));

const outPath = path.join(__dirname, 'test-book.epub');
zip.writeZip(outPath);
console.log(`Created test EPUB at ${outPath}`);
