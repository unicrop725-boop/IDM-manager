/* Sign-in / sign-up pages: Google first, then name + phone + password, then email + password for next time. */
(function () {
  "use strict";
  var root = document.getElementById("auth");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/$/, "");
  if (API && (API.indexOf("localhost") >= 0 || API.indexOf("127.0.0.1") >= 0)) {
    API = API.replace(/localhost|127\.0\.0\.1/, window.location.hostname);
  }
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
    var name = $("p-name").value.trim(), rawPhone = $("p-phone").value.trim(), pw = $("p-pass").value, pw2 = $("p-pass2").value;
    var country = $("p-country") ? $("p-country").value : "+91";
    var cleanNumber = rawPhone.replace(/^0+/, "");
    var phone = cleanNumber.startsWith("+") ? cleanNumber : (country + cleanNumber);
    err("err-profile", "");
    if (name.length < 2) return err("err-profile", "Enter your full name.");
    if (!/^\+[0-9]{7,15}$/.test(phone.replace(/[\s().-]/g, ""))) return err("err-profile", "Enter a valid phone number (7 to 15 digits).");
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return err("err-profile", "Use at least 8 characters, with letters and a number.");
    if (pw !== pw2) return err("err-profile", "The two passwords do not match.");
    var btn = $("btn-profile"); btn.disabled = true;
    call("POST", "/api/auth/complete", { setupToken: setupToken, name: name, phone: phone.replace(/[\s().-]/g, ""), password: pw })
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

  /* ---- country code picker with real flag graphics ---- */
  var COUNTRIES = [
    { code: "in", dial: "+91", name: "India" },
    { code: "us", dial: "+1", name: "United States" },
    { code: "gb", dial: "+44", name: "United Kingdom" },
    { code: "ca", dial: "+1", name: "Canada" },
    { code: "au", dial: "+61", name: "Australia" },
    { code: "de", dial: "+49", name: "Germany" },
    { code: "fr", dial: "+33", name: "France" },
    { code: "ae", dial: "+971", name: "United Arab Emirates" },
    { code: "sa", dial: "+966", name: "Saudi Arabia" },
    { code: "sg", dial: "+65", name: "Singapore" },
    { code: "my", dial: "+60", name: "Malaysia" },
    { code: "id", dial: "+62", name: "Indonesia" },
    { code: "jp", dial: "+81", name: "Japan" },
    { code: "kr", dial: "+82", name: "South Korea" },
    { code: "br", dial: "+55", name: "Brazil" },
    { code: "ru", dial: "+7", name: "Russia" },
    { code: "it", dial: "+39", name: "Italy" },
    { code: "es", dial: "+34", name: "Spain" },
    { code: "nl", dial: "+31", name: "Netherlands" },
    { code: "ch", dial: "+41", name: "Switzerland" },
    { code: "se", dial: "+46", name: "Sweden" },
    { code: "pk", dial: "+92", name: "Pakistan" },
    { code: "bd", dial: "+880", name: "Bangladesh" },
    { code: "np", dial: "+977", name: "Nepal" },
    { code: "lk", dial: "+94", name: "Sri Lanka" },
    { code: "ph", dial: "+63", name: "Philippines" },
    { code: "vn", dial: "+84", name: "Vietnam" },
    { code: "th", dial: "+66", name: "Thailand" },
    { code: "tr", dial: "+90", name: "Turkey" },
    { code: "eg", dial: "+20", name: "Egypt" },
    { code: "za", dial: "+27", name: "South Africa" },
    { code: "ng", dial: "+234", name: "Nigeria" },
    { code: "mx", dial: "+52", name: "Mexico" },
    { code: "ar", dial: "+54", name: "Argentina" },
    { code: "nz", dial: "+64", name: "New Zealand" },
    { code: "ie", dial: "+353", name: "Ireland" },
    { code: "pt", dial: "+351", name: "Portugal" },
    { code: "pl", dial: "+48", name: "Poland" },
    { code: "ua", dial: "+380", name: "Ukraine" },
    { code: "gr", dial: "+30", name: "Greece" },
    { code: "at", dial: "+43", name: "Austria" },
    { code: "be", dial: "+32", name: "Belgium" },
    { code: "dk", dial: "+45", name: "Denmark" },
    { code: "fi", dial: "+358", name: "Finland" },
    { code: "no", dial: "+47", name: "Norway" },
    { code: "cz", dial: "+420", name: "Czechia" },
    { code: "ro", dial: "+40", name: "Romania" },
    { code: "hu", dial: "+36", name: "Hungary" },
    { code: "il", dial: "+972", name: "Israel" },
    { code: "qa", dial: "+974", name: "Qatar" },
    { code: "kw", dial: "+965", name: "Kuwait" },
    { code: "om", dial: "+968", name: "Oman" },
    { code: "bh", dial: "+973", name: "Bahrain" }
  ];

  var picker = $("phone-picker"), pickerBtn = $("phone-picker-btn"), pickerMenu = $("phone-picker-menu"), pickerList = $("phone-picker-list"), pickerFilter = $("phone-picker-filter");
  if (picker && pickerBtn && pickerMenu && pickerList) {
    function renderCountries(filterText) {
      var q = (filterText || "").toLowerCase().trim();
      var items = COUNTRIES.filter(function (c) {
        return !q || c.name.toLowerCase().indexOf(q) >= 0 || c.dial.indexOf(q) >= 0 || c.code.indexOf(q) >= 0;
      });
      pickerList.innerHTML = items.map(function (c) {
        return '<li class="phone-picker-item" data-code="' + c.code + '" data-dial="' + c.dial + '" data-name="' + c.name + '">' +
          '<img src="https://flagcdn.com/24x18/' + c.code + '.png" width="20" height="15" alt="" />' +
          '<span class="c-name">' + c.name + '</span>' +
          '<span class="c-code">' + c.dial + '</span>' +
          '</li>';
      }).join("");
    }
    renderCountries("");

    function openPicker() {
      pickerMenu.hidden = false;
      picker.classList.add("open");
      pickerBtn.setAttribute("aria-expanded", "true");
      if (pickerFilter) { pickerFilter.value = ""; renderCountries(""); pickerFilter.focus(); }
    }
    function closePicker() {
      pickerMenu.hidden = true;
      picker.classList.remove("open");
      pickerBtn.setAttribute("aria-expanded", "false");
    }

    pickerBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (pickerMenu.hidden) openPicker(); else closePicker();
    });

    if (pickerFilter) {
      pickerFilter.addEventListener("input", function () {
        renderCountries(pickerFilter.value);
      });
      pickerFilter.addEventListener("click", function (e) { e.stopPropagation(); });
    }

    pickerList.addEventListener("click", function (e) {
      var item = e.target.closest(".phone-picker-item");
      if (!item) return;
      var code = item.getAttribute("data-code");
      var dial = item.getAttribute("data-dial");
      var name = item.getAttribute("data-name");
      $("p-flag-selected").src = "https://flagcdn.com/24x18/" + code + ".png";
      $("p-flag-selected").alt = name;
      $("p-dial-selected").textContent = dial;
      $("p-country").value = dial;
      closePicker();
      $("p-phone").focus();
    });

    document.addEventListener("click", function (e) {
      if (!picker.contains(e.target)) closePicker();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !pickerMenu.hidden) closePicker();
    });
  }

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
