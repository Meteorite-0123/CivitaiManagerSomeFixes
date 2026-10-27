import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/civitai/file_picker.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const context = {
    t: (key, values = {}) => String(key).replace(/\{(\w+)\}/g, (match, name) => (name in values ? values[name] : match)),
    formatBytes: (bytes) => `${Math.round(Number(bytes) / 1024 / 1024)} MB`,
    selectorIcon: () => "<svg></svg>",
};
vm.createContext(context);
const { fileRole, groupVersionFiles, representativeFiles, renderFilePicker } = vm.runInContext(
    `(() => { ${source}\n return { fileRole, groupVersionFiles, representativeFiles, renderFilePicker }; })()`,
    context,
);

const checkpointFiles = [
    { name: "flux1-dev-fp8.safetensors", type: "Model", sizeKB: 10240, primary: true },
    { name: "t5xxl_fp16.safetensors", type: "Text Encoder", sizeKB: 9200 },
    { name: "ae.safetensors", type: "VAE", sizeKB: 320 },
    { name: "flux1-dev-config.json", type: "Config", sizeKB: 1 },
];

test("fileRole follows Civitai file types", () => {
    assert.equal(fileRole(checkpointFiles[0]), "model");
    assert.equal(fileRole(checkpointFiles[1]), "text_encoder");
    assert.equal(fileRole(checkpointFiles[2]), "vae");
    assert.equal(fileRole(checkpointFiles[3]), "config");
    assert.equal(fileRole({ name: "something-t5xxl.safetensors", type: "Other" }), "text_encoder");
    assert.equal(fileRole({ name: "ae.safetensors" }), "vae");
});

test("groupVersionFiles keeps components out of the main model", () => {
    const { main, mainRole, components } = groupVersionFiles(checkpointFiles);
    assert.equal(mainRole, "model");
    assert.deepEqual(Array.from(main, (file) => file.name), ["flux1-dev-fp8.safetensors"]);
    assert.deepEqual(Array.from(components.get("text_encoder"), (file) => file.name), ["t5xxl_fp16.safetensors"]);
    assert.deepEqual(Array.from(components.get("vae"), (file) => file.name), ["ae.safetensors"]);
    assert.deepEqual(Array.from(components.get("config"), (file) => file.name), ["flux1-dev-config.json"]);
});

test("a VAE-only upload still has a main entry", () => {
    const { main, mainRole, components } = groupVersionFiles([{ name: "kl-f8-anime2.safetensors", type: "VAE" }]);
    assert.equal(mainRole, "vae");
    assert.equal(main.length, 1);
    assert.equal(components.size, 0);
});

test("representativeFiles picks one file per component role", () => {
    const picks = representativeFiles(checkpointFiles, "ae.safetensors");
    assert.deepEqual(Array.from(picks, (file) => file.name), [
        "flux1-dev-fp8.safetensors",
        "t5xxl_fp16.safetensors",
        "ae.safetensors",
        "flux1-dev-config.json",
    ]);
});

test("renderFilePicker checks the representative files by default", () => {
    const html = renderFilePicker(checkpointFiles, "flux1-dev-fp8.safetensors");
    assert.match(html, /Download selected \(4\)/);
    assert.match(html, /Required components/);
    assert.match(html, /TEXT ENCODER/);
    assert.match(html, /t5xxl_fp16\.safetensors/);
    assert.match(html, /9 MB/);
    assert.match(html, /ae\.safetensors/);
    assert.match(html, /Clear selection/);
});

test("renderFilePicker shows a checkbox and a target folder per file", () => {
    const targetOptions = [
        { value: "checkpoints", label: "Checkpoints" },
        { value: "text_encoders", label: "Text Encoders" },
        { value: "vae", label: "VAE" },
    ];
    const html = renderFilePicker(checkpointFiles, "flux1-dev-fp8.safetensors", {
        checkedNames: ["flux1-dev-fp8.safetensors", "ae.safetensors"],
        rowFor: (file, role) => ({
            rootKind: role === "vae" ? "vae" : role === "text_encoder" ? "text_encoders" : "checkpoints",
            targetOptions,
        }),
    });
    assert.match(html, /Download selected \(2\)/);
    assert.match(html, /data-file-check="flux1-dev-fp8\.safetensors" checked/);
    assert.match(html, /data-file-check="ae\.safetensors" checked/);
    assert.doesNotMatch(html, /data-file-check="t5xxl_fp16\.safetensors" checked/);
    assert.match(html, /data-file-target="t5xxl_fp16\.safetensors"/);
    assert.match(html, /<option value="text_encoders" selected>Text Encoders<\/option>/);
    assert.match(html, /<option value="vae" selected>VAE<\/option>/);
});

test("renderFilePicker honours an emptied selection", () => {
    const html = renderFilePicker(checkpointFiles, "flux1-dev-fp8.safetensors", { checkedNames: [] });
    assert.match(html, /Download selected \(0\)/);
    assert.match(html, /data-action="download-selected-files" disabled/);
    assert.doesNotMatch(html, /data-file-check="[^"]+" checked/);
});

test("renderFilePicker counts only the rendered files", () => {
    const html = renderFilePicker(checkpointFiles, "flux1-dev-fp8.safetensors", {
        includeComponents: false,
        checkedNames: checkpointFiles.map((file) => file.name),
        rowFor: () => ({ rootKind: "loras", targetOptions: [{ value: "loras", label: "LoRAs" }] }),
    });
    assert.match(html, /Download selected \(1\)/);
    assert.match(html, /Clear selection/);
    assert.doesNotMatch(html, /Required components/);
});

test("renderFilePicker labels a VAE upload as the main file", () => {
    const html = renderFilePicker([{ name: "kl-f8-anime2.safetensors", type: "VAE", sizeKB: 320 }], "");
    assert.match(html, /Main file/);
    assert.doesNotMatch(html, /Required components/);
    assert.match(html, /Download selected \(1\)/);
});
