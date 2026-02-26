import React from 'react';
import { StrategyPlan, StrategyStep } from '../types';
import { CheckCircle2, Circle, Zap, Battery, Target } from 'lucide-react';

interface StrategyViewProps {
  plan: StrategyPlan;
}

export const StrategyView: React.FC<StrategyViewProps> = ({ plan }) => {
  return (
    <div className="space-y-8 animate-fade-in pb-20">
      
      <div className="grid grid-cols-1 gap-6">
        {plan.phases.map((phase, idx) => (
          <div key={idx} className="card bg-base-100 shadow-md border border-base-200">
            <div className="card-body p-0">
                <div className="bg-base-200 p-4 rounded-t-xl border-b border-base-200">
                    <h3 className="font-display font-bold text-lg text-primary">{phase.phaseName}</h3>
                </div>
                
                <div className="p-4 space-y-4">
                  {phase.steps.map((step) => (
                    <div key={step.id} className="flex flex-col md:flex-row gap-4 p-4 hover:bg-base-200/50 rounded-lg transition-colors border border-transparent hover:border-base-200">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h4 className="font-bold text-base text-slate-800">{step.title}</h4>
                            <div className="badge badge-neutral badge-sm gap-1">
                                <Target size={10} /> {step.channel}
                            </div>
                        </div>
                        <p className="text-sm opacity-80 leading-relaxed mb-3 text-slate-600">{step.description}</p>
                        
                        <div className="flex gap-2">
                             <div className={`badge badge-outline badge-sm gap-1 ${step.impact === 'High' ? 'badge-success' : 'badge-info'}`}>
                                <Zap size={10} /> {step.impact} Impact
                             </div>
                             <div className={`badge badge-outline badge-sm gap-1 ${step.effort === 'High' ? 'badge-error' : step.effort === 'Medium' ? 'badge-warning' : 'badge-success'}`}>
                                <Battery size={10} /> {step.effort} Effort
                             </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};