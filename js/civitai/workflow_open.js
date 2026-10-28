import { app } from "/scripts/app.js";
import { apiPost } from "./api.js";

/** True for library assets and download jobs that point at a workflow file. */
export function isWorkflowFile(entry) {
    return String(entry?.root_kind || "") === "workflows" && Boolean(String(entry?.relative_path || "").trim());
}

// A saved workflow is either the editor graph (nodes/links) or an API prompt
// (node id -> { class_type }). Older exports keep both under one wrapper.
function graphOf(data) {
    if (!data || typeof data !== "object") return null;
    if (Array.isArray(data.nodes)) return data;
    if (Array.isArray(data.workflow?.nodes)) return data.workflow;
    return null;
}

function promptOf(data) {
    if (!data || typeof data !== "object") return null;
    if (Array.isArray(data.nodes)) return null;
    const embedded = data.prompt;
    if (embedded && typeof embedded === "object" && !Array.isArray(embedded)) {
        const values = Object.values(embedded);
        if (values.length && values.every((node) => typeof node?.class_type === "string")) return embedded;
    }
    const values = Object.values(data);
    return values.length && values.every((node) => typeof node?.class_type === "string") ? data : null;
}

/**
 * Reads a downloaded workflow from the backend and opens it on the canvas.
 * Resolves with the number of nodes that were loaded.
 */
export async function openWorkflowInComfyUI(entry) {
    if (!isWorkflowFile(entry)) throw new Error("Only workflow files can be opened");
    const data = await apiPost("/workflow-content", {
        root_kind: "workflows",
        relative_path: entry.relative_path,
        storage_root_id: entry.storage_root_id || "",
    });
    const workflow = data?.workflow;
    const graph = graphOf(workflow);
    if (graph) {
        await app.loadGraphData(graph, true, true);
        return graph.nodes.length;
    }
    const prompt = promptOf(workflow);
    if (prompt && typeof app.loadApiJson === "function") {
        await app.loadApiJson(prompt, data?.filename || "");
        return Object.keys(prompt).length;
    }
    throw new Error("This workflow file is not in a format ComfyUI can open");
}
