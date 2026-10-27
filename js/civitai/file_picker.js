import { formatBytes } from "./detail.js";
import { t } from "./i18n.js";
import { selectorIcon } from "./selector_ui.js";

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

// Civitai marks every file with a type. These labels are what the picker shows
// instead of a bare file name, so a ".safetensors" is never ambiguous.
export const FILE_ROLES = {
    model: { label: "Diffusion model", short: "MODEL", folder: "", order: 0 },
    text_encoder: { label: "Text encoder", short: "TEXT ENCODER", folder: "text_encoders", order: 1 },
    vae: { label: "VAE", short: "VAE", folder: "vae", order: 2 },
    config: { label: "Config", short: "CONFIG", folder: "configs", order: 3 },
    archive: { label: "Archive", short: "ARCHIVE", folder: "", order: 4 },
};

const COMPONENT_ORDER = ["text_encoder", "vae", "config"];
const MAIN_ROLE_ORDER = ["model", "archive", ...COMPONENT_ORDER];

/**
 * Reads the role from Civitai's file `type`. The name is only inspected when
 * Civitai gives no usable type, so an explicit "Model" stays the main file.
 */
export function fileRole(file) {
    const type = String(file?.type || "").trim().toLowerCase();
    if (type) {
        if (type.includes("vae")) return "vae";
        if (type.includes("text encoder") || type === "text_encoder" || type === "textencoder") return "text_encoder";
        if (type === "config" || type === "configuration") return "config";
        if (type === "archive" || type === "training data") return "archive";
        if (type === "model" || type === "diffusion model" || type === "checkpoint") return "model";
    }
    const name = String(file?.name || file?.id || "");
    const stem = name.replace(/\.[^.]+$/, "").toLowerCase();
    if (/(^|[._\-\s])vae([._\-\s]|$)/.test(stem) || stem === "ae") return "vae";
    if (/(^|[._\-\s])(t5|umt5|t5xxl|clip|clip_l|clip_g|text[._-]?encoder|llm|qwen3?[._-]?vl|gemma|byt5)([._\-\s]|$)/.test(stem)) return "text_encoder";
    if (/(^|[._\-\s])(config|configs)([._\-\s]|$)/.test(stem) || /\.(ya?ml|json)$/i.test(name)) return "config";
    if (/\.(zip|7z|rar)$/i.test(name)) return "archive";
    return "model";
}

export function fileKey(file) {
    return String(file?.name || file?.id || "");
}

/** Splits a version's files into the main model and its companion components. */
export function groupVersionFiles(files, { includeComponents = true } = {}) {
    const list = (Array.isArray(files) ? files : []).filter(Boolean);
    const groups = new Map();
    for (const file of list) {
        const role = fileRole(file);
        if (!groups.has(role)) groups.set(role, []);
        groups.get(role).push(file);
    }
    // Usually a "Model" file is the main entry. Some uploads (VAE, text encoder,
    // workflow archives) only ever contain one other role, so that role becomes
    // the main entry instead of leaving the picker empty.
    const mainRole = MAIN_ROLE_ORDER.find((role) => groups.get(role)?.length);
    const main = mainRole ? groups.get(mainRole) : [];
    if (!includeComponents) return { main: main.length ? main : list, mainRole: mainRole || "model", components: new Map() };
    const components = new Map();
    for (const role of COMPONENT_ORDER) {
        if (role !== mainRole && groups.get(role)?.length) components.set(role, groups.get(role));
    }
    return { main, mainRole: mainRole || "model", components };
}

/** One entry per role: the selected file when it belongs to the role, else the primary. */
export function representativeFiles(files, selectedName, { includeComponents = true } = {}) {
    const { main, components } = groupVersionFiles(files, { includeComponents });
    const selected = String(selectedName || "");
    const pick = (items) => (
        items.find((file) => fileKey(file) === selected)
        || items.find((file) => file.primary)
        || items[0]
    );
    const picks = [];
    if (main.length) picks.push(pick(main));
    for (const role of COMPONENT_ORDER) {
        const items = components.get(role);
        if (items?.length) picks.push(pick(items));
    }
    return picks.filter(Boolean);
}

/**
 * The files a bulk download would queue, with their combined size. The main
 * download button uses this so its size always matches the ticked files.
 */
export function selectionSummary(files, checkedNames, { includeComponents = true } = {}) {
    const list = (Array.isArray(files) ? files : []).filter(Boolean);
    const { main, components } = groupVersionFiles(list, { includeComponents });
    const rendered = includeComponents
        ? [...main, ...COMPONENT_ORDER.flatMap((role) => components.get(role) || [])]
        : main;
    const checked = new Set((Array.isArray(checkedNames) ? checkedNames : []).map(String));
    const picked = rendered.filter((file) => checked.has(fileKey(file)));
    return {
        files: picked,
        count: picked.length,
        totalBytes: picked.reduce((sum, file) => sum + Number(file.sizeKB || 0) * 1024, 0),
    };
}

function fileMeta(file) {
    const metadata = file?.metadata || {};
    const format = String(metadata.format || "").trim();
    const precision = String(metadata.fp || "").trim();
    return [format, precision].filter(Boolean).join(" · ");
}

