// server/reviews.cjs
// Customer reviews: only people who bought FlowGet can write one, an admin approves it, and approved reviews are shown on the website.
//
// Routes (JSON):
//   GET  /api/reviews          approved reviews for the website (public)
//   GET  /api/reviews/mine     the signed-in person's review and whether they may write one
//   POST /api/reviews          { rating 1-5, text, role? }  create or update my review (goes back to "pending")
// The admin side (list, approve, reject, delete) lives in server/admin.cjs.

"use strict";

const MAX_BODY = 8 * 1024;
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** "Naila Keleta-Mae" -> "Naila K." (full surnames are not published) */
function displayName(name, email) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return String(email || "Customer").split("@")[0].slice(0, 20);
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/**
 * @param {{
 *   db: any, saveDb: () => void, auth: any,
 *   hasLicense: (email: string) => boolean,
 *   limited: (k: string, max: number, ms: number) => boolean, clientIp: (req: any) => string,
 * }} ctx
 */
function createHandler(ctx) {
  const { db, saveDb, auth, hasLicense, limited, clientIp } = ctx;
  const { Problem, send } = auth;
  db.reviews ||= {};

  const publicView = (r) => ({ id: r.id, name: r.name, role: r.role || "", rating: r.rating, text: r.text, verified: true });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > MAX_BODY) {
          reject(new Problem(413, "That is too long."));
          if (req.destroy) req.destroy();
        }
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Problem(400, "Invalid request."));
        }
      });
      req.on("error", reject);
    });
  }

  async function route(req, res, pathname) {
    if (req.method === "GET" && pathname === "/api/reviews") {
      const list = Object.values(db.reviews)
        .filter((r) => r.status === "approved")
        .sort((a, b) => (b.approvedAt || b.createdAt) - (a.approvedAt || a.createdAt))
        .slice(0, 12)
        .map(publicView);
      return send(req, res, 200, { reviews: list }, { "Cache-Control": "public, max-age=60" });
    }

    const user = auth.currentUser(req);
    if (!user) throw new Problem(401, "Sign in to write a review.");

    if (req.method === "GET" && pathname === "/api/reviews/mine") {
      const r = db.reviews[user.id];
      return send(req, res, 200, {
        canReview: hasLicense(user.email),
        review: r ? { rating: r.rating, text: r.text, role: r.role || "", status: r.status } : null,
      });
    }

    if (req.method === "POST" && pathname === "/api/reviews") {
      const origin = String(req.headers.origin || "").replace(/\/$/, "");
      if (!auth.allowedOrigins.includes(origin)) throw new Problem(403, "This website is not allowed to post reviews.");
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new Problem(415, "Expected JSON.");
      if (limited("review:" + clientIp(req), 10, 60 * 60 * 1000)) throw new Problem(429, "Too many attempts. Try again later.");
      if (!hasLicense(user.email)) throw new Problem(403, "Reviews can be written by people who bought FlowGet Pro.");
      const body = await readBody(req);
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Problem(400, "Choose a rating from 1 to 5 stars.");
      const text = clean(body.text, 600);
      if (text.length < 20) throw new Problem(400, "Write at least 20 characters about your experience.");
      const prev = db.reviews[user.id];
      db.reviews[user.id] = {
        id: user.id,
        userId: user.id,
        email: user.email,
        name: displayName(user.name, user.email),
        role: clean(body.role, 60),
        rating,
        text,
        status: "pending",
        createdAt: prev ? prev.createdAt : Date.now(),
        updatedAt: Date.now(),
      };
      saveDb();
      return send(req, res, 200, { ok: true, status: "pending" });
    }

    throw new Problem(404, "Endpoint not found");
  }

  return function handle(req, res, pathname) {
    if (pathname !== "/api/reviews" && pathname !== "/api/reviews/mine") return false;
    if (req.method === "OPTIONS") {
      res.writeHead(204, auth.corsHeadersFor(req));
      res.end();
      return true;
    }
    route(req, res, pathname).catch((e) => {
      if (e instanceof Problem) return send(req, res, e.status, { error: e.message });
      console.error("[reviews] unexpected error:", e);
      send(req, res, 500, { error: "Something went wrong. Please try again." });
    });
    return true;
  };
}

module.exports = { createHandler, displayName };
