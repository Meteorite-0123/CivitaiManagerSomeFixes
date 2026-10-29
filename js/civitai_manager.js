import { app } from "../../scripts/app.js";
import {
    API,
    ASSET_KINDS,
    CIVITAI_CATEGORY_FILTERS,
    DEFAULT_TARGET_KINDS,
    HIGH_PRIORITY_PREVIEW_LOADS,
    INITIAL_PREVIEW_LOADS,
    MODEL_FILE_FORMAT_OPTIONS,
    MODEL_PERIODS,
    MODEL_STATUS_OPTIONS,
    OTHER_LIBRARY_KIND,
    ROOT_KINDS,
    ROOT_LOCAL_FOLDER,
    SEARCH_PAGE_SIZE,
    TABS,
} from "./civitai/constants.js";
import { apiGet, apiPost, clearSearchCache, fetchModelDetail, getSearchCache, peekModelDetail, setSearchCache, unseenSearchItems } from "./civitai/api.js";
import { animateCardsIn, bindCardMedia, loadMoreSkeletonCount, observeCardMedia, preconnectMediaHosts, renderCardMedia, renderCardSkeletons } from "./civitai/card_media.js";
import { ACTIVE_DOWNLOAD_STATUSES, patchDownloadPage, patchDownloadProgress, renderDownloadPage, renderDownloadProgress, handleDownloadDetailsClick, hydrateDownloadDetails, trackDownloadRates } from "./civitai/downloads.js";
import {
    bindFavoriteFolderSidebar,
    bindSearchCombo,
    ensureNotificationHost,
    renderActiveFilterChips,
    renderCollectionEmptyState,
    renderFavoriteCardMark,
    renderFavoriteControls,
    syncFavoriteControls,
    renderFavoriteFolderSidebar,
    renderPromoLinks,
    syncFavoriteCardMark,
    updateNotificationHost,
} from "./civitai/components.js";
import {
    bindDetailInteractions,
    formatBytes,
    formatStatCount,
    galleryItemsForModel,
    galleryItemsForUrl,
    isDetailDrawerOpen,
    isEarlyAccess,
    modelFacts,
    modelStats,
    renderDescriptionSkeleton,
    renderDetailDismiss,
    renderDetailFacts,
    renderDetailGallery,
    renderDetailSkeleton,
    renderDetailTags,
    renderEarlyAccessNotice,
    renderMatchRow,
    setDetailDrawer,
    setDetailLoading,
    swapDetail,
} from "./civitai/detail.js";
import {
    favoriteEntryForLocal,
    favoriteEntryForRemote,
    favoriteItemForLocal,
    favoriteItemForRemote,
    favoriteModel,
    filterFavoriteItems,
    localAssetForFavorite,
} from "./civitai/favorites.js";
import { fileKey, fileRole, groupVersionFiles, renderFilePicker, representativeFiles, selectionSummary } from "./civitai/file_picker.js";
import {
    IMAGES_KIND,
    imageState,
    loadImageFeed,
    openImageById,
    renderImageDetailAside,
    renderImageDiscover,
    resetImageFeed,
    checkedImageFiles,
    downloadCheckedImageFiles,
    imageResourceKeys,
    imagePeriodValue,
    parseImageLink,
    renderImageCard,
    renderImageFilters,
    resolveImageResources,
    setImageTargets,
} from "./civitai/images.js";
import { t } from "./civitai/i18n.js";
import {
    createPreviewMedia,
    findModelPreviewSource,
    isModelPreviewFiltered,
} from "./civitai/media.js";
import { state } from "./civitai/state.js";
import { injectStyles } from "./civitai/styles.js";
import { injectSelectorStyles } from "./civitai/selector_styles.js";
import { selectorIcon, renderSelectorCombo, renderSelectorSearch, renderSelectorToolbar, renderSelectorSort, renderSelectorStats, animateSelectorFolder, bindSelectorMenus } from "./civitai/selector_ui.js";

let overlay = null;
let bodyEl = null;
let navEl = null;
let notificationHost = null;
let pollTimer = null;
let toastTimer = null;
let searchRequestSeq = 0;
let searchAbortController = null;
let downloadsPollingFast = false;
let themeObserver = null;
let themeSyncQueued = false;
let themeColorProbe = null;
let responsiveSearchTimer = null;
let imageSearchTimer = null;
let pendingResponsiveSearch = false;
let lastResponsiveSearchKey = "";
let lastDownloadNavCount = -1;
let filtersOpen = false;
let returnFocus = null;
let lastModelSelectAt = 0;
// Last markup written by download polling, so unchanged surfaces are left alone.
const liveMarkup = new WeakMap();
const SIDEBAR_TAB_ID = "civitai-manager";
// Discover, Library and Favorites each keep their own detail selection.
const SELECTION_FIELDS = ["selectedModel", "selectedVersionId", "selectedFileName", "selectedFileNames", "fileOverrides", "pathOverrides", "resolution", "selectedAssetId"];
const tabSelections = {};
let libraryMetadataBatch = {
    running: false,
    cancelRequested: false,
    total: 0,
    completed: 0,
    matched: 0,
    notFound: 0,
    failed: 0,
    current: "",
};

app.registerExtension({
    name: "CivitaiManager.extension",
    async setup() {
        injectStyles();
        syncThemeVariables();
        observeThemeChanges();
        registerEntryPoint();
    },
});

function isUsefulThemeColor(value) {
    const color = String(value || "").trim();
    return color
        && color !== "transparent"
        && color !== "none"
        && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(color)
        && !/^rgba?\([^)]*,\s*0\s*\)$/i.test(color);
}

function isVisibleThemeElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity || "1") > 0
        && element.getClientRects().length > 0;
}

function readCssColor(style, names) {
    for (const name of names) {
        const value = style.getPropertyValue(name).trim();
        if (isUsefulThemeColor(value)) return value;
    }
    return "";
}

function resolveThemeRgb(value) {
    if (!isUsefulThemeColor(value)) return null;
    if (!themeColorProbe) {
        themeColorProbe = document.createElement("span");
        themeColorProbe.setAttribute("aria-hidden", "true");
        themeColorProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;";
        document.documentElement.appendChild(themeColorProbe);
    }

    themeColorProbe.style.color = "";
    themeColorProbe.style.color = value;
    if (!themeColorProbe.style.color) return null;

    const resolved = getComputedStyle(themeColorProbe).color;
    const channels = resolved.match(/[\d.]+/g)?.map(Number);
    if (!channels || channels.length < 3) return null;
    if (resolved.startsWith("color(srgb")) {
        return channels.slice(0, 3).map((channel) => channel * 255);
    }
    return channels.slice(0, 3);
}

function themeColorLuminance(value) {
    const rgb = resolveThemeRgb(value);
    if (!rgb) return null;
    const [red, green, blue] = rgb.map((channel) => {
        const srgb = Math.max(0, Math.min(255, channel)) / 255;
        return srgb <= 0.04045
            ? srgb / 12.92
            : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function themeColorHsl(value) {
    const rgb = resolveThemeRgb(value);
    if (!rgb) return null;
    const [red, green, blue] = rgb.map((channel) => Math.max(0, Math.min(255, channel)) / 255);
    const max = Math.max(red, green, blue);
    const chroma = max - Math.min(red, green, blue);
    if (!chroma) return { hue: 0, saturation: 0, chroma };
    const lightness = max - chroma / 2;
    const sector = max === red ? ((green - blue) / chroma + 6) % 6 : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4;
    return { hue: sector * 60, saturation: chroma / (1 - Math.abs(2 * lightness - 1)), chroma };
}

// Palettes have no accent token, so the most saturated palette color carries
// the theme hue; neutral palettes fall back to ComfyUI's primary blue. The
// lightness is fixed per theme so text and filled buttons stay readable.
function themeAccent(style, isLightTheme) {
    let source = null;
    for (const name of ["--border-color", "--interface-panel-selected-surface", "--comfy-menu-secondary-bg", "--content-hover-bg", "--content-bg"]) {
        const hsl = themeColorHsl(style.getPropertyValue(name).trim());
        if (hsl && hsl.chroma >= 0.12 && (!source || hsl.chroma > source.chroma)) source = hsl;
    }
    source ||= themeColorHsl(readCssColor(style, ["--primary-background", "--p-primary-color"]));
    if (!source) return {};
    const hue = Math.round(source.hue);
    const saturation = Math.round(Math.min(Math.max(source.saturation, 0.35), 0.6) * 100);
    return {
        text: `hsl(${hue} ${saturation}% ${isLightTheme ? 38 : 70}%)`,
        fill: `hsl(${hue} ${saturation}% ${isLightTheme ? 42 : 44}%)`,
    };
}

function firstVisibleElement(selectors) {
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            if (isVisibleThemeElement(element)) return element;
        }
    }
    return null;
}

function readElementColor(elementOrSelectors, property, fallback = "") {
    const element = Array.isArray(elementOrSelectors) ? firstVisibleElement(elementOrSelectors) : elementOrSelectors;
    if (!element || !(element instanceof HTMLElement)) return fallback;
    const value = getComputedStyle(element)[property];
    return isUsefulThemeColor(value) ? value : fallback;
}

function readBorderColor(element) {
    if (!element || !(element instanceof HTMLElement)) return "";
    const style = getComputedStyle(element);
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
        const width = Number.parseFloat(style[`border${side}Width`] || "0");
        const borderStyle = style[`border${side}Style`];
        const color = style[`border${side}Color`];
        if (width > 0 && borderStyle !== "none" && borderStyle !== "hidden" && isUsefulThemeColor(color)) {
            return color;
        }
    }
    return "";
}

function findThemeMenuContainer() {
    if (app?.ui?.menuContainer instanceof HTMLElement) {
        return app.ui.menuContainer;
    }
    return firstVisibleElement([
        "#comfy-menu",
        ".comfy-menu",
        ".comfyui-menu",
        ".comfyui-body-topbar",
        ".comfyui-workspace-bar",
        ".comfyui-topbar",
        ".comfyui-toolbar",
        ".comfyui-menu-right",
        "[data-testid='topbar']",
        "[role='toolbar']",
        ".p-toolbar",
        ".topbar",
        ".p-menubar",
    ]);
}

function setRootVariable(name, value) {
    const root = document.documentElement;
    const current = root.style.getPropertyValue(name).trim();
    if (isUsefulThemeColor(value)) {
        if (current !== value) root.style.setProperty(name, value);
    } else if (current) {
        root.style.removeProperty(name);
    }
}

function syncThemeVariables() {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = document.body ? getComputedStyle(document.body) : rootStyle;
    const menu = findThemeMenuContainer();
    const controlElement = firstVisibleElement([
        ".comfy-menu input",
        ".comfy-menu select",
        ".comfy-menu button",
        ".comfyui-menu input",
        ".comfyui-menu select",
        ".comfyui-menu button",
        ".comfyui-input",
        ".comfyui-button",
        ".p-form-field",
        ".p-inputtext",
        ".p-select",
        ".p-button",
    ]);

    const panelBg = readElementColor(menu, "backgroundColor")
        || readCssColor(rootStyle, ["--comfy-menu-bg", "--p-content-background", "--bg-color"])
        || readElementColor(document.body, "backgroundColor")
        || bodyStyle.backgroundColor;
    const cardBg = readCssColor(rootStyle, [
        "--comfy-input-bg",
        "--p-form-field-background",
        "--component-node-widget-background",
        "--secondary-background",
    ]) || readElementColor(menu, "backgroundColor") || panelBg;
    const controlBg = cardBg;
    const borderColor = readBorderColor(controlElement)
        || readBorderColor(menu)
        || readCssColor(rootStyle, ["--border-color", "--p-content-border-color", "--p-button-secondary-border-color"]);
    const textColor = readElementColor(menu, "color")
        || readCssColor(rootStyle, ["--fg-color", "--input-text", "--p-text-color"])
        || bodyStyle.color;
    const mutedColor = readCssColor(rootStyle, ["--descrip-text", "--p-text-muted-color", "--muted-foreground"]);
    const panelLuminance = themeColorLuminance(panelBg);
    const isLightTheme = panelLuminance !== null && panelLuminance >= 0.5;
    const readableTextColor = panelLuminance === null
        ? textColor
        : (isLightTheme ? "#18181b" : "#e4e4e7");
    const readableMutedColor = panelLuminance === null
        ? mutedColor
        : (isLightTheme ? "#52525b" : "#b8bec7");
    const accent = themeAccent(rootStyle, isLightTheme);

    setRootVariable("--cmgr-sampled-accent", accent.text);
    setRootVariable("--cmgr-sampled-primary", accent.fill);
    setRootVariable("--cmgr-sampled-panel-bg", panelBg);
    setRootVariable("--cmgr-sampled-card-bg", cardBg);
    setRootVariable("--cmgr-sampled-control-bg", controlBg);
    setRootVariable("--cmgr-sampled-border-color", borderColor);
    setRootVariable("--cmgr-sampled-text-color", readableTextColor);
    setRootVariable("--cmgr-sampled-muted-color", readableMutedColor);

    setRootVariable("--cmgr-sampled-bg", panelBg);
    setRootVariable("--cmgr-sampled-panel", panelBg);
    setRootVariable("--cmgr-sampled-card", cardBg);
    setRootVariable("--cmgr-sampled-control", controlBg);
    setRootVariable("--cmgr-sampled-border", borderColor);
    setRootVariable("--cmgr-sampled-text", readableTextColor);
    setRootVariable("--cmgr-sampled-muted", readableMutedColor);
}

function queueThemeSync() {
    if (themeSyncQueued) return;
    themeSyncQueued = true;
    requestAnimationFrame(() => {
        themeSyncQueued = false;
        syncThemeVariables();
    });
}

function observeThemeChanges() {
    if (themeObserver) {
        queueThemeSync();
        return;
    }
    themeObserver = new MutationObserver(() => queueThemeSync());
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-color-mode"],
    });
    if (document.body) {
        themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ["class", "style", "data-theme", "data-color-mode"],
        });
    }
    if (document.head) {
        themeObserver.observe(document.head, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ["class", "style", "href"],
        });
    }
    window.addEventListener("focus", queueThemeSync);
    queueThemeSync();
}

function registerEntryPoint() {
    const registerSidebarTab = app?.extensionManager?.registerSidebarTab;
    if (typeof registerSidebarTab === "function") {
        try {
            registerSidebarTab.call(app.extensionManager, {
                id: SIDEBAR_TAB_ID,
                icon: "pi pi-box",
                title: "Civitai",
                tooltip: "Civitai",
                type: "custom",
                render: renderSidebarLauncher,
            });
            bindSidebarLauncher();
            document.querySelector(".cmgr-left-entry")?.remove();
            return;
        } catch (error) {
            console.warn("[CivitaiManager] Failed to register the ComfyUI sidebar entry; using the legacy launcher.", error);
        }
    }
    createFallbackLeftButton();
}

// The sidebar tab is only a launcher: selecting it opens the manager at once
// and puts back whichever panel was open before, so its panel never shows.
function bindSidebarLauncher() {
    const sidebar = app.extensionManager.sidebarTab;
    if (typeof sidebar?.$subscribe !== "function") return;
    let previous = sidebar.activeSidebarTabId;
    sidebar.$subscribe(() => {
        const active = sidebar.activeSidebarTabId;
        if (active !== SIDEBAR_TAB_ID) {
            previous = active;
            return;
        }
        sidebar.activeSidebarTabId = previous;
        openOverlay();
    }, { flush: "sync" });
}

function renderSidebarLauncher(element) {
    element.innerHTML = `
        <div class="cmgr-sidebar-launcher">
            <div class="cmgr-sidebar-launcher-icon" aria-hidden="true"><i class="pi pi-box"></i></div>
            <h3>${escapeHtml(t("CivitaiManager"))}</h3>
            <p>${escapeHtml(t("Browse, download, and organize Checkpoints, UNet, LoRA, and Workflows from Civitai."))}</p>
            <button class="cmgr-primary" type="button" data-action="open-civitai-manager">${escapeHtml(t("Open CivitaiManager"))}</button>
        </div>
    `;
    element.querySelector('[data-action="open-civitai-manager"]')?.addEventListener("click", () => openOverlay());
}

function createFallbackLeftButton() {
    if (document.querySelector(".cmgr-left-entry")) return;
    const btn = document.createElement("button");
    btn.className = "cmgr-left-entry";
    btn.type = "button";
    btn.title = t("CivitaiManager");
    btn.textContent = "Civitai";
    btn.onclick = () => openOverlay();
    document.body.appendChild(btn);
}

function openOverlay() {
    returnFocus = document.activeElement;
    if (overlay) {
        overlay.classList.add("show");
        render();
        return;
    }
    injectSelectorStyles();
    preconnectMediaHosts();
    filtersOpen = window.matchMedia("(min-width: 1180px)").matches;
    overlay = document.createElement("div");
    overlay.className = "cmgr-overlay cmgr-selector-overlay show";
    overlay.innerHTML = `
        <div class="cmgr-shell cmgr-selector-shell" role="dialog" aria-modal="true" aria-label="${escapeAttr(t("CivitaiManager"))}">
            <div class="cmgr-topbar cmgr-selector-topbar">
                <div class="cmgr-selector-heading">
                    ${selectorIcon("layers")}
                    <div class="cmgr-title">${escapeHtml(t("CivitaiManager"))}</div>
                </div>
                <div class="cmgr-topbar-actions">
                    <button class="cmgr-selector-filter-toggle" type="button" data-action="toggle-manager-filters" aria-label="${escapeAttr(t("Adjust filters"))}" aria-controls="cmgr-manager-filters">${selectorIcon("panel")}<span>${escapeHtml(t("Adjust filters"))}</span></button>
                    <button class="cmgr-selector-close" type="button" data-action="close" aria-label="${escapeAttr(t("Close"))}" title="${escapeAttr(t("Close"))} (Esc)">${selectorIcon("close")}</button>
                </div>
            </div>
            <div class="cmgr-selector-workspace">
                <nav class="cmgr-selector-tabs" role="tablist" aria-orientation="vertical" aria-label="${escapeAttr(t("Views"))}"></nav>
                <div class="cmgr-layout cmgr-selector-layout">
                    <button class="cmgr-selector-filter-backdrop" type="button" aria-label="${escapeAttr(t("Close"))}"></button>
                    <aside class="cmgr-nav cmgr-selector-nav" id="cmgr-manager-filters" aria-label="${escapeAttr(t("Adjust filters"))}"></aside>
                    <main class="cmgr-body cmgr-selector-body" id="cmgr-manager-content" role="tabpanel"></main>
                </div>
            </div>
            <footer class="cmgr-selector-footer">
                <button class="cmgr-selector-node-status" type="button" data-action="view-library"></button>
                <div>${renderPromoLinks()}<span class="cmgr-selector-escape"><kbd>Esc</kbd> ${escapeHtml(t("Close"))}</span></div>
            </footer>
        </div>
    `;
    document.body.appendChild(overlay);
    navEl = overlay.querySelector(".cmgr-nav");
    bodyEl = overlay.querySelector(".cmgr-body");
    notificationHost = ensureNotificationHost(overlay.querySelector(".cmgr-shell"));
    overlay.querySelector('[data-action="close"]').onclick = closeOverlay;
    overlay.querySelector('[data-action="toggle-manager-filters"]').onclick = () => setManagerFiltersOpen(!filtersOpen);
    overlay.querySelector('.cmgr-selector-filter-backdrop').onclick = () => setManagerFiltersOpen(false);
    overlay.querySelector('[data-action="view-library"]').onclick = () => switchManagerTab("Library");
    const handleKey = (event) => {
        if (!overlay.classList.contains("show")) return;
        event.stopPropagation();
        if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            const menu = overlay.querySelector(".cmgr-selector-tools[open]");
            if (menu) {
                menu.open = false;
                menu.querySelector("summary").focus();
            } else if (isDetailDrawerOpen(overlay)) {
                state.detailOpen = false;
                setDetailDrawer(overlay, false);
                overlay.querySelector(".cmgr-card.selected")?.focus({ preventScroll: true });
            } else if (filtersOpen && window.matchMedia("(max-width: 1179px)").matches) setManagerFiltersOpen(false);
            else closeOverlay();
        }
        if (event.key !== "Tab") return;
        const controls = [...overlay.querySelectorAll('button, summary, input, select, textarea, a[href], [tabindex="0"]')]
            .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
        if (!overlay.contains(document.activeElement) || document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
            event.preventDefault();
            (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
    };
    overlay.addEventListener("keydown", handleKey);
    document.addEventListener("keydown", handleKey);
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeOverlay();
    });
    bindDetailInteractions(overlay, { onCloseDetail: () => { state.detailOpen = false; } });
    bindCardMedia(overlay);
    state.mounted = true;
    hydrateInitialData();
    render();
    overlay.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    startPolling();
}

function closeOverlay() {
    overlay.querySelectorAll("video").forEach((video) => video.pause());
    overlay.classList.remove("show");
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function setManagerFiltersOpen(open) {
    filtersOpen = open;
    overlay.querySelector('.cmgr-selector-layout').classList.toggle("filters-open", open);
    const button = overlay.querySelector('[data-action="toggle-manager-filters"]');
    button.setAttribute("aria-expanded", String(open));
    if (!open && navEl.contains(document.activeElement)) button.focus({ preventScroll: true });
}

function switchManagerTab(tab) {
    if (tab !== state.activeTab) {
        tabSelections[state.activeTab] = Object.fromEntries(SELECTION_FIELDS.map((field) => [field, state[field]]));
        Object.assign(state, tabSelections[tab] || {
            selectedModel: null,
            selectedVersionId: "",
            selectedFileName: "",
            selectedFileNames: [],
            fileOverrides: {},
            pathOverrides: {},
            resolution: null,
            selectedAssetId: "",
        });
        state.detailOpen = false;
        state.resolvingPath = false;
    }
    state.activeTab = tab;
    // The image feed only exists in Discover; other tabs need a real model kind.
    if (tab !== "Discover" && state.assetKind === IMAGES_KIND) state.assetKind = "lora";
    const needsPath = ["Discover", "Favorites"].includes(tab) && state.selectedModel && !state.resolution;
    if (tab === "Library") void loadLibrary();
    if (tab === "Favorites") void loadFavorites(true);
    if (tab === "Downloads") void loadDownloads();
    if (tab === "Discover") {
        if (state.assetKind === IMAGES_KIND) {
            if (!imageState.items.length) void loadImageFeed({ reset: true }).then(() => render());
        } else {
            void loadTaxonomy(state.assetKind, { silent: true });
            if (!state.searchItems.length) void search(true, { silent: true });
            else if (!state.selectedModel) void selectModel(state.searchItems[0]);
        }
    }
    render();
    if (needsPath) void resolveSelectedPath({ detailOnly: true, pathOnly: true });
}

async function hydrateInitialData() {
    const tasks = [loadConfig(), loadLibrary(), loadFavorites(false), loadDownloads(false), loadTaxonomy(state.assetKind, { silent: true })];
    if (state.activeTab === "Discover" && state.assetKind === IMAGES_KIND && imageState.items.length === 0) {
        tasks.push(loadImageFeed({ reset: true }).then(() => {
            if (state.activeTab === "Discover" && state.assetKind === IMAGES_KIND) render();
        }));
    } else if (state.activeTab === "Discover" && state.searchItems.length === 0 && !state.loadingSearch) {
        tasks.push(search(true, { silent: true }));
    }
    const results = await Promise.allSettled(tasks);
    results.forEach((result) => {
        if (result.status === "rejected") {
            console.error("[CivitaiManager] Initial data task failed:", result.reason);
        }
    });
}

function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
        if (!overlay?.classList.contains("show")) return;
        loadDownloads(false);
    }, 1500);
}

