/* Thank-you page: waits for Dodo's payment webhook to create the license, then shows the key. */
(function () {
  "use strict";
  var root = document.getElementById("thanks");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/$/, "");
  if (API && (API.indexOf("localhost") >= 0 || API.indexOf("127.0.0.1") >= 0)) {
    API = API.replace(/localhost|127\.0\.0\.1/, window.location.hostname);
  }
  var $ = function (id) { return document.getElementById(id); };
  var order = (new URLSearchParams(location.search).get("order") || "").trim();
  var views = ["t-wait", "t-paid", "t-late", "t-refund", "t-none"];
  var tries = 0, timer = 0;

  function show(id) { views.forEach(function (v) { $(v).hidden = v !== id; }); }

  function paid(j) {
    $("t-key").textContent = j.licenseKey;
    $("t-meta").textContent = "FlowGet Pro (lifetime) · up to 2 PCs" + (j.email ? " · " + j.email : "");
    show("t-paid");
  }

  function poll() {
    fetch(API + "/api/checkout/status?order=" + encodeURIComponent(order))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (r) {
        if (r.status === 404) return show("t-none");
        if (!r.ok) throw new Error("status");
        if (r.j.status === "paid") return paid(r.j);
        if (r.j.status === "refunded") return show("t-refund");
        if (++tries >= 40) return show("t-late"); // about 2 minutes
        timer = setTimeout(poll, 3000);
      })
      .catch(function () {
        if (++tries >= 40) return show("t-late");
        timer = setTimeout(poll, 4000);
      });
  }

  $("t-copy").addEventListener("click", function () {
    var b = $("t-copy"), key = $("t-key").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(key) : Promise.reject()).then(
      function () { b.textContent = "Copied"; },
      function () { b.textContent = "Select the key to copy"; }
    );
    setTimeout(function () { b.textContent = "Copy key"; }, 2000);
  });
  $("t-retry").addEventListener("click", function () { tries = 0; show("t-wait"); clearTimeout(timer); poll(); });

  if (!API || !/^ord_[a-f0-9]{32}$/.test(order)) return show("t-none");
  poll();
})();
