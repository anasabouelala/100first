import React, { useState, useEffect } from 'react';
import { AppMode, StrategyPlan } from './types';
import { generateLaunchStrategy } from './services/geminiService';
import { ProjectProvider, useProject } from './contexts/ProjectContext';
import { ProjectSetup, ProjectSummaryCard } from './components/ProjectSetup';
import { StrategyView } from './components/StrategyView';
import { DistributionView } from './components/DistributionView';
import { ReconView } from './components/ReconView';
import { ReadinessWidget } from './components/ReadinessWidget';
import { PersonaView } from './components/PersonaView';
import { UnifiedCommandCenter } from './components/UnifiedCommandCenter';
import { ContentEngineView } from './components/ContentEngineView';
import { AccountFinderView } from './components/AccountFinderView';
import {
  Rocket, Target, Zap, Globe, Radar, Menu, Home, ArrowRight, ShieldCheck,
  Users, Sparkles, ListChecks, Trash2, Crosshair, Loader2, Lock
} from 'lucide-react';

function AppInner() {
  const { project, isComplete, clearProject } = useProject();
  const [mode, setMode] = useState<AppMode | 'DASHBOARD'>('DASHBOARD');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingProject, setEditingProject] = useState(false);

  // Strategy state — driven entirely by project context
  const [plan, setPlan] = useState<StrategyPlan | null>(() => {
    const saved = localStorage.getItem('strategy_plan_v2');
    return saved ? JSON.parse(saved) : null;
  });
  const [loadingStrategy, setLoadingStrategy] = useState(false);

  useEffect(() => {
    if (plan) localStorage.setItem('strategy_plan_v2', JSON.stringify(plan));
    else localStorage.removeItem('strategy_plan_v2');
  }, [plan]);

  // Auto-clear stale strategy plan when project changes
  useEffect(() => {
    if (project) {
      const saved = localStorage.getItem('strategy_plan_v2');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.productName && parsed.productName !== project.productName) {
            setPlan(null);
          }
        } catch {}
      }
    }
  }, [project?.productName]);

  const handleGenerateStrategy = async () => {
    if (!project) return;
    setLoadingStrategy(true);
    try {
      const generatedPlan = await generateLaunchStrategy(project.productName, project.pitch, project.targetAudience);
      setPlan(generatedPlan);
    } catch (e) {
      console.error(e);
      alert("Failed to generate strategy. Please check console.");
    } finally {
      setLoadingStrategy(false);
    }
  };

  // ── First-time setup gate ──
  if (!isComplete) {
    return (
      <div className="min-h-screen bg-base-200">
        <ProjectSetup mode="first-time" />
      </div>
    );
  }

  const navGroups = [
    {
      title: 'Mission Control',
      items: [
        { id: 'DASHBOARD', label: 'Dashboard', icon: <Home size={18} /> },
        { id: AppMode.ANSWERLY_RADAR, label: 'Unified Radar', icon: <ShieldCheck size={18} /> },
      ]
    },
    {
      title: 'Growth Ops',
      items: [
        { id: AppMode.ACCOUNT_FINDER, label: 'Account Finder', icon: <Crosshair size={18} /> },
      ]
    },
    {
      title: 'Founder Suite',
      items: [
        { id: AppMode.STRATEGY, label: 'Launch Strategy', icon: <Target size={18} /> },
        { id: AppMode.RECON, label: 'Competitor Analysis', icon: <Radar size={18} /> },
        { id: AppMode.PERSONA, label: 'Buyer Persona', icon: <Users size={18} /> },
        { id: AppMode.DISTRIBUTION, label: 'Distribution', icon: <Globe size={18} /> },
      ]
    },
    {
      title: 'Execution',
      items: [
        { id: AppMode.CONTENT_ENGINE, label: 'Content Engine', icon: <Sparkles size={18} /> },
      ]
    }
  ];

  const renderContent = () => {
    // Project summary appears at top of every section (except dashboard which has its own hero)
    const projectHeader = mode !== 'DASHBOARD' && project && (
      <ProjectSummaryCard onEdit={() => setEditingProject(true)} />
    );

    switch (mode) {
      case AppMode.DISTRIBUTION:    return <>{projectHeader}<DistributionView /></>;
      case AppMode.RECON:           return <>{projectHeader}<ReconView /></>;
      case AppMode.PERSONA:         return <>{projectHeader}<PersonaView appName={project!.productName} appDesc={project!.pitch} category={project!.targetAudience} /></>;
      case AppMode.ANSWERLY_RADAR:  return <UnifiedCommandCenter appDesc={project!.pitch} />;
      case AppMode.CONTENT_ENGINE:  return <>{projectHeader}<ContentEngineView /></>;
      case AppMode.ACCOUNT_FINDER:  return <AccountFinderView />;
      case AppMode.STRATEGY:
        return (
          <>
            {projectHeader}
            {plan ? (
              <div className="space-y-6">
                <div className="flex justify-between items-center bg-base-100 p-4 rounded-xl shadow-sm">
                  <div>
                    <h3 className="font-bold text-lg">{plan.productName}</h3>
                    <p className="text-xs opacity-70">Active Strategy</p>
                  </div>
                  <button onClick={() => setPlan(null)} className="btn btn-sm btn-outline">
                    Reset Plan
                  </button>
                </div>
                <StrategyView plan={plan} />
              </div>
            ) : (
              <div className="hero min-h-[40vh] bg-base-100 rounded-3xl shadow-sm">
                <div className="hero-content text-center max-w-xl">
                  <div className="w-full">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <Target className="text-primary" size={28} />
                    </div>
                    <h1 className="text-3xl font-display font-bold mb-2">Generate Launch Strategy</h1>
                    <p className="opacity-70 mb-6">
                      A battle-tested roadmap built from your project data — no more forms.
                    </p>
                    <button onClick={handleGenerateStrategy}
                      disabled={loadingStrategy}
                      className="btn btn-primary px-8 py-3 text-base text-white shadow-lg">
                      {loadingStrategy ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />}
                      {loadingStrategy ? 'Building roadmap...' : 'Generate Roadmap'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        );

      case 'DASHBOARD':
      default:
        return (
          <div className="space-y-8 animate-fade-in">
            {/* Hero — uses project data */}
            <div className="flex flex-col lg:flex-row gap-6 items-center justify-between bg-gray-900 p-10 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-10 opacity-5 rotate-12">
                <Zap size={240} />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-black tracking-[0.3em] uppercase text-primary">Active project</span>
                  <button onClick={() => setEditingProject(true)}
                    className="text-[10px] font-bold tracking-widest uppercase text-white/40 hover:text-white transition-colors">Edit →</button>
                </div>
                <h1 className="text-5xl font-display font-bold mb-3 tracking-tight">{project!.productName}</h1>
                <p className="opacity-60 max-w-lg text-lg leading-relaxed line-clamp-2">{project!.pitch}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1 bg-white/10 rounded-full">{project!.category}</span>
                  <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1 bg-white/10 rounded-full">{project!.targetAudience}</span>
                  {project!.stage && <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1 bg-primary/20 text-primary rounded-full">{project!.stage}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 relative z-10">
                <button onClick={() => setMode(AppMode.ACCOUNT_FINDER)} className="btn bg-primary hover:bg-primary/90 border-none text-white px-8 h-14 rounded-2xl shadow-xl shadow-primary/20"><Crosshair size={20}/> Find Accounts</button>
                <button onClick={() => setMode(AppMode.ANSWERLY_RADAR)} className="btn bg-white/10 hover:bg-white/20 border-white/10 text-white px-8 h-14 rounded-2xl backdrop-blur-md"><ShieldCheck size={20}/> View Radar</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <DashboardCard onClick={() => setMode(AppMode.ACCOUNT_FINDER)} icon={<Crosshair size={28} className="text-primary" />} title="Account Finder" desc="Discover & track key accounts." color="blue" />
              <DashboardCard onClick={() => setMode(AppMode.ANSWERLY_RADAR)} icon={<ShieldCheck size={28} className="text-emerald-500" />} title="Unified Radar" desc="Engage tracked account posts." color="emerald" />
              <DashboardCard onClick={() => setMode(AppMode.DISTRIBUTION)} icon={<Globe size={28} className="text-amber-500" />} title="Distribution" desc="Find the best launch channels." color="amber" />
              <DashboardCard onClick={() => setMode(AppMode.CONTENT_ENGINE)} icon={<Sparkles size={28} className="text-purple-500" />} title="Content Engine" desc="Generate trending content." color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Operation Readiness</h3>
                    <p className="text-sm text-gray-400 mt-1">Foundational tasks for a successful launch</p>
                  </div>
                  <ListChecks className="text-gray-200" size={32} />
                </div>
                <ReadinessWidget />
              </div>

              <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-8 rounded-[2rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-between">
                <div className="relative z-10">
                  <Target className="mb-4 opacity-50" size={32} />
                  <h3 className="text-2xl font-bold mb-2">Build Your Roadmap</h3>
                  <p className="text-white/70 text-sm leading-relaxed">Generate a launch strategy tailored to {project!.productName} — using the data you already filled in.</p>
                </div>
                <button onClick={() => setMode(AppMode.STRATEGY)}
                  className="mt-8 w-full py-4 bg-white text-blue-700 rounded-2xl font-bold shadow-lg hover:bg-blue-50 transition-all flex items-center justify-center gap-2">
                  Generate Strategy <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="drawer lg:drawer-open">
      <input id="my-drawer-2" type="checkbox" className="drawer-toggle" checked={isSidebarOpen} onChange={() => setIsSidebarOpen(!isSidebarOpen)} />

      <div className="drawer-content flex flex-col bg-base-200 min-h-screen">
        <div className="w-full navbar bg-base-100 lg:hidden shadow-sm">
          <div className="flex-none">
            <label htmlFor="my-drawer-2" className="btn btn-square btn-ghost">
              <Menu />
            </label>
          </div>
          <div className="flex-1 px-2 mx-2 font-display font-bold text-xl">LaunchVelocity</div>
        </div>

        <main className="flex-1 p-4 lg:p-10 overflow-x-hidden">
          {renderContent()}
        </main>
      </div>

      <div className="drawer-side z-50 shadow-xl lg:shadow-none">
        <label htmlFor="my-drawer-2" aria-label="close sidebar" className="drawer-overlay"></label>
        <ul className="menu p-4 w-80 min-h-full bg-base-100 text-base-content flex flex-col justify-between border-r border-base-200">
          <div>
            <div className="px-4 py-4 mb-3 flex items-center gap-2">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Zap className="text-primary" size={24} />
              </div>
              <div>
                <h1 className="font-display font-bold text-xl leading-none tracking-tight">Launch<br/>Velocity</h1>
              </div>
            </div>

            {/* Active project pill in sidebar */}
            <div className="px-2 mb-4">
              <ProjectSummaryCard compact onEdit={() => setEditingProject(true)} />
            </div>

            {navGroups.map((group) => (
              <React.Fragment key={group.title}>
                <li className="menu-title opacity-40 uppercase text-[10px] tracking-[0.2em] mt-6 mb-2 font-black">{group.title}</li>
                {group.items.map((item) => (
                  <li key={item.id} className="mb-0.5">
                    <button
                      onClick={() => { setMode(item.id as any); if(window.innerWidth < 1024) setIsSidebarOpen(false); }}
                      className={`flex items-center gap-3 py-2.5 font-bold rounded-xl transition-all ${mode === item.id ? 'active bg-gray-900 text-white shadow-lg shadow-gray-200' : 'hover:bg-base-200 text-slate-500'}`}>
                      <span className={mode === item.id ? 'text-primary' : 'text-slate-400'}>{item.icon}</span>
                      <span className="text-sm">{item.label}</span>
                    </button>
                  </li>
                ))}
              </React.Fragment>
            ))}
          </div>

          <div className="mt-8 space-y-4">
            <button
              onClick={() => {
                if (window.confirm("FATAL RESET: This will permanently DELETE the project, all campaigns, prospects, leads, and extension data. You will start with a 100% clean session. Proceed?")) {
                  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    chrome.runtime.sendMessage({ action: 'STOP_RECON_MISSION' });
                    if (chrome.storage?.local) chrome.storage.local.clear();
                  }
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl transition-all font-black uppercase tracking-widest text-[10px] border border-transparent hover:border-red-100">
              <Trash2 size={16} />
              <span>Nuke Session</span>
            </button>

            <div className="divider my-4"></div>
            <div className="px-4 text-[9px] opacity-40 font-black uppercase tracking-[0.2em] text-center">
              System: Stable<br/>
              v1.1.0.UNIFIED
            </div>
          </div>
        </ul>
      </div>

      {/* Edit Project Modal */}
      {editingProject && (
        <ProjectSetup mode="edit" onClose={() => setEditingProject(false)} />
      )}
    </div>
  );
}

const DashboardCard = ({ onClick, icon, title, desc, color }: any) => (
  <div onClick={onClick}
    className={`group p-6 rounded-[2rem] bg-white border border-gray-100 shadow-sm hover:shadow-xl hover:border-${color}-200 transition-all cursor-pointer flex flex-col gap-4`}>
    <div className={`w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center transition-all group-hover:scale-110 group-hover:rotate-3`}>
      {icon}
    </div>
    <div>
      <h3 className="font-bold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-400 mt-1 leading-relaxed">{desc}</p>
    </div>
  </div>
);

export default function App() {
  return (
    <ProjectProvider>
      <AppInner />
    </ProjectProvider>
  );
}
