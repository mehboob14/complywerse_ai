// Shared types + helpers for the /frameworks and /frameworks/manage pages.

export interface UploadedFramework {
  id: number;
  name: string;
  version: string;
  framework_type?: string | null;
  upload_status: string;
  controls_count: number;
  is_shared: boolean;
  is_active: boolean;
  created_at: string;
  classification?: string;
  classification_confidence?: number;
  classification_reasoning?: string;
  framework_purpose?: string;
  framework_scope?: string;
  framework_objectives?: string[];
  target_audience?: string;
  certification_body?: string;
  certification_validity_period?: string;
  certification_levels?: unknown[];
  certification_lifecycle?: unknown;
  required_artifacts?: unknown;
  regulatory_authority?: string;
  compliance_deadline?: string;
  penalty_for_non_compliance?: string;
  adoption_approach?: unknown;
  parsed_controls_count?: number;
}

export const stripCertificationPostfix = (value?: string): string => {
  if (!value) return '';
  return value.replace(/\s+certification\s*$/i, '').trim();
};

export const frameworkDedupeKey = (framework: UploadedFramework): string => {
  const normalizedName = stripCertificationPostfix(framework.name).toLowerCase();
  const version = (framework.version || '').toLowerCase();
  return `${normalizedName}::${version}`;
};

export const dedupeFrameworks = (frameworksArray: UploadedFramework[]): UploadedFramework[] => {
  const statusPriority = (status?: string) => {
    const priorities: Record<string, number> = {
      classified: 7,
      published: 6,
      completed: 5,
      parsed: 4,
      classifying: 3,
      text_extracted: 2,
      draft: 1,
    };
    return priorities[(status || '').toLowerCase()] || 0;
  };
  return Object.values(
    frameworksArray.reduce((acc, framework) => {
      const key = frameworkDedupeKey(framework);
      const existing = acc[key];
      if (!existing) { acc[key] = framework; return acc; }

      const existingScore = statusPriority(existing.upload_status);
      const candidateScore = statusPriority(framework.upload_status);
      if (candidateScore > existingScore) { acc[key] = framework; return acc; }
      if (candidateScore === existingScore) {
        const existingTs = new Date(existing.created_at || 0).getTime();
        const candidateTs = new Date(framework.created_at || 0).getTime();
        if (candidateTs >= existingTs) acc[key] = framework;
      }
      return acc;
    }, {} as Record<string, UploadedFramework>)
  );
};
