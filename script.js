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
  var editingEntry = null; // { id, date, original } of the entry currently loaded into the form, or null
  var pendingJobSelection = null;
  var pendingEmployerSelections = [];

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

  function formatShortDate(date) {
    return date.toLocaleDateString(undefined, {
      weekday: "short",
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
  var dateSelect = document.getElementById("dateSelect");
  var jobSelect = document.getElementById("jobSelect");
  var employerCheckList = document.getElementById("employerCheckList");
  var taskInput = document.getElementById("taskInput");
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

  var remindersList = document.getElementById("remindersList");
  var reminderForm = document.getElementById("reminderForm");
  var reminderDateInput = document.getElementById("reminderDateInput");
  var reminderTextInput = document.getElementById("reminderTextInput");
  var reminderErrors = document.getElementById("reminderErrors");

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
    populateDateSelect();
    exitEditMode();
    renderResults();
  });

  // ---------- Date dropdown (10 weekdays of the selected fortnight) ----------
  function populateDateSelect() {
    var prevValue = dateSelect.value;
    dateSelect.innerHTML = "";
    workingDates().forEach(function (iso) {
      var opt = document.createElement("option");
      opt.value = iso;
      opt.textContent = formatShortDate(parseISODate(iso));
      dateSelect.appendChild(opt);
    });
    if (workingDates().indexOf(prevValue) !== -1) {
      dateSelect.value = prevValue;
    }
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
  function enterEditMode(entry, dateISO) {
    editingEntry = { id: entry.id, date: dateISO, original: entry };
    dateSelect.value = dateISO;
    jobSelect.value = entry.job;
    var boxes = employerCheckList.querySelectorAll('input[type="checkbox"]');
    boxes.forEach(function (b) { b.checked = (entry.employers || []).indexOf(b.value) !== -1; });
    taskInput.value = entry.task;
    entryErrors.textContent = "";

    inputCardTitle.textContent = "Edit Task";
    entrySubmitBtn.textContent = "Save Changes";
    cancelEditBtn.classList.remove("hidden");
    inputCard.classList.add("editing");
    inputCard.scrollIntoView({ behavior: "smooth", block: "start" });
    taskInput.focus();
  }

  function exitEditMode() {
    editingEntry = null;
    inputCardTitle.textContent = "Add a Task";
    entrySubmitBtn.textContent = "+ Add to Plan";
    cancelEditBtn.classList.add("hidden");
    inputCard.classList.remove("editing");
  }

  function resetEntryFormAfterSave() {
    taskInput.value = "";
    var checkedBoxes = employerCheckList.querySelectorAll('input[type="checkbox"]:checked');
    checkedBoxes.forEach(function (b) { b.checked = false; });
  }

  cancelEditBtn.addEventListener("click", function () {
    exitEditMode();
    resetEntryFormAfterSave();
    entryErrors.textContent = "";
  });

  entryForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var dateISO = dateSelect.value;
    var job = jobSelect.value;
    var selectedEmployers = getCheckedEmployers();
    var task = taskInput.value.trim();

    var missing = [];
    if (!job) missing.push("Job/Trade");
    if (!task) missing.push("Task");
    if (selectedEmployers.length === 0) missing.push("Labour");

    if (missing.length > 0) {
      entryErrors.textContent = "Please fill in: " + missing.join(", ") + ".";
      return;
    }
    entryErrors.textContent = "";

    if (editingEntry) {
      PlannerStore.removeTaskEntry(editingEntry.date, editingEntry.original);
      PlannerStore.addTaskEntry(dateISO, {
        id: editingEntry.id,
        job: job,
        employers: selectedEmployers,
        task: task
      });
      exitEditMode();
    } else {
      PlannerStore.addTaskEntry(dateISO, {
        id: makeId(),
        job: job,
        employers: selectedEmployers,
        task: task
      });
    }

    resetEntryFormAfterSave();
    taskInput.focus();
  });

  // ---------- Results (matrix: one row per task, dots mark its date) ----------
  function renderResults() {
    var dates = workingDates();
    resultsBody.innerHTML = "";

    var rows = [];
    dates.forEach(function (dateISO) {
      (plans[dateISO] || []).forEach(function (entry) {
        rows.push({ date: dateISO, entry: entry });
      });
    });

    if (rows.length === 0) {
      var empty = document.createElement("p");
      empty.className = "empty-day-note";
      empty.textContent = "No tasks added yet for this fortnight.";
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
    var actionsTh = document.createElement("th");
    actionsTh.className = "no-print matrix-actions-col";
    headRow.appendChild(actionsTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var entry = row.entry;
      var dateISO = row.date;
      var tr = document.createElement("tr");

      var jobTd = document.createElement("td");
      jobTd.className = "matrix-col-job";
      jobTd.textContent = entry.job;
      var descTd = document.createElement("td");
      descTd.className = "matrix-col-task";
      descTd.textContent = entry.task;
      var empTd = document.createElement("td");
      empTd.className = "matrix-col-labour";
      empTd.textContent = (entry.employers || []).join(", ");
      tr.appendChild(jobTd);
      tr.appendChild(descTd);
      tr.appendChild(empTd);

      dates.forEach(function (d, idx) {
        var td = document.createElement("td");
        td.className = "matrix-day-col" + (idx === 5 ? " week-sep" : "");
        if (d === dateISO) {
          var dot = document.createElement("span");
          dot.className = "matrix-dot";
          td.appendChild(dot);
        }
        tr.appendChild(td);
      });

      var actionTd = document.createElement("td");
      actionTd.className = "no-print matrix-actions-col";
      var actionsWrap = document.createElement("div");
      actionsWrap.className = "row-actions";

      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "edit-row-btn";
      editBtn.setAttribute("aria-label", "Edit this task");
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", function () {
        enterEditMode(entry, dateISO);
      });

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "remove-row-btn";
      delBtn.setAttribute("aria-label", "Remove this task");
      delBtn.textContent = "×";
      delBtn.addEventListener("click", function () {
        PlannerStore.removeTaskEntry(dateISO, entry);
        if (editingEntry && editingEntry.id === entry.id) {
          exitEditMode();
          resetEntryFormAfterSave();
        }
      });

      actionsWrap.appendChild(editBtn);
      actionsWrap.appendChild(delBtn);
      actionTd.appendChild(actionsWrap);
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    resultsBody.appendChild(table);

    resultsWeekRange.textContent = weekRangeLabel.textContent;
  }

  // ---------- Reminders (date + description, shown at the bottom of the report) ----------
  function renderReminders() {
    remindersList.innerHTML = "";

    if (reminders.length === 0) {
      var empty = document.createElement("p");
      empty.className = "empty-day-note no-print";
      empty.textContent = "No reminders yet.";
      remindersList.appendChild(empty);
      return;
    }

    var sorted = reminders.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });

    sorted.forEach(function (reminder) {
      var row = document.createElement("div");
      row.className = "reminder-row";

      var dateEl = document.createElement("span");
      dateEl.className = "reminder-date";
      dateEl.textContent = formatDisplayDate(parseISODate(reminder.date));

      var textEl = document.createElement("span");
      textEl.className = "reminder-text";
      textEl.textContent = reminder.text;

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "remove-row-btn no-print";
      delBtn.setAttribute("aria-label", "Remove this reminder");
      delBtn.textContent = "×";
      delBtn.addEventListener("click", function () {
        PlannerStore.removeReminder(reminder);
      });

      row.appendChild(dateEl);
      row.appendChild(textEl);
      row.appendChild(delBtn);
      remindersList.appendChild(row);
    });
  }

  reminderForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var dateVal = reminderDateInput.value;
    var textVal = reminderTextInput.value.trim();

    var missing = [];
    if (!dateVal) missing.push("Date");
    if (!textVal) missing.push("Description");
    if (missing.length > 0) {
      reminderErrors.textContent = "Please fill in: " + missing.join(", ") + ".";
      return;
    }
    reminderErrors.textContent = "";

    PlannerStore.addReminder({ id: makeId(), date: dateVal, text: textVal });
    reminderForm.reset();
    reminderTextInput.focus();
  });

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
      jsPDF: { unit: "mm", format: "a4", orientation: "landscape" }
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
  populateDateSelect();
  renderResults();
  renderReminders();

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
      renderReminders();
    }
  });
})();
