from __future__ import annotations

import asyncio
import gzip
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class _FakeRoutes:
    def get(self, _path):
        return lambda handler: handler

    def post(self, _path):
        return lambda handler: handler


class _FakeResponse:
    def __init__(self, body=None, status=200, **_kwargs):
        self.body = body
        self.status = status
        self.headers = {}


def _fake_json_response(payload, status=200, **_kwargs):
    return _FakeResponse(body=payload, status=status)


class _JsonRequest:
    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


class _QueryRequest:
    def __init__(self, query=None):
        self.query = query or {}


def _load_manager_api():
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.models_dir = str(PROJECT_ROOT / ".test-models")
    folder_paths.get_user_directory = lambda: str(PROJECT_ROOT / ".test-user")
    folder_paths.get_folder_paths = lambda _name: []

    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(
        instance=types.SimpleNamespace(routes=_FakeRoutes())
    )

    aiohttp = types.ModuleType("aiohttp")
    aiohttp.web = types.SimpleNamespace(
        Request=object,
        Response=_FakeResponse,
        StreamResponse=_FakeResponse,
        FileResponse=_FakeResponse,
        json_response=_fake_json_response,
    )

    sys.modules["folder_paths"] = folder_paths
    sys.modules["server"] = server
    sys.modules["aiohttp"] = aiohttp
    module_name = "civitai_manager_test_manager_api"
    sys.modules.pop(module_name, None)
    spec = importlib.util.spec_from_file_location(module_name, PROJECT_ROOT / "manager_api.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load manager_api.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


manager = _load_manager_api()


class RemoteImageVariantTests(unittest.TestCase):
    def test_civitai_original_url_becomes_optimized_thumbnail(self):
        source = (
            "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/"
            "04a43bd2-a6f2-493f-ba86-c677fe642f00/original=true/592643.jpeg?width=450"
        )
        self.assertEqual(
            manager._civitai_media_cache_url(source, 450),
            "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/"
            "04a43bd2-a6f2-493f-ba86-c677fe642f00/width=450,optimized=true/"
            "04a43bd2-a6f2-493f-ba86-c677fe642f00.jpeg",
        )

    def test_width_snaps_to_official_common_size(self):
        source = (
            "https://image-b2.civitai.com/file/civitai-media-cache/"
            "04a43bd2-a6f2-493f-ba86-c677fe642f00/original"
        )
        self.assertIn("/width=800,optimized=true/", manager._civitai_media_cache_url(source, 700))

    def test_non_civitai_and_video_urls_are_not_rewritten(self):
        external = "https://example.com/image.jpg"
        video = (
            "https://image.civitai.com/x/"
            "04a43bd2-a6f2-493f-ba86-c677fe642f00/original=true/preview.mp4"
        )
        self.assertEqual(manager._civitai_media_cache_url(external, 450), external)
        self.assertEqual(manager._civitai_media_cache_url(video, 450), video)


class ImageFeedTests(unittest.TestCase):
    def _image(self, **overrides):
        image = {
            "id": 900,
            "url": "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/04a43bd2-a6f2-493f-ba86-c677fe642f00/width=450/900.jpeg",
            "width": 832,
            "height": 1216,
            "username": "alice",
            "baseModel": "SDXL 1.0",
            "meta": {"prompt": "a cat", "resources": []},
            "stats": {"likeCount": 12, "heartCount": 4},
            "resources": [
                {"type": "checkpoint", "modelId": 10, "modelVersionId": 20, "modelName": "Base"},
                {"type": "lora", "modelId": 30, "modelVersionId": 40, "modelName": "Style", "weight": 0.7},
                {"type": "lora", "modelId": 30, "modelVersionId": 40, "modelName": "Style"},
            ],
        }
        image.update(overrides)
        return image

    def test_feed_card_keeps_only_downloadable_metadata(self):
        card = manager._image_feed_card(self._image())
        self.assertEqual(card["id"], 900)
        self.assertEqual(card["username"], "alice")
        self.assertEqual(card["prompt"], "a cat")
        self.assertEqual(card["stats"]["likeCount"], 12)
        # The duplicated LoRA resource is collapsed, the checkpoint is kept.
        self.assertEqual([item["kind"] for item in card["resources"]], ["checkpoint", "lora"])
        self.assertEqual(card["resources"][1]["weight"], 0.7)

    def test_feed_requests_the_generation_metadata_that_carries_weights(self):
        params = manager._images_query_params(
            "", "", "Most Reactions", 40, "AllTime", "", {"allow_nsfw": True},
        )
        self.assertEqual(params["withMeta"], "true")

    def test_weights_come_from_civitai_resources_when_the_free_form_list_is_empty(self):
        image = self._image(
            resources=[],
            meta={
                "prompt": "a cat",
                "resources": [],
                "civitaiResources": [
                    {"type": "checkpoint", "modelVersionId": 691639},
                    {"type": "lora", "weight": 0.3, "modelVersionId": 1527024, "modelVersionName": "Cinematic 1940s"},
                    {"type": "lora", "weight": 0.2, "modelVersionId": 1526912, "modelVersionName": "Cinematic Octane"},
                ],
            },
            modelVersionIds=[691639, 1527024, 1526912],
        )
        resources = manager._image_resources(image)
        self.assertEqual([item["kind"] for item in resources], ["checkpoint", "lora", "lora"])
        self.assertEqual([item["weight"] for item in resources], [None, 0.3, 0.2])
        self.assertEqual(resources[1]["version_name"], "Cinematic 1940s")

    def test_a_version_listed_twice_across_the_two_lists_is_kept_once(self):
        image = self._image(
            meta={
                "civitaiResources": [
                    {"type": "lora", "weight": 0.8, "modelVersionId": 40},
                ],
            },
        )
        resources = manager._image_resources(image)
        versions = [item["version_id"] for item in resources]
        self.assertEqual(versions.count("40"), 1)
        lora = next(item for item in resources if item["version_id"] == "40")
        self.assertEqual(lora["weight"], 0.8)

    def test_nested_meta_from_single_image_lookup_is_unwrapped(self):
        # `?imageId=` returns {"id": ..., "meta": {...}} while the feed is flat.
        nested = {
            "id": 900,
            "meta": {
                "prompt": "a cat",
                "civitaiResources": [
                    {"type": "checkpoint", "modelVersionId": 20, "modelVersionName": "Dev"},
                    {"type": "lora", "weight": 0.3, "modelVersionId": 1527024, "modelVersionName": "Cinematic 1940s"},
                    {"type": "lora", "weight": 0.2, "modelVersionId": 1526912, "modelVersionName": "Cinematic Octane"},
                ],
            },
        }
        card = manager._image_feed_card(self._image(meta=nested, resources=None))
        self.assertEqual(card["prompt"], "a cat")
        self.assertEqual([item["kind"] for item in card["resources"]], ["checkpoint", "lora", "lora"])
        self.assertIsNone(card["resources"][0]["weight"])
        self.assertEqual([item["weight"] for item in card["resources"][1:]], [0.3, 0.2])
        self.assertEqual(card["resources"][1]["version_name"], "Cinematic 1940s")

    def test_prompt_tags_supply_missing_loras_and_weights(self):
        # A1111 images keep the whole stack in the prompt; civitaiResources may
        # list only some of them, or none at all.
        image = self._image(
            resources=None,
            meta={
                "prompt": "a cat <lora:Cinematic 1940s:0.35> and <lora:add_detail:0.8> <lora:Extra:1.2>",
                "civitaiResources": [
                    {"type": "checkpoint", "modelVersionId": 20, "modelVersionName": "Dev"},
                    {"type": "lora", "modelVersionId": 1527024, "modelVersionName": "Cinematic 1940s"},
                ],
            },
        )
        card = manager._image_feed_card(image)
        loras = [(item["name"] or item["version_name"], item["weight"]) for item in card["resources"] if item["kind"] == "lora"]
        self.assertEqual(loras[0], ("Cinematic 1940s", 0.35))
        self.assertIn(("add_detail", 0.8), loras)
        self.assertIn(("Extra", 1.2), loras)
        self.assertEqual(len([item for item in card["resources"] if item["kind"] == "lora"]), 3)
        self.assertTrue(any(item.get("from_prompt") for item in card["resources"]))

    def test_prompt_tags_do_not_override_civitai_weight(self):
        image = self._image(
            resources=None,
            meta={
                "prompt": "<lora:Style:0.1>",
                "civitaiResources": [{"type": "lora", "weight": 0.7, "modelVersionId": 40, "modelVersionName": "Style"}],
            },
        )
        card = manager._image_feed_card(image)
        self.assertEqual(len(card["resources"]), 1)
        self.assertEqual(card["resources"][0]["weight"], 0.7)

    def test_prompt_only_lora_is_looked_up_by_name(self):
        model = {
            "id": 500,
            "name": "Krea 2 Flat Illustration/Anime Style",
            "type": "LORA",
            "modelVersions": [
                {"id": 700, "name": "v2.0", "baseModel": "Krea 2", "files": [{"id": 1, "name": "flat_v2.safetensors"}]},
                {"id": 800, "name": "v1.0", "baseModel": "Krea 2", "files": [{"id": 2, "name": "flat_v1.safetensors"}]},
            ],
        }
        with mock.patch.object(manager, "_read_json_url_with_retries", return_value={"items": [model]}) as fetch:
            entry = manager._resolve_image_resources(
                [{"kind": "lora", "name": "Flat_anime_Krea_@", "weight": 0.5, "version_id": "", "model_id": ""}],
                {"civitai_api_key": ""},
            )[0]
        self.assertEqual(entry["error"], "")
        self.assertEqual(entry["weight"], 0.5)
        self.assertEqual(entry["model_id"], "500")
        self.assertTrue(entry["version_id"])
        self.assertIn("/models?", fetch.call_args[0][0])

    def test_prompt_only_lora_keeps_the_matching_version(self):
        model = {
            "id": 600,
            "name": "BArtstyle | Blue Archive Art Style",
            "type": "LORA",
            "modelVersions": [
                {"id": 901, "name": "Krea2-V2", "files": [{"id": 1, "name": "krea2_v2.safetensors"}]},
                {"id": 902, "name": "REv3-LoRA-CounterFeitV3", "files": [{"id": 2, "name": "rev3.safetensors"}]},
            ],
        }
        with mock.patch.object(manager, "_read_json_url_with_retries", return_value={"items": [model]}):
            payload = manager._lookup_prompt_lora("BArtstyle-KREA2-V2-1024", {"allow_nsfw": False}, None)
        self.assertEqual(payload["id"], 901)
        self.assertEqual(payload["model"]["id"], 600)

    def test_prompt_lora_lookup_rejects_unrelated_names(self):
        model = {"id": 1, "name": "Something Else Entirely", "type": "LORA", "modelVersions": [{"id": 2, "name": "v1.0"}]}
        with mock.patch.object(manager, "_read_json_url_with_retries", return_value={"items": [model]}):
            self.assertIsNone(manager._lookup_prompt_lora("unrelated zzz", {"allow_nsfw": False}, None))

    def test_model_version_ids_are_merged_even_when_resources_exist(self):
        # Civitai sometimes lists only the checkpoint in `resources` while the
        # picture actually used seven versions.
        image = self._image(
            resources=[{"type": "checkpoint", "modelId": 10, "modelVersionId": 20, "modelName": "Base"}],
            modelVersionIds=[20, 30, 31, 32, 33, 34, 35],
            meta={"prompt": "a cat", "resources": []},
        )
        card = manager._image_feed_card(image)
        self.assertEqual(len(card["resources"]), 7)
        self.assertEqual({item["version_id"] for item in card["resources"]}, {"20", "30", "31", "32", "33", "34", "35"})

    def test_merge_folds_prompt_weights_into_version_rows(self):
        resolved = [
            {"version_id": "1", "name": "Base", "kind": "checkpoint", "weight": None},
            {"version_id": "2", "name": "Purple Graphics || Poster lora", "version_name": "v1.0 Krea 2", "kind": "lora", "weight": None},
            {"version_id": "3", "name": "Purple Grainy || Photography lora", "version_name": "v2.0 Krea 2", "kind": "lora", "weight": None},
            {"version_id": "", "name": "Purple_Graphics_KR2", "kind": "lora", "weight": 1.0, "from_prompt": True},
            {"version_id": "", "name": "Purple_Grainy_KR2_V2_D", "kind": "lora", "weight": 0.65, "from_prompt": True},
            {"version_id": "", "name": "Unrelated-Thing-XYZ", "kind": "lora", "weight": 0.4, "from_prompt": True},
        ]
        merged = manager._merge_resolved_resources(resolved)
        self.assertEqual(len(merged), 3)
        self.assertEqual([row["weight"] for row in merged], [None, 1.0, 0.65])

    def test_merge_keeps_prompt_rows_when_no_ids_exist(self):
        resolved = [
            {"version_id": "", "name": "Some_LoRA", "kind": "lora", "weight": 0.4, "from_prompt": True},
        ]
        merged = manager._merge_resolved_resources(resolved)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["weight"], 0.4)

    def test_resource_kinds_map_to_asset_kinds(self):
        self.assertEqual(manager._image_resource_kind("Checkpoint"), "checkpoint")
        self.assertEqual(manager._image_resource_kind("LoCon"), "lora")
        self.assertEqual(manager._image_resource_kind("DoRA"), "lora")
        self.assertEqual(manager._image_resource_kind("Workflows"), "workflow")
        self.assertEqual(manager._image_resource_kind("Embedding"), "embed")
        self.assertEqual(manager._image_resource_kind("Mystery"), "")

    def test_image_id_parses_links_and_bare_ids(self):
        self.assertEqual(manager._parse_image_id("12345"), "12345")
        self.assertEqual(manager._parse_image_id("https://civitai.com/images/777"), "777")
        self.assertEqual(manager._parse_image_id("https://civitai.red/images/888?foo=1"), "888")
        self.assertEqual(manager._parse_image_id("https://civitai.com/models/5"), "")

    def test_image_query_params_respect_content_setting(self):
        params = manager._images_query_params(
            "cat", "", "Newest", 40, "AllTime", "SDXL 1.0", {"allow_nsfw": False},
        )
        self.assertEqual(params["query"], "cat")
        self.assertEqual(params["nsfw"], "false")
        self.assertEqual(params["baseModels"], "SDXL 1.0")
        self.assertNotIn("cursor", params)

    def test_image_query_params_keep_multiple_base_models_in_one_value(self):
        params = manager._images_query_params(
            "", "", "Newest", 40, "AllTime", "SDXL 1.0,Pony", {"allow_nsfw": False},
        )
        self.assertEqual(params["baseModels"], "SDXL 1.0,Pony")

    def test_resource_resolution_reads_the_pinned_version(self):
        version = {
            "id": 40,
            "modelId": 30,
            "name": "old",
            "baseModel": "SDXL 1.0",
            "trainedWords": ["style"],
            "files": [{"id": 7, "name": "old.safetensors", "sizeKB": 100}],
            "model": {"name": "Style LoRA", "type": "LORA"},
        }
        with mock.patch.object(manager, "_read_json_url_with_retries", return_value=version) as fetch:
            entries = manager._resolve_image_resources(
                [{"type": "lora", "kind": "lora", "model_id": "30", "version_id": "40", "name": "Style"}],
                {"civitai_api_key": ""},
            )
        self.assertEqual(entries[0]["error"], "")
        self.assertEqual(fetch.call_args[0][0], "https://civitai.red/api/v1/model-versions/40")
        self.assertEqual(entries[0]["model"]["name"], "Style LoRA")
        self.assertEqual(entries[0]["model"]["modelVersions"][0]["id"], 40)
        self.assertEqual(entries[0]["model"]["modelVersions"][0]["files"][0]["name"], "old.safetensors")

    def test_bare_version_ids_resolve_into_a_kind_and_card(self):
        version = {
            "id": 40,
            "modelId": 30,
            "name": "v1.0",
            "baseModel": "SDXL 1.0",
            "files": [{"id": 7, "name": "lora.safetensors", "sizeKB": 100}],
            "model": {"name": "Style LoRA", "type": "LORA"},
        }
        # The feed only ships `modelVersionIds`, so the kind stays empty until the
        # version payload names it.
        with mock.patch.object(manager, "_read_json_url_with_retries", return_value=version):
            entries = manager._resolve_image_resources(
                [{"kind": "", "model_id": "", "version_id": "40"}],
                {},
            )
        self.assertEqual(entries[0]["error"], "")
        self.assertEqual(entries[0]["kind"], "lora")
        self.assertTrue(entries[0]["supported"])
        self.assertEqual(entries[0]["model"]["modelVersions"][0]["files"][0]["name"], "lora.safetensors")

    def test_feed_cards_fall_back_to_model_version_ids(self):
        card = manager._image_feed_card({"id": 9, "url": "u", "modelVersionIds": [40, 41]})
        self.assertEqual([item["version_id"] for item in card["resources"]], ["40", "41"])
        self.assertEqual([item["kind"] for item in card["resources"]], ["", ""])

    def test_image_detail_tries_both_browsing_levels(self):
        calls = []

        def fake(url, **_kwargs):
            calls.append(url)
            if "nsfw=true" in url:
                return {"items": []}
            return {"items": [{"id": 55, "url": "u", "modelVersionIds": [7]}]}

        with mock.patch.object(manager, "_read_json_url_with_retries", side_effect=fake):
            detail = manager._image_detail("55", {"allow_nsfw": True})
        self.assertEqual(detail["image"]["id"], 55)
        self.assertEqual(len(calls), 2)

    def test_image_detail_only_asks_publicly_when_nsfw_is_off(self):
        with mock.patch.object(manager, "_read_json_url_with_retries", return_value={"items": []}) as fetch:
            detail = manager._image_detail("55", {})
        self.assertEqual(detail["error"], "Image not found")
        self.assertEqual(fetch.call_count, 1)
        self.assertNotIn("nsfw", fetch.call_args[0][0])

    def test_unsupported_resources_are_reported_not_fetched(self):
        with mock.patch.object(manager, "_read_json_url_with_retries") as fetch:
            entries = manager._resolve_image_resources(
                [{"type": "embed", "kind": "embed", "model_id": "1", "version_id": "2"}],
                {},
            )
        fetch.assert_not_called()
        self.assertEqual(entries[0]["error"], "unsupported")


