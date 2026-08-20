import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ru", "en", "es", "de"],
  defaultLocale: "ru",
  localePrefix: "never",
});

export type AppLocale = (typeof routing.locales)[number];
