"""Backend API for the CivitaiManager ComfyUI extension."""

from __future__ import annotations

import asyncio
import hashlib
import http.client
import json
import mimetypes
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import folder_paths
from aiohttp import web
from server import PromptServer

try:
    from .backend.client import (
        civitai_red_url as _civitai_red_url,
        fetch as _fetch,
        http_error_message as _http_error_message,
        request_headers as _request_headers,
        validate_civitai_https as _validate_civitai_https,
    )
    from .backend.config import normalize_config as _normalize_config_values, parse_bool as _config_bool
    from .backend.downloads import DownloadJobStore
    from .backend.library import LibraryIndex
    from .backend.routes import register_routes
except ImportError:  # Standalone test loading
    from backend.client import (
        civitai_red_url as _civitai_red_url,
        fetch as _fetch,
        http_error_message as _http_error_message,
        request_headers as _request_headers,
        validate_civitai_https as _validate_civitai_https,
    )
    from backend.config import normalize_config as _normalize_config_values, parse_bool as _config_bool
    from backend.downloads import DownloadJobStore
    from backend.library import LibraryIndex
    from backend.routes import register_routes


API_PREFIX = "/civitai-manager/api"
CIVITAI_API_BASE = "https://civitai.red/api/v1"
CIVITAI_DOWNLOAD_BASE = "https://civitai.red/api/download/models"
MODEL_EXTENSIONS = {".ckpt", ".pt", ".pt2", ".bin", ".pth", ".safetensors", ".pkl", ".sft", ".gguf"}
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
WORKFLOW_EXTENSIONS = {".json"}
# A workflow file is parsed in the backend; anything this large is not a graph.
WORKFLOW_CONTENT_MAX_BYTES = 16 * 1024 * 1024
# Civitai ships some workflow bundles as a ZIP of graph + wildcards + readme.
# Archives may start with an empty archive or a spanned marker, not only a
# local file header, so every documented signature is accepted.
ZIP_MAGICS = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
CONFIG_EXTENSIONS = {".json", ".yaml", ".yml", ".txt"}
REMOTE_IMAGE_CACHE_WIDTH_DEFAULT = 450
REMOTE_IMAGE_COMMON_WIDTHS = (96, 320, 450, 512, 800, 1200, 1600, 2200)
CIVITAI_IMAGE_HOSTS = {"image.civitai.com", "imagecache.civitai.com", "image-b2.civitai.com"}
CIVITAI_IMAGE_LOCATION = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA"
CIVITAI_MEDIA_ID_RE = re.compile(
    r"(?:^|/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/|$)",
    re.IGNORECASE,
)
TAXONOMY_CACHE_TTL = 10 * 60
SEARCH_RESULT_CACHE_TTL = 5 * 60
SEARCH_RESULT_CACHE_LIMIT = 64
MODEL_DETAIL_CACHE_TTL = 5 * 60
MODEL_DETAIL_CACHE_LIMIT = 64
# Search cards only need these fields; /model-detail delivers the full record.
SEARCH_MODEL_FIELDS = ("id", "name", "type", "nsfw", "nsfwLevel", "tags", "stats", "availability")
SEARCH_VERSION_FIELDS = ("id", "name", "baseModel", "baseModelType", "publishedAt", "trainedWords", "stats", "availability", "earlyAccessEndsAt", "paidAccess")
SEARCH_FILE_FIELDS = ("id", "name", "sizeKB", "type", "primary", "metadata", "hashes", "downloadUrl")
SEARCH_IMAGE_FIELDS = ("url", "type", "nsfwLevel", "width", "height")
SEARCH_PRIMARY_IMAGE_LIMIT = 12
# The sort values Civitai's own model browser offers. Anything outside this
# list is silently rewritten server-side, so an old saved value can never make
# the endpoint answer 400.
MODEL_SORTS = (
    "Hot",
    "Highest Rated",
    "Most Downloaded",
    "Most Liked",
    "Most Discussed",
    "Most Collected",
    "Most Images",
    "Newest",
    "Oldest",
)
MODEL_PERIODS = ("AllTime", "Day", "Week", "Month", "Year")
MODEL_FILE_FORMATS = ("SafeTensor", "PickleTensor", "GGUF", "Diffusers", "ONNX", "Core ML", "Other")
# Status filters have no query parameter in the public API, so they are applied
# to the fetched pages here (the same place base models are checked).
MODEL_STATUSES = ("paid", "free")
SEARCH_FILTER_PAGE_LIMIT = 5
# Civitai's image feed and the resources each image was generated with.
IMAGES_URL = f"{CIVITAI_API_BASE}/images"
IMAGE_FEED_PAGE_SIZE = 40
IMAGE_FEED_CACHE_TTL = 60
IMAGE_FEED_CACHE_LIMIT = 64
IMAGE_RESOURCE_KINDS = {
    "checkpoint": "checkpoint",
    "lora": "lora",
    "locon": "lora",
    "lycoris": "lora",
    "dora": "lora",
    "embed": "embed",
    "embedding": "embed",
    "vae": "vae",
    "workflow": "workflow",
    "unet": "checkpoint",
    "diffusion model": "checkpoint",
}
DOWNLOADABLE_IMAGE_RESOURCE_KINDS = {"checkpoint", "lora", "workflow"}
IMAGE_RESOURCE_FETCH_WORKERS = 4
CIVITAI_IMAGE_URL_RE = re.compile(r"civitai\.(?:com|red)/(?:images|i)/(\d+)", re.IGNORECASE)
SEARCH_FALLBACK_CURSOR_PREFIX = "fallback:"
SEARCH_ATTEMPT_CURSOR_PREFIX = "attempt:"
SEARCH_FALLBACK_MAX_PAGES = 8
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}
DOWNLOAD_MAX_WORKERS = 3
DOWNLOAD_MAX_ACTIVE_JOBS = 20
DOWNLOAD_JOB_HISTORY_LIMIT = 100
DOWNLOAD_JOB_RETENTION_SECONDS = 24 * 60 * 60
ASSET_ROOT_KINDS = {"checkpoints", "unet", "loras", "workflows"}
ROOT_KIND_FAMILIES = {
    "checkpoints": "checkpoint",
    "unet": "checkpoint",
    "loras": "lora",
    "workflows": "workflow",
}
# Downloads keep the "<Base model>/<Category>/" layout only for the classic
# model kinds. Every other model folder stores files at its root instead.
STRUCTURED_ROOT_KINDS = {"checkpoints", "unet", "loras"}
# Every model folder a download may target, in the order the picker shows them.
TARGET_ROOT_ORDER = (
    "checkpoints",
    "unet",
    "loras",
    "vae",
    "text_encoders",
    "clip",
    "clip_vision",
    "controlnet",
    "style_models",
    "upscale_models",
    "embeddings",
    "hypernetworks",
    "gligen",
    "photomaker",
    "diffusers",
    "vae_approx",
    "model_patches",
    "audio_encoders",
    "configs",
    "classifiers",
    "workflows",
)
TARGET_ROOT_LABELS = {
    "checkpoints": "Checkpoints",
    "unet": "UNet / Diffusion Models",
    "loras": "LoRAs",
    "vae": "VAE",
    "text_encoders": "Text Encoders",
    "clip": "CLIP",
    "clip_vision": "CLIP Vision",
    "controlnet": "ControlNet",
    "style_models": "Style Models",
    "upscale_models": "Upscale Models",
    "embeddings": "Embeddings",
    "hypernetworks": "Hypernetworks",
    "gligen": "GLIGEN",
    "photomaker": "PhotoMaker",
    "diffusers": "Diffusers",
    "vae_approx": "VAE Approx",
    "model_patches": "Model Patches",
    "audio_encoders": "Audio Encoders",
    "configs": "Configs",
    "classifiers": "Classifiers",
    "workflows": "Workflows",
}
# Civitai file roles and the model folder each one belongs in.
FILE_ROLE_ROOT_KINDS = {
    "vae": "vae",
    "text_encoder": "text_encoders",
    "config": "configs",
}
MODEL_FOLDERS_CACHE_TTL = 15.0
WINDOWS_RESERVED_SEGMENTS = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}

_CONFIG_CACHE: dict[str, Any] | None = None
_CONFIG_LOCK = threading.Lock()
_DOWNLOAD_QUEUE: queue.Queue[tuple[str, str, str, str, dict[str, Any], str]] = queue.Queue(
    maxsize=DOWNLOAD_MAX_ACTIVE_JOBS
)
_DOWNLOAD_WORKERS_LOCK = threading.Lock()
_DOWNLOAD_WORKERS_STARTED = False
_DOWNLOAD_STORE: DownloadJobStore | None = None
_DOWNLOAD_STORE_LOCK = threading.Lock()
_HASH_METADATA_LOCK = threading.Lock()
_HASH_METADATA_REQUEST_LOCK = asyncio.Lock()
_TAXONOMY_CACHE: dict[str, dict[str, Any]] = {}
_TAXONOMY_LOCK = threading.Lock()
_SEARCH_RESULT_CACHE: dict[tuple[Any, ...], dict[str, Any]] = {}
_SEARCH_RESULT_CACHE_LOCK = threading.Lock()
_MODEL_DETAIL_CACHE: dict[tuple[str, str], dict[str, Any]] = {}
_MODEL_DETAIL_CACHE_LOCK = threading.Lock()
_IMAGE_FEED_CACHE: dict[tuple[Any, ...], dict[str, Any]] = {}
_IMAGE_FEED_CACHE_LOCK = threading.Lock()
_FAVORITES_LOCK = threading.Lock()
_LIBRARY_INDEX = LibraryIndex(ttl_seconds=30)
_MODEL_FOLDERS_LOCK = threading.Lock()
_MODEL_FOLDERS_CACHE: tuple[float, dict[str, list[str]]] | None = None


def _install_windows_proactor_shutdown_guard() -> None:
    """Suppress noisy Windows asyncio cleanup errors for already-closed pipes.

    Python's Proactor event loop can log an exception from
    _ProactorBasePipeTransport._call_connection_lost when the browser closes an
    HTTP connection while a response is being cleaned up. The connection is
    already gone, so this is not actionable for the plugin or user.
    """
    if os.name != "nt":
        return
    try:
        import asyncio.proactor_events as proactor_events

        transport_cls = getattr(proactor_events, "_ProactorBasePipeTransport", None)
        original = getattr(transport_cls, "_call_connection_lost", None)
        if not transport_cls or not original or getattr(original, "_civitai_manager_guarded", False):
            return

        def guarded_call_connection_lost(self, exc):  # type: ignore[no-untyped-def]
            try:
                return original(self, exc)
            except OSError:
                return None

        guarded_call_connection_lost._civitai_manager_guarded = True  # type: ignore[attr-defined]
        transport_cls._call_connection_lost = guarded_call_connection_lost
    except Exception:
        return


_install_windows_proactor_shutdown_guard()


def _now() -> int:
    return int(time.time())


def _plugin_data_dir() -> str:
    path = os.path.join(folder_paths.get_user_directory(), "civitai_manager")
    os.makedirs(path, exist_ok=True)
    return path


def _config_path() -> str:
    return os.path.join(_plugin_data_dir(), "config.json")


def _favorites_path() -> str:
    return os.path.join(_plugin_data_dir(), "favorites.json")


def _default_workflow_dir() -> str:
    return os.path.join(folder_paths.get_user_directory(), "default", "workflows")


def _default_config() -> dict[str, Any]:
    return {
        "civitai_api_key": "",
        "allow_nsfw": False,
        "workflow_dir": _default_workflow_dir(),
        "save_metadata": True,
        "save_preview": True,
    }


def _normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    return _normalize_config_values(config, _default_config())


def load_config() -> dict[str, Any]:
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None:
        return dict(_CONFIG_CACHE)

    config = _default_config()
    path = _config_path()
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                config.update(data)
            config = _normalize_config(config)
        except Exception as exc:
            print(f"[CivitaiManager] Failed to read config: {exc}")
            config = _normalize_config(_default_config())
    else:
        config = _normalize_config(config)

    _CONFIG_CACHE = config
    return dict(config)


def save_config(data: dict[str, Any]) -> dict[str, Any]:
    with _CONFIG_LOCK:
        return _save_config_unlocked(data)


def _save_config_unlocked(data: dict[str, Any]) -> dict[str, Any]:
    global _CONFIG_CACHE
    current = load_config()
    writable = {
        "civitai_api_key",
        "allow_nsfw",
        "workflow_dir",
        "save_metadata",
        "save_preview",
    }
    for key in writable:
        if key in data:
            current[key] = data[key]
    current = _normalize_config(current)

    path = _config_path()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(current, handle, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)
    _CONFIG_CACHE = current
    _invalidate_model_root_cache()
    with _TAXONOMY_LOCK:
        _TAXONOMY_CACHE.clear()
    with _SEARCH_RESULT_CACHE_LOCK:
        _SEARCH_RESULT_CACHE.clear()
    with _MODEL_DETAIL_CACHE_LOCK:
        _MODEL_DETAIL_CACHE.clear()
    return dict(current)


def _public_config(config: dict[str, Any]) -> dict[str, Any]:
    public = dict(config)
    public["civitai_api_key"] = ""
    public["api_key_set"] = bool(config.get("civitai_api_key"))
    public["roots"] = _root_display()
    public["target_kinds"] = _target_root_kinds()
    return public


def _favorite_asset_kind(root_kind: Any, fallback: Any = "") -> str:
    normalized_root = str(root_kind or "").strip().lower()
    kind = ROOT_KIND_FAMILIES.get(normalized_root, str(fallback or "").strip().lower())
    if kind not in {"checkpoint", "lora", "workflow"}:
        raise ValueError("Invalid favorite asset kind")
    return kind


def _favorite_item_key(item: dict[str, Any]) -> str:
    model = item.get("model") if isinstance(item.get("model"), dict) else {}
    local = item.get("local") if isinstance(item.get("local"), dict) else {}
    asset_kind = _favorite_asset_kind(
        item.get("root_kind") or local.get("root_kind"),
        item.get("asset_kind"),
    )
    model_id = str(item.get("model_id") or model.get("id") or "").strip()
    if model_id:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", model_id):
            raise ValueError("Invalid favorite model id")
        return f"civitai:{asset_kind}:{model_id}"
    root_kind = str(item.get("root_kind") or local.get("root_kind") or "").strip().lower()
    relative_path = str(item.get("relative_path") or local.get("relative_path") or "").strip().replace("\\", "/")
    storage_root_id = str(item.get("storage_root_id") or local.get("storage_root_id") or "").strip()
    if not root_kind or not relative_path:
        key = str(item.get("key") or "").strip()
        if re.fullmatch(r"[A-Za-z0-9:._-]{1,200}", key):
            return key
        raise ValueError("Favorite requires a Civitai model id or local asset path")
    digest = hashlib.sha256(f"{root_kind}\0{storage_root_id}\0{relative_path}".encode("utf-8")).hexdigest()[:24]
    return f"local:{asset_kind}:{digest}"


