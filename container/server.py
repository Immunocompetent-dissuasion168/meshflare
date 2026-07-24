#!/usr/bin/env python3
"""HTTP front-end for meshflare WireGuard extraction (Coolify / Docker)."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


AUTH_SECRET = os.environ.get("WG_EXTRACTOR_SECRET", "").strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[wg] {self.address_string()} - {fmt % args}", flush=True)

    def _send(self, code: int, body: bytes, content_type: str = "text/plain") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not AUTH_SECRET:
            return True
        auth = self.headers.get("Authorization", "")
        if auth == f"Bearer {AUTH_SECRET}":
            return True
        return self.headers.get("X-Meshflare-Secret", "") == AUTH_SECRET

    def do_GET(self) -> None:
        if self.path in ("/", "/health"):
            self._send(200, b"ok")
            return
        self._send(404, b"not found")

    def do_POST(self) -> None:
        if self.path != "/extract":
            self._send(404, b"not found")
            return
        if not self._authorized():
            self._send(401, b"unauthorized")
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, b"invalid json")
            return

        token = payload.get("token")
        if not token or not isinstance(token, str):
            self._send(400, b"token required")
            return

        env = os.environ.copy()
        env["CONNECTOR_TOKEN"] = token

        with tempfile.TemporaryDirectory(prefix="warp-"):
            subprocess.run(["rm", "-rf", "/var/lib/cloudflare-warp"], check=False)
            subprocess.run(["mkdir", "-p", "/var/lib/cloudflare-warp", "/run/dbus"], check=False)

            try:
                result = subprocess.run(
                    ["/app/extract.sh"],
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                self._send(504, b"extract timed out")
                return

            if result.returncode != 0:
                err = (result.stderr or result.stdout or "extract failed").encode()
                self._send(500, err)
                return

            self._send(200, result.stdout.encode(), "text/plain; charset=utf-8")


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"meshflare wg extractor listening on {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
