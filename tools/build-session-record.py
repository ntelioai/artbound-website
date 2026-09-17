#!/usr/bin/env python3
"""
Turn a raw ArtBound session log into the public record file the session page reads.

    python3 tools/build-session-record.py tmp/2026-09-16-september-session.json \
        sessions/september-2026.json

The raw log carries every guest's phone number, and a WhatsApp message id carries
the recipient's number inside it (`wamid.HBgK<base64 msisdn>...`). Neither may ever
reach the repository root, because wrangler serves the root. Everything this script
writes is public by construction:

  * phone numbers are dropped; a guest is only ever a paddle number
  * message ids become a 16-hex fingerprint (sha256), which still lets the gallery
    match a published line back to its own WhatsApp record
  * operator-only traffic (`preview`) is counted but not published

It also precomputes the figures the page states, so the page never does arithmetic
on the log in the browser and the two can never disagree.
"""

import hashlib
import json
import re
import statistics
import sys
from datetime import datetime, timezone

OPERATOR_ONLY = {"preview"}

# Types the auction fans out to the whole room at once. One send per guest is one
# log line, so a single announcement can be seventeen near-identical rows. They
# carry a broadcast key, and the page folds a consecutive run of them into one
# line that names its recipients.
BROADCAST = {"template", "bid_alert", "outbid_alert"}


def broadcast_key(msg):
    """Same announcement, different recipient — the paddle is the only difference."""
    if msg["direction"] != "out" or msg["type"] not in BROADCAST:
        return None
    body = re.sub(r"#\d+", "#", msg.get("text") or "")
    lot = (msg.get("lot") or {}).get("key", "")
    template = (msg.get("template") or {}).get("name", "")
    return hashlib.sha1(
        "|".join([msg["type"], template, lot, body]).encode("utf-8")
    ).hexdigest()[:10]


def fingerprint(message_id):
    return hashlib.sha256(message_id.encode("utf-8")).hexdigest()[:16]


def parse(ts):
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def redact_message(msg):
    out = {
        "seq": msg["seq"],
        "time": msg["time"],
        "type": msg["type"],
        "direction": msg["direction"],
        "text": msg.get("text"),
        "text_source": msg.get("text_source"),
    }
    for key in ("text_note", "time_approximate", "button_id", "event", "amount",
                "paddle", "previous_amount", "detail", "buttons_source", "campaign_key"):
        if msg.get(key) is not None:
            out[key] = msg[key]

    participant = msg.get("participant")
    if participant:
        # The paddle is the whole identity. The phone number is not carried over.
        out["paddle"] = participant.get("paddle")
        out["rsvp"] = participant.get("rsvpStatus")

    lot = msg.get("lot")
    if lot:
        out["lot"] = lot["key"]
        out["lot_label"] = lot["label"]

    template = msg.get("template")
    if template:
        out["template"] = template.get("name")

    if msg.get("buttons"):
        out["buttons"] = [b["title"] if isinstance(b, dict) else b for b in msg["buttons"]]

    payload = msg.get("payload")
    if payload and payload.get("messageType"):
        out["media"] = payload["messageType"]

    key = broadcast_key(msg)
    if key:
        out["bkey"] = key

    wa = msg.get("whatsapp")
    if wa:
        delivery = {}
        if wa.get("message_id"):
            delivery["fp"] = fingerprint(wa["message_id"])
        for key in ("sent", "delivered", "read", "failed", "error_code", "error_detail"):
            if wa.get(key):
                delivery[key] = wa[key]
        out["delivery"] = delivery

    return out


def build_lots(sale, messages):
    """Per lot: the window, the audit trail, and what the trail settled on."""
    lots = []
    for index, lot in enumerate(sale["lots"], start=1):
        events = [m for m in messages
                  if m["type"] == "bid_event" and m.get("lot", {}).get("key") == lot["key"]]
        committed = [e for e in events if e["event"] == "committed"]
        rejected = [e for e in events if e["event"] == "precheck_rejected"]
        confirms = [e for e in events if e["event"] == "confirm_sent"]
        closed = next((e for e in events if e["event"] == "lot_closed"), None)

        ladder = []
        for event in sorted(events, key=lambda e: e["seq"]):
            if event["event"] in ("committed", "precheck_rejected"):
                ladder.append({
                    "time": event["time"],
                    "kind": "bid" if event["event"] == "committed" else "rejected",
                    "amount": event["amount"],
                    "paddle": event.get("paddle"),
                    "previous": event.get("previous_amount"),
                })

        sold = lot.get("soldPrice")
        lots.append({
            "n": index,
            "key": lot["key"],
            "name": lot["name"],
            "artist": lot["artist"],
            "openingBid": float(lot["startingBid"]),
            "increment": float(lot["bidIncrement"]),
            "opensAt": lot["opensAt"],
            "closesAt": lot["closesAt"],
            "opensLabel": lot["opensLabel"],
            "closesLabel": lot["closesLabel"],
            "label": lot["label"],
            "result": float(sold) if sold else None,
            "sold": bool(sold),
            "bids": len(committed),
            "confirmsSent": len(confirms),
            "unconfirmed": len(confirms) - len(committed),
            "rejected": len(rejected),
            "bidders": sorted({e["paddle"] for e in committed}, key=int),
            "winner": committed[-1]["paddle"] if committed else None,
            "closeNote": closed.get("detail") if closed else None,
            "ladder": ladder,
        })
    return lots