class ImagesApiTests(unittest.TestCase):
    def setUp(self):
        manager._IMAGE_FEED_CACHE.clear()

    def tearDown(self):
        manager._IMAGE_FEED_CACHE.clear()

    def test_images_api_returns_cards_and_caches_the_page(self):
        request = _QueryRequest({"query": "cat", "sort": "Newest", "limit": "20"})
        payload = {
            "items": [{"id": 1, "url": "https://image.civitai.com/x/y.jpeg", "resources": []}],
            "metadata": {"nextCursor": "abc"},
        }
        with (
            mock.patch.object(manager, "load_config", return_value={"allow_nsfw": False}),
            mock.patch.object(manager, "_read_json_url_with_retries", return_value=payload) as fetch,
        ):
            first = asyncio.run(manager.images_api(request))
            second = asyncio.run(manager.images_api(request))

        self.assertEqual(len(first.body["items"]), 1)
        self.assertEqual(first.body["metadata"]["nextCursor"], "abc")
        self.assertTrue(first.body["content_filter_active"])
        self.assertEqual(second.body, first.body)
        self.assertEqual(fetch.call_count, 1)

    def test_images_api_reports_upstream_errors_without_caching(self):
        request = _QueryRequest({"query": "cat"})
        with (
            mock.patch.object(manager, "load_config", return_value={"allow_nsfw": True}),
            mock.patch.object(manager, "_read_json_url_with_retries", return_value={"error": "boom"}),
        ):
            response = asyncio.run(manager.images_api(request))
        self.assertEqual(response.body["items"], [])
        self.assertEqual(response.body["error"], "boom")
        self.assertEqual(manager._IMAGE_FEED_CACHE, {})

    def test_image_detail_api_rejects_a_missing_id(self):
        response = asyncio.run(manager.image_detail_api(_QueryRequest({"id": "not-a-link"})))
        self.assertEqual(response.status, 400)
        self.assertFalse(response.body["success"])

    def test_image_detail_api_resolves_a_link(self):
        payload = {"items": [{"id": 55, "url": "https://image.civitai.com/x/y.jpeg", "meta": {"prompt": "hi"}}]}
        with (
            mock.patch.object(manager, "load_config", return_value={"allow_nsfw": True}),
            mock.patch.object(manager, "_read_json_url_with_retries", return_value=payload),
        ):
            response = asyncio.run(manager.image_detail_api(_QueryRequest({"id": "https://civitai.com/images/55"})))
        self.assertTrue(response.body["success"])
        self.assertEqual(response.body["image"]["id"], 55)
        self.assertEqual(response.body["image"]["prompt"], "hi")

    def test_image_resolve_api_requires_an_object_payload(self):
        class _BadRequest:
            async def json(self):
                return []

        response = asyncio.run(manager.image_resolve_api(_BadRequest()))
        self.assertEqual(response.status, 400)

    def test_image_resolve_api_passes_selected_versions_through(self):
        class _Request:
            async def json(self):
                return {
                    "resources": [{"type": "lora", "kind": "lora", "model_id": "1", "version_id": "2"}],
                    "selected_versions": {"2": "3"},
                }

        with (
            mock.patch.object(manager, "load_config", return_value={}),
            mock.patch.object(manager, "_resolve_image_resources", return_value=[]) as resolve,
        ):
            response = asyncio.run(manager.image_resolve_api(_Request()))
        self.assertTrue(response.body["success"])
        self.assertEqual(resolve.call_args.args[2], {"2": "3"})


