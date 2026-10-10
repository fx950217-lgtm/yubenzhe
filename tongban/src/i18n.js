// UI text is returned as plain text; renderers remain responsible for HTML escaping.
export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en']);
export function normalizeLocale(value) {
  return typeof value === 'string' && /^en(?:-|$)/i.test(value) ? 'en' : 'zh-CN';
}
export function normalizeTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return 'UTC';
  try { return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone; }
  catch { return 'UTC'; }
}
function utcDate(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new RangeError('Invalid UTC date');
    return new Date(value.getTime());
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) value = text + 'T00:00:00Z';
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)) value = text + 'Z';
    else if (/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) value = text;
    else throw new RangeError('Use an ISO UTC date or epoch milliseconds');
  } else if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('Invalid UTC date');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid UTC date');
  return date;
}
export function createI18n({ locale = 'zh-CN', timeZone = 'UTC', messages = {} } = {}) {
  let preferences = { locale: normalizeLocale(locale), timeZone: normalizeTimeZone(timeZone) };
  const getPreferences = () => ({ ...preferences });
  function setPreferences(next = {}) {
    preferences = {
      locale: Object.hasOwn(next, 'locale') ? normalizeLocale(next.locale) : preferences.locale,
      timeZone: Object.hasOwn(next, 'timeZone') ? normalizeTimeZone(next.timeZone) : preferences.timeZone,
    };
    return getPreferences();
  }
  function t(key, values = {}, fallback = key) {
    let template;
    for (const locale of new Set([preferences.locale, 'zh-CN', 'en'])) {
      const dictionary = messages[locale];
      if (dictionary && Object.hasOwn(dictionary, key) && typeof dictionary[key] === 'string') { template = dictionary[key]; break; }
    }
    return String(template ?? fallback).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }
  function formatDateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
    return new Intl.DateTimeFormat(preferences.locale, { ...options, timeZone: preferences.timeZone }).format(utcDate(value));
  }
  function formatNumber(value, options = {}) {
    // This formats values only; financial calculations must use the ledger's integer units.
    if (typeof value !== 'bigint' && (typeof value !== 'number' || !Number.isFinite(value))) throw new RangeError('Invalid number');
    return new Intl.NumberFormat(preferences.locale, options).format(value);
  }
  return Object.freeze({ getPreferences, setPreferences, t, formatDateTime, formatNumber });
}
