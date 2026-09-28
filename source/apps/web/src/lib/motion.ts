import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

/** Presentation only: never animate measurements, clinical flags, or action availability. */
export function useWorkspaceMotion(key: string, kind: 'login' | 'workspace') {
  const scope = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!scope.current || typeof window.matchMedia !== 'function') return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const root = scope.current!;
      const targets = root.querySelectorAll(kind === 'login' ? '[data-login-reveal], .login-card' : '.page-heading, .workflow-ribbon, .attention-section');
      if (targets.length) gsap.from(targets, {
        y: kind === 'login' ? 16 : 6, opacity: 0.75, duration: kind === 'login' ? 0.65 : 0.3,
        stagger: kind === 'login' ? 0.07 : 0.035, ease: 'power2.out', clearProps: 'transform,opacity',
      });
      if (kind === 'login') {
        const paths = root.querySelectorAll('.workflow-art path');
        gsap.fromTo(paths, { strokeDasharray: 1, strokeDashoffset: 1 }, {
          strokeDashoffset: 0, duration: 1.2, stagger: 0.07, ease: 'power2.out',
          clearProps: 'strokeDasharray,strokeDashoffset',
        });
      }
    }, scope);
    return () => media.revert();
  }, [key, kind]);
  return scope;
}