class KeepAliveFetchTests(unittest.TestCase):
    def setUp(self):
        self.ports = []
        self.drop_after_first = False
        test = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                test.ports.append(self.client_address[1])
                body = gzip.compress(json.dumps({"path": self.path}).encode("utf-8"))
                self.send_response(200)
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                # Simulate a server that silently drops idle keep-alive connections.
                self.close_connection = test.drop_after_first

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_reuses_connection_and_decodes_gzip(self):
        first = manager._fetch(f"{self.base}/a?x=1", {}, 5)
        second = manager._fetch(f"{self.base}/b", {}, 5)

        self.assertEqual(json.loads(first[2]), {"path": "/a?x=1"})
        self.assertEqual(json.loads(second[2]), {"path": "/b"})
        self.assertEqual(len(set(self.ports)), 1)

    def test_retries_once_when_kept_connection_was_dropped(self):
        self.drop_after_first = True
        manager._fetch(f"{self.base}/a", {}, 5)
        status, _reason, body = manager._fetch(f"{self.base}/b", {}, 5)

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"path": "/b"})
        self.assertEqual(len(set(self.ports)), 2)


class SearchCardTests(unittest.TestCase):
    def test_search_card_keeps_card_fields_and_drops_heavy_ones(self):
        image = {"url": "https://image.civitai.com/x/a.jpeg", "type": "image", "hash": "h", "meta": {"prompt": "p"}}
        model = {
            "id": 1,
            "name": "Model",
            "type": "LORA",
            "description": "<p>long</p>",
            "creator": {"username": "me", "image": "avatar"},
            "modelVersions": [
                {"id": 10, "baseModel": "SDXL 1.0", "description": "v", "images": [image] * 20, "files": [{"name": "a.safetensors", "sizeKB": 1, "pickleScanMessage": "ok"}]},
                {"id": 11, "baseModel": "Pony", "images": [image] * 5, "files": []},
            ],
        }

        card = manager._search_card(model)

        self.assertNotIn("description", card)
        self.assertEqual(card["creator"], {"username": "me"})
        self.assertEqual(len(card["modelVersions"][0]["images"]), manager.SEARCH_PRIMARY_IMAGE_LIMIT)
        self.assertEqual(len(card["modelVersions"][1]["images"]), 1)
        self.assertEqual(card["modelVersions"][0]["images"][0], {"url": image["url"], "type": "image"})
        self.assertEqual(card["modelVersions"][0]["files"], [{"name": "a.safetensors", "sizeKB": 1}])
        self.assertNotIn("description", card["modelVersions"][0])


class ModelDetailCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        manager._MODEL_DETAIL_CACHE.clear()

    def tearDown(self):
        manager._MODEL_DETAIL_CACHE.clear()

    async def test_repeated_detail_requests_hit_the_cache(self):
        with (
            mock.patch.object(manager, "load_config", return_value={"civitai_api_key": ""}),
            mock.patch.object(manager, "_read_json_url", return_value={"id": 5, "name": "Model"}) as read,
        ):
            first = await manager.model_detail_api(_QueryRequest({"id": "5"}))
            second = await manager.model_detail_api(_QueryRequest({"id": "5"}))

        self.assertEqual(first.body["model"]["name"], "Model")
        self.assertEqual(second.body, first.body)
        self.assertEqual(read.call_count, 1)


class SearchResultCacheTests(unittest.TestCase):
    def setUp(self):
        manager._SEARCH_RESULT_CACHE.clear()

    def tearDown(self):
        manager._SEARCH_RESULT_CACHE.clear()

    def test_identical_search_uses_short_lived_backend_cache(self):
        request = _QueryRequest({
            "kind": "lora",
            "query": "speed",
            "sort": "Newest",
            "limit": "20",
        })
        result = {"items": [{"id": 1}], "metadata": {}}
        with (
            mock.patch.object(manager, "load_config", return_value={"allow_nsfw": True}),
            mock.patch.object(manager, "_search_civitai_models", return_value=result) as search,
        ):
            first = asyncio.run(manager.search_api(request))
            second = asyncio.run(manager.search_api(request))

        self.assertEqual(first.body, result)
        self.assertEqual(second.body, result)
        self.assertEqual(search.call_count, 1)


class PathAndConfigTests(unittest.TestCase):
    def test_safe_join_rejects_parent_escape(self):
        with tempfile.TemporaryDirectory() as root:
            inside = manager._safe_join(root, "base", "model.safetensors")
            self.assertEqual(
                inside,
                os.path.abspath(os.path.join(root, "base", "model.safetensors")),
            )
            with self.assertRaises(ValueError):
                manager._safe_join(root, "..", "outside.safetensors")

    def test_public_config_never_returns_api_key(self):
        config = {
            "civitai_api_key": "secret",
            "allow_nsfw": False,
            "workflow_dir": "workflows",
            "save_metadata": True,
            "save_preview": True,
        }
        with mock.patch.object(manager, "_root_display", return_value={}):
            public = manager._public_config(config)
        self.assertEqual(public["civitai_api_key"], "")
        self.assertTrue(public["api_key_set"])

    def test_reserved_windows_segment_is_prefixed(self):
        self.assertEqual(manager._safe_segment("CON"), "_CON")
        self.assertEqual(manager._safe_filename("NUL.safetensors", "model"), "_NUL.safetensors")

    def test_move_validation_allows_model_folders_but_keeps_workflows_separate(self):
        manager._validate_root_transition("vae", "vae")
        manager._validate_root_transition("checkpoints", "unet")
        manager._validate_root_transition("vae", "text_encoders")
        manager._validate_root_transition("loras", "vae")
        with self.assertRaisesRegex(ValueError, "Cannot move"):
            manager._validate_root_transition("loras", "workflows")
        with self.assertRaisesRegex(ValueError, "Cannot move"):
            manager._validate_root_transition("workflows", "loras")

    def test_config_normalizes_boolean_strings_and_absolute_workflow_path(self):
        normalized = manager._normalize_config({
            "allow_nsfw": "false",
            "save_metadata": "yes",
            "save_preview": 0,
            "workflow_dir": ".",
        })
        self.assertFalse(normalized["allow_nsfw"])
        self.assertTrue(normalized["save_metadata"])
        self.assertFalse(normalized["save_preview"])
        self.assertTrue(os.path.isabs(normalized["workflow_dir"]))

    def test_config_rejects_file_as_workflow_directory(self):
        with tempfile.TemporaryDirectory() as root:
            file_path = Path(root) / "workflow.json"
            file_path.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must be a directory"):
                manager._normalize_config({"workflow_dir": str(file_path)})

    def test_asset_path_rejects_escape_and_companion_metadata(self):
        with tempfile.TemporaryDirectory() as root, mock.patch.object(
            manager,
            "_root_for_kind",
            return_value=root,
        ):
            with self.assertRaisesRegex(ValueError, "escapes allowed root"):
                manager._resolve_asset_path("loras", "../outside.safetensors")
            with self.assertRaisesRegex(ValueError, "file extension"):
                manager._resolve_asset_path("loras", "model.json")
            with self.assertRaisesRegex(ValueError, "Companion metadata"):
                manager._resolve_asset_path("workflows", "flow.civitai.json")

    def test_asset_path_resolves_configured_secondary_root(self):
        with tempfile.TemporaryDirectory() as base:
            primary = Path(base) / "primary"
            secondary = Path(base) / "secondary"
            primary.mkdir()
            secondary.mkdir()
            asset = secondary / "model.safetensors"
            asset.write_bytes(b"model")
            secondary_id = manager._storage_root_id(str(secondary))
            with (
                mock.patch.object(manager, "_root_for_kind", return_value=str(primary)),
                mock.patch.object(manager, "_roots_for_kind", return_value=[str(primary), str(secondary)]),
            ):
                resolved = manager._resolve_asset_path("loras", "model.safetensors", secondary_id)
                with self.assertRaisesRegex(ValueError, "Unknown model storage root"):
                    manager._resolve_asset_path("loras", "model.safetensors", "missing")

        self.assertEqual(resolved, str(asset))

    def test_download_path_allows_any_model_folder_and_override_extension(self):
        model = {"name": "Example", "type": "LORA"}
        version = {"name": "v1", "baseModel": "SDXL 1.0"}
        file_info = {"name": "example.safetensors"}
        with tempfile.TemporaryDirectory() as root, mock.patch.object(
            manager,
            "_root_for_kind",
            return_value=root,
        ):
            resolution = manager.resolve_download_path(
                model,
                version,
                file_info,
                "lora",
                {"root_kind": "text_encoders"},
            )
            self.assertEqual(resolution["root_kind"], "text_encoders")
            self.assertEqual(resolution["relative_path"], "example.safetensors")
            with self.assertRaisesRegex(ValueError, "file extension"):
                manager.resolve_download_path(
                    model,
                    version,
                    file_info,
                    "lora",
                    {"filename": "example.json"},
                )

    def test_text_encoder_and_vae_files_default_to_component_folders(self):
        model = {"name": "Qwen Image", "type": "Checkpoint"}
        version = {"name": "v1", "baseModel": "Qwen"}
        with mock.patch.object(manager, "_root_for_kind", return_value="C:/models"):
            text_encoder = manager.resolve_download_path(
                model,
                version,
                {"name": "qwen_txt_bf16.safetensors", "type": "Text Encoder"},
            )
            vae = manager.resolve_download_path(
                model,
                version,
                {"name": "qwen_vae_bf16.safetensors", "type": "VAE"},
            )
        self.assertEqual(text_encoder["root_kind"], "text_encoders")
        self.assertEqual(text_encoder["relative_path"], "qwen_txt_bf16.safetensors")
        self.assertEqual(vae["root_kind"], "vae")
        self.assertEqual(vae["relative_path"], "qwen_vae_bf16.safetensors")

    def test_workflow_download_normalizes_automatic_filename_to_json(self):
        with tempfile.TemporaryDirectory() as root, mock.patch.object(
            manager,
            "_root_for_kind",
            return_value=root,
        ):
            resolution = manager.resolve_download_path(
                {"name": "Flow", "type": "Workflows"},
                {"name": "v1"},
                {"name": "flow.safetensors"},
                "workflow",
            )
        self.assertEqual(resolution["filename"], "flow.json")
        self.assertEqual(resolution["root_kind"], "workflows")