def build_stats(raw, published):
    messages = raw["messages"]
    participants = raw["participants"]

    outbound = [m for m in messages if m["direction"] == "out"]
    inbound = [m for m in messages if m["direction"] == "in"]
    system = [m for m in messages if m["direction"] == "system"]

    def count(field):
        return sum(1 for m in outbound if (m.get("whatsapp") or {}).get(field))

    failures = {}
    for message in outbound:
        wa = message.get("whatsapp") or {}
        if wa.get("error_code"):
            entry = failures.setdefault(wa["error_code"], {
                "code": wa["error_code"],
                "detail": wa.get("error_detail", ""),
                "count": 0,
            })
            entry["count"] += 1

    # Bot answer latency: an inbound turn and the next outbound message to the
    # same paddle. Inbound times are stamped 2s before the reply (see caveats),
    # so these are the pipeline's own figures, not a wall-clock measurement.
    latencies = []
    for index, message in enumerate(messages):
        if message["direction"] != "in":
            continue
        paddle = (message.get("participant") or {}).get("paddle")
        for later in messages[index + 1:index + 12]:
            if later["direction"] == "out" and (later.get("participant") or {}).get("paddle") == paddle:
                delta = (parse(later["time"]) - parse(message["time"])).total_seconds()
                if 0 <= delta <= 600:
                    latencies.append(delta)
                break

    times = [parse(m["time"]) for m in messages]
    lots = raw["sale"]["lots"]
    hammer = sum(float(lot["soldPrice"]) for lot in lots if lot.get("soldPrice"))

    return {
        "lotsOffered": len(lots),
        "lotsSold": sum(1 for lot in lots if lot.get("soldPrice")),
        "hammerTotal": hammer,
        "invited": len(participants),
        "accepted": sum(1 for p in participants if p["rsvpStatus"] == "accepted"),
        "declined": sum(1 for p in participants if p["rsvpStatus"] == "declined"),
        "paddles": sorted({p["paddle"] for p in participants if p["paddle"]}, key=int),
        "events": len(messages),
        "published": len(published),
        "withheld": len(messages) - len(published),
        "outbound": len(outbound),
        "inbound": len(inbound),
        "system": len(system),
        "sent": count("sent"),
        "delivered": count("delivered"),
        "read": count("read"),
        "failed": count("failed"),
        "failures": sorted(failures.values(), key=lambda f: -f["count"]),
        "replyMedian": round(statistics.median(latencies), 1) if latencies else None,
        "replyCount": len(latencies),
        "replyMax": round(max(latencies), 1) if latencies else None,
        "firstEvent": min(times).isoformat().replace("+00:00", "Z"),
        "lastEvent": max(times).isoformat().replace("+00:00", "Z"),
        "runtimeMinutes": round((max(times) - min(times)).total_seconds() / 60),
    }


def main():
    source, destination = sys.argv[1], sys.argv[2]
    raw = json.load(open(source))

    published = [redact_message(m) for m in raw["messages"] if m["type"] not in OPERATOR_ONLY]

    record = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sale": {
            "reference": raw["sale"]["auctionKey"],
            "displayName": raw["sale"]["displayName"],
            "timezone": raw["sale"]["timezone"],
        },
        "lots": build_lots(raw["sale"], raw["messages"]),
        "stats": build_stats(raw, published),
        "sources": raw["sources"],
        "caveats": raw["caveats"],
        "redactions": [
            "Guests appear by paddle number only. No phone number, name or contact detail is published.",
            "WhatsApp message ids are replaced by a 16-character SHA-256 fingerprint; the gallery can match any published line back to its own record, and the fingerprint reveals nothing on its own.",
            "%d operator-only message(s) — wording previews sent to the gallery's own handset, never to a guest — are counted in the totals but not printed." % (len(raw["messages"]) - len(published)),
        ],
        "messages": published,
    }

    with open(destination, "w") as handle:
        json.dump(record, handle, ensure_ascii=False, separators=(",", ":"))

    stats = record["stats"]
    print("wrote %s — %d of %d events, %d lots" % (
        destination, stats["published"], stats["events"], len(record["lots"])))
    print("  hammer USD %s · %d/%d sold · delivered %d/%d · read %d · failed %d" % (
        f"{stats['hammerTotal']:,.0f}", stats["lotsSold"], stats["lotsOffered"],
        stats["delivered"], stats["sent"], stats["read"], stats["failed"]))
    print("  median reply %ss over %d turns" % (stats["replyMedian"], stats["replyCount"]))


if __name__ == "__main__":
    main()
