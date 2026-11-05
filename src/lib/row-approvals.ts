'use client';

import { useCallback, useEffect, useState } from 'react';

import { approvals } from '@/lib/services';
import type { RecordApprovalState, RecordApprovalSummary } from '@/lib/services';

/**
 * Row-level approval state for a register's records.
 *
 * The rule the approval screens follow: a record that has been **approved**
 * shows only a Details button — it is a settled fact, and the backend freezes
 * it the same way (an edit or delete on an approved record is a 403 for every
 * user, on every route). A record still **before** approval shows Edit and
 * Details. A register with no approval chain at all keeps its normal Edit.
 */
/**
 * The registers whose rows open an approval chain (the backend trigger map's
 * keys). Rows on these registers get the Send-for-approval action when they
 * have no chain; rows on every other register keep their plain Edit only.
 */
export const CHAIN_REGISTER_KEYS = new Set([
  'purchase_requirements', 'purchase_orders', 'boq_register', 'ra_bills',
  'hse_permits', 'ncr_register', 'itp_plans', 'performance_tests',
  'schedule_milestones', 'payment_milestones', 'onboarding', 'scope_change',
  'dci_documents', 'drawing_register', 'as_built', 'rfi_register',
  'po_amendments', 'vendor_payments', 'advance_payments', 'raise_po',
  'dsr_entries', 'commissioning_tests', 'goods_receipts', 'handover_acceptance',
  'material_issue', 'dispatch_clearances', 'document_publication', 'variation',
]);

/**
 * Status words that mean "approved" on a record's own data, when no chain
 * instance ever opened (a row edited to its approved status by hand, or a
 * register the chain predates). These also freeze the row, same rule.
 */
export const APPROVED_STATUS_WORDS = new Set(['Approved', 'Client approved', 'Verified']);

/**
 * The pre-chain words: a row that still sits in one of these has not been
 * sent through the register's chain yet, so the Send-for-approval action is
 * available (when the states call confirms no chain exists). Every other
 * status word means the document is in review or finished — no send button.
 */
export const PRE_CHAIN_WORDS = new Set(['WIP', 'Draft', 'Not started', 'Created', 'New', 'Submitted', 'Pending', 'Awaiting review']);

export function useRowApprovals(typeKey: string, rows: Array<{ ref: string; data: Record<string, unknown> }>) {
  const refs = rows.map((r) => r.ref);
  const byRef = new Map(rows.map((r) => [r.ref, r.data]));
  const [states, setStates] = useState<Record<string, RecordApprovalSummary>>({});
  // True only when the bulk states call actually succeeded. A failure
  // (403, network) must not read as "no chain" — the Send-for-approval
  // action shows only when we positively know the row has no chain.
  const [statesKnown, setStatesKnown] = useState(false);
  const [detail, setDetail] = useState<RecordApprovalState | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  useEffect(() => {
    if (refs.length === 0) {
      setStates({});
      setStatesKnown(false);
      return;
    }
    setStatesKnown(false);
    let cancelled = false;
    approvals
      .recordStates(typeKey, refs)
      .then((s) => {
        if (!cancelled) {
          setStates(s ?? {});
          setStatesKnown(true);
        }
      })
      .catch((err) => {
        // A silent {} here means "show Edit everywhere", which reads as the
        // rule not working. Log the real cause once per screen instead.
        console.warn('[row-approvals] recordStates failed for', typeKey, err);
        if (!cancelled) setStates({});
      });
    return () => {
      cancelled = true;
    };
    // The refs list identity changes on every load; the joined key is the
    // real trigger (same rows = no refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey, refs.join(',')]);

  /**
   * True when the row is frozen: its latest chain is approved, or the row's
   * own status already reads approved even with no chain ever opened on it.
   */
  const isApproved = (ref: string): boolean => {
    if (states[ref]?.status === 'approved') return true;
    const word = String(byRef.get(ref)?.status ?? '');
    return APPROVED_STATUS_WORDS.has(word);
  };
  /**
   * True when Details applies: the row has a chain, or its status shows the
   * approval outcome (that state is worth looking at, not just editing).
   */
  const hasChain = (ref: string): boolean => {
    if (states[ref] !== undefined) return true;
    return APPROVED_STATUS_WORDS.has(String(byRef.get(ref)?.status ?? ''));
  };

  const openDetail = useCallback(
    async (ref: string) => {
      setDetailBusy(true);
      try {
        const state = await approvals.recordState(typeKey, ref);
        if (state) setDetail(state);
      } finally {
        setDetailBusy(false);
      }
    },
    [typeKey],
  );

  /**
   * True when the row's own status word says "not yet in a chain". This is
   * what keeps the Send button off on in-review words (In client review,
   * Internal review, In progress, Under approval, Returned, …) even when
   * the bulk states call has not answered.
   */
  const preChain = (ref: string): boolean => {
    const word = String(byRef.get(ref)?.status ?? '');
    return word === '' || PRE_CHAIN_WORDS.has(word);
  };

  return { isApproved, hasChain, preChain, statesKnown, openDetail, detail, setDetail, detailBusy };
}
