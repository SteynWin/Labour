# Labour

Weekly labour planning tool — allocate employers to jobs for each work day (Monday–Friday).

## Usage

This is a plain HTML/CSS/JS app with no build step or server required.

1. Open `index.html` in your browser (double-click it, or serve the folder with any static server).
2. **Setup**: add your jobs and employers once — they're saved in your browser (`localStorage`) and reused every week.
3. **Week starting**: pick the Monday of the week you're planning.
4. For each day (Mon–Fri), select a job, describe the task, and assign the employer responsible. Use **+ Add task** for multiple tasks in a day.
5. Click **Generate Weekly Plan** — every day must have at least one complete task before it will proceed.
6. On the results screen, click **Export as PDF** to print/save the plan as a PDF (uses your browser's print dialog — choose "Save as PDF" as the destination).

All data stays in your browser; nothing is sent anywhere.
