import React, { useState, useEffect } from 'react';
import { Check, Circle } from 'lucide-react';

const CHECKLIST_ITEMS = [
  { id: 'landing', label: 'Landing Page Live' },
  { id: 'analytics', label: 'Analytics Configured' },
  { id: 'waitlist', label: 'Waitlist Form' },
  { id: 'socials', label: 'Social Handles' },
  { id: 'legal', label: 'Terms & Privacy' },
  { id: 'demo', label: 'Demo Video' },
];

export const ReadinessWidget: React.FC = () => {
  const [checkedItems, setCheckedItems] = useState<string[]>(() => {
    const saved = localStorage.getItem('launch_readiness');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('launch_readiness', JSON.stringify(checkedItems));
  }, [checkedItems]);

  const toggleItem = (id: string) => {
    setCheckedItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const progress = Math.round((checkedItems.length / CHECKLIST_ITEMS.length) * 100);

  return (
    <div className="space-y-3 px-1">
      <div className="flex items-center gap-3 mb-2">
         <progress className="progress progress-success w-full" value={progress} max="100"></progress>
         <span className="text-xs font-bold w-8 text-right">{progress}%</span>
      </div>
      
      <div className="space-y-1">
        {CHECKLIST_ITEMS.map(item => {
            const isChecked = checkedItems.includes(item.id);
            return (
                <div 
                    key={item.id} 
                    onClick={() => toggleItem(item.id)}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all hover:bg-base-300 ${isChecked ? 'opacity-50' : 'opacity-100'}`}
                >
                    {isChecked ? (
                        <Check size={16} className="text-success" />
                    ) : (
                        <Circle size={16} className="text-base-content/30" />
                    )}
                    <span className={`text-xs ${isChecked ? 'line-through decoration-base-content/50' : ''}`}>
                        {item.label}
                    </span>
                </div>
            );
        })}
      </div>
    </div>
  );
};