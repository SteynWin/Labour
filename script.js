(function () {
  "use strict";

  var FORTNIGHT_LENGTH = 14;
  var DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

  // ---------- State (kept in sync from PlannerStore.onChange) ----------
  var jobs = [];
  var employers = [];
  var plans = {}; // flat: ISO date -> [entry, ...]
  var reminders = []; // [{ id, date, text }, ...]
  var currentFortnightStart = null; // ISO date string (a Monday)
  var editingGroup = null; // { entries: [{date, entry}, ...] } currently loaded into the form, or null
  var pendingJobSelection = null;
  var pendingEmployerSelections = [];
  var toggledDates = {}; // ISO date -> true, for the Add a Task day-toggle row

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Date helpers ----------
  function toISODate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function parseISODate(iso) {
    var parts = iso.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function mondayOf(date) {
    var d = new Date(date);
    var dow = d.getDay(); // 0 Sun .. 6 Sat
    var diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    var d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function formatDisplayDate(date) {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function fortnightDates() {
    var monday = parseISODate(currentFortnightStart);
    var out = [];
    for (var i = 0; i < FORTNIGHT_LENGTH; i++) {
      out.push(toISODate(addDays(monday, i)));
    }
    return out;
  }

  // Mon-Fri only, across both weeks (10 dates) - weekends are left out of
  // both the date picker and the report matrix.
  function workingDates() {
    return fortnightDates().filter(function (iso) {
      var dow = parseISODate(iso).getDay();
      return dow !== 0 && dow !== 6;
    });
  }

  // ---------- DOM refs ----------
  var weekStartInput = document.getElementById("weekStart");
  var weekRangeLabel = document.getElementById("weekRangeLabel");
  var syncStatus = document.getElementById("syncStatus");
  var footerNote = document.getElementById("footerNote");

  var inputCard = document.getElementById("inputCard");
  var inputCardTitle = document.getElementById("inputCardTitle");
  var entryForm = document.getElementById("entryForm");
  var dayToggleRow = document.getElementById("dayToggleRow");
  var jobSelect = document.getElementById("jobSelect");
  var employerCheckList = document.getElementById("employerCheckList");
  var taskInput = document.getElementById("taskInput");
  var reminderTextInput = document.getElementById("reminderTextInput");
  var entryErrors = document.getElementById("entryErrors");
  var entrySubmitBtn = document.getElementById("entrySubmitBtn");
  var cancelEditBtn = document.getElementById("cancelEditBtn");

  var jobAddBtn = document.getElementById("jobAddBtn");
  var jobDelBtn = document.getElementById("jobDelBtn");
  var empAddBtn = document.getElementById("empAddBtn");

  var resultsBody = document.getElementById("resultsBody");
  var resultsWeekRange = document.getElementById("resultsWeekRange");
  var printArea = document.getElementById("printArea");
  var exportBtn = document.getElementById("exportBtn");

  var backupText = document.querySelector(".backup-text p");
  var backupDownloadBtn = document.getElementById("backupDownloadBtn");
  var backupRestoreBtn = document.getElementById("backupRestoreBtn");
  var backupFileInput = document.getElementById("backupFileInput");
  var backupMsg = document.getElementById("backupMsg");
  var clearDataBtn = document.getElementById("clearDataBtn");

  // ---------- Sync status ----------
  var STATUS_LABELS = {
    local: "Local only",
    connecting: "Connecting…",
    live: "Live — shared with your team",
    offline: "Offline — will sync later",
    error: "Sync error"
  };

  function handleStatusChange(status) {
    syncStatus.textContent = STATUS_LABELS[status] || status;
    syncStatus.className = "sync-status sync-status-" + status;

    if (PlannerStore.isTeamSyncEnabled) {
      backupText.textContent = "Shared live with everyone using this link. Download a backup regularly, or after finishing a fortnight, to keep an extra copy safe.";
      footerNote.textContent = "Data is shared in real time with everyone using this link.";
    } else {
      backupText.textContent = "Saved automatically in this browser. Download a backup regularly, or after finishing a fortnight, to keep it safe or move it to another computer.";
      footerNote.textContent = "Data is stored locally in your browser. Nothing is uploaded anywhere.";
    }
  }

  // ---------- Fortnight selector ----------
  function initFortnight() {
    var today = new Date();
    var monday = mondayOf(today);
    currentFortnightStart = toISODate(monday);
    weekStartInput.value = currentFortnightStart;
    updateFortnightRangeLabel();
  }

  function updateFortnightRangeLabel() {
    var start = parseISODate(currentFortnightStart);
    var end = addDays(start, FORTNIGHT_LENGTH - 1);
    var label = formatDisplayDate(start) + " – " + formatDisplayDate(end);
    weekRangeLabel.textContent = label;
    resultsWeekRange.textContent = label;
  }

  weekStartInput.addEventListener("change", function () {
    var raw = weekStartInput.value;
    if (!raw) return;
    var picked = parseISODate(raw);
    var monday = mondayOf(picked);
    var iso = toISODate(monday);
    if (iso !== raw) {
      weekStartInput.value = iso;
    }
    currentFortnightStart = iso;
    updateFortnightRangeLabel();
    toggledDates = {};
    renderDayToggleRow();
    exitEditMode();
    renderResults();
  });

  // ---------- Day-toggle row (10 weekdays of the selected fortnight; tap
  // a day to turn its dot on/off for the task/reminder about to be added) ----------
  function renderDayToggleRow() {
    dayToggleRow.innerHTML = "";
    workingDates().forEach(function (dateISO, idx) {
      var d = parseISODate(dateISO);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-toggle" + (idx === 5 ? " week-sep" : "");
      if (toggledDates[dateISO]) btn.classList.add("active");

      var letter = document.createElement("span");
      letter.className = "day-toggle-letter";
      letter.textContent = DAY_LETTERS[d.getDay() === 0 ? 6 : d.getDay() - 1];

      var num = document.createElement("span");
      num.className = "day-toggle-num";
      num.textContent = String(d.getDate());

      var dot = document.createElement("span");
      dot.className = "day-toggle-dot";

      btn.appendChild(letter);
      btn.appendChild(num);
      btn.appendChild(dot);

      btn.addEventListener("click", function () {
        toggledDates[dateISO] = !toggledDates[dateISO];
        btn.classList.toggle("active", !!toggledDates[dateISO]);
      });

      dayToggleRow.appendChild(btn);
    });
  }

  // ---------- Options builders ----------
  function buildOptions(selectEl, list, placeholder) {
    var prevValue = selectEl.value;
    selectEl.innerHTML = "";
    var placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = placeholder;
    selectEl.appendChild(placeholderOpt);
    list.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    });
    if (list.indexOf(prevValue) !== -1) {
      selectEl.value = prevValue;
    }
  }

  function renderJobOptions() {
    buildOptions(jobSelect, jobs, jobs.length ? "Select job/trade…" : "No jobs yet — click + Add");
    if (pendingJobSelection && jobs.indexOf(pendingJobSelection) !== -1) {
      jobSelect.value = pendingJobSelection;
      pendingJobSelection = null;
    }
  }

  function renderEmployerCheckboxes() {
    var checkedNames = getCheckedEmployers();
    pendingEmployerSelections.forEach(function (n) {
      if (employers.indexOf(n) !== -1 && checkedNames.indexOf(n) === -1) checkedNames.push(n);
    });
    pendingEmployerSelections = pendingEmployerSelections.filter(function (n) {
      return employers.indexOf(n) === -1;
    });

    employerCheckList.innerHTML = "";

    if (employers.length === 0) {
      var hint = document.createElement("p");
      hint.className = "checkbox-list-hint";
      hint.textContent = "No labour yet — click + Add.";
      employerCheckList.appendChild(hint);
      return;
    }

    employers.forEach(function (name) {
      var row = document.createElement("div");
      row.className = "checkbox-item";

      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      checkbox.checked = checkedNames.indexOf(name) !== -1;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + name));

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "mini-del-btn";
      delBtn.setAttribute("aria-label", "Delete " + name);
      delBtn.textContent = "×";
      delBtn.addEventListener("click", function () {
        if (!window.confirm('Delete "' + name + '" from the labour list?')) return;
        PlannerStore.deleteEmployer(name);
      });

      row.appendChild(label);
      row.appendChild(delBtn);
      employerCheckList.appendChild(row);
    });
  }

  function getCheckedEmployers() {
    var boxes = employerCheckList.querySelectorAll('input[type="checkbox"]:checked');
    return Array.prototype.map.call(boxes, function (b) { return b.value; });
  }

  // ---------- Add / Delete job & employer ----------
  jobAddBtn.addEventListener("click", function () {
    var name = window.prompt("New job/trade name:");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    pendingJobSelection = name;
    PlannerStore.addJob(name);
  });

  jobDelBtn.addEventListener("click", function () {
    var name = jobSelect.value;
    if (!name) {
      window.alert("Select a job/trade first, then click Delete.");
      return;
    }
    if (!window.confirm('Delete "' + name + '" from the list?')) return;
    PlannerStore.deleteJob(name);
  });

  empAddBtn.addEventListener("click", function () {
    var name = window.prompt("New labour/team mate name:");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    pendingEmployerSelections.push(name);
    PlannerStore.addEmployer(name);
  });

  // ---------- Add / Edit entry ----------
  // row: { job, task, employers, dates: [iso, ...], entries: [{date, entry}, ...] }
  function enterEditMode(row) {
    editingGroup = { entries: row.entries };
    jobSelect.value = row.job;
    var boxes = employerCheckList.querySelectorAll('input[type="checkbox"]');
    boxes.forEach(function (b) { b.checked = row.employers.indexOf(b.value) !== -1; });
    taskInput.value = row.task;
    toggledDates = {};
    row.dates.forEach(function (d) { toggledDates[d] = true; });
    renderDayToggleRow();
    entryErrors.textContent = "";

    inputCardTitle.textContent = "Edit Task";
    entrySubmitBtn.textContent = "Save Changes";
    cancelEditBtn.classList.remove("hidden");
    inputCard.classList.add("editing");
    inputCard.scrollIntoView({ behavior: "smooth", block: "start" });
    taskInput.focus();
  }

  function exitEditMode() {
    editingGroup = null;
    inputCardTitle.textContent = "Add a Task";
    entrySubmitBtn.textContent = "+ Add to Plan";
    cancelEditBtn.classList.add("hidden");
    inputCard.classList.remove("editing");
  }

  function resetEntryFormAfterSave() {
    taskInput.value = "";
    reminderTextInput.value = "";
    var checkedBoxes = employerCheckList.querySelectorAll('input[type="checkbox"]:checked');
    checkedBoxes.forEach(function (b) { b.checked = false; });
    toggledDates = {};
    renderDayToggleRow();
  }

  cancelEditBtn.addEventListener("click", function () {
    exitEditMode();
    resetEntryFormAfterSave();
    entryErrors.textContent = "";
  });

  entryForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var job = jobSelect.value;
    var selectedEmployers = getCheckedEmployers();
    var task = taskInput.value.trim();
    var reminderText = reminderTextInput.value.trim();
    var activeDates = workingDates().filter(function (d) { return toggledDates[d]; });

    // Job/Trade keeps its selected value after a submit (so adding several
    // tasks for the same job in a row is easy), so it alone isn't a signal
    // of fresh intent - only new Task text or a newly-checked Labour name
    // means "this submit is adding a task", not just a reminder.
    var wantsTask = task.length > 0 || selectedEmployers.length > 0;
    var wantsReminder = reminderText.length > 0;

    var missing = [];
    if (wantsTask) {
      if (!job) missing.push("Job/Trade");
      if (!task) missing.push("Task");
      if (selectedEmployers.length === 0) missing.push("Labour");
    }
    if (!wantsTask && !wantsReminder) {
      missing.push("a Task or a Reminder");
    } else if (activeDates.length === 0) {
      missing.push("at least one day toggled on");
    }

    if (missing.length > 0) {
      entryErrors.textContent = "Please fill in: " + missing.join(", ") + ".";
      return;
    }
    entryErrors.textContent = "";

    if (editingGroup) {
      editingGroup.entries.forEach(function (pair) {
        PlannerStore.removeTaskEntry(pair.date, pair.entry);
      });
      exitEditMode();
    }

    if (wantsTask) {
      activeDates.forEach(function (dateISO) {
        PlannerStore.addTaskEntry(dateISO, {
          id: makeId(),
          job: job,
          employers: selectedEmployers,
          task: task
        });
      });
    }

    if (wantsReminder) {
      activeDates.forEach(function (dateISO) {
        PlannerStore.addReminder({ id: makeId(), date: dateISO, text: reminderText });
      });
    }

    resetEntryFormAfterSave();
    taskInput.focus();
  });

  // ---------- Results (matrix: one row per task, dots mark its date, plus
  // a Reminder column at the end holding each date's reminder(s)) ----------
  function renderResults() {
    var dates = workingDates();
    resultsBody.innerHTML = "";

    // Reminders only ever get a date from the Add a Task day-toggle row, so
    // every reminder's date always belongs to SOME fortnight's working days
    // - just not necessarily the one currently being viewed.
    var remindersByDate = {};
    reminders.forEach(function (r) {
      if (dates.indexOf(r.date) === -1) return;
      (remindersByDate[r.date] = remindersByDate[r.date] || []).push(r);
    });

    // Group same Job/Trade + Task + Labour entries (however many days they
    // were added on, whenever) into one row, with a dot for each of its
    // days - so "deck / Mark, Max" added to 3 days is one line, not 3.
    var groups = {};
    dates.forEach(function (dateISO) {
      (plans[dateISO] || []).forEach(function (entry) {
        var empKey = (entry.employers || []).slice().sort().join(",");
        var key = entry.job + "||" + entry.task + "||" + empKey;
        if (!groups[key]) {
          groups[key] = { job: entry.job, task: entry.task, employers: entry.employers || [], dates: [], entries: [] };
        }
        groups[key].dates.push(dateISO);
        groups[key].entries.push({ date: dateISO, entry: entry });
      });
    });

    var rows = Object.keys(groups).map(function (key) {
      var g = groups[key];
      return { isGroup: true, job: g.job, task: g.task, employers: g.employers, dates: g.dates, entries: g.entries };
    });
    dates.forEach(function (dateISO) {
      var hasTask = (plans[dateISO] || []).length > 0;
      if (!hasTask && remindersByDate[dateISO]) {
        // A reminder with no task on its date still needs a row to live in.
        rows.push({ isGroup: false, date: dateISO });
      }
    });

    function earliestDate(row) {
      return row.isGroup ? row.dates.slice().sort()[0] : row.date;
    }

    // Sort by Job/Trade (case-insensitive); rows with no job (a reminder
    // with no task on its date) sort to the end, chronologically among
    // themselves. Same-job rows stay in date order (earliest day first).
    rows.sort(function (a, b) {
      var jobA = a.isGroup ? a.job.trim().toLowerCase() : null;
      var jobB = b.isGroup ? b.job.trim().toLowerCase() : null;
      if (jobA === null && jobB === null) return earliestDate(a) < earliestDate(b) ? -1 : earliestDate(a) > earliestDate(b) ? 1 : 0;
      if (jobA === null) return 1;
      if (jobB === null) return -1;
      if (jobA !== jobB) return jobA < jobB ? -1 : 1;
      return earliestDate(a) < earliestDate(b) ? -1 : earliestDate(a) > earliestDate(b) ? 1 : 0;
    });

    // Attach each date's reminder(s) to the first row (in the now-sorted
    // order) that covers that date, so they show once rather than on every
    // row that happens to share the date.
    var usedReminderDates = {};
    rows.forEach(function (row) {
      var rowDates = row.isGroup ? row.dates : [row.date];
      var attached = [];
      rowDates.forEach(function (d) {
        if (remindersByDate[d] && !usedReminderDates[d]) {
          attached = attached.concat(remindersByDate[d]);
          usedReminderDates[d] = true;
        }
      });
      row.reminders = attached;
    });

    if (rows.length === 0) {
      var empty = document.createElement("p");
      empty.className = "empty-day-note";
      empty.textContent = "No tasks or reminders added yet for this fortnight.";
      resultsBody.appendChild(empty);
      resultsWeekRange.textContent = weekRangeLabel.textContent;
      return;
    }

    var table = document.createElement("table");
    table.className = "results-table matrix-table";

    // A single header row (rather than two rows joined by rowSpan) keeps
    // every <tr> in the table with the same cell count, which avoids a
    // browser fixed-table-layout quirk where rowSpan'd header cells throw
    // off column-width calculation and some day columns render wider than
    // others despite having identical declared widths.
    var thead = document.createElement("thead");
    var LABEL_COLS = [
      { text: "Job/Trade", cls: "matrix-col-job" },
      { text: "Task", cls: "matrix-col-task" },
      { text: "Labour", cls: "matrix-col-labour" }
    ];
    var headRow = document.createElement("tr");
    LABEL_COLS.forEach(function (col) {
      var th = document.createElement("th");
      th.className = "matrix-label-col " + col.cls;
      th.textContent = col.text;
      headRow.appendChild(th);
    });
    dates.forEach(function (dateISO, idx) {
      var d = parseISODate(dateISO);
      var th = document.createElement("th");
      th.className = "matrix-day-col" + (idx === 5 ? " week-sep" : "");
      var letter = document.createElement("div");
      letter.textContent = DAY_LETTERS[d.getDay() === 0 ? 6 : d.getDay() - 1];
      var num = document.createElement("div");
      num.className = "matrix-date-num";
      num.textContent = String(d.getDate());
      th.appendChild(letter);
      th.appendChild(num);
      headRow.appendChild(th);
    });
    var reminderTh = document.createElement("th");
    reminderTh.className = "matrix-label-col matrix-col-reminder";
    reminderTh.textContent = "Reminder";
    headRow.appendChild(reminderTh);

    var actionsTh = document.createElement("th");
    actionsTh.className = "no-print matrix-actions-col";
    headRow.appendChild(actionsTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var rowDates = row.isGroup ? row.dates : [row.date];
      var tr = document.createElement("tr");

      var jobTd = document.createElement("td");
      jobTd.className = "matrix-col-job";
      var descTd = document.createElement("td");
      descTd.className = "matrix-col-task";
      var empTd = document.createElement("td");
      empTd.className = "matrix-col-labour";
      if (row.isGroup) {
        jobTd.textContent = row.job;
        descTd.textContent = row.task;
        empTd.textContent = row.employers.join(", ");
      }
      tr.appendChild(jobTd);
      tr.appendChild(descTd);
      tr.appendChild(empTd);

      dates.forEach(function (d, idx) {
        var td = document.createElement("td");
        td.className = "matrix-day-col" + (idx === 5 ? " week-sep" : "");
        if (rowDates.indexOf(d) !== -1) {
          var dot = document.createElement("span");
          dot.className = "matrix-dot";
          td.appendChild(dot);
        }
        tr.appendChild(td);
      });

      var reminderTd = document.createElement("td");
      reminderTd.className = "matrix-col-reminder";
      row.reminders.forEach(function (reminder) {
        var line = document.createElement("div");
        line.className = "matrix-reminder-line";

        var textSpan = document.createElement("span");
        textSpan.textContent = reminder.text;

        var remDelBtn = document.createElement("button");
        remDelBtn.type = "button";
        remDelBtn.className = "mini-del-btn no-print";
        remDelBtn.setAttribute("aria-label", "Remove this reminder");
        remDelBtn.textContent = "×";
        remDelBtn.addEventListener("click", function () {
          PlannerStore.removeReminder(reminder);
        });

        line.appendChild(textSpan);
        line.appendChild(remDelBtn);
        reminderTd.appendChild(line);
      });
      tr.appendChild(reminderTd);

      var actionTd = document.createElement("td");
      actionTd.className = "no-print matrix-actions-col";
      if (row.isGroup) {
        var actionsWrap = document.createElement("div");
        actionsWrap.className = "row-actions";
        var entryIds = row.entries.map(function (pair) { return pair.entry.id; });

        var editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "edit-row-btn";
        editBtn.setAttribute("aria-label", "Edit this task");
        editBtn.textContent = "✎";
        editBtn.addEventListener("click", function () {
          enterEditMode(row);
        });

        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "remove-row-btn";
        delBtn.setAttribute("aria-label", "Remove this task");
        delBtn.textContent = "×";
        delBtn.addEventListener("click", function () {
          if (entryIds.length > 1 && !window.confirm("Remove this task from all " + entryIds.length + " days?")) return;
          row.entries.forEach(function (pair) {
            PlannerStore.removeTaskEntry(pair.date, pair.entry);
          });
          if (editingGroup && editingGroup.entries.some(function (pair) { return entryIds.indexOf(pair.entry.id) !== -1; })) {
            exitEditMode();
            resetEntryFormAfterSave();
          }
        });

        actionsWrap.appendChild(editBtn);
        actionsWrap.appendChild(delBtn);
        actionTd.appendChild(actionsWrap);
      }
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    resultsBody.appendChild(table);

    resultsWeekRange.textContent = weekRangeLabel.textContent;
  }

  // ---------- Export as PDF ----------
  // Generates and downloads an actual PDF file by rendering the page
  // directly, rather than using the browser's print dialog - this works
  // the same way on every device, including phones where printing itself
  // is disabled or unavailable at the OS level.
  exportBtn.addEventListener("click", function () {
    if (typeof window.html2pdf !== "function") {
      window.alert("The PDF export tool didn't load. Check your internet connection and try again.");
      return;
    }
    var originalLabel = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = "Preparing PDF…";
    document.body.classList.add("exporting-pdf");

    var filename = "labour-plan-" + currentFortnightStart + ".pdf";
    var opt = {
      margin: 6,
      filename: filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };

    function finish() {
      document.body.classList.remove("exporting-pdf");
      exportBtn.disabled = false;
      exportBtn.textContent = originalLabel;
    }

    window.html2pdf().set(opt).from(printArea).save()
      .then(finish)
      .catch(function (err) {
        finish();
        window.alert("Export failed: " + (err && err.message ? err.message : String(err)));
      });
  });

  // ---------- Backup / Restore ----------
  function showBackupMsg(text, isSuccess) {
    backupMsg.textContent = text;
    backupMsg.classList.toggle("form-success", !!isSuccess);
  }

  backupDownloadBtn.addEventListener("click", function () {
    var data = { jobs: jobs, employers: employers, plans: plans, reminders: reminders, savedAt: new Date().toISOString() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = toISODate(new Date());
    a.href = url;
    a.download = "labour-planner-backup-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showBackupMsg("Backup downloaded.", true);
  });

  backupRestoreBtn.addEventListener("click", function () {
    backupFileInput.value = "";
    backupFileInput.click();
  });

  backupFileInput.addEventListener("change", function () {
    var file = backupFileInput.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        showBackupMsg("That file isn't a valid backup (couldn't read it as JSON).", false);
        return;
      }
      if (!data || typeof data !== "object" || !Array.isArray(data.jobs) || !Array.isArray(data.employers) || typeof data.plans !== "object") {
        showBackupMsg("That file doesn't look like a Labour Planner backup.", false);
        return;
      }
      var warnText = PlannerStore.isTeamSyncEnabled
        ? "This will replace all jobs, labour and tasks for EVERYONE sharing this link with the backup. Continue?"
        : "This will replace all jobs, labour and tasks currently in this browser with the backup. Continue?";
      if (!window.confirm(warnText)) {
        return;
      }

      exitEditMode();
      resetEntryFormAfterSave();
      PlannerStore.overwriteAll({ jobs: data.jobs, employers: data.employers, plans: data.plans, reminders: Array.isArray(data.reminders) ? data.reminders : [] });
      showBackupMsg("Backup restored.", true);
    };
    reader.onerror = function () {
      showBackupMsg("Couldn't read that file.", false);
    };
    reader.readAsText(file);
  });

  clearDataBtn.addEventListener("click", function () {
    var rangeLabel = weekRangeLabel.textContent;
    var warnText = PlannerStore.isTeamSyncEnabled
      ? "Clear all tasks for " + rangeLabel + " for EVERYONE sharing this link, and start a new report? Job and Labour lists will be kept."
      : "Clear all tasks for " + rangeLabel + " and start a new report? Your Job and Labour lists will be kept.";
    if (!window.confirm(warnText)) {
      return;
    }
    exitEditMode();
    resetEntryFormAfterSave();
    PlannerStore.clearDates(fortnightDates());
    showBackupMsg("This fortnight's report was cleared. Jobs and Labour were kept.", true);
  });

  // ---------- Init ----------
  initFortnight();
  renderDayToggleRow();
  renderResults();

  PlannerStore.init({
    onStatus: handleStatusChange,
    onChange: function (state) {
      jobs = state.jobs || [];
      employers = state.employers || [];
      plans = state.plans || {};
      reminders = state.reminders || [];
      renderJobOptions();
      renderEmployerCheckboxes();
      renderResults();
    }
  });
})();
