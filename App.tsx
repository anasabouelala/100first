import React, { useState, useEffect } from 'react';
import { AppMode, StrategyPlan } from './types';
import { generateLaunchStrategy } from './services/geminiService';
import { StrategyView } from './components/StrategyView';
import { RoastView } from './components/RoastView';
import { DistributionView } from './components/DistributionView';
import { ReconView } from './components/ReconView';
import { OutreachView } from './components/OutreachView';
import { ReadinessWidget } from './components/ReadinessWidget';
import { PersonaView } from './components/PersonaView';
import { ICPReconView } from './components/ICPReconView';
import { UnifiedCommandCenter } from './components/UnifiedCommandCenter';
import { ForumOpportunitiesView } from './components/ForumOpportunitiesView';
import { ContentEngineView } from './components/ContentEngineView';
import { PlatformIntelligenceView } from './components/PlatformIntelligenceView';
import { PipelineView } from './components/PipelineView';
import { IntelligenceTriage } from './components/IntelligenceTriage';
import { 
  Rocket, Target, Zap, Layout, Loader2, Globe, Radar, MessageSquarePlus, 
  Menu, Home, ArrowRight, ShieldCheck, Activity, Users, Sparkles, Database, ListChecks, GitMerge
} from 'lucide-react';

function App() {
  const [mode, setMode] = useState<AppMode | 'DASHBOARD'>('DASHBOARD');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Strategy State
  const [appName, setAppName] = useState('');
  const [appDesc, setAppDesc] = useState('');
  const [audience, setAudience] = useState('');
  const [plan, setPlan] = useState<StrategyPlan | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);

  // Load plan from local storage on mount
  useEffect(() => {
    const savedPlan = localStorage.getItem('launch_velocity_plan');
    if (savedPlan) {
      try {
        setPlan(JSON.parse(savedPlan));
      } catch (e) {
        console.error("Failed to parse saved plan");
      }
    }
  }, []);

  // Save plan to local storage when it changes
  useEffect(() => {
    if (plan) {
      localStorage.setItem('launch_velocity_plan', JSON.stringify(plan));
    } else {
      localStorage.removeItem('launch_velocity_plan');
    }
  }, [plan]);

  const handleGenerateStrategy = async () => {
    if (!appName || !appDesc || !audience) return;
    setLoadingStrategy(true);
    try {
      const generatedPlan = await generateLaunchStrategy(appName, appDesc, audience);
      setPlan(generatedPlan);
      setMode(AppMode.STRATEGY);
    } catch (e) {
      console.error(e);
      alert("Failed to generate strategy. Please check console.");
    } finally {
      setLoadingStrategy(false);
    }
  };

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
        { id: AppMode.ICP_RECON, label: 'ICP Recon Pulse', icon: <Activity size={18} /> },
        { id: AppMode.TRIAGE, label: 'Intelligence Triage', icon: <ListChecks size={18} /> },
        { id: AppMode.PIPELINE, label: 'Pipeline', icon: <GitMerge size={18} /> },
        { id: AppMode.FORUM_LEADS, label: 'Forum Intel', icon: <Users size={18} /> },
        { id: AppMode.PLATFORM_INSIGHTS, label: 'Platform Insights', icon: <Database size={18} /> },
      ]
    },
    {
      title: 'Founder Suite',
      items: [
        { id: AppMode.STRATEGY, label: 'Launch Strategy', icon: <Target size={18} /> },
        { id: AppMode.RECON, label: 'Competitor Analysis', icon: <Radar size={18} /> },
        { id: AppMode.PERSONA, label: 'Buyer Persona', icon: <Users size={18} /> },
        { id: AppMode.ROAST, label: 'Landing Roast', icon: <Layout size={18} /> },
        { id: AppMode.DISTRIBUTION, label: 'Distribution', icon: <Globe size={18} /> },
      ]
    },
    {
      title: 'Execution',
      items: [
        { id: AppMode.CONTENT_ENGINE, label: 'Content Engine', icon: <Sparkles size={18} /> },
        { id: AppMode.OUTREACH, label: 'Direct Outreach', icon: <MessageSquarePlus size={18} /> },
      ]
    }
  ];

  const renderContent = () => {
    switch (mode) {
      case AppMode.ROAST: return <RoastView />;
      case AppMode.DISTRIBUTION: return <DistributionView />;
      case AppMode.RECON: return <ReconView />;
      case AppMode.PERSONA: return <PersonaView appName={appName} appDesc={appDesc} category={audience} />;
      case AppMode.OUTREACH: return <OutreachView appDesc={appDesc} />;
      case AppMode.ICP_RECON: return <ICPReconView />;
      case AppMode.ANSWERLY_RADAR: return <UnifiedCommandCenter appDesc={appDesc} />;
      case AppMode.PIPELINE: return <PipelineView appDesc={appDesc} />;
      case AppMode.TRIAGE: return <IntelligenceTriage />;
      case AppMode.FORUM_LEADS: return <ForumOpportunitiesView />;
      case AppMode.CONTENT_ENGINE: return <ContentEngineView />;
      case AppMode.PLATFORM_INSIGHTS: return <PlatformIntelligenceView />;
      case AppMode.STRATEGY:
        if (plan) {
          return (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-base-100 p-4 rounded-xl shadow-sm">
                 <div>
                    <h3 className="font-bold text-lg">{plan.productName}</h3>
                    <p className="text-xs opacity-70">Active Strategy</p>
                 </div>
                 <button 
                   onClick={() => { setPlan(null); setAppName(''); setAppDesc(''); setAudience(''); }} 
                   className="btn btn-sm btn-outline"
                 >
                   Reset Plan
                 </button>
              </div>
              <StrategyView plan={plan} />
            </div>
          );
        }
        return (
          <div className="hero min-h-[60vh] bg-base-100 rounded-3xl shadow-sm">
            <div className="hero-content text-center max-w-2xl">
              <div className="w-full">
                <h1 className="text-4xl font-display font-bold mb-2">Launch<span className="text-primary">Strategy</span></h1>
                <p className="py-6 opacity-70">
                  Generate a battle-tested roadmap for your first 100 users.
                </p>

                <div className="card bg-base-200 shadow-inner text-left">
                  <div className="card-body gap-4">
                    <div className="form-control">
                      <label className="label"><span className="label-text font-bold">Product Name</span></label>
                      <input 
                        className="input input-bordered w-full bg-base-100" 
                        placeholder="e.g. SuperTask.ai"
                        value={appName}
                        onChange={(e) => setAppName(e.target.value)}
                      />
                    </div>
                    
                    <div className="form-control">
                      <label className="label"><span className="label-text font-bold">Elevator Pitch</span></label>
                      <textarea 
                        className="textarea textarea-bordered h-24 bg-base-100" 
                        placeholder="What does it do? Who is it for?"
                        value={appDesc}
                        onChange={(e) => setAppDesc(e.target.value)}
                      />
                    </div>

                    <div className="form-control">
                      <label className="label"><span className="label-text font-bold">Target Audience</span></label>
                      <input 
                        className="input input-bordered w-full bg-base-100" 
                        placeholder="e.g. Freelance Designers"
                        value={audience}
                        onChange={(e) => setAudience(e.target.value)}
                      />
                    </div>

                    <div className="card-actions justify-end mt-4">
                      <button 
                        onClick={handleGenerateStrategy}
                        disabled={loadingStrategy || !appName || !appDesc}
                        className="btn btn-primary w-full text-lg text-white"
                      >
                        {loadingStrategy ? <span className="loading loading-spinner"></span> : <Rocket />}
                        Generate Roadmap
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'DASHBOARD':
      default:
        return (
          <div className="space-y-8 animate-fade-in">
             <div className="flex flex-col lg:flex-row gap-6 items-center justify-between bg-gray-900 p-10 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5 rotate-12">
                   <Zap size={240} />
                </div>
                <div className="relative z-10">
                   <h1 className="text-5xl font-display font-bold mb-4 tracking-tight">Mission <span className="text-primary">Control</span></h1>
                   <p className="opacity-60 max-w-lg text-lg leading-relaxed">The engine for your first 100 users. Deploy social radar, surgical search dorks, and AI-powered engagement from one dashboard.</p>
                </div>
                <div className="flex flex-wrap gap-4 relative z-10">
                    <button onClick={() => setMode(AppMode.ICP_RECON)} className="btn bg-primary hover:bg-primary/90 border-none text-white px-8 h-14 rounded-2xl shadow-xl shadow-primary/20"><Activity size={20}/> Launch Recon</button>
                    <button onClick={() => setMode(AppMode.ANSWERLY_RADAR)} className="btn bg-white/10 hover:bg-white/20 border-white/10 text-white px-8 h-14 rounded-2xl backdrop-blur-md"><ShieldCheck size={20}/> View Radar</button>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <DashboardCard 
                  onClick={() => setMode(AppMode.ICP_RECON)}
                  icon={<Activity size={28} className="text-primary" />}
                  title="ICP Recon Pulse"
                  desc="Run surgical social searches."
                  color="blue"
                />
                <DashboardCard 
                  onClick={() => setMode(AppMode.ANSWERLY_RADAR)}
                  icon={<ShieldCheck size={28} className="text-emerald-500" />}
                  title="Unified Radar"
                  desc="Manage leads and engagement."
                  color="emerald"
                />
                <DashboardCard 
                  onClick={() => setMode(AppMode.FORUM_LEADS)}
                  icon={<Users size={28} className="text-amber-500" />}
                  title="Forum Intel"
                  desc="Find intent in Reddit/HN."
                  color="amber"
                />
                <DashboardCard 
                  onClick={() => setMode(AppMode.CONTENT_ENGINE)}
                  icon={<Sparkles size={28} className="text-purple-500" />}
                  title="Content Engine"
                  desc="Generate trending content."
                  color="purple"
                />
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
                      <p className="text-white/70 text-sm leading-relaxed">Don't fly blind. Generate an AI strategy tailored for your product's niche and audience.</p>
                   </div>
                   <button 
                     onClick={() => setMode(AppMode.STRATEGY)}
                     className="mt-8 w-full py-4 bg-white text-blue-700 rounded-2xl font-bold shadow-lg hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                   >
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
      
      {/* Drawer Content: Now Light Gray for better card contrast */}
      <div className="drawer-content flex flex-col bg-base-200 min-h-screen">
        {/* Mobile Header */}
        <div className="w-full navbar bg-base-100 lg:hidden shadow-sm">
          <div className="flex-none">
            <label htmlFor="my-drawer-2" className="btn btn-square btn-ghost">
              <Menu />
            </label>
          </div>
          <div className="flex-1 px-2 mx-2 font-display font-bold text-xl">LaunchVelocity</div>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 p-4 lg:p-10 overflow-x-hidden">
          {renderContent()}
        </main>
      </div> 
      
      <div className="drawer-side z-50 shadow-xl lg:shadow-none">
        <label htmlFor="my-drawer-2" aria-label="close sidebar" className="drawer-overlay"></label> 
        {/* Sidebar: Now White for classic dashboard look */}
        <ul className="menu p-4 w-80 min-h-full bg-base-100 text-base-content flex flex-col justify-between border-r border-base-200">
          {/* Sidebar Content */}
          <div>
            <div className="px-4 py-4 mb-6 flex items-center gap-2">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Zap className="text-primary" size={24} />
              </div>
              <div>
                <h1 className="font-display font-bold text-xl leading-none tracking-tight">Launch<br/>Velocity</h1>
              </div>
            </div>

            {navGroups.map((group) => (
              <React.Fragment key={group.title}>
                <li className="menu-title opacity-40 uppercase text-[10px] tracking-[0.2em] mt-6 mb-2 font-black">{group.title}</li>
                {group.items.map((item) => (
                  <li key={item.id} className="mb-0.5">
                    <button 
                      onClick={() => { setMode(item.id as any); if(window.innerWidth < 1024) setIsSidebarOpen(false); }}
                      className={`flex items-center gap-3 py-2.5 font-bold rounded-xl transition-all ${mode === item.id ? 'active bg-gray-900 text-white shadow-lg shadow-gray-200' : 'hover:bg-base-200 text-slate-500'}`}
                    >
                      <span className={mode === item.id ? 'text-primary' : 'text-slate-400'}>{item.icon}</span>
                      <span className="text-sm">{item.label}</span>
                    </button>
                  </li>
                ))}
              </React.Fragment>
            ))}
          </div>

          <div className="mt-8">
            <li className="menu-title opacity-50 uppercase text-xs tracking-wider mb-4 font-semibold">Readiness Checklist</li>
            <ReadinessWidget />
            
            <div className="divider my-4"></div>
            <div className="px-4 text-xs opacity-50 text-center">
              Powered by Gemini 3 Flash<br/>
              v1.0.0
            </div>
          </div>
        </ul>
      
      </div>
    </div>
  );
}

const DashboardCard = ({ onClick, icon, title, desc, color }: any) => (
  <div 
    onClick={onClick}
    className={`group p-6 rounded-[2rem] bg-white border border-gray-100 shadow-sm hover:shadow-xl hover:border-${color}-200 transition-all cursor-pointer flex flex-col gap-4`}
  >
      <div className={`w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center transition-all group-hover:scale-110 group-hover:rotate-3`}>
         {icon}
      </div>
      <div>
         <h3 className="font-bold text-gray-900">{title}</h3>
         <p className="text-xs text-gray-400 mt-1 leading-relaxed">{desc}</p>
      </div>
  </div>
);

export default App;