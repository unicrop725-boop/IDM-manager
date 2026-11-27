/* Google Analytics 4 loader. Kept as its own file because the site's Content-Security-Policy does not allow inline scripts.
   Runs only on the live public pages: never on sign-in, sign-up, account, buy, thanks or admin pages, never on
   previews or localhost, and never when the visitor has Do Not Track or Global Privacy Control switched on. */
(function () {
  var ID = "G-HX68CZZNB7";

  if (!/^(www\.)?boltgrab\.online$/.test(location.hostname)) return;
  if (/^\/(signin|signup|account|buy|thanks|admin)(\/|$)/.test(location.pathname)) return;
  if (navigator.doNotTrack === "1" || navigator.doNotTrack === "yes" || window.doNotTrack === "1" || navigator.globalPrivacyControl) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  // No advertising features: no Google signals, no ad personalization.
  gtag("config", ID, { allow_google_signals: false, allow_ad_personalization_signals: false });

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  document.head.appendChild(s);
})();
