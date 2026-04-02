import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { applyBaseUrl } from '../utils/base-url';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  active?: boolean;
}

export function Link({
  children,
  active,
  href,
  className = '',
  ...props
}: LinkProps) {
  return (
    <a
      href={href ? applyBaseUrl(href) : href}
      className={`transition-colors duration-200 ${active ? 'text-switch-accent-bright font-medium' : 'text-switch-text-dim hover:text-switch-text'} ${className}`}
      {...props}
    >
      {children}
    </a>
  );
}
