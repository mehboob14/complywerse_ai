// What every tab of the vendor record receives. The page (owner: B2) fetches the vendor once and passes it down.
export type TabProps = {
  vendorId: number;
  /** The engagement picked on the page, or null for General (the supplier itself). */
  engagementId: number | null;
  /** The vendor as GET /vendor-risk/vendors/{id} returns it; undefined while loading. */
  vendor: Record<string, any> | undefined;
};
