/* Buyer reviews carousel in the showcase panel of the sign-in / sign-up / buy pages. Shows only approved reviews; stays hidden when there are none. */
(function () {
  "use strict";
  var panel = document.querySelector(".vis");
  var box = document.getElementById("reviews");
  if (!panel || !box) return;
  var API = (panel.getAttribute("data-api") || "").replace(/\/$/, "");
  if (!API) return;
  var NS = "http://www.w3.org/2000/svg";
  var track = document.getElementById("rv-track");
  // Placeholder reviews for design/testing only. Used when there are no real ones AND the site was built with PUBLIC_SAMPLE_REVIEWS=1.
  var SAMPLE = [
    { name: "Daniel W.", role: "Video editor", rating: 5, text: "Resumed a 9 GB download after my Wi-Fi dropped, without starting over. Exactly what I bought it for." },
    { name: "Priya S.", role: "IT administrator", rating: 5, text: "The speed limit by time of day is great: full speed at night, quiet during work hours." },
    { name: "Lucas M.", role: "Student", rating: 4, text: "Much faster than my browser for large files. The Download Video button in the browser is handy too." },
    { name: "Aisha K.", role: "Freelance designer", rating: 5, text: "Simple, fast and it does not nag me. One payment and done." },
    { name: "Tom R.", role: "Accountant", rating: 5, text: "Warned me about a file with a double extension before I opened it. That alone was worth it." }
  ];

  function svg(cls, d) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke-width", "1.6");
    p.setAttribute("stroke-linejoin", "round");
    s.appendChild(p);
    return s;
  }
  var STAR = "M12 3.6l2.5 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.1 2.7 1-5.8-4.2-4.1 5.8-.8z";
  function initials(name) {
    var p = String(name || "?").split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase().replace(".", "");
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function card(r, sample) {
    var c = el("article", "rv-card");
    c.setAttribute("role", "listitem");
    var top = el("div");
    var stars = el("div", "rv-stars");
    stars.setAttribute("role", "img");
    stars.setAttribute("aria-label", r.rating + " out of 5 stars");
    for (var i = 1; i <= 5; i++) stars.appendChild(svg(i <= r.rating ? "on" : "off", STAR));
    top.appendChild(stars);
    top.appendChild(el("p", "rv-text", r.text));
    var by = el("div", "rv-by");
    by.appendChild(el("span", "rv-av", initials(r.name)));
    var who = el("div");
    var nm = el("b", null, r.name);
    var ok = el("span", "ok");
    var tick = document.createElementNS(NS, "svg");
    tick.setAttribute("viewBox", "0 0 24 24"); tick.setAttribute("aria-hidden", "true");
    var tp = document.createElementNS(NS, "path"); tp.setAttribute("d", "M5 12.5l4.2 4.2L19 7"); tick.appendChild(tp);
    ok.appendChild(tick); ok.appendChild(document.createTextNode("Verified buyer"));
    if (!sample) nm.appendChild(ok);
    who.appendChild(nm);
    if (r.role) who.appendChild(el("small", null, r.role));
    by.appendChild(who);
    c.appendChild(top);
    c.appendChild(by);
    return c;
  }

  fetch(API + "/api/reviews").then(function (r) { return r.ok ? r.json() : { reviews: [] }; }).then(function (d) {
    var list = (d && d.reviews) || [];
    var sample = false;
    if (!list.length && panel.getAttribute("data-sample") === "1") { list = SAMPLE; sample = true; }
    if (!list.length) return;
    list.forEach(function (r) { track.appendChild(card(r, sample)); });
    box.hidden = false;

    // Slow, continuous scroll that loops forever. It pauses while the pointer is over it or the tab is hidden,
    // and is skipped when the person asked for less motion (the row can still be swiped).
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var setW = track.scrollWidth + 12; // width of one full set of cards incl. gaps (4px padding, 16px gap)
    if (reduce || setW <= track.clientWidth) return;
    [].slice.call(track.children).forEach(function (c) {
      var k = c.cloneNode(true);
      k.setAttribute("aria-hidden", "true");
      track.appendChild(k);
    });
    var pos = 0, last = 0, hover = false, SPEED = 34; // pixels per second
    box.addEventListener("mouseenter", function () { hover = true; });
    box.addEventListener("mouseleave", function () { hover = false; pos = track.scrollLeft; });
    box.addEventListener("touchstart", function () { hover = true; }, { passive: true });
    box.addEventListener("touchend", function () { setTimeout(function () { hover = false; pos = track.scrollLeft; }, 1500); }, { passive: true });
    function tick(t) {
      var dt = last ? Math.min(t - last, 100) : 0;
      last = t;
      if (!hover && !document.hidden) {
        pos += (SPEED * dt) / 1000;
        if (pos >= setW) pos -= setW;
        track.scrollLeft = pos;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }).catch(function () { /* no reviews shown */ });
})();