class SearchFallbackTests(unittest.TestCase):
    def test_search_response_reports_when_content_filter_is_active(self):
        result = {"items": [{"id": 1, "name": "Example"}], "metadata": {}}
        config = manager._default_config()
        with (
            mock.patch.object(manager, "_read_models_json", return_value=result),
            mock.patch.object(manager, "_merge_taxonomy_cache"),
            mock.patch.object(manager, "_taxonomy_cache_get", return_value={}),
        ):
            response = manager._search_civitai_models(
                "lora", "Example", "", "Highest Rated", 40, "", "", "", config,
            )

        self.assertTrue(response["content_filter_active"])

    def test_every_site_sort_and_period_reaches_the_api(self):
        with (
            mock.patch.object(manager, "_read_models_json", return_value={"items": [], "metadata": {}}) as read_models,
            mock.patch.object(manager, "_merge_taxonomy_cache"),
            mock.patch.object(manager, "_taxonomy_cache_get", return_value={}),
        ):
            manager._search_civitai_models(
                "lora", "", "", "Most Collected", 40, "", "", "", manager._default_config(), "Month",
            )

        params = read_models.call_args.args[0]
        self.assertEqual(params["sort"], "Most Collected")
        self.assertEqual(params["period"], "Month")

    def test_unknown_sort_and_period_fall_back_instead_of_400(self):
        self.assertEqual(manager._normalize_model_sort("Most Liked"), "Most Liked")
        self.assertEqual(manager._normalize_model_sort("made up"), "Highest Rated")
        self.assertEqual(manager._normalize_model_period("year"), "Year")
        self.assertEqual(manager._normalize_model_period("decade"), "AllTime")

    def test_file_format_filter_keeps_paging_until_it_finds_a_match(self):
        pickled = {
            "items": [{"id": 1, "name": "Old", "modelVersions": [{"files": [{"metadata": {"format": "PickleTensor"}}]}]}],
            "metadata": {"nextCursor": "9|8"},
        }
        safe = {
            "items": [{"id": 2, "name": "Safe", "modelVersions": [{"files": [{"metadata": {"format": "SafeTensor"}}]}]}],
            "metadata": {},
        }
        with (
            mock.patch.object(manager, "_read_models_json", side_effect=[pickled, safe]) as read_models,
            mock.patch.object(manager, "_merge_taxonomy_cache"),
            mock.patch.object(manager, "_taxonomy_cache_get", return_value={}),
        ):
            response = manager._search_civitai_models(
                "lora", "", "", "Newest", 40, "", "", "", manager._default_config(), "AllTime", "SafeTensor",
            )

        self.assertEqual([item["id"] for item in response["items"]], [2])
        self.assertEqual(read_models.call_count, 2)
        self.assertEqual(read_models.call_args.args[0]["cursor"], "9|8")

    def test_model_status_filter_understands_paid_and_free(self):
        early = {"id": 1, "name": "Early", "availability": "EarlyAccess", "modelVersions": []}
        paid = {"id": 2, "name": "Paid", "hasActivePaidAccess": True, "modelVersions": []}
        plain = {"id": 3, "name": "Plain", "modelVersions": []}

        def run(status):
            with (
                mock.patch.object(manager, "_read_models_json", return_value={"items": [early, paid, plain], "metadata": {}}),
                mock.patch.object(manager, "_merge_taxonomy_cache"),
                mock.patch.object(manager, "_taxonomy_cache_get", return_value={}),
            ):
                return manager._search_civitai_models(
                    "lora", "", "", "Newest", 40, "", "", "", manager._default_config(), "AllTime", "", status,
                )

        self.assertEqual([item["id"] for item in run("paid")["items"]], [2])
        self.assertEqual([item["id"] for item in run("free")["items"]], [3])
        # Several statuses widen the page instead of narrowing it.
        self.assertEqual([item["id"] for item in run("paid,free")["items"]], [2, 3])

    def test_multiple_values_inside_a_filter_are_or_ed(self):
        self.assertEqual(manager._normalize_model_file_formats("SafeTensor, GGUF"), ["SafeTensor", "GGUF"])
        self.assertEqual(manager._normalize_model_file_formats(["gguf", "nonsense"]), ["GGUF"])
        self.assertEqual(manager._normalize_model_statuses("paid,free"), ["paid", "free"])

        safe = {"modelVersions": [{"files": [{"metadata": {"format": "SafeTensor"}}]}]}
        gguf = {"modelVersions": [{"files": [{"metadata": {"format": "GGUF"}}]}]}
        pickled = {"modelVersions": [{"files": [{"metadata": {"format": "PickleTensor"}}]}]}
        self.assertTrue(manager._model_matches_local_filters(safe, ["SafeTensor", "GGUF"], []))
        self.assertTrue(manager._model_matches_local_filters(gguf, ["SafeTensor", "GGUF"], []))
        self.assertFalse(manager._model_matches_local_filters(pickled, ["SafeTensor", "GGUF"], []))
        # Different filters still narrow each other.
        self.assertFalse(manager._model_matches_local_filters(safe, ["SafeTensor"], ["paid"]))

    def test_multiple_base_models_are_sent_as_repeated_params(self):
        params = manager._build_model_query_params(
            "lora", "", "", "Newest", 40, manager._default_config(), "", "", "SDXL 1.0,Pony",
        )
        self.assertEqual(params["baseModels"], ["SDXL 1.0", "Pony"])
        # doseq keeps both keys; Civitai ignores a comma separated model list.
        self.assertIn("baseModels=SDXL+1.0&baseModels=Pony", manager._models_url(params))

    def test_several_base_models_keep_every_model_on_the_page(self):
        items = [
            {"id": 1, "name": "A", "modelVersions": [{"baseModel": "SDXL 1.0"}]},
            {"id": 2, "name": "B", "modelVersions": [{"baseModel": "Pony"}]},
            {"id": 3, "name": "C", "modelVersions": [{"baseModel": "Illustrious"}]},
        ]
        with (
            mock.patch.object(manager, "_read_models_json", return_value={"items": items, "metadata": {}}) as read_models,
            mock.patch.object(manager, "_merge_taxonomy_cache"),
            mock.patch.object(manager, "_taxonomy_cache_get", return_value={}),
        ):
            response = manager._search_civitai_models(
                "lora", "", "", "Newest", 40, "", "SDXL 1.0,Pony", "", manager._default_config(),
            )

        self.assertEqual([item["id"] for item in response["items"]], [1, 2])
        self.assertEqual(read_models.call_args.args[0]["baseModels"], ["SDXL 1.0", "Pony"])

    def search(self, query, cursor, pages):
        with (
            mock.patch.object(manager, "_read_models_json", side_effect=pages) as read_models,
            mock.patch.object(manager, "_merge_taxonomy_cache"),
            mock.patch.object(manager, "_taxonomy_cache_get", return_value={}),
        ):
            response = manager._search_civitai_models(
                "lora", query, cursor, "Highest Rated", 40, "", "", "", manager._default_config(),
            )
        return response, [call.args[0] for call in read_models.call_args_list]

    def test_query_retried_as_unknown_tag_does_not_return_the_unfiltered_listing(self):
        unfiltered = {"items": [{"id": 1, "name": "Detail Tweaker", "tags": ["concept"]}], "metadata": {"nextCursor": "1|2"}}
        response, requests = self.search("zzqxv", "", [{"items": [], "metadata": {}}, unfiltered])

        self.assertEqual(requests[1]["tag"], "zzqxv")
        self.assertEqual(response["items"], [])
        self.assertNotIn("nextCursor", response["metadata"])

    def test_tag_retry_pages_continue_the_tag_search(self):
        tagged = {"items": [{"id": 3, "name": "Brush", "tags": ["watercolor"]}], "metadata": {"nextCursor": "9|8"}}
        first, _ = self.search("watercolor", "", [{"items": [], "metadata": {}}, tagged])
        cursor = first["metadata"]["nextCursor"]
        second, requests = self.search("watercolor", cursor, [tagged])

        self.assertEqual([item["id"] for item in first["items"]], [3])
        self.assertEqual(cursor, f"{manager.SEARCH_ATTEMPT_CURSOR_PREFIX}1:9|8")
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]["tag"], "watercolor")
        self.assertNotIn("query", requests[0])
        self.assertEqual(requests[0]["cursor"], "9|8")
        self.assertEqual(second["metadata"]["nextCursor"], cursor)

    def test_fallback_filters_items_and_prefixes_next_cursor(self):
        result = {
            "items": [
                {"id": 1, "name": "Landscape", "baseModels": ["SDXL 1.0"], "tags": ["style"]},
                {"id": 2, "name": "Portrait Hero", "baseModels": ["SDXL 1.0"], "tags": ["character"]},
            ],
            "metadata": {"nextCursor": "200"},
        }
        with (
            mock.patch.object(manager, "_read_models_json", return_value=result) as read_models,
            mock.patch.object(manager, "_merge_taxonomy_cache"),
        ):
            items, metadata = manager._search_base_model_text_fallback(
                kind="lora",
                query="Portrait",
                tag="character",
                category="",
                base_model="SDXL 1.0",
                sort="Highest Rated",
                limit=1,
                cursor="",
                config=manager._default_config(),
                api_key=None,
            )

        self.assertEqual([item["id"] for item in items], [2])
        self.assertEqual(metadata["nextCursor"], f"{manager.SEARCH_FALLBACK_CURSOR_PREFIX}200")
        self.assertEqual(read_models.call_args.args[0]["baseModels"], ["SDXL 1.0"])


