"use client";

/**
 * PrefsEffect — renders nothing; mirrors the device-local DISPLAY prefs onto <html> as data-*
 * attributes so the CSS in globals.css / support.css applies them app-wide (feature 016). Sits with
 * the other zero-render app-wide effects in <Providers/>. Comfortable / motion-on map to ABSENT
 * attributes, so a first paint before this effect runs looks like the normal (default) app.
 */

import { useEffect } from "react";
import { useDisplayPrefs } from "@/lib/settings/usePrefs";
import { displayAttrs } from "@/lib/settings/prefs";

export function PrefsEffect(): null {
  const { prefs } = useDisplayPrefs();
  useEffect(() => {
    const el = document.documentElement;
    const { density, reducedMotion } = displayAttrs(prefs);
    if (density) el.setAttribute("data-density", density);
    else el.removeAttribute("data-density");
    if (reducedMotion) el.setAttribute("data-reduced-motion", reducedMotion);
    else el.removeAttribute("data-reduced-motion");
  }, [prefs]);
  return null;
}
