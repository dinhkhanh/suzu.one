"use client";
// The preview dialog every attachment opens in (photo, video, audio, PDF, Word, Excel, CSV, text,
// zip). It is handed a short-lived storage link that the owning module made after its own check,
// and a way to ask for another; it never decides who may see a file.
//
// Pictures, video and audio play straight from the link. The other viewers read the bytes, which
// the browser fetches from storage (the bucket's CORS rule allows GET from the app) and keeps in
// memory: a PDF is shown from a blob by the browser's own viewer, a .docx is turned into HTML by
// mammoth inside a sandboxed frame, a sheet or CSV becomes a table, a zip lists its entries.
import { Download, FileQuestion, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action";
import { parseCsv } from "../../import/engine/table";
import { formatBytes, listZipEntries, type PreviewKind, previewKindOf, readsBytes, type ZipEntry } from "../preview";

const MediaPlayer = dynamic(() => import("./media-player"), { ssr: false, loading: () => <Loading /> });

export type OpenLink = () => Promise<ActionResult<{ url: string }>>;
export type PreviewTarget = { url: string; fileName: string | null; openLink: OpenLink };

/** A table shows this much of a sheet; the rest is a download away. */
const MAX_ROWS = 500;
const MAX_COLUMNS = 50;
const MAX_TEXT_CHARS = 200_000;
/** A link that failed sooner than this after it was made is broken, not expired: no new one. */
const RETRY_AFTER_MS = 10_000;

type Sheet = { name: string; rows: string[][]; total: number };
type Content = { kind: "pdf"; objectUrl: string } | { kind: "document"; html: string } | { kind: "sheets"; sheets: Sheet[] } | { kind: "text"; text: string } | { kind: "archive"; entries: ZipEntry[] | null };

const nameInLink = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
};

/** One place for a screen to open a preview from: `show()` a link, render `dialog`. */
export function useFilePreview() {
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const dialog = target ? <FilePreviewDialog key={target.url} target={target} onClose={() => setTarget(null)} /> : null;
  return { show: setTarget, dialog };
}

export function FilePreviewDialog({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const t = useTranslations("files");
  const [url, setUrl] = useState(target.url);
  // When the current link was made: the dialog opens right after its first one.
  const madeAt = useRef(0);
  useEffect(() => {
    madeAt.current = Date.now();
  }, []);
  const [broken, setBroken] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const kind = previewKindOf(target.fileName, target.url);
  const title = target.fileName ?? nameInLink(target.url);

  const reopen = useCallback(async (): Promise<string | null> => {
    const result = await target.openLink();
    if (!result.ok) return null;
    madeAt.current = Date.now();
    return result.data.url;
  }, [target]);

  // Media errors when its link lapses mid-watch: a fresh one, unless the first was simply broken.
  const onExpired = useCallback(() => {
    if (Date.now() - madeAt.current < RETRY_AFTER_MS) return setBroken(true);
    void reopen().then((fresh) => (fresh ? setUrl(fresh) : setBroken(true)));
  }, [reopen]);

  async function download() {
    setDownloading(true);
    // A link older than a few seconds may lapse before the browser gets to it.
    const fresh = Date.now() - madeAt.current < RETRY_AFTER_MS ? url : await reopen();
    setDownloading(false);
    // The stored object says `Content-Disposition: attachment`, so this saves rather than navigates.
    if (fresh) window.location.assign(fresh);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-3 p-3 sm:max-w-5xl sm:p-4" showCloseButton>
        <div className="flex min-w-0 items-center gap-2 pr-10">
          <DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>
          <Button type="button" variant="outline" size="sm" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            {t("download")}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{broken ? <Notice onDownload={download}>{t("failed")}</Notice> : <Viewer kind={kind} url={url} onExpired={onExpired} onDownload={download} />}</div>
      </DialogContent>
    </Dialog>
  );
}

function Viewer({ kind, url, onExpired, onDownload }: { kind: PreviewKind; url: string; onExpired: () => void; onDownload: () => void }) {
  const t = useTranslations("files");
  if (kind === "image") return <ImageViewer url={url} onDownload={onDownload} />;
  if (kind === "video" || kind === "audio") return <MediaPlayer kind={kind} url={url} onExpired={onExpired} />;
  if (readsBytes(kind)) return <BytesViewer kind={kind} url={url} onDownload={onDownload} />;
  return (
    <Notice onDownload={onDownload} icon>
      {t("unsupported")}
    </Notice>
  );
}

/** Fits the picture to the dialog; a click shows it at its own size. */
function ImageViewer({ url, onDownload }: { url: string; onDownload: () => void }) {
  const t = useTranslations("files");
  const [actualSize, setActualSize] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return <Notice onDownload={onDownload}>{t("failed")}</Notice>;
  return (
    <div className={actualSize ? "overflow-auto" : "flex items-center justify-center"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, one-minute storage link */}
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        onClick={() => setActualSize((value) => !value)}
        className={actualSize ? "max-w-none cursor-zoom-out" : "max-h-[78dvh] max-w-full cursor-zoom-in rounded-md object-contain"}
      />
    </div>
  );
}

async function readContent(kind: PreviewKind, blob: Blob): Promise<Content> {
  if (kind === "pdf") return { kind: "pdf", objectUrl: URL.createObjectURL(new Blob([blob], { type: "application/pdf" })) };
  if (kind === "document") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    return { kind: "document", html: value };
  }
  if (kind === "spreadsheet") {
    const readXlsxFile = (await import("read-excel-file/browser")).default;
    const sheets = await readXlsxFile(blob);
    return { kind: "sheets", sheets: sheets.map((sheet) => tableOf(sheet.sheet, sheet.data as unknown[][])) };
  }
  if (kind === "csv") {
    const text = await blob.text();
    const rows =
      text.includes("\t") && !text.includes(",")
        ? text
            .replace(/^﻿/, "")
            .split(/\r?\n/)
            .map((line) => line.split("\t"))
        : parseCsv(text);
    return { kind: "sheets", sheets: [tableOf("", rows)] };
  }
  if (kind === "archive") return { kind: "archive", entries: listZipEntries(new Uint8Array(await blob.arrayBuffer())) };
  return { kind: "text", text: (await blob.text()).slice(0, MAX_TEXT_CHARS) };
}

