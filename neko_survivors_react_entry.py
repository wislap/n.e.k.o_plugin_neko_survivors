"""NEKO Survivors React plugin transport and optional avatar synchronization."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import threading
from urllib.parse import quote, urlsplit, unquote
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

from plugin.sdk.plugin import (
    Err, NekoPluginBase, Ok, SdkError, lifecycle, neko_plugin, plugin_entry, tr, ui,
)


# ── 宿主（主服务器）常量 ──────────────────────────────────────

HOST_BASE = "http://127.0.0.1:48911"
PLUGIN_ID = "neko_survivors_react"
GAME_TYPE = PLUGIN_ID
# Producer-owned load order, shared with the isolated real-engine fixture.
_AVATAR_ENGINE = json.loads((Path(__file__).resolve().parent / "protocol/avatar-engine.json").read_text())
AVATAR_HOST_SCRIPT = _AVATAR_ENGINE["avatarHostScript"]
ENGINE_SCRIPTS = _AVATAR_ENGINE["engineScripts"]

# Shared with the SDK adapter; this is the single commentary product policy.
COMMENTARY = json.loads((Path(__file__).resolve().parent / "protocol/commentary.json").read_text())
_MIN_GAPS = COMMENTARY["eventGapsSeconds"]
_GLOBAL_GAP = COMMENTARY["globalGapSeconds"]

def _safe_rel(rel: str) -> str:
    """Map a relative URI to its once-decoded local path, without traversal."""
    rel = unquote(str(rel or ""), errors="strict").replace("\\", "/")
    if not rel or rel.startswith("/") or ":" in rel or "?" in rel or "#" in rel or "\x00" in rel:
        raise ValueError(f"unsafe model ref: {rel!r}")
    parts = rel.split("/")
    if any(part in ("", "..") for part in parts):
        raise ValueError(f"unsafe model ref: {rel!r}")
    # Dot segments are legal relative model references (e.g. ./motions/idle).
    normalized = "/".join(part for part in parts if part != ".")
    if not normalized:
        raise ValueError(f"unsafe model ref: {rel!r}")
    return normalized


@neko_plugin
class SurvivorsReactPlugin(NekoPluginBase):
    """猫娘姐妹：幸存者。"""

    def __init__(self, ctx=None, *, http_request: Callable[..., tuple[int, bytes]] | None = None):
        super().__init__(ctx)
        self._request_port = http_request
        self._last_event_at: dict[str, float] = {}
        self._last_any_at = 0.0
        self._sync_task: Any = None
        self._stopping = threading.Event()
        self._avatar_lock = asyncio.Lock()
        self._session_lock = asyncio.Lock()
        self._sessions: dict[str, dict] = {}
        self._closed_sessions: dict[str, None] = {}

    # ── 生命周期 ─────────────────────────────────────────────

    @lifecycle(id="startup")
    async def startup(self, **_):
        # 后台同步 Live2D 引擎 + 当前猫娘模型（失败静默，绝不阻塞启动）
        self._stopping.clear()
        self._sync_task = asyncio.create_task(self._sync_avatar_quiet())
        return Ok({"status": "ready"})

    @lifecycle(id="shutdown")
    async def shutdown(self, **_):
        self._stopping.set()
        if self._sync_task is not None and not self._sync_task.done():
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass
        for identity in list(self._sessions):
            await self.close_session(session_id=identity, reason="plugin_shutdown")
        return Ok({"status": "stopped"})

    @ui.context(id="neko_survivors_react")
    async def panel_context(self):
        return {"plugin_id": PLUGIN_ID, "transport": "hosted-ui-action"}

    # ── 动作一：战况播报（猫娘自由发挥） ─────────────────────

    # Static surface actions use the public hosted-ui authorization whitelist.
    @ui.action(id="game_event", label=tr("entries.game_event.name", default="游戏战况播报"), icon="gamepad")
    @plugin_entry(
        id="game_event",
        timeout=60,
        name=tr("entries.game_event.name", default="游戏战况播报"),
        description=tr(
            "entries.game_event.description",
            default="使用正式游戏会话生成一句解说，再交给同会话语音管线。由游戏页面自动调用，内置节流。",
        ),
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "correlation_id": {"type": "string"},
                "event": {"type": "string", "description": "事件类型（run_start/wave_start/boss_spawn/boss_kill/win/death 等）"},
                "text": {"type": "string", "description": "战况一句话描述（第几波/难度/血量/击杀等）"},
            },
            "required": ["event", "text", "session_id"],
            "additionalProperties": False,
        },
    )
    async def game_event(self, event: str = "", text: str = "", session_id: str = "", correlation_id: str = "", **_) -> Ok:
        """One protected game-dialogue request followed by one generation-owned speech."""
        event = str(event or "").strip()[:COMMENTARY["maxEventLength"]]
        safe_text = str(text or "").strip()[:COMMENTARY["maxTextLength"]]
        if not safe_text:
            return Err(SdkError("empty text"))
        binding = self._sessions.get(session_id)
        if self._stopping.is_set() or not binding or session_id in self._closed_sessions or not binding.get("active"):
            return Ok({"status": "cancelled", "reason": "session_closed"})
        now = time.monotonic()
        gap = _MIN_GAPS.get(event, COMMENTARY["defaultEventGapSeconds"])
        if event in self._last_event_at and now - self._last_event_at[event] < gap:
            return Ok({"status": "throttled", "reason": "event_gap"})
        if self._last_any_at and now - self._last_any_at < _GLOBAL_GAP:
            return Ok({"status": "throttled", "reason": "global_gap"})
        # Reserve before the first await: concurrent events may not launch two
        # paid generations. Provider failure does not automatically retry a bill.
        self._last_event_at[event] = now
        self._last_any_at = now
        if await self._current_lanlan() != binding["lanlan_name"]:
            return Ok({"status": "unavailable", "reason": "character_changed"})
        request = {**binding["payload"], "event": {"kind": event, "text": safe_text},
                   "prompt": {"mode": "author-managed", "messages": [{"role": "user", "content":
                     COMMENTARY["prompt"].replace("{text}", safe_text)}]}}
        status, body = await asyncio.to_thread(self._http_request, "POST", f"/api/game/{GAME_TYPE}/chat", json.dumps(request, ensure_ascii=False).encode("utf-8"), timeout=25.0)
        if status != 200:
            return Ok({"status": "unavailable", "reason": f"dialogue_http_{status}"})
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeError):
            data = None
        if not isinstance(data, dict) or data.get("error") or data.get("ok") is False:
            return Ok({"status": "rejected", "reason": str(data.get("error") or data.get("reason") or "invalid_dialogue_response") if isinstance(data, dict) else "invalid_dialogue_response"})
        if data.get("skipped") or data.get("handled") is False or session_id in self._closed_sessions:
            return Ok({"status": "cancelled", "reason": str(data.get("skipped") or "session_closed")})
        line = data.get("line")
        if not isinstance(line, str) or not line.strip():
            return Ok({"status": "rejected", "reason": "empty_dialogue_line"})
        # /chat only generates; /speak mirrors text and outputs speech exactly once.
        result = await self.speak(line.strip()[:COMMENTARY["maxTextLength"]], session_id, correlation_id)
        return Ok({**result.value, "line": line.strip()[:COMMENTARY["maxTextLength"]]})

    # ── 动作二：照念台词（官方 TTS，"本地版的感觉"） ─────────

    @ui.action(id="speak", label=tr("entries.speak.name", default="让猫娘说这句话"), icon="chat")
    @plugin_entry(
        id="speak",
        name=tr("entries.speak.name", default="让猫娘说这句话"),
        description=tr(
            "entries.speak.description",
            default="把指定台词通过宿主官方 TTS 管线说出来（与内置小游戏同一条 B 层输出通道）。"
                    "由游戏页面自动调用（宠物业/天气台词），不额外限频。",
        ),
        input_schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "要让猫娘照念的台词"},
                "session_id": {"type": "string", "description": "当前游戏会话身份"},
                "correlation_id": {"type": "string", "description": "本句语音的可取消关联身份"},
            },
            "required": ["text", "session_id"],
            "additionalProperties": False,
        },
    )
    async def speak(self, text: str = "", session_id: str = "", correlation_id: str = "", **_):
        """照念台词：转发宿主 /api/game/<type>/speak（官方 TTS 管线，无 CD）。"""
        log = getattr(self, "logger", None)
        safe = str(text or "").strip()[:COMMENTARY["maxTextLength"]]
        if self._stopping.is_set():
            return Ok({"status": "cancelled"})
        if not safe:
            return Err(SdkError("empty text"))

        binding = self._sessions.get(session_id)
        if self._stopping.is_set() or not binding or session_id in self._closed_sessions or not binding.get("active"):
            return Ok({"status": "cancelled", "reason": "session_closed"})
        lanlan = await self._current_lanlan()
        if lanlan != binding["lanlan_name"]:
            return Ok({"status": "unavailable", "reason": "character_changed"})
        if session_id in self._closed_sessions:
            return Ok({"status": "cancelled", "reason": "session_closed"})
        payload = json.dumps({
            **binding["payload"], "line": safe, "source": "game_route",
            "sdk_speech_correlation_id": str(correlation_id or uuid.uuid4().hex)[:128],
        }, ensure_ascii=False).encode("utf-8")
        if log:
            log.info("[neko_survivors_react] speak → 宿主 TTS（%s）：%.60s", lanlan, safe)
        status, body = await asyncio.to_thread(
            self._http_request, "POST", f"/api/game/{GAME_TYPE}/speak", payload,
        )
        if status != 200:
            if log:
                log.info("[neko_survivors_react] speak 宿主不可达（HTTP %s）", status)
            return Ok({"status": "upstream_unavailable", "code": status})
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeError):
            return Ok({"status": "rejected", "reason": "invalid_upstream_response"})
        if not isinstance(data, dict) or data.get("ok") is not True:
            return Ok({"status": "rejected", "reason": str(data.get("reason") or "invalid_upstream_response")[:80] if isinstance(data, dict) else "invalid_upstream_response"})
        if data.get("skipped") or data.get("handled") is False:
            return Ok({"status": "cancelled", "reason": str(data.get("reason") or data.get("skipped"))[:80]})
        return Ok({"status": "queued", "method": str(data.get("method") or "")[:40]})

    def _remember_closed(self, session_id: str) -> None:
        self._closed_sessions[session_id] = None
        while len(self._closed_sessions) > 512:
            self._closed_sessions.pop(next(iter(self._closed_sessions)))

    async def _route_request(self, action: str, payload: dict) -> dict:
        status, body = await asyncio.to_thread(self._http_request, "POST", f"/api/game/{GAME_TYPE}/route/{action}", json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        if status != 200:
            return {"status": "unavailable", "reason": f"upstream_http_{status}"}
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeError):
            data = None
        if not isinstance(data, dict) or data.get("ok") is not True:
            return {"status": "rejected", "reason": str(data.get("reason") or "invalid_route_response") if isinstance(data, dict) else "invalid_route_response"}
        if action == "start" and not (isinstance(data.get("state"), dict) and data["state"].get("game_route_active") is True):
            return {"status": "cancelled", "reason": str(data.get("reason") or "route_inactive")}
        if action == "heartbeat" and data.get("active") is not True:
            return {"status": "unavailable", "reason": str(data.get("reason") or "route_inactive")}
        return {"status": "completed"}

    @ui.action(id="open_session", label=tr("entries.open_session.name", default="连接游戏会话"), icon="gamepad")
    @plugin_entry(id="open_session", name=tr("entries.open_session.name", default="连接游戏会话"), description=tr("entries.open_session.description", default="为当前角色激活独立且可关闭的游戏语音路由。"))
    async def open_session(self, session_id: str = "", route_id: str = "", visibility_state: str = "visible", **_):
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", session_id) or not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", route_id):
            return Ok({"status": "rejected", "reason": "invalid_session_identity"})
        if self._stopping.is_set() or session_id in self._closed_sessions:
            return Ok({"status": "cancelled", "reason": "session_closed"})
        async with self._session_lock:
            if session_id in self._closed_sessions:
                return Ok({"status": "cancelled", "reason": "session_closed"})
            old = self._sessions.get(session_id)
            if old and old.get("active"):
                return Ok({"status": "completed"})
            lanlan = await self._current_lanlan()
            # close_session/shutdown can invalidate us during character I/O.
            # Do not acquire a host takeover for an already-retired generation.
            if self._stopping.is_set() or session_id in self._closed_sessions:
                return Ok({"status": "cancelled", "reason": "session_closed"})
            if not lanlan:
                return Ok({"status": "unavailable", "reason": "no_current_character"})
            binding = {"lanlan_name": lanlan, "active": False, "payload": {
                "lanlan_name": lanlan, "session_id": f"{GAME_TYPE}_{session_id}",
                "sdk_route_instance_id": route_id, "game_memory_enabled": False, "visibility_state": str(visibility_state)[:32],
            }}
            self._sessions[session_id] = binding
            try:
                result = await self._route_request("start", binding["payload"])
            except asyncio.CancelledError:
                self._remember_closed(session_id)
                # Retire even an end-before-start race; the host records the
                # exact session+route generation as a bounded tombstone.
                await asyncio.shield(self._route_request("end", {**binding["payload"], "reason": "start_cancelled", "postgameProactive": {"enabled": False}}))
                raise
            if session_id in self._closed_sessions or self._stopping.is_set():
                # Even if the browser aborted while startup was in flight, retire
                # this exact generation on the host, never a replacement route.
                await self._route_request("end", {**binding["payload"], "reason": "start_cancelled", "postgameProactive": {"enabled": False}})
                self._sessions.pop(session_id, None)
                return Ok({"status": "cancelled", "reason": "session_closed"})
            binding["active"] = result["status"] == "completed"
            return Ok(result)

    @ui.action(id="close_session", label=tr("entries.close_session.name", default="关闭游戏会话"), icon="stop")
    @plugin_entry(id="close_session", name=tr("entries.close_session.name", default="关闭游戏会话"), description=tr("entries.close_session.description", default="通过宿主正式关闭路由，取消该会话已提交的语音。"))
    async def close_session(self, session_id: str = "", reason: str = "game_exit", **_):
        self._remember_closed(session_id)  # Synchronous invalidation precedes every await.
        async with self._session_lock:
            binding = self._sessions.get(session_id)
            if not binding:
                return Ok({"status": "completed"})
            result = await self._route_request("end", {**binding["payload"], "reason": str(reason)[:80], "postgameProactive": {"enabled": False}})
            if result["status"] == "completed":
                self._sessions.pop(session_id, None)
            return Ok(result)

    @ui.action(id="heartbeat_session", label=tr("entries.heartbeat_session.name", default="刷新游戏连接"), icon="refresh")
    @plugin_entry(id="heartbeat_session", name=tr("entries.heartbeat_session.name", default="刷新游戏连接"), description=tr("entries.heartbeat_session.description", default="维护会话并检测当前角色切换。"))
    async def heartbeat_session(self, session_id: str = "", visibility_state: str = "visible", **_):
        binding = self._sessions.get(session_id)
        if not binding or session_id in self._closed_sessions:
            return Ok({"status": "cancelled", "reason": "session_closed"})
        current = await self._current_lanlan()
        if current != binding["lanlan_name"]:
            await self.close_session(session_id, "character_changed")
            return Ok({"status": "unavailable", "reason": "character_changed"})
        return Ok(await self._route_request("heartbeat", {**binding["payload"], "visibility_state": str(visibility_state)[:32]}))

    @ui.action(id="avatar_state", label=tr("entries.avatar_state.name", default="查看当前形象"), icon="refresh")
    @plugin_entry(id="avatar_state", name=tr("entries.avatar_state.name", default="查看当前形象"), description=tr("entries.avatar_state.description", default="读取当前角色与模型身份，供晚启动和角色切换后重新加载。"))
    async def avatar_state(self, **_):
        info = await asyncio.to_thread(self._http_json, f"/api/game/{GAME_TYPE}/character")
        if not info.get("lanlan_name"):
            return Ok({"status": "unavailable", "reason": "no_current_character"})
        identity = hashlib.sha256(json.dumps({key: info.get(key) for key in ("lanlan_name", "model_type", "live2d_path")}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        return Ok({"status": "completed", "identity": identity, "name": info.get("lanlan_name"), "modelType": info.get("model_type")})

    # ── 动作三：手动重同步形象资源（诊断用） ─────────────────

    @ui.action(id="sync_avatar", label=tr("entries.sync_avatar.name", default="同步猫娘形象"), icon="refresh")
    @plugin_entry(
        id="sync_avatar",
        timeout=300,
        name=tr("entries.sync_avatar.name", default="同步猫娘形象"),
        description=tr(
            "entries.sync_avatar.description",
            default="从本机宿主重新同步 Live2D 引擎与当前猫娘模型到插件 vendor 目录。"
                    "插件启动时会自动做一次；宿主中途才打开时可用这个手动补。",
        ),
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    )
    async def sync_avatar(self, **_):
        return Ok(await self._sync_avatar_payload())

    # ── 内部：宿主 HTTP 与形象同步 ───────────────────────────

    def _vendor_dir(self) -> Path:
        return Path(__file__).resolve().parent / "static" / "vendor"

    def _http_request(self, method: str, path: str, body: bytes | None = None,
                      timeout: float = 15.0) -> tuple[int, bytes]:
        if self._request_port is not None:
            return self._request_port(method, path, body, timeout=timeout)
        req = urllib.request.Request(
            HOST_BASE + quote(path, safe="/%?=&"), data=body, method=method,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, b""
        except Exception:
            return 0, b""

    def _http_json(self, path: str, timeout: float = 15.0) -> dict:
        status, body = self._http_request("GET", path, timeout=timeout)
        if status != 200:
            return {}
        try:
            data = json.loads(body.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    async def _current_lanlan(self) -> str:
        # Character selection is live state. Caching the name routes speech to a
        # previous character after the user switches the desktop companion.
        chars = await asyncio.to_thread(self._http_json, "/api/characters")
        return str(chars.get("当前猫娘") or "").strip()

    async def _sync_avatar_quiet(self) -> None:
        try:
            await self._sync_avatar_payload()
        except Exception:
            pass  # 任何失败都静默：形象是可选增强

    def _model_refs(self, model_json: dict) -> list[str]:
        """从 model3.json 收集 FileReferences 引用的相对路径。"""
        refs: list[str] = []
        fr = model_json.get("FileReferences") or {}
        for key in ("Moc", "Physics", "Pose", "DisplayInfo"):
            if isinstance(fr.get(key), str) and fr[key]:
                refs.append(fr[key])
        textures = fr.get("Textures")
        if isinstance(textures, list):
            refs.extend(t for t in textures if isinstance(t, str) and t)
        expressions = fr.get("Expressions")
        if isinstance(expressions, list):
            for item in expressions:
                if isinstance(item, dict) and isinstance(item.get("File"), str):
                    refs.append(item["File"])
        motions = fr.get("Motions")
        if isinstance(motions, dict):
            for group in motions.values():
                if isinstance(group, list):
                    for m in group:
                        if isinstance(m, dict):
                            for mk in ("File", "Sound"):
                                if isinstance(m.get(mk), str) and m[mk]:
                                    refs.append(m[mk])
        return refs

    async def _sync_avatar_payload(self) -> dict:
        """Publish a complete avatar manifest only after every required fetch succeeds."""
        async with self._avatar_lock:
            if self._stopping.is_set():
                return {"synced": False, "reason": "cancelled"}
            info = await asyncio.to_thread(self._http_json, f"/api/game/{GAME_TYPE}/character")
            model_path = str(info.get("live2d_path") or "").strip()
            parsed = urlsplit(model_path)
            if info.get("model_type") != "live2d" or not model_path:
                return {"synced": False, "reason": "no_live2d_model"}
            if parsed.scheme or parsed.netloc or not model_path.startswith("/"):
                return {"synced": False, "reason": "invalid_model_path"}
            status, blob = await asyncio.to_thread(self._http_request, "GET", model_path, timeout=30.0)
            if status != 200 or not blob:
                return {"synced": False, "reason": "model_fetch_failed"}
            try:
                model_json = json.loads(blob.decode("utf-8"))
                rel_model = _safe_rel(parsed.path.lstrip("/"))
                # The JSON retains its original relative URIs. Decode only the
                # local destination; the source HTTP request must keep escapes.
                refs = [(_safe_rel(ref), ref.replace("\\", "/")) for ref in self._model_refs(model_json)]
            except (ValueError, TypeError, AttributeError):
                return {"synced": False, "reason": "model_json_invalid"}
            payloads = {f"model/{rel_model}": blob}
            base = rel_model.rsplit("/", 1)[0] if "/" in rel_model else ""
            downloads = [(f"model/{base + '/' if base else ''}{local}", parsed.path.rsplit("/", 1)[0] + "/" + remote) for local, remote in refs]
            downloads += [("engine/" + script.rsplit("/", 1)[-1], script) for script in ENGINE_SCRIPTS]
            downloads += [("neko-minigame-avatar-host.js", AVATAR_HOST_SCRIPT)]
            total = len(blob)
            for local, remote in downloads:
                if self._stopping.is_set():
                    return {"synced": False, "reason": "cancelled"}
                status, content = await asyncio.to_thread(self._http_request, "GET", remote, timeout=30.0)
                if status != 200 or not content:
                    return {"synced": False, "reason": "resource_missing", "resource": local}
                total += len(content)
                if total > 200 * 1024 * 1024:
                    return {"synced": False, "reason": "too_large"}
                payloads[local] = content
            # Content-addressed generation prevents a failed/changed sync corrupting
            # the previous model's files. Vite preserves this runtime-only cache.
            digest = hashlib.sha256(b"".join(k.encode() + v for k, v in sorted(payloads.items()))).hexdigest()[:20]
            generation = self._vendor_dir() / digest
            for local, content in payloads.items():
                target = generation / local
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    target.write_bytes(content)
            # Retain current + one previous generation for in-flight avatar swaps.
            old_generations = sorted((path for path in self._vendor_dir().iterdir() if path.is_dir() and path.name != digest), key=lambda path: path.stat().st_mtime, reverse=True)
            for stale in old_generations[1:]:
                import shutil
                shutil.rmtree(stale, ignore_errors=True)
            return {"synced": True, "bytes": total, "name": str(info.get("lanlan_name") or ""),
                    "generation": digest,
                    "modelUrl": f"/plugin/{PLUGIN_ID}/ui/vendor/{digest}/{quote('model/' + rel_model, safe='/')}",
                    "scripts": [f"/plugin/{PLUGIN_ID}/ui/vendor/{digest}/{quote(local, safe='/')}"
                                for local in ["neko-minigame-avatar-host.js", *("engine/" + script.rsplit("/", 1)[-1] for script in ENGINE_SCRIPTS)]]}
