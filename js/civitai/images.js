import { apiGet, apiPost } from "./api.js";
import { renderCardMedia, renderCardSkeletons } from "./card_media.js";
import { renderActiveFilterChips, renderCollectionEmptyState } from "./components.js";
import { formatBytes, formatStatCount, galleryItemsForUrl, isEarlyAccess, renderDetailDismiss, renderDetailGallery, renderEarlyAccessNotice } from "./detail.js";
import { fileKey, fileRole } from "./file_picker.js";
import { t } from "./i18n.js";
import { createPreviewMedia } from "./media.js";
import { renderSelectorCombo, renderSelectorSearch, renderSelectorToolbar, selectorIcon } from "./selector_ui.js";

export const IMAGES_KIND = "images";
const PAGE_SIZE = 40;
const DOWNLOADABLE_KINDS = new Set(["checkpoint", "lora", "workflow"]);
// Civitai's image feed only sorts these ways, and only filters base model and
// period; the model categories and tags have no image counterpart there.
// These five values are the ones the endpoint accepts; anything else is a 400.
export const IMAGE_SORTS = [
    { value: "Most Reactions", label: "Most Reactions" },
    { value: "Most Comments", label: "Most Comments" },
    { value: "Most Collected", label: "Most Collected" },
    { value: "Newest", label: "Newest" },
    { value: "Oldest", label: "Oldest" },
];
export const IMAGE_PERIODS = [
    { value: "AllTime", label: "All time" },
    { value: "Year", label: "Past year" },
    { value: "Month", label: "Past month" },
    { value: "Week", label: "Past week" },
    { value: "Day", label: "Past day" },
];

/** Reads an image id out of a pasted Civitai link, or a bare id. */
export function parseImageLink(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^\d{4,}$/.test(text)) return text;
    const match = text.match(/civitai\.(?:com|red)\/(?:images|i)\/(\d+)/i);
    return match ? match[1] : "";
}

export function imagePeriodValue(label) {
    return IMAGE_PERIODS.find((item) => t(item.label) === label)?.value || "AllTime";
}

// The image feed keeps its own list so switching between Discover kinds never
// throws away the pictures the user was looking at.
export const imageState = {
    items: [],
    cursor: "",
    nextCursor: "",
    query: "",
    sort: "Most Reactions",
    period: "AllTime",
    baseModel: "",
    loading: false,
    loadingMore: false,
    error: "",
    contentFilterActive: false,
    selectedId: "",
    selectedImage: null,
    resources: [],
    loadingResources: false,
    resourceError: "",
    checked: [],
    // Per-file target folder picks, keyed the same way as `checked`.
    overrides: {},
    targets: [],
    downloading: false,
};

/** Folder choices offered next to every file, mirroring the model download picker. */
export function setImageTargets(options) {
    imageState.targets = (Array.isArray(options) ? options : [])
        .map((item) => ({ value: String(item?.value ?? ""), label: String(item?.label ?? item?.value ?? "") }))
        .filter((item) => item.value);
}

