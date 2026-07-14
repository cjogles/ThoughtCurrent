#!/usr/bin/env python3
"""
slack-grep — workspace-wide keyword/topic search over Slack.

Uses the native Slack `search.messages` API with your USER token (scope
`search:read`), so it searches the ENTIRE workspace in one paginated call
instead of compiling 253 channels' history. Rate-limit safe by design:
one endpoint, polite inter-request delay, and honors HTTP 429 Retry-After.

The token is read from ThoughtCurrent's .env at runtime and is never printed.

Examples
--------
  # Everything mentioning "jackson" in the last 90 days
  ./slack-grep.py --query jackson --days 90

  # A topic / exact phrase, last 6 months, only a given channel
  ./slack-grep.py --query '"page reset"' --days 180 --in msgr_my_designer_lab

  # What a specific person said about a topic, explicit date window
  ./slack-grep.py --query tinymce --from caleb --after 2026-01-01 --before 2026-06-26

  # Pulse check: confirm the token works without scanning anything heavy
  ./slack-grep.py --selftest

  # JSON out (for piping into jq / further grep)
  ./slack-grep.py --query lotus --days 30 --json > /tmp/hits.json

Flags
-----
  --query TEXT       Search terms. Slack search syntax works: quotes for exact
                     phrases, OR, -exclude, etc. Required (unless --selftest).
  --days N           Look back N days from today (sets after:).
  --after  YYYY-MM-DD / --before YYYY-MM-DD   Explicit window (override --days).
  --in CHANNEL       Restrict to a channel name (repeatable). No leading '#'.
  --from USER        Restrict to an author handle/name (repeatable). No '@'.
  --max-pages N      Hard cap on pages (default 100; Slack ~100 max). Safety.
  --delay SECONDS    Polite delay between API calls (default 3.0 ≈ 20/min).
  --count N          Results per page (default 100, Slack max).
  --json             Emit raw JSON array instead of the human report.
  --selftest         Verify token + connectivity with a 1-result query, exit.
"""

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

SLACK_API = "https://slack.com/api"
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")


def log(msg: str) -> None:
    """Pulse-check output — goes to stderr so --json stdout stays clean."""
    print(f"[slack-grep] {msg}", file=sys.stderr, flush=True)


def load_user_token() -> str:
    """Read SLACK_USER_TOKEN from env or ThoughtCurrent/.env. Never logged."""
    tok = os.environ.get("SLACK_USER_TOKEN")
    if tok:
        return tok.strip()
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == "SLACK_USER_TOKEN":
                    return v.strip().strip('"').strip("'")
    log(f"ERROR: SLACK_USER_TOKEN not found in env or {ENV_PATH}")
    sys.exit(2)


def slack_api(method: str, params: dict, token: str, max_retries: int = 4) -> dict:
    """Call Slack Web API with retry on 429 (Retry-After) and body ratelimited."""
    url = f"{SLACK_API}/{method}?" + urllib.parse.urlencode(params)
    for attempt in range(max_retries + 1):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get("Retry-After", "5"))
                log(f"rate limited ({method}), waiting {wait}s "
                    f"(attempt {attempt + 1}/{max_retries + 1})")
                time.sleep(wait)
                continue
            log(f"ERROR: {method} HTTP {e.code}: {e.reason}")
            sys.exit(1)
        if not data.get("ok"):
            if data.get("error") == "ratelimited":
                log(f"rate limited body ({method}), waiting 5s "
                    f"(attempt {attempt + 1}/{max_retries + 1})")
                time.sleep(5)
                continue
            log(f"ERROR: {method}: {data.get('error')}")
            sys.exit(1)
        return data
    log(f"ERROR: {method} still rate limited after {max_retries + 1} attempts")
    sys.exit(1)


_user_cache: dict = {}


def resolve_user(uid: str, token: str, delay: float) -> str:
    if not uid:
        return "Unknown"
    if uid in _user_cache:
        return _user_cache[uid]
    try:
        data = slack_api("users.info", {"user": uid}, token)
        u = data.get("user", {})
        name = u.get("real_name") or u.get("name") or uid
    except SystemExit:
        name = uid
    _user_cache[uid] = name
    time.sleep(delay)
    return name


