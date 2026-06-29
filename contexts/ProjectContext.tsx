import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// ─── Output language / dialect for AI content generation ──────────────
export type OutputLanguage = 'en' | 'ar' | 'ar-SA' | 'ar-AE' | 'fr';

export const LANGUAGE_OPTIONS: { value: OutputLanguage; label: string; note: string }[] = [
  { value: 'en',    label: 'English',                  note: 'Default' },
  { value: 'ar',    label: 'العربية الفصحى',           note: 'Classical Arabic' },
  { value: 'ar-SA', label: 'العربية — لهجة سعودية',    note: 'Saudi dialect' },
  { value: 'ar-AE', label: 'العربية — لهجة إماراتية',  note: 'Emirati dialect' },
  { value: 'fr',    label: 'Français',                 note: 'French' },
];

// ─── The single source of truth for product/project info ──────────────
export interface ProjectConfig {
  productName: string;        // e.g. "Viraholic"
  pitch: string;              // one-paragraph elevator pitch
  category: string;           // "B2B SaaS" | "DevTool" | "Consumer SaaS" | etc.
  targetAudience: string;     // who pays (used by Persona, Strategy, Distribution)

  // Optional but valuable
  valueProposition?: string;  // unique angle / wedge
  pricingModel?: string;      // "$29/mo Pro · Free tier" / "Annual contract starting $5K"
  competitors?: string;       // comma-separated vendor names
  stage?: 'idea' | 'pre-launch' | 'launched' | 'scaling';
  websiteUrl?: string;
  primaryGoal?: string;       // "Get first 100 users" / "Reach $10K MRR"
  outputLanguage?: OutputLanguage;  // language/dialect for all AI-generated content

  // Metadata
  createdAt: string;
  updatedAt: string;
}

interface ProjectContextValue {
  project: ProjectConfig | null;
  setProject: (project: ProjectConfig | null) => void;
  updateProject: (patch: Partial<ProjectConfig>) => void;
  isComplete: boolean;        // whether all required fields are filled
  clearProject: () => void;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

const STORAGE_KEY = 'project_config_v1';

// Legacy migration: prior versions used 'launch_velocity_plan' for strategy info
const migrateFromLegacy = (): ProjectConfig | null => {
  try {
    const legacy = localStorage.getItem('launch_velocity_plan');
    if (!legacy) return null;
    const parsed = JSON.parse(legacy);
    if (!parsed?.productName) return null;
    return {
      productName: parsed.productName,
      pitch: '',
      category: 'B2B SaaS',
      targetAudience: parsed.targetAudience || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  } catch { return null; }
};

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [project, setProjectState] = useState<ProjectConfig | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
      return migrateFromLegacy();
    } catch { return null; }
  });

  useEffect(() => {
    if (project) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [project]);

  const setProject = (p: ProjectConfig | null) => {
    if (p) {
      setProjectState({ ...p, updatedAt: new Date().toISOString() });
    } else {
      setProjectState(null);
    }
  };

  const updateProject = (patch: Partial<ProjectConfig>) => {
    setProjectState(prev => prev
      ? { ...prev, ...patch, updatedAt: new Date().toISOString() }
      : null
    );
  };

  const clearProject = () => setProjectState(null);

  // Only the product name is required to enter the app. Pitch / category / audience
  // sharpen the AI but are optional — collected progressively, never a first-run wall.
  const isComplete = !!(project?.productName);

  return (
    <ProjectContext.Provider value={{ project, setProject, updateProject, isComplete, clearProject }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = (): ProjectContextValue => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within a ProjectProvider');
  return ctx;
};
