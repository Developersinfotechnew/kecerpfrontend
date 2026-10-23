'use client';

import { Register } from '@/components/Register';

/**
 * Material consumption.
 *
 * BOQ quantity against ordered, received and consumed. Balance and variance
 * are the arithmetic of those columns, so the register holds the inputs and
 * the screen does the rest.
 */
export default function EpcConsumptionPage() {
  return (
    <Register
      typeKey="material_tracking"
      title="Material consumption"
      description="BOQ quantity against ordered, received and consumed, per item."
    />
  );
}
