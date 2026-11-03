/** Public page identity. active describes user visibility, not an implicit execution target. */
export interface PageObservation {
  tabRef: string | number;
  title: string;
  url: string;
  active: boolean;
  pinned?: boolean;
  pageMode?: 'desktop' | 'mobile';
  usable?: boolean;
  readOnlyUsable?: boolean;
  ownedByCurrentTask?: boolean;
  ownerSessionId?: string;
  contentAccess?: unknown;
  securityGuardrailBlocked?: boolean;
  unusableCode?: string;
  unusableReason?: string;
}