function tuneDownloadPolling() {
    const hasActive = activeDownloadCount() > 0;
    if (hasActive === downloadsPollingFast && pollTimer) return;
    downloadsPollingFast = hasActive;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    pollTimer = setInterval(() => {
        if (!overlay?.classList.contains("show")) return;
        loadDownloads(false);
    }, hasActive ? 500 : 1500);
}

function normalizeTaxonomy(data = {}) {
    const toItems = (value) => (Array.isArray(value) ? value : [])
        .map((item) => ({
            name: String(item?.name || "Other"),
            count: Number(item?.count || 0),
        }))
        .filter((item) => item.name);
    return {
        kind: data.kind || state.assetKind,
        categories: toItems(data.categories),
        baseModels: toItems(data.baseModels),
        modelTypes: toItems(data.modelTypes),
        tags: toItems(data.tags),
        updated_at: data.updated_at || 0,
        warning: data.warning || "",
    };
}

function mergeTaxonomy(kind, data) {
    if (!data || typeof data !== "object") return;
    const normalized = normalizeTaxonomy({ ...data, kind });
    state.taxonomyByKind = {
        ...state.taxonomyByKind,
        [kind]: normalized,
    };
}

function currentTaxonomy() {
    return normalizeTaxonomy(state.taxonomyByKind[state.assetKind] || { kind: state.assetKind });
}

function applyFavoriteStore(data = {}) {
    state.favoriteItems = Array.isArray(data.items) ? data.items : [];
    state.favoriteFolders = Array.isArray(data.folders) ? data.folders : [];
    if (state.selectedFavoriteKey && !state.favoriteItems.some((item) => item.key === state.selectedFavoriteKey)) {
        state.selectedFavoriteKey = "";
    }
    if (state.selectedFavoriteFolderId
        && !state.favoriteFolders.some((folder) => folder.id === state.selectedFavoriteFolderId)) {
        state.selectedFavoriteFolderId = "";
    }
}

async function loadFavorites(shouldRender = true) {
    state.favoritesLoading = true;
    try {
        applyFavoriteStore(await apiGet("/favorites"));
    } catch (err) {
        state.error = err.message;
    }
    state.favoritesLoading = false;
    if (!overlay?.classList.contains("show")) return;
    if (shouldRender) {
        render();
        return;
    }
    refreshNav();
    syncVisibleFavoriteCardMarks();
    if (state.activeTab === "Discover" && state.selectedModel) renderSelectedModelDetail();
    if (state.activeTab === "Library" && state.selectedAssetId) renderSelectedAssetDetail();
}

function selectedFavorite() {
    return state.favoriteItems.find((item) => item.key === state.selectedFavoriteKey) || null;
}

// A favorite keeps its own asset kind; Discover's kind tabs must not change.
function detailAssetKind() {
    return state.activeTab === "Favorites" ? selectedFavorite()?.asset_kind || state.assetKind : state.assetKind;
}

function remoteFavorite(model = state.selectedModel, assetKind = detailAssetKind()) {
    return favoriteEntryForRemote(state.favoriteItems, model, assetKind);
}

function localFavorite(asset = getSelectedAsset()) {
    return favoriteEntryForLocal(state.favoriteItems, asset, state.assetKind);
}

function syncVisibleFavoriteCardMarks() {
    if (!bodyEl) return;
    if (state.activeTab === "Discover") {
        bodyEl.querySelectorAll("[data-model-id]").forEach((card) => {
            const model = state.searchItems.find((item) => String(item.id || "") === String(card.dataset.modelId || ""));
            syncFavoriteCardMark(card, Boolean(model && remoteFavorite(model, state.assetKind)));
        });
    }
    if (state.activeTab === "Library") {
        bodyEl.querySelectorAll("[data-asset-id]").forEach((card) => {
            const asset = state.libraryItems.find((item) => String(item.id || "") === String(card.dataset.assetId || ""));
            syncFavoriteCardMark(card, Boolean(asset && localFavorite(asset)));
        });
    }
}

function refreshFavoriteSurface() {
    refreshNav();
    syncVisibleFavoriteCardMarks();
    if (state.activeTab === "Discover") {
        const favorite = remoteFavorite();
        syncFavoriteControls(bodyEl, Boolean(favorite), favorite?.folder_id);
        return;
    }
    if (state.activeTab === "Library") {
        const favorite = localFavorite();
        syncFavoriteControls(bodyEl, Boolean(favorite), favorite?.folder_id);
        return;
    }
    render();
}

async function setFavoriteItem(item, favorite, folderId) {
    const payload = { item, favorite };
    if (folderId !== undefined) payload.folder_id = folderId;
    const data = await apiPost("/favorites/item", payload);
    applyFavoriteStore(data);
    return data;
}

