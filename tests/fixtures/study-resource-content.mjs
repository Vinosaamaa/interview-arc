// Synthetic, redistributable test files. No real user material.
export const resourceText = ('Complete paragraph with code: return 42; and emoji 😀.\n').repeat(700);
export const resourceHtml = '<!doctype html><h1>Queue design</h1><details><summary>Deep detail</summary><pre>if (a &lt; b) {\n  return 42;\n}</pre><p>Collapsed but preserved.</p></details><script>NEVER_EXECUTE_OR_TEACH_THIS()</script><img src="https://example.test/unfetched.png" alt="Queue diagram">';
export const resourcePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fXYAAAAASUVORK5CYII=', 'base64');
export function resourcePdf() {
  const stream = 'BT /F1 18 Tf 50 700 Td (Synthetic complete PDF text) Tj ET\n20 20 200 100 re S';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let source = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(source)); source += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}
