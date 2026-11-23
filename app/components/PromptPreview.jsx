/**
 * Side panel with a prompt's details, opened from the citation table. The
 * details load from the prompt's own route (/app/visibility/citations/:id),
 * for the table's period and engines. Closes with the X, Escape or a click
 * outside it. Tailwind; see app/styles/citations.css.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useFetcher } from "react-router";
import { periodText, viewQuery } from "../lib/citationView";
import { Icon, Skeleton } from "./CitationUi";
import { PromptDetails } from "./PromptDetails";

/**
 * @param {object} props
 * @param {string} props.promptId
 * @param {{ key: string, from: Date, to: Date }} props.range the period shown
 * @param {string[]} props.engines selected AI engine ids, empty for all
 * @param {() => void} props.onClose
 */
export function PromptPreview({ promptId, range, engines, onClose }) {
  const fetcher = useFetcher();
  const { load } = fetcher;
  const closeButton = useRef(null);
  const query = viewQuery({ range, engines });
  const pageHref = `/app/visibility/citations/${promptId}?${query}`;

  useEffect(() => {
    load(pageHref);
  }, [load, pageHref]);

  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    closeButton.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  const loading = !fetcher.data;
  const detail = fetcher.data?.detail ?? null;

  return createPortal(
    <div className="geo-ui fixed inset-0 z-[1000] animate-[geo-fade-in_150ms_ease-out] motion-reduce:animate-none">
      {/* The panel can also be closed with the X and Escape. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Prompt details"
        className="absolute inset-y-0 right-0 flex w-full max-w-[1040px] animate-[geo-slide-in_200ms_ease-out] flex-col bg-white shadow-2xl motion-reduce:animate-none"
      >
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3.5">
          <h2 className="text-base font-semibold text-gray-900">Prompt details</h2>
          <div className="flex items-center gap-1">
            <Link
              to={pageHref}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              <Icon name="external" className="size-3.5" />
              Open as page
            </Link>
            <button
              ref={closeButton}
              type="button"
              aria-label="Close prompt details"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-gray-50/40">
          {loading ? (
            <PanelSkeleton />
          ) : detail ? (
            <PromptDetails detail={detail} engines={engines} period={periodText(range)} />
          ) : (
            <div className="p-8 text-center text-sm text-gray-500">
              This prompt isn&apos;t tracked any more.
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" role="status" aria-label="Loading prompt details">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