class LibraryScanTests(unittest.TestCase):
    def test_scan_reads_metadata_preview_and_ignores_non_assets(self):
        with tempfile.TemporaryDirectory() as root:
            asset_dir = Path(root) / "SDXL 1.0" / "Character"
            asset_dir.mkdir(parents=True)
            asset = asset_dir / "hero.safetensors"
            asset.write_bytes(b"model")
            asset.with_suffix(".json").write_text(json.dumps({
                "name": "Hero LoRA",
                "base_model": "SDXL 1.0",
                "category": "Character",
                "hashes": {"SHA256": "ABC"},
                "source": "civitai",
                "metadata_match_status": "matched",
                "version": {"id": 22, "modelId": 11},
            }), encoding="utf-8")
            asset.with_suffix(".png").write_bytes(b"preview")
            (asset_dir / "notes.txt").write_text("ignored", encoding="utf-8")

            with mock.patch.object(manager, "_root_for_kind", return_value=root):
                items = manager._scan_library_kind("loras")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Hero LoRA")
        self.assertEqual(items[0]["metadata_status"], "cached")
        self.assertTrue(items[0]["has_preview"])
        self.assertEqual(items[0]["hash"], "ABC")
        self.assertEqual(items[0]["model_id"], 11)
        self.assertEqual(items[0]["version_id"], 22)
        self.assertEqual(items[0]["civitai_url"], "https://civitai.red/models/11?modelVersionId=22")

    def test_workflow_scan_skips_companion_json(self):
        with tempfile.TemporaryDirectory() as root:
            asset_dir = Path(root) / "Generation"
            asset_dir.mkdir(parents=True)
            (asset_dir / "flow.json").write_text("{}", encoding="utf-8")
            (asset_dir / "flow.civitai.json").write_text(json.dumps({"name": "Flow"}), encoding="utf-8")
            with mock.patch.object(manager, "_root_for_kind", return_value=root):
                items = manager._scan_library_kind("workflows")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["filename"], "flow.json")
        self.assertEqual(items[0]["name"], "Flow")

    def test_scan_reads_every_configured_model_root(self):
        with tempfile.TemporaryDirectory() as base:
            primary = Path(base) / "primary"
            secondary = Path(base) / "secondary"
            for root in (primary, secondary):
                asset_dir = root / "Shared"
                asset_dir.mkdir(parents=True)
                (asset_dir / "model.safetensors").write_bytes(root.name.encode("utf-8"))
            with (
                mock.patch.object(manager, "_root_for_kind", return_value=str(primary)),
                mock.patch.object(manager, "_roots_for_kind", return_value=[str(primary), str(secondary)]),
            ):
                items = manager._scan_library_kind("loras")

        self.assertEqual(len(items), 2)
        self.assertEqual(len({item["id"] for item in items}), 2)
        self.assertEqual({item["storage_root"] for item in items}, {str(primary), str(secondary)})
        self.assertTrue(all("root_id=" in item["thumb_url"] for item in items))

    def test_scan_component_folder_uses_flat_layout(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "ae.safetensors").write_bytes(b"vae")
            (Path(root) / "ae.json").write_text(json.dumps({"name": "Flux AE"}), encoding="utf-8")
            (Path(root) / "ae.png").write_bytes(b"preview")
            (Path(root) / "ae.civitai.json").write_text("{}", encoding="utf-8")

            with mock.patch.object(manager, "_root_for_kind", return_value=root):
                items = manager._scan_library_kind("vae")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["filename"], "ae.safetensors")
        self.assertEqual(items[0]["name"], "Flux AE")
        self.assertEqual(items[0]["base_model"], "")
        self.assertEqual(items[0]["category"], "")
        self.assertEqual(items[0]["metadata_status"], "cached")

    def test_config_scan_uses_dedicated_companion_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "flux.yaml").write_text("cfg", encoding="utf-8")
            (Path(root) / "flux.civitai.json").write_text(
                json.dumps({"name": "Flux Config"}),
                encoding="utf-8",
            )
            (Path(root) / "plain.json").write_text("{}", encoding="utf-8")

            with mock.patch.object(manager, "_root_for_kind", return_value=root):
                items = manager._scan_library_kind("configs")

        names = {item["filename"]: item for item in items}
        self.assertEqual(set(names), {"flux.yaml", "plain.json"})
        self.assertEqual(names["flux.yaml"]["name"], "Flux Config")
        self.assertEqual(names["flux.yaml"]["metadata_status"], "cached")
        self.assertEqual(names["plain.json"]["metadata_status"], "missing")

    def test_scan_all_items_covers_every_folder_and_dedupes_shared_roots(self):
        with tempfile.TemporaryDirectory() as base:
            base_path = Path(base)
            checkpoints = base_path / "checkpoints"
            vae = base_path / "vae"
            shared = base_path / "shared"
            (checkpoints / "Base" / "Category").mkdir(parents=True)
            (checkpoints / "Base" / "Category" / "model.safetensors").write_bytes(b"ckpt")
            vae.mkdir()
            (vae / "ae.safetensors").write_bytes(b"vae")
            shared.mkdir()
            (shared / "encoder.safetensors").write_bytes(b"encoder")
            root_map = {
                "checkpoints": [str(checkpoints)],
                "vae": [str(vae)],
                "text_encoders": [str(shared)],
                "clip": [str(shared)],
            }
            with (
                mock.patch.object(manager, "_model_root_map", return_value=root_map),
                mock.patch.object(manager, "_roots_for_kind", side_effect=lambda kind: list(root_map[kind])),
                mock.patch.object(manager, "_root_for_kind", side_effect=lambda kind: root_map[kind][0]),
            ):
                items = manager._scan_all_library_items()

        self.assertEqual({item["root_kind"] for item in items}, {"checkpoints", "vae", "text_encoders"})
        self.assertEqual(sum(1 for item in items if item["filename"] == "encoder.safetensors"), 1)


class LibraryIndexTests(unittest.TestCase):
    def test_cache_reuses_snapshot_until_forced_or_invalidated(self):
        index = manager.LibraryIndex(ttl_seconds=60)
        calls = []

        def load():
            calls.append(len(calls) + 1)
            return {"items": [{"generation": calls[-1]}]}

        first = index.get(load)
        second = index.get(load)
        forced = index.get(load, force=True)
        index.invalidate()
        invalidated = index.get(load)

        self.assertEqual(first, second)
        self.assertEqual(forced["items"][0]["generation"], 2)
        self.assertEqual(invalidated["items"][0]["generation"], 3)
        self.assertEqual(len(calls), 3)


class FavoritesApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path_patch = mock.patch.object(
            manager,
            "_favorites_path",
            return_value=str(Path(self.temp_dir.name) / "favorites.json"),
        )
        self.scan_patch = mock.patch.object(manager, "_scan_roots", return_value={"items": []})
        self.path_patch.start()
        self.scan_patch.start()

    async def asyncTearDown(self):
        self.scan_patch.stop()
        self.path_patch.stop()
        self.temp_dir.cleanup()

    async def test_remote_favorite_can_be_grouped_renamed_and_unfiled(self):
        created = await manager.favorite_folder_api(_JsonRequest({"action": "create", "name": "Styles"}))
        self.assertEqual(created.status, 200)
        folder_id = created.body["folders"][0]["id"]
        item = {
            "asset_kind": "lora",
            "model_id": 1060551,
            "name": "Illustrious Style Pack",
            "model": {"id": 1060551, "name": "Illustrious Style Pack", "type": "LORA"},
        }

        favorited = await manager.favorite_item_api(_JsonRequest({
            "favorite": True,
            "folder_id": folder_id,
            "item": item,
        }))

        self.assertEqual(favorited.status, 200)
        self.assertEqual(favorited.body["items"][0]["key"], "civitai:lora:1060551")
        self.assertEqual(favorited.body["items"][0]["folder_id"], folder_id)

        renamed = await manager.favorite_folder_api(_JsonRequest({
            "action": "rename",
            "folder_id": folder_id,
            "name": "Illustration",
        }))
        self.assertEqual(renamed.body["folders"][0]["name"], "Illustration")

        deleted = await manager.favorite_folder_api(_JsonRequest({
            "action": "delete",
            "folder_id": folder_id,
        }))
        self.assertEqual(deleted.body["folders"], [])
        self.assertEqual(deleted.body["items"][0]["folder_id"], "")

        loaded = await manager.favorites_api(_QueryRequest())
        self.assertEqual(loaded.body["items"][0]["model"]["id"], 1060551)

    async def test_first_load_migrates_legacy_local_favorites(self):
        self.scan_patch.stop()
        self.scan_patch = mock.patch.object(manager, "_scan_roots", return_value={
            "items": [{
                "id": "loras:root:style.safetensors",
                "root_kind": "loras",
                "storage_root_id": "root",
                "relative_path": "style.safetensors",
                "filename": "style.safetensors",
                "name": "Legacy Style",
                "model_id": 42,
                "favorite": True,
            }],
        })
        self.scan_patch.start()

        loaded = await manager.favorites_api(_QueryRequest())

        self.assertEqual(loaded.status, 200)
        self.assertEqual(loaded.body["items"][0]["key"], "civitai:lora:42")
        self.assertTrue(Path(manager._favorites_path()).is_file())

    async def test_downloaded_asset_merges_with_existing_remote_favorite(self):
        remote = {
            "asset_kind": "lora",
            "model_id": 42,
            "name": "Remote Style",
            "model": {"id": 42, "name": "Remote Style", "type": "LORA"},
        }
        local = {
            "asset_kind": "lora",
            "model_id": 42,
            "version_id": 7,
            "name": "Local Style",
            "local": {
                "asset_id": "loras:root:style.safetensors",
                "root_kind": "loras",
                "storage_root_id": "root",
                "relative_path": "style.safetensors",
                "filename": "style.safetensors",
            },
        }

        await manager.favorite_item_api(_JsonRequest({"favorite": True, "item": remote}))
        merged = await manager.favorite_item_api(_JsonRequest({"favorite": True, "item": local}))

        self.assertEqual(len(merged.body["items"]), 1)
        item = merged.body["items"][0]
        self.assertEqual(item["key"], "civitai:lora:42")
        self.assertEqual(item["model"]["id"], 42)
        self.assertEqual(item["local"]["relative_path"], "style.safetensors")
        self.assertEqual(item["sources"], ["local", "remote"])


class ConfigApiAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_cache = manager._CONFIG_CACHE
        manager._CONFIG_CACHE = manager._normalize_config(manager._default_config())

    async def asyncTearDown(self):
        manager._CONFIG_CACHE = self.original_cache

    async def test_invalid_boolean_returns_bad_request_without_writing(self):
        with tempfile.TemporaryDirectory() as root, mock.patch.object(
            manager,
            "_config_path",
            return_value=str(Path(root) / "config.json"),
        ):
            response = await manager.save_config_api(_JsonRequest({
                "allow_nsfw": "sometimes",
            }))
            self.assertFalse((Path(root) / "config.json").exists())

        self.assertEqual(response.status, 400)
        self.assertIn("must be a boolean", response.body["error"])


