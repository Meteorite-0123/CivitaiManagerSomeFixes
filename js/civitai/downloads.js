import { renderCardMedia } from "./card_media.js";
import { renderCollectionEmptyState } from "./components.js";
import { formatBytes } from "./detail.js";
import { t } from "./i18n.js";

export const ACTIVE_DOWNLOAD_STATUSES = new Set(["pending", "downloading", "cancelling"]);
const STATUS_LABELS = {
    pending: "Pending",
    downloading: "Downloading",
    cancelling: "Cancelling",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
};
// Byte rate per job, smoothed across polls so the speed and ETA do not jitter.
const rates = new Map();
const renderedActions = new WeakMap();

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function trackDownloadRates(jobs) {
    const now = performance.now();
    for (const job of jobs) {
        if (job.status !== "downloading") {
            rates.delete(job.id);
            continue;
        }
        const progress = Number(job.progress || 0);
        const sample = rates.get(job.id);
        if (!sample) {
            rates.set(job.id, { progress, time: now, rate: 0 });
            continue;
        }
        const seconds = (now - sample.time) / 1000;
        if (seconds < 0.25 || progress < sample.progress) continue;
        const rate = (progress - sample.progress) / seconds;
        sample.rate = sample.rate ? sample.rate * 0.6 + rate * 0.4 : rate;
        sample.progress = progress;
        sample.time = now;
    }
}

function downloadPercent(job) {
    if (job.status === "completed") return 100;
    const total = Number(job.total || 0);
    return total > 0 ? Math.min(100, Math.round((Number(job.progress || 0) / total) * 100)) : 0;
}

function formatRemaining(seconds) {
    if (seconds < 60) return t("{count}s left", { count: Math.max(1, Math.round(seconds)) });
    if (seconds < 3600) return t("{count} min left", { count: Math.round(seconds / 60) });
    return t("{count} h left", { count: (seconds / 3600).toFixed(1) });
}

function formatAgo(timestamp) {
    const seconds = Math.max(0, Date.now() / 1000 - Number(timestamp || 0));
    if (seconds < 60) return t("Just now");
    if (seconds < 3600) return t("{count} min ago", { count: Math.round(seconds / 60) });
    if (seconds < 86400) return t("{count} h ago", { count: Math.round(seconds / 3600) });
    return new Date(Number(timestamp) * 1000).toLocaleDateString();
}

function renderMeta(job) {
    const progress = Number(job.progress || 0);
    const total = Number(job.total || 0);
    if (job.status === "pending") return escapeHtml(t("Waiting in queue..."));
    if (job.status === "cancelling") return escapeHtml(t("Cancelling..."));
    if (job.status === "failed") return `<span class="is-error">${escapeHtml(job.error || t("Download failed."))}</span>`;
    if (job.status === "cancelled") return escapeHtml(t("Cancelled {time}", { time: formatAgo(job.cancelled_at) }));
    if (job.status === "completed") return escapeHtml(`${formatBytes(total || progress)} · ${formatAgo(job.completed_at)}`);
    const rate = rates.get(job.id)?.rate || 0;
    const parts = [
        `<b>${total ? `${downloadPercent(job)}%` : escapeHtml(t("Waiting for size..."))}</b>`,
        escapeHtml(total ? `${formatBytes(progress)} / ${formatBytes(total)}` : formatBytes(progress)),
    ];
    if (rate > 0) {
        parts.push(escapeHtml(`${formatBytes(rate)}/s`));
        if (total > progress) parts.push(escapeHtml(formatRemaining((total - progress) / rate)));
    }
    return parts.join("<i aria-hidden=\"true\">·</i>");
}

function renderBar(job) {
    const indeterminate = ACTIVE_DOWNLOAD_STATUSES.has(job.status) && !Number(job.total || 0);
    const pct = downloadPercent(job);
    return `<div class="cmgr-dl-bar ${indeterminate ? "is-indeterminate" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`;
}

function patchBar(bar, job) {
    const pct = downloadPercent(job);
    bar.classList.toggle("is-indeterminate", ACTIVE_DOWNLOAD_STATUSES.has(job.status) && !Number(job.total || 0));
    bar.setAttribute("aria-valuenow", String(pct));
    bar.firstElementChild.style.width = `${pct}%`;
}

/** Compact progress used inside a model detail while its download runs. */
export function renderDownloadProgress(job) {
    return `
        <div class="cmgr-dl-inline" data-dl-progress="${escapeHtml(job.id)}">
            <div class="cmgr-dl-inline-head"><b>${escapeHtml(t(STATUS_LABELS[job.status] || "Pending"))}</b><span class="cmgr-dl-meta" data-dl-meta>${renderMeta(job)}</span></div>
            ${renderBar(job)}
        </div>
    `;
}

/** Update an existing inline progress in place; returns false when it has to be rendered. */
export function patchDownloadProgress(root, job) {
    const host = job ? root?.querySelector(`[data-dl-progress="${CSS.escape(String(job.id))}"]`) : null;
    if (!host) return false;
    host.querySelector("b").textContent = t(STATUS_LABELS[job.status] || "Pending");
    host.querySelector("[data-dl-meta]").innerHTML = renderMeta(job);
    patchBar(host.querySelector(".cmgr-dl-bar"), job);
    return true;
}

