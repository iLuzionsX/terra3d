#!/usr/bin/env python3
"""Terra3D dev server — zero dependencies (Python 3 standard library).

Usage:
    python serve.py [port]   (default: 8000)
Then open http://localhost:8000
"""
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        # Windows registry often maps .js -> text/plain, which breaks ES modules.
        if str(path).endswith(".js"):
            return "text/javascript"
        if str(path).endswith(".mjs"):
            return "text/javascript"
        if str(path).endswith(".css"):
            return "text/css"
        if str(path).endswith(".html"):
            return "text/html"
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Terra3D dev server: http://localhost:{PORT}  (root: {ROOT})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
