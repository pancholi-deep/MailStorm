import React, { useState } from 'react';
import { flushSync } from 'react-dom';

export default function ComposerSection({
  id,
  step,
  title,
  description,
  summary,
  actions,
  notice,
  children,
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section
      className={`composer-section ${expanded ? '' : 'section-collapsed'}`}
      aria-labelledby={`${id}-heading`}
      onInvalidCapture={() => {
        // Reveal required fields before the browser tries to focus an invalid input.
        if (!expanded) flushSync(() => setExpanded(true));
      }}
    >
      <div className="section-heading">
        <span className="step-number">{step}</span>
        <div className="section-heading-copy">
          <h2 id={`${id}-heading`}>{title}</h2>
          <p className={`muted ${expanded ? '' : 'section-summary'}`} title={summary}>
            {expanded ? description : summary}
          </p>
        </div>
        {expanded && actions && <div className="section-heading-actions">{actions}</div>}
        <button
          type="button"
          className="ws-button section-toggle"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          title={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          onClick={() => setExpanded(!expanded)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {notice}
      <div id={`${id}-content`} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
