#!/usr/bin/env python3
"""
Local dev server for Bowling Machine Controller.
Serves static files and handles POST /generate to regenerate bowling_data.json.

Usage:
    python3 server.py
    Then open http://localhost:8080 in a browser.
"""
import json
import os
import shutil
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, 'Configs', 'BLR'))
from lane1main import generate_minimal_bowling_dataset_with_rpm_map


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/generate':
            try:
                length = int(self.headers['Content-Length'])
                body = json.loads(self.rfile.read(length))

                # rpm_map keys come in as strings from JSON; convert to int:float
                rpm_map = {int(k): float(v) for k, v in body.get('rpm_map', {}).items()}
                speed_group_tuning = body.get('speed_group_tuning', {})

                out_root   = os.path.join(BASE_DIR, 'bowling_data.json')
                out_config = os.path.join(BASE_DIR, 'Configs', 'BLR', 'pitch-mapping.json')

                generate_minimal_bowling_dataset_with_rpm_map(
                    speed_rpm_map=rpm_map,
                    speed_group_tuning=speed_group_tuning,
                    output_filename=out_root,
                )
                shutil.copy2(out_root, out_config)

                size_mb = os.path.getsize(out_root) / (1024 * 1024)
                self._json(200, {'status': 'ok', 'size_mb': round(size_mb, 2)})

            except Exception as exc:
                self._json(500, {'status': 'error', 'message': str(exc)})
        else:
            self._json(404, {'status': 'not found'})

    def end_headers(self):
        # Prevent browser from caching bowling_data.json so a regenerate is always picked up
        if self.path and 'bowling_data.json' in self.path:
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f'  {self.address_string()}  {fmt % args}')


if __name__ == '__main__':
    port = 8080
    os.chdir(BASE_DIR)
    httpd = HTTPServer(('localhost', port), Handler)
    print(f'Bowling Machine Server running at http://localhost:{port}')
    print('Press Ctrl+C to stop.')
    httpd.serve_forever()