class DownloadRedirectTests(unittest.TestCase):
    def _redirect(self, target_url):
        request = urllib.request.Request(
            "https://civitai.red/api/download/models/123",
            headers={
                "Authorization": "Bearer secret",
                "Cookie": "session=secret",
                "User-Agent": "CivitaiManager/test",
            },
        )
        return manager._SafeDownloadRedirectHandler().redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            target_url,
        )

    def test_cross_host_redirect_strips_credentials(self):
        redirected = self._redirect("https://storage.example/model.safetensors")

        self.assertIsNotNone(redirected)
        self.assertIsNone(redirected.get_header("Authorization"))
        self.assertIsNone(redirected.get_header("Cookie"))
        self.assertEqual(redirected.get_header("User-agent"), "CivitaiManager/test")

    def test_same_host_redirect_keeps_credentials(self):
        redirected = self._redirect("https://civitai.red/api/download/models/123?fileId=456")

        self.assertEqual(redirected.get_header("Authorization"), "Bearer secret")
        self.assertEqual(redirected.get_header("Cookie"), "session=secret")

    def _http_error(self, code, body):
        return urllib.error.HTTPError("https://civitai.red/api/download/models/1", code, "Forbidden", {}, io.BytesIO(body))

    def test_early_access_refusal_keeps_civitai_reason(self):
        reason, error = manager._download_failure(self._http_error(403, b'{"error":"Early Access","message":"This asset is in Early Access. You can use Buzz access it now!"}'))

        self.assertEqual(reason, "early_access")
        self.assertEqual(error, "Civitai refused the download: This asset is in Early Access. You can use Buzz access it now!")

    def test_failures_are_classified_by_cause(self):
        cases = [
            (self._http_error(403, b"Forbidden"), "auth"),
            (self._http_error(401, b'{"error":"Unauthorized"}'), "auth"),
            (self._http_error(403, b'{"message":"Purchase required"}'), "forbidden"),
            (self._http_error(404, b""), "not_found"),
            (self._http_error(429, b""), "rate_limited"),
            (self._http_error(502, b'{"message":"boom"}'), "server"),
            (urllib.error.URLError("timed out"), "network"),
            (PermissionError("denied"), "disk"),
        ]
        for exc, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(manager._download_failure(exc)[0], expected)
        self.assertEqual(manager._download_failure(self._http_error(502, b'{"message":"boom"}'))[1], "HTTP 502: Forbidden")

    def test_fallback_download_url_uses_download_endpoint_without_v1(self):
        self.assertEqual(
            manager._download_url_for({"id": 123}, {}),
            "https://civitai.red/api/download/models/123",
        )

    def test_civitai_com_download_urls_are_rewritten_to_red(self):
        self.assertEqual(
            manager._download_url_for({}, {"downloadUrl": "https://civitai.com/api/download/models/5?type=Model"}),
            "https://civitai.red/api/download/models/5?type=Model",
        )
        self.assertFalse(manager._validate_civitai_https("https://civitai.com/api/download/models/5"))
        self.assertTrue(manager._validate_civitai_https("https://civitai.red/api/download/models/5"))


class DownloadJobTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store_path = str(Path(self.temp_dir.name) / "downloads.json")

    def tearDown(self):
        self.temp_dir.cleanup()

    def make_store(self, history_limit=100, retention_seconds=24 * 60 * 60):
        return manager.DownloadJobStore(
            self.store_path,
            history_limit=history_limit,
            retention_seconds=retention_seconds,
        )

    def test_preview_is_saved_before_the_job_reports_completion(self):
        store = self.make_store()
        store.add({"id": "job", "status": "pending", "created_at": 1}, {})
        target = Path(self.temp_dir.name) / "loras" / "hero.safetensors"
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.headers = {"Content-Length": "5"}
        response.read.side_effect = [b"model", b""]
        statuses = []

        def save_preview(url, path, api_key=None, timeout=30):
            statuses.append(store.snapshot("job")["status"])
            Path(path).write_bytes(b"jpg")

        with (
            mock.patch.object(manager, "_download_store", return_value=store),
            mock.patch.object(manager, "load_config", return_value={"save_metadata": False, "save_preview": True}),
            mock.patch.object(manager._DOWNLOAD_URL_OPENER, "open", return_value=response),
            mock.patch.object(manager, "_download_binary", side_effect=save_preview),
            mock.patch.object(manager, "_root_for_kind", return_value=str(target.parent)),
        ):
            manager._download_worker("job", "https://civitai.red/api/download/models/1", str(target), "loras", {}, "https://image.civitai.com/a/b/preview.jpeg")

        self.assertEqual(statuses, ["downloading"])
        self.assertEqual(store.snapshot("job")["status"], "completed")
        self.assertTrue(target.with_suffix(".jpg").is_file())

    def test_workflow_zip_download_is_saved_as_a_real_workflow_json(self):
        store = self.make_store()
        store.add({"id": "job", "status": "pending", "created_at": 1}, {})
        target = Path(self.temp_dir.name) / "workflows" / "workflow" / "ponyflow.json"
        graph = {"nodes": [{"id": 1, "type": "KSampler"}], "links": []}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("ponyflow_v3/README.md", "docs")
            archive.writestr("ponyflow_v3/ponyflow_v3.json", json.dumps(graph))
        payload = buffer.getvalue()

        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.headers = {"Content-Length": str(len(payload))}
        response.read.side_effect = [payload, b""]

        with (
            mock.patch.object(manager, "_download_store", return_value=store),
            mock.patch.object(manager, "load_config", return_value={"save_metadata": False, "save_preview": False}),
            mock.patch.object(manager._DOWNLOAD_URL_OPENER, "open", return_value=response),
            mock.patch.object(manager, "_root_for_kind", return_value=str(target.parent.parent)),
        ):
            manager._download_worker("job", "https://civitai.red/api/download/models/1", str(target), "workflows", {}, "")

        self.assertEqual(store.snapshot("job")["status"], "completed")
        saved = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual([node["type"] for node in saved["nodes"]], ["KSampler"])

    def test_active_count_only_includes_pending_and_downloading(self):
        store = self.make_store()
        for task_id, status in {
            "pending": "pending",
            "running": "downloading",
            "done": "completed",
            "failed": "failed",
        }.items():
            store.add({"id": task_id, "status": status, "created_at": 1}, {})
        self.assertEqual(store.active_count(), 2)

    def test_prune_expires_old_jobs_and_caps_finished_history(self):
        store = self.make_store(history_limit=2, retention_seconds=1_000)
        now = int(time.time())
        store.add({"id": "active", "status": "pending", "created_at": now}, {})
        for task_id, status, finished_at in [
            ("expired", "completed", now - 2_000),
            ("newest", "completed", now - 10),
            ("middle", "failed", now - 20),
            ("oldest-retained", "completed", now - 30),
        ]:
            store.add({"id": task_id, "status": status, "created_at": now}, {})
            field = "failed_at" if status == "failed" else "completed_at"
            store.update(task_id, **{field: finished_at})

        self.assertEqual(set(store.snapshot()), {"active", "newest", "middle"})

    def test_restart_marks_active_jobs_failed_and_preserves_retry_payload(self):
        store = self.make_store()
        store.add(
            {"id": "active", "status": "downloading", "created_at": int(time.time())},
            {"kind": "lora", "download_url": "https://civitai.com/api/download/1"},
        )

        restored = self.make_store()

        self.assertEqual(restored.snapshot("active")["status"], "failed")
        self.assertIn("restart", restored.snapshot("active")["error"])
        self.assertEqual(restored.retry_payload("active")["kind"], "lora")
        self.assertNotIn("retry_payload", restored.snapshot("active"))

    def test_cancel_event_and_status_are_recorded(self):
        store = self.make_store()
        store.add({"id": "active", "status": "pending", "created_at": int(time.time())}, {})

        job = store.request_cancel("active")

        self.assertEqual(job["status"], "cancelling")
        self.assertTrue(store.cancel_event("active").is_set())

    def test_capacity_check_and_add_are_one_operation(self):
        store = self.make_store()
        now = int(time.time())

        first = store.add_if_capacity({"id": "first", "status": "pending", "created_at": now}, {}, 1)
        second = store.add_if_capacity({"id": "second", "status": "pending", "created_at": now}, {}, 1)

        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(set(store.snapshot()), {"first"})

    def test_completed_job_cannot_be_retried(self):
        store = self.make_store()
        store.add(
            {"id": "completed", "status": "completed", "created_at": int(time.time())},
            {"kind": "lora"},
        )

        self.assertIsNone(store.retry_payload("completed"))

    def test_remove_finished_never_removes_active_jobs(self):
        store = self.make_store()
        now = int(time.time())
        store.add({"id": "active", "status": "downloading", "created_at": now}, {})
        store.add({"id": "completed", "status": "completed", "created_at": now}, {})
        store.add({"id": "failed", "status": "failed", "created_at": now}, {})

        self.assertEqual(store.remove_finished("active"), 0)
        self.assertEqual(store.remove_finished("completed"), 1)
        self.assertEqual(store.remove_finished(), 1)
        self.assertEqual(set(store.snapshot()), {"active"})

    def test_remove_finished_many_only_removes_selected_terminal_jobs(self):
        store = self.make_store()
        now = int(time.time())
        for task_id, status in {
            "lora-done": "completed",
            "checkpoint-done": "completed",
            "lora-active": "downloading",
        }.items():
            store.add({"id": task_id, "status": status, "created_at": now}, {})

        self.assertEqual(store.remove_finished_many(["lora-done", "lora-active"]), 1)
        self.assertEqual(set(store.snapshot()), {"checkpoint-done", "lora-active"})


class DownloadApiAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_store = manager._DOWNLOAD_STORE
        self.temp_dir = tempfile.TemporaryDirectory()
        manager._DOWNLOAD_STORE = manager.DownloadJobStore(
            str(Path(self.temp_dir.name) / "downloads.json"),
            history_limit=100,
            retention_seconds=24 * 60 * 60,
        )

    async def asyncTearDown(self):
        manager._DOWNLOAD_STORE = self.original_store
        self.temp_dir.cleanup()

    async def test_rejects_when_active_job_limit_is_reached(self):
        class Request:
            async def json(self):
                return {}

        for index in range(manager.DOWNLOAD_MAX_ACTIVE_JOBS):
            manager._DOWNLOAD_STORE.add({
                "id": str(index),
                "status": "pending",
                "created_at": int(time.time()),
            }, {})
        resolution = {
            "root_kind": "loras",
            "absolute_path": "model.safetensors",
            "relative_path": "Other/Other/model.safetensors",
            "filename": "model.safetensors",
            "download_url": "https://civitai.red/api/download/model",
            "base_model_dir": "Other",
            "category_dir": "Other",
        }
        with (
            mock.patch.object(manager, "_ensure_download_workers"),
            mock.patch.object(manager, "resolve_download_path", return_value=resolution),
        ):
            response = await manager.download_api(Request())

        self.assertEqual(response.status, 429)
        self.assertEqual(len(manager._DOWNLOAD_STORE.snapshot()), manager.DOWNLOAD_MAX_ACTIVE_JOBS)

    async def test_legacy_civitai_com_payload_is_queued_on_red(self):
        resolution = {
            "root_kind": "loras",
            "absolute_path": "model.safetensors",
            "relative_path": "Other/Other/model.safetensors",
            "filename": "model.safetensors",
            "download_url": "",
        }
        with (
            mock.patch.object(manager, "_ensure_download_workers"),
            mock.patch.object(manager, "resolve_download_path", return_value=resolution),
            mock.patch.object(manager._DOWNLOAD_QUEUE, "put_nowait") as put,
        ):
            task_id, _ = manager._enqueue_download_request({
                "kind": "lora",
                "download_url": "https://civitai.com/api/download/models/1",
            })

        self.assertEqual(put.call_args.args[0][1], "https://civitai.red/api/download/models/1")
        self.assertEqual(
            manager._DOWNLOAD_STORE.jobs[task_id]["retry_payload"]["download_url"],
            "https://civitai.red/api/download/models/1",
        )

    async def test_status_endpoint_prunes_expired_history(self):
        manager._DOWNLOAD_STORE.retention_seconds = 100
        now = int(time.time())
        manager._DOWNLOAD_STORE.add({"id": "active", "status": "downloading", "created_at": now}, {})
        manager._DOWNLOAD_STORE.add({"id": "expired", "status": "completed", "created_at": now}, {})
        manager._DOWNLOAD_STORE.update("expired", completed_at=1)

        response = await manager.download_status_api(_QueryRequest())

        self.assertEqual(response.status, 200)
        self.assertEqual(set(response.body), {"active"})

    async def test_cancel_endpoint_marks_active_job_cancelling(self):
        manager._DOWNLOAD_STORE.add({
            "id": "active",
            "status": "pending",
            "created_at": int(time.time()),
        }, {})

        response = await manager.cancel_download_api(_JsonRequest({"task_id": "active"}))

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["job"]["status"], "cancelling")

    async def test_retry_endpoint_queues_saved_payload(self):
        payload = {"kind": "lora", "download_url": "https://civitai.com/api/download/1"}
        manager._DOWNLOAD_STORE.add({
            "id": "failed",
            "status": "failed",
            "created_at": int(time.time()),
            "failed_at": int(time.time()),
        }, payload)
        with mock.patch.object(
            manager,
            "_enqueue_download_request",
            return_value=("new-task", {"filename": "model.safetensors"}),
        ) as enqueue:
            response = await manager.retry_download_api(_JsonRequest({"task_id": "failed"}))

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["retry_of"], "failed")
        enqueue.assert_called_once_with(payload)

    async def test_remove_endpoint_clears_only_finished_downloads(self):
        now = int(time.time())
        manager._DOWNLOAD_STORE.add({"id": "active", "status": "downloading", "created_at": now}, {})
        manager._DOWNLOAD_STORE.add({"id": "completed", "status": "completed", "created_at": now}, {})

        response = await manager.remove_download_api(_JsonRequest({}))

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["removed"], 1)
        self.assertEqual(set(manager._DOWNLOAD_STORE.snapshot()), {"active"})

    async def test_remove_endpoint_rejects_active_download(self):
        manager._DOWNLOAD_STORE.add({
            "id": "active",
            "status": "pending",
            "created_at": int(time.time()),
        }, {})

        response = await manager.remove_download_api(_JsonRequest({"task_id": "active"}))

        self.assertEqual(response.status, 409)
        self.assertIn("active", manager._DOWNLOAD_STORE.snapshot())

    async def test_remove_endpoint_clears_selected_finished_downloads(self):
        now = int(time.time())
        manager._DOWNLOAD_STORE.add({"id": "lora", "status": "completed", "created_at": now}, {})
        manager._DOWNLOAD_STORE.add({"id": "checkpoint", "status": "completed", "created_at": now}, {})

        response = await manager.remove_download_api(_JsonRequest({"task_ids": ["lora"]}))

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["removed"], 1)
        self.assertEqual(set(manager._DOWNLOAD_STORE.snapshot()), {"checkpoint"})


class AssetApiAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        self.roots = {
            "checkpoints": base / "checkpoints",
            "unet": base / "unet",
            "loras": base / "loras",
            "vae": base / "vae",
            "workflows": base / "workflows",
        }
        for root in self.roots.values():
            root.mkdir(parents=True)
        self.root_patch = mock.patch.object(
            manager,
            "_root_for_kind",
            side_effect=lambda kind: str(self.roots[kind]),
        )
        self.root_patch.start()

    async def asyncTearDown(self):
        self.root_patch.stop()
        self.temp_dir.cleanup()

    async def test_move_checkpoint_to_unet_moves_companions_and_updates_metadata(self):
        source = self.roots["checkpoints"] / "OldBase" / "OldCategory" / "model.safetensors"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"model")
        manager._write_asset_metadata(str(source), "checkpoints", {
            "name": "Example",
            "resolution": {
                "root_kind": "checkpoints",
                "base_model_dir": "OldBase",
                "category_dir": "OldCategory",
                "filename": "model.safetensors",
                "relative_path": "OldBase/OldCategory/model.safetensors",
            },
        })
        source.with_suffix(".png").write_bytes(b"preview")

        response = await manager.move_asset_api(_JsonRequest({
            "root_kind": "checkpoints",
            "relative_path": "OldBase/OldCategory/model.safetensors",
            "target_root_kind": "unet",
            "base_model_dir": "NewBase",
            "category_dir": "NewCategory",
            "filename": "renamed.safetensors",
        }))

        target = self.roots["unet"] / "NewBase" / "NewCategory" / "renamed.safetensors"
        self.assertEqual(response.status, 200)
        self.assertFalse(source.exists())
        self.assertTrue(target.is_file())
        self.assertTrue(target.with_suffix(".png").is_file())
        metadata = json.loads(target.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["resolution"], {
            "root_kind": "unet",
            "base_model_dir": "NewBase",
            "category_dir": "NewCategory",
            "filename": "renamed.safetensors",
            "relative_path": "NewBase/NewCategory/renamed.safetensors",
        })

    async def test_move_rejects_cross_type_transition(self):
        source = self.roots["loras"] / "Base" / "Category" / "model.safetensors"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"model")
        response = await manager.move_asset_api(_JsonRequest({
            "root_kind": "loras",
            "relative_path": "Base/Category/model.safetensors",
            "target_root_kind": "workflows",
            "category_dir": "Generation",
            "filename": "model.json",
        }))

        self.assertEqual(response.status, 400)
        self.assertTrue(source.is_file())

    async def test_move_to_component_folder_drops_base_and_category(self):
        source = self.roots["loras"] / "Base" / "Category" / "model.safetensors"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"model")
        manager._write_asset_metadata(str(source), "loras", {
            "name": "Example",
            "resolution": {
                "root_kind": "loras",
                "base_model_dir": "Base",
                "category_dir": "Category",
                "filename": "model.safetensors",
                "relative_path": "Base/Category/model.safetensors",
            },
        })

        response = await manager.move_asset_api(_JsonRequest({
            "root_kind": "loras",
            "relative_path": "Base/Category/model.safetensors",
            "target_root_kind": "vae",
            "base_model_dir": "Base",
            "category_dir": "Category",
            "filename": "moved.safetensors",
        }))

        target = self.roots["vae"] / "moved.safetensors"
        self.assertEqual(response.status, 200)
        self.assertFalse(source.exists())
        self.assertTrue(target.is_file())
        metadata = json.loads(target.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["resolution"], {
            "root_kind": "vae",
            "base_model_dir": "",
            "category_dir": "",
            "filename": "moved.safetensors",
            "relative_path": "moved.safetensors",
        })

    async def test_move_preflight_preserves_source_when_companion_target_exists(self):
        source = self.roots["checkpoints"] / "Old" / "Category" / "model.safetensors"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"model")
        source.with_suffix(".png").write_bytes(b"source-preview")
        target_preview = self.roots["unet"] / "New" / "Category" / "model.png"
        target_preview.parent.mkdir(parents=True)
        target_preview.write_bytes(b"existing-preview")

        response = await manager.move_asset_api(_JsonRequest({
            "root_kind": "checkpoints",
            "relative_path": "Old/Category/model.safetensors",
            "target_root_kind": "unet",
            "base_model_dir": "New",
            "category_dir": "Category",
            "filename": "model.safetensors",
        }))

        self.assertEqual(response.status, 409)
        self.assertTrue(source.is_file())
        self.assertEqual(source.with_suffix(".png").read_bytes(), b"source-preview")
        self.assertEqual(target_preview.read_bytes(), b"existing-preview")

    async def test_delete_removes_asset_companions_only(self):
        asset = self.roots["loras"] / "Base" / "Category" / "delete.safetensors"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"model")
        asset.with_suffix(".json").write_text("{}", encoding="utf-8")
        asset.with_suffix(".webp").write_bytes(b"preview")
        unrelated = asset.parent / "keep.txt"
        unrelated.write_text("keep", encoding="utf-8")

        response = await manager.delete_asset_api(_JsonRequest({
            "root_kind": "loras",
            "relative_path": "Base/Category/delete.safetensors",
        }))

        self.assertEqual(response.status, 200)
        self.assertFalse(asset.exists())
        self.assertFalse(asset.with_suffix(".json").exists())
        self.assertFalse(asset.with_suffix(".webp").exists())
        self.assertTrue(unrelated.is_file())

    async def test_delete_rejects_direct_companion_path(self):
        metadata = self.roots["loras"] / "Base" / "Category" / "model.json"
        metadata.parent.mkdir(parents=True)
        metadata.write_text("{}", encoding="utf-8")

        response = await manager.delete_asset_api(_JsonRequest({
            "root_kind": "loras",
            "relative_path": "Base/Category/model.json",
        }))

        self.assertEqual(response.status, 400)
        self.assertTrue(metadata.is_file())

    async def test_delete_normalizes_workflow_root_before_removing_companion(self):
        asset = self.roots["workflows"] / "Generation" / "flow.json"
        asset.parent.mkdir(parents=True)
        asset.write_text("{}", encoding="utf-8")
        companion = asset.with_name("flow.civitai.json")
        companion.write_text("{}", encoding="utf-8")

        response = await manager.delete_asset_api(_JsonRequest({
            "root_kind": "WORKFLOWS",
            "relative_path": "Generation/flow.json",
        }))

        self.assertEqual(response.status, 200)
        self.assertFalse(asset.exists())
        self.assertFalse(companion.exists())

    async def test_delete_resolves_asset_in_secondary_model_root(self):
        secondary = self.roots["loras"].parent / "secondary-loras"
        secondary.mkdir()
        asset = secondary / "model.safetensors"
        asset.write_bytes(b"model")
        with mock.patch.object(
            manager,
            "_roots_for_kind",
            return_value=[str(self.roots["loras"]), str(secondary)],
        ):
            response = await manager.delete_asset_api(_JsonRequest({
                "root_kind": "loras",
                "storage_root_id": manager._storage_root_id(str(secondary)),
                "relative_path": "model.safetensors",
            }))

        self.assertEqual(response.status, 200)
        self.assertFalse(asset.exists())


