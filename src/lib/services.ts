import { api, apiMultipart, setAccessToken } from './api';
import type {
  ClientUser,
  FileValue,
  RecordListPage,
  RecordRow,
  RecordType,
  RecordTypeVocabulary,
  SuiteCatalogue,
} from './types';

/**
 * Uploads.
 *
 * A file is stored on the record as a descriptor. The bytes live elsewhere,
 * and `url` is a short-lived signed link that opens the document directly,
 * which is what makes a list cell render as a plain anchor.
 */
export const uploads = {
  /**
   * `perm` is the full create permission for the register, e.g.
   * `dms:create`. The backend checks it against the caller's own permission
   * set, so an upload is only possible where the user can already create a
   * row — no separate "may upload" grant to hand out.
   */
  async upload(file: File, perm: string): Promise<FileValue> {
    const form = new FormData();
    form.append('file', file);
    return apiMultipart<FileValue>(`/uploads?perm=${encodeURIComponent(perm)}`, form);
  },
};

export const auth = {
  async login(email: string, password: string): Promise<ClientUser> {
    const data = await api<{ accessToken: string; user: ClientUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });

    setAccessToken(data.accessToken);
    return data.user;
  },

  async logout(): Promise<void> {
    await api('/auth/logout', { method: 'POST' });
    setAccessToken(null);
  },

  async me(): Promise<ClientUser> {
    const data = await api<{ user: ClientUser }>('/auth/me');
    return data.user;
  },
};

export const nav = {
  async catalogue(): Promise<SuiteCatalogue[]> {
    return api<SuiteCatalogue[]>('/nav');
  },
};

/** One delivery phase attached to a plant. */
export interface ProjectStage {
  id: string;
  code: string;
  stage: 'pmc' | 'epc' | 'eptp' | 'om';
  status: string;
  progress: number;
  contractValue: number;
}

export interface ProjectOption {
  id: string;
  code: string;
  name: string;
  location: string;
  technology: string;
  pm: string;
  clientName: string;
  capacityTpd: number;
  contractValue: number;
  budget: number;
  committed: number;
  actual: number;
  eac: number;
  billed: number;
  collected: number;
  progress: number;
  scheduleDays: number;
  spi: number;
  cpi: number;
  /** RAG override the PM sets; engine computes the rest. */
  health?: 'green' | 'amber' | 'red';
  /** CR-04: per-project client approval switch; the workflow engine skips client steps when false. */
  clientApprovalsEnabled?: boolean;
  openActions: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
  /** 'master' is a plant, 'stage' is one delivery phase of it. */
  kind: 'master' | 'stage';
  stage: 'pmc' | 'epc' | 'eptp' | 'om' | null;
  parentProjectId: string | null;
  enabledStages: ('pmc' | 'epc' | 'eptp' | 'om')[];
  stages: ProjectStage[];
}

/**
 * Creates a plant and its delivery stages.
 *
 * The backend fans the plant out into one stage project per enabled phase,
 * inside a transaction. A failure rolls the whole plant back, so a half-created
 * plant with a missing EPC never reaches the portfolio.
 */
