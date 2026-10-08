import type { Metadata } from 'next';
import { BreakClient } from './BreakClient';

export const metadata: Metadata = {
  title: 'Try to break it · Atlas Rail',
  description: 'Take control of an AI agent and try to make it pay where it should not. The real Atlas Rail gate decides, live.',
};

export default function BreakPage() {
  return <BreakClient />;
}