def build_query(args) -> str:
    parts = []
    if args.query:
        parts.append(args.query)
    # date window
    if args.after:
        after = args.after
    elif args.days:
        after = (dt.date.today() - dt.timedelta(days=args.days)).isoformat()
    else:
        after = None
    if after:
        parts.append(f"after:{after}")
    if args.before:
        parts.append(f"before:{args.before}")
    for ch in (args.in_ or []):
        parts.append(f"in:#{ch.lstrip('#')}")
    for u in (args.from_ or []):
        parts.append(f"from:@{u.lstrip('@')}")
    return " ".join(parts).strip()


def search(query: str, token: str, args) -> list:
    matches = []
    page = 1
    total_pages = 1
    log(f"query: {query}")
    while page <= total_pages and page <= args.max_pages:
        data = slack_api(
            "search.messages",
            {"query": query, "page": str(page), "count": str(args.count),
             "sort": "timestamp", "sort_dir": "desc"},
            token,
        )
        m = data.get("messages", {})
        page_matches = m.get("matches", [])
        paging = m.get("paging", {})
        total = paging.get("total", len(page_matches))
        total_pages = paging.get("pages", 1)
        matches.extend(page_matches)
        log(f"page {page}/{total_pages} — {len(page_matches)} hits "
            f"(running total {len(matches)} of ~{total})")
        page += 1
        if page <= total_pages and page <= args.max_pages:
            time.sleep(args.delay)
    return matches


def human_report(matches: list, token: str, args) -> None:
    if not matches:
        print("\nNo matches.")
        return
    # group by channel
    by_channel: dict = {}
    for mt in matches:
        ch = (mt.get("channel") or {}).get("name", "unknown")
        by_channel.setdefault(ch, []).append(mt)

    print(f"\n=== {len(matches)} matches across {len(by_channel)} channels ===\n")
    for ch in sorted(by_channel, key=lambda c: -len(by_channel[c])):
        msgs = by_channel[ch]
        print(f"#{ch}  ({len(msgs)})")
        for mt in sorted(msgs, key=lambda x: x.get("ts", ""), reverse=True):
            author = mt.get("username") or resolve_user(mt.get("user", ""), token, args.delay)
            ts = mt.get("ts", "0")
            try:
                when = dt.datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d %H:%M")
            except (ValueError, OSError):
                when = ts
            text = " ".join((mt.get("text") or "").split())
            if len(text) > 280:
                text = text[:277] + "..."
            print(f"  • [{when}] {author}: {text}")
            link = mt.get("permalink")
            if link:
                print(f"    {link}")
        print()


def main() -> None:
    p = argparse.ArgumentParser(description="Workspace-wide Slack keyword search.")
    p.add_argument("--query")
    p.add_argument("--days", type=int)
    p.add_argument("--after")
    p.add_argument("--before")
    p.add_argument("--in", dest="in_", action="append")
    p.add_argument("--from", dest="from_", action="append")
    p.add_argument("--max-pages", dest="max_pages", type=int, default=100)
    p.add_argument("--delay", type=float, default=3.0)
    p.add_argument("--count", type=int, default=100)
    p.add_argument("--json", action="store_true")
    p.add_argument("--selftest", action="store_true")
    args = p.parse_args()

    token = load_user_token()

    if args.selftest:
        log("self-test: confirming token + search.messages reachability...")
        # 'thanks' is a non-stopword that virtually any active workspace contains;
        # ok:true already proves the token, the count proves search actually returns.
        data = slack_api("search.messages", {"query": "thanks", "count": "1"}, token)
        total = data.get("messages", {}).get("paging", {}).get("total", "?")
        log(f"OK — token valid, search reachable (~{total} msgs match 'thanks').")
        print("selftest: PASS")
        return

    if not args.query:
        log("ERROR: --query is required (or use --selftest)")
        sys.exit(2)

    query = build_query(args)
    matches = search(query, token, args)

    if args.json:
        print(json.dumps(matches, indent=2))
    else:
        human_report(matches, token, args)
    log(f"done — {len(matches)} total matches")


if __name__ == "__main__":
    main()