export const projects = {
  async list(params: { kind?: 'master' | 'stage'; stage?: string } = {}): Promise<ProjectOption[]> {
    const qs = new URLSearchParams();
    if (params.kind) qs.set('kind', params.kind);
    if (params.stage) qs.set('stage', params.stage);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api<ProjectOption[]>(`/projects${suffix}`);
  },

  async create(
    body: CreateProjectInput,
  ): Promise<ProjectOption> {
    return api<ProjectOption>('/projects', { method: 'POST', body });
  },

  /** Edits the master-level fields of a project. Gated on project:update. */
  async update(
    id: string,
    body: {
      name?: string;
      location?: string;
      technology?: string;
      capacityTpd?: number;
      contractValue?: number;
      startDate?: string | null;
      endDate?: string | null;
      health?: 'green' | 'amber' | 'red';
      clientApprovalsEnabled?: boolean;
    },
  ): Promise<ProjectOption> {
    return api<ProjectOption>(`/projects/${id}`, { method: 'PATCH', body });
  },

  /** The projects the calling user is a team member of, with their role. */
  async myProjects(): Promise<Array<{ id: string; code: string; name: string; location: string; role: string }>> {
    return api<Array<{ id: string; code: string; name: string; location: string; role: string }>>('/projects/my-projects');
  },

  /** The team assigned to one project. Read by any user on the team. */
  async team(projectId: string): Promise<ProjectTeamMember[]> {
    return api<ProjectTeamMember[]>(`/projects/${projectId}/team`);
  },

  /** Add a user to a project's team. Superadmin only. */
  async addToTeam(projectId: string, userId: string, role: string): Promise<{ id: string; userId: string; role: string }> {
    return api(`/projects/${projectId}/team`, { method: 'POST', body: { userId, role } });
  },

  /** Remove a user from a project's team. Superadmin only. */
  async removeFromTeam(projectId: string, memberId: string): Promise<{ id: string }> {
    return api(`/projects/${projectId}/team/${memberId}`, { method: 'DELETE' });
  },

  /** Portfolio MIS roll-up: one row per project with open NCRs, claims and approvals. */
  async portfolioMis(): Promise<MisResult> {
    return api<MisResult>('/projects/portfolio-mis');
  },
};

/** A row in a project's team list. */
/**
 * Portfolio MIS roll-up.
 *
 * One row per project in scope: the leadership view of the whole portfolio
 * rather than one plant. Counts come from live aggregation over the NCR,
 * claims and approval tables.
 */
export interface ProcurementMis {
  scopeLabel: string;
  openPrsByStage: Array<{ stage: string; count: number }>;
  rfqAwaitingOffers: number;
  poPendingApproval: number;
  delayedItems: number;
  delayedOldestDays: number;
  vendorPaymentsPending: number;
  boqBudget: number;
  poPlaced: number;
  savingVsBoq: number;
}

export interface MisProjectRow {
  projectId: string;
  name: string;
  code: string;
  pm: string;
  status: string;
  health: 'green' | 'amber' | 'red';
  progress: number;
  spi: number;
  cpi: number;
  eac: number;
  budget: number;
  openNcrs: number;
  openClaims: number;
  pendingApprovals: number;
  pendingClientApprovals: number;
  clientApprovalAgeDays: number;
  /** CR-13: month-to-date DPR compliance, 0-100. */
  dprCompliance?: number;
  finalAccount: number;
  closedAccounts: number;
}

export interface MisResult {
  totalProjects: number;
  activeProjects: number;
  delayedProjects: number;
  totalOpenNcrs: number;
  totalOpenClaims: number;
  totalPendingApprovals: number;
  totalPendingClientApprovals: number;
  totalDprCompliance: number;
  orderBook: number;
  totalEac: number;
  totalBudget: number;
  totalFinalAccount: number;
  rows: MisProjectRow[];
}

export interface ProjectTeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  addedBy: string | null;
  addedAt: string;
}

/** The four delivery lines a client may have bought. */
export type ServiceLine = 'backoffice' | 'pmc' | 'epc' | 'eptp' | 'om';

/** A counterparty. Created in admin, referenced by every project. */
export interface ClientEntity {
  id: string;
  code: string;
  name: string;
  plant: string;
  services: ServiceLine[];
  contacts: Array<{
    name: string;
    designation: string;
    email: string;
    mobile: string;
    approverLevel: 'Engineer' | 'Management' | 'Other';
  }>;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  externalRef: string;
  isActive: boolean;
}

export type ClientContact = ClientEntity['contacts'][number];

/** A user eligible to be named as a project manager. */
export interface ManagerOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Administration.
 *
 * Everything a super admin creates before work can begin lives here: clients,
 * people, roles and the team membership that ties a person to a project.
 * Creating a client and creating a person are prerequisites for creating a
 * project, so this surface is the top of the hierarchy.
 */
