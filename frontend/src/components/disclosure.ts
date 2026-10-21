import { createElement, type ReactNode, type ToggleEvent, useState } from 'react';

/** Native keyboard/click behavior, without mounting hidden content. Keep it mounted after opening. */
export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: ReactNode;
  children: () => ReactNode;
  className?: string;
}) {
  const [visited, setVisited] = useState(false);
  return createElement(
    'details',
    {
      className,
      onToggle: (event: ToggleEvent<HTMLDetailsElement>) => {
        if (event.currentTarget.open) {
          setVisited(true);
        }
      },
    },
    createElement('summary', null, summary),
    visited ? children() : null,
  );
}
