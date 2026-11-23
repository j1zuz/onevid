import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using Onevid and Hackw.",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">
          Last updated: November 23, 2026
        </p>

        <div className="mt-10 space-y-8 text-sm leading-6 text-muted-foreground [&_h2]:font-semibold [&_h2]:text-foreground [&_strong]:text-foreground">
          <section className="space-y-2">
            <h2>1. Acceptance</h2>
            <p>
              By using Onevid or Hackw you agree to these terms. If you do not
              agree, do not use the Service. The Service is operated by Hackw;
              contact{" "}
              <a className="underline" href="mailto:support@hackw.tech">
                support@hackw.tech
              </a>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h2>2. The Service</h2>
            <p>
              Onevid is a video player, catalog and library. It can play local
              files and resolve sources from addons or debrid accounts that you
              configure. We do not host, upload or control the third-party
              content those sources provide. Availability, quality and legality
              of third-party sources are the responsibility of the provider and
              of the user who chooses to access them.
            </p>
          </section>

          <section className="space-y-2">
            <h2>3. Accounts</h2>
            <p>
              You must provide accurate information and keep access to your
              account secure. You are responsible for activity under your
              account and profiles. You may request account deletion by
              contacting{" "}
              <a className="underline" href="mailto:support@hackw.tech">
                support@hackw.tech
              </a>{" "}
              from the account email.
            </p>
          </section>

          <section className="space-y-2">
            <h2>4. Acceptable use</h2>
            <p>
              You may not use the Service to break the law, infringe
              intellectual-property rights, distribute malware, attempt to gain
              unauthorized access, overload the Service, or create or
              distribute non-consensual intimate imagery (NCI) or
              AI-generated sexual content involving real people without
              consent. We may suspend access for abuse.
            </p>
          </section>

          <section className="space-y-2">
            <h2>5. Third-party addons and debrid</h2>
            <p>
              Addons, debrid providers and external links are third-party
              services with their own terms and privacy policies. You are
              responsible for the keys, accounts and sources you connect. We do
              not endorse or guarantee third-party content.
            </p>
          </section>

          <section className="space-y-2">
            <h2>6. Local downloads</h2>
            <p>
              Offline copies are stored on your device and may expire according
              to the retention setting. You are responsible for the storage and
              lawful use of those copies.
            </p>
          </section>

          <section className="space-y-2">
            <h2>7. Intellectual property</h2>
            <p>
              The Onevid/Hackw name, interface, code and branding belong to
              their respective owners. These terms do not grant rights to
              third-party content.
            </p>
          </section>

          <section className="space-y-2">
            <h2>8. Disclaimer</h2>
            <p>
              The Service is provided "as is" and "as available", without
              warranties of uninterrupted operation, accuracy or fitness for a
              particular purpose. We are not liable for third-party content,
              network failures, device incompatibility or data loss to the
              extent permitted by law.
            </p>
          </section>

          <section className="space-y-2">
            <h2>9. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, we are not liable for
              indirect, incidental, special or consequential damages, or for
              loss of data, revenue or profits arising from use of the Service.
            </p>
          </section>

          <section className="space-y-2">
            <h2>10. Changes and termination</h2>
            <p>
              We may update the Service or these terms. We may suspend or end
              access for violations or operational reasons. Material changes
              will be published on this page.
            </p>
          </section>

          <section className="space-y-2">
            <h2>11. Contact</h2>
            <p>
              Questions:{" "}
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
