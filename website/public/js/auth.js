/* Sign-in / sign-up pages: Google first, then name + phone + password, then email + password for next time. */
(function () {
  "use strict";
  var root = document.getElementById("auth");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/$/, "");
  var $ = function (id) { return document.getElementById(id); };
  var mode = root.getAttribute("data-mode") === "signup" ? "signup" : "signin";
  var views = { home: $("view-" + mode), profile: $("view-profile"), off: $("view-off") };
  var setupToken = "";
  var googleReady = false;

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
  }
  function err(id, msg) { var el = $(id); if (el) el.textContent = msg || ""; }

  function call(method, path, body) {
    return fetch(API + path, {
      method: method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { var e = new Error(j.error || "Something went wrong. Please try again."); e.status = res.status; throw e; }
        return j;
      });
    }, function () { throw new Error("Could not reach the sign-in service. Check your connection and try again."); });
  }

  // "?next=/admin/" sends the person back where they came from (same-site paths only).
  function done() {
    var n = new URLSearchParams(location.search).get("next") || "";
    window.location.assign(/^\/[A-Za-z0-9]/.test(n) && n.indexOf("//") < 0 && n.indexOf("\\") < 0 ? n : "/account/");
  }

  function handleAuth(j) {
    if (j.status === "signed_in") return done();
    if (j.status === "needs_profile") {
      setupToken = j.setupToken;
      $("p-email").textContent = j.email;
      if (j.name && !$("p-name").value) $("p-name").value = j.name;
      err("err-profile", "");
      show("profile");
      ($("p-name").value ? $("p-phone") : $("p-name")).focus();
    }
  }

  function onGoogle(credential) {
    err("err-google", "");
    call("POST", "/api/auth/google", { credential: credential }).then(handleAuth).catch(function (e) { err("err-google", e.message); });
  }

  /* ---- show / hide password ---- */
  [].forEach.call(document.querySelectorAll("[data-toggle]"), function (b) {
    b.addEventListener("click", function () {
      var input = $(b.getAttribute("data-toggle"));
      var hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      b.textContent = hidden ? "Hide" : "Show";
    });
  });

  /* ---- email + password login ---- */
  if ($("form-login")) $("form-login").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("l-email").value.trim(), pass = $("l-pass").value;
    err("err-login", "");
    if (!email || !pass) return err("err-login", "Enter your email and password.");
    var btn = $("btn-login"); btn.disabled = true;
    call("POST", "/api/auth/login", { email: email, password: pass, remember: $("l-remember").checked })
      .then(handleAuth)
      .catch(function (x) { err("err-login", x.message); btn.disabled = false; });
  });

  /* ---- finish a new account ---- */
  $("form-profile").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("p-name").value.trim(), phone = $("p-phone").value.trim(), pw = $("p-pass").value, pw2 = $("p-pass2").value;
    err("err-profile", "");
    if (name.length < 2) return err("err-profile", "Enter your full name.");
    if (!/^\+?[0-9]{7,15}$/.test(phone.replace(/[\s().-]/g, ""))) return err("err-profile", "Enter a valid phone number (7 to 15 digits, with country code if outside India).");
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return err("err-profile", "Use at least 8 characters, with letters and a number.");
    if (pw !== pw2) return err("err-profile", "The two passwords do not match.");
    var btn = $("btn-profile"); btn.disabled = true;
    call("POST", "/api/auth/complete", { setupToken: setupToken, name: name, phone: phone, password: pw })
      .then(handleAuth)
      .catch(function (x) {
        err("err-profile", x.message);
        btn.disabled = false;
        if (x.status === 401) { setupToken = ""; setTimeout(function () { show("home"); err("err-google", x.message); }, 1800); }
      });
  });

  $("p-back").addEventListener("click", function (e) {
    e.preventDefault();
    setupToken = ""; $("p-pass").value = ""; $("p-pass2").value = "";
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    show("home");
  });

  /* ---- Google button: our own look; Google's real button sits invisibly on top once it has loaded ---- */
  var devOn = false;
  $("g-fake").addEventListener("click", function () {
    if (googleReady) return;
    if (devOn) { $("dev-email").focus(); err("err-google", ""); return; }
    $("g-missing").hidden = false;
  });
  function loadGoogle(clientId) {
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = function () {
      googleReady = true;
      google.accounts.id.initialize({ client_id: clientId, callback: function (r) { onGoogle(r.credential); }, ux_mode: "popup", auto_select: false });
      var w = Math.min(400, Math.max(200, Math.round($("g-slot").getBoundingClientRect().width) || 356));
      google.accounts.id.renderButton($("g-slot"), { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "center", width: w });
    };
    s.onerror = function () { $("g-missing").textContent = "Could not load Google sign-in. Check your connection or an ad blocker."; $("g-missing").hidden = false; };
    document.head.appendChild(s);
  }

  /* ---- start ---- */
  if (!API) { show("off"); return; }
  show("home");
  // Already signed in? Go straight to the account page.
  call("GET", "/api/auth/me").then(function () { if (!/[?&]switch=1/.test(location.search)) done(); }).catch(function () {});
  call("GET", "/api/auth/config").then(function (c) {
    if (c.googleClientId) loadGoogle(c.googleClientId);
    else if (!c.devGoogle) $("g-missing").hidden = false;
    if (c.devGoogle) {
      devOn = true;
      $("dev-box").hidden = false;
      $("dev-go").addEventListener("click", function () {
        var email = $("dev-email").value.trim();
        if (email) onGoogle("dev:" + email + "|" + email.split("@")[0]);
      });
    }
  }).catch(function (e) { $("g-missing").textContent = e.message; $("g-missing").hidden = false; });
  void googleReady;
})();
