/* Admin dashboard: KPIs, charts, users, purchases and a blog editor. Talks to /api/admin on the FlowGet API. */
(function () {
  "use strict";
  var root = document.getElementById("admin");
  if (!root) return;
  var API = (root.getAttribute("data-api") || "").replace(/\/$/, "");
  if (API && (API.indexOf("localhost") >= 0 || API.indexOf("127.0.0.1") >= 0)) {
    API = API.replace(/localhost|127\.0\.0\.1/, window.location.hostname);
  }
  var $ = function (id) { return document.getElementById(id); };
  var NS = "http://www.w3.org/2000/svg";

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function s(tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el);
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function money(amount, cur, digits) {
    var v = (amount || 0) / 100;
    try { return new Intl.NumberFormat("en", { style: "currency", currency: cur || "USD", maximumFractionDigits: digits == null ? 2 : digits }).format(v); } catch (e) { return (cur ? cur + " " : "") + v.toFixed(2); }
  }
  function moneyMajor(v, cur, digits) { return money(v * 100, cur, digits); }
  function moneyMap(map) {
    var keys = Object.keys(map || {});
    return keys.length ? keys.map(function (c) { return money(map[c], c); }).join(" + ") : money(0, "USD");
  }
  var fmtDate = function (t) { return t ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; };
  var fmtTime = function (t) { return t ? new Date(t).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; };
  function ago(t) {
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var hr = Math.round(m / 60);
    if (hr < 24) return hr + " h ago";
    var d = Math.round(hr / 24);
    return d < 31 ? d + " d ago" : fmtDate(t);
  }
  function dayLabel(key) { return new Date(key + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }); }
  function chip(text, cls) { return h("span", { class: "chip " + (cls || ""), text: text }); }
  function initials(name) {
    var p = String(name || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
  }
  function icon(paths) {
    var svg = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    paths.forEach(function (d) { s("path", { d: d }, svg); });
    return svg;
  }
  var ICON_USER = ["M12 12a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z", "M4.8 20c.9-3.7 3.7-5.6 7.2-5.6s6.3 1.9 7.2 5.6"];
  var ICON_CART = ["M3.5 5h2.2l2 9.5h9.6L19.5 8H7", "M10 19.2h.1M16.5 19.2h.1"];

  function api(method, path, body) {
    return fetch(API + path, {
      method: method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { var e = new Error(j.error || "Something went wrong."); e.status = res.status; throw e; }
        return j;
      });
    }, function () { throw new Error("Could not reach the server."); });
  }

  function csvCell(v) {
    var t = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // spreadsheets would run this as a formula
    return '"' + t.replace(/"/g, '""') + '"';
  }
  function downloadCsv(name, header, rows) {
    var lines = [header.map(csvCell).join(",")].concat(rows.map(function (r) { return r.map(csvCell).join(","); }));
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- charts (hand-drawn SVG, no libraries) ---------- */
  var gid = 0;
  function niceMax(v) {
    if (!(v > 0)) return 4;
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / e;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 5 ? 5 : 10;
    return nf * e;
  }
  function compact(v) {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + "k";
    return String(Math.round(v * 10) / 10);
  }
  /** Smooth line through the points that never overshoots (monotone cubic). */
  function smooth(pts) {
    var n = pts.length;
    if (n < 3) return pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(" ");
    var dx = [], dy = [], m = [], t = [], i;
    for (i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
      if (q > 9) { var k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    var d = "M" + pts[0][0] + " " + pts[0][1];
    for (i = 0; i < n - 1; i++) {
      var h3 = dx[i] / 3;
      d += " C" + (pts[i][0] + h3) + " " + (pts[i][1] + t[i] * h3) + " " + (pts[i + 1][0] - h3) + " " + (pts[i + 1][1] - t[i + 1] * h3) + " " + pts[i + 1][0] + " " + pts[i + 1][1];
    }
    return d;
  }

  /**
   * o = { labels: ["2026-11-24", ...], values: [..], type: "area" | "bar", color, fmt: v -> text, name, axis: v -> short text }
   */
  function drawChart(el, o) {
    clear(el);
    var W = Math.max(260, el.clientWidth), H = Math.max(140, el.clientHeight);
    var maxV = Math.max.apply(null, o.values.concat([0]));
    var top = niceMax(maxV);
    var padL = Math.max(34, String((o.axis || compact)(top)).length * 7 + 14), padR = 10, padT = 12, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = o.values.length;
    var X = function (i) { return padL + (n === 1 ? iw / 2 : (o.type === "bar" ? (i + 0.5) * (iw / n) : (i * iw) / (n - 1))); };
    var Y = function (v) { return padT + ih - (v / top) * ih; };
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": o.name });
    var defs = s("defs", {}, svg);
    var id = "g" + (++gid);
    var lg = s("linearGradient", { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    s("stop", { offset: "0%", "stop-color": o.color, "stop-opacity": ".14" }, lg);
    s("stop", { offset: "100%", "stop-color": o.color, "stop-opacity": ".14" }, lg);

    var steps = 4, i;
    for (i = 0; i <= steps; i++) {
      var v = (top / steps) * i, y = Y(v);
      s("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "gl" + (i === 0 ? " base" : "") }, svg);
      var tx = s("text", { x: padL - 8, y: y + 4, "text-anchor": "end" }, svg);
      tx.textContent = (o.axis || compact)(v);
    }
    var want = Math.min(n, W < 420 ? 4 : 7);
    for (i = 0; i < want; i++) {
      var idx = want === 1 ? 0 : Math.round((i * (n - 1)) / (want - 1));
      var lx = s("text", { x: X(idx), y: H - 6, "text-anchor": i === 0 ? "start" : i === want - 1 ? "end" : "middle" }, svg);
      lx.textContent = dayLabel(o.labels[idx]);
    }

    var all0 = maxV === 0;
    if (o.type === "bar") {
      var bw = Math.max(2, Math.min(26, (iw / n) * 0.62));
      o.values.forEach(function (val, j) {
        var bh = val ? Math.max(3, (val / top) * ih) : 0;
        s("rect", { x: X(j) - bw / 2, y: padT + ih - bh, width: bw, height: bh, rx: Math.min(4, bw / 2), fill: o.color, class: "bar", "data-i": j }, svg);
      });
    } else {
      var pts = o.values.map(function (val, j) { return [X(j), Y(val)]; });
      var line = smooth(pts);
      s("path", { d: line + " L" + pts[n - 1][0] + " " + (padT + ih) + " L" + pts[0][0] + " " + (padT + ih) + " Z", fill: "url(#" + id + ")" }, svg);
      s("path", { d: line, fill: "none", stroke: o.color, "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
    }
    if (all0) {
      var et = s("text", { x: padL + iw / 2, y: padT + ih / 2 - 4, "text-anchor": "middle", class: "empty-t" }, svg);
      et.textContent = "No data in this period yet";
    }

    var guide = s("line", { class: "guide", y1: padT, y2: padT + ih, visibility: "hidden" }, svg);
    var dot = s("circle", { class: "dot", r: 5, fill: o.color, visibility: "hidden" }, svg);
    var tip = h("div", { class: "tip" });
    tip.style.display = "none";
    var hit = s("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", function (ev) {
      var box = svg.getBoundingClientRect();
      var px = ((ev.clientX - box.left) / box.width) * W;
      var j = o.type === "bar" ? Math.floor(((px - padL) / iw) * n) : Math.round(((px - padL) / iw) * (n - 1));
      j = Math.max(0, Math.min(n - 1, j));
      var cx = X(j), cy = Y(o.values[j]);
      guide.setAttribute("x1", cx); guide.setAttribute("x2", cx); guide.setAttribute("visibility", "visible");
      if (o.type !== "bar") { dot.setAttribute("cx", cx); dot.setAttribute("cy", cy); dot.setAttribute("visibility", "visible"); }
      clear(tip);
      tip.appendChild(h("small", { text: dayLabel(o.labels[j]) }));
      tip.appendChild(h("b", { text: o.fmt(o.values[j]) }));
      tip.style.display = "block";
      tip.style.left = (cx / W) * box.width + "px";
      tip.style.top = (cy / H) * box.height - 10 + "px";
      [].forEach.call(svg.querySelectorAll(".bar"), function (r) { r.style.opacity = Number(r.getAttribute("data-i")) === j ? "1" : ".45"; });
    });
    hit.addEventListener("mouseleave", function () {
      tip.style.display = "none"; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
      [].forEach.call(svg.querySelectorAll(".bar"), function (r) { r.style.opacity = ""; });
    });
    el.appendChild(svg);
    el.appendChild(tip);
  }

  function spark(color, values) {
    var W = 120, H = 54, n = values.length, max = Math.max.apply(null, values.concat([1]));
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, class: "spark", preserveAspectRatio: "none", "aria-hidden": "true" });
    var id = "s" + (++gid);
    var defs = s("defs", {}, svg), lg = s("linearGradient", { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    s("stop", { offset: "0%", "stop-color": color, "stop-opacity": ".14" }, lg);
    s("stop", { offset: "100%", "stop-color": color, "stop-opacity": ".14" }, lg);
    var pts = values.map(function (v, i) { return [(i * W) / Math.max(1, n - 1), H - 6 - (v / max) * (H - 18)]; });
    var d = smooth(pts);
    s("path", { d: d + " L" + W + " " + H + " L0 " + H + " Z", fill: "url(#" + id + ")" }, svg);
    s("path", { d: d, fill: "none", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "stroke-linecap": "round" }, svg);
    return svg;
  }

  /* ---------- start ---------- */
  var gate = $("gate");
  if (!API) { gate.textContent = "The admin panel needs the accounts API (PUBLIC_API_URL is not set for this build)."; return; }

  var TABS = ["overview", "users", "purchases", "reviews", "blog"];
  var TITLES = {
    overview: ["Overview", "How FlowGet is doing"],
    users: ["Users", "Everyone who created an account"],
    purchases: ["Purchases", "Payments, licenses and refunds"],
    reviews: ["Reviews", "Approve what buyers write before it appears on the website"],
    blog: ["Blog", "Write and publish articles"]
  };
  var publishing = "none", demoTools = false, demoLoaded = false;
  var days = 30;
  try { var saved = parseInt(localStorage.getItem("fg_admin_days"), 10); if ([7, 30, 90].indexOf(saved) >= 0) days = saved; } catch (e) { /* ignore */ }

  api("GET", "/api/admin/me").then(function (me) {
    publishing = me.publishing; demoTools = !!me.demoTools; demoLoaded = !!me.demoLoaded;
    gate.hidden = true;
    $("tabs").hidden = false;
    $("who").hidden = false;
    $("who-name").textContent = me.name || "Admin";
    $("who-email").textContent = me.email;
    $("who-av").textContent = initials(me.name || me.email);
    syncRange();
    syncDemo();
    setBadge(me.pendingReviews);
    var first = location.hash.slice(1);
    openTab(TABS.indexOf(first) >= 0 ? first : "overview");
  }).catch(function (e) {
    if (e.status === 401) { location.replace("/admin/login/"); return; }
    if (e.status === 403) {
      clear(gate);
      gate.appendChild(document.createTextNode("This account is not an admin. "));
      gate.appendChild(h("a", { href: "/account/", text: "Back to my account" }));
      return;
    }
    gate.textContent = e.message;
  });

  $("signout").addEventListener("click", function () {
    api("POST", "/api/auth/logout", {}).catch(function () {}).then(function () { location.assign("/admin/login/"); });
  });

  var current = "overview";
  function openTab(name) {
    current = name;
    TABS.forEach(function (t) {
      $("tab-" + t).hidden = t !== name;
      document.querySelector('[data-tab="' + t + '"]').classList.toggle("on", t === name);
    });
    $("page-title").textContent = TITLES[name][0];
    $("page-sub").textContent = TITLES[name][1];
    $("actions").hidden = name !== "overview";
    if (name === "overview") loadOverview();
    if (name === "users") loadUsers();
    if (name === "purchases") loadPurchases();
    if (name === "reviews") loadReviews();
    if (name === "blog") loadBlog();
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
  }
  [].forEach.call(document.querySelectorAll("[data-tab]"), function (b) {
    b.addEventListener("click", function () { openTab(b.getAttribute("data-tab")); });
  });

  function failure(container, e) {
    if (e.status === 401) return location.replace("/signin/?next=" + encodeURIComponent("/admin/"));
    clear(container);
    container.appendChild(h("p", { class: "err", text: e.message }));
  }

  /* ---------- overview ---------- */
  function syncRange() {
    [].forEach.call($("range").children, function (b) { b.classList.toggle("on", Number(b.getAttribute("data-days")) === days); });
    $("actions").hidden = current !== "overview";
  }
  [].forEach.call($("range").children, function (b) {
    b.addEventListener("click", function () {
      days = Number(b.getAttribute("data-days"));
      try { localStorage.setItem("fg_admin_days", String(days)); } catch (e) { /* ignore */ }
      syncRange();
      loadOverview();
    });
  });
  $("refresh").addEventListener("click", function () { loadOverview(); });

  function syncDemo() {
    var b = $("demo");
    b.hidden = !demoTools;
    b.textContent = demoLoaded ? "Remove demo data" : "Load demo data";
  }
  $("demo").addEventListener("click", function () {
    var b = $("demo");
    if (demoLoaded && !confirm("Remove all demo users and purchases?")) return;
    b.disabled = true;
    api("POST", "/api/admin/demo", { action: demoLoaded ? "clear" : "seed" }).then(function (r) {
      demoLoaded = r.demoLoaded; syncDemo(); loadOverview();
    }).catch(function (e) { alert(e.message); }).then(function () { b.disabled = false; });
  });

  function delta(nowV, prevV, opts) {
    opts = opts || {};
    var cls = "delta", text;
    if (opts.points) {
      var dp = Math.round((nowV - prevV) * 10) / 10;
      text = (dp > 0 ? "▲ +" : dp < 0 ? "▼ " : "") + dp + " pts";
      cls += dp > 0 ? " up" : dp < 0 ? " down" : "";
      if (!dp) text = "no change";
    } else if (!prevV) {
      text = nowV ? "New" : "–";
      cls += nowV ? " up" : "";
    } else {
      var pct = ((nowV - prevV) / prevV) * 100;
      text = (pct > 0 ? "▲ +" : pct < 0 ? "▼ " : "") + (Math.abs(pct) < 10 ? pct.toFixed(1) : Math.round(pct)) + "%";
      if (!pct) text = "no change";
      cls += pct > 0 ? " up" : pct < 0 ? " down" : "";
    }
    return h("span", { class: cls, text: text });
  }

  function kpi(label, value, color, d, extra, series, hl) {
    var dot = h("i");
    dot.style.setProperty("--c", color);
    var card = h("div", { class: "kpi" + (hl ? " hl" : "") }, [
      h("div", { class: "k" }, [dot, label]),
      h("div", { class: "v", text: value }),
      h("div", { class: "d" }, [d, h("span", { text: extra })])
    ]);
    if (series) card.appendChild(spark(hl ? "#15200a" : color, series));
    return card;
  }

  var lastStats = null;
  function renderCharts() {
    if (!lastStats) return;
    var st = lastStats, cur = st.range.currency;
    drawChart($("chart-revenue"), { labels: st.series.days, values: st.series.revenue, type: "bar", color: "#7EC151", name: "Revenue", fmt: function (v) { return moneyMajor(v, cur, 2); }, axis: function (v) { return moneyMajor(v, cur, 0); } });
    drawChart($("chart-users"), { labels: st.series.days, values: st.series.users, type: "bar", color: "#FED24F", name: "New users", fmt: function (v) { return v + (v === 1 ? " new user" : " new users"); } });
    drawChart($("chart-sales"), { labels: st.series.days, values: st.series.purchases, type: "bar", color: "#7EC151", name: "Purchases", fmt: function (v) { return v + (v === 1 ? " purchase" : " purchases"); } });
  }
  var rz = 0;
  window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (current === "overview") renderCharts(); }, 120); });

  function loadOverview() {
    api("GET", "/api/admin/stats?days=" + days).then(function (st) {
      lastStats = st;
      var cur = st.range.currency, c = st.compare, vs = "vs previous " + days + " days";
      var box = $("kpis");
      clear(box);
      box.appendChild(kpi("Revenue", moneyMajor(c.revenue.now, cur, 2), "#15200a", delta(c.revenue.now, c.revenue.prev), vs, st.series.revenue, true));
      box.appendChild(kpi("Purchases", String(c.purchases.now), "#7EC151", delta(c.purchases.now, c.purchases.prev), vs, st.series.purchases));
      box.appendChild(kpi("New users", String(c.users.now), "#FED24F", delta(c.users.now, c.users.prev), vs, st.series.users));
      box.appendChild(kpi("Checkout conversion", c.conversion.now.pct + "%", "#B2D959", delta(c.conversion.now.pct, c.conversion.prev.pct, { points: true }), c.conversion.now.paid + " of " + c.conversion.now.started + " checkouts"));

      $("rev-sub").textContent = "All time " + moneyMap(st.sales.revenue) + " · " + (st.sales.purchases - st.sales.refunded) + " paid, " + st.sales.refunded + " refunded" + (st.range.mixedCurrencies ? " · chart shows " + cur + " only" : "");
      $("users-sub").textContent = st.users.total + " users in total · " + st.users.last7 + " in the last 7 days";
      $("sales-sub").textContent = c.purchases.now + " in this period";
      renderCharts();

      var fn = $("funnel");
      clear(fn);
      var f = st.funnel, base = Math.max(1, f.signups);
      var wrap = h("div", { class: "fn" });
      [["Signed up", f.signups], ["Finished profile", f.completed], ["Bought FlowGet Pro", f.bought]].forEach(function (r) {
        var pct = Math.round((r[1] / base) * 100);
        var fill = h("div", { class: "fill" });
        fill.style.width = Math.max(r[1] ? 3 : 0, pct) + "%";
        wrap.appendChild(h("div", { class: "r" }, [h("div", { class: "t" }, [h("b", { text: r[0] }), h("span", { text: r[1] + " · " + pct + "%" })]), h("div", { class: "track" }, [fill])]));
      });
      fn.appendChild(wrap);

      var L = st.licenses, lt = Math.max(1, L.issued);
      $("lic-sub").textContent = L.issued + " issued · " + L.activeDevices + " active PCs";
      var ls = $("lic-status");
      clear(ls);
      var stack = h("div", { class: "stack" });
      [[L.activated, "#7EC151"], [L.neverActivated, "#FED24F"], [L.revoked, "#E5645A"]].forEach(function (p) {
        if (!p[0]) return;
        var seg = h("i");
        seg.style.width = (p[0] / lt) * 100 + "%"; seg.style.background = p[1];
        stack.appendChild(seg);
      });
      ls.appendChild(stack);
      var legend = h("div", { class: "legend" });
      [["Activated", L.activated, "#7EC151"], ["Not activated yet", L.neverActivated, "#FED24F"], ["Refunded / revoked", L.revoked, "#E5645A"]].forEach(function (p) {
        var dt = h("i"); dt.style.background = p[2];
        legend.appendChild(h("div", {}, [dt, p[0], h("span", { text: String(p[1]) })]));
      });
      ls.appendChild(legend);

      var feed = $("activity");
      clear(feed);
      st.activity.forEach(function (a) {
        var buy = a.type === "purchase";
        var ic = h("span", { class: "ic" + (buy ? " buy" : "") }, [icon(buy ? ICON_CART : ICON_USER)]);
        var right = h("div", { class: "rt" }, [buy ? h("b", { text: money(a.amount, a.currency) }) : null, document.createTextNode(ago(a.at))]);
        feed.appendChild(h("div", { class: "it" }, [ic, h("div", { class: "tx" }, [h("b", { text: a.title }), h("small", { text: a.sub })]), right]));
      });
      if (!st.activity.length) feed.appendChild(h("p", { class: "muted", text: "Nothing yet. New sign-ups and purchases will show up here." }));
    }).catch(function (e) { failure($("kpis"), e); });
  }

  /* ---------- users ---------- */
  var uPage = 1, uQ = "", uTimer = 0, uPages = 1;
  function loadUsers() {
    api("GET", "/api/admin/users?page=" + uPage + "&q=" + encodeURIComponent(uQ)).then(function (r) {
      uPages = r.pages;
      $("u-count").textContent = r.total + (r.total === 1 ? " user" : " users");
      $("u-page").textContent = "Page " + r.page + " of " + r.pages;
      $("u-prev").disabled = r.page <= 1;
      $("u-next").disabled = r.page >= r.pages;
      var tb = $("u-table").tBodies[0];
      clear(tb);
      if (!r.rows.length) tb.appendChild(h("tr", {}, [h("td", { class: "empty", colspan: "5", text: "No users found." })]));
      r.rows.forEach(function (u) {
        var how = [];
        if (u.google) how.push("Google");
        if (u.hasPassword) how.push("Password");
        var nameEl = h("b", { text: u.name || (u.profileComplete ? u.email : "Profile not finished") });
        if (u.demo) nameEl.appendChild(chip("demo", "demo"));
        tb.appendChild(h("tr", {}, [
          h("td", {}, [h("div", { class: "who-c" }, [h("span", { class: "av", text: initials(u.name || u.email) }), h("div", {}, [nameEl, h("small", { text: u.email })])])]),
          h("td", { text: u.phone || "–" }),
          h("td", { text: fmtDate(u.createdAt) }),
          h("td", { text: how.join(" + ") || (u.demo ? "demo" : "–") }),
          h("td", {}, [u.purchases ? chip(String(u.purchases) + (u.purchases === 1 ? " license" : " licenses"), "green") : h("span", { class: "muted", text: "none" })])
        ]));
      });
    }).catch(function (e) { failure($("u-table").tBodies[0], e); });
  }
  $("u-q").addEventListener("input", function () {
    clearTimeout(uTimer);
    uTimer = setTimeout(function () { uQ = $("u-q").value.trim(); uPage = 1; loadUsers(); }, 250);
  });
  $("u-prev").addEventListener("click", function () { if (uPage > 1) { uPage--; loadUsers(); } });
  $("u-next").addEventListener("click", function () { if (uPage < uPages) { uPage++; loadUsers(); } });
  $("u-csv").addEventListener("click", function () {
    api("GET", "/api/admin/users?all=1&q=" + encodeURIComponent(uQ)).then(function (r) {
      downloadCsv("flowget-users.csv", ["Name", "Email", "Phone", "Joined", "Profile completed", "Google", "Password", "Licenses"],
        r.rows.map(function (u) { return [u.name, u.email, u.phone, new Date(u.createdAt).toISOString(), u.profileComplete ? "yes" : "no", u.google ? "yes" : "no", u.hasPassword ? "yes" : "no", u.purchases]; }));
    });
  });

  /* ---------- purchases ---------- */
  var lastPurchases = [];
  function loadPurchases() {
    api("GET", "/api/admin/purchases").then(function (r) {
      lastPurchases = r.rows;
      $("p-count").textContent = r.rows.length + (r.rows.length === 1 ? " purchase" : " purchases");
      var tb = $("p-table").tBodies[0];
      clear(tb);
      if (!r.rows.length) tb.appendChild(h("tr", {}, [h("td", { class: "empty", colspan: "7", text: "No purchases yet." })]));
      r.rows.forEach(function (p) {
        var refunded = p.status === "refunded";
        var btn = h("button", { type: "button", class: "btn ghost sm" + (refunded ? "" : " danger"), text: refunded ? "Restore" : "Revoke", onclick: function () {
          var q = refunded ? "Restore this license?" : "Revoke this license? It can no longer be activated on new PCs.";
          if (!confirm(q)) return;
          btn.disabled = true;
          api("POST", "/api/admin/license", { keyId: p.keyId, revoked: !refunded }).then(loadPurchases).catch(function (e) { alert(e.message); btn.disabled = false; });
        } });
        tb.appendChild(h("tr", {}, [
          h("td", { text: fmtTime(p.at) }),
          h("td", {}, [h("div", { class: "who-c" }, [h("span", { class: "av", text: initials(p.email) }), h("div", {}, [p.email, p.accountEmail && p.accountEmail !== p.email ? h("small", { text: "account: " + p.accountEmail }) : null])])]),
          h("td", { text: p.amount ? money(p.amount, p.currency) : "–" }),
          h("td", { text: p.keyId || "–" }),
          h("td", { text: p.devices + " / " + p.maxDevices }),
          h("td", {}, [chip(refunded ? "Refunded / revoked" : "Paid", refunded ? "red" : "green")]),
          h("td", {}, [p.keyId ? btn : null])
        ]));
      });
      var pb = $("p-pending").tBodies[0];
      clear(pb);
      if (!r.pending.length) pb.appendChild(h("tr", {}, [h("td", { class: "empty", colspan: "3", text: "None." })]));
      r.pending.forEach(function (o) { pb.appendChild(h("tr", {}, [h("td", { text: fmtTime(o.at) }), h("td", { text: o.email }), h("td", { text: o.name || "–" })])); });
    }).catch(function (e) { failure($("p-table").tBodies[0], e); });
  }
  $("p-csv").addEventListener("click", function () {
    downloadCsv("flowget-purchases.csv", ["Date", "Email", "Account email", "Amount", "Currency", "License", "PCs activated", "Status", "Payment id"],
      lastPurchases.map(function (p) { return [new Date(p.at).toISOString(), p.email, p.accountEmail, (p.amount / 100).toFixed(2), p.currency, p.keyId, p.devices, p.status, p.paymentId]; }));
  });

  /* ---------- reviews ---------- */
  var rFilter = "pending";
  function setBadge(n) { var b = $("rv-badge"); b.hidden = !n; b.textContent = String(n || ""); }
  function starsRow(n) {
    var wrap = h("div", { class: "st", role: "img", "aria-label": n + " out of 5" });
    for (var i = 1; i <= 5; i++) { var sv = s("svg", { viewBox: "0 0 24 24", class: i <= n ? "" : "off" }); s("path", { d: "M12 3.6l2.5 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.1 2.7 1-5.8-4.2-4.1 5.8-.8z" }, sv); wrap.appendChild(sv); }
    return wrap;
  }
  [].forEach.call($("r-filter").children, function (b) {
    b.addEventListener("click", function () {
      rFilter = b.getAttribute("data-f");
      [].forEach.call($("r-filter").children, function (x) { x.classList.toggle("on", x === b); });
      loadReviews();
    });
  });
  function act(id, action, btn, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    btn.disabled = true;
    api("POST", "/api/admin/reviews", { id: id, action: action }).then(loadReviews).catch(function (e) { alert(e.message); btn.disabled = false; });
  }
  function loadReviews() {
    api("GET", "/api/admin/reviews").then(function (r) {
      var pending = r.rows.filter(function (x) { return x.status === "pending"; }).length;
      setBadge(pending);
      var rows = r.rows.filter(function (x) { return rFilter === "all" || x.status === rFilter; });
      $("r-count").textContent = pending + " waiting · " + r.rows.filter(function (x) { return x.status === "approved"; }).length + " published";
      var box = $("r-list");
      clear(box);
      if (!rows.length) box.appendChild(h("div", { class: "panel" }, [h("p", { class: "muted", text: rFilter === "pending" ? "Nothing is waiting for approval. Buyers can write a review from their account page." : "No reviews here yet." })]));
      rows.forEach(function (x) {
        var btns = [];
        if (x.status !== "approved") btns.push(h("button", { type: "button", class: "btn primary sm", style: "margin:0", text: "Approve", onclick: function (e) { act(x.id, "approve", e.currentTarget); } }));
        if (x.status === "pending") btns.push(h("button", { type: "button", class: "btn ghost sm", text: "Reject", onclick: function (e) { act(x.id, "reject", e.currentTarget); } }));
        if (x.status === "approved") btns.push(h("button", { type: "button", class: "btn ghost sm", text: "Unpublish", onclick: function (e) { act(x.id, "reject", e.currentTarget); } }));
        btns.push(h("button", { type: "button", class: "btn ghost sm danger", text: "Delete", onclick: function (e) { act(x.id, "delete", e.currentTarget, "Delete this review for good?"); } }));
        var meta = h("div", { class: "who" }, [h("b", { text: x.name }), (x.role ? " · " + x.role : "") + " · " + x.email + " · " + fmtDate(x.at) + " "]);
        meta.appendChild(chip(x.status === "approved" ? "Published" : x.status === "pending" ? "Waiting" : "Rejected", x.status === "approved" ? "green" : x.status === "pending" ? "amber" : "red"));
        if (x.demo) meta.appendChild(chip("demo", "demo"));
        box.appendChild(h("div", { class: "rv " + x.status }, [h("div", {}, [starsRow(x.rating), h("p", { text: x.text }), meta]), h("div", { class: "acts" }, btns)]));
      });
    }).catch(function (e) { failure($("r-list"), e); });
  }

  /* ---------- blog ---------- */
  function slugify(t) {
    return String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  }
  var slugTouched = false, coverData = "";
  var editing = null; // { slug, pubDate, cover } while an existing post is open
  var DRAFT_KEY = "fg_blog_draft";

  function counter(inputId, outId, min, max) {
    var inp = $(inputId), out = $(outId);
    function upd() { var n = inp.value.trim().length; out.textContent = n + "/" + max + (n < min ? " (at least " + min + ")" : ""); }
    inp.addEventListener("input", upd); upd();
    return upd;
  }
  var updTitleN = counter("b-title", "b-title-n", 10, 110);
  var updDescN = counter("b-desc", "b-desc-n", 50, 200);

  /* The article editor: toolbar + Markdown/visual switch (Toast UI Editor, vendored). Falls back to a plain textarea. */
  var editor = null;
  function uploadPicture(blob) {
    return new Promise(function (resolve, reject) {
      if (blob.size > 2.5 * 1024 * 1024) return reject(new Error("The picture is larger than 2.5 MB."));
      var rd = new FileReader();
      rd.onload = function () { api("POST", "/api/admin/blog/image", { dataUrl: String(rd.result) }).then(resolve, reject); };
      rd.onerror = function () { reject(new Error("Could not read the picture.")); };
      rd.readAsDataURL(blob);
    });
  }
  if (window.toastui && window.toastui.Editor) {
    $("b-body").hidden = true;
    editor = new window.toastui.Editor({
      el: $("b-editor"),
      height: "max(900px, calc(100vh - 140px))",
      initialEditType: "wysiwyg",
      previewStyle: "vertical",
      usageStatistics: false, // do not send anything to Google Analytics
      placeholder: "Write the article here…",
      toolbarItems: [
        ["heading", "bold", "italic", "strike"],
        ["hr", "quote"],
        ["ul", "ol", "task", "indent", "outdent"],
        ["table", "image", "link"],
        ["code", "codeblock"],
        ["scrollSync"]
      ],
      hooks: {
        addImageBlobHook: function (blob, callback) {
          $("b-err").textContent = "";
          uploadPicture(blob).then(function (r) { callback(r.url, blob.name ? blob.name.replace(/\.[a-z0-9]+$/i, "") : "picture"); })
            .catch(function (e) { $("b-err").textContent = e.message; });
        }
      }
    });
    editor.on("change", function () { stats(); scheduleSave(); });
    root.fgEditor = editor; // handy for tests and the browser console
    // Switching to the Markdown view: show (and keep) the cleaned-up text, so what you see is what gets published.
    editor.on("changeMode", function (mode) { if (mode === "markdown") editor.setMarkdown(normalizeMd(editor.getMarkdown()), false); });
  }
  /* The visual editor writes two paragraphs as "a\nb" (one line break). In Markdown that is ONE paragraph, so the site would run
     them together. Put a blank line between separate blocks (code blocks are left alone). */
  function normalizeMd(md) {
    var lines = String(md).replace(/\r\n/g, "\n").split("\n"), out = [], fence = false, prev = "blank";
    function kind(l) {
      if (!l.trim()) return "blank";
      if (/^\s{0,3}#{1,6}\s/.test(l)) return "heading";
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) return "hr";
      if (/^\s*([*+-]|\d+[.)])\s/.test(l)) return "list";
      if (/^\s*>/.test(l)) return "quote";
      if (/^\s*\|/.test(l)) return "table";
      if (/^(\s{2,}|\t)/.test(l)) return "indent";
      return "text";
    }
    lines.forEach(function (l) {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; out.push(l); prev = "fence"; return; }
      if (fence) { out.push(l); return; }
      var k = kind(l), need = false;
      if (prev === "text" && (k === "text" || k === "table" || k === "quote" || k === "list")) need = true;
      if ((prev === "list" || prev === "quote" || prev === "table") && k === "text") need = true;
      if (prev === "table" && (k === "quote" || k === "list")) need = true;
      if (need) out.push("");
      out.push(l);
      prev = k;
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  var getBody = function () {
    if (!editor) return $("b-body").value;
    var md = editor.getMarkdown();
    return editor.isWysiwygMode() ? normalizeMd(md) : md;
  };
  root.fgBody = function () { return getBody(); };
  var setBody = function (t) { if (editor) editor.setMarkdown(t || "", false); else $("b-body").value = t || ""; stats(); };
  $("b-body").addEventListener("input", function () { stats(); scheduleSave(); });

  function stats() {
    var t = getBody().replace(/```[\s\S]*?```/g, " ");
    var words = (t.match(/\S+/g) || []).length;
    $("b-stats").textContent = words + " words · " + t.length + " characters · about " + Math.max(1, Math.round(words / 220)) + " min read";
  }

  /* Draft kept in this browser, so a closed tab does not lose the article. */
  var saveTimer = 0;
  function formState() {
    return {
      title: $("b-title").value, slug: $("b-slug").value, desc: $("b-desc").value, tags: $("b-tags").value, date: $("b-date").value,
      author: $("b-author").value, alt: $("b-alt").value, body: getBody(), featured: $("b-featured").checked, draft: $("b-draft").checked,
      faq: [].map.call($("b-faq").children, function (row) { var i = row.querySelectorAll("input"); return [i[0].value, i[1].value]; })
    };
  }
  function scheduleSave() {
    if (editing) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var st = formState();
      if (!st.title && !st.body.trim()) return;
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(st)); $("b-saved").textContent = "Draft saved in this browser"; } catch (e) { /* ignore */ }
    }, 1200);
  }
  function clearSavedDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } $("b-saved").textContent = ""; }
  function applyState(st) {
    $("b-title").value = st.title || ""; $("b-slug").value = st.slug || ""; slugTouched = !!st.slug; $("b-desc").value = st.desc || "";
    $("b-tags").value = st.tags || ""; $("b-date").value = st.date || ""; $("b-author").value = st.author || ""; $("b-alt").value = st.alt || "";
    $("b-featured").checked = !!st.featured; $("b-draft").checked = !!st.draft;
    clear($("b-faq"));
    (st.faq || []).forEach(function (f) { addFaq(f[0], f[1]); });
    setBody(st.body || "");
    updTitleN(); updDescN(); syncSlug();
  }
  function offerRestore() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    $("b-restore").hidden = !raw || !!editing;
  }
  $("b-restore-yes").addEventListener("click", function () {
    try { applyState(JSON.parse(localStorage.getItem(DRAFT_KEY))); } catch (e) { /* ignore */ }
    $("b-restore").hidden = true;
  });
  $("b-restore-no").addEventListener("click", function () { clearSavedDraft(); $("b-restore").hidden = true; });

  $("b-title").addEventListener("input", function () { if (!slugTouched && !editing) { $("b-slug").value = slugify($("b-title").value); } syncSlug(); scheduleSave(); });
  $("b-slug").addEventListener("input", function () { slugTouched = $("b-slug").value !== ""; syncSlug(); scheduleSave(); });
  ["b-desc", "b-tags", "b-date", "b-author", "b-alt", "b-featured", "b-draft"].forEach(function (id) { $(id).addEventListener("input", scheduleSave); $(id).addEventListener("change", scheduleSave); });
  function syncSlug() { $("b-slug-show").textContent = slugify($("b-slug").value || $("b-title").value) || "…"; }

  function addFaq(q, a) {
    var row = h("div", { class: "faqrow" }, [
      h("input", { type: "text", maxlength: "200", placeholder: "Question", "aria-label": "Question", value: q || "" }),
      h("input", { type: "text", maxlength: "1200", placeholder: "Answer", "aria-label": "Answer", value: a || "" }),
      h("button", { type: "button", class: "btn ghost sm", text: "Remove", onclick: function () { row.remove(); scheduleSave(); } })
    ]);
    $("b-faq").appendChild(row);
  }
  $("b-faq-add").addEventListener("click", function () { addFaq(); });

  $("b-img").addEventListener("change", function () {
    var f = $("b-img").files[0];
    coverData = "";
    $("b-img-prev").hidden = true;
    if (!f) return;
    if (f.size > 2.5 * 1024 * 1024) { $("b-err").textContent = "The cover image is larger than 2.5 MB."; $("b-img").value = ""; return; }
    $("b-err").textContent = "";
    var rd = new FileReader();
    rd.onload = function () { coverData = String(rd.result); $("b-img-prev").hidden = false; $("b-img-prev").querySelector("img").src = coverData; };
    rd.readAsDataURL(f);
  });
  $("b-img-clear").addEventListener("click", function () { coverData = ""; $("b-img").value = ""; $("b-img-prev").hidden = true; });

  /* ---------- edit an existing post / start a new one ---------- */
  function setMode(post) {
    editing = post ? { slug: post.slug, pubDate: post.pubDate, cover: post.cover || "" } : null;
    $("b-heading").textContent = post ? "Edit post" : "Write a post";
    $("b-editing").hidden = !post;
    $("b-editing").textContent = post ? "/blog/" + post.slug + "/" : "";
    $("b-new").hidden = !post;
    $("b-slug").readOnly = !!post;
    $("b-go").textContent = post ? "Update post" : "Publish post";
  }
  function resetForm() {
    setMode(null);
    applyState({});
    coverData = ""; $("b-img").value = ""; $("b-img-prev").hidden = true;
    $("b-err").textContent = ""; clear($("b-ok")); $("b-over").checked = false; $("b-over-row").hidden = true;
  }
  $("b-new").addEventListener("click", function () { resetForm(); offerRestore(); loadBlog(); });

  function openPost(slug) {
    $("b-err").textContent = ""; clear($("b-ok"));
    api("GET", "/api/admin/blog/post?slug=" + encodeURIComponent(slug)).then(function (p) {
      setMode(p);
      applyState({
        title: p.title, slug: p.slug, desc: p.description, tags: (p.tags || []).join(", "),
        date: "", author: p.author, alt: p.coverAlt, body: p.body, featured: p.featured, draft: p.draft,
        faq: (p.faq || []).map(function (f) { return [f.q, f.a]; })
      });
      slugTouched = true;
      coverData = ""; $("b-img").value = ""; $("b-img-prev").hidden = true;
      if (p.cover) { $("b-img-prev").hidden = false; $("b-img-prev").querySelector("img").src = p.cover; }
      $("b-restore").hidden = true;
      loadBlog();
      $("b-form").scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (e) { $("b-err").textContent = e.message; });
  }

  function loadBlog() {
    $("b-mode").className = "note" + (publishing === "none" ? " warn" : "");
    $("b-mode").textContent = publishing === "github"
      ? "Publishing is on: posts are saved to your GitHub repository and appear on the site after it rebuilds (a minute or two)."
      : publishing === "local"
        ? "Local mode: posts are written into the website folder on the server's computer. For the live site, set GITHUB_TOKEN and GITHUB_REPO on the server."
        : "Publishing is not set up yet. Set GITHUB_TOKEN and GITHUB_REPO on the server (see the README, Admin panel). You can fill in the form, but Publish will not work until then.";
    offerRestore();
    api("GET", "/api/admin/blog").then(function (r) {
      var box = $("b-list");
      clear(box);
      r.posts.forEach(function (p) {
        var del = h("button", { type: "button", class: "btn ghost sm danger", text: "Delete", onclick: function () {
          if (!confirm('Delete "' + p.title + '"? This removes the article from the site.')) return;
          del.disabled = true;
          api("POST", "/api/admin/blog/delete", { slug: p.slug }).then(function () {
            if (editing && editing.slug === p.slug) resetForm();
            loadBlog();
          }).catch(function (e) { alert(e.message); del.disabled = false; });
        } });
        box.appendChild(h("div", { class: "it" + (editing && editing.slug === p.slug ? " cur" : "") }, [
          h("div", {}, [
            h("a", { href: "/blog/" + encodeURIComponent(p.slug) + "/", target: "_blank", rel: "noopener", text: p.title }),
            h("small", { text: p.slug }),
            h("div", { class: "acts" }, [h("button", { type: "button", class: "btn ghost sm", text: "Edit", onclick: function () { openPost(p.slug); } }), del])
          ]),
          h("div", { class: "r" }, [p.draft ? chip("Draft", "amber") : null, p.draft ? " " : null, p.pubDate ? fmtDate(Date.parse(p.pubDate)) : ""])
        ]));
      });
      if (!r.posts.length) box.appendChild(h("p", { class: "muted", text: "No posts found." }));
    }).catch(function (e) { failure($("b-list"), e); });
  }

  $("b-form").addEventListener("submit", function (e) {
    e.preventDefault();
    $("b-err").textContent = ""; clear($("b-ok"));
    var title = $("b-title").value.trim();
    var payload = {
      title: title,
      slug: editing ? editing.slug : ($("b-slug").value.trim() || slugify(title)),
      description: $("b-desc").value.trim(),
      tags: $("b-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
      author: $("b-author").value.trim(),
      coverAlt: $("b-alt").value.trim(),
      body: getBody(),
      featured: $("b-featured").checked,
      draft: $("b-draft").checked,
      overwrite: $("b-over").checked,
      faq: [].map.call($("b-faq").children, function (row) { var i = row.querySelectorAll("input"); return { q: i[0].value.trim(), a: i[1].value.trim() }; }).filter(function (f) { return f.q && f.a; })
    };
    if (editing) {
      payload.editing = true;
      payload.pubDate = editing.pubDate || undefined;
      if (editing.cover && !coverData) payload.cover = editing.cover;
    } else if ($("b-date").value) payload.pubDate = new Date($("b-date").value).toISOString();
    if (!editing && $("b-date").value === "") delete payload.pubDate;
    if (coverData) payload.coverImage = coverData;
    var btn = $("b-go"), label = editing ? "Update post" : "Publish post";
    btn.disabled = true; btn.textContent = editing ? "Saving…" : "Publishing…";
    api("POST", "/api/admin/blog", payload).then(function (r) {
      var ok = $("b-ok");
      ok.appendChild(document.createTextNode((r.draft ? "Saved as a draft. " : editing ? "Updated. " : "Published. ") + r.note + " "));
      if (!r.draft) ok.appendChild(h("a", { href: r.url, target: "_blank", rel: "noopener", text: "Open the post" }));
      $("b-over").checked = false; $("b-over-row").hidden = true;
      if (!editing) { clearSavedDraft(); }
      loadBlog();
    }).catch(function (x) {
      $("b-err").textContent = x.message;
      if (x.status === 409) $("b-over-row").hidden = false;
    }).then(function () { btn.disabled = false; btn.textContent = label; });
  });

  stats();
})();
