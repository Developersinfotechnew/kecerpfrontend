export interface ClientUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  moduleAccess: Record<string, 'view' | 'add' | 'edit' | 'full'>;
  projectScopeAll: boolean;
  projectIds: string[];
  clientIds: string[];
}

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  modules: string[];
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export interface SuiteCatalogue {
  suite: string;
  groups: NavGroup[];
}

/**
 * Partial on purpose. A suite missing from this map falls back to its raw key,
 * so an unrecognised suite renders its code rather than crashing.
 */
export const SUITE_LABELS: Partial<Record<string, string>> = {
  backoffice: 'General',
  shared: 'Head Office',
  epc: 'EPC',
  pmc: 'PMC',
  eptp: 'EPTP',
  om: 'O&M',
};

// ---------------------------------------------------------------------------
// Record engine
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'select'
  | 'status'
  | 'ref'
  | 'boolean'
  | 'file';

/**
 * The value of a `file` field, stored on the record.
 *
 * A descriptor, not the bytes. `url` carries a short-lived signed token that
 * authorises exactly one download, so a plain anchor opens the document with
 * no extra request and the upload directory stays off the public route table.
 */
export interface FileValue {
  url: string;
  name: string;
  size: number;
  mimetype: string;
}

export type RefTarget = 'project' | 'user' | 'client';

export interface RecordField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  refType: RefTarget | '';
  align: 'left' | 'right';
  listColumn: boolean;
  defaultValue: string;
  sortOrder: number;
}

export interface RecordType {
  id: string;
  key: string;
  label: string;
  description: string;
  suite: string;
  icon: string;
  permissionModule: string;
  refPrefix: string;
  titleField: string;
  fields: RecordField[];
  isSystem: boolean;
}

export interface RecordRow {
  id: string;
  ref: string;
  projectId: string | null;
  data: Record<string, unknown>;
  createdBy: { id: string; email: string; name: string };
  updatedBy: { id: string; email: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface RecordListPage {
  items: RecordRow[];
  total: number;
  limit: number;
  skip: number;
}

export interface RecordTypeVocabulary {
  fieldTypes: FieldType[];
  refTargets: RefTarget[];
  modules: string[];
  suites: string[];
}