export const admin = {
  async clients(): Promise<ClientEntity[]> {
    return api<ClientEntity[]>('/admin/clients');
  },

  async createClient(
    body: {
      name: string;
      code?: string;
      plant?: string;
      services?: ServiceLine[];
      contacts?: Array<{
        name: string;
        designation?: string;
        email?: string;
        mobile?: string;
        approverLevel?: 'Engineer' | 'Management' | 'Other';
      }>;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      externalRef?: string;
    },
  ): Promise<ClientEntity> {
    return api<ClientEntity>('/admin/clients', { method: 'POST', body });
  },

  async updateClient(id: string, body: Partial<ClientEntity>): Promise<ClientEntity> {
    return api<ClientEntity>(`/admin/clients/${id}`, { method: 'PATCH', body });
  },

  async deleteClient(id: string): Promise<{ id: string }> {
    return api<{ id: string }>(`/admin/clients/${id}`, { method: 'DELETE' });
  },

  /** Active users whose role may own a project. Feeds the PM picker. */
  async managers(): Promise<ManagerOption[]> {
    return api<ManagerOption[]>('/admin/managers');
  },

  async users(): Promise<UserOption[]> {
    return api<UserOption[]>('/admin/users');
  },

  async deleteUser(id: string): Promise<{ id: string }> {
    return api<{ id: string }>(`/admin/users/${id}`, { method: 'DELETE' });
  },

  async createUser(body: {
    name: string;
    email: string;
    password: string;
    role: string;
    projectIds: string[];
    clientIds?: string[];
  }): Promise<{ id: string; email: string }> {
    return api<{ id: string; email: string }>('/admin/users', { method: 'POST', body });
  },

  async updateUser(
    id: string,
    body: { name?: string; role?: string; isActive?: boolean; projectIds?: string[] },
  ): Promise<unknown> {
    return api(`/admin/users/${id}`, { method: 'PATCH', body });
  },

  /** Users waiting for admin approval. Gated on admin:approve. */
  async pendingUsers(): Promise<PendingUser[]> {
    return api<PendingUser[]>('/admin/users-pending');
  },

  async approveUser(id: string): Promise<{ id: string; approvalStatus: string }> {
    return api(`/admin/users/${id}/approve`, { method: 'POST' });
  },

  async rejectUser(id: string, reason: string): Promise<{ id: string }> {
    return api(`/admin/users/${id}/reject`, { method: 'POST', body: { reason } });
  },

  async setUserModuleAccess(
    id: string,
    moduleAccess: Record<string, string>,
  ): Promise<{ id: string; moduleAccess: Record<string, string> }> {
    return api(`/admin/users/${id}/module-access`, { method: 'POST', body: { moduleAccess } });
  },

  async setUserServices(
    id: string,
    services: string[],
  ): Promise<{ id: string; services: string[] }> {
    return api(`/admin/users/${id}/services`, { method: 'POST', body: { services } });
  },

  /** Assign which projects a user may see. Empty array = no project scope. */
  async setUserProjects(
    id: string,
    projectIds: string[],
  ): Promise<{ id: string; projectIds: string[] }> {
    return api(`/admin/users/${id}/projects`, { method: 'POST', body: { projectIds } });
  },

  async roles(): Promise<RoleOption[]> {
    return api<RoleOption[]>('/admin/roles');
  },

  /** The permission matrix: modules, actions and every module:action pair. */
  async permissions(): Promise<PermissionMatrix> {
    return api<PermissionMatrix>('/admin/permissions');
  },

  async createRole(body: RoleBody): Promise<RoleOption> {
    return api<RoleOption>('/admin/roles', { method: 'POST', body });
  },

  async updateRole(id: string, body: RoleBody): Promise<RoleOption> {
    return api<RoleOption>(`/admin/roles/${id}`, { method: 'PATCH', body });
  },

  async deleteRole(id: string): Promise<{ id: string }> {
    return api<{ id: string }>(`/admin/roles/${id}`, { method: 'DELETE' });
  },

  async navEntries(): Promise<NavEntryView[]> {
    return api<NavEntryView[]>('/nav/admin');
  },

  async createNavEntry(body: NavEntryBody): Promise<NavEntryView> {
    return api<NavEntryView>('/nav/admin', { method: 'POST', body });
  },

  async updateNavEntry(id: string, body: NavEntryBody): Promise<NavEntryView> {
    return api<NavEntryView>(`/nav/admin/${id}`, { method: 'PATCH', body });
  },

  async deleteNavEntry(id: string): Promise<NavEntryView> {
    return api<NavEntryView>(`/nav/admin/${id}`, { method: 'DELETE' });
  },

  // --- audit log ---

  async auditLog(params: { entity?: string; action?: string; actorEmail?: string; from?: string; limit?: number; skip?: number }): Promise<AuditLogPage> {
    const qs = new URLSearchParams();
    if (params.entity) qs.set('entity', params.entity);
    if (params.action) qs.set('action', params.action);
    if (params.actorEmail) qs.set('actorEmail', params.actorEmail);
    if (params.from) qs.set('from', params.from);
    qs.set('limit', String(params.limit ?? 200));
    qs.set('skip', String(params.skip ?? 0));
    return api<AuditLogPage>(`/admin/audit-log?${qs.toString()}`);
  },

  async exportAuditLog(params: { entity?: string; action?: string; limit?: number; skip?: number }): Promise<AuditEntry[]> {
    const qs = new URLSearchParams();
    if (params.entity) qs.set('entity', params.entity);
    if (params.action) qs.set('action', params.action);
    qs.set('limit', String(params.limit ?? 5000));
    qs.set('skip', String(params.skip ?? 0));
    return api<AuditEntry[]>(`/admin/audit-log/export?${qs.toString()}`);
  },
};

