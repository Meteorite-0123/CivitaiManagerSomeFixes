export const API = "/civitai-manager/api";
export const SEARCH_CACHE_KEY = "cmgr-civitai-search-cache";
export const SEARCH_CACHE_VERSION = "v9-early-access";
export const SEARCH_CACHE_TTL = 24 * 60 * 60 * 1000;
export const SEARCH_CACHE_LIMIT = 16;
export const INITIAL_PREVIEW_LOADS = 12;
export const SEARCH_PAGE_SIZE = 40;
export const HIGH_PRIORITY_PREVIEW_LOADS = 4;

export const TABS = ["Discover", "Library", "Favorites", "Downloads", "Settings"];

export const ASSET_KINDS = [
    { id: "checkpoint", label: "Checkpoint/UNet", rootKinds: ["checkpoints", "unet"] },
    { id: "lora", label: "LoRA", rootKinds: ["loras"] },
    { id: "workflow", label: "Workflow", rootKinds: ["workflows"] },
    // Discover-only feed: Civitai images and the models they were made with.
    { id: "images", label: "Images", rootKinds: [], discoverOnly: true },
];

// Library-only tab that collects every model folder outside the classic kinds.
export const OTHER_LIBRARY_KIND = "other";

export const CIVITAI_CATEGORY_FILTERS = [
    { label: "Action", value: "action" },
    { label: "Animal", value: "animal" },
    { label: "Assets", value: "assets" },
    { label: "Background", value: "background" },
    { label: "Base Model", value: "base model" },
    { label: "Buildings", value: "buildings" },
    { label: "Celebrity", value: "celebrity" },
    { label: "Character", value: "character" },
    { label: "Clothing", value: "clothing" },
    { label: "Concept", value: "concept" },
    { label: "Objects", value: "objects" },
    { label: "Poses", value: "poses" },
    { label: "Style", value: "style" },
    { label: "Tool", value: "tool" },
    { label: "Vehicle", value: "vehicle" },
];

export const ROOT_KINDS = [
    { id: "checkpoints", label: "Checkpoints" },
    { id: "unet", label: "UNet / Diffusion Models" },
    { id: "loras", label: "LoRAs" },
    { id: "workflows", label: "Workflows" },
];

// Used until /config answers; keeps the folder picker usable on first render.
export const DEFAULT_TARGET_KINDS = [
    { id: "checkpoints", label: "Checkpoints" },
    { id: "unet", label: "UNet / Diffusion Models" },
    { id: "loras", label: "LoRAs" },
    { id: "vae", label: "VAE" },
    { id: "text_encoders", label: "Text Encoders" },
    { id: "clip", label: "CLIP" },
    { id: "clip_vision", label: "CLIP Vision" },
    { id: "controlnet", label: "ControlNet" },
    { id: "style_models", label: "Style Models" },
    { id: "upscale_models", label: "Upscale Models" },
    { id: "embeddings", label: "Embeddings" },
    { id: "hypernetworks", label: "Hypernetworks" },
    { id: "gligen", label: "GLIGEN" },
    { id: "photomaker", label: "PhotoMaker" },
    { id: "diffusers", label: "Diffusers" },
    { id: "vae_approx", label: "VAE Approx" },
    { id: "model_patches", label: "Model Patches" },
    { id: "audio_encoders", label: "Audio Encoders" },
    { id: "configs", label: "Configs" },
    { id: "classifiers", label: "Classifiers" },
    { id: "workflows", label: "Workflows" },
];

export const ROOT_LOCAL_FOLDER = "__cmgr_root_files__";
