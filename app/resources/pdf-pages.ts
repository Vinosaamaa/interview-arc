// Rendering happens locally in the browser. The original PDF remains unchanged.
export async function* pdfPageImages(file: Blob) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    if (pdf.numPages > 100) throw Error("Original saved. Page-image preparation supports up to 100 pages per PDF; split a reading copy for longer documents.");
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber), base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.sqrt(4_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale }), canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error("Page image could not be rendered.")), "image/png"));
      yield { page: pageNumber, total: pdf.numPages, blob };
      canvas.width = 0; canvas.height = 0; page.cleanup();
    }
  } finally { await pdf.loadingTask.destroy(); }
}