function defaultTargetFor(kind) {
    if (kind === "checkpoint") return "checkpoints";
    if (kind === "workflow") return "workflows";
    return "loras";
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

export function imageMedia(image, width = 450) {
    // The feed hands out `original=true` URLs, whose B2 variant is often still
    // missing; the legacy transformer answers with a ~25 KB thumbnail instead
    // of the multi-megabyte original.
    const media = createPreviewMedia({ url: image?.url || "", type: "image" }, width, { preferLegacy: true });
    return { ...media, emptyText: t("No Preview") };
}

// A newer load always wins, so switching kinds mid-request can never leave the
// grid showing an older page (or nothing at all).
let feedToken = 0;

export function resetImageFeed() {
    imageState.items = [];
    imageState.cursor = "";
    imageState.nextCursor = "";
    imageState.error = "";
    imageState.selectedId = "";
    imageState.selectedImage = null;
    imageState.resources = [];
    imageState.checked = [];
    imageState.overrides = {};
    // Any page still on its way belongs to the feed that was just dropped.
    feedToken += 1;
    imageState.loading = false;
    imageState.loadingMore = false;
}

export async function loadImageFeed({ reset = true, silent = false } = {}) {
    if (reset) {
        feedToken += 1;
        imageState.loading = true;
        imageState.loadingMore = false;
        if (!silent) imageState.error = "";
    } else {
        if (imageState.loading || imageState.loadingMore || !imageState.nextCursor) return;
        imageState.loadingMore = true;
    }
    const token = feedToken;
    const params = new URLSearchParams({
        query: imageState.query,
        sort: imageState.sort,
        period: imageState.period,
        limit: String(PAGE_SIZE),
    });
    if (imageState.baseModel) params.set("base_model", imageState.baseModel);
    if (!reset && imageState.nextCursor) params.set("cursor", imageState.nextCursor);
    try {
        const data = await apiGet(`/images?${params.toString()}`);
        if (token !== feedToken) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const seen = new Set(reset ? [] : imageState.items.map((item) => String(item.id)));
        imageState.items = reset ? items : [...imageState.items, ...items.filter((item) => !seen.has(String(item.id)))];
        imageState.nextCursor = String(data?.metadata?.nextCursor || "");
        imageState.contentFilterActive = data?.content_filter_active === true;
        if (data?.error) imageState.error = String(data.error);
    } catch (err) {
        if (token !== feedToken) return;
        imageState.error = err.message || String(err);
    } finally {
        if (token === feedToken) {
            imageState.loading = false;
            imageState.loadingMore = false;
        }
    }
}

export async function openImageById(rawId) {
    const clean = String(rawId || "").trim();
    if (!clean) return;
    imageState.loadingResources = true;
    imageState.resourceError = "";
    imageState.resources = [];
    imageState.checked = [];
    imageState.overrides = {};
    imageState.selectedImage = { id: clean, url: "" };
    imageState.selectedId = clean;
    try {
        const data = await apiGet(`/image-detail?id=${encodeURIComponent(clean)}`);
        imageState.selectedImage = data.image || null;
        if (imageState.selectedImage) imageState.selectedId = String(imageState.selectedImage.id || clean);
        await resolveImageResources();
    } catch (err) {
        imageState.resourceError = err.message || String(err);
    } finally {
        imageState.loadingResources = false;
    }
}

export async function resolveImageResources() {
    const resources = Array.isArray(imageState.selectedImage?.resources) ? imageState.selectedImage.resources : [];
    if (!resources.length) {
        imageState.resources = [];
        return;
    }
    try {
        const data = await apiPost("/image-resolve", { resources });
        imageState.resources = Array.isArray(data?.resources) ? data.resources : [];
    } catch (err) {
        imageState.resourceError = err.message || String(err);
    }
}

export function imageResourceFiles(resource) {
    const version = resource?.model?.modelVersions?.[0];
    return Array.isArray(version?.files) ? version.files : [];
}

export function imageResourceKeys(resource, index) {
    return imageResourceFiles(resource).map((file) => `${index}::${fileKey(file)}`);
}

export function imageFileTargetKey(resource, index, file) {
    const key = `${index}::${fileKey(file)}`;
    return String(imageState.overrides?.[key] || defaultTargetFor(resource?.kind));
}

export function checkedImageFiles() {
    const checked = new Set((imageState.checked || []).map(String));
    const picks = [];
    imageState.resources.forEach((resource, index) => {
        imageResourceFiles(resource).forEach((file) => {
            if (checked.has(`${index}::${fileKey(file)}`)) picks.push({ resource, file, index });
        });
    });
    return picks;
}

export async function downloadCheckedImageFiles() {
    const picks = checkedImageFiles();
    if (!picks.length) {
        throw new Error(t("Tick at least one file to download."));
    }
    imageState.downloading = true;
    let queued = 0;
    const failures = [];
    try {
        for (const { resource, file, index } of picks) {
            const version = resource.model?.modelVersions?.[0] || {};
            const rootKind = imageFileTargetKey(resource, index, file);
            try {
                await apiPost("/download", {
                    kind: resource.kind || "lora",
                    model: resource.model || {},
                    version,
                    file,
                    overrides: { root_kind: rootKind },
                });
                queued += 1;
            } catch (err) {
                failures.push(`${file.name || file.id}: ${err.message}`);
            }
        }
    } finally {
        imageState.downloading = false;
    }
    return { queued, failures };
}

export function renderImageCard(image, index = 0) {
    const selected = String(image.id) === String(imageState.selectedId);
    const resourceCount = Array.isArray(image.resources) ? image.resources.length : 0;
    const media = imageMedia(image, 450);
    return `
        <article class="cmgr-card cmgr-image-card ${selected ? "selected" : ""}" data-image-id="${escapeAttr(image.id)}" tabindex="0" role="button" aria-label="${escapeAttr(image.username || t("Civitai image"))}">
            <div class="cmgr-thumb cmgr-image-thumb">
                ${renderCardMedia(media, { eager: index < 8, priority: index < 4 ? "high" : "auto" })}
                ${resourceCount ? `<span class="cmgr-image-resource-badge">${selectorIcon("layers")}<b>${resourceCount}</b></span>` : ""}
            </div>
            <div class="cmgr-card-body">
                <div class="cmgr-card-title">${escapeHtml(image.username ? `@${image.username}` : t("Civitai image"))}</div>
                <div class="cmgr-image-card-stats">
                    <span>${selectorIcon("heart")}${escapeHtml(formatStatCount(image.stats?.likeCount || 0))}</span>
                    ${image.baseModel ? `<span>${escapeHtml(image.baseModel)}</span>` : ""}
                </div>
            </div>
        </article>
    `;
}

function renderImageEmpty() {
    if (imageState.loading) return renderCardSkeletons(12);
    return renderCollectionEmptyState({
        kind: "discover",
        kicker: t("Images"),
        title: t("No images found"),
        description: imageState.error || t("Try another keyword, or paste a Civitai image link above."),
        hints: [t("Change keywords"), t("Paste a link")],
    });
}

export function renderImageSort() {
    const current = IMAGE_SORTS.find((item) => item.value === imageState.sort) || IMAGE_SORTS[0];
    return `
        <details class="cmgr-selector-tools cmgr-selector-sort">
            <summary aria-label="${escapeAttr(t("Sort"))}" aria-haspopup="menu"><span>${escapeHtml(t(current.label))}</span>${selectorIcon("chevron")}</summary>
            <div class="cmgr-selector-menu" role="menu" aria-label="${escapeAttr(t("Sort"))}">
                ${IMAGE_SORTS.map((item) => `<button type="button" role="menuitemradio" aria-checked="${imageState.sort === item.value}" data-image-sort="${escapeAttr(item.value)}">${escapeHtml(t(item.label))}</button>`).join("")}
            </div>
        </details>
    `;
}

/** The Images sidebar: the only two filters Civitai's image feed accepts. */
export function renderImageFilters(baseModels = [], options = {}) {
    const loading = options.loading === true;
    // Taxonomy rows are `{ name, count }` records; accepting both shapes keeps
    // this working no matter which one the caller hands over.
    const names = (Array.isArray(baseModels) ? baseModels : [])
        .map((item) => String(item?.name || item || "").trim())
        .filter(Boolean);
    const selected = imageState.baseModel;
    const items = selected && !names.includes(selected) ? [selected, ...names] : names;
    return `
        <div class="cmgr-nav-group cmgr-category-group">
            <div class="cmgr-nav-title">${escapeHtml(t("Base Model"))}</div>
            <div class="cmgr-search-picker">
                ${renderSelectorCombo({
                    id: "image-base-model",
                    value: selected,
                    items,
                    placeholder: t("All base models"),
                    searchPlaceholder: t("Search base models..."),
                    emptyText: t("No base models found"),
                    clearTitle: t("Clear base model"),
                })}
            </div>
            ${!items.length ? `<div class="cmgr-nav-note">${escapeHtml(t(loading ? "Loading base models..." : "Base models appear from Civitai data."))}</div>` : ""}
        </div>
        <div class="cmgr-nav-group cmgr-category-group">
            <div class="cmgr-nav-title">${escapeHtml(t("Period"))}</div>
            <div class="cmgr-search-picker">
                ${renderSelectorCombo({
                    id: "image-period",
                    value: imageState.period === "AllTime" ? "" : t(IMAGE_PERIODS.find((item) => item.value === imageState.period)?.label || ""),
                    items: IMAGE_PERIODS.slice(1).map((item) => t(item.label)),
                    placeholder: t("All time"),
                    searchPlaceholder: t("Search"),
                    emptyText: t("No options found"),
                    clearTitle: t("Clear"),
                })}
            </div>
        </div>
    `;
}

function renderImageFilterBar() {
    const chips = [];
    if (imageState.baseModel) {
        chips.push({
            key: "image-base-model",
            label: t("Base Model"),
            value: imageState.baseModel,
            clearAction: "clear-image-base-model",
        });
    }
    if (imageState.period !== "AllTime") {
        chips.push({
            key: "image-period",
            label: t("Period"),
            value: t(IMAGE_PERIODS.find((item) => item.value === imageState.period)?.label || ""),
            clearAction: "clear-image-period",
        });
    }
    return renderActiveFilterChips(chips, "reset-image-filters");
}

export function renderImageDiscover(headingHtml = "") {
    const toolbar = renderSelectorToolbar({
        title: t("Images"),
        headingHtml: headingHtml || undefined,
        searchHtml: renderSelectorSearch({
            value: imageState.query,
            inputAttrs: 'data-field="image-query"',
            placeholder: t("Search images or paste a Civitai image link"),
            clearAction: "clear-image-search",
            loading: imageState.loading,
        }),
        actionsHtml: `
            ${renderImageSort()}
            <button class="cmgr-selector-button is-icon" type="button" data-action="refresh-images" title="${escapeAttr(t("Refresh"))}" aria-label="${escapeAttr(t("Refresh"))}">${selectorIcon("refresh")}</button>
        `,
        filterBarHtml: renderImageFilterBar(),
    });
    return `
        <section class="cmgr-page cmgr-images">
            ${toolbar}
            <div class="cmgr-split has-detail ${imageState.selectedImage ? "is-detail-open" : ""}">
                <div class="cmgr-results cmgr-image-results">
                    ${imageState.items.length ? imageState.items.map((image, index) => renderImageCard(image, index)).join("") : renderImageEmpty()}
                    ${imageState.loadingMore ? renderCardSkeletons(6, { loadMore: true }) : ""}
                </div>
                ${renderImageDetailAside()}
            </div>
        </section>
    `;
}

function resourceFileRow(resource, resourceIndex, file, checked) {
    const key = fileKey(file);
    const size = Number(file?.sizeKB || 0) * 1024;
    const meta = [file?.metadata?.format, file?.metadata?.fp].filter(Boolean).join(" · ");
    const role = fileRole(file);
    const rowKey = `${resourceIndex}::${key}`;
    const target = imageFileTargetKey(resource, resourceIndex, file);
    const options = imageState.targets.length
        ? imageState.targets
        : [{ value: target, label: target }];
    return `
        <div class="cmgr-file-row ${checked ? "is-checked" : ""}" data-image-file-row="${escapeAttr(rowKey)}">
            <input class="cmgr-file-check" type="checkbox" data-image-file-check="${escapeAttr(rowKey)}" ${checked ? "checked" : ""} aria-label="${escapeAttr(t("Include {file} in the download", { file: key }))}" />
            <label class="cmgr-file-main">
                <span class="cmgr-file-role is-${escapeAttr(role)}">${escapeHtml(t("FILE"))}</span>
                <span class="cmgr-file-name">${escapeHtml(key)}</span>
                <span class="cmgr-file-meta">${meta ? `<span>${escapeHtml(meta)}</span>` : ""}<b>${escapeHtml(size ? formatBytes(size) : t("Unknown size"))}</b></span>
            </label>
            <label class="cmgr-file-target" title="${escapeAttr(t("Change the folder for this file"))}">
                <span aria-hidden="true">→</span>
                <select data-image-file-target="${escapeAttr(rowKey)}" aria-label="${escapeAttr(t("Folder for {file}", { file: key }))}">
                    ${options.map((item) => `<option value="${escapeAttr(item.value)}" ${item.value === target ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
                </select>
            </label>
        </div>
    `;
}

function renderResourceCard(resource, index) {
    const kind = String(resource?.kind || "");
    const supported = DOWNLOADABLE_KINDS.has(kind) && resource?.model;
    const version = resource?.model?.modelVersions?.[0] || {};
    const files = imageResourceFiles(resource);
    const checked = new Set((imageState.checked || []).map(String));
    const kindLabel = kind === "checkpoint" ? t("Checkpoint/UNet") : kind === "workflow" ? t("Workflow") : kind === "lora" ? t("LoRA") : kind ? t(kind) : t("Resource");
    const versionLabel = version.name ? `${version.name}${version.baseModel ? ` · ${version.baseModel}` : ""}` : "";
    const modelId = resource?.model_id || resource?.model?.id || "";
    return `
        <article class="cmgr-image-resource ${supported ? "" : "is-unsupported"}" data-image-resource="${index}">
            <div class="cmgr-image-resource-head">
                <div>
                    <span class="cmgr-image-resource-kind">${escapeHtml(kindLabel)}</span>
                    <b>${escapeHtml(resource?.name || versionLabel || t("Unknown model"))}</b>
                    ${versionLabel ? `<small>${escapeHtml(versionLabel)}</small>` : ""}
                </div>
                ${modelId ? `<a class="cmgr-secondary cmgr-mini-btn" href="https://civitai.red/models/${encodeURIComponent(modelId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("Civitai"))}</a>` : ""}
            </div>
            ${supported ? `
                ${isEarlyAccess(version) ? renderEarlyAccessNotice(resource.model, version) : ""}
                <div class="cmgr-image-resource-files">
                    ${files.length
                        ? files.map((file) => resourceFileRow(resource, index, file, checked.has(`${index}::${fileKey(file)}`))).join("")
                        : `<p class="cmgr-nav-note">${escapeHtml(t("This version has no downloadable file."))}</p>`}
                </div>
            ` : `<p class="cmgr-nav-note">${escapeHtml(!resource?.model && resource?.error && resource.error !== "unsupported" ? t("This model could not be loaded.") : t("This resource kind cannot be downloaded from here."))}</p>`}
        </article>
    `;
}

function renderImageDetailBody() {
    const image = imageState.selectedImage;
    if (!image) {
        return `
            <div class="cmgr-detail-scroll cmgr-empty-detail-scroll">
                <div class="cmgr-empty-detail">
                    <div class="cmgr-empty-detail-copy">
                        <span class="cmgr-empty-detail-kicker">${escapeHtml(t("Details"))}</span>
                        <h2>${escapeHtml(t("Select an image"))}</h2>
                        <p>${escapeHtml(t("The models used for an image appear here, ready for bulk download."))}</p>
                    </div>
                </div>
            </div>
        `;
    }
    const picks = checkedImageFiles();
    const totalBytes = picks.reduce((sum, { file }) => sum + Number(file?.sizeKB || 0) * 1024, 0);
    const resources = imageState.resources;
    return `
        <div class="cmgr-detail-scroll cmgr-image-detail">
            ${renderDetailGallery(galleryItemsForUrl(image.url, { preferLegacy: true }), image.username || t("Civitai image"), t("No Preview"))}
            <div class="cmgr-detail-head">
                <div>
                    <a class="cmgr-detail-title-link" href="https://civitai.com/images/${encodeURIComponent(image.id || "")}" target="_blank" rel="noopener noreferrer">
                        <h2>${escapeHtml(image.username ? `@${image.username}` : t("Civitai image"))}</h2>
                        <span class="cmgr-external-icon" aria-hidden="true">↗</span>
                    </a>
                    <div class="cmgr-detail-meta">
                        ${image.baseModel ? `<span>${escapeHtml(image.baseModel)}</span>` : ""}
                        <span>${escapeHtml(t("{count} likes", { count: formatStatCount(image.stats?.likeCount || 0) }))}</span>
                    </div>
                </div>
            </div>
            ${image.prompt ? `
                <section class="cmgr-selector-section" data-section="prompt" open>
                    <div class="cmgr-section-head"><div class="cmgr-section-title">${selectorIcon("file")}${escapeHtml(t("Prompt"))}</div>
                        <button class="cmgr-copy-all-btn" type="button" data-copy="${escapeAttr(image.prompt)}">${escapeHtml(t("Copy"))}</button></div>
                    <div class="cmgr-selector-section-body"><p class="cmgr-image-prompt">${escapeHtml(image.prompt)}</p></div>
                </section>
            ` : ""}
            <section class="cmgr-detail-download-card cmgr-image-resources">
                <div class="cmgr-section-head">
                    <div class="cmgr-section-title">${selectorIcon("layers")}${escapeHtml(t("Models in this image"))}</div>
                    ${resources.length ? `<button class="cmgr-selector-button cmgr-file-select-all" type="button" data-action="select-all-image-files">${escapeHtml(picks.length ? t("Clear selection") : t("Select all"))}</button>` : ""}
                </div>
                ${imageState.loadingResources ? `<p class="cmgr-nav-note">${escapeHtml(t("Loading models..."))}</p>` : ""}
                ${imageState.resourceError ? `<p class="cmgr-nav-note">${escapeHtml(imageState.resourceError)}</p>` : ""}
                ${!imageState.loadingResources && !resources.length && !imageState.resourceError ? `<p class="cmgr-nav-note">${escapeHtml(t("This image has no linked models."))}</p>` : ""}
                ${resources.map((resource, index) => renderResourceCard(resource, index)).join("")}
                ${resources.length ? `
                    <button class="cmgr-primary cmgr-download-cta" type="button" data-action="download-image-files" ${picks.length && !imageState.downloading ? "" : "disabled"}>
                        <span class="cmgr-download-cta-icon" aria-hidden="true">↓</span>
                        <span class="cmgr-download-cta-label">${escapeHtml(imageState.downloading ? t("Queueing...") : t("Download {count} files · {size}", { count: picks.length, size: formatBytes(totalBytes) }))}</span>
                    </button>
                ` : ""}
            </section>
        </div>
    `;
}

export function renderImageDetailAside() {
    return `<aside class="cmgr-detail ${imageState.selectedImage ? "is-open" : ""}" data-detail-subject="image:${escapeAttr(imageState.selectedId || "")}">${renderDetailDismiss()}${renderImageDetailBody()}</aside>`;
}
