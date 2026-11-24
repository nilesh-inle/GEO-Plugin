/**
 * Three cards under the AI visibility summary: which AI engines name the
 * store, which competitors are named, and the most cited sources. A row of
 * the competitors card opens the pages of that brand AI links to; "View more"
 * on the sources card opens every cited domain with its top pages.
 * Tailwind; see app/styles/citations.css.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { getAiTool } from "../lib/aiTools";
import { formatNumber } from "../lib/format";
import { Badge, EmptyBox, EngineAvatar, EngineStack, Favicon, Icon } from "./CitationUi";

const percent = (value) => (value == null ? "–" : `${value}%`);
const COMPETITORS_SHOWN = 5;
const SOURCES_SHOWN = 3;

function InsightCard({ title, subtitle, children, footer }) {
  return (
    <section className="flex min-h-[250px] flex-col rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-[13px] text-gray-500">{subtitle}</p>
      <div className="mt-4 flex flex-1 flex-col gap-3">{children}</div>
      {footer && <div className="mt-3 flex justify-end">{footer}</div>}
    </section>
  );
}

const LINK_BUTTON = "text-xs font-medium text-brand hover:underline";

// ─── Cards ────────────────────────────────────────────────────────────────────

function EngineCard({ engines }) {
  const best = engines.find((engine) => engine.mentioned > 0);
  const name = best ? (getAiTool(best.id)?.name ?? best.id) : null;
  return (
    <InsightCard title="Mentions by AI" subtitle="See which AI models name your store">
      {engines.length ? (
        <>
          {name && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700">
              <EngineAvatar id={best.id} className="size-4" />
              {`Most visibility comes from ${name}`}
            </span>
          )}
          <ol className="flex flex-col gap-2.5">
            {engines.map((engine, index) => {
              const share = engine.answers ? (engine.mentioned / engine.answers) * 100 : 0;
              return (
                <li key={engine.id} className="flex items-center gap-2.5 text-[13px]">
                  <span className="w-4 text-gray-400">{index + 1}</span>
                  <EngineAvatar id={engine.id} className="size-5" />
                  <span className="w-24 truncate font-medium text-gray-900">
                    {getAiTool(engine.id)?.name ?? engine.id}
                  </span>
                  <span
                    role="progressbar"
                    aria-label={`Answers naming your store, ${getAiTool(engine.id)?.name ?? engine.id}`}
                    aria-valuemin={0}
                    aria-valuemax={engine.answers}
                    aria-valuenow={engine.mentioned}
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"
                  >
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${share}%` }} />
                  </span>
                  <span className="w-10 text-right text-gray-700" title="Answers naming your store">
                    {`${engine.mentioned}/${engine.answers}`}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-auto pt-2 text-xs text-gray-500">
            {name
              ? `${name} drives most of your visibility`
              : "No AI engine has named your store in this period"}
          </p>
        </>
      ) : (
        <EmptyBox title="No answers yet">Run a check to see which AI engines name your store.</EmptyBox>
      )}
    </InsightCard>
  );
}

function CompetitorCard({ voices, onOpen }) {
  const [all, setAll] = useState(false);
  const shown = all ? voices : voices.slice(0, COMPETITORS_SHOWN);
  const watched = voices.some((voice) => !voice.you);
  return (
    <InsightCard
      title="Competitors mentioned"
      subtitle="Track competitor mentions in AI responses"
      footer={
        voices.length > COMPETITORS_SHOWN && (
          <button type="button" onClick={() => setAll((value) => !value)} className={LINK_BUTTON}>
            {all ? "Show less" : "View more"}
          </button>
        )
      }
    >
      <ol className="flex flex-col gap-1">
        {shown.map((voice, index) => (
          <li key={voice.key}>
            <button
              type="button"
              onClick={() => onOpen(voice.key)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] ${voice.you ? "bg-emerald-50 hover:bg-emerald-100" : "hover:bg-gray-50"}`}
            >
              <span className="w-4 text-gray-400">{index + 1}</span>
              <span className="min-w-0 truncate font-medium text-gray-900" title={voice.name}>
                {voice.name}
              </span>
              {voice.you && (
                <span className="rounded-full border border-emerald-300 px-1.5 text-[10px] leading-4 font-medium text-emerald-700">
                  You
                </span>
              )}
              <span
                className="ml-auto text-gray-700"
                title={`Named in ${formatNumber(voice.answers)} of ${formatNumber(voice.rate.total)} answers`}
              >
                {percent(voice.rate.value)}
              </span>
              <span className="sr-only">, show the pages AI links to</span>
              <Icon name="chevronRight" className="size-3.5 text-gray-400" />
            </button>
          </li>
        ))}
      </ol>
      {!watched && <p className="text-xs text-gray-500">No competitors are watched yet.</p>}
    </InsightCard>
  );
}

function SourcesCard({ sources, onMore }) {
  return (
    <InsightCard
      title="Top cited sources"
      subtitle="Discover which websites AI cites in its answers"
      footer={
        sources.length > SOURCES_SHOWN && (
          <button type="button" onClick={onMore} className={LINK_BUTTON}>
            View more
          </button>
        )
      }
    >
      {sources.length ? (
        <ol className="flex flex-col gap-2.5">
          {sources.slice(0, SOURCES_SHOWN).map((source, index) => (
            <li key={source.host} className="flex items-center gap-2.5 text-[13px]">
              <span className="w-4 text-gray-400">{index + 1}</span>
              <Favicon host={source.host} />
              <span className="min-w-0 truncate font-medium text-gray-900" title={source.host}>
                {source.host}
              </span>
              <EngineStack ids={source.engines} />
               <span className="ml-auto text-gray-700" title={`Cited in ${formatNumber(source.answers)} answers`}>
                {percent(source.share.value)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyBox title="No sources yet">Sources appear when AI answers link to websites.</EmptyBox>
      )}
    </InsightCard>
  );
}

// ─── Side panels ──────────────────────────────────────────────────────────────

const BOX_BUTTON =
  "grid size-9 place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50";

/** A panel sliding in from the right; Back, Close, Escape and the backdrop close it. */
function Drawer({ title, intro, onClose, children }) {
  const titleId = useId();
  const closeButton = useRef(null);

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

  return createPortal(
    <div className="geo-ui fixed inset-0 z-[1000] animate-[geo-fade-in_150ms_ease-out] motion-reduce:animate-none">
      {/* The panel can also be closed with the buttons and Escape. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full max-w-[640px] animate-[geo-slide-in_200ms_ease-out] flex-col bg-white shadow-2xl motion-reduce:animate-none"
      >
        <header className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Back" onClick={onClose} className={BOX_BUTTON}>
              <Icon name="chevronLeft" className="size-4" />
            </button>
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">
              {title}
            </h2>
            <button
              ref={closeButton}
              type="button"
              aria-label="Close"
              onClick={onClose}
              className={BOX_BUTTON}
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
          {intro && <p className="text-[13px] leading-5 text-gray-500">{intro}</p>}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        <footer className="flex justify-end border-t border-gray-200 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-gray-300 bg-white px-4 text-[13px] text-gray-800 hover:bg-gray-50"
          >
            Close
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function SourcesPanel({ sources, onClose }) {
  const [open, setOpen] = useState(null);
  return (
    <Drawer
      title="Cited sources and domains"
      intro="See where AI gets its answers. Focus on improving your presence on the domains that often influence what AI says."
      onClose={onClose}
    >
      <h3 className="text-[15px] font-semibold text-gray-900">Top cited domains</h3>
      <p className="mt-1 mb-4 text-[13px] text-gray-500">
        The share is the answers that link to the domain, out of all answers in the period.
      </p>
      <ul>
        {sources.map((source, index) => {
          const expanded = open === source.host;
          return (
            <li key={source.host} className="border-b border-gray-100 last:border-b-0">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : source.host)}
                className={`flex w-full items-center gap-3 px-3 py-3 text-[14px] hover:bg-gray-50 ${expanded ? "rounded-t-lg bg-gray-50" : ""}`}
              >
                <span className="w-5 text-gray-400">{index + 1}</span>
                <Favicon host={source.host} className="size-5" />
                <span className="min-w-0 truncate font-medium text-gray-900">{source.host}</span>
                {source.isStore && <Badge tone="success">Your store</Badge>}
                <EngineStack ids={source.engines} />
                <span className="ml-auto text-gray-700">{percent(source.share.value)}</span>
                <Icon
                  name="chevronDown"
                  className={`size-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              {expanded && (
                <div className="mb-3 rounded-b-lg border border-gray-200 bg-gray-50 px-4 py-3.5">
                  <p className="mb-2.5 text-[14px] font-semibold text-gray-900">Top URLs</p>
                  {source.urls.length ? (
                    <ul className="flex flex-col gap-2">
                      {source.urls.map((item) => (
                        <li key={item.url} className="flex items-center gap-2 text-[13px]">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 truncate text-gray-700 hover:text-brand-700 hover:underline"
                            title={item.url}
                          >
                            {item.url}
                          </a>
                          <Icon name="external" className="size-3.5 text-gray-400" />
                          {item.answers > 1 && (
                            <span className="ml-auto shrink-0 text-xs text-gray-400">
                              {`${item.answers} answers`}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-gray-500">
                      The exact pages aren&apos;t shown for this domain. Some AI tools, such as
                      Gemini, only name the site.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}

// ─── One brand's pages ────────────────────────────────────────────────────────

const shortUrl = (url) => url.replace(/^https?:\/\//, "");

function PanelStat({ label, value, note }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3.5 py-3">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 text-xl leading-7 font-semibold text-gray-900">{value}</dd>
      <dd className="text-xs text-gray-500">{note}</dd>
    </div>
  );
}

/**
 * The pages of the store, or of one competitor, that AI answers link to: how
 * many answers link to each, where the link sits among the answer's sources
 * and which AI tools gave it.
 */
function PagesPanel({ voice, onClose }) {
  const total = voice.rate.total;
  const linkedRate = total ? Math.round((voice.linked / total) * 100) : null;
  return (
    <Drawer
      title={voice.you ? "Your pages in AI answers" : `${voice.name} pages in AI answers`}
      intro={
        voice.you
          ? "The pages of your store that AI answers link to. Keep them accurate and complete: AI quotes them when it recommends you."
          : `The pages of ${voice.name} that AI answers link to when it recommends them.`
      }
      onClose={onClose}
    >
      <div className="flex items-center gap-3">
        {voice.domain && <Favicon host={voice.domain} className="size-8" />}
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
            <span className="truncate">{voice.name}</span>
            {voice.you && <Badge tone="success">You</Badge>}
          </p>
          <p className="text-[13px] text-gray-500">{voice.domain ?? "No website added"}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <PanelStat
          label="Named in"
          value={percent(voice.rate.value)}
          note={`${formatNumber(voice.answers)} of ${formatNumber(total)} answers`}
        />
        <PanelStat
          label="Linked in"
          value={voice.domain ? percent(linkedRate) : "–"}
          note={
            voice.domain
              ? `${formatNumber(voice.linked)} of ${formatNumber(total)} answers`
              : "Needs a website"
          }
        />
      </dl>

      <h3 className="mt-6 text-[15px] font-semibold text-gray-900">Pages AI links to</h3>
      <p className="mt-1 mb-3 text-[13px] text-gray-500">
        Answers counts the answers linking to the page. Position is where the link sits among an
        answer&apos;s sources on average, 1 being the first.
      </p>

      {voice.pages.length ? (
        <table className="w-full table-fixed text-[13px]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th scope="col" className="py-2 pr-3 font-medium">
                Page
              </th>
              <th scope="col" className="w-24 py-2 font-medium">
                AI tools
              </th>
              <th scope="col" className="w-20 py-2 text-right font-medium">
                Position
              </th>
              <th scope="col" className="w-20 py-2 text-right font-medium">
                Answers
              </th>
            </tr>
          </thead>
          <tbody>
            {voice.pages.map((page) => (
              <tr key={page.url ?? "hidden"} className="border-b border-gray-100 last:border-b-0">
                <td className="py-2.5 pr-3">
                  {page.url ? (
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={page.url}
                      className="flex min-w-0 items-center gap-1.5 text-gray-800 hover:text-brand-700 hover:underline"
                    >
                      <span className="truncate">{shortUrl(page.url)}</span>
                      <Icon name="external" className="size-3.5 text-gray-400" />
                    </a>
                  ) : (
                    <span className="text-gray-500">Exact page hidden: AI named only the site</span>
                  )}
                </td>
                <td className="py-2.5">
                  <EngineStack ids={page.engines} />
                </td>
                <td className="py-2.5 text-right text-gray-700">{`#${page.position}`}</td>
                <td className="py-2.5 text-right text-gray-700">{formatNumber(page.answers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : voice.domain ? (
        <EmptyBox title="No links in this period">
          {voice.answers
            ? `AI named ${voice.you ? "your store" : voice.name} but didn't link to ${voice.domain}.`
            : `No AI answer linked to ${voice.domain}.`}
        </EmptyBox>
      ) : (
        <EmptyBox title="No website added">
          <>
            Add {voice.name}&apos;s website in{" "}
            <Link to="/app/settings" className="text-brand hover:underline">
              Settings
            </Link>{" "}
            to see which of its pages AI links to.
          </>
        </EmptyBox>
      )}
    </Drawer>
  );
}

/**
 * @param {object} props
 * @param {object} props.breakdown from buildVisibilityBreakdown
 * @param {boolean} props.loading the page is reloading
 */
export function VisibilityInsights({ breakdown, loading }) {
  // null, "sources", or the key of the brand whose pages are shown
  const [panel, setPanel] = useState(null);
  const onClose = useCallback(() => setPanel(null), []);
  // Looked up on each render, so an open panel follows a period change.
  const voice = breakdown.voices.find((item) => item.key === panel);
  return (
    <>
      <div
        aria-busy={loading}
        className={`grid grid-cols-1 gap-3 transition-opacity lg:grid-cols-3 ${loading ? "opacity-60" : ""}`}
      >
        <EngineCard engines={breakdown.engines} />
        <CompetitorCard voices={breakdown.voices} onOpen={setPanel} />
        <SourcesCard sources={breakdown.sources} onMore={() => setPanel("sources")} />
      </div>
      {panel === "sources" && <SourcesPanel sources={breakdown.sources} onClose={onClose} />}
      {voice && <PagesPanel voice={voice} onClose={onClose} />}
    </>
  );
}
