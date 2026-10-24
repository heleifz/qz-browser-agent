import { t } from "../../../i18n/index.js";
import {
  CHROME_STORE_REVIEW_STORAGE_KEY,
  CHROME_WEB_STORE_REVIEWS_URL,
  emptyChromeStoreReviewRecord,
  finishChromeStoreReview,
  isChromeWebStoreInstall,
  isReviewCardPending,
  normalizeChromeStoreReviewRecord,
  readChromeWebStoreInstallProbe,
  type BrowserInstallEnvironment,
  type ChromeStoreReviewRecord,
  type InstallProbe,
} from "../../../../shared/chrome-store-review.js";

interface ReviewStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

export interface StoreReviewCardOptions {
  messagesEl: HTMLElement;
  getSessionId(): string;
  hasTranscript(): boolean;
  onPlaced?(): void;
  storage?: ReviewStorage | null;
  listen?: (listener: StorageListener) => () => void;
  probeInstall?: () => Promise<InstallProbe>;
  openReviews?: (url: string) => Promise<void> | void;
  document?: Document;
}

/** Quiet transcript card. It stays on the conversation that finished the second task until the user dismisses it or opens the review page. */
export function createStoreReviewTranscriptCard(options: StoreReviewCardOptions) {
  const storage = options.storage === undefined ? extensionStorage() : options.storage;
  const doc = options.document ?? (typeof document === "undefined" ? null : document);
  if (!storage || !doc || !options.messagesEl) {
    const ready = Promise.resolve();
    return { ready, sync() {}, clear() {}, dispose() {}, idle: () => ready };
  }

  const reviewDocument = doc;
  const reviewStorage = storage;
  const messagesEl = options.messagesEl;
  const listen = options.listen ?? extensionListener;
  const probeInstall = options.probeInstall ?? (() => readChromeWebStoreInstallProbe(extensionInstallEnvironment()));
  const openReviews = options.openReviews ?? defaultOpenReviews;
  let state: ChromeStoreReviewRecord = emptyChromeStoreReviewRecord();
  let loaded = false;
  let revision = 0;
  let install: InstallProbe | null = null;
  let installKnown = false;
  let card: HTMLElement | null = null;
  let pendingAction = false;
  let syncGeneration = 0;
  let actions = Promise.resolve();
  const stopListening = listen((changes, area) => {
    if (area !== "local" || !Object.prototype.hasOwnProperty.call(changes, CHROME_STORE_REVIEW_STORAGE_KEY)) return;
    revision += 1;
    state = normalizeChromeStoreReviewRecord(changes[CHROME_STORE_REVIEW_STORAGE_KEY]?.newValue);
    loaded = true;
    sync();
  });
  const seenRevision = revision;
  const ready = reviewStorage.get(CHROME_STORE_REVIEW_STORAGE_KEY).then(data => {
    if (revision !== seenRevision) return;
    state = normalizeChromeStoreReviewRecord(data[CHROME_STORE_REVIEW_STORAGE_KEY]);
    loaded = true;
    sync();
  }).catch(error => {
    console.warn("[轻舟] Chrome Web Store review prompt could not be read:", error);
    if (revision === seenRevision) {
      state = emptyChromeStoreReviewRecord();
      loaded = true;
    }
    sync();
  });

  function sync() {
    const generation = ++syncGeneration;
    if (!loaded || !isReviewCardPending(state, options.getSessionId(), options.hasTranscript())) {
      clear();
      return;
    }
    if (!installKnown) {
      void probeInstall().then(probe => {
        install = probe;
        installKnown = true;
        if (generation === syncGeneration) sync();
      }).catch(error => {
        console.warn("[轻舟] Chrome Web Store install check failed:", error);
        install = { browser: "other", installType: "", updateUrl: "" };
        installKnown = true;
        if (generation === syncGeneration) sync();
      });
      return;
    }
    if (!isChromeWebStoreInstall(install) || !isReviewCardPending(state, options.getSessionId(), options.hasTranscript())) {
      clear();
      return;
    }
    mount();
  }

  function mount() {
    if (!card || card.parentElement !== messagesEl) {
      card = buildCard();
      messagesEl.appendChild(card);
      options.onPlaced?.();
      return;
    }
    refreshCopy(card);
    if (messagesEl.lastElementChild !== card) {
      messagesEl.appendChild(card);
      options.onPlaced?.();
    }
  }

  function buildCard() {
    const root = reviewDocument.createElement("div");
    root.className = "msg store-review-card";
    root.setAttribute("data-chat-lane", "summary");
    root.setAttribute("data-store-review-card", "");
    root.setAttribute("role", "note");
    const body = reviewDocument.createElement("div");
    body.className = "store-review-card-body";
    const copy = reviewDocument.createElement("p");
    copy.className = "store-review-copy";
    copy.setAttribute("data-store-review-copy", "");
    const actionsRow = reviewDocument.createElement("div");
    actionsRow.className = "store-review-actions";
    const review = reviewDocument.createElement("button");
    review.type = "button";
    review.className = "qz-btn qz-btn--primary qz-btn--sm";
    review.setAttribute("data-store-review-action", "review");
    review.addEventListener("click", () => { void runAction("reviewed"); });
    const dismiss = reviewDocument.createElement("button");
    dismiss.type = "button";
    dismiss.className = "qz-btn qz-btn--ghost qz-btn--sm";
    dismiss.setAttribute("data-store-review-action", "dismiss");
    dismiss.addEventListener("click", () => { void runAction("dismissed"); });
    actionsRow.append(review, dismiss);
    body.append(copy, actionsRow);
    root.append(body);
    refreshCopy(root);
    return root;
  }

  function refreshCopy(root: HTMLElement) {
    const copy = root.querySelector<HTMLElement>("[data-store-review-copy]");
    const review = root.querySelector<HTMLButtonElement>("[data-store-review-action='review']");
    const dismiss = root.querySelector<HTMLButtonElement>("[data-store-review-action='dismiss']");
    const prompt = t("storeReviewPrompt");
    const reviewLabel = t("storeReviewAction");
    const dismissLabel = t("storeReviewDismiss");
    if (copy && copy.textContent !== prompt) copy.textContent = prompt;
    if (review && review.textContent !== reviewLabel) review.textContent = reviewLabel;
    if (dismiss && dismiss.textContent !== dismissLabel) dismiss.textContent = dismissLabel;
  }

  function runAction(resolution: "dismissed" | "reviewed") {
    if (pendingAction || state.status === "done") return;
    pendingAction = true;
    setPending(true);
    const work = (async () => {
      try {
        if (resolution === "reviewed") await openReviews(CHROME_WEB_STORE_REVIEWS_URL);
        const stored = await reviewStorage.get(CHROME_STORE_REVIEW_STORAGE_KEY);
        const next = finishChromeStoreReview(stored[CHROME_STORE_REVIEW_STORAGE_KEY], resolution);
        if (next.changed) await reviewStorage.set({ [CHROME_STORE_REVIEW_STORAGE_KEY]: next.record });
        state = next.record;
        loaded = true;
        sync();
      } catch (error) {
        console.warn("[轻舟] Chrome Web Store review prompt failed:", error);
        setPending(false);
      } finally {
        pendingAction = false;
      }
    })();
    actions = actions.then(() => work, () => work);
  }

  function setPending(pending: boolean) {
    card?.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = pending; });
  }

  function clear() {
    card?.remove();
    card = null;
  }

  function dispose() {
    stopListening();
    clear();
  }

  return {
    ready,
    sync,
    clear,
    dispose,
    idle: () => actions,
  };
}

function extensionStorage(): ReviewStorage | null {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") return null;
  return storage;
}

function extensionListener(listener: StorageListener): () => void {
  const onChanged = globalThis.chrome?.storage?.onChanged;
  if (!onChanged?.addListener || !onChanged.removeListener) return () => {};
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

function extensionInstallEnvironment(): BrowserInstallEnvironment {
  const browser = (globalThis as { browser?: { runtime?: { getBrowserInfo?: unknown } } }).browser;
  const getSelf = globalThis.chrome?.management?.getSelf;
  return {
    protocol: globalThis.location?.protocol,
    userAgent: globalThis.navigator?.userAgent,
    hasGetBrowserInfo: typeof browser?.runtime?.getBrowserInfo === "function",
    getSelf: typeof getSelf === "function" ? () => getSelf() : undefined,
  };
}

async function defaultOpenReviews(url: string) {
  const create = globalThis.chrome?.tabs?.create;
  if (typeof create !== "function") throw new Error("Could not open the Chrome Web Store");
  await create({ url, active: true });
}
