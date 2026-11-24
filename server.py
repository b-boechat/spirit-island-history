"""Local server for the Spirit Island game history site.

Serves the static site in ./web and a small JSON API:

  GET /api/games?uid=<device id>[&cached=1]
      Fetches the device's completed games from the online feed, merges them
      into the local cache (data/<uid>.json) and returns the full history.
      Older games are kept even if the feed stops returning them. If the feed
      can't be reached, the cached history is returned instead.
      cached=1 skips the online fetch.

  GET /api/devices
      The named devices from data/config.json.

  POST /api/devices {uid, name?, skipCheck?}
      Adds a device, after checking the ID with the online feed.
  PATCH /api/devices/<uid> {name}
      Renames a device.
  DELETE /api/devices/<uid>[?history=delete]
      Removes a device (and, if asked, its saved game history).
      Changes are only accepted from the site's own page.

  POST /api/art/download {}      (and GET for its progress)
      Downloads the spirit, aspect and adversary images that are missing
      from web/art/, from mindwanderer.net/si/.

  GET /api/art
      The image files found in web/art/{spirits,adversaries,aspects},
      keyed by game ID (file name without extension), plus web/art/aliases.json.

Only the Python standard library is used.
Personal data (settings, devices, game history) is kept in ./data only.

Run:  python server.py [--port 8080] [--config other-settings.json] [--open]
"""

import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
# Everything personal (devices, game history) lives in data/, so the rest of
# the project can be shared as is.
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "config.json"
LEGACY_CONFIG_PATH = ROOT / "config.json"  # where the config lived before
ART_DIR = WEB_DIR / "art"
ART_KINDS = ("spirits", "adversaries", "aspects")
ART_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}

DEFAULT_CONFIG = {
    "port": 8080,
    "feedUrl": "https://mindwanderer.net/si/player/json.cgi?uid={uid}",
    "devices": [],
}

# Device IDs are UUID-like; allow letters, digits and dashes only, so the ID
# is safe to use as a file name and in the feed URL.
UID_PATTERN = re.compile(r"^[A-Za-z0-9-]{8,64}$")
FETCH_TIMEOUT_SECONDS = 15
USER_AGENT = "SpiritIslandHistory/1.0 (local personal viewer)"

_cache_locks: dict[str, threading.Lock] = {}
_cache_locks_guard = threading.Lock()


def load_config(path: Path) -> dict:
    config = dict(DEFAULT_CONFIG)
    if path.exists():
        with path.open(encoding="utf-8-sig") as f:  # -sig: tolerate files saved by Notepad
            config.update(json.load(f))
    return config


def prepare_config() -> None:
    """Makes sure data/config.json exists.

    An older config.json next to server.py is moved into data/. Without any
    config, an empty one is created: a new user starts with no devices.
    """
    DATA_DIR.mkdir(exist_ok=True)
    if CONFIG_PATH.exists():
        if LEGACY_CONFIG_PATH.exists():
            print(f"Note: {LEGACY_CONFIG_PATH.name} next to server.py is ignored; "
                  f"the settings in data/config.json are used.", file=sys.stderr)
        return
    if LEGACY_CONFIG_PATH.exists():
        os.replace(LEGACY_CONFIG_PATH, CONFIG_PATH)
        print("Moved config.json into the data folder (data/config.json).")
    else:
        write_json(CONFIG_PATH, DEFAULT_CONFIG)
        print("Created data/config.json (no devices yet).")


def lock_for(uid: str) -> threading.Lock:
    with _cache_locks_guard:
        return _cache_locks.setdefault(uid, threading.Lock())


def game_key(game: dict) -> str:
    """Identity of a game record, used to de-duplicate when merging."""
    spirits = ",".join(game.get("spirits") or [])
    return f"{game.get('createdAt', '')}|{spirits}"


def read_cache(uid: str) -> dict:
    path = DATA_DIR / f"{uid}.json"
    if not path.exists():
        return {"uid": uid, "lastFetchedAt": None, "games": []}
    with path.open(encoding="utf-8-sig") as f:  # -sig: tolerate files saved by Notepad
        return json.load(f)


