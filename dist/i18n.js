/* Explicit source-text catalog for the calculator.
 * UI text is localized at render time; engineering values remain unchanged.
 * GPL-3.0-or-later */
import { english } from "./locales/en.js?v=01b1a032c3";

export function getLanguage() {
  if (typeof window === "undefined") return "zh";
  const query = new URL(window.location.href).searchParams.get("lang");
  if (query === "zh" || query === "en") { try { localStorage.setItem("shinepcb.language", query); } catch {} return query; }
  try { const saved = localStorage.getItem("shinepcb.language"); if (saved === "en" || saved === "zh") return saved; } catch {}
  return "zh";
}
export const language = getLanguage();
export const localeTag = language === "en" ? "en-US" : "zh-CN";
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const indices = [];
  const chunks = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { indices.push(Number(part.slice(1, -1))); return "([\\s\\S]*?)"; }
    return escapeRegex(part);
  });
  return { pattern: new RegExp("^" + chunks.join("") + "$"), value, indices, length: key.length };
}).sort((a, b) => b.length - a.length);
const format = (value, values) => value.replace(/\{(\d+)\}/g, (match, index) => index in values ? String(values[index]) : match);

export function translate(text, selected = "zh", depth = 0) {
  if (typeof text !== "string" || selected !== "en") return text;
  if (Object.hasOwn(english, text)) return english[text];
  if (!/[\u3400-\u9fff]/.test(text) || depth > 3) return text;
  const series = /^([A-Z0-9-]+) 系列$/.exec(text);
  if (series) return `${series[1]} series`;
  for (const { pattern, value, indices } of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const values = {};
      indices.forEach((index, position) => { values[index] = translate(match[position + 1], selected, depth + 1); });
      return format(value, values);
    }
  }
  return text;
}
export function t(source, ...values) {
  if (typeof source === "string") return translate(source, language);
  let key = source[0];
  values.forEach((_, index) => { key += `{${index}}` + source[index + 1]; });
  return format(language === "en" && Object.hasOwn(english, key) ? english[key] : key, values);
}
export function canonicalText(text) {
  return Object.keys(english).find(key => english[key] === text) ?? text;
}
export function localizeStatic(root = document) {
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const attribute of ["aria-label", "title", "placeholder", "content"]) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
  }
}
export function changeLanguage(next) {
  if (!["zh", "en"].includes(next) || next === language) return;
  if (!window.dispatchEvent(new CustomEvent("sunden:language-will-change", { cancelable: true, detail: next }))) return;
  window.dispatchEvent(new CustomEvent("sunden:language-change", { detail: next }));
  try { localStorage.setItem("shinepcb.language", next); } catch {}
  const url = new URL(window.location.href); url.searchParams.set("lang", next);
  window.location.replace(url.href);
}
