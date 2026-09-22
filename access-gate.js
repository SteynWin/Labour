/*
 * A simple access code screen shown before the page content.
 *
 * This is a light deterrent, not real security: the code below is visible
 * to anyone who views this file (especially since the repo is public on
 * GitHub). It stops someone from casually opening the link without the
 * code, but doesn't protect the underlying shared data - that's controlled
 * separately by the Firestore rule (see SETUP-TEAM-SYNC.md).
 *
 * Once someone enters the code correctly, this device/browser remembers
 * it (localStorage) so they aren't asked again.
 */
(function () {
  "use strict";

  var ACCESS_CODE = "3622";
  var STORAGE_KEY = "lp_access_ok";

  var gate = document.getElementById("pinGate");
  var form = document.getElementById("pinForm");
  var input = document.getElementById("pinInput");
  var error = document.getElementById("pinError");

  if (gate.style.display !== "none") {
    input.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var value = input.value.trim();
    if (value === ACCESS_CODE) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch (err) {}
      gate.style.display = "none";
      document.body.classList.remove("gate-locked");
    } else {
      error.textContent = "That code isn't right. Try again.";
      input.value = "";
      input.focus();
    }
  });
})();
