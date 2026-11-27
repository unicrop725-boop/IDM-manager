(function () {
  var root = document.getElementById("admin-auth");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/$/, "");
  if (API && (API.indexOf("localhost") >= 0 || API.indexOf("127.0.0.1") >= 0)) {
    API = API.replace(/localhost|127\.0\.0\.1/, window.location.hostname);
  }
  var errEl = document.getElementById("err-admin-auth");
  function setErr(msg) { errEl.textContent = msg || ""; }

  function checkAdminAndRedirect() {
    fetch(API + "/api/admin/me", { credentials: "include" })
      .then(function (res) {
        if (res.ok) {
          window.location.replace("/admin/");
        } else if (res.status === 403) {
          setErr("Access Denied: This account is not an authorized administrator.");
        }
      })
      .catch(function () {});
  }

  // If already signed in as admin, go straight in
  checkAdminAndRedirect();

  // Email + Password login
  var form = document.getElementById("admin-login-form");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    setErr("");
    var email = document.getElementById("adm-email").value.trim();
    var pass = document.getElementById("adm-pass").value;
    if (!email || !pass) return setErr("Enter your admin email and password.");

    var btn = document.getElementById("adm-btn");
    btn.disabled = true;
    btn.textContent = "Checking credentials…";

    fetch(API + "/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: pass, remember: true })
    })
      .then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || "Login failed."); return j; }); })
      .then(function () {
        // Check if admin
        return fetch(API + "/api/admin/me", { credentials: "include" })
          .then(function (res) {
            if (res.ok) {
              window.location.replace("/admin/");
            } else {
              throw new Error("Access Denied: " + email + " is not configured as an administrator.");
            }
          });
      })
      .catch(function (err) {
        setErr(err.message);
        btn.disabled = false;
        btn.textContent = "Sign In to Admin";
      });
  });

  // Google Sign In
  fetch(API + "/api/auth/config")
    .then(function (res) { return res.json(); })
    .then(function (c) {
      if (!c.googleClientId) return;
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = function () {
        google.accounts.id.initialize({
          client_id: c.googleClientId,
          callback: function (r) {
            setErr("");
            fetch(API + "/api/auth/google", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: r.credential })
            })
              .then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || "Failed"); return j; }); })
              .then(function () {
                return fetch(API + "/api/admin/me", { credentials: "include" })
                  .then(function (res) {
                    if (res.ok) {
                      window.location.replace("/admin/");
                    } else {
                      throw new Error("Access Denied: Your Google account is not configured as an administrator.");
                    }
                  });
              })
              .catch(function (err) {
                setErr(err.message);
              });
          },
          ux_mode: "popup"
        });
        var slot = document.getElementById("g-slot");
        google.accounts.id.renderButton(slot, { theme: "outline", size: "large", width: 376 });
      };
      document.head.appendChild(s);
    })
    .catch(function () {});
})();
