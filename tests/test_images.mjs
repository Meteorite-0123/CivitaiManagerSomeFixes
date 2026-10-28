import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/civitai/images.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ["'][^"']+["'];?\r?\n/gm, "")
    .replace(/^export /gm, "");

const context = {
    t: (key, values = {}) => String(key).replace(/\{(\w+)\}/g, (match, name) => (name in values ? values[name] : match)),
    formatBytes: (bytes) => `${Math.round(Number(bytes) / 1024)} KB`,
    formatStatCount: (value) => String(value),
    fileKey: (file) => String(file?.name || file?.id || ""),
    fileRole: () => "model",
    selectorIcon: () => "<svg></svg>",
    renderCardMedia: () => "<img />",
    renderCardSkeletons: () => "",
    observeCardMedia: () => {},
    renderCollectionEmptyState: () => "",
    renderSelectorSearch: () => "",
    renderSelectorToolbar: () => "",
    renderDetailGallery: () => "",
    renderDetailDismiss: () => "",
    renderEarlyAccessNotice: () => "",
    isEarlyAccess: () => false,
    galleryItemsForUrl: () => [],
    createPreviewMedia: (image) => ({ url: image?.url || "", type: "image", fallbackUrls: [] }),
    apiGet: async () => ({ items: [], metadata: {} }),
    apiPost: async () => ({ resources: [] }),
};

vm.createContext(context);
const images = vm.runInContext(
    `(() => { ${source}\n return { imageState, imageResourceKeys, checkedImageFiles, imageMedia, renderImageDiscover, renderImageDetailAside, imageFileTargetKey, setImageTargets }; })()`,
    context,
);

const { imageState, imageResourceKeys, checkedImageFiles, imageMedia, renderImageDiscover, renderImageDetailAside, imageFileTargetKey, setImageTargets } = images;

function resource(files) {
    return { kind: "lora", model: { id: 1, modelVersions: [{ id: 2, files }] } };
}

test("resource keys are scoped per resource so identical file names never collide", () => {
    const keys = imageResourceKeys(resource([{ name: "a.safetensors" }, { name: "b.safetensors" }]), 3);
    assert.equal([...keys].join(","), "3::a.safetensors,3::b.safetensors");
});

test("checked files resolve back to their resource and file", () => {
    imageState.resources = [
        resource([{ name: "a.safetensors", sizeKB: 10 }, { name: "b.safetensors", sizeKB: 20 }]),
        resource([{ name: "a.safetensors", sizeKB: 30 }]),
    ];
    imageState.checked = ["1::a.safetensors", "0::b.safetensors"];
    const picks = checkedImageFiles();
    assert.equal(picks.length, 2);
    assert.equal(picks.map((pick) => pick.file.name).join(","), "b.safetensors,a.safetensors");
    assert.equal(picks[1].resource, imageState.resources[1]);
});

test("an unchecked feed yields no picks", () => {
    imageState.resources = [resource([{ name: "a.safetensors" }])];
    imageState.checked = [];
    assert.equal(checkedImageFiles().length, 0);
});

test("feed cards carry the image id and a resource count badge", () => {
    imageState.selectedId = "";
    imageState.items = [{ id: 12, url: "https://example.com/a.jpg", username: "bob", baseModel: "SDXL 1.0", stats: { likeCount: 5 }, resources: [{ kind: "lora" }] }];
    const html = renderImageDiscover("<div class=" + "\"tabs\"></div>");
    assert.ok(html.includes('data-image-id="12"'));
    assert.ok(html.includes("cmgr-image-resource-badge"));
    assert.ok(html.includes("@bob"));
    assert.ok(html.includes("cmgr-image-results"));
});

test("detail panel shows a placeholder until an image is selected", () => {
    imageState.selectedImage = null;
    const html = renderImageDetailAside();
    assert.ok(html.includes("Select an image"));
    assert.ok(html.includes("data-detail-subject=\"image:\""));
});

test("detail panel lists resources with ticked files and a bulk button", () => {
    imageState.selectedImage = { id: 9, url: "https://example.com/a.jpg", username: "bob" };
    imageState.loadingResources = false;
    imageState.resourceError = "";
    imageState.resources = [{
        kind: "lora",
        name: "Style",
        model_id: 30,
        model: { id: 30, modelVersions: [{ id: 40, name: "v1", baseModel: "SDXL 1.0", files: [{ name: "s.safetensors", sizeKB: 100, type: "Model" }] }] },
    }];
    imageState.checked = ["0::s.safetensors"];
    const html = renderImageDetailAside();
    assert.ok(html.includes("data-image-file-check=\"0::s.safetensors\""));
    assert.ok(html.includes("checked"));
    assert.ok(html.includes('data-action="download-image-files"'));
    assert.ok(html.includes("Download 1 files"));
    imageState.checked = [];
});

test("each file defaults to the folder of its resource kind", () => {
    imageState.overrides = {};
    assert.equal(imageFileTargetKey({ kind: "lora" }, 0, { name: "a" }), "loras");
    assert.equal(imageFileTargetKey({ kind: "checkpoint" }, 0, { name: "a" }), "checkpoints");
    assert.equal(imageFileTargetKey({ kind: "workflow" }, 0, { name: "a" }), "workflows");
});

test("a user folder pick overrides the default for that file only", () => {
    imageState.overrides = { "0::a.safetensors": "vae" };
    assert.equal(imageFileTargetKey({ kind: "lora" }, 0, { name: "a.safetensors" }), "vae");
    assert.equal(imageFileTargetKey({ kind: "lora" }, 0, { name: "b.safetensors" }), "loras");
    imageState.overrides = {};
});

test("targets are sanitised into value/label options", () => {
    setImageTargets([{ value: "loras", label: "LoRAs" }, { value: "" }, null]);
    assert.equal(imageState.targets.length, 1);
    assert.equal(imageState.targets[0].value, "loras");
    setImageTargets([]);
});

test("image media falls back to the raw url when it is not a civitai cache path", () => {
    const media = imageMedia({ url: "https://example.com/x.jpg" }, 450);
    assert.equal(media.url, "https://example.com/x.jpg");
    assert.equal(media.emptyText, "No Preview");
});