export interface AuditEntry {
  _id: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string;
  userAgent: string;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditEntry[];
  total: number;
  limit: number;
  skip: number;
}

/** A role as the admin UI needs it. */
export interface RoleOption {
  _id: string;
  name: string;
  label: string;
  description: string;
  permissions: string[];
  projectScopeAll: boolean;
  approvalLimit: number;
  isSystem: boolean;
}

/** Write payload for a role. `id` is never sent; the route reads it from the URL. */
export interface RoleBody {
  name?: string;
  label?: string;
  description?: string;
  permissions?: string[];
  projectScopeAll?: boolean;
  approvalLimit?: number;
}

/** The permission catalogue the backend enforces against. */
export interface PermissionMatrix {
  modules: string[];
  actions: string[];
  permissions: string[];
}

export type Suite = 'backoffice' | 'epc' | 'pmc' | 'eptp' | 'om' | 'shared';

/** A sidebar entry as the admin editor sees it, unfiltered by client service. */
export interface NavEntryView {
  id: string;
  suite: Suite;
  group: string;
  path: string;
  label: string;
  icon: string;
  description: string;
  requiredPermission: string;
  modules: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NavEntryBody {
  suite?: Suite;
  group?: string;
  path?: string;
  label?: string;
  icon?: string;
  description?: string;
  requiredPermission?: string;
  modules?: string[];
  sortOrder?: number;
  isActive?: boolean;
}

/** A project team member: a user plus the role and project they hold. */
export interface UserOption {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Present only when the caller has loaded the role list to resolve it. */
  roleLabel?: string;
  projectScopeAll: boolean;
  projectIds: string[];
  clientIds: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason: string;
  moduleAccess: Record<string, 'view' | 'add' | 'edit' | 'full'>;
  services: string[];
}

/** A user whose approval is pending or who was rejected. */
export interface PendingUser {
  id: string;
  name: string;
  email: string;
  roleName: string;
  createdAt: string;
  approvalStatus: 'pending' | 'rejected';
  rejectionReason: string;
  services?: string[];
  moduleAccess?: Record<string, string>;
}

/**
 * Fields the create form sends. The backend treats `enabledStages` as the
 * source of truth for which phases exist.
 */
export interface CreateProjectInput {
  name: string;
  code: string;
  location: string;
  technology: string;
  /** User id of the project manager. Drives the displayed `pm` name. */
  managerId?: string;
  pm: string;
  clientId: string;
  capacityTpd: number;
  contractValue: number;
  startDate: string;
  endDate: string;
  enabledStages: ('pmc' | 'epc' | 'eptp' | 'om')[];
  stageBudgets?: Partial<Record<'pmc' | 'epc' | 'eptp' | 'om', number>>;
}

/** Urgency carried on an approval instance. 'Medium' is the stored default. */
export type Priority = 'High' | 'Medium' | 'Low';

export const approvals = {
  async queue(): Promise<unknown[]> {
    return api<unknown[]>('/workflow/queue');
  },

  async act(
    id: string,
    action: 'approve' | 'reject' | 'return',
    remark: string,
    evidence?: { url: string; name: string } | null,
  ): Promise<unknown> {
    return api(`/workflow/instances/${id}/act`, {
      method: 'POST',
      body: { action, remark, evidence: evidence ?? null },
    });
  },

  /**
   * Full trail of decisions for one instance, including every approver note.
   * Non-admin endpoint: any approver with workflow:view can read the notes.
   */
  async trail(id: string): Promise<{
    actions: Array<ApprovalInstanceAction & { actorName: string }>;
    awaitingUser: string | null;
  }> {
    return api(`/workflow/instances/${id}/trail`);
  },

  /** Documents returned to this user, waiting for resubmission. */
  async awaiting(): Promise<AwaitingResubmitItem[]> {
    return api<AwaitingResubmitItem[]>('/workflow/awaiting');
  },

  /** Approver's own returns that are still sitting with the requester. */
  async returnedByMe(): Promise<ReturnedByMeItem[]> {
    return api<ReturnedByMeItem[]>('/workflow/returned-by-me');
  },

  /**
   * Full lifecycle history the user is involved with, filterable by status.
   * One record's journey: pending, returned, rejected, approved, cancelled.
   */
  async history(status?: 'pending' | 'returned' | 'rejected' | 'approved' | 'cancelled'): Promise<HistoryItem[]> {
    const qs = status ? `?status=${status}` : '';
    return api<HistoryItem[]>(`/workflow/history${qs}`);
  },

  /** Resubmit a returned document back into the chain at step 1. */
  async resubmit(id: string, remark: string): Promise<unknown> {
    return api(`/workflow/instances/${id}/resubmit`, {
      method: 'POST',
      body: { remark },
    });
  },

  /** The 13-row approval matrix. Gated on admin:view. */
  async matrix(): Promise<ApprovalMatrixRow[]> {
    return api<ApprovalMatrixRow[]>('/workflow/admin/matrix');
  },

  /** Full chain definitions. Gated on admin:view. */
  async chains(): Promise<ApprovalChain[]> {
    return api<ApprovalChain[]>('/workflow/admin/chains');
  },

  /** Paginated instance history. Gated on admin:view. */
  async instances(params: { status?: string; entity?: string; limit?: number; offset?: number }): Promise<ApprovalInstancePage> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.entity) qs.set('entity', params.entity);
    qs.set('limit', String(params.limit ?? 50));
    qs.set('offset', String(params.offset ?? 0));
    return api<ApprovalInstancePage>(`/workflow/admin/instances?${qs.toString()}`);
  },

  /** One instance with full detail. Gated on admin:view. */
  async instance(id: string): Promise<ApprovalInstanceDetail> {
    return api<ApprovalInstanceDetail>(`/workflow/admin/instances/${id}`);
  },

  /**
   * Create an approval chain. Gated on the superadmin role only.
   */
  async createChain(body: {
    key: string;
    label: string;
    entity: string;
    description?: string;
    steps: ApprovalChainStep[];
  }): Promise<ApprovalChain> {
    return api<ApprovalChain>('/workflow/admin/chains', { method: 'POST', body });
  },

  /**
   * Rewrite a chain's steps/label/entity. Gated on the superadmin role only.
   */
  async updateChain(
    id: string,
    body: { label?: string; description?: string; entity?: string; steps?: ApprovalChainStep[]; isActive?: boolean },
  ): Promise<ApprovalChain> {
    return api<ApprovalChain>(`/workflow/admin/chains/${id}`, { method: 'PATCH', body });
  },

  /**
   * Soft-delete a chain. Gated on the superadmin role only.
   */
  async deleteChain(id: string): Promise<{ id: string }> {
    return api<{ id: string }>(`/workflow/admin/chains/${id}`, { method: 'DELETE' });
  },
};

