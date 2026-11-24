/* Speed lab: replays the measured test runs, sped up. The times are the real measurements from FlowGet's own test server. */
(function () {
  "use strict";
  var box = document.getElementById("lab");
  if (!box) return;
  var SCEN = {
    slow: { d: "One connection is slow. A plain 8-part downloader waits for its slowest part to finish; FlowGet hands that part's remaining work to idle connections.", t: [14.4, 16.5, 5.5] },
    silent: { d: "One connection goes silent mid-download. Fixed parts wait on it; FlowGet notices, gives its work to the others and carries on.", t: [15.3, 32.0, 4.0] },
    outage: { d: "The internet drops for 30 seconds. All three have to wait; FlowGet continues from the last saved byte as soon as the network returns.", t: [70.3, 61.4, 36.6] }
  };
  var SPEEDUP = 8; // measured seconds per real second
  var current = "slow", raf = 0, started = 0, seen = false;
  var bars = [].slice.call(box.querySelectorAll(".lab-bar"));
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fill(i, f, secs, done) {
    var b = bars[i];
    b.querySelector("i").style.width = (f * 100) + "%";
    b.querySelector(".tm").textContent = secs.toFixed(1) + " s";
    b.classList.toggle("won", !!done);
  }
  function frame(now) {
    var t = SCEN[current].t, el = (now - started) / 1000 * SPEEDUP, best = Math.min.apply(null, t), all = true;
    t.forEach(function (d, i) {
      var f = Math.min(1, el / d);
      if (f < 1) all = false;
      fill(i, f, Math.min(el, d), f >= 1 && d === best);
    });
    raf = all ? 0 : requestAnimationFrame(frame);
    if (all) box.querySelector("[data-lab-result]").innerHTML = "FlowGet finished <b>" + (Math.max.apply(null, t.slice(0, 2)) / t[2]).toFixed(1) + "×</b> sooner than the slower of the other two.";
  }
  function run() {
    cancelAnimationFrame(raf);
    box.querySelector("[data-lab-result]").textContent = "Replaying the measured run…";
    if (reduce) {
      SCEN[current].t.forEach(function (d, i) { fill(i, 1, d, d === Math.min.apply(null, SCEN[current].t)); });
      return;
    }
    bars.forEach(function (_, i) { fill(i, 0, 0, false); });
    started = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pick(k) {
    current = k;
    [].forEach.call(box.querySelectorAll("[data-scen]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-scen") === k ? "true" : "false"); });
    box.querySelector("[data-lab-desc]").textContent = SCEN[k].d;
    run();
  }
  box.addEventListener("click", function (e) {
    var s = e.target.closest("[data-scen]");
    if (s) pick(s.getAttribute("data-scen"));
    else if (e.target.closest("[data-lab-run]")) run();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { if (en[0].isIntersecting && !seen) { seen = true; pick("slow"); } }, { threshold: 0.35 }).observe(box);
  } else pick("slow");
})();
