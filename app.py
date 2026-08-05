import http.server
import os
import subprocess
import sys

PORT = int(os.environ.get("PORT", 8501))
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

def build_if_needed():
    out_dir = os.path.join(PROJECT_DIR, "out")
    if os.path.exists(out_dir):
        print("[app.py] out/ already exists, skipping build")
        return out_dir

    node_modules = os.path.join(PROJECT_DIR, "node_modules")
    if not os.path.exists(node_modules):
        print("[app.py] Installing npm dependencies...")
        result = subprocess.run(
            ["npm", "install"],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            print(f"[app.py] npm install failed: {result.stderr}")
            sys.exit(1)
        print("[app.py] npm install complete")

    print("[app.py] Building Next.js project...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=PROJECT_DIR,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        print(f"[app.py] npm run build failed: {result.stderr}")
        sys.exit(1)
    print("[app.py] Build complete")

    if not os.path.exists(out_dir):
        print(f"[app.py] ERROR: out/ directory not found after build")
        sys.exit(1)

    return out_dir

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # SPA fallback: serve index.html for non-file routes
        out_dir = os.path.join(PROJECT_DIR, "out")
        path = self.translate_path(self.path)
        if not os.path.exists(path) and not self.path.startswith("/_next"):
            self.path = "/index.html"
        return super().do_GET()

    def end_headers(self):
        # Add CORS headers for JSON files
        if self.path.endswith(".json"):
            self.send_header("Content-Type", "application/json")
        super().end_headers()

if __name__ == "__main__":
    out_dir = build_if_needed()
    os.chdir(out_dir)
    print(f"[app.py] Serving static files from {out_dir} on port {PORT}")

    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
