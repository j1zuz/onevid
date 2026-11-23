import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Onevid and Hackw collect, use, share and delete account and usage data.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
        <Link
          className="text-muted-foreground text-sm transition-colors hover:text-foreground"
          href="/"
        >
          ← Onevid
        </Link>
        <h1 className="mt-8 font-semibold text-4xl text-foreground">
          Privacy Policy
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">
          Last updated: November 23, 2026
        </p>

        <div className="mt-10 space-y-8 text-sm leading-6 text-muted-foreground [&_h2]:font-semibold [&_h2]:text-foreground [&_strong]:text-foreground">
          <section className="space-y-2">
            <h2>1. Who we are</h2>
            <p>
              Onevid is a video player and catalog operated by Hackw. This
              policy explains how Onevid and Hackw ("we", "us") handle personal
              data when you use the Onevid website, mobile app, Android TV app
              or related services (the "Service"). Contact:{" "}
              <a className="underline" href="mailto:support@hackw.tech">
                support@hackw.tech
              </a>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h2>2. Information we collect</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>Account and sign-in data.</strong> If you sign in with
                Google, we receive your name, email address, profile photo and
                Google account identifier from Google. We do not receive your
                Google password.
              </li>
              <li>
                <strong>Profile data.</strong> Profile names, avatars, stickers,
                kids-profile flags and PINs. PINs are stored hashed; we never
                store the PIN in plain text.
              </li>
              <li>
                <strong>Usage and library data.</strong> Watch progress,
                watchlist, saved titles, search queries, selected language,
                feed and catalog preferences, and the sources or addons you
                configure.
              </li>
              <li>
                <strong>Debrid configuration.</strong> If you connect TorBox or
                Real-Debrid, your API key is stored encrypted and used only to
                resolve the sources you request.
              </li>
              <li>
                <strong>Technical data.</strong> IP address, device and app
                version, operating system, browser, language, crash and
                performance diagnostics, and approximate region derived from
                your IP address.
              </li>
              <li>
                <strong>Local data.</strong> Offline downloads, local video
                selections, theme and language preferences are stored on your
                device. Offline video files are not uploaded to us.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2>3. How we use information</h2>
            <p>
              We use data to authenticate you, create and switch profiles,
              remember playback progress and preferences, provide catalog and
              search results, resolve the sources you ask for, protect the
              Service from abuse, diagnose crashes and performance problems,
              provide support, and comply with legal obligations. We do not use
              your Google data for advertising or sell it.
            </p>
          </section>

          <section className="space-y-2">
            <h2>4. Google API data and NCI statement</h2>
            <p>
              Onevid requests only the basic Google identity scopes{" "}
              <code>openid</code>, <code>email</code> and <code>profile</code>.
              We use them solely to sign you in and display your name, email and
              avatar. We do not use Google APIs, Google user data or any
              AI-generated content to create, generate, store or distribute{" "}
              <strong>
                non-consensual intimate imagery (NCI)
              </strong>{" "}
              or non-consensual sexual content. Onevid does not generate images
              of people.
            </p>
          </section>

          <section className="space-y-2">
            <h2>5. Sharing</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>Google</strong> for sign-in and account authentication.
              </li>
              <li>
                <strong>TMDB</strong> for titles, posters and metadata.
              </li>
              <li>
                <strong>TorBox / Real-Debrid</strong> when you connect a debrid
                account: the providers receive the magnet or torrent you ask to
                resolve, under their own privacy policies.
              </li>
              <li>
                <strong>Cloudflare</strong> for hosting, security and delivery.
              </li>
              <li>
                <strong>PostHog</strong> for product analytics, error tracking
                and performance diagnostics. Session replay is disabled.
              </li>
              <li>
                <strong>Email providers</strong> used to send sign-in or support
                messages.
              </li>
            </ul>
            <p>
              We do not sell, rent or trade personal data. We may disclose data
              when required by law or to protect the Service and its users.
            </p>
          </section>

          <section className="space-y-2">
            <h2>6. Cookies and local storage</h2>
            <p>
              We use a session cookie for authentication, a locale cookie to
              remember your language, consent preferences, and browser storage
              for local settings and offline downloads. You can clear them from
              your browser or device settings. Disabling the session cookie
              prevents sign-in.
            </p>
          </section>

          <section className="space-y-2">
            <h2>7. Retention</h2>
            <p>
              Account data is kept while your account exists. Watch progress and
              library data are kept until you delete them or your account.
              Diagnostics and analytics are kept for a limited period according
              to our providers' retention settings. Offline downloads expire
              according to the retention setting in the app. Server logs are
              kept only as long as needed for security and operations.
            </p>
          </section>

          <section className="space-y-2">
            <h2>8. Security</h2>
            <p>
              We use HTTPS in transit, hashed PINs, encrypted debrid keys,
              access controls and least-privilege credentials. No method of
              transmission or storage is completely secure, so we cannot
              guarantee absolute security.
            </p>
          </section>

          <section className="space-y-2">
            <h2>9. Your rights</h2>
            <p>
              Depending on your jurisdiction, you may request access,
              correction, deletion, portability or restriction of your data, or
              object to processing. You can also withdraw consent. Contact{" "}
              <a className="underline" href="mailto:support@hackw.tech">
                support@hackw.tech
              </a>
              . You may lodge a complaint with your local data-protection
              authority.
            </p>
          </section>

          <section className="space-y-2">
            <h2>10. Account deletion</h2>
            <p>
              If you created an Onevid account, you can request deletion of your
              account and associated data by emailing{" "}
              <a className="underline" href="mailto:support@hackw.tech">
                support@hackw.tech
              </a>{" "}
              from the email associated with the account. In the mobile app, the
              request link is also available in Settings. We will delete or
              anonymize account data within a reasonable period, except data we
              must retain for security, fraud prevention or legal compliance.
              Deleting the account does not delete offline files already stored
              on your device; remove them from the device or the app's download
              manager.
            </p>
          </section>

          <section className="space-y-2">
            <h2>11. Children</h2>
            <p>
              The Service is not directed to children under 13. Kids profiles
              are a parental control feature and do not change this rule.
            </p>
          </section>

          <section className="space-y-2">
            <h2>12. International transfers</h2>
            <p>
              Our providers may process data in countries other than yours,
              including the United States. We use appropriate safeguards where
              required.
            </p>
          </section>

          <section className="space-y-2">
            <h2>13. Changes</h2>
            <p>
              We may update this policy. We will publish the new version on this
              page and update the date above. Material changes may also be
              communicated in the app.
            </p>
          </section>

          <section className="space-y-2">
            <h2>14. Contact</h2>
            <p>
              Questions or requests:{" "}
              <a className="underline" href="mailto:support@hackw.tech">
                support@hackw.tech
              </a>
              .
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </main>
  );
}
