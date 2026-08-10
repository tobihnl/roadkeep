# Roadkeep

**Keep the good stretches, not whole routes.**

Every navigation app can save a point or a whole route. None of them can save *the eleven kilometres between two villages that were unexpectedly brilliant*. Roadkeep does that, and only that.

Mark a road while you're riding, cut the segment out of your recorded track when you get home, rate it, and watch a personal map of good roads build up over the seasons. Then feed those segments back into whatever you actually navigate with.

**[→ Open Roadkeep](https://example.github.io/roadkeep/)** · works on desktop and installs to an iPhone home screen

---

## Why

A saved route gets less useful as your list grows — you scroll past it. A map of marked segments gets *more* useful, because the value is density in a region, not count. Fifteen segments scattered across Europe is a scrapbook. Fifteen inside an hour's ride of home is something you plan against.

It also shows you where you have never been. The blank quadrants turn out to be as useful as the marked ones.

## What it does

- **Cut segments from a recorded ride.** Drop in a `.gpx`, paste the timestamps you logged while riding, and each one becomes a proposed segment reaching back from where you pressed.
- **Or highlight by hand.** Tap the track where the good bit starts, tap again where it ends. Drag the endpoints along the road afterwards.
- **Suggest curvy stretches.** Curvature analysis proposes the twistiest windows of a ride when you forgot to mark anything.
- **Rate, tag and date them.** Rating, surface, season and traffic notes, and a *last confirmed* date — because a five-year-old claim about a gravel road is a claim, not a fact. Stale segments visibly fade.
- **Record the bad ones too.** "Avoid — gated, no through route" saves more time than another five-star curve, and nothing else has a place to put it.
- **Export back into your navigation.** GPX tracks, or shaping waypoints that force a router through the segment. Also CSV and a Markdown table.
- **Find them again.** Colour by rating or by surface, filter for stale, or ask what's near you.

## What it deliberately doesn't do

No turn-by-turn navigation, no routing engine, no offline vector maps, no social feed, no leaderboards, no timing. Plenty of apps already navigate well; this is a sidecar to whichever one you use, not a competitor. Nothing about it is a race.

## Works with whatever you already ride with

Any GPX track with timestamps will do — Kurviger, calimoto, Scenic, OsmAnd, a Garmin, a dedicated GPS logger, or a track someone sent you. Roadkeep reads `<trkpt>`, falls back to `<rtept>` and `<wpt>`, and if there are no timestamps at all it matches your marks by coordinates instead. Nothing is assumed about where the file came from.

## Your data is yours

There is no account, no server and no analytics. Everything lives on your device and in a plain JSON file you own and can read without this app.

On desktop Chrome or Edge it writes straight into a file you pick. On iPhone it saves to iCloud Drive through a Shortcut. Both ends can edit: every segment carries a last-modified time and deletions leave tombstones, so merging a phone copy into a desktop copy keeps the newer version of each segment and never silently drops one.

Put the file in iCloud or Dropbox and your map follows you between machines. Hand it to a friend and they get your roads — segments travel better than routes, because their start point isn't yours.

## Getting started

1. Open the link above and add it to your home screen (Safari → Share → Add to Home Screen).
2. Set up the three Shortcuts in **[SHORTCUTS.md](SHORTCUTS.md)** — one to mark roads while riding, two to move the file in and out of iCloud.
3. Record your rides with anything that exports GPX — timestamps make the matching precise, but aren't required.
4. After a ride: load the GPX, paste your marks, review, save.

## Built with

[Leaflet](https://leafletjs.com) for the map, [OpenStreetMap](https://www.openstreetmap.org/copyright) for tiles, and [Nominatim](https://nominatim.org) for place names.

## Status

Personal project, in active use in Franconia and the Alps. Expect rough edges.

## Licence

**Copyright © 2026 Tobias Heinl. All rights reserved.**

This is not open source. The source is visible because browsers require it to be, but no permission is granted to copy, modify, redistribute or run your own instance. See [LICENSE](LICENSE).

Get in touch if you want to use it.
