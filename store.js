/*
 * PlannerStore - a small persistence layer with two backends:
 *
 *  - Local (default): saves to this browser's localStorage only, exactly
 *    like the app worked before. Nothing to set up.
 *
 *  - Firestore (team sync): once firebase-config.js has real values, data
 *    is stored in Firebase and every device that opens the page shares the
 *    same jobs, team mates and weekly plans in real time.
 *
 * Either way, callers use the same small API:
 *
 *   PlannerStore.init({ onChange: fn, onStatus: fn })
 *   PlannerStore.addJob(name) / deleteJob(name)
 *   PlannerStore.addEmployer(name) / deleteEmployer(name)
 *   PlannerStore.addTaskEntry(weekStart, dayKey, entry)
 *   PlannerStore.removeTaskEntry(weekStart, dayKey, entry)
 *   PlannerStore.clearWeek(weekStart)
 *   PlannerStore.overwriteAll({ jobs, employers, plans })
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

  var DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  function emptyPlan() {
    var plan = {};
    DAY_KEYS.forEach(function (k) { plan[k] = []; });
    return plan;
  }

  function migrateOldEmployerField(plansObj) {
    var changed = false;
    Object.keys(plansObj).forEach(function (weekKey) {
      var plan = plansObj[weekKey];
      DAY_KEYS.forEach(function (dayKey) {
        if (!Array.isArray(plan[dayKey])) return;
        plan[dayKey].forEach(function (entry) {
          if (!Array.isArray(entry.employers)) {
            entry.employers = entry.employer ? [entry.employer] : [];
            delete entry.employer;
            changed = true;
          }
        });
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
    var STORAGE = { jobs: "lp_jobs", employers: "lp_employers", plans: "lp_plans" };
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
      plans: loadJSON(STORAGE.plans, {})
    };
    migrateOldEmployerField(state.plans);

    function persist() {
      saveJSON(STORAGE.jobs, state.jobs);
      saveJSON(STORAGE.employers, state.employers);
      saveJSON(STORAGE.plans, state.plans);
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
      addTaskEntry: function (weekStart, dayKey, entry) {
        if (!state.plans[weekStart]) state.plans[weekStart] = emptyPlan();
        state.plans[weekStart][dayKey].push(entry);
        persist();
        emit();
        return Promise.resolve();
      },
      removeTaskEntry: function (weekStart, dayKey, entry) {
        if (!state.plans[weekStart]) return Promise.resolve();
        var arr = state.plans[weekStart][dayKey] || [];
        var idx = arr.findIndex(function (t) { return t.id === entry.id; });
        if (idx !== -1) arr.splice(idx, 1);
        persist();
        emit();
        return Promise.resolve();
      },
      clearWeek: function (weekStart) {
        state.plans[weekStart] = emptyPlan();
        persist();
        emit();
        return Promise.resolve();
      },
      overwriteAll: function (data) {
        state.jobs = data.jobs || [];
        state.employers = data.employers || [];
        state.plans = data.plans || {};
        migrateOldEmployerField(state.plans);
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
    var state = { jobs: [], employers: [], plans: {} };

    function handleSnapshot(snap) {
      if (!snap.exists) {
        docRef.set({ jobs: [], employers: [], plans: {} }, { merge: true }).catch(reportError);
        return;
      }
      var data = snap.data() || {};
      state.jobs = data.jobs || [];
      state.employers = data.employers || [];
      state.plans = data.plans || {};
      var changed = migrateOldEmployerField(state.plans);
      if (onStatus) onStatus(snap.metadata.fromCache ? "offline" : "live");
      if (onChange) onChange(state);
      if (changed) {
        docRef.set({ plans: state.plans }, { merge: true }).catch(reportError);
      }
    }

    function reportError(err) {
      if (onStatus) onStatus("error");
      // eslint-disable-next-line no-console
      console.error("PlannerStore (Firestore) error:", err);
    }

    function dayFieldPath(weekStart, dayKey) {
      return "plans." + weekStart + "." + dayKey;
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
      addTaskEntry: function (weekStart, dayKey, entry) {
        var patch = {};
        patch[dayFieldPath(weekStart, dayKey)] = firebase.firestore.FieldValue.arrayUnion(entry);
        return docRef.set(patch, { merge: true }).catch(reportError);
      },
      removeTaskEntry: function (weekStart, dayKey, entry) {
        var patch = {};
        patch[dayFieldPath(weekStart, dayKey)] = firebase.firestore.FieldValue.arrayRemove(entry);
        return docRef.set(patch, { merge: true }).catch(reportError);
      },
      clearWeek: function (weekStart) {
        var patch = {};
        patch["plans." + weekStart] = emptyPlan();
        return docRef.set(patch, { merge: true }).catch(reportError);
      },
      overwriteAll: function (data) {
        return docRef.set({
          jobs: data.jobs || [],
          employers: data.employers || [],
          plans: data.plans || {}
        }).catch(reportError);
      }
    };
  }

  window.PlannerStore = isFirebaseConfigured() ? FirestoreBackend() : LocalBackend();
  window.PlannerStore.isTeamSyncEnabled = isFirebaseConfigured();
})();
