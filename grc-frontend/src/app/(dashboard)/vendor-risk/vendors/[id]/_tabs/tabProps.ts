// What every tab of the vendor record receives. The page (owner: B2) fetches the vendor once and passes it down.
export type TabProps = {
  vendorId: number;
  /** The engagement picked on the page (a picker bar above the tabs, only when there are several), or null for General (the supplier itself). */
  engagementId: number | null;
  onEngagementChange?: (id: number | null) => void;
  /** The vendor as GET /vendor-risk/vendors/{id} returns it; undefined while loading. */
  vendor: Record<string, any> | undefined;
  /** Deep links the page reads from the address: ?stage=<key> (Lifecycle) and ?finding=<id> (Findings). */
  stage?: string | null;
  findingId?: number | null;
  /** Counts up each time "VAT check" is picked in the head's menu: the Overview opens that section and brings it into view. */
  vatRequest?: number;
  /** Call after a change the header or right column must reflect (refetches the vendor and its engagements). */
  onChanged?: () => void;
};
