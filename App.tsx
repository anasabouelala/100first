import React, { useState, useEffect } from 'react';
import { AppMode, StrategyPlan } from './types';
import { generateLaunchStrategy } from './services/geminiService';
import { StrategyView } from './components/StrategyView';
import { RoastView } from './components/RoastView';
import { DistributionView } from './components/DistributionView';
import { ReconView } from './components/ReconView';
import { OutreachView } from './components/OutreachView';
import { ReadinessWidget } from './components/ReadinessWidget';
import { Rocket, Target, Zap, Layout, Loader2, Globe, Radar, MessageSquarePlus, Menu, Home, ArrowRight } from 'lucide-react';

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

  const navItems = [
    { id: 'DASHBOARD', label: 'Mission Control', icon: <Home size={20} /> },
    { id: AppMode.STRATEGY, label: 'Strategy Roadmap', icon: <Target size={20} /> },
    { id: AppMode.RECON, label: 'Competitor Analysis', icon: <Radar size={20} /> },
    { id: AppMode.ROAST, label: 'Landing Roast', icon: <Layout size={20} /> },
    { id: AppMode.DISTRIBUTION, label: 'Distribution', icon: <Globe size={20} /> },
    { id: AppMode.OUTREACH, label: 'Direct Outreach', icon: <MessageSquarePlus size={20} /> },
  ];

  const renderContent = () => {
    switch (mode) {
      case AppMode.ROAST: return <RoastView />;
      case AppMode.DISTRIBUTION: return <DistributionView />;
      case AppMode.RECON: return <ReconView />;
      case AppMode.OUTREACH: return <OutreachView />;
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
             <div className="flex flex-col md:flex-row gap-6 items-center justify-between bg-white p-8 rounded-3xl border border-base-200 shadow-sm">
                <div>
                   <h1 className="text-4xl font-display font-bold mb-2 text-brand-dark">Welcome, Founder.</h1>
                   <p className="opacity-80 max-w-md">Your mission control for user acquisition. Select a tool from the sidebar to begin your campaign.</p>
                </div>
                <div className="flex gap-4">
                    <button onClick={() => setMode(AppMode.RECON)} className="btn btn-primary text-white"><Radar size={18}/> Start Recon</button>
                    <button onClick={() => setMode(AppMode.STRATEGY)} className="btn btn-secondary text-white"><Target size={18}/> New Strategy</button>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div 
                  onClick={() => setMode(AppMode.ROAST)}
                  className="card bg-base-100 shadow-md hover:shadow-xl transition-all cursor-pointer border border-base-200 hover:border-accent/30"
                >
                    <div className="card-body">
                       <Layout className="text-accent mb-2" size={32} />
                       <h3 className="card-title">Conversion Roast</h3>
                       <p className="text-sm opacity-70">Analyze your landing page for conversion killers.</p>
                    </div>
                </div>
                
                <div 
                  onClick={() => setMode(AppMode.DISTRIBUTION)}
                  className="card bg-base-100 shadow-md hover:shadow-xl transition-all cursor-pointer border border-base-200 hover:border-secondary/30"
                >
                    <div className="card-body">
                       <Globe className="text-secondary mb-2" size={32} />
                       <h3 className="card-title">Distribution Channels</h3>
                       <p className="text-sm opacity-70">Find high-traffic communities relevant to your niche.</p>
                    </div>
                </div>

                <div 
                  onClick={() => setMode(AppMode.OUTREACH)}
                  className="card bg-base-100 shadow-md hover:shadow-xl transition-all cursor-pointer border border-base-200 hover:border-primary/30"
                >
                    <div className="card-body">
                       <MessageSquarePlus className="text-primary mb-2" size={32} />
                       <h3 className="card-title">Cold Outreach</h3>
                       <p className="text-sm opacity-70">Generate personalized icebreakers for high-value prospects.</p>
                    </div>
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

            <li className="menu-title opacity-50 uppercase text-xs tracking-wider mb-2 font-semibold">Tools</li>
            {navItems.map((item) => (
              <li key={item.id} className="mb-1">
                <button 
                  onClick={() => { setMode(item.id as any); if(window.innerWidth < 1024) setIsSidebarOpen(false); }}
                  className={`flex items-center gap-3 py-3 font-medium rounded-lg ${mode === item.id ? 'active bg-primary text-white' : 'hover:bg-base-200 text-slate-600'}`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </li>
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

export default App;