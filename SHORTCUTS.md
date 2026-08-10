# The three Shortcuts

One for capture, two for iCloud. Build them once.

Pick a folder in iCloud Drive first — this guide assumes **iCloud Drive / Roadkeep /**.

---

## 1. "Mark road" — capture during the ride

The one that has to work every time. No dictation, no thinking.

**Shortcuts → + → add in order:**

1. **Get Current Location**
2. **Get Details of Locations** → `Latitude` ← Current Location
3. **Get Details of Locations** → `Longitude` ← Current Location
4. **Format Date** → Date: `Current Date`, Format: **ISO 8601**, Include Time: on
5. **Text**, with the variables inserted:
   ```
   [Formatted Date],[Latitude],[Longitude],
   ```
   The trailing comma is the empty note field.
6. **Append to Note** → a note called `Road Markers`
7. **Speak Text** → `marked`

Settings (ⓘ): name it exactly **Mark road**, **Allow Running When Locked** on, **Ask Before Running** off.

### The format doesn't have to match exactly

Roadkeep also reads labelled blocks, which is what several ready-made "log position" shortcuts produce:

```
Date: 10.08.2026, 21:03
Description: Ortsausfahrt Eckental
Position: 49.58892229289478/11.21561751719265
```

German `DD.MM.YYYY` dates, `/` or `,` or a space between the coordinates, and English or German labels (`Datum`, `Beschreibung`, `Standort`, `Koordinaten`) all work. A new `Date:` line starts a new mark. If your existing shortcut already writes something like this, keep it.

Coordinates matter more than the timestamp: `21:03` is only minute-accurate, while a logged position is exact. When both are present, Roadkeep matches on position and uses the time only to disambiguate a road you rode twice in one day.

Test it in the kitchen: "Hey Siri, mark road" should answer "marked" within about two seconds.

**Why a Note and not Notion or a direct upload:** Notes appends offline and syncs later. Anything that needs a connection at the moment you press it will fail silently exactly where the good roads are.

Optional second version, **Mark road note**, with a **Dictate Text** action feeding the last field. Expect it to fail in wind — Siri often can't detect the end of speech over sustained noise. Use it at a stop.

---

## 2. "Save Roadkeep" — app → iCloud

The app copies the vault to the clipboard, then hands over to this.

1. **Get Clipboard**
2. **Save File**
   - Service: **iCloud Drive**
   - Destination path: `Roadkeep/roadkeep.json`
   - **Ask Where to Save: OFF**
   - **Overwrite If File Exists: ON**
3. **Show Notification** → `Roadkeep saved` (so you know it worked)

Name it exactly **Save Roadkeep**, or rename it and put your name into the app under **Sync → Shortcut names**.

Overwrite must be on. Without it you'll accumulate `roadkeep 2.json`, `roadkeep 3.json` and lose track of which is current.

---

## 3. "Load Roadkeep" — iCloud → app

1. **Get File**
   - Service: **iCloud Drive**
   - Path: `Roadkeep/roadkeep.json`
   - **Show Document Picker: OFF**
   - **Error If Not Found: OFF**
2. **Get Text from Input** ← File
3. **Copy to Clipboard**
4. **Show Notification** → `Roadkeep on clipboard`

Name it **Load Roadkeep**.

Then switch back to the app and tap **Sync → Paste vault from clipboard**. iOS will show its paste confirmation; allow it. The merge keeps the newer version of every segment on both sides, so nothing is lost either way.

---

## Why the clipboard

iOS gives web apps no file system access and no iCloud API. URL schemes can carry a little data but choke on a full vault. The clipboard has no practical size limit and Shortcuts can read and write iCloud Drive freely — so the clipboard is the bridge. It is a workaround, but a stable one.

If the clipboard is ever blocked, everything still works through **Sync → Share / save file…** (share sheet → Save to Files → Replace) and **Open file…**. Slower, same result.

---

## Daily rhythm

| When | Do |
|---|---|
| Riding | Record the track with whatever you navigate with, and say "Hey Siri, mark road" |
| Home, before editing | Load Roadkeep → Paste, if you last edited elsewhere |
| Home, after editing | Save to iCloud |
| Desktop Chrome | Link the file once; it saves itself from then on |

If you only ever edit on one device, you can skip Load entirely and just Save.
