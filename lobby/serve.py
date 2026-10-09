"""Tiny static server for local development (no caching, so edits show up on reload).
POST /__shot saves a PNG data-URL body to BREW_SHOTS (dev-only screenshot hook).
Usage: serve.py [port] [root]  (root defaults to this folder; e.g. `kitchen` for the night kitchen)."""
import http.server, functools, os, sys, base64

SHOTS = os.environ.get('BREW_SHOTS') or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.shots')

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path.startswith('/__shot') and SHOTS:
            n = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(n).decode()
            name = self.path.split('name=')[-1] if 'name=' in self.path else 'shot'
            os.makedirs(SHOTS, exist_ok=True)
            with open(os.path.join(SHOTS, name + '.jpg'), 'wb') as f:
                f.write(base64.b64decode(data.split(',', 1)[1]))
            self.send_response(204); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(os.path.dirname(here), sys.argv[2]) if len(sys.argv) > 2 else here
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(NoCache, directory=root)).serve_forever()
