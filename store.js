/*
 * PlannerStore - a small persistence layer with two backends:
 *
 *  - Local (default): saves to this browser's localStorage only, exactly
 *    like the app worked before. Nothing to set up.
 *
 *  - Firestore (team sync): once firebase-config.js has real values, data
 *    is stored in Firebase and every device that opens the page shares the
 *    same jobs, team mates and plan in real time.
 *
 * Plans are stored FLAT, keyed directly by calendar date ("YYYY-MM-DD" ->
 * array of entries). A "fortnight" (or any date range) is just a display
 * window into this data, not a storage boundary - so switching which
 * range you're viewing never hides or loses anything.
 *
 * Either way, callers use the same small API:
 *
 *   PlannerStore.init({ onChange: fn, onStatus: fn })
 *   PlannerStore.addJob(name) / deleteJob(name)
 *   PlannerStore.addEmployer(name) / deleteEmployer(name)
 *   PlannerStore.addTaskEntry(dateISO, entry)
 *   PlannerStore.removeTaskEntry(dateISO, entry)
 *   PlannerStore.clearDates(datesISOArray)
 *   PlannerStore.addReminder(entry) / removeReminder(entry)
 *   PlannerStore.overwriteAll({ jobs, employers, plans, reminders })
 *
 * onChange(state) fires with the full { jobs, employers, plans } whenever
 * data changes - from this device or (in Firestore mode) from any other
 * device sharing the same link. Rendering always happens from onChange,
 * so the two backends are interchangeable from the UI's point of view.
 *
 * Editing an entry is a remove-then-add of the whole entry object (rather
 * than patching one field), so it works the same way, and just as safely,
 * on both backends.
 */
