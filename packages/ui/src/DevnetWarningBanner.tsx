import React from 'react';
import { DEVNET_WARNING_BANNER } from '@atlas-rail/config';

export const DevnetWarningBanner: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div
      style={{
        backgroundColor: '#7f1d1d',
        color: '#fef2f2',
        padding: '0.5rem 1rem',
        textAlign: 'center',
        fontWeight: 600,
        fontSize: '0.875rem',
        letterSpacing: '0.025em',
        borderBottom: '1px solid #991b1b',
      }}
      className={className}
    >
      ⚠️ {DEVNET_WARNING_BANNER}
    </div>
  );
};
