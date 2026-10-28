import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const jsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js");

// ComfyUI serves WEB_DIRECTORY at /extensions/<folder>/ while our modules sit at
// js/<sub>/..., so a module's URL is one level shallower than its folder depth.
// Importing "../../scripts/app.js" from js/civitai/x.js therefore resolves to
// /extensions/scripts/app.js, a 404 that kills the whole module graph and makes
// the extension disappear from the UI without any visible error.
const EXTENSION_BASE = "/extensions/civitai-manager/";

function moduleFiles(dir = jsRoot) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return moduleFiles(full);
        return entry.name.endsWith(".js") ? [full] : [];
    });
}

function urlFor(file) {
    return EXTENSION_BASE + path.relative(jsRoot, file).split(path.sep).join("/");
}

function specifiersOf(source) {
    const found = [];
    const pattern = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;
    let match;
    while ((match = pattern.exec(source))) found.push(match[1]);
    return found;
}

test("every relative import resolves inside the served extension folder", () => {
    const broken = [];
    for (const file of moduleFiles()) {
        const relative = path.relative(jsRoot, file).split(path.sep).join("/");
        for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
            if (!specifier.startsWith(".")) continue;
            // ComfyUI core modules live at the web root on purpose; the next
            // test checks those resolve to /scripts/... exactly.
            if (/(^|\/)scripts\//.test(specifier)) continue;
            const resolved = new URL(specifier, "http://comfy" + urlFor(file)).pathname;
            if (!resolved.startsWith(EXTENSION_BASE)) {
                broken.push(`${relative}: "${specifier}" escapes to ${resolved}`);
                continue;
            }
            const onDisk = path.join(jsRoot, resolved.slice(EXTENSION_BASE.length));
            try {
                readFileSync(onDisk);
            } catch {
                broken.push(`${relative}: "${specifier}" resolves to ${resolved}, which is not served`);
            }
        }
    }
    assert.deepEqual(broken, []);
});

test("ComfyUI core modules always land on the web root", () => {
    // Both "../../scripts/app.js" (from js/) and "/scripts/app.js" (from
    // js/civitai/) are fine, but they must end up at /scripts/app.js. The depth
    // is what differs, and getting it wrong is exactly the earlier bug.
    const offenders = [];
    for (const file of moduleFiles()) {
        const relative = path.relative(jsRoot, file).split(path.sep).join("/");
        for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
            const core = specifier.match(/(?:^|\/)scripts\/(.+)$/);
            if (!core) continue;
            const resolved = specifier.startsWith("/")
                ? specifier
                : new URL(specifier, "http://comfy" + urlFor(file)).pathname;
            if (resolved !== "/scripts/" + core[1]) {
                offenders.push(`${relative}: "${specifier}" resolves to ${resolved}`);
            }
        }
    }
    assert.deepEqual(offenders, []);
});

test("a missing optional helper cannot break the extension entry point", () => {
    const source = readFileSync(path.join(jsRoot, "civitai_manager.js"), "utf8");
    // Anything the manager pulls in statically is fatal when it 404s, so the
    // workflow helper is imported lazily at click time instead.
    const staticImports = source
        .split(/\r?\n/)
        .filter((line) => /^\s*import\s/.test(line) && line.includes("workflow_open.js"));
    assert.deepEqual(staticImports, []);
    assert.match(source, /await import\("\.\/civitai\/workflow_open\.js"\)/);
});