function renderFileRow(file, role, selected, options = {}) {
    const size = Number(file?.sizeKB || 0) * 1024;
    const meta = fileMeta(file);
    const name = String(file?.name || t("Unnamed file"));
    const key = fileKey(file);
    const checked = options.checked !== false;
    const targetOptions = (Array.isArray(options.targetOptions) ? options.targetOptions : [])
        .map((item) => ({ value: String(item?.value ?? ""), label: String(item?.label ?? item?.value ?? "") }))
        .filter((item) => item.value);
    const targetValue = String(options.rootKind || "");
    if (targetValue && !targetOptions.some((item) => item.value === targetValue)) {
        targetOptions.unshift({ value: targetValue, label: targetValue });
    }
    return `
        <div class="cmgr-file-row ${selected ? "is-selected" : ""} ${checked ? "is-checked" : ""}" data-file-row="${escapeAttr(key)}" role="group" aria-label="${escapeAttr(name)}">
            <input class="cmgr-file-check" type="checkbox" data-file-check="${escapeAttr(key)}" ${checked ? "checked" : ""} aria-label="${escapeAttr(t("Include {file} in the download", { file: name }))}" />
            <button class="cmgr-file-main" type="button" aria-pressed="${checked}" data-file-option="${escapeAttr(key)}" title="${escapeAttr(name)}">
                <span class="cmgr-file-role is-${escapeAttr(role)}">${escapeHtml(t(FILE_ROLES[role]?.short || "FILE"))}</span>
                <span class="cmgr-file-name">${escapeHtml(name)}</span>
                <span class="cmgr-file-meta">
                    ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
                    <b>${escapeHtml(size ? formatBytes(size) : t("Unknown size"))}</b>
                </span>
            </button>
            ${targetOptions.length ? `
                <label class="cmgr-file-target" title="${escapeAttr(t("Change the folder for this file"))}">
                    <span aria-hidden="true">→</span>
                    <select data-file-target="${escapeAttr(key)}" aria-label="${escapeAttr(t("Folder for {file}", { file: name }))}">
                        ${targetOptions.map((item) => `<option value="${escapeAttr(item.value)}" ${item.value === targetValue ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
                    </select>
                </label>
            ` : ""}
        </div>
    `;
}

function renderGroup(role, items, selectedName, options = {}) {
    const info = FILE_ROLES[role] || FILE_ROLES.model;
    const selected = String(selectedName || "");
    const rowFor = typeof options.rowFor === "function" ? options.rowFor : () => ({});
    return `
        <div class="cmgr-file-group" data-file-group="${escapeAttr(role)}">
            <div class="cmgr-file-group-head">
                <span class="cmgr-file-role is-${escapeAttr(role)}">${escapeHtml(t(info.short))}</span>
                <span>${escapeHtml(options.title || t(info.label))} · ${items.length}</span>
            </div>
            <div class="cmgr-file-rows" role="group" aria-label="${escapeAttr(t(info.label))}">
                ${items.map((file) => renderFileRow(file, role, fileKey(file) === selected, rowFor(file, role))).join("")}
            </div>
        </div>
    `;
}

/**
 * Replaces the old single-line file dropdown: every file gets a role, its full
 * name, a right-aligned size, a checkbox for bulk downloads and an editable
 * target folder. Required components are separated from the main model file.
 */
export function renderFilePicker(files, selectedName, options = {}) {
    const list = (Array.isArray(files) ? files : []).filter(Boolean);
    if (!list.length) return "";
    const includeComponents = options.includeComponents !== false;
    const { main, mainRole, components } = groupVersionFiles(list, { includeComponents });
    const componentRoles = COMPONENT_ORDER.filter((role) => components.get(role)?.length);
    if (!main.length && !componentRoles.length) return "";
    const checkedNames = new Set(
        Array.isArray(options.checkedNames)
            ? options.checkedNames.map(String)
            : representativeFiles(list, selectedName, { includeComponents }).map(fileKey),
    );
    const renderedFiles = [
        ...main.map((file) => [file, mainRole]),
        ...componentRoles.flatMap((role) => (components.get(role) || []).map((file) => [file, role])),
    ];
    const checkedCount = renderedFiles.filter(([file]) => checkedNames.has(fileKey(file))).length;
    const rowFor = (file, role) => {
        const extra = typeof options.rowFor === "function" ? options.rowFor(file, role) : {};
        return { checked: checkedNames.has(fileKey(file)), ...extra };
    };
    const rowOptions = { rowFor };
    return `
        <div class="cmgr-file-picker" data-file-picker>
            <div class="cmgr-file-picker-head">
                <div>
                    <div class="cmgr-label">${selectorIcon("file")}${escapeHtml(t("Files"))}</div>
                    <p>${escapeHtml(t("Click a file to include it in the download, then adjust each target folder if needed."))}</p>
                </div>
                <div class="cmgr-file-picker-actions">
                    <button class="cmgr-selector-button cmgr-file-select-all" type="button" data-action="select-all-files">${escapeHtml(renderedFiles.length && checkedCount === renderedFiles.length ? t("Clear selection") : t("Select all"))}</button>
                </div>
            </div>
            ${main.length ? renderGroup(mainRole, main, selectedName, { ...rowOptions, title: t("Main file") }) : ""}
            ${componentRoles.length ? `
                <div class="cmgr-file-components">
                    <div class="cmgr-file-components-title">${escapeHtml(t("Required components"))}</div>
                    ${componentRoles.map((role) => renderGroup(role, components.get(role), selectedName, rowOptions)).join("")}
                </div>
            ` : ""}
        </div>
    `;
}
