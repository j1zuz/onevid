import posthog from "posthog-js";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_TOKEN as string, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  debug: process.env.NODE_ENV === "development",
  disable_surveys: true,
  disable_conversations: true,
  opt_out_capturing_by_default: true,
  opt_out_persistence_by_default: true,
});
// Surveys are disabled permanently — we have our own custom feedback popover in
// the sidebar dropdown. The Support (conversations) chat widget is disabled at
// init and re-enabled at runtime in <PaidUserSupportWidget /> for users with
// an active subscription.