function renderRow(job, actions) {
    const title = job.model_name || job.filename || t("Download");
    return `
        <article class="cmgr-dl-row is-${escapeHtml(job.status || "pending")}" data-job-id="${escapeHtml(job.id)}" data-status="${escapeHtml(job.status || "pending")}">
            <div class="cmgr-dl-thumb">${renderCardMedia(job.preview_url || "", { eager: true })}</div>
            <div class="cmgr-dl-main">
                <div class="cmgr-dl-head">
                    <b title="${escapeHtml(title)}">${escapeHtml(title)}</b>
                    ${job.base_model ? `<span class="cmgr-dl-chip">${escapeHtml(job.base_model)}</span>` : ""}
                    <span class="cmgr-dl-status">${escapeHtml(t(STATUS_LABELS[job.status] || "Pending"))}</span>
                </div>
                <div class="cmgr-dl-path" title="${escapeHtml(job.target_path || "")}">${escapeHtml(job.relative_path || job.filename || "")}</div>
                ${renderBar(job)}
                <div class="cmgr-dl-meta" data-dl-meta>${renderMeta(job)}</div>
            </div>
            <div class="cmgr-dl-actions">${actions}</div>
        </article>
    `;
}

function sortJobs(jobs) {
    const finishedAt = (job) => Number(job.completed_at || job.failed_at || job.cancelled_at || job.created_at || 0);
    const active = jobs.filter((job) => ACTIVE_DOWNLOAD_STATUSES.has(job.status)).sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
    const finished = jobs.filter((job) => !ACTIVE_DOWNLOAD_STATUSES.has(job.status)).sort((a, b) => finishedAt(b) - finishedAt(a));
    return { active, finished };
}

function renderGroups(jobs, actionsFor) {
    if (!jobs.length) {
        return renderCollectionEmptyState({
            kind: "downloads",
            kicker: t("Downloads"),
            title: t("No download tasks yet"),
            description: t("Downloads you queue from Discover will appear here with their progress and status."),
            hints: [t("Live progress"), t("Retry failed tasks")],
        });
    }
    const groups = sortJobs(jobs);
    return [["active", t("In progress")], ["finished", t("History")]].map(([id, label]) => `
        <section class="cmgr-dl-group" data-dl-group="${id}" ${groups[id].length ? "" : "hidden"}>
            <h3>${escapeHtml(label)}<b data-dl-count>${groups[id].length}</b></h3>
            <div class="cmgr-dl-rows">${groups[id].map((job) => renderRow(job, actionsFor(job))).join("")}</div>
        </section>
    `).join("");
}

function renderSummary(jobs) {
    const { active, finished } = sortJobs(jobs);
    return escapeHtml(t("{active} active · {finished} finished", { active: active.length, finished: finished.length }));
}

function renderToolbarActions(jobs) {
    const finished = jobs.some((job) => !ACTIVE_DOWNLOAD_STATUSES.has(job.status));
    return finished ? `<button class="cmgr-secondary" type="button" data-action="clear-downloads">${escapeHtml(t("Clear finished"))}</button>` : "";
}

export function renderDownloadPage({ title, jobs, actionsFor }) {
    return `
        <section class="cmgr-page cmgr-dl-page">
            <div class="cmgr-toolbar cmgr-selector-utility-toolbar cmgr-dl-toolbar">
                <div class="cmgr-dl-heading"><h2>${escapeHtml(title)}</h2><span data-dl-summary>${renderSummary(jobs)}</span></div>
                <div class="cmgr-dl-toolbar-actions" data-dl-toolbar>${renderToolbarActions(jobs)}</div>
            </div>
            <div class="cmgr-download-list" data-dl-list>${renderGroups(jobs, actionsFor)}</div>
        </section>
    `;
}

function rowElement(job, actions) {
    const template = document.createElement("template");
    template.innerHTML = renderRow(job, actions).trim();
    const row = template.content.firstElementChild;
    renderedActions.set(row, actions);
    return row;
}

/**
 * Keyed update of a rendered download page: running rows only move their bar
 * and numbers, rows that change status are swapped, new ones slide in.
 */
export function patchDownloadPage(root, { jobs, actionsFor }) {
    const list = root?.querySelector("[data-dl-list]");
    if (!list) return false;
    root.querySelector("[data-dl-summary]").innerHTML = renderSummary(jobs);
    root.querySelector("[data-dl-toolbar]").innerHTML = renderToolbarActions(jobs);
    if (!jobs.length || !list.querySelector("[data-dl-group]")) {
        list.innerHTML = renderGroups(jobs, actionsFor);
        return true;
    }
    const keep = new Set(jobs.map((job) => String(job.id)));
    list.querySelectorAll("[data-job-id]").forEach((row) => {
        if (!keep.has(row.dataset.jobId)) row.remove();
    });
    const groups = sortJobs(jobs);
    for (const id of ["active", "finished"]) {
        const section = list.querySelector(`[data-dl-group="${id}"]`);
        const rows = section.querySelector(".cmgr-dl-rows");
        section.hidden = !groups[id].length;
        section.querySelector("[data-dl-count]").textContent = String(groups[id].length);
        let previous = null;
        for (const job of groups[id]) {
            const actions = actionsFor(job);
            let row = list.querySelector(`[data-job-id="${CSS.escape(String(job.id))}"]`);
            if (!row || row.dataset.status !== (job.status || "pending")) {
                const fresh = rowElement(job, actions);
                fresh.classList.add(row ? "is-changed" : "is-new");
                row?.remove();
                row = fresh;
            } else {
                patchBar(row.querySelector(".cmgr-dl-bar"), job);
                row.querySelector("[data-dl-meta]").innerHTML = renderMeta(job);
                if (renderedActions.get(row) !== actions) {
                    row.querySelector(".cmgr-dl-actions").innerHTML = actions;
                    renderedActions.set(row, actions);
                }
            }
            const expected = previous ? previous.nextElementSibling : rows.firstElementChild;
            if (row !== expected) rows.insertBefore(row, expected);
            previous = row;
        }
    }
    return true;
}
