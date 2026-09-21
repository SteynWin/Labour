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

  var STORAGE = {
    jobs: "lp_jobs",
    employers: "lp_employers",
    plans: "lp_plans"
  };

  // ---------- State ----------
  var jobs = loadJSON(STORAGE.jobs, []);
  var employers = loadJSON(STORAGE.employers, []);
  var plans = loadJSON(STORAGE.plans, {}); // keyed by week-start ISO date -> { Mon: [entry,...], ... }
  var currentWeekStart = null; // ISO date string (Monday)

  migrateOldEmployerField(plans);
  savePlans();

  // Migrate entries saved before employers became multi-select
  // (old shape: entry.employer as a single string)
  function migrateOldEmployerField(plansObj) {
    Object.keys(plansObj).forEach(function (weekKey) {
      var plan = plansObj[weekKey];
      DAY_KEYS.forEach(function (dayKey) {
        if (!Array.isArray(plan[dayKey])) return;
        plan[dayKey].forEach(function (entry) {
          if (!Array.isArray(entry.employers)) {
            entry.employers = entry.employer ? [entry.employer] : [];
            delete entry.employer;
          }
        });
      });
    });
  }

  // ---------- Storage helpers ----------
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // ignore quota / privacy-mode errors
    }
  }

  function saveJobs() { saveJSON(STORAGE.jobs, jobs); }
  function saveEmployers() { saveJSON(STORAGE.employers, employers); }
  function savePlans() { saveJSON(STORAGE.plans, plans); }

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

  // ---------- Plan helpers ----------
  function emptyPlan() {
    var plan = {};
    DAY_KEYS.forEach(function (k) { plan[k] = []; });
    return plan;
  }

  function getCurrentPlan() {
    if (!plans[currentWeekStart]) {
      plans[currentWeekStart] = emptyPlan();
    }
    return plans[currentWeekStart];
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- DOM refs ----------
  var weekStartInput = document.getElementById("weekStart");
  var weekRangeLabel = document.getElementById("weekRangeLabel");

  var entryForm = document.getElementById("entryForm");
  var dateSelect = document.getElementById("dateSelect");
  var jobSelect = document.getElementById("jobSelect");
  var employerCheckList = document.getElementById("employerCheckList");
  var taskInput = document.getElementById("taskInput");
  var entryErrors = document.getElementById("entryErrors");

  var jobAddBtn = document.getElementById("jobAddBtn");
  var jobDelBtn = document.getElementById("jobDelBtn");
  var empAddBtn = document.getElementById("empAddBtn");

  var resultsBody = document.getElementById("resultsBody");
  var resultsWeekRange = document.getElementById("resultsWeekRange");
  var exportBtn = document.getElementById("exportBtn");

  var backupDownloadBtn = document.getElementById("backupDownloadBtn");
  var backupRestoreBtn = document.getElementById("backupRestoreBtn");
  var backupFileInput = document.getElementById("backupFileInput");
  var backupMsg = document.getElementById("backupMsg");

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
  }

  function renderEmployerCheckboxes() {
    var checkedNames = getCheckedEmployers();
    employerCheckList.innerHTML = "";

    if (employers.length === 0) {
      var hint = document.createElement("p");
      hint.className = "checkbox-list-hint";
      hint.textContent = "No employers yet — click + Add.";
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
        if (!window.confirm('Delete employer "' + name + '" from the list?')) return;
        var idx = employers.indexOf(name);
        if (idx !== -1) {
          employers.splice(idx, 1);
          saveEmployers();
          renderEmployerCheckboxes();
        }
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
    if (jobs.indexOf(name) === -1) {
      jobs.push(name);
      saveJobs();
      renderJobOptions();
    }
    jobSelect.value = name;
  });

  jobDelBtn.addEventListener("click", function () {
    var name = jobSelect.value;
    if (!name) {
      window.alert("Select a job first, then click Delete.");
      return;
    }
    if (!window.confirm('Delete job "' + name + '" from the list?')) return;
    var idx = jobs.indexOf(name);
    if (idx !== -1) {
      jobs.splice(idx, 1);
      saveJobs();
      renderJobOptions();
    }
  });

  empAddBtn.addEventListener("click", function () {
    var name = window.prompt("New employer name:");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    var checkedNames = getCheckedEmployers();
    if (employers.indexOf(name) === -1) {
      employers.push(name);
      saveEmployers();
    }
    checkedNames.push(name);
    renderEmployerCheckboxes();
    checkedNames.forEach(function (n) {
      var box = employerCheckList.querySelector('input[value="' + CSS.escape(n) + '"]');
      if (box) box.checked = true;
    });
  });

  // ---------- Add entry ----------
  entryForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var dayKey = dateSelect.value;
    var job = jobSelect.value;
    var selectedEmployers = getCheckedEmployers();
    var task = taskInput.value.trim();

    var missing = [];
    if (!job) missing.push("Job");
    if (!task) missing.push("Task");
    if (selectedEmployers.length === 0) missing.push("Employer");

    if (missing.length > 0) {
      entryErrors.textContent = "Please fill in: " + missing.join(", ") + ".";
      return;
    }
    entryErrors.textContent = "";

    var plan = getCurrentPlan();
    plan[dayKey].push({ id: makeId(), job: job, employers: selectedEmployers, task: task });
    savePlans();

    taskInput.value = "";
    taskInput.focus();
    var checkedBoxes = employerCheckList.querySelectorAll('input[type="checkbox"]:checked');
    checkedBoxes.forEach(function (b) { b.checked = false; });
    renderResults();
  });

  // ---------- Results (live, grouped by day) ----------
  function renderResults() {
    var plan = getCurrentPlan();
    var monday = parseISODate(currentWeekStart);
    resultsBody.innerHTML = "";

    DAY_KEYS.forEach(function (dayKey, dayIdx) {
      var rows = plan[dayKey];
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
      thead.innerHTML = "<tr><th>Job</th><th>Task</th><th>Employer</th><th class=\"no-print\"></th></tr>";
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
        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "remove-row-btn";
        delBtn.setAttribute("aria-label", "Remove this task");
        delBtn.textContent = "×";
        delBtn.addEventListener("click", function () {
          var idx = plan[dayKey].findIndex(function (t) { return t.id === entry.id; });
          if (idx !== -1) {
            plan[dayKey].splice(idx, 1);
            savePlans();
            renderResults();
          }
        });
        actionTd.appendChild(delBtn);

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
    window.print();
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
      if (!window.confirm("This will replace all jobs, employers and tasks currently in this browser with the backup. Continue?")) {
        return;
      }

      jobs = data.jobs;
      employers = data.employers;
      plans = data.plans || {};
      migrateOldEmployerField(plans);
      saveJobs();
      saveEmployers();
      savePlans();

      renderJobOptions();
      renderEmployerCheckboxes();
      populateDateSelect();
      renderResults();
      showBackupMsg("Backup restored.", true);
    };
    reader.onerror = function () {
      showBackupMsg("Couldn't read that file.", false);
    };
    reader.readAsText(file);
  });

  // ---------- Init ----------
  renderJobOptions();
  renderEmployerCheckboxes();
  initWeek();
  populateDateSelect();
  renderResults();
})();
