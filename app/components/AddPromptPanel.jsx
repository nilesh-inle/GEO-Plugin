/**
 * "Add new prompt" side panel on the AI visibility page. Saves the prompt and,
 * if asked, checks it right away on the chosen AI engines. Tailwind; see
 * app/styles/citations.css.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { MAX_PROMPT_LENGTH } from "../lib/prompts";
import { formatNumber, pluralize } from "../lib/format";
import { EngineAvatar, Icon } from "./CitationUi";

const postJson = { method: "post", encType: "application/json" };

const ANALYSES = [
  "Whether AI answers name your store",
  "Links to your store's pages, and where they sit among the sources",
  "Which competitors are named next to you",
  "The other websites the answers cite",
];

/**
 * @param {object} props
 * @param {Array<{ id: string, name: string, company: string, connected: boolean }>} props.engines
 * @param {number} props.answers answers asked per engine in a check
 * @param {boolean} props.running a check is running now
 * @param {number} props.selectedPrompts prompts tracked now
 * @param {number} props.maxPrompts prompts a store can track
 * @param {() => void} props.onClose a stable callback
 */
export function AddPromptPanel({ engines, answers, running, selectedPrompts, maxPrompts, onClose }) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const field = useRef(null);
  const connected = engines.filter((engine) => engine.connected);
  const full = selectedPrompts >= maxPrompts;

  const [text, setText] = useState("");
  const [picked, setPicked] = useState(() => connected.map((engine) => engine.id));
  const [runNow, setRunNow] = useState(!running && !full && connected.length > 0);

  const canRun = !running && !full && connected.length > 0;
  const chosen = picked.filter((id) => connected.some((engine) => engine.id === id));
  const wantsRun = runNow && canRun;
  const willRun = wantsRun && chosen.length > 0;
  const requests = chosen.length * answers;
  const ready = text.trim().length >= 8 && !(wantsRun && !chosen.length);
  const saving = fetcher.state !== "idle";
  const error = fetcher.state === "idle" ? fetcher.data?.error : null;

  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    field.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  // The page reloads its data after the save; the panel can go.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;
    const { started, note } = fetcher.data;
    shopify.toast.show(
      started
        ? "Prompt added. Checking it now."
        : note
          ? `Prompt added. ${note}`
          : "Prompt added. It's checked in the next weekly check.",
    );
    onClose();
  }, [fetcher.state, fetcher.data, shopify, onClose]);

  const toggleEngine = (id) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const submit = (event) => {
    event.preventDefault();
    if (!ready || saving) return;
    fetcher.submit({ intent: "add", text, runNow: willRun, engines: chosen }, postJson);
  };

  return createPortal(
    <div className="geo-ui fixed inset-0 z-[1000] animate-[geo-fade-in_150ms_ease-out] motion-reduce:animate-none">
      {/* The panel can also be closed with the buttons and Escape. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-prompt-title"
        onSubmit={submit}
        className="absolute inset-y-0 right-0 flex w-full max-w-[520px] animate-[geo-slide-in_200ms_ease-out] flex-col bg-white shadow-2xl motion-reduce:animate-none"
      >
        <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-3.5">
          <button
            type="button"
            aria-label="Back"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <Icon name="arrowLeft" className="size-4" />
          </button>
          <h2 id="add-prompt-title" className="flex-1 text-base font-semibold text-gray-900">
            Add new prompt
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <Icon name="close" className="size-4" />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] leading-5 text-gray-600">
              Write a question a shopper might ask an AI assistant. GEO asks it to your AI
              engines and shows whether the answers name or link to your store.
            </p>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
              <Icon name="tag" className="size-3.5 text-gray-500" />
              Your prompt
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-prompt-text" className="text-[13px] font-medium text-gray-900">
              Prompt
            </label>
            <textarea
              ref={field}
              id="add-prompt-text"
              rows={4}
              maxLength={MAX_PROMPT_LENGTH}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="e.g. What are the best running shoes for flat feet?"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "add-prompt-error" : undefined}
              className={`w-full resize-none rounded-lg border bg-white px-3 py-2.5 text-[13px] leading-5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-gray-300 focus:border-brand focus:ring-brand"}`}
            />
            <div className="flex items-start justify-between gap-3 text-xs">
              {error ? (
                <p id="add-prompt-error" role="alert" className="text-red-600">
                  {error}
                </p>
              ) : (
                <span className="text-gray-500">At least 8 characters.</span>
              )}
              <span className="shrink-0 text-gray-400">{`${text.length}/${MAX_PROMPT_LENGTH}`}</span>
            </div>
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-medium text-gray-900">
              Select AI engines to check it on
            </legend>
            {connected.length ? (
              <div className="flex flex-col gap-1.5">
                {connected.map((engine) => {
                  const checked = picked.includes(engine.id);
                  return (
                    <label
                      key={engine.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${wantsRun ? "cursor-pointer hover:bg-gray-50" : "cursor-not-allowed opacity-60"} ${checked && wantsRun ? "border-brand bg-brand-50/40" : "border-gray-200"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!wantsRun}
                        onChange={() => toggleEngine(engine.id)}
                        className="size-4 shrink-0 accent-brand"
                      />
                      <EngineAvatar id={engine.id} className="size-6" />
                      <span className="flex-1 text-[13px] text-gray-900">{engine.name}</span>
                      <span className="text-xs text-gray-400">{engine.company}</span>
                    </label>
                  );
                })}
                <p className={`text-xs ${wantsRun && !chosen.length ? "text-red-600" : "text-gray-500"}`}>
                  {wantsRun && !chosen.length
                    ? "Select at least one engine, or turn off Run prompt now."
                    : "Only this first check uses your selection. Weekly checks ask every connected engine."}
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-3 text-[13px] text-gray-600">
                No AI engine is connected yet.{" "}
                <Link to="/app/settings/tools" className="font-medium text-brand hover:underline">
                  Connect an AI tool
                </Link>{" "}
                to check prompts.
              </p>
            )}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <div
              className={`flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-3 ${canRun ? "" : "opacity-60"}`}
            >
              <input
                id="add-prompt-run"
                type="checkbox"
                checked={wantsRun}
                disabled={!canRun}
                aria-describedby="add-prompt-run-help"
                onChange={(event) => setRunNow(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <div className="flex flex-col gap-0.5">
                <label
                  htmlFor="add-prompt-run"
                  className={`text-[13px] font-medium text-gray-900 ${canRun ? "cursor-pointer" : "cursor-not-allowed"}`}
                >
                  Run prompt now
                </label>
                <p id="add-prompt-run-help" className="text-xs leading-5 text-gray-500">
                  {willRun
                    ? `This check makes ${pluralize(requests, "request")} to your AI engines (${pluralize(chosen.length, "engine")} × ${pluralize(answers, "answer")}).`
                    : "Otherwise it's checked in the next weekly check."}
                </p>
              </div>
            </div>
            {running && (
              <p className="text-xs text-gray-500">
                A check is running now. This prompt joins the next one.
              </p>
            )}
            {full && (
              <p className="text-xs text-amber-700">
                {`You track ${formatNumber(maxPrompts)} prompts already, the most there can be. This prompt is saved as archived and isn't checked.`}
              </p>
            )}
          </div>

          <div className="rounded-lg bg-gray-50 px-4 py-3.5">
            <p className="mb-2 text-[13px] font-medium text-gray-900">This prompt will analyze:</p>
            <ul className="flex flex-col gap-1.5">
              {ANALYSES.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs leading-5 text-gray-600">
                  <Icon name="check" className="mt-0.5 size-3.5 text-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-gray-300 bg-white px-4 text-[13px] text-gray-800 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || saving}
            className="h-9 rounded-md bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add prompt"}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
