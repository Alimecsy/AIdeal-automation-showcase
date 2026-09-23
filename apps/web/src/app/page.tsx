import { SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";

const signals = [
  ["Document completeness", "82%"],
  ["Company verification", "B"],
  ["Research confidence", "High"],
  ["Recommended action", "Request POF"],
];

export default function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Primary">
        <div className="brand">AIDEAL</div>
        <div className="nav-actions">
          <SignedOut>
            <Link className="button button-secondary" href="/sign-in">
              Login
            </Link>
            <Link className="button button-primary" href="/sign-up">
              Request demo
            </Link>
          </SignedOut>
          <SignedIn>
            <Link className="button button-secondary" href="/app">
              Open app
            </Link>
          </SignedIn>
        </div>
      </nav>

      <section className="landing-hero">
        <div>
          <p className="eyebrow">Deal intake intelligence</p>
          <h1 className="hero-title">
            Turn financing and trade requests into scored deal packets.
          </h1>
          <p className="hero-copy">
            AIDEAL evaluates submissions, documents, research, SOP fit, and
            recommended next steps before your analysts spend hours reviewing.
          </p>
          <div className="hero-actions">
            <SignedOut>
              <Link className="button button-primary" href="/sign-up">
                Request demo
              </Link>
              <Link className="button button-secondary" href="/sign-in">
                View product walkthrough
              </Link>
            </SignedOut>
            <SignedIn>
              <Link className="button button-primary" href="/app">
                Open app
              </Link>
              <Link className="button button-secondary" href="/app">
                View command center
              </Link>
            </SignedIn>
          </div>
        </div>

        <div className="motion-panel" aria-label="AIDEAL deal packet preview">
          <div className="packet">
            <div className="packet-header">
              <div>
                <strong>Commodity Trade Request</strong>
                <div className="muted">Applicant packet generated</div>
              </div>
              <span className="rating">B+</span>
            </div>
            <div className="signal-list">
              {signals.map(([label, value]) => (
                <div className="signal" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