def _normalize_favorite_item(item: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError("Favorite item must be an object")
    model = item.get("model") if isinstance(item.get("model"), dict) else {}
    local = item.get("local") if isinstance(item.get("local"), dict) else {}
    root_kind = str(item.get("root_kind") or local.get("root_kind") or "").strip().lower()
    asset_kind = _favorite_asset_kind(root_kind, item.get("asset_kind"))
    model_id = str(item.get("model_id") or model.get("id") or "").strip()
    name = str(item.get("name") or model.get("name") or local.get("name") or "").strip()[:300]
    if not name:
        raise ValueError("Favorite name is required")
    source = "remote" if model else "local"
    sources = {
        str(value).strip().lower()
        for value in (item.get("sources") if isinstance(item.get("sources"), list) else [item.get("source"), source])
        if str(value or "").strip().lower() in {"local", "remote"}
    }
    if source:
        sources.add(source)
    normalized_local = {}
    if root_kind and str(item.get("relative_path") or local.get("relative_path") or "").strip():
        normalized_local = {
            "asset_id": str(item.get("asset_id") or local.get("asset_id") or "")[:500],
            "root_kind": root_kind,
            "storage_root_id": str(item.get("storage_root_id") or local.get("storage_root_id") or "")[:200],
            "relative_path": str(item.get("relative_path") or local.get("relative_path") or "").replace("\\", "/")[:1000],
            "filename": str(item.get("filename") or local.get("filename") or "")[:300],
        }
    now = _now()
    normalized = {
        "key": "",
        "asset_kind": asset_kind,
        "source": source,
        "sources": sorted(sources),
        "model_id": model_id,
        "version_id": str(item.get("version_id") or "")[:100],
        "name": name,
        "creator": str(item.get("creator") or (model.get("creator") or {}).get("username") or "")[:200],
        "base_model": str(item.get("base_model") or "")[:200],
        "type": str(item.get("type") or model.get("type") or asset_kind)[:100],
        "preview_url": str(item.get("preview_url") or item.get("thumb_url") or "")[:4000],
        "civitai_url": str(item.get("civitai_url") or "")[:2000],
        "folder_id": str(item.get("folder_id") or "")[:100],
        "model": model,
        "local": normalized_local,
        "created_at": int(item.get("created_at") or now),
        "updated_at": int(item.get("updated_at") or now),
    }
    normalized["key"] = _favorite_item_key(normalized)
    return normalized


def _favorite_item_from_asset(asset: dict[str, Any]) -> dict[str, Any]:
    root_kind = str(asset.get("root_kind") or "")
    return _normalize_favorite_item({
        "asset_kind": _favorite_asset_kind(root_kind),
        "source": "local",
        "model_id": asset.get("model_id") or "",
        "version_id": asset.get("version_id") or "",
        "name": asset.get("name") or asset.get("filename") or "Local asset",
        "creator": asset.get("creator") or "",
        "base_model": asset.get("base_model") or "",
        "type": root_kind,
        "preview_url": asset.get("thumb_url") or "",
        "civitai_url": asset.get("civitai_url") or "",
        "local": {
            "asset_id": asset.get("id") or "",
            "root_kind": root_kind,
            "storage_root_id": asset.get("storage_root_id") or "",
            "relative_path": asset.get("relative_path") or "",
            "filename": asset.get("filename") or "",
        },
    })


def _empty_favorite_store() -> dict[str, Any]:
    return {"version": 1, "folders": [], "items": [], "updated_at": _now()}


def _normalize_favorite_store(data: Any) -> dict[str, Any]:
    store = _empty_favorite_store()
    if not isinstance(data, dict):
        return store
    folders = []
    seen_folder_ids: set[str] = set()
    for raw in data.get("folders") if isinstance(data.get("folders"), list) else []:
        if not isinstance(raw, dict):
            continue
        folder_id = str(raw.get("id") or "").strip()
        name = str(raw.get("name") or "").strip()[:80]
        if not folder_id or folder_id in seen_folder_ids or not name:
            continue
        seen_folder_ids.add(folder_id)
        folders.append({
            "id": folder_id[:100],
            "name": name,
            "created_at": int(raw.get("created_at") or _now()),
            "updated_at": int(raw.get("updated_at") or _now()),
        })
    items = []
    seen_item_keys: set[str] = set()
    for raw in data.get("items") if isinstance(data.get("items"), list) else []:
        try:
            item = _normalize_favorite_item(raw)
        except ValueError:
            continue
        if item["key"] in seen_item_keys:
            continue
        seen_item_keys.add(item["key"])
        if item["folder_id"] not in seen_folder_ids:
            item["folder_id"] = ""
        items.append(item)
    store.update({
        "folders": folders,
        "items": items,
        "updated_at": int(data.get("updated_at") or _now()),
    })
    return store


def _write_favorites_unlocked(store: dict[str, Any]) -> None:
    path = _favorites_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.{uuid.uuid4().hex}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(store, handle, indent=2, ensure_ascii=False)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _load_favorites_unlocked() -> dict[str, Any]:
    path = _favorites_path()
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return _normalize_favorite_store(json.load(handle))
        except Exception as exc:
            print(f"[CivitaiManager] Failed to read favorites: {exc}")
            return _empty_favorite_store()
    store = _empty_favorite_store()
    try:
        snapshot = _scan_roots(False)
        migrated = []
        for asset in snapshot.get("items") if isinstance(snapshot, dict) else []:
            if not isinstance(asset, dict) or not asset.get("favorite"):
                continue
            try:
                migrated.append(_favorite_item_from_asset(asset))
            except ValueError:
                continue
        store["items"] = migrated
    except Exception as exc:
        print(f"[CivitaiManager] Failed to migrate legacy favorites: {exc}")
    _write_favorites_unlocked(store)
    return store


def _favorite_store_response(store: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_favorite_store(store)
    normalized["folders"].sort(key=lambda folder: (folder["name"].lower(), folder["id"]))
    normalized["items"].sort(key=lambda item: (-int(item.get("updated_at") or 0), item["name"].lower()))
    return normalized


def _load_favorites() -> dict[str, Any]:
    with _FAVORITES_LOCK:
        return _favorite_store_response(_load_favorites_unlocked())


def _mutate_favorite_item(item: dict[str, Any], favorite: bool, folder_id: str | None = None) -> dict[str, Any]:
    normalized = _normalize_favorite_item(item)
    with _FAVORITES_LOCK:
        store = _load_favorites_unlocked()
        by_key = {entry["key"]: entry for entry in store["items"]}
        existing = by_key.get(normalized["key"])
        if favorite:
            merged = {**(existing or {}), **normalized}
            if existing and existing.get("model") and not normalized.get("model"):
                merged["model"] = existing["model"]
            if existing and existing.get("local") and not normalized.get("local"):
                merged["local"] = existing["local"]
            sources = set(existing.get("sources") or []) if existing else set()
            sources.update(normalized.get("sources") or [])
            merged["sources"] = sorted(sources)
            merged["source"] = "remote" if merged.get("model") else "local"
            merged["created_at"] = int(existing.get("created_at") or _now()) if existing else _now()
            merged["updated_at"] = _now()
            if folder_id is None:
                merged["folder_id"] = str(existing.get("folder_id") or "") if existing else ""
            else:
                valid_folder_ids = {folder["id"] for folder in store["folders"]}
                if folder_id and folder_id not in valid_folder_ids:
                    raise ValueError("Favorite folder not found")
                merged["folder_id"] = folder_id
            by_key[normalized["key"]] = merged
        else:
            by_key.pop(normalized["key"], None)
        store["items"] = list(by_key.values())
        store["updated_at"] = _now()
        _write_favorites_unlocked(store)
        return _favorite_store_response(store)


def _favorite_folder_name(value: Any) -> str:
    name = re.sub(r"[\x00-\x1f]+", " ", str(value or "")).strip()
    if not name:
        raise ValueError("Favorite folder name is required")
    return name[:80]


def _read_json_url(url: str, api_key: str | None = None, timeout: int = 30, quiet: bool = False) -> dict[str, Any] | None:
    try:
        status, reason, body = _fetch(url, _request_headers(api_key), timeout)
    except Exception as exc:
        if not quiet:
            print(f"[CivitaiManager] Request failed for {url}: {exc}")
        return {"error": str(exc)}
    raw = body.decode("utf-8", errors="replace")
    if status >= 400:
        snippet = raw[:500]
        if not quiet:
            print(f"[CivitaiManager] HTTP {status} for {url}: {snippet or reason}")
        return {
            "error": _http_error_message(snippet, f"HTTP {status}: {reason}"),
            "status": status,
            "body": snippet,
            "retryable": status in RETRYABLE_HTTP_STATUS,
        }
    if not raw.strip():
        return {"error": "Empty response from Civitai"}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"[CivitaiManager] Invalid JSON for {url}: {exc}")
        return {"error": "Invalid JSON response from Civitai"}


def _is_retryable_result(result: dict[str, Any] | None) -> bool:
    if not isinstance(result, dict):
        return False
    status = result.get("status")
    return bool(result.get("retryable")) or status in RETRYABLE_HTTP_STATUS


def _is_invalid_cursor_result(result: dict[str, Any] | None) -> bool:
    if not isinstance(result, dict):
        return False
    if result.get("status") != 400:
        return False
    text = f"{result.get('error') or ''} {result.get('body') or ''}".lower()
    return "invalid cursor" in text


def _read_json_url_with_retries(
    url: str,
    api_key: str | None = None,
    timeout: int = 30,
    retries: int = 2,
    quiet: bool = False,
) -> dict[str, Any] | None:
    last_result: dict[str, Any] | None = None
    for attempt in range(max(0, retries) + 1):
        last_result = _read_json_url(url, api_key, timeout, quiet=quiet or attempt < retries)
        if not _is_retryable_result(last_result):
            return last_result
        if attempt < retries:
            time.sleep(0.45 * (attempt + 1))
    return last_result


def _safe_segment(value: Any, fallback: str = "Other", max_len: int = 80) -> str:
    text = str(value or "").strip()
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", text)
    text = re.sub(r"\s+", " ", text).strip(" ._")
    if not text:
        text = fallback
    text = text[:max_len].strip(" ._") or fallback
    if text and os.path.splitext(text)[0].upper() in WINDOWS_RESERVED_SEGMENTS:
        text = f"_{text}"
    return text


def _safe_filename(value: Any, fallback: str, extension: str = ".safetensors") -> str:
    text = _safe_segment(value, fallback=fallback, max_len=160)
    root, ext = os.path.splitext(text)
    if not ext:
        text = f"{text}{extension}"
    return text


def _safe_join(root: str, *parts: str) -> str:
    root_abs = os.path.abspath(root)
    path_abs = os.path.abspath(os.path.join(root_abs, *parts))
    root_real = os.path.normcase(os.path.realpath(root_abs))
    path_real = os.path.normcase(os.path.realpath(path_abs))
    if os.path.commonpath([root_real, path_real]) != root_real:
        raise ValueError("Resolved path escapes allowed root")
    return path_abs


def _normalize_root_kind(root_kind: Any) -> str:
    normalized = str(root_kind or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{1,64}", normalized):
        raise ValueError(f"Unknown asset root: {normalized or '(empty)'}")
    if normalized not in _model_root_map():
        raise ValueError(f"Unknown asset root: {normalized}")
    return normalized


def _extensions_for_root(root_kind: str) -> set[str]:
    normalized = _normalize_root_kind(root_kind)
    if normalized == "workflows":
        return WORKFLOW_EXTENSIONS
    if normalized == "configs":
        return CONFIG_EXTENSIONS
    return MODEL_EXTENSIONS


def _validate_asset_filename(root_kind: str, filename: str) -> str:
    normalized = _normalize_root_kind(root_kind)
    name = os.path.basename(str(filename or ""))
    extension = os.path.splitext(name)[1].lower()
    if name.lower().endswith(".civitai.json"):
        raise ValueError("Companion metadata is not an asset")
    if extension not in _extensions_for_root(normalized):
        allowed = ", ".join(sorted(_extensions_for_root(normalized)))
        raise ValueError(f"Invalid {normalized} file extension; expected one of: {allowed}")
    return name


def _validate_root_transition(source_root_kind: str, target_root_kind: str) -> None:
    source = _normalize_root_kind(source_root_kind)
    target = _normalize_root_kind(target_root_kind)
    # Workflows live outside the models tree, so they never mix with model folders.
    if (source == "workflows") != (target == "workflows"):
        raise ValueError(f"Cannot move an asset from {source} to {target}")


def _first_folder_path(folder_name: str, fallback: str) -> str:
    return _folder_paths(folder_name, fallback)[0]


def _folder_paths(folder_name: str, fallback: str) -> list[str]:
    candidates: list[str] = []
    try:
        candidates.extend(folder_paths.get_folder_paths(folder_name) or [])
    except Exception:
        pass
    candidates.append(fallback)
    unique: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        clean = str(candidate or "").strip()
        if not clean:
            continue
        path = os.path.abspath(os.path.expanduser(clean))
        key = os.path.normcase(os.path.realpath(path))
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique or [os.path.abspath(fallback)]


def _extra_model_folder_roots() -> dict[str, list[str]]:
    """Folders under ComfyUI's models directory that ComfyUI does not register."""
    global _MODEL_FOLDERS_CACHE
    now = time.monotonic()
    with _MODEL_FOLDERS_LOCK:
        cached = _MODEL_FOLDERS_CACHE
        if cached and now - cached[0] < MODEL_FOLDERS_CACHE_TTL:
            return {kind: list(paths) for kind, paths in cached[1].items()}
    discovered: dict[str, list[str]] = {}
    try:
        base = os.path.abspath(str(folder_paths.models_dir))
        names = sorted(os.listdir(base))
    except Exception:
        names = []
    for name in names:
        path = os.path.join(base, name)
        if not os.path.isdir(path):
            continue
        kind = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
        if not kind or kind in TARGET_ROOT_ORDER:
            continue
        discovered[kind] = [path]
    with _MODEL_FOLDERS_LOCK:
        _MODEL_FOLDERS_CACHE = (now, discovered)
    return {kind: list(paths) for kind, paths in discovered.items()}


def _target_paths_for(root_kind: str) -> list[str]:
    models_dir = os.path.abspath(str(folder_paths.models_dir))
    if root_kind == "workflows":
        return [os.path.abspath(str(load_config().get("workflow_dir") or _default_workflow_dir()))]
    if root_kind == "unet":
        return _folder_paths("diffusion_models", os.path.join(models_dir, "unet"))
    return _folder_paths(root_kind, os.path.join(models_dir, root_kind))


def _model_root_map() -> dict[str, list[str]]:
    roots: dict[str, list[str]] = {}
    known: set[str] = set()
    for kind in TARGET_ROOT_ORDER:
        paths = _target_paths_for(kind)
        roots[kind] = paths
        known.update(os.path.normcase(os.path.realpath(path)) for path in paths)
    for kind, paths in _extra_model_folder_roots().items():
        if kind in roots:
            continue
        keys = {os.path.normcase(os.path.realpath(path)) for path in paths}
        if keys & known:
            # Same physical folder as a known kind (e.g. models/unet or models/clip).
            continue
        roots[kind] = paths
        known.update(keys)
    return roots


def _prettify_root_kind(root_kind: str) -> str:
    words = str(root_kind or "").replace("_", " ").split()
    return " ".join(word[:1].upper() + word[1:] for word in words) or "Models"


def _root_kind_label(root_kind: str) -> str:
    normalized = str(root_kind or "").strip().lower()
    return TARGET_ROOT_LABELS.get(normalized) or _prettify_root_kind(normalized)


def _target_root_kinds() -> list[dict[str, Any]]:
    return [
        {
            "id": kind,
            "label": _root_kind_label(kind),
            "path": paths[0] if paths else "",
            "paths": list(paths),
        }
        for kind, paths in _model_root_map().items()
    ]


def _invalidate_model_root_cache() -> None:
    global _MODEL_FOLDERS_CACHE
    with _MODEL_FOLDERS_LOCK:
        _MODEL_FOLDERS_CACHE = None


def _roots_for_kind(root_kind: str) -> list[str]:
    normalized = _normalize_root_kind(root_kind)
    if normalized in TARGET_ROOT_ORDER:
        return _target_paths_for(normalized)
    # Dynamically discovered folders keep the exact path (and case) they were found at.
    return list(_model_root_map().get(normalized, []))


def _root_for_kind(root_kind: str) -> str:
    return _roots_for_kind(root_kind)[0]


def _storage_root_id(root_path: str) -> str:
    normalized = os.path.normcase(os.path.realpath(os.path.abspath(root_path)))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _storage_root_for_asset(root_kind: str, storage_root_id: Any = "") -> str:
    requested = str(storage_root_id or "").strip().lower()
    if not requested:
        return _root_for_kind(root_kind)
    for root in _roots_for_kind(root_kind):
        if _storage_root_id(root) == requested:
            return root
    raise ValueError("Unknown model storage root")


def _root_display() -> dict[str, str]:
    return {kind: paths[0] for kind, paths in _model_root_map().items() if paths}


def _category_name(model: dict[str, Any]) -> str:
    category = model.get("category")
    if isinstance(category, dict):
        return _safe_segment(category.get("name"), "Other")
    if isinstance(category, str):
        return _safe_segment(category, "Other")
    for key in ("modelCategory", "categoryName"):
        if model.get(key):
            return _safe_segment(model.get(key), "Other")
    tags = model.get("tags")
    if isinstance(tags, list):
        for tag in tags:
            clean = _safe_segment(tag, "")
            if clean:
                return clean
    return "Other"


def _kind_to_civitai_type(kind: str) -> str:
    kind = str(kind or "").lower()
    if kind == "checkpoint":
        return "Checkpoint"
    if kind == "workflow":
        return "Workflows"
    return "LORA"


def _normalize_asset_kind(kind: str) -> str:
    kind = str(kind or "").lower()
    if kind in {"checkpoint", "workflow", "lora"}:
        return kind
    return "lora"


def _api_key_cache_part(api_key: str | None) -> str:
    if not api_key:
        return "public"
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:12]


def _taxonomy_cache_key(kind: str, config: dict[str, Any]) -> str:
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    return "|".join((
        "taxonomy-enums-v1",
        _normalize_asset_kind(kind),
        "nsfw" if config.get("allow_nsfw") else "sfw",
        _api_key_cache_part(api_key),
    ))


def _empty_taxonomy(kind: str, warning: str = "") -> dict[str, Any]:
    data = {
        "kind": _normalize_asset_kind(kind),
        "categories": [],
        "baseModels": [],
        "modelTypes": [],
        "tags": [],
        "updated_at": _now(),
    }
    if warning:
        data["warning"] = warning
    return data


def _model_base_models(model: dict[str, Any]) -> list[str]:
    values: list[str] = []
    raw_models = model.get("baseModels")
    if isinstance(raw_models, list):
        values.extend(str(item) for item in raw_models if item)
    for key in ("baseModel", "baseModelType"):
        if model.get(key):
            values.append(str(model.get(key)))
    versions = model.get("modelVersions")
    if isinstance(versions, list):
        for version in versions:
            if not isinstance(version, dict):
                continue
            for key in ("baseModel", "baseModelType"):
                if version.get(key):
                    values.append(str(version.get(key)))
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        name = _safe_segment(value, "")
        key = name.lower()
        if not name or key in seen:
            continue
        seen.add(key)
        cleaned.append(name)
    return cleaned or ["Other"]


def _model_tags(model: dict[str, Any]) -> list[str]:
    raw_tags = model.get("tags")
    if not isinstance(raw_tags, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in raw_tags:
        name = _safe_segment(value, "")
        key = name.lower()
        if not name or key in seen:
            continue
        seen.add(key)
        cleaned.append(name)
    return cleaned


def _taxonomy_from_items(kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    categories: dict[str, int] = {}
    base_models: dict[str, int] = {}
    model_types: dict[str, int] = {}
    tags: dict[str, int] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        category = _category_name(item)
        categories[category] = categories.get(category, 0) + 1
        model_type = _model_type(item) or _kind_to_civitai_type(kind)
        model_types[model_type] = model_types.get(model_type, 0) + 1
        for base in _model_base_models(item):
            base_models[base] = base_models.get(base, 0) + 1
        for tag in _model_tags(item):
            tags[tag] = tags.get(tag, 0) + 1

    def to_list(values: dict[str, int]) -> list[dict[str, Any]]:
        return [
            {"name": name, "count": count}
            for name, count in sorted(values.items(), key=lambda entry: (-entry[1], entry[0].lower()))
        ]

    return {
        "kind": _normalize_asset_kind(kind),
        "categories": to_list(categories),
        "baseModels": to_list(base_models),
        "modelTypes": to_list(model_types),
        "tags": to_list(tags),
        "updated_at": _now(),
    }


def _taxonomy_from_tags(kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    def safe_count(value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    tags: dict[str, int] = {}
    for item in items:
        if isinstance(item, dict):
            name = _safe_segment(item.get("name") or item.get("tag"), "")
            count = safe_count(item.get("modelCount") or item.get("count") or item.get("models") or 0)
        else:
            name = _safe_segment(item, "")
            count = 0
        if not name:
            continue
        tags[name] = max(tags.get(name, 0), count)
    return {
        "kind": _normalize_asset_kind(kind),
        "categories": [],
        "baseModels": [],
        "modelTypes": [],
        "tags": [
            {"name": name, "count": count}
            for name, count in sorted(tags.items(), key=lambda entry: (-entry[1], entry[0].lower()))
        ],
        "updated_at": _now(),
    }


def _taxonomy_from_base_models(kind: str, values: list[Any]) -> dict[str, Any]:
    base_models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for value in values:
        name = _safe_segment(value, "")
        key = name.lower()
        if not name or key in seen:
            continue
        seen.add(key)
        base_models.append({"name": name, "count": 0})
    return {
        "kind": _normalize_asset_kind(kind),
        "categories": [],
        "baseModels": base_models,
        "modelTypes": [],
        "tags": [],
        "updated_at": _now(),
    }


def _merge_taxonomy(current: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    merged = dict(current or {})
    merged["kind"] = update.get("kind") or merged.get("kind") or "lora"
    merged["updated_at"] = _now()
    for key in ("categories", "baseModels", "modelTypes", "tags"):
        counts: dict[str, int] = {}
        for source in (merged.get(key), update.get(key)):
            if isinstance(source, list):
                for item in source:
                    if not isinstance(item, dict):
                        continue
                    name = _safe_segment(item.get("name"), "Other")
                    counts[name] = max(counts.get(name, 0), int(item.get("count") or 0))
        merged[key] = [
            {"name": name, "count": count}
            for name, count in sorted(counts.items(), key=lambda entry: (-entry[1], entry[0].lower()))
        ]
    return merged


def _merge_taxonomy_cache(kind: str, config: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    update = _taxonomy_from_items(kind, items)
    key = _taxonomy_cache_key(kind, config)
    with _TAXONOMY_LOCK:
        cached = _TAXONOMY_CACHE.get(key)
        current = cached.get("data") if isinstance(cached, dict) and isinstance(cached.get("data"), dict) else _empty_taxonomy(kind)
        merged = _merge_taxonomy(current, update)
        _TAXONOMY_CACHE[key] = {"timestamp": _now(), "data": merged}
    return merged


def _set_taxonomy_cache(kind: str, config: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    data = _taxonomy_from_items(kind, items)
    return _set_taxonomy_cache_data(kind, config, data)


def _set_taxonomy_cache_data(kind: str, config: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    key = _taxonomy_cache_key(kind, config)
    normalized = _merge_taxonomy(_empty_taxonomy(kind), data)
    with _TAXONOMY_LOCK:
        _TAXONOMY_CACHE[key] = {"timestamp": _now(), "data": normalized}
    return normalized


def _taxonomy_cache_get(kind: str, config: dict[str, Any]) -> dict[str, Any] | None:
    key = _taxonomy_cache_key(kind, config)
    with _TAXONOMY_LOCK:
        cached = _TAXONOMY_CACHE.get(key)
        if cached and _now() - int(cached.get("timestamp") or 0) < TAXONOMY_CACHE_TTL:
            data = cached.get("data")
            return dict(data) if isinstance(data, dict) else None
    return None


def _models_url(params: dict[str, Any]) -> str:
    return f"{CIVITAI_API_BASE}/models?{urllib.parse.urlencode(params)}"


def _cursor_offset_to_page(cursor: str, limit: int) -> str:
    try:
        offset = max(0, int(str(cursor).strip()))
        page_size = max(1, int(limit or 40))
        return str((offset // page_size) + 1)
    except Exception:
        return ""


def _model_params_with_page_cursor(params: dict[str, Any]) -> dict[str, Any]:
    cursor = str(params.get("cursor") or "").strip()
    if not cursor.isdigit():
        return dict(params)
    next_params = dict(params)
    next_params.pop("cursor", None)
    next_params["page"] = _cursor_offset_to_page(cursor, int(str(params.get("limit") or "40")))
    return next_params


def _should_prefer_page_cursor(params: dict[str, Any]) -> bool:
    cursor = str(params.get("cursor") or "").strip()
    if not cursor.isdigit():
        return False
    return bool(params.get("tag") or params.get("category") or params.get("baseModels"))


def _normalize_page_cursor_metadata(result: dict[str, Any] | None, params: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(result, dict) or result.get("error"):
        return result
    metadata = result.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    if metadata.get("nextCursor"):
        return result
    page = str(params.get("page") or "").strip()
    if not page.isdigit():
        return result
    items = result.get("items") if isinstance(result.get("items"), list) else []
    limit = max(1, int(str(params.get("limit") or "40")))
    current_page = int(page)
    total_pages = metadata.get("totalPages")
    has_more = len(items) >= limit
    if isinstance(total_pages, int):
        has_more = current_page < total_pages
    elif isinstance(total_pages, str) and total_pages.isdigit():
        has_more = current_page < int(total_pages)
    if has_more:
        next_result = dict(result)
        next_metadata = dict(metadata)
        next_metadata["nextCursor"] = str(current_page * limit)
        next_result["metadata"] = next_metadata
        return next_result
    return result


def _read_models_json(params: dict[str, Any], api_key: str | None, timeout: int = 30) -> dict[str, Any] | None:
    request_params = _model_params_with_page_cursor(params) if _should_prefer_page_cursor(params) else dict(params)
    result = _read_json_url_with_retries(_models_url(request_params), api_key, timeout, retries=2, quiet=True)
    if _is_invalid_cursor_result(result):
        fallback_params = _model_params_with_page_cursor(params)
        if fallback_params != params:
            result = _read_json_url_with_retries(_models_url(fallback_params), api_key, timeout, retries=1, quiet=True)
            return _normalize_page_cursor_metadata(result, fallback_params)
    return _normalize_page_cursor_metadata(result, request_params)


def _tags_url(params: dict[str, Any]) -> str:
    return f"{CIVITAI_API_BASE}/tags?{urllib.parse.urlencode(params)}"


def _enums_url() -> str:
    return f"{CIVITAI_API_BASE}/enums"


def _normalize_model_sort(sort: str) -> str:
    clean = str(sort or "").strip()
    for option in MODEL_SORTS:
        if option.lower() == clean.lower():
            return option
    return "Highest Rated"


def _normalize_model_period(period: str) -> str:
    clean = str(period or "").strip()
    for option in MODEL_PERIODS:
        if option.lower() == clean.lower():
            return option
    return "AllTime"


def _normalize_model_file_format(value: str) -> str:
    clean = str(value or "").strip()
    for option in MODEL_FILE_FORMATS:
        if option.lower() == clean.lower():
            return option
    return ""


def _normalize_model_status(value: str) -> str:
    clean = str(value or "").strip().lower()
    return clean if clean in MODEL_STATUSES else ""


def _model_file_formats(model: dict[str, Any]) -> set[str]:
    formats: set[str] = set()
    for version in model.get("modelVersions") or []:
        if not isinstance(version, dict):
            continue
        for file in version.get("files") or []:
            if not isinstance(file, dict):
                continue
            metadata = file.get("metadata") if isinstance(file.get("metadata"), dict) else {}
            value = str(metadata.get("format") or "").strip().lower()
            if value:
                formats.add(value)
    return formats


def _model_status_values(model: dict[str, Any]) -> set[str]:
    statuses: set[str] = set()
    if str(model.get("availability") or "").strip().lower() == "earlyaccess":
        statuses.add("early_access")
    if model.get("hasActivePaidAccess"):
        statuses.add("paid")
    for version in model.get("modelVersions") or []:
        if not isinstance(version, dict):
            continue
        if str(version.get("availability") or "").strip().lower() == "earlyaccess":
            statuses.add("early_access")
        if version.get("paidAccess"):
            statuses.add("paid")
    return statuses


def _model_matches_local_filters(model: dict[str, Any], file_format: str, model_status: str) -> bool:
    if file_format and file_format.lower() not in _model_file_formats(model):
        return False
    if not model_status:
        return True
    statuses = _model_status_values(model)
    if model_status == "free":
        # Early access is also gated behind a paid membership, so "free" means
        # the download needs neither.
        return not statuses
    return model_status in statuses


def _build_model_query_params(
    kind: str,
    query: str = "",
    cursor: str = "",
    sort: str = "Highest Rated",
    limit: int = 40,
    config: dict[str, Any] | None = None,
    category: str = "",
    tag: str = "",
    base_model: str = "",
    period: str = "AllTime",
) -> dict[str, str]:
    config = config or load_config()
    params = {
        "limit": str(limit),
        "types": _kind_to_civitai_type(kind),
        "sort": _normalize_model_sort(sort),
        "period": _normalize_model_period(period),
        "nsfw": "true" if config.get("allow_nsfw") else "false",
        "primaryFileOnly": "true",
    }
    if query.strip():
        params["query"] = query.strip()
    if cursor.strip():
        params["cursor"] = cursor.strip()
    if category.strip():
        params["category"] = category.strip()
    if tag.strip():
        params["tag"] = tag.strip()
    if base_model.strip():
        params["baseModels"] = base_model.strip()
    return params


def _category_matches(model: dict[str, Any], category: str) -> bool:
    clean = _safe_segment(category, "").lower()
    if not clean:
        return True
    return _category_name(model).lower() == clean


def _tag_matches(model: dict[str, Any], tag: str) -> bool:
    clean = _safe_segment(tag, "").lower()
    if not clean:
        return True
    return any(item.lower() == clean for item in _model_tags(model))


def _base_model_matches(model: dict[str, Any], base_model: str) -> bool:
    clean = _safe_segment(base_model, "").lower()
    if not clean:
        return True
    return any(item.lower() == clean for item in _model_base_models(model))


def _search_text_values(model: dict[str, Any]) -> list[str]:
    values: list[str] = [
        model.get("name"),
        model.get("description"),
        model.get("type"),
    ]
    creator = model.get("creator")
    if isinstance(creator, dict):
        values.append(creator.get("username"))
    tags = model.get("tags")
    if isinstance(tags, list):
        values.extend(str(tag) for tag in tags if tag)
    versions = model.get("modelVersions")
    if isinstance(versions, list):
        for version in versions:
            if not isinstance(version, dict):
                continue
            values.extend([
                version.get("name"),
                version.get("baseModel"),
                version.get("description"),
            ])
            trained_words = version.get("trainedWords")
            if isinstance(trained_words, list):
                values.extend(str(word) for word in trained_words if word)
            files = version.get("files")
            if isinstance(files, list):
                values.extend(str(file.get("name")) for file in files if isinstance(file, dict) and file.get("name"))
    return [str(value) for value in values if value]


def _model_text_matches(model: dict[str, Any], *queries: str) -> bool:
    tokens: list[str] = []
    for query in queries:
        clean = re.sub(r"<[^>]+>", " ", str(query or "").lower())
        tokens.extend(token for token in re.split(r"\s+", clean) if token)
    if not tokens:
        return True
    haystack = " ".join(_search_text_values(model)).lower()
    haystack = re.sub(r"<[^>]+>", " ", haystack)
    return all(token in haystack for token in tokens)


def _version_base_model(version: dict[str, Any], model: dict[str, Any]) -> str:
    for value in (
        version.get("baseModel"),
        version.get("baseModelType"),
        model.get("baseModel"),
        model.get("baseModelType"),
    ):
        if value:
            return _safe_segment(value, "Other")
    return "Other"


def _model_type(model: dict[str, Any]) -> str:
    return str(model.get("type") or model.get("modelType") or "").strip()


def _is_workflow(model: dict[str, Any], requested_kind: str = "") -> bool:
    model_type = _model_type(model).lower()
    requested_kind = requested_kind.lower()
    return requested_kind == "workflow" or "workflow" in model_type


def _is_lora(model: dict[str, Any], requested_kind: str = "") -> bool:
    model_type = _model_type(model).lower()
    requested_kind = requested_kind.lower()
    return requested_kind == "lora" or model_type in {"lora", "locon", "lycoris"} or "lora" in model_type


def _is_unet_model(model: dict[str, Any], version: dict[str, Any], file_info: dict[str, Any]) -> bool:
    candidates = [
        model.get("type"),
        model.get("name"),
        model.get("description"),
        version.get("name"),
        version.get("baseModel"),
        version.get("description"),
        file_info.get("name"),
        file_info.get("type"),
        file_info.get("format"),
        file_info.get("pickleScanResult"),
    ]
    metadata = file_info.get("metadata")
    if isinstance(metadata, dict):
        candidates.extend(str(value) for value in metadata.values() if value is not None)
    haystack = " ".join(str(item or "") for item in candidates).lower()
    explicit_tokens = (
        "unet",
        "diffusion model",
        "diffusion_models",
        "diffusion-model",
        "dit model",
        "transformer model",
    )
    return any(token in haystack for token in explicit_tokens)


def _file_role(file_info: dict[str, Any]) -> str:
    """Classify a Civitai file so it lands in the right model folder."""
    file_type = str(file_info.get("type") or "").strip().lower()
    if file_type:
        if "vae" in file_type:
            return "vae"
        if "text encoder" in file_type or file_type in {"text_encoder", "textencoder"}:
            return "text_encoder"
        if file_type in {"config", "configuration"}:
            return "config"
        if file_type in {"training data", "archive"}:
            return "archive"
        if file_type in {"model", "diffusion model", "checkpoint"}:
            return "model"
    name = os.path.basename(str(file_info.get("name") or "")).lower()
    stem = os.path.splitext(name)[0]
    if "vae" in stem or stem in {"ae", "vae2"}:
        return "vae"
    if re.search(
        r"(^|[._\-\s])(t5|umt5|t5xxl|clip|clip_l|clip_g|text[._-]?encoder|llm|"
        r"qwen3?[._-]?vl|gemma|byt5)([._\-\s]|$)",
        stem,
    ):
        return "text_encoder"
    if re.search(r"(^|[._\-\s])(config|configs)([._\-\s]|$)", stem):
        return "config"
    return "model"


def _root_kind_for(model: dict[str, Any], version: dict[str, Any], file_info: dict[str, Any], requested_kind: str = "") -> str:
    if _is_workflow(model, requested_kind):
        return "workflows"
    if _is_lora(model, requested_kind):
        return "loras"
    role = _file_role(file_info)
    if role in FILE_ROLE_ROOT_KINDS:
        return FILE_ROLE_ROOT_KINDS[role]
    model_type = _model_type(model).lower()
    if "textencoder" in model_type or "text encoder" in model_type:
        return "text_encoders"
    if model_type == "vae":
        return "vae"
    if _is_unet_model(model, version, file_info):
        return "unet"
    return "checkpoints"


def _file_extension_for(root_kind: str, file_info: dict[str, Any]) -> str:
    name = str(file_info.get("name") or "")
    ext = os.path.splitext(name)[1].lower()
    if root_kind == "workflows":
        return ".json"
    if root_kind == "configs":
        return ext if ext in CONFIG_EXTENSIONS else ".json"
    if ext in MODEL_EXTENSIONS:
        return ext
    return ".safetensors"


def _filename_for(model: dict[str, Any], version: dict[str, Any], file_info: dict[str, Any], root_kind: str) -> str:
    ext = _file_extension_for(root_kind, file_info)
    if file_info.get("name"):
        return _safe_filename(file_info["name"], "civitai_asset", ext)
    base = " - ".join(part for part in (model.get("name"), version.get("name")) if part)
    return _safe_filename(base, f"civitai_{model.get('id') or version.get('id') or _now()}", ext)


def _download_url_for(version: dict[str, Any], file_info: dict[str, Any]) -> str:
    for key in ("downloadUrl", "download_url", "url"):
        value = file_info.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return _civitai_red_url(value)
    version_id = version.get("id")
    if version_id:
        return f"{CIVITAI_DOWNLOAD_BASE}/{version_id}"
    return ""


def resolve_download_path(
    model: dict[str, Any],
    version: dict[str, Any],
    file_info: dict[str, Any],
    requested_kind: str = "",
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    overrides = overrides or {}
    default_root_kind = _normalize_root_kind(_root_kind_for(model, version, file_info, requested_kind))
    root_kind = _normalize_root_kind(overrides.get("root_kind") or default_root_kind)

    base_model_dir = _safe_segment(overrides.get("base_model_dir") or _version_base_model(version, model), "Other")
    category_dir = _safe_segment(overrides.get("category_dir") or _category_name(model), "Other")
    default_extension = _file_extension_for(root_kind, file_info)
    override_filename = str(overrides.get("filename") or "").strip()
    if override_filename:
        filename = _safe_filename(override_filename, "civitai_asset", default_extension)
        _validate_asset_filename(root_kind, filename)
    else:
        filename = _filename_for(model, version, file_info, root_kind)
        if os.path.splitext(filename)[1].lower() not in _extensions_for_root(root_kind):
            filename = f"{os.path.splitext(filename)[0]}{default_extension}"
        _validate_asset_filename(root_kind, filename)

    root_dir = _root_for_kind(root_kind)
    if root_kind == "workflows":
        base_model_dir = ""
        relative_path = os.path.join(category_dir, filename)
    elif root_kind in STRUCTURED_ROOT_KINDS:
        relative_path = os.path.join(base_model_dir, category_dir, filename)
    else:
        # Component folders (VAE, text encoders, ...) keep files at their root
        # so ComfyUI finds them immediately.
        base_model_dir = ""
        category_dir = ""
        relative_path = filename
    absolute_path = _safe_join(root_dir, relative_path)

    return {
        "root_kind": root_kind,
        "root_dir": root_dir,
        "base_model_dir": base_model_dir,
        "category_dir": category_dir,
        "filename": filename,
        "relative_path": relative_path.replace("\\", "/"),
        "absolute_path": absolute_path,
        "download_url": _download_url_for(version, file_info),
        "file_role": _file_role(file_info),
    }


def _unique_path(path: str) -> str:
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    index = 1
    while True:
        candidate = f"{base} ({index}){ext}"
        if not os.path.exists(candidate):
            return candidate
        index += 1


def _companion_metadata_path(asset_path: str, root_kind: str) -> str:
    base, ext = os.path.splitext(asset_path)
    # JSON assets (workflows) and every file inside configs would otherwise
    # collide with their own companion metadata, so they use the
    # "<name>.civitai.json" suffix.
    if ext.lower() == ".json" or str(root_kind or "").strip().lower() == "configs":
        return f"{base}.civitai.json"
    return f"{base}.json"


def _companion_preview_path(asset_path: str, image_url: str) -> str:
    ext = ".png"
    lowered = image_url.lower()
    if ".jpg" in lowered or ".jpeg" in lowered:
        ext = ".jpg"
    elif ".webp" in lowered:
        ext = ".webp"
    return os.path.splitext(asset_path)[0] + ext


def _metadata_payload(model: dict[str, Any], version: dict[str, Any], file_info: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    creator = model.get("creator") if isinstance(model.get("creator"), dict) else {}
    file_hashes = file_info.get("hashes") if isinstance(file_info.get("hashes"), dict) else {}
    return {
        "source": "civitai",
        "downloaded_at": _now(),
        "model_id": model.get("id"),
        "version_id": version.get("id"),
        "type": model.get("type"),
        "name": model.get("name"),
        "version_name": version.get("name"),
        "creator": creator.get("username") or model.get("username") or "",
        "category": _category_name(model),
        "base_model": _version_base_model(version, model),
        "trained_words": version.get("trainedWords") if isinstance(version.get("trainedWords"), list) else [],
        "tags": model.get("tags") if isinstance(model.get("tags"), list) else [],
        "hashes": file_hashes,
        "resolution": {
            "root_kind": resolution.get("root_kind"),
            "base_model_dir": resolution.get("base_model_dir"),
            "category_dir": resolution.get("category_dir"),
            "filename": resolution.get("filename"),
            "relative_path": resolution.get("relative_path"),
        },
        "model": model,
        "version": version,
        "file": file_info,
    }


def _first_preview_url(version: dict[str, Any], model: dict[str, Any]) -> str:
    for images in (version.get("images"), model.get("images")):
        if isinstance(images, list):
            for image in images:
                url = str(image.get("url") or "") if isinstance(image, dict) else str(image or "")
                media_type = str(image.get("type") or "").lower() if isinstance(image, dict) else ""
                clean_url = url.split("?", 1)[0].lower()
                if not url or "video" in media_type or re.search(r"\.(?:mp4|webm|mov|m4v|avi)$", clean_url):
                    continue
                return url
    return ""


class _SafeDownloadRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Do not forward Civitai credentials to redirected storage hosts."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is None:
            return None
        source_host = (urllib.parse.urlparse(req.full_url).hostname or "").lower()
        target_host = (urllib.parse.urlparse(newurl).hostname or "").lower()
        if source_host != target_host:
            redirected.remove_header("Authorization")
            redirected.remove_header("Cookie")
        return redirected


_DOWNLOAD_URL_OPENER = urllib.request.build_opener(_SafeDownloadRedirectHandler())


class DownloadCancelled(Exception):
    pass


class DownloadQueueFull(Exception):
    pass


def _download_store() -> DownloadJobStore:
    global _DOWNLOAD_STORE
    if _DOWNLOAD_STORE is not None:
        return _DOWNLOAD_STORE
    with _DOWNLOAD_STORE_LOCK:
        if _DOWNLOAD_STORE is None:
            _DOWNLOAD_STORE = DownloadJobStore(
                os.path.join(_plugin_data_dir(), "downloads.json"),
                history_limit=DOWNLOAD_JOB_HISTORY_LIMIT,
                retention_seconds=DOWNLOAD_JOB_RETENTION_SECONDS,
            )
        return _DOWNLOAD_STORE


def _download_queue_worker() -> None:
    while True:
        task = _DOWNLOAD_QUEUE.get()
        try:
            _download_worker(*task)
        finally:
            _DOWNLOAD_QUEUE.task_done()


def _ensure_download_workers() -> None:
    global _DOWNLOAD_WORKERS_STARTED
    if _DOWNLOAD_WORKERS_STARTED:
        return
    with _DOWNLOAD_WORKERS_LOCK:
        if _DOWNLOAD_WORKERS_STARTED:
            return
        for index in range(DOWNLOAD_MAX_WORKERS):
            worker = threading.Thread(
                target=_download_queue_worker,
                name=f"civitai-manager-download-{index + 1}",
                daemon=True,
            )
            worker.start()
        _DOWNLOAD_WORKERS_STARTED = True


DOWNLOAD_HTTP_REASONS = {401: "auth", 404: "not_found", 429: "rate_limited"}


def _download_failure(exc: Exception) -> tuple[str, str]:
    """Classify a failed download for the UI, keeping Civitai's own wording."""
    if isinstance(exc, urllib.error.HTTPError):
        try:
            body = json.loads(exc.read(4096) or b"null")
        except (OSError, ValueError):
            body = None
        body = body if isinstance(body, dict) else {}
        detail = str(body.get("message") or body.get("error") or "").strip()
        message = f"Civitai refused the download: {detail}" if detail and exc.code < 500 else f"HTTP {exc.code}: {exc.reason}"
        if exc.code == 403:
            # Civitai explains refusals such as Early Access in the body; only
            # an unexplained 403 points at the API Key.
            if "early access" in f"{body.get('error') or ''} {detail}".lower():
                return "early_access", message
            return ("forbidden" if detail else "auth"), message
        if exc.code >= 500:
            return "server", message
        return DOWNLOAD_HTTP_REASONS.get(exc.code, "http"), message
    if isinstance(exc, (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException)):
        return "network", str(getattr(exc, "reason", "") or exc)
    if isinstance(exc, OSError):
        return "disk", str(exc)
    return "unknown", str(exc)


def _download_worker(
    task_id: str,
    download_url: str,
    target_path: str,
    root_kind: str,
    metadata: dict[str, Any],
    preview_url: str,
) -> None:
    temp_path = f"{target_path}.download"
    store = _download_store()
    cancel_event = store.cancel_event(task_id)
    config = load_config()
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    total = 0
    progress = 0

    try:
        if cancel_event.is_set():
            raise DownloadCancelled()
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        req = urllib.request.Request(download_url, headers=_request_headers(api_key, json_content=False))
        with _DOWNLOAD_URL_OPENER.open(req, timeout=60) as resp, open(temp_path, "wb") as handle:
            total = int(resp.headers.get("Content-Length") or 0)
            store.update(task_id, status="downloading", total=total, error="", error_reason="")
            while True:
                if cancel_event.is_set():
                    raise DownloadCancelled()
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                progress += len(chunk)
                store.update(task_id, persist=False, progress=progress)

        if cancel_event.is_set():
            raise DownloadCancelled()
        if root_kind == "workflows" and _looks_like_zip(temp_path):
            # Civitai serves some workflow bundles as a ZIP under a .json name.
            # Store the graph itself so the file is a real workflow that both
            # ComfyUI's own loader and this panel can open.
            graph = _workflow_graph_from_zip(temp_path)
            if graph is None:
                raise ValueError("Workflow archive does not contain a workflow")
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump(graph, handle, ensure_ascii=False)
        final_path = _unique_path(target_path)
        os.replace(temp_path, final_path)
        metadata["saved_path"] = final_path
        metadata["saved_filename"] = os.path.basename(final_path)

        if config.get("save_metadata", True):
            _write_asset_metadata(final_path, root_kind, metadata)
        # The preview is saved before the job reports completion: the library
        # rescan that completion triggers (e.g. to apply the LoRA to a node)
        # must already find it, or the node keeps the "No Preview" placeholder.
        if config.get("save_preview", True) and preview_url:
            try:
                preview_path = _companion_preview_path(final_path, preview_url)
                _download_binary(preview_url, preview_path, api_key=None, timeout=30)
            except Exception as exc:
                print(f"[CivitaiManager] Preview download failed: {exc}")

        store.update(
            task_id,
            status="completed",
            progress=total or progress or os.path.getsize(final_path),
            target_path=final_path,
            relative_path=os.path.relpath(final_path, _root_for_kind(root_kind)).replace("\\", "/"),
            completed_at=_now(),
        )
        _LIBRARY_INDEX.invalidate()
    except DownloadCancelled:
        store.update(task_id, status="cancelled", error="", cancelled_at=_now())
    except Exception as exc:
        if cancel_event.is_set():
            store.update(task_id, status="cancelled", error="", cancelled_at=_now())
        else:
            reason, error = _download_failure(exc)
            store.update(task_id, status="failed", error=error, error_reason=reason, failed_at=_now())
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


def _download_binary(url: str, target_path: str, api_key: str | None = None, timeout: int = 30) -> None:
    req = urllib.request.Request(url, headers=_request_headers(api_key, json_content=False))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "wb") as handle:
            shutil.copyfileobj(resp, handle)


def _build_library_snapshot() -> dict[str, Any]:
    return {
        "roots": _root_display(),
        "root_paths": {kind: list(paths) for kind, paths in _model_root_map().items()},
        "items": _scan_all_library_items(),
        "generated_at": _now(),
    }


def _scan_roots(force: bool = False) -> dict[str, Any]:
    return _LIBRARY_INDEX.get(_build_library_snapshot, force=force)


def _metadata_for_asset(abs_path: str, root_kind: str) -> tuple[str, dict[str, Any]]:
    path = _companion_metadata_path(abs_path, root_kind)
    if not os.path.isfile(path):
        return "missing", {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return "cached", data if isinstance(data, dict) else {}
    except Exception:
        return "invalid", {}


def _write_asset_metadata(abs_path: str, root_kind: str, metadata: dict[str, Any]) -> None:
    path = _companion_metadata_path(abs_path, root_kind)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.{uuid.uuid4().hex}.tmp"
    try:
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2, ensure_ascii=False)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _preview_for_asset(abs_path: str) -> str:
    base = os.path.splitext(abs_path)[0]
    for ext in IMAGE_EXTENSIONS:
        candidate = base + ext
        if os.path.isfile(candidate):
            return candidate
    return ""


def _civitai_ids_from_metadata(metadata: dict[str, Any]) -> tuple[Any, Any]:
    model = metadata.get("model") if isinstance(metadata.get("model"), dict) else {}
    version = metadata.get("version") if isinstance(metadata.get("version"), dict) else {}
    model_id = (
        metadata.get("model_id")
        or metadata.get("modelId")
        or model.get("id")
        or version.get("modelId")
        or version.get("model_id")
    )
    version_id = metadata.get("version_id") or metadata.get("versionId") or version.get("id")
    return model_id, version_id


def _scan_library_kind(root_kind: str, seen_roots: set[str] | None = None) -> list[dict[str, Any]]:
    extensions = _extensions_for_root(root_kind)
    structured = root_kind in STRUCTURED_ROOT_KINDS
    items: list[dict[str, Any]] = []
    roots = _roots_for_kind(root_kind)
    primary_root = _root_for_kind(root_kind)
    if all(os.path.normcase(os.path.realpath(root)) != os.path.normcase(os.path.realpath(primary_root)) for root in roots):
        roots.insert(0, primary_root)
    for root in roots:
        root_key = os.path.normcase(os.path.realpath(root))
        if seen_roots is not None:
            if root_key in seen_roots:
                continue
            seen_roots.add(root_key)
        if not os.path.isdir(root):
            continue
        storage_root_id = _storage_root_id(root)
        for dirpath, _, filenames in os.walk(root):
            for name in filenames:
                ext = os.path.splitext(name)[1].lower()
                if ext not in extensions:
                    continue
                # "<name>.civitai.json" is companion metadata for any asset kind.
                if name.lower().endswith(".civitai.json"):
                    continue

                abs_path = os.path.join(dirpath, name)
                rel_path = os.path.relpath(abs_path, root).replace("\\", "/")
                folder_path = os.path.dirname(rel_path).replace("\\", "/")
                metadata_status, metadata = _metadata_for_asset(abs_path, root_kind)
                preview_file = _preview_for_asset(abs_path)
                rel_parts = rel_path.split("/")
                if structured:
                    inferred_base = rel_parts[0] if len(rel_parts) > 2 else ""
                    inferred_category = rel_parts[1] if len(rel_parts) > 2 else "Other"
                elif root_kind == "workflows":
                    inferred_base = ""
                    inferred_category = rel_parts[0] if len(rel_parts) > 1 else "Other"
                else:
                    # Flat folders (VAE, text encoders, ...) have no subfolders.
                    inferred_base = ""
                    inferred_category = ""
                resolution = metadata.get("resolution") if isinstance(metadata.get("resolution"), dict) else {}
                if not structured:
                    resolution_base = ""
                else:
                    resolution_base = resolution.get("base_model_dir") or ""
                if not (structured or root_kind == "workflows"):
                    resolution_category = ""
                else:
                    resolution_category = resolution.get("category_dir") or ""
                hashes = metadata.get("hashes") if isinstance(metadata.get("hashes"), dict) else {}
                model_id, version_id = _civitai_ids_from_metadata(metadata)
                civitai_url = _civitai_red_url(str(metadata.get("civitai_url") or ""))
                if not civitai_url and model_id:
                    civitai_url = f"https://civitai.red/models/{model_id}"
                    if version_id:
                        civitai_url += f"?modelVersionId={version_id}"
                try:
                    stat = os.stat(abs_path)
                except OSError:
                    continue
                preview_version = int(os.path.getmtime(preview_file)) if preview_file else int(stat.st_mtime)
                items.append({
                    "id": f"{root_kind}:{storage_root_id}:{rel_path}",
                    "root_kind": root_kind,
                    "storage_root_id": storage_root_id,
                    "storage_root": root,
                    "name": metadata.get("name") or os.path.splitext(name)[0],
                    "version_name": metadata.get("version_name") or "",
                    "filename": name,
                    "relative_path": rel_path,
                    "folder_path": folder_path,
                    "absolute_path": abs_path,
                    "size": stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "base_model": metadata.get("base_model") or resolution_base or inferred_base,
                    "category": metadata.get("category") or resolution_category or inferred_category,
                    "creator": metadata.get("creator") or "",
                    "model_id": model_id,
                    "version_id": version_id,
                    "civitai_url": civitai_url,
                    "metadata_match_status": metadata.get("metadata_match_status") or ("matched" if model_id else "unknown"),
                    "source": metadata.get("source") or "local",
                    "trained_words": metadata.get("trained_words") if isinstance(metadata.get("trained_words"), list) else [],
                    "tags": metadata.get("tags") if isinstance(metadata.get("tags"), list) else [],
                    "hash": hashes.get("SHA256") or hashes.get("sha256") or metadata.get("sha256") or "",
                    "favorite": bool(metadata.get("favorite")),
                    "metadata_status": metadata_status,
                    "has_preview": bool(preview_file),
                    "thumb_url": f"{API_PREFIX}/local-preview?root_kind={urllib.parse.quote(root_kind)}&root_id={urllib.parse.quote(storage_root_id)}&path={urllib.parse.quote(rel_path)}&v={preview_version}",
                })
    return items


def _scan_all_library_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    # Different ComfyUI folder names can point at the same physical directory, so
    # every real path is scanned once even when it shows up under two kinds.
    seen_roots: set[str] = set()
    for root_kind in _model_root_map():
        items.extend(_scan_library_kind(root_kind, seen_roots))

    by_hash: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        item_hash = str(item.get("hash") or "").lower()
        if item_hash:
            by_hash.setdefault(item_hash, []).append(item)
    for group in by_hash.values():
        if len(group) > 1:
            for item in group:
                item["duplicate_count"] = len(group)
    return sorted(items, key=lambda item: (item["root_kind"], item.get("storage_root", "").lower(), item["relative_path"].lower()))


def _resolve_asset_path(root_kind: str, rel_path: str, storage_root_id: Any = "") -> str:
    root_kind = _normalize_root_kind(root_kind)
    root = _storage_root_for_asset(root_kind, storage_root_id)
    rel_path = str(rel_path or "").replace("\\", "/").lstrip("/")
    abs_path = _safe_join(root, rel_path)
    _validate_asset_filename(root_kind, os.path.basename(abs_path))
    return abs_path


def _companion_move_pairs(
    src_path: str,
    dst_path: str,
    source_root_kind: str,
    target_root_kind: str,
) -> list[tuple[str, str]]:
    companions = [(
        _companion_metadata_path(src_path, source_root_kind),
        _companion_metadata_path(dst_path, target_root_kind),
    )]
    for ext in IMAGE_EXTENSIONS:
        companions.append((os.path.splitext(src_path)[0] + ext, os.path.splitext(dst_path)[0] + ext))
    return [(src, dst) for src, dst in companions if os.path.isfile(src)]


def _move_asset_bundle(
    src_path: str,
    dst_path: str,
    source_root_kind: str,
    target_root_kind: str,
) -> None:
    moves = [(src_path, dst_path), *_companion_move_pairs(
        src_path,
        dst_path,
        source_root_kind,
        target_root_kind,
    )]
    for _, dst in moves:
        if os.path.exists(dst):
            raise FileExistsError(f"Target already exists: {dst}")

    completed: list[tuple[str, str]] = []
    try:
        for src, dst in moves:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
            completed.append((src, dst))
    except Exception:
        for src, dst in reversed(completed):
            if os.path.exists(dst) and not os.path.exists(src):
                try:
                    os.makedirs(os.path.dirname(src), exist_ok=True)
                    shutil.move(dst, src)
                except Exception as rollback_exc:
                    print(f"[CivitaiManager] Failed to roll back move {dst}: {rollback_exc}")
        raise


def _update_moved_asset_metadata(
    dst_path: str,
    target_root_kind: str,
    relative_path: str,
    base_model_dir: str,
    category_dir: str,
    filename: str,
) -> None:
    status, metadata = _metadata_for_asset(dst_path, target_root_kind)
    if status != "cached":
        return
    if target_root_kind not in STRUCTURED_ROOT_KINDS:
        base_model_dir = ""
    if target_root_kind != "workflows" and target_root_kind not in STRUCTURED_ROOT_KINDS:
        category_dir = ""
    resolution = metadata.get("resolution") if isinstance(metadata.get("resolution"), dict) else {}
    resolution.update({
        "root_kind": target_root_kind,
        "base_model_dir": base_model_dir,
        "category_dir": category_dir,
        "filename": filename,
        "relative_path": relative_path,
    })
    metadata["resolution"] = resolution
    _write_asset_metadata(dst_path, target_root_kind, metadata)


def _delete_companions(asset_path: str, root_kind: str) -> None:
    for path in [_companion_metadata_path(asset_path, root_kind), *[os.path.splitext(asset_path)[0] + ext for ext in IMAGE_EXTENSIONS]]:
        if os.path.isfile(path):
            try:
                os.remove(path)
            except Exception as exc:
                print(f"[CivitaiManager] Failed to delete companion {path}: {exc}")


def _hash_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _metadata_from_hash(sha256: str) -> dict[str, Any] | None:
    config = load_config()
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    url = f"{CIVITAI_API_BASE}/model-versions/by-hash/{urllib.parse.quote(sha256)}"
    data = _read_json_url_with_retries(url, api_key=api_key, timeout=30, retries=1)
    if not data or data.get("error"):
        return None
    return data


def _stored_sha256(metadata: dict[str, Any]) -> str:
    hashes = metadata.get("hashes") if isinstance(metadata.get("hashes"), dict) else {}
    for value in (hashes.get("SHA256"), hashes.get("sha256"), metadata.get("sha256")):
        clean = str(value or "").strip().lower()
        if re.fullmatch(r"[0-9a-f]{64}", clean):
            return clean
    return ""


def _complete_civitai_model(version: dict[str, Any]) -> dict[str, Any]:
    summary = version.get("model") if isinstance(version.get("model"), dict) else {}
    model_id = summary.get("id") or version.get("modelId") or version.get("model_id")
    if not model_id:
        return summary
    summary = {**summary, "id": model_id}
    config = load_config()
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    url = f"{CIVITAI_API_BASE}/models/{urllib.parse.quote(str(model_id))}"
    full = _read_json_url_with_retries(url, api_key=api_key, timeout=30, retries=1, quiet=True)
    if not full or full.get("error"):
        return summary
    return {**summary, **full}


def _enrich_metadata_worker(abs_path: str, root_kind: str) -> dict[str, Any]:
    """Hash and enrich one asset entirely off the asyncio event-loop thread."""
    with _HASH_METADATA_LOCK:
        existing_status, existing = _metadata_for_asset(abs_path, root_kind)
        metadata = existing if existing_status in {"cached", "invalid"} else {}
        sha256 = _stored_sha256(metadata) or _hash_file(abs_path)
        civitai_data = _metadata_from_hash(sha256)
        metadata.update({
            "source": metadata.get("source") or "local",
            "sha256": sha256,
            "hashes": {
                **(metadata.get("hashes") if isinstance(metadata.get("hashes"), dict) else {}),
                "SHA256": sha256.upper(),
            },
            "metadata_enriched_at": _now(),
            "metadata_checked_at": _now(),
            "metadata_match_status": "matched" if civitai_data else "not_found",
        })
        preview_saved = bool(_preview_for_asset(abs_path))
        preview_error = ""
        if civitai_data:
            model = _complete_civitai_model(civitai_data)
            preview_url = _first_preview_url(civitai_data, model)
            metadata.update({
                "source": "civitai",
                "model_id": model.get("id") or metadata.get("model_id"),
                "version_id": civitai_data.get("id") or metadata.get("version_id"),
                "type": model.get("type") or metadata.get("type"),
                "name": model.get("name") or metadata.get("name"),
                "version_name": civitai_data.get("name") or metadata.get("version_name"),
                "creator": (model.get("creator") or {}).get("username")
                if isinstance(model.get("creator"), dict)
                else metadata.get("creator", ""),
                "category": _category_name(model) if model else metadata.get("category", "Other"),
                "base_model": civitai_data.get("baseModel") or metadata.get("base_model"),
                "trained_words": civitai_data.get("trainedWords")
                if isinstance(civitai_data.get("trainedWords"), list)
                else metadata.get("trained_words", []),
                "tags": model.get("tags") if isinstance(model.get("tags"), list) else metadata.get("tags", []),
                "description": model.get("description") or metadata.get("description", ""),
                "preview_url": preview_url or metadata.get("preview_url", ""),
                "civitai_url": f"https://civitai.red/models/{model.get('id')}?modelVersionId={civitai_data.get('id')}"
                if model.get("id")
                else metadata.get("civitai_url", ""),
                "model": model or metadata.get("model", {}),
                "version": civitai_data,
            })
        _write_asset_metadata(abs_path, root_kind, metadata)
        if civitai_data and not preview_saved and load_config().get("save_preview", True):
            preview_url = str(metadata.get("preview_url") or "")
            if preview_url:
                try:
                    optimized_url = _civitai_media_cache_url(preview_url, REMOTE_IMAGE_CACHE_WIDTH_DEFAULT)
                    preview_path = _companion_preview_path(abs_path, optimized_url)
                    _download_binary(optimized_url, preview_path, api_key=None, timeout=30)
                    preview_saved = True
                except Exception as exc:
                    preview_error = str(exc)
        return {
            "sha256": sha256,
            "metadata": metadata,
            "matched": bool(civitai_data),
            "preview_saved": preview_saved,
            "preview_error": preview_error,
        }


def _cache_dir(name: str) -> str:
    path = os.path.join(_plugin_data_dir(), name)
    os.makedirs(path, exist_ok=True)
    return path


def _image_resource_kind(value: Any) -> str:
    """Map a Civitai resource type to the Discover asset kind it belongs to."""
    clean = str(value or "").strip().lower()
    if clean in IMAGE_RESOURCE_KINDS:
        return IMAGE_RESOURCE_KINDS[clean]
    for token, kind in IMAGE_RESOURCE_KINDS.items():
        if token in clean:
            return kind
    return ""


def _image_resource_entry(resource: Any) -> dict[str, Any] | None:
    if not isinstance(resource, dict):
        return None
    kind = _image_resource_kind(resource.get("type"))
    version_id = resource.get("modelVersionId") or resource.get("versionId") or resource.get("model_version_id")
    model_id = resource.get("modelId") or resource.get("model_id")
    if not version_id and not model_id:
        return None
    return {
        "kind": kind,
        "type": str(resource.get("type") or ""),
        "model_id": str(model_id or ""),
        "version_id": str(version_id or ""),
        "name": str(resource.get("modelName") or resource.get("name") or ""),
        "version_name": str(resource.get("modelVersionName") or resource.get("versionName") or ""),
        "base_model": str(resource.get("baseModel") or ""),
        "weight": resource.get("weight") if isinstance(resource.get("weight"), (int, float)) else None,
    }


def _image_meta(image: dict[str, Any]) -> dict[str, Any]:
    """The generation data of one image.

    The feed returns it flat, while a single-image lookup (`?imageId=`) nests it
    one level deeper (`{"id": ..., "meta": {...}}`), so both shapes are read.
    """
    meta = image.get("meta")
    if not isinstance(meta, dict):
        return {}
    inner = meta.get("meta")
    if isinstance(inner, dict):
        return {**meta, **inner}
    return meta


def _resource_name_key(value: Any) -> str:
    """A comparison key for resource names: `FilmGrain XL.safetensors` == `film grain xl`."""
    clean = str(value or "").strip().lower()
    clean = re.sub(r"\.(safetensors|ckpt|pt|pth|bin|onnx|yaml|json)$", "", clean)
    return re.sub(r"[^a-z0-9]+", " ", clean).strip()


LORA_PROMPT_TAG_RE = re.compile(r"<(?:lora|lyco):\s*([^:>]+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*>", re.I)


def _prompt_lora_weights(prompt: Any) -> list[tuple[str, float]]:
    """LoRAs written into a prompt as `<lora:name:0.7>`.

    A1111-style images carry their whole LoRA stack in the prompt while
    `civitaiResources` is empty, so this is the only place their weights exist.
    """
    found: list[tuple[str, float]] = []
    for name, weight in LORA_PROMPT_TAG_RE.findall(str(prompt or "")):
        clean = name.strip()
        if not clean:
            continue
        try:
            found.append((clean, float(weight)))
        except ValueError:
            continue
    return found


def _image_resources(image: dict[str, Any]) -> list[dict[str, Any]]:
    meta = _image_meta(image)
    raw = image.get("resources")
    if not isinstance(raw, list):
        raw = meta.get("resources") if isinstance(meta.get("resources"), list) else None
    entries = [entry for entry in (_image_resource_entry(item) for item in (raw or [])) if entry]
    # `resources` is free-form and often empty, while `civitaiResources` is the
    # structured one that carries the weight of every LoRA the picture used.
    civitai_entries = [
        entry for entry in (_image_resource_entry(item) for item in (meta.get("civitaiResources") or [])) if entry
    ]
    civitai_by_version = {entry["version_id"]: entry for entry in civitai_entries if entry.get("version_id")}
    for entry in entries:
        extra = civitai_by_version.get(entry.get("version_id") or "")
        if not extra:
            continue
        # Civitai's own record wins over the free-form weight a generator wrote.
        if extra.get("weight") is not None:
            entry["weight"] = extra.get("weight")
        if not entry.get("kind"):
            entry["kind"] = extra.get("kind") or ""
        if not entry.get("version_name"):
            entry["version_name"] = extra.get("version_name") or ""
    known_versions = {str(entry.get("version_id") or "") for entry in entries}
    entries.extend(entry for entry in civitai_entries if str(entry.get("version_id") or "") not in known_versions)
    # Prompt tags fill two gaps: the weight of a known LoRA, and LoRAs that
    # `civitaiResources` leaves out entirely (an eight-LoRA picture that only
    # lists five). They are kept unresolved and looked up by name later.
    prompt_weights = _prompt_lora_weights(meta.get("prompt"))
    if prompt_weights:
        by_name: dict[str, dict[str, Any]] = {}
        for entry in entries:
            for candidate in (entry.get("name"), entry.get("version_name"), entry.get("model_name")):
                key = _resource_name_key(candidate)
                if key:
                    by_name.setdefault(key, entry)
        for name, weight in prompt_weights:
            key = _resource_name_key(name)
            flat = key.replace(" ", "")
            match = by_name.get(key)
            if match is None and flat:
                match = next(
                    (entry for candidate, entry in by_name.items() if candidate.replace(" ", "") == flat),
                    None,
                )
            if match is not None:
                if match.get("weight") is None:
                    match["weight"] = weight
                continue
            entry = {
                "kind": "lora",
                "type": "LoRA",
                "model_id": "",
                "version_id": "",
                "name": name,
                "version_name": "",
                "base_model": "",
                "weight": weight,
                "from_prompt": True,
            }
            entries.append(entry)
            if key:
                by_name.setdefault(key, entry)
    # `modelVersionIds` is the complete list of versions the picture used, while
    # `resources` is often just the checkpoint. Both are merged, otherwise a
    # seven-LoRA picture shows a single entry.
    known_versions_all = {str(entry.get("version_id") or "") for entry in entries if entry.get("version_id")}
    for version_id in image.get("modelVersionIds") or []:
        clean = str(version_id or "").strip()
        if not clean or clean in known_versions_all:
            continue
        known_versions_all.add(clean)
        entries.append({
            "kind": "",
            "type": "",
            "model_id": "",
            "version_id": clean,
            "name": "",
            "version_name": "",
            "base_model": "",
            "weight": None,
            "from_ids": True,
        })
    # A resource can appear twice (base model plus the checkpoint alias); keep one.
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for entry in entries:
        key = str(entry.get("version_id") or entry.get("model_id") or "")
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        unique.append(entry)
    return unique


def _image_feed_card(image: dict[str, Any]) -> dict[str, Any]:
    meta = _image_meta(image)
    stats = image.get("stats") if isinstance(image.get("stats"), dict) else {}
    username = str(image.get("username") or "").strip()
    if not username and isinstance(image.get("user"), dict):
        username = str(image.get("user", {}).get("username") or "")
    return {
        "id": image.get("id"),
        "url": str(image.get("url") or ""),
        "width": image.get("width"),
        "height": image.get("height"),
        "nsfwLevel": image.get("nsfwLevel") or meta.get("nsfwLevel") or 0,
        "type": str(image.get("type") or "image"),
        "username": username,
        "baseModel": str(image.get("baseModel") or meta.get("baseModel") or ""),
        "prompt": str(meta.get("prompt") or ""),
        "stats": {
            "likeCount": stats.get("likeCount") or stats.get("heartCount") or 0,
            "heartCount": stats.get("heartCount") or 0,
            "commentCount": stats.get("commentCount") or 0,
        },
        "resources": _image_resources(image),
    }


IMAGE_SORTS = (
    "Most Reactions",
    "Most Comments",
    "Most Collected",
    "Newest",
    "Oldest",
)


def _normalize_image_sort(sort: str) -> str:
    clean = str(sort or "").strip()
    for option in IMAGE_SORTS:
        if option.lower() == clean.lower():
            return option
    return "Newest"


def _images_query_params(
    query: str = "",
    cursor: str = "",
    sort: str = "Newest",
    limit: int = IMAGE_FEED_PAGE_SIZE,
    period: str = "AllTime",
    base_model: str = "",
    config: dict[str, Any] | None = None,
) -> dict[str, str]:
    config = config or load_config()
    params: dict[str, str] = {
        "limit": str(max(1, min(int(limit or IMAGE_FEED_PAGE_SIZE), 100))),
        "sort": _normalize_image_sort(sort),
        "period": str(period or "AllTime"),
        "nsfw": "true" if config.get("allow_nsfw") else "false",
        # The generation data (and with it every LoRA weight) is only attached
        # when the caller asks for it; without this the feed returns meta: null.
        "withMeta": "true",
    }
    if query.strip():
        params["query"] = query.strip()
    if cursor.strip():
        params["cursor"] = cursor.strip()
    if base_model.strip():
        params["baseModels"] = base_model.strip()
    return params


def _read_images_json(params: dict[str, str], api_key: str | None, timeout: int = 30) -> dict[str, Any] | None:
    url = f"{IMAGES_URL}?{urllib.parse.urlencode(params)}"
    return _read_json_url_with_retries(url, api_key=api_key, timeout=timeout, retries=1)


def _image_feed(
    query: str,
    cursor: str,
    sort: str,
    limit: int,
    period: str,
    base_model: str,
    config: dict[str, Any],
) -> dict[str, Any]:
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    params = _images_query_params(query, cursor, sort, limit, period, base_model, config)
    result = _read_images_json(params, api_key)
    if not result or result.get("error"):
        return {
            "items": [],
            "metadata": {},
            "error": (result or {}).get("error") or "No response from Civitai images",
            "content_filter_active": not bool(config.get("allow_nsfw", False)),
        }
    items = [item for item in (result.get("items") if isinstance(result.get("items"), list) else []) if isinstance(item, dict)]
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    return {
        "items": [_image_feed_card(item) for item in items[:limit]],
        "metadata": metadata,
        "content_filter_active": not bool(config.get("allow_nsfw", False)),
    }


def _parse_image_id(value: str) -> str:
    clean = str(value or "").strip()
    if clean.isdigit():
        return clean
    match = CIVITAI_IMAGE_URL_RE.search(clean)
    return match.group(1) if match else ""


def _image_detail(image_id: str, config: dict[str, Any]) -> dict[str, Any]:
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    # An `imageId` lookup only returns pictures of the browsing level it asks
    # for: `nsfw=true` hides safe images and the bare request hides NSFW ones.
    # Both are tried so a pasted link resolves either way.
    attempts: list[dict[str, str]] = []
    if config.get("allow_nsfw"):
        attempts.append({"imageId": str(image_id), "nsfw": "true", "limit": "1", "withMeta": "true"})
    attempts.append({"imageId": str(image_id), "limit": "1", "withMeta": "true"})
    last_error = ""
    for params in attempts:
        url = f"{IMAGES_URL}?{urllib.parse.urlencode(params)}"
        result = _read_json_url_with_retries(url, api_key=api_key, timeout=30, retries=1, quiet=True)
        if not result or result.get("error"):
            last_error = str((result or {}).get("error") or "Image not found")
            continue
        items = [item for item in (result.get("items") if isinstance(result.get("items"), list) else []) if isinstance(item, dict)]
        match = next((item for item in items if str(item.get("id") or "") == str(image_id)), None)
        if match:
            return {"image": _image_feed_card(match)}
    return {"error": last_error or "Image not found"}


def _resource_search_item(model: dict[str, Any]) -> dict[str, Any]:
    """A search card built from a full model payload, so image resources match Discover.

    Every version is kept: the image pins one of them first, but the picker still
    needs the others so a different version can be chosen.
    """
    item = _search_card(model)
    item["description"] = model.get("description") or ""
    item["civitai_url"] = f"https://civitai.red/models/{model.get('id')}" if model.get("id") else ""
    return item


def _image_version_card(version_payload: dict[str, Any]) -> dict[str, Any]:
    """A single-version model card built straight from a model-version payload.

    The image only pins one version, and `/model-versions/{id}` already carries
    its files, so there is no model request to make.
    """
    version = _pick(version_payload, SEARCH_VERSION_FIELDS)
    version["files"] = [
        _pick(file, SEARCH_FILE_FIELDS) for file in version_payload.get("files") or [] if isinstance(file, dict)
    ]
    version["images"] = [
        _pick(image, SEARCH_IMAGE_FIELDS) for image in (version_payload.get("images") or [])[:2] if isinstance(image, dict)
    ]
    model_info = version_payload.get("model") if isinstance(version_payload.get("model"), dict) else {}
    return {
        "id": str(version_payload.get("modelId") or ""),
        "name": str(model_info.get("name") or ""),
        "type": str(model_info.get("type") or ""),
        "modelVersions": [version],
    }


def _name_match_score(candidate: Any, wanted: str) -> float:
    """How well a model or version name matches a prompt's LoRA tag, as 0..1."""
    key = _resource_name_key(candidate)
    if not key or not wanted:
        return 0.0
    if key == wanted:
        return 1.0
    flat_key = key.replace(" ", "")
    flat_wanted = wanted.replace(" ", "")
    if flat_key == flat_wanted:
        return 0.99
    # Prompts carry file names, so a model or version name often sits inside
    # them ("BArtstyle-KREA2-V2-1024" holds the version "Krea2-V2").
    if len(flat_key) >= 5 and flat_key in flat_wanted:
        return 0.92
    if len(flat_wanted) >= 5 and flat_wanted in flat_key:
        return 0.9
    # Reordered words still name the same model ("Flat_anime_Krea_@" is
    # "Krea 2 Flat Illustration/Anime Style").
    tokens = set(key.split())
    wanted_tokens = set(wanted.split())
    shared = len(tokens & wanted_tokens)
    if not shared:
        return 0.0
    coverage = shared / len(wanted_tokens)
    if coverage >= 0.6:
        return 0.85 * coverage
    reverse = shared / len(tokens)
    if reverse >= 0.6:
        return 0.8 * reverse
    return 0.0


def _lookup_prompt_lora(name: str, config: dict[str, Any], api_key: str | None) -> dict[str, Any] | None:
    """Finds the model a prompt's `<lora:name:0.7>` tag points at.

    Prompt-only stacks have no version ids, so the name is searched among LoRAs
    and the closest model wins; its first version is used as the pinned one.
    """
    wanted = _resource_name_key(name)
    if not wanted:
        return None
    params = {
        "query": wanted,
        "types": "LORA",
        "limit": "8",
        "nsfw": "true" if config.get("allow_nsfw") else "false",
    }
    url = f"{CIVITAI_API_BASE}/models?{urllib.parse.urlencode(params)}"
    result = _read_json_url_with_retries(url, api_key=api_key, timeout=30, retries=1, quiet=True)
    items = result.get("items") if isinstance(result, dict) else None
    if not isinstance(items, list):
        return None
    def score_candidate(candidate: Any) -> float:
        return _name_match_score(candidate, wanted)

    best_model: dict[str, Any] | None = None
    best_version: dict[str, Any] | None = None
    best_score = 0.0
    for model in items:
        if not isinstance(model, dict):
            continue
        versions = [item for item in (model.get("modelVersions") or []) if isinstance(item, dict)]
        model_score = score_candidate(model.get("name"))
        if model_score > best_score:
            best_model, best_version, best_score = model, (versions[0] if versions else None), model_score
        # A version name may match even when the model title does not; the
        # matching version is the one the picture actually loaded.
        for version in versions:
            version_score = score_candidate(version.get("name"))
            if version_score > best_score:
                best_model, best_version, best_score = model, version, version_score
    if best_model is None or best_score <= 0 or not best_version:
        return None
    version = dict(best_version)
    version["modelId"] = version.get("modelId") or best_model.get("id")
    version["model"] = {
        "id": best_model.get("id"),
        "name": str(best_model.get("name") or ""),
        "type": str(best_model.get("type") or "LORA"),
    }
    return version


def _resolve_image_resource(
    resource: dict[str, Any],
    api_key: str | None,
    selected_version_ids: dict[str, str],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolves one image resource into a model card holding its files."""
    entry: dict[str, Any] = {**resource, "supported": False, "model": None, "error": ""}
    kind = str(resource.get("kind") or "")
    version_id = str(resource.get("version_id") or "")
    model_id = str(resource.get("model_id") or "")
    name = str(resource.get("name") or "").strip()
    if not model_id and not version_id and not name:
        entry["error"] = "missing ids"
        return entry
    if kind and kind not in DOWNLOADABLE_IMAGE_RESOURCE_KINDS:
        # Embeds, VAEs and anything else this panel cannot download need no lookup.
        entry["error"] = "unsupported"
        return entry
    target_version_id = str(selected_version_ids.get(version_id or model_id) or version_id)
    try:
        version_payload = None
        if target_version_id:
            version_payload = _read_json_url_with_retries(
                f"{CIVITAI_API_BASE}/model-versions/{urllib.parse.quote(target_version_id)}",
                api_key=api_key, timeout=30, retries=1, quiet=True,
            )
            if version_payload and version_payload.get("error"):
                version_payload = None
        if version_payload is None and not target_version_id and name:
            # A LoRA that only exists as a prompt tag has no id to look up.
            version_payload = _lookup_prompt_lora(name, config or {}, api_key)
        if isinstance(version_payload, dict):
            model_info = version_payload.get("model") if isinstance(version_payload.get("model"), dict) else {}
            kind = kind or _image_resource_kind(model_info.get("type"))
            entry["kind"] = kind
            entry["model_id"] = model_id or str(version_payload.get("modelId") or "")
            entry["version_id"] = str(version_payload.get("id") or target_version_id)
            entry["type"] = str(model_info.get("type") or entry.get("type") or "")
            entry["name"] = str(model_info.get("name") or entry.get("name") or "")
            entry["version_name"] = str(version_payload.get("name") or entry.get("version_name") or "")
            entry["base_model"] = str(version_payload.get("baseModel") or entry.get("base_model") or "")
            entry["supported"] = kind in DOWNLOADABLE_IMAGE_RESOURCE_KINDS
            if not entry["supported"]:
                entry["error"] = "unsupported"
                return entry
            entry["model"] = _image_version_card(version_payload)
            return entry
        if kind and kind not in DOWNLOADABLE_IMAGE_RESOURCE_KINDS:
            entry["error"] = "unsupported"
            return entry
        if not model_id:
            entry["error"] = "Model not found"
            return entry
        model = _read_json_url_with_retries(
            f"{CIVITAI_API_BASE}/models/{urllib.parse.quote(model_id)}",
            api_key=api_key, timeout=30, retries=1, quiet=True,
        )
        if not model or model.get("error"):
            entry["error"] = str((model or {}).get("error") or "Model not found")
            return entry
        card = _resource_search_item(model)
        kind = kind or _image_resource_kind(card.get("type"))
        entry["kind"] = kind
        entry["supported"] = kind in DOWNLOADABLE_IMAGE_RESOURCE_KINDS
        if not entry["supported"]:
            entry["error"] = "unsupported"
            return entry
        versions = card.get("modelVersions") if isinstance(card.get("modelVersions"), list) else []
        pinned = next((item for item in versions if str(item.get("id") or "") == target_version_id), None)
        if pinned:
            card["modelVersions"] = [pinned, *[item for item in versions if item is not pinned]]
        entry["model"] = card
        entry["model_id"] = model_id
        entry["version_id"] = str((pinned or {}).get("id") or target_version_id or "")
        entry["name"] = card.get("name") or entry.get("name") or ""
        entry["base_model"] = str((pinned or {}).get("baseModel") or entry.get("base_model") or "")
        entry["type"] = str(card.get("type") or entry.get("type") or "")
    except Exception as exc:
        entry["error"] = str(exc)
    return entry


def _resolve_image_resources(
    resources: list[dict[str, Any]],
    config: dict[str, Any],
    selected_version_ids: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Turns image resources into model cards with every file of their version.

    The image payload only carries ids, so each resource is fetched on its own
    and pinned to the version the image was generated with; that version keeps
    the full file list, which is what the tick-box bulk download needs. Lookups
    run in parallel because one picture can reference a whole LoRA stack.
    """
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    selected_version_ids = selected_version_ids or {}
    items = [resource for resource in resources if isinstance(resource, dict)]
    if not items:
        return []
    if len(items) == 1:
        return [_resolve_image_resource(items[0], api_key, selected_version_ids, config)]
    workers = min(len(items), IMAGE_RESOURCE_FETCH_WORKERS)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        resolved = list(pool.map(lambda item: _resolve_image_resource(item, api_key, selected_version_ids, config), items))
    return _merge_resolved_resources(resolved)


def _weight_match_score(row: dict[str, Any], wanted: str) -> float:
    """How likely a prompt tag names this row; used to move a weight across."""
    if not wanted:
        return 0.0
    # A prompt tag is a LoRA file name, and Civitai lists the file names of the
    # pinned version, so this is the most exact match available.
    versions = (row.get("model") or {}).get("modelVersions") or []
    for version in versions[:1]:
        for file in (version.get("files") or [])[:4] if isinstance(version, dict) else []:
            if isinstance(file, dict) and _resource_name_key(file.get("name")) == wanted:
                return 1.0
    score = max(
        _name_match_score(row.get("name"), wanted),
        _name_match_score(row.get("version_name"), wanted),
    )
    if score:
        return score
    # A model title and a LoRA file name share only part of their words
    # ("Purple_Grainy_KR2_V2_D" against "Purple Grainy || Photography lora").
    row_tokens = set(_resource_name_key(row.get("name")).split()) | set(_resource_name_key(row.get("version_name")).split())
    wanted_tokens = set(wanted.split())
    shared = len(row_tokens & wanted_tokens)
    if shared < 2:
        return 0.0
    return 0.5 * (shared / max(1, min(len(row_tokens), len(wanted_tokens))))


def _merge_resolved_resources(resolved: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Folds rows that describe the same model into one.

    The same LoRA arrives twice when it is both a prompt tag (its weight) and a
    known version id (its files); matching them by name keeps the count equal to
    what Civitai lists while keeping the weight.
    """
    id_rows: list[dict[str, Any]] = []
    prompt_rows: list[dict[str, Any]] = []
    by_version: dict[str, dict[str, Any]] = {}
    for entry in resolved:
        if entry.get("from_prompt"):
            prompt_rows.append(entry)
            continue
        key = str(entry.get("version_id") or "")
        kept = by_version.get(key) if key else None
        if kept is not None:
            if entry.get("weight") is not None and kept.get("weight") is None:
                kept["weight"] = entry["weight"]
            continue
        if key:
            by_version[key] = entry
        id_rows.append(entry)
    used: set[int] = set()
    for prompt_row in prompt_rows:
        wanted = _resource_name_key(prompt_row.get("name"))
        # The name search may have landed on the exact version already listed.
        direct = by_version.get(str(prompt_row.get("version_id") or ""))
        if direct is not None and direct in id_rows:
            index = id_rows.index(direct)
            used.add(index)
            if direct.get("weight") is None:
                direct["weight"] = prompt_row.get("weight")
            continue
        best: dict[str, Any] | None = None
        best_score = 0.2
        for index, row in enumerate(id_rows):
            if index in used:
                continue
            score = _weight_match_score(row, wanted)
            if score > best_score:
                best, best_score = row, score
                best_index = index
        if best is None:
            # `modelVersionIds` is the picture's complete list, so an unmatched
            # prompt tag must not become an extra row; it only carries a weight.
            if not id_rows:
                id_rows.append(prompt_row)
            continue
        used.add(best_index)
        if best.get("weight") is None:
            best["weight"] = prompt_row.get("weight")
    return id_rows


def _search_base_model_text_fallback(
    kind: str,
    query: str,
    tag: str,
    category: str,
    base_model: str,
    sort: str,
    limit: int,
    cursor: str,
    config: dict[str, Any],
    api_key: str | None,
    existing_ids: set[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if limit <= 0:
        return [], {}
    existing_ids = existing_ids or set()
    collected: list[dict[str, Any]] = []
    metadata: dict[str, Any] = {}
    current_cursor = cursor
    pages = 0
    while pages < SEARCH_FALLBACK_MAX_PAGES and len(collected) < limit:
        params = _build_model_query_params(
            kind,
            query="",
            cursor=current_cursor,
            sort=sort,
            limit=100,
            config=config,
            category="",
            tag="",
            base_model=base_model,
        )
        result = _read_models_json(params, api_key, 30)
        if not result or (isinstance(result, dict) and result.get("error")):
            break
        page_items = result.get("items") if isinstance(result.get("items"), list) else []
        page_items = [item for item in page_items if isinstance(item, dict)]
        if page_items:
            _merge_taxonomy_cache(kind, config, page_items)
        for item in page_items:
            item_id = str(item.get("id") or "")
            if item_id in existing_ids:
                continue
            if not _base_model_matches(item, base_model):
                continue
            if not _model_text_matches(item, query, tag, category):
                continue
            existing_ids.add(item_id)
            collected.append(item)
            if len(collected) >= limit:
                break
        metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
        next_cursor = str(metadata.get("nextCursor") or "")
        pages += 1
        if not next_cursor:
            metadata = {}
            break
        current_cursor = next_cursor
    if current_cursor and metadata.get("nextCursor"):
        metadata = dict(metadata)
        metadata["nextCursor"] = f"{SEARCH_FALLBACK_CURSOR_PREFIX}{metadata['nextCursor']}"
    return collected, metadata


def _pick(source: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    return {field: source[field] for field in fields if field in source} if isinstance(source, dict) else {}


def _search_card(model: dict[str, Any]) -> dict[str, Any]:
    card = _pick(model, SEARCH_MODEL_FIELDS)
    creator = model.get("creator")
    if isinstance(creator, dict):
        card["creator"] = {"username": creator.get("username")}
    versions = []
    for index, version in enumerate(model.get("modelVersions") or []):
        if not isinstance(version, dict):
            continue
        slim = _pick(version, SEARCH_VERSION_FIELDS)
        images = [_pick(image, SEARCH_IMAGE_FIELDS) for image in version.get("images") or [] if isinstance(image, dict)]
        slim["images"] = images[:SEARCH_PRIMARY_IMAGE_LIMIT if index == 0 else 1]
        slim["files"] = [_pick(file, SEARCH_FILE_FIELDS) for file in version.get("files") or [] if isinstance(file, dict)]
        versions.append(slim)
    card["modelVersions"] = versions
    return card


def _search_civitai_models(
    kind: str,
    query: str,
    cursor: str,
    sort: str,
    limit: int,
    tag: str,
    base_model: str,
    category: str,
    config: dict[str, Any],
    period: str = "AllTime",
    file_format: str = "",
    model_status: str = "",
) -> dict[str, Any]:
    api_key = str(config.get("civitai_api_key") or "").strip() or None
    period = _normalize_model_period(period)
    file_format = _normalize_model_file_format(file_format)
    model_status = _normalize_model_status(model_status)
    local_filters = bool(file_format or model_status)
    category = _safe_segment(category, "") if category else ""
    tag = _safe_segment(tag, "") if tag else ""
    base_model = _safe_segment(base_model, "") if base_model else ""
    if category.lower() == "other":
        category = ""
    api_tag = tag or category
    collected: list[dict[str, Any]] = []
    warning = ""
    metadata: dict[str, Any] = {}
    attempted: set[tuple[str, str, str]] = set()
    fallback_cursor = ""
    attempt_index = 0
    if cursor.startswith(SEARCH_FALLBACK_CURSOR_PREFIX):
        fallback_cursor = cursor[len(SEARCH_FALLBACK_CURSOR_PREFIX):]
        cursor = ""
    elif cursor.startswith(SEARCH_ATTEMPT_CURSOR_PREFIX):
        index_text, _, cursor = cursor[len(SEARCH_ATTEMPT_CURSOR_PREFIX):].partition(":")
        attempt_index = int(index_text) if index_text.isdigit() else 0

    def add_attempt(attempts: list[tuple[str, str, str]], attempt_query: str, attempt_tag: str, attempt_base: str) -> None:
        key = (attempt_query.strip(), attempt_tag.strip(), attempt_base.strip())
        if key in attempted:
            return
        attempted.add(key)
        attempts.append(key)

    attempts: list[tuple[str, str, str]] = []
    if not fallback_cursor:
        add_attempt(attempts, query, api_tag, base_model)
        if query and api_tag:
            add_attempt(attempts, query, "", base_model)
        if query and not api_tag:
            add_attempt(attempts, "", query, base_model)
        if query and api_tag:
            add_attempt(attempts, "", api_tag, base_model)
    if cursor:
        # Later pages continue the attempt that produced the first page.
        attempts = attempts[attempt_index:attempt_index + 1]
    else:
        attempt_index = 0

    for index, (attempt_query, attempt_tag, attempt_base) in enumerate(attempts, start=attempt_index):
        fetch_limit = 100 if base_model else limit
        page_cursor = cursor
        # Format and status filters have no Civitai parameter, so the pages that
        # do not match are skipped here and the listing keeps paging until it
        # can fill a whole page (or runs out).
        page_budget = SEARCH_FILTER_PAGE_LIMIT if local_filters else 1
        more_pages = False
        for _ in range(page_budget):
            more_pages = False
            params = _build_model_query_params(
                kind,
                attempt_query,
                page_cursor,
                sort,
                fetch_limit,
                config,
                "",
                attempt_tag,
                attempt_base,
                period,
            )
            result = _read_models_json(params, api_key, 30)
            if not result:
                warning = "Empty response from Civitai"
                break
            if isinstance(result, dict) and result.get("error"):
                warning = str(result.get("error") or "")
                break

            page_items = result.get("items") if isinstance(result.get("items"), list) else []
            page_items = [item for item in page_items if isinstance(item, dict)]
            if attempt_tag and not attempt_query and attempt_tag == query.strip():
                # Civitai ignores unknown tags, so a query retried as a tag must
                # still match the query or the page is just the unfiltered listing.
                page_items = [item for item in page_items if _model_text_matches(item, query)]
            page_metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
            next_cursor = str(page_metadata.get("nextCursor") or "")
            _merge_taxonomy_cache(kind, config, page_items)
            if base_model:
                page_items = [item for item in page_items if _base_model_matches(item, base_model)]
            if local_filters:
                page_items = [
                    item for item in page_items
                    if _model_matches_local_filters(item, file_format, model_status)
                ]
            if page_items:
                metadata = page_metadata
                if index and next_cursor:
                    metadata = {**metadata, "nextCursor": f"{SEARCH_ATTEMPT_CURSOR_PREFIX}{index}:{next_cursor}"}
                collected.extend(page_items)
                warning = ""
            if len(collected) >= limit or not next_cursor:
                break
            page_cursor = next_cursor
            more_pages = True
        if collected and (not local_filters or not more_pages or len(collected) >= limit):
            break

    should_fallback = base_model and (query or tag or category) and len(collected) < limit
    if should_fallback:
        existing_ids = {str(item.get("id")) for item in collected}
        fallback_items, fallback_metadata = _search_base_model_text_fallback(
            kind,
            query,
            tag,
            category,
            base_model,
            sort,
            limit - len(collected),
            fallback_cursor,
            config,
            api_key,
            existing_ids,
        )
        if fallback_items:
            collected.extend(fallback_items)
            metadata = fallback_metadata
            warning = ""
        elif fallback_metadata:
            metadata = fallback_metadata

    taxonomy = _taxonomy_cache_get(kind, config) or _empty_taxonomy(kind)
    response = {
        "items": [_search_card(item) for item in collected[:limit]],
        "metadata": metadata or {},
        "taxonomy": taxonomy,
        "content_filter_active": not bool(config.get("allow_nsfw", False)),
    }
    if warning:
        response["warning"] = warning
    return response


def _load_taxonomy(kind: str, config: dict[str, Any], force: bool = False) -> dict[str, Any]:
    cached = None if force else _taxonomy_cache_get(kind, config)
    if cached:
        return cached

    api_key = str(config.get("civitai_api_key") or "").strip() or None
    params = _build_model_query_params(kind, sort="Highest Rated", limit=100, config=config)
    with ThreadPoolExecutor(max_workers=3) as pool:
        models_request = pool.submit(_read_models_json, params, api_key, 30)
        enums_request = pool.submit(_read_json_url, _enums_url(), api_key, 30)
        tags_request = pool.submit(_read_json_url, _tags_url({"limit": "200"}), api_key, 30)
        result = models_request.result()
        enums_result = enums_request.result()
        tag_result = tags_request.result()
    if not result or result.get("error"):
        stale_key = _taxonomy_cache_key(kind, config)
        with _TAXONOMY_LOCK:
            stale = _TAXONOMY_CACHE.get(stale_key, {}).get("data")
        taxonomy = dict(stale) if isinstance(stale, dict) else _empty_taxonomy(kind)
        taxonomy["warning"] = result.get("error") if isinstance(result, dict) else "Failed to load taxonomy"
    else:
        items = result.get("items") if isinstance(result.get("items"), list) else []
        items = [item for item in items if isinstance(item, dict)]
        taxonomy = _taxonomy_from_items(kind, items)

    if isinstance(enums_result, dict) and not enums_result.get("error"):
        base_models = enums_result.get("BaseModel")
        if isinstance(base_models, list):
            taxonomy = _merge_taxonomy(taxonomy, _taxonomy_from_base_models(kind, base_models))

    if isinstance(tag_result, dict) and not tag_result.get("error"):
        tag_items = tag_result.get("items") if isinstance(tag_result.get("items"), list) else []
        taxonomy = _merge_taxonomy(taxonomy, _taxonomy_from_tags(kind, tag_items))
    return _set_taxonomy_cache_data(kind, config, taxonomy)


def _placeholder_svg(text: str = "No Preview") -> web.Response:
    body = f"""<svg xmlns="http://www.w3.org/2000/svg" width="450" height="600" viewBox="0 0 450 600">
<rect width="450" height="600" fill="#16181d"/>
<rect x="24" y="24" width="402" height="552" rx="8" fill="#20242c" stroke="#3a404b"/>
<text x="225" y="300" fill="#9aa3b2" font-family="Arial, sans-serif" font-size="24" text-anchor="middle">{text}</text>
</svg>"""
    return web.Response(body=body.encode("utf-8"), content_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})


async def get_config_api(request: web.Request) -> web.Response:
    config = load_config()
    return web.json_response(_public_config(config))


async def save_config_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            return web.json_response({"success": False, "error": "Config payload must be an object"}, status=400)
        config = await asyncio.to_thread(save_config, body)
        return web.json_response({"success": True, "config": _public_config(config)})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def roots_api(request: web.Request) -> web.Response:
    return web.json_response(_root_display())


async def taxonomy_api(request: web.Request) -> web.Response:
    try:
        config = load_config()
        kind = _normalize_asset_kind(request.query.get("kind", "lora"))
        force = request.query.get("force", "").lower() in {"1", "true", "yes"}
        data = await asyncio.to_thread(_load_taxonomy, kind, config, force)
        return web.json_response(data)
    except Exception as exc:
        return web.json_response(_empty_taxonomy(request.query.get("kind", "lora"), str(exc)))


async def search_api(request: web.Request) -> web.Response:
    try:
        config = load_config()
        kind = _normalize_asset_kind(request.query.get("kind", "lora"))
        query = request.query.get("query", "")
        cursor = request.query.get("cursor", "")
        sort = _normalize_model_sort(request.query.get("sort", "Highest Rated"))
        period = _normalize_model_period(request.query.get("period", "AllTime"))
        category = request.query.get("category", "")
        tag = request.query.get("tag", "")
        base_model = request.query.get("base_model") or request.query.get("baseModel") or request.query.get("baseModels") or ""
        file_format = _normalize_model_file_format(
            request.query.get("file_format") or request.query.get("fileFormat") or ""
        )
        model_status = _normalize_model_status(
            request.query.get("model_status") or request.query.get("modelStatus") or ""
        )
        limit = max(1, min(int(request.query.get("limit", "40")), 100))
        cache_key = (
            kind,
            query,
            cursor,
            sort,
            period,
            file_format,
            model_status,
            limit,
            tag,
            base_model,
            category,
            bool(config.get("allow_nsfw", True)),
            bool(str(config.get("civitai_api_key") or "").strip()),
        )
        now = _now()
        with _SEARCH_RESULT_CACHE_LOCK:
            cached = _SEARCH_RESULT_CACHE.get(cache_key)
            if cached and now - int(cached.get("timestamp") or 0) < SEARCH_RESULT_CACHE_TTL:
                return web.json_response(cached["data"])
        result = await asyncio.to_thread(
            _search_civitai_models,
            kind,
            query,
            cursor,
            sort,
            limit,
            tag,
            base_model,
            category,
            config,
            period,
            file_format,
            model_status,
        )
        if isinstance(result, dict) and not result.get("error"):
            with _SEARCH_RESULT_CACHE_LOCK:
                stale_keys = [
                    key for key, value in _SEARCH_RESULT_CACHE.items()
                    if now - int(value.get("timestamp") or 0) >= SEARCH_RESULT_CACHE_TTL
                ]
                for key in stale_keys:
                    _SEARCH_RESULT_CACHE.pop(key, None)
                if len(_SEARCH_RESULT_CACHE) >= SEARCH_RESULT_CACHE_LIMIT:
                    oldest_key = min(
                        _SEARCH_RESULT_CACHE,
                        key=lambda key: int(_SEARCH_RESULT_CACHE[key].get("timestamp") or 0),
                    )
                    _SEARCH_RESULT_CACHE.pop(oldest_key, None)
                _SEARCH_RESULT_CACHE[cache_key] = {"timestamp": now, "data": result}
        return web.json_response(result)
    except Exception as exc:
        return web.json_response({"items": [], "metadata": {}, "error": str(exc)}, status=500)


async def test_api_api(request: web.Request) -> web.Response:
    try:
        config = load_config()
        api_key = str(config.get("civitai_api_key") or "").strip() or None
        params = _build_model_query_params("lora", limit=1, config=config)
        result = await asyncio.to_thread(_read_json_url, _models_url(params), api_key, 20)
        if not result or result.get("error"):
            return web.json_response({
                "success": False,
                "api_key_set": bool(api_key),
                "error": result.get("error") if isinstance(result, dict) else "No response from Civitai red",
            })
        return web.json_response({
            "success": True,
            "api_key_set": bool(api_key),
            "count": len(result.get("items") if isinstance(result.get("items"), list) else []),
        })
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc), "api_key_set": bool(load_config().get("civitai_api_key"))})


async def model_detail_api(request: web.Request) -> web.Response:
    try:
        model_id = str(request.query.get("id", "")).strip()
        if not model_id:
            return web.json_response({"success": False, "error": "Missing model id"}, status=400)
        api_key = str(load_config().get("civitai_api_key") or "").strip() or None
        cache_key = (model_id, _api_key_cache_part(api_key))
        now = _now()
        with _MODEL_DETAIL_CACHE_LOCK:
            cached = _MODEL_DETAIL_CACHE.get(cache_key)
        if cached and now - cached["timestamp"] < MODEL_DETAIL_CACHE_TTL:
            return web.json_response({"success": True, "model": cached["model"]})
        url = f"{CIVITAI_API_BASE}/models/{urllib.parse.quote(model_id)}"
        data = await asyncio.to_thread(_read_json_url, url, api_key, 30)
        if not data or data.get("error"):
            return web.json_response({"success": False, "error": data.get("error") if data else "Model not found"}, status=404)
        with _MODEL_DETAIL_CACHE_LOCK:
            if len(_MODEL_DETAIL_CACHE) >= MODEL_DETAIL_CACHE_LIMIT:
                _MODEL_DETAIL_CACHE.pop(min(_MODEL_DETAIL_CACHE, key=lambda key: _MODEL_DETAIL_CACHE[key]["timestamp"]), None)
            _MODEL_DETAIL_CACHE[cache_key] = {"timestamp": now, "model": data}
        return web.json_response({"success": True, "model": data})
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def images_api(request: web.Request) -> web.Response:
    try:
        config = load_config()
        query = request.query.get("query", "")
        cursor = request.query.get("cursor", "")
        sort = request.query.get("sort", "Newest") or "Newest"
        period = request.query.get("period", "AllTime") or "AllTime"
        base_model = request.query.get("base_model") or request.query.get("baseModels") or ""
        limit = max(1, min(int(request.query.get("limit", str(IMAGE_FEED_PAGE_SIZE))), 100))
        cache_key = (
            query.strip(),
            cursor.strip(),
            sort,
            period,
            limit,
            base_model.strip(),
            bool(config.get("allow_nsfw", True)),
            _api_key_cache_part(str(config.get("civitai_api_key") or "").strip() or None),
        )
        now = _now()
        with _IMAGE_FEED_CACHE_LOCK:
            cached = _IMAGE_FEED_CACHE.get(cache_key)
            if cached and now - int(cached.get("timestamp") or 0) < IMAGE_FEED_CACHE_TTL:
                return web.json_response(cached["data"])
        result = await asyncio.to_thread(
            _image_feed, query, cursor, sort, limit, period, base_model, config,
        )
        if isinstance(result, dict) and not result.get("error"):
            with _IMAGE_FEED_CACHE_LOCK:
                if len(_IMAGE_FEED_CACHE) >= IMAGE_FEED_CACHE_LIMIT:
                    _IMAGE_FEED_CACHE.pop(
                        min(_IMAGE_FEED_CACHE, key=lambda key: int(_IMAGE_FEED_CACHE[key].get("timestamp") or 0)),
                        None,
                    )
                _IMAGE_FEED_CACHE[cache_key] = {"timestamp": now, "data": result}
        return web.json_response(result)
    except Exception as exc:
        return web.json_response({"items": [], "metadata": {}, "error": str(exc)}, status=500)


async def image_detail_api(request: web.Request) -> web.Response:
    try:
        image_id = _parse_image_id(request.query.get("id", ""))
        if not image_id:
            return web.json_response({"success": False, "error": "Missing image id or link"}, status=400)
        data = await asyncio.to_thread(_image_detail, image_id, load_config())
        if data.get("error"):
            return web.json_response({"success": False, "error": data["error"]}, status=404)
        return web.json_response({"success": True, "image": data["image"]})
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def image_resolve_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Image payload must be an object")
        resources = body.get("resources") if isinstance(body.get("resources"), list) else []
        selected = body.get("selected_versions") if isinstance(body.get("selected_versions"), dict) else {}
        entries = await asyncio.to_thread(
            _resolve_image_resources, resources, load_config(), {str(key): str(value) for key, value in selected.items()},
        )
        return web.json_response({"success": True, "resources": entries})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def resolve_path_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        model = body.get("model") if isinstance(body.get("model"), dict) else {}
        version = body.get("version") if isinstance(body.get("version"), dict) else {}
        file_info = body.get("file") if isinstance(body.get("file"), dict) else {}
        requested_kind = str(body.get("kind") or "")
        overrides = body.get("overrides") if isinstance(body.get("overrides"), dict) else {}
        resolution = resolve_download_path(model, version, file_info, requested_kind, overrides)
        resolution["exists"] = os.path.exists(resolution["absolute_path"])
        return web.json_response({"success": True, "resolution": resolution})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


def _enqueue_download_request(body: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    model = body.get("model") if isinstance(body.get("model"), dict) else {}
    version = body.get("version") if isinstance(body.get("version"), dict) else {}
    file_info = body.get("file") if isinstance(body.get("file"), dict) else {}
    requested_kind = str(body.get("kind") or "")
    overrides = body.get("overrides") if isinstance(body.get("overrides"), dict) else {}
    resolution = resolve_download_path(model, version, file_info, requested_kind, overrides)
    download_url = _civitai_red_url(str(body.get("download_url") or resolution.get("download_url") or ""))
    if not download_url or not _validate_civitai_https(download_url):
        raise ValueError("Only Civitai HTTPS downloads are supported")

    store = _download_store()
    _ensure_download_workers()
    task_id = str(uuid.uuid4())
    metadata = _metadata_payload(model, version, file_info, resolution)
    preview_url = _first_preview_url(version, model)
    retry_payload = {
        "kind": requested_kind,
        "model": model,
        "version": version,
        "file": file_info,
        "overrides": overrides,
        "download_url": download_url,
    }
    added = store.add_if_capacity({
        "id": task_id,
        "status": "pending",
        "progress": 0,
        "total": 0,
        "error": "",
        "root_kind": resolution["root_kind"],
        "target_path": resolution["absolute_path"],
        "relative_path": resolution["relative_path"],
        "filename": resolution["filename"],
        "model_id": model.get("id") or "",
        "version_id": version.get("id") or "",
        "model_name": str(model.get("name") or ""),
        "model_type": str(model.get("type") or ""),
        "version_name": str(version.get("name") or ""),
        "base_model": str(version.get("baseModel") or model.get("baseModel") or ""),
        "file_size": int(float(file_info.get("sizeKB") or 0) * 1024),
        "preview_url": preview_url or "",
        "created_at": _now(),
    }, retry_payload, DOWNLOAD_MAX_ACTIVE_JOBS)
    if not added:
        raise DownloadQueueFull(f"Download queue is full ({DOWNLOAD_MAX_ACTIVE_JOBS} active jobs)")
    try:
        _DOWNLOAD_QUEUE.put_nowait((
            task_id,
            download_url,
            resolution["absolute_path"],
            resolution["root_kind"],
            metadata,
            preview_url,
        ))
    except queue.Full as exc:
        store.remove(task_id)
        raise DownloadQueueFull("Download queue is full") from exc
    return task_id, resolution


async def download_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Download payload must be an object")
        task_id, resolution = _enqueue_download_request(body)
        return web.json_response({"success": True, "task_id": task_id, "resolution": resolution})
    except DownloadQueueFull as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=429)
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def download_status_api(request: web.Request) -> web.Response:
    task_id = request.query.get("task_id", "")
    return web.json_response(_download_store().snapshot(task_id))


async def cancel_download_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        task_id = str(body.get("task_id") or "") if isinstance(body, dict) else ""
        if not task_id:
            raise ValueError("Missing task_id")
        job = _download_store().request_cancel(task_id)
        if not job:
            return web.json_response({"success": False, "error": "Download is not active"}, status=409)
        return web.json_response({"success": True, "job": job})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def retry_download_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        task_id = str(body.get("task_id") or "") if isinstance(body, dict) else ""
        if not task_id:
            raise ValueError("Missing task_id")
        payload = _download_store().retry_payload(task_id)
        if not payload:
            return web.json_response({"success": False, "error": "Download is not retryable"}, status=409)
        new_task_id, resolution = _enqueue_download_request(payload)
        return web.json_response({
            "success": True,
            "task_id": new_task_id,
            "retry_of": task_id,
            "resolution": resolution,
        })
    except DownloadQueueFull as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=429)
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def remove_download_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Download removal payload must be an object")
        task_id = str(body.get("task_id") or "")
        task_ids = body.get("task_ids")
        if task_id and task_ids is not None:
            raise ValueError("Provide task_id or task_ids, not both")
        if task_ids is not None and not isinstance(task_ids, list):
            raise ValueError("task_ids must be an array")
        store = _download_store()
        removed = (
            store.remove_finished_many([str(item) for item in task_ids if str(item)])
            if task_ids is not None
            else store.remove_finished(task_id)
        )
        if task_id and not removed:
            job = store.snapshot(task_id)
            if job.get("status") == "not_found":
                return web.json_response({"success": False, "error": "Download record not found"}, status=404)
            return web.json_response({"success": False, "error": "Active downloads cannot be removed"}, status=409)
        return web.json_response({"success": True, "removed": removed})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def library_api(request: web.Request) -> web.Response:
    try:
        force = request.query.get("force", "").lower() in {"1", "true", "yes"}
        data = await asyncio.to_thread(_scan_roots, force)
        return web.json_response(data)
    except Exception as exc:
        return web.json_response({"roots": _root_display(), "items": [], "error": str(exc)}, status=500)


def _update_local_favorite_metadata(item: dict[str, Any], favorite: bool) -> None:
    local = item.get("local") if isinstance(item.get("local"), dict) else {}
    root_kind = str(local.get("root_kind") or "")
    relative_path = str(local.get("relative_path") or "")
    if not root_kind or not relative_path:
        return
    try:
        abs_path = _resolve_asset_path(root_kind, relative_path, local.get("storage_root_id"))
    except ValueError:
        return
    if not os.path.isfile(abs_path):
        return
    status, metadata = _metadata_for_asset(abs_path, root_kind)
    if status == "missing":
        metadata = {
            "source": "local",
            "name": item.get("name") or os.path.splitext(os.path.basename(abs_path))[0],
            "resolution": {"root_kind": root_kind, "relative_path": relative_path},
        }
    metadata["favorite"] = favorite
    metadata["favorite_updated_at"] = _now()
    _write_asset_metadata(abs_path, root_kind, metadata)
    _LIBRARY_INDEX.invalidate()


async def favorites_api(_request: web.Request) -> web.Response:
    try:
        return web.json_response(await asyncio.to_thread(_load_favorites))
    except Exception as exc:
        return web.json_response({"folders": [], "items": [], "error": str(exc)}, status=500)


async def favorite_item_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("item"), dict):
            raise ValueError("Favorite item is required")
        favorite = _config_bool(body.get("favorite"), "favorite", True)
        folder_id = str(body.get("folder_id") or "") if "folder_id" in body else None
        normalized = _normalize_favorite_item(body["item"])
        store = await asyncio.to_thread(_mutate_favorite_item, normalized, favorite, folder_id)
        await asyncio.to_thread(_update_local_favorite_metadata, normalized, favorite)
        return web.json_response({"success": True, **store})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


def _mutate_favorite_folder(action: str, folder_id: str, name: str) -> dict[str, Any]:
    with _FAVORITES_LOCK:
        store = _load_favorites_unlocked()
        folders = store["folders"]
        if action == "create":
            clean_name = _favorite_folder_name(name)
            if any(folder["name"].casefold() == clean_name.casefold() for folder in folders):
                raise ValueError("Favorite folder already exists")
            folders.append({
                "id": uuid.uuid4().hex,
                "name": clean_name,
                "created_at": _now(),
                "updated_at": _now(),
            })
        elif action == "rename":
            clean_name = _favorite_folder_name(name)
            folder = next((entry for entry in folders if entry["id"] == folder_id), None)
            if not folder:
                raise ValueError("Favorite folder not found")
            if any(entry["id"] != folder_id and entry["name"].casefold() == clean_name.casefold() for entry in folders):
                raise ValueError("Favorite folder already exists")
            folder["name"] = clean_name
            folder["updated_at"] = _now()
        elif action == "delete":
            if not any(folder["id"] == folder_id for folder in folders):
                raise ValueError("Favorite folder not found")
            store["folders"] = [folder for folder in folders if folder["id"] != folder_id]
            for item in store["items"]:
                if item.get("folder_id") == folder_id:
                    item["folder_id"] = ""
                    item["updated_at"] = _now()
        else:
            raise ValueError("Invalid favorite folder action")
        store["updated_at"] = _now()
        _write_favorites_unlocked(store)
        return _favorite_store_response(store)


async def favorite_folder_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Favorite folder payload must be an object")
        action = str(body.get("action") or "").strip().lower()
        folder_id = str(body.get("folder_id") or "").strip()
        name = str(body.get("name") or "")
        store = await asyncio.to_thread(_mutate_favorite_folder, action, folder_id, name)
        return web.json_response({"success": True, **store})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def local_preview_api(request: web.Request) -> web.StreamResponse:
    try:
        root_kind = request.query.get("root_kind", "")
        storage_root_id = request.query.get("root_id", "")
        rel_path = request.query.get("path", "")
        abs_path = _resolve_asset_path(root_kind, rel_path, storage_root_id)
        preview_file = _preview_for_asset(abs_path)
        if preview_file and os.path.isfile(preview_file):
            resp = web.FileResponse(preview_file)
            resp.headers["Cache-Control"] = "public, max-age=86400"
            return resp
        return _placeholder_svg()
    except Exception:
        return _placeholder_svg()


def _snap_remote_image_width(width: int) -> int:
    for common_width in REMOTE_IMAGE_COMMON_WIDTHS:
        if width <= common_width:
            return common_width
    return width


def _civitai_media_cache_url(source_url: str, width: int) -> str:
    try:
        parsed = urllib.parse.urlparse(source_url)
    except Exception:
        return source_url
    if not parsed.hostname or parsed.hostname.lower() not in CIVITAI_IMAGE_HOSTS:
        return source_url
    if re.search(r"\.(?:mp4|webm|mov|m4v|avi)(?:$|/)", parsed.path, re.IGNORECASE):
        return source_url
    media_id_match = CIVITAI_MEDIA_ID_RE.search(parsed.path)
    if not media_id_match:
        return source_url
    media_id = media_id_match.group(1).lower()
    snapped_width = _snap_remote_image_width(width)
    return (
        f"{CIVITAI_IMAGE_LOCATION}/{media_id}/"
        f"width={snapped_width},optimized=true/{media_id}.jpeg"
    )


async def image_proxy_api(request: web.Request) -> web.StreamResponse:
    source_url = request.query.get("url", "").strip()
    if not source_url.startswith(("http://", "https://")):
        return _placeholder_svg()
    try:
        width = max(80, min(int(request.query.get("width", str(REMOTE_IMAGE_CACHE_WIDTH_DEFAULT))), 1400))
    except Exception:
        width = REMOTE_IMAGE_CACHE_WIDTH_DEFAULT
    source_url = _civitai_media_cache_url(source_url, width)
    cache_key = hashlib.sha256(f"{source_url}|{width}".encode("utf-8")).hexdigest()
    cache_path = os.path.join(_cache_dir("remote_images"), cache_key)
    meta_path = f"{cache_path}.json"
    if os.path.isfile(cache_path):
        content_type = "image/webp"
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as handle:
                    content_type = json.load(handle).get("content_type") or content_type
            except Exception:
                pass
        return web.FileResponse(cache_path, headers={"Cache-Control": "public, max-age=31536000, immutable", "Content-Type": content_type})

    def image_source_candidates(url: str) -> list[str]:
        candidates = [url]
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query)
        if "width" in query:
            query.pop("width", None)
            stripped = urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query, doseq=True)))
            if stripped and stripped not in candidates:
                candidates.append(stripped)
        return candidates

    def normalize_image_content_type(url: str, content_type: str | None, data: bytes) -> str:
        clean = (content_type or "").split(";", 1)[0].strip().lower()
        if clean.startswith("image/") or clean.startswith("video/"):
            return clean
        guessed = mimetypes.guess_type(url)[0]
        if guessed:
            return guessed
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            return "image/webp"
        if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
            return "image/gif"
        return "image/jpeg"

    def fetch_image() -> tuple[bytes, str]:
        last_error: Exception | None = None
        for candidate in image_source_candidates(source_url):
            try:
                req = urllib.request.Request(candidate, headers=_request_headers(json_content=False))
                with urllib.request.urlopen(req, timeout=25) as resp:
                    data = resp.read()
                    return data, normalize_image_content_type(candidate, resp.headers.get("Content-Type"), data)
            except Exception as exc:
                last_error = exc
        if last_error:
            raise last_error
        raise RuntimeError("No image source candidates")

    try:
        data, content_type = await asyncio.to_thread(fetch_image)
        with open(cache_path, "wb") as handle:
            handle.write(data)
        with open(meta_path, "w", encoding="utf-8") as handle:
            json.dump({
                "content_type": content_type,
                "source_url": source_url,
                "width": width,
                "content_length": len(data),
                "cached_at": _now(),
            }, handle)
        return web.Response(body=data, content_type=content_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})
    except Exception as exc:
        print(f"[CivitaiManager] Image proxy failed: {exc}")
        return _placeholder_svg()


async def delete_asset_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        root_kind = _normalize_root_kind(body.get("root_kind"))
        rel_path = str(body.get("relative_path") or "")
        abs_path = _resolve_asset_path(root_kind, rel_path, body.get("storage_root_id"))
        if not os.path.isfile(abs_path):
            return web.json_response({"success": False, "error": "Asset not found"}, status=404)
        os.remove(abs_path)
        _delete_companions(abs_path, root_kind)
        _LIBRARY_INDEX.invalidate()
        return web.json_response({"success": True})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def move_asset_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        source_root_kind = _normalize_root_kind(body.get("root_kind"))
        source_storage_root_id = str(body.get("storage_root_id") or "")
        source_rel_path = str(body.get("relative_path") or "")
        target_root_kind = _normalize_root_kind(body.get("target_root_kind") or source_root_kind)
        _validate_root_transition(source_root_kind, target_root_kind)
        base_model_dir = _safe_segment(body.get("base_model_dir"), "Other")
        category_dir = _safe_segment(body.get("category_dir"), "Other")
        filename = _safe_filename(body.get("filename"), os.path.basename(source_rel_path), os.path.splitext(source_rel_path)[1] or ".safetensors")
        _validate_asset_filename(target_root_kind, filename)

        source_root = _storage_root_for_asset(source_root_kind, source_storage_root_id)
        src_path = _resolve_asset_path(source_root_kind, source_rel_path, source_storage_root_id)
        if not os.path.isfile(src_path):
            return web.json_response({"success": False, "error": "Source asset not found"}, status=404)
        target_root = source_root if target_root_kind == source_root_kind else _root_for_kind(target_root_kind)
        if target_root_kind == "workflows":
            dst_path = _safe_join(target_root, category_dir, filename)
        elif target_root_kind in STRUCTURED_ROOT_KINDS:
            dst_path = _safe_join(target_root, base_model_dir, category_dir, filename)
        else:
            # Component folders (VAE, text encoders, ...) keep files at their root.
            base_model_dir = ""
            category_dir = ""
            dst_path = _safe_join(target_root, filename)
        relative_path = os.path.relpath(dst_path, target_root).replace("\\", "/")
        _move_asset_bundle(src_path, dst_path, source_root_kind, target_root_kind)
        _update_moved_asset_metadata(
            dst_path,
            target_root_kind,
            relative_path,
            base_model_dir,
            category_dir,
            filename,
        )
        _LIBRARY_INDEX.invalidate()
        return web.json_response({
            "success": True,
            "relative_path": relative_path,
            "absolute_path": dst_path,
            "root_kind": target_root_kind,
            "storage_root_id": _storage_root_id(target_root),
        })
    except FileExistsError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=409)
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def favorite_asset_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        root_kind = _normalize_root_kind(body.get("root_kind"))
        rel_path = str(body.get("relative_path") or "")
        favorite = _config_bool(body.get("favorite"), "favorite", False)
        abs_path = _resolve_asset_path(root_kind, rel_path, body.get("storage_root_id"))
        if not os.path.isfile(abs_path):
            return web.json_response({"success": False, "error": "Asset not found"}, status=404)
        status, metadata = _metadata_for_asset(abs_path, root_kind)
        if status == "missing":
            metadata = {
                "source": "local",
                "name": os.path.splitext(os.path.basename(abs_path))[0],
                "resolution": {
                    "root_kind": root_kind,
                    "relative_path": rel_path,
                },
            }
        metadata["favorite"] = favorite
        metadata["favorite_updated_at"] = _now()
        _write_asset_metadata(abs_path, root_kind, metadata)
        model_id, version_id = _civitai_ids_from_metadata(metadata)
        resolution = metadata.get("resolution") if isinstance(metadata.get("resolution"), dict) else {}
        favorite_item = _normalize_favorite_item({
            "asset_kind": _favorite_asset_kind(root_kind),
            "source": "local",
            "model_id": model_id,
            "version_id": version_id,
            "name": metadata.get("name") or os.path.splitext(os.path.basename(abs_path))[0],
            "creator": metadata.get("creator") or "",
            "base_model": metadata.get("base_model") or resolution.get("base_model_dir") or "",
            "type": root_kind,
            "civitai_url": metadata.get("civitai_url") or "",
            "local": {
                "root_kind": root_kind,
                "storage_root_id": body.get("storage_root_id") or "",
                "relative_path": rel_path,
                "filename": os.path.basename(abs_path),
            },
        })
        _mutate_favorite_item(favorite_item, favorite)
        _LIBRARY_INDEX.invalidate()
        return web.json_response({"success": True, "favorite": favorite})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def open_folder_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        root_kind = _normalize_root_kind(body.get("root_kind"))
        rel_path = str(body.get("relative_path") or "")
        abs_path = _resolve_asset_path(root_kind, rel_path, body.get("storage_root_id"))
        if not os.path.exists(abs_path):
            return web.json_response({"success": False, "error": "Asset not found"}, status=404)
        folder = os.path.dirname(abs_path)
        if os.name == "nt":
            os.startfile(folder)  # type: ignore[attr-defined]
        elif sys_platform() == "darwin":
            subprocess.Popen(["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])
        return web.json_response({"success": True, "folder": folder})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


def sys_platform() -> str:
    return sys.platform


def _looks_like_zip(path: str) -> bool:
    """True for any ZIP container, including empty and spanned archives.

    Checking only the first local-file header (``PK\\x03\\x04``) misses archives
    that start with a different signature, so the extension name is ignored and
    the real container format decides.
    """
    try:
        if os.path.getsize(path) < 4:
            return False
        with open(path, "rb") as handle:
            if handle.read(4) in ZIP_MAGICS:
                return True
        return zipfile.is_zipfile(path)
    except OSError:
        return False


def _is_workflow_graph(data: Any) -> bool:
    """True for an editor graph or an API prompt, the two shapes ComfyUI loads."""
    if not isinstance(data, dict) or not data:
        return False
    if isinstance(data.get("nodes"), list):
        return True
    if isinstance(data.get("workflow"), dict) and isinstance(data["workflow"].get("nodes"), list):
        return True
    prompt = data.get("prompt") if isinstance(data.get("prompt"), dict) else data
    values = [value for value in prompt.values() if isinstance(value, dict)]
    return bool(values) and all(isinstance(value.get("class_type"), str) for value in values)


def _workflow_graph_from_zip(path: str) -> dict[str, Any] | None:
    """Picks the workflow JSON out of a Civitai ZIP bundle.

    Bundles contain the graph next to wildcards, readme files and previews. The
    graph is the entry that parses as a ComfyUI workflow; nested folders are
    searched and the shallowest candidate wins so a stray example file deeper
    in the archive cannot shadow the real one.
    """
    try:
        with zipfile.ZipFile(path) as archive:
            candidates = [
                info for info in archive.infolist()
                if not info.is_dir()
                and info.filename.lower().endswith(".json")
                and info.file_size <= WORKFLOW_CONTENT_MAX_BYTES
            ]
            # Shallower entries first: "flow.json" before "docs/example/flow.json".
            candidates.sort(key=lambda info: (info.filename.count("/"), len(info.filename)))
            for info in candidates:
                try:
                    data = json.loads(archive.read(info).decode("utf-8-sig"))
                except (ValueError, UnicodeDecodeError):
                    continue
                if _is_workflow_graph(data):
                    return data
    except (zipfile.BadZipFile, OSError):
        return None
    return None


def _workflow_json_from_file(path: str) -> dict[str, Any]:
    """Reads a workflow file, unwrapping a ZIP bundle served under a .json name.

    Raises ValueError with a message the panel can show, so a truncated or
    non-workflow file never surfaces as a raw json decode error.
    """
    if _looks_like_zip(path):
        graph = _workflow_graph_from_zip(path)
        if graph is None:
            raise ValueError("Workflow archive does not contain a workflow")
        return graph
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as handle:
            text = handle.read()
    except OSError as exc:
        raise ValueError(f"Workflow file could not be read: {exc}") from exc
    if not text.strip():
        raise ValueError("Workflow file is empty; download it again")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        # A workflow that is really an image or a truncated download is a broken
        # file, not a JSON syntax problem the user can fix by hand.
        raise ValueError(
            "This file is not a workflow (it may be a preview image or an interrupted download); download it again"
        ) from exc
    if not isinstance(data, dict):
        raise ValueError("Workflow file does not contain a workflow")
    return data


async def workflow_content_api(request: web.Request) -> web.Response:
    """Returns a saved workflow so the browser can load it into the canvas."""
    try:
        body = await request.json()
        root_kind = _normalize_root_kind(body.get("root_kind") or "workflows")
        if root_kind != "workflows":
            raise ValueError("Only workflow files can be opened in ComfyUI")
        rel_path = str(body.get("relative_path") or "")
        abs_path = _resolve_asset_path(root_kind, rel_path, body.get("storage_root_id"))
        if not os.path.isfile(abs_path):
            return web.json_response({"success": False, "error": "Workflow not found"}, status=404)
        if os.path.getsize(abs_path) > WORKFLOW_CONTENT_MAX_BYTES:
            return web.json_response({"success": False, "error": "Workflow file is too large to open"}, status=413)
        workflow = _workflow_json_from_file(abs_path)
        return web.json_response({
            "success": True,
            "filename": os.path.basename(abs_path),
            "workflow": workflow,
        })
    except json.JSONDecodeError as exc:
        return web.json_response({"success": False, "error": f"Invalid workflow JSON: {exc}"}, status=400)
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def enrich_metadata_api(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        root_kind = _normalize_root_kind(body.get("root_kind"))
        rel_path = str(body.get("relative_path") or "")
        abs_path = _resolve_asset_path(root_kind, rel_path, body.get("storage_root_id"))
        if not os.path.isfile(abs_path):
            return web.json_response({"success": False, "error": "Asset not found"}, status=404)
        async with _HASH_METADATA_REQUEST_LOCK:
            result = await asyncio.to_thread(_enrich_metadata_worker, abs_path, root_kind)
        _LIBRARY_INDEX.invalidate()
        return web.json_response({"success": True, **result})
    except ValueError as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


routes = PromptServer.instance.routes
register_routes(routes, API_PREFIX, globals())
