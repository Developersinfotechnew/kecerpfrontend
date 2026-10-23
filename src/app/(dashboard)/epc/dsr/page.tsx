'use client';

import { Register } from '@/components/Register';

/**
 * Daily site report.
 *
 * Material booked against an activity, manpower deployed, hours lost to delay.
 * Each entry is one day of one activity.
 */
export default function EpcDsrPage() {
  return (
    <Register
      typeKey="dsr_entries"
      title="Daily site report"
      description="Material booked against an activity, manpower deployed, and hours lost to delay."
    />
  );
}
