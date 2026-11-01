import type { BrowserTab } from "@openbot/contracts/ipc";

/** A page that the user went to in this session, and how many times. */
export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visits: number;
}

export type BrowserSuggestionKind = "tab" | "history" | "search" | "url";

/** A row under the address field. */
export interface BrowserSuggestion {
  id: string;
  kind: BrowserSuggestionKind;
  /** The text that the field shows when the arrow keys move to this row. */
  text: string;
  title: string;
  /** The address under the title. */
  detail: string | undefined;
  url: string;
  /** The open tab that the row switches to. */
  tabId?: string;
}

/** The page that a new tab opens. Local privacy mode: a blank page, never a search engine. */
export const BROWSER_NEW_TAB_URL = "about:blank";

/** The address without the scheme, `www.` and a last slash, as the address bar shows it. */
export function browserDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/**
 * The text in the address field opens this page: a web address, or null when the text is not one.
 * Local privacy mode: text that is not an address is never sent to a search engine.
 */
export function browserAddressUrl(value: string): string | null {
  if (value === BROWSER_NEW_TAB_URL) return value;
  const hasProtocol = /^https?:\/\//i.test(value);
  const candidate = hasProtocol ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (
      !/\s/.test(value) &&
      (hasProtocol || url.hostname.includes(".") || url.hostname === "localhost" || url.hostname.startsWith("["))
    ) {
      return candidate;
    }
  } catch {
    // Text that is not a web address opens nothing.
  }
  return null;
}

/** The most visited page whose address starts with the typed text. Its rest is completed in the field. */
export function browserCompletion(
  typed: string,
  history: readonly BrowserHistoryEntry[],
): BrowserHistoryEntry | undefined {
  const text = typed.toLowerCase();
  if (!text || /\s/.test(text)) return undefined;
  let best: BrowserHistoryEntry | undefined;
  for (const entry of history) {
    const shown = browserDisplayUrl(entry.url).toLowerCase();
    if (shown.length <= text.length || !shown.startsWith(text)) continue;
    if (!best || entry.visits > best.visits) best = entry;
  }
  return best;
}

function historyRow(entry: BrowserHistoryEntry): BrowserSuggestion {
  return {
    id: `history:${entry.url}`,
    kind: "history",
    text: browserDisplayUrl(entry.url),
    title: entry.title || browserDisplayUrl(entry.url),
    detail: browserDisplayUrl(entry.url),
    url: entry.url,
  };
}

function tabRow(tab: BrowserTab): BrowserSuggestion {
  return {
    id: `tab:${tab.id}`,
    kind: "tab",
    text: browserDisplayUrl(tab.url),
    title: tab.title || browserDisplayUrl(tab.url),
    detail: browserDisplayUrl(tab.url),
    url: tab.url,
    tabId: tab.id,
  };
}

const MAX_ROWS = 8;

/**
 * The rows under the address field. With no text: the recent history that is not open. With text: the
 * completed or typed address first, then the open tabs and the history that match.
 */
export function browserSuggestions(input: {
  typed: string;
  completion: BrowserHistoryEntry | undefined;
  tabs: readonly BrowserTab[];
  activeTabId: string | undefined;
  history: readonly BrowserHistoryEntry[];
}): BrowserSuggestion[] {
  const query = input.typed.trim();
  const text = query.toLowerCase();
  const openUrls = new Set(input.tabs.map((tab) => tab.url));
  if (!text) {
    return input.history
      .filter((entry) => !openUrls.has(entry.url))
      .slice(0, 6)
      .map(historyRow);
  }

  const matches = (page: { url: string; title: string }) =>
    page.title.toLowerCase().includes(text) || browserDisplayUrl(page.url).toLowerCase().includes(text);
  const rows: BrowserSuggestion[] = [];
  const add = (row: BrowserSuggestion) => {
    if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
  };

  const { completion } = input;
  const completedTab = completion
    ? input.tabs.find((tab) => tab.url === completion.url && tab.id !== input.activeTabId)
    : undefined;
  const address = browserAddressUrl(query);
  if (completedTab) add(tabRow(completedTab));
  else if (completion) add(historyRow(completion));
  else if (address) {
    add({
      id: `url:${address}`,
      kind: "url",
      text: query,
      title: browserDisplayUrl(address),
      detail: undefined,
      url: address,
    });
  }

  for (const tab of input.tabs.filter((tab) => tab.id !== input.activeTabId && tab.url && matches(tab)).slice(0, 3)) {
    add(tabRow(tab));
  }
  for (const entry of input.history.filter((entry) => matches(entry) && !openUrls.has(entry.url)).slice(0, 4)) {
    add(historyRow(entry));
  }
  return rows.slice(0, MAX_ROWS);
}