(function () {
  "use strict";

  var OLD_DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function toISODate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseISODate(iso) {
    var parts = iso.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function addDays(iso, n) {
    var d = parseISODate(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  // Older versions stored plans nested by week ("2026-09-21" -> {Mon:[...],
  // Tue:[...], ...}). This flattens any such entries into the new
  // date-keyed shape (never dropping data), leaving already-flat entries
  // (plain arrays) untouched. Returns { plans, changed }.
  function migrateOldWeekFormat(plansObj) {
    var flat = {};
    var changed = false;

    Object.keys(plansObj).forEach(function (key) {
      var val = plansObj[key];
      if (Array.isArray(val)) {
        flat[key] = (flat[key] || []).concat(val);
        return;
      }
      if (val && typeof val === "object") {
        changed = true;
        OLD_DAY_KEYS.forEach(function (dayKey, idx) {
          if (!Array.isArray(val[dayKey]) || val[dayKey].length === 0) return;
          var iso = addDays(key, idx);
          flat[iso] = (flat[iso] || []).concat(val[dayKey]);
        });
      }
    });

    return { plans: flat, changed: changed };
  }

  function migrateOldEmployerField(plansObj) {
    var changed = false;
    Object.keys(plansObj).forEach(function (dateKey) {
      var entries = plansObj[dateKey];
      if (!Array.isArray(entries)) return;
      entries.forEach(function (entry) {
        if (!Array.isArray(entry.employers)) {
          entry.employers = entry.employer ? [entry.employer] : [];
          delete entry.employer;
          changed = true;
        }
      });
    });
    return changed;
  }

  function isFirebaseConfigured() {
    var c = window.FIREBASE_CONFIG;
    return !!(c && typeof c === "object" && c.apiKey && c.projectId &&
      c.apiKey.indexOf("YOUR_") !== 0 && c.projectId.indexOf("YOUR_") !== 0);
  }

  // ---------------- Local (localStorage) backend ----------------
  function LocalBackend() {
    var STORAGE = { jobs: "lp_jobs", employers: "lp_employers", plans: "lp_plans", reminders: "lp_reminders" };
    var onChange = null;

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

    var state = {
      jobs: loadJSON(STORAGE.jobs, []),
      employers: loadJSON(STORAGE.employers, []),
      plans: loadJSON(STORAGE.plans, {}),
      reminders: loadJSON(STORAGE.reminders, [])
    };
    state.plans = migrateOldWeekFormat(state.plans).plans;
    migrateOldEmployerField(state.plans);

    function persist() {
      saveJSON(STORAGE.jobs, state.jobs);
      saveJSON(STORAGE.employers, state.employers);
      saveJSON(STORAGE.plans, state.plans);
      saveJSON(STORAGE.reminders, state.reminders);
    }

    function emit() {
      if (onChange) onChange(state);
    }

    return {
      init: function (callbacks) {
        onChange = callbacks.onChange;
        if (callbacks.onStatus) callbacks.onStatus("local");
        persist();
        emit();
        return Promise.resolve();
      },
      addJob: function (name) {
        if (state.jobs.indexOf(name) === -1) state.jobs.push(name);
        persist();
        emit();
        return Promise.resolve();
      },
      deleteJob: function (name) {
        var idx = state.jobs.indexOf(name);
        if (idx !== -1) state.jobs.splice(idx, 1);
        persist();
        emit();
        return Promise.resolve();
      },
      addEmployer: function (name) {
        if (state.employers.indexOf(name) === -1) state.employers.push(name);
        persist();
        emit();
        return Promise.resolve();
      },
      deleteEmployer: function (name) {
        var idx = state.employers.indexOf(name);
        if (idx !== -1) state.employers.splice(idx, 1);
        persist();
        emit();
        return Promise.resolve();
      },
      addTaskEntry: function (dateISO, entry) {
        if (!state.plans[dateISO]) state.plans[dateISO] = [];
        state.plans[dateISO].push(entry);
        persist();
        emit();
        return Promise.resolve();
      },
      removeTaskEntry: function (dateISO, entry) {
        var arr = state.plans[dateISO] || [];
        var idx = arr.findIndex(function (t) { return t.id === entry.id; });
        if (idx !== -1) arr.splice(idx, 1);
        persist();
        emit();
        return Promise.resolve();
      },
      clearDates: function (datesISO) {
        datesISO.forEach(function (d) { state.plans[d] = []; });
        persist();
        emit();
        return Promise.resolve();
      },
      addReminder: function (entry) {
        state.reminders.push(entry);
        persist();
        emit();
        return Promise.resolve();
      },
      removeReminder: function (entry) {
        var idx = state.reminders.findIndex(function (r) { return r.id === entry.id; });
        if (idx !== -1) state.reminders.splice(idx, 1);
        persist();
        emit();
        return Promise.resolve();
      },
      overwriteAll: function (data) {
        state.jobs = data.jobs || [];
        state.employers = data.employers || [];
        state.plans = migrateOldWeekFormat(data.plans || {}).plans;
        migrateOldEmployerField(state.plans);
        state.reminders = data.reminders || [];
        persist();
        emit();
        return Promise.resolve();
      }
    };
  }

  // ---------------- Firestore (team sync) backend ----------------
  function FirestoreBackend() {
    var onChange = null;
    var onStatus = null;
    var docRef = null;
    var state = { jobs: [], employers: [], plans: {}, reminders: [] };

    function handleSnapshot(snap) {
      if (!snap.exists) {
        docRef.set({ jobs: [], employers: [], plans: {}, reminders: [] }, { merge: true }).catch(reportError);
        return;
      }
      var data = snap.data() || {};
      state.jobs = data.jobs || [];
      state.employers = data.employers || [];
      state.reminders = data.reminders || [];

      var migrated = migrateOldWeekFormat(data.plans || {});
      state.plans = migrated.plans;
      var employerFieldChanged = migrateOldEmployerField(state.plans);

      if (onStatus) onStatus(snap.metadata.fromCache ? "offline" : "live");
      if (onChange) onChange(state);

      if (migrated.changed || employerFieldChanged) {
        // update() replaces the "plans" field's value outright (not a deep
        // merge), so old week-shaped sub-objects are fully discarded in
        // favour of the new flat date keys, in one clean write.
        docRef.update({ plans: state.plans }).catch(reportError);
      }
    }

    function reportError(err) {
      if (onStatus) onStatus("error");
      // eslint-disable-next-line no-console
      console.error("PlannerStore (Firestore) error:", err);
    }

    function dayPatch(dateISO, value) {
      var patch = { plans: {} };
      patch.plans[dateISO] = value;
      return patch;
    }

    return {
      init: function (callbacks) {
        onChange = callbacks.onChange;
        onStatus = callbacks.onStatus;
        if (onStatus) onStatus("connecting");
        try {
          firebase.initializeApp(window.FIREBASE_CONFIG);
          var db = firebase.firestore();
          // Some networks (certain WiFi routers/firewalls) block or break
          // the QUIC-based streaming connection Firestore tries by default,
          // causing "transport errored" / QUIC_NETWORK_IDLE_TIMEOUT. This
          // makes it detect that and fall back to a plain HTTP long-polling
          // connection instead, which works everywhere.
          if (db.settings) {
            db.settings({ experimentalAutoDetectLongPolling: true });
          }
          docRef = db.collection("labourPlanner").doc("shared");
          docRef.onSnapshot({ includeMetadataChanges: true }, handleSnapshot, reportError);
        } catch (e) {
          reportError(e);
        }
        return Promise.resolve();
      },
      addJob: function (name) {
        return docRef.set({ jobs: firebase.firestore.FieldValue.arrayUnion(name) }, { merge: true }).catch(reportError);
      },
      deleteJob: function (name) {
        return docRef.set({ jobs: firebase.firestore.FieldValue.arrayRemove(name) }, { merge: true }).catch(reportError);
      },
      addEmployer: function (name) {
        return docRef.set({ employers: firebase.firestore.FieldValue.arrayUnion(name) }, { merge: true }).catch(reportError);
      },
      deleteEmployer: function (name) {
        return docRef.set({ employers: firebase.firestore.FieldValue.arrayRemove(name) }, { merge: true }).catch(reportError);
      },
      addTaskEntry: function (dateISO, entry) {
        var patch = dayPatch(dateISO, firebase.firestore.FieldValue.arrayUnion(entry));
        return docRef.set(patch, { merge: true }).catch(reportError);
      },
      removeTaskEntry: function (dateISO, entry) {
        var patch = dayPatch(dateISO, firebase.firestore.FieldValue.arrayRemove(entry));
        return docRef.set(patch, { merge: true }).catch(reportError);
      },
      clearDates: function (datesISO) {
        var patch = { plans: {} };
        datesISO.forEach(function (d) { patch.plans[d] = []; });
        return docRef.set(patch, { merge: true }).catch(reportError);
      },
      addReminder: function (entry) {
        return docRef.set({ reminders: firebase.firestore.FieldValue.arrayUnion(entry) }, { merge: true }).catch(reportError);
      },
      removeReminder: function (entry) {
        return docRef.set({ reminders: firebase.firestore.FieldValue.arrayRemove(entry) }, { merge: true }).catch(reportError);
      },
      overwriteAll: function (data) {
        return docRef.set({
          jobs: data.jobs || [],
          employers: data.employers || [],
          plans: migrateOldWeekFormat(data.plans || {}).plans,
          reminders: data.reminders || []
        }).catch(reportError);
      }
    };
  }

  window.PlannerStore = isFirebaseConfigured() ? FirestoreBackend() : LocalBackend();
  window.PlannerStore.isTeamSyncEnabled = isFirebaseConfigured();
})();