def write_cache(uid: str, cache: dict) -> None:
    write_json(DATA_DIR / f"{uid}.json", cache, indent=1)


def write_json(path: Path, data, indent: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write("\n")
    # Atomic swap, so a crash never leaves a half-written file. On Windows the
    # swap fails while another request is reading the file, so retry briefly.
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def fetch_feed(feed_url: str, uid: str) -> list:
    url = feed_url.replace("{uid}", urllib.parse.quote(uid))
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        data = json.load(response)
    if not isinstance(data, list):
        raise ValueError("feed did not return a list of games")
    return [g for g in data if isinstance(g, dict)]


def merge_games(existing: list, fresh: list) -> tuple[list, int]:
    merged = {game_key(g): g for g in existing}
    new_count = 0
    for game in fresh:
        key = game_key(game)
        if key not in merged:
            new_count += 1
        merged[key] = game  # the feed's copy wins if a record changed
    games = sorted(merged.values(), key=lambda g: g.get("createdAt", ""))
    return games, new_count


def get_games(config: dict, uid: str, use_cache_only: bool) -> dict:
    if use_cache_only:
        # No lock needed: write_cache() swaps the file in atomically, so a
        # read never sees a half-written cache, and it shouldn't wait for a
        # slow online fetch that's in progress.
        cache = read_cache(uid)
        return {
            "uid": uid,
            "source": "cache",
            "newGames": 0,
            "error": None,
            "lastFetchedAt": cache.get("lastFetchedAt"),
            "games": cache["games"],
        }
    with lock_for(uid):
        cache = read_cache(uid)
        result = {
            "uid": uid,
            "source": "cache",
            "newGames": 0,
            "error": None,
        }
        if not use_cache_only:
            try:
                fresh = fetch_feed(config["feedUrl"], uid)
                cache["games"], result["newGames"] = merge_games(cache["games"], fresh)
                cache["lastFetchedAt"] = datetime.now(timezone.utc).isoformat()
                write_cache(uid, cache)
                result["source"] = "live"
            except urllib.error.HTTPError as exc:
                if exc.code in (404, 406):
                    # The feed answers 406 for device IDs it has no games for.
                    result["errorKind"] = "unknown_device"
                    result["error"] = (
                        "The online feed has no games for this device ID. "
                        "Check the ID, or play and finish a game on that device first."
                    )
                else:
                    result["errorKind"] = "feed_error"
                    result["error"] = f"The online feed returned an error: HTTP {exc.code}"
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                result["errorKind"] = "unreachable"
                result["error"] = f"Could not reach the online feed: {exc}"
        result["lastFetchedAt"] = cache.get("lastFetchedAt")
        result["games"] = cache["games"]
        return result


# --- Managing devices ---------------------------------------------------------
# The page adds, renames and removes devices; they're saved in the config file
# (data/config.json, or the file given with --config).

_config_lock = threading.Lock()
MAX_NAME_LENGTH = 40


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.payload = {"error": message, **extra}


def clean_name(name, uid: str) -> str:
    """A tidy display name: no control characters, single spaces, at most 40 characters."""
    text = re.sub(r"[\x00-\x1f\x7f]", "", str(name or ""))
    text = re.sub(r"\s+", " ", text).strip()[:MAX_NAME_LENGTH].strip()
    return text or f"Device {uid[:8]}"


def check_uid(uid) -> str:
    uid = str(uid or "").strip()
    if not UID_PATTERN.match(uid):
        raise ApiError(HTTPStatus.BAD_REQUEST,
                       "That doesn't look like a device ID: use letters, digits and dashes only.")
    return uid


def save_devices(config: dict, config_path: Path, devices: list) -> None:
    """Writes the device list into the config file, keeping its other settings."""
    on_disk = load_config(config_path)
    on_disk["devices"] = devices
    write_json(config_path, on_disk)
    config["devices"] = devices


def add_device(config: dict, config_path: Path, uid, name, skip_check: bool) -> dict:
    uid = check_uid(uid)
    with _config_lock:
        existing = next((d for d in config.get("devices", []) if d.get("uid") == uid), None)
    if existing:
        raise ApiError(HTTPStatus.CONFLICT,
                       f"This device is already added, as “{existing.get('name') or uid}”.")
    # Check the ID against the online feed (this also saves its games).
    check = {"checked": False, "games": None}
    if not skip_check:
        result = get_games(config, uid, use_cache_only=False)
        kind = result.get("errorKind")
        if kind == "unknown_device":
            raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, result["error"], errorKind=kind)
        if kind:
            raise ApiError(HTTPStatus.BAD_GATEWAY,
                           f"{result['error']}. You can save the ID anyway and load its games later.",
                           errorKind=kind)
        check = {"checked": True, "games": len(result["games"])}
    device = {"name": clean_name(name, uid), "uid": uid}
    with _config_lock:
        devices = [d for d in config.get("devices", []) if d.get("uid") != uid] + [device]
        save_devices(config, config_path, devices)
    return {"device": device, "devices": devices, "check": check}


