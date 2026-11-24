/* Account page: shows the signed-in person and the license keys bought with their email. */
(function () {
  "use strict";
  var root = document.getElementById("acct");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/$/, "");
  var $ = function (id) { return document.getElementById(id); };
  if (!API) { window.location.replace("/signin/"); return; }

  function call(method, path) {
    return fetch(API + path, { method: method, credentials: "include", headers: method === "POST" ? { "Content-Type": "application/json" } : undefined, body: method === "POST" ? "{}" : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { if (!res.ok) { var e = new Error(j.error || "Error"); e.status = res.status; throw e; } return j; }); });
  }

  call("GET", "/api/auth/me").then(function (d) {
    var u = d.user;
    $("a-first").textContent = (u.name || u.email).split(" ")[0];
    $("a-name").textContent = u.name || "–";
    $("a-email").textContent = u.email;
    $("a-phone").textContent = u.phone || "–";
    var list = $("a-lic");
    if (d.licenses && d.licenses.length) {
      $("a-lic-empty").hidden = true;
      list.hidden = false;
      d.licenses.forEach(function (l) {
        var li = document.createElement("li");
        var t = document.createElement("div"); t.className = "t";
        t.textContent = "FlowGet Pro (" + (l.tier || "lifetime") + ") · up to " + (l.maxDevices || 2) + " PCs · " + (l.issuedAt ? new Date(l.issuedAt).toLocaleDateString() : "");
        var code = document.createElement("code"); code.textContent = l.licenseKey;
        var b = document.createElement("button"); b.type = "button"; b.className = "soft"; b.textContent = "Copy key";
        b.addEventListener("click", function () {
          (navigator.clipboard ? navigator.clipboard.writeText(l.licenseKey) : Promise.reject()).then(function () { b.textContent = "Copied"; }, function () { b.textContent = "Select the key to copy"; });
          setTimeout(function () { b.textContent = "Copy key"; }, 2000);
        });
        li.appendChild(t); li.appendChild(code); li.appendChild(b); list.appendChild(li);
      });
    }
    if (d.isAdmin) $("a-admin").hidden = false;
    $("a-loading").hidden = true;
    $("a-main").hidden = false;
  }).catch(function (e) {
    if (e.status === 401) window.location.replace("/signin/");
    else $("a-loading").textContent = "Could not load your account. Try again in a moment.";
  });

  /* ---- write a review (buyers only) ---- */
  var rating = 0;
  var STAR = "M12 3.6l2.5 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.1 2.7 1-5.8-4.2-4.1 5.8-.8z";
  function paintStars() {
    [].forEach.call($("stars").children, function (b, i) { b.classList.toggle("on", i < rating); b.setAttribute("aria-checked", String(i + 1 === rating)); });
  }
  (function buildStars() {
    for (var i = 1; i <= 5; i++) (function (n) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-label", n + (n === 1 ? " star" : " stars"));
      var ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path");
      s.setAttribute("viewBox", "0 0 24 24"); p.setAttribute("d", STAR); p.setAttribute("stroke-linejoin", "round"); s.appendChild(p); b.appendChild(s);
      b.addEventListener("click", function () { rating = n; paintStars(); });
      $("stars").appendChild(b);
    })(i);
  })();
  function showState(status) {
    var el = $("rv-state");
    if (!status) { el.hidden = true; return; }
    el.hidden = false;
    el.className = "rv-state" + (status === "approved" ? " live" : "");
    el.textContent = status === "approved" ? "Your review is published on the website. Editing it sends it for approval again." : status === "rejected" ? "Your review was not published. You can change it and send it again." : "Thank you! Your review is waiting for approval.";
  }
  call("GET", "/api/reviews/mine").then(function (m) {
    if (!m.canReview) return;
    $("a-review").hidden = false;
    if (m.review) {
      rating = m.review.rating; paintStars();
      $("rv-text").value = m.review.text; $("rv-role").value = m.review.role || "";
      $("btn-review").textContent = "Update review";
      showState(m.review.status);
    }
  }).catch(function () {});
  $("form-review").addEventListener("submit", function (e) {
    e.preventDefault();
    $("err-review").textContent = "";
    if (!rating) return ($("err-review").textContent = "Choose a rating from 1 to 5 stars.");
    var text = $("rv-text").value.trim();
    if (text.length < 20) return ($("err-review").textContent = "Write at least 20 characters about your experience.");
    var btn = $("btn-review"); btn.disabled = true;
    fetch(API + "/api/reviews", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: rating, text: text, role: $("rv-role").value.trim() }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { if (!res.ok) throw new Error(j.error || "Could not send your review."); return j; }); })
      .then(function () { showState("pending"); btn.textContent = "Update review"; })
      .catch(function (x) { $("err-review").textContent = x.message; })
      .then(function () { btn.disabled = false; });
  });

  $("a-out").addEventListener("click", function () {
    call("POST", "/api/auth/logout").catch(function () {}).then(function () { window.location.assign("/signin/?switch=1"); });
  });
})();
