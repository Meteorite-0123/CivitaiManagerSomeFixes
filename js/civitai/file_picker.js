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

function fileMeta(file) {
    const metadata = file?.metadata || {};
    const format = String(metadata.format || "").trim();
    const precision = String(metadata.fp || "").trim();
    return [format, precision].filter(Boolean).join(" · ");
}

function renderFileRow(file, role, selected) {
    const size = Number(file?.sizeKB || 0) * 1024;
    const meta = fileMeta(file);
    const name = String(file?.name || t("Unnamed file"));
    const key = fileKey(file);
    return `
        <button class="cmgr-file-row ${selected ? "is-selected" : ""}" type="button" role="radio" aria-checked="${selected}" data-file-option="${escapeAttr(key)}" title="${escapeAttr(name)}">
            <span class="cmgr-file-role is-${escapeAttr(role)}">${escapeHtml(t(FILE_ROLES[role]?.short || "FILE"))}</span>
            <span class="cmgr-file-name">${escapeHtml(name)}</span>
            <span class="cmgr-file-meta">
                ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
                <b>${escapeHtml(size ? formatBytes(size) : t("Unknown size"))}</b>
            </span>
        </button>
    `;
}

function renderGroup(role, items, selectedName, { title = "" } = {}) {
    const info = FILE_ROLES[role] || FILE_ROLES.model;
    const selected = String(selectedName || "");
    return `
        <div class="cmgr-file-group" data-file-group="${escapeAttr(role)}">
            <div class="cmgr-file-group-head">
                <span class="cmgr-file-role is-${escapeAttr(role)}">${escapeHtml(t(info.short))}</span>
                <span>${escapeHtml(title || t(info.label))} · ${items.length}</span>
                ${info.folder ? `<span class="cmgr-file-target" title="${escapeAttr(t("Saved to {folder}", { folder: `models/${info.folder}` }))}">→ models/${escapeHtml(info.folder)}</span>` : ""}
            </div>
            <div class="cmgr-file-rows" role="radiogroup" aria-label="${escapeAttr(t(info.label))}">
                ${items.map((file) => renderFileRow(file, role, fileKey(file) === selected)).join("")}
            </div>
        </div>
    `;
}

/**
 * Replaces the old single-line file dropdown: every file gets its role, its
 * full name and a right-aligned size, and required components are separated
 * from the main model file.
 */
export function renderFilePicker(files, selectedName, options = {}) {
    const list = (Array.isArray(files) ? files : []).filter(Boolean);
    if (!list.length) return "";
    const includeComponents = options.includeComponents !== false;
    const { main, mainRole, components } = groupVersionFiles(list, { includeComponents });
    const componentRoles = COMPONENT_ORDER.filter((role) => components.get(role)?.length);
    if (!main.length && !componentRoles.length) return "";
    const count = (main.length ? 1 : 0) + componentRoles.length;
    return `
        <div class="cmgr-file-picker" data-file-picker>
            <div class="cmgr-file-picker-head">
                <div>
                    <div class="cmgr-label">${selectorIcon("file")}${escapeHtml(t("Files"))}</div>
                    <p>${escapeHtml(t("Each file is labeled with what it is and the folder it is saved to."))}</p>
                </div>
                ${count > 1 ? `<button class="cmgr-selector-button cmgr-file-download-all" type="button" data-action="download-all-files" title="${escapeAttr(t("Download the main file and one file per component"))}">${escapeHtml(t("Download all ({count})", { count }))}</button>` : ""}
            </div>
            ${main.length ? renderGroup(mainRole, main, selectedName, { title: t("Main file") }) : ""}
            ${componentRoles.length ? `
                <div class="cmgr-file-components">
                    <div class="cmgr-file-components-title">${escapeHtml(t("Required components"))}</div>
                    ${componentRoles.map((role) => renderGroup(role, components.get(role), selectedName)).join("")}
                </div>
            ` : ""}
        </div>
    `;
}
