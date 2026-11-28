// src/price.ts
// What to show as the BoltGrab Pro price, in the buyer's own currency.
//
// India pays a fixed INR price. Everyone else sees the USD price converted at an approximate rate (marked with "≈"),
// because the exact amount, tax and rate are set by the payment page at checkout. The rates below are rough
// reference values, not live ones: update them now and then (or the display will drift).

export const PRICE_USD = 19.99;
export const PRICE_INR = 999;

/** Approximate units of each currency per 1 US dollar. */
const RATE_PER_USD: Record<string, number> = {
  EUR: 0.92, GBP: 0.79, CAD: 1.37, AUD: 1.52, NZD: 1.65, JPY: 150, CNY: 7.2, KRW: 1350, SGD: 1.34, HKD: 7.8,
  AED: 3.67, SAR: 3.75, CHF: 0.88, SEK: 10.5, NOK: 10.7, DKK: 6.9, PLN: 4.0, CZK: 23, HUF: 365, RON: 4.6,
  TRY: 33, BRL: 5.2, MXN: 17.5, ZAR: 18.5, IDR: 15800, MYR: 4.7, THB: 36, VND: 25000, PHP: 57, PKR: 280,
  BDT: 118, LKR: 300, NPR: 133, EGP: 48, ILS: 3.7,
};

const EURO_COUNTRIES = "DE FR ES IT NL BE AT IE PT FI GR SK SI LT LV EE LU MT CY HR".split(" ");

const COUNTRY_CURRENCY: Record<string, string> = {
  GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", CN: "CNY", KR: "KRW", SG: "SGD", HK: "HKD",
  AE: "AED", SA: "SAR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF",
  RO: "RON", TR: "TRY", BR: "BRL", MX: "MXN", ZA: "ZAR", ID: "IDR", MY: "MYR", TH: "THB", VN: "VND",
  PH: "PHP", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", EG: "EGP", IL: "ILS",
};
for (const c of EURO_COUNTRIES) COUNTRY_CURRENCY[c] = "EUR";

export interface PriceDisplay {
  /** Main price text, e.g. "₹999" or "≈ €18.39". */
  main: string;
  /** Small line under the price, e.g. "US$19.99 · taxes at checkout". */
  note: string;
  isIndia: boolean;
}

/** Two-letter country guess from the system: India via time zone, others via the language's region (en-DE → DE). */
export function detectCountry(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz === "Asia/Calcutta" || tz === "Asia/Kolkata") return "IN";
  } catch {
    /* ignore */
  }
  try {
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      const region = new Intl.Locale(l).region;
      if (region) return region.toUpperCase();
    }
  } catch {
    /* ignore */
  }
  return "US";
}

function fmt(amount: number, currency: string, whole = false): string {
  try {
    return new Intl.NumberFormat(navigator.language || "en", {
      style: "currency",
      currency,
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function getPriceDisplay(country: string = detectCountry()): PriceDisplay {
  if (country === "IN") {
    return { main: fmt(PRICE_INR, "INR", true), note: "One-time · taxes at checkout", isIndia: true };
  }
  const usd = fmt(PRICE_USD, "USD");
  const currency = COUNTRY_CURRENCY[country];
  const rate = currency ? RATE_PER_USD[currency] : undefined;
  if (!currency || !rate) {
    return { main: usd, note: "One-time · taxes at checkout", isIndia: false };
  }
  return {
    main: `≈ ${fmt(PRICE_USD * rate, currency)}`,
    note: `${usd} USD · final price at checkout`,
    isIndia: false,
  };
}
