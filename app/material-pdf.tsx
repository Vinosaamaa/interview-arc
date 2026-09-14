"use client";
import { useEffect, useState } from "react";
import { openPdfPages } from "./resources/pdf-pages";
export default function MaterialPdf({ url }: {
    url: string;
}) {
    const [pdf, setPdf] = useState<Awaited<ReturnType<typeof openPdfPages>> | null>(null), [page, setPage] = useState(1), [image, setImage] = useState<{
        page: number;
        url: string;
    } | null>(null), [error, setError] = useState("");
    useEffect(() => {
        const abort = new AbortController();
        let opened: Awaited<ReturnType<typeof openPdfPages>> | null = null;
        void (async () => { try {
            const r = await fetch(url, { signal: abort.signal });
            if (!r.ok)
                throw Error("The original PDF could not be loaded.");
            opened = await openPdfPages(await r.blob());
            if (abort.signal.aborted) {
                await opened.close();
                return;
            }
            setPdf(opened);
        }
        catch (e) {
            if (!abort.signal.aborted)
                setError(e instanceof Error ? e.message : "The PDF could not be opened.");
        } })();
        return () => { abort.abort(); if (opened)
            void opened.close(); };
    }, [url]);
    useEffect(() => {
        if (!pdf)
            return;
        let active = true, objectUrl: string | undefined;
        void pdf.render(page).then(blob => { if (!active)
            return; objectUrl = URL.createObjectURL(blob); setImage({ page, url: objectUrl }); setError(""); }).catch(e => { if (active)
            setError(e instanceof Error ? e.message : "This page could not be displayed."); });
        return () => { active = false; if (objectUrl)
            URL.revokeObjectURL(objectUrl); };
    }, [pdf, page]);
    return <section aria-label="Original PDF pages"><div className="material-source-actions"><button disabled={!pdf || page <= 1 || (image?.page !== page && !error)} onClick={() => { setError(""); setPage(p => p - 1); }}>Previous page</button><span>Page {page}{pdf ? ` of ${pdf.total}` : ""}</span><button disabled={!pdf || page >= pdf.total || (image?.page !== page && !error)} onClick={() => { setError(""); setPage(p => p + 1); }}>Next page</button></div>{error ? <p role="alert">{error} The unchanged PDF is available through Download original.</p> : image?.page === page ? <img className="material-image" src={image.url} alt={`Original PDF page ${page}`}/> : <p role="status">Rendering original PDF page…</p>}</section>;
}
