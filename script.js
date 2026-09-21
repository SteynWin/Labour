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
  var plans = loadJSON(STORAGE.plans, {}); // keyed by week-start ISO date
  var currentWeekStart = null; // ISO date string (Monday)

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
      weekday: undefined,
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  // ---------- Plan helpers ----------
  function emptyPlan() {
    var plan = {};
    DAY_KEYS.forEach(function (k) {
      plan[k] = [{ job: "", description: "", employer: "" }];
    });
    return plan;
  }

  function getCurrentPlan() {
    if (!plans[currentWeekStart]) {
      plans[currentWeekStart] = emptyPlan();
    }
    return plans[currentWeekStart];
  }

  // ---------- DOM refs ----------
  var jobForm = document.getElementById("jobForm");
  var jobInput = document.getElementById("jobInput");
  var jobListEl = document.getElementById("jobList");

  var employerForm = document.getElementById("employerForm");
  var employerInput = document.getElementById("employerInput");
  var employerListEl = document.getElementById("employerList");

  var setupToggle = document.getElementById("setupToggle");
  var setupBody = document.getElementById("setupBody");

  var weekStartInput = document.getElementById("weekStart");
  var weekRangeLabel = document.getElementById("weekRangeLabel");

  var daysContainer = document.getElementById("daysContainer");
  var formErrors = document.getElementById("formErrors");
  var generateBtn = document.getElementById("generateBtn");

  var planningSection = document.getElementById("planningSection");
  var resultsSection = document.getElementById("resultsSection");
  var resultsBody = document.getElementById("resultsBody");
  var resultsWeekRange = document.getElementById("resultsWeekRange");
  var editBtn = document.getElementById("editBtn");
  var exportBtn = document.getElementById("exportBtn");

  // ---------- Setup: Jobs & Employers ----------
  function renderChipList(container, items, onRemove) {
    container.innerHTML = "";
    if (items.length === 0) {
      var li = document.createElement("li");
      li.className = "empty-hint";
      li.textContent = "None added yet";
      container.appendChild(li);
      return;
    }
    items.forEach(function (name, idx) {
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.textContent = name;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Remove " + name);
      btn.textContent = "×";
      btn.addEventListener("click", function () {
        onRemove(idx);
      });
      li.appendChild(span);
      li.appendChild(btn);
      container.appendChild(li);
    });
  }

  function renderJobsList() {
    renderChipList(jobListEl, jobs, function (idx) {
      jobs.splice(idx, 1);
      saveJobs();
      renderJobsList();
      renderDays();
    });
  }

  function renderEmployersList() {
    renderChipList(employerListEl, employers, function (idx) {
      employers.splice(idx, 1);
      saveEmployers();
      renderEmployersList();
      renderDays();
    });
  }

  jobForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var val = jobInput.value.trim();
    if (!val) return;
    if (jobs.indexOf(val) === -1) {
      jobs.push(val);
      saveJobs();
      renderJobsList();
      renderDays();
    }
    jobInput.value = "";
    jobInput.focus();
  });

  employerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var val = employerInput.value.trim();
    if (!val) return;
    if (employers.indexOf(val) === -1) {
      employers.push(val);
      saveEmployers();
      renderEmployersList();
      renderDays();
    }
    employerInput.value = "";
    employerInput.focus();
  });

  setupToggle.addEventListener("click", function () {
    var expanded = setupToggle.getAttribute("aria-expanded") === "true";
    setupToggle.setAttribute("aria-expanded", String(!expanded));
    setupBody.classList.toggle("hidden", expanded);
  });

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
    renderDays();
    hideResults();
  });

  // ---------- Options builders ----------
  function buildOptions(selectEl, list, selectedValue, placeholder) {
    selectEl.innerHTML = "";
    var placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = placeholder;
    selectEl.appendChild(placeholderOpt);
    list.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === selectedValue) opt.selected = true;
      selectEl.appendChild(opt);
    });
    if (selectedValue && list.indexOf(selectedValue) === -1) {
      var missingOpt = document.createElement("option");
      missingOpt.value = selectedValue;
      missingOpt.textContent = selectedValue + " (removed)";
      missingOpt.selected = true;
      selectEl.appendChild(missingOpt);
    }
  }

  // ---------- Planning grid ----------
  function renderDays() {
    var plan = getCurrentPlan();
    daysContainer.innerHTML = "";
    var monday = parseISODate(currentWeekStart);

    DAY_KEYS.forEach(function (dayKey, dayIdx) {
      var dayDate = addDays(monday, dayIdx);
      var card = document.createElement("div");
      card.className = "day-card";
      card.dataset.day = dayKey;

      var header = document.createElement("div");
      header.className = "day-card-header";
      var nameSpan = document.createElement("span");
      nameSpan.className = "day-name";
      nameSpan.textContent = DAY_NAMES[dayKey];
      var dateSpan = document.createElement("span");
      dateSpan.className = "day-date";
      dateSpan.textContent = formatDisplayDate(dayDate);
      header.appendChild(nameSpan);
      header.appendChild(dateSpan);
      card.appendChild(header);

      var rowsWrap = document.createElement("div");
      rowsWrap.className = "task-rows";
      card.appendChild(rowsWrap);

      var addBar = document.createElement("div");
      addBar.className = "add-row-bar";
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "add-row-btn";
      addBtn.textContent = "+ Add task";
      addBtn.addEventListener("click", function () {
        plan[dayKey].push({ job: "", description: "", employer: "" });
        savePlans();
        renderDays();
      });
      addBar.appendChild(addBtn);
      card.appendChild(addBar);

      plan[dayKey].forEach(function (task, rowIdx) {
        rowsWrap.appendChild(buildTaskRow(dayKey, rowIdx, task, plan[dayKey].length));
      });

      daysContainer.appendChild(card);
    });
  }

  function buildTaskRow(dayKey, rowIdx, task, rowCount) {
    var row = document.createElement("div");
    row.className = "task-row";

    // Job select
    var jobWrap = document.createElement("div");
    var jobLabel = document.createElement("label");
    jobLabel.className = "field-label";
    jobLabel.textContent = "Job";
    var jobSelect = document.createElement("select");
    buildOptions(jobSelect, jobs, task.job, "Select job…");
    jobSelect.addEventListener("change", function () {
      task.job = jobSelect.value;
      savePlans();
    });
    jobWrap.appendChild(jobLabel);
    jobWrap.appendChild(jobSelect);

    // Task description
    var descWrap = document.createElement("div");
    var descLabel = document.createElement("label");
    descLabel.className = "field-label";
    descLabel.textContent = "What needs to be done";
    var descInput = document.createElement("textarea");
    descInput.rows = 1;
    descInput.placeholder = "Describe the task…";
    descInput.value = task.description || "";
    descInput.addEventListener("input", function () {
      task.description = descInput.value;
      savePlans();
    });
    descWrap.appendChild(descLabel);
    descWrap.appendChild(descInput);

    // Employer select
    var empWrap = document.createElement("div");
    var empLabel = document.createElement("label");
    empLabel.className = "field-label";
    empLabel.textContent = "Employer";
    var empSelect = document.createElement("select");
    buildOptions(empSelect, employers, task.employer, "Select employer…");
    empSelect.addEventListener("change", function () {
      task.employer = empSelect.value;
      savePlans();
    });
    empWrap.appendChild(empLabel);
    empWrap.appendChild(empSelect);

    row.appendChild(jobWrap);
    row.appendChild(descWrap);
    row.appendChild(empWrap);

    // Remove button
    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-row-btn";
    removeBtn.setAttribute("aria-label", "Remove this task");
    removeBtn.textContent = "×";
    removeBtn.disabled = rowCount <= 1;
    removeBtn.title = rowCount <= 1 ? "Each day needs at least one task" : "Remove task";
    removeBtn.addEventListener("click", function () {
      var plan = getCurrentPlan();
      if (plan[dayKey].length <= 1) return;
      plan[dayKey].splice(rowIdx, 1);
      savePlans();
      renderDays();
    });
    row.appendChild(removeBtn);

    return row;
  }

  // ---------- Validation ----------
  function validatePlan(plan) {
    var errors = [];
    var missingDays = [];

    DAY_KEYS.forEach(function (dayKey) {
      var rows = plan[dayKey];
      var validRows = rows.filter(function (t) {
        return t.job && t.description.trim() && t.employer;
      });
      var hasIncomplete = rows.some(function (t) {
        var any = t.job || t.description.trim() || t.employer;
        var all = t.job && t.description.trim() && t.employer;
        return any && !all;
      });

      if (validRows.length === 0) {
        missingDays.push(DAY_NAMES[dayKey]);
      } else if (hasIncomplete) {
        errors.push(DAY_NAMES[dayKey] + " has an incomplete task row (job, task and employer are all required).");
      }
    });

    if (missingDays.length > 0) {
      errors.unshift("Every day (Mon–Fri) needs at least one complete task. Missing: " + missingDays.join(", ") + ".");
    }

    if (jobs.length === 0) {
      errors.push("Add at least one job in Setup before generating the plan.");
    }
    if (employers.length === 0) {
      errors.push("Add at least one employer in Setup before generating the plan.");
    }

    return { valid: errors.length === 0, errors: errors, missingDays: missingDays };
  }

  function markMissingDays(missingDays) {
    var cards = daysContainer.querySelectorAll(".day-card");
    cards.forEach(function (card) {
      var dayKey = card.dataset.day;
      var isMissing = missingDays.indexOf(DAY_NAMES[dayKey]) !== -1;
      card.classList.toggle("day-missing", isMissing);
    });
  }

  // ---------- Generate / Results ----------
  generateBtn.addEventListener("click", function () {
    var plan = getCurrentPlan();
    var result = validatePlan(plan);
    markMissingDays(result.missingDays);

    if (!result.valid) {
      formErrors.innerHTML =
        "<strong>Please fix the following before generating the plan:</strong><ul>" +
        result.errors.map(function (e) { return "<li>" + escapeHTML(e) + "</li>"; }).join("") +
        "</ul>";
      formErrors.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    formErrors.innerHTML = "";
    renderResults(plan);
    showResults();
  });

  function escapeHTML(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderResults(plan) {
    resultsBody.innerHTML = "";
    var monday = parseISODate(currentWeekStart);

    DAY_KEYS.forEach(function (dayKey, dayIdx) {
      var rows = plan[dayKey].filter(function (t) {
        return t.job && t.description.trim() && t.employer;
      });
      if (rows.length === 0) return;

      var dayDate = addDays(monday, dayIdx);
      var section = document.createElement("div");
      section.className = "results-day";

      var h3 = document.createElement("h3");
      h3.textContent = DAY_NAMES[dayKey] + " — " + formatDisplayDate(dayDate);
      section.appendChild(h3);

      var table = document.createElement("table");
      table.className = "results-table";
      var thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>Job</th><th>Task</th><th>Employer</th></tr>";
      table.appendChild(thead);

      var tbody = document.createElement("tbody");
      rows.forEach(function (t) {
        var tr = document.createElement("tr");
        var jobTd = document.createElement("td");
        jobTd.textContent = t.job;
        var descTd = document.createElement("td");
        descTd.textContent = t.description;
        var empTd = document.createElement("td");
        empTd.textContent = t.employer;
        tr.appendChild(jobTd);
        tr.appendChild(descTd);
        tr.appendChild(empTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      section.appendChild(table);
      resultsBody.appendChild(section);
    });

    resultsWeekRange.textContent = weekRangeLabel.textContent;
  }

  function showResults() {
    planningSection.classList.add("hidden");
    document.getElementById("setupSection").classList.add("hidden");
    resultsSection.classList.remove("hidden");
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function hideResults() {
    resultsSection.classList.add("hidden");
    planningSection.classList.remove("hidden");
    document.getElementById("setupSection").classList.remove("hidden");
  }

  editBtn.addEventListener("click", hideResults);

  exportBtn.addEventListener("click", function () {
    window.print();
  });

  // ---------- Init ----------
  renderJobsList();
  renderEmployersList();
  initWeek();
  renderDays();
})();
