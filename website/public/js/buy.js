/* Buy page: asks the FlowGet API to start a Dodo Payments checkout, then sends the buyer to Dodo's hosted payment page. */
(function () {
  "use strict";
  var root = document.getElementById("buy");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/$/, "");
  var $ = function (id) { return document.getElementById(id); };
  var err = function (msg) { $("err-buy").textContent = msg || ""; };

  if (!API) { $("buy-off").hidden = false; return; }
  $("buy-form").hidden = false;

  // Signed in already? Fill in the details.
  fetch(API + "/api/auth/me", { credentials: "include" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.user) return;
      if (!$("b-email").value) $("b-email").value = d.user.email || "";
      if (!$("b-name").value) $("b-name").value = d.user.name || "";
    })
    .catch(function () {});

  $("form-buy").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("b-email").value.trim();
    err("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err("Enter a valid email address. Your license key is linked to it.");
    var btn = $("btn-buy");
    btn.disabled = true;
    btn.textContent = "Opening secure payment…";
    fetch(API + "/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, name: $("b-name").value.trim() })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok) throw new Error(j.error || "Could not start the payment. Please try again.");
          return j;
        });
      })
      .then(function (j) {
        var u;
        try { u = new URL(j.checkoutUrl); } catch (x) { u = null; }
        if (!u || u.protocol !== "https:" || !/(^|\.)dodopayments\.com$/.test(u.hostname)) throw new Error("Unexpected payment address. Please contact support.");
        window.location.assign(u.href);
      })
      .catch(function (x) {
        err(x instanceof TypeError ? "Could not reach the payment service. Check your connection and try again." : x.message);
        btn.disabled = false;
        btn.textContent = "Continue to secure payment";
      });
  });
})();
