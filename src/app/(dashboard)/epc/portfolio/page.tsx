'use client';

import { Register } from '@/components/Register';

/**
 * Project portfolio.
 *
 * Every plant at a glance: contract value, budget, actual, EAC and the SPI and
 * CPI indices. The reports screen aggregates these same rows by plant.
 */
export default function EpcPortfolioPage() {
  return (
    <Register
      typeKey="project_portfolio"
      title="Project portfolio"
      description="Every plant at a glance — contract value, budget, actual cost, EAC and the schedule and cost indices."
    />
  );
}
