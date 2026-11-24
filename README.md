# Spirit Island — Run History

A local website showing the game history of the digital Spirit Island app:
every finished game, with filters, statistics and spirit/adversary art.

It reads your games from the online feed at
`https://mindwanderer.net/si/player/json.cgi?uid=<device ID>` and keeps its own
copy on your computer, so older games stay in your history even if the feed
stops returning them, and the site still works offline.

## Quick start

1. Download the latest version from the project's **Releases** page on GitHub
   and unzip it:
   - **`…-windows-with-python.zip`** if you don't have Python: it includes a
     portable Python, nothing to install (Windows only);
   - **`spirit-island-history-<version>.zip`** if you already have
     **Python 3.9 or newer**.
2. Double-click **`start.bat`**. Your browser opens on a welcome screen.
3. Follow the instructions to obtain and paste your device ID and press **Check & save**.
4. Press **Download artwork** for the spirit and adversary pictures.

To update to a newer version, unzip it and copy your old copy's **`data`**
folder into it: that folder holds your devices and game history.

## Devices

Each device running Spirit Island has its own device ID. To find it:

1. Open the Spirit Island digital app.
2. Go to **Statistics → Personal Report**. A web page opens.
3. Scroll to the bottom of that page and copy the code after **"Device id:"**.

- **First use**: with no device set up, the site opens on a welcome screen. Paste
  your device ID (and a name, if you like) and press **Check & save**: the site
  checks the ID with the online feed, saves it and loads your games.
- **Later**: the **Device** menu → **Add or manage devices…** adds more devices,
  renames them or removes them. Removing a device keeps its saved games unless
  you tick "Also delete its saved game history".
- With two or more devices the menu also has **All devices**, which merges their
  histories (each game shows its device).
- A link with `?uid=<device ID>` opens that device without saving it (it shows
  as "not saved" in the menu).

The site remembers the last device you looked at. Devices are stored in
`data/config.json`; you can also edit that file by hand (restart the server
afterwards):

```json
{
  "port": 8080,
  "feedUrl": "https://mindwanderer.net/si/player/json.cgi?uid={uid}",
  "devices": [
    { "name": "My PC",  "uid": "paste-your-device-id-here" },
    { "name": "Tablet", "uid": "paste-the-other-device-id-here" }
  ]
}
```

## Using the site

- **History**: every game, newest first. Click a column header to sort, click a
  game (or press Enter on it) for its details: setup, end-of-game state, power
  cards and discard pile. In the details, ← / → move between games, Esc closes.
- **Statistics**: win rate, streaks, hardest and fastest wins, games over time,
  and win rates by spirit, adversary, difficulty and number of spirits. Click a
  row to filter to it. Abandoned games count as defeats in win rates and
  streaks (false starts are already hidden); to leave abandoned games out,
  tick "Hide abandoned games" in the filters.
- **Filters** (left side; behind the "Filters" button on a phone): search
  (spirits, adversaries, power cards, blight cards…), wins/losses, hide
  abandoned, spirits (any of / all together), number of spirits, adversary and
  level, difficulty, dates, how the game ended, boards, layout, blight card.
  Each option shows how many games it would match. Press **/** to jump to the
  search box.
- **Aspects** are listed under their spirit (for spirits you've played with an
  aspect), with "Base (no aspect)" for games without one. Tick the spirit for
  every version of it, or an aspect for just that version; ticking an aspect
  narrows its spirit, which then shows a dash.
- **False starts** (games abandoned on turn 0, usually a start with the wrong
  setup) are hidden everywhere by default: history, filters, statistics and
  exports. Untick "Hide false starts" under Result to see them. It's a setting,
  not a filter, so "Clear all" leaves it as it is.
- Filters, sort order and view are kept in the page address, so **bookmark a
  view** to come back to it.
- **Export**: the CSV / JSON buttons download the games currently shown (after
  filters). CSV opens in Excel or Google Sheets; JSON has the original records.
- **Theme**: Auto (follows Windows), Light or Dark, top right.

**Note**: The feed uses data from <https://mindwanderer.net>, which can take up to a few days to update with your newest games.

## Art

The spirit, aspect and adversary pictures come from
<https://mindwanderer.net/si/>.
They belong to the game's makers, so they aren't included with this project:
the site downloads them when asked.

- On a fresh copy, a **Download artwork** banner appears above the history
  (about 5 MB).
- Later, when the game adds a spirit or adversary, the footer's "Art: … missing"
  line has a **Download missing artwork** button. Images already there are
  skipped.

When a spirit was played with an aspect, the aspect's art is shown.