async function toggleRemoteFavorite(model = state.selectedModel, assetKind = detailAssetKind()) {
    if (!model) return;
    const existing = remoteFavorite(model, assetKind);
    try {
        await setFavoriteItem(existing || favoriteItemForRemote(model, assetKind), !existing);
        showToast(t(existing ? "Removed favorite" : "Marked favorite"));
        refreshFavoriteSurface();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function toggleLocalFavorite(asset = getSelectedAsset()) {
    if (!asset) return;
    const existing = localFavorite(asset);
    try {
        await setFavoriteItem(existing || favoriteItemForLocal(asset, state.assetKind), !existing);
        showToast(t(existing ? "Removed favorite" : "Marked favorite"));
        refreshFavoriteSurface();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function assignFavoriteFolder(item, folderId) {
    if (!item) return;
    try {
        await setFavoriteItem(item, true, folderId || "");
        showToast(t("Favorite moved"));
        refreshFavoriteSurface();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function saveFavoriteFolder(editor) {
    const name = String(editor?.value || "").trim();
    if (!name) return;
    try {
        const data = await apiPost("/favorites/folder", {
            action: editor.mode === "rename" ? "rename" : "create",
            folder_id: editor.id || "",
            name,
        });
        applyFavoriteStore(data);
        state.favoriteFolderEditor = null;
        showToast(t(editor.mode === "rename" ? "Favorite folder renamed" : "Favorite folder created"));
        render();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function deleteFavoriteFolder(folderId) {
    if (!folderId || !confirm(t("Delete this favorite folder? Its items will remain in All Favorites without a folder."))) return;
    try {
        applyFavoriteStore(await apiPost("/favorites/folder", { action: "delete", folder_id: folderId }));
        state.favoriteFolderEditor = null;
        showToast(t("Favorite folder deleted"));
        render();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function loadConfig() {
    try {
        state.config = await apiGet("/config");
    } catch (err) {
        console.warn("[CivitaiManager] Failed to load config:", err);
    }
    if (state.activeTab === "Settings") render();
}

async function loadTaxonomy(kind = state.assetKind, options = {}) {
    const silent = options.silent === true;
    const force = options.force === true;
    state.taxonomyLoading = true;
    if (!silent) render();
    try {
        const data = await apiGet(`/taxonomy?kind=${encodeURIComponent(kind)}${force ? "&force=true" : ""}`);
        mergeTaxonomy(kind, data);
    } catch (err) {
        console.warn("[CivitaiManager] Failed to load taxonomy:", err);
    }
    state.taxonomyLoading = false;
    if (silent) {
        if (kind === state.assetKind && ["Discover", "Library"].includes(state.activeTab)) refreshNav();
    } else {
        render();
    }
}

function setSettingsSaveState(root, saving) {
    const button = root?.querySelector?.('[data-action="save-settings"]');
    if (!button) return;
    button.disabled = saving;
    button.setAttribute("aria-busy", saving ? "true" : "false");
    button.textContent = t(saving ? "Saving..." : "Save Settings");
}

async function saveSettings(form, root = bodyEl) {
    if (state.settingsSaving) return;
    state.settingsSaving = true;
    state.error = "";
    updateTransientMessages();
    setSettingsSaveState(root, true);
    try {
        const payload = {
            allow_nsfw: form.allow_nsfw,
            workflow_dir: form.workflow_dir,
            save_metadata: form.save_metadata,
            save_preview: form.save_preview,
        };
        if (String(form.civitai_api_key || "").trim()) {
            payload.civitai_api_key = String(form.civitai_api_key || "").trim();
        }
        const data = await apiPost("/config", payload);
        state.config = data.config;
        clearSearchCache();
        state.settingsSaving = false;
        render();
        showToast(t("Settings saved"));
        void loadTaxonomy(state.assetKind, { silent: true, force: true });
    } catch (err) {
        state.error = err.message;
        state.settingsSaving = false;
        setSettingsSaveState(root, false);
        updateTransientMessages();
    }
}

async function clearApiKey() {
    try {
        const data = await apiPost("/config", { civitai_api_key: "" });
        state.config = data.config;
        clearSearchCache();
        await loadTaxonomy(state.assetKind, { silent: true, force: true });
        showToast(t("API key cleared"));
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function testApiConnection() {
    state.apiTesting = true;
    render();
    try {
        const data = await apiGet("/test-api");
        if (data.success) {
            showToast(t(data.api_key_set ? "Civitai connected with saved API key" : "Civitai connected"));
        } else {
            state.error = data.error || t("Civitai test failed");
        }
    } catch (err) {
        state.error = err.message;
    }
    state.apiTesting = false;
    render();
}

async function search(reset = true, options = {}) {
    const silent = options.silent === true;
    const forceRefresh = options.forceRefresh === true;
    if (!reset && state.loadingSearch) return;
    if (reset) cancelActiveSearch();
    const params = new URLSearchParams({
        kind: state.assetKind,
        query: state.query,
        sort: state.sort,
        limit: String(SEARCH_PAGE_SIZE),
    });
    if (state.selectedBaseModels.length) params.set("base_model", state.selectedBaseModels.join(","));
    if (state.selectedTag) params.set("tag", state.selectedTag);
    if (state.selectedCivitaiCategory) params.set("category", state.selectedCivitaiCategory);
    if (state.period && state.period !== "AllTime") params.set("period", state.period);
    if (state.fileFormats.length) params.set("file_format", state.fileFormats.join(","));
    if (state.modelStatuses.length) params.set("model_status", state.modelStatuses.join(","));
    if (!reset && state.nextCursor) params.set("cursor", state.nextCursor);
    const requestPath = `/search?${params.toString()}`;
    const cached = forceRefresh ? null : getSearchCache(requestPath);
    const requestSeq = ++searchRequestSeq;

    if (!silent) state.error = "";
    if (cached) {
        const appended = applySearchData(cached, reset, silent);
        if (requestSeq !== searchRequestSeq) return;
        if (appended) return;
        finishSearchRender(reset);
        return;
    }

    const abortController = new AbortController();
    searchAbortController = abortController;
    state.loadingSearch = true;
    if (reset) resetSearchResults();
    if (reset) render({ preserveScroll: false });
    else setDiscoverLoadStatus(true);
    try {
        const data = await apiGet(requestPath, { signal: abortController.signal });
        setSearchCache(requestPath, data);
        if (requestSeq !== searchRequestSeq) {
            return;
        }
        if (applySearchData(data, reset, silent)) return;
    } catch (err) {
        if (err?.name === "AbortError" || requestSeq !== searchRequestSeq) {
            return;
        }
        if (!silent) {
            state.error = err.message;
        } else {
            console.warn("[CivitaiManager] Initial search failed:", err);
        }
    } finally {
        if (searchAbortController === abortController) {
            searchAbortController = null;
        }
    }
    if (requestSeq !== searchRequestSeq) {
        return;
    }
    finishSearchRender(reset);
}

function resetSearchResults() {
    state.cursor = "";
    state.nextCursor = "";
    state.searchItems = [];
    if (state.activeTab === "Discover") state.selectedModel = null;
    else delete tabSelections.Discover;
    state.scroll.discoverResults = 0;
}

function applySearchData(data, reset, silent) {
    const nextItems = unseenSearchItems(reset ? [] : state.searchItems, data?.items);
    const startIndex = state.searchItems.length;
    state.searchItems = reset ? nextItems : [...state.searchItems, ...nextItems];
    state.contentFilterActive = data?.content_filter_active === true;
    if (reset) {
        if (state.activeTab === "Discover") state.selectedModel = null;
        else delete tabSelections.Discover;
        state.scroll.discoverResults = 0;
    }
    // A page that adds nothing new ends the list instead of loading forever.
    state.nextCursor = reset || nextItems.length ? data?.metadata?.nextCursor || "" : "";
    // A thin page means the rest is a slow, mostly empty scan (e.g. a keyword
    // inside a base model): keep searching behind a progress bar instead of
    // placeholder cards that may never be filled.
    state.sparseResults = nextItems.length < SEARCH_PAGE_SIZE / 2;
    state.cursor = state.nextCursor;
    if (data?.taxonomy) mergeTaxonomy(state.assetKind, data.taxonomy);
    if (data?.warning && !silent && !nextItems.length) {
        state.error = data.warning;
    }
    if (!reset && state.activeTab === "Discover" && appendDiscoverItems(nextItems, startIndex)) {
        state.loadingSearch = false;
        state.autoLoadingMore = false;
        setDiscoverLoadStatus(false);
        maybeAutoLoadMore(bodyEl.querySelector(".cmgr-discover .cmgr-results"));
        return true;
    }
    return false;
}

function finishSearchRender(reset) {
    state.loadingSearch = false;
    state.autoLoadingMore = false;
    const autoPick = reset && state.activeTab === "Discover" && !state.selectedModel ? state.searchItems[0] : null;
    if (autoPick) {
        state.selectedModel = autoPick;
        state.pathOverrides = {};
        state.resolution = null;
        const firstVersion = getVersions(autoPick)[0] || {};
        state.selectedVersionId = String(firstVersion.id || "");
        state.selectedFileName = defaultFileName(firstVersion);
        resetFileSelection(firstVersion, state.selectedFileName);
    }
    render({ preserveScroll: !reset });
    if (reset && state.activeTab === "Discover") animateCardsIn(bodyEl.querySelectorAll(".cmgr-discover .cmgr-results > .cmgr-card[data-model-id]"));
    if (autoPick) {
        void selectModel(autoPick);
    }
    if (state.activeTab === "Discover") maybeAutoLoadMore(bodyEl.querySelector(".cmgr-discover .cmgr-results"));
    if (pendingResponsiveSearch && state.activeTab === "Discover") {
        pendingResponsiveSearch = false;
        scheduleResponsiveSearch(true);
    }
}

function cancelActiveSearch() {
    searchRequestSeq++;
    searchAbortController?.abort();
    searchAbortController = null;
    state.loadingSearch = false;
    state.autoLoadingMore = false;
}

function currentSearchSignature() {
    return [
        state.assetKind,
        state.query,
        state.sort,
        state.selectedBaseModels.join(","),
        state.selectedTag,
        state.selectedCivitaiCategory,
        state.period,
        state.fileFormats.join(","),
        state.modelStatuses.join(","),
    ].map((item) => String(item || "").trim()).join("\u001f");
}

function scheduleResponsiveSearch(immediate = false) {
    if (responsiveSearchTimer) {
        clearTimeout(responsiveSearchTimer);
        responsiveSearchTimer = null;
    }
    responsiveSearchTimer = setTimeout(() => {
        responsiveSearchTimer = null;
        if (state.activeTab !== "Discover") return;
        const signature = currentSearchSignature();
        if (signature === lastResponsiveSearchKey && !pendingResponsiveSearch) return;
        pendingResponsiveSearch = false;
        lastResponsiveSearchKey = signature;
        search(true, { silent: true });
    }, immediate ? 0 : 300);
}

function setDiscoverLoadStatus(visible) {
    if (state.activeTab !== "Discover" || !bodyEl) return;
    const results = bodyEl.querySelector(".cmgr-discover .cmgr-results");
    if (!results) return;
    results.querySelectorAll(".cmgr-load-more-skeleton").forEach((item) => item.remove());
    results.parentElement.classList.toggle("is-searching-more", visible && state.sparseResults);
    if (visible && !state.sparseResults) {
        results.insertAdjacentHTML("beforeend", renderCardSkeletons(loadMoreSkeletonCount(results), { loadMore: true }));
    }
}

function appendDiscoverItems(items, startIndex = 0) {
    const results = bodyEl?.querySelector(".cmgr-discover .cmgr-results");
    if (!results) return false;
    results.querySelectorAll(".cmgr-load-more-skeleton").forEach((item) => item.remove());
    if (!items.length) return true;
    results.insertAdjacentHTML("beforeend", items.map((model, index) => renderModelCard(model, startIndex + index)).join(""));
    animateCardsIn([...results.querySelectorAll(":scope > .cmgr-card[data-model-id]")].slice(startIndex));
    bindDiscoverEvents(bodyEl);
    observeCardMedia(results);
    return true;
}

async function selectModel(model) {
    const isCurrent = () => state.activeTab === "Discover" && String(state.selectedModel?.id || "") === String(model.id || "");
    const prefetched = peekModelDetail(model.id);
    state.selectedModel = prefetched || model;
    state.pathOverrides = {};
    state.resolution = null;
    const firstVersion = getVersions()[0] || {};
    state.selectedVersionId = String(firstVersion.id || "");
    state.selectedFileName = defaultFileName(firstVersion);
    resetFileSelection(firstVersion, state.selectedFileName);
    renderSelectedModelDetail();
    // Arrow-key browsing selects in quick succession; only fetch where it settles.
    const rapid = performance.now() - lastModelSelectAt < 350;
    lastModelSelectAt = performance.now();
    if (!prefetched) {
        setDetailLoading(bodyEl, true);
        if (rapid) await new Promise((resolve) => setTimeout(resolve, 250));
        if (!isCurrent()) return;
        try {
            const full = await fetchModelDetail(model.id);
            if (!isCurrent()) return;
            if (full) {
                state.selectedModel = full;
                state.selectedVersionId = String(getSelectedVersion()?.id || "");
                state.selectedFileName = String(getSelectedFile()?.name || "");
                resetFileSelection(getSelectedVersion(), state.selectedFileName);
                renderSelectedModelDetail();
            }
        } catch (_) {
            // Search results are enough for path resolution in the common case.
        }
        if (!isCurrent()) return;
        setDetailLoading(bodyEl, false);
    }
    await resolveSelectedPath({ detailOnly: true, pathOnly: true });
}

function getVersions(model = state.selectedModel) {
    return Array.isArray(model?.modelVersions) ? model.modelVersions : [];
}

function getSelectedVersion() {
    const versions = getVersions();
    return versions.find((version) => String(version.id) === String(state.selectedVersionId)) || versions[0] || null;
}

function getFiles(version = getSelectedVersion()) {
    return Array.isArray(version?.files) ? version.files : [];
}

function getSelectedFile() {
    const files = getFiles();
    return files.find((file) => String(file.name || file.id) === String(state.selectedFileName)) || files[0] || {};
}

/** First real model file, never a text encoder or VAE component. */
function defaultFileName(version = getSelectedVersion()) {
    const files = getFiles(version);
    const { main } = groupVersionFiles(files, { includeComponents: detailAssetKind() === "checkpoint" });
    const file = main.find((item) => item.primary) || main[0] || files[0] || {};
    return String(file.name || file.id || "");
}

/** Last known target-folder resolution for every file of a version. */
function fileResolutionCache(version = getSelectedVersion()) {
    const versionKey = String(version?.id || "");
    if (!versionKey) return {};
    if (!state.fileResolutions) state.fileResolutions = {};
    if (!state.fileResolutions[versionKey]) state.fileResolutions[versionKey] = {};
    return state.fileResolutions[versionKey];
}

function fileResolutionFor(file, version = getSelectedVersion()) {
    const key = fileKey(file);
    return key ? fileResolutionCache(version)[key] || null : null;
}

/**
 * Folder shown for a file row: the user's own pick first, then the folder the
 * backend resolved for it, and finally a role-based guess while it loads.
 */
function fileTargetRootKind(file, role = "", version = getSelectedVersion()) {
    const key = fileKey(file);
    const override = key ? state.fileOverrides?.[key] : null;
    if (override?.root_kind) return String(override.root_kind);
    const resolution = fileResolutionFor(file, version);
    if (resolution?.root_kind) return String(resolution.root_kind);
    const fileRoleName = role || fileRole(file);
    if (fileRoleName === "text_encoder") return "text_encoders";
    if (fileRoleName === "vae") return "vae";
    if (fileRoleName === "config") return "configs";
    const kind = detailAssetKind();
    if (kind === "lora") return "loras";
    if (kind === "workflow") return "workflows";
    return "checkpoints";
}

function fileTargetOptions() {
    return targetKindOptions();
}

/**
 * Default bulk selection: the main file plus one file per component role, which
 * matches what the old "Download all" button did.
 */
function resetFileSelection(version = getSelectedVersion(), preferredName = state.selectedFileName) {
    const files = getFiles(version);
    const picks = representativeFiles(files, preferredName || defaultFileName(version), {
        includeComponents: detailAssetKind() === "checkpoint",
    });
    state.selectedFileNames = picks.map(fileKey).filter(Boolean);
    state.fileOverrides = {};
}

/** Adds or removes one file from the bulk download selection. */
function setFileChecked(key, checked) {
    if (!key) return;
    const selected = new Set((state.selectedFileNames || []).map(String));
    if (checked) selected.add(String(key));
    else selected.delete(String(key));
    state.selectedFileNames = [...selected];
}

/** The ticked files of the current version, in picker order. */
function selectedVersionFiles(version = getSelectedVersion()) {
    const checked = new Set((state.selectedFileNames || []).map(String));
    return getFiles(version).filter((file) => checked.has(fileKey(file)));
}

function downloadCtaLabel(bytes) {
    return bytes ? t("Download ({size})", { size: formatBytes(bytes) }) : t("Download Now");
}

/**
 * The main download button shows the combined size of the ticked files, so
 * adding a text encoder or VAE visibly raises the number before downloading.
 */
function syncDownloadCta(root = bodyEl) {
    const cta = root?.querySelector?.("[data-download-selection]");
    if (!cta) return;
    const picks = selectedVersionFiles();
    const focused = getSelectedFile() || {};
    const bytes = picks.length
        ? picks.reduce((sum, file) => sum + Number(file.sizeKB || 0) * 1024, 0)
        : Number(focused.sizeKB || 0) * 1024;
    const label = cta.querySelector(".cmgr-download-cta-label");
    if (label) {
        label.textContent = downloadCtaLabel(bytes);
        cta.title = picks.length > 1 ? t("{count} files selected", { count: picks.length }) : "";
    }
    cta.disabled = !state.resolution?.download_url;
}

/** Keeps checkboxes, the "select all" label and the download size in sync. */
function syncFilePickerSelection(root = bodyEl) {
    syncDownloadCta(root);
    const picker = root?.querySelector?.("[data-file-picker]");
    if (!picker) return;
    const checked = new Set((state.selectedFileNames || []).map(String));
    const boxes = [...picker.querySelectorAll("[data-file-check]")];
    for (const box of boxes) {
        const isChecked = checked.has(String(box.dataset.fileCheck || ""));
        box.checked = isChecked;
        const row = box.closest("[data-file-row]");
        row?.classList.toggle("is-checked", isChecked);
        row?.querySelector("[data-file-option]")?.setAttribute("aria-pressed", String(isChecked));
    }
    const checkedCount = boxes.filter((box) => box.checked).length;
    const selectAll = picker.querySelector('[data-action="select-all-files"]');
    if (selectAll) {
        selectAll.textContent = boxes.length && checkedCount === boxes.length ? t("Clear selection") : t("Select all");
    }
}

/** Applies freshly resolved folders to the picker rows without a re-render. */
function syncFileTargets(root = bodyEl) {
    const picker = root?.querySelector?.("[data-file-picker]");
    if (!picker) return;
    const files = getFiles();
    for (const select of picker.querySelectorAll("[data-file-target]")) {
        const key = String(select.dataset.fileTarget || "");
        const file = files.find((item) => fileKey(item) === key);
        if (!file) continue;
        const target = fileTargetRootKind(file);
        if (!target) continue;
        if (![...select.options].some((option) => option.value === target)) {
            select.insertAdjacentHTML("beforeend", `<option value="${escapeAttr(target)}">${escapeHtml(target)}</option>`);
        }
        select.value = target;
    }
}

let fileTargetRequestId = 0;

/**
 * Resolves the folder of every unselected file so each row shows its real
 * target instead of a role-based guess. These are local API calls.
 */
async function resolveOtherFileTargets() {
    const model = state.selectedModel;
    const version = getSelectedVersion();
    if (!model || !version) return;
    const versionKey = String(version.id || "");
    const cache = fileResolutionCache(version);
    const focusedKey = fileKey(getSelectedFile());
    const pending = getFiles(version).filter((file) => {
        const key = fileKey(file);
        return key && key !== focusedKey && !cache[key];
    });
    if (!pending.length) return;
    const requestId = ++fileTargetRequestId;
    const results = await Promise.all(pending.map(async (file) => {
        const key = fileKey(file);
        try {
            const data = await apiPost("/resolve-path", {
                kind: detailAssetKind(),
                model,
                version,
                file,
                overrides: state.fileOverrides?.[key] || {},
            });
            return [key, data.resolution];
        } catch (_) {
            return null;
        }
    }));
    if (requestId !== fileTargetRequestId) return;
    if (state.selectedModel !== model || String(state.selectedVersionId) !== versionKey) return;
    for (const entry of results) if (entry?.[1]) cache[entry[0]] = entry[1];
    syncFileTargets();
}

/** Re-resolves one file after its folder was changed in the picker. */
async function resolveFileTarget(key) {
    const model = state.selectedModel;
    const version = getSelectedVersion();
    const file = getFiles(version).find((item) => fileKey(item) === key);
    if (!model || !version || !file) return;
    const versionKey = String(version.id || "");
    try {
        const data = await apiPost("/resolve-path", {
            kind: detailAssetKind(),
            model,
            version,
            file,
            overrides: state.fileOverrides?.[key] || {},
        });
        if (state.selectedModel !== model || String(state.selectedVersionId) !== versionKey) return;
        fileResolutionCache(version)[key] = data.resolution;
        syncFileTargets();
    } catch (err) {
        state.error = err.message;
    }
}

async function resolveSelectedPath(options = {}) {
    const model = state.selectedModel;
    if (!model) return;
    const target = `${state.selectedVersionId}|${state.selectedFileName}`;
    const isCurrent = () => state.selectedModel === model && `${state.selectedVersionId}|${state.selectedFileName}` === target;
    state.resolvingPath = true;
    renderSelectionSurface(options);
    try {
        const data = await apiPost("/resolve-path", {
            kind: detailAssetKind(),
            model,
            version: getSelectedVersion() || {},
            file: getSelectedFile() || {},
            overrides: state.pathOverrides,
        });
        if (!isCurrent()) return;
        state.resolution = data.resolution;
        state.pathOverrides = {
            root_kind: data.resolution.root_kind,
            base_model_dir: data.resolution.base_model_dir,
            category_dir: data.resolution.category_dir,
            filename: data.resolution.filename,
        };
        const key = fileKey(getSelectedFile());
        if (key) {
            fileResolutionCache(getSelectedVersion())[key] = data.resolution;
            state.fileOverrides[key] = { ...state.pathOverrides };
        }
    } catch (err) {
        if (!isCurrent()) return;
        state.error = err.message;
    }
    state.resolvingPath = false;
    renderSelectionSurface(options);
    syncFileTargets();
    void resolveOtherFileTargets();
}

function renderSelectionSurface(options = {}) {
    if (options.pathOnly && options.detailOnly && updateSelectedPathPanel()) return;
    if (options.detailOnly && state.activeTab === "Discover" && renderSelectedModelDetail()) return;
    if (options.detailOnly && state.activeTab === "Favorites" && renderSelectedFavoriteDetail()) return;
    render();
}

function detailAside(subject, html) {
    return `<aside class="cmgr-detail is-open" data-detail-subject="${escapeAttr(subject)}">${renderDetailDismiss()}${html}</aside>`;
}

function replaceDetail(split, asideHtml) {
    const next = htmlToElement(asideHtml);
    const existing = split.querySelector(":scope > .cmgr-detail");
    if (existing) swapDetail(existing, next);
    else split.appendChild(next);
}

function modelDetailAside() {
    const model = state.selectedModel;
    return detailAside(model ? `model:${model.id}` : "", model ? renderModelDetail(model) : renderEmptyModelDetail());
}

function assetDetailAside(asset = getSelectedAsset()) {
    return detailAside(asset ? `asset:${asset.id}` : "", asset ? renderAssetDetail(asset) : renderEmptyAssetDetail());
}

function favoriteDetailAside(item = selectedFavorite()) {
    return detailAside(item ? `favorite:${item.key}` : "", item ? renderFavoriteDetail(item) : renderEmptyFavoriteDetail());
}

function renderSelectedModelDetail() {
    if (state.activeTab !== "Discover" || !bodyEl) return false;
    const split = bodyEl.querySelector(".cmgr-discover .cmgr-split");
    if (!split) return false;
    split.querySelectorAll("[data-model-id]").forEach((card) => {
        card.classList.toggle("selected", String(card.dataset.modelId) === String(state.selectedModel?.id || ""));
    });
    replaceDetail(split, modelDetailAside());
    bindCommonEvents(bodyEl);
    bindDiscoverEvents(bodyEl);
    return true;
}

function renderSelectedAssetDetail() {
    if (state.activeTab !== "Library" || !bodyEl) return false;
    const split = bodyEl.querySelector(".cmgr-library .cmgr-split");
    if (!split) return false;
    split.querySelectorAll("[data-asset-id]").forEach((card) => {
        card.classList.toggle("selected", String(card.dataset.assetId) === String(state.selectedAssetId || ""));
    });
    replaceDetail(split, assetDetailAside());
    bindCommonEvents(bodyEl);
    bindLibraryEvents(bodyEl);
    return true;
}

function updateSelectedPathPanel() {
    if (!bodyEl || !["Discover", "Favorites"].includes(state.activeTab) || !state.selectedModel) return false;
    const detail = bodyEl.querySelector(".cmgr-detail");
    if (!detail) return false;
    const pathBox = detail.querySelector(".cmgr-path-box");
    const actionHub = detail.querySelector(".cmgr-detail-action-hub");
    if (pathBox) pathBox.outerHTML = renderPathBox();
    if (actionHub) {
        const version = getSelectedVersion() || getVersions(state.selectedModel)[0] || {};
        const file = getSelectedFile() || getFiles(version)[0] || {};
        actionHub.outerHTML = renderModelActionHub(state.selectedModel, version, file, state.resolution);
    }
    bindCommonEvents(detail);
    if (state.activeTab === "Favorites") bindFavoritesEvents(bodyEl);
    else bindDiscoverEvents(bodyEl);
    return true;
}

function htmlToElement(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "").trim();
    return template.content.firstElementChild;
}

async function startDownload() {
    if (!state.selectedModel || !state.resolution) return;
    try {
        await apiPost("/download", {
            kind: detailAssetKind(),
            model: state.selectedModel,
            version: getSelectedVersion() || {},
            file: getSelectedFile() || {},
            overrides: state.pathOverrides,
        });
        showToast(t("Download queued."));
        await loadDownloads(false);
        syncLiveDownloadSurfaces();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

/**
 * The main download button follows the ticks: it queues every selected file
 * (with its own target folder) and falls back to the focused file when the
 * selection is empty.
 */
async function startDownloadFromSelection() {
    if (selectedVersionFiles().length) return downloadSelectedVersionFiles();
    return startDownload();
}

/**
 * Queues every checked file with its own target folder. The backend already
 * accepts one `overrides` object per file, so components can go to different
 * model folders in a single action.
 */
async function downloadSelectedVersionFiles() {
    const model = state.selectedModel;
    const version = getSelectedVersion();
    if (!model || !version) return;
    const checked = new Set((state.selectedFileNames || []).map(String));
    const picks = getFiles(version).filter((file) => checked.has(fileKey(file)));
    if (!picks.length) {
        showToast(t("Check at least one file first."));
        return;
    }
    let queued = 0;
    const failures = [];
    for (const file of picks) {
        try {
            await apiPost("/download", {
                kind: detailAssetKind(),
                model,
                version,
                file,
                overrides: state.fileOverrides?.[fileKey(file)] || {},
            });
            queued += 1;
        } catch (err) {
            failures.push(`${file.name || file.id}: ${err.message}`);
        }
    }
    await loadDownloads(false);
    syncLiveDownloadSurfaces();
    if (queued) showToast(t("Queued {count} downloads", { count: queued }));
    if (failures.length) showToast(failures[0]);
}

async function cancelDownload(taskId) {
    try {
        await apiPost("/download/cancel", { task_id: taskId });
        showToast(t("Cancel requested."));
        await loadDownloads(state.activeTab === "Downloads");
        syncLiveDownloadSurfaces();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function retryDownload(taskId) {
    try {
        await apiPost("/download/retry", { task_id: taskId });
        showToast(t("Download retried."));
        await loadDownloads(state.activeTab === "Downloads");
        syncLiveDownloadSurfaces();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function removeDownloadRecord(taskId = "") {
    if (!taskId && !confirm(t("Clear all finished download records?"))) return;
    try {
        const data = await apiPost("/download/remove", { task_id: taskId });
        showToast(taskId
            ? t("Download record removed.")
            : t("{count} download records cleared.", { count: Number(data.removed || 0) }));
        await loadDownloads();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function loadDownloads(doRender = true) {
    const prevJobs = state.downloads || {};
    const prevActiveIds = new Set(
        Object.values(prevJobs)
            .filter((job) => ACTIVE_DOWNLOAD_STATUSES.has(job?.status))
            .map((job) => job.id)
    );
    try {
        state.downloads = await apiGet("/download-status");
    } catch (_) {
        state.downloads = state.downloads || {};
    }
    trackDownloadRates(Object.values(state.downloads));
    const newlyCompleted = Object.values(state.downloads || {}).some(
        (job) => prevActiveIds.has(job?.id) && job?.status === "completed"
    );
    if (newlyCompleted) {
        void loadLibrary(true).then(() => {
            syncLiveDownloadSurfaces();
        });
    }
    tuneDownloadPolling();
    if (doRender !== false) {
        lastDownloadNavCount = activeDownloadCount();
        render();
    } else if (state.activeTab === "Downloads") {
        patchDownloadPage(bodyEl, downloadPageOptions());
    } else {
        const nextCount = activeDownloadCount();
        if (nextCount !== lastDownloadNavCount) {
            lastDownloadNavCount = nextCount;
            updateDownloadNavBadge();
        }
        syncLiveDownloadSurfaces();
    }
}

function syncLiveDownloadSurfaces() {
    updateDownloadNavBadge();
    if (!bodyEl) return;
    if (["Discover", "Favorites"].includes(state.activeTab)) {
        bodyEl.querySelectorAll("[data-model-id]").forEach((card) => {
            const model = state.searchItems.find((item) => String(item.id) === String(card.dataset.modelId));
            const slot = card.querySelector("[data-card-status-slot]");
            if (!model || !slot) return;
            const html = renderModelCardStatusBadge(model);
            if (liveMarkup.get(slot) === html) return;
            liveMarkup.set(slot, html);
            slot.innerHTML = html;
        });
        if (state.selectedModel) {
            const detail = bodyEl.querySelector(".cmgr-detail");
            const actionHub = detail?.querySelector(".cmgr-detail-action-hub");
            const version = getSelectedVersion() || getVersions(state.selectedModel)[0] || {};
            const file = getSelectedFile() || getFiles(version)[0] || {};
            if (actionHub && !patchDownloadProgress(actionHub, activeDownloadJobForModel(state.selectedModel, version))) {
                const html = renderModelActionHub(state.selectedModel, version, file, state.resolution);
                if (liveMarkup.get(actionHub) === html) return;
                const next = htmlToElement(html);
                liveMarkup.set(next, html);
                actionHub.replaceWith(next);
                bindCommonEvents(detail);
                if (state.activeTab === "Favorites") bindFavoritesEvents(bodyEl);
                else bindDiscoverEvents(bodyEl);
            }
        }
    }
}

async function loadLibrary(force = false) {
    state.libraryLoading = true;
    if (state.activeTab === "Library") render();
    try {
        const data = await apiGet(`/library${force ? "?force=true" : ""}`);
        state.libraryItems = Array.isArray(data.items) ? data.items : [];
        const visible = state.libraryItems.filter((item) => assetMatchesKind(item));
        if (state.activeTab === "Library" && !visible.some((item) => item.id === state.selectedAssetId)) {
            state.selectedAssetId = visible[0]?.id || "";
        }
    } catch (err) {
        console.warn("[CivitaiManager] Failed to load library:", err);
    }
    state.libraryLoading = false;
    if (state.activeTab === "Library") {
        render();
    } else if (overlay) {
        refreshNav();
        syncLiveDownloadSurfaces();
    }
}

function getSelectedAsset() {
    return state.libraryItems.find((item) => item.id === state.selectedAssetId) || null;
}

function assetLocationPayload(asset) {
    return {
        root_kind: asset.root_kind,
        relative_path: asset.relative_path,
        storage_root_id: asset.storage_root_id || "",
    };
}

async function moveSelectedAsset(form) {
    const asset = getSelectedAsset();
    if (!asset) return;
    try {
        await apiPost("/asset/move", {
            ...assetLocationPayload(asset),
            target_root_kind: form.target_root_kind,
            base_model_dir: form.base_model_dir,
            category_dir: form.category_dir,
            filename: form.filename,
        });
        showToast(t("Asset moved"));
        await loadLibrary();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function deleteSelectedAsset() {
    const asset = getSelectedAsset();
    if (!asset) return;
    if (!confirm(`Delete ${asset.filename}? This also removes companion metadata and preview files.`)) return;
    try {
        await apiPost("/asset/delete", assetLocationPayload(asset));
        state.selectedAssetId = "";
        showToast(t("Asset deleted"));
        await loadLibrary();
    } catch (err) {
        state.error = err.message;
        render();
    }
}

async function enrichSelectedAsset() {
    const asset = getSelectedAsset();
    if (!asset) return;
    try {
        showToast(t("Hashing asset..."));
        const data = await apiPost("/asset/metadata", assetLocationPayload(asset));
        showToast(t(data.matched ? "Civitai metadata and preview updated" : "No Civitai match found; SHA256 saved"));
        await loadLibrary(true);
    } catch (err) {
        state.error = err.message;
        render();
    }
}

function assetNeedsCivitaiMetadata(asset) {
    const wantsPreview = state.config?.save_preview !== false;
    return !assetHasCivitaiMatch(asset) || (wantsPreview && !asset.has_preview);
}

function assetHasCivitaiMatch(asset) {
    const matchStatus = String(asset?.metadata_match_status || "").toLowerCase();
    return Boolean(
        asset?.model_id
        || matchStatus === "matched"
        || (asset?.source === "civitai" && asset?.version_id)
    );
}

function libraryMetadataBatchText() {
    if (!libraryMetadataBatch.running && !libraryMetadataBatch.total) return "";
    if (libraryMetadataBatch.cancelRequested && libraryMetadataBatch.running) {
        return t("Stopping after current model...");
    }
    return t("Matching metadata {completed}/{total} · matched {matched} · not found {notFound} · failed {failed}", {
        completed: libraryMetadataBatch.completed,
        total: libraryMetadataBatch.total,
        matched: libraryMetadataBatch.matched,
        notFound: libraryMetadataBatch.notFound,
        failed: libraryMetadataBatch.failed,
    });
}

function renderLibraryMetadataBatchStatus() {
    if (!libraryMetadataBatch.running && !libraryMetadataBatch.total) return "";
    const pct = libraryMetadataBatch.total
        ? Math.round((libraryMetadataBatch.completed / libraryMetadataBatch.total) * 100)
        : 0;
    return `
        <div class="cmgr-library-match-status" data-library-match-status>
            <div class="cmgr-library-match-progress"><span style="width:${pct}%"></span></div>
            <b>${escapeHtml(libraryMetadataBatchText())}</b>
            <span data-library-match-current>${escapeHtml(libraryMetadataBatch.current || "")}</span>
        </div>
    `;
}

function updateLibraryMetadataBatchStatus() {
    const status = bodyEl?.querySelector("[data-library-match-status]");
    if (!status) return;
    const pct = libraryMetadataBatch.total
        ? Math.round((libraryMetadataBatch.completed / libraryMetadataBatch.total) * 100)
        : 0;
    const progress = status.querySelector(".cmgr-library-match-progress span");
    const label = status.querySelector("b");
    const current = status.querySelector("[data-library-match-current]");
    if (progress) progress.style.width = `${pct}%`;
    if (label) label.textContent = libraryMetadataBatchText();
    if (current) current.textContent = libraryMetadataBatch.current || "";
}

async function enrichVisibleLibraryMetadata() {
    if (libraryMetadataBatch.running) return;
    const candidates = filteredLibraryItems().filter(assetNeedsCivitaiMetadata);
    if (!candidates.length) {
        showToast(t("All visible models already have Civitai metadata and previews"));
        return;
    }
    if (!confirm(t("Match Civitai information for {count} visible models? Hashing large files may take a while.", { count: candidates.length }))) {
        return;
    }
    libraryMetadataBatch = {
        running: true,
        cancelRequested: false,
        total: candidates.length,
        completed: 0,
        matched: 0,
        notFound: 0,
        failed: 0,
        current: "",
    };
    render();
    for (const asset of candidates) {
        if (libraryMetadataBatch.cancelRequested) break;
        libraryMetadataBatch.current = asset.name || asset.filename || "";
        updateLibraryMetadataBatchStatus();
        try {
            const data = await apiPost("/asset/metadata", assetLocationPayload(asset));
            if (data.matched) libraryMetadataBatch.matched += 1;
            else libraryMetadataBatch.notFound += 1;
        } catch (err) {
            libraryMetadataBatch.failed += 1;
            console.warn("[CivitaiManager] Metadata match failed:", asset.absolute_path, err);
        } finally {
            libraryMetadataBatch.completed += 1;
            updateLibraryMetadataBatchStatus();
        }
    }
    const cancelled = libraryMetadataBatch.cancelRequested;
    libraryMetadataBatch.running = false;
    libraryMetadataBatch.current = "";
    await loadLibrary(true);
    showToast(t(cancelled ? "Metadata matching stopped" : "Metadata matching completed"));
}

function cancelLibraryMetadataBatch() {
    if (!libraryMetadataBatch.running) return;
    libraryMetadataBatch.cancelRequested = true;
    updateLibraryMetadataBatchStatus();
}

async function toggleSelectedFavorite() {
    await toggleLocalFavorite(getSelectedAsset());
}

function renderSelectedFavoriteDetail() {
    if (state.activeTab !== "Favorites" || !bodyEl) return false;
    const split = bodyEl.querySelector(".cmgr-favorites-page .cmgr-split");
    if (!split) return false;
    split.querySelectorAll("[data-favorite-key]").forEach((card) => {
        card.classList.toggle("selected", card.dataset.favoriteKey === state.selectedFavoriteKey);
    });
    replaceDetail(split, favoriteDetailAside());
    bindCommonEvents(bodyEl);
    bindFavoritesEvents(bodyEl);
    return true;
}

async function selectFavoriteItem(item) {
    if (!item) return;
    state.selectedFavoriteKey = item.key;
    const model = favoriteModel(item);
    if (model) {
        const isCurrent = () => state.activeTab === "Favorites" && state.selectedFavoriteKey === item.key;
        const selectVersion = () => {
            state.selectedVersionId = String(getVersions()[0]?.id || "");
            state.selectedFileName = defaultFileName(getVersions()[0]);
            resetFileSelection(getVersions()[0], state.selectedFileName);
        };
        state.selectedModel = peekModelDetail(model.id) || model;
        state.selectedAssetId = "";
        state.pathOverrides = {};
        state.resolution = null;
        selectVersion();
        renderSelectedFavoriteDetail();
        // The saved snapshot can be a trimmed search card; show the live record.
        if (state.selectedModel === model) {
            setDetailLoading(bodyEl, true);
            const full = await fetchModelDetail(model.id).catch(() => null);
            if (!isCurrent()) return;
            setDetailLoading(bodyEl, false);
            if (full) {
                state.selectedModel = full;
                selectVersion();
                renderSelectedFavoriteDetail();
            }
        }
        await resolveSelectedPath({ detailOnly: true, pathOnly: true });
        return;
    }
    const asset = localAssetForFavorite(item, state.libraryItems);
    state.selectedModel = null;
    state.selectedAssetId = asset?.id || "";
    renderSelectedFavoriteDetail();
}

async function openDownloadFolder({ rootKind, relativePath }) {
    try {
        await apiPost("/asset/open-folder", { root_kind: rootKind, relative_path: relativePath });
        showToast(t("Folder opened"));
    } catch (err) {
        state.error = err.message;
        updateTransientMessages();
    }
}

async function openSelectedFolder() {
    const asset = getSelectedAsset();
    if (!asset) return;
    try {
        await apiPost("/asset/open-folder", assetLocationPayload(asset));
        showToast(t("Folder opened"));
    } catch (err) {
        state.error = err.message;
        render();
    }
}

/** Loads a downloaded workflow onto the canvas; the panel closes to show it. */
async function openWorkflowAsset(entry) {
    try {
        // Imported on demand: a missing or broken helper file must never stop the
        // whole panel from loading, which is what a top-level import would do.
        const { openWorkflowInComfyUI } = await import("./civitai/workflow_open.js");
        await openWorkflowInComfyUI(entry);
        showToast(t("Workflow opened"));
        if (overlay?.classList.contains("show")) closeOverlay();
    } catch (err) {
        showToast(t(err.message));
    }
}

function render(options = {}) {
    if (!state.mounted || !bodyEl) return;
    const preserveScroll = options.preserveScroll !== false;
    const scrollState = preserveScroll ? captureScrollState() : null;
    const comboState = captureOpenComboState();
    const focusedField = captureFocusedField(bodyEl);
    if (navEl) {
        renderNav(navEl);
        restoreOpenComboState(comboState);
    }
    bodyEl.innerHTML = renderActiveTab();
    reuseFocusedFieldInput(bodyEl, focusedField);
    updateTransientMessages();
    bindCommonEvents(bodyEl);
    bindActiveTabEvents(bodyEl);
    restoreFocusedField(bodyEl, focusedField);
    if (scrollState) restoreScrollState(scrollState);
}

const FIELD_INPUT_SELECTOR = "input[data-field], textarea[data-field]";

function captureFocusedField(root) {
    const active = document.activeElement;
    if (!root?.contains(active) || !active?.matches?.(FIELD_INPUT_SELECTOR)) return null;
    return {
        field: active.dataset.field || "",
        element: active,
        start: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
        end: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
        direction: active.selectionDirection || "none",
        caretPreserved: false,
    };
}

/**
 * Puts the live input back into the freshly rendered markup instead of keeping
 * the newly created one. Re-creating the search field on every result update
 * drops focus and the caret for a frame, so fast typing lands one character late
 * ("image" -> "imaeg"). Re-using the node keeps the browser's own selection
 * untouched; it must happen before the event handlers are bound, so they attach
 * to the node that survives.
 */
function reuseFocusedFieldInput(root, snapshot) {
    if (!root || !snapshot?.field || !snapshot.element || snapshot.element.isConnected) return;
    const fresh = Array.from(root.querySelectorAll(FIELD_INPUT_SELECTOR))
        .find((item) => item.dataset.field === snapshot.field);
    if (!fresh || fresh === snapshot.element || fresh.tagName !== snapshot.element.tagName) return;
    fresh.replaceWith(snapshot.element);
    snapshot.caretPreserved = true;
}

function restoreFocusedField(root, snapshot) {
    if (!root || !snapshot?.field) return;
    const input = snapshot.element?.isConnected
        ? snapshot.element
        : Array.from(root.querySelectorAll(FIELD_INPUT_SELECTOR))
            .find((item) => item.dataset.field === snapshot.field);
    if (!input) return;
    const focusInput = () => {
        if (document.activeElement === input) return;
        try {
            input.focus({ preventScroll: true });
        } catch (_) {
            input.focus();
        }
    };
    // A reused node still carries the caret the user left behind, so restoring a
    // snapshot position would drag it back a character on every render.
    const placeCaret = () => {
        if (snapshot.caretPreserved) return;
        if (snapshot.start === null || snapshot.end === null) return;
        const length = String(input.value || "").length;
        input.setSelectionRange?.(
            Math.min(snapshot.start, length),
            Math.min(snapshot.end, length),
            snapshot.direction,
        );
    };
    focusInput();
    placeCaret();
    if (document.activeElement !== input) {
        // Retry only a focus that did not land yet; never move the caret again,
        // so typing that happened in the meantime is not undone.
        requestAnimationFrame(() => {
            focusInput();
            if (document.activeElement === input) placeCaret();
        });
    }
}

function updateTransientMessages() {
    updateNotificationHost(notificationHost, {
        error: state.error,
        toast: state.toast,
        onDismissError: () => {
            state.error = "";
            updateTransientMessages();
        },
    });
}

function captureOpenComboState() {
    const combo = navEl?.querySelector?.(".cmgr-combo.open");
    if (!combo) return null;
    return {
        id: combo.dataset.combo || "",
        query: combo.querySelector("[data-combo-search]")?.value || "",
        focused: combo.contains(document.activeElement),
    };
}

function restoreOpenComboState(snapshot) {
    if (!snapshot?.id || !navEl) return;
    const combo = Array.from(navEl.querySelectorAll(".cmgr-combo")).find((item) => item.dataset.combo === snapshot.id);
    if (!combo) return;
    const toggle = combo.querySelector("[data-combo-toggle]");
    const searchInput = combo.querySelector("[data-combo-search]");
    combo.classList.add("open");
    toggle?.setAttribute("aria-expanded", "true");
    if (searchInput) {
        searchInput.value = snapshot.query || "";
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        if (snapshot.focused) {
            requestAnimationFrame(() => {
                searchInput.focus();
                const length = searchInput.value.length;
                searchInput.setSelectionRange?.(length, length);
            });
        }
    }
}

function captureScrollState() {
    const selectors = [".cmgr-results", ".cmgr-split", ".cmgr-detail-scroll", ".cmgr-nav", ".cmgr-download-list", ".cmgr-settings-grid"];
    return selectors.map((selector) => {
        const element = selector === ".cmgr-nav" ? navEl : bodyEl?.querySelector(selector);
        return element ? { selector, top: element.scrollTop, left: element.scrollLeft } : null;
    }).filter(Boolean);
}

function restoreScrollState(scrollState) {
    const apply = () => {
        scrollState.forEach((item) => {
            const element = item.selector === ".cmgr-nav" ? navEl : bodyEl?.querySelector(item.selector);
            if (!element) return;
            element.scrollTop = item.top;
            element.scrollLeft = item.left;
        });
    };
    apply();
    requestAnimationFrame(apply);
}

function attachRememberedScroll(element, key, onScroll) {
    if (!element || !key) return;
    const value = Number(state.scroll[key] || 0);
    if (value > 0) {
        element.scrollTop = value;
    }
    element.onscroll = () => {
        state.scroll[key] = element.scrollTop;
        onScroll?.(element);
    };
}

function maybeAutoLoadMore(element) {
    if (!element || state.loadingSearch || state.autoLoadingMore || !state.nextCursor) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining > Math.max(720, element.clientHeight * 0.8)) return;
    state.autoLoadingMore = true;
    search(false, { silent: true });
}

function renderNav(nav) {
    const tabs = overlay.querySelector('.cmgr-selector-tabs');
    const icons = { Discover: "discover", Library: "local", Favorites: "favorites", Downloads: "downloads", Settings: "settings" };
    const count = (tab) => tab === "Library" ? state.libraryItems.length : tab === "Favorites" ? state.favoriteItems.length : tab === "Downloads" ? activeDownloadCount() : "";
    if (!tabs.children.length) tabs.innerHTML = TABS.map((tab) => `
        <button class="cmgr-selector-tab" type="button" role="tab" id="cmgr-manager-tab-${tab}" data-tab="${tab}" aria-controls="cmgr-manager-content">
            ${selectorIcon(icons[tab])}<span>${escapeHtml(t(tab))}</span>${count(tab) !== "" ? `<b>${count(tab)}</b>` : ""}
        </button>
    `).join("");
    tabs.querySelectorAll('[data-tab]').forEach((button, index, buttons) => {
        const active = button.dataset.tab === state.activeTab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
        const badge = button.querySelector("b");
        if (badge) badge.textContent = count(button.dataset.tab);
        button.onclick = () => {
            switchManagerTab(button.dataset.tab);
            button.focus({ preventScroll: true });
        };
        button.onkeydown = (event) => {
            if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next].click();
        };
    });
    const imagesMode = state.activeTab === "Discover" && state.assetKind === IMAGES_KIND;
    const hasFilters = ["Discover", "Library", "Favorites"].includes(state.activeTab);
    overlay.querySelector('.cmgr-selector-layout').classList.toggle("has-filters", hasFilters);
    overlay.querySelector('[data-action="toggle-manager-filters"]').hidden = !hasFilters;
    bodyEl.setAttribute("aria-labelledby", `cmgr-manager-tab-${state.activeTab}`);
    overlay.querySelector('[data-action="view-library"]').innerHTML = `${selectorIcon("layers")}<span>${escapeHtml(t("Library"))}</span><b>${state.libraryItems.length}</b>`;
    setManagerFiltersOpen(filtersOpen);
    if (imagesMode) {
        const imageFiltered = imageState.baseModels.length > 0 || imageState.period !== "AllTime";
        nav.innerHTML = `
            <div class="cmgr-selector-filter-heading">
                <h2>${escapeHtml(t("Adjust filters"))}</h2>
                ${imageFiltered ? `<button class="cmgr-selector-reset" type="button" data-action="reset-image-filters">${escapeHtml(t("Reset filters"))}</button>` : ""}
            </div>
            ${renderImageFilters(currentTaxonomy().baseModels, { loading: state.taxonomyLoading })}
        `;
        const resetImages = nav.querySelector('[data-action="reset-image-filters"]');
        if (resetImages) resetImages.onclick = resetImageFilters;
        bindSearchCombo(nav.querySelector('[data-combo="image-base-model"]'), (values) => setImageBaseModels(values));
        bindSearchCombo(nav.querySelector('[data-combo="image-period"]'), (value) => setImagePeriod(imagePeriodValue(value)));
        return;
    }
    nav.innerHTML = `
        <div class="cmgr-selector-filter-heading">
            <h2>${escapeHtml(t(state.activeTab === "Favorites" ? "Favorites" : "Adjust filters"))}</h2>
            ${["Discover", "Library"].includes(state.activeTab) && (state.selectedBaseModels.length || state.selectedTag || state.period !== "AllTime" || state.fileFormats.length || state.modelStatuses.length || (state.activeTab === "Library" ? state.selectedCategory : state.selectedCivitaiCategory)) ? `<button class="cmgr-selector-reset" type="button" data-action="reset-manager-filters">${escapeHtml(t("Reset filters"))}</button>` : ""}
        </div>
        ${["Discover", "Library"].includes(state.activeTab) && !imagesMode ? renderAssetSidebar() : ""}
        ${state.activeTab === "Favorites" ? renderFavoritesSidebar() : ""}
    `;
    const reset = nav.querySelector('[data-action="reset-manager-filters"]');
    if (reset) reset.onclick = resetManagerFilters;
    nav.querySelectorAll("[data-asset-kind]").forEach((btn) => {
        btn.onclick = () => selectAssetKind(btn.dataset.assetKind);
    });
    bindSelectMenus(nav);
    const assetKindSelect = nav.querySelector("[data-asset-kind-select]");
    if (assetKindSelect) {
        assetKindSelect.onchange = () => selectAssetKind(assetKindSelect.value);
    }
    nav.querySelectorAll("[data-category]").forEach((btn) => {
        selectCategoryButton(btn);
    });
    nav.querySelectorAll("[data-local-folder-toggle]").forEach((btn) => {
        btn.onclick = (event) => {
            event.stopPropagation();
            animateSelectorFolder(btn, () => toggleLocalFolder(btn.dataset.localFolderToggle || ""));
        };
    });
    bindSearchCombo(nav.querySelector('[data-combo="base-model"]'), (values) => selectBaseModels(values));
    bindSearchCombo(nav.querySelector('[data-combo="category"]'), (value) => selectManagerCategory(CIVITAI_CATEGORY_FILTERS.find((item) => t(item.label) === value)?.value || ""));
    bindSearchCombo(nav.querySelector('[data-combo="period"]'), (value) => selectModelPeriod(modelPeriodValue(value)));
    bindSearchCombo(nav.querySelector('[data-combo="file-format"]'), (values) => selectModelFileFormats(values.map((value) => modelOptionValue(MODEL_FILE_FORMAT_OPTIONS, value))));
    bindSearchCombo(nav.querySelector('[data-combo="model-status"]'), (values) => selectModelStatuses(values.map((value) => modelOptionValue(MODEL_STATUS_OPTIONS, value))));
    bindSearchCombo(nav.querySelector('[data-combo="tag"]'), (value) => selectTag(value));
    if (state.activeTab === "Favorites") bindFavoritesSidebar(nav);
}

function refreshNav() {
    if (!navEl) return;
    const comboState = captureOpenComboState();
    const scrollTop = navEl.scrollTop;
    const scrollLeft = navEl.scrollLeft;
    renderNav(navEl);
    restoreOpenComboState(comboState);
    navEl.scrollTop = scrollTop;
    navEl.scrollLeft = scrollLeft;
}

function updateDownloadNavBadge() {
    const button = overlay?.querySelector('.cmgr-selector-tabs [data-tab="Downloads"]');
    if (!button) return;
    const count = activeDownloadCount();
    let badge = button.querySelector("b");
    if (!count) {
        badge?.remove();
        return;
    }
    if (!badge) {
        badge = document.createElement("b");
        button.appendChild(badge);
    }
    badge.textContent = String(count);
}

function renderAssetSidebar() {
    const taxonomy = currentTaxonomy();
    const baseModels = state.activeTab === "Library" ? libraryBaseModelsForKind(state.assetKind) : taxonomy.baseModels;
    const tags = state.activeTab === "Library" ? libraryTagsForKind(state.assetKind) : taxonomy.tags;
    const selectedCategory = state.activeTab === "Library" ? state.selectedCategory || "" : state.selectedCivitaiCategory || "";
    const localFolderTree = state.activeTab === "Library" ? libraryFolderTreeForKind(state.assetKind) : null;
    const baseModelOptions = ensureSelectedOptions(baseModels, state.selectedBaseModels);
    const tagOptions = ensureSelectedOption(tags, state.selectedTag);
    return `
        <div class="cmgr-nav-group cmgr-category-group">
            <div class="cmgr-nav-title">${escapeHtml(t("Base Model"))}</div>
            <div class="cmgr-search-picker">
                ${renderSelectorCombo({
                    id: "base-model",
                    values: state.selectedBaseModels,
                    items: baseModelOptions,
                    placeholder: t("Choose a base model"),
                    searchPlaceholder: t("Search base models..."),
                    emptyText: t("No base models found"),
                    clearTitle: t("Clear base model"),
                    multiHint: t("Pick any number"),
                })}
            </div>
            ${state.taxonomyLoading && state.activeTab === "Discover" ? `<div class="cmgr-nav-note">${escapeHtml(t("Loading base models..."))}</div>` : ""}
            ${!baseModels.length && !state.taxonomyLoading ? `<div class="cmgr-nav-note">${escapeHtml(t("Base models appear from Civitai data."))}</div>` : ""}
        </div>
        ${state.activeTab === "Discover" ? `
            <div class="cmgr-nav-group cmgr-category-group">
                <div class="cmgr-nav-title">${escapeHtml(t("Time period"))}</div>
                <div class="cmgr-search-picker">
                    ${renderSelectorCombo({
                        id: "period",
                        value: state.period === "AllTime" ? "" : t(MODEL_PERIODS.find((item) => item.value === state.period)?.label || ""),
                        items: MODEL_PERIODS.slice(1).map((item) => t(item.label)),
                        placeholder: t("All time"),
                        searchPlaceholder: t("Search"),
                        emptyText: t("No options found"),
                        clearTitle: t("Clear"),
                    })}
                </div>
            </div>
            <div class="cmgr-nav-group cmgr-category-group">
                <div class="cmgr-nav-title">${escapeHtml(t("File format"))}</div>
                <div class="cmgr-search-picker">
                    ${renderSelectorCombo({
                        id: "file-format",
                        values: state.fileFormats.map((value) => t(value)),
                        items: MODEL_FILE_FORMAT_OPTIONS.map((item) => t(item.label)),
                        placeholder: t("Any format"),
                        searchPlaceholder: t("Search"),
                        emptyText: t("No options found"),
                        clearTitle: t("Clear"),
                        multiHint: t("Pick any number"),
                    })}
                </div>
            </div>
            <div class="cmgr-nav-group cmgr-category-group">
                <div class="cmgr-nav-title">${escapeHtml(t("Model status"))}</div>
                <div class="cmgr-search-picker">
                    ${renderSelectorCombo({
                        id: "model-status",
                        values: state.modelStatuses.map((value) => t(MODEL_STATUS_OPTIONS.find((item) => item.value === value)?.label || value)),
                        items: MODEL_STATUS_OPTIONS.map((item) => t(item.label)),
                        placeholder: t("Any status"),
                        searchPlaceholder: t("Search"),
                        emptyText: t("No options found"),
                        clearTitle: t("Clear"),
                        multiHint: t("Pick any number"),
                    })}
                </div>
            </div>
            <div class="cmgr-nav-group cmgr-category-group">
                <div class="cmgr-nav-title">${escapeHtml(t("Filter by Category"))}</div>
                ${renderSelectorCombo({
                    id: "category",
                    value: selectedCategory ? t(categoryFilterLabel(selectedCategory)) : "",
                    items: [t("All"), ...CIVITAI_CATEGORY_FILTERS.map((item) => t(item.label))],
                    placeholder: t("All"),
                    searchPlaceholder: t("Search"),
                    emptyText: t("No options found"),
                    clearTitle: t("Clear"),
                })}
            </div>
        ` : ""}
        ${state.activeTab === "Library" ? `
            <div class="cmgr-nav-group cmgr-category-group">
                <div class="cmgr-nav-title">${escapeHtml(t("Local Folders"))}</div>
                <button class="cmgr-nav-btn ${!selectedCategory ? "active" : ""}" data-category="">
                    <span>${escapeHtml(t("All"))}</span>
                    <b>${libraryCountForKind(state.assetKind)}</b>
                </button>
                ${renderLibraryFolderTree(localFolderTree)}
                ${!localFolderTree?.count ? `<div class="cmgr-nav-note">${escapeHtml(t("Local folders appear after scanning your model files."))}</div>` : ""}
            </div>
        ` : ""}
        <div class="cmgr-nav-group cmgr-category-group">
            <div class="cmgr-nav-title">${escapeHtml(t("Search Tags"))}</div>
            <div class="cmgr-search-picker">
                ${renderSelectorCombo({
                    id: "tag",
                    value: state.selectedTag,
                    items: tagOptions,
                    placeholder: t("Choose a tag"),
                    searchPlaceholder: t("Search tags..."),
                    emptyText: t("No tags found"),
                    clearTitle: t("Clear tag"),
                })}
            </div>
            ${state.taxonomyLoading && state.activeTab === "Discover" ? `<div class="cmgr-nav-note">${escapeHtml(t("Loading tags from Civitai..."))}</div>` : ""}
            ${!tags.length && !state.taxonomyLoading ? `<div class="cmgr-nav-note">${escapeHtml(t("Tags appear from Civitai model and tag data."))}</div>` : ""}
        </div>
    `;
}

function renderLibraryFolderTree(tree) {
    if (!tree?.count) return "";
    const rootFiles = tree.rootFileCount ? renderLibraryRootFilesNode(tree.rootFileCount) : "";
    return `
        <div class="cmgr-folder-tree">
            ${rootFiles}
            ${tree.children.map((node) => renderLibraryFolderNode(node, 0)).join("")}
        </div>
    `;
}

function renderLibraryRootFilesNode(count) {
    return `
        <div class="cmgr-folder-node" style="--cmgr-folder-depth: 0">
            <div class="cmgr-folder-row">
                <span class="cmgr-folder-spacer" aria-hidden="true"></span>
                <button class="cmgr-nav-btn cmgr-folder-select ${state.selectedCategory === ROOT_LOCAL_FOLDER ? "active" : ""}" data-category="${ROOT_LOCAL_FOLDER}" title="${escapeAttr(t("Root files"))}">
                    <span>${escapeHtml(t("Root files"))}</span>
                    <b>${count}</b>
                </button>
            </div>
        </div>
    `;
}

function renderLibraryFolderNode(node, depth) {
    const expanded = isLocalFolderExpanded(node.path);
    const hasChildren = node.children.length > 0;
    const depthValue = Math.min(depth, 8);
    return `
        <div class="cmgr-folder-node" style="--cmgr-folder-depth: ${depthValue}">
            <div class="cmgr-folder-row">
                ${hasChildren ? `
                    <button class="cmgr-folder-toggle ${expanded ? "expanded" : ""}" data-local-folder-toggle="${escapeAttr(node.path)}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeAttr(node.path)}" aria-expanded="${expanded ? "true" : "false"}"></button>
                ` : `<span class="cmgr-folder-spacer" aria-hidden="true"></span>`}
                <button class="cmgr-nav-btn cmgr-folder-select ${state.selectedCategory === node.path ? "active" : ""}" data-category="${escapeAttr(node.path)}" title="${escapeAttr(node.path)}">
                    <span>${escapeHtml(node.name)}</span>
                    <b>${node.count}</b>
                </button>
            </div>
            ${hasChildren && expanded ? `<div class="cmgr-folder-children">${node.children.map((child) => renderLibraryFolderNode(child, depth + 1)).join("")}</div>` : ""}
        </div>
    `;
}

function renderSelectMenu(options = {}) {
    const id = String(options.id || "select");
    const selectedValue = String(options.value ?? "");
    const items = (Array.isArray(options.options) ? options.options : [])
        .map((item) => ({
            value: String(item?.value ?? item?.id ?? item?.name ?? ""),
            label: String(item?.label ?? item?.name ?? item?.value ?? ""),
        }))
        .filter((item) => item.value || item.label);
    const selected = items.find((item) => item.value === selectedValue) || items[0] || { value: selectedValue, label: selectedValue || "Choose..." };
    const inputAttrs = options.inputAttrs ? ` ${String(options.inputAttrs).trim()}` : "";
    const className = options.className ? ` ${escapeAttr(options.className)}` : "";
    return `
        <div class="cmgr-combo cmgr-select-menu${className}" data-combo="${escapeAttr(id)}" data-select-menu>
            <input type="hidden"${inputAttrs} value="${escapeAttr(selected.value)}" />
            <button class="cmgr-combo-control" type="button" data-combo-toggle aria-haspopup="listbox" aria-expanded="false" title="${escapeAttr(selected.label)}">
                <span class="cmgr-combo-value">${escapeHtml(selected.label)}</span>
                <span class="cmgr-combo-arrow" aria-hidden="true">⌄</span>
            </button>
            <div class="cmgr-combo-popover" data-combo-popover>
                <div class="cmgr-combo-list" data-combo-list role="listbox">
                    ${items.map((item) => `
                        <button class="cmgr-combo-option ${item.value === selected.value ? "active" : ""}" type="button" data-select-value="${escapeAttr(item.value)}" role="option" aria-selected="${item.value === selected.value ? "true" : "false"}">
                            <span>${escapeHtml(item.label)}</span>
                        </button>
                    `).join("")}
                </div>
            </div>
        </div>
    `;
}

function bindSelectMenus(root) {
    if (!root) return;
    root.querySelectorAll("[data-select-menu]").forEach((menu) => {
        const toggle = menu.querySelector("[data-combo-toggle]");
        const input = menu.querySelector('input[type="hidden"]');
        const valueEl = menu.querySelector(".cmgr-combo-value");
        const options = Array.from(menu.querySelectorAll("[data-select-value]"));
        if (!toggle || !input) return;
        let activeIndex = Math.max(0, options.findIndex((option) => option.classList.contains("active")));
        const setOpen = (open) => {
            if (open) {
                document.querySelectorAll(".cmgr-combo.open").forEach((item) => {
                    if (item !== menu) {
                        item.classList.remove("open");
                        item.querySelector("[data-combo-toggle]")?.setAttribute("aria-expanded", "false");
                    }
                });
            }
            menu.classList.toggle("open", open);
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
            if (open && options[activeIndex]) {
                options[activeIndex].classList.add("is-key-active");
                options[activeIndex].scrollIntoView({ block: "nearest" });
            }
        };
        const setActive = (index, behavior = {}) => {
            if (!options.length) return;
            activeIndex = (index + options.length) % options.length;
            options.forEach((option) => option.classList.remove("is-key-active"));
            options[activeIndex].classList.add("is-key-active");
            if (behavior.scroll !== false) options[activeIndex].scrollIntoView({ block: "nearest" });
        };
        const choose = (option) => {
            if (!option) return;
            const value = option.dataset.selectValue || "";
            const label = option.textContent?.trim() || value;
            input.value = value;
            valueEl.textContent = label;
            toggle.title = label;
            options.forEach((item) => {
                const active = item === option;
                item.classList.toggle("active", active);
                item.setAttribute("aria-selected", active ? "true" : "false");
            });
            setOpen(false);
            input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        toggle.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(!menu.classList.contains("open"));
        };
        toggle.onkeydown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                return;
            }
            if (event.key === "Tab") {
                setOpen(false);
                return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!menu.classList.contains("open")) setOpen(true);
                setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1), { scroll: true });
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!menu.classList.contains("open")) {
                    setOpen(true);
                } else {
                    choose(options[activeIndex]);
                }
            }
        };
        options.forEach((option) => {
            option.onpointerdown = (event) => {
                event.preventDefault();
                event.stopPropagation();
                choose(option);
            };
            option.onmouseenter = () => setActive(options.indexOf(option), { scroll: false });
        });
    });
}

function selectCategoryButton(btn) {
    btn.onclick = () => selectManagerCategory(btn.dataset.category || "");
}

function selectManagerCategory(category) {
        if (state.activeTab === "Discover") {
            if (state.selectedCivitaiCategory === category) return;
            state.selectedCivitaiCategory = category;
        } else {
            if (state.selectedCategory === category) return;
            state.selectedCategory = category;
            expandLocalFolderAncestors(category);
        }
        state.selectedModel = null;
        state.selectedAssetId = "";
        state.resolution = null;
        state.scroll.discoverResults = 0;
        state.scroll.libraryResults = 0;
        if (state.activeTab === "Discover") {
            search(true, { silent: true });
        } else {
            render();
        }
}

function resetManagerFilters() {
    state.selectedBaseModels = [];
    state.selectedTag = "";
    state.period = "AllTime";
    state.fileFormats = [];
    state.modelStatuses = [];
    if (state.activeTab === "Discover") state.selectedCivitaiCategory = "";
    else state.selectedCategory = "";
    state.selectedModel = null;
    state.selectedAssetId = "";
    state.resolution = null;
    if (state.activeTab === "Discover") void search(true, { silent: true });
    else render();
}

function selectTagButton(btn) {
    btn.onclick = () => selectTag(btn.dataset.tag || "");
}

function toggleLocalFolder(path) {
    const folder = normalizeLocalFolderPath(path);
    if (!folder) return;
    const key = localFolderStateKey(folder);
    state.expandedLocalFolders[key] = !state.expandedLocalFolders[key];
    refreshNav();
}

function expandLocalFolderAncestors(path) {
    const folder = normalizeLocalFolderPath(path);
    if (!folder || folder === ROOT_LOCAL_FOLDER) return;
    const parts = splitLocalPath(folder);
    for (let index = 1; index <= parts.length; index += 1) {
        state.expandedLocalFolders[localFolderStateKey(parts.slice(0, index).join("/"))] = true;
    }
}

function isLocalFolderExpanded(path) {
    return Boolean(state.expandedLocalFolders[localFolderStateKey(path)]);
}

function localFolderStateKey(path) {
    return `${state.assetKind}:${normalizeLocalFolderPath(path)}`;
}

function modelPeriodValue(label) {
    return MODEL_PERIODS.find((item) => t(item.label) === label)?.value || "AllTime";
}

function modelOptionValue(options, label) {
    return (Array.isArray(options) ? options : []).find((item) => t(item.label) === label)?.value || "";
}

function refreshDiscoverListing() {
    state.selectedModel = null;
    state.selectedAssetId = "";
    state.resolution = null;
    state.scroll.discoverResults = 0;
    void search(true, { silent: true });
}

function selectModelPeriod(period) {
    const next = String(period || "AllTime");
    if (state.period === next) return;
    state.period = next;
    refreshDiscoverListing();
}

function selectModelFileFormats(formats) {
    const next = uniqueFilterValues(formats);
    if (sameFilterValues(state.fileFormats, next)) return;
    state.fileFormats = next;
    refreshDiscoverListing();
}

function selectModelStatuses(statuses) {
    const next = uniqueFilterValues(statuses);
    if (sameFilterValues(state.modelStatuses, next)) return;
    state.modelStatuses = next;
    refreshDiscoverListing();
}

function selectBaseModels(values) {
    const next = uniqueFilterValues((Array.isArray(values) ? values : [values])
        .map((value) => normalizePickerChoice(value, currentBaseModelItems())));
    if (sameFilterValues(state.selectedBaseModels, next)) return;
    state.selectedBaseModels = next;
    state.selectedModel = null;
    state.selectedAssetId = "";
    state.resolution = null;
    state.scroll.discoverResults = 0;
    state.scroll.libraryResults = 0;
    if (state.activeTab === "Discover") {
        search(true, { silent: true });
    } else {
        render();
    }
}

function selectTag(tag) {
    tag = normalizePickerChoice(tag, currentTagItems());
    if (state.selectedTag === tag) return;
    state.selectedTag = tag;
    state.selectedModel = null;
    state.selectedAssetId = "";
    state.resolution = null;
    state.scroll.discoverResults = 0;
    state.scroll.libraryResults = 0;
    if (state.activeTab === "Discover") {
        search(true, { silent: true });
    } else {
        render();
    }
}

function selectAssetKind(kind) {
    if (!kind || state.assetKind === kind) return;
    cancelActiveSearch();
    state.assetKind = kind;
    state.selectedCategory = "";
    state.selectedCivitaiCategory = "";
    state.selectedBaseModels = [];
    state.selectedTag = "";
    state.fileFormats = [];
    state.modelStatuses = [];
    state.selectedModel = null;
    state.selectedAssetId = "";
    state.resolution = null;
    state.searchItems = [];
    state.nextCursor = "";
    state.cursor = "";
    state.scroll.discoverResults = 0;
    state.scroll.libraryResults = 0;
    if (kind === IMAGES_KIND) {
        resetImageFeed();
        // Civitai has no image taxonomy, so the sidebar reuses the model enums;
        // fetch them once per session or Base Model stays empty.
        if (!state.taxonomyByKind[IMAGES_KIND]) void loadTaxonomy(IMAGES_KIND, { silent: true });
        if (state.activeTab === "Discover") {
            // Skeletons now, the pictures as soon as the page lands.
            void loadImageFeed({ reset: true }).then(() => render());
            render();
            return;
        }
    }
    if (kind !== OTHER_LIBRARY_KIND) loadTaxonomy(kind, { silent: true });
    if (state.activeTab === "Discover") {
        search(true, { silent: true });
    } else {
        render();
    }
}

function renderActiveTab() {
    if (state.activeTab === "Library") return renderLibrary();
    if (state.activeTab === "Favorites") return renderFavorites();
    if (state.activeTab === "Downloads") return renderDownloads();
    if (state.activeTab === "Settings") return renderSettings();
    if (state.activeTab === "Discover" && state.assetKind === IMAGES_KIND) {
        setImageTargets(targetKindOptions());
        return renderImageDiscover(renderToolbarKindTabs());
    }
    return renderDiscover();
}

function libraryAssetKinds() {
    return state.activeTab === "Library"
        ? [...ASSET_KINDS.filter((kind) => !kind.discoverOnly), { id: OTHER_LIBRARY_KIND, label: "Other" }]
        : ASSET_KINDS;
}

function renderToolbarKindTabs() {
    return `
        <div class="cmgr-kind-tabs" role="tablist" aria-label="${escapeAttr(t("Asset Type"))}">
            ${libraryAssetKinds().map((kind) => `
                <button
                    class="cmgr-kind-tab ${state.assetKind === kind.id ? "active" : ""}"
                    type="button"
                    role="tab"
                    aria-selected="${state.assetKind === kind.id ? "true" : "false"}"
                    data-asset-kind="${escapeAttr(kind.id)}"
                ><span>${escapeHtml(t(kind.label))}</span>${state.activeTab === "Library" ? `<b>${libraryCountForKind(kind.id)}</b>` : ""}</button>
            `).join("")}
        </div>
    `;
}

function renderActiveFilterBar() {
    const chips = [];
    state.selectedBaseModels.forEach((baseModel) => {
        chips.push({
            key: "base_model",
            label: t("Base Model"),
            value: baseModel,
            clearValue: baseModel,
            clearAction: "clear-filter-base",
        });
    });
    if (state.activeTab === "Discover" && state.selectedCivitaiCategory) {
        chips.push({
            key: "category",
            label: t("Category"),
            value: t(categoryFilterLabel(state.selectedCivitaiCategory)),
            clearAction: "clear-filter-category",
        });
    }
    if (state.activeTab === "Library" && state.selectedCategory) {
        chips.push({
            key: "folder",
            label: t("Local Folders"),
            value: localFolderFilterLabel(state.selectedCategory),
            clearAction: "clear-filter-category",
        });
    }
    if (state.selectedTag) {
        chips.push({
            key: "tag",
            label: t("Search Tags"),
            value: state.selectedTag,
            clearAction: "clear-filter-tag",
        });
    }
    if (state.activeTab === "Discover" && state.period !== "AllTime") {
        chips.push({
            key: "period",
            label: t("Time period"),
            value: t(MODEL_PERIODS.find((item) => item.value === state.period)?.label || ""),
            clearAction: "clear-filter-period",
        });
    }
    if (state.activeTab === "Discover") {
        state.fileFormats.forEach((format) => {
            chips.push({
                key: "file_format",
                label: t("File format"),
                value: t(format),
                clearValue: format,
                clearAction: "clear-filter-file-format",
            });
        });
        state.modelStatuses.forEach((status) => {
            chips.push({
                key: "model_status",
                label: t("Model status"),
                value: t(MODEL_STATUS_OPTIONS.find((item) => item.value === status)?.label || status),
                clearValue: status,
                clearAction: "clear-filter-model-status",
            });
        });
    }
    return renderActiveFilterChips(chips, "reset-all-filters");
}

function renderDiscover() {
    const toolbar = renderSelectorToolbar({
        title: assetKindLabel(state.assetKind),
        headingHtml: renderToolbarKindTabs(),
        searchHtml: renderSelectorSearch({
            value: state.query,
            inputAttrs: 'data-field="query"',
            placeholder: t("Search as you type..."),
            clearAction: "clear-search",
            loading: state.loadingSearch,
        }),
        actionsHtml: `
            ${renderSelectorSort(state.sort)}
            <button class="cmgr-selector-button is-icon" type="button" data-action="search" title="${escapeAttr(t("Refresh"))}" aria-label="${escapeAttr(t("Refresh"))}">${selectorIcon("refresh")}</button>
        `,
        filterBarHtml: renderActiveFilterBar(),
    });
    return `
        <section class="cmgr-page cmgr-discover">
            ${toolbar}
            <div class="cmgr-split has-detail ${state.detailOpen ? "is-detail-open" : ""} ${state.loadingSearch && state.searchItems.length && state.sparseResults ? "is-searching-more" : ""}">
                <div class="cmgr-results">
                    ${state.searchItems.length ? state.searchItems.map(renderModelCard).join("") : renderEmptySearch()}
                    ${state.loadingSearch && state.searchItems.length && state.autoLoadingMore && !state.sparseResults ? renderCardSkeletons(loadMoreSkeletonCount(bodyEl.querySelector(".cmgr-discover .cmgr-results")), { loadMore: true }) : ""}
                </div>
                ${modelDetailAside()}
            </div>
        </section>
    `;
}

function renderEmptySearch() {
    if (state.loadingSearch) return renderCardSkeletons(30);
    return renderCollectionEmptyState({
        kind: "discover",
        kicker: t("Discover"),
        title: t("No matching {kind} found", { kind: assetKindLabel(state.assetKind) }),
        description: t("Try another keyword or loosen the filters to explore more from Civitai."),
        hints: [t("Change keywords"), t("Adjust filters")],
    });
}

function renderModelCardStatusBadge(model) {
    const activeJob = activeDownloadJobForModel(model);
    if (activeJob) {
        const total = Number(activeJob.total || 0);
        const progress = Number(activeJob.progress || 0);
        const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
        return `<span class="cmgr-card-status is-downloading"><i aria-hidden="true"></i>${pct > 0 ? `${pct}%` : escapeHtml(t("Downloading"))}</span>`;
    }
    if (isInstalled(model)) {
        return `<span class="cmgr-card-status is-installed">✓ ${escapeHtml(t("Installed"))}</span>`;
    }
    return "";
}

function renderModelCard(model, index = 0) {
    const version = getVersions(model)[0] || {};
    const badge = version.baseModel || model.baseModel || model.base_model || "Other";
    const favorite = remoteFavorite(model, state.assetKind);
    const creator = model.creator?.username ? `@${model.creator.username}` : "";
    const preview = renderCardMedia(modelPreviewMedia(model), cardMediaOptions(index));
    return `
        <article class="cmgr-card ${state.selectedModel?.id === model.id ? "selected" : ""}" data-model-id="${escapeAttr(model.id)}" tabindex="0">
            ${renderFavoriteCardMark(Boolean(favorite))}
            <div class="cmgr-card-top-badges">
                ${badge ? `<div class="cmgr-card-badge">${escapeHtml(badge)}</div>` : ""}
                ${isEarlyAccess(version) ? `<div class="cmgr-card-badge is-early-access" title="${escapeAttr(t("Early Access"))}" aria-label="${escapeAttr(t("Early Access"))}">${selectorIcon("lock")}</div>` : ""}
                <div class="cmgr-card-status-slot" data-card-status-slot>${renderModelCardStatusBadge(model)}</div>
            </div>
            <div class="cmgr-thumb">${preview}</div>
            <div class="cmgr-card-body">
                ${creator ? `<div class="cmgr-card-creator">${escapeHtml(creator)}</div>` : ""}
                <div class="cmgr-card-title">${escapeHtml(model.name || "Untitled")}</div>
                ${renderCardStats(model, version)}
            </div>
        </article>
    `;
}

function cardMediaOptions(index) {
    return { eager: index < INITIAL_PREVIEW_LOADS, priority: index < HIGH_PRIORITY_PREVIEW_LOADS ? "high" : "auto" };
}

function renderCardStats(model, version = {}) {
    const stats = modelStats(model, version);
    const firstFile = getFiles(version)[0] || {};
    const sizeText = firstFile.sizeKB ? formatBytes(firstFile.sizeKB * 1024) : "";
    return renderSelectorStats(formatStatCount(stats.downloadCount), formatStatCount(stats.likeCount), sizeText);
}

function renderModelActionHub(model, version = {}, file = {}, resolution = state.resolution) {
    const favorite = remoteFavorite(model);
    const activeJob = activeDownloadJobForModel(model, version);
    const installedAsset = findInstalledAssetForModel(model, version);
    const selection = selectionSummary(getFiles(version), state.selectedFileNames, {
        includeComponents: detailAssetKind() === "checkpoint",
    });
    const totalBytes = selection.count ? selection.totalBytes : Number(file.sizeKB || 0) * 1024;
    const multiSelected = selection.count > 1;
    const inlineCta = !activeJob && !installedAsset;
    const favoriteHtml = renderFavoriteControls({
        favorite: Boolean(favorite),
        folders: state.favoriteFolders,
        folderId: favorite?.folder_id || "",
        toggleAction: "favorite-model",
        folderAction: "assign-model-favorite-folder",
        compact: true,
    });
    let primaryHtml = "";
    if (activeJob) {
        primaryHtml = `
            <div class="cmgr-detail-download-progress">
                ${renderDownloadProgress(activeJob)}
                <div class="cmgr-detail-download-progress-actions">
                    <button class="cmgr-secondary cmgr-mini-btn" type="button" data-action="open-downloads-tab">${escapeHtml(t("View Downloads"))}</button>
                    <button class="cmgr-secondary cmgr-mini-btn is-danger" type="button" data-action="cancel-download" data-task-id="${escapeAttr(activeJob.id)}">${escapeHtml(t("Cancel Download"))}</button>
                </div>
            </div>
        `;
    } else if (installedAsset) {
        primaryHtml = `
            <div class="cmgr-detail-installed-bar">
                <div class="cmgr-detail-installed-badge">
                    <span class="cmgr-installed-check" aria-hidden="true">✓</span>
                    <div>
                        <b>${escapeHtml(t("In Local Library"))}</b>
                        <span>${escapeHtml(installedAsset.relative_path || installedAsset.filename || "")}</span>
                    </div>
                </div>
                <div class="cmgr-detail-installed-actions">
                    <button class="cmgr-primary cmgr-mini-btn" type="button" data-action="view-in-library" data-asset-id="${escapeAttr(installedAsset.id)}">${escapeHtml(t("View in Library"))}</button>
                    <button class="cmgr-secondary cmgr-mini-btn" type="button" data-action="download" data-download-selection="true" ${resolution?.download_url ? "" : "disabled"} title="${escapeAttr(t("Re-download"))}">${escapeHtml(t("Re-download"))}</button>
                </div>
            </div>
        `;
    } else {
        primaryHtml = `
            <button class="cmgr-primary cmgr-download-cta" type="button" data-action="download" data-download-selection="true" ${resolution?.download_url ? "" : "disabled"}${multiSelected ? ` title="${escapeAttr(t("{count} files selected", { count: selection.count }))}"` : ""}>
                <span class="cmgr-download-cta-icon" aria-hidden="true">↓</span>
                <span class="cmgr-download-cta-label">${escapeHtml(downloadCtaLabel(totalBytes))}</span>
            </button>
        `;
    }
    return `
        <div class="cmgr-detail-action-hub ${inlineCta ? "is-inline-cta" : ""}">
            ${primaryHtml}
            ${favoriteHtml}
        </div>
    `;
}

function renderModelDetail(model) {
    const versions = getVersions(model);
    const version = getSelectedVersion() || versions[0] || {};
    const files = getFiles(version);
    const file = getSelectedFile() || files[0] || {};
    const resolution = state.resolution;
    const stats = modelStats(model, version);
    const trainedWords = (Array.isArray(version.trainedWords) ? version.trainedWords : [])
        .map((word) => String(word || "").trim())
        .filter(Boolean);
    const modelUrl = `https://civitai.red/models/${encodeURIComponent(model.id || "")}${version.id ? `?modelVersionId=${encodeURIComponent(version.id)}` : ""}`;
    return `
        <div class="cmgr-detail-scroll">
            ${renderDetailGallery(galleryItemsForModel(model, version), model.name || "", modelPreviewMedia(model).emptyText)}
            <div class="cmgr-detail-head">
                <div>
                    <a class="cmgr-detail-title-link" href="${escapeAttr(modelUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(t("Open model page"))}">
                        <h2>${escapeHtml(model.name || "Untitled")}</h2>
                        <span class="cmgr-external-icon" aria-hidden="true">↗</span>
                    </a>
                    <p>${escapeHtml(model.creator?.username || t("Unknown creator"))}</p>
                    <div class="cmgr-detail-meta">
                        ${renderDetailFacts(modelFacts(model, version, file))}
                        ${renderSelectorStats(formatStatCount(stats.downloadCount), formatStatCount(stats.likeCount))}
                    </div>
                </div>
            </div>
            <section class="cmgr-detail-download-card">
                ${versions.length > 1 ? `
                    <div class="cmgr-detail-field-block">
                        <label class="cmgr-label">${selectorIcon("layers")}${escapeHtml(t("Version"))}</label>
                        ${renderSelectMenu({
                            id: "selected-version",
                            value: String(version.id || ""),
                            options: versions.map((item) => ({ value: String(item.id || ""), label: `${item.name || item.id} · ${item.baseModel || "Other"}` })),
                            inputAttrs: 'data-field="selected-version"',
                            className: "cmgr-full",
                        })}
                    </div>
                ` : `<input type="hidden" data-field="selected-version" value="${escapeAttr(version.id || "")}" />`}
                ${renderFilePicker(files, String(file.name || file.id || ""), {
                    includeComponents: detailAssetKind() === "checkpoint",
                    checkedNames: Array.isArray(state.selectedFileNames) ? state.selectedFileNames : undefined,
                    rowFor: (pickerFile, role) => ({
                        rootKind: fileTargetRootKind(pickerFile, role, version),
                        targetOptions: fileTargetOptions(),
                    }),
                })}
                ${findInstalledAssetForModel(model, version) ? "" : renderEarlyAccessNotice(model, version)}
                ${renderModelActionHub(model, version, file, resolution)}
                ${renderPathBox()}
            </section>
            ${trainedWords.length ? `
                <section class="cmgr-selector-triggers" aria-label="${escapeAttr(t("Trigger Words"))}">
                <div class="cmgr-section-head">
                    <div class="cmgr-section-title">${selectorIcon("tag")}${escapeHtml(t("Trigger Words"))}</div>
                    ${trainedWords.length > 1 ? `<button class="cmgr-copy-all-btn" type="button" data-copy="${escapeAttr(trainedWords.join(", "))}">${escapeHtml(t("Copy All ({count})", { count: trainedWords.length }))}</button>` : ""}
                </div>
                <div class="cmgr-trained">
                    ${trainedWords.slice(0, 16).map((word) => `<button type="button" data-copy="${escapeAttr(word)}">${escapeHtml(word)}</button>`).join("")}
                </div>
                </section>
            ` : ""}
            ${renderDetailTags(model.tags, state.activeTab === "Discover")}
            <details class="cmgr-selector-section" data-section="description" open>
                <summary>${selectorIcon("file")}<span>${escapeHtml(t("Description"))}</span></summary>
                <div class="cmgr-selector-section-body"><div class="cmgr-description">${"description" in model ? sanitizeDescriptionHtml(model.description || version.description || "") : renderDescriptionSkeleton()}</div></div>
            </details>
        </div>
    `;
}

function renderEmptyModelDetail() {
    if (state.loadingSearch) return renderDetailSkeleton();
    return renderEmptySidebarDetail(
        t("Select a model"),
        t("Model details, versions, files, and download path will stay here."),
        "discover",
    );
}

function configuredTargetKinds() {
    const configured = Array.isArray(state.config?.target_kinds) ? state.config.target_kinds : [];
    return configured.length ? configured : DEFAULT_TARGET_KINDS;
}

function targetKindOptions() {
    return configuredTargetKinds()
        .filter((kind) => kind?.id)
        .map((kind) => ({ value: kind.id, label: t(kind.label || kind.id) }));
}

function settingsRootEntries(roots = {}) {
    const configured = Array.isArray(state.config?.target_kinds) ? state.config.target_kinds : [];
    const entries = configured.length
        ? configured.map((item) => ({ id: item.id, label: item.label || item.id, path: item.path || roots[item.id] || "" }))
        : ROOT_KINDS.map((item) => ({ id: item.id, label: item.label, path: roots[item.id] || "" }));
    return entries.filter((item) => item.path);
}

function renderPathEditor(resolution) {
    const rootKind = state.pathOverrides.root_kind || resolution?.root_kind || "";
    const structured = ["checkpoints", "unet", "loras"].includes(rootKind);
    const workflow = rootKind === "workflows";
    const flat = Boolean(rootKind) && !structured && !workflow;
    const categoryEditable = structured || workflow;
    return `
        <div class="cmgr-path-drawer">
            <div class="cmgr-grid2">
                <label>${escapeHtml(t("Type"))}${renderSelectMenu({
                    id: "override-root-kind",
                    value: rootKind,
                    options: targetKindOptions(),
                    inputAttrs: 'data-override="root_kind"',
                })}</label>
                <label>${escapeHtml(t("Base Model"))}<input class="cmgr-input" data-override="base_model_dir" value="${escapeAttr(state.pathOverrides.base_model_dir || "")}" ${structured ? "" : "disabled"} /></label>
                <label>${escapeHtml(t("Category"))}<input class="cmgr-input" data-override="category_dir" value="${escapeAttr(state.pathOverrides.category_dir || "")}" ${categoryEditable ? "" : "disabled"} /></label>
                <label>${escapeHtml(t("Filename"))}<input class="cmgr-input" data-override="filename" value="${escapeAttr(state.pathOverrides.filename || "")}" /></label>
            </div>
            ${flat ? `<p class="cmgr-path-hint">${escapeHtml(t("This folder keeps files directly, without Base Model or Category subfolders."))}</p>` : ""}
            <div class="cmgr-path">${escapeHtml(resolution.absolute_path || "")}</div>
        </div>
    `;
}

function renderPathBox() {
    const resolution = state.resolution;
    const open = Boolean(state.pathEditorOpen);
    const previewPath = resolution
        ? `${resolution.root_kind || state.pathOverrides.root_kind || ""}/${resolution.relative_path || resolution.filename || ""}`.replace(/\/+/g, "/")
        : t(state.resolvingPath ? "Resolving path..." : "No path resolved yet.");
    return `
        <div class="cmgr-path-box ${open ? "is-open" : "is-collapsed"}">
            <div class="cmgr-path-summary-row">
                <div class="cmgr-path-summary-main" title="${escapeAttr(resolution?.absolute_path || previewPath)}">
                    <span class="cmgr-path-folder-icon" aria-hidden="true">📁</span>
                    <span class="cmgr-path-summary-text">${escapeHtml(previewPath)}</span>
                </div>
                <button class="cmgr-path-toggle-btn" type="button" data-action="toggle-path-editor" aria-expanded="${open ? "true" : "false"}">
                    <span>${escapeHtml(t(open ? "Hide path options" : "Customize path"))}</span>
                    <i aria-hidden="true">${open ? "▴" : "▾"}</i>
                </button>
            </div>
            ${resolution?.exists ? `<div class="cmgr-warning cmgr-path-conflict">${escapeHtml(t("A file already exists at this path. The downloader will keep both by adding a numeric suffix."))}</div>` : ""}
            ${resolution && open ? renderPathEditor(resolution) : ""}
        </div>
    `;
}

function renderLibrary() {
    const toolbar = renderSelectorToolbar({
        title: `${t("Library")} · ${assetKindLabel(state.assetKind)}`,
        headingHtml: renderToolbarKindTabs(),
        className: "cmgr-library-selector-toolbar",
        searchHtml: renderSelectorSearch({
            value: state.libraryQuery,
            inputAttrs: 'data-field="library-query"',
            placeholder: t("Filter local models..."),
            clearAction: "clear-library-search",
        }),
        actionsHtml: `
            ${libraryMetadataBatch.running
                ? `<button class="cmgr-selector-button" data-action="cancel-enrich-library">${escapeHtml(t("Stop matching"))}</button>`
                : ""}
            <button class="cmgr-selector-button" type="button" data-action="refresh-library" ${libraryMetadataBatch.running ? "disabled" : ""}>${selectorIcon("refresh")}<span>${escapeHtml(t(state.libraryLoading ? "Scanning..." : "Refresh"))}</span></button>
            <details class="cmgr-selector-tools">
                <summary class="is-icon" aria-label="${escapeAttr(t("Actions"))}" title="${escapeAttr(t("Actions"))}" aria-haspopup="menu">${selectorIcon("more")}</summary>
                <div class="cmgr-selector-menu" role="menu" aria-label="${escapeAttr(t("Actions"))}">
                    <button type="button" role="menuitem" data-action="enrich-library" ${libraryMetadataBatch.running ? "disabled" : ""}>${selectorIcon("match")}<span>${escapeHtml(t("Match missing Civitai info"))}</span></button>
                </div>
            </details>
        `,
        filterBarHtml: renderActiveFilterBar(),
    });
    return `
        <section class="cmgr-page cmgr-library">
            ${toolbar}
            ${renderLibraryMetadataBatchStatus()}
            <div class="cmgr-split has-detail ${state.detailOpen ? "is-detail-open" : ""}">
                <div class="cmgr-results">
                    ${renderLibraryResults()}
                </div>
                ${assetDetailAside()}
            </div>
        </section>
    `;
}

function renderLibraryResults() {
    const items = filteredLibraryItems();
    return items.length
        ? items.map(renderAssetCard).join("")
        : renderCollectionEmptyState({
            kind: "library",
            kicker: t("Library"),
            title: t("No local {kind} found", { kind: assetKindLabel(state.assetKind) }),
            description: t("Try changing the current filters or refresh the local model library."),
            hints: [t("Change filters"), t("Refresh library")],
        });
}

function renderAssetCard(asset, index = 0) {
    const badge = asset.base_model
        || (isStructuredRootKind(asset.root_kind) ? (inferBaseFromPath(asset) || "Other") : labelForRoot(asset.root_kind));
    const favorite = localFavorite(asset);
    return `
        <article class="cmgr-card asset ${state.selectedAssetId === asset.id ? "selected" : ""}" data-asset-id="${escapeAttr(asset.id)}" tabindex="0">
            ${renderFavoriteCardMark(Boolean(favorite))}
            <div class="cmgr-thumb small">${renderCardMedia(asset.has_preview ? asset.thumb_url : "", cardMediaOptions(index))}</div>
            ${badge ? `<div class="cmgr-card-badge">${escapeHtml(badge)}</div>` : ""}
            <div class="cmgr-card-body">
                <div class="cmgr-card-title">${escapeHtml(asset.name || asset.filename)}</div>
            </div>
        </article>
    `;
}

function renderAssetDetail(asset) {
    const baseValue = asset.base_model || inferBaseFromPath(asset);
    const categoryValue = asset.category || inferCategoryFromPath(asset);
    const moveFields = moveFieldVisibility(asset.root_kind);
    const matched = assetHasCivitaiMatch(asset);
    const favorite = localFavorite(asset);
    const civitaiUrl = asset.civitai_url || (asset.model_id ? `https://civitai.red/models/${encodeURIComponent(asset.model_id)}${asset.version_id ? `?modelVersionId=${encodeURIComponent(asset.version_id)}` : ""}` : "");
    const words = (asset.trained_words || []).map((word) => String(word || "").trim()).filter(Boolean);
    const title = escapeHtml(asset.name || asset.filename);
    return `
        <div class="cmgr-detail-scroll">
            ${renderDetailGallery(galleryItemsForUrl(asset.has_preview ? asset.thumb_url : ""), asset.name || asset.filename)}
            <div class="cmgr-detail-head">
                <div>
                    ${civitaiUrl
                        ? `<a class="cmgr-detail-title-link" href="${escapeAttr(civitaiUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(t("Open model page"))}"><h2>${title}</h2><span class="cmgr-external-icon" aria-hidden="true">↗</span></a>`
                        : `<h2>${title}</h2>`}
                    <p>${escapeHtml([asset.creator, asset.version_name].filter(Boolean).join(" · ") || t("Local file"))}</p>
                    <div class="cmgr-detail-meta">${renderDetailFacts([labelForRoot(asset.root_kind), baseValue, categoryValue].filter((value) => value !== "Other").concat(formatBytes(asset.size || 0)))}</div>
                </div>
            </div>
            <section class="cmgr-detail-download-card">
                <div class="cmgr-detail-action-hub is-inline-cta">
                    ${asset.root_kind === "workflows"
                        ? `<div class="cmgr-detail-cta-stack">
                            <button class="cmgr-primary cmgr-detail-local-cta" type="button" data-action="open-workflow">${selectorIcon("layers")}<span>${escapeHtml(t("Open in ComfyUI"))}</span></button>
                            <button class="cmgr-secondary cmgr-detail-local-cta" type="button" data-action="open-folder">${selectorIcon("local")}<span>${escapeHtml(t("Open Folder"))}</span></button>
                        </div>`
                        : `<button class="cmgr-secondary cmgr-detail-local-cta" type="button" data-action="open-folder">${selectorIcon("local")}<span>${escapeHtml(t("Open Folder"))}</span></button>`}
                    ${renderFavoriteControls({
                        favorite: Boolean(favorite),
                        folders: state.favoriteFolders,
                        folderId: favorite?.folder_id || "",
                        toggleAction: "favorite-asset",
                        folderAction: "assign-asset-favorite-folder",
                        compact: true,
                    })}
                </div>
                ${renderMatchRow(matched, asset, "enrich-asset", libraryMetadataBatch.running)}
            </section>
            ${words.length || asset.root_kind === "loras" ? `
                <section class="cmgr-selector-triggers" aria-label="${escapeAttr(t("Trigger Words"))}">
                    <div class="cmgr-section-head">
                        <div class="cmgr-section-title">${selectorIcon("tag")}${escapeHtml(t("Trigger Words"))}</div>
                        ${words.length > 1 ? `<button class="cmgr-copy-all-btn" type="button" data-copy="${escapeAttr(words.join(", "))}">${escapeHtml(t("Copy All ({count})", { count: words.length }))}</button>` : ""}
                    </div>
                    <div class="cmgr-trained">
                        ${words.slice(0, 16).map((word) => `<button type="button" data-copy="${escapeAttr(word)}">${escapeHtml(word)}</button>`).join("") || `<span>${escapeHtml(t("No trained words cached."))}</span>`}
                    </div>
                </section>
            ` : ""}
            ${renderDetailTags(asset.tags, false)}
            <details class="cmgr-selector-section" data-section="file" open>
                <summary>${selectorIcon("file")}<span>${escapeHtml(t("File"))}</span></summary>
                <div class="cmgr-selector-section-body">
                    <div class="cmgr-info-list">
                        <div><span>${escapeHtml(t("File"))}</span><b>${escapeHtml(asset.filename)}</b></div>
                        <div><span>${escapeHtml(t("Relative Path"))}</span><b>${escapeHtml(asset.relative_path)}</b></div>
                        <div><span>${escapeHtml(t("Absolute Path"))}</span><b>${escapeHtml(asset.absolute_path || "")}</b></div>
                    </div>
                    <div class="cmgr-detail-danger-row">
                        <span><b>${escapeHtml(t("Delete local file"))}</b><small>${escapeHtml(t("Also removes companion metadata"))}</small></span>
                        <button class="cmgr-danger" type="button" data-action="delete-asset">${escapeHtml(t("Delete"))}</button>
                    </div>
                </div>
            </details>
            <details class="cmgr-selector-section">
                <summary>${selectorIcon("local")}<span>${escapeHtml(t("Move / Rename"))}</span></summary>
                <div class="cmgr-selector-section-body">
                <div class="cmgr-grid2">
                    <label>${escapeHtml(t("Type"))}${renderSelectMenu({
                        id: "move-root-kind",
                        value: asset.root_kind || "",
                        options: moveTargetKindOptions(asset),
                        inputAttrs: 'data-move="target_root_kind"',
                    })}</label>
                    <label>${escapeHtml(t("Base Model"))}<input class="cmgr-input" data-move="base_model_dir" value="${escapeAttr(baseValue || "Other")}" ${moveFields.base ? "" : "disabled"} /></label>
                    <label>${escapeHtml(t("Category"))}<input class="cmgr-input" data-move="category_dir" value="${escapeAttr(categoryValue || "Other")}" ${moveFields.category ? "" : "disabled"} /></label>
                    <label>${escapeHtml(t("Filename"))}<input class="cmgr-input" data-move="filename" value="${escapeAttr(asset.filename)}" /></label>
                </div>
                <p class="cmgr-path-hint" data-move-flat-hint ${moveFields.structured ? "hidden" : ""}>${escapeHtml(t("This folder keeps files directly, without Base Model or Category subfolders."))}</p>
                <button class="cmgr-secondary cmgr-full" data-action="move-asset">${escapeHtml(t("Move Asset"))}</button>
                </div>
            </details>
        </div>
    `;
}

function renderEmptyAssetDetail() {
    return renderEmptySidebarDetail(
        t("Select a local model"),
        t("Local model metadata, preview, location, and management actions will stay here."),
        "library",
    );
}

function renderEmptySidebarDetail(title, description, kind = "model") {
    return `
        <div class="cmgr-detail-scroll cmgr-empty-detail-scroll">
            <div class="cmgr-empty-detail" data-empty-kind="${escapeAttr(kind)}">
                <div class="cmgr-empty-detail-art" aria-hidden="true">
                    <span class="cmgr-empty-detail-orbit orbit-one"></span>
                    <span class="cmgr-empty-detail-orbit orbit-two"></span>
                    <span class="cmgr-empty-detail-card card-back"></span>
                    <span class="cmgr-empty-detail-card card-front"><i></i><i></i><i></i></span>
                    <span class="cmgr-empty-detail-spark spark-one"></span>
                    <span class="cmgr-empty-detail-spark spark-two"></span>
                </div>
                <div class="cmgr-empty-detail-copy">
                    <span class="cmgr-empty-detail-kicker">${escapeHtml(t("Details"))}</span>
                    <h2>${escapeHtml(title)}</h2>
                    <p>${escapeHtml(description)}</p>
                </div>
                <div class="cmgr-empty-detail-features" aria-hidden="true"><span>${escapeHtml(t("Preview"))}</span><span>${escapeHtml(t("Metadata"))}</span><span>${escapeHtml(t("Actions"))}</span></div>
            </div>
        </div>
    `;
}

function downloadPageOptions() {
    return { title: t("Downloads"), jobs: Object.values(state.downloads || {}), actionsFor: downloadActions };
}

function renderDownloads() {
    return renderDownloadPage(downloadPageOptions());
}

function downloadedAsset(job) {
    return state.libraryItems.find((item) => (job.relative_path && item.relative_path === job.relative_path)
        || (job.version_id && String(item.version_id || "") === String(job.version_id))
        || (job.model_id && String(item.model_id || "") === String(job.model_id))) || null;
}

function downloadActions(job) {
    const taskButton = (action, label, className = "cmgr-secondary") => `<button class="${className}" type="button" data-action="${action}" data-task-id="${escapeAttr(job.id)}">${escapeHtml(t(label))}</button>`;
    if (ACTIVE_DOWNLOAD_STATUSES.has(job.status)) return job.status === "cancelling" ? "" : taskButton("cancel-download", "Cancel");
    const asset = job.status === "completed" ? downloadedAsset(job) : null;
    const workflow = job.status === "completed" && job.root_kind === "workflows" && job.relative_path
        ? `<button class="cmgr-primary" type="button" data-action="open-workflow" data-root-kind="workflows" data-relative-path="${escapeAttr(job.relative_path)}">${escapeHtml(t("Open in ComfyUI"))}</button>`
        : "";
    return `
        ${["failed", "cancelled"].includes(job.status) ? taskButton("retry-download", "Retry", "cmgr-primary") : ""}
        ${workflow}
        ${asset ? `<button class="cmgr-secondary" type="button" data-action="show-downloaded-asset" data-asset-id="${escapeAttr(asset.id)}">${escapeHtml(t("View in Library"))}</button>` : ""}
        <button class="cmgr-dl-remove" type="button" data-action="remove-download" data-task-id="${escapeAttr(job.id)}" title="${escapeAttr(t("Remove record"))}" aria-label="${escapeAttr(t("Remove record"))}">${selectorIcon("close")}</button>
    `;
}

function renderSettings() {
    const config = state.config || {};
    const roots = config.roots || {};
    const rootEntries = settingsRootEntries(roots);
    return `
        <section class="cmgr-page settings">
            <div class="cmgr-settings-grid">
                <div class="cmgr-settings-column">
                    <div class="cmgr-settings-form cmgr-setting-card">
                        <div class="cmgr-settings-head">
                            <div>
                                <h2>${escapeHtml(t("Connection"))}</h2>
                                <p>${escapeHtml(t("Civitai API access and restricted content permissions."))}</p>
                            </div>
                            <span class="cmgr-setting-status ${config.api_key_set ? "is-set" : ""}">${escapeHtml(t(config.api_key_set ? "Key saved" : "No key"))}</span>
                        </div>
                        <label class="cmgr-label">${escapeHtml(t("Civitai API Key"))}</label>
                        <input class="cmgr-input cmgr-full" data-setting="civitai_api_key" type="password" value="" placeholder="${escapeAttr(t(config.api_key_set ? "Leave blank to keep the saved key" : "Optional, required for restricted downloads"))}" />
                        <div class="cmgr-action-row">
                            <button class="cmgr-secondary" data-action="test-api">${escapeHtml(t(state.apiTesting ? "Testing..." : "Test API"))}</button>
                            ${config.api_key_set ? `<button class="cmgr-secondary" data-action="clear-api-key">${escapeHtml(t("Clear Saved Key"))}</button>` : ""}
                        </div>
                    </div>

                    <div class="cmgr-settings-form cmgr-setting-card">
                        <div class="cmgr-settings-head">
                            <div>
                                <h2>${escapeHtml(t("Download Defaults"))}</h2>
                                <p>${escapeHtml(t("Defaults used when queueing models and companion files."))}</p>
                            </div>
                        </div>
                        <div class="cmgr-check-list">
                            <label class="cmgr-check"><input type="checkbox" data-setting="allow_nsfw" ${config.allow_nsfw ? "checked" : ""}/> <span>${escapeHtml(t("Allow NSFW results"))}</span></label>
                            <label class="cmgr-check"><input type="checkbox" data-setting="save_metadata" ${config.save_metadata !== false ? "checked" : ""}/> <span>${escapeHtml(t("Save companion metadata JSON"))}</span></label>
                            <label class="cmgr-check"><input type="checkbox" data-setting="save_preview" ${config.save_preview !== false ? "checked" : ""}/> <span>${escapeHtml(t("Save companion preview image"))}</span></label>
                        </div>
                    </div>
                </div>

                <div class="cmgr-settings-column">
                    <div class="cmgr-settings-form cmgr-setting-card">
                        <div class="cmgr-settings-head">
                            <div>
                                <h2>${escapeHtml(t("Workflow Storage"))}</h2>
                                <p>${escapeHtml(t("Online workflows are saved here as JSON files."))}</p>
                            </div>
                        </div>
                        <label class="cmgr-label">${escapeHtml(t("Workflow Directory"))}</label>
                        <input class="cmgr-input cmgr-full" data-setting="workflow_dir" value="${escapeAttr(config.workflow_dir || "")}" />
                    </div>

                    <div class="cmgr-roots cmgr-setting-card">
                        <div class="cmgr-settings-head">
                            <div>
                                <h2>${escapeHtml(t("Resolved Roots"))}</h2>
                                <p>${escapeHtml(t("Model roots detected from ComfyUI folder paths."))}</p>
                            </div>
                            <span class="cmgr-setting-status">${escapeHtml(t("{count} folders", { count: rootEntries.length }))}</span>
                        </div>
                        <div class="cmgr-root-list">
                            ${rootEntries.map((root) => `
                                <div class="cmgr-root-row">
                                    <span>${escapeHtml(t(root.label))}</span>
                                    <b title="${escapeAttr(root.path)}">${escapeHtml(root.path)}</b>
                                </div>
                            `).join("")}
                        </div>
                    </div>
                </div>

                <div class="cmgr-settings-footer">
                    <button class="cmgr-primary" data-action="save-settings" aria-busy="${state.settingsSaving ? "true" : "false"}" ${state.settingsSaving ? "disabled" : ""}>${escapeHtml(t(state.settingsSaving ? "Saving..." : "Save Settings"))}</button>
                </div>
            </div>
        </section>
    `;
}

function bindCommonEvents(root) {
    bindSelectMenus(root);
    bindSelectorMenus(root);
    root.querySelectorAll("[data-copy]").forEach((btn) => {
        btn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(btn.dataset.copy || "");
                btn.classList.add("is-copied");
                setTimeout(() => btn.classList.remove("is-copied"), 1400);
                showToast(t("Copied"));
            } catch (_) {
                showToast(t("Copy failed"));
            }
        };
    });
    root.querySelectorAll("[data-asset-kind]").forEach((btn) => {
        btn.onclick = () => selectAssetKind(btn.dataset.assetKind);
    });
    // One chip per selected value, so each clear button only drops that value.
    root.querySelectorAll('[data-action="clear-filter-base"]').forEach((btn) => {
        btn.onclick = () => selectBaseModels(state.selectedBaseModels.filter((value) => value !== btn.dataset.clearValue));
    });
    const clearTag = root.querySelector('[data-action="clear-filter-tag"]');
    if (clearTag) clearTag.onclick = () => selectTag("");
    const clearPeriod = root.querySelector('[data-action="clear-filter-period"]');
    if (clearPeriod) clearPeriod.onclick = () => selectModelPeriod("AllTime");
    root.querySelectorAll('[data-action="clear-filter-file-format"]').forEach((btn) => {
        btn.onclick = () => selectModelFileFormats(state.fileFormats.filter((value) => value !== btn.dataset.clearValue));
    });
    root.querySelectorAll('[data-action="clear-filter-model-status"]').forEach((btn) => {
        btn.onclick = () => selectModelStatuses(state.modelStatuses.filter((value) => value !== btn.dataset.clearValue));
    });
    const clearCategory = root.querySelector('[data-action="clear-filter-category"]');
    if (clearCategory) clearCategory.onclick = () => {
        if (state.activeTab === "Discover") state.selectedCivitaiCategory = "";
        else state.selectedCategory = "";
        state.selectedModel = null;
        state.selectedAssetId = "";
        state.resolution = null;
        if (state.activeTab === "Discover") search(true, { silent: true });
        else render();
    };
    const resetAll = root.querySelector('[data-action="reset-all-filters"]');
    if (resetAll) resetAll.onclick = resetManagerFilters;
    root.querySelectorAll('[data-action="view-in-library"]').forEach((btn) => {
        btn.onclick = () => showInLibrary(btn.dataset.assetId || "");
    });
    root.querySelectorAll('[data-action="open-downloads-tab"]').forEach((btn) => {
        btn.onclick = () => switchManagerTab("Downloads");
    });
}

function showInLibrary(assetId) {
    const asset = state.libraryItems.find((item) => String(item.id) === String(assetId));
    switchManagerTab("Library");
    if (!asset) return;
    selectAssetKind(libraryKindForRoot(asset.root_kind));
    state.selectedAssetId = asset.id;
    render();
    bodyEl.querySelector(".cmgr-library .cmgr-card.selected")?.scrollIntoView({ block: "center" });
}

function bindActiveTabEvents(root) {
    if (state.activeTab === "Discover" && state.assetKind === IMAGES_KIND) {
        bindImageEvents(root);
        observeCardMedia(root);
        return;
    }
    if (state.activeTab === "Discover") bindDiscoverEvents(root);
    if (state.activeTab === "Library") bindLibraryEvents(root);
    if (state.activeTab === "Favorites") bindFavoritesEvents(root);
    if (state.activeTab === "Downloads") bindDownloadsEvents(root);
    if (state.activeTab === "Settings") bindSettingsEvents(root);
    observeCardMedia(root);
}

function filteredFavorites() {
    return filterFavoriteItems(state.favoriteItems, {
        folderId: state.selectedFavoriteFolderId,
        query: state.favoriteQuery,
    });
}

function favoriteTypeLabel(item) {
    if (item?.asset_kind === "checkpoint") return "Checkpoint/UNet";
    if (item?.asset_kind === "workflow") return t("Workflow");
    return "LoRA";
}

function renderFavorites() {
    const toolbar = renderSelectorToolbar({
        title: t("Favorites"),
        className: "cmgr-favorites-selector-toolbar",
        searchHtml: renderSelectorSearch({
            value: state.favoriteQuery,
            inputAttrs: 'data-field="favorite-query"',
            placeholder: t("Search favorites..."),
            clearAction: "clear-favorite-search",
        }),
        actionsHtml: `<span class="cmgr-selector-total">${filteredFavorites().length}</span>`,
    });
    return `
        <section class="cmgr-page cmgr-favorites-page">
            ${toolbar}
            <div class="cmgr-split has-detail ${state.detailOpen ? "is-detail-open" : ""}">
                <div class="cmgr-results">
                    ${renderFavoriteResults()}
                </div>
                ${favoriteDetailAside()}
            </div>
        </section>
    `;
}

function renderFavoriteResults() {
    const items = filteredFavorites();
    if (state.favoritesLoading && !items.length) return renderCardSkeletons(30);
    return items.length
        ? items.map(renderFavoriteCard).join("")
        : renderCollectionEmptyState({
            kind: "favorites",
            kicker: t("Favorites"),
            title: state.favoriteQuery ? t("No matching favorites") : t("Your favorites will appear here"),
            description: state.favoriteQuery
                ? t("Try another keyword or clear the current search.")
                : state.selectedFavoriteFolderId
                    ? t("This folder is empty. Move a favorite here to start organizing it.")
                    : t("Save models from Discover or your local library for quick access later."),
            hints: [t("Remote models"), t("Local models"), t("Custom folders")],
        });
}

function renderFavoriteCard(item, index = 0) {
    const model = favoriteModel(item);
    const localAsset = localAssetForFavorite(item, state.libraryItems);
    const media = model ? modelPreviewMedia(model) : item.preview_url || (localAsset?.has_preview ? localAsset.thumb_url : "");
    const preview = renderCardMedia(media, cardMediaOptions(index));
    return `
        <article class="cmgr-card cmgr-favorite-card ${state.selectedFavoriteKey === item.key ? "selected" : ""}" data-favorite-key="${escapeAttr(item.key)}" tabindex="0">
            <div class="cmgr-thumb">${preview}</div>
            <div class="cmgr-card-badge">${escapeHtml(favoriteTypeLabel(item))}</div>
            <div class="cmgr-card-body">
                <div class="cmgr-card-title">${escapeHtml(item.name || "Untitled")}</div>
                <div class="cmgr-card-tags">
                    ${localAsset ? `<span class="installed">${escapeHtml(t("Installed"))}</span>` : ""}
                    ${item.base_model ? `<span>${escapeHtml(item.base_model)}</span>` : ""}
                </div>
            </div>
        </article>
    `;
}

function renderFavoriteDetail(item) {
    const model = favoriteModel(item);
    if (model) return renderModelDetail(String(state.selectedModel?.id || "") === String(model.id) ? state.selectedModel : model);
    const asset = localAssetForFavorite(item, state.libraryItems);
    if (asset) return renderAssetDetail(asset);
    return `
        <div class="cmgr-detail-scroll">
            ${renderDetailGallery(galleryItemsForUrl(item.preview_url || ""), item.name || "")}
            <div class="cmgr-detail-head"><div><h2>${escapeHtml(item.name || "Untitled")}</h2><p>${escapeHtml(favoriteTypeLabel(item))} · ${escapeHtml(item.creator || t("Unknown creator"))}</p></div></div>
            ${renderFavoriteControls({
                favorite: true,
                folders: state.favoriteFolders,
                folderId: item.folder_id,
                toggleAction: "toggle-selected-favorite",
                folderAction: "assign-selected-favorite-folder",
            })}
        </div>
    `;
}

function renderEmptyFavoriteDetail() {
    return renderEmptySidebarDetail(
        t("Select a favorite"),
        t("Favorite details and available actions will stay here."),
        "favorites",
    );
}

function renderFavoritesSidebar() {
    return renderFavoriteFolderSidebar({
        folders: state.favoriteFolders,
        items: state.favoriteItems,
        selectedId: state.selectedFavoriteFolderId,
        editor: state.favoriteFolderEditor,
    });
}

function bindFavoritesSidebar(root) {
    bindFavoriteFolderSidebar(root, {
        onSelect: (folderId) => {
            if (state.selectedFavoriteFolderId === folderId) return;
            state.selectedFavoriteFolderId = folderId;
            state.selectedFavoriteKey = "";
            state.favoriteFolderEditor = null;
            state.scroll.favoriteResults = 0;
            render();
        },
        onEdit: (editor) => {
            state.favoriteFolderEditor = editor;
            refreshNav();
        },
        onSave: (editor) => void saveFavoriteFolder(editor),
        onDelete: (folderId) => void deleteFavoriteFolder(folderId),
    });
}

function refreshImageDetail() {
    const split = bodyEl?.querySelector(".cmgr-images .cmgr-split");
    if (!split) return;
    split.classList.toggle("is-detail-open", Boolean(imageState.selectedImage));
    const aside = split.querySelector(":scope > .cmgr-detail");
    if (aside) aside.outerHTML = renderImageDetailAside();
    else split.insertAdjacentHTML("beforeend", renderImageDetailAside());
    bindCommonEvents(bodyEl);
    bindImageEvents(bodyEl);
    observeCardMedia(split.querySelector(".cmgr-detail"));
}

function syncImageCardSelection() {
    bodyEl?.querySelectorAll("[data-image-id]").forEach((card) => {
        card.classList.toggle("selected", String(card.dataset.imageId) === String(imageState.selectedId));
    });
}

async function selectImage(image) {
    if (!image) return;
    imageState.selectedId = String(image.id || "");
    imageState.selectedImage = image;
    imageState.resources = [];
    imageState.checked = [];
    imageState.overrides = {};
    imageState.resourceError = "";
    openDetailDrawer();
    syncImageCardSelection();
    refreshImageDetail();
    await resolveImageResourcesFromSelection();
}

async function resolveImageResourcesFromSelection() {
    imageState.loadingResources = true;
    refreshImageDetail();
    await resolveImageResources();
    imageState.loadingResources = false;
    refreshImageDetail();
}

function reloadImageFeed() {
    if (state.activeTab !== "Discover" || state.assetKind !== IMAGES_KIND) return;
    imageState.nextCursor = "";
    // Drop the old page and paint the skeletons before the request leaves. Waiting
    // for the network kept the previous pictures (and the open menu) on screen, so
    // a filter click looked like the panel had frozen.
    imageState.items = [];
    imageState.loading = true;
    render();
    void loadImageFeed({ reset: true }).then(() => render());
}

function setImageBaseModels(values) {
    const next = uniqueFilterValues(values);
    if (sameFilterValues(imageState.baseModels, next)) return;
    imageState.baseModels = next;
    reloadImageFeed();
}

function setImagePeriod(period) {
    const next = String(period || "AllTime");
    if (imageState.period === next) return;
    imageState.period = next;
    reloadImageFeed();
}

function setImageSort(sort) {
    const next = String(sort || "Newest");
    if (imageState.sort === next) return;
    imageState.sort = next;
    reloadImageFeed();
}

function resetImageFilters() {
    imageState.baseModels = [];
    imageState.period = "AllTime";
    reloadImageFeed();
}

function openImageFromQuery(value) {
    const imageId = parseImageLink(value);
    if (!imageId) return false;
    if (imageSearchTimer) clearTimeout(imageSearchTimer);
    imageSearchTimer = null;
    void openImageLink(imageId);
    return true;
}

function bindImageEvents(root) {
    const queryInput = root.querySelector('[data-field="image-query"]');
    const clearSearch = root.querySelector('[data-action="clear-image-search"]');
    if (queryInput) {
        queryInput.oninput = () => {
            imageState.query = queryInput.value;
            if (clearSearch) clearSearch.hidden = !imageState.query;
            if (imageSearchTimer) clearTimeout(imageSearchTimer);
            // A pasted Civitai link opens that image instead of searching text.
            // Bare ids only open on Enter so a numeric search stays a search.
            if (/civitai\.(?:com|red)\//i.test(queryInput.value) && parseImageLink(queryInput.value)) {
                imageSearchTimer = setTimeout(() => openImageFromQuery(queryInput.value), 250);
                return;
            }
            imageSearchTimer = setTimeout(async () => {
                imageSearchTimer = null;
                if (state.activeTab !== "Discover" || state.assetKind !== IMAGES_KIND) return;
                await loadImageFeed({ reset: true });
                render();
            }, 350);
        };
        queryInput.onpaste = () => {
            setTimeout(() => {
                if (queryInput.value !== imageState.query) queryInput.oninput();
            }, 0);
        };
        queryInput.onkeydown = (event) => {
            if (event.key !== "Enter") return;
            if (openImageFromQuery(queryInput.value)) return;
            if (imageSearchTimer) clearTimeout(imageSearchTimer);
            imageSearchTimer = null;
            void loadImageFeed({ reset: true }).then(() => render());
        };
    }
    if (clearSearch) clearSearch.onclick = () => {
        imageState.query = "";
        if (queryInput) queryInput.value = "";
        clearSearch.hidden = true;
        void loadImageFeed({ reset: true }).then(() => render());
    };
    const refresh = root.querySelector('[data-action="refresh-images"]');
    if (refresh) refresh.onclick = () => void loadImageFeed({ reset: true }).then(() => render());
    root.querySelectorAll('[data-image-sort]').forEach((button) => {
        button.onclick = () => setImageSort(button.dataset.imageSort || "Newest");
    });
    root.querySelectorAll('[data-action="clear-image-base-model"]').forEach((btn) => {
        btn.onclick = () => setImageBaseModels(
            imageState.baseModels.filter((value) => value !== btn.dataset.clearValue),
        );
    });
    const clearPeriod = root.querySelector('[data-action="clear-image-period"]');
    if (clearPeriod) clearPeriod.onclick = () => setImagePeriod("AllTime");
    const resetFilters = root.querySelector('[data-action="reset-image-filters"]');
    if (resetFilters) resetFilters.onclick = resetImageFilters;
    const results = root.querySelector(".cmgr-image-results");
    if (results) {
        results.onscroll = () => {
            const remaining = results.scrollHeight - results.scrollTop - results.clientHeight;
            if (remaining > 600 || imageState.loading || imageState.loadingMore || !imageState.nextCursor) return;
            void loadMoreImages();
        };
    }
    root.querySelectorAll("[data-image-id]").forEach((card) => {
        card.onclick = () => void selectImage(imageState.items.find((item) => String(item.id) === String(card.dataset.imageId)));
        card.onkeydown = (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            card.click();
        };
    });
    root.querySelectorAll("[data-image-file-check]").forEach((box) => {
        box.onchange = () => {
            const key = String(box.dataset.imageFileCheck || "");
            const set = new Set((imageState.checked || []).map(String));
            if (box.checked) set.add(key);
            else set.delete(key);
            imageState.checked = [...set];
            box.closest("[data-image-file-row]")?.classList.toggle("is-checked", box.checked);
            refreshImageDetail();
        };
    });
    root.querySelectorAll("[data-image-file-target]").forEach((select) => {
        select.onchange = () => {
            imageState.overrides = { ...(imageState.overrides || {}), [select.dataset.imageFileTarget]: select.value };
        };
    });
    const selectAll = root.querySelector('[data-action="select-all-image-files"]');
    if (selectAll) selectAll.onclick = () => {
        const all = [];
        imageState.resources.forEach((resource, index) => {
            imageResourceKeys(resource, index).forEach((key) => all.push(key));
        });
        imageState.checked = checkedImageFiles().length ? [] : all;
        refreshImageDetail();
    };
    const download = root.querySelector('[data-action="download-image-files"]');
    if (download) download.onclick = async () => {
        download.disabled = true;
        try {
            const { queued, failures } = await downloadCheckedImageFiles();
            await loadDownloads(false);
            syncLiveDownloadSurfaces();
            if (queued) showToast(t("Queued {count} downloads", { count: queued }));
            if (failures.length) showToast(failures[0]);
        } catch (err) {
            showToast(err.message);
        }
        refreshImageDetail();
    };
}

async function loadMoreImages() {
    const results = bodyEl?.querySelector(".cmgr-image-results");
    const startIndex = imageState.items.length;
    results?.insertAdjacentHTML("beforeend", renderCardSkeletons(6, { loadMore: true }));
    await loadImageFeed({ reset: false });
    if (!results?.isConnected) return;
    results.querySelectorAll(".cmgr-load-more-skeleton").forEach((item) => item.remove());
    const fresh = imageState.items.slice(startIndex);
    if (fresh.length) {
        results.insertAdjacentHTML("beforeend", fresh.map((image, index) => renderImageCard(image, startIndex + index)).join(""));
        bindImageEvents(bodyEl);
        observeCardMedia(results);
    }
}

async function openImageLink(imageId) {
    imageState.loadingResources = true;
    imageState.resourceError = "";
    imageState.resources = [];
    imageState.checked = [];
    imageState.overrides = {};
    imageState.selectedImage = { id: imageId, url: "" };
    imageState.selectedId = String(imageId);
    openDetailDrawer();
    refreshImageDetail();
    await openImageById(imageId);
    imageState.loadingResources = false;
    if (imageState.resourceError) showToast(imageState.resourceError);
    render();
}

function bindDiscoverEvents(root) {
    const queryInput = root.querySelector('[data-field="query"]');
    const clearSearch = root.querySelector('[data-action="clear-search"]');
    if (queryInput) {
        queryInput.oninput = () => {
            state.query = queryInput.value;
            if (clearSearch) clearSearch.hidden = !state.query;
            scheduleResponsiveSearch();
        };
        queryInput.onkeydown = (event) => {
            if (event.key === "Enter") {
                if (responsiveSearchTimer) {
                    clearTimeout(responsiveSearchTimer);
                    responsiveSearchTimer = null;
                }
                lastResponsiveSearchKey = currentSearchSignature();
                search(true, { forceRefresh: true });
            }
        };
    }
    if (clearSearch) clearSearch.onclick = () => {
        state.query = "";
        if (queryInput) queryInput.value = "";
        clearSearch.hidden = true;
        if (responsiveSearchTimer) {
            clearTimeout(responsiveSearchTimer);
            responsiveSearchTimer = null;
        }
        search(true, { silent: true });
    };
    root.querySelectorAll('[data-selector-sort]').forEach((button) => {
        button.onclick = () => {
            cancelActiveSearch();
            state.sort = button.dataset.selectorSort;
            void search(true, { silent: true });
        };
    });
    const searchBtn = root.querySelector('[data-action="search"]');
    if (searchBtn) searchBtn.onclick = () => {
        if (responsiveSearchTimer) {
            clearTimeout(responsiveSearchTimer);
            responsiveSearchTimer = null;
        }
        lastResponsiveSearchKey = currentSearchSignature();
        search(true, { forceRefresh: true });
    };
    const moreBtn = root.querySelector('[data-action="load-more"]');
    if (moreBtn) moreBtn.onclick = () => search(false);
    attachRememberedScroll(root.querySelector(".cmgr-results"), "discoverResults", maybeAutoLoadMore);
    root.querySelectorAll("[data-model-id]").forEach((card) => {
        const favBtn = card.querySelector("[data-card-favorite]");
        if (favBtn) {
            favBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const model = state.searchItems.find((item) => String(item.id) === String(card.dataset.modelId));
                if (model) void toggleRemoteFavorite(model, state.assetKind);
            };
        }
        card.onclick = () => {
            const results = card.closest(".cmgr-results");
            if (results) {
                state.scroll.discoverResults = results.scrollTop;
            }
            openDetailDrawer();
            if (String(state.selectedModel?.id || "") === String(card.dataset.modelId || "")) {
                return;
            }
            const model = state.searchItems.find((item) => String(item.id) === String(card.dataset.modelId));
            if (model) selectModel(model);
        };
    });
    root.querySelectorAll("[data-detail-tag]").forEach((button) => {
        button.onclick = () => {
            state.detailOpen = false;
            selectTag(button.dataset.detailTag);
        };
    });
    const switchVersion = async (nextVersionId) => {
        if (!nextVersionId || String(state.selectedVersionId) === String(nextVersionId)) return;
        state.selectedVersionId = String(nextVersionId);
        state.selectedFileName = defaultFileName(getSelectedVersion());
        state.pathOverrides = {};
        state.resolution = null;
        resetFileSelection(getSelectedVersion(), state.selectedFileName);
        if (state.activeTab === "Favorites") renderSelectedFavoriteDetail();
        else renderSelectedModelDetail();
        await resolveSelectedPath({ detailOnly: true, pathOnly: true });
    };
    const versionSelect = root.querySelector('[data-field="selected-version"]');
    if (versionSelect) versionSelect.onchange = () => void switchVersion(versionSelect.value);
    root.querySelectorAll("[data-file-option]").forEach((button) => {
        button.onclick = async () => {
            const name = button.dataset.fileOption || "";
            if (!name) return;
            // Clicking the row is the selection gesture: no Ctrl needed for a
            // bulk download, and clicking it again removes the tick.
            const checked = (state.selectedFileNames || []).map(String).includes(String(name));
            setFileChecked(name, !checked);
            syncFilePickerSelection(root);
            if (name === state.selectedFileName) return;
            state.selectedFileName = name;
            // Start from whatever target this file already had so switching the
            // focused file never discards another row's folder choice.
            state.pathOverrides = { ...(state.fileOverrides?.[name] || {}) };
            const picker = button.closest("[data-file-picker]");
            picker?.querySelectorAll("[data-file-row]").forEach((row) => {
                row.classList.toggle("is-selected", row.dataset.fileRow === name);
            });
            await resolveSelectedPath({ detailOnly: true, pathOnly: true });
        };
    });
    root.querySelectorAll("[data-file-check]").forEach((box) => {
        box.onchange = () => {
            setFileChecked(box.dataset.fileCheck || "", box.checked);
            syncFilePickerSelection(root);
        };
    });
    root.querySelectorAll("[data-file-target]").forEach((select) => {
        select.onchange = async () => {
            const key = String(select.dataset.fileTarget || "");
            if (!key) return;
            // A different folder kind invalidates the subfolders of the old one,
            // so only the kind is kept and the backend fills in the rest.
            state.fileOverrides[key] = { root_kind: select.value };
            if (key === fileKey(getSelectedFile())) {
                state.pathOverrides = { ...state.fileOverrides[key] };
                await resolveSelectedPath({ detailOnly: true, pathOnly: true });
            } else {
                await resolveFileTarget(key);
            }
        };
    });
    const selectAllFiles = root.querySelector('[data-action="select-all-files"]');
    if (selectAllFiles) {
        selectAllFiles.onclick = () => {
            const picker = selectAllFiles.closest("[data-file-picker]");
            const boxes = picker ? [...picker.querySelectorAll("[data-file-check]")] : [];
            const allChecked = boxes.length > 0 && boxes.every((box) => box.checked);
            state.selectedFileNames = allChecked ? [] : boxes.map((box) => String(box.dataset.fileCheck || "")).filter(Boolean);
            syncFilePickerSelection(root);
        };
    }
    const togglePathBtn = root.querySelector('[data-action="toggle-path-editor"]');
    if (togglePathBtn) {
        togglePathBtn.onclick = () => {
            state.pathEditorOpen = !state.pathEditorOpen;
            if (!updateSelectedPathPanel()) render();
        };
    }
    root.querySelectorAll("[data-override]").forEach((input) => {
        input.onchange = async () => {
            state.pathOverrides[input.dataset.override] = input.value;
            await resolveSelectedPath({ detailOnly: true, pathOnly: true });
        };
    });
    const downloadBtn = root.querySelector('[data-action="download"]');
    if (downloadBtn) {
        downloadBtn.onclick = () => (
            downloadBtn.dataset.downloadSelection
                ? startDownloadFromSelection()
                : startDownload()
        );
    }
    root.querySelectorAll('[data-action="cancel-download"]').forEach((btn) => {
        btn.onclick = () => cancelDownload(btn.dataset.taskId);
    });
    const favoriteBtn = root.querySelector('[data-action="favorite-model"]');
    if (favoriteBtn) favoriteBtn.onclick = () => void toggleRemoteFavorite();
    const favoriteFolder = root.querySelector('[data-action="assign-model-favorite-folder"]');
    if (favoriteFolder) favoriteFolder.onchange = () => void assignFavoriteFolder(remoteFavorite(), favoriteFolder.value);
}

function openDetailDrawer() {
    state.detailOpen = true;
    setDetailDrawer(bodyEl, true);
}

function bindLibraryEvents(root) {
    root.querySelectorAll("[data-library-filter]").forEach((btn) => {
        btn.onclick = () => {
            state.libraryFilter = btn.dataset.libraryFilter;
            render();
        };
    });
    const refresh = root.querySelector('[data-action="refresh-library"]');
    if (refresh) refresh.onclick = () => loadLibrary(true);
    const enrichLibrary = root.querySelector('[data-action="enrich-library"]');
    if (enrichLibrary) enrichLibrary.onclick = () => enrichVisibleLibraryMetadata();
    const cancelEnrichLibrary = root.querySelector('[data-action="cancel-enrich-library"]');
    if (cancelEnrichLibrary) cancelEnrichLibrary.onclick = () => cancelLibraryMetadataBatch();
    attachRememberedScroll(root.querySelector(".cmgr-results"), "libraryResults");
    const queryInput = root.querySelector('[data-field="library-query"]');
    const clearSearch = root.querySelector('[data-action="clear-library-search"]');
    const updateSearchResults = () => {
        const results = root.querySelector(".cmgr-results");
        if (!results) return;
        results.innerHTML = renderLibraryResults();
        bindLibraryCards(root);
        observeCardMedia(root);
    };
    if (queryInput) queryInput.oninput = () => {
        state.libraryQuery = queryInput.value;
        if (clearSearch) clearSearch.hidden = !state.libraryQuery;
        updateSearchResults();
    };
    if (clearSearch) clearSearch.onclick = () => {
        state.libraryQuery = "";
        if (queryInput) {
            queryInput.value = "";
            queryInput.focus();
        }
        clearSearch.hidden = true;
        updateSearchResults();
    };
    bindLibraryCards(root);
    const move = root.querySelector('[data-action="move-asset"]');
    if (move) move.onclick = () => {
        moveSelectedAsset(readMoveForm(root));
    };
    const moveRootKind = root.querySelector('[data-move="target_root_kind"]');
    const moveBaseModel = root.querySelector('[data-move="base_model_dir"]');
    const moveCategory = root.querySelector('[data-move="category_dir"]');
    const moveFlatHint = root.querySelector("[data-move-flat-hint]");
    const syncMoveFields = () => {
        const visibility = moveFieldVisibility(moveRootKind?.value || "");
        if (moveBaseModel) moveBaseModel.disabled = !visibility.base;
        if (moveCategory) moveCategory.disabled = !visibility.category;
        if (moveFlatHint) moveFlatHint.hidden = visibility.structured;
    };
    if (moveRootKind) {
        moveRootKind.onchange = syncMoveFields;
        syncMoveFields();
    }
    const del = root.querySelector('[data-action="delete-asset"]');
    if (del) del.onclick = () => deleteSelectedAsset();
    const enrich = root.querySelector('[data-action="enrich-asset"]');
    if (enrich) enrich.onclick = () => enrichSelectedAsset();
    const favorite = root.querySelector('[data-action="favorite-asset"]');
    if (favorite) favorite.onclick = () => toggleSelectedFavorite();
    const favoriteFolder = root.querySelector('[data-action="assign-asset-favorite-folder"]');
    if (favoriteFolder) favoriteFolder.onchange = () => void assignFavoriteFolder(localFavorite(), favoriteFolder.value);
    const openFolder = root.querySelector('[data-action="open-folder"]');
    if (openFolder) openFolder.onclick = () => openSelectedFolder();
    const openWorkflow = root.querySelector('[data-action="open-workflow"]');
    if (openWorkflow) openWorkflow.onclick = () => {
        const asset = getSelectedAsset();
        if (asset) openWorkflowAsset(assetLocationPayload(asset));
    };
}

function bindLibraryCards(root) {
    root.querySelectorAll("[data-asset-id]").forEach((card) => {
        const favBtn = card.querySelector("[data-card-favorite]");
        if (favBtn) {
            favBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const asset = state.libraryItems.find((item) => String(item.id || "") === String(card.dataset.assetId || ""));
                if (asset) void toggleLocalFavorite(asset);
            };
        }
        card.onclick = () => {
            const results = card.closest(".cmgr-results");
            if (results) {
                state.scroll.libraryResults = results.scrollTop;
            }
            openDetailDrawer();
            if (String(state.selectedAssetId || "") === String(card.dataset.assetId || "")) {
                return;
            }
            state.selectedAssetId = card.dataset.assetId;
            if (!renderSelectedAssetDetail()) render();
        };
    });
}

function bindDownloadsEvents(root) {
    const page = root.querySelector(".cmgr-dl-page");
    if (!page) return;
    hydrateDownloadDetails(page);
    // Rows are patched in place while polling, so actions are delegated.
    page.onclick = (event) => {
        if (handleDownloadDetailsClick(event)) return;
        const button = event.target.closest("[data-action]");
        const taskId = button?.dataset.taskId || "";
        const actions = {
            "cancel-download": () => cancelDownload(taskId),
            "retry-download": () => retryDownload(taskId),
            "remove-download": () => removeDownloadRecord(taskId),
            "clear-downloads": () => removeDownloadRecord(),
            "show-downloaded-asset": () => showInLibrary(button.dataset.assetId || ""),
            "open-download-folder": () => openDownloadFolder(button.dataset),
            "open-workflow": () => openWorkflowAsset({ root_kind: button.dataset.rootKind, relative_path: button.dataset.relativePath }),
        };
        actions[button?.dataset.action]?.();
    };
}

function bindSettingsEvents(root) {
    const save = root.querySelector('[data-action="save-settings"]');
    if (save) save.onclick = () => saveSettings(readSettingsForm(root), root);
    const test = root.querySelector('[data-action="test-api"]');
    if (test) test.onclick = () => testApiConnection();
    const clear = root.querySelector('[data-action="clear-api-key"]');
    if (clear) clear.onclick = () => clearApiKey();
}

function readMoveForm(root) {
    const form = {};
    root.querySelectorAll("[data-move]").forEach((input) => {
        form[input.dataset.move] = input.value;
    });
    return form;
}

function readSettingsForm(root) {
    const form = {};
    root.querySelectorAll("[data-setting]").forEach((input) => {
        form[input.dataset.setting] = input.type === "checkbox" ? input.checked : input.value;
    });
    return form;
}

function assetKindLabel(kind) {
    return t(ASSET_KINDS.find((item) => item.id === kind)?.label || kind || "Asset");
}

function rootKindsForAssetKind(kind) {
    if (kind === OTHER_LIBRARY_KIND) {
        const classic = new Set(ASSET_KINDS.flatMap((item) => item.rootKinds || []));
        const ids = new Set(configuredTargetKinds().map((item) => item.id));
        state.libraryItems.forEach((item) => {
            if (item?.root_kind) ids.add(item.root_kind);
        });
        return Array.from(ids).filter((id) => id && !classic.has(id));
    }
    const found = ASSET_KINDS.find((item) => item.id === kind);
    if (Array.isArray(found?.rootKinds)) return found.rootKinds;
    if (kind === "workflow") return ["workflows"];
    if (kind === "checkpoint") return ["checkpoints", "unet"];
    return ["loras"];
}

function moveTargetKindOptions(asset) {
    const workflow = asset?.root_kind === "workflows";
    const options = targetKindOptions().filter((option) => (
        workflow ? option.value === "workflows" : option.value !== "workflows"
    ));
    if (asset?.root_kind && !options.some((option) => option.value === asset.root_kind)) {
        options.unshift({ value: asset.root_kind, label: labelForRoot(asset.root_kind) });
    }
    return options;
}

function moveFieldVisibility(rootKind) {
    const root = String(rootKind || "");
    const structured = ["checkpoints", "unet", "loras"].includes(root);
    return {
        structured,
        base: structured,
        category: structured || root === "workflows",
    };
}

function assetMatchesKind(asset, kind = state.assetKind) {
    return rootKindsForAssetKind(kind).includes(asset.root_kind);
}

function libraryKindForRoot(rootKind) {
    const found = ASSET_KINDS.find((item) => (item.rootKinds || []).includes(rootKind));
    return found?.id || OTHER_LIBRARY_KIND;
}

function assetCategory(asset) {
    return asset.category || inferCategoryFromPath(asset) || "Other";
}

function assetBaseModel(asset) {
    return asset.base_model || inferBaseFromPath(asset) || "Other";
}

function assetTags(asset) {
    return Array.isArray(asset?.tags)
        ? asset.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
        : [];
}

function activeFilterText() {
    const category = state.activeTab === "Discover" ? categoryFilterLabel(state.selectedCivitaiCategory) : localFolderFilterLabel(state.selectedCategory);
    return [state.selectedBaseModels.join(", "), category, state.selectedTag]
        .filter(Boolean)
        .join(" · ");
}

function localFolderFilterLabel(value) {
    const folder = normalizeLocalFolderPath(value);
    if (!folder) return "";
    if (folder === ROOT_LOCAL_FOLDER) return "Root files";
    return folder;
}

function categoryFilterLabel(value) {
    if (!value) return "";
    return CIVITAI_CATEGORY_FILTERS.find((item) => item.value === value)?.label || value;
}

function ensureSelectedOption(items, selected) {
    const list = Array.isArray(items) ? items : [];
    if (!selected || list.some((item) => item.name === selected)) return list;
    return [{ name: selected, count: 0 }, ...list];
}

// Selections that are not in the taxonomy yet (for example the base model a
// shared card carried) still have to render as a ticked row.
function ensureSelectedOptions(items, selected) {
    const values = uniqueFilterValues(selected);
    return values.reduceRight(
        (list, value) => ensureSelectedOption(list, value),
        Array.isArray(items) ? items : [],
    );
}

function uniqueFilterValues(values) {
    const result = [];
    (Array.isArray(values) ? values : [values]).forEach((value) => {
        const clean = String(value ?? "").trim();
        if (!clean) return;
        if (result.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
        result.push(clean);
    });
    return result;
}

function sameFilterValues(left, right) {
    const a = uniqueFilterValues(left).map((item) => item.toLowerCase());
    const b = uniqueFilterValues(right).map((item) => item.toLowerCase());
    return a.length === b.length && a.every((item, index) => item === b[index]);
}

function currentBaseModelItems() {
    const taxonomy = currentTaxonomy();
    return state.activeTab === "Library" ? libraryBaseModelsForKind(state.assetKind) : taxonomy.baseModels;
}

function currentTagItems() {
    const taxonomy = currentTaxonomy();
    return state.activeTab === "Library" ? libraryTagsForKind(state.assetKind) : taxonomy.tags;
}

function normalizePickerChoice(value, items) {
    const clean = String(value || "").trim();
    if (!clean) return "";
    const match = (Array.isArray(items) ? items : []).find((item) => String(item?.name || "").toLowerCase() === clean.toLowerCase());
    return match?.name || clean;
}

function filteredLibraryItems() {
    const selectedFolder = normalizeLocalFolderPath(state.selectedCategory);
    const query = String(state.libraryQuery || "").trim().toLocaleLowerCase();
    return state.libraryItems.filter((item) => {
        if (!assetMatchesKind(item)) return false;
        if (state.selectedBaseModels.length && !state.selectedBaseModels.some((value) => assetBaseModel(item).toLowerCase() === value.toLowerCase())) return false;
        if (selectedFolder && !assetMatchesLocalFolder(item, selectedFolder)) return false;
        if (state.selectedTag && !assetTags(item).some((tag) => tag.toLowerCase() === state.selectedTag.toLowerCase())) return false;
        if (query && ![
            item.name,
            item.filename,
            item.relative_path,
            item.creator,
            assetBaseModel(item),
            ...assetTags(item),
        ].some((value) => String(value || "").toLocaleLowerCase().includes(query))) return false;
        return true;
    });
}

function libraryCountForKind(kind) {
    return state.libraryItems.filter((item) => assetMatchesKind(item, kind)).length;
}

function libraryFolderTreeForKind(kind) {
    const root = { count: 0, rootFileCount: 0, children: new Map() };
    state.libraryItems.filter((item) => assetMatchesKind(item, kind)).forEach((item) => {
        root.count += 1;
        const parts = itemLocalFolderParts(item);
        if (!parts.length) {
            root.rootFileCount += 1;
            return;
        }
        let children = root.children;
        let currentPath = "";
        parts.forEach((part) => {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (!children.has(part)) {
                children.set(part, { name: part, path: currentPath, count: 0, children: new Map() });
            }
            const node = children.get(part);
            node.count += 1;
            children = node.children;
        });
    });
    return {
        count: root.count,
        rootFileCount: root.rootFileCount,
        children: sortLocalFolderNodes(root.children),
    };
}

function sortLocalFolderNodes(children) {
    return Array.from(children.values())
        .map((node) => ({
            ...node,
            children: sortLocalFolderNodes(node.children),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function assetMatchesLocalFolder(asset, selectedFolder) {
    const folder = itemLocalFolderPath(asset);
    if (selectedFolder === ROOT_LOCAL_FOLDER) return !folder;
    return folder === selectedFolder || folder.startsWith(`${selectedFolder}/`);
}

function itemLocalFolderPath(asset) {
    return itemLocalFolderParts(asset).join("/");
}

function itemLocalFolderParts(asset) {
    let parts;
    if (typeof asset?.folder_path === "string") {
        parts = splitLocalPath(asset.folder_path);
    } else {
        parts = splitLocalPath(asset?.relative_path);
        parts.pop();
    }
    const rootKind = String(asset?.root_kind || "");
    const classic = ["checkpoints", "unet", "loras", "workflows"];
    if (rootKind && !classic.includes(rootKind)) {
        // The Other tab mixes several model folders; keep them apart in the tree.
        return [labelForRoot(rootKind), ...parts];
    }
    return parts;
}

function normalizeLocalFolderPath(value) {
    if (value === ROOT_LOCAL_FOLDER) return ROOT_LOCAL_FOLDER;
    return splitLocalPath(value).join("/");
}

function splitLocalPath(value) {
    return String(value || "")
        .replaceAll("\\", "/")
        .split("/")
        .filter((part) => part && part !== ".");
}

function libraryBaseModelsForKind(kind) {
    const counts = state.libraryItems.filter((item) => assetMatchesKind(item, kind)).reduce((acc, item) => {
        const baseModel = assetBaseModel(item);
        acc[baseModel] = (acc[baseModel] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function libraryTagsForKind(kind) {
    const counts = state.libraryItems.filter((item) => assetMatchesKind(item, kind)).reduce((acc, item) => {
        assetTags(item).forEach((tag) => {
            acc[tag] = (acc[tag] || 0) + 1;
        });
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function countByRoot() {
    return state.libraryItems.reduce((acc, item) => {
        acc[item.root_kind] = (acc[item.root_kind] || 0) + 1;
        return acc;
    }, {});
}

function activeDownloadCount() {
    return Object.values(state.downloads || {}).filter((job) => ["pending", "downloading"].includes(job.status)).length;
}

function isInstalled(model) {
    const modelId = String(model?.id || "");
    if (!modelId) return false;
    return state.libraryItems.some((item) => String(item.model_id || "") === modelId);
}

function findInstalledAssetForModel(model, version = null) {
    const modelId = String(model?.id || "");
    const versionId = String(version?.id || "");
    if (versionId) {
        const exact = state.libraryItems.find((item) => String(item.version_id || "") === versionId);
        if (exact) return exact;
    }
    if (modelId) {
        const byModel = state.libraryItems.find((item) => String(item.model_id || "") === modelId);
        if (byModel) return byModel;
    }
    return null;
}

function activeDownloadJobForModel(model, version = null) {
    const modelId = String(model?.id || "");
    const versionId = String(version?.id || "");
    const jobs = Object.values(state.downloads || {}).filter((job) =>
        ACTIVE_DOWNLOAD_STATUSES.has(job?.status)
    );
    if (versionId) {
        const byVersion = jobs.find((job) => String(job.version_id || "") === versionId);
        if (byVersion) return byVersion;
    }
    if (modelId) {
        const byModel = jobs.find((job) => String(job.model_id || "") === modelId);
        if (byModel) return byModel;
    }
    return null;
}

function isStructuredRootKind(rootKind) {
    return ["checkpoints", "unet", "loras"].includes(String(rootKind || ""));
}

function inferBaseFromPath(asset) {
    if (!isStructuredRootKind(asset?.root_kind)) return "";
    const parts = String(asset.relative_path || "").split("/");
    return parts.length > 2 ? parts[0] : "Other";
}

function inferCategoryFromPath(asset) {
    const parts = String(asset.relative_path || "").split("/");
    if (asset?.root_kind === "workflows") return parts.length > 1 ? parts[0] : "Other";
    if (!isStructuredRootKind(asset?.root_kind)) return "";
    return parts.length > 2 ? parts[1] : "Other";
}

function labelForRoot(rootKind) {
    const known = ROOT_KINDS.find((root) => root.id === rootKind)?.label
        || DEFAULT_TARGET_KINDS.find((root) => root.id === rootKind)?.label;
    if (known) return t(known);
    if (!rootKind) return t("Asset");
    const prettified = String(rootKind)
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
    return t(prettified);
}

function modelPreviewMedia(model) {
    const source = findModelPreviewSource(model);
    if (source) return createPreviewMedia(source, 450);
    const messageKey = isModelPreviewFiltered(model, state.contentFilterActive)
        ? "Preview hidden by content settings"
        : "No Preview";
    return { url: "", type: "image", emptyText: t(messageKey) };
}

function bindFavoritesEvents(root) {
    const queryInput = root.querySelector('[data-field="favorite-query"]');
    const clearSearch = root.querySelector('[data-action="clear-favorite-search"]');
    const updateResults = () => {
        const results = root.querySelector(".cmgr-favorites-page .cmgr-results");
        if (!results) return;
        results.innerHTML = renderFavoriteResults();
        bindFavoriteCards(root);
        observeCardMedia(results);
    };
    if (queryInput) queryInput.oninput = () => {
        state.favoriteQuery = queryInput.value;
        if (clearSearch) clearSearch.hidden = !state.favoriteQuery;
        updateResults();
    };
    if (clearSearch) clearSearch.onclick = () => {
        state.favoriteQuery = "";
        if (queryInput) {
            queryInput.value = "";
            queryInput.focus();
        }
        clearSearch.hidden = true;
        updateResults();
    };
    attachRememberedScroll(root.querySelector(".cmgr-favorites-page .cmgr-results"), "favoriteResults");
    bindFavoriteCards(root);
    const item = selectedFavorite();
    const model = favoriteModel(item);
    const asset = item ? localAssetForFavorite(item, state.libraryItems) : null;
    const detail = root.querySelector(".cmgr-favorites-page .cmgr-detail");
    if (model && detail) bindDiscoverEvents(detail);
    if (asset && !model) {
        const move = detail?.querySelector('[data-action="move-asset"]');
        if (move) move.onclick = () => moveSelectedAsset(readMoveForm(detail));
        const del = detail?.querySelector('[data-action="delete-asset"]');
        if (del) del.onclick = () => deleteSelectedAsset();
        const enrich = detail?.querySelector('[data-action="enrich-asset"]');
        if (enrich) enrich.onclick = () => enrichSelectedAsset();
        const favorite = detail?.querySelector('[data-action="favorite-asset"]');
        if (favorite) favorite.onclick = () => void toggleLocalFavorite(asset);
        const openFolder = detail?.querySelector('[data-action="open-folder"]');
        if (openFolder) openFolder.onclick = () => openSelectedFolder();
        const openWorkflow = detail?.querySelector('[data-action="open-workflow"]');
        if (openWorkflow) openWorkflow.onclick = () => openWorkflowAsset(asset);
        const folder = detail?.querySelector('[data-action="assign-asset-favorite-folder"]');
        if (folder) folder.onchange = () => void assignFavoriteFolder(item, folder.value);
    }
    const genericToggle = detail?.querySelector('[data-action="toggle-selected-favorite"]');
    if (genericToggle) genericToggle.onclick = () => void setFavoriteItem(item, false).then(() => {
        showToast(t("Removed favorite"));
        render();
    }).catch((err) => {
        state.error = err.message;
        render();
    });
    const genericFolder = detail?.querySelector('[data-action="assign-selected-favorite-folder"]');
    if (genericFolder) genericFolder.onchange = () => void assignFavoriteFolder(item, genericFolder.value);
}

function bindFavoriteCards(root) {
    root.querySelectorAll("[data-favorite-key]").forEach((card) => {
        card.onclick = () => {
            const results = card.closest(".cmgr-results");
            if (results) state.scroll.favoriteResults = results.scrollTop;
            openDetailDrawer();
            if (card.dataset.favoriteKey === state.selectedFavoriteKey) return;
            const item = state.favoriteItems.find((entry) => entry.key === card.dataset.favoriteKey);
            if (item) void selectFavoriteItem(item);
        };
    });
}

function sanitizeDescriptionHtml(html) {
    const raw = String(html || "").trim();
    if (!raw) return `<span class="cmgr-muted">${escapeHtml(t("No description available."))}</span>`;
    const allowed = new Set(["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "pre", "code", "blockquote", "h1", "h2", "h3", "h4"]);
    const template = document.createElement("template");
    template.innerHTML = raw
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");

    const renderNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        const tag = node.tagName.toLowerCase();
        const children = Array.from(node.childNodes).map(renderNode).join("");
        if (!allowed.has(tag)) return children;
        if (tag === "br") return "<br>";
        if (tag === "a") {
            const href = String(node.getAttribute("href") || "").trim();
            const safeHref = /^(https?:)?\/\//i.test(href) || href.startsWith("#") ? href : "";
            return safeHref
                ? `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer">${children || escapeHtml(safeHref)}</a>`
                : children;
        }
        return `<${tag}>${children}</${tag}>`;
    };

    const cleaned = Array.from(template.content.childNodes).map(renderNode).join("").trim();
    if (cleaned) return cleaned;
    const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text ? `<p>${escapeHtml(text)}</p>` : `<span class="cmgr-muted">${escapeHtml(t("No description available."))}</span>`;
}

function showToast(message) {
    state.toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        state.toast = "";
        updateTransientMessages();
    }, 1800);
    updateTransientMessages();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
}
