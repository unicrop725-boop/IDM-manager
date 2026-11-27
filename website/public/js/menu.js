(function () {
  "use strict";
  var btn = document.getElementById("menu-btn");
  var links = document.getElementById("nav-links");
  if (btn && links) {
    btn.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A" && !e.target.closest("#nav-user-menu")) {
        links.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---- Header User Auth State ---- */
  var nav = document.getElementById("main-nav");
  var signinLink = document.getElementById("nav-signin");
  var userWrap = document.getElementById("nav-user-wrap");
  var userBtn = document.getElementById("nav-user-btn");
  var userMenu = document.getElementById("nav-user-menu");
  var logoutBtn = document.getElementById("nav-user-logout");

  if (nav && signinLink && userWrap && userBtn && userMenu) {
    var rawApi = (nav.getAttribute("data-api") || "").replace(/\/$/, "");
    if (rawApi && (rawApi.indexOf("localhost") >= 0 || rawApi.indexOf("127.0.0.1") >= 0)) {
      rawApi = rawApi.replace(/localhost|127\.0\.0\.1/, window.location.hostname);
    }

    if (rawApi) {
      fetch(rawApi + "/api/auth/me", { credentials: "include" })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || !data.user) return;
          var u = data.user;
          signinLink.hidden = true;
          userWrap.hidden = false;

          var displayName = (u.name || u.email.split("@")[0] || "User").trim();
          var fullName = document.getElementById("nav-user-fullname");
          var emailSpan = document.getElementById("nav-user-email");

          if (fullName) fullName.textContent = u.name || displayName;
          if (emailSpan) emailSpan.textContent = u.email;
        })
        .catch(function () {});

      // Toggle dropdown menu
      userBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var isHidden = userMenu.hidden;
        userMenu.hidden = !isHidden;
        userWrap.classList.toggle("open", isHidden);
        userBtn.setAttribute("aria-expanded", isHidden ? "true" : "false");
      });

      // Close dropdown when clicking outside
      document.addEventListener("click", function (e) {
        if (!userWrap.contains(e.target)) {
          userMenu.hidden = true;
          userWrap.classList.remove("open");
          userBtn.setAttribute("aria-expanded", "false");
        }
      });

      // Logout
      if (logoutBtn) {
        logoutBtn.addEventListener("click", function () {
          logoutBtn.disabled = true;
          fetch(rawApi + "/api/auth/logout", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" }
          }).finally(function () {
            window.location.assign("/");
          });
        });
      }
    }
  }
})();