def rename_device(config: dict, config_path: Path, uid, name) -> dict:
    uid = check_uid(uid)
    with _config_lock:
        devices = [dict(d) for d in config.get("devices", [])]
        target = next((d for d in devices if d.get("uid") == uid), None)
        if not target:
            raise ApiError(HTTPStatus.NOT_FOUND, "That device isn't in your list.")
        target["name"] = clean_name(name, uid)
        save_devices(config, config_path, devices)
    return {"device": target, "devices": devices}


def remove_device(config: dict, config_path: Path, uid, delete_history: bool) -> dict:
    uid = check_uid(uid)
    with _config_lock:
        devices = config.get("devices", [])
        if not any(d.get("uid") == uid for d in devices):
            raise ApiError(HTTPStatus.NOT_FOUND, "That device isn't in your list.")
        devices = [d for d in devices if d.get("uid") != uid]
        save_devices(config, config_path, devices)
    history_deleted = False
    if delete_history:
        with lock_for(uid):
            history = DATA_DIR / f"{uid}.json"
            if history.exists():
                history.unlink()
                history_deleted = True
    return {"devices": devices, "historyDeleted": history_deleted}


# --- Downloading artwork ------------------------------------------------------
# The artwork isn't shipped with the project: it belongs to the game's makers.
# mindwanderer.net/si/ shows every spirit, aspect and adversary with images named
# after the game's own IDs, so the server can fetch them into web/art/ on request.

ART_SOURCE = "https://mindwanderer.net/si/"
ART_MAX_BYTES = 2 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

_art_job_lock = threading.Lock()
_art_job = {"state": "idle"}  # idle | running | done | failed


def art_job_status() -> dict:
    with _art_job_lock:
        return dict(_art_job)


def _set_art_job(**changes) -> None:
    with _art_job_lock:
        _art_job.update(changes)


