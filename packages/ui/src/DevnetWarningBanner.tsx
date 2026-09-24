import React from 'react';
import { DEVNET_WARNING_BANNER } from '@atlas-rail/config';

export const DevnetWarningBanner: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        background: 'linear-gradient(90deg, rgba(153,69,255,0.16), rgba(20,241,149,0.10))',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        color: '#fde68a',
        padding: '0.45rem 1rem',
        textAlign: 'center',
        fontWeight: 600,
        fontSize: '0.75rem',
        letterSpacing: '0.03em',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          width: '6px',
          height: '6px',
          borderRadius: '9999px',
          background: '#f59e0b',
          boxShadow: '0 0 0 3px rgba(245,158,11,0.2)',
        }}
      />
      {DEVNET_WARNING_BANNER}
    </div>
  );
};
export * from './DevnetWarningBanner';
