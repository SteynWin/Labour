(function () {
  "use strict";

  var DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  var DAY_NAMES = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday"
  };

  // ---------- State (kept in sync from PlannerStore.onChange) ----------
  var jobs = [];
  var employers = [];
  var plans = {}; // keyed by week-start ISO date -> { Mon: [entry,...], ... }
  var currentWeekStart = null; // ISO date string (Monday)
  var editingEntry = null; // { id, dayKey, original } of the entry currently loaded into the form, or null
  var pendingJobSelection = null;
  var pendingEmployerSelections = [];

  function emptyPlan() {
    var plan = {};
    DAY_KEYS.forEach(function (k) { plan[k] = []; });
    return plan;
  }

  function getPlanForRender() {
    return plans[currentWeekStart] || emptyPlan();
  }

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

  function formatShortDayDate(date, dayKey) {
    return DAY_NAMES[dayKey].slice(0, 3) + ", " + date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
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
      backupText.textContent = "Shared live with everyone using this link. Download a backup regularly, or after finishing a week, to keep an extra copy safe.";
      footerNote.textContent = "Data is shared in real time with everyone using this link.";
    } else {
      backupText.textContent = "Saved automatically in this browser. Download a backup regularly, or after finishing a week, to keep it safe or move it to another computer.";
      footerNote.textContent = "Data is stored locally in your browser. Nothing is uploaded anywhere.";
    }
  }

  // ---------- Week selector ----------
  function initWeek() {
    var today = new Date();
    var monday = mondayOf(today);
    currentWeekStart = toISODate(monday);
    weekStartInput.value = currentWeekStart;
    updateWeekRangeLabel();
  }

  function updateWeekRangeLabel() {
    var start = parseISODate(currentWeekStart);
    var end = addDays(start, 4);
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
    currentWeekStart = iso;
    updateWeekRangeLabel();
    populateDateSelect();
    exitEditMode();
    renderResults();
  });

  // ---------- Date dropdown (Mon-Fri of the selected week) ----------
  function populateDateSelect() {
    var monday = parseISODate(currentWeekStart);
    var prevValue = dateSelect.value;
    dateSelect.innerHTML = "";
    DAY_KEYS.forEach(function (dayKey, idx) {
      var d = addDays(monday, idx);
      var opt = document.createElement("option");
      opt.value = dayKey;
      opt.textContent = formatShortDayDate(d, dayKey);
      dateSelect.appendChild(opt);
    });
    if (DAY_KEYS.indexOf(prevValue) !== -1) {
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
    buildOptions(jobSelect, jobs, jobs.length ? "Select job…" : "No jobs yet — click + Add");
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
      hint.textContent = "No team mates yet — click + Add.";
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
        if (!window.confirm('Delete team mate "' + name + '" from the list?')) return;
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
    var name = window.prompt("New job name:");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    pendingJobSelection = name;
    PlannerStore.addJob(name);
  });

  jobDelBtn.addEventListener("click", function () {
    var name = jobSelect.value;
    if (!name) {
      window.alert("Select a job first, then click Delete.");
      return;
    }
    if (!window.confirm('Delete job "' + name + '" from the list?')) return;
    PlannerStore.deleteJob(name);
  });

  empAddBtn.addEventListener("click", function () {
    var name = window.prompt("New team mate name:");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    pendingEmployerSelections.push(name);
    PlannerStore.addEmployer(name);
  });

  // ---------- Add / Edit entry ----------
  function enterEditMode(entry, dayKey) {
    editingEntry = { id: entry.id, dayKey: dayKey, original: entry };
    dateSelect.value = dayKey;
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
    var dayKey = dateSelect.value;
    var job = jobSelect.value;
    var selectedEmployers = getCheckedEmployers();
    var task = taskInput.value.trim();

    var missing = [];
    if (!job) missing.push("Job");
    if (!task) missing.push("Task");
    if (selectedEmployers.length === 0) missing.push("Team Mate");

    if (missing.length > 0) {
      entryErrors.textContent = "Please fill in: " + missing.join(", ") + ".";
      return;
    }
    entryErrors.textContent = "";

    if (editingEntry) {
      PlannerStore.removeTaskEntry(currentWeekStart, editingEntry.dayKey, editingEntry.original);
      PlannerStore.addTaskEntry(currentWeekStart, dayKey, {
        id: editingEntry.id,
        job: job,
        employers: selectedEmployers,
        task: task
      });
      exitEditMode();
    } else {
      PlannerStore.addTaskEntry(currentWeekStart, dayKey, {
        id: makeId(),
        job: job,
        employers: selectedEmployers,
        task: task
      });
    }

    resetEntryFormAfterSave();
    taskInput.focus();
  });

  // ---------- Results (live, grouped by day) ----------
  function renderResults() {
    var plan = getPlanForRender();
    var monday = parseISODate(currentWeekStart);
    resultsBody.innerHTML = "";

    DAY_KEYS.forEach(function (dayKey, dayIdx) {
      var rows = plan[dayKey] || [];
      var dayDate = addDays(monday, dayIdx);

      var section = document.createElement("div");
      section.className = "results-day";
      if (rows.length === 0) section.classList.add("results-day-empty");

      var h3 = document.createElement("h3");
      h3.textContent = DAY_NAMES[dayKey] + " — " + formatDisplayDate(dayDate);
      section.appendChild(h3);

      if (rows.length === 0) {
        var placeholder = document.createElement("p");
        placeholder.className = "no-print empty-day-note";
        placeholder.textContent = "No tasks added yet for this day.";
        section.appendChild(placeholder);
        resultsBody.appendChild(section);
        return;
      }

      var table = document.createElement("table");
      table.className = "results-table";
      var thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>Job</th><th>Task</th><th>Team Mate</th><th class=\"no-print\"></th></tr>";
      table.appendChild(thead);

      var tbody = document.createElement("tbody");
      rows.forEach(function (entry) {
        var tr = document.createElement("tr");

        var jobTd = document.createElement("td");
        jobTd.textContent = entry.job;

        var descTd = document.createElement("td");
        descTd.textContent = entry.task;

        var empTd = document.createElement("td");
        empTd.textContent = (entry.employers || []).join(", ");

        var actionTd = document.createElement("td");
        actionTd.className = "no-print";
        var actionsWrap = document.createElement("div");
        actionsWrap.className = "row-actions";

        var editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "edit-row-btn";
        editBtn.setAttribute("aria-label", "Edit this task");
        editBtn.textContent = "✎";
        editBtn.addEventListener("click", function () {
          enterEditMode(entry, dayKey);
        });

        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "remove-row-btn";
        delBtn.setAttribute("aria-label", "Remove this task");
        delBtn.textContent = "×";
        delBtn.addEventListener("click", function () {
          PlannerStore.removeTaskEntry(currentWeekStart, dayKey, entry);
          if (editingEntry && editingEntry.id === entry.id) {
            exitEditMode();
            resetEntryFormAfterSave();
          }
        });

        actionsWrap.appendChild(editBtn);
        actionsWrap.appendChild(delBtn);
        actionTd.appendChild(actionsWrap);

        tr.appendChild(jobTd);
        tr.appendChild(descTd);
        tr.appendChild(empTd);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      section.appendChild(table);
      resultsBody.appendChild(section);
    });

    resultsWeekRange.textContent = weekRangeLabel.textContent;
  }

  // ---------- Export as PDF ----------
  exportBtn.addEventListener("click", function () {
    window.alert("Button tapped. print type: " + typeof window.print);
    try {
      if (typeof window.print !== "function") {
        window.alert("This browser doesn't support window.print().");
        return;
      }
      window.print();
      window.alert("window.print() finished without throwing.");
    } catch (err) {
      window.alert("Export failed: " + (err && err.message ? err.message : String(err)));
    }
  });

  // ---------- Backup / Restore ----------
  function showBackupMsg(text, isSuccess) {
    backupMsg.textContent = text;
    backupMsg.classList.toggle("form-success", !!isSuccess);
  }

  backupDownloadBtn.addEventListener("click", function () {
    var data = { jobs: jobs, employers: employers, plans: plans, savedAt: new Date().toISOString() };
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
        showBackupMsg("That file doesn't look like a Weekly Labour Planner backup.", false);
        return;
      }
      var warnText = PlannerStore.isTeamSyncEnabled
        ? "This will replace all jobs, team mates and tasks for EVERYONE sharing this link with the backup. Continue?"
        : "This will replace all jobs, team mates and tasks currently in this browser with the backup. Continue?";
      if (!window.confirm(warnText)) {
        return;
      }

      exitEditMode();
      resetEntryFormAfterSave();
      PlannerStore.overwriteAll({ jobs: data.jobs, employers: data.employers, plans: data.plans });
      showBackupMsg("Backup restored.", true);
    };
    reader.onerror = function () {
      showBackupMsg("Couldn't read that file.", false);
    };
    reader.readAsText(file);
  });

  clearDataBtn.addEventListener("click", function () {
    var weekLabel = weekRangeLabel.textContent;
    var warnText = PlannerStore.isTeamSyncEnabled
      ? "Clear all tasks for the week of " + weekLabel + " for EVERYONE sharing this link, and start a new report? Job and Team Mate lists will be kept."
      : "Clear all tasks for the week of " + weekLabel + " and start a new report? Your Job and Team Mate lists will be kept.";
    if (!window.confirm(warnText)) {
      return;
    }
    exitEditMode();
    resetEntryFormAfterSave();
    PlannerStore.clearWeek(currentWeekStart);
    showBackupMsg("This week's report was cleared. Jobs and Team Mates were kept.", true);
  });

  // ---------- Init ----------
  initWeek();
  populateDateSelect();
  renderResults();

  PlannerStore.init({
    onStatus: handleStatusChange,
    onChange: function (state) {
      jobs = state.jobs || [];
      employers = state.employers || [];
      plans = state.plans || {};
      renderJobOptions();
      renderEmployerCheckboxes();
      renderResults();
    }
  });
})();