class MetadataWorkerTests(unittest.TestCase):
    def test_complete_model_uses_version_model_id_when_summary_omits_it(self):
        version = {
            "id": 22,
            "modelId": 11,
            "model": {"name": "Example", "type": "LORA"},
        }
        with (
            mock.patch.object(manager, "load_config", return_value={}),
            mock.patch.object(manager, "_read_json_url_with_retries", return_value=None) as read_model,
        ):
            model = manager._complete_civitai_model(version)

        self.assertEqual(model["id"], 11)
        self.assertEqual(model["name"], "Example")
        self.assertIn("/models/11", read_model.call_args.args[0])

    def test_worker_hashes_and_writes_companion_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            asset = Path(root) / "model.safetensors"
            asset.write_bytes(b"model-data")
            civitai_data = {
                "id": 22,
                "name": "Version",
                "baseModel": "SDXL 1.0",
                "trainedWords": ["trigger"],
                "images": [{"url": "https://image.civitai.com/x/04a43bd2-a6f2-493f-ba86-c677fe642f00/original=true/preview.jpeg"}],
                "model": {
                    "id": 11,
                    "name": "Example",
                    "type": "LORA",
                    "creator": {"username": "tester"},
                },
            }
            full_model = {
                **civitai_data["model"],
                "tags": ["character", "style"],
                "description": "Example description",
            }

            def save_preview(_url, target_path, **_kwargs):
                Path(target_path).write_bytes(b"preview")

            with (
                mock.patch.object(manager, "_metadata_from_hash", return_value=civitai_data),
                mock.patch.object(manager, "_complete_civitai_model", return_value=full_model),
                mock.patch.object(manager, "_download_binary", side_effect=save_preview),
            ):
                result = manager._enrich_metadata_worker(str(asset), "loras")

            metadata_path = asset.with_suffix(".json")
            self.assertTrue(metadata_path.is_file())
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertTrue(result["matched"])
            self.assertTrue(result["preview_saved"])
            self.assertEqual(metadata["model_id"], 11)
            self.assertEqual(metadata["version_id"], 22)
            self.assertEqual(metadata["hashes"]["SHA256"], result["sha256"].upper())
            self.assertEqual(metadata["tags"], ["character", "style"])
            self.assertEqual(metadata["metadata_match_status"], "matched")
            self.assertTrue(asset.with_suffix(".jpg").is_file())

    def test_worker_reuses_saved_sha256(self):
        with tempfile.TemporaryDirectory() as root:
            asset = Path(root) / "model.safetensors"
            asset.write_bytes(b"model-data")
            saved_hash = "a" * 64
            asset.with_suffix(".json").write_text(json.dumps({
                "hashes": {"SHA256": saved_hash.upper()},
            }), encoding="utf-8")
            with (
                mock.patch.object(manager, "_hash_file", side_effect=AssertionError("hash should be reused")),
                mock.patch.object(manager, "_metadata_from_hash", return_value=None),
            ):
                result = manager._enrich_metadata_worker(str(asset), "loras")

        self.assertEqual(result["sha256"], saved_hash)
        self.assertFalse(result["matched"])

    def test_preview_selection_skips_video(self):
        version = {"images": [
            {"url": "https://example.com/preview.mp4", "type": "video"},
            {"url": "https://example.com/preview.jpeg", "type": "image"},
        ]}
        self.assertEqual(
            manager._first_preview_url(version, {}),
            "https://example.com/preview.jpeg",
        )


class MetadataApiAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_enrichment_runs_without_blocking_event_loop(self):
        class Request:
            async def json(self):
                return {"root_kind": "loras", "relative_path": "model.safetensors"}

        with tempfile.TemporaryDirectory() as root:
            asset = Path(root) / "model.safetensors"
            asset.write_bytes(b"model-data")

            def slow_worker(_path, _kind):
                time.sleep(0.08)
                return {"sha256": "abc", "metadata": {}, "matched": False}

            with (
                mock.patch.object(manager, "_resolve_asset_path", return_value=str(asset)),
                mock.patch.object(manager, "_enrich_metadata_worker", side_effect=slow_worker),
            ):
                task = asyncio.create_task(manager.enrich_metadata_api(Request()))
                await asyncio.sleep(0.02)
                self.assertFalse(task.done())
                marker = []
                await asyncio.sleep(0)
                marker.append("event-loop-responsive")
                response = await task

        self.assertEqual(marker, ["event-loop-responsive"])
        self.assertEqual(response.status, 200)


class WorkflowContentApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_the_saved_workflow_graph(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / "workflows"
            (root / "Generation").mkdir(parents=True)
            graph = {
                "last_node_id": 2,
                "nodes": [{"id": 1, "type": "KSampler"}, {"id": 2, "type": "SaveImage"}],
                "links": [],
            }
            (root / "Generation" / "flow.json").write_text(json.dumps(graph), encoding="utf-8")
            with mock.patch.object(manager, "_root_for_kind", return_value=str(root)):
                response = await manager.workflow_content_api(_JsonRequest({
                    "root_kind": "workflows",
                    "relative_path": "Generation/flow.json",
                }))

        self.assertEqual(response.status, 200)
        self.assertEqual(response.body["filename"], "flow.json")
        self.assertEqual([node["type"] for node in response.body["workflow"]["nodes"]], ["KSampler", "SaveImage"])

    async def test_missing_workflow_is_reported(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / "workflows"
            root.mkdir()
            with mock.patch.object(manager, "_root_for_kind", return_value=str(root)):
                response = await manager.workflow_content_api(_JsonRequest({
                    "root_kind": "workflows",
                    "relative_path": "generation/missing.json",
                }))

        self.assertEqual(response.status, 404)
        self.assertFalse(response.body["success"])

    async def test_workflow_shipped_as_zip_returns_the_graph_inside(self):
        # Civitai serves some bundles as a ZIP named ".json"; the graph lives
        # inside next to a readme and wildcards, so the raw bytes are not JSON.
        graph = {"nodes": [{"id": 1, "type": "KSampler"}], "links": []}
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / "workflows"
            (root / "workflow").mkdir(parents=True)
            bundle = root / "workflow" / "ponyflow.json"
            with zipfile.ZipFile(bundle, "w") as archive:
                archive.writestr("ponyflow_v3/README.md", "docs")
                archive.writestr("ponyflow_v3/wildcards.yaml", "a: b")
                archive.writestr("ponyflow_v3/ponyflow_v3.json", json.dumps(graph))
            with mock.patch.object(manager, "_root_for_kind", return_value=str(root)):
                response = await manager.workflow_content_api(_JsonRequest({
                    "root_kind": "workflows",
                    "relative_path": "workflow/ponyflow.json",
                }))

        self.assertEqual(response.status, 200)
        self.assertEqual([node["type"] for node in response.body["workflow"]["nodes"]], ["KSampler"])

    async def test_empty_workflow_file_is_reported_as_empty(self):
        # A zero-byte file (an interrupted download) used to surface as
        # "Invalid workflow JSON: Expecting value: line 1 column 1 (char 0)".
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / "workflows"
            root.mkdir()
            (root / "empty.json").write_bytes(b"")
            with mock.patch.object(manager, "_root_for_kind", return_value=str(root)):
                response = await manager.workflow_content_api(_JsonRequest({
                    "root_kind": "workflows",
                    "relative_path": "empty.json",
                }))

        self.assertEqual(response.status, 400)
        self.assertIn("empty", response.body["error"])

    async def test_zip_is_detected_even_with_an_empty_archive_signature(self):
        # Archives can start with the end-of-central-directory marker instead of
        # a local file header; the old 4-byte check missed those.
        with tempfile.TemporaryDirectory() as base:
            path = Path(base) / "bundle.json"
            with zipfile.ZipFile(path, "w"):
                pass
            self.assertTrue(manager._looks_like_zip(str(path)))

    async def test_archive_without_a_workflow_is_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / "workflows"
            root.mkdir()
            with zipfile.ZipFile(root / "bundle.json", "w") as archive:
                archive.writestr("notes.txt", "nothing here")
            with mock.patch.object(manager, "_root_for_kind", return_value=str(root)):
                response = await manager.workflow_content_api(_JsonRequest({
                    "root_kind": "workflows",
                    "relative_path": "bundle.json",
                }))

        self.assertEqual(response.status, 400)
        self.assertIn("does not contain a workflow", response.body["error"])

    async def test_other_roots_and_invalid_json_are_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / "workflows"
            root.mkdir()
            (root / "broken.json").write_text("{not json", encoding="utf-8")
            with mock.patch.object(manager, "_root_for_kind", return_value=str(root)):
                other_root = await manager.workflow_content_api(_JsonRequest({
                    "root_kind": "loras",
                    "relative_path": "flow.json",
                }))
                broken = await manager.workflow_content_api(_JsonRequest({
                    "root_kind": "workflows",
                    "relative_path": "broken.json",
                }))

        self.assertEqual(other_root.status, 400)
        self.assertEqual(broken.status, 400)
        # A broken file must explain itself instead of leaking a decoder error.
        self.assertIn("not a workflow", broken.body["error"])


if __name__ == "__main__":
    unittest.main()
