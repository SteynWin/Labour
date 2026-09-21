# Labour

Weekly labour planning tool — allocate team mates to jobs for each work day (Monday–Friday).

## Usage

This is a plain HTML/CSS/JS app with no build step or server required.

1. Open `index.html` in your browser (double-click it, or serve the folder with any static server), or visit the hosted GitHub Pages link.
2. Pick the **Week starting (Monday)** date.
3. In **Add a Task**: pick the **Date**, pick a **Job** (use **+ Add** the first time to create one), tick one or more **Team Mate**(s), describe the **Task**, then click **+ Add to Plan**.
4. The **Weekly Plan** below updates live, grouped by day. Use the pencil (✎) on any row to edit it, or × to remove it.
5. Click **Export as PDF** to print/save the plan as a PDF (uses your browser's print dialog — choose "Save as PDF" as the destination).
6. Use **Download Backup** / **Restore Backup** at the bottom to save or move your data, and **Clear Data** to wipe the current week's tasks and start over (Jobs and Team Mates are kept).

## Team sync (optional)

By default, data is saved only in your own browser. To let several managers
fill this in from their own phones and see each other's changes live, see
[`SETUP-TEAM-SYNC.md`](./SETUP-TEAM-SYNC.md) — a one-time, free Firebase setup.
Until that's done, the app works exactly as described above with no setup
needed, and nothing is sent anywhere.