/**
 * The in-app bell. Every user gets their own notifications: an approver's
 * decision lands here when they acted on something this user raised.
 */
export interface NotificationItem {
  id: string;
  actorName: string;
  actorEmail: string;
  action: string;
  entity: string;
  entityId: string;
  remark: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationBell {
  unreadCount: number;
  items: NotificationItem[];
}

export const notifications = {
  async bell(limit = 20): Promise<NotificationBell> {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    return api<NotificationBell>(`/notifications?${qs.toString()}`);
  },

  async markAllRead(): Promise<{ changed: number }> {
    return api<{ changed: number }>('/notifications/read-all', { method: 'POST' });
  },
};

export interface ApprovalChainStep {
  order: number;
  name: string;
  role: string;
  minAmount: number;
  maxAmount: number;
  parallel: boolean;
}

export interface ApprovalChain {
  id: string;
  key: string;
  label: string;
  description: string;
  entity: string;
  isActive: boolean;
  customized: boolean;
  totalSteps: number;
  steps: ApprovalChainStep[];
}

export interface ApprovalMatrixRow {
  transaction: string;
  key: string;
  exists: boolean;
  chain: string;
  stepCount: number;
}

export interface ApprovalInstanceAction {
  stepOrder: number;
  role: string;
  actorEmail: string;
  actorName?: string;
  action: 'approved' | 'rejected' | 'returned' | 'resubmitted';
  remark: string;
  at: string;
}

/** One item in the resubmission queue: a document an approver sent back. */
export interface AwaitingResubmitItem {
  id: string;
  entity: string;
  entityId: string;
  amount: number;
  priority: Priority;
  workflowLabel: string;
  totalSteps: number;
  returnedBy: string;
  returnedRole: string;
  returnedRemark: string;
  returnedAt: string;
  nextStepName: string;
  nextStepRole: string;
  nextStepOrder: number;
}

/**
 * One document an approver returned that is still parked with the requester.
 * Shown on the approver's side so they can see their own returns and the note
 * they left, until the requester resubmits or the item is otherwise closed.
 */
export interface ReturnedByMeItem {
  id: string;
  entity: string;
  entityId: string;
  amount: number;
  priority: Priority;
  workflowKey: string;
  totalSteps: number;
  requestedBy: string;
  requestedByEmail: string;
  returnedAt: string;
  returnedRemark: string;
  awaiting: boolean;
}

export type HistoryStatus = 'pending' | 'returned' | 'rejected' | 'approved' | 'cancelled';

/**
 * One record from a user's approval history. The user either raised it
 * (role: "requester") or decided on it (role: "approver"). `status` is the
 * effective state — a pending instance awaiting resubmission shows as
 * "returned".
 */
export interface HistoryItem {
  id: string;
  entity: string;
  entityId: string;
  amount: number;
  priority: Priority;
  workflowKey: string;
  status: HistoryStatus;
  storedStatus: string;
  currentStep: number;
  totalSteps: number;
  requestedBy: string;
  requestedByEmail: string;
  awaitingUser: string | null;
  role: 'requester' | 'approver';
  lastAction: {
    action: string;
    by: string;
    at: string;
    remark: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ApprovalInstanceSummary {
  id: string;
  workflowKey: string;
  workflowLabel: string;
  entity: string;
  entityId: string;
  projectId: string | null;
  amount: number;
  priority: Priority | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'returned';
  totalSteps: number;
  currentStep: number;
  requestedBy: string;
  requestedByEmail: string;
  completedAt: string | null;
  createdAt: string;
  chain: Array<{ order: number; name: string; role: string }>;
  actions: ApprovalInstanceAction[];
}

export interface ApprovalInstanceDetail extends ApprovalInstanceSummary {}

export interface ApprovalInstancePage {
  total: number;
  limit: number;
  offset: number;
  items: ApprovalInstanceSummary[];
}

export interface CpmActivity {
  wbsCode: string;
  description: string;
  owner: string;
  duration: number;
  predecessor: string;
  relType: string;
  lagDays: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  isCritical: boolean;
  progress: number;
  status: string;
  /** Calendar dates, derived from the project baseline start plus day offsets. */
  earlyStartISO: string;
  earlyFinishISO: string;
  lateFinishISO: string;
}

export interface CpmResult {
  activities: CpmActivity[];
  criticalPath: CpmActivity[];
  /** Day-offset of the project start (anchored to the earliest baseline start). */
  projectStart: number;
  /** Day-offset of the project finish. */
  projectFinish: number;
  /** ISO date of the project baseline start (anchor for day offsets). */
  projectStartISO: string;
  /** ISO date of the project finish. */
  projectFinishISO: string;
  issues: string[];
}

/**
 * WBS / critical path (CPM) roll-up. The backend computes early/late pass over
 * the schedule rows; this just fetches it for a project.
 */
export const wbsCpm = {
  async criticalPath(projectId: string): Promise<CpmResult> {
    return api<CpmResult>(`/records/wbs-critical-path?projectId=${encodeURIComponent(projectId)}`);
  },
};

export interface VendorScoreRow {
  vendor: string;
  onTimeDeliveryPct: number;
  qualityRejectionPct: number;
  responsivenessScore: number;
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D';
}

export interface VendorScoreResult {
  scored: VendorScoreRow[];
  noHistory: string[];
}

export const vendorScores = {
  /** Compute and persist vendor performance rows from GRN/PO data. */
  async compute(): Promise<VendorScoreResult> {
    return api<VendorScoreResult>('/records/vendor-scores');
  },
};

/**
 * The record engine.
 *
 * `types` are the admin-defined registers; `records` are the rows inside one.
 * A screen never names a Mongo collection — it names a type key, and the same
 * five calls serve every register in the app.
 */
export const records = {
  async types(suite?: string): Promise<RecordType[]> {
    return api<RecordType[]>(`/records/types${suite ? `?suite=${suite}` : ''}`);
  },

  async type(key: string): Promise<RecordType> {
    return api<RecordType>(`/records/types/${key}`);
  },

  async list(
    key: string,
    params: { search?: string; projectId?: string; limit?: number; skip?: number; sort?: string } = {},
  ): Promise<RecordListPage> {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.skip !== undefined) qs.set('skip', String(params.skip));
    if (params.sort) qs.set('sort', params.sort);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api<RecordListPage>(`/records/${key}${suffix}`);
  },

  async create(key: string, body: Record<string, unknown>): Promise<{ id: string; ref: string }> {
    return api(`/records/${key}`, { method: 'POST', body });
  },

  async update(
    key: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; ref: string }> {
    return api(`/records/${key}/${id}`, { method: 'PATCH', body });
  },

  async remove(key: string, id: string): Promise<{ id: string }> {
    return api(`/records/${key}/${id}`, { method: 'DELETE' });
  },

  /** CR-26: the procurement department dashboard, cross project. */
  async procurementMis(): Promise<ProcurementMis> {
    return api<ProcurementMis>('/records/procurement-mis');
  },

  /** CR-11: prefill the PM daily progress report from a day's DSRs. */
  async dprPrefill(projectId: string, date: string): Promise<Record<string, unknown> | null> {
    return api<Record<string, unknown> | null>(
      `/records/dpr-prefill?projectId=${encodeURIComponent(projectId)}&date=${encodeURIComponent(date)}`,
    );
  },

  async vocabulary(): Promise<RecordTypeVocabulary> {
    return api<RecordTypeVocabulary>('/records/vocabulary');
  },

  async createType(body: Record<string, unknown>): Promise<{ id: string; key: string }> {
    return api('/records/types', { method: 'POST', body });
  },

  async updateType(id: string, body: Record<string, unknown>): Promise<{ id: string; key: string }> {
    return api(`/records/types/${id}`, { method: 'PATCH', body });
  },

  async removeType(id: string): Promise<{ id: string }> {
    return api(`/records/types/${id}`, { method: 'DELETE' });
  },
};
