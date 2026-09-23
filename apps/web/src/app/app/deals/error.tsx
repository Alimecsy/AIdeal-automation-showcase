"use client";

export default function DealsError({ reset }: { reset: () => void }) {
  return (
    <section role="alert">
      <h1 className="page-title">Deals</h1>
      <div className="panel">
        <h2 className="panel-title">Unable to load the review queue</h2>
        <p className="muted">The queue could not be loaded. Retry without changing your filters.</p>
        <button className="button button-dark" onClick={reset} type="button">Retry</button>
      </div>
    </section>
  );
}
