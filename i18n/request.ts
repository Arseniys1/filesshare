import { getRequestConfig } from "next-intl/server";
import { headers, cookies } from "next/headers";
import Negotiator from "negotiator";
import { match } from "@formatjs/intl-localematcher";
import { routing, type AppLocale } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale;
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const requestHeaders = await headers();
  const acceptedLanguages = new Negotiator({
    headers: { "accept-language": requestHeaders.get("accept-language") ?? "" },
  }).languages();
  const detectedLocale = match(
    acceptedLanguages,
    routing.locales,
    routing.defaultLocale,
  );
  const locale: AppLocale = routing.locales.includes(cookieLocale as AppLocale)
    ? (cookieLocale as AppLocale)
    : routing.locales.includes(requestedLocale as AppLocale)
      ? (requestedLocale as AppLocale)
      : (detectedLocale as AppLocale);

  const [messages, adminPages, docs] = await Promise.all([
    import(`../messages/${locale}.json`),
    import(`../messages/adminPages/${locale}.json`),
    import(`../messages/docs/${locale}.json`),
  ]);

  return {
    locale,
    messages: {
      ...messages.default,
      adminPages: adminPages.default,
      docs: docs.default,
    },
  };
});
