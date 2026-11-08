'use client';

// Administration > Company & profile: the company's name and primary contact (the first stage, a form that saves as a whole) and the organisation profile (the four stages
// that save as they are typed, which every framework's onboarding reads). One page where there were two tabs over the same columns (Company and Organisation Profile,
// G12 P-20). Open it on a profile stage with ?stage=<stage> (the framework onboarding pages link there); ?stage=profile opens the first stage still open.
import OrganisationProfile from '@/components/compliance/onboarding/profile/OrganisationProfile';
import CompanyDetails from './_company/CompanyDetails';

const INFO = "The organisation's name and primary contact, then the general facts every framework's onboarding reuses, kept once. Nothing here holds a framework back: an onboarding asks its own questions and only picks sites, systems, third parties and data types from here.";

export default function OrganisationPage() {
  return <OrganisationProfile title="Company & profile" info={INFO} lead={{ key: 'company', label: 'Company', panel: <CompanyDetails /> }} />;
}
