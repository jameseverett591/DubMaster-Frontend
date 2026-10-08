"""Export YouTube/Google cookies from a Firefox profile to Netscape format.

Why this exists instead of `yt-dlp --cookies-from-browser`:

- YouTube rotates session cookies on active browsing, so the durable source
  is a dedicated Firefox profile nobody browses YouTube on (Firefox also
  lets its cookie DB be read while running — Chrome does not).
- yt-dlp's own Firefox extractor silently dropped the auth cookies
  (LOGIN_INFO, SID, SAPISID) on this setup — the direct sqlite read
  doesn't.
- moz_cookies.expiry is in SECONDS; creationTime/lastAccessed are in
  MICROSECONDS. Mixing that up writes cookies that expired in 1970 and
  the jar silently discards them (the "9 anonymous cookies" bug).

Usage (from repo root, backend running) — the backend image copies only
app/, so the script itself has to be docker cp'd in, same as the DB:

    docker cp "%APPDATA%\\Mozilla\\Firefox\\Profiles\\<profile>\\cookies.sqlite" \
        dubverse-backend:/tmp/cookies.sqlite
    docker cp "Dubverse Backend\\scripts\\export_yt_cookies.py" \
        dubverse-backend:/tmp/export_yt_cookies.py
    docker exec dubverse-backend python /tmp/export_yt_cookies.py

Writes /app/data/yt_cookies.txt (volume-mounted -> host data/) with
owner-only permissions — it holds live Google session credentials. No
restart needed — the service reads the file per request (io.StringIO).
"""

import os
import sqlite3
import sys

SQLITE_PATH = sys.argv[1] if len(sys.argv) > 1 else "/tmp/cookies.sqlite"
OUT_PATH = sys.argv[2] if len(sys.argv) > 2 else "/app/data/yt_cookies.txt"

con = sqlite3.connect(SQLITE_PATH)
cur = con.execute(
    "SELECT host, path, isSecure, expiry, name, value FROM moz_cookies "
    "WHERE host LIKE '%youtube%' OR host LIKE '%google%'"
)

lines = ["# Netscape HTTP Cookie File", ""]
n = 0
for host, path, secure, expiry, name, value in cur.fetchall():
    flag = "TRUE" if host.startswith(".") else "FALSE"
    sec = "TRUE" if secure else "FALSE"
    exp = str(int(expiry)) if expiry else "0"  # seconds, NOT microseconds
    lines.append("\t".join([host, flag, path, sec, exp, name, value]))
    n += 1

# Owner-only: the file is bind-mounted to the host and carries plaintext
# YouTube/Google session cookies — default umask would leave it readable
# by other local users.
fd = os.open(OUT_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write("\n".join(lines) + "\n")
os.chmod(OUT_PATH, 0o600)  # tighten an existing file too

print(f"wrote {n} cookies -> {OUT_PATH}")