def _http_get(url: str, max_bytes: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("file too large")
    return data


def list_art_sources(page_html: str) -> list:
    """[(kind, game ID, image URL)] for every spirit, aspect and adversary on the page."""
    found = []
    for section in ("players", "adversaries"):
        match = re.search(
            rf'<div id="{section}" class="category">(.*?)(?=<div id="[^"]+" class="category">|</body>)',
            page_html, re.S)
        if not match:
            continue
        for game_id, image, alt in re.findall(
                r'<a href="details/([A-Za-z0-9]+)\.html"[^>]*>\s*<img src="(images/[A-Za-z0-9_-]+\.png)" alt="([^"]*)"',
                match.group(1)):
            if section == "adversaries":
                kind = "adversaries"
            else:
                # Aspects are listed among the spirits as "Spirit — Aspect".
                kind = "aspects" if "&mdash;" in alt or "—" in alt else "spirits"
            found.append((kind, game_id, urllib.parse.urljoin(ART_SOURCE, image)))
    return found


def _existing_art(kind: str, game_id: str) -> bool:
    folder = ART_DIR / kind
    return any((folder / f"{game_id}{ext}").exists() for ext in ART_EXTENSIONS)


def _download_art_job() -> None:
    try:
        page = _http_get(ART_SOURCE, ART_MAX_BYTES).decode("utf-8", errors="replace")
        sources = list_art_sources(page)
        if not sources:
            raise ValueError("no images were found on the page (it may have changed)")
        todo = [s for s in sources if not _existing_art(s[0], s[1])]
        _set_art_job(total=len(sources), toDownload=len(todo), skipped=len(sources) - len(todo))
        downloaded, failed = 0, []
        for kind, game_id, url in todo:
            try:
                data = _http_get(url, ART_MAX_BYTES)
                if not data.startswith(PNG_SIGNATURE):
                    raise ValueError("not a PNG image")
                target = ART_DIR / kind / f"{game_id}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_suffix(".png.tmp")
                tmp.write_bytes(data)
                os.replace(tmp, target)
                downloaded += 1
            except Exception as exc:  # one bad image shouldn't stop the rest
                failed.append(f"{game_id}: {exc}")
            _set_art_job(downloaded=downloaded, failed=len(failed), failures=failed[:10])
        _set_art_job(state="done", finishedAt=datetime.now(timezone.utc).isoformat())
    except Exception as exc:
        _set_art_job(state="failed", error=f"Could not download the artwork: {exc}")


def start_art_download() -> dict:
    with _art_job_lock:
        if _art_job.get("state") == "running":
            return dict(_art_job)
        _art_job.clear()
        _art_job.update(state="running", total=None, toDownload=None, skipped=0,
                        downloaded=0, failed=0, failures=[], error=None)
    threading.Thread(target=_download_art_job, name="art-download", daemon=True).start()
    return art_job_status()


def list_art() -> dict:
    art = {kind: {} for kind in ART_KINDS}
    for kind in ART_KINDS:
        folder = ART_DIR / kind
        if not folder.is_dir():
            continue
        for file in sorted(folder.iterdir()):
            if file.is_file() and file.suffix.lower() in ART_EXTENSIONS:
                art[kind][file.stem] = f"art/{kind}/{urllib.parse.quote(file.name)}"
    aliases_path = ART_DIR / "aliases.json"
    aliases = {}
    if aliases_path.exists():
        try:
            with aliases_path.open(encoding="utf-8-sig") as f:  # -sig: tolerate files saved by Notepad
                aliases = json.load(f)
        except (OSError, ValueError) as exc:
            print(f"Warning: could not read {aliases_path}: {exc}", file=sys.stderr)
    art["aliases"] = aliases
    return art


class Handler(SimpleHTTPRequestHandler):
    # Make sure these are right regardless of the Windows registry.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
    }

    MAX_BODY_BYTES = 4096

    def __init__(self, *args, config: dict, config_path: Path, **kwargs):
        self.config = config
        self.config_path = config_path
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    # --- Request safety ---------------------------------------------------------
    # The server only listens on this computer, but web pages from other sites
    # open in the same browser could still try to send it requests. So:
    #  - the Host header must be this server (blocks "DNS rebinding" tricks);
    #  - changes (POST/PATCH/DELETE) must come from this site's own page
    #    (Origin header) and send JSON, which other sites can't do silently.

    def _own_hosts(self) -> set:
        port = self.server.server_address[1]
        return {f"localhost:{port}", f"127.0.0.1:{port}", f"[::1]:{port}"}

    def _check_host(self) -> None:
        if (self.headers.get("Host") or "").lower() not in self._own_hosts():
            raise ApiError(HTTPStatus.FORBIDDEN, "Requests must come from this computer's own address.")

    def _check_write_request(self) -> None:
        self._check_host()
        origin = (self.headers.get("Origin") or "").lower()
        if origin not in {f"http://{h}" for h in self._own_hosts()}:
            raise ApiError(HTTPStatus.FORBIDDEN, "Changes are only accepted from this site's own page.")

    def _read_json_body(self) -> dict:
        if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
            raise ApiError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Send the request as JSON.")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > self.MAX_BODY_BYTES:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Request too large.")
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "The request isn't valid JSON.")
        if not isinstance(body, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "The request must be a JSON object.")
        return body

    # --- Routing -----------------------------------------------------------------

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed)
        else:
            super().do_GET()

    def do_POST(self):
        self.handle_write("POST")

    def do_PATCH(self):
        self.handle_write("PATCH")

    def do_DELETE(self):
        self.handle_write("DELETE")

    def handle_write(self, method: str):
        """Device changes:
          POST   /api/devices        {uid, name?, skipCheck?}   add (checks the ID online first)
          PATCH  /api/devices/<uid>  {name}                     rename
          DELETE /api/devices/<uid>[?history=delete]            remove (optionally its saved games)
        Artwork:
          POST   /api/art/download   {}                         start downloading missing images
        """
        parsed = urllib.parse.urlparse(self.path)
        try:
            if not parsed.path.startswith("/api/"):
                raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED, "Not allowed.")
            self._check_write_request()
            if parsed.path.rstrip("/") == "/api/art/download" and method == "POST":
                self._read_json_body()
                return self.send_json(start_art_download(), HTTPStatus.ACCEPTED)
            parts = parsed.path.rstrip("/").split("/")  # ["", "api", "devices", <uid>?]
            if parts[:3] != ["", "api", "devices"] or len(parts) > 4:
                raise ApiError(HTTPStatus.NOT_FOUND, "Unknown API endpoint.")
            uid = urllib.parse.unquote(parts[3]) if len(parts) == 4 else None
            if method == "POST" and uid is None:
                body = self._read_json_body()
                result = add_device(self.config, self.config_path, body.get("uid"), body.get("name"),
                                    bool(body.get("skipCheck")))
                return self.send_json(result, HTTPStatus.CREATED)
            if method == "PATCH" and uid is not None:
                body = self._read_json_body()
                return self.send_json(rename_device(self.config, self.config_path, uid, body.get("name")))
            if method == "DELETE" and uid is not None:
                query = urllib.parse.parse_qs(parsed.query)
                delete_history = (query.get("history") or [""])[0] == "delete"
                return self.send_json(remove_device(self.config, self.config_path, uid, delete_history))
            raise ApiError(HTTPStatus.METHOD_NOT_ALLOWED, "Not allowed.")
        except ApiError as exc:
            return self.send_json(exc.payload, exc.status)
        except Exception as exc:  # report instead of dropping the connection
            return self.send_json({"error": f"Server error: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_api(self, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        try:
            self._check_host()
            if parsed.path == "/api/games":
                uid = (query.get("uid") or [""])[0].strip()
                if not UID_PATTERN.match(uid):
                    return self.send_json(
                        {"error": "Invalid device ID. Use letters, digits and dashes only."},
                        HTTPStatus.BAD_REQUEST,
                    )
                cached_only = (query.get("cached") or ["0"])[0] == "1"
                return self.send_json(get_games(self.config, uid, cached_only))
            if parsed.path == "/api/devices":
                return self.send_json({"devices": self.config.get("devices", [])})
            if parsed.path == "/api/art":
                return self.send_json(list_art())
            if parsed.path == "/api/art/download":
                return self.send_json(art_job_status())
            return self.send_json({"error": "Unknown API endpoint."}, HTTPStatus.NOT_FOUND)
        except ApiError as exc:
            return self.send_json(exc.payload, exc.status)
        except Exception as exc:  # report instead of dropping the connection
            return self.send_json(
                {"error": f"Server error: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR
            )

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Always serve the latest site files and art while developing locally.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        if self.path.startswith("/api/"):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description="Spirit Island game history server")
    parser.add_argument("--config", help="use another settings file instead of data/config.json")
    parser.add_argument("--port", type=int, help="overrides the port in the settings")
    parser.add_argument("--open", action="store_true", help="open the site in a browser")
    args = parser.parse_args()

    if args.config:
        config_path = Path(args.config).resolve()
    else:
        prepare_config()
        config_path = CONFIG_PATH
    config = load_config(config_path)
    port = args.port or int(config.get("port", 8080))
    DATA_DIR.mkdir(exist_ok=True)
    for kind in ART_KINDS:
        (ART_DIR / kind).mkdir(parents=True, exist_ok=True)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, config=config, config_path=config_path))
    except OSError as exc:
        print(f"Could not start on port {port}: {exc}", file=sys.stderr)
        print("Another program (or another copy of this server) may be using it.", file=sys.stderr)
        print("Close it, or change \"port\" in data/config.json.", file=sys.stderr)
        sys.exit(1)

    url = f"http://localhost:{port}/"
    print(f"Spirit Island history running at {url}  (Ctrl+C to stop)")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
