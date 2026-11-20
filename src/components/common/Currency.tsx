import React from 'react';
import { IndianRupee } from 'lucide-react';

interface CurrencyProps {
  value: number;
  className?: string;
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl';
}

export const Currency: React.FC<CurrencyProps> = ({
  value,
  className = '',
  size = 'base',
}) => {
  const formattedNumber = (Math.round(value) || 0).toLocaleString('en-IN');

  const iconSizes = {
    xs: 'w-2.5 h-2.5',
    sm: 'w-3 h-3',
    base: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
    xl: 'w-5 h-5',
    '2xl': 'w-6 h-6',
  };

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <IndianRupee className={`${iconSizes[size]} shrink-0`} strokeWidth={2.5} />
      <span>{formattedNumber}</span>
    </span>
  );
};
