/* Sizes the embedded BoltGrab demo to its column and mirrors its live numbers into the caption below it. */
(function () {
  "use strict";
  var frame = document.getElementById("appframe");
  var iframe = document.getElementById("appdemo");
  if (!frame || !iframe) return;
  var DESIGN = 1176; // the width the app is laid out for at full size
  var MIN = 900; // below this the app is scaled down instead of squeezed

  function fit() {
    var w = frame.clientWidth || DESIGN;
    var inner = Math.max(MIN, Math.min(w, DESIGN * 1.25));
    frame.style.setProperty("--s", String(w / inner));
  }
  fit();
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(frame);
  else window.addEventListener("resize", fit);

  function mb(b) { return (b / 1048576).toFixed(1) + " MB/s"; }
  window.addEventListener("message", function (e) {
    if (e.origin !== window.location.origin || e.source !== iframe.contentWindow) return;
    var d = e.data;
    if (!d || d.type !== "flowget-demo") return;
    var a = document.getElementById("c-active"), s = document.getElementById("c-speed"), f = document.getElementById("c-done");
    if (a) a.textContent = d.active + " downloads active";
    if (s) s.textContent = mb(d.speedBps) + " total";
    if (f) f.textContent = d.done + " finished";
  });

  var reset = document.getElementById("demo-reset");
  if (reset) reset.addEventListener("click", function () {
    try { iframe.contentWindow.location.reload(); } catch (err) { iframe.src = iframe.src; }
  });
})();