const cellText = (value: unknown) => (value == null ? "" : value instanceof Date ? value.toLocaleDateString() : String(value));
function tableOf(name: string, data: unknown[][]): Sheet {
  const rows = data.filter((row) => row.some((cell) => cellText(cell) !== ""));
  return { name, total: rows.length, rows: rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLUMNS).map(cellText)) };
}

function BytesViewer({ kind, url, onDownload }: { kind: PreviewKind; url: string; onDownload: () => void }) {
  const t = useTranslations("files");
  const [content, setContent] = useState<Content | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void fetch(url, { referrerPolicy: "no-referrer" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then((blob) => readContent(kind, blob))
      .then((read) => {
        if (read.kind === "pdf") objectUrl = read.objectUrl;
        if (alive) setContent(read);
        else if (objectUrl) URL.revokeObjectURL(objectUrl);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, url]);

  if (failed) return <Notice onDownload={onDownload}>{t("failed")}</Notice>;
  if (!content) return <Loading />;
  switch (content.kind) {
    case "pdf":
      return <iframe src={content.objectUrl} title={t("preview")} className="h-[78dvh] w-full rounded-md border bg-muted" />;
    case "document":
      // No scripts, no same-origin: the frame only lays out what mammoth wrote.
      return <iframe sandbox="" srcDoc={documentPage(content.html)} title={t("preview")} className="h-[78dvh] w-full rounded-md border bg-white" />;
    case "sheets":
      return <SheetsViewer sheets={content.sheets} />;
    case "archive":
      return <ArchiveViewer entries={content.entries} />;
    case "text":
      return <pre className="max-h-[78dvh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{content.text}</pre>;
  }
}

const documentPage = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;max-width:52rem;margin:0 auto;padding:2rem 1.5rem}img{max-width:100%;height:auto}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #ddd;padding:.35em .6em;vertical-align:top}a{color:#2563eb}</style></head><body>${body}</body></html>`;

function SheetsViewer({ sheets }: { sheets: Sheet[] }) {
  const t = useTranslations("files");
  const [active, setActive] = useState(0);
  const sheet = sheets[active];
  return (
    <div className="flex flex-col gap-2">
      {sheets.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {sheets.map((each, index) => (
            <Button key={`${index}-${each.name}`} type="button" size="xs" variant={index === active ? "default" : "outline"} onClick={() => setActive(index)}>
              {each.name}
            </Button>
          ))}
        </div>
      ) : null}
      {!sheet || sheet.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("sheetEmpty")}</p>
      ) : (
        <TableCard className="max-h-[72dvh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                {sheet.rows[0].map((cell, index) => (
                  <TableHead key={index} kind="text">
                    {cell}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheet.rows.slice(1).map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, index) => (
                    <TableCell key={index} className="max-w-72 truncate" title={cell}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      {sheet && sheet.total > sheet.rows.length ? <p className="text-xs text-muted-foreground">{t("rowsCut", { shown: sheet.rows.length, total: sheet.total })}</p> : null}
    </div>
  );
}

function ArchiveViewer({ entries }: { entries: ZipEntry[] | null }) {
  const t = useTranslations("files");
  if (!entries) return <p className="py-8 text-center text-sm text-muted-foreground">{t("archiveUnreadable")}</p>;
  if (entries.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t("archiveEmpty")}</p>;
  const files = entries.filter((entry) => !entry.directory);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("archiveEntries", { count: files.length })}</p>
      <TableCard className="max-h-[72dvh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="file">{t("columns.name")}</TableHead>
              <TableHead kind="number">{t("columns.size")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((entry) => (
              <TableRow key={entry.name}>
                <TableCell className="font-mono text-xs break-all whitespace-normal">{entry.name}</TableCell>
                <TableCell kind="number" className="text-xs text-muted-foreground">
                  {formatBytes(entry.sizeBytes)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

function Loading() {
  const t = useTranslations("files");
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {t("loading")}
    </div>
  );
}

function Notice({ children, onDownload, icon }: { children: ReactNode; onDownload: () => void; icon?: boolean }) {
  const t = useTranslations("files");
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center text-sm text-muted-foreground">
      {icon ? <FileQuestion className="size-10 opacity-50" /> : null}
      <p>{children}</p>
      <Button type="button" size="sm" onClick={onDownload}>
        <Download />
        {t("download")}
      </Button>
    </div>
  );
}
