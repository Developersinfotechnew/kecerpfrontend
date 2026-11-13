import { redirect } from 'next/navigation';

/**
 * The planner screen lives at /epc/planning ("Planning and tasks"). A second
 * sidebar row labelled "Project planner" points here, so this alias simply
 * forwards to it instead of dying on the "Page not built yet" catch-all.
 */
export default function EpcProjectPlannerPage() {
  redirect('/epc/planning');
}
