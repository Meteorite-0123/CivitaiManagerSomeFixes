import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createPreviewMedia } from "../js/civitai/media.js";

const source = readFileSync(new URL("../js/civitai/images.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ["'][^"']+["'];?\r?\n/gm, "")
    .replace(/^export /gm, "");

// Captured so the sidebar tests can inspect the options handed to each combo.
const capturedCombos = {};

const context = {
    URLSearchParams,
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
    renderActiveFilterChips: () => "",
    renderSelectorCombo: (options) => {
        capturedCombos[options.id] = options;
        return "";
    },
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
    `(() => { ${source}\n return { IMAGE_SORTS, imageResourceWeight, imageWeightsFromText, loraWeightsFromText, imageState, imageResourceKeys, checkedImageFiles, imageMedia, renderImageDiscover, renderImageFilters, renderImageSort, renderImageDetailAside, imageFileTargetKey, setImageTargets, parseImageLink, imagePeriodValue, loadImageFeed }; })()`,
    context,
);

const { IMAGE_SORTS, imageResourceWeight, imageWeightsFromText, loraWeightsFromText, imageState, imageResourceKeys, checkedImageFiles, imageMedia, renderImageDiscover, renderImageFilters, renderImageSort, renderImageDetailAside, imageFileTargetKey, setImageTargets, parseImageLink, imagePeriodValue, loadImageFeed } = images;

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

test("the loras of an image share one card instead of one card each", () => {
    const entry = (name, kind) => ({
        kind,
        name,
        model: { id: name.length, modelVersions: [{ name: "v1", files: [{ name: `${name}.safetensors`, sizeKB: 10 }] }] },
    });
    imageState.selectedImage = { id: 5, url: "https://example.com/a.jpg", username: "bob" };
    imageState.loadingResources = false;
    imageState.resourceError = "";
    imageState.checked = [];
    imageState.resources = [
        entry("LoraA", "lora"),
        entry("LoraB", "lora"),
        entry("Checkpoint", "checkpoint"),
        entry("LoraC", "lora"),
    ];
    const html = renderImageDetailAside();
    assert.equal((html.match(/data-image-resource-kind=/g) || []).length, 2);
    const loraCard = html.split('data-image-resource-kind="lora"')[1].split("</details>")[0];
    assert.equal((loraCard.match(/data-image-resource=/g) || []).length, 3);
    assert.ok(html.indexOf('data-image-resource-kind="checkpoint"') < html.indexOf('data-image-resource-kind="lora"'));
    // The checkpoint card is folded until clicked; the LoRA card is open.
    assert.ok(!html.split('data-image-resource-kind="checkpoint"')[1].split(">")[0].includes("open"));
    assert.ok(html.split('data-image-resource-kind="lora"')[1].split(">")[0].includes("open"));
    imageState.resources = [];
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

test("a pasted civitai link or bare id is read as an image id", () => {
    assert.equal(parseImageLink("https://civitai.com/images/146394239?modalId=1"), "146394239");
    assert.equal(parseImageLink("https://civitai.red/images/777"), "777");
    assert.equal(parseImageLink("  https://civitai.com/i/8888  "), "8888");
    assert.equal(parseImageLink("91234567"), "91234567");
    assert.equal(parseImageLink("solo lora"), "");
    assert.equal(parseImageLink("https://civitai.com/models/5"), "");
});

test("the feed request carries the base model and period filters", async () => {
    const urls = [];
    context.apiGet = async (path) => {
        urls.push(path);
        return { items: [], metadata: {} };
    };
    imageState.query = "";
    imageState.sort = "Most Reactions";
    imageState.period = "Week";
    imageState.baseModel = "SDXL 1.0";
    imageState.loading = false;
    await loadImageFeed({ reset: true });
    const params = new URLSearchParams(urls.at(-1).split("?")[1]);
    assert.equal(params.get("base_model"), "SDXL 1.0");
    assert.equal(params.get("period"), "Week");
    assert.equal(params.get("sort"), "Most Reactions");
    imageState.period = "AllTime";
    imageState.baseModel = "";
    imageState.sort = "Newest";
});

test("lora weights are read from air syntax and from json generation data", () => {
    const air = loraWeightsFromText("a cat <lora:Add-Detail XL:0.65> at night <lora:FilmGrain:0.3>");
    assert.equal(air.get("add detail xl"), 0.65);
    assert.equal(air.get("filmgrain"), 0.3);

    const json = loraWeightsFromText(JSON.stringify({ resources: [{ name: "Film Grain", weight: 0.45, type: "lora" }] }));
    assert.equal(json.get("film grain"), 0.45);
    assert.equal(loraWeightsFromText("no metadata here").size, 0);
});

test("a resource weight is rounded and defaults when the api omits it", () => {
    assert.equal(imageResourceWeight({ weight: 0.654 }), 0.65);
    assert.equal(imageResourceWeight({ weight: 0.3 }), 0.3);
    assert.equal(imageResourceWeight({}), 1);
    // Civitai sends `weight: null` for resources without one; Number(null) is 0.
    assert.equal(imageResourceWeight({ weight: null }), 1);
    assert.equal(imageResourceWeight({ weight: null }, 0.5), 0.5);
    assert.equal(imageResourceWeight({ weight: "" }), 1);
    assert.equal(imageResourceWeight({ weight: "0.35" }), 0.35);
    assert.equal(imageResourceWeight({ weight: 0 }), 0);
    assert.equal(imageResourceWeight({}, 0.5), 0.5);
});

test("pasted weights land on the matching lora resources only", () => {
    const resources = [
        { kind: "lora", name: "Add Detail XL", model: { modelVersions: [{ name: "v1" }] } },
        { kind: "checkpoint", name: "Krea 2 Turbo", model: { modelVersions: [{ name: "v1" }] } },
        { kind: "lora", name: "Film Grain", model: { modelVersions: [{ name: "v1" }] } },
    ];
    const weights = imageWeightsFromText("<lora:Add-Detail XL:0.6> <lora:FilmGrain.safetensors:0.25>", resources);
    assert.equal(JSON.stringify(weights), JSON.stringify({ 0: 0.6, 2: 0.25 }));
    assert.equal(JSON.stringify(imageWeightsFromText("nothing", resources)), "{}");
});

test("the sort menu offers exactly the five orders the image api accepts", () => {
    // JSON round-trip keeps the cross-realm array from failing a strict compare.
    assert.equal(
        JSON.stringify(IMAGE_SORTS.map((item) => item.value)),
        JSON.stringify(["Most Reactions", "Most Comments", "Most Collected", "Newest", "Oldest"]),
    );
    assert.ok(IMAGE_SORTS.some((item) => item.value === imageState.sort));
});

test("the sort menu renders one row per order and marks the current one", () => {
    imageState.sort = "Most Collected";
    const html = renderImageSort();
    assert.equal((html.match(/data-image-sort=/g) || []).length, 5);
    assert.ok(html.includes('data-image-sort="Most Reactions"'));
    assert.ok(html.includes('data-image-sort="Oldest"'));
    assert.ok(html.includes('aria-checked="true" data-image-sort="Most Collected"'));
    imageState.sort = "Newest";
});

test("the base model picker receives plain names, never objects", () => {
    renderImageFilters([{ name: "SDXL 1.0", count: 12 }, { name: "Flux.1 D", count: 3 }, "Pony"]);
    assert.equal(JSON.stringify(capturedCombos["image-base-model"].items), JSON.stringify(["SDXL 1.0", "Flux.1 D", "Pony"]));
});

test("a selected base model stays visible even before the taxonomy lists it", () => {
    imageState.baseModel = "Illustrious";
    renderImageFilters([{ name: "SDXL 1.0", count: 12 }]);
    assert.equal(JSON.stringify(capturedCombos["image-base-model"].items), JSON.stringify(["Illustrious", "SDXL 1.0"]));
    assert.equal(capturedCombos["image-base-model"].value, "Illustrious");
    imageState.baseModel = "";
});

test("period labels map back to the api values", () => {
    assert.equal(imagePeriodValue("Past week"), "Week");
    assert.equal(imagePeriodValue("All time"), "AllTime");
    assert.equal(imagePeriodValue("nonsense"), "AllTime");
});

test("the feed asks the legacy transformer first so no tile wastes a 404", () => {
    const id = "cb1b5647-4623-4a0e-9b2b-0e3c1a1b5cd7";
    const url = `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${id}/original=true/${id}.jpeg`;
    const feed = createPreviewMedia({ url, type: "image" }, 450, { preferLegacy: true });
    assert.match(feed.url, /width=450,optimized=true/);
    assert.equal(feed.fallbackUrls.length, 2);
    // Model cards keep the pre-generated variant they have always used.
    const card = createPreviewMedia({ url, type: "image" }, 450);
    assert.match(card.url, /image-b2\.civitai\.com/);
});

test("image media falls back to the raw url when it is not a civitai cache path", () => {
    const media = imageMedia({ url: "https://example.com/x.jpg" }, 450);
    assert.equal(media.url, "https://example.com/x.jpg");
    assert.equal(media.emptyText, "No Preview");
});
