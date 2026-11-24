// "Copy link" button on blog posts. The other share buttons are plain links.
(function () {
  var row = document.querySelector("[data-share-url]");
  if (!row) return;
  var btn = row.querySelector("[data-copy]");
  var note = row.querySelector(".copied");
  var url = row.getAttribute("data-share-url");
  var timer;
  function done() {
    if (!note) return;
    note.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { note.hidden = true; }, 1800);
  }
  function fallback() {
    var t = document.createElement("textarea");
    t.value = url;
    t.setAttribute("readonly", "");
    t.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(t);
  }
  btn.addEventListener("click", function () {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
  });
})();
